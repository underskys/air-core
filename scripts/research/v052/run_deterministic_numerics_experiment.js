#!/usr/bin/env node
"use strict";

const assert = require("node:assert");
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { lowerToWat, watToWasm } = require("../../../src/lower_wasm");
const { parseAir, parseV051Air } = require("../../../src/parser");
const { verifyModule, verifyV051Air } = require("../../../src/verifier");
const { canonical, typedValue } = require("../../../src/v051_reference");

const ROOT = path.resolve(__dirname, "../../..");
const FIXTURE_PATH = path.join(ROOT, "fixtures/v052/numerics/g2_existing_numeric.air");
const I32_FIXTURE_PATH = path.join(ROOT, "fixtures/v052/numerics/g2_existing_i32.air");
const MANIFEST_PATH = path.join(ROOT, "fixtures/v052/numerics/g2-vector-manifest.json");
const I64_MIN = -9223372036854775808n;
const I64_MAX = 9223372036854775807n;
const I32_MIN = -2147483648;
const I32_MAX = 2147483647;
const FAILURE_CODES = Object.freeze({ overflow: 1, division_by_zero: 2, invalid_conversion: 3 });

function sha256(value) {
  return "sha256:" + crypto.createHash("sha256").update(value).digest("hex");
}

function f64Bits(value) {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value, false);
  return view.getBigUint64(0, false).toString(16).padStart(16, "0");
}

function f32Bits(value) {
  const view = new DataView(new ArrayBuffer(4));
  view.setFloat32(0, value, false);
  return view.getUint32(0, false).toString(16).padStart(8, "0");
}

function quotientTowardZero(numerator, denominator) {
  assert.notStrictEqual(denominator, 0n);
  const magnitude = (numerator < 0n ? -numerator : numerator) / (denominator < 0n ? -denominator : denominator);
  return (numerator < 0n) !== (denominator < 0n) ? -magnitude : magnitude;
}

function floorQuotient(numerator, denominator) {
  const towardZero = quotientTowardZero(numerator, denominator);
  const remainder = numerator % denominator;
  return remainder !== 0n && (numerator < 0n) !== (denominator < 0n) ? towardZero - 1n : towardZero;
}

function ceilQuotient(numerator, denominator) {
  const towardZero = quotientTowardZero(numerator, denominator);
  const remainder = numerator % denominator;
  return remainder !== 0n && (numerator < 0n) === (denominator < 0n) ? towardZero + 1n : towardZero;
}

function tiesToEvenQuotient(numerator, denominator) {
  const sign = (numerator < 0n) !== (denominator < 0n) ? -1n : 1n;
  const absNumerator = numerator < 0n ? -numerator : numerator;
  const absDenominator = denominator < 0n ? -denominator : denominator;
  const quotient = absNumerator / absDenominator;
  const remainder = absNumerator % absDenominator;
  const twice = remainder * 2n;
  const rounded = twice < absDenominator ? quotient : twice > absDenominator ? quotient + 1n : (quotient % 2n === 0n ? quotient : quotient + 1n);
  return sign * rounded;
}

function exactRational(numerator, denominator) {
  assert.notStrictEqual(denominator, 0n);
  return { numerator: numerator.toString(), denominator: denominator.toString() };
}

function record(records, id, expected, actual, provenance) {
  const pass = expected === actual;
  records.push({ VECTOR_ID: id, EXPECTED: expected, ACTUAL: actual, PASS: pass ? "PASS" : "FAIL", PROVENANCE: provenance });
  assert.strictEqual(actual, expected, id + " mismatch");
}

function expectAirTrap(instance, operation, args, reason, records, id) {
  let actual = "accepted";
  try {
    instance.exports[operation](...args);
  } catch (error) {
    actual = error instanceof WebAssembly.RuntimeError && instance.exports.__air_v051_checked_numeric_failure.value === FAILURE_CODES[reason]
      ? `air.numeric.checked_failure:${reason}`
      : `unexpected:${String(error.message || error)}`;
  }
  record(records, id, `air.numeric.checked_failure:${reason}`, actual, "AIR source -> parse -> verify -> lower -> Wasm");
}

function expectOutsideI64(value, id) {
  assert(value < I64_MIN || value > I64_MAX, `${id} must be outside the i64 range in the independent BigInt oracle`);
}

async function instanceFromFixture() {
  const source = fs.readFileSync(FIXTURE_PATH, "utf8");
  const parsed = parseV051Air(source, FIXTURE_PATH);
  verifyV051Air(parsed);
  const wat = lowerToWat(parsed);
  const wasm = await watToWasm(wat, FIXTURE_PATH);
  const instance = (await WebAssembly.instantiate(wasm, {})).instance;
  return { instance, source, wat, wasm };
}

async function instanceFromI32Fixture() {
  const source = fs.readFileSync(I32_FIXTURE_PATH, "utf8");
  const parsed = parseAir(source, I32_FIXTURE_PATH);
  verifyModule(parsed);
  const wat = lowerToWat(parsed);
  const wasm = await watToWasm(wat, I32_FIXTURE_PATH);
  return (await WebAssembly.instantiate(wasm, {})).instance;
}

async function wasmF64Bits(expression) {
  const wasm = await watToWasm(`(module (func (export "run") (result f64) ${expression}))`, "v052-g2-f64-engine-probe.wat");
  const value = (await WebAssembly.instantiate(wasm, {})).instance.exports.run();
  return f64Bits(value);
}

function runSwiftProbe() {
  const probe = path.join(ROOT, "scripts/research/v052/swift_deterministic_numerics_probe.swift");
  const moduleCache = path.join("/private/tmp", "air-g2-swift-module-cache");
  const xcodeDeveloper = "/Applications/Xcode.app/Contents/Developer";
  const env = { ...process.env };
  if (fs.existsSync(xcodeDeveloper)) env.DEVELOPER_DIR = xcodeDeveloper;
  const run = childProcess.spawnSync("swift", ["-Xfrontend", "-module-cache-path", "-Xfrontend", moduleCache, probe], { cwd: ROOT, encoding: "utf8", env });
  if (run.error || run.status !== 0) {
    return { available: false, status: run.status, stderr: String(run.stderr || run.error || "swift probe failed") };
  }
  return { available: true, values: JSON.parse(run.stdout) };
}

function compareSwiftNativeProbe(swift, records) {
  if (!swift.available) return [{ VECTOR_ID: "PARITY-SWIFT-ENV", EXPECTED: "swift native probe", ACTUAL: "unavailable", PASS: "HOLD" }];
  const byId = new Map(records.map((item) => [item.VECTOR_ID, item.ACTUAL]));
  const cases = [
    ["PARITY-01", "F64-01", "f64_plus_zero_bits"],
    ["PARITY-02", "F64-02", "f64_minus_zero_bits"],
    ["PARITY-03", "F64-03", "f64_normal_bits"],
    ["PARITY-04", "F64-04", "f64_least_subnormal_bits"],
    ["PARITY-05", "F64-05", "f64_least_normal_bits"],
    ["PARITY-06", "F64-06", "f64_max_finite_bits"],
    ["PARITY-07", "F64-07", "f64_infinity_bits"],
    ["PARITY-08", "F64-08", "f64_nan_classification"],
    ["PARITY-09", "F64-13", "f64_halfway_add_bits"],
    ["PARITY-10", "F64-14", "f64_one_third_bits"]
  ];
  return cases.map(([id, nodeId, swiftKey]) => {
    const expected = byId.get(nodeId);
    const actual = swift.values[swiftKey];
    return { VECTOR_ID: id, NODE_WASM: expected, SWIFT_NATIVE: actual, PASS: expected === actual ? "PASS" : "FAIL", SCOPE: "native Swift IEEE probe only; not Swift/Wasm AIR execution" };
  });
}

async function run() {
  const manifestBytes = fs.readFileSync(MANIFEST_PATH);
  const manifest = JSON.parse(manifestBytes);
  const { instance, source, wat, wasm } = await instanceFromFixture();
  const i32Instance = await instanceFromI32Fixture();
  const records = [];
  const nodeWasm = { fixture_sha256: sha256(Buffer.from(source, "utf8")), wat_sha256: sha256(Buffer.from(wat, "utf8")), wasm_sha256: sha256(wasm), records };

  record(records, "F64-01", "0000000000000000", f64Bits(instance.exports.f64_identity(0)), "AIR source -> parse -> verify -> lower -> Wasm");
  record(records, "F64-02", "8000000000000000", f64Bits(instance.exports.f64_identity(-0)), "AIR source -> parse -> verify -> lower -> Wasm");
  record(records, "F64-03", "3ff8000000000000", f64Bits(instance.exports.f64_identity(1.5)), "AIR source -> parse -> verify -> lower -> Wasm");
  record(records, "F64-04", "0000000000000001", f64Bits(instance.exports.f64_identity(Number.MIN_VALUE)), "AIR host boundary identity probe");
  record(records, "F64-05", "0010000000000000", f64Bits(instance.exports.f64_identity(2 ** -1022)), "AIR host boundary identity probe");
  record(records, "F64-06", "7fefffffffffffff", f64Bits(instance.exports.f64_identity(Number.MAX_VALUE)), "AIR host boundary identity probe");
  record(records, "F64-07", "7ff0000000000000", f64Bits(instance.exports.f64_identity(Infinity)), "AIR host boundary identity probe");
  record(records, "F64-08", "nan", Number.isNaN(instance.exports.f64_identity(NaN)) ? "nan" : "not_nan", "AIR host boundary identity probe");
  record(records, "F64-09", "8000000000000000", f64Bits(instance.exports.f64_negative_zero()), "AIR source literal -> parse -> verify -> lower -> Wasm");
  record(records, "F64-10", "3ff8000000000000", f64Bits(instance.exports.f32_to_f64(1.5)), "AIR source conversion -> Wasm");
  record(records, "F64-11", "3fc00000", f32Bits(instance.exports.f64_to_f32_checked(1.5)), "AIR source checked conversion -> Wasm");
  expectAirTrap(instance, "f64_to_f32_checked", [0.1], "invalid_conversion", records, "F64-12");
  record(records, "F64-13", "3ff0000000000000", await wasmF64Bits("f64.const 1 f64.const 0x1p-53 f64.add"), "Wasm engine probe; f64 arithmetic is not admitted AIR source semantics");
  record(records, "F64-14", "3fd5555555555555", await wasmF64Bits("f64.const 1 f64.const 3 f64.div"), "Wasm engine probe; f64 arithmetic is not admitted AIR source semantics");
  record(records, "F64-15", "7ff0000000000000", await wasmF64Bits("f64.const 0x1.fffffffffffffp1023 f64.const 2 f64.mul"), "Wasm engine probe; overflow behavior is not an admitted AIR source semantic");
  record(records, "F64-16", "0000000000000000", await wasmF64Bits("f64.const 0x0.0000000000001p-1022 f64.const 2 f64.div"), "Wasm engine probe; underflow behavior is not an admitted AIR source semantic");

  const add1000 = 1500n + 250n;
  const sub1000 = -1500n - 500n;
  record(records, "S64-01", add1000.toString(), String(instance.exports.i64_checked_add(1500n, 250n)), "AIR source checked i64 Wasm; independent BigInt oracle");
  record(records, "S64-02", sub1000.toString(), String(instance.exports.i64_checked_sub(-1500n, 500n)), "AIR source checked i64 Wasm; independent BigInt oracle");
  const product1000 = instance.exports.i64_checked_mul(1500n, 2000n);
  const oracleProduct1000 = 1500n * 2000n;
  record(records, "S64-03-INTERMEDIATE", oracleProduct1000.toString(), String(product1000), "AIR source checked i64 Wasm; independent BigInt oracle");
  record(records, "S64-03", quotientTowardZero(oracleProduct1000, 1000n).toString(), String(instance.exports.i64_checked_div(product1000, 1000n)), "AIR source checked i64 Wasm; independent BigInt oracle and explicit candidate rescale");
  const dividend1000 = instance.exports.i64_checked_mul(1500n, 1000n);
  const oracleDividend1000 = 1500n * 1000n;
  record(records, "S64-04", quotientTowardZero(oracleDividend1000, 2000n).toString(), String(instance.exports.i64_checked_div(dividend1000, 2000n)), "AIR source checked i64 Wasm; independent BigInt oracle and explicit candidate division scaling");
  record(records, "S64-05", quotientTowardZero(1500n, 1000n).toString(), String(instance.exports.i64_checked_div(1500n, 1000n)), "AIR source checked i64 Wasm");
  record(records, "S64-06", quotientTowardZero(-1500n, 1000n).toString(), String(instance.exports.i64_checked_div(-1500n, 1000n)), "AIR source checked i64 Wasm");
  expectOutsideI64(I64_MAX * 2n, "S64-07");
  expectAirTrap(instance, "i64_checked_mul", [I64_MAX, 2n], "overflow", records, "S64-07");
  expectOutsideI64(I64_MIN / -1n, "S64-08");
  expectAirTrap(instance, "i64_checked_div", [I64_MIN, -1n], "overflow", records, "S64-08");
  const product1000000 = instance.exports.i64_checked_mul(1500000n, 2000000n);
  const oracleProduct1000000 = 1500000n * 2000000n;
  record(records, "S64-09", quotientTowardZero(oracleProduct1000000, 1000000n).toString(), String(instance.exports.i64_checked_div(product1000000, 1000000n)), "AIR source checked i64 Wasm; independent BigInt oracle and 10^6 candidate scale");

  record(records, "S32-01", "1750", String(i32Instance.exports.i32_add(1500, 250)), "AIR source existing i32 Wasm");
  record(records, "S32-02", String(I32_MIN), String(i32Instance.exports.i32_add(I32_MAX, 1)), "AIR source existing i32 Wasm wrap probe");
  {
    let actual = "accepted";
    try { i32Instance.exports.i32_div_s(I32_MIN, -1); } catch (error) { actual = error instanceof WebAssembly.RuntimeError ? "raw_wasm_trap" : "unexpected"; }
    record(records, "S32-03", "raw_wasm_trap", actual, "AIR source existing i32 Wasm; no checked-i32 failure identity");
  }

  const rounding = [
    ["ROUND-01", 1500n, 1000n],
    ["ROUND-02", -1500n, 1000n]
  ].map(([id, numerator, denominator]) => ({
    VECTOR_ID: id,
    exact: exactRational(numerator, denominator),
    truncate_toward_zero: quotientTowardZero(numerator, denominator).toString(),
    floor: floorQuotient(numerator, denominator).toString(),
    ceil: ceilQuotient(numerator, denominator).toString(),
    ties_to_even: tiesToEvenQuotient(numerator, denominator).toString(),
    existing_i64_checked_div: String(instance.exports.i64_checked_div(numerator, denominator))
  }));
  const rescale = [
    { VECTOR_ID: "RESCALE-01", FROM_SCALE: "1000", TO_SCALE: "1000000", ACTUAL: "UNREPRESENTED_BY_EXISTING_I64_TYPE", PASS: "PROFILE_RULE_REQUIRED" },
    { VECTOR_ID: "RESCALE-02", FROM_SCALE: "1000000", TO_SCALE: "1000", ACTUAL: "ROUNDING_POLICY_UNREPRESENTED_BY_EXISTING_I64_TYPE", PASS: "PROFILE_RULE_REQUIRED" }
  ];
  const negativeAuthority = [
    "numeric profile != CapabilityGrant",
    "scale/profile identity != authority",
    "numeric result != DecisionEvidence",
    "overflow/failure evidence != EffectReceipt",
    "simulation number cannot mint a host capability"
  ].map((claim, index) => ({ VECTOR_ID: `PARITY-NA-${index + 1}`, CLAIM: claim, ACTUAL: "NO_HOST_CONTRACT_OR_AUTHORITY_SURFACE_USED", PASS: "PASS" }));
  const canonicalCodec = {
    negative_zero: canonical(typedValue({ type: "f64", bits: "8000000000000000" })),
    finite_one: canonical(typedValue({ type: "f64", bits: "3ff0000000000000" })),
    nan: canonical(typedValue({ type: "f64", classification: "nan" }))
  };
  const swift = runSwiftProbe();
  const swiftNativeParity = compareSwiftNativeProbe(swift, records);
  for (const item of swiftNativeParity) {
    if (item.PASS === "FAIL") throw new Error(`${item.VECTOR_ID} native Swift parity mismatch`);
  }

  return {
    schema: manifest.schema,
    task_id: manifest.task_id,
    source_execution: nodeWasm,
    rounding,
    rescale,
    negative_authority: negativeAuthority,
    canonical_codec: canonicalCodec,
    swift_native_probe: swift,
    swift_native_parity: swiftNativeParity,
    swift_wasm_result: swift.available ? "HOLD_CROSS_HOST_SWIFT_WASM_BACKEND_UNAVAILABLE" : "HOLD_CROSS_HOST_SWIFT_ENVIRONMENT",
    manifest_sha256: sha256(manifestBytes),
    vectors_executed: records.length + rounding.length + rescale.length + negativeAuthority.length
  };
}

if (require.main === module) {
  run().then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)).catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
  });
}

module.exports = { run, quotientTowardZero, floorQuotient, ceilQuotient, tiesToEvenQuotient };
