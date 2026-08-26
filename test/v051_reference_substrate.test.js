#!/usr/bin/env node
"use strict";
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { run } = require("../scripts/run_v051_reference");
const { canonical, createEffectReceipt, digestDomain, DOMAINS, formatV051Contract, parseV051Contract, typedValue } = require("../src/v051_reference");
const { parseV051Air } = require("../src/parser");
const { formatV051Air } = require("../src/format");
const { verifyV051Air } = require("../src/verifier");
const {
  descriptorDigest,
  validateDescriptorAgainstSource
} = require("../src/typed_interface");
const { validatePackageManifest } = require("../src/package_manifest");

const result = run();
for (const key of [
  "DE01", "A2R1_S01", "OBS01", "INT01", "TP01",
  "RECORD_DUPLICATE_KEY_REJECTED", "RECORD_CLOSED_ENUM_REJECTED", "RECORD_DEADLINE_REJECTED",
  "IC06", "IC07", "IC08", "IC09", "IC10", "IC11", "IC12", "IC13", "IC14", "IC15", "IC16", "IC17", "IC18", "IC19", "IC20", "IC21", "IC22",
  "DE_C01", "DE_C02", "DE_C03", "DE_C04", "DE_C05", "DE_C06",
  "F32_NAN_BITS_REJECTED", "F64_NAN_BITS_REJECTED", "CODEPOINT_ORDER", "NAN_CLASSIFICATION",
  "NORMATIVE_MATCH", "FORMATTER_MATCH", "FORMATTER_BYTE_STABLE", "LOCAL_INITIALIZER_ATOMS", "RETURN_TYPE_REJECTED", "UNKNOWN_LOCAL_REJECTED", "MATCH_TYPE_MISMATCH_REJECTED", "MATCH_BINDING_SHADOW_REJECTED", "MATCH_BINDING_ESCAPE_REJECTED", "TYPED_MODULE_NO_DOT",
  "TI01", "TM01", "ABI_012", "ABI_012_DEFAULT", "ABI_GARBAGE_EXPORTS",
  "TI02", "TI03", "TI04", "TI05", "TI06", "TI07", "TI08", "TI09", "TI10", "TI11", "TI12", "TI13", "TI14", "TI15", "TI16", "TI17", "TI18", "TI19", "TI20",
  "TM02", "TM03", "TM04", "TM05", "TM06", "TM07", "TM08", "TM09", "TM10", "TM11", "TM12", "TM13", "CUSTOM_ENUM_CONTEXT", "RECEIPT_BINDING", "LEGACY_011"
]) assert.match(result[key], /^PASS/);
assert.strictEqual(formatV051Contract(parseV051Contract('{"z":1,"a":2}')), '{"a":2,"z":1}');
assert.deepStrictEqual(typedValue({ type: "i64", decimal: "9223372036854775807" }), { type: "i64", decimal: "9223372036854775807" });
assert.throws(() => typedValue({ type: "i64", decimal: "9223372036854775808" }));
const receipt = {
  receipt_id: `sha256:${"1".repeat(64)}`,
  decision_evidence_digest: `sha256:${"2".repeat(64)}`,
  intent_id: `sha256:${"3".repeat(64)}`,
  generation: { domain: "air.runtime", epoch: { decimal: "7", type: "i64" }, fence_id: `sha256:${"4".repeat(64)}` },
  outcome: { discriminant: 0, type: "air.host::ReceiptOutcome" },
  failure_reason: { tag: "none", type: "option<air.host::FailureReason>" },
  consumed_budgets: [],
  host_execution_id: `sha256:${"5".repeat(64)}`,
  terminal_state: { discriminant: 0, type: "air.host::TerminalState" },
  redacted_observation_refs: []
};
assert.strictEqual(createEffectReceipt(receipt).digest, digestDomain(DOMAINS.effectReceipt, receipt));
assert.notStrictEqual(createEffectReceipt(receipt).digest, digestDomain(DOMAINS.decisionEvidence, receipt));
assert.strictEqual(canonical({ b: 1, a: 2 }), '{"a":2,"b":1}');
const v051Air = parseV051Air("module exact\ncapabilities { }\nfunc run() -> i64 {\nentry:\n  %n:i64 = const.i64 9223372036854775807\n  return %n\n}\n");
assert.strictEqual(v051Air.functions[0].blocks[0].instructions[0].args[0].exactI64, "9223372036854775807");
verifyV051Air(v051Air, { library: true });
assert.match(formatV051Air(v051Air), /const.i64 9223372036854775807/);

assert.strictEqual(typedValue(42), 42);
assert.throws(() => typedValue({ decimal: "42", type: "i32" }));
assert.throws(() => typedValue({ tag: "some", type: "option<option<i32>>", value: 1 }));

const typedSource = `module example.policy

enum Admission {
  allow = 1,
  deny = 0,
}

error enum ParseError {
  malformed = 0,
}

export func decide(value: i32) -> Admission {
  return Admission.allow
}

func check_enum(value: Admission) -> i32 {
  %out: i32 = match %value {
    Admission.allow => 1,
    Admission.deny => 0,
  }
  return %out
}

func check_option(value: option<i32>) -> i32 {
  %out: i32 = match %value {
    some(item) => 1,
    none => 0,
  }
  return %out
}

func check_result(value: result<i32,ParseError>) -> i32 {
  %out: i32 = match %value {
    err(error) => 1,
    ok(item) => 0,
  }
  return %out
}
`;
const typedModule = parseV051Air(typedSource, "typed.air");
verifyV051Air(typedModule);
const typedRoundTrip = formatV051Air(typedModule);
verifyV051Air(parseV051Air(typedRoundTrip, "typed.roundtrip.air"));
assert.throws(() => verifyV051Air(parseV051Air(typedSource.replace("    some(item) => 1,\n", ""), "nonexhaustive.air")), /air\.decision\.match_nonexhaustive/);
assert.throws(() => verifyV051Air(parseV051Air(typedSource.replace("    Admission.allow => 1,", "    _ => 1,"), "wildcard.air")), /air\.decision\.match_arm_invalid/);
assert.match(typedRoundTrip, /Admission\.deny => 0,\n    Admission\.allow => 1,/);

const descriptor = {
  air_abi_lane: "0.12",
  exports: [{ function: "decide", name: "decide", parameters: [{ name: "value", type: "i32" }], return_type: "example.policy::Admission" }],
  module_id: "example.policy",
  schema: "air.typed-interface/0.12-candidate.1",
  types: [{ cases: [{ discriminant: 0, name: "deny" }, { discriminant: 1, name: "allow" }], kind: "enum", type_id: "example.policy::Admission" }]
};
assert.deepStrictEqual(validateDescriptorAgainstSource(descriptor, typedModule).module_id, "example.policy");
assert.throws(() => validateDescriptorAgainstSource({ ...descriptor, exports: [{ ...descriptor.exports[0], parameters: [{ name: "other", type: "i32" }] }] }, typedModule));
assert.throws(() => validateDescriptorAgainstSource({ ...descriptor, exports: [{ ...descriptor.exports[0], return_type: "i32" }] }, typedModule));
assert.throws(() => validateDescriptorAgainstSource({ ...descriptor, types: [{ ...descriptor.types[0], cases: [{ discriminant: 0, name: "deny" }] }] }, typedModule));

const packageDir = fs.mkdtempSync(path.join(os.tmpdir(), "air-v051-candidate-"));
try {
  fs.writeFileSync(path.join(packageDir, "policy.air"), typedSource);
  fs.writeFileSync(path.join(packageDir, "air.interface.json"), `${canonical(descriptor)}\n`);
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
      descriptorDigest: descriptorDigest(descriptor),
      entryExport: "decide",
      hostContractVersion: "air.host-contract/1.0.0-candidate.1"
    },
    version: "0.51.0"
  };
  fs.writeFileSync(path.join(packageDir, "air.package.json"), `${JSON.stringify(manifest)}\n`);
  assert.throws(() => validatePackageManifest(packageDir, { built: false }), /air\.v051\.abi_candidate_disabled/);
  const validated = validatePackageManifest(packageDir, { allowCandidateAbi012: true, built: false });
  assert.strictEqual(validated.typedInterface.descriptorDigest, descriptorDigest(descriptor));
  manifest.typedInterface.descriptorDigest = `sha256:${"0".repeat(64)}`;
  fs.writeFileSync(path.join(packageDir, "air.package.json"), `${JSON.stringify(manifest)}\n`);
  assert.throws(() => validatePackageManifest(packageDir, { allowCandidateAbi012: true, built: false }), /descriptor digest mismatch/);
} finally {
  fs.rmSync(packageDir, { force: true, recursive: true });
}
process.stdout.write(`v0.51 reference substrate: ${Object.keys(result).length} checks passed\n`);
