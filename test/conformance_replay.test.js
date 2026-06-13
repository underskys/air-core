#!/usr/bin/env node

const assert = require("assert");
const cp = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const airc = path.join(root, "bin", "airc.js");
const fixture = path.join(root, "test", "fixtures", "conformance_policy");
const stateFixture = path.join(root, "test", "fixtures", "conformance_state");
const batchFixtures = path.join(root, "test", "fixtures", "conformance_batch");
const packageCompositionFixtures = path.join(root, "test", "fixtures", "package_composition");
const tmp = path.join(root, "build", "conformance-replay-tests");

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
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });

const packageDir = path.join(tmp, "package");
fs.cpSync(fixture, packageDir, { recursive: true });
run(["build", path.join(packageDir, "module.air"), "--emit", "wasm", "-o", path.join(packageDir, "module.wasm")]);

const trace = path.join(packageDir, "traces", "basic.json");
const first = run(["conformance", packageDir, "--profile", "cli", "--trace", trace, "--json"]);
const second = run(["conformance", packageDir, "--profile", "cli", "--trace", trace, "--json"]);
assert.strictEqual(first, second);

const report = JSON.parse(first);
assert.strictEqual(report.schemaVersion, "0.16");
assert.strictEqual(report.kind, "air.conformance.report");
assert.strictEqual(report.package, "conformance-policy-fixture");
assert.strictEqual(report.profile, "cli");
assert.strictEqual(report.status, "pass");
assert.match(report.trace.fingerprint, /^sha256:[a-f0-9]{64}$/);
assert.deepStrictEqual(report.mismatches, []);
assert(report.steps.some((step) => step.id === "policy-score" && step.observed.return === 15));
assert(!JSON.stringify(report).includes(root));

const wrongTrace = JSON.parse(fs.readFileSync(trace, "utf8"));
wrongTrace.id = "policy-wrong-output";
wrongTrace.steps[1].expect.return = 99;
const wrongTracePath = path.join(tmp, "wrong.json");
writeJson(wrongTracePath, wrongTrace);
const wrong = runStatus(["conformance", packageDir, "--profile", "cli", "--trace", wrongTracePath, "--json"]);
assert.notStrictEqual(wrong.status, 0);
const wrongReport = JSON.parse(wrong.stdout);
assert.strictEqual(wrongReport.status, "fail");
assert(wrongReport.mismatches.some((item) => item.kind === "return" && item.expected === 99 && item.actual === 15));

const statePackageDir = path.join(tmp, "state-package");
fs.cpSync(stateFixture, statePackageDir, { recursive: true });
run(["build", path.join(statePackageDir, "module.air"), "--emit", "wasm", "-o", path.join(statePackageDir, "module.wasm")]);
const stateTrace = path.join(statePackageDir, "traces", "pass.json");
const stateFirst = run(["conformance", statePackageDir, "--profile", "cli", "--trace", stateTrace, "--json"]);
const stateSecond = run(["conformance", statePackageDir, "--profile", "cli", "--trace", stateTrace, "--json"]);
assert.strictEqual(stateFirst, stateSecond);
const stateReport = JSON.parse(stateFirst);
assert.strictEqual(stateReport.status, "pass");
assert.strictEqual(stateReport.package, "fixed-state-conformance-fixture");
assert.match(stateReport.stateDigest.observed, /^sha256:[a-f0-9]{64}$/);
assert.strictEqual(stateReport.stateDigest.expected, stateReport.stateDigest.observed);
assert.strictEqual(stateReport.stateDigest.helperCount, 4);
assert.strictEqual(stateReport.stateDigest.helpers[2].export, "board_cell");
assert.strictEqual("return" in stateReport.stateDigest.helpers[2], false);
assert.deepStrictEqual(stateReport.mismatches, []);
assert(!JSON.stringify(stateReport).includes(root));

const wrongStateTrace = JSON.parse(fs.readFileSync(stateTrace, "utf8"));
wrongStateTrace.id = "fixed-state-digest-wrong";
wrongStateTrace.stateDigest.expected = "sha256:0000000000000000000000000000000000000000000000000000000000000000";
const wrongStateTracePath = path.join(tmp, "wrong-state-digest.json");
writeJson(wrongStateTracePath, wrongStateTrace);
const wrongState = runStatus(["conformance", statePackageDir, "--profile", "cli", "--trace", wrongStateTracePath, "--json"]);
assert.notStrictEqual(wrongState.status, 0);
const wrongStateReport = JSON.parse(wrongState.stdout);
assert.strictEqual(wrongStateReport.status, "fail");
assert(wrongStateReport.mismatches.some((item) => item.kind === "state_digest" && item.code === "air.conformance.state_digest_mismatch"));

const unsafeStateTrace = JSON.parse(fs.readFileSync(stateTrace, "utf8"));
unsafeStateTrace.id = "fixed-state-digest-unsafe-helper";
unsafeStateTrace.stateDigest.helpers = [
  { export: "unsafe_digest_helper", args: [0] }
];
delete unsafeStateTrace.stateDigest.expected;
const unsafeStateTracePath = path.join(tmp, "unsafe-state-digest-helper.json");
writeJson(unsafeStateTracePath, unsafeStateTrace);
const unsafeState = runStatus(["conformance", statePackageDir, "--profile", "cli", "--trace", unsafeStateTracePath, "--json"]);
assert.notStrictEqual(unsafeState.status, 0);
const unsafeStateReport = JSON.parse(unsafeState.stdout);
assert.strictEqual(unsafeStateReport.status, "fail");
assert(unsafeStateReport.mismatches.some((item) =>
  item.kind === "state_digest_helper" &&
  item.code === "air.conformance.state_digest_helper_not_observation_safe" &&
  item.reason === "state_write"));
assert.strictEqual(unsafeStateReport.stateDigest.helpers[0].status, "fail");

const unsupportedTrace = JSON.parse(fs.readFileSync(trace, "utf8"));
unsupportedTrace.id = "policy-unsupported-profile";
unsupportedTrace.profile = "browser-webgpu";
const unsupportedTracePath = path.join(tmp, "unsupported-profile.json");
writeJson(unsupportedTracePath, unsupportedTrace);
const unsupported = runStatus(["conformance", packageDir, "--profile", "browser-webgpu", "--trace", unsupportedTracePath, "--json"]);
assert.notStrictEqual(unsupported.status, 0);
const unsupportedReport = JSON.parse(unsupported.stdout);
assert.strictEqual(unsupportedReport.status, "fail");
assert.strictEqual(unsupportedReport.unsupported.profile, true);
assert(unsupportedReport.mismatches.some((item) => /target profile browser-webgpu/.test(item.message)));

const compositionPackageDir = path.join(tmp, "package-composition");
fs.cpSync(path.join(packageCompositionFixtures, "conformance_multi_module"), compositionPackageDir, { recursive: true });
run(["build", "package", compositionPackageDir, "--linked-wasm", "--profile", "cli", "-o", path.join(compositionPackageDir, "linked.wasm")]);
const compositionTrace = path.join(compositionPackageDir, "traces", "pass.json");
const compositionFirst = run(["conformance", compositionPackageDir, "--profile", "cli", "--trace", compositionTrace, "--json"]);
const compositionSecond = run(["conformance", compositionPackageDir, "--profile", "cli", "--trace", compositionTrace, "--json"]);
assert.strictEqual(compositionFirst, compositionSecond);
const compositionReport = JSON.parse(compositionFirst);
assert.strictEqual(compositionReport.status, "pass");
assert.strictEqual(compositionReport.package, "package-composition-conformance");
assert(compositionReport.steps.some((step) => step.id === "linked-run" && step.observed.return === 9));
assert.deepStrictEqual(compositionReport.mismatches, []);
assert(!JSON.stringify(compositionReport).includes(root));

const flowdesk = path.join(batchFixtures, "flowdesk");
const flowdeskTrace = path.join(flowdesk, "traces", "pass.json");
const flowdeskFirst = run(["conformance", flowdesk, "--profile", "cli", "--trace", flowdeskTrace, "--json"]);
const flowdeskSecond = run(["conformance", flowdesk, "--profile", "cli", "--trace", flowdeskTrace, "--json"]);
assert.strictEqual(flowdeskFirst, flowdeskSecond);
const flowdeskReport = JSON.parse(flowdeskFirst);
assert.strictEqual(flowdeskReport.schemaVersion, "0.20");
assert.strictEqual(flowdeskReport.kind, "air.conformance.report");
assert.strictEqual(flowdeskReport.mode, "batch");
assert.strictEqual(flowdeskReport.package, "flowdesk-batch-conformance-fixture");
assert.strictEqual(flowdeskReport.status, "pass");
assert.match(flowdeskReport.trace.fingerprint, /^sha256:[a-f0-9]{64}$/);
assert.match(flowdeskReport.replayChecksum, /^sha256:[a-f0-9]{64}$/);
assert.strictEqual(flowdeskReport.rowsets[0].name, "task_summary");
assert.strictEqual(flowdeskReport.rowsets[0].rowCount, 2);
assert.strictEqual(flowdeskReport.outputs.expectedCount, 1);
assert.strictEqual(flowdeskReport.outputs.observed[0].id, 1001);
assert.deepStrictEqual(flowdeskReport.mismatches, []);
assert(!JSON.stringify(flowdeskReport).includes(root));

const airops = path.join(batchFixtures, "airops");
const airopsTrace = path.join(airops, "traces", "pass.json");
const airopsReport = JSON.parse(run(["conformance", airops, "--profile", "cli", "--trace", airopsTrace, "--json"]));
assert.strictEqual(airopsReport.status, "pass");
assert.strictEqual(airopsReport.rowsets[0].name, "incident_observation");
assert.strictEqual(airopsReport.outputs.observed[0].channel, "pipeline");

const airopsExample = path.join(root, "examples", "airops_incident_package");
const airopsExampleTrace = path.join(airopsExample, "traces", "pass.json");
const airopsExampleFirst = run(["conformance", airopsExample, "--profile", "cli", "--trace", airopsExampleTrace, "--json"]);
const airopsExampleSecond = run(["conformance", airopsExample, "--profile", "cli", "--trace", airopsExampleTrace, "--json"]);
assert.strictEqual(airopsExampleFirst, airopsExampleSecond);
const airopsExampleReport = JSON.parse(airopsExampleFirst);
assert.strictEqual(airopsExampleReport.status, "pass");
assert.strictEqual(airopsExampleReport.package, "airops-incident-canonical-example");
assert.strictEqual(airopsExampleReport.rowsets[0].name, "incident_observation");
assert.strictEqual(airopsExampleReport.commands.observed[0].arg1, 102);
assert.strictEqual(airopsExampleReport.commands.observed[0].arg2, 204);
assert.strictEqual(airopsExampleReport.commands.observed[0].arg3, 100);
assert.deepStrictEqual(airopsExampleReport.mismatches, []);
assert(!JSON.stringify(airopsExampleReport).includes(root));

const wrongBatchTrace = JSON.parse(fs.readFileSync(flowdeskTrace, "utf8"));
wrongBatchTrace.id = "flowdesk-wrong-output";
wrongBatchTrace.expectedOutputs[0].id = 1999;
wrongBatchTrace.expectedOutputs[0].args = [101, 2, 1];
const wrongBatchTracePath = path.join(tmp, "wrong-batch-output.json");
writeJson(wrongBatchTracePath, wrongBatchTrace);
const wrongBatch = runStatus(["conformance", flowdesk, "--profile", "cli", "--trace", wrongBatchTracePath, "--json"]);
assert.notStrictEqual(wrongBatch.status, 0);
const wrongBatchReport = JSON.parse(wrongBatch.stdout);
assert.strictEqual(wrongBatchReport.status, "fail");
assert(wrongBatchReport.mismatches.some((item) => item.kind === "wrong_output_id" && item.expected === 1999 && item.actual === 1001));
assert(wrongBatchReport.mismatches.some((item) => item.kind === "wrong_args"));

const rowBoundTrace = JSON.parse(fs.readFileSync(flowdeskTrace, "utf8"));
rowBoundTrace.id = "flowdesk-row-bound-exceeded";
rowBoundTrace.rowsets[0].rows = [
  { task_id: 101, status_id: 2, priority: 95, flags: 1 },
  { task_id: 102, status_id: 1, priority: 20, flags: 0 },
  { task_id: 103, status_id: 1, priority: 30, flags: 0 },
  { task_id: 104, status_id: 1, priority: 40, flags: 0 },
  { task_id: 105, status_id: 1, priority: 50, flags: 0 }
];
const rowBoundTracePath = path.join(tmp, "row-bound.json");
writeJson(rowBoundTracePath, rowBoundTrace);
const rowBound = runStatus(["conformance", flowdesk, "--profile", "cli", "--trace", rowBoundTracePath, "--json"]);
assert.notStrictEqual(rowBound.status, 0);
const rowBoundReport = JSON.parse(rowBound.stdout);
assert(rowBoundReport.mismatches.some((item) => item.kind === "row_bound_exceeded" && item.rowCount === 5 && item.maxRows === 4));

const privacyTrace = JSON.parse(fs.readFileSync(flowdeskTrace, "utf8"));
privacyTrace.id = "flowdesk-privacy-leak";
privacyTrace.rowsets[0].rows[0].raw_url = 1;
const privacyTracePath = path.join(tmp, "privacy-leak.json");
writeJson(privacyTracePath, privacyTrace);
const privacy = runStatus(["conformance", flowdesk, "--profile", "cli", "--trace", privacyTracePath, "--json"]);
assert.notStrictEqual(privacy.status, 0);
const privacyReport = JSON.parse(privacy.stdout);
assert(privacyReport.mismatches.some((item) => item.kind === "privacy_leak"));

const unsupportedBatchTrace = JSON.parse(fs.readFileSync(flowdeskTrace, "utf8"));
unsupportedBatchTrace.id = "flowdesk-unsupported-profile";
unsupportedBatchTrace.profile = "browser-webgpu";
const unsupportedBatchPath = path.join(tmp, "unsupported-batch-profile.json");
writeJson(unsupportedBatchPath, unsupportedBatchTrace);
const unsupportedBatch = runStatus(["conformance", flowdesk, "--profile", "browser-webgpu", "--trace", unsupportedBatchPath, "--json"]);
assert.notStrictEqual(unsupportedBatch.status, 0);
const unsupportedBatchReport = JSON.parse(unsupportedBatch.stdout);
assert.strictEqual(unsupportedBatchReport.unsupported.profile, true);
assert(unsupportedBatchReport.mismatches.some((item) => item.kind === "unsupported_profile"));

console.log("ok: conformance replay tests");
