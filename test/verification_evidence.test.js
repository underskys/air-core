#!/usr/bin/env node

const assert = require("assert");
const cp = require("child_process");
const fs = require("fs");
const path = require("path");
const { createNotRunVerificationEvidence } = require("../src/verification_evidence");
const { AIR_ABI_VERSION } = require("../src/version");
const { HOST_ABI_VERSION } = require("../src/package_manifest");

const root = path.resolve(__dirname, "..");
const airc = path.join(root, "bin", "airc.js");
const tmp = path.join(root, "build", "verification-evidence-tests");
const airopsPackage = path.join(root, "examples", "airops_incident_package");

function run(args) {
  return cp.execFileSync(process.execPath, [airc, ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function runStatus(args) {
  return cp.spawnSync(process.execPath, [airc, ...args], {
    cwd: root,
    encoding: "utf8"
  });
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function writeBasePackage(dir, options = {}) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, "facts"), { recursive: true });
  fs.mkdirSync(path.join(dir, "outputs"), { recursive: true });
  fs.mkdirSync(path.join(dir, "generated"), { recursive: true });
  fs.writeFileSync(path.join(dir, "main.air"), options.main || `module evidence_pkg
export func run() -> i32 {
entry:
  %zero:i32 = 0
  return %zero
}
`);
  fs.writeFileSync(path.join(dir, "generated", "facts_handles.air"), `# Generated file. Do not edit manually.
# Generator: repo:bin/airc.js
# Source: air.package.json
# Manifest fingerprint: evidence
module facts_handles
capabilities { }

export func fact_count() -> i32 {
entry:
  %one:i32 = const.i32 1
  return %one
}
`);
  writeJson(path.join(dir, "facts", "tasks.facts.json"), options.facts || {
    schemaVersion: "0.18",
    privacyPolicy: {
      defaultClassification: "minimized",
      forbiddenByDefault: ["raw_text", "raw_url", "secret", "token"]
    },
    facts: [{
      id: 1,
      name: "task_summary",
      maxRows: 8,
      privacy: "minimized",
      columns: [
        { name: "task_id", type: "i32" },
        { name: "blocked", type: "bool", privacy: "public" }
      ]
    }]
  });
  writeJson(path.join(dir, "outputs", "main.output.json"), options.outputContract || {
    schemaVersion: "0.18",
    kind: "air.outputContract",
    outputs: [{
      id: 1,
      name: "priority_alert_requested",
      channel: "notification",
      capability: "notify.request",
      args: [
        { name: "task_id", type: "i32" },
        { name: "severity", type: "i32" }
      ],
      resources: [],
      profileConstraints: []
    }]
  });
  writeJson(path.join(dir, "air.package.json"), {
    name: options.name || "verification-evidence-package",
    version: "0.1.0",
    airAbi: "0.10",
    hostAbi: "0.10",
    entry: "main.air",
    capabilities: [],
    targetProfiles: ["cli"],
    generatedModules: ["generated/facts_handles.air"],
    factSchemas: ["facts/tasks.facts.json"],
    outputContracts: ["outputs/main.output.json"]
  });
}

function walk(value, fn, key = null) {
  fn(value, key);
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, fn, String(index)));
  } else if (value && typeof value === "object") {
    for (const childKey of Object.keys(value)) walk(value[childKey], fn, childKey);
  }
}

function assertNoAbsolutePaths(value) {
  const offenders = [];
  walk(value, (item) => {
    if (typeof item === "string" && (item.startsWith("/") || /^[A-Za-z]:[\\/]/.test(item))) offenders.push(item);
  });
  assert.deepStrictEqual(offenders, []);
}

function assertNoTimestampLikeFields(value) {
  const offenders = [];
  walk(value, (_item, key) => {
    if (key && /timestamp|createdAt|updatedAt|generatedAt/i.test(key)) offenders.push(key);
  });
  assert.deepStrictEqual(offenders, []);
}

fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });

const validPackage = path.join(tmp, "valid");
writeBasePackage(validPackage);
const validEvidence = JSON.parse(run(["verify", "package", validPackage, "--profile", "cli", "--json"]));
const validEvidenceAgain = JSON.parse(run(["verify", "package", validPackage, "--profile", "cli", "--json"]));
assert.deepStrictEqual(validEvidenceAgain, validEvidence);
assert.strictEqual(validEvidence.schemaVersion, "0.20");
assert.strictEqual(validEvidence.kind, "air.verificationEvidence");
assert.strictEqual(validEvidence.status, "passed");
assert.strictEqual(validEvidence.compilerVersion, "0.44.2");
assert.strictEqual(validEvidence.airAbi, "0.10");
assert.strictEqual(validEvidence.hostAbi, "0.10");
assert.strictEqual(validEvidence.packageName, "verification-evidence-package");
assert.strictEqual(validEvidence.packageId, "verification-evidence-package");
assert.strictEqual(validEvidence.profile, "cli");
assert.match(validEvidence.packageHash, /^sha256:[a-f0-9]{64}$/);
assert.match(validEvidence.abiHash, /^sha256:[a-f0-9]{64}$/);
assert.strictEqual(validEvidence.modules[0].path, "main.air");
assert.strictEqual(validEvidence.modules[0].status, "checked");
assert.deepStrictEqual(validEvidence.modules[0].imports, []);
assert.deepStrictEqual(validEvidence.modules[0].diagnostics, []);
assert.strictEqual(validEvidence.factSchemas.length, 1);
assert.match(validEvidence.factSchemas[0].fingerprint, /^sha256:[a-f0-9]{64}$/);
assert.strictEqual(validEvidence.factSchemas[0].hash, validEvidence.factSchemas[0].fingerprint);
assert.strictEqual(validEvidence.factSchemas[0].status, "passed");
assert.deepStrictEqual(validEvidence.factSchemas[0].diagnostics, []);
assert.strictEqual(validEvidence.outputContracts.length, 1);
assert.match(validEvidence.outputContracts[0].fingerprint, /^sha256:[a-f0-9]{64}$/);
assert.strictEqual(validEvidence.outputContracts[0].hash, validEvidence.outputContracts[0].fingerprint);
assert.strictEqual(validEvidence.outputContracts[0].status, "passed");
assert.deepStrictEqual(validEvidence.outputContracts[0].diagnostics, []);
assert(validEvidence.generatedArtifacts.some((item) => item.kind === "generatedArtifacts" && item.path === "generated/facts_handles.air" && item.sourceManifests.some((source) => source.path === "air.package.json")));
assert.strictEqual(validEvidence.profileCompatibility.status, "pass");
assert.strictEqual(validEvidence.profileCompatibility.requiredHostAbi, "0.10");
assert.strictEqual(validEvidence.profileCompatibility.supportedHostAbi, "0.10");
assert.deepStrictEqual(validEvidence.errors, []);
assertNoAbsolutePaths(validEvidence);
assertNoTimestampLikeFields(validEvidence);

const hostPolicy = path.join(airopsPackage, "host_policies", "incident_readonly.policy.json");
const hostEvidencePath = path.join(tmp, "airops-host-interaction.evidence.json");
fs.writeFileSync(hostEvidencePath, run(["mock-host", airopsPackage, "--policy", hostPolicy, "--profile", "cli", "--json"]));
const withHostEvidenceFirst = run(["verify", "package", airopsPackage, "--profile", "cli", "--host-evidence", hostEvidencePath, "--json"]);
const withHostEvidenceSecond = run(["verify", "package", airopsPackage, "--profile", "cli", "--host-evidence", hostEvidencePath, "--json"]);
assert.strictEqual(withHostEvidenceSecond, withHostEvidenceFirst);
const withHostEvidence = JSON.parse(withHostEvidenceFirst);
assert.strictEqual(withHostEvidence.status, "passed");
assert.deepStrictEqual(withHostEvidence.hostInteractionEvidence, {
  decisions: [{
    capability: "incident.policy_decision",
    decision: "allow",
    output: "incident_policy_decision_recorded",
    output_id: 2001,
    reasonCode: "allowed",
    statusCode: null
  }],
  decisionsCount: 1,
  deniedCapabilitiesCount: 0,
  diagnosticsCount: 0,
  hostProfile: "cli",
  policyId: "incident-readonly",
  replayChecksum: JSON.parse(fs.readFileSync(hostEvidencePath, "utf8")).replayChecksum,
  status: "passed"
});
assertNoAbsolutePaths(withHostEvidence);
assertNoTimestampLikeFields(withHostEvidence);

const denyPolicyPath = path.join(tmp, "airops-deny.policy.json");
writeJson(denyPolicyPath, {
  schemaVersion: "0.25",
  kind: "air.mockHostPolicy",
  id: "incident-deny",
  allowOutputs: [],
  denyOutputs: ["incident_policy_decision_recorded"],
  capabilities: {
    "incident.policy_decision": "forbidden"
  }
});
const deniedHostEvidencePath = path.join(tmp, "airops-host-denied.evidence.json");
fs.writeFileSync(deniedHostEvidencePath, run(["mock-host", airopsPackage, "--policy", denyPolicyPath, "--profile", "cli", "--json"]));
const deniedHostEvidence = JSON.parse(fs.readFileSync(deniedHostEvidencePath, "utf8"));
assert.strictEqual(deniedHostEvidence.status, "passed");
assert.deepStrictEqual(deniedHostEvidence.deniedCapabilities, ["incident.policy_decision"]);
const deniedSummaryEvidence = JSON.parse(run(["verify", "package", airopsPackage, "--profile", "cli", "--host-evidence", deniedHostEvidencePath, "--json"]));
assert.strictEqual(deniedSummaryEvidence.status, "passed");
assert.strictEqual(deniedSummaryEvidence.hostInteractionEvidence.deniedCapabilitiesCount, 1);
assert.strictEqual(deniedSummaryEvidence.hostInteractionEvidence.diagnosticsCount, 1);

const failedHostEvidencePath = path.join(tmp, "airops-host-failed.evidence.json");
const failedHostEvidence = {
  ...deniedHostEvidence,
  status: "failed",
  diagnostics: deniedHostEvidence.diagnostics.concat([{
    code: "air.host_policy.unknown_output",
    severity: "fail",
    source: "mock-host",
    message: "synthetic failed host policy",
    fields: {}
  }])
};
writeJson(failedHostEvidencePath, failedHostEvidence);
const failedHostStatus = runStatus(["verify", "package", airopsPackage, "--profile", "cli", "--host-evidence", failedHostEvidencePath, "--json"]);
assert.notStrictEqual(failedHostStatus.status, 0);
const failedHostSummary = JSON.parse(failedHostStatus.stdout);
assert.strictEqual(failedHostSummary.status, "failed");
assert.strictEqual(failedHostSummary.hostInteractionEvidence.status, "failed");
assert(failedHostSummary.diagnostics.some((diagnostic) => diagnostic.code === "air.host_interaction.policy_failed"));

const invalidPackage = path.join(tmp, "invalid");
writeBasePackage(invalidPackage, {
  main: `module bad_evidence_pkg
table status_ids:u8 = [1, 300]

export func run() -> i32 {
entry:
  %zero:i32 = 0
  return %zero
}
`
});
const invalidStatus = runStatus(["verify", "package", invalidPackage, "--profile", "cli", "--json"]);
assert.notStrictEqual(invalidStatus.status, 0);
const invalidEvidence = JSON.parse(invalidStatus.stdout);
assert.strictEqual(invalidEvidence.status, "failed");
assert.strictEqual(invalidEvidence.failingCommand, "airc verify package build/verification-evidence-tests/invalid --json --profile cli");
assert.strictEqual(invalidEvidence.failingModule, "main.air");
assert(invalidEvidence.diagnostics.some((diagnostic) => diagnostic.code === "air.table.value_out_of_range"));
assert(invalidEvidence.modules[0].diagnostics.some((diagnostic) => diagnostic.code === "air.table.value_out_of_range"));
assertNoAbsolutePaths(invalidEvidence);
assertNoTimestampLikeFields(invalidEvidence);

const notRun = createNotRunVerificationEvidence({
  package: "queued-package",
  profile: "cli",
  reason: "deferred by scheduler"
});
const notRunAgain = createNotRunVerificationEvidence({
  package: "queued-package",
  profile: "cli",
  reason: "deferred by scheduler"
});
assert.deepStrictEqual(notRunAgain, notRun);
assert.strictEqual(notRun.status, "not_run");
assert.strictEqual(notRun.kind, "air.verificationEvidence");
assert.strictEqual(notRun.package, "queued-package");
assert.strictEqual(notRun.packageName, "queued-package");
assert.strictEqual(notRun.packageId, "queued-package");
assert.strictEqual(notRun.profile, "cli");
assert.strictEqual(notRun.profileCompatibility.status, "not_run");
assert(notRun.diagnostics.some((diagnostic) => diagnostic.code === "air.package.verification_not_run"));
assertNoAbsolutePaths(notRun);
assertNoTimestampLikeFields(notRun);

assert.strictEqual(AIR_ABI_VERSION, "0.10");
assert.strictEqual(HOST_ABI_VERSION, "0.10");

console.log("ok: verification evidence tests");
