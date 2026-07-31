#!/usr/bin/env node
"use strict";

const assert = require("assert");
const air = require("../src");
const { parseAir } = require("../src/parser");
const {
  BORROWED_SLICE_LENGTH_MAX,
  WASM32_MAX_ADDRESS,
  borrowedOverlapAllowed,
  borrowedRangesOverlap,
  borrowedSliceInterfaceDescriptor,
  classifyBorrowedRange
} = require("../src/borrowed_slices");
const { lowerToWat, watToWasm } = require("../src/lower_wasm");
const { verifyModule } = require("../src/verifier");

const PACKAGE_DIGEST = `sha256:${"7".repeat(64)}`;

function parse(source) {
  return parseAir(source.trim(), "<borrowed-adversarial>", {
    resolveSourceImports: false
  });
}

function verify(source) {
  const mod = typeof source === "string" ? parse(source) : source;
  verifyModule(mod, { library: true });
  return mod;
}

function expectReject(source, code) {
  assert.throws(
    () => verify(source),
    (error) => error && error.message.includes(code),
    `expected ${code}`
  );
}

async function compile(source) {
  const mod = verify(source);
  const wasmBytes = await watToWasm(lowerToWat(mod), "<borrowed-adversarial>");
  const instance = await air.instantiateAirModule({
    wasmBytes,
    packageDigest: PACKAGE_DIGEST
  });
  return {
    descriptor: borrowedSliceInterfaceDescriptor(mod),
    instance
  };
}

function descriptor(buffer, access, options = {}) {
  return {
    buffer,
    access,
    actualLength: options.actualLength === undefined ? buffer.byteLength : options.actualLength,
    maxLength: options.maxLength === undefined ? buffer.byteLength : options.maxLength,
    alignment: options.alignment === undefined ? 4 : options.alignment,
    aliasGroup: options.aliasGroup === undefined ? null : options.aliasGroup,
    memoryDomain: options.memoryDomain || "wasm-linear",
    transferMode: options.transferMode || "copied_into_wasm"
  };
}

function invoke(compiled, entrypoint, bindings, args = {}) {
  return air.invokeBorrowedMemory({
    instance: compiled.instance,
    interfaceDescriptor: compiled.descriptor,
    packageDigest: PACKAGE_DIGEST,
    entrypoint,
    bindings,
    arguments: args
  });
}

function prepare(compiled, entrypoint, bindings, args = {}) {
  return air.prepareBorrowedMemoryInvocation({
    instance: compiled.instance,
    interfaceDescriptor: compiled.descriptor,
    packageDigest: PACKAGE_DIGEST,
    entrypoint,
    bindings,
    arguments: args
  });
}

function expectDiagnostic(result, code) {
  assert.strictEqual(result.result, null);
  assert.deepStrictEqual(result.diagnostics.map((item) => item.code), [code]);
  assert.strictEqual(result.evidence.failureReason, code);
  const output = JSON.stringify(result);
  assert(!output.includes("RuntimeError"));
  assert(!output.includes("\n    at "));
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => error && error.code === code);
}

function readI32(view, offset) {
  return new DataView(view.buffer, view.byteOffset, view.byteLength).getInt32(offset, true);
}

function runRangeProperties(iterations = 20000) {
  const accessModes = ["readonly", "writeonly", "readwrite"];
  const alignments = [1, 2, 4, 8, 16, 0, 3];
  const edges = [
    -1,
    0,
    1,
    2,
    3,
    4,
    BORROWED_SLICE_LENGTH_MAX,
    WASM32_MAX_ADDRESS,
    WASM32_MAX_ADDRESS + 1
  ];
  let state = 0x50b0770;

  function randomU32() {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  }

  function value(index) {
    return index % 5 === 0 ? edges[randomU32() % edges.length] : randomU32();
  }

  for (let index = 0; index < iterations; index += 1) {
    const base = value(index);
    const length = value(index + 1);
    const limit = value(index + 2);
    const alignment = alignments[randomU32() % alignments.length];
    const accessWidth = [0, 1, 2, 4, 8, 16, WASM32_MAX_ADDRESS][randomU32() % 7];
    assert.deepStrictEqual(
      classifyBorrowedRange(base, length, { accessWidth, alignment, limit }),
      rangeOracle(base, length, limit, alignment, accessWidth)
    );

    const leftBase = randomU32();
    const rightBase = randomU32();
    const leftLength = randomU32() % 65537;
    const rightLength = randomU32() % 65537;
    const overlap = borrowedRangesOverlap(leftBase, leftLength, rightBase, rightLength);
    const oracleOverlap =
      leftLength !== 0 &&
      rightLength !== 0 &&
      BigInt(leftBase) < BigInt(rightBase) + BigInt(rightLength) &&
      BigInt(rightBase) < BigInt(leftBase) + BigInt(leftLength);
    assert.strictEqual(overlap, oracleOverlap);

    const leftAccess = accessModes[randomU32() % accessModes.length];
    const rightAccess = accessModes[randomU32() % accessModes.length];
    assert.strictEqual(
      borrowedOverlapAllowed(leftAccess, rightAccess, overlap),
      !overlap || (leftAccess === "readonly" && rightAccess === "readonly")
    );
  }

  return iterations * 3;
}

function rangeOracle(base, length, limit, alignment, accessWidth) {
  if (!Number.isSafeInteger(length) || length < 0 || length > BORROWED_SLICE_LENGTH_MAX) {
    return { ok: false, code: "air.borrow.length_out_of_range" };
  }
  if (!Number.isSafeInteger(base) || base < 0 || base > WASM32_MAX_ADDRESS) {
    return { ok: false, code: "air.borrow.pointer_out_of_bounds" };
  }
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > WASM32_MAX_ADDRESS + 1) {
    return { ok: false, code: "air.borrow.pointer_out_of_bounds" };
  }
  if (!Number.isSafeInteger(alignment) || alignment <= 0 || base % alignment !== 0) {
    return { ok: false, code: "air.borrow.alignment_mismatch" };
  }
  if (!Number.isSafeInteger(accessWidth) ||
      accessWidth < 0 ||
      accessWidth > BORROWED_SLICE_LENGTH_MAX ||
      base > limit ||
      length > limit - base ||
      accessWidth > length ||
      accessWidth > limit - base) {
    return { ok: false, code: "air.borrow.pointer_out_of_bounds" };
  }
  return { ok: true, end: base + length };
}

(async () => {
  expectReject(`
module return_escape
capabilities { }
func leak(src: borrowed_slice<readonly,len<=4,align=4>) -> borrowed_slice<readonly,len<=4,align=4> {
entry:
  return %src
}
`, "air.borrow.escape_return");

  expectReject(`
module global_escape
capabilities { }
global retained:borrowed_slice<readonly,len<=4,align=4> = const.str "x"
func run() -> i32 {
entry:
  %zero:i32 = 0
  return %zero
}
`, "air.borrow.escape_storage");

  const stateEscape = parse(`
module state_escape
state retained:i32[1] = fill 0
capabilities { }
func run() -> i32 {
entry:
  %zero:i32 = 0
  return %zero
}
`);
  stateEscape.states[0].type = "borrowed_slice<readwrite,len<=4,align=4>";
  expectReject(stateEscape, "air.borrow.escape_storage");

  const poolEscape = parse(`
module pool_escape
pool retained capacity 1 {
  active:bool = false
  value:i32 = 0
}
capabilities { }
func run() -> i32 {
entry:
  %zero:i32 = 0
  return %zero
}
`);
  poolEscape.pools[0].fields[1].type = "borrowed_slice<readwrite,len<=4,align=4>";
  expectReject(poolEscape, "air.borrow.escape_storage");

  const tableEscape = parse(`
module table_escape
table retained:i32[1] = [0]
capabilities { }
func run() -> i32 {
entry:
  %zero:i32 = 0
  return %zero
}
`);
  tableEscape.tables[0].type = "borrowed_slice<readonly,len<=4,align=4>";
  expectReject(tableEscape, "air.borrow.escape_storage");

  expectReject(`
module free_borrow
capabilities { }
func run(src: borrowed_slice<readwrite,len<=4,align=4>) -> i32 {
entry:
  free_region %src
  %zero:i32 = 0
  return %zero
}
`, "air.borrow.free_forbidden");

  expectReject(`
module grow_borrow
capabilities { }
func run(src: borrowed_slice<readwrite,len<=4,align=4>) -> i32 {
entry:
  slice.grow %src, 4
  %zero:i32 = 0
  return %zero
}
`, "air.borrow.free_forbidden");

  expectReject(`
module opaque_forward
capabilities { debug }
extern debug.metric(src: borrowed_slice<readonly,len<=4,align=4>) -> i32
func run(src: borrowed_slice<readonly,len<=4,align=4>) -> i32 {
entry:
  %out:i32 = call @debug.metric(%src)
  return %out
}
`, "air.borrow.extern_opaque");

  expectReject(`
module readonly_store
capabilities { }
func run(src: borrowed_slice<readonly,len<=4,align=4>) -> i32 {
entry:
  %value:i32 = 1
  slice.store.i32 %src, 0, %value
  return %value
}
`, "air.borrow.mode_violation");

  expectReject(`
module writeonly_load
capabilities { }
func run(dst: borrowed_slice<writeonly,len<=4,align=4>) -> i32 {
entry:
  %value:i32 = slice.load.i32 %dst, 0
  return %value
}
`, "air.borrow.mode_violation");

  expectReject(`
module reinterpret
capabilities { }
func run(src: borrowed_slice<readonly,len<=8,align=4>) -> i32 {
entry:
  %part:slice = slice.sub %src, 0, 4
  %zero:i32 = 0
  return %zero
}
`, "air.borrow.reinterpret_forbidden");

  expectReject(`
module misaligned_static_f32
capabilities { }
func run(src: borrowed_slice<readonly,len<=8,align=4>) -> i32 {
entry:
  %value:f32 = slice.load.f32 %src, 2
  %zero:i32 = 0
  return %zero
}
`, "air.borrow.alignment_invalid");

  expectReject(`
module misaligned_static_i32
capabilities { }
func run(src: borrowed_slice<readonly,len<=8,align=4>) -> i32 {
entry:
  %value:i32 = slice.load.i32 %src, 2
  return %value
}
`, "air.borrow.alignment_invalid");

  const copy = await compile(`
module copy
capabilities { }
requires export copy
export func copy(src: borrowed_slice<readonly,len<=8,align=4>, dst: borrowed_slice<writeonly,len<=8,align=4>) -> i32 {
entry:
  %value:i32 = slice.load.i32 %src, 4
  slice.store.i32 %dst, 4, %value
  return %value
}
`);
  const backing = new ArrayBuffer(16);
  expectDiagnostic(invoke(copy, "copy", {
    src: descriptor(new Uint8Array(backing, 0, 8), "readonly", { aliasGroup: "left" }),
    dst: descriptor(new Uint8Array(backing, 4, 8), "writeonly", { aliasGroup: "right" })
  }), "air.borrow.mutable_overlap");
  expectDiagnostic(invoke(copy, "copy", {
    src: descriptor(new Uint8Array(backing, 0, 8), "readonly"),
    dst: descriptor(new Uint8Array(backing, 0, 8), "writeonly")
  }), "air.borrow.mutable_overlap");

  const readonlyPair = await compile(`
module readonly_pair
capabilities { }
requires export lengths
export func lengths(a: borrowed_slice<readonly,len<=8,align=4>, b: borrowed_slice<readonly,len<=8,align=4>) -> i32 {
entry:
  %length:i32 = slice.len %a
  return %length
}
`);
  const sharedReadonly = new Uint8Array(8);
  const readonlyResult = invoke(readonlyPair, "lengths", {
    a: descriptor(sharedReadonly, "readonly", { aliasGroup: "same" }),
    b: descriptor(sharedReadonly, "readonly", { aliasGroup: "different" })
  });
  assert.strictEqual(readonlyResult.result, 8);

  const invalid = new Uint8Array(8);
  expectDiagnostic(invoke(copy, "copy", {
    src: descriptor(invalid, "readonly", { actualLength: -1, maxLength: 8 }),
    dst: descriptor(new Uint8Array(8), "writeonly")
  }), "air.borrow.length_out_of_range");
  expectDiagnostic(invoke(copy, "copy", {
    src: descriptor(new Uint8Array(12), "readonly", { actualLength: 12, maxLength: 8 }),
    dst: descriptor(new Uint8Array(8), "writeonly")
  }), "air.borrow.length_out_of_range");
  expectDiagnostic(invoke(copy, "copy", {
    src: descriptor(new Uint8Array(8), "readonly", { memoryDomain: "native" }),
    dst: descriptor(new Uint8Array(8), "writeonly")
  }), "air.borrow.memory_domain_unsupported");
  expectDiagnostic(invoke(copy, "copy", {
    src: descriptor(new Uint8Array(8), "readonly", { aliasGroup: "invalid group!" }),
    dst: descriptor(new Uint8Array(8), "writeonly")
  }), "air.borrow.alias_group_invalid");

  const detached = new Uint8Array(8);
  structuredClone(detached, { transfer: [detached.buffer] });
  expectDiagnostic(invoke(copy, "copy", {
    src: descriptor(detached, "readonly", { maxLength: 8 }),
    dst: descriptor(new Uint8Array(8), "writeonly")
  }), "air.borrow.buffer_detached");

  const mutationSource = new Uint8Array(8);
  new DataView(mutationSource.buffer).setInt32(4, 31, true);
  const mutationTarget = new Uint8Array(8);
  const mutableDescriptor = descriptor(mutationSource, "readonly");
  const preparedMutation = prepare(copy, "copy", {
    src: mutableDescriptor,
    dst: descriptor(mutationTarget, "writeonly")
  });
  assert(Object.isFrozen(preparedMutation));
  assert.deepStrictEqual(Object.keys(preparedMutation), ["invoke"]);
  mutableDescriptor.access = "readwrite";
  mutableDescriptor.actualLength = 0;
  mutableDescriptor.buffer = new Uint8Array(0);
  assert.strictEqual(preparedMutation.invoke().result, 31);
  assert.strictEqual(readI32(mutationTarget, 4), 31);
  expectCode(() => preparedMutation.invoke(), "air.borrow.invocation_reused");

  const viewCopy = await compile(`
module view_copy
capabilities { }
requires export copy
export func copy(src: borrowed_slice<readonly,len=8..8,align=4>, dst: borrowed_slice<writeonly,len=8..8,align=4>) -> i32 {
entry:
  %value:i32 = slice.load.i32 %src, 4
  slice.store.i32 %dst, 4, %value
  return %value
}
`);
  const oldMemory = viewCopy.instance.exports.memory.buffer;
  const stalePrepared = prepare(viewCopy, "copy", {
    src: descriptor(new Uint8Array(oldMemory, 0, 8), "readonly", { transferMode: "wasm_memory_view" }),
    dst: descriptor(new Uint8Array(oldMemory, 16, 8), "writeonly", { transferMode: "wasm_memory_view" })
  });
  viewCopy.instance.exports.memory.grow(1);
  expectCode(() => stalePrepared.invoke(), "air.borrow.memory_changed");

  const zero = await compile(`
module zero
capabilities { }
requires export accept
export func accept(a: borrowed_slice<writeonly,len<=0,align=1>, b: borrowed_slice<readwrite,len<=0,align=1>) -> i32 {
entry:
  %length:i32 = slice.len %a
  return %length
}
`);
  const zeroResult = invoke(zero, "accept", {
    a: descriptor(new Uint8Array(0), "writeonly", { alignment: 1, maxLength: 0 }),
    b: descriptor(new Uint8Array(0), "readwrite", { alignment: 1, maxLength: 0 })
  });
  assert.strictEqual(zeroResult.result, 0);

  const finalSource = new Uint8Array(8);
  const finalTarget = new Uint8Array(8);
  new DataView(finalSource.buffer).setInt32(4, 99, true);
  assert.strictEqual(invoke(copy, "copy", {
    src: descriptor(finalSource, "readonly"),
    dst: descriptor(finalTarget, "writeonly")
  }).result, 99);
  assert.strictEqual(readI32(finalTarget, 4), 99);

  const direct = await compile(`
module direct_preflight
capabilities { }
requires export accept
export func accept(src: borrowed_slice<readonly,len<=8,align=4>) -> i32 {
entry:
  %length:i32 = slice.len %src
  return %length
}
`);
  assert.throws(() => direct.instance.exports.accept(-4, 8), WebAssembly.RuntimeError);
  assert.throws(() => direct.instance.exports.accept(0, -1), WebAssembly.RuntimeError);
  assert.throws(() => direct.instance.exports.accept(0, 9), WebAssembly.RuntimeError);

  const dynamicAccess = await compile(`
module dynamic_access
capabilities { }
requires export load
export func load(src: borrowed_slice<readonly,len=8..8,align=4>, offset: i32) -> i32 {
entry:
  %value:i32 = slice.load.i32 %src, %offset
  return %value
}
`);
  expectDiagnostic(invoke(dynamicAccess, "load", {
    src: descriptor(new Uint8Array(8), "readonly")
  }, { offset: 0x7fffffff }), "air.borrow.pointer_out_of_bounds");

  assert.deepStrictEqual(
    classifyBorrowedRange(0xfffffffc, 8, { limit: 0x100000000, alignment: 4 }),
    { ok: false, code: "air.borrow.pointer_out_of_bounds" }
  );
  assert.deepStrictEqual(
    classifyBorrowedRange(4, 4, { limit: 8, alignment: 4, accessWidth: 8 }),
    { ok: false, code: "air.borrow.pointer_out_of_bounds" }
  );

  const firstDeterministic = invoke(copy, "copy", {
    src: descriptor(finalSource, "readonly"),
    dst: descriptor(new Uint8Array(8), "writeonly")
  });
  const secondDeterministic = invoke(copy, "copy", {
    src: descriptor(finalSource, "readonly"),
    dst: descriptor(new Uint8Array(8), "writeonly")
  });
  assert.deepStrictEqual(secondDeterministic, firstDeterministic);

  const fuzzCases = runRangeProperties();

  console.log(JSON.stringify({
    status: "pass",
    hostileCases: 28,
    fuzzCases,
    mutableInPlaceSupported: false
  }));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
