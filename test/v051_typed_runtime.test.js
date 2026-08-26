#!/usr/bin/env node
"use strict";

const assert = require("node:assert");
const { run } = require("../scripts/run_v051_typed_runtime");

(async () => {
  const result = await run();
  for (const key of [
    "NORMATIVE_OPTION_CONSTRUCTOR_PASS", "NORMATIVE_RESULT_CONSTRUCTOR_PASS",
    "TYPED_SCALAR_LITERAL_PASS", "TYPED_ENUM_LITERAL_PASS", "NORMATIVE_MATCH_PASS",
    "FORMATTER_ROUNDTRIP_PASS", "LOWER_TYPED_SCALARS_PASS", "LOWER_CLOSED_ENUM_PASS",
    "LOWER_OPTION_PASS", "LOWER_RESULT_PASS", "LOWER_MATCH_PASS", "INVALID_TAG_FAIL_CLOSED",
    "ABI_012_TYPED_ARTIFACT_PASS", "RT01_RESULT", "RT02_RESULT", "RT03_RESULT",
    "RT04_RESULT", "RT05_RESULT", "RT06_RESULT", "RT07_RESULT", "RT08_RESULT",
    "RT09_RESULT", "RT10_RESULT", "SUM01_RESULT", "SUM03_RESULT", "SUM04_RESULT",
    "SUM05_RESULT", "SUM08_RESULT", "SUM10_RESULT", "SCALAR_INACTIVE_RAW_ZERO_RESULT"
  ]) assert.match(result[key], /^PASS/);
  for (const key of ["SUM02_RESULT", "SUM06_RESULT", "SUM07_RESULT", "SUM09_RESULT", "SUM11_RESULT", "SUM12_RESULT", "SUM13_RESULT", "SUM14_RESULT"]) {
    assert.strictEqual(result[key], "TRAP");
  }
  assert.strictEqual(result.REAL_TYPED_SOURCE_PARSED, "true");
  assert.strictEqual(result.REAL_TYPED_SOURCE_VERIFIED, "true");
  assert.strictEqual(result.REAL_TYPED_SOURCE_LOWERED, "true");
  assert.strictEqual(result.REAL_WASM_INSTANTIATED, "true");
  assert.strictEqual(result.REAL_TYPED_EXPORT_INVOKED, "true");
  assert.strictEqual(result.FULL_V051_RUNTIME_COMPLETE, "false");
  process.stdout.write("v0.51 typed first vertical: RT01-RT10 and SUM01-SUM14 passed\n");
})().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
