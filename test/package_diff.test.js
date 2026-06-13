#!/usr/bin/env node

const assert = require("assert");
const cp = require("child_process");
const fs = require("fs");
const path = require("path");
const { AIR_ABI_VERSION } = require("../src/version");

const root = path.resolve(__dirname, "..");
const airc = path.join(root, "bin", "airc.js");
const tmp = path.join(root, "build", "package-diff-tests");
const fixtureDir = path.join(root, "test", "fixtures", "package_diff");

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
    encoding: "utf8"
  });
}

function diff(oldDir, newDir) {
  return JSON.parse(run(["diff", "package", oldDir, newDir, "--json"]));
}

function walk(value, fn) {
  fn(value);
  if (Array.isArray(value)) {
    for (const item of value) walk(item, fn);
  } else if (value && typeof value === "object") {
    for (const key of Object.keys(value)) walk(value[key], fn);
  }
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
  walk(value, (item) => {
    if (typeof item === "string" && /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(item)) offenders.push(item);
  });
  assert.deepStrictEqual(offenders, []);
}

function assertNoRawPrivatePayloads(value) {
  const offenders = [];
  const forbidden = [
    "raw private payload",
    "raw URL",
    "raw_url",
    "token",
    "secret",
    "private text",
    "private_text",
    "/tmp/",
    "/var/folders/"
  ];
  walk(value, (item) => {
    if (typeof item !== "string") return;
    for (const marker of forbidden) {
      if (item.includes(marker)) offenders.push(item);
    }
  });
  assert.deepStrictEqual(offenders, []);
}

function assertDiffSafe(value) {
  assertNoAbsolutePaths(value);
  assertNoTimestampFields(value);
  assertNoRawPrivatePayloads(value);
}

function writePackage(dir, options = {}) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "module.air"), `module ${options.moduleName || "diff_pkg"}
${options.modulePreamble || ""}
export func run() -> i32 {
entry:
  return 1
}
`);
  if (options.outputContract) {
    fs.mkdirSync(path.join(dir, "outputs"), { recursive: true });
    fs.writeFileSync(path.join(dir, "outputs", "intent.output.json"), JSON.stringify({
      schemaVersion: "0.18",
      kind: "air.outputContract",
      outputs: [{
        id: 1001,
        name: "review_requested",
        channel: "notification",
        capability: "notify.request",
        args: [{ name: "code", type: "i32" }]
      }]
    }, null, 2));
  }
  fs.writeFileSync(path.join(dir, "air.package.json"), JSON.stringify({
    name: options.name || "diff-package",
    version: "0.1.0",
    airAbi: AIR_ABI_VERSION,
    hostAbi: options.hostAbi || "0.10",
    entry: "module.air",
    capabilities: options.capabilities || [],
    targetProfiles: options.targetProfiles || ["cli"],
    factSchemas: options.factSchemas || [],
    outputContracts: options.outputContract ? ["outputs/intent.output.json"] : [],
    commandBuffers: options.commandBuffers || [],
    generatedModules: options.generatedModules || []
  }, null, 2));
}

const identicalOld = path.join(tmp, "identical-old");
const identicalNew = path.join(tmp, "identical-new");
writePackage(identicalOld);
writePackage(identicalNew);
const identical = diff(identicalOld, identicalNew);
assert.strictEqual(identical.schemaVersion, "0.30");
assert.strictEqual(identical.kind, "air.packageDiff");
assert.strictEqual(identical.status, "passed");
assert.strictEqual(identical.oldPackageHash, identical.newPackageHash);
assert.strictEqual(identical.airAbiDelta.changed, false);
assert.strictEqual(identical.hostAbiDelta.changed, false);
assert.strictEqual(identical.capabilityDelta.changed, false);
assert.strictEqual(identical.outputContractDelta.changed, false);
assert.strictEqual(identical.generatedArtifactDelta.changed, false);
assertNoAbsolutePaths(identical);

const deterministic = run(["diff", "package", identicalOld, identicalNew, "--json"]);
assert.strictEqual(deterministic, run(["diff", "package", identicalOld, identicalNew, "--json"]));

const fixtureOld = path.join(fixtureDir, "old");
const fixtureNew = path.join(fixtureDir, "new");
const fixtureGolden = JSON.parse(fs.readFileSync(path.join(fixtureDir, "expected_changed.golden.json"), "utf8"));
const fixtureIdentical = diff(fixtureOld, fixtureOld);
assert.strictEqual(fixtureIdentical.status, "passed");
assert.strictEqual(fixtureIdentical.oldPackageHash, fixtureIdentical.newPackageHash);
assert.strictEqual(fixtureIdentical.capabilityDelta.changed, false);
assert.strictEqual(fixtureIdentical.outputContractDelta.changed, false);
assertDiffSafe(fixtureIdentical);

const fixtureChangedText = run(["diff", "package", fixtureOld, fixtureNew, "--json"]);
assert.strictEqual(fixtureChangedText, run(["diff", "package", fixtureOld, fixtureNew, "--json"]));
const fixtureChanged = JSON.parse(fixtureChangedText);
assert.deepStrictEqual(fixtureChanged, fixtureGolden);
assert.strictEqual(fixtureChanged.status, "changed");
assert.deepStrictEqual(fixtureChanged.capabilityDelta.added, ["output"]);
assert.strictEqual(fixtureChanged.effectDelta.added.some((item) => item.key === "output.emit" && item.value === 1), true);
assert.strictEqual(fixtureChanged.hostAbiDelta.old, "0.10");
assert.strictEqual(fixtureChanged.hostAbiDelta.new, "0.11");
assert.strictEqual(fixtureChanged.outputContractDelta.added[0].path, "outputs/task_policy.output.json");
assert.strictEqual(fixtureChanged.rowsetSchemaDelta.changedItems[0].old.maxRows, 4);
assert.strictEqual(fixtureChanged.rowsetSchemaDelta.changedItems[0].new.maxRows, 8);
assert.strictEqual(fixtureChanged.generatedArtifactDelta.changed, false);
assert(fixtureChanged.diagnostics.some((diagnostic) => diagnostic.code === "air.review.magic_handle_literal"));
assertDiffSafe(fixtureChanged);

const capabilityOld = path.join(tmp, "capability-old");
const capabilityNew = path.join(tmp, "capability-new");
writePackage(capabilityOld);
writePackage(capabilityNew, { capabilities: ["debug"] });
const capability = diff(capabilityOld, capabilityNew);
assert.strictEqual(capability.status, "changed");
assert.deepStrictEqual(capability.capabilityDelta.added, ["debug"]);
assert.deepStrictEqual(capability.capabilityDelta.removed, []);
assertDiffSafe(capability);

const contractOld = path.join(tmp, "contract-old");
const contractNew = path.join(tmp, "contract-new");
writePackage(contractOld);
writePackage(contractNew, { outputContract: true });
const contract = diff(contractOld, contractNew);
assert.strictEqual(contract.status, "changed");
assert.strictEqual(contract.outputContractDelta.added.length, 1);
assert.strictEqual(contract.outputContractDelta.added[0].path, "outputs/intent.output.json");
assert.strictEqual(contract.outputContractDelta.added[0].outputs[0].id, 1001);
assertDiffSafe(contract);

const generatedOld = path.join(tmp, "generated-old");
const generatedNew = path.join(tmp, "generated-new");
writePackage(generatedOld);
writePackage(generatedNew, { generatedModules: ["generated/missing.air"] });
const generated = runStatus(["diff", "package", generatedOld, generatedNew, "--json"]);
assert.notStrictEqual(generated.status, 0);
const generatedReport = JSON.parse(generated.stdout);
assert.strictEqual(generatedReport.status, "failed");
assert.strictEqual(generatedReport.generatedArtifactDelta.added.length, 1);
assert.strictEqual(generatedReport.generatedArtifactDelta.added[0].path, "generated/missing.air");
assert.strictEqual(generatedReport.generatedArtifactDelta.added[0].status, "missing");
assert(generatedReport.diagnostics.some((diagnostic) => diagnostic.code === "air.package_diff.package_report_error"));
assertDiffSafe(generatedReport);

const hostOld = path.join(tmp, "host-old");
const hostNew = path.join(tmp, "host-new");
writePackage(hostOld);
fs.cpSync(path.join(root, "test", "fixtures", "host_interaction", "output_emit"), hostNew, { recursive: true });
const host = diff(hostOld, hostNew);
assert.strictEqual(host.status, "changed");
assert.strictEqual(host.hostAbiDelta.old, "0.10");
assert.strictEqual(host.hostAbiDelta.new, "0.11");
assert.strictEqual(host.hostAbiDelta.changed, true);
assert.deepStrictEqual(host.capabilityDelta.added, ["output"]);
assertDiffSafe(host);

console.log("package diff tests passed");
