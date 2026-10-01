#!/usr/bin/env node
"use strict";

const assert = require("node:assert");
const { MANIFEST_SHA256, run } = require("../scripts/run_v052_pressure_conformance");

(async () => {
  const first = await run();
  const second = await run();

  assert.strictEqual(MANIFEST_SHA256, "142db623a71b301a9c281cb4813d711488e76ac47bffe7efa1eb125f046a44b1");
  assert.strictEqual(first.manifest_sha256, `sha256:${MANIFEST_SHA256}`);
  assert.deepStrictEqual(second, first, "S4 conformance output must be deterministic");
  assert.deepStrictEqual(first.summary, {
    vector_count: 24,
    pass_count: 9,
    fail_closed_pass_count: 10,
    hold_count: 1,
    not_yet_proven_count: 4,
    fail_count: 0,
    unexpected_host_exception_count: 0
  });

  const ids = first.records.map((item) => item.VECTOR_ID);
  assert.strictEqual(new Set(ids).size, 24);
  assert(first.records.every((item) => Object.hasOwn(item, "VECTOR_ID")));
  assert(first.records.every((item) => Object.hasOwn(item, "EXPECTED")));
  assert(first.records.every((item) => Object.hasOwn(item, "ACTUAL")));
  assert(first.records.every((item) => ["literal", "one_of"].includes(item.MATCH)));
  assert(first.records.every((item) => Object.hasOwn(item, "PASS")));
  assert(first.records.every((item) => item.PASS !== "FAIL"));
  assert(first.records.filter((item) => item.PASS === "NOT_YET_PROVEN").every((item) => item.EVIDENCE.length > 0));
  assert(first.records.filter((item) => item.FAMILY.startsWith("message_") || [
    "transcript_spoof", "evidence_mutation", "stale_generation", "digest_not_grant", "invalidated_handle"
  ].includes(item.FAMILY)).every((item) => item.PASS === "FAIL_CLOSED_PASS"));

  const swiftHold = first.records.find((item) => item.VECTOR_ID === "S4-G2-02");
  assert.strictEqual(swiftHold.EXPECTED, "HOLD_CROSS_HOST_SWIFT");
  assert.strictEqual(swiftHold.MATCH, "one_of");
  assert.strictEqual(swiftHold.PASS, "HOLD");
  assert(swiftHold.EVIDENCE.includes(swiftHold.ACTUAL));

  const replayParity = first.records.find((item) => item.VECTOR_ID === "S4-STATE-05");
  assert.strictEqual(replayParity.ACTUAL, "IDENTICAL");
  assert(replayParity.EVIDENCE.includes("primary-runtime=sha256:"));
  assert(replayParity.EVIDENCE.includes("repeated-runtime=sha256:"));

  const swiftNotYetProven = first.records.find((item) => item.VECTOR_ID === "S4-NYP-04");
  assert.strictEqual(swiftNotYetProven.EXPECTED, "NOT_YET_PROVEN:SWIFT_WASM_CROSS_HOST");
  assert.strictEqual(swiftNotYetProven.MATCH, "one_of");
  assert.strictEqual(swiftNotYetProven.PASS, "NOT_YET_PROVEN");
  assert(swiftNotYetProven.EVIDENCE.includes(swiftHold.ACTUAL));

  process.stdout.write("v0.52 S4 pressure conformance: 24 vectors accounted, no silent skips\n");
})().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
