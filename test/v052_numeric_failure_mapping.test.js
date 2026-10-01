#!/usr/bin/env node
"use strict";

const assert = require("node:assert");
const { checkedNumericFailureReason } = require("../src/v052_numeric_diagnostic");

// Real native Wasm probe of the diagnostic bridge, independent of WABT.
// It sets the already-defined flag and traps; this is NOT a compiler oracle.
function trapInstance(code, exportMarker = true) {
  const marker = Buffer.from(exportMarker ? "__air_v051_checked_numeric_failure" : "other_flag");
  const exports = [2, 4, ...Buffer.from("trap"), 0, 0, marker.length, ...marker, 3, 0];
  const body = [0, 0x41, code, 0x24, 0, 0, 0x0b];
  const bytes = Uint8Array.from([
    0, 97, 115, 109, 1, 0, 0, 0,
    1, 4, 1, 0x60, 0, 0,
    3, 2, 1, 0,
    6, 6, 1, 0x7f, 1, 0x41, 0, 0x0b,
    7, exports.length, ...exports,
    10, body.length + 2, 1, body.length, ...body
  ]);
  return new WebAssembly.Instance(new WebAssembly.Module(bytes), {});
}
for (const [flag, expected] of [[1, "overflow"], [2, "division_by_zero"], [3, "invalid_conversion"], [0, null], [4, null]]) {
  const instance = trapInstance(flag);
  let trapped;
  try { instance.exports.trap(); } catch (error) { trapped = error; }
  assert(trapped instanceof WebAssembly.RuntimeError);
  assert.strictEqual(checkedNumericFailureReason(trapped, instance), expected);
  assert.strictEqual(checkedNumericFailureReason(new Error("not a Wasm trap"), instance), null);
}
const absent = trapInstance(1, false);
assert.throws(() => absent.exports.trap(), (error) => {
  assert.strictEqual(checkedNumericFailureReason(error, absent), null);
  return error instanceof WebAssembly.RuntimeError;
});
assert.strictEqual(checkedNumericFailureReason(new WebAssembly.RuntimeError("probe"), { exports: {
  __air_v051_checked_numeric_failure: { value: 1 }
} }), null, "a look-alike object is not a Wasm global");
assert.strictEqual(checkedNumericFailureReason(new WebAssembly.RuntimeError("probe"), { exports: {
  __air_v051_checked_numeric_failure: new WebAssembly.Global({value: "i64"}, 1n)
} }), null, "a flag in an unexpected numeric representation is not a known reason");
console.log("v0.52 numeric diagnostic bridge: real Wasm flags 0/1/2/3/4, unknown marker and non-Wasm errors passed");
