#!/usr/bin/env node

const assert = require("assert");
const cp = require("child_process");
const fs = require("fs");
const path = require("path");
const { validateFactsSchema } = require("../src/facts_schema");

const root = path.resolve(__dirname, "..");
const airc = path.join(root, "bin", "airc.js");
const tmp = path.join(root, "build", "facts-schema-tests");

function run(args, options = {}) {
  return cp.execFileSync(process.execPath, [airc, ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options
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

function validSchema(overrides = {}) {
  return {
    schemaVersion: "0.18",
    privacyPolicy: {
      defaultClassification: "minimized",
      forbiddenByDefault: ["note", "raw_text", "raw_url", "secret", "token"]
    },
    facts: [
      {
        id: 1,
        name: "task_summary",
        maxRows: 16,
        capability: "policy.score",
        privacy: "minimized",
        columns: [
          { name: "status_id", type: "i32" },
          { name: "is_blocked", type: "bool", privacy: "public" },
          { name: "priority_score", type: "i32" }
        ]
      }
    ],
    ...overrides
  };
}

function validRowsetSchema(overrides = {}) {
  return {
    schemaVersion: "0.20",
    kind: "air.boundedRowsetSchema",
    name: "task_summary",
    layout: "columnar",
    maxRows: 128,
    columns: [
      { name: "task_id", type: "i32", privacy: "minimized" },
      { name: "status_id", type: "i32", enum: "task_status", storageHint: "u8", privacy: "minimized" },
      { name: "priority", type: "i32", range: [0, 100], storageHint: "u8", privacy: "minimized" },
      { name: "flags", type: "i32", storageHint: "u16", privacy: "minimized" },
      { name: "blocked", type: "bool", storageHint: "bool", privacy: "public" }
    ],
    privacyPolicy: {
      defaultClassification: "minimized",
      forbiddenByDefault: ["raw_text", "raw_url", "token", "secret"]
    },
    ...overrides
  };
}

function assertInvalid(schema, pattern, code = null) {
  const result = validateFactsSchema(schema);
  assert.strictEqual(result.ok, false);
  assert(result.errors.some((error) => pattern.test(error)), `expected ${pattern}, got ${result.errors.join("; ")}`);
  if (code) assert(result.diagnostics.some((diagnostic) => diagnostic.code === code && pattern.test(diagnostic.message)), `expected diagnostic ${code}, got ${JSON.stringify(result.diagnostics)}`);
}

function writePackage(dir, schema) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, "facts"), { recursive: true });
  fs.writeFileSync(path.join(dir, "main.air"), "module facts_pkg\nexport func run() -> i32 {\nentry:\n  %zero:i32 = 0\n  return %zero\n}\n");
  writeJson(path.join(dir, "facts", "task_summary.facts.json"), schema);
  writeJson(path.join(dir, "air.package.json"), {
    name: "facts-package",
    version: "0.1.0",
    airAbi: "0.10",
    hostAbi: "0.10",
    entry: "main.air",
    capabilities: [],
    targetProfiles: ["cli"],
    factSchemas: ["facts/task_summary.facts.json"]
  });
}

function writeRowsetPackage(dir, schema) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, "facts"), { recursive: true });
  fs.writeFileSync(path.join(dir, "main.air"), "module rowset_pkg\nexport func run() -> i32 {\nentry:\n  %zero:i32 = 0\n  return %zero\n}\n");
  writeJson(path.join(dir, "facts", "task_summary.rowset.schema.json"), schema);
  writeJson(path.join(dir, "air.package.json"), {
    name: "rowset-package",
    version: "0.1.0",
    airAbi: "0.10",
    hostAbi: "0.10",
    entry: "main.air",
    capabilities: [],
    targetProfiles: ["cli"],
    factSchemas: ["facts/task_summary.rowset.schema.json"]
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

const valid = validateFactsSchema(validSchema());
assert.strictEqual(valid.ok, true);
assert.deepStrictEqual(valid.facts.map((fact) => fact.name), ["task_summary"]);
assert.deepStrictEqual(valid.facts[0].columns.map((column) => column.type).sort(), ["bool", "i32", "i32"]);

const validRowset = validateFactsSchema(validRowsetSchema());
assert.strictEqual(validRowset.ok, true);
assert.strictEqual(validRowset.kind, "air.boundedRowsetSchema");
assert.strictEqual(validRowset.rowset.name, "task_summary");
assert.strictEqual(validRowset.rowset.layout, "columnar");
assert.strictEqual(validRowset.rowset.maxRows, 128);
assert.strictEqual(validRowset.rowset.columnCount, 5);
assert.strictEqual(validRowset.rowset.storage.estimatedI32Bytes, 2560);
assert.strictEqual(validRowset.rowset.storage.estimatedStorageBytes, 1152);
assert.strictEqual(validRowset.rowset.storage.estimatedSavingsBytes, 1408);

assertInvalid(validSchema({ facts: [{ name: "task_summary", columns: [{ name: "status_id", type: "i32" }] }] }), /maxRows is required/, "air.facts.schema_invalid");
assertInvalid(validSchema({ facts: [{ id: 1, name: "task_summary", maxRows: 4, columns: [{ name: "title", type: "string" }] }] }), /not a supported bounded scalar type/, "air.facts.non_scalar_column");
assertInvalid(validSchema({ facts: [{ id: 1, name: "task_summary", maxRows: 4, columns: [{ name: "payload", type: "object", properties: { raw: "text" } }] }] }), /fact columns must be scalar|not a supported bounded scalar type/, "air.facts.non_scalar_column");
assertInvalid(validSchema({ facts: [{ id: 1, name: "task_summary", maxRows: 4, columns: [{ name: "status_id", type: "i32" }, { name: "status_id", type: "bool" }] }] }), /duplicate column status_id/, "air.facts.duplicate_column");
assertInvalid(validSchema({ facts: [
  { id: 1, name: "task_summary", maxRows: 4, columns: [{ name: "status_id", type: "i32" }] },
  { id: 2, name: "task_summary", maxRows: 4, columns: [{ name: "other_id", type: "i32" }] }
] }), /duplicate fact name/, "air.facts.duplicate_fact");
assertInvalid(validSchema({ facts: [{ id: 1, name: "task_summary", maxRows: "dynamic", dynamic: true, columns: [{ name: "status_id", type: "i32" }] }] }), /dynamic or unbounded/, "air.facts.dynamic_or_unbounded");
assertInvalid(validSchema({ privacyPolicy: [] }), /privacyPolicy must be an object/, "air.facts.privacy_invalid");
assertInvalid(validSchema({ privacyPolicy: { defaultClassification: "private_text" } }), /privacyPolicy\.defaultClassification must be one of/, "air.facts.privacy_invalid");
assertInvalid(validSchema({ privacyPolicy: { forbiddenByDefault: "raw_text" } }), /privacyPolicy\.forbiddenByDefault must be an array/, "air.facts.privacy_invalid");
assertInvalid(validSchema({ facts: [{ id: 1, name: "task_summary", maxRows: 4, privacy: "private_text", columns: [{ name: "status_id", type: "i32" }] }] }), /facts\[0\]\.privacy must be one of/, "air.facts.privacy_invalid");
assertInvalid(validSchema({ generatedAt: "2026-05-20T00:00:00Z" }), /must not encode timestamps/, "air.facts.timestamp_field");
assertInvalid(validSchema({ sourcePath: "/tmp/private/tasks.json" }), /must not contain absolute paths/, "air.facts.absolute_path");
assertInvalid(validRowsetSchema({ schemaVersion: "0.18" }), /bounded rowset schemaVersion must be 0\.20/, "air.rowset.schema_invalid");
assertInvalid(validRowsetSchema({ maxRows: undefined }), /maxRows is required|positive integer/, "air.rowset.schema_invalid");
assertInvalid(validRowsetSchema({ dynamic: true }), /dynamic or unbounded/, "air.rowset.unbounded_rows");
assertInvalid(validRowsetSchema({ columns: [{ name: "task_id", type: "i32" }, { name: "task_id", type: "bool" }] }), /duplicate column task_id/, "air.rowset.duplicate_column");
assertInvalid(validRowsetSchema({ columns: [{ name: "title", type: "string" }] }), /not a supported bounded rowset scalar type/, "air.rowset.non_scalar_column");
assertInvalid(validRowsetSchema({ columns: [{ name: "payload", type: "object", properties: { raw: "text" } }] }), /rowset columns must be scalar|not a supported bounded rowset scalar type/, "air.rowset.non_scalar_column");
assertInvalid(validRowsetSchema({ privacyPolicy: [] }), /privacyPolicy must be an object/, "air.rowset.privacy_invalid");
assertInvalid(validRowsetSchema({ columns: [{ name: "task_id", type: "i32", privacy: "raw_text" }] }), /forbidden privacy marker raw_text/, "air.rowset.privacy_invalid");
assertInvalid(validRowsetSchema({ columns: [{ name: "status_id", type: "i32", storageHint: "u64" }] }), /storageHint must be one of/, "air.rowset.storage_hint_invalid");
assertInvalid(validRowsetSchema({ generatedAt: "2026-05-20T00:00:00Z" }), /must not encode timestamps/, "air.rowset.timestamp_field");
assertInvalid(validRowsetSchema({ sourcePath: "/tmp/private/tasks.json" }), /must not contain absolute paths/, "air.rowset.absolute_path");
assertInvalid(validRowsetSchema({ rows: [] }), /rows is not allowed/, "air.rowset.schema_invalid");
assertInvalid(validRowsetSchema({ data: [] }), /data is not allowed/, "air.rowset.schema_invalid");
assertInvalid(validRowsetSchema({ values: [1, 2, 3] }), /values is not allowed/, "air.rowset.schema_invalid");

const packageDir = path.join(tmp, "valid-package");
writePackage(packageDir, validSchema());
const checkReport = JSON.parse(run(["package-check", packageDir, "--profile", "cli", "--source-only", "--json"]));
assert.strictEqual(checkReport.status, "pass");
assert.strictEqual(checkReport.facts.schemas.length, 1);
assert.strictEqual(checkReport.facts.schemas[0].path, "facts/task_summary.facts.json");
assert.strictEqual(checkReport.facts.schemas[0].privacyPolicy.defaultClassification, "minimized");
assert.deepStrictEqual(checkReport.facts.schemas[0].privacyPolicy.forbiddenByDefault, ["note", "raw_text", "raw_url", "secret", "token"]);
assert.strictEqual(checkReport.facts.schemas[0].facts[0].name, "task_summary");
assert.strictEqual(checkReport.facts.schemas[0].facts[0].privacy, "minimized");
assert.strictEqual(checkReport.facts.schemas[0].facts[0].columns.find((column) => column.name === "is_blocked").privacy, "public");
assert.match(checkReport.facts.schemas[0].fingerprint, /^sha256:[a-f0-9]{64}$/);
assertNoAbsolutePaths(checkReport.facts);
assertNoTimestampLikeFields(checkReport.facts);

const report = JSON.parse(run(["report", "package", packageDir, "--json"]));
assert.strictEqual(report.facts.schemas.length, 1);
assert.strictEqual(report.facts.schemas[0].facts[0].columnCount, 3);
assertNoAbsolutePaths(report.facts);
assertNoTimestampLikeFields(report.facts);

const rowsetPackage = path.join(tmp, "rowset-package");
writeRowsetPackage(rowsetPackage, validRowsetSchema());
const rowsetCheck = JSON.parse(run(["package-check", rowsetPackage, "--profile", "cli", "--source-only", "--json"]));
const rowsetSummary = rowsetCheck.facts.schemas[0];
assert.strictEqual(rowsetCheck.status, "pass");
assert.strictEqual(rowsetSummary.kind, "air.boundedRowsetSchema");
assert.strictEqual(rowsetSummary.path, "facts/task_summary.rowset.schema.json");
assert.strictEqual(rowsetSummary.rowset.name, "task_summary");
assert.strictEqual(rowsetSummary.rowset.maxRows, 128);
assert.strictEqual(rowsetSummary.rowset.columnCount, 5);
assert.strictEqual(rowsetSummary.rowset.columns.find((column) => column.name === "priority").storageHint, "u8");
assert.strictEqual(rowsetSummary.rowset.columns.find((column) => column.name === "priority").range[1], 100);
assert.strictEqual(rowsetSummary.rowset.storage.estimatedSavingsBytes, 1408);
assert.strictEqual(rowsetSummary.privacyPolicy.defaultClassification, "minimized");
assert.match(rowsetSummary.fingerprint, /^sha256:[a-f0-9]{64}$/);
assertNoAbsolutePaths(rowsetCheck.facts);
assertNoTimestampLikeFields(rowsetCheck.facts);

const rowsetReport = JSON.parse(run(["report", "package", rowsetPackage, "--json"]));
assert.strictEqual(rowsetReport.facts.schemas[0].rowset.storage.estimatedI32Bytes, 2560);
assertNoAbsolutePaths(rowsetReport.facts);
assertNoTimestampLikeFields(rowsetReport.facts);

const rowsetEvidence = JSON.parse(run(["verify", "package", rowsetPackage, "--profile", "cli", "--json"]));
assert.strictEqual(rowsetEvidence.status, "passed");
assert.strictEqual(rowsetEvidence.airAbi, "0.10");
assert.strictEqual(rowsetEvidence.hostAbi, "0.10");
assert.strictEqual(rowsetEvidence.factSchemas[0].kind, "air.boundedRowsetSchema");
assert.strictEqual(rowsetEvidence.factSchemas[0].rowset.name, "task_summary");
assert.strictEqual(rowsetEvidence.factSchemas[0].rowset.storage.estimatedSavingsBytes, 1408);
assert.match(rowsetEvidence.factSchemas[0].fingerprint, /^sha256:[a-f0-9]{64}$/);
assertNoAbsolutePaths(rowsetEvidence);
assertNoTimestampLikeFields(rowsetEvidence);

const rowsetEvidenceAgain = JSON.parse(run(["verify", "package", rowsetPackage, "--profile", "cli", "--json"]));
assert.deepStrictEqual(rowsetEvidenceAgain, rowsetEvidence);

const invalidPackage = path.join(tmp, "invalid-package");
writePackage(invalidPackage, validSchema({ facts: [{ id: 1, name: "task_summary", maxRows: 4, columns: [{ name: "title", type: "object" }] }] }));
const invalidStatus = runStatus(["package-check", invalidPackage, "--profile", "cli", "--source-only", "--json"]);
assert.notStrictEqual(invalidStatus.status, 0);
const invalidReport = JSON.parse(invalidStatus.stdout);
assert.strictEqual(invalidReport.status, "fail");
assert(invalidReport.checks.some((check) => check.id === "facts-schema:facts/task_summary.facts.json" && check.status === "fail"));
assert(invalidReport.diagnostics.some((diagnostic) => diagnostic.code === "air.facts.non_scalar_column"));
assert(!invalidReport.diagnostics.some((diagnostic) => diagnostic.code === "air.package.check_failed" && /facts schema/.test(diagnostic.message)));

const missingSchemaPackage = path.join(tmp, "missing-schema-package");
writePackage(missingSchemaPackage, validSchema());
fs.rmSync(path.join(missingSchemaPackage, "facts", "task_summary.facts.json"));
const missingSchemaStatus = runStatus(["package-check", missingSchemaPackage, "--profile", "cli", "--source-only", "--json"]);
assert.notStrictEqual(missingSchemaStatus.status, 0);
const missingSchemaReport = JSON.parse(missingSchemaStatus.stdout);
assert(missingSchemaReport.diagnostics.some((diagnostic) => diagnostic.code === "air.facts.schema_missing"));

const invalidRowsetPackage = path.join(tmp, "invalid-rowset-package");
writeRowsetPackage(invalidRowsetPackage, validRowsetSchema({ columns: [{ name: "status_id", type: "string" }] }));
const invalidRowsetStatus = runStatus(["package-check", invalidRowsetPackage, "--profile", "cli", "--source-only", "--json"]);
assert.notStrictEqual(invalidRowsetStatus.status, 0);
const invalidRowsetReport = JSON.parse(invalidRowsetStatus.stdout);
assert.strictEqual(invalidRowsetReport.status, "fail");
assert(invalidRowsetReport.diagnostics.some((diagnostic) => diagnostic.code === "air.rowset.non_scalar_column"));
assert(!invalidRowsetReport.diagnostics.some((diagnostic) => diagnostic.code === "air.package.check_failed" && /rowset|facts schema/.test(diagnostic.message)));

const missingRowsetPackage = path.join(tmp, "missing-rowset-package");
writeRowsetPackage(missingRowsetPackage, validRowsetSchema());
fs.rmSync(path.join(missingRowsetPackage, "facts", "task_summary.rowset.schema.json"));
const missingRowsetStatus = runStatus(["package-check", missingRowsetPackage, "--profile", "cli", "--source-only", "--json"]);
assert.notStrictEqual(missingRowsetStatus.status, 0);
const missingRowsetReport = JSON.parse(missingRowsetStatus.stdout);
assert(missingRowsetReport.diagnostics.some((diagnostic) => diagnostic.code === "air.rowset.missing_schema"));

console.log("ok: facts schema tests");
