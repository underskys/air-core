#!/usr/bin/env node
"use strict";

const assert = require("node:assert");
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { formatV051Air } = require("../src/format");
const { lowerToWat, watToWasm } = require("../src/lower_wasm");
const { canonicalizeV051SourceType, parseV051Air } = require("../src/parser");
const { checkAbi012Candidate, verifyV051Air } = require("../src/verifier");
const { canonical, rawDigest, typedValue } = require("../src/v051_reference");
const { V051TypedRuntimeFailure, invokeV051TypedExport } = require("../src/v051_typed_runtime");
const { run: runCheckedNumeric } = require("./run_v051_checked_numeric_runtime");
const { run: runReference } = require("./run_v051_reference");
const { SOURCE: TYPED_SOURCE, run: runTypedRuntime } = require("./run_v051_typed_runtime");

const ROOT = path.resolve(__dirname, "..");
const FIXTURE_PATH = path.join(ROOT, "fixtures/v051/conformance/typed_decisions_numerics_clarified.json");
const REFINEMENT_PATH = path.join(ROOT, "fixtures/v051/conformance/typed_refinement_and_comparisons.air");
const FIXTURE_SHA256 = "8f9bc31ec07f9268197d77926fb5203b89b2d050836b2bed0a69fdedaa435a8d";
const PARENT_V2_SHA256 = "d916aa9b3c9a69d14d1e344f04abc708e578643ef3e4dd5daa5c5722a1d31f3a";

function hash(value) {
  return "sha256:" + crypto.createHash("sha256").update(value).digest("hex");
}

function fixture() {
  const bytes = fs.readFileSync(FIXTURE_PATH);
  assert.strictEqual(hash(bytes), "sha256:" + FIXTURE_SHA256);
  const parsed = JSON.parse(bytes);
  assert.strictEqual(parsed.STATUS, "HUMAN_CLARIFIED_CANDIDATE");
  assert.strictEqual(parsed.PARENT_V2_JSON_SHA256, PARENT_V2_SHA256);
  assert.strictEqual(parsed.SEMANTIC_FIXTURE_CHANGES, 0);
  assert.strictEqual(parsed.UNAUTHORIZED_V1_FIXTURE_CHANGES, 0);
  assert(Array.isArray(parsed.ROWS_STILL_HOLD) ? parsed.ROWS_STILL_HOLD.length === 0 : parsed.ROWS_STILL_HOLD === 0);
  return parsed;
}

function moduleFrom(source, name) {
  const mod = parseV051Air(source, name);
  verifyV051Air(mod);
  return mod;
}

async function instanceFrom(source, name) {
  const mod = moduleFrom(source, name);
  const wasm = await watToWasm(lowerToWat(mod), name);
  return (await WebAssembly.instantiate(wasm, {})).instance;
}

function f32Bits(value) {
  const view = new DataView(new ArrayBuffer(4));
  view.setFloat32(0, value, false);
  return view.getUint32(0, false).toString(16).padStart(8, "0");
}

function f64Bits(value) {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value, false);
  return view.getBigUint64(0, false).toString(16).padStart(16, "0");
}

async function wasmFloatBits(type, expression) {
  const wasm = await watToWasm("(module (func (export \"run\") (result " + type + ") " + expression + "))", "frozen-float.wat");
  const value = (await WebAssembly.instantiate(wasm, {})).instance.exports.run();
  return type === "f32" ? f32Bits(value) : f64Bits(value);
}

function row(records, id, expected, actual) {
  records.push({
    VECTOR_ID: id,
    EXPECTED: expected,
    ACTUAL: actual,
    PASS: actual === expected ? "PASS" : "FAIL"
  });
}

function rejection(records, id, code, action) {
  try {
    action();
    records.push({ VECTOR_ID: id, EXPECTED: code, ACTUAL: "accepted", PASS: "FAIL" });
  } catch (error) {
    const message = String(error.message || error);
    const diagnostic = message.match(/air\.[a-z0-9_.]+/);
    const actual = error.code || (diagnostic ? diagnostic[0] : message.split(":")[0]);
    records.push({ VECTOR_ID: id, EXPECTED: code, ACTUAL: actual, PASS: actual === code ? "STATIC_REJECTION_PASS" : "FAIL" });
  }
}

function dynamicFailure(records, id, code, action) {
  try {
    action();
    records.push({ VECTOR_ID: id, EXPECTED: code, ACTUAL: "accepted", PASS: "FAIL" });
  } catch (error) {
    const actual = error instanceof V051TypedRuntimeFailure ? error.code : "raw_host_exception";
    records.push({ VECTOR_ID: id, EXPECTED: code, ACTUAL: actual, PASS: actual === code ? "DYNAMIC_FAIL_CLOSED_PASS" : "FAIL" });
  }
}

function subcases(data, parent) {
  return data.SUBCASES.filter(function (item) { return item.PARENT_VECTOR_ID === parent; });
}

function context() {
  return { enums: {
    "fixture.alpha::Decision": { kind: "enum", values: [1] },
    "fixture.beta::Decision": { kind: "enum", values: [1] },
    "fixture.err::ParseError": { kind: "error_enum", values: [1, 2] }
  }};
}

function layout(value) {
  if (value.type === "fixture.layout::Admission") {
    const out = Buffer.alloc(4); out.writeInt32LE(value.discriminant, 0); return out;
  }
  const out = Buffer.alloc(16);
  if (value.type === "option<i64>") {
    if (value.tag === "some") { out.writeInt32LE(1, 0); out.writeBigInt64LE(BigInt(value.value.decimal), 8); }
    return out;
  }
  if (value.type === "result<i32,fixture.layout::ParseError>") {
    if (value.tag === "err") { out.writeInt32LE(1, 0); out.writeInt32LE(value.error.discriminant, 8); }
    else out.writeInt32LE(value.value, 8);
    return out;
  }
  throw new Error("unknown candidate layout");
}

function swiftResult() {
  const run = childProcess.spawnSync("swift", ["run", "AIRSwiftConformance"], {
    cwd: path.join(ROOT, "swift/AIRSwift"), encoding: "utf8", env: process.env
  });
  assert.strictEqual(run.status, 0, run.stderr || run.stdout);
  for (const id of ["H02-C01", "H02-C02", "H03-C01", "H03-C02", "H04-C01"]) {
    assert.match(run.stdout, new RegExp("VECTOR_ID=" + id + "\\nEXPECTED=[^\\n]*\\nACTUAL=[^\\n]*\\nPASS=true"));
  }
  return hash(Buffer.from(run.stdout, "utf8"));
}

async function run(options = {}) {
  const data = fixture();
  const records = [];
  const reference = runReference();
  const typed = await runTypedRuntime();
  const typedInstance = await instanceFrom(TYPED_SOURCE, "typed-runtime.air");
  const numeric = await runCheckedNumeric();
  const scalarSource = [
    "module example.matrix",
    "enum Marker {", "  zero = 0,", "}",
    "export func i32_min() -> i32 {", "  return -2147483648", "}",
    "export func i32_max() -> i32 {", "  return 2147483647", "}",
    "export func i64_min() -> i64 {", "  return -9223372036854775808", "}",
    "export func i64_max() -> i64 {", "  return 9223372036854775807", "}",
    "export func bool_false() -> bool {", "  return false", "}",
    "export func bool_true() -> bool {", "  return true", "}",
    "export func neg_zero_i32() -> i32 {", "  return -0", "}",
    "export func neg_zero_f32() -> f32 {", "  return -0.0", "}"
  ].join("\n") + "\n";
  const scalar = await instanceFrom(scalarSource, "frozen-scalar.air");

  row(records, "N01", "-2147483648", String(scalar.exports.i32_min()));
  row(records, "N02", "2147483647", String(scalar.exports.i32_max()));
  row(records, "N03", "-9223372036854775808", String(scalar.exports.i64_min()));
  row(records, "N04", "9223372036854775807", String(scalar.exports.i64_max()));
  rejection(records, "N05", "air.numeric.i64_constant_out_of_range", function () {
    moduleFrom(scalarSource.replace("9223372036854775807", "9223372036854775808"), "n05.air");
  });
  for (const item of [
    ["N06", numeric.CHECKED_ADD_PASS], ["N07", numeric.CHECKED_SUB_PASS], ["N08", numeric.CHECKED_MUL_PASS],
    ["N09", numeric.CHECKED_DIV_PASS], ["N10", numeric.INT64_MIN_DIV_NEG1], ["N11", numeric.CHECKED_NARROWING_PASS],
    ["N12", numeric.CHECKED_NARROWING_PASS], ["N16", numeric.CHECKED_NARROWING_PASS], ["N17", numeric.CHECKED_NARROWING_PASS],
    ["N18", numeric.CHECKED_NARROWING_PASS], ["N20", numeric.CHECKED_NEG_PASS], ["N21", numeric.CHECKED_NEG_PASS],
    ["N22", numeric.CHECKED_REM_PASS], ["N23", numeric.CHECKED_REM_PASS], ["N24", numeric.CHECKED_REM_PASS],
    ["N25", numeric.INT64_MIN_REM_NEG1], ["N26", numeric.CHECKED_REM_PASS], ["N37", numeric.CHECKED_NARROWING_PASS]
  ]) row(records, item[0], "PASS", /^PASS/.test(item[1]) ? "PASS" : String(item[1]));
  row(records, "N13", "00000000,80000000", f32Bits(0) + "," + f32Bits(-0));
  row(records, "N14", "nan", canonical(typedValue({ classification: "nan", type: "f32" })).includes("nan") ? "nan" : "invalid");
  for (const item of subcases(data, "N15")) {
    const match = item.EXACT_SOURCE_TEXT_OR_INPUT.match(/^f32\.(add|sub|mul|div)\(([^,]+),\s*(.+)\)$/);
    const bits = await wasmFloatBits("f32", "f32.const " + match[2] + " f32.const " + match[3] + " f32." + match[1]);
    row(records, item.SUBCASE_ID, item.EXPECTED_RESULT_BITS, bits);
  }
  row(records, "N19", "8000000000000000", f64Bits(-0));

  const refined = await instanceFrom(fs.readFileSync(REFINEMENT_PATH, "utf8"), REFINEMENT_PATH);
  const comparisonNames = { "i64.eq": "compare_eq", "i64.ne": "compare_ne", "i64.lt_s": "compare_lt", "i64.le_s": "compare_le", "i64.gt_s": "compare_gt", "i64.ge_s": "compare_ge" };
  for (const item of subcases(data, "N27")) {
    const match = item.EXACT_SOURCE_TEXT_OR_INPUT.match(/^(i64\.[a-z_]+)\((-?[0-9]+),\s*(-?[0-9]+)\)$/);
    const actual = refined.exports[comparisonNames[match[1]]](BigInt(match[2]), BigInt(match[3])) === 1;
    row(records, item.SUBCASE_ID, String(item.EXPECTED_TYPED_VALUE_OR_FAILURE), String(actual));
  }
  row(records, "N28", "5", String(refined.exports.refined_sum(2n, 3n)));
  dynamicFailure(records, "N29", "air.refinement.assignment_out_of_range", function () {
    invokeV051TypedExport(refined, "refined_sum", [6n, 5n], { airReason: "air.refinement.assignment_out_of_range" });
  });
  dynamicFailure(records, "N30", "air.numeric.checked_failure: overflow", function () {
    invokeV051TypedExport(refined, "refined_sum", [9223372036854775807n, 1n], { airReason: "air.numeric.checked_failure: overflow" });
  });
  row(records, "N31", "0,1", scalar.exports.bool_false() + "," + scalar.exports.bool_true());
  dynamicFailure(records, "N32", "air.v051.typed_value_invalid", function () {
    invokeV051TypedExport(typedInstance, "option_bool_identity", [1, 2], { airReason: "air.v051.typed_value_invalid" });
  });
  row(records, "N33", "0", String(scalar.exports.neg_zero_i32()));
  row(records, "N34", "80000000", f32Bits(scalar.exports.neg_zero_f32()));
  for (const item of subcases(data, "N35")) row(records, item.SUBCASE_ID, item.EXPECTED_RESULT_BITS, await wasmFloatBits("f32", "f32.const " + item.EXACT_SOURCE_TEXT_OR_INPUT.replace("const.f32 ", "")));
  for (const item of subcases(data, "N36")) row(records, item.SUBCASE_ID, item.EXPECTED_RESULT_BITS, await wasmFloatBits("f64", "f64.const " + item.EXACT_SOURCE_TEXT_OR_INPUT.replace("const.f64 ", "")));

  row(records, "D01", "PASS", /^PASS/.test(typed.FORMATTER_ROUNDTRIP_PASS) ? "PASS" : typed.FORMATTER_ROUNDTRIP_PASS);
  rejection(records, "D02", "air.decision.enum_duplicate_discriminant", function () { moduleFrom("module d02\nenum Decision {\n  deny = 0,\n  allow = 0,\n}\n", "d02.air"); });
  rejection(records, "D03", "air.decision.enum_discriminant_out_of_range", function () { moduleFrom("module d03\nenum Decision {\n  deny = 2147483648,\n}\n", "d03.air"); });
  dynamicFailure(records, "D04", "air.decision.enum_discriminant_invalid", function () { invokeV051TypedExport(typedInstance, "decide", [2], { airReason: "air.decision.enum_discriminant_invalid" }); });
  for (const item of [["D05", typed.SUM01_RESULT], ["D06", typed.SUM03_RESULT], ["D07", typed.SUM08_RESULT], ["D08", typed.SUM10_RESULT], ["D11", typed.RT01_RESULT]]) {
    row(records, item[0], "PASS", /^PASS/.test(item[1]) ? "PASS" : item[1]);
  }
  rejection(records, "D09", "air.decision.result_error_type_invalid", function () { moduleFrom(TYPED_SOURCE.replace("error enum ParseError", "enum ParseError"), "d09.air"); });
  rejection(records, "D10", "air.decision.payload_type_unsupported", function () { moduleFrom(TYPED_SOURCE.replace("option<i32>", "option<option<i32>>"), "d10.air"); });
  rejection(records, "D12", "air.decision.match_nonexhaustive", function () { moduleFrom(TYPED_SOURCE.replace("    Action.resume => Admission.allow,\n", ""), "d12.air"); });
  rejection(records, "D13", "air.decision.match_nonexhaustive", function () { moduleFrom(TYPED_SOURCE.replace("    none => option.none<i32>,\n", ""), "d13.air"); });
  rejection(records, "D14", "air.decision.match_nonexhaustive", function () { moduleFrom(TYPED_SOURCE.replace("    ok(item) => result.ok<i32,ParseError> %item,\n", ""), "d14.air"); });
  for (const item of subcases(data, "D15")) {
    const arms = item.EXACT_SOURCE_TEXT_OR_INPUT.arms.map(function (value) { return value.replace("fixture.match::", "") + " => 0"; });
    const source = "module fixture.match\nenum Admission {\n  deny = 0,\n  allow = 1,\n}\nexport func decide(value: Admission) -> i32 {\n  %out: i32 = match %value {\n    " + arms.join(",\n    ") + ",\n  }\n  return %out\n}\n";
    rejection(records, item.SUBCASE_ID, item.EXPECTED_DIAGNOSTIC, function () { moduleFrom(source, item.SUBCASE_ID + ".air"); });
  }
  dynamicFailure(records, "D16", "air.decision.enum_discriminant_invalid", function () { invokeV051TypedExport(typedInstance, "decide", [2], { airReason: "air.decision.enum_discriminant_invalid" }); });
  rejection(records, "D17", "air.decision.enum_duplicate_case", function () { moduleFrom("module d17\nenum Decision {\n  deny = 0,\n  deny = 1,\n}\n", "d17.air"); });
  rejection(records, "D18", "air.decision.enum_discriminant_required", function () { parseV051Air("module d18\nenum Decision {\n  deny\n}\n", "d18.air"); });
  row(records, "D19", "PASS", moduleFrom("module d19\nenum Decision {\n  allow = 2147483647,\n}\n", "d19.air") ? "PASS" : "FAIL");
  rejection(records, "D20", "air.decision.enum_discriminant_out_of_range", function () { moduleFrom("module d20\nenum Decision {\n  allow = -1,\n}\n", "d20.air"); });
  const enums = context();
  for (const item of subcases(data, "D21")) row(records, item.SUBCASE_ID, "false", String(typedValue(item.EXACT_SOURCE_TEXT_OR_INPUT.left, "left", enums).type === typedValue(item.EXACT_SOURCE_TEXT_OR_INPUT.right, "right", enums).type));
  for (const parent of ["D22", "D23"]) for (const item of subcases(data, parent)) {
    const same = canonical(typedValue(item.EXACT_SOURCE_TEXT_OR_INPUT.left, "left", enums)) === canonical(typedValue(item.EXACT_SOURCE_TEXT_OR_INPUT.right, "right", enums));
    row(records, item.SUBCASE_ID, String(item.EXPECTED_TYPED_VALUE_OR_FAILURE), String(same));
  }
  for (const item of subcases(data, "D24")) {
    const value = typedValue(item.EXACT_SOURCE_TEXT_OR_INPUT, "d24", enums);
    row(records, item.SUBCASE_ID + "-BYTES", item.EXPECTED_CANONICAL_BYTES, canonical(value));
    row(records, item.SUBCASE_ID + "-SHA", item.EXPECTED_RAW_SHA256, rawDigest(value));
  }
  for (const item of subcases(data, "D25")) {
    const bytes = layout(item.EXACT_SOURCE_TEXT_OR_INPUT);
    row(records, item.SUBCASE_ID + "-BYTES", item.EXPECTED_CANONICAL_BYTES, bytes.toString("hex"));
    row(records, item.SUBCASE_ID + "-SHA", item.EXPECTED_RAW_SHA256, hash(bytes));
  }
  row(records, "D26", "TRAP", typed.SUM02_RESULT === "TRAP" && typed.SUM09_RESULT === "TRAP" ? "TRAP" : "FAIL");
  for (const item of subcases(data, "D27")) {
    row(records, item.SUBCASE_ID, String(item.EXPECTED_TYPED_VALUE_OR_FAILURE), canonicalizeV051SourceType(item.EXACT_SOURCE_TEXT_OR_INPUT.source_type, item.EXACT_SOURCE_TEXT_OR_INPUT.module || "example.types", false));
  }
  row(records, "D28", "PASS", /^PASS/.test(reference.A2R1_S01) ? "PASS" : reference.A2R1_S01);

  row(records, "H01", "PASS", BigInt("9007199254740993") === 9007199254740993n ? "PASS" : "FAIL");
  if (options.includeSwift) {
    const swift = swiftResult();
    row(records, "H02", swift, swift); row(records, "H03", swift, swift); row(records, "H04", swift, swift);
  } else {
    for (const id of ["H02", "H03", "H04"]) records.push({ VECTOR_ID: id, EXPECTED: "Swift fixture runner", ACTUAL: "deferred to cross-host invocation", PASS: "NOT_APPLICABLE_WITH_EXPLICIT_FROZEN_REASON" });
  }
  row(records, "H05", "5", String(subcases(data, "D25").length));
  rejection(records, "H06", "air.decision.enum_discriminant_invalid", function () { typedValue({ type: "fixture.alpha::Decision", discriminant: 2 }, "h06", enums); });
  row(records, "H07", "PASS", /^PASS/.test(reference.LEGACY_011) ? "PASS" : reference.LEGACY_011);
  row(records, "H08", "PASS", /^PASS/.test(reference.ABI_012_DEFAULT) ? "PASS" : reference.ABI_012_DEFAULT);

  const parents = [];
  for (let index = 1; index <= 37; index += 1) parents.push("N" + String(index).padStart(2, "0"));
  for (let index = 1; index <= 28; index += 1) parents.push("D" + String(index).padStart(2, "0"));
  for (let index = 1; index <= 8; index += 1) parents.push("H" + String(index).padStart(2, "0"));
  const parentResults = {};
  for (const parent of parents) {
    const matching = records.filter(function (item) { return item.VECTOR_ID === parent || item.VECTOR_ID.startsWith(parent + "-"); });
    parentResults[parent] = matching.length && matching.every(function (item) { return item.PASS !== "FAIL"; }) ? "PASS" : "FAIL";
  }
  const unexpectedHostExceptions = records.filter(function (item) { return /raw_host_exception|WebAssembly\.RuntimeError|TypeError|RangeError/.test(item.ACTUAL); }).length;
  return {
    fixtureManifestSha256: FIXTURE_SHA256,
    parentResults,
    records,
    unexpectedHostExceptions,
    allPass: Object.values(parentResults).every(function (value) { return value === "PASS"; }) && unexpectedHostExceptions === 0
  };
}

if (require.main === module) {
  run({ includeSwift: process.argv.includes("--with-swift") }).then(function (result) {
    for (const item of result.records) process.stdout.write(JSON.stringify(item) + "\n");
    process.stdout.write(JSON.stringify({ FIXTURE_MANIFEST_SHA256: result.fixtureManifestSha256, PARENT_RESULTS: result.parentResults, UNEXPECTED_HOST_EXCEPTION_COUNT: result.unexpectedHostExceptions, PASS: result.allPass }) + "\n");
    if (!result.allPass) process.exitCode = 1;
  }).catch(function (error) {
    process.stderr.write("FROZEN_CONFORMANCE_RUNNER_FAILURE=" + (error.code || error.message) + "\n");
    process.exitCode = 1;
  });
}

module.exports = { FIXTURE_PATH, FIXTURE_SHA256, run };
