#!/usr/bin/env node

const assert = require("assert");
const cp = require("child_process");
const fs = require("fs");
const path = require("path");
const { HOST_ABI_VERSION } = require("../src/package_manifest");
const { validateOutputContractSchema } = require("../src/output_contract_schema");
const { AIR_ABI_VERSION } = require("../src/version");

const root = path.resolve(__dirname, "..");
const airc = path.join(root, "bin", "airc.js");
const tmp = path.join(root, "build", "output-contract-schema-tests");

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

function validContract(overrides = {}) {
  return {
    schemaVersion: "0.18",
    kind: "air.outputContract",
    outputs: [
      {
        id: 1,
        name: "priority_alert_requested",
        channel: "notification",
        capability: "notify.request",
        args: [
          { name: "task_id", type: "i32" },
          { name: "severity", type: "i32" },
          { name: "flags", type: "i32" },
          { name: "silent", type: "bool" }
        ],
        resources: [],
        profileConstraints: []
      }
    ],
    ...overrides
  };
}

function assertInvalid(schema, code, pattern) {
  const report = validateOutputContractSchema(schema);
  assert.strictEqual(report.ok, false);
  assert(report.diagnostics.some((item) => item.code === code && pattern.test(item.message)), `expected ${code} ${pattern}, got ${JSON.stringify(report.diagnostics)}`);
}

function writePackage(dir, contract) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, "outputs"), { recursive: true });
  fs.writeFileSync(path.join(dir, "main.air"), "module output_contract_pkg\nexport func run() -> i32 {\nentry:\n  %zero:i32 = 0\n  return %zero\n}\n");
  writeJson(path.join(dir, "outputs", "main.output.json"), contract);
  writeJson(path.join(dir, "air.package.json"), {
    name: "output-contract-package",
    version: "0.1.0",
    airAbi: "0.10",
    hostAbi: "0.10",
    entry: "main.air",
    capabilities: [],
    targetProfiles: ["cli"],
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

const valid = validateOutputContractSchema(validContract());
assert.strictEqual(valid.ok, true);
assert.deepStrictEqual(valid.outputs.map((item) => item.name), ["priority_alert_requested"]);
assert.deepStrictEqual(valid.outputs[0].args.map((arg) => arg.type).sort(), ["bool", "i32", "i32", "i32"]);

assertInvalid(validContract({ outputs: [{ ...validContract().outputs[0], id: 0 }] }), "air.output_contract.schema_invalid", /id must be a positive integer/);
assertInvalid(validContract({ outputs: [validContract().outputs[0], { ...validContract().outputs[0] }] }), "air.output_contract.duplicate_id", /duplicate output id/);
assertInvalid(validContract({ outputs: [validContract().outputs[0], { ...validContract().outputs[0], id: 2 }] }), "air.output_contract.duplicate_name", /duplicate output name/);
assertInvalid(validContract({ outputs: [{ ...validContract().outputs[0], args: [{ name: "payload", type: "string" }] }] }), "air.output_contract.non_scalar_arg", /not a supported scalar/);
assertInvalid(validContract({ outputs: [{ ...validContract().outputs[0], args: [{ name: "payload", type: "object", properties: { raw: "text" } }] }] }), "air.output_contract.non_scalar_arg", /not a supported scalar|must be scalar/);
assertInvalid(validContract({ outputs: [{ ...validContract().outputs[0], args: [{ name: "task_id", type: "i32" }, { name: "task_id", type: "bool" }] }] }), "air.output_contract.duplicate_name", /duplicate arg name/);
assertInvalid(validContract({ sourcePath: "/tmp/private/output.json" }), "air.output_contract.absolute_path", /absolute paths/);
assertInvalid(validContract({ generatedAt: "2026-05-20T00:00:00Z" }), "air.output_contract.timestamp_field", /must not encode timestamps/);

const packageDir = path.join(tmp, "valid-package");
writePackage(packageDir, validContract());
const checkReport = JSON.parse(run(["package-check", packageDir, "--profile", "cli", "--source-only", "--json"]));
assert.strictEqual(checkReport.status, "pass");
assert.strictEqual(checkReport.outputContracts.schemas.length, 1);
assert.strictEqual(checkReport.outputContracts.schemas[0].path, "outputs/main.output.json");
assert.strictEqual(checkReport.outputContracts.schemas[0].outputsCount, 1);
assert.deepStrictEqual(checkReport.outputContracts.schemas[0].channels, ["notification"]);
assert.deepStrictEqual(checkReport.outputContracts.schemas[0].capabilities, ["notify.request"]);
assert.strictEqual(checkReport.outputContracts.schemas[0].outputs[0].argCount, 4);
assert.match(checkReport.outputContracts.schemas[0].fingerprint, /^sha256:[a-f0-9]{64}$/);
assertNoAbsolutePaths(checkReport.outputContracts);
assertNoTimestampLikeFields(checkReport.outputContracts);

const report = JSON.parse(run(["report", "package", packageDir, "--json"]));
assert.strictEqual(report.outputContracts.schemas.length, 1);
assert.strictEqual(report.outputContracts.schemas[0].outputs[0].name, "priority_alert_requested");

const invalidPackage = path.join(tmp, "invalid-package");
writePackage(invalidPackage, validContract({ outputs: [{ ...validContract().outputs[0], args: [{ name: "payload", type: "string" }] }] }));
const invalidStatus = runStatus(["package-check", invalidPackage, "--profile", "cli", "--source-only", "--json"]);
assert.notStrictEqual(invalidStatus.status, 0);
const invalidReport = JSON.parse(invalidStatus.stdout);
assert.strictEqual(invalidReport.status, "fail");
assert(invalidReport.checks.some((check) => check.id === "output-contract:outputs/main.output.json" && check.status === "fail"));
assert(invalidReport.diagnostics.some((diagnostic) => diagnostic.code === "air.output_contract.non_scalar_arg"));

const badManifestDir = path.join(tmp, "bad-manifest");
writePackage(badManifestDir, validContract());
writeJson(path.join(badManifestDir, "air.package.json"), {
  name: "output-contract-package",
  version: "0.1.0",
  airAbi: "0.10",
  hostAbi: "0.10",
  entry: "main.air",
  capabilities: [],
  targetProfiles: ["cli"],
  outputContracts: ["/tmp/output.json"]
});
const badManifestStatus = runStatus(["package-check", badManifestDir, "--profile", "cli", "--source-only", "--json"]);
assert.notStrictEqual(badManifestStatus.status, 0);
assert(/outputContracts\[0\] must be relative and package-local/.test(badManifestStatus.stdout));

assert.strictEqual(AIR_ABI_VERSION, "0.10");
assert.strictEqual(HOST_ABI_VERSION, "0.10");

console.log("ok: output contract schema tests");
