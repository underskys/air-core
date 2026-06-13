#!/usr/bin/env node

const assert = require("assert");
const cp = require("child_process");
const fs = require("fs");
const path = require("path");
const { AIR_ABI_VERSION } = require("../src/version");

const root = path.resolve(__dirname, "..");
const airc = path.join(root, "bin", "airc.js");
const tmp = path.join(root, "build", "structured-io-tests");

function run(args) {
  return cp.execFileSync(process.execPath, [airc, ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function runJson(args) {
  return JSON.parse(run(args.concat("--json")));
}

function runFailsJson(args) {
  const result = cp.spawnSync(process.execPath, [airc, ...args, "--json"], {
    cwd: root,
    encoding: "utf8"
  });
  assert.notStrictEqual(result.status, 0, `expected failure: ${args.join(" ")}`);
  return JSON.parse(result.stdout || "{}");
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function writePackage(name, schemas) {
  const dir = path.join(tmp, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, "schemas"), { recursive: true });
  fs.writeFileSync(path.join(dir, "main.air"), `module ${name.replace(/-/g, "_")}
capabilities { }

export func run() -> i32 {
entry:
  %ok:i32 = const.i32 1
  return %ok
}
`);
  const paths = [];
  for (const [file, schema] of Object.entries(schemas)) {
    const rel = `schemas/${file}`;
    writeJson(path.join(dir, rel), schema);
    paths.push(rel);
  }
  writeJson(path.join(dir, "air.package.json"), {
    name,
    version: "0.1.0",
    airAbi: "0.10",
    hostAbi: "0.10",
    entry: "main.air",
    capabilities: [],
    targetProfiles: ["cli"],
    generatedModules: ["generated/structured_io_handles.air"],
    structuredIO: paths.sort()
  });
  return dir;
}

function taskRowset(overrides = {}) {
  return {
    schemaVersion: "0.32",
    kind: "air.structuredRowsetSchema",
    name: "task_summary",
    maxRows: 4,
    privacyPolicy: {
      defaultClassification: "minimized",
      forbiddenByDefault: ["raw_text", "raw_url", "token", "secret"]
    },
    fields: [
      { name: "task_id", type: "i32", privacy: "minimized", semantic: "id" },
      { name: "status_id", type: "i32", privacy: "minimized", semantic: "enum" },
      { name: "blocked", type: "bool", privacy: "public", semantic: "flag" },
      { name: "risk_score", type: "i32", privacy: "minimized", semantic: "score" }
    ],
    ...overrides
  };
}

function observerRowset() {
  return {
    schemaVersion: "0.32",
    kind: "air.structuredRowsetSchema",
    name: "observation_summary",
    maxRows: 8,
    privacyPolicy: {
      defaultClassification: "minimized",
      forbiddenByDefault: ["raw_text", "raw_url", "token", "secret"]
    },
    fields: [
      { name: "host_id", type: "i32", privacy: "minimized", semantic: "id" },
      { name: "signal_kind_id", type: "i32", privacy: "minimized", semantic: "enum" },
      { name: "severity_id", type: "i32", privacy: "minimized", semantic: "enum" },
      { name: "seen_count", type: "i32", privacy: "minimized", semantic: "counter" }
    ]
  };
}

function outputSummary() {
  return {
    schemaVersion: "0.32",
    kind: "air.structuredOutputSummarySchema",
    name: "task_policy_summary",
    privacyPolicy: {
      defaultClassification: "minimized",
      forbiddenByDefault: ["raw_text", "raw_url", "token", "secret"]
    },
    fields: [
      { name: "task_id", type: "i32", privacy: "minimized", semantic: "id" },
      { name: "recommended_action_id", type: "i32", privacy: "minimized", semantic: "enum" }
    ]
  };
}

function diagnosticCodes(report) {
  return new Set((report.diagnostics || []).map((diagnostic) => diagnostic.code));
}

function assertNoAbsolutePaths(value) {
  const offenders = [];
  walk(value, (item) => {
    if (typeof item === "string" && (item.startsWith(root) || /^[A-Za-z]:[\\/]/.test(item))) offenders.push(item);
  });
  assert.deepStrictEqual(offenders, []);
}

function walk(value, fn) {
  fn(value);
  if (Array.isArray(value)) value.forEach((item) => walk(item, fn));
  else if (value && typeof value === "object") Object.keys(value).forEach((key) => walk(value[key], fn));
}

fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });
assert.strictEqual(AIR_ABI_VERSION, "0.10");

const flowdesk = writePackage("flowdesk-structured-io", {
  "task_summary.structured.rowset.json": taskRowset(),
  "task_policy_summary.structured.output.json": outputSummary()
});
let missing = runFailsJson(["package-check", flowdesk, "--profile", "cli", "--source-only"]);
assert(diagnosticCodes(missing).has("air.structured_io.generated_stale"));

let generated = runJson(["generate", "structured-io", flowdesk]);
assert.deepStrictEqual(generated.written, ["generated/structured_io_handles.air", "generated/structured_io.meta.json"]);
let generatedAir = fs.readFileSync(path.join(flowdesk, "generated", "structured_io_handles.air"), "utf8");
assert.match(generatedAir, /const STRUCT_TASK_SUMMARY_MAX_ROWS:i32 = 4/);
assert.match(generatedAir, /const STRUCT_TASK_SUMMARY_FIELD_TASK_ID_OFFSET:i32 = 0/);
assert(!/\bfunc\b/.test(generatedAir), "structured IO handles must be constants only");
run(["verify", "--library", path.join(flowdesk, "generated", "structured_io_handles.air")]);

const fresh = runJson(["package-check", flowdesk, "--profile", "cli", "--source-only"]);
assert.strictEqual(fresh.status, "pass");
assert.strictEqual(fresh.structuredIO.schemas.length, 2);
assert.strictEqual(fresh.structuredIO.handleSets[0].status, "fresh");
assert.strictEqual(fresh.structuredIO.schemas.find((schema) => schema.name === "task_summary").maxRows, 4);
assert.strictEqual(fresh.airAbi, "0.10");
assert.strictEqual(fresh.hostAbi, "0.10");
assertNoAbsolutePaths(fresh);

const evidence = runJson(["verify", "package", flowdesk, "--profile", "cli"]);
assert.strictEqual(evidence.status, "passed");
assert.strictEqual(evidence.structuredIO.schemas.length, 2);
assert.strictEqual(evidence.structuredIO.handleSets[0].status, "fresh");
assertNoAbsolutePaths(evidence);

const report = runJson(["report", "package", flowdesk]);
assert.strictEqual(report.structuredIO.schemas.length, 2);
assert.strictEqual(report.structuredIO.handleSets[0].status, "fresh");
assertNoAbsolutePaths(report);

const lanObserver = writePackage("lan-observer-structured-io", {
  "observation_summary.structured.rowset.json": observerRowset()
});
runJson(["generate", "structured-io", lanObserver]);
const lanCheck = runJson(["package-check", lanObserver, "--profile", "cli", "--source-only"]);
assert.strictEqual(lanCheck.status, "pass");

writeJson(path.join(flowdesk, "traces", "pass.json"), {
  schemaVersion: "0.20",
  kind: "air.conformance.batchFixture",
  id: "flowdesk-structured-io-pass",
  package: "flowdesk-structured-io",
  profile: "cli",
  rowsets: [{
    name: "task_summary",
    rows: [
      { task_id: 1, status_id: 2, blocked: false, risk_score: 30 },
      { task_id: 2, status_id: 4, blocked: true, risk_score: 80 }
    ]
  }],
  observedOutputs: [],
  expectedOutputs: []
});
const conformance = runJson(["conformance", flowdesk, "--profile", "cli", "--trace", path.join(flowdesk, "traces", "pass.json")]);
assert.strictEqual(conformance.status, "pass");
assert.strictEqual(conformance.rowsets[0].source, "structuredIO");

writeJson(path.join(lanObserver, "traces", "pass.json"), {
  schemaVersion: "0.20",
  kind: "air.conformance.batchFixture",
  id: "lan-observer-structured-io-pass",
  package: "lan-observer-structured-io",
  profile: "cli",
  rowsets: [{
    name: "observation_summary",
    rows: [
      { host_id: 1, signal_kind_id: 2, severity_id: 1, seen_count: 3 }
    ]
  }],
  observedOutputs: [],
  expectedOutputs: []
});
assert.strictEqual(runJson(["conformance", lanObserver, "--profile", "cli", "--trace", path.join(lanObserver, "traces", "pass.json")]).status, "pass");

const invalidNoMaxRows = writePackage("structured-io-no-maxrows", {
  "bad.structured.rowset.json": taskRowset({ maxRows: undefined })
});
let invalid = runFailsJson(["package-check", invalidNoMaxRows, "--profile", "cli", "--source-only"]);
assert(diagnosticCodes(invalid).has("air.structured_io.unbounded_rowset"));

const invalidString = writePackage("structured-io-string-field", {
  "bad.structured.rowset.json": taskRowset({ fields: [{ name: "task_id", type: "string", privacy: "minimized" }] })
});
invalid = runFailsJson(["package-check", invalidString, "--profile", "cli", "--source-only"]);
assert(diagnosticCodes(invalid).has("air.structured_io.field_type_invalid"));

const invalidObject = writePackage("structured-io-object-field", {
  "bad.structured.rowset.json": taskRowset({ fields: [{ name: "task", type: "object", privacy: "minimized" }] })
});
invalid = runFailsJson(["package-check", invalidObject, "--profile", "cli", "--source-only"]);
assert(diagnosticCodes(invalid).has("air.structured_io.object_field_rejected"));

const invalidJson = writePackage("structured-io-json-field", {
  "bad.structured.rowset.json": taskRowset({ fields: [{ name: "task", type: "json", privacy: "minimized" }] })
});
invalid = runFailsJson(["package-check", invalidJson, "--profile", "cli", "--source-only"]);
assert(diagnosticCodes(invalid).has("air.structured_io.runtime_json_rejected"));

const invalidNested = writePackage("structured-io-nested-field", {
  "bad.structured.rowset.json": taskRowset({ fields: [{ name: "task", type: "i32", privacy: "minimized", fields: [{ name: "nested", type: "i32" }] }] })
});
invalid = runFailsJson(["package-check", invalidNested, "--profile", "cli", "--source-only"]);
assert(diagnosticCodes(invalid).has("air.structured_io.object_field_rejected"));

const stale = writePackage("structured-io-stale", {
  "task_summary.structured.rowset.json": taskRowset()
});
runJson(["generate", "structured-io", stale]);
writeJson(path.join(stale, "schemas", "task_summary.structured.rowset.json"), taskRowset({ maxRows: 5 }));
const staleReport = runFailsJson(["package-check", stale, "--profile", "cli", "--source-only"]);
assert(diagnosticCodes(staleReport).has("air.structured_io.generated_stale"));

const diffReport = runJson(["diff", "package", flowdesk, lanObserver]);
assert.strictEqual(diffReport.structuredIODelta.changed, true);
assert(diffReport.structuredIODelta.added.some((schema) => schema.name === "observation_summary"));
assertNoAbsolutePaths(diffReport);

writeJson(path.join(flowdesk, "traces", "too-many-rows.json"), {
  schemaVersion: "0.20",
  kind: "air.conformance.batchFixture",
  id: "flowdesk-structured-io-too-many-rows",
  package: "flowdesk-structured-io",
  profile: "cli",
  rowsets: [{
    name: "task_summary",
    rows: [
      { task_id: 1, status_id: 1, blocked: false, risk_score: 1 },
      { task_id: 2, status_id: 1, blocked: false, risk_score: 1 },
      { task_id: 3, status_id: 1, blocked: false, risk_score: 1 },
      { task_id: 4, status_id: 1, blocked: false, risk_score: 1 },
      { task_id: 5, status_id: 1, blocked: false, risk_score: 1 }
    ]
  }],
  observedOutputs: [],
  expectedOutputs: []
});
const rowBound = runFailsJson(["conformance", flowdesk, "--profile", "cli", "--trace", path.join(flowdesk, "traces", "too-many-rows.json")]);
assert(rowBound.mismatches.some((item) => item.code === "air.conformance.row_bound_exceeded"));

writeJson(path.join(flowdesk, "traces", "privacy-leak.json"), {
  schemaVersion: "0.20",
  kind: "air.conformance.batchFixture",
  id: "flowdesk-structured-io-privacy-leak",
  package: "flowdesk-structured-io",
  profile: "cli",
  rowsets: [{
    name: "task_summary",
    rows: [{ task_id: 1, status_id: 1, blocked: false, risk_score: 1, raw_text: "do-not-report" }]
  }],
  observedOutputs: [],
  expectedOutputs: []
});
const privacy = runFailsJson(["conformance", flowdesk, "--profile", "cli", "--trace", path.join(flowdesk, "traces", "privacy-leak.json")]);
assert(privacy.mismatches.some((item) => item.code === "air.conformance.privacy_leak"));

console.log("structured IO tests passed");
