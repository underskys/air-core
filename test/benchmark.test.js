#!/usr/bin/env node

const assert = require("assert");
const cp = require("child_process");
const fs = require("fs");
const path = require("path");
const { AIR_ABI_VERSION } = require("../src/version");

const root = path.resolve(__dirname, "..");
const airc = path.join(root, "bin", "airc.js");
const benchmarks = path.join(root, "benchmarks");

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
    if (typeof item === "string" && (item.startsWith(root) || /^[A-Za-z]:[\\/]/.test(item))) offenders.push(item);
  });
  assert.deepStrictEqual(offenders, []);
}

function assertMetricKeys(report) {
  assert.deepStrictEqual(Object.keys(report.metrics), [
    "commandBufferRecordCount",
    "conformanceReplayMs",
    "e2eProofMs",
    "evidenceMs",
    "evidenceReportMs",
    "hostCrossings",
    "mockHostPolicyMs",
    "outputEmitCount",
    "outputIntentCount",
    "packageCheckMs",
    "packageSizeBytes",
    "reportMs",
    "verifierMs",
    "wasmBuildMs",
    "wasmExecutionMs",
    "wasmSizeBytes"
  ]);
}

function assertBenchmarkReport(report, id) {
  assert.strictEqual(report.schemaVersion, "0.29");
  assert.strictEqual(report.kind, "air.benchmarkReport");
  assert.strictEqual(report.status, "pass");
  assert.strictEqual(report.benchmarkId, id);
  assert.match(report.packageHash, /^sha256:[a-f0-9]{64}$/);
  assert.strictEqual(report.airAbi, AIR_ABI_VERSION);
  assert(report.hostAbi === "0.10" || report.hostAbi === "0.11");
  assertMetricKeys(report);
  assert(Number.isInteger(report.metrics.packageCheckMs));
  assert(Number.isInteger(report.metrics.reportMs));
  assert(Number.isInteger(report.metrics.evidenceMs));
  assert(Number.isInteger(report.metrics.verifierMs));
  assert(Number.isInteger(report.metrics.packageSizeBytes));
  assert(Array.isArray(report.diagnostics));
  assert(Array.isArray(report.limitations));
  assertNoAbsolutePaths(report);
}

const fixed = JSON.parse(run(["benchmark", path.join(benchmarks, "fixed_state_basic"), "--json"]));
assertBenchmarkReport(fixed, "fixed_state_basic");
assert(Number.isInteger(fixed.metrics.wasmBuildMs));
assert(Number.isInteger(fixed.metrics.wasmExecutionMs));
assert(Number.isInteger(fixed.metrics.wasmSizeBytes));
assert(Number.isInteger(fixed.metrics.conformanceReplayMs));

const outputEmit = JSON.parse(run(["benchmark", path.join(benchmarks, "output_emit_basic"), "--json"]));
assertBenchmarkReport(outputEmit, "output_emit_basic");
assert.strictEqual(outputEmit.hostAbi, "0.11");
assert.strictEqual(outputEmit.metrics.outputEmitCount, 1);
assert.strictEqual(outputEmit.metrics.hostCrossings, 1);

const commandBuffer = JSON.parse(run(["benchmark", path.join(benchmarks, "command_buffer_basic"), "--json"]));
assertBenchmarkReport(commandBuffer, "command_buffer_basic");
assert.strictEqual(commandBuffer.metrics.commandBufferRecordCount, 1);
assert(Number.isInteger(commandBuffer.metrics.conformanceReplayMs));
assert(commandBuffer.limitations.some((item) => /wasmExecutionMs unavailable/.test(item)));

const airOps = JSON.parse(run(["benchmark", path.join(benchmarks, "air_ops_decision_basic"), "--json"]));
assertBenchmarkReport(airOps, "air_ops_decision_basic");
assert.strictEqual(airOps.metrics.commandBufferRecordCount, 1);

const flowdesk = JSON.parse(run(["benchmark", path.join(benchmarks, "flowdesk_policy_basic"), "--json"]));
assertBenchmarkReport(flowdesk, "flowdesk_policy_basic");
assert.strictEqual(flowdesk.metrics.commandBufferRecordCount, 1);

const lanObserver = JSON.parse(run(["benchmark", path.join(benchmarks, "lan_observer_readonly_basic"), "--json"]));
assertBenchmarkReport(lanObserver, "lan_observer_readonly_basic");
assert.strictEqual(lanObserver.hostAbi, "0.10");
assert.strictEqual(lanObserver.metrics.commandBufferRecordCount, 1);
assert.strictEqual(lanObserver.metrics.outputEmitCount, 0);
assert(Number.isInteger(lanObserver.metrics.conformanceReplayMs));
assert(Number.isInteger(lanObserver.metrics.packageCheckMs));
assert(Number.isInteger(lanObserver.metrics.evidenceMs));
assert(Number.isInteger(lanObserver.metrics.reportMs));
assert(lanObserver.limitations.some((item) => /wasmExecutionMs unavailable/.test(item)));

const e2eLanObserver = JSON.parse(run(["benchmark", path.join(benchmarks, "e2e_lan_observer_readonly_basic"), "--json"]));
assertBenchmarkReport(e2eLanObserver, "e2e_lan_observer_readonly_basic");
assert.strictEqual(e2eLanObserver.hostAbi, "0.10");
assert.strictEqual(e2eLanObserver.metrics.commandBufferRecordCount, 1);
assert.strictEqual(e2eLanObserver.metrics.outputEmitCount, 0);
assert.strictEqual(e2eLanObserver.metrics.outputIntentCount, 1);
assert.strictEqual(e2eLanObserver.metrics.hostCrossings, 0);
assert(Number.isInteger(e2eLanObserver.metrics.conformanceReplayMs));
assert(Number.isInteger(e2eLanObserver.metrics.e2eProofMs));
assert(Number.isInteger(e2eLanObserver.metrics.evidenceReportMs));
assert(Number.isInteger(e2eLanObserver.metrics.mockHostPolicyMs));
assert(Number.isInteger(e2eLanObserver.metrics.packageCheckMs));
assert(Number.isInteger(e2eLanObserver.metrics.evidenceMs));
assert(Number.isInteger(e2eLanObserver.metrics.reportMs));
assert(!e2eLanObserver.limitations.some((item) => /e2eProofMs unavailable/.test(item)));

const missingDir = path.join(root, "build", "missing-benchmark-dir");
fs.rmSync(missingDir, { recursive: true, force: true });
const missing = runStatus(["benchmark", missingDir, "--json"]);
assert.notStrictEqual(missing.status, 0);
const missingReport = JSON.parse(missing.stdout);
assert.strictEqual(missingReport.status, "fail");
assert.strictEqual(missingReport.kind, "air.benchmarkReport");
assert(missingReport.diagnostics.some((diagnostic) => diagnostic.code === "air.benchmark.missing_dir"));
assertNoAbsolutePaths(missingReport);

console.log("benchmark tests passed");
