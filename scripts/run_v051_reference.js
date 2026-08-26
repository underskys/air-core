#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const reference = require("../src/v051_reference");
const typedInterface = require("../src/typed_interface");
const { parseV051Air } = require("../src/parser");
const { verifyV051Air } = require("../src/verifier");
const { validatePackageManifest } = require("../src/package_manifest");
const { checkAirpkgArtifact } = require("../src/airpkg");

const ROOT = path.resolve(__dirname, "..");
const FREEZE = fs.readFileSync(path.join(ROOT, "docs/rfcs/v0.51-final-architecture-freeze.md"), "utf8");
const TYPED = fs.readFileSync(path.join(ROOT, "docs/v0.51/TYPED_DECISIONS_NUMERICS_CONFORMANCE.md"), "utf8");
const clone = (value) => JSON.parse(JSON.stringify(value));
function literal(text, marker, fence = "json") {
  const at = text.indexOf(marker); if (at < 0) throw new Error(`missing ${marker}`);
  const begin = text.indexOf(`\`\`\`${fence}\n`, at) + fence.length + 4;
  const end = text.indexOf("\n```", begin); return text.slice(begin, end);
}
function domainDigest(domain, text) { return `sha256:${crypto.createHash("sha256").update(Buffer.concat([Buffer.from(domain), Buffer.from([0]), Buffer.from(text)])).digest("hex")}`; }
function raw(text) { return `sha256:${crypto.createHash("sha256").update(text).digest("hex")}`; }
function expect(name, value, reason) {
  if (value.outcome !== "deny" || value.reason !== reason) throw new Error(`${name} expected deny/${reason}, got ${value.outcome}/${value.reason}`);
  return `PASS_deny_${reason}`;
}
function rejects(name, fn) {
  try { fn(); } catch { return `PASS_${name}`; }
  throw new Error(`${name} unexpectedly accepted`);
}
const TI01 = {
  air_abi_lane: "0.12",
  exports: [{ function: "decide", name: "decide", parameters: [{ name: "value", type: "i32" }], return_type: "example.policy::Admission" }],
  module_id: "example.policy",
  schema: "air.typed-interface/0.12-candidate.1",
  types: [{ cases: [{ discriminant: 0, name: "deny" }, { discriminant: 1, name: "allow" }], kind: "enum", type_id: "example.policy::Admission" }]
};
const TI01_DIGEST = "sha256:876486b6fc1053a0a11c9649eff901a58a4bb5fadcfb402a601c217ae828dfbd";
const TM01 = {
  air_abi_lane: "0.12",
  capabilities: [],
  entry_export: "decide",
  host_abi_lane: "0.10",
  host_contract_version: "air.host-contract/1.0.0-candidate.1",
  interface_descriptor_digest: TI01_DIGEST,
  name: "example.policy",
  target_profiles: [],
  version: "0.51.0"
};
const TM01_DIGEST = "sha256:84e0dc510f691fe163c6af6a29e902712bca9fbed24f085ad2fc1911b4eab154";
function run() {
  const intentText = literal(FREEZE, "Requested `DecisionIntentV1` (1,166 UTF-8 bytes)");
  const grantsText = literal(FREEZE, "The complete `SuppliedGrantSet` (2,396 UTF-8 bytes)");
  const expectedText = literal(FREEZE, "The expected derivation record is 801 UTF-8 bytes");
  const intent = JSON.parse(intentText); const grants = JSON.parse(grantsText);
  const result = {};
  const vectors = [
    ["DE01", FREEZE, "Example deny vector `DE01`", "AIR_DECISION_EVIDENCE_V1", "74a439506428651773946c8bb6cd4f64ee1d9ce9f68c0e47264a426aa897f165"],
    ["OBS01", FREEZE, "`OBS01` (`AIR_CANONICAL_TYPED_INPUT_V1`", "AIR_CANONICAL_TYPED_INPUT_V1", "da0dfb66260717d5d93ef006ee9b0cb1d6b4def74bfff7f67e15ae051e94e861"],
    ["INT01", FREEZE, "`INT01` (`AIR_DECISION_INTENT_V1`", "AIR_DECISION_INTENT_V1", "f5e4b65125c93a93605811e77cb80a48dd1d6bdcc8bfd56563b39b10a028a0d0"],
    ["TP01", FREEZE, "`TP01` (`AIR_PACKAGE_IDENTITY_V1`", "AIR_PACKAGE_IDENTITY_V1", "c8d769bf321bf04fc61ce7f8eb15a125017758ec58ab6844a672a04bbfd3ea22"],
    ["A2R1_S01", TYPED, "`A2R1-S01` serializes", null, "f28f4f51f397d490ef68d002ed9ddb07f2f5e7e3ebb6354ea8befa3aec2f9a38"]
  ];
  for (const [name, text, marker, domain, expected] of vectors) {
    const value = literal(text, marker, name === "A2R1_S01" ? "text" : "json");
    const parsed = name === "A2R1_S01" ? reference.parseV051Contract(value) : JSON.parse(value);
    const normalized = name === "DE01" ? reference.normalizeFrozenDecisionEvidenceVector(parsed) :
      name === "OBS01" ? reference.normalizeCanonicalTypedInput(parsed) :
      name === "INT01" ? reference.normalizeIntent(parsed) :
        name === "TP01" ? reference.normalizePackageIdentity(parsed) : parsed;
    const bytes = reference.canonical(normalized);
    if (bytes !== value) throw new Error(`${name} canonical validator changed frozen literal bytes`);
    const actual = domain ? domainDigest(domain, bytes) : raw(bytes);
    if (actual.slice(7) !== expected) throw new Error(`${name} digest mismatch`); result[name] = "PASS";
  }
  const de01 = JSON.parse(literal(FREEZE, "Example deny vector `DE01`"));
  if (reference.createFrozenDecisionEvidenceVector(de01).digest !== `sha256:74a439506428651773946c8bb6cd4f64ee1d9ce9f68c0e47264a426aa897f165`) throw new Error("DE01 reference record mismatch");
  const duplicateObservation = JSON.parse(literal(FREEZE, "`OBS01` (`AIR_CANONICAL_TYPED_INPUT_V1`"));
  duplicateObservation.observations.push(clone(duplicateObservation.observations[0]));
  result.RECORD_DUPLICATE_KEY_REJECTED = rejects("RECORD_DUPLICATE_KEY_REJECTED", () => reference.normalizeCanonicalTypedInput(duplicateObservation));
  const wrongDecisionEnum = clone(de01);
  wrongDecisionEnum.decision_outcome.type = "air.host::ReceiptOutcome";
  result.RECORD_CLOSED_ENUM_REJECTED = rejects("RECORD_CLOSED_ENUM_REJECTED", () => reference.normalizeFrozenDecisionEvidenceVector(wrongDecisionEnum));
  const invalidDeadline = clone(intent);
  invalidDeadline.intent.deadline.value.not_after_ns.decimal = "-1";
  result.RECORD_DEADLINE_REJECTED = rejects("RECORD_DEADLINE_REJECTED", () => reference.normalizeIntent(invalidDeadline));
  if (reference.digestDomain(reference.DOMAINS.intent, JSON.parse(intentText)) !== `sha256:9babcff913d2f45c62b22301e11e1e12067440b6602d6fa82dcc93d208522f85`) throw new Error("IC06 intent digest mismatch");
  if (reference.digestDomain(reference.DOMAINS.grantSet, JSON.parse(grantsText)) !== `sha256:78ad211363f9bcd809405535b182d458c2cfe847fc343d0909ce2917e34a8c64`) throw new Error("IC06 grant digest mismatch");
  if (raw(expectedText) !== `sha256:40cf9cb239b5929d3751a32c79b72bc3880e8ef122916852d94c2d41587f42c5`) throw new Error("IC06 expected digest mismatch");
  const derived = reference.deriveEffectiveAuthority(intent, grants);
  const expected = JSON.parse(expectedText);
  if (derived.outcome !== expected.outcome || reference.canonical(derived.effective_scope) !== reference.canonical(expected.effective_scope) || reference.canonical(derived.effective_budgets) !== reference.canonical(expected.effective_budgets) || reference.canonical(derived.deadline) !== reference.canonical(expected.effective_deadline)) throw new Error("IC06 derivation mismatch");
  result.IC06 = "PASS_limit";
  const mutate = (name, fn, reason) => { const i = clone(intent), g = clone(grants); fn(i, g); result[name] = expect(name, reference.deriveEffectiveAuthority(i, g), reason); };
  mutate("IC07", (i, g) => { g.grants[0].scope.target_class = "air.target.other"; }, "grant_scope_mismatch");
  mutate("IC08", (i) => { i.intent.budgets.pop(); }, "budget_exceeded");
  mutate("IC09", (i, g) => { g.grants[0].scope.effect_types = ["air.effect.other"]; }, "grant_scope_mismatch");
  mutate("IC10", (i, g) => { g.grants[0].scope.resource_classes = []; g.grants[0].budgets = []; }, "grant_scope_mismatch");
  mutate("IC11", (i, g) => { const extra = clone(g.grants[0]); extra.grant_id = `sha256:${"3".repeat(64)}`; extra.capability = "air.capability.unrelated"; g.grants.push(extra); }, "unknown_capability");
  mutate("IC12", (i, g) => { g.grants[0].generation.fence_id = `sha256:${"0".repeat(64)}`; }, "stale_generation");
  mutate("IC13", (i) => { i.intent.required_capabilities = []; }, "invalid_intent");
  mutate("IC14", (i, g) => { g.grants = []; }, "grant_missing");
  mutate("IC15", (i) => { i.intent.required_capabilities.push("air.capability.missing"); }, "grant_missing");
  mutate("IC16", (i, g) => { g.grants[0].deadline.value.now_ns.decimal = "101"; }, "invalid_intent");
  mutate("IC17", (i, g) => { g.grants[0].deadline.value.clock_domain = "air.clock.other"; }, "invalid_intent");
  const twice = reference.deriveEffectiveAuthority(clone(intent), clone(grants)); if (reference.canonical(derived.deadline) !== reference.canonical(twice.deadline)) throw new Error("IC18 deadline is not deterministic"); result.IC18 = "PASS_byte_identical_deadline";
  mutate("IC19", (i) => { i.intent.budgets.push({ limit: { decimal: "1", type: "i64" }, resource_class: { discriminant: 4, type: "air.host::ResourceClass" } }); }, "invalid_intent");
  mutate("IC20", (i, g) => { g.grants[0].budgets.push({ limit: { decimal: "1", type: "i64" }, resource_class: { discriminant: 4, type: "air.host::ResourceClass" } }); }, "grant_scope_mismatch");
  mutate("IC21", (i) => { i.requested_scope.resource_classes = []; }, "invalid_intent");
  const expiredIntent = clone(intent); const expiredGrants = clone(grants);
  for (const deadline of [expiredIntent.intent.deadline, ...expiredGrants.grants.map((grant) => grant.deadline)]) if (deadline.tag === "some") deadline.value.now_ns.decimal = "801";
  result.IC22 = expect("IC22", reference.deriveEffectiveAuthority(expiredIntent, expiredGrants), "deadline_exceeded");

  const failureReasonDiscriminant = { grant_missing: 1, deadline_exceeded: 4, budget_exceeded: 5, invalid_intent: 6, unknown_capability: 7, grant_scope_mismatch: 2, stale_generation: 3 };
  function decisionComponents(decisionIntent, suppliedGrantSet) {
    const verifiedArtifact = {
      air_abi_lane: "0.11",
      artifact_bytes_digest: `sha256:${"d".repeat(64)}`,
      verifier_disposition: "accepted",
      verifier_evidence_digest: `sha256:${"e".repeat(64)}`
    };
    const verifiedArtifactDigest = reference.digestDomain(reference.DOMAINS.verifiedArtifact, reference.normalizeVerifiedArtifact(verifiedArtifact));
    return {
      canonicalTypedInput: { observations: [] },
      grantSet: suppliedGrantSet,
      intent: decisionIntent,
      packageIdentity: {
        air_abi_lane: "0.11",
        interface_descriptor_digest: `sha256:${"8".repeat(64)}`,
        manifest_digest: `sha256:${"9".repeat(64)}`,
        verified_artifact_digest: verifiedArtifactDigest
      },
      policyArtifact: {
        policy_identity: "air.policy.default",
        policy_interface_digest: `sha256:${"b".repeat(64)}`,
        policy_source_digest: `sha256:${"c".repeat(64)}`,
        policy_version: "0.51.0"
      },
      verifiedArtifact
    };
  }
  function decisionRecord(components) {
    const normalizedIntent = reference.normalizeIntent(components.intent, components.context || {});
    const normalizedGrants = reference.normalizeGrantSet(components.grantSet);
    const derivedDecision = reference.deriveEffectiveAuthority(components.intent, components.grantSet, components.context || {});
    const denied = derivedDecision.outcome === "deny";
    return {
      air_abi_lane: "0.11",
      canonical_typed_input_digest: reference.digestDomain(reference.DOMAINS.canonicalTypedInput, reference.normalizeCanonicalTypedInput(components.canonicalTypedInput, components.context || {})),
      contract_version: reference.CONTRACT_VERSION,
      deadline: derivedDecision.deadline,
      decision_outcome: { discriminant: denied ? 1 : derivedDecision.outcome === "allow" ? 0 : 2, type: "air.host::DecisionOutcome" },
      effective_budgets: derivedDecision.effective_budgets,
      effective_scope: denied ? { tag: "none", type: "option<air.host::GrantScope>" } : { tag: "some", type: "option<air.host::GrantScope>", value: derivedDecision.effective_scope },
      generation_fence: normalizedIntent.intent.generation,
      grant_set_digest: reference.digestDomain(reference.DOMAINS.grantSet, normalizedGrants),
      intent_digest: reference.digestDomain(reference.DOMAINS.intent, normalizedIntent),
      package_identity_digest: reference.digestDomain(reference.DOMAINS.packageIdentity, reference.normalizePackageIdentity(components.packageIdentity)),
      policy_digest: reference.digestDomain(reference.DOMAINS.policy, reference.normalizePolicyArtifact(components.policyArtifact)),
      policy_identity: components.policyArtifact.policy_identity,
      reason: denied ? { tag: "some", type: "option<air.host::FailureReason>", value: { discriminant: failureReasonDiscriminant[derivedDecision.reason], type: "air.host::FailureReason" } } : { tag: "none", type: "option<air.host::FailureReason>" },
      requested_budgets: normalizedIntent.intent.budgets,
      requested_scope: normalizedIntent.requested_scope,
      verified_artifact_digest: reference.digestDomain(reference.DOMAINS.verifiedArtifact, reference.normalizeVerifiedArtifact(components.verifiedArtifact))
    };
  }
  const limitComponents = decisionComponents(clone(intent), clone(grants));
  const limitRecord = decisionRecord(limitComponents);
  reference.createDecisionEvidence(limitRecord, limitComponents);
  const limitAsAllow = clone(limitRecord); limitAsAllow.decision_outcome.discriminant = 0;
  result.DE_C01 = rejects("DE_C01", () => reference.createDecisionEvidence(limitAsAllow, limitComponents));
  const allowIntent = clone(intent); allowIntent.requested_scope = clone(derived.effective_scope); allowIntent.intent.budgets = clone(derived.effective_budgets); allowIntent.intent.deadline = clone(derived.deadline);
  const allowComponents = decisionComponents(allowIntent, clone(grants)); const allowRecord = decisionRecord(allowComponents); const allowAsLimit = clone(allowRecord); allowAsLimit.decision_outcome.discriminant = 2;
  result.DE_C02 = rejects("DE_C02", () => reference.createDecisionEvidence(allowAsLimit, allowComponents));
  const denyComponents = decisionComponents(clone(intent), { grants: [] }); const denyRecord = decisionRecord(denyComponents);
  reference.createDecisionEvidence(denyRecord, denyComponents); result.DE_C03 = "PASS_valid_deny_components";
  const wrongDenyReason = clone(denyRecord); wrongDenyReason.reason.value.discriminant = 6;
  result.DE_C04 = rejects("DE_C04", () => reference.createDecisionEvidence(wrongDenyReason, denyComponents));
  result.DE_C05 = rejects("DE_C05", () => reference.createDecisionEvidence(limitRecord));
  const broaderScope = clone(limitRecord); broaderScope.effective_scope.value.effect_types.push("air.effect.broader"); broaderScope.effective_scope.value.effect_types.sort();
  result.DE_C06 = rejects("DE_C06", () => reference.createDecisionEvidence(broaderScope, limitComponents));
  result.F32_NAN_BITS_REJECTED = rejects("F32_NAN_BITS_REJECTED", () => reference.typedValue({ bits: "7fc00000", type: "f32" }));
  result.F64_NAN_BITS_REJECTED = rejects("F64_NAN_BITS_REJECTED", () => reference.typedValue({ bits: "7ff8000000000000", type: "f64" }));
  if (reference.canonical({ [String.fromCodePoint(0x1f600)]: 2, [String.fromCodePoint(0xe000)]: 1 }) !== `{"${String.fromCodePoint(0xe000)}":1,"${String.fromCodePoint(0x1f600)}":2}`) throw new Error("Unicode code-point canonical ordering mismatch");
  if (reference.typedValue({ classification: "nan", type: "f32" }).classification !== "nan") throw new Error("canonical NaN classification rejected");
  result.CODEPOINT_ORDER = "PASS"; result.NAN_CLASSIFICATION = "PASS";
  const canonicalTi01 = typedInterface.canonicalDescriptor(TI01);
  if (Buffer.byteLength(canonicalTi01, "utf8") !== 378 || typedInterface.descriptorDigest(TI01) !== TI01_DIGEST) throw new Error("TI01 descriptor vector mismatch");
  result.TI01 = "PASS";
  if (typedInterface.semanticManifestDigest(TM01) !== TM01_DIGEST) throw new Error("TM01 semantic manifest vector mismatch");
  result.TM01 = "PASS";
  const candidate = reference.checkAbi012Candidate({ airAbi: "0.12", name: "example.policy", typedInterface: TI01 }, { allowCandidateAbi012: true });
  result.ABI_012 = candidate.accepted && candidate.descriptorDigest === TI01_DIGEST ? "PASS_candidate_only" : "FAIL";
  result.ABI_012_DEFAULT = !reference.checkAbi012Candidate({ airAbi: "0.12", name: "example.policy", typedInterface: TI01 }).accepted ? "PASS_disabled" : "FAIL";
  const negativeDescriptors = {
    TI02: { ...TI01, unknown: true },
    TI03: (() => { const value = clone(TI01); delete value.schema; return value; })(),
    TI04: { ...TI01, exports: [] },
    TI05: { ...TI01, exports: [{}] },
    TI06: { ...TI01, exports: [{ garbage: 1 }] },
    TI07: { ...TI01, exports: ["x"] },
    TI08: { ...TI01, exports: [TI01.exports[0], { ...TI01.exports[0], function: "other" }] },
    TI09: { ...TI01, exports: [TI01.exports[0], { ...TI01.exports[0], name: "other" }] },
    TI10: { ...TI01, exports: [{ ...TI01.exports[0], parameters: [{ name: "value", type: "i32" }, { name: "value", type: "i32" }] }] },
    TI11: { ...TI01, exports: [{ ...TI01.exports[0], return_type: "Admission" }] },
    TI12: { ...TI01, exports: [{ ...TI01.exports[0], return_type: "example.policy::Missing" }] },
    TI13: { ...TI01, types: [{ ...TI01.types[0], cases: [{ discriminant: -1, name: "deny" }] }] },
    TI14: { ...TI01, exports: [{ ...TI01.exports[0], return_type: "result<i32,example.policy::Admission>" }] },
    TI15: { ...TI01, exports: [{ ...TI01.exports[0], return_type: "option<option<i32>>" }] },
    TI16: { ...TI01, exports: [{ ...TI01.exports[0], return_type: "result<result<i32,example.policy::Admission>,example.policy::Admission>" }] },
    TI17: { ...TI01, types: [...TI01.types, { cases: [{ discriminant: 0, name: "unused" }], kind: "enum", type_id: "example.policy::Unused" }] }
  };
  for (const [name, vector] of Object.entries(negativeDescriptors)) result[name] = rejects(name, () => typedInterface.normalizeTypedInterfaceDescriptor(vector));
  result.ABI_GARBAGE_EXPORTS = ["TI05", "TI06", "TI07"].every((name) => result[name].startsWith("PASS")) ? "PASS" : "FAIL";
  result.TM02 = !reference.checkAbi012Candidate({ airAbi: "0.12", name: "example.policy" }, { allowCandidateAbi012: true }).accepted ? "PASS" : "FAIL";
  result.TM03 = rejects("TM03", () => reference.checkAbi012Candidate({ airAbi: "0.10", typedInterface: TI01 }));
  result.TM04 = rejects("TM04", () => reference.checkAbi012Candidate({ airAbi: "0.11", typedInterface: TI01 }));
  const typedSource = `module example.policy

enum Admission {
  allow = 1,
  deny = 0,
}

export func decide(value: i32) -> Admission {
  return Admission.allow
}

func classify(value: Admission) -> i32 {
  %out: i32 = match %value {
    Admission.allow => 1,
    Admission.deny => 0,
  }
  return %out
}
`;
  const typedModule = parseV051Air(typedSource, "TI01.air");
  verifyV051Air(typedModule);
  const typedFormatted = require("../src/format").formatV051Air(typedModule);
  if (!typedFormatted.includes("Admission.deny => 0,") || typedFormatted.indexOf("Admission.deny => 0,") > typedFormatted.indexOf("Admission.allow => 1,")) throw new Error("typed match formatter order mismatch");
  const typedReparsed = parseV051Air(typedFormatted, "TI01.formatted.air"); verifyV051Air(typedReparsed);
  if (require("../src/format").formatV051Air(typedReparsed) !== typedFormatted) throw new Error("typed formatter is not byte-stable");
  result.NORMATIVE_MATCH = "PASS"; result.FORMATTER_MATCH = "PASS"; result.FORMATTER_BYTE_STABLE = "PASS";
  const atomSource = `module example
enum Admission {
  deny = 0,
  allow = 1,
}
error enum Fault {
  bad = 0,
}
func option_none() -> option<i32> {
  %out: option<i32> = none
  return %out
}
func option_some(value: i32) -> option<i32> {
  %out: option<i32> = some(%value)
  return %out
}
func result_ok(value: i32) -> result<i32,Fault> {
  %out: result<i32,Fault> = ok(%value)
  return %out
}
func result_err(error: Fault) -> result<i32,Fault> {
  %out: result<i32,Fault> = err(%error)
  return %out
}
func enum_value() -> Admission {
  %out: Admission = Admission.deny
  return %out
}
func option_match(value: option<i32>) -> i32 {
  %out: i32 = match %value {
    some(item) => %item,
    none => 0,
  }
  return %out
}
func result_match(value: result<i32,Fault>) -> i32 {
  %out: i32 = match %value {
    err(error) => 1,
    ok(item) => %item,
  }
  return %out
}
`;
  const atomModule = parseV051Air(atomSource, "atoms.air"); verifyV051Air(atomModule);
  const atomFormatted = require("../src/format").formatV051Air(atomModule);
  if (atomFormatted.indexOf("none => 0,") > atomFormatted.indexOf("some(item) => %item,") || atomFormatted.indexOf("ok(item) => %item,") > atomFormatted.indexOf("err(error) => 1,")) throw new Error("option/result formatter order mismatch");
  verifyV051Air(parseV051Air(atomFormatted, "atoms.formatted.air")); result.LOCAL_INITIALIZER_ATOMS = "PASS";
  result.RETURN_TYPE_REJECTED = rejects("RETURN_TYPE_REJECTED", () => verifyV051Air(parseV051Air("module example\nfunc f(value: i32) -> i32 {\n  return true\n}\n", "return-type.air")));
  result.UNKNOWN_LOCAL_REJECTED = rejects("UNKNOWN_LOCAL_REJECTED", () => verifyV051Air(parseV051Air("module example\nfunc f(value: i32) -> i32 {\n  return unknown\n}\n", "unknown-local.air")));
  result.MATCH_TYPE_MISMATCH_REJECTED = rejects("MATCH_TYPE_MISMATCH_REJECTED", () => verifyV051Air(parseV051Air(typedSource.replace("%out: i32", "%out: bool"), "match-type.air")));
  const optionShadow = `module example
func f(item: i32, value: option<i32>) -> i32 {
  %out: i32 = match %value {
    none => 0,
    some(item) => %item,
  }
  return %out
}
`;
  result.MATCH_BINDING_SHADOW_REJECTED = rejects("MATCH_BINDING_SHADOW_REJECTED", () => verifyV051Air(parseV051Air(optionShadow, "match-shadow.air")));
  const optionEscape = optionShadow.replace("func f(item: i32, value: option<i32>)", "func f(value: option<i32>)").replace("return %out", "return %item");
  result.MATCH_BINDING_ESCAPE_REJECTED = rejects("MATCH_BINDING_ESCAPE_REJECTED", () => verifyV051Air(parseV051Air(optionEscape, "match-escape.air")));
  const noDotTyped = parseV051Air("module example\nexport func decide(value: i32) -> i32 {\n  return %value\n}\n", "no-dot.air");
  verifyV051Air(noDotTyped); result.TYPED_MODULE_NO_DOT = "PASS";
  result.TI18 = rejects("TI18", () => typedInterface.validateDescriptorAgainstSource({ ...TI01, exports: [{ ...TI01.exports[0], parameters: [{ name: "other", type: "i32" }] }] }, typedModule));
  result.TI19 = rejects("TI19", () => typedInterface.validateDescriptorAgainstSource({ ...TI01, exports: [{ ...TI01.exports[0], return_type: "i32" }] }, typedModule));
  result.TI20 = rejects("TI20", () => typedInterface.validateDescriptorAgainstSource({ ...TI01, types: [{ ...TI01.types[0], cases: [{ discriminant: 0, name: "deny" }] }] }, typedModule));
  const packageDir = fs.mkdtempSync(path.join(os.tmpdir(), "air-v051-reference-"));
  try {
    fs.writeFileSync(path.join(packageDir, "policy.air"), typedSource);
    fs.writeFileSync(path.join(packageDir, "air.interface.json"), `${canonicalTi01}\n`);
    const manifest = {
      airAbi: "0.12",
      capabilities: [],
      entry: "policy.air",
      hostAbi: "0.10",
      name: "example.policy",
      packageExports: [{ function: "decide", module: "policy.air", name: "decide" }],
      targetProfiles: [],
      typedInterface: {
        descriptor: "air.interface.json",
        descriptorDigest: TI01_DIGEST,
        entryExport: "decide",
        hostContractVersion: "air.host-contract/1.0.0-candidate.1"
      },
      version: "0.51.0"
    };
    const validateManifest = (value) => {
      fs.writeFileSync(path.join(packageDir, "air.package.json"), `${JSON.stringify(value)}\n`);
      return validatePackageManifest(packageDir, { allowCandidateAbi012: true, built: false });
    };
    const validated = validateManifest(manifest);
    if (validated.typedInterface.manifestDigest !== TM01_DIGEST) throw new Error("TM01 unpacked semantic manifest mismatch");
    result.TM05 = rejects("TM05", () => validateManifest({ ...manifest, typedInterface: { ...manifest.typedInterface, descriptorDigest: `sha256:${"0".repeat(64)}` } }));
    result.TM06 = rejects("TM06", () => validateManifest({ ...manifest, name: "other.policy" }));
    result.TM07 = rejects("TM07", () => validateManifest({ ...manifest, typedInterface: { ...manifest.typedInterface, entryExport: "missing" } }));
    result.TM08 = rejects("TM08", () => validateManifest({ ...manifest, packageExports: undefined }));
    result.TM09 = rejects("TM09", () => validateManifest({ ...manifest, packageExports: [...manifest.packageExports, { function: "other", module: "policy.air", name: "other" }] }));
    result.TM10 = rejects("TM10", () => validateManifest({ ...manifest, packageExports: [{ function: "other", module: "policy.air", name: "decide" }] }));
    result.TM11 = rejects("TM11", () => validateManifest({ ...manifest, unsupportedCandidateField: true }));
    const transportPath = path.join(packageDir, "candidate.airpkg.json");
    fs.writeFileSync(transportPath, JSON.stringify({ abi: { airAbiRequired: "0.12", hostAbiRequired: "0.10" }, kind: "airpkg", schemaVersion: "0.16" }));
    const transport = checkAirpkgArtifact(transportPath);
    if (!transport.diagnostics.some((item) => item.code === "air.artifact.candidate_unsupported")) throw new Error("TM12 candidate transport containment missing");
    result.TM12 = "PASS_candidate_transport_rejected_semantic_identity_unchanged";
    result.TM13 = rejects("TM13", () => validateManifest({ ...manifest, packageExports: [{ function: "decide", module: "other.air", name: "decide" }] }));
  } finally {
    fs.rmSync(packageDir, { force: true, recursive: true });
  }
  const customDescriptor = {
    air_abi_lane: "0.12",
    exports: [{ function: "decide", name: "decide", parameters: [{ name: "operation", type: "example.policy::Operation" }], return_type: "i32" }],
    module_id: "example.policy",
    schema: "air.typed-interface/0.12-candidate.1",
    types: [{ cases: [{ discriminant: 0, name: "stop" }], kind: "enum", type_id: "example.policy::Operation" }]
  };
  const customIntent = clone(intent); customIntent.intent.typed_arguments = [{ name: "operation", value: { discriminant: 0, type: "example.policy::Operation" } }];
  const customContext = typedInterface.enumSchemaContextFromDescriptor(customDescriptor);
  result.CUSTOM_ENUM_CONTEXT = rejects("CUSTOM_ENUM_WITHOUT_CONTEXT", () => reference.normalizeIntent(customIntent));
  reference.normalizeIntent(customIntent, customContext); result.CUSTOM_ENUM_CONTEXT = "PASS";
  const receipt = {
    receipt_id: `sha256:${"f".repeat(64)}`,
    decision_evidence_digest: `sha256:${"1".repeat(64)}`,
    intent_id: `sha256:${"2".repeat(64)}`,
    generation: clone(intent.intent.generation),
    outcome: { discriminant: 0, type: "air.host::ReceiptOutcome" },
    failure_reason: { tag: "none", type: "option<air.host::FailureReason>" },
    consumed_budgets: [],
    host_execution_id: `sha256:${"3".repeat(64)}`,
    terminal_state: { discriminant: 0, type: "air.host::TerminalState" },
    redacted_observation_refs: []
  };
  reference.validateEffectReceiptBinding(receipt, receipt.decision_evidence_digest, receipt.intent_id, receipt.generation);
  result.RECEIPT_BINDING = rejects("RECEIPT_BINDING", () => reference.validateEffectReceiptBinding(receipt, `sha256:${"0".repeat(64)}`, receipt.intent_id, receipt.generation));
  result.LEGACY_011 = reference.checkAbi012Candidate({ airAbi: "0.11" }).legacy ? "PASS_unchanged" : "FAIL";
  return result;
}
if (require.main === module) process.stdout.write(`${JSON.stringify(run(), null, 2)}\n`);
module.exports = { run };
