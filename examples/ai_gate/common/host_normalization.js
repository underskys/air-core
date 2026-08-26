"use strict";

// Tutorial-only host normalization. It intentionally delegates every authority
// result to the frozen Node reference evaluator; it is not another evaluator.
const crypto = require("crypto");
const {
  canonical,
  deriveEffectiveAuthority,
  normalizeCanonicalTypedInput,
  normalizeGrantSet,
  normalizeIntent
} = require("../../../src/v051_reference");

const OPERATIONS = Object.freeze({ discriminant: 2, type: "air.host::ResourceClass" });
const NONE_DEADLINE = Object.freeze({ tag: "none", type: "option<air.host::Deadline>" });

function digest(seed) {
  return `sha256:${crypto.createHash("sha256").update(seed, "utf8").digest("hex")}`;
}

function i64(value) {
  return { decimal: String(value), type: "i64" };
}

function deadline(nowNs, notAfterNs) {
  return {
    tag: "some",
    type: "option<air.host::Deadline>",
    value: {
      clock_domain: "example.clock.monotonic",
      now_ns: i64(nowNs),
      not_after_ns: i64(notAfterNs)
    }
  };
}

function fence(epoch) {
  return { domain: "example.runtime", epoch: i64(epoch), fence_id: digest(`fence:${epoch}`) };
}

function observations(generation) {
  return {
    observations: [{
      generation,
      logical_observation_id: digest("observation:logical"),
      observation_id: digest("observation:current"),
      observation_type: "example.observation.current_state",
      observed_value: true,
      precision: { discriminant: 0, type: "air.host::ObservationPrecision" },
      provenance: digest("observation:provenance"),
      source_class: { discriminant: 0, type: "air.host::SourceClass" }
    }]
  };
}

function proposal(action, requestedUses, requestedBudget, rawText = "", claimedAuthority = "") {
  return {
    type: "UntrustedProposal",
    marker: "NON_AIR_CORE_TYPE",
    action,
    requested_uses: requestedUses,
    requested_budget: requestedBudget,
    raw_text: rawText,
    claimed_authority: claimedAuthority
  };
}

function authorityInputs(options) {
  const intentGeneration = fence(options.intentEpoch ?? 1);
  const grantGeneration = fence(options.grantEpoch ?? options.intentEpoch ?? 1);
  const intentDeadline = options.intentDeadline ?? NONE_DEADLINE;
  const grantDeadline = options.grantDeadline ?? intentDeadline;
  const requestedScope = {
    effect_types: [options.effectType],
    max_uses: i64(options.requestedUses),
    resource_classes: [OPERATIONS],
    target_class: options.targetClass
  };
  const intent = {
    intent: {
      budgets: [{ limit: i64(options.requestedBudget), resource_class: OPERATIONS }],
      deadline: intentDeadline,
      effect_type: options.effectType,
      generation: intentGeneration,
      provenance: digest(`intent:${options.name}`),
      required_capabilities: [options.requiredCapability],
      typed_arguments: [{ name: "requested_value", value: i64(options.requestedBudget) }]
    },
    requested_scope: requestedScope
  };
  const grantSet = options.omitGrant ? { grants: [] } : {
    grants: [{
      budgets: [{ limit: i64(options.grantBudget ?? options.requestedBudget), resource_class: OPERATIONS }],
      capability: options.grantCapability ?? options.requiredCapability,
      constraints_digest: digest(`constraints:${options.name}`),
      deadline: grantDeadline,
      generation: grantGeneration,
      grant_id: digest(`grant:${options.name}`),
      issuer_class: "example.issuer.host",
      issuer_id: digest("issuer:host"),
      scope: {
        effect_types: [options.grantEffectType ?? options.effectType],
        max_uses: i64(options.grantUses ?? options.requestedUses),
        resource_classes: [OPERATIONS],
        target_class: options.grantTargetClass ?? options.targetClass
      }
    }]
  };
  return { intent, grantSet, observations: observations(intentGeneration) };
}

function normalizeUntrustedProposal(untrusted, hostContract) {
  if (!untrusted || untrusted.type !== "UntrustedProposal" || untrusted.marker !== "NON_AIR_CORE_TYPE") {
    throw new Error("example host accepts only an explicitly untrusted tutorial proposal");
  }
  if (untrusted.action !== hostContract.action || !Number.isInteger(untrusted.requested_uses) || untrusted.requested_uses <= 0
      || !Number.isInteger(untrusted.requested_budget) || untrusted.requested_budget <= 0) {
    throw new Error("example host rejected malformed proposal before AIR input construction");
  }
  // Raw text, confidence, provider identity, and claimed authority never enter
  // the frozen DecisionIntent or GrantSet values below.
  return authorityInputs({
    name: hostContract.name,
    requiredCapability: hostContract.requiredCapability,
    grantCapability: hostContract.grantCapability,
    effectType: hostContract.effectType,
    grantEffectType: hostContract.grantEffectType,
    targetClass: hostContract.targetClass,
    grantTargetClass: hostContract.grantTargetClass,
    requestedUses: untrusted.requested_uses,
    grantUses: hostContract.grantUses,
    requestedBudget: untrusted.requested_budget,
    grantBudget: hostContract.grantBudget,
    omitGrant: hostContract.omitGrant,
    intentEpoch: hostContract.intentEpoch,
    grantEpoch: hostContract.grantEpoch,
    intentDeadline: hostContract.intentDeadline,
    grantDeadline: hostContract.grantDeadline
  });
}

function summary(decision) {
  if (decision.outcome === "deny") return { outcome: "deny", reason: decision.reason, max_uses: null, operations: null };
  return {
    outcome: decision.outcome,
    reason: null,
    max_uses: decision.effective_scope.max_uses.decimal,
    operations: decision.effective_budgets.find((item) => item.resource_class.discriminant === OPERATIONS.discriminant)?.limit.decimal ?? null
  };
}

function executeOnlyEffective(decision) {
  if (decision.outcome === "deny") return { executed: false, max_uses: null, operations: null };
  const effective = summary(decision);
  return { executed: true, max_uses: effective.max_uses, operations: effective.operations };
}

function runNormalizedProposal(untrusted, hostContract) {
  const inputs = normalizeUntrustedProposal(untrusted, hostContract);
  const checkedObservations = normalizeCanonicalTypedInput(inputs.observations);
  const checkedIntent = normalizeIntent(inputs.intent);
  const checkedGrants = normalizeGrantSet(inputs.grantSet);
  const decision = deriveEffectiveAuthority(checkedIntent, checkedGrants);
  const semanticInput = canonical({ grants: checkedGrants, intent: checkedIntent, observations: checkedObservations });
  return { checkedGrants, checkedIntent, checkedObservations, decision, semanticInput };
}

module.exports = {
  NONE_DEADLINE,
  authorityInputs,
  deadline,
  executeOnlyEffective,
  proposal,
  runNormalizedProposal,
  summary
};
