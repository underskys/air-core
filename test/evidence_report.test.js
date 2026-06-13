#!/usr/bin/env node

const assert = require("assert");
const cp = require("child_process");
const fs = require("fs");
const path = require("path");
const { createReplaySummary } = require("../src/evidence_report");

const root = path.resolve(__dirname, "..");
const airc = path.join(root, "bin", "airc.js");
const tmp = path.join(root, "build", "evidence-report-tests");
const pkg = path.join(root, "examples", "airops_incident_package");
const fixtureDir = path.join(root, "test", "fixtures", "evidence_report");
const goldenReportPath = path.join(fixtureDir, "airops_with_host_and_replay.golden.md");
const failedReplayGoldenPath = path.join(fixtureDir, "airops_failed_replay.golden.md");
const stateDigestConformancePath = path.join(fixtureDir, "state_digest_conformance_pass.json");
const stateDigestGoldenPath = path.join(fixtureDir, "state_digest_replay.golden.md");

fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });

function run(args, options = {}) {
  return cp.execFileSync(process.execPath, [airc, ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options
  });
}

function runStatus(args, options = {}) {
  const result = cp.spawnSync(process.execPath, [airc, ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options
  });
  return result;
}

function assertNoAbsolutePaths(text) {
  assert(!text.includes(root), "report must not include repository absolute path");
  assert(!/[A-Za-z]:[\\/]/.test(text), "report must not include Windows absolute path");
}

function assertNoTimestampFields(text) {
  assert(!/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(text), "report must not include timestamp-like values");
  assert(!/\b(timestamp|createdAt|updatedAt|generatedAt)\b/i.test(text), "report must not include timestamp fields");
}

function assertNoRawPrivatePayloads(text) {
  const forbidden = [
    "raw URL",
    "raw_url",
    "token",
    "secret",
    "private text",
    "private_text",
    "raw state values",
    "helper return dumps",
    "incident_id",
    "service_id",
    "signal_count",
    "age_minutes",
    "701, 102, 204, 100"
  ];
  for (const value of forbidden) {
    assert(!text.includes(value), `report must not include ${value}`);
  }
}

function assertPrivacySafe(text) {
  assertNoAbsolutePaths(text);
  assertNoTimestampFields(text);
  assertNoRawPrivatePayloads(text);
}

const reportPath = path.join(tmp, "airops-evidence.md");
run(["evidence", "report", pkg, "--format", "markdown", "-o", reportPath]);
const report = fs.readFileSync(reportPath, "utf8");

assert(report.startsWith("# AIR Evidence Report"));
assert(report.includes("| Package | airops-incident-canonical-example |"));
assert(report.includes("| Verification status | passed |"));
assert(report.includes("| AIR ABI | 0.10 |"));
assert(report.includes("| Required Host ABI | 0.10 |"));
assert(report.includes("## Capabilities"));
assert(report.includes("## Effects"));
assert(report.includes("cpu.instructions="));
assert(report.includes("## Output Intents"));
assert(report.includes("outputs/incident_policy.output.json"));
assert(report.includes("## Structured IO"));
assert(report.includes("No structured IO metadata was reported."));
assert(report.includes("## Host Policy Result"));
assert(report.includes("Not run."));
assert(report.includes("## Diagnostics"));
assert(report.includes("| fail | none |"));
assert(report.includes("## Generated Artifacts"));
assert(report.includes("## Privacy Boundary"));
assert(report.includes("Not run."));
assertPrivacySafe(report);

const hostPassPath = path.join(tmp, "host-pass.json");
run([
  "mock-host", pkg,
  "--policy", path.join(pkg, "host_policies", "incident_readonly.policy.json"),
  "--profile", "cli",
  "--trace", path.join(pkg, "traces", "pass.json"),
  "--json"
], { stdio: ["ignore", fs.openSync(hostPassPath, "w"), "pipe"] });

const conformancePath = path.join(tmp, "conformance.json");
run([
  "conformance", pkg,
  "--profile", "cli",
  "--trace", path.join(pkg, "traces", "pass.json"),
  "--json"
], { stdio: ["ignore", fs.openSync(conformancePath, "w"), "pipe"] });

const withEvidencePath = path.join(tmp, "with-host-and-replay.md");
run([
  "evidence", "report", pkg,
  "--format", "markdown",
  "--host-evidence", hostPassPath,
  "--conformance", conformancePath,
  "-o", withEvidencePath
]);
const withEvidence = fs.readFileSync(withEvidencePath, "utf8");
const goldenReport = fs.readFileSync(goldenReportPath, "utf8");
assert.strictEqual(withEvidence.trimEnd(), goldenReport.trimEnd(), "evidence report must match golden Markdown fixture");
assert(withEvidence.includes("| Status | passed |"));
assert(withEvidence.includes("| Allowed | 1 |"));
assert(withEvidence.includes("| Denied | 0 |"));
assert(withEvidence.includes("| Expected commands | 1 |"));
assert(withEvidence.includes("| Observed commands | 1 |"));
assert(withEvidence.includes("| Fixture | airops-incident-canonical-pass |"));
assert(withEvidence.includes("| Mismatch count | 0 |"));
assert(withEvidence.includes("| Output IDs involved | 2001 |"));
assert(withEvidence.includes("| State digest | not available |"));
assert(withEvidence.includes("| Host interaction evidence | passed |"));
assert(withEvidence.includes("Replay checksum"));
assertPrivacySafe(withEvidence);

const deniedPolicyPath = path.join(tmp, "deny.policy.json");
fs.writeFileSync(deniedPolicyPath, JSON.stringify({
  schemaVersion: "0.25",
  kind: "air.mockHostPolicy",
  id: "deny-incident-output",
  allowOutputs: [],
  denyOutputs: ["incident_policy_decision_recorded"],
  capabilities: {
    "incident.policy_decision": "denied"
  }
}, null, 2));

const hostDeniedPath = path.join(tmp, "host-denied.json");
run([
  "mock-host", pkg,
  "--policy", deniedPolicyPath,
  "--profile", "cli",
  "--trace", path.join(pkg, "traces", "pass.json"),
  "--json"
], { stdio: ["ignore", fs.openSync(hostDeniedPath, "w"), "pipe"] });

const deniedReportPath = path.join(tmp, "host-denied.md");
run([
  "evidence", "report", pkg,
  "--format", "markdown",
  "--host-evidence", hostDeniedPath,
  "-o", deniedReportPath
]);
const deniedReport = fs.readFileSync(deniedReportPath, "utf8");
assert(deniedReport.includes("| Verification status | passed |"));
assert(deniedReport.includes("| Status | passed |"));
assert(deniedReport.includes("| Allowed | 0 |"));
assert(deniedReport.includes("| Denied | 1 |"));
assert(deniedReport.includes("air.host_policy.denied_output"));
assertPrivacySafe(deniedReport);

const wrongTrace = JSON.parse(fs.readFileSync(path.join(pkg, "traces", "pass.json"), "utf8"));
wrongTrace.id = "airops-incident-canonical-wrong-output";
wrongTrace.expectedOutputs[0].id = 2999;
wrongTrace.expectedCommands[0].output_id = 2999;
const wrongTracePath = path.join(tmp, "wrong-output.json");
fs.writeFileSync(wrongTracePath, `${JSON.stringify(wrongTrace, null, 2)}\n`);

const failedConformance = runStatus([
  "conformance", pkg,
  "--profile", "cli",
  "--trace", wrongTracePath,
  "--json"
]);
assert.notStrictEqual(failedConformance.status, 0);
const failedConformancePath = path.join(tmp, "failed-conformance.json");
fs.writeFileSync(failedConformancePath, failedConformance.stdout);

const failedReplayReportPath = path.join(tmp, "failed-replay.md");
run([
  "evidence", "report", pkg,
  "--format", "markdown",
  "--conformance", failedConformancePath,
  "-o", failedReplayReportPath
]);
const failedReplayReport = fs.readFileSync(failedReplayReportPath, "utf8");
const failedReplayGolden = fs.readFileSync(failedReplayGoldenPath, "utf8");
assert.strictEqual(failedReplayReport.trimEnd(), failedReplayGolden.trimEnd(), "failing replay summary must match golden Markdown fixture");
assert(failedReplayReport.includes("| Fixture | airops-incident-canonical-wrong-output |"));
assert(failedReplayReport.includes("| Status | failed |"));
assert(failedReplayReport.includes("| Mismatch count | 3 |"));
assert(failedReplayReport.includes("| Mismatch kinds | wrong_output_count, wrong_output_id |"));
assert(failedReplayReport.includes("| Output IDs involved | 2001, 2999 |"));
assertPrivacySafe(failedReplayReport);

const stateDigestReportPath = path.join(tmp, "state-digest-replay.md");
run([
  "evidence", "report", pkg,
  "--format", "markdown",
  "--conformance", stateDigestConformancePath,
  "-o", stateDigestReportPath
]);
const stateDigestReport = fs.readFileSync(stateDigestReportPath, "utf8");
const stateDigestGolden = fs.readFileSync(stateDigestGoldenPath, "utf8");
assert.strictEqual(stateDigestReport.trimEnd(), stateDigestGolden.trimEnd(), "state digest replay summary must match golden Markdown fixture");
assert(stateDigestReport.includes("| Fixture | fixed-state-digest-pass |"));
assert(stateDigestReport.includes("| Status | passed |"));
assert(stateDigestReport.includes("| State digest | passed; expected=sha256:2222222222222222222222222222222222222222222222222222222222222222; observed=sha256:2222222222222222222222222222222222222222222222222222222222222222; helpers=4 |"));
assert(stateDigestReport.includes("| Host interaction evidence | not_run |"));
assert.strictEqual(stateDigestReport.includes("board_cell"), false);
assert.strictEqual(stateDigestReport.includes("return"), false);
assertPrivacySafe(stateDigestReport);

const stateDigestSummary = createReplaySummary({
  status: "pass",
  package: "stateful",
  trace: { id: "state-pass", kind: "air.conformance.trace" },
  replayChecksum: "sha256:abc",
  mismatches: [],
  stateDigest: {
    expected: `sha256:${"1".repeat(64)}`,
    observed: `sha256:${"1".repeat(64)}`,
    helperCount: 4,
    helpers: [{ export: "board_cell", status: "pass", return: 12 }]
  }
});
assert.strictEqual(stateDigestSummary.stateDigest.status, "passed");
assert.strictEqual(stateDigestSummary.stateDigest.helperCount, 4);
assert.strictEqual(JSON.stringify(stateDigestSummary).includes("board_cell"), false);
assert.strictEqual(JSON.stringify(stateDigestSummary).includes("return"), false);

const lanPkg = path.join(root, "examples", "lan_observer_readonly_package");
const lanTrace = path.join(lanPkg, "traces", "pass.json");
const lanPolicy = path.join(lanPkg, "host_policies", "lan_observer_readonly.policy.json");
const e2eProofPath = path.join(tmp, "lan-e2e-proof.json");
run([
  "run-proof", lanPkg,
  "--fixture", lanTrace,
  "--policy", lanPolicy,
  "--profile", "cli",
  "--json"
], { stdio: ["ignore", fs.openSync(e2eProofPath, "w"), "pipe"] });

const e2eBenchmarkPath = path.join(tmp, "lan-e2e-benchmark.json");
run([
  "benchmark", path.join(root, "benchmarks", "e2e_lan_observer_readonly_basic"),
  "--json"
], { stdio: ["ignore", fs.openSync(e2eBenchmarkPath, "w"), "pipe"] });

const e2eReportPath = path.join(tmp, "lan-e2e-evidence.md");
run([
  "evidence", "report", lanPkg,
  "--format", "markdown",
  "--e2e-proof", e2eProofPath,
  "--benchmark", e2eBenchmarkPath,
  "-o", e2eReportPath
]);
const e2eReport = fs.readFileSync(e2eReportPath, "utf8");
assert(e2eReport.includes("## End-to-End Proof"));
assert(e2eReport.includes("| Static validation | passed |"));
assert(e2eReport.includes("| Package policy validation | passed |"));
assert(e2eReport.includes("| Conformance replay | passed |"));
assert(e2eReport.includes("| Runtime execution proof | passed |"));
assert(e2eReport.includes("| Host policy simulation | passed |"));
assert(e2eReport.includes("| Output intent | 3501; args=4; commands=1 |"));
assert(e2eReport.includes("## Benchmark Summary"));
assert(e2eReport.includes("| E2E proof ms |"));
assert(e2eReport.includes("| Evidence report ms |"));
assert(e2eReport.includes("| Mock host policy ms |"));
assert(e2eReport.includes("| Output intents | 1 |"));
assert(e2eReport.includes("| Host crossings | 0 |"));
for (const forbidden of ["device_id", "latency_ms", "packet_loss_x1000", "raw_hostname", "mac_address", "ip_address"]) {
  assert(!e2eReport.includes(forbidden), `E2E evidence report must not include ${forbidden}`);
}
assertPrivacySafe(e2eReport);

console.log("evidence report tests passed");
