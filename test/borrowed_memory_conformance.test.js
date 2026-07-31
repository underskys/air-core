#!/usr/bin/env node
"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const air = require("../src");
const { borrowedSliceInterfaceDescriptor } = require("../src/borrowed_slices");
const { lowerToWat, watToWasm } = require("../src/lower_wasm");
const { parseAir } = require("../src/parser");
const { verifyModule } = require("../src/verifier");

const root = path.resolve(__dirname, "..");
const examples = path.join(root, "examples", "borrowed_memory_conformance");

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function bytesOf(view) {
  return Buffer.from(view.buffer, view.byteOffset, view.byteLength);
}

function writeI32(view, value) {
  new DataView(view.buffer, view.byteOffset, view.byteLength).setInt32(0, value, true);
}

function readI32(view) {
  return new DataView(view.buffer, view.byteOffset, view.byteLength).getInt32(0, true);
}

function descriptor(buffer, access, transferMode, options = {}) {
  return {
    buffer,
    access,
    actualLength: options.actualLength === undefined ? buffer.byteLength : options.actualLength,
    maxLength: options.maxLength,
    alignment: options.alignment === undefined ? 4 : options.alignment,
    aliasGroup: options.aliasGroup === undefined ? null : options.aliasGroup,
    memoryDomain: "wasm-linear",
    transferMode
  };
}

function expectDiagnostic(result, code) {
  assert.strictEqual(result.result, null);
  assert.deepStrictEqual(result.diagnostics.map((item) => item.code), [code]);
  assert.strictEqual(result.evidence.failureReason, code);
  assert(!JSON.stringify(result).includes("RuntimeError"));
  assert(!JSON.stringify(result).includes("\n    at "));
}

async function buildPackage(relativeDir) {
  const sourceDir = path.join(examples, relativeDir);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `air-conformance-${relativeDir}-`));
  const source = fs.readFileSync(path.join(sourceDir, "module.air"), "utf8");
  const manifest = fs.readFileSync(path.join(sourceDir, "air.package.json"), "utf8");
  fs.writeFileSync(path.join(dir, "module.air"), source);
  fs.writeFileSync(path.join(dir, "air.package.json"), manifest);
  const sourcePath = path.join(dir, "module.air");
  const firstModule = parseAir(source, sourcePath);
  const secondModule = parseAir(source, sourcePath);
  verifyModule(firstModule);
  verifyModule(secondModule);
  const firstDescriptor = borrowedSliceInterfaceDescriptor(firstModule);
  const secondDescriptor = borrowedSliceInterfaceDescriptor(secondModule);
  assert.deepStrictEqual(firstDescriptor, secondDescriptor);
  const firstWasm = Buffer.from(await watToWasm(lowerToWat(firstModule), sourcePath));
  const secondWasm = Buffer.from(await watToWasm(lowerToWat(secondModule), sourcePath));
  assert(firstWasm.equals(secondWasm), `${relativeDir} lowering must be deterministic`);
  fs.writeFileSync(path.join(dir, "module.wasm"), firstWasm);
  const certificate = air.createPackageResourceCertificate(dir, { certificateRequired: true });
  assert.strictEqual(certificate.status, "verified");
  assert.strictEqual(certificate.requiredBoundsSatisfied, true);
  return {
    certificate,
    descriptor: firstDescriptor,
    dir,
    interfaceDigest: sha256(Buffer.from(JSON.stringify(firstDescriptor))),
    module: firstModule,
    source,
    wasm: firstWasm,
    wasmDigest: sha256(firstWasm)
  };
}

async function instantiate(pkg) {
  return air.instantiateAirModule({
    wasmBytes: pkg.wasm,
    packageDigest: pkg.certificate.package.digest
  });
}

async function runAffine(pkg, transferMode) {
  const instance = await instantiate(pkg);
  let src;
  let dst;
  if (transferMode === "copied_into_wasm") {
    src = new Float32Array([1, 2, 3, 4]);
    dst = new Float32Array(4);
  } else {
    src = new Float32Array(instance.exports.memory.buffer, 0, 4);
    dst = new Float32Array(instance.exports.memory.buffer, 64, 4);
    src.set([1, 2, 3, 4]);
  }
  const result = air.invokeBorrowedMemory({
    instance,
    packageDigest: pkg.certificate.package.digest,
    interfaceDescriptor: pkg.descriptor,
    entrypoint: "affine",
    bindings: {
      src: descriptor(src, "readonly", transferMode, { maxLength: 16 }),
      dst: descriptor(dst, "writeonly", transferMode, { maxLength: 16 })
    },
    arguments: { count: 4, scale: 2, bias: 0.5 },
    resourceCertificate: pkg.certificate
  });
  assert.deepStrictEqual(result.diagnostics, []);
  assert.strictEqual(result.result, 4);
  assert.deepStrictEqual(Array.from(dst), [2.5, 4.5, 6.5, 8.5]);
  return {
    bytes: bytesOf(dst),
    digest: sha256(bytesOf(dst)),
    evidence: result.evidence,
    values: Array.from(dst)
  };
}

async function runChecksum(pkg, transferMode) {
  const instance = await instantiate(pkg);
  let input;
  let state;
  if (transferMode === "copied_into_wasm") {
    input = Uint8Array.from({ length: 16 }, (_, index) => index + 1);
    state = new Uint8Array(4);
  } else {
    input = new Uint8Array(instance.exports.memory.buffer, 0, 16);
    state = new Uint8Array(instance.exports.memory.buffer, 64, 4);
    input.set(Uint8Array.from({ length: 16 }, (_, index) => index + 1));
  }
  writeI32(state, 10);
  const result = air.invokeBorrowedMemory({
    instance,
    packageDigest: pkg.certificate.package.digest,
    interfaceDescriptor: pkg.descriptor,
    entrypoint: "checksum",
    bindings: {
      input: descriptor(input, "readonly", transferMode, { maxLength: 16 }),
      state: descriptor(state, "readwrite", transferMode, { maxLength: 4 })
    },
    arguments: { word_count: 4 },
    resourceCertificate: pkg.certificate
  });
  assert.deepStrictEqual(result.diagnostics, []);
  assert.strictEqual(result.result, 146);
  assert.strictEqual(readI32(state), 146);
  return {
    bytes: bytesOf(state),
    digest: sha256(bytesOf(state)),
    evidence: result.evidence,
    value: readI32(state)
  };
}

async function runHostileCases(pkg) {
  const makeBase = async (entrypoint = "affine") => {
    const instance = await instantiate(pkg);
    return {
      instance,
      packageDigest: pkg.certificate.package.digest,
      interfaceDescriptor: pkg.descriptor,
      entrypoint,
      arguments: { count: entrypoint === "affine_empty" ? 0 : 4, scale: 2, bias: 0.5 },
      resourceCertificate: pkg.certificate
    };
  };
  const valid = (buffer, access, options = {}) =>
    descriptor(buffer, access, "copied_into_wasm", {
      maxLength: 16,
      ...options
    });

  const zero = air.invokeBorrowedMemory({
    ...await makeBase("affine_empty"),
    bindings: {
      src: valid(new Uint8Array(0), "readonly", { maxLength: 0 }),
      dst: valid(new Uint8Array(0), "writeonly", { maxLength: 0 })
    }
  });
  assert.strictEqual(zero.result, 0);
  assert.deepStrictEqual(zero.diagnostics, []);

  const negative = air.invokeBorrowedMemory({
    ...await makeBase(),
    bindings: {
      src: valid(new Uint8Array(16), "readonly", { actualLength: -1 }),
      dst: valid(new Uint8Array(16), "writeonly")
    }
  });
  expectDiagnostic(negative, "air.borrow.length_out_of_range");

  const oversized = air.invokeBorrowedMemory({
    ...await makeBase(),
    bindings: {
      src: valid(new Uint8Array(17), "readonly", { actualLength: 17 }),
      dst: valid(new Uint8Array(16), "writeonly")
    }
  });
  expectDiagnostic(oversized, "air.borrow.length_out_of_range");

  const relationBase = await makeBase();
  relationBase.arguments = { count: 5, scale: 2, bias: 0.5 };
  const relation = air.invokeBorrowedMemory({
    ...relationBase,
    bindings: {
      src: valid(new Uint8Array(16), "readonly"),
      dst: valid(new Uint8Array(16), "writeonly")
    }
  });
  expectDiagnostic(relation, "air.borrow.entry_relation_failed");

  const permission = air.invokeBorrowedMemory({
    ...await makeBase("affine_empty"),
    bindings: {
      src: valid(new Uint8Array(0), "readwrite", { maxLength: 0 }),
      dst: valid(new Uint8Array(0), "writeonly", { maxLength: 0 })
    }
  });
  expectDiagnostic(permission, "air.borrow.access_mismatch");

  const overlapBuffer = new ArrayBuffer(24);
  const overlap = air.invokeBorrowedMemory({
    ...await makeBase(),
    bindings: {
      src: valid(new Uint8Array(overlapBuffer, 0, 16), "readonly"),
      dst: valid(new Uint8Array(overlapBuffer, 8, 16), "writeonly")
    }
  });
  expectDiagnostic(overlap, "air.borrow.mutable_overlap");

  const alignment = air.invokeBorrowedMemory({
    ...await makeBase(),
    bindings: {
      src: valid(new Uint8Array(new ArrayBuffer(17), 1, 16), "readonly"),
      dst: valid(new Uint8Array(16), "writeonly")
    }
  });
  expectDiagnostic(alignment, "air.borrow.alignment_mismatch");

  const stale = new Uint8Array(16);
  structuredClone(stale, { transfer: [stale.buffer] });
  const detached = air.invokeBorrowedMemory({
    ...await makeBase(),
    bindings: {
      src: valid(stale, "readonly"),
      dst: valid(new Uint8Array(16), "writeonly")
    }
  });
  expectDiagnostic(detached, "air.borrow.buffer_detached");
}

function memoryPlan() {
  return {
    input: {
      byteOffset: 0,
      actualLength: 16,
      maxLength: 16,
      access: "readonly",
      alignment: 4,
      aliasGroup: null,
      memoryDomain: "wasm-linear",
      transferMode: "wasm_memory_view"
    },
    state: {
      byteOffset: 64,
      actualLength: 4,
      maxLength: 4,
      access: "readwrite",
      alignment: 4,
      aliasGroup: null,
      memoryDomain: "wasm-linear",
      transferMode: "wasm_memory_view"
    }
  };
}

async function runRealtimeStateConformance(pkg) {
  const create = () => air.createVerifiedExecutionSession({
    packageDir: pkg.dir,
    resourceCertificate: pkg.certificate,
    entrypoint: "checksum",
    memoryPlan: memoryPlan(),
    arguments: { word_count: 4 }
  });
  const first = await create();
  const second = await create();
  assert.deepStrictEqual(first.preparationEvidence, second.preparationEvidence);
  assert.strictEqual(
    first.preparationEvidence.certificateDigest,
    pkg.certificate.certificateDigest
  );
  first.memoryView("input").set(Uint8Array.from({ length: 16 }, (_, index) => index + 1));
  writeI32(first.memoryView("state"), 10);
  const originalStringify = JSON.stringify;
  const originalCreateHash = crypto.createHash;
  JSON.stringify = () => {
    throw new Error("serializer entered realtime invocation");
  };
  crypto.createHash = () => {
    throw new Error("hash entered realtime invocation");
  };
  try {
    assert.strictEqual(first.invoke(), 146);
    assert.strictEqual(first.invoke(), 282);
  } finally {
    JSON.stringify = originalStringify;
    crypto.createHash = originalCreateHash;
  }
  assert.strictEqual(readI32(first.memoryView("state")), 282);
  const evidence = first.evidence();
  assert.strictEqual(evidence.counters.invocationCount, 2);

  const stale = await create();
  const staleView = stale.memoryView("input");
  stale.memory.grow(1);
  assert.strictEqual(staleView.byteLength, 0);
  assert.throws(
    () => stale.invoke(),
    (error) => error && error.code === "air.realtime.memory_changed"
  );
  return evidence;
}

async function runLegacyCompatibility() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "air-conformance-legacy-"));
  const source = `module legacy_scalar
capabilities { }
requires export identity
export func identity(value: i32) -> i32 {
entry:
  return %value
}
`;
  fs.writeFileSync(path.join(dir, "module.air"), source);
  fs.writeFileSync(path.join(dir, "air.package.json"), JSON.stringify({
    name: "legacy-scalar",
    version: "0.50.0",
    airAbi: "0.10",
    hostAbi: "0.11",
    entry: "module.air",
    wasm: "module.wasm",
    capabilities: [],
    targetProfiles: []
  }, null, 2));
  const mod = parseAir(source, path.join(dir, "module.air"));
  verifyModule(mod);
  const wasm = Buffer.from(await watToWasm(lowerToWat(mod), path.join(dir, "module.air")));
  fs.writeFileSync(path.join(dir, "module.wasm"), wasm);
  const report = air.checkPackageDir(dir, { built: true });
  assert.notStrictEqual(report.status, "fail");
  const instance = await air.instantiateAirModule({ wasmBytes: wasm });
  assert.strictEqual(instance.exports.identity(37), 37);
  return true;
}

function runBrowser(affine, checksum) {
  const runner = path.join(
    root,
    "consumer_evidence",
    "demos",
    "borrowed_memory",
    "browser_conformance.mjs"
  );
  const stdout = execFileSync(process.execPath, [
    runner,
    path.join(affine.dir, "module.wasm"),
    path.join(checksum.dir, "module.wasm")
  ], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 4 * 1024 * 1024
  });
  return JSON.parse(stdout);
}

(async () => {
  const affine = await buildPackage("vector_affine");
  const checksum = await buildPackage("checksum");
  assert.strictEqual(affine.module.capabilities.size, 0);
  assert.strictEqual(checksum.module.capabilities.size, 0);
  assert.deepStrictEqual(affine.module.externs, []);
  assert.deepStrictEqual(checksum.module.externs, []);

  const affineCopied = await runAffine(affine, "copied_into_wasm");
  const affineView = await runAffine(affine, "wasm_memory_view");
  assert(affineCopied.bytes.equals(affineView.bytes));
  assert.strictEqual(affineCopied.digest, affineView.digest);

  const affineRepeat = await runAffine(affine, "copied_into_wasm");
  assert.deepStrictEqual(affineRepeat.evidence, affineCopied.evidence);

  const checksumCopied = await runChecksum(checksum, "copied_into_wasm");
  const checksumView = await runChecksum(checksum, "wasm_memory_view");
  assert(checksumCopied.bytes.equals(checksumView.bytes));
  assert.strictEqual(checksumCopied.digest, checksumView.digest);

  await runHostileCases(affine);
  const sessionEvidence = await runRealtimeStateConformance(checksum);
  const legacyCompatible = await runLegacyCompatibility();
  const browser = runBrowser(affine, checksum);

  assert.strictEqual(browser.kind, "air.borrowedMemoryBrowserConformance");
  assert.strictEqual(browser.browser, "playwright-chromium");
  assert.deepStrictEqual(browser.result.affineCopied.outputBytes, Array.from(affineCopied.bytes));
  assert.deepStrictEqual(browser.result.affineView.outputBytes, Array.from(affineView.bytes));
  assert.strictEqual(browser.result.affineCopied.outputDigest, affineCopied.digest);
  assert.strictEqual(browser.result.affineView.outputDigest, affineView.digest);
  assert.strictEqual(browser.result.affineCopied.wasmDigest, affine.wasmDigest);
  assert.strictEqual(browser.result.affineView.wasmDigest, affine.wasmDigest);
  assert.deepStrictEqual(browser.result.checksumCopied.outputBytes, Array.from(checksumCopied.bytes));
  assert.deepStrictEqual(browser.result.checksumView.outputBytes, Array.from(checksumView.bytes));
  assert.strictEqual(browser.result.checksumCopied.outputDigest, checksumCopied.digest);
  assert.strictEqual(browser.result.checksumView.outputDigest, checksumView.digest);
  assert.strictEqual(browser.result.checksumCopied.wasmDigest, checksum.wasmDigest);
  assert.strictEqual(browser.result.checksumView.wasmDigest, checksum.wasmDigest);

  console.log(JSON.stringify({
    status: "pass",
    cases: 20,
    nodeConformance: "pass",
    browserConformance: "pass:playwright-chromium",
    copiedMode: "pass",
    wasmViewMode: "pass",
    realtimeSession: "pass",
    stateContinuity: sessionEvidence.counters.invocationCount === 2,
    legacyCompatibility: legacyCompatible,
    affine: {
      sourceDigest: sha256(Buffer.from(affine.source)),
      interfaceDigest: affine.interfaceDigest,
      wasmDigest: affine.wasmDigest,
      outputDigest: affineCopied.digest
    },
    checksum: {
      sourceDigest: sha256(Buffer.from(checksum.source)),
      interfaceDigest: checksum.interfaceDigest,
      wasmDigest: checksum.wasmDigest,
      outputDigest: checksumCopied.digest
    }
  }));
})().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
