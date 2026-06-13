#!/usr/bin/env node

const assert = require("assert");
const cp = require("child_process");
const fs = require("fs");
const path = require("path");
const { AIR_ABI_VERSION } = require("../src/version");

const root = path.resolve(__dirname, "..");
const airc = path.join(root, "bin", "airc.js");
const pkg = path.join(root, "examples", "lan_observer_readonly_package");
const trace = path.join(pkg, "traces", "pass.json");
const policy = path.join(pkg, "host_policies", "lan_observer_readonly.policy.json");
const tmp = path.join(root, "build", "e2e-proof-tests");

fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });

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
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function walk(value, fn) {
  fn(value);
  if (Array.isArray(value)) value.forEach((item) => walk(item, fn));
  else if (value && typeof value === "object") Object.keys(value).forEach((key) => walk(value[key], fn));
}

function assertNoAbsolutePaths(value) {
  const offenders = [];
  walk(value, (item) => {
    if (typeof item === "string" && (item.startsWith(root) || /^[A-Za-z]:[\\/]/.test(item))) offenders.push(item);
  });
  assert.deepStrictEqual(offenders, []);
}

function assertNoTimestamps(value) {
  const serialized = JSON.stringify(value);
  assert(!/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(serialized));
  assert(!/\b(timestamp|createdAt|updatedAt|generatedAt)\b/i.test(serialized));
}

function assertNoRawPrivateFacts(value) {
  const serialized = JSON.stringify(value);
  for (const forbidden of ["device_id", "latency_ms", "packet_loss_x1000", "raw_hostname", "mac_address", "ip_address", "secret", "token"]) {
    assert(!serialized.includes(forbidden), `E2E proof report must not include ${forbidden}`);
  }
}

const first = JSON.parse(run(["run-proof", pkg, "--fixture", trace, "--policy", policy, "--profile", "cli", "--json"]));
const second = JSON.parse(run(["run-proof", pkg, "--fixture", trace, "--policy", policy, "--profile", "cli", "--json"]));
assert.deepStrictEqual(first, second, "E2E proof report must be deterministic");
assert.strictEqual(first.schemaVersion, "0.38");
assert.strictEqual(first.kind, "air.e2eProofReport");
assert.strictEqual(first.status, "passed");
assert.strictEqual(first.airAbi, AIR_ABI_VERSION);
assert.strictEqual(first.requiredHostAbi, "0.10");
assert.strictEqual(first.fixtureId, "lan-observer-readonly-pass");
assert.strictEqual(first.executionProof.status, "passed");
assert.strictEqual(first.executionProof.outputIntentCount, 1);
assert.strictEqual(first.outputIntent.id, 3501);
assert.strictEqual(first.outputIntent.argCount, 4);
assert.strictEqual(first.hostDecision.decision, "allow");
assert.strictEqual(first.hostDecision.reasonCode, "allowed");
assert(first.evidenceReport.sections.some((section) => section.name === "runtime execution proof" && section.status === "passed"));
assert(first.evidenceReport.sections.some((section) => section.name === "host policy simulation" && section.status === "passed"));
assertNoAbsolutePaths(first);
assertNoTimestamps(first);
assertNoRawPrivateFacts(first);

const wrongTrace = JSON.parse(fs.readFileSync(trace, "utf8"));
wrongTrace.id = "lan-observer-readonly-wrong-output";
wrongTrace.expectedOutputs[0].args[0] = 304;
wrongTrace.expectedCommands[0].arg0 = 304;
const wrongTracePath = path.join(tmp, "wrong-output.json");
fs.writeFileSync(wrongTracePath, `${JSON.stringify(wrongTrace, null, 2)}\n`);
const mismatch = runStatus(["run-proof", pkg, "--fixture", wrongTracePath, "--policy", policy, "--profile", "cli", "--json"]);
assert.notStrictEqual(mismatch.status, 0);
const mismatchReport = JSON.parse(mismatch.stdout);
assert.strictEqual(mismatchReport.status, "failed");
assert.strictEqual(mismatchReport.executionProof.status, "failed");
assert(mismatchReport.diagnostics.some((item) => item.code === "air.e2e_proof.output_mismatch"));
assert(mismatchReport.diagnostics.some((item) => item.code === "air.e2e_proof.command_mismatch"));
assertNoAbsolutePaths(mismatchReport);
assertNoTimestamps(mismatchReport);
assertNoRawPrivateFacts(mismatchReport);

const denyPolicyPath = path.join(tmp, "deny.policy.json");
fs.writeFileSync(denyPolicyPath, `${JSON.stringify({
  schemaVersion: "0.25",
  kind: "air.mockHostPolicy",
  id: "lan-observer-readonly-deny",
  allowOutputs: [],
  denyOutputs: ["lan_observer_diagnosis_recorded"],
  capabilities: {
    "lan_observer.readonly_diagnosis": "denied"
  }
}, null, 2)}\n`);
const denied = JSON.parse(run(["run-proof", pkg, "--fixture", trace, "--policy", denyPolicyPath, "--profile", "cli", "--json"]));
assert.strictEqual(denied.status, "passed");
assert.strictEqual(denied.hostDecision.decision, "deny");
assert.strictEqual(denied.hostDecision.reasonCode, "denied_output");
assertNoRawPrivateFacts(denied);

const unknownTrace = JSON.parse(fs.readFileSync(trace, "utf8"));
unknownTrace.id = "lan-observer-readonly-unknown-output";
unknownTrace.expectedOutputs[0].id = 9999;
unknownTrace.expectedCommands[0].output_id = 9999;
const unknownTracePath = path.join(tmp, "unknown-output.json");
fs.writeFileSync(unknownTracePath, `${JSON.stringify(unknownTrace, null, 2)}\n`);
const unknown = runStatus(["run-proof", pkg, "--fixture", unknownTracePath, "--policy", policy, "--profile", "cli", "--json"]);
assert.notStrictEqual(unknown.status, 0);
const unknownReport = JSON.parse(unknown.stdout);
assert.strictEqual(unknownReport.status, "failed");
assert(unknownReport.diagnostics.some((item) => item.code === "air.e2e_proof.output_contract_missing" || item.code === "air.e2e_proof.output_mismatch"));
assertNoAbsolutePaths(unknownReport);
assertNoTimestamps(unknownReport);

console.log("E2E proof tests passed");
