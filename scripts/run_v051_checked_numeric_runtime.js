#!/usr/bin/env node
"use strict";

const assert = require("node:assert");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { formatV051Air } = require("../src/format");
const { lowerToWat, watToWasm } = require("../src/lower_wasm");
const { parseV051Air } = require("../src/parser");
const { verifyV051Air } = require("../src/verifier");

const ROOT = path.resolve(__dirname, "..");
const FIXTURE_PATH = path.join(ROOT, "fixtures", "v051", "checked_numeric", "checked_numeric.air");
const SOURCE = fs.readFileSync(FIXTURE_PATH, "utf8");
const I64_MIN = -9223372036854775808n;
const I64_MAX = 9223372036854775807n;

const FAILURE_CODES = Object.freeze({
  division_by_zero: 2,
  invalid_conversion: 3,
  overflow: 1
});

function expectTrap(instance, reason, invoke) {
  assert.throws(invoke, WebAssembly.RuntimeError);
  assert.strictEqual(instance.exports.__air_v051_checked_numeric_failure.value, FAILURE_CODES[reason]);
  return `PASS_air.numeric.checked_failure:${reason}`;
}

function expectStaticFailure(source, name, reason) {
  assert.throws(
    () => verifyV051Air(parseV051Air(source, `${name}.air`)),
    new RegExp(`air\\.numeric\\.checked_failure: ${reason}`)
  );
  return "PASS";
}

async function run() {
  const result = {};
  const parsed = parseV051Air(SOURCE, FIXTURE_PATH);
  verifyV051Air(parsed);
  const formatted = formatV051Air(parsed);
  const reparsed = parseV051Air(formatted, `${FIXTURE_PATH}.formatted`);
  verifyV051Air(reparsed);
  assert.strictEqual(formatV051Air(reparsed), formatted);
  result.FORMATTER_ROUNDTRIP = "PASS";

  const firstWat = lowerToWat(parsed);
  const secondWat = lowerToWat(parsed);
  assert.strictEqual(firstWat, secondWat);
  assert.match(firstWat, /__air_v051_numeric_overflow/);
  assert.match(firstWat, /__air_v051_numeric_division_by_zero/);
  assert.match(firstWat, /__air_v051_numeric_invalid_conversion/);
  const firstWasm = await watToWasm(firstWat, FIXTURE_PATH);
  const secondWasm = await watToWasm(secondWat, FIXTURE_PATH);
  assert.deepStrictEqual(firstWasm, secondWasm);
  result.WASM_DIGEST = `sha256:${crypto.createHash("sha256").update(firstWasm).digest("hex")}`;
  const { instance } = await WebAssembly.instantiate(firstWasm, {});

  assert.strictEqual(instance.exports.checked_add(40n, 2n), 42n);
  assert.strictEqual(instance.exports.checked_add(I64_MAX - 1n, 1n), I64_MAX);
  expectTrap(instance, "overflow", () => instance.exports.checked_add(I64_MAX, 1n));
  result.CHECKED_ADD_PASS = "PASS";

  assert.strictEqual(instance.exports.checked_sub(40n, 2n), 38n);
  assert.strictEqual(instance.exports.checked_sub(I64_MIN + 1n, 1n), I64_MIN);
  expectTrap(instance, "overflow", () => instance.exports.checked_sub(I64_MIN, 1n));
  result.CHECKED_SUB_PASS = "PASS";

  assert.strictEqual(instance.exports.checked_mul(6n, 7n), 42n);
  assert.strictEqual(instance.exports.checked_mul(I64_MAX, 1n), I64_MAX);
  expectTrap(instance, "overflow", () => instance.exports.checked_mul(I64_MAX, 2n));
  result.CHECKED_MUL_PASS = "PASS";

  assert.strictEqual(instance.exports.checked_neg(0n), 0n);
  assert.strictEqual(instance.exports.checked_neg(-42n), 42n);
  expectTrap(instance, "overflow", () => instance.exports.checked_neg(I64_MIN));
  result.CHECKED_NEG_PASS = "PASS";

  assert.strictEqual(instance.exports.checked_div(-5n, 2n), -2n);
  expectTrap(instance, "overflow", () => instance.exports.checked_div(I64_MIN, -1n));
  result.INT64_MIN_DIV_NEG1 = "PASS_TRAP_OVERFLOW";
  expectTrap(instance, "division_by_zero", () => instance.exports.checked_div(1n, 0n));
  result.CHECKED_DIV_PASS = "PASS";

  assert.strictEqual(instance.exports.checked_rem(5n, 2n), 1n);
  assert.strictEqual(instance.exports.checked_rem(-5n, 2n), -1n);
  assert.strictEqual(instance.exports.checked_rem(5n, -2n), 1n);
  assert.strictEqual(instance.exports.checked_rem(I64_MIN, -1n), 0n);
  result.INT64_MIN_REM_NEG1 = "PASS_ZERO";
  expectTrap(instance, "division_by_zero", () => instance.exports.checked_rem(1n, 0n));
  result.CHECKED_REM_PASS = "PASS";
  result.DIV_ZERO_FAIL_CLOSED = "PASS";

  assert.strictEqual(instance.exports.narrow_i64(2147483647n), 2147483647);
  assert.strictEqual(instance.exports.narrow_i64(-2147483648n), -2147483648);
  expectTrap(instance, "invalid_conversion", () => instance.exports.narrow_i64(2147483648n));
  expectTrap(instance, "invalid_conversion", () => instance.exports.narrow_i64(-2147483649n));
  assert.strictEqual(instance.exports.widen_i32(-2147483648), -2147483648n);
  assert.strictEqual(instance.exports.widen_f32(1.5), 1.5);
  assert.strictEqual(instance.exports.narrow_f64(1.5), 1.5);
  assert.strictEqual(instance.exports.narrow_f64(Infinity), Infinity);
  assert.strictEqual(instance.exports.narrow_f64(-Infinity), -Infinity);
  assert(Number.isNaN(instance.exports.narrow_f64(NaN)));
  assert(Object.is(instance.exports.narrow_f64(-0), -0));
  expectTrap(instance, "invalid_conversion", () => instance.exports.narrow_f64(0.1));
  result.CHECKED_NARROWING_PASS = "PASS";

  result.STATIC_OVERFLOW_REJECTION = expectStaticFailure(
    SOURCE.replace("i64.checked_add %left, %right", "i64.checked_add 9223372036854775807, 1"),
    "static-add-overflow",
    "overflow"
  );
  result.STATIC_DIVISION_BY_ZERO_REJECTION = expectStaticFailure(
    SOURCE.replace("i64.checked_div_s %left, %right", "i64.checked_div_s 1, 0"),
    "static-division-zero",
    "division_by_zero"
  );

  result.REAL_WASM_NUMERIC_EXECUTION = "true";
  result.FULL_V051_RUNTIME_COMPLETE = "false";
  return result;
}

if (require.main === module) {
  run().then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`));
}

module.exports = { FIXTURE_PATH, SOURCE, run };
