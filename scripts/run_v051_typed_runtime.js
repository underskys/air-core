#!/usr/bin/env node
"use strict";

const assert = require("node:assert");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { formatV051Air } = require("../src/format");
const { lowerToWat, watToWasm } = require("../src/lower_wasm");
const { parseV051Air } = require("../src/parser");
const { checkAbi012Candidate, verifyV051Air } = require("../src/verifier");
const { descriptorDigest, validateDescriptorAgainstSource } = require("../src/typed_interface");

const ROOT = path.resolve(__dirname, "..");
const FIXTURE_PATH = path.join(ROOT, "fixtures", "v051", "first_vertical", "typed_decide.air");
const SOURCE = fs.readFileSync(FIXTURE_PATH, "utf8");

const DESCRIPTOR = Object.freeze({
  air_abi_lane: "0.12",
  exports: [{
    function: "decide",
    name: "decide",
    parameters: [{ name: "action", type: "example.control::Action" }],
    return_type: "example.control::Admission"
  }],
  module_id: "example.control",
  schema: "air.typed-interface/0.12-candidate.1",
  types: [
    { cases: [{ discriminant: 0, name: "pause" }, { discriminant: 1, name: "resume" }], kind: "enum", type_id: "example.control::Action" },
    { cases: [{ discriminant: 0, name: "deny" }, { discriminant: 1, name: "allow" }], kind: "enum", type_id: "example.control::Admission" }
  ]
});

const SCALAR_SUM_SOURCE = `module example.sum_lanes

error enum ParseError {
  malformed = 0,
}

export func option_i64_identity(value: option<i64>) -> option<i64> {
  %out: option<i64> = match %value {
    none => option.none<i64>,
    some(item) => option.some<i64> %item,
  }
  return %out
}

export func option_f32_identity(value: option<f32>) -> option<f32> {
  %out: option<f32> = match %value {
    none => option.none<f32>,
    some(item) => option.some<f32> %item,
  }
  return %out
}

export func result_f64_identity(value: result<f64,ParseError>) -> result<f64,ParseError> {
  %out: result<f64,ParseError> = match %value {
    ok(item) => result.ok<f64,ParseError> %item,
    err(error) => result.err<f64,ParseError> %error,
  }
  return %out
}
`;

function rejectsVector(source, name) {
  assert.throws(() => verifyV051Air(parseV051Air(source, `${name}.air`)));
  return "PASS";
}

function rejectsIngress(invoke) {
  assert.throws(invoke, WebAssembly.RuntimeError);
  return "TRAP";
}

async function verifyCanonicalScalarInactiveLanes() {
  const mod = parseV051Air(SCALAR_SUM_SOURCE, "sum-scalar-lanes.air");
  verifyV051Air(mod);
  const wasm = await watToWasm(lowerToWat(mod), "sum-scalar-lanes.air");
  const { instance } = await WebAssembly.instantiate(wasm, {});
  assert.deepStrictEqual(instance.exports.option_i64_identity(0, 0n), [0, 0n]);
  rejectsIngress(() => instance.exports.option_i64_identity(0, 1n));
  assert.deepStrictEqual(instance.exports.option_f32_identity(0, 0), [0, 0]);
  rejectsIngress(() => instance.exports.option_f32_identity(0, -0));
  const activeNegativeZero = instance.exports.option_f32_identity(1, -0);
  assert.strictEqual(activeNegativeZero[0], 1);
  assert(Object.is(activeNegativeZero[1], -0));
  assert.deepStrictEqual(instance.exports.result_f64_identity(1, 0, 0), [1, 0, 0]);
  rejectsIngress(() => instance.exports.result_f64_identity(1, -0, 0));
  return "PASS_i64_f32_f64_raw_zero";
}

async function run() {
  const result = {};
  const parsed = parseV051Air(SOURCE, FIXTURE_PATH);
  result.REAL_TYPED_SOURCE_PARSED = "true";
  verifyV051Air(parsed);
  result.REAL_TYPED_SOURCE_VERIFIED = "true";

  const formatted = formatV051Air(parsed);
  const reparsed = parseV051Air(formatted, `${FIXTURE_PATH}.formatted`);
  verifyV051Air(reparsed);
  assert.strictEqual(formatV051Air(reparsed), formatted);
  result.FORMATTER_ROUNDTRIP_PASS = "PASS";
  result.NORMATIVE_OPTION_CONSTRUCTOR_PASS = /option\.none<i32>/.test(formatted) && /option\.some<i32> %item/.test(formatted) ? "PASS" : "FAIL";
  result.NORMATIVE_RESULT_CONSTRUCTOR_PASS = /result\.ok<i32,example\.control::ParseError> %item/.test(formatted) && /result\.err<i32,example\.control::ParseError> %error/.test(formatted) ? "PASS" : "FAIL";
  result.TYPED_SCALAR_LITERAL_PASS = /9223372036854775807/.test(formatted) && /-0\.0/.test(formatted) ? "PASS" : "FAIL";
  result.TYPED_ENUM_LITERAL_PASS = /example\.control::Admission\.allow/.test(formatted) ? "PASS" : "FAIL";
  result.NORMATIVE_MATCH_PASS = "PASS";
  assert.throws(
    () => verifyV051Air(parseV051Air(SOURCE.replace("9223372036854775807", "9223372036854775808"), "i64-out-of-range.air")),
    /air\.numeric\.i64_constant_out_of_range/
  );
  assert.throws(
    () => verifyV051Air(parseV051Air(SOURCE.replace("%single: f32 = 1.0", "%single: f32 = 1e40"), "f32-out-of-range.air")),
    /air\.v051\.typed_atom_type_mismatch/
  );
  assert.throws(
    () => verifyV051Air(parseV051Air(SOURCE.replace("error enum ParseError", "enum ParseError"), "result-error-kind.air")),
    /air\.decision\.result_error_type_invalid/
  );
  assert.throws(
    () => verifyV051Air(parseV051Air(SOURCE.replace("Admission.deny", "Admission.missing"), "unknown-enum-case.air")),
    /air\.v051\.typed_atom_invalid/
  );
  assert.throws(
    () => verifyV051Air(parseV051Air(SOURCE.replace("option.none<i32>", "option.none<i64>"), "option-payload-mismatch.air")),
    /air\.v051\.typed_constructor_type_mismatch/
  );

  const candidate = checkAbi012Candidate({ airAbi: "0.12", name: "example.control", typedInterface: DESCRIPTOR }, { allowCandidateAbi012: true, sourceModule: parsed });
  assert.strictEqual(candidate.accepted, true);
  assert.strictEqual(candidate.descriptorDigest, descriptorDigest(DESCRIPTOR));
  assert.deepStrictEqual(validateDescriptorAgainstSource(DESCRIPTOR, parsed), candidate.descriptor);
  result.ABI_012_TYPED_ARTIFACT_PASS = "PASS_candidate_only";

  const firstWat = lowerToWat(parsed);
  const secondWat = lowerToWat(parsed);
  assert.strictEqual(firstWat, secondWat);
  const firstWasm = Buffer.from(await watToWasm(firstWat, FIXTURE_PATH));
  const secondWasm = Buffer.from(await watToWasm(secondWat, FIXTURE_PATH));
  assert.deepStrictEqual(firstWasm, secondWasm);
  result.REAL_TYPED_SOURCE_LOWERED = "true";
  result.WASM_DIGEST = `sha256:${crypto.createHash("sha256").update(firstWasm).digest("hex")}`;
  const { instance } = await WebAssembly.instantiate(firstWasm, {});
  result.REAL_WASM_INSTANTIATED = "true";

  assert.strictEqual(instance.exports.decide(0), 0);
  result.RT01_RESULT = "PASS_deny";
  assert.strictEqual(instance.exports.decide(1), 1);
  result.RT02_RESULT = "PASS_allow";
  assert.strictEqual(instance.exports.scalar_literals(), 1);
  assert.deepStrictEqual(instance.exports.option_identity(0, 0), [0, 0]);
  result.SUM01_RESULT = "PASS";
  result.SUM02_RESULT = rejectsIngress(() => instance.exports.option_identity(0, 91));
  assert.deepStrictEqual(instance.exports.option_identity(1, 91), [1, 91]);
  result.SUM03_RESULT = "PASS";
  assert.deepStrictEqual(instance.exports.option_bool_identity(1, 0), [1, 0]);
  result.SUM04_RESULT = "PASS";
  assert.deepStrictEqual(instance.exports.option_bool_identity(1, 1), [1, 1]);
  result.SUM05_RESULT = "PASS";
  result.SUM06_RESULT = rejectsIngress(() => instance.exports.option_bool_identity(1, 2));
  result.SUM07_RESULT = rejectsIngress(() => instance.exports.option_identity(2, 0));

  assert.deepStrictEqual(instance.exports.result_identity(0, 91, 0), [0, 91, 0]);
  result.SUM08_RESULT = "PASS";
  result.SUM09_RESULT = rejectsIngress(() => instance.exports.result_identity(0, 91, 7));
  assert.deepStrictEqual(instance.exports.result_identity(1, 0, 0), [1, 0, 0]);
  result.SUM10_RESULT = "PASS";
  result.SUM11_RESULT = rejectsIngress(() => instance.exports.result_identity(1, 91, 0));
  result.SUM12_RESULT = rejectsIngress(() => instance.exports.result_identity(2, 0, 0));
  result.SUM13_RESULT = rejectsIngress(() => instance.exports.result_identity(1, 0, 7));
  result.SUM14_RESULT = rejectsIngress(() => instance.exports.result_bool_identity(0, 2, 0));
  result.SCALAR_INACTIVE_RAW_ZERO_RESULT = await verifyCanonicalScalarInactiveLanes();
  result.REAL_TYPED_EXPORT_INVOKED = "true";
  result.LOWER_TYPED_SCALARS_PASS = "PASS";
  result.LOWER_CLOSED_ENUM_PASS = "PASS";
  result.LOWER_OPTION_PASS = "PASS";
  result.LOWER_RESULT_PASS = "PASS";
  result.LOWER_MATCH_PASS = "PASS";

  assert.throws(() => instance.exports.decide(99), WebAssembly.RuntimeError);
  result.RT03_RESULT = "PASS_invalid_enum_discriminant";
  assert.throws(() => instance.exports.option_identity(2, 0), WebAssembly.RuntimeError);
  result.RT04_RESULT = "PASS_invalid_option_tag";
  assert.throws(() => instance.exports.result_identity(2, 0, 0), WebAssembly.RuntimeError);
  result.RT05_RESULT = "PASS_invalid_result_tag";
  result.INVALID_TAG_FAIL_CLOSED = "PASS";

  result.RT06_RESULT = rejectsVector(SOURCE.replace("    Action.resume => Admission.allow,\n", ""), "RT06_nonexhaustive");
  result.RT07_RESULT = rejectsVector(SOURCE.replace("    Action.resume => Admission.allow,", "    Action.pause => Admission.allow,"), "RT07_duplicate_arm");
  result.RT08_RESULT = rejectsVector(SOURCE.replace("    Action.pause => Admission.deny,", "    Action.pause => true,"), "RT08_wrong_arm_type");
  result.RT09_RESULT = rejectsVector(SOURCE.replace("  return %out\n}", "  return %action\n}"), "RT09_return_mismatch");
  const unsupported = parseV051Air(`${SOURCE}\nfunc deferred_void() -> void {\n}\n`, "RT10_unsupported.air");
  verifyV051Air(unsupported);
  assert.throws(() => lowerToWat(unsupported), /air\.v051\.typed_lowering_unsupported/);
  result.RT10_RESULT = "PASS_stable_fail_closed_diagnostic";

  result.CHECKED_I64_RUNTIME_PASS = "DEFERRED_NOT_REQUIRED_BY_FIRST_VERTICAL";
  result.FULL_V051_RUNTIME_COMPLETE = "false";
  return result;
}

if (require.main === module) {
  run().then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`));
}

module.exports = { DESCRIPTOR, FIXTURE_PATH, SOURCE, run };
