#!/usr/bin/env node
"use strict";

const assert = require("node:assert");
const { run } = require("../scripts/run_v051_frozen_conformance_matrix");

(async () => {
  const result = await run();
  assert.strictEqual(result.fixtureManifestSha256, "8f9bc31ec07f9268197d77926fb5203b89b2d050836b2bed0a69fdedaa435a8d");
  assert.strictEqual(result.unexpectedHostExceptions, 0);
  assert.strictEqual(result.allPass, true);
  for (const [vector, status] of Object.entries(result.parentResults)) {
    assert.strictEqual(status, "PASS", vector + " did not pass");
  }
  const d16 = result.records.find((item) => item.VECTOR_ID === "D16");
  assert.deepStrictEqual(d16, {
    VECTOR_ID: "D16",
    EXPECTED: "air.decision.enum_discriminant_invalid",
    ACTUAL: "air.decision.enum_discriminant_invalid",
    PASS: "DYNAMIC_FAIL_CLOSED_PASS"
  });
  process.stdout.write("v0.51 frozen Node conformance matrix: N01-N37, D01-D28, H01-H08 passed\n");
})().catch((error) => {
  process.stderr.write(String(error.stack || error) + "\n");
  process.exitCode = 1;
});
