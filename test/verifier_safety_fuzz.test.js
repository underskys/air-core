#!/usr/bin/env node

const assert = require("assert");
const cp = require("child_process");
const path = require("path");
const { AIR_ABI_VERSION } = require("../src/version");
const { HOST_ABI_VERSION } = require("../src/package_manifest");

const root = path.resolve(__dirname, "..");
const airc = path.join(root, "bin", "airc.js");

function run(args) {
  return cp.execFileSync(process.execPath, [airc, ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function walk(value, fn, key = null) {
  fn(value, key);
  if (Array.isArray(value)) value.forEach((item, index) => walk(item, fn, String(index)));
  else if (value && typeof value === "object") Object.keys(value).forEach((childKey) => walk(value[childKey], fn, childKey));
}

function assertNoAbsolutePaths(value) {
  const offenders = [];
  walk(value, (item) => {
    if (typeof item === "string" && (item.startsWith(root) || /^[A-Za-z]:[\\/]/.test(item))) offenders.push(item);
  });
  assert.deepStrictEqual(offenders, []);
}

function assertNoTimestampFields(value) {
  const offenders = [];
  walk(value, (_item, key) => {
    if (key && /timestamp|createdAt|updatedAt|generatedAt|wallClock/i.test(key)) offenders.push(key);
  });
  assert.deepStrictEqual(offenders, []);
}

assert.strictEqual(AIR_ABI_VERSION, "0.10");
assert.strictEqual(HOST_ABI_VERSION, "0.10");

const first = run(["fuzz-safety", "--seed", "1", "--cases", "50", "--json"]);
const second = run(["fuzz-safety", "--seed", "1", "--cases", "50", "--json"]);
assert.strictEqual(second, first, "fuzz-safety output must be deterministic");

const report = JSON.parse(first);
assert.strictEqual(report.schemaVersion, "0.32");
assert.strictEqual(report.kind, "air.verifierSafetyFuzzReport");
assert.strictEqual(report.status, "passed");
assert.strictEqual(report.seed, 1);
assert.strictEqual(report.requestedCases, 50);
assert.strictEqual(report.runConfig.liveNetwork, false);
assert.strictEqual(report.runConfig.apiKeysRequired, false);
assert.strictEqual(report.runConfig.liveModelCalls, false);
assert.strictEqual(report.metrics.totalCases, 50);
assert.strictEqual(report.passed, 50);
assert.strictEqual(report.failed, 0);
assert.strictEqual(report.skipped, 0);
assert.strictEqual(report.minimizedCase, null);
assert.strictEqual(report.metrics.failed, 0);
assert.strictEqual(report.metrics.skipped, 0);
assert(report.metrics.validCases > 0);
assert(report.metrics.invalidCases > 0);
assert(report.metrics.packageChecks > 0);
assert.strictEqual(report.metrics.unexpectedTraps, 0);
assert.strictEqual(report.metrics.unexpectedImports, 0);
assert.strictEqual(report.metrics.invalidLoweringAttempts, 0);
assert(report.cases.some((item) => item.kind === "fixed_state" && item.status === "pass"));
assert(report.cases.some((item) => item.kind === "output_emit" && item.status === "pass"));
assert(report.cases.some((item) => item.kind === "generated_handle" && item.status === "pass"));
assert(report.cases.some((item) => item.kind === "structured_io_fixture" && item.status === "pass"));
assert(report.cases.some((item) => item.kind === "invalid_arithmetic_type" && item.status === "pass"));
assert(report.cases.some((item) => item.kind === "invalid_state_oob" && item.status === "pass"));
assert(report.cases.some((item) => item.kind === "invalid_dynamic_output" && item.status === "pass"));
assert(report.cases.some((item) => item.kind === "structured_io_invalid_json" && item.status === "pass"));
assert(report.cases.some((item) => item.kind === "structured_io_invalid_object" && item.status === "pass"));
assert(report.cases.some((item) => item.kind === "structured_io_invalid_string" && item.status === "pass"));
assert(report.cases.some((item) => item.kind === "generated_handles_missing" && item.status === "pass"));
assert(report.cases.some((item) => item.kind === "generated_handles_stale" && item.status === "pass"));
assert(report.cases.some((item) => item.kind === "structured_io_invalid_json" && item.observedDiagnosticCodes.includes("air.structured_io.runtime_json_rejected")));
assert(report.cases.some((item) => item.kind === "structured_io_invalid_object" && item.observedDiagnosticCodes.includes("air.structured_io.object_field_rejected")));
assert(report.cases.some((item) => item.kind === "structured_io_invalid_string" && item.observedDiagnosticCodes.includes("air.structured_io.field_type_invalid")));
assert(report.cases.some((item) => item.kind === "generated_handles_missing" && item.observedDiagnosticCodes.includes("air.structured_io.generated_stale")));

const families = Object.fromEntries(report.families.map((item) => [item.family, item]));
for (const family of ["arithmetic", "fixed_state", "generated_handles", "output_emit", "structured_io"]) {
  assert(families[family], `missing fuzz family ${family}`);
  assert(families[family].valid > 0, `missing valid case for ${family}`);
  assert(families[family].invalid > 0, `missing invalid case for ${family}`);
  assert.strictEqual(families[family].failed, 0);
}
assert(report.limitations.some((item) => /not formal verification/.test(item)));
assertNoAbsolutePaths(report);
assertNoTimestampFields(report);

console.log("verifier safety fuzz tests passed");
