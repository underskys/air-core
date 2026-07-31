#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const air = require("../src");
const { parseAir } = require("../src/parser");
const { borrowedSliceInterfaceDescriptor } = require("../src/borrowed_slices");
const { lowerToWat, watToWasm } = require("../src/lower_wasm");
const { verifyModule } = require("../src/verifier");

const root = path.resolve(__dirname, "..");
const PACKAGE_DIGEST = `sha256:${"c".repeat(64)}`;

async function compile(source, file = "<borrowed-memory-binding>") {
  const mod = parseAir(source.trim(), file, { resolveSourceImports: false });
  verifyModule(mod, { library: true });
  const wasm = await watToWasm(lowerToWat(mod), file);
  return {
    descriptor: borrowedSliceInterfaceDescriptor(mod),
    instance: await air.instantiateAirModule({
      wasmBytes: wasm,
      packageDigest: PACKAGE_DIGEST
    }),
    wasm
  };
}

function fixedDescriptor(buffer, access, transferMode, options = {}) {
  return {
    buffer,
    access,
    maxLength: options.maxLength === undefined ? 8 : options.maxLength,
    alignment: options.alignment === undefined ? 4 : options.alignment,
    aliasGroup: options.aliasGroup === undefined ? null : options.aliasGroup,
    memoryDomain: options.memoryDomain || "wasm-linear",
    transferMode,
    ...(options.actualLength === undefined ? {} : { actualLength: options.actualLength })
  };
}

function writeI32(view, byteOffset, value) {
  new DataView(view.buffer, view.byteOffset, view.byteLength).setInt32(byteOffset, value, true);
}

function readI32(view, byteOffset) {
  return new DataView(view.buffer, view.byteOffset, view.byteLength).getInt32(byteOffset, true);
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => error && error.code === code);
}

function expectDiagnostic(result, code) {
  assert.strictEqual(result.result, null);
  assert.deepStrictEqual(result.diagnostics.map((item) => item.code), [code]);
  assert.strictEqual(result.evidence.status, "failed");
  assert.strictEqual(result.evidence.failureReason, code);
  assert(!JSON.stringify(result).includes("RuntimeError"));
  assert(!JSON.stringify(result).includes("\n    at "));
}

function invoke(options) {
  return air.invokeBorrowedMemory({
    packageDigest: PACKAGE_DIGEST,
    ...options
  });
}

function prepare(options) {
  return air.prepareBorrowedMemoryInvocation({
    packageDigest: PACKAGE_DIGEST,
    ...options
  });
}

async function copyModule() {
  const sourcePath = path.join(root, "examples", "borrowed_slices", "wasm", "copy_final_i32.air");
  return compile(fs.readFileSync(sourcePath, "utf8"), sourcePath);
}

async function invokeCopied() {
  const compiled = await copyModule();
  const src = new Uint8Array(8);
  const dst = new Uint8Array(8);
  dst.fill(0x7f);
  writeI32(src, 4, 0x12345678);
  const result = invoke({
    instance: compiled.instance,
    interfaceDescriptor: compiled.descriptor,
    entrypoint: "copy_final",
    bindings: {
      src: fixedDescriptor(src, "readonly", "copied_into_wasm", { aliasGroup: "input" }),
      dst: fixedDescriptor(dst, "writeonly", "copied_into_wasm", { aliasGroup: "output" })
    },
    arguments: { count: 2 },
    resourceCertificate: {
      certificateDigest: `sha256:${"a".repeat(64)}`,
      package: {
        digest: PACKAGE_DIGEST
      }
    }
  });
  return { dst, result, src };
}

(async () => {
  assert.strictEqual(typeof air.invokeBorrowedMemory, "function");
  assert.strictEqual(typeof air.prepareBorrowedMemoryInvocation, "function");
  assert.strictEqual(typeof air.createBorrowedMemoryEvidenceReport, "function");

  const copied = await invokeCopied();
  assert.strictEqual(copied.result.result, 2);
  assert.strictEqual(readI32(copied.dst, 4), 0x12345678);
  assert.deepStrictEqual(Array.from(copied.dst.slice(0, 4)), [0, 0, 0, 0]);
  assert.strictEqual(copied.result.evidence.kind, "air.borrowedMemoryInvocationEvidence");
  assert.strictEqual(copied.result.evidence.schemaVersion, "0.50");
  assert.strictEqual(copied.result.evidence.memoryDomain, "wasm-linear");
  assert.match(copied.result.evidence.moduleDigest, /^sha256:[0-9a-f]{64}$/);
  assert.strictEqual(copied.result.evidence.packageDigest, PACKAGE_DIGEST);
  assert.strictEqual(copied.result.evidence.airAbi, "0.11");
  assert.strictEqual(copied.result.evidence.feature, "borrowed-slice-v1");
  assert.deepStrictEqual(copied.result.evidence.transferModes, ["copied_into_wasm"]);
  assert.deepStrictEqual(copied.result.evidence.totals, {
    actualBytes: 16,
    bytesCopiedIn: 8,
    bytesCopiedOut: 8
  });
  assert.strictEqual(copied.result.evidence.parameters[0].bytesCopiedOut, 0);
  assert.strictEqual(copied.result.evidence.parameters[1].bytesCopiedIn, 0);
  assert.match(copied.result.evidence.bindingDigest, /^sha256:[0-9a-f]{64}$/);
  assert.match(copied.result.evidence.evidenceDigest, /^sha256:[0-9a-f]{64}$/);
  assert.strictEqual(
    copied.result.evidence.resourceCertificateDigest,
    `sha256:${"a".repeat(64)}`
  );

  const repeated = await invokeCopied();
  assert.deepStrictEqual(repeated.result, copied.result, "borrowed invocation evidence must be deterministic");

  const report = air.createBorrowedMemoryEvidenceReport(copied.result.evidence);
  assert.match(report, /AIR Borrowed Memory Invocation/);
  assert.match(report, /copied_into_wasm/);
  assert.match(report, /not a universal native-memory zero-copy claim/);

  const viewed = await copyModule();
  const memoryBuffer = viewed.instance.exports.memory.buffer;
  const viewSrc = new Uint8Array(memoryBuffer, 0, 8);
  const viewDst = new Uint8Array(memoryBuffer, 16, 8);
  writeI32(viewSrc, 4, 73);
  const viewResult = invoke({
    instance: viewed.instance,
    interfaceDescriptor: viewed.descriptor,
    entrypoint: "copy_final",
    bindings: {
      src: fixedDescriptor(viewSrc, "readonly", "wasm_memory_view"),
      dst: fixedDescriptor(viewDst, "writeonly", "wasm_memory_view")
    },
    arguments: { count: 2 }
  });
  assert.strictEqual(viewResult.result, 2);
  assert.strictEqual(readI32(viewDst, 4), 73);
  assert.deepStrictEqual(viewResult.evidence.transferModes, ["wasm_memory_view"]);
  assert.deepStrictEqual(viewResult.evidence.totals, {
    actualBytes: 16,
    bytesCopiedIn: 0,
    bytesCopiedOut: 0
  });

  const floatCompiled = await compile(`
module borrowed_float_copy
capabilities { }
requires export copy
export func copy(src: borrowed_slice<readonly,len=4..4,align=4>, dst: borrowed_slice<writeonly,len=4..4,align=4>) -> i32 {
entry:
  %value:f32 = slice.load.f32 %src, 0
  slice.store.f32 %dst, 0, %value
  %zero:i32 = 0
  return %zero
}
`);
  const floatSrc = new Float32Array([1.25]);
  const floatDst = new Float32Array([9]);
  invoke({
    instance: floatCompiled.instance,
    interfaceDescriptor: floatCompiled.descriptor,
    entrypoint: "copy",
    bindings: {
      src: fixedDescriptor(floatSrc, "readonly", "copied_into_wasm", { maxLength: 4 }),
      dst: fixedDescriptor(floatDst, "writeonly", "copied_into_wasm", { maxLength: 4 })
    }
  });
  assert.strictEqual(floatDst[0], 1.25);

  const readwriteCompiled = await compile(`
module borrowed_readwrite
capabilities { }
requires export replace
export func replace(data: borrowed_slice<readwrite,len=4..4,align=4>, value: i32) -> i32 {
entry:
  slice.store.i32 %data, 0, %value
  %out:i32 = slice.load.i32 %data, 0
  return %out
}
`);
  const readwrite = new Uint8Array(4);
  writeI32(readwrite, 0, 4);
  const readwriteResult = invoke({
    instance: readwriteCompiled.instance,
    interfaceDescriptor: readwriteCompiled.descriptor,
    entrypoint: "replace",
    bindings: {
      data: fixedDescriptor(readwrite, "readwrite", "copied_into_wasm", { maxLength: 4 })
    },
    arguments: { value: 19 }
  });
  assert.strictEqual(readwriteResult.result, 19);
  assert.strictEqual(readI32(readwrite, 0), 19);
  assert.strictEqual(readwriteResult.evidence.totals.bytesCopiedIn, 4);
  assert.strictEqual(readwriteResult.evidence.totals.bytesCopiedOut, 4);

  const invalid = await copyModule();
  const goodSrc = new Uint8Array(8);
  const goodDst = new Uint8Array(8);
  const baseOptions = {
    instance: invalid.instance,
    interfaceDescriptor: invalid.descriptor,
    entrypoint: "copy_final",
    arguments: { count: 0 }
  };
  expectDiagnostic(invoke({
    ...baseOptions,
    bindings: {
      src: fixedDescriptor(new Int32Array(2), "readonly", "copied_into_wasm"),
      dst: fixedDescriptor(goodDst, "writeonly", "copied_into_wasm")
    }
  }), "air.borrow.buffer_type_invalid");
  expectDiagnostic(invoke({
    ...baseOptions,
    bindings: {
      src: fixedDescriptor(goodSrc, "readwrite", "copied_into_wasm"),
      dst: fixedDescriptor(goodDst, "writeonly", "copied_into_wasm")
    }
  }), "air.borrow.access_mismatch");
  expectDiagnostic(invoke({
    ...baseOptions,
    bindings: {
      src: fixedDescriptor(goodSrc, "readonly", "copied_into_wasm", { actualLength: 9 }),
      dst: fixedDescriptor(goodDst, "writeonly", "copied_into_wasm")
    }
  }), "air.borrow.buffer_truncated");
  expectDiagnostic(invoke({
    ...baseOptions,
    bindings: {
      src: fixedDescriptor(new Uint8Array(12), "readonly", "copied_into_wasm", { actualLength: 12 }),
      dst: fixedDescriptor(goodDst, "writeonly", "copied_into_wasm")
    }
  }), "air.borrow.length_out_of_range");
  const unknownDescriptor = fixedDescriptor(goodSrc, "readonly", "copied_into_wasm");
  unknownDescriptor.extension = true;
  expectDiagnostic(invoke({
    ...baseOptions,
    bindings: {
      src: unknownDescriptor,
      dst: fixedDescriptor(goodDst, "writeonly", "copied_into_wasm")
    }
  }), "air.borrow.descriptor_invalid");
  const unalignedBacking = new ArrayBuffer(9);
  expectDiagnostic(invoke({
    ...baseOptions,
    bindings: {
      src: fixedDescriptor(new Uint8Array(unalignedBacking, 1, 8), "readonly", "copied_into_wasm"),
      dst: fixedDescriptor(goodDst, "writeonly", "copied_into_wasm")
    }
  }), "air.borrow.alignment_mismatch");

  const aliasBacking = new ArrayBuffer(12);
  expectDiagnostic(invoke({
    ...baseOptions,
    bindings: {
      src: fixedDescriptor(new Uint8Array(aliasBacking, 0, 8), "readonly", "copied_into_wasm"),
      dst: fixedDescriptor(new Uint8Array(aliasBacking, 4, 8), "writeonly", "copied_into_wasm")
    }
  }), "air.borrow.mutable_overlap");

  const detached = new Uint8Array(8);
  structuredClone(detached, { transfer: [detached.buffer] });
  expectDiagnostic(invoke({
    ...baseOptions,
    bindings: {
      src: fixedDescriptor(detached, "readonly", "copied_into_wasm"),
      dst: fixedDescriptor(goodDst, "writeonly", "copied_into_wasm")
    }
  }), "air.borrow.buffer_detached");
  expectDiagnostic(air.invokeBorrowedMemory({
    ...baseOptions,
    bindings: {
      src: fixedDescriptor(goodSrc, "readonly", "copied_into_wasm"),
      dst: fixedDescriptor(goodDst, "writeonly", "copied_into_wasm")
    }
  }), "air.borrow.identity_digest_invalid");
  expectDiagnostic(air.invokeBorrowedMemory({
    ...baseOptions,
    moduleDigest: `sha256:${"f".repeat(64)}`,
    packageDigest: PACKAGE_DIGEST,
    bindings: {
      src: fixedDescriptor(goodSrc, "readonly", "copied_into_wasm"),
      dst: fixedDescriptor(goodDst, "writeonly", "copied_into_wasm")
    }
  }), "air.borrow.module_identity_mismatch");
  const rawInstantiation = await WebAssembly.instantiate(invalid.wasm, {});
  expectDiagnostic(invoke({
    ...baseOptions,
    instance: rawInstantiation.instance || rawInstantiation,
    bindings: {
      src: fixedDescriptor(goodSrc, "readonly", "copied_into_wasm"),
      dst: fixedDescriptor(goodDst, "writeonly", "copied_into_wasm")
    }
  }), "air.borrow.instance_identity_unavailable");
  expectDiagnostic(invoke({
    ...baseOptions,
    bindings: {
      src: fixedDescriptor(goodSrc, "readonly", "copied_into_wasm"),
      dst: fixedDescriptor(goodDst, "writeonly", "copied_into_wasm")
    },
    resourceCertificate: {
      certificateDigest: `sha256:${"d".repeat(64)}`,
      package: {
        digest: `sha256:${"e".repeat(64)}`
      }
    }
  }), "air.borrow.certificate_invalid");

  const relationDst = new Uint8Array(8);
  relationDst.fill(0x5a);
  const relationFailure = invoke({
    ...baseOptions,
    bindings: {
      src: fixedDescriptor(goodSrc, "readonly", "copied_into_wasm"),
      dst: fixedDescriptor(relationDst, "writeonly", "copied_into_wasm")
    },
    arguments: { count: 3 }
  });
  expectDiagnostic(relationFailure, "air.borrow.entry_relation_failed");
  assert.strictEqual(relationFailure.evidence.parameters.length, 2);
  assert.strictEqual(relationFailure.evidence.totals.bytesCopiedIn, 0);
  assert.strictEqual(relationFailure.evidence.totals.bytesCopiedOut, 0);
  assert.deepStrictEqual(Array.from(relationDst), new Array(8).fill(0x5a));

  const runtimeBoundsCompiled = await compile(`
module borrowed_partial_output
capabilities { }
requires export write_then_fail
export func write_then_fail(dst: borrowed_slice<writeonly,len=8..8,align=4>, offset: i32) -> i32 {
entry:
  %value:i32 = 7
  slice.store.i32 %dst, 0, %value
  slice.store.i32 %dst, %offset, %value
  return %value
}
`);
  const partialOutput = new Uint8Array(8);
  partialOutput.fill(0x6b);
  const runtimeFailure = invoke({
    instance: runtimeBoundsCompiled.instance,
    interfaceDescriptor: runtimeBoundsCompiled.descriptor,
    entrypoint: "write_then_fail",
    bindings: {
      dst: fixedDescriptor(partialOutput, "writeonly", "copied_into_wasm")
    },
    arguments: { offset: 8 }
  });
  expectDiagnostic(runtimeFailure, "air.borrow.pointer_out_of_bounds");
  assert.strictEqual(runtimeFailure.evidence.totals.bytesCopiedOut, 0);
  assert.deepStrictEqual(Array.from(partialOutput), new Array(8).fill(0x6b));

  const arithmeticCompiled = await compile(`
module borrowed_entry_arithmetic
capabilities { }
requires export check
export func check(src: borrowed_slice<readonly,len=0..8,align=4>, count: i32) -> i32 {
  requires checked bytes src >= param count * 4
entry:
  return %count
}
`);
  const arithmeticFailure = invoke({
    instance: arithmeticCompiled.instance,
    interfaceDescriptor: arithmeticCompiled.descriptor,
    entrypoint: "check",
    bindings: {
      src: fixedDescriptor(new Uint8Array(8), "readonly", "copied_into_wasm")
    },
    arguments: { count: 0x7fffffff }
  });
  expectDiagnostic(arithmeticFailure, "air.borrow.entry_arithmetic_overflow");

  const unexpectedTrapCompiled = await compile(`
module unexpected_region_trap
capabilities { }
effects { memory.alloc <= 1, memory.free <= 1, memory.load <= 0, memory.store <= 1, memory.static_alloc_bytes <= 4, memory.dynamic_allocations <= 0 }
requires export fail
export func fail(dst: borrowed_slice<writeonly,len=4..4,align=4>, offset: i32) -> i32 {
entry:
  %bytes:i32 = 4
  %ptr:ptr = alloc_region %bytes
  %value:i32 = 7
  store.i32 %ptr, %offset, %value
  free_region %ptr
  return %value
}
`);
  assert.throws(() => invoke({
    instance: unexpectedTrapCompiled.instance,
    interfaceDescriptor: unexpectedTrapCompiled.descriptor,
    entrypoint: "fail",
    bindings: {
      dst: fixedDescriptor(new Uint8Array(4), "writeonly", "copied_into_wasm", { maxLength: 4 })
    },
    arguments: { offset: 4 }
  }), (error) =>
    error instanceof WebAssembly.RuntimeError &&
    /__air_region_bounds_fail/.test(error.stack));

  const toctouCompiled = await copyModule();
  const toctouSrc = new Uint8Array(8);
  const toctouDst = new Uint8Array(8);
  writeI32(toctouSrc, 4, 41);
  const srcDescriptor = fixedDescriptor(toctouSrc, "readonly", "copied_into_wasm");
  const prepared = prepare({
    instance: toctouCompiled.instance,
    interfaceDescriptor: toctouCompiled.descriptor,
    entrypoint: "copy_final",
    bindings: {
      src: srcDescriptor,
      dst: fixedDescriptor(toctouDst, "writeonly", "copied_into_wasm")
    },
    arguments: { count: 2 }
  });
  srcDescriptor.access = "readwrite";
  srcDescriptor.buffer = new Uint8Array(8);
  const snapshotResult = prepared.invoke();
  assert.strictEqual(snapshotResult.result, 2);
  assert.strictEqual(readI32(toctouDst, 4), 41);
  assert.strictEqual(snapshotResult.evidence.parameters[0].access, "readonly");
  expectCode(() => prepared.invoke(), "air.borrow.invocation_reused");

  const detachedAfterPrepareCompiled = await copyModule();
  const detachAfter = new Uint8Array(8);
  const detachedPrepared = prepare({
    instance: detachedAfterPrepareCompiled.instance,
    interfaceDescriptor: detachedAfterPrepareCompiled.descriptor,
    entrypoint: "copy_final",
    bindings: {
      src: fixedDescriptor(detachAfter, "readonly", "copied_into_wasm"),
      dst: fixedDescriptor(new Uint8Array(8), "writeonly", "copied_into_wasm")
    },
    arguments: { count: 0 }
  });
  structuredClone(detachAfter, { transfer: [detachAfter.buffer] });
  expectCode(() => detachedPrepared.invoke(), "air.borrow.buffer_detached");

  const mixed = await copyModule();
  expectDiagnostic(invoke({
    instance: mixed.instance,
    interfaceDescriptor: mixed.descriptor,
    entrypoint: "copy_final",
    bindings: {
      src: fixedDescriptor(new Uint8Array(8), "readonly", "copied_into_wasm"),
      dst: fixedDescriptor(new Uint8Array(mixed.instance.exports.memory.buffer, 16, 8), "writeonly", "wasm_memory_view")
    },
    arguments: { count: 0 }
  }), "air.borrow.transfer_mode_mixed_unavailable");

  console.log("borrowed memory binding tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
