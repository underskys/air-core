#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const air = require("../src");
const { createToolGateRequest: createPublicToolGateRequest } = require("../examples/tool_gate/request");

const root = path.resolve(__dirname, "..");

function createToolGateRequest(options = {}) {
  const grant = {
    id: "agent.tool.invoke",
    decision: "allow",
    capability: "output",
    effects: ["output.emit"],
    targetId: 7,
    maxAmount: 100,
    quotaLimit: 3,
    rateLimit: 4,
    expiresAt: 2000,
    redaction: "required",
    ...(options.grant || {})
  };
  return {
    package: {
      directory: path.join(root, "examples", "tool_gate"),
      profile: "mock-output-v011",
      entrypoint: "decide",
      requiredGrant: "agent.tool.invoke",
      arguments: [
        { from: "facts", key: "amount" },
        { from: "effective", key: "amountLimit" },
        { from: "facts", key: "quotaUsed" },
        { from: "effective", key: "quotaLimit" },
        { from: "facts", key: "rateUsed" },
        { from: "effective", key: "rateLimit" },
        { from: "facts", key: "targetId" },
        { from: "effective", key: "allowedTargetId" },
        { from: "effective", key: "now" },
        { from: "effective", key: "expiresAt" },
        { from: "effective", key: "redactionFlag" }
      ]
    },
    facts: {
      amount: 25,
      quotaUsed: 1,
      rateUsed: 1,
      targetId: 7,
      requiresRedaction: true,
      ...(options.facts || {})
    },
    grants: options.grants !== undefined ? options.grants : [grant],
    limits: {
      maxAmount: 80,
      quotaLimit: 2,
      rateLimit: 3,
      now: 1000,
      maxOutputs: 1,
      maxHostCalls: 1,
      ...(options.limits || {})
    },
    adapters: { "output.emit": "capture" }
  };
}

function diagnosticCodes(result) {
  return new Set((result.diagnostics || []).map((item) => item.code));
}

async function expectDenied(options, reasonCode, diagnosticCode) {
  const result = await air.run(createToolGateRequest(options));
  assert.strictEqual(result.decision.status, "deny");
  assert.strictEqual(result.decision.reasonCode, reasonCode);
  assert.strictEqual(result.outputs.length, 0);
  assert.strictEqual(result.evidence.execution.status, "not_run");
  assert(diagnosticCodes(result).has(diagnosticCode));
  return result;
}

async function main() {
  const allowed = await air.run(createToolGateRequest());
  assert.strictEqual(allowed.decision.status, "allow");
  assert.deepStrictEqual(allowed.outputs[0].scalarArgs, [7, 25, 1, 1]);
  assert.strictEqual(allowed.outputs[0].display, "[REDACTED]");

  await expectDenied(
    { facts: { amount: 81 } },
    "amount_limit",
    "air.run.amount_limit_exceeded"
  );
  await expectDenied(
    { facts: { quotaUsed: 2 } },
    "quota_limit",
    "air.run.quota_limit_exceeded"
  );
  await expectDenied(
    { facts: { rateUsed: 3 } },
    "rate_limit",
    "air.run.rate_limit_exceeded"
  );
  await expectDenied(
    { facts: { targetId: 8 } },
    "forbidden_target",
    "air.run.target_denied"
  );
  await expectDenied(
    { limits: { now: 2001 } },
    "expired_grant",
    "air.run.grant_expired"
  );
  await expectDenied(
    { grant: { decision: "deny" } },
    "explicit_denial",
    "air.run.grant_denied"
  );
  await expectDenied(
    { grant: { redaction: "none" } },
    "redaction_required",
    "air.run.redaction_required"
  );

  const noSensitiveOutput = await air.run(createToolGateRequest({
    facts: { requiresRedaction: false },
    grant: { redaction: "none" }
  }));
  assert.strictEqual(noSensitiveOutput.decision.status, "allow");
  assert.strictEqual(noSensitiveOutput.outputs[0].redactionApplied, false);
  assert.strictEqual(noSensitiveOutput.outputs[0].display, "not_provided");

  const repeat = await air.run(createToolGateRequest());
  assert.deepStrictEqual(repeat, allowed);

  const publicExampleResult = await air.run(createPublicToolGateRequest());
  assert.deepStrictEqual(publicExampleResult, allowed);

  const coreSource = fs.readFileSync(path.join(root, "src", "run_package.js"), "utf8");
  assert(!/\b(?:task|claim|lease|vacancy)\b/i.test(coreSource));
  assert(!/child_process|process\.env|\bfetch\s*\(|XMLHttpRequest/.test(coreSource));

  console.log("tool gate showcase tests passed");
}

main().catch((err) => {
  console.error(err && err.stack || err);
  process.exit(1);
});
