#!/usr/bin/env node

const assert = require("assert");
const cp = require("child_process");
const fs = require("fs");
const path = require("path");
const { AIR_ABI_VERSION } = require("../src/version");
const { HOST_ABI_VERSION } = require("../src/package_manifest");

const root = path.resolve(__dirname, "..");
const airc = path.join(root, "bin", "airc.js");
const fixture = path.join(root, "examples", "airops_incident_package");
const airopsBatchFixture = path.join(root, "test", "fixtures", "conformance_batch", "airops");
const visualFixture = path.join(root, "test", "fixtures", "host_interaction", "visual_panel");
const tmp = path.join(root, "build", "mock-host-policy-tests");

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

function copyFixture(name) {
  const dir = path.join(tmp, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.cpSync(fixture, dir, { recursive: true });
  return dir;
}

function policy(overrides = {}) {
  return {
    schemaVersion: "0.25",
    kind: "air.mockHostPolicy",
    id: "test-policy",
    allowOutputs: ["incident_policy_decision_recorded"],
    denyOutputs: [],
    capabilities: {
      "incident.policy_decision": "allowed"
    },
    ...overrides
  };
}

function runMockHost(packageDir, policyValue, extra = []) {
  const policyPath = path.join(packageDir, "mock_host.policy.json");
  writeJson(policyPath, policyValue);
  return run(["mock-host", packageDir, "--policy", policyPath, "--profile", "cli", "--json", ...extra]);
}

function runMockHostStatus(packageDir, policyValue, extra = []) {
  const policyPath = path.join(packageDir, "mock_host.policy.json");
  writeJson(policyPath, policyValue);
  return runStatus(["mock-host", packageDir, "--policy", policyPath, "--profile", "cli", "--json", ...extra]);
}

function runFixtureEvidence(packageDir, policyPath) {
  return run(["mock-host", packageDir, "--policy", policyPath, "--profile", "cli", "--json"]);
}

function assertPolicyFailsWith(name, policyValue, code) {
  const packageDir = copyFixture(name);
  const status = runMockHostStatus(packageDir, policyValue);
  assert.notStrictEqual(status.status, 0);
  const report = JSON.parse(status.stdout);
  assert.strictEqual(report.status, "failed");
  assert(report.diagnostics.some((item) => item.code === code), `${name} expected ${code}`);
  return report;
}

fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });

const airopsPolicyPath = path.join(airopsBatchFixture, "host_policies", "incident_readonly.policy.json");
const airopsExpectedPath = path.join(airopsBatchFixture, "expected", "host_interaction.evidence.json");
const airopsEvidenceFirst = runFixtureEvidence(airopsBatchFixture, airopsPolicyPath);
const airopsEvidenceSecond = runFixtureEvidence(airopsBatchFixture, airopsPolicyPath);
assert.strictEqual(airopsEvidenceFirst, airopsEvidenceSecond);
assert.strictEqual(airopsEvidenceFirst, fs.readFileSync(airopsExpectedPath, "utf8"));
const airopsEvidence = JSON.parse(airopsEvidenceFirst);
assert.strictEqual(airopsEvidence.status, "passed");
assert.strictEqual(airopsEvidence.policyId, "airops-incident-readonly");
assert.strictEqual(airopsEvidence.decisions.length, 1);
assert.strictEqual(airopsEvidence.decisions[0].decision, "allow");
assert.strictEqual(airopsEvidence.decisions[0].output, "pipeline_decision_recorded");
assert(!airopsEvidenceFirst.includes(root));
assert(!/20[0-9]{2}-[0-9]{2}-[0-9]{2}T/.test(airopsEvidenceFirst));

const visualPolicyPath = path.join(visualFixture, "host_policies", "panel_review.policy.json");
const visualExpectedPath = path.join(visualFixture, "expected", "host_interaction.evidence.json");
const visualEvidenceFirst = runFixtureEvidence(visualFixture, visualPolicyPath);
const visualEvidenceSecond = runFixtureEvidence(visualFixture, visualPolicyPath);
assert.strictEqual(visualEvidenceFirst, visualEvidenceSecond);
assert.strictEqual(visualEvidenceFirst, fs.readFileSync(visualExpectedPath, "utf8"));
const visualEvidence = JSON.parse(visualEvidenceFirst);
assert.strictEqual(visualEvidence.status, "passed");
assert.strictEqual(visualEvidence.policyId, "visual-panel-review");
assert.strictEqual(visualEvidence.commandRecords.length, 2);
assert.deepStrictEqual(visualEvidence.decisions.map((item) => item.decision), ["allow", "allow"]);
assert.deepStrictEqual(visualEvidence.decisions.map((item) => item.capability), ["visual.status_intent", "visual.attention_intent"]);
assert(!visualEvidenceFirst.includes(root));
assert(!/20[0-9]{2}-[0-9]{2}-[0-9]{2}T/.test(visualEvidenceFirst));

const visualDeniedPath = path.join(visualFixture, "host_policies", "panel_deny_attention.policy.json");
const visualDeniedExpectedPath = path.join(visualFixture, "expected", "host_interaction.denied.evidence.json");
const visualDeniedText = runFixtureEvidence(visualFixture, visualDeniedPath);
assert.strictEqual(visualDeniedText, fs.readFileSync(visualDeniedExpectedPath, "utf8"));
const visualDenied = JSON.parse(visualDeniedText);
assert.strictEqual(visualDenied.status, "passed");
assert(visualDenied.decisions.some((item) => item.output === "panel_attention_intent_recorded" && item.decision === "deny"));
assert.deepStrictEqual(visualDenied.deniedCapabilities, ["visual.attention_intent"]);
assert(visualDenied.diagnostics.some((item) => item.code === "air.host_policy.denied_output"));

const allowedPackage = copyFixture("allowed");
const allowedFirst = runMockHost(allowedPackage, policy());
const allowedSecond = runMockHost(allowedPackage, policy());
assert.strictEqual(allowedFirst, allowedSecond);
const allowed = JSON.parse(allowedFirst);
assert.strictEqual(allowed.schemaVersion, "0.25");
assert.strictEqual(allowed.kind, "air.hostInteractionEvidence");
assert.strictEqual(allowed.status, "passed");
assert.strictEqual(allowed.hostProfile, "cli");
assert.match(allowed.packageHash, /^sha256:[a-f0-9]{64}$/);
assert.match(allowed.abiHash, /^sha256:[a-f0-9]{64}$/);
assert.match(allowed.replayChecksum, /^sha256:[a-f0-9]{64}$/);
assert.strictEqual(allowed.commandRecords.length, 1);
assert.strictEqual(allowed.decisions.length, 1);
assert.strictEqual(allowed.decisions[0].decision, "allow");
assert.strictEqual(allowed.decisions[0].output, "incident_policy_decision_recorded");
assert.deepStrictEqual(allowed.deniedCapabilities, []);
assert(!allowedFirst.includes(root));
assert(!/20[0-9]{2}-[0-9]{2}-[0-9]{2}T/.test(allowedFirst));

const deniedPackage = copyFixture("denied");
const denied = JSON.parse(runMockHost(deniedPackage, policy({
  allowOutputs: [],
  denyOutputs: ["incident_policy_decision_recorded"]
})));
assert.strictEqual(denied.status, "passed");
assert.strictEqual(denied.decisions[0].decision, "deny");
assert.strictEqual(denied.decisions[0].reasonCode, "denied_output");
assert.deepStrictEqual(denied.deniedCapabilities, ["incident.policy_decision"]);
assert(denied.diagnostics.some((item) => item.code === "air.host_policy.denied_output" && item.severity === "warn"));

const unknownPackage = copyFixture("unknown-output");
const unknownCommands = JSON.parse(fs.readFileSync(path.join(unknownPackage, "outputs", "incident_policy.commands.json"), "utf8"));
unknownCommands.records[0].output_id = 9999;
writeJson(path.join(unknownPackage, "outputs", "incident_policy.commands.json"), unknownCommands);
const unknown = runMockHostStatus(unknownPackage, policy());
assert.notStrictEqual(unknown.status, 0);
const unknownReport = JSON.parse(unknown.stdout);
assert.strictEqual(unknownReport.status, "failed");
assert(unknownReport.diagnostics.some((item) => item.code === "air.host_policy.unknown_output"));

const unsupportedPackage = copyFixture("unsupported-profile");
const unsupportedPolicyPath = path.join(unsupportedPackage, "mock_host.policy.json");
writeJson(unsupportedPolicyPath, policy());
const unsupported = runStatus(["mock-host", unsupportedPackage, "--policy", unsupportedPolicyPath, "--profile", "browser-webgpu", "--json"]);
assert.notStrictEqual(unsupported.status, 0);
const unsupportedReport = JSON.parse(unsupported.stdout);
assert(unsupportedReport.diagnostics.some((item) => item.code === "air.host_policy.unsupported_profile"));

const rawPackage = copyFixture("raw-authority");
const raw = runMockHostStatus(rawPackage, policy({
  allowOutputs: ["chrome.tabs.query"]
}));
assert.notStrictEqual(raw.status, 0);
assert(JSON.parse(raw.stdout).diagnostics.some((item) => item.code === "air.host_policy.raw_authority_rejected"));

assertPolicyFailsWith("unknown-policy-field", policy({
  allowedData: { incident: 701 }
}), "air.host_policy.schema_invalid");

assertPolicyFailsWith("payload-content-policy-field", policy({
  payload_content: { incident: 701 }
}), "air.host_policy.schema_invalid");

assertPolicyFailsWith("object-allow-output", policy({
  allowOutputs: [{ name: "incident_policy_decision_recorded" }]
}), "air.host_policy.schema_invalid");

assertPolicyFailsWith("object-deny-output", policy({
  denyOutputs: [{ name: "incident_policy_decision_recorded" }]
}), "air.host_policy.schema_invalid");

assertPolicyFailsWith("object-capability-policy", policy({
  capabilities: {
    "incident.policy_decision": { mode: "allowed" }
  }
}), "air.host_policy.schema_invalid");

assertPolicyFailsWith("raw-capability-policy", policy({
  capabilities: {
    "chrome.tabs.query": "allowed"
  }
}), "air.host_policy.raw_authority_rejected");

const nondeterministicPackage = copyFixture("nondeterministic");
const nondeterministic = runMockHostStatus(nondeterministicPackage, policy({
  generatedAt: "2026-05-28T00:00:00Z",
  sourcePath: "/tmp/host-policy.json"
}));
assert.notStrictEqual(nondeterministic.status, 0);
const nondeterministicReport = JSON.parse(nondeterministic.stdout);
assert(nondeterministicReport.diagnostics.some((item) => item.code === "air.host_policy.nondeterministic_field"));

const tracePackage = copyFixture("trace-payload");
const trace = JSON.parse(fs.readFileSync(path.join(tracePackage, "traces", "pass.json"), "utf8"));
trace.observedCommands[0].payload = { action: "run" };
const tracePath = path.join(tracePackage, "traces", "bad-payload.json");
writeJson(tracePath, trace);
const tracePolicyPath = path.join(tracePackage, "mock_host.policy.json");
writeJson(tracePolicyPath, policy());
const tracePayload = runStatus(["mock-host", tracePackage, "--policy", tracePolicyPath, "--profile", "cli", "--trace", tracePath, "--json"]);
assert.notStrictEqual(tracePayload.status, 0);
assert(JSON.parse(tracePayload.stdout).diagnostics.some((item) => item.code === "air.host_policy.raw_authority_rejected"));

assert.strictEqual(AIR_ABI_VERSION, "0.10");
assert.strictEqual(HOST_ABI_VERSION, "0.10");

console.log("ok: mock host policy tests");
