"use strict";

// This is the one v0.51 semantic codec. Parser, formatter, package/interface
// validation, the reference runner, and future host bindings consume its
// normalized records rather than making host-language serialization authority.
const crypto = require("crypto");

const CONTRACT_VERSION = "air.host-contract/1.0.0-candidate.1";
const ABI_012 = "0.12";
const DOMAINS = Object.freeze({
  canonicalTypedInput: "AIR_CANONICAL_TYPED_INPUT_V1",
  grantSet: "AIR_GRANT_SET_V1",
  intent: "AIR_DECISION_INTENT_V1",
  packageIdentity: "AIR_PACKAGE_IDENTITY_V1",
  policy: "AIR_POLICY_ARTIFACT_V1",
  verifiedArtifact: "AIR_VERIFIED_ARTIFACT_V1",
  decisionEvidence: "AIR_DECISION_EVIDENCE_V1",
  effectReceipt: "AIR_EFFECT_RECEIPT_V1"
});
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const IDENTIFIER = /^[a-z][a-z0-9_.-]{0,95}$/;
const I64_MIN = -(2n ** 63n);
const I64_MAX = 2n ** 63n - 1n;
const DECISION_OUTCOMES = Object.freeze({ allow: 0, deny: 1, limit: 2 });
const FAILURE_REASONS = Object.freeze({
  capability_missing: 0,
  grant_missing: 1,
  grant_scope_mismatch: 2,
  stale_generation: 3,
  deadline_exceeded: 4,
  budget_exceeded: 5,
  invalid_intent: 6,
  unknown_capability: 7,
  unknown_effect: 8,
  authority_widening: 9,
  replay_rejected: 10,
  duplicate_rejected: 11,
  invalid_receipt: 12,
  host_failure: 13
});
const CLOSED_ENUMS = Object.freeze({
  "air.host::ResourceClass": { kind: "enum", values: [0, 1, 2, 3, 4, 5] },
  "air.host::SourceClass": { kind: "enum", values: [0, 1, 2, 3] },
  "air.host::ObservationPrecision": { kind: "enum", values: [0, 1, 2, 3, 4, 5] },
  "air.host::DecisionOutcome": { kind: "enum", values: [0, 1, 2] },
  "air.host::FailureReason": { kind: "error_enum", values: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] },
  "air.host::ReceiptOutcome": { kind: "enum", values: [0, 1, 2, 3, 4] },
  "air.host::TerminalState": { kind: "enum", values: [0, 1, 2] }
});

class V051ReferenceError extends Error {
  constructor(code, message) { super(`${code}: ${message}`); this.name = "V051ReferenceError"; this.code = code; }
}
function fail(code, message) { throw new V051ReferenceError(code, message); }
function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("air.v051.record_invalid", `${label} must be an object`);
  return value;
}
function exactKeys(value, keys, label) {
  object(value, label);
  const actual = Object.keys(value).sort(); const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail("air.v051.record_invalid", `${label} has missing or unknown fields`);
}
function ascii(value, label) {
  if (typeof value !== "string" || /[^\x00-\x7f]/.test(value)) fail("air.v051.value_invalid", `${label} must be ASCII`);
  return value;
}
function identifier(value, label, qualified = false) {
  ascii(value, label);
  if (!IDENTIFIER.test(value) || (qualified && !value.includes("."))) fail("air.v051.value_invalid", `${label} is not a valid identifier`);
  return value;
}
function digest(value, label) {
  if (typeof value !== "string" || !DIGEST.test(value)) fail("air.v051.digest_invalid", `${label} must be sha256: followed by 64 lowercase hex digits`);
  return value;
}
function i64(value, label, { nonnegative = false, positive = false } = {}) {
  exactKeys(value, ["decimal", "type"], label);
  if (value.type !== "i64" || typeof value.decimal !== "string" || !/^-?(0|[1-9][0-9]*)$/.test(value.decimal) || value.decimal === "-0") fail("air.v051.typed_value_invalid", `${label} is not canonical i64`);
  const number = BigInt(value.decimal);
  if (number < I64_MIN || number > I64_MAX || (nonnegative && number < 0n) || (positive && number <= 0n)) fail("air.v051.typed_value_invalid", `${label} is out of range`);
  return { decimal: value.decimal, type: "i64" };
}
function enumSchema(type, context = {}) {
  const explicit = context.enums instanceof Map ? context.enums.get(type) : context.enums && context.enums[type];
  return explicit || CLOSED_ENUMS[type] || null;
}
function enumValue(value, label, context = {}, expectedType = null, requireError = false) {
  exactKeys(value, ["discriminant", "type"], label);
  if (typeof value.type !== "string" || !/^[a-z][a-z0-9._-]{0,127}::[A-Z][A-Za-z0-9_]{0,127}$/.test(value.type)) fail("air.v051.typed_value_invalid", `${label} enum type must be qualified`);
  if (expectedType && value.type !== expectedType) fail("air.v051.typed_value_invalid", `${label} enum type mismatches expected type`);
  const schema = enumSchema(value.type, context);
  if (!schema || (requireError && schema.kind !== "error_enum") || !Number.isInteger(value.discriminant) || !schema.values.includes(value.discriminant)) fail("air.decision.enum_discriminant_invalid", `${label} has an invalid closed-enum discriminant`);
  return { discriminant: value.discriminant, type: value.type };
}
function parseTypeReference(value, options = {}) { return require("./typed_interface").parseTypeReference(value, options); }
function typedValue(value, label = "TypedValue", context = {}, expectedType = null) {
  const expected = expectedType ? parseTypeReference(expectedType) : null;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < -2147483648 || value > 2147483647 || (expected && expected.canonical !== "i32")) fail("air.v051.typed_value_invalid", `${label} is not canonical i32`);
    return value;
  }
  if (typeof value === "boolean") {
    if (expected && expected.canonical !== "bool") fail("air.v051.typed_value_invalid", `${label} bool has wrong type`);
    return value;
  }
  object(value, label);
  if (value.type === "i64") {
    if (expected && expected.canonical !== "i64") fail("air.v051.typed_value_invalid", `${label} i64 has wrong type`);
    return i64(value, label);
  }
  if (value.type === "f32" || value.type === "f64") {
    if (expected && expected.canonical !== value.type) fail("air.v051.typed_value_invalid", `${label} floating value has wrong type`);
    const width = value.type === "f32" ? 8 : 16;
    if (value.classification === "nan") { exactKeys(value, ["classification", "type"], label); return { classification: "nan", type: value.type }; }
    exactKeys(value, ["bits", "type"], label);
    if (typeof value.bits !== "string" || !new RegExp(`^[0-9a-f]{${width}}$`).test(value.bits)) fail("air.v051.typed_value_invalid", `${label} bits are invalid`);
    if (isNanBits(value.type, value.bits)) fail("air.v051.typed_value_invalid", `${label} NaN must use the canonical classification form`);
    return { bits: value.bits, type: value.type };
  }
  if (typeof value.type !== "string") fail("air.v051.typed_value_invalid", `${label} has no canonical type`);
  const type = parseTypeReference(value.type);
  if (expected && type.canonical !== expected.canonical) fail("air.v051.typed_value_invalid", `${label} type mismatches expected type`);
  if (type.kind === "enum") return enumValue(value, label, context, type.canonical);
  if (type.kind === "option") {
    if (value.tag === "none") { exactKeys(value, ["tag", "type"], label); return { tag: "none", type: type.canonical }; }
    exactKeys(value, ["tag", "type", "value"], label);
    if (value.tag !== "some") fail("air.v051.typed_value_invalid", `${label} option tag is invalid`);
    return { tag: "some", type: type.canonical, value: typedValue(value.value, `${label}.value`, context, type.payload.canonical) };
  }
  if (type.kind === "result") {
    if (value.tag === "ok") { exactKeys(value, ["tag", "type", "value"], label); return { tag: "ok", type: type.canonical, value: typedValue(value.value, `${label}.value`, context, type.payload.canonical) }; }
    if (value.tag === "err") { exactKeys(value, ["error", "tag", "type"], label); return { error: enumValue(value.error, `${label}.error`, context, type.error.canonical, true), tag: "err", type: type.canonical }; }
    fail("air.v051.typed_value_invalid", `${label} result tag is invalid`);
  }
  fail("air.v051.typed_value_invalid", `${label} type is unsupported`);
}
function isNanBits(type, bits) {
  if (type === "f32") {
    const value = Number.parseInt(bits, 16) >>> 0;
    return (value & 0x7f800000) === 0x7f800000 && (value & 0x007fffff) !== 0;
  }
  const value = BigInt(`0x${bits}`);
  return ((value >> 52n) & 0x7ffn) === 0x7ffn && (value & ((1n << 52n) - 1n)) !== 0n;
}
function resource(value, label) { return enumValue(value, label, {}, "air.host::ResourceClass"); }
function optionDeadline(value, label) {
  object(value, label);
  if (value.tag === "none") { exactKeys(value, ["tag", "type"], label); if (value.type !== "option<air.host::Deadline>") fail("air.v051.deadline_invalid", `${label} has wrong option type`); return { tag: "none", type: value.type }; }
  exactKeys(value, ["tag", "type", "value"], label);
  if (value.tag !== "some" || value.type !== "option<air.host::Deadline>") fail("air.v051.deadline_invalid", `${label} is not a Deadline option`);
  exactKeys(value.value, ["clock_domain", "not_after_ns", "now_ns"], `${label}.value`);
  const normalized = { clock_domain: identifier(value.value.clock_domain, `${label}.clock_domain`, true), not_after_ns: i64(value.value.not_after_ns, `${label}.not_after_ns`, { nonnegative: true }), now_ns: i64(value.value.now_ns, `${label}.now_ns`, { nonnegative: true }) };
  return { tag: "some", type: value.type, value: normalized };
}
function optionScope(value, label) {
  object(value, label);
  if (value.tag === "none") { exactKeys(value, ["tag", "type"], label); if (value.type !== "option<air.host::GrantScope>") fail("air.v051.scope_invalid", `${label} has wrong option type`); return { tag: "none", type: value.type }; }
  exactKeys(value, ["tag", "type", "value"], label);
  if (value.tag !== "some" || value.type !== "option<air.host::GrantScope>") fail("air.v051.scope_invalid", `${label} is not a GrantScope option`);
  return { tag: "some", type: value.type, value: scope(value.value, `${label}.value`) };
}
function optionFailureReason(value, label) {
  object(value, label);
  if (value.tag === "none") { exactKeys(value, ["tag", "type"], label); if (value.type !== "option<air.host::FailureReason>") fail("air.v051.receipt_invalid", `${label} has wrong option type`); return { tag: "none", type: value.type }; }
  exactKeys(value, ["tag", "type", "value"], label);
  if (value.tag !== "some" || value.type !== "option<air.host::FailureReason>") fail("air.v051.receipt_invalid", `${label} is not a FailureReason option`);
  return { tag: "some", type: value.type, value: enumValue(value.value, `${label}.value`, {}, "air.host::FailureReason", true) };
}
function fence(value, label) { exactKeys(value, ["domain", "epoch", "fence_id"], label); return { domain: identifier(value.domain, `${label}.domain`, true), epoch: i64(value.epoch, `${label}.epoch`, { nonnegative: true }), fence_id: digest(value.fence_id, `${label}.fence_id`) }; }
function same(value, other) { return canonical(value) === canonical(other); }
function sortedUnique(values, label, validate, keyOf = null) {
  if (!Array.isArray(values)) fail("air.v051.collection_invalid", `${label} must be an array`);
  const normalized = values.map((value, index) => validate(value, `${label}[${index}]`));
  const keys = normalized.map((value) => keyOf ? keyOf(value) : (typeof value === "string" ? value : String(value.discriminant)));
  if (new Set(keys).size !== keys.length) fail("air.v051.collection_duplicate", `${label} has duplicate semantic keys`);
  return normalized.sort((left, right) => {
    const a = keyOf ? keyOf(left) : (typeof left === "string" ? left : left.discriminant);
    const b = keyOf ? keyOf(right) : (typeof right === "string" ? right : right.discriminant);
    return typeof a === "number" ? a - b : (a < b ? -1 : a > b ? 1 : 0);
  });
}
function budget(value, label) { exactKeys(value, ["limit", "resource_class"], label); return { limit: i64(value.limit, `${label}.limit`, { nonnegative: true }), resource_class: resource(value.resource_class, `${label}.resource_class`) }; }
function scope(value, label) {
  exactKeys(value, ["effect_types", "max_uses", "resource_classes", "target_class"], label);
  return { effect_types: sortedUnique(value.effect_types, `${label}.effect_types`, (item, itemLabel) => identifier(item, itemLabel, true)), max_uses: i64(value.max_uses, `${label}.max_uses`, { positive: true }), resource_classes: sortedUnique(value.resource_classes, `${label}.resource_classes`, resource), target_class: identifier(value.target_class, `${label}.target_class`, true) };
}
function budgetMap(items, label) { const list = sortedUnique(items, label, budget, (item) => item.resource_class.discriminant); return new Map(list.map((item) => [item.resource_class.discriminant, item])); }
function keySetMatch(budgets, classes, missingReason, extraReason, label) {
  const map = budgetMap(budgets, label); const keys = new Set(classes.map((item) => item.discriminant));
  for (const key of keys) if (!map.has(key)) return { ok: false, reason: missingReason };
  for (const key of map.keys()) if (!keys.has(key)) return { ok: false, reason: extraReason };
  return { ok: true, map };
}
function normalizeIntent(input, context = {}) {
  exactKeys(input, ["intent", "requested_scope"], "DecisionIntentV1"); object(input.intent, "DecisionIntent");
  exactKeys(input.intent, ["budgets", "deadline", "effect_type", "generation", "provenance", "required_capabilities", "typed_arguments"], "DecisionIntent");
  const requested_scope = scope(input.requested_scope, "requested_scope");
  const intent = {
    budgets: sortedUnique(input.intent.budgets, "intent.budgets", budget, (item) => item.resource_class.discriminant),
    deadline: optionDeadline(input.intent.deadline, "intent.deadline"),
    effect_type: identifier(input.intent.effect_type, "intent.effect_type", true),
    generation: fence(input.intent.generation, "intent.generation"),
    provenance: digest(input.intent.provenance, "intent.provenance"),
    required_capabilities: sortedUnique(input.intent.required_capabilities, "intent.required_capabilities", (item, itemLabel) => identifier(item, itemLabel, true)),
    typed_arguments: sortedUnique(input.intent.typed_arguments, "intent.typed_arguments", (item, itemLabel) => {
      exactKeys(item, ["name", "value"], itemLabel);
      return { name: identifier(item.name, `${itemLabel}.name`), value: typedValue(item.value, `${itemLabel}.value`, context) };
    }, (item) => item.name)
  };
  return { intent, requested_scope };
}
function normalizeGrant(value, label) {
  exactKeys(value, ["budgets", "capability", "constraints_digest", "deadline", "generation", "grant_id", "issuer_class", "issuer_id", "scope"], label);
  return { budgets: sortedUnique(value.budgets, `${label}.budgets`, budget, (item) => item.resource_class.discriminant), capability: identifier(value.capability, `${label}.capability`, true), constraints_digest: digest(value.constraints_digest, `${label}.constraints_digest`), deadline: optionDeadline(value.deadline, `${label}.deadline`), generation: fence(value.generation, `${label}.generation`), grant_id: digest(value.grant_id, `${label}.grant_id`), issuer_class: identifier(value.issuer_class, `${label}.issuer_class`, true), issuer_id: digest(value.issuer_id, `${label}.issuer_id`), scope: scope(value.scope, `${label}.scope`) };
}
function normalizeGrantSet(input) { exactKeys(input, ["grants"], "GrantSetV1"); return { grants: sortedUnique(input.grants, "grants", normalizeGrant, (item) => item.grant_id) }; }
function normalizeCapabilityObservation(value, label = "CapabilityObservation", context = {}) {
  exactKeys(value, ["generation", "logical_observation_id", "observation_id", "observation_type", "observed_value", "precision", "provenance", "source_class"], label);
  return { generation: fence(value.generation, `${label}.generation`), logical_observation_id: digest(value.logical_observation_id, `${label}.logical_observation_id`), observation_id: digest(value.observation_id, `${label}.observation_id`), observation_type: identifier(value.observation_type, `${label}.observation_type`, true), observed_value: typedValue(value.observed_value, `${label}.observed_value`, context), precision: enumValue(value.precision, `${label}.precision`, context, "air.host::ObservationPrecision"), provenance: digest(value.provenance, `${label}.provenance`), source_class: enumValue(value.source_class, `${label}.source_class`, context, "air.host::SourceClass") };
}
function normalizeCanonicalTypedInput(input, context = {}) {
  exactKeys(input, ["observations"], "CanonicalTypedInputV1");
  return { observations: sortedUnique(input.observations, "observations", (item, label) => normalizeCapabilityObservation(item, label, context), (item) => item.observation_id) };
}
function normalizePackageIdentity(value) {
  exactKeys(value, ["air_abi_lane", "interface_descriptor_digest", "manifest_digest", "verified_artifact_digest"], "PackageIdentityV1");
  if (!["0.10", "0.11", ABI_012].includes(value.air_abi_lane)) fail("air.v051.package_identity_invalid", "PackageIdentityV1 air ABI lane is invalid");
  return { air_abi_lane: value.air_abi_lane, interface_descriptor_digest: digest(value.interface_descriptor_digest, "PackageIdentityV1.interface_descriptor_digest"), manifest_digest: digest(value.manifest_digest, "PackageIdentityV1.manifest_digest"), verified_artifact_digest: digest(value.verified_artifact_digest, "PackageIdentityV1.verified_artifact_digest") };
}
function normalizePolicyArtifact(value) {
  exactKeys(value, ["policy_identity", "policy_interface_digest", "policy_source_digest", "policy_version"], "PolicyArtifactV1");
  if (typeof value.policy_version !== "string" || !value.policy_version) fail("air.v051.policy_invalid", "PolicyArtifactV1.policy_version is required");
  return { policy_identity: identifier(value.policy_identity, "PolicyArtifactV1.policy_identity", true), policy_interface_digest: digest(value.policy_interface_digest, "PolicyArtifactV1.policy_interface_digest"), policy_source_digest: digest(value.policy_source_digest, "PolicyArtifactV1.policy_source_digest"), policy_version: value.policy_version };
}
function normalizeVerifiedArtifact(value) {
  exactKeys(value, ["air_abi_lane", "artifact_bytes_digest", "verifier_disposition", "verifier_evidence_digest"], "VerifiedArtifactV1");
  if (!["0.10", "0.11", ABI_012].includes(value.air_abi_lane) || value.verifier_disposition !== "accepted") fail("air.v051.verified_artifact_invalid", "VerifiedArtifactV1 has invalid lane or verifier disposition");
  return { air_abi_lane: value.air_abi_lane, artifact_bytes_digest: digest(value.artifact_bytes_digest, "VerifiedArtifactV1.artifact_bytes_digest"), verifier_disposition: "accepted", verifier_evidence_digest: digest(value.verifier_evidence_digest, "VerifiedArtifactV1.verifier_evidence_digest") };
}
function canonical(value) {
  if (value === null || value === undefined || typeof value === "function" || typeof value === "bigint") fail("air.v051.canonical_invalid", "canonical value is unsupported");
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") { if (!Number.isSafeInteger(value)) fail("air.v051.canonical_invalid", "canonical number must be a safe integer"); return String(value); }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  object(value, "canonical value"); return `{${Object.keys(value).sort(compareUnicodeCodePoints).map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}
function compareUnicodeCodePoints(left, right) {
  const a = Array.from(left); const b = Array.from(right);
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const difference = a[index].codePointAt(0) - b[index].codePointAt(0);
    if (difference) return difference;
  }
  return a.length - b.length;
}
function digestDomain(domain, record) { return `sha256:${crypto.createHash("sha256").update(Buffer.concat([Buffer.from(domain, "utf8"), Buffer.from([0]), Buffer.from(canonical(record), "utf8")])).digest("hex")}`; }
function rawDigest(record) { return `sha256:${crypto.createHash("sha256").update(canonical(record), "utf8").digest("hex")}`; }
function deny(reason) { return { outcome: "deny", reason, effective_scope: null, effective_budgets: [], deadline: { tag: "none", type: "option<air.host::Deadline>" } }; }
function intersectStrings(values) { return values.reduce((out, value) => out.filter((item) => value.includes(item))); }
function intersectResources(values) { return values.reduce((out, value) => out.filter((item) => value.some((candidate) => candidate.discriminant === item.discriminant))); }
function deriveEffectiveAuthority(intentInput, grantsInput, context = {}) {
  let input; let grantSet;
  try { input = normalizeIntent(intentInput, context); grantSet = normalizeGrantSet(grantsInput); } catch { return deny("invalid_intent"); }
  const { intent, requested_scope } = input; const grants = grantSet.grants;
  if (!intent.required_capabilities.length) return deny("invalid_intent");
  if (!grants.length) return deny("grant_missing");
  const requestedBudgetKeys = keySetMatch(intent.budgets, requested_scope.resource_classes, "budget_exceeded", "invalid_intent", "intent.budgets");
  if (!requestedBudgetKeys.ok) return deny(requestedBudgetKeys.reason);
  for (const grant of grants) {
    if (!intent.required_capabilities.includes(grant.capability)) return deny("unknown_capability");
    const keys = keySetMatch(grant.budgets, grant.scope.resource_classes, "grant_scope_mismatch", "grant_scope_mismatch", "grant.budgets");
    if (!keys.ok) return deny(keys.reason);
    if (!same(intent.generation, grant.generation)) return deny("stale_generation");
  }
  if (intent.required_capabilities.some((capability) => !grants.some((grant) => grant.capability === capability))) return deny("grant_missing");
  const effects = intersectStrings([requested_scope.effect_types, ...grants.map((grant) => grant.scope.effect_types)]).sort();
  if (!effects.length || !effects.includes(intent.effect_type)) return deny("grant_scope_mismatch");
  const resources = intersectResources([requested_scope.resource_classes, ...grants.map((grant) => grant.scope.resource_classes)]).sort((a, b) => a.discriminant - b.discriminant);
  if (requested_scope.resource_classes.length && !resources.length) return deny("grant_scope_mismatch");
  if (grants.some((grant) => grant.scope.target_class !== requested_scope.target_class)) return deny("grant_scope_mismatch");
  const maxUses = [requested_scope.max_uses, ...grants.map((grant) => grant.scope.max_uses)].reduce((least, value) => BigInt(value.decimal) < BigInt(least.decimal) ? value : least);
  if (BigInt(maxUses.decimal) <= 0n) return deny("grant_scope_mismatch");
  const budgets = [];
  for (const item of resources) {
    const values = [requestedBudgetKeys.map.get(item.discriminant), ...grants.map((grant) => budgetMap(grant.budgets, "grant.budgets").get(item.discriminant))];
    if (values.some((value) => !value)) return deny("grant_scope_mismatch");
    const least = values.map((value) => value.limit).reduce((current, value) => BigInt(value.decimal) < BigInt(current.decimal) ? value : current);
    if (BigInt(least.decimal) <= 0n) return deny("budget_exceeded");
    budgets.push({ limit: least, resource_class: item });
  }
  const deadlines = [intent.deadline, ...grants.map((grant) => grant.deadline)].filter((value) => value.tag === "some");
  let deadline = { tag: "none", type: "option<air.host::Deadline>" };
  if (deadlines.length) {
    const first = deadlines[0].value;
    if (deadlines.some((value) => value.value.clock_domain !== first.clock_domain || value.value.now_ns.decimal !== first.now_ns.decimal)) return deny("invalid_intent");
    const notAfter = deadlines.map((value) => value.value.not_after_ns).reduce((least, value) => BigInt(value.decimal) < BigInt(least.decimal) ? value : least);
    deadline = { tag: "some", type: "option<air.host::Deadline>", value: { clock_domain: first.clock_domain, now_ns: first.now_ns, not_after_ns: notAfter } };
    if (BigInt(first.now_ns.decimal) > BigInt(notAfter.decimal)) return deny("deadline_exceeded");
  }
  const effective_scope = { effect_types: effects, max_uses: maxUses, resource_classes: resources, target_class: requested_scope.target_class };
  const unchanged = same(effective_scope, requested_scope) && same(budgets, intent.budgets) && same(deadline, intent.deadline);
  return { outcome: unchanged ? "allow" : "limit", reason: { tag: "none", type: "option<air.host::FailureReason>" }, effective_scope, effective_budgets: budgets, deadline };
}
function normalizeDecisionEvidenceRecord(record) {
  const keys = ["air_abi_lane", "canonical_typed_input_digest", "contract_version", "deadline", "decision_outcome", "effective_budgets", "effective_scope", "generation_fence", "grant_set_digest", "intent_digest", "package_identity_digest", "policy_digest", "policy_identity", "reason", "requested_budgets", "requested_scope", "verified_artifact_digest"];
  exactKeys(record, keys, "DecisionEvidence");
  if (!["0.10", "0.11", ABI_012].includes(record.air_abi_lane) || record.contract_version !== CONTRACT_VERSION) fail("air.v051.decision_evidence_invalid", "candidate lane or contract version is invalid");
  const normalized = {
    air_abi_lane: record.air_abi_lane,
    canonical_typed_input_digest: digest(record.canonical_typed_input_digest, "canonical_typed_input_digest"),
    contract_version: CONTRACT_VERSION,
    deadline: optionDeadline(record.deadline, "deadline"),
    decision_outcome: enumValue(record.decision_outcome, "decision_outcome", {}, "air.host::DecisionOutcome"),
    effective_budgets: sortedUnique(record.effective_budgets, "effective_budgets", budget, (item) => item.resource_class.discriminant),
    effective_scope: optionScope(record.effective_scope, "effective_scope"),
    generation_fence: fence(record.generation_fence, "generation_fence"),
    grant_set_digest: digest(record.grant_set_digest, "grant_set_digest"),
    intent_digest: digest(record.intent_digest, "intent_digest"),
    package_identity_digest: digest(record.package_identity_digest, "package_identity_digest"),
    policy_digest: digest(record.policy_digest, "policy_digest"),
    policy_identity: identifier(record.policy_identity, "policy_identity", true),
    reason: optionFailureReason(record.reason, "reason"),
    requested_budgets: sortedUnique(record.requested_budgets, "requested_budgets", budget, (item) => item.resource_class.discriminant),
    requested_scope: scope(record.requested_scope, "requested_scope"),
    verified_artifact_digest: digest(record.verified_artifact_digest, "verified_artifact_digest")
  };
  const isDeny = normalized.decision_outcome.discriminant === 1;
  const hasReason = normalized.reason.tag === "some";
  if (isDeny && (normalized.effective_scope.tag !== "none" || normalized.effective_budgets.length || !hasReason)) {
    fail("air.v051.decision_evidence_invalid", "deny DecisionEvidence must have no effective authority and a FailureReason");
  }
  if (!isDeny && (normalized.effective_scope.tag !== "some" || hasReason)) {
    fail("air.v051.decision_evidence_invalid", "allow or limit DecisionEvidence must have effective authority and no FailureReason");
  }
  return normalized;
}
function normalizeFrozenDecisionEvidenceVector(record) { return normalizeDecisionEvidenceRecord(record); }
function normalizeDecisionEvidence(record, components) {
  if (!components || typeof components !== "object") fail("air.v051.decision_evidence_components_required", "semantic DecisionEvidence requires coherent component records");
  const normalized = normalizeDecisionEvidenceRecord(record);
  validateDecisionEvidenceComponents(normalized, components);
  return normalized;
}
function validateDecisionEvidenceComponents(record, components) {
  const canonicalInput = normalizeCanonicalTypedInput(components.canonicalTypedInput, components.context || {});
  const grants = normalizeGrantSet(components.grantSet);
  const intent = normalizeIntent(components.intent, components.context || {});
  const packageIdentity = normalizePackageIdentity(components.packageIdentity);
  const policy = normalizePolicyArtifact(components.policyArtifact);
  const verified = normalizeVerifiedArtifact(components.verifiedArtifact);
  if (record.canonical_typed_input_digest !== digestDomain(DOMAINS.canonicalTypedInput, canonicalInput) || record.grant_set_digest !== digestDomain(DOMAINS.grantSet, grants) || record.intent_digest !== digestDomain(DOMAINS.intent, intent) || record.package_identity_digest !== digestDomain(DOMAINS.packageIdentity, packageIdentity) || record.policy_digest !== digestDomain(DOMAINS.policy, policy) || record.verified_artifact_digest !== digestDomain(DOMAINS.verifiedArtifact, verified)) fail("air.v051.decision_evidence_invalid", "DecisionEvidence component digest mismatch");
  if (record.air_abi_lane !== packageIdentity.air_abi_lane || record.air_abi_lane !== verified.air_abi_lane || record.verified_artifact_digest !== packageIdentity.verified_artifact_digest || record.policy_identity !== policy.policy_identity || !same(record.requested_budgets, intent.intent.budgets) || !same(record.requested_scope, intent.requested_scope) || !same(record.generation_fence, intent.intent.generation)) fail("air.v051.decision_evidence_invalid", "DecisionEvidence cross-record coherence mismatch");
  const derived = deriveEffectiveAuthority(intent, grants, components.context || {});
  const outcome = Object.entries(DECISION_OUTCOMES).find(([, discriminant]) => discriminant === record.decision_outcome.discriminant)?.[0];
  if (outcome !== derived.outcome) fail("air.v051.decision_evidence_invalid", "DecisionEvidence outcome does not match effective-authority derivation");
  if (derived.outcome === "deny") {
    const expectedReason = FAILURE_REASONS[derived.reason];
    if (expectedReason === undefined || record.effective_scope.tag !== "none" || record.effective_budgets.length || !same(record.deadline, derived.deadline) || record.reason.tag !== "some" || record.reason.value.discriminant !== expectedReason) {
      fail("air.v051.decision_evidence_invalid", "DecisionEvidence deny authority or FailureReason mismatches derivation");
    }
    return;
  }
  if (!same(record.effective_budgets, derived.effective_budgets) || !same(record.deadline, derived.deadline) || !same(record.effective_scope, { tag: "some", type: "option<air.host::GrantScope>", value: derived.effective_scope }) || record.reason.tag !== "none") fail("air.v051.decision_evidence_invalid", "DecisionEvidence effective authority mismatch");
}
function createDecisionEvidence(record, components) { const normalized = normalizeDecisionEvidence(record, components); return { bytes: canonical(normalized), digest: digestDomain(DOMAINS.decisionEvidence, normalized), record: normalized }; }
function createFrozenDecisionEvidenceVector(record) { const normalized = normalizeFrozenDecisionEvidenceVector(record); return { bytes: canonical(normalized), digest: digestDomain(DOMAINS.decisionEvidence, normalized), record: normalized }; }
function normalizeEffectReceipt(record) {
  const keys = ["consumed_budgets", "decision_evidence_digest", "failure_reason", "generation", "host_execution_id", "intent_id", "outcome", "receipt_id", "redacted_observation_refs", "terminal_state"];
  exactKeys(record, keys, "EffectReceipt");
  const normalized = {
    consumed_budgets: sortedUnique(record.consumed_budgets, "consumed_budgets", budget, (item) => item.resource_class.discriminant),
    decision_evidence_digest: digest(record.decision_evidence_digest, "decision_evidence_digest"),
    failure_reason: optionFailureReason(record.failure_reason, "failure_reason"),
    generation: fence(record.generation, "generation"),
    host_execution_id: digest(record.host_execution_id, "host_execution_id"),
    intent_id: digest(record.intent_id, "intent_id"),
    outcome: enumValue(record.outcome, "outcome", {}, "air.host::ReceiptOutcome"),
    receipt_id: digest(record.receipt_id, "receipt_id"),
    redacted_observation_refs: sortedUnique(record.redacted_observation_refs, "redacted_observation_refs", digest),
    terminal_state: enumValue(record.terminal_state, "terminal_state", {}, "air.host::TerminalState")
  };
  if (normalized.outcome.discriminant === 0 && normalized.failure_reason.tag !== "none") {
    fail("air.v051.receipt_invalid", "executed EffectReceipt must not carry a FailureReason");
  }
  return normalized;
}
// Canonical receipt shape is distinct from ledger-valid receipt binding.
function createEffectReceipt(record) { const normalized = normalizeEffectReceipt(record); return { bytes: canonical(normalized), digest: digestDomain(DOMAINS.effectReceipt, normalized), record: normalized }; }
function validateEffectReceiptBinding(record, decisionEvidenceDigest, intentId, generation) {
  const normalized = normalizeEffectReceipt(record);
  if (normalized.decision_evidence_digest !== digest(decisionEvidenceDigest, "decisionEvidenceDigest") || normalized.intent_id !== digest(intentId, "intentId") || !same(normalized.generation, fence(generation, "generation"))) {
    fail("air.v051.receipt_binding_invalid", "EffectReceipt does not match its bound decision, intent, and generation");
  }
  return normalized;
}
function checkAbi012Candidate(manifest, options = {}) { return require("./typed_interface").validateCandidateManifestObject(manifest, options); }
function parseV051Contract(text) { try { return JSON.parse(text); } catch { fail("air.v051.parse_invalid", "contract JSON does not parse"); } }
function formatV051Contract(value) { return canonical(value); }

module.exports = {
  ABI_012, CONTRACT_VERSION, DOMAINS, V051ReferenceError, CLOSED_ENUMS,
  canonical, digestDomain, rawDigest, typedValue, i64, fence, budget, scope,
  normalizeIntent, normalizeGrantSet, normalizeCapabilityObservation,
  normalizeCanonicalTypedInput, normalizePackageIdentity, normalizePolicyArtifact,
  normalizeVerifiedArtifact, normalizeDecisionEvidence, normalizeFrozenDecisionEvidenceVector, normalizeEffectReceipt,
  deriveEffectiveAuthority, createDecisionEvidence, createFrozenDecisionEvidenceVector, createEffectReceipt, validateEffectReceiptBinding,
  checkAbi012Candidate, parseV051Contract, formatV051Contract
};
