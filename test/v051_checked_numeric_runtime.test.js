#!/usr/bin/env node
"use strict";

const assert = require("node:assert");
const { run } = require("../scripts/run_v051_checked_numeric_runtime");

(async () => {
  const result = await run();
  for (const key of [
    "FORMATTER_ROUNDTRIP", "CHECKED_ADD_PASS", "CHECKED_SUB_PASS", "CHECKED_MUL_PASS",
    "CHECKED_NEG_PASS", "CHECKED_DIV_PASS", "CHECKED_REM_PASS", "CHECKED_NARROWING_PASS",
    "INT64_MIN_DIV_NEG1", "INT64_MIN_REM_NEG1", "DIV_ZERO_FAIL_CLOSED",
    "STATIC_OVERFLOW_REJECTION", "STATIC_DIVISION_BY_ZERO_REJECTION"
  ]) assert.match(result[key], /^PASS/);
  assert.strictEqual(result.REAL_WASM_NUMERIC_EXECUTION, "true");
  assert.strictEqual(result.FULL_V051_RUNTIME_COMPLETE, "false");
  process.stdout.write("v0.51 checked numeric runtime: i64 arithmetic and conversions passed\n");
})().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
