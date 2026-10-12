#!/usr/bin/env node
"use strict";

// AIR 0.52.1 QA52 correction vectors (AIR-0052-1-QA52-REQUEST-CHANGES-CORRECTION-0002).
// P1-1 run_package admission bounds, P1-2 linked-package host capacity and
// region provenance, P1-3 legacy verifier analysis limits, and the bounded P2
// corrections. Expected outcomes follow spec/MEMORY.md, spec/AIR_CORE.md and
// docs/VERIFIED_RESOURCE_CERTIFICATE.md. Nothing here asserts wall-clock time.

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const air = require("../src");
const { parseAir } = require("../src/parser");
const verifier = require("../src/verifier");
const { lowerToWat, watToWasm } = require("../src/lower_wasm");
const { buildLinkedPackage } = require("../src/linked_package");
const { certifiedAdmissionBound } = require("../src/run_package");
const { analyzeObservationOnlyFunctions } = require("../src/observation_safety");
const { createLspDiagnostics } = require("../src/lsp_diagnostics");
const { REGION_BACKING_MAX_BYTES } = require("../src/region_bounds");

const root = path.resolve(__dirname, "..");
const LIMITS = verifier.LEGACY_VERIFIER_ANALYSIS_LIMITS;
const results = [];

function test(name, fn) {
  results.push({ name, fn });
}

function parse(source, file = "<qa52-correction>") {
  return parseAir(source, file, { resolveSourceImports: false });
}

function verify(source, options = {}) {
  const mod = parse(source);
  verifier.verifyModule(mod, options);
  return mod;
}

function rejectsWith(fn, pattern) {
  let error = null;
  try {
    fn();
  } catch (err) {
    error = err;
  }
  assert(error, `expected rejection matching ${pattern}`);
  assert(!(error instanceof RangeError), `raw RangeError: ${error && error.message}`);
  assert.match(String(error.message), pattern);
  return error;
}

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writePackage(dir, files, manifest = {}) {
  for (const [relative, source] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, relative)), { recursive: true });
    fs.writeFileSync(path.join(dir, relative), source);
  }
  fs.writeFileSync(path.join(dir, "air.package.json"), `${JSON.stringify({
    name: "qa52-correction",
    version: "0.1.0",
    airAbi: "0.10",
    hostAbi: "0.10",
    entry: "main.air",
    capabilities: [],
    targetProfiles: [],
    ...manifest
  }, null, 2)}\n`);
}

// ---------------------------------------------------------------------------
// P1-1 run_package admission
// ---------------------------------------------------------------------------

const toolGate = path.join(root, "examples", "tool_gate");
const { createToolGateRequest } = require(path.join(toolGate, "request.js"));

const phiFn = (name, bodyLine) => `
func ${name}(n: i32) -> i32 {
entry:
  %zero:i32 = const.i32 0
  br loop
loop:
  %i:i32 = phi.i32 entry:%zero, body:%next
  %done:bool = i32.ge_s %i, %n
  br_if %done, exit, body
body:
  %id:i32 = const.i32 1
  ${bodyLine}
  %one:i32 = const.i32 1
  %next:i32 = i32.add %i, %one
  br loop
exit:
  return %i
}`;

function pureOverflowChain(k) {
  let out = phiFn("g1", "%x:i32 = i32.add %i, %id");
  for (let i = 2; i <= k; i += 1) out += phiFn(`g${i}`, `%r:i32 = @g${i - 1}(%n)`);
  return out;
}

function toolGateModule({ emits = 1, extraFns = "", extraCall = "", budget = null, imports = "" } = {}) {
  const emitLines = Array.from({ length: emits }, (_, idx) =>
    `  %s${idx}:i32 = @output.emit(OUT_TOOL_INTENT, %intent_target, %intent_amount, %intent_redaction, %intent_quota)`).join("\n");
  return `module agent_tool_gate
${imports}const OUT_TOOL_INTENT:i32 = 4101
capabilities { output }
effects { ${budget || `output.emit <= ${Math.max(emits, 1)}`} }
requires export decide

extern output.emit(output_id: i32, arg0: i32, arg1: i32, arg2: i32, arg3: i32) -> i32
${extraFns}
export func decide(amount: i32, amount_limit: i32, quota_used: i32, quota_limit: i32, rate_used: i32, rate_limit: i32, target_id: i32, allowed_target_id: i32, now: i32, expires_at: i32, redaction_flag: i32) -> i32 {
entry:
  %amount_ok:bool = i32.le_s %amount, %amount_limit
  br_if %amount_ok, emit, denied
emit:
  %zero:i32 = 0
${extraCall}  %intent_target:i32 = add %target_id, %zero
  %intent_amount:i32 = add %amount, %zero
  %intent_redaction:i32 = add %redaction_flag, %zero
  %intent_quota:i32 = add %quota_used, %zero
${emitLines}
  %allow:i32 = 1
  return %allow
denied:
  %deny:i32 = 0
  return %deny
}
`;
}

async function runToolGate({ source, requiredBounds = null, limits = {}, files = {} }) {
  const dir = tempDir("air-qa52-runpkg-");
  try {
    fs.cpSync(toolGate, dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "module.air"), source);
    for (const [relative, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, relative), text);
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "air.package.json"), "utf8"));
    if (requiredBounds) manifest.resourceCertificate.requiredBounds = requiredBounds;
    fs.writeFileSync(path.join(dir, "air.package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    return await air.run(createToolGateRequest({ directory: dir, limits }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function codes(result) {
  return (result.diagnostics || []).map((item) => item.code);
}

function assertNotExecuted(result) {
  assert.strictEqual(result.decision.status, "deny");
  assert.strictEqual(result.evidence.execution.status, "not_run");
  assert.deepStrictEqual(result.outputs, []);
}

test("P1-1.1 finite zero host-call bound is admitted when the limit permits", async () => {
  const dir = tempDir("air-qa52-zero-");
  try {
    fs.cpSync(toolGate, dir, { recursive: true });
    const source = fs.readFileSync(path.join(toolGate, "module.air"), "utf8")
      .replace(/\n {2}%status:i32 = @output\.emit[^\n]*/, "")
      .replace("effects { output.emit <= 1, cpu.branches <= 1 }", "effects { cpu.branches <= 1 }")
      .replace("capabilities { output }", "capabilities { }")
      .replace(/\nextern output\.emit[^\n]*\n/, "\n")
      .replace("const OUT_TOOL_INTENT:i32 = 4101\n", "");
    fs.writeFileSync(path.join(dir, "module.air"), source);
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "air.package.json"), "utf8"));
    manifest.capabilities = [];
    delete manifest.outputContracts;
    fs.writeFileSync(path.join(dir, "air.package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    const result = await air.run(createToolGateRequest({ directory: dir, adapters: {}, grant: { effects: [] }, limits: { maxOutputs: 1, maxHostCalls: 1 } }));
    assert.strictEqual(result.resourceCertificate.bounds.hostCalls.status, "verified");
    assert.strictEqual(result.resourceCertificate.bounds.hostCalls.totalUpperBound, 0);
    assert.deepStrictEqual(result.decision, { code: 1, reasonCode: "allowed", status: "allow" });
    assert.deepStrictEqual(result.diagnostics, []);
    assert.strictEqual(result.evidence.execution.status, "executed");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("P1-1.2 finite bound within maxHostCalls is admitted and executes", async () => {
  const result = await runToolGate({ source: toolGateModule({ emits: 1 }), limits: { maxOutputs: 1, maxHostCalls: 1 } });
  assert.deepStrictEqual(result.decision, { code: 1, reasonCode: "allowed", status: "allow" });
  assert.strictEqual(result.outputs.length, 1);
});

test("P1-1.3 finite bound above maxHostCalls is denied before execution", async () => {
  const result = await runToolGate({ source: toolGateModule({ emits: 2 }), requiredBounds: ["memory"], limits: { maxOutputs: 2, maxHostCalls: 1 } });
  assert(codes(result).includes("air.run.resource_limit_exceeded"), codes(result).join(","));
  assert.strictEqual(result.decision.reasonCode, "authority_mismatch");
  assertNotExecuted(result);
});

test("P1-1.4 unknown (overflowed) host-call bound fails closed: QA52 counterexample", async () => {
  const source = toolGateModule({ emits: 2, extraFns: pureOverflowChain(5), extraCall: "  %w:i32 = @g5(%zero)\n" });
  const result = await runToolGate({ source, requiredBounds: ["memory"], limits: { maxOutputs: 2, maxHostCalls: 1 } });
  assert.strictEqual(result.resourceCertificate.status, "verified");
  assert.strictEqual(result.resourceCertificate.bounds.hostCalls.status, "unknown");
  assert.strictEqual(result.resourceCertificate.bounds.hostCalls.totalUpperBound, null);
  assert(codes(result).includes("air.run.resource_bound_overflow"), codes(result).join(","));
  assert.strictEqual(result.decision.reasonCode, "resource_bound_unproven");
  assertNotExecuted(result);
  // Same package, generous limit: still denied, because absence is not zero.
  const generous = await runToolGate({ source, requiredBounds: ["memory"], limits: { maxOutputs: 2, maxHostCalls: 1000 } });
  assert(codes(generous).includes("air.run.resource_bound_overflow"));
  assertNotExecuted(generous);
});

test("P1-1.5 unsupported cross-module composition fails closed with its own reason", async () => {
  const helper = `module helper
capabilities { }

export func touch(x: i32) -> i32 {
entry:
  return %x
}
`;
  const source = toolGateModule({ emits: 1, imports: 'use "./helper.air" as helper\n', extraCall: "  %t:i32 = @helper.touch(%zero)\n" });
  const result = await runToolGate({ source, requiredBounds: ["memory"], limits: { maxOutputs: 1, maxHostCalls: 1 }, files: { "helper.air": helper } });
  assert.strictEqual(result.resourceCertificate.bounds.hostCalls.status, "unknown");
  assert(result.resourceCertificate.classifications.unknown.some((item) =>
    item.category === "hostCalls" && item.code === "package_call_composition_unproven"));
  assert(codes(result).includes("air.run.resource_bound_unproven"), codes(result).join(","));
  assertNotExecuted(result);
});

test("P1-1.6 malformed certificate bounds are invalid, never zero", () => {
  const verified = (section) => ({ bounds: { hostCalls: section }, classifications: { unknown: [] } });
  assert.deepStrictEqual(certifiedAdmissionBound(verified({ status: "verified", totalUpperBound: 0 }), "hostCalls", "totalUpperBound"),
    { state: "finite", value: 0, reasons: [] });
  for (const [section, reason] of [
    [undefined, "section_missing"],
    [[], "section_missing"],
    [{ status: "verified", totalUpperBound: null }, "bound_missing"],
    [{ status: "verified" }, "bound_missing"],
    [{ status: "verified", totalUpperBound: -1 }, "bound_not_exact"],
    [{ status: "verified", totalUpperBound: 1.5 }, "bound_not_exact"],
    [{ status: "verified", totalUpperBound: "2" }, "bound_not_exact"],
    [{ status: "verified", totalUpperBound: 2 ** 53 }, "bound_not_exact"],
    [{ status: "maybe", totalUpperBound: 2 }, "status_invalid"]
  ]) {
    const bound = certifiedAdmissionBound(verified(section), "hostCalls", "totalUpperBound");
    assert.strictEqual(bound.state, "invalid", JSON.stringify(section));
    assert.deepStrictEqual(bound.reasons, [reason]);
  }
  assert.strictEqual(certifiedAdmissionBound(null, "hostCalls", "totalUpperBound").state, "invalid");
  const unknown = certifiedAdmissionBound({
    bounds: { hostCalls: { status: "unknown", totalUpperBound: 2 } },
    classifications: { unknown: [{ category: "hostCalls", code: "package_call_composition_unproven" }] }
  }, "hostCalls", "totalUpperBound");
  assert.deepStrictEqual(unknown, { state: "unknown", reasons: ["package_call_composition_unproven"] });
  const overflow = certifiedAdmissionBound({
    bounds: { hostCalls: { status: "unknown", totalUpperBound: null } },
    classifications: { unknown: [{ category: "hostCalls", code: "work_bound_overflow" }] }
  }, "hostCalls", "totalUpperBound");
  assert.strictEqual(overflow.state, "overflow");
  const unexplained = certifiedAdmissionBound({ bounds: { hostCalls: { status: "unknown" } } }, "hostCalls", "totalUpperBound");
  assert.deepStrictEqual(unexplained, { state: "unknown", reasons: ["unknown_reason_missing"] });
});

test("P1-1.6 the validator rejects verified certificates with null or negative totals", () => {
  const mod = verify(`module qa52_cert
capabilities { }
export func run(n: i32) -> i32 {
entry:
  return %n
}`);
  const certificate = verifier.createVerifiedResourceCertificate(mod, { packageName: "qa52", mode: "required" });
  assert.strictEqual(certificate.status, "verified");
  const crypto = require("crypto");
  const forge = (mutate) => {
    const copy = JSON.parse(JSON.stringify(certificate));
    mutate(copy);
    delete copy.certificateDigest;
    const payload = JSON.parse(verifier.stableCertificateStringify(copy));
    const digest = `sha256:${crypto.createHash("sha256").update(`AIR_VERIFIED_RESOURCE_CERTIFICATE_V1\0${verifier.stableCertificateStringify(payload)}`).digest("hex")}`;
    return { ...copy, certificateDigest: digest };
  };
  const self = forge(() => {});
  assert.deepStrictEqual(verifier.validateVerifiedResourceCertificate(self, { required: true }).diagnostics, [],
    "re-digest helper must reproduce the certificate digest");
  for (const mutate of [
    (c) => { c.bounds.hostCalls.totalUpperBound = null; },
    (c) => { delete c.bounds.hostCalls.totalUpperBound; },
    (c) => { c.bounds.hostCalls.totalUpperBound = -5; },
    (c) => { c.bounds.outputs.totalHostCallUpperBound = null; },
    (c) => { c.bounds.loops.totalDynamicLoopFuelUpperBound = null; },
    (c) => { delete c.bounds.hostCalls; }
  ]) {
    const codesFound = verifier.validateVerifiedResourceCertificate(forge(mutate), { required: true }).diagnostics.map((item) => item.code);
    assert(codesFound.includes("air.resource_certificate.bound_invalid"), codesFound.join(","));
  }
});

// ---------------------------------------------------------------------------
// P1-2 linked-package host capacity and region provenance
// ---------------------------------------------------------------------------

function hostCapacitySource({ size = 16, cap = "%c", neighbour = 16, extra = "", freeBefore = false } = {}) {
  return `module main
capabilities { fs }
extern fs.read_file(path_ptr: i32, path_len: i32, out_ptr: ptr, out_cap: i32) -> i32

export func run(c: i32) -> i32 {
entry:
  %n:i32 = ${size}
  %m:i32 = ${neighbour}
  %a:ptr = alloc_region %n
  %b:ptr = alloc_region %m
  %z:i32 = 0
  %init:i32 = 11
  store.i32 %b, %z, %init
  %p:i32 = 0
${extra}${freeBefore ? "  free_region %a\n" : ""}  %r:i32 = @fs.read_file(%p, %p, %a, ${cap})
  %seen:i32 = load.i32 %b, %z
  free_region %b
${freeBefore ? "" : "  free_region %a\n"}  return %seen
}
`;
}

// Honest host: writes exactly `cap` bytes at out_ptr.
async function runWithHonestHost(wasm, arg) {
  const calls = [];
  let memory = null;
  const module = await WebAssembly.compile(wasm);
  const imports = {};
  for (const imp of WebAssembly.Module.imports(module)) {
    imports[imp.module] = imports[imp.module] || {};
    if (imp.kind === "function") {
      imports[imp.module][imp.name] = (...args) => {
        calls.push(args);
        const [, , outPtr, cap] = args;
        new Uint8Array(memory.buffer, outPtr, cap).fill(0x7f);
        return cap;
      };
    }
  }
  const instance = await WebAssembly.instantiate(module, imports);
  memory = instance.exports.memory;
  try {
    return { value: instance.exports.run(arg), calls };
  } catch (error) {
    assert(error instanceof WebAssembly.RuntimeError, `expected a trap, got ${error && error.message}`);
    return { trap: true, calls };
  }
}

async function buildStandalone(source) {
  return watToWasm(lowerToWat(verify(source)), "standalone.wat");
}

async function buildLinked(source, files = {}) {
  const dir = tempDir("air-qa52-linked-");
  try {
    writePackage(dir, { "main.air": source, ...files }, { capabilities: /capabilities \{ fs \}/.test(source) ? ["fs"] : [] });
    const built = await buildLinkedPackage(dir, path.join(dir, "out.wasm"), {});
    return fs.readFileSync(built.output);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Both build paths must give the same observable outcome.
async function bothPaths(source, arg) {
  const standalone = await runWithHonestHost(await buildStandalone(source), arg);
  const linked = await runWithHonestHost(await buildLinked(source), arg);
  assert.deepStrictEqual(linked, standalone, "linked and single-module paths must agree");
  return linked;
}

test("P1-2.1 16-byte region with capacity 16 is valid on both paths", async () => {
  const out = await bothPaths(hostCapacitySource(), 16);
  assert.strictEqual(out.value, 11);
  assert.deepStrictEqual(out.calls, [[0, 0, 1024, 16]]);
});

test("P1-2.2 capacity 0 keeps the accepted semantics (host called, nothing written)", async () => {
  const out = await bothPaths(hostCapacitySource(), 0);
  assert.strictEqual(out.value, 11);
  assert.deepStrictEqual(out.calls, [[0, 0, 1024, 0]]);
  const statics = await bothPaths(hostCapacitySource({ cap: "%z" }), 0);
  assert.strictEqual(statics.value, 11);
});

test("P1-2.3 capacity 8192 over a 16-byte region is rejected; QA52 overwrite oracle", async () => {
  for (const cap of [17, 64, 8192]) {
    const out = await bothPaths(hostCapacitySource(), cap);
    assert.strictEqual(out.trap, true, `capacity ${cap}`);
    assert.deepStrictEqual(out.calls, [], "no host call on a rejected preflight");
  }
  // The neighbouring live region keeps its value: never 0x7f7f7f7f.
  const literal = hostCapacitySource({ cap: "%big", extra: "  %big:i32 = 8192\n" });
  rejectsWith(() => verify(literal), /air\.memory\.region_bounds_static: @fs\.read_file capacity argument 3 exceeds the region size/);
  await assert.rejects(() => buildLinked(literal), /link plan failed/);
});

test("P1-2.4 negative capacity is rejected before the host call", async () => {
  const out = await bothPaths(hostCapacitySource(), -1);
  assert.strictEqual(out.trap, true);
  assert.deepStrictEqual(out.calls, []);
  rejectsWith(() => verify(hostCapacitySource({ cap: "%neg", extra: "  %neg:i32 = -1\n" })), /always negative/);
});

test("P1-2.5 capacity arithmetic overflow is rejected before the host call", async () => {
  const source = hostCapacitySource({ cap: "%wrapped", extra: "  %max:i32 = 2147483647\n  %wrapped:i32 = i32.add %c, %max\n" });
  for (const arg of [1, 16, 2147483647]) {
    const out = await bothPaths(source, arg);
    assert.strictEqual(out.trap, true, `arg ${arg}`);
    assert.deepStrictEqual(out.calls, []);
  }
});

test("P1-2.6 a freed region is rejected as a host buffer", async () => {
  const source = hostCapacitySource({ freeBefore: true });
  rejectsWith(() => verify(source), /pointer %a is not a live region/);
  await assert.rejects(() => buildLinked(source), /link plan failed/);
});

test("P1-2.7 a foreign pointer is rejected; lowering without verification fails closed", async () => {
  const source = `module main
capabilities { fs }
extern fs.read_file(path_ptr: i32, path_len: i32, out_ptr: ptr, out_cap: i32) -> i32

func write_into(out: ptr, cap: i32) -> i32 {
entry:
  %p:i32 = 0
  %r:i32 = @fs.read_file(%p, %p, %out, %cap)
  return %r
}

export func run(c: i32) -> i32 {
entry:
  %n:i32 = 16
  %a:ptr = alloc_region %n
  %r:i32 = @write_into(%a, %c)
  free_region %a
  return %r
}
`;
  rejectsWith(() => verify(source), /pointer %out is not a live region/);
  await assert.rejects(() => buildLinked(source), /link plan failed/);
  // Defense in depth: an unverified AST is never lowered without the check.
  assert.throws(() => lowerToWat(parse(source)), /cannot bind host buffer for @fs\.read_file: argument 2 is not a live region pointer/);
  const unverified = lowerToWat(parse(hostCapacitySource()));
  assert(/i32\.gt_u/.test(unverified) && unverified.includes("__air_region_bounds_fail"),
    "an unannotated host call still gets the runtime capacity check");
});

test("P1-2.8/9 interior host pointers are not expressible; the interior view is extent-checked", async () => {
  // `ptr` has a single provenance (alloc_region) and no arithmetic: an
  // offset pointer cannot be formed, so an interior host buffer cannot exist.
  rejectsWith(() => verify(hostCapacitySource({ cap: "%c", extra: "  %eight:i32 = 8\n  %inner:i32 = i32.add %a, %eight\n" })), /expected i32, got ptr/);
  // The legitimate interior view is slice.sub over a region slice: accepted
  // only within the remaining extent of its parent.
  const view = (len) => `module main
capabilities { }

export func run(len: i32) -> i32 {
entry:
  %bytes:i32 = 16
  %ptr:ptr = alloc_region %bytes
  %s:slice = slice.from_region %ptr, %bytes
  %off:i32 = 8
  %inner:slice = slice.sub %s, %off, %len
  %n:i32 = slice.len %inner
  free_region %ptr
  return %n
}
`;
  const wasm = await buildStandalone(view());
  const { instance } = await WebAssembly.instantiate(wasm, {});
  assert.strictEqual(instance.exports.run(8), 8);
  assert.throws(() => instance.exports.run(9), WebAssembly.RuntimeError);
  const linked = await buildLinked(view());
  const linkedInstance = (await WebAssembly.instantiate(linked, {})).instance;
  assert.strictEqual(linkedInstance.exports.run(8), 8);
  assert.throws(() => linkedInstance.exports.run(9), WebAssembly.RuntimeError);
});

test("P1-2.10 two adjacent large live regions cannot alias through capacity", async () => {
  const source = hostCapacitySource({ size: 8192, neighbour: 8192 });
  const fits = await bothPaths(source, 8192);
  assert.strictEqual(fits.value, 11);
  assert.deepStrictEqual(fits.calls, [[0, 0, 1024, 8192]]);
  const over = await bothPaths(source, 8193);
  assert.strictEqual(over.trap, true);
  assert.deepStrictEqual(over.calls, []);
});

// P2-3: valid static regions above 4096 bytes on the linked path.
test("P2-3 linked static regions above 4096 bytes use the verified slot", async () => {
  for (const size of [4096, 4097, 8192, 65536]) {
    const last = Math.floor((size - 4) / 4) * 4;
    const source = `module main
capabilities { }

export func run() -> i32 {
entry:
  %big:i32 = ${size}
  %small:i32 = 16
  %a:ptr = alloc_region %big
  %b:ptr = alloc_region %small
  %zero:i32 = 0
  %init:i32 = 11
  store.i32 %b, %zero, %init
  %off:i32 = ${last}
  %v:i32 = 77
  store.i32 %a, %off, %v
  %seen:i32 = load.i32 %b, %zero
  free_region %b
  free_region %a
  return %seen
}
`;
    const standalone = (await WebAssembly.instantiate(await buildStandalone(source), {})).instance.exports.run();
    const linked = (await WebAssembly.instantiate(await buildLinked(source), {})).instance.exports.run();
    assert.strictEqual(standalone, 11, `standalone ${size}`);
    assert.strictEqual(linked, 11, `linked ${size}`);
  }
});

// P2-4: checked total region backing.
function regionSites(count, size = 16 * 1024 * 1024) {
  const lines = [];
  for (let idx = 0; idx < count; idx += 1) {
    lines.push(`  %r${idx}:ptr = alloc_region %size`);
  }
  for (let idx = count - 1; idx >= 0; idx -= 1) lines.push(`  free_region %r${idx}`);
  return `module main
capabilities { }

export func run() -> i32 {
entry:
  %size:i32 = ${size}
${lines.join("\n")}
  %zero:i32 = 0
  return %zero
}
`;
}

test("P2-4 total region backing is checked before WAT or Wasm generation", () => {
  assert.strictEqual(REGION_BACKING_MAX_BYTES, 256 * 1024 * 1024);
  const atLimit = verify(regionSites(16));
  const wat = lowerToWat(atLimit);
  assert.match(wat, /\(memory \(export "memory"\) 4097\)/);
  const over = rejectsWith(() => verify(regionSites(17)), /air\.memory\.region_backing_unsupported: region slots need 285212672 bytes; the maintenance limit is 268435456 bytes/);
  assert.strictEqual(over.code, "air.memory.region_backing_unsupported");
  for (const count of [256, 300]) rejectsWith(() => verify(regionSites(count)), /air\.memory\.region_backing_unsupported/);
});

test("P2-4 the merged linked module keeps the same backing ceiling", async () => {
  const sites = (count) => {
    const lines = [];
    for (let idx = 0; idx < count; idx += 1) lines.push(`  %r${idx}:ptr = alloc_region %size`);
    for (let idx = count - 1; idx >= 0; idx -= 1) lines.push(`  free_region %r${idx}`);
    return lines.join("\n");
  };
  const helper = `module big
capabilities { }

export func touch(x: i32) -> i32 {
entry:
  %size:i32 = 16777216
${sites(9)}
  return %x
}
`;
  const main = `module main
use "./big.air" as big
capabilities { }

export func run(x: i32) -> i32 {
entry:
  %size:i32 = 16777216
${sites(9)}
  %r:i32 = @big.touch(%x)
  return %r
}
`;
  // Each module alone is inside the ceiling (9 x 16 MiB).
  verify(main.replace('use "./big.air" as big\n', "").replace("  %r:i32 = @big.touch(%x)\n  return %r", "  return %x"));
  verify(helper, { library: true });
  await assert.rejects(() => buildLinked(main, { "big.air": helper }), (err) =>
    err.code === "air.memory.region_backing_unsupported" && /region slots need 285212672 bytes/.test(err.message));
});

// ---------------------------------------------------------------------------
// P1-3 legacy verifier analysis limits
// ---------------------------------------------------------------------------

function chainSource(depth, chains = 1) {
  let src = "module qa52_chain\ncapabilities { }\n";
  for (let c = 0; c < chains; c += 1) {
    src += `\nfunc c${c}_l0(x: i32) -> i32 {\nentry:\n  %one:i32 = const.i32 1\n  %r:i32 = i32.add %x, %one\n  return %r\n}\n`;
    for (let j = 1; j <= depth; j += 1) {
      src += `\nfunc c${c}_l${j}(x: i32) -> i32 {\nentry:\n  %a0:i32 = @c${c}_l${j - 1}(%x)\n  return %a0\n}\n`;
    }
  }
  src += "\nexport func run(x: i32) -> i32 {\nentry:\n";
  for (let c = 0; c < chains; c += 1) src += `  %r${c}:i32 = @c${c}_l${depth}(%x)\n`;
  src += "  return %r0\n}\n";
  return src;
}

function dagSource(fanout, depth) {
  let src = "module qa52_dag\ncapabilities { }\n\nfunc d0(x: i32) -> i32 {\nentry:\n  %one:i32 = const.i32 1\n  %r:i32 = i32.add %x, %one\n  return %r\n}\n";
  for (let level = 1; level <= depth; level += 1) {
    const calls = Array.from({ length: fanout }, (_, idx) => `  %a${idx}:i32 = @d${level - 1}(%x)`).join("\n");
    src += `\nfunc d${level}(x: i32) -> i32 {\nentry:\n${calls}\n  return %a0\n}\n`;
  }
  src += `\nexport func run(x: i32) -> i32 {\nentry:\n  %r:i32 = @d${depth}(%x)\n  return %r\n}\n`;
  return src;
}

test("P1-3 limits are the documented maintenance constants", () => {
  assert.deepStrictEqual({ ...LIMITS }, {
    maxFunctions: 4096,
    maxCallEdges: 65536,
    maxCallDepth: 256,
    maxStructuralVisits: 4194304,
    maxSummaryWork: 4194304
  });
  assert(Object.isFrozen(LIMITS));
});

test("P1-3.1 a normal shallow module is accepted with small counters", () => {
  const mod = verify(chainSource(3));
  const profile = verifier.legacyVerifierAnalysisProfile(mod);
  assert.deepStrictEqual({ functions: profile.functions, callEdges: profile.callEdges, callDepth: profile.callDepth, acyclic: profile.acyclic },
    { functions: 5, callEdges: 4, callDepth: 5, acyclic: true });
});

test("P1-3.2 a wide call DAG is summarised once per function", () => {
  // 8^12 call paths; each function is summarised once.
  const mod = verify(dagSource(8, 12));
  const profile = verifier.legacyVerifierAnalysisProfile(mod);
  assert.strictEqual(profile.callEdges, 8 * 12 + 1);
  assert.strictEqual(profile.callDepth, 14);
  assert(profile.summaryWork < 5000, `summary work ${profile.summaryWork}`);
  // Counts are unchanged: run (2) plus d12, where d0 = 3 and
  // d_k = (fanout calls + return) + fanout * d_{k-1}.
  let expected = 3;
  for (let level = 1; level <= 12; level += 1) expected = 8 + 1 + 8 * expected;
  assert.strictEqual(verifier.collectEffectUsage(mod).get("cpu.instructions"), 2 + expected);
});

test("P1-3.3/4/5 deep chains: below the limit, exact boundary, boundary + 1", () => {
  const below = verify(chainSource(200));
  assert.strictEqual(verifier.legacyVerifierAnalysisProfile(below).callDepth, 202);
  const boundary = verify(chainSource(LIMITS.maxCallDepth - 2));
  assert.strictEqual(verifier.legacyVerifierAnalysisProfile(boundary).callDepth, LIMITS.maxCallDepth);
  const over = rejectsWith(() => verify(chainSource(LIMITS.maxCallDepth - 1)),
    /air\.verifier\.analysis_limit_exceeded: legacy verifier call depth 257 exceeds the maintenance limit 256/);
  assert.strictEqual(over.code, "air.verifier.analysis_limit_exceeded");
  // Deterministic: the same source fails with the same message.
  const again = rejectsWith(() => verify(chainSource(LIMITS.maxCallDepth - 1)), /analysis_limit_exceeded/);
  assert.strictEqual(again.message, over.message);
});

test("P1-3.6 depths at and beyond the former RangeError case give an AIR rejection", () => {
  for (const depth of [1500, 3000]) {
    const err = rejectsWith(() => verify(chainSource(depth)), /air\.verifier\.analysis_limit_exceeded: legacy verifier call depth 257/);
    assert.strictEqual(err.code, "air.verifier.analysis_limit_exceeded");
  }
  // Far beyond: the function-count limit is reached first, still stable.
  const wide = rejectsWith(() => verify(chainSource(20000)), /legacy verifier function count 20002 exceeds the maintenance limit 4096/);
  assert.strictEqual(wide.code, "air.verifier.analysis_limit_exceeded");
  // Every consumer of the usage walk is guarded, not only verifyModule.
  const deep = parse(chainSource(1500));
  for (const fn of [
    () => verifier.collectEffectUsage(deep),
    () => verifier.createVerifiedResourceCertificate(deep, { packageName: "deep" }),
    () => air.auditModule(deep)
  ]) {
    rejectsWith(fn, /air\.verifier\.analysis_limit_exceeded/);
  }
  // The CLI reports the stable code, no raw stack.
  const dir = tempDir("air-qa52-depth-");
  try {
    const file = path.join(dir, "deep.air");
    fs.writeFileSync(file, chainSource(1500));
    const result = spawnSync(process.execPath, [path.join(root, "bin", "airc.js"), "verify", file], { encoding: "utf8" });
    assert.notStrictEqual(result.status, 0);
    assert.match(result.stderr + result.stdout, /air\.verifier\.analysis_limit_exceeded/);
    assert(!/RangeError|Maximum call stack/.test(result.stderr + result.stdout));
    const check = createLspDiagnostics(file);
    assert.strictEqual(check.diagnostics[0].code, "air.verifier.analysis_limit_exceeded");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("P1-3.7 repeated-DAG scaling: summary work is exactly linear in independent chains", () => {
  const work = [1, 2, 4, 8].map((chains) => verifier.legacyVerifierAnalysisProfile(verify(chainSource(100, chains))).summaryWork);
  const perChain = work[1] - work[0];
  assert(perChain > 0);
  assert.deepStrictEqual(work.map((value, idx) => value - work[0] - perChain * ([1, 2, 4, 8][idx] - 1)), [0, 0, 0, 0],
    `work ${work.join(",")}`);
});

test("P1-3 function count, call edges and structural visits have stable boundaries", () => {
  const functions = (count) => {
    let src = "module qa52_many\ncapabilities { }\n";
    for (let idx = 0; idx < count - 1; idx += 1) src += `\nfunc f${idx}(x: i32) -> i32 {\nentry:\n  return %x\n}\n`;
    return `${src}\nexport func run(x: i32) -> i32 {\nentry:\n  return %x\n}\n`;
  };
  assert.strictEqual(verifier.legacyVerifierAnalysisProfile(verify(functions(LIMITS.maxFunctions))).functions, LIMITS.maxFunctions);
  rejectsWith(() => verify(functions(LIMITS.maxFunctions + 1)), /legacy verifier function count 4097 exceeds the maintenance limit 4096/);
  // Structural visits include the per-function constant scope.
  const constants = Array.from({ length: 1100 }, (_, idx) => `const K${idx}:i32 = ${idx}`).join("\n");
  rejectsWith(() => verify(functions(4000).replace("capabilities { }", `${constants}\ncapabilities { }`)),
    /legacy verifier structural visits 4400000 exceeds the maintenance limit 4194304/);
  // Call edges: one function with 65537 local calls.
  const calls = Array.from({ length: LIMITS.maxCallEdges + 1 }, (_, idx) => `  %c${idx}:i32 = @leaf(%x)`).join("\n");
  rejectsWith(() => verify(`module qa52_edges\ncapabilities { }\n\nfunc leaf(x: i32) -> i32 {\nentry:\n  return %x\n}\n\nexport func run(x: i32) -> i32 {\nentry:\n${calls}\n  return %x\n}\n`),
    /legacy verifier (call edge count 65537 exceeds the maintenance limit 65536|structural visits)/);
});

test("P1-3.8 summary work above the limit is rejected with the stable code", () => {
  // Layered DAG inside every shape limit (64 layers of 16, each node calling
  // the whole previous layer): callee summaries grow with the reachable set,
  // so the merge work is far above the summary-work limit.
  const width = 16;
  const layers = 64;
  let src = "module qa52_layers\ncapabilities { }\n";
  for (let idx = 0; idx < width; idx += 1) src += `\nfunc n0_${idx}(x: i32) -> i32 {\nentry:\n  return %x\n}\n`;
  for (let layer = 1; layer < layers; layer += 1) {
    for (let idx = 0; idx < width; idx += 1) {
      const calls = Array.from({ length: width }, (_, k) => `  %a${k}:i32 = @n${layer - 1}_${k}(%x)`).join("\n");
      src += `\nfunc n${layer}_${idx}(x: i32) -> i32 {\nentry:\n${calls}\n  return %x\n}\n`;
    }
  }
  src += `\nexport func run(x: i32) -> i32 {\nentry:\n  %r:i32 = @n${layers - 1}_0(%x)\n  return %r\n}\n`;
  const mod = parse(src);
  const err = rejectsWith(() => verifier.verifyModule(mod), /air\.verifier\.analysis_limit_exceeded: legacy verifier summary work [0-9]+ exceeds the maintenance limit 4194304/);
  assert.strictEqual(err.code, "air.verifier.analysis_limit_exceeded");
  // Same source, same verdict and message.
  const again = rejectsWith(() => verifier.verifyModule(parse(src)), /summary work/);
  assert.strictEqual(again.message, err.message);
});

test("P1-3 cyclic modules keep the former recursion diagnostic", () => {
  rejectsWith(() => verify(`module qa52_cycle
capabilities { }

func a(x: i32) -> i32 {
entry:
  %r:i32 = @b(%x)
  return %r
}

func b(x: i32) -> i32 {
entry:
  %r:i32 = @a(%x)
  return %r
}

export func run(x: i32) -> i32 {
entry:
  %r:i32 = @a(%x)
  return %r
}`), /air\.call\.recursion_rejected: local function call cycle @a -> @b -> @a/);
});

// ---------------------------------------------------------------------------
// P2 corrections
// ---------------------------------------------------------------------------

test("P2-2 unresolved std.* calls fail closed with stdlib_call_composition_unproven", () => {
  const source = `module qa52_std
use std.grid
capabilities { }

export func run(x: i32) -> i32 {
entry:
  %size:i32 = 8
  %r:i32 = @grid.cell_trunc_i32(%x, %size)
  return %r
}
`;
  const unresolved = parse(source);
  const certificate = verifier.createVerifiedResourceCertificate([{ path: "main.air", mod: unresolved }], { packageName: "std", mode: "required" });
  assert.strictEqual(certificate.status, "incomplete");
  const reasons = certificate.classifications.unknown.map((item) => item.code);
  assert(reasons.includes("stdlib_call_composition_unproven"));
  assert(!reasons.includes("package_call_composition_unproven"));
  assert.strictEqual(certificate.modules[0].facts.stdlibExternalCalls, 1);
  assert.strictEqual(certificate.modules[0].facts.packageExternalCalls, 0);
  // With imports resolved the std functions are local and fully counted.
  const resolved = parseAir(source, path.join(root, "qa52_std.air"));
  verifier.verifyModule(resolved);
  assert.strictEqual(verifier.collectEffectUsage(resolved).get("call.stdlib_external"), undefined);
});

test("P2-5 a marker-stripped typed AST never receives a legacy certificate", () => {
  const source = fs.readFileSync(path.join(root, "fixtures", "v052", "public_reality", "limit.air"), "utf8");
  const typed = (text) => air.parseSource(text, "limit.air", { sourceProfile: "typed-v0.51" });
  const digests = [];
  for (const text of [source, source.replace(/50/, "51")]) {
    const stripped = typed(text);
    delete stripped.v051TypedAst;
    rejectsWith(() => verifier.createVerifiedResourceCertificate(stripped, { packageName: "typed" }),
      /air\.resource_certificate\.profile_unsupported: module 0 is not a legacy block-IR module/);
    const bare = typed(text);
    delete bare.v051TypedAst;
    delete bare.v051TypedDecisionCandidate;
    delete bare.enums;
    const err = rejectsWith(() => verifier.createVerifiedResourceCertificate(bare, { packageName: "typed" }), /has a statement body/);
    digests.push(err.code);
  }
  assert.deepStrictEqual(digests, ["air.resource_certificate.profile_unsupported", "air.resource_certificate.profile_unsupported"]);
});

test("P2-7 airc check keeps the stable air.cli.file_* code", () => {
  const dir = tempDir("air-qa52-cli-");
  try {
    const big = path.join(dir, "big.air");
    fs.writeFileSync(big, Buffer.alloc(4 * 1024 * 1024 + 1, 0x20));
    const cases = [
      [path.join(dir, "missing.air"), "air.cli.file_missing"],
      [dir, null],
      [big, "air.cli.file_too_large"]
    ];
    if (process.platform !== "win32") {
      const fifo = path.join(dir, "fifo.air");
      spawnSync("mkfifo", [fifo]);
      if (fs.existsSync(fifo)) cases.push([fifo, "air.cli.file_invalid"]);
    }
    for (const [file, code] of cases) {
      if (!code) continue;
      const report = createLspDiagnostics(file);
      assert.strictEqual(report.diagnostics[0].code, code, file);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("P2-8 the observation-safety analysis is memoised and bounded", () => {
  // f=4, d=16: 4^16 call paths; the former walk visited every path.
  let src = "module qa52_obs\ncapabilities { debug }\nextern debug.metric(id: i32, value: i32) -> void\n\nfunc o0(x: i32) -> i32 {\nentry:\n  @debug.metric(%x, %x)\n  return %x\n}\n";
  for (let level = 1; level <= 16; level += 1) {
    const calls = Array.from({ length: 4 }, (_, idx) => `  %a${idx}:i32 = @o${level - 1}(%x)`).join("\n");
    src += `\nfunc o${level}(x: i32) -> i32 {\nentry:\n${calls}\n  return %a0\n}\n`;
  }
  const safety = analyzeObservationOnlyFunctions(parse(src), { label: "helper" });
  const issues = safety.diagnostics.get("o16");
  assert.deepStrictEqual(issues, [{
    reason: "host_call",
    message: `helper o16 calls o15: ${Array.from({ length: 15 }, (_, idx) => `helper o${15 - idx} calls o${14 - idx}: `).join("")}helper o0 calls host import debug.metric`
  }]);
  // A dense DAG with an origin issue per function exceeds the bound and fails closed.
  let dense = "module qa52_dense_obs\ncapabilities { debug }\nextern debug.metric(id: i32, value: i32) -> void\n";
  for (let idx = 0; idx < 1200; idx += 1) {
    const calls = Array.from({ length: Math.min(idx, 8) }, (_, k) => `  %a${k}:i32 = @p${idx - 1 - k}(%x)`).join("\n");
    dense += `\nfunc p${idx}(x: i32) -> i32 {\nentry:\n  @debug.metric(%x, %x)\n${calls}\n  return %x\n}\n`;
  }
  const bounded = analyzeObservationOnlyFunctions(parse(dense), { label: "helper" });
  const last = bounded.diagnostics.get("p1199");
  assert.deepStrictEqual(last.map((item) => item.reason), ["analysis_limit_exceeded"]);
});

test("P2-10 a region view passed across a local call after free is rejected", () => {
  const source = (order) => `module qa52_view
capabilities { }

func use(s: slice) -> i32 {
entry:
  %n:i32 = slice.len %s
  return %n
}

export func run() -> i32 {
entry:
  %bytes:i32 = 16
  %ptr:ptr = alloc_region %bytes
  %s:slice = slice.from_region %ptr, %bytes
${order}
  return %n
}
`;
  rejectsWith(() => verify(source("  free_region %ptr\n  %n:i32 = @use(%s)")), /pointer %ptr is not a live region/);
  verify(source("  %n:i32 = @use(%s)\n  free_region %ptr"));
  const buffer = (order) => `module qa52_buffer
capabilities { }

func first(b: buffer<f32,4>) -> f32 {
entry:
  %zero:i32 = 0
  %one:f32 = 1.0
  buffer.store %b, %zero, %one
  return %one
}

export func run() -> f32 {
entry:
  %bytes:i32 = 16
  %ptr:ptr = alloc_region %bytes
  %b:buffer<f32,4> = buffer.from_ptr %ptr
${order}
  return %v
}
`;
  rejectsWith(() => verify(buffer("  free_region %ptr\n  %v:f32 = @first(%b)")), /pointer %ptr is not a live region/);
});

// ---------------------------------------------------------------------------

(async () => {
  let failed = 0;
  for (const item of results) {
    try {
      await item.fn();
      console.log(`ok - ${item.name}`);
    } catch (err) {
      failed += 1;
      console.log(`not ok - ${item.name}`);
      console.log(String(err && err.stack || err).split("\n").slice(0, 8).map((line) => `  ${line}`).join("\n"));
    }
  }
  console.log(`v0.52.1 QA52 correction vectors: ${results.length - failed}/${results.length} passed`);
  if (failed) process.exitCode = 1;
})();
