const path = require("path");

function createToolGateRequest(options = {}) {
  const facts = {
    amount: 25,
    quotaUsed: 1,
    rateUsed: 1,
    targetId: 7,
    requiresRedaction: true,
    ...(options.facts || {})
  };
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
  const limits = {
    maxAmount: 80,
    quotaLimit: 2,
    rateLimit: 3,
    now: 1000,
    maxOutputs: 1,
    maxHostCalls: 1,
    ...(options.limits || {})
  };
  return {
    package: {
      directory: options.directory || path.resolve(__dirname),
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
    facts,
    grants: options.grants !== undefined ? options.grants : [grant],
    limits,
    adapters: options.adapters !== undefined
      ? options.adapters
      : { "output.emit": "capture" }
  };
}

module.exports = { createToolGateRequest };
