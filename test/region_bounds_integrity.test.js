#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { parseAir } = require("../src/parser");
const { verifyModule } = require("../src/verifier");
const { diagnosticHintsFromMessage, normalizeDiagnostic } = require("../src/diagnostics");
const { lowerToWat, watToWasm } = require("../src/lower_wasm");

const root = path.resolve(__dirname, "..");
const fixtureRoot = path.join(root, "fixtures", "v050", "region_bounds");
const staticCode = "air.memory.region_bounds_static";
const runtimeCode = "air.memory.region_bounds_runtime";

function loadFixture(name) {
  const file = path.join(fixtureRoot, name);
  return parseAir(fs.readFileSync(file, "utf8"), path.relative(root, file), {
    resolveSourceImports: false
  });
}

function expectStaticReject(name, pattern = /out of region bounds/) {
  const errors = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      verifyModule(loadFixture(name));
    } catch (caught) {
      errors.push(caught);
    }
  }
  assert.strictEqual(errors.length, 2, `expected ${name} to reject deterministically`);
  const [error, repeatedError] = errors;
  assert.strictEqual(repeatedError.message, error.message, `${name} diagnostic must be byte-identical`);
  assert(error, `expected ${name} to reject`);
  assert.match(error.message, pattern);
  const diagnostic = normalizeDiagnostic(diagnosticHintsFromMessage(error.message));
  assert.strictEqual(diagnostic.code, staticCode);
  assert.strictEqual(diagnostic.severity, "fail");
}

async function instantiate(name) {
  const mod = loadFixture(name);
  verifyModule(mod);
  const firstWat = lowerToWat(mod);
  const secondWat = lowerToWat(mod);
  assert.strictEqual(secondWat, firstWat, `${name} WAT must be deterministic`);
  const wasm = await watToWasm(firstWat, name);
  const result = await WebAssembly.instantiate(wasm, {});
  return { mod, wat: firstWat, wasm, instance: result.instance };
}

function assertTrap(fn, ...args) {
  assert.throws(() => fn(...args), WebAssembly.RuntimeError);
}

(async () => {
  expectStaticReject("static_negative_offset.air");
  expectStaticReject("static_one_byte_beyond.air");
  expectStaticReject("static_overflow_offset.air");
  expectStaticReject("static_zero_length.air");

  assert.throws(
    () => verifyModule(loadFixture("use_after_free_load.air")),
    /pointer %ptr is not a live region/
  );
  assert.throws(
    () => verifyModule(loadFixture("use_after_free_store.air")),
    /pointer %ptr is not a live region/
  );

  const finalElement = await instantiate("static_valid_final_element.air");
  assert.strictEqual(finalElement.instance.exports.run(), 42);
  assert.doesNotMatch(finalElement.wat, new RegExp(runtimeCode.replace(/\./g, "\\.")));

  const dynamicI32 = await instantiate("dynamic_i32.air");
  const writeI32 = dynamicI32.instance.exports.write_at;
  assert.strictEqual(writeI32(0), 99);
  assert.strictEqual(writeI32(12), 99);
  assertTrap(writeI32, -1);
  assertTrap(writeI32, 13);
  assertTrap(writeI32, 16);
  assertTrap(writeI32, 4096);
  assertTrap(writeI32, 2147483647);
  assert.match(dynamicI32.wat, new RegExp(`func \\$__air_region_bounds_fail`));
  assert.match(dynamicI32.wat, new RegExp(runtimeCode.replace(/\./g, "\\.")));

  const dynamicLoop = await instantiate("dynamic_loop.air");
  assert.strictEqual(dynamicLoop.instance.exports.write_frames(4), 4);
  assertTrap(dynamicLoop.instance.exports.write_frames, 5);

  const dynamicF32 = await instantiate("dynamic_f32.air");
  assert.strictEqual(dynamicF32.instance.exports.write_at(12), 1.25);
  assertTrap(dynamicF32.instance.exports.write_at, 13);

  const dynamicMat4 = await instantiate("dynamic_mat4.air");
  assert.strictEqual(dynamicMat4.instance.exports.write_at(0), 1);
  assertTrap(dynamicMat4.instance.exports.write_at, 1);

  const dynamicSize = await instantiate("dynamic_size.air");
  assert.strictEqual(dynamicSize.instance.exports.write_sized(4, 0), 7);
  assertTrap(dynamicSize.instance.exports.write_sized, 0, 0);
  assertTrap(dynamicSize.instance.exports.write_sized, -1, 0);
  assertTrap(dynamicSize.instance.exports.write_sized, 4, 1);

  const dynamicCheckCalls = (dynamicI32.wat.match(/call \$__air_region_bounds_fail/g) || []).length;
  assert.strictEqual(dynamicCheckCalls, 8, "two dynamic raw accesses require four overflow-safe predicates each");

  console.log(JSON.stringify({
    status: "pass",
    dynamicAccessSites: 2,
    dynamicFailurePredicates: dynamicCheckCalls,
    dynamicI32WasmBytes: dynamicI32.wasm.length
  }));
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
