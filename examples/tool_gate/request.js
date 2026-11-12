const path = require("path");
const air = require("../../src");

const REQUEST_FACT_KEYS = ["amount", "targetId"];

// Host side. Everything here comes from the host's own configuration, clock and counters, never from a request.
function createToolGateAuthority(hostState = {}) {
  return air.hostAuthority({
    package: {
      directory: hostState.directory || path.resolve(__dirname),
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
    grants: hostState.grants !== undefined ? hostState.grants : [{
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
      ...(hostState.grant || {})
    }],
    limits: {
      maxAmount: 80,
      quotaLimit: 2,
      rateLimit: 3,
      now: 1000,
      maxOutputs: 1,
      maxHostCalls: 1,
      ...(hostState.limits || {})
    },
    adapters: hostState.adapters !== undefined ? hostState.adapters : { "output.emit": "capture" },
    hostFacts: {
      quotaUsed: 1,
      rateUsed: 1,
      requiresRedaction: true,
      ...(hostState.hostFacts || {})
    }
  });
}

// Request side. Only the two values a client may ask for, checked before AIR sees them.
function toolGateRequestFacts(untrusted) {
  if (!untrusted || typeof untrusted !== "object" || Array.isArray(untrusted)) throw new Error("tool request must be an object");
  const extra = Object.keys(untrusted).filter((key) => !REQUEST_FACT_KEYS.includes(key)).sort();
  if (extra.length) throw new Error(`tool request field ${extra[0]} is not accepted`);
  for (const key of REQUEST_FACT_KEYS) {
    if (!Number.isSafeInteger(untrusted[key]) || untrusted[key] < 0) throw new Error(`tool request ${key} must be a non-negative safe integer`);
  }
  return { amount: untrusted.amount, targetId: untrusted.targetId };
}

function createToolGateRequest(authority = createToolGateAuthority(), untrusted = { amount: 25, targetId: 7 }) {
  return { authority, facts: toolGateRequestFacts(untrusted) };
}

module.exports = { createToolGateAuthority, createToolGateRequest, toolGateRequestFacts };
