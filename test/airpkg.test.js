#!/usr/bin/env node

const assert = require("assert");
const cp = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const airc = path.join(root, "bin", "airc.js");
const tmp = path.join(root, "build", "airpkg-tests");

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

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function statusJson(args) {
  const result = runStatus(args);
  assert(result.stdout, result.stderr);
  return { result, json: JSON.parse(result.stdout) };
}

function assertDiagnostic(report, code) {
  assert(report.diagnostics.some((item) => item.code === code), `expected diagnostic ${code}`);
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
    if (key && /timestamp|createdAt|updatedAt|generatedAt|date/i.test(key)) offenders.push(key);
  });
  assert.deepStrictEqual(offenders, []);
}

fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });

const policyPackage = path.join(root, "examples", "policy_audit_package");
const outA = path.join(tmp, "policy-a.airpkg.json");
const outB = path.join(tmp, "policy-b.airpkg.json");

run(["package", policyPackage, "-o", outA, "--profile", "cli"]);
run(["package", policyPackage, "-o", outB, "--profile", "cli"]);

const firstText = fs.readFileSync(outA, "utf8");
const secondText = fs.readFileSync(outB, "utf8");
assert.strictEqual(firstText, secondText);

const artifact = readJson(outA);
assert.strictEqual(artifact.schemaVersion, "0.16");
assert.strictEqual(artifact.kind, "airpkg");
assert.strictEqual(artifact.package.name, "policy-audit-package");
assert.strictEqual(artifact.abi.airAbiRequired, "0.10");
assert.strictEqual(artifact.abi.hostAbiRequired, "0.10");
assert.strictEqual(artifact.abi.airAbiBumpRequired, false);
assert.strictEqual(artifact.abi.hostAbiBumpRequired, false);
assert.strictEqual(artifact.linkedWasm.enabled, false);
assert.strictEqual(artifact.linkedWasm.status, "deferred");
assert.strictEqual(artifact.linkedOutput.status, "planned");
assert.strictEqual(artifact.linkedOutput.kind, "link-plan");
assert.strictEqual(artifact.linkedOutput.hash, null);
assert.match(artifact.linkedOutput.linkPlanHash, /^sha256:[a-f0-9]{64}$/);
assert.match(artifact.linkedOutput.sourceGraphHash, /^sha256:[a-f0-9]{64}$/);
assert.deepStrictEqual(artifact.linkedOutput.moduleOrder, ["main.air", "allowlist.air"]);
assert.deepStrictEqual(artifact.linkedOutput.packageExports.map((item) => item.name), [
  "is_service_allowed",
  "policy_score",
  "service_retry_budget_ms"
]);
assert.deepStrictEqual(artifact.linkedOutput.hostImports.used, []);
assert.deepStrictEqual(artifact.linkedOutput.capabilities.required, []);
assert.strictEqual(artifact.linkedOutput.abiImpact.airAbi, "0.10");
assert.strictEqual(artifact.linkedOutput.abiImpact.hostAbi, "0.10");
assert.strictEqual(artifact.linkedOutput.linkedWasm, false);
assert.deepStrictEqual(artifact.boundary.runtimeRequires, []);
assert(!artifact.boundary.runtimeRequires.includes("Node"));
assert(!artifact.boundary.runtimeRequires.includes("Python"));
assert.deepStrictEqual(artifact.hostProfiles.compatible, ["cli"]);
assert(artifact.package.manifestFingerprint.startsWith("sha256:"));
assert(artifact.sourceGraph.fingerprint.startsWith("sha256:"));
assertNoAbsolutePaths(artifact);
assertNoTimestampLikeFields(artifact);

const inspectText = run(["inspect-airpkg", outA]);
assert.strictEqual(inspectText, firstText);
const checkText = run(["check-airpkg", outA, "--profile", "cli", "--json"]);
assert.strictEqual(run(["check-airpkg", outA, "--profile", "cli", "--json"]), checkText);
const checkReport = JSON.parse(checkText);
assert.strictEqual(checkReport.schemaVersion, "0.17");
assert.strictEqual(checkReport.kind, "airpkg.validation");
assert.strictEqual(checkReport.status, "pass");
assert.strictEqual(checkReport.artifact.package, "policy-audit-package");
assert.strictEqual(checkReport.artifact.schemaVersion, "0.16");
assert.strictEqual(checkReport.profile, "cli");
assert.deepStrictEqual(checkReport.diagnostics, []);
assertNoAbsolutePaths(checkReport);
assertNoTimestampLikeFields(checkReport);

const dirOut = path.join(tmp, "policy-dir.airpkg");
run(["package", policyPackage, "-o", dirOut, "--profile", "cli"]);
assert(fs.existsSync(path.join(dirOut, "airpkg.json")));
assert.deepStrictEqual(JSON.parse(run(["inspect-airpkg", dirOut])), artifact);

const linkedPackage = path.join(tmp, "policy-linked");
fs.cpSync(policyPackage, linkedPackage, { recursive: true });
run(["build", "package", linkedPackage, "--linked-wasm", "--profile", "cli", "-o", path.join(linkedPackage, "policy.linked.wasm")]);
const linkedManifest = readJson(path.join(linkedPackage, "air.package.json"));
linkedManifest.wasm = "policy.linked.wasm";
fs.writeFileSync(path.join(linkedPackage, "air.package.json"), JSON.stringify(linkedManifest, null, 2));
const linkedOut = path.join(tmp, "policy-linked.airpkg.json");
run(["package", linkedPackage, "-o", linkedOut, "--profile", "cli"]);
const linkedArtifact = readJson(linkedOut);
assert.strictEqual(linkedArtifact.linkedOutput.status, "available");
assert.strictEqual(linkedArtifact.linkedOutput.kind, "wasm");
assert.strictEqual(linkedArtifact.linkedOutput.path, "policy.linked.wasm");
assert.match(linkedArtifact.linkedOutput.hash, /^sha256:[a-f0-9]{64}$/);
assert.strictEqual(linkedArtifact.linkedOutput.linkedWasm, true);
assert.deepStrictEqual(JSON.parse(run(["inspect-airpkg", linkedOut])).linkedOutput, linkedArtifact.linkedOutput);
assertNoAbsolutePaths(linkedArtifact);
assertNoTimestampLikeFields(linkedArtifact);
fs.copyFileSync(path.join(linkedPackage, linkedArtifact.linkedOutput.path), path.join(tmp, linkedArtifact.linkedOutput.path));
assert.strictEqual(JSON.parse(run(["check-airpkg", linkedOut, "--profile", "cli", "--json"])).status, "pass");

const invalidJson = path.join(tmp, "invalid.airpkg.json");
fs.writeFileSync(invalidJson, "{ nope\n");
const invalidJsonReport = statusJson(["check-airpkg", invalidJson, "--json"]);
assert.notStrictEqual(invalidJsonReport.result.status, 0);
assertDiagnostic(invalidJsonReport.json, "air.artifact.schema_invalid");

const missingLinkedArtifact = cloneJson(linkedArtifact);
missingLinkedArtifact.linkedOutput.path = "missing.linked.wasm";
const missingLinkedOut = path.join(tmp, "missing-linked.airpkg.json");
writeJson(missingLinkedOut, missingLinkedArtifact);
const missingLinkedReport = statusJson(["check-airpkg", missingLinkedOut, "--json"]);
assert.notStrictEqual(missingLinkedReport.result.status, 0);
assertDiagnostic(missingLinkedReport.json, "air.artifact.missing_linked_output");

const mismatchArtifact = cloneJson(linkedArtifact);
mismatchArtifact.linkedOutput.hash = `sha256:${"0".repeat(64)}`;
const mismatchOut = path.join(tmp, "hash-mismatch.airpkg.json");
writeJson(mismatchOut, mismatchArtifact);
const mismatchReport = statusJson(["check-airpkg", mismatchOut, "--json"]);
assert.notStrictEqual(mismatchReport.result.status, 0);
assertDiagnostic(mismatchReport.json, "air.artifact.hash_mismatch");

const absolutePathArtifact = cloneJson(artifact);
absolutePathArtifact.package.manifestPath = path.join(root, "air.package.json");
const absolutePathOut = path.join(tmp, "absolute-path.airpkg.json");
writeJson(absolutePathOut, absolutePathArtifact);
const absolutePathReport = statusJson(["check-airpkg", absolutePathOut, "--json"]);
assert.notStrictEqual(absolutePathReport.result.status, 0);
assertDiagnostic(absolutePathReport.json, "air.artifact.absolute_path");

const runtimeBoundaryArtifact = cloneJson(artifact);
runtimeBoundaryArtifact.boundary.runtimeRequires = ["Node", "Python"];
const runtimeBoundaryOut = path.join(tmp, "runtime-boundary.airpkg.json");
writeJson(runtimeBoundaryOut, runtimeBoundaryArtifact);
const runtimeBoundaryReport = statusJson(["check-airpkg", runtimeBoundaryOut, "--json"]);
assert.notStrictEqual(runtimeBoundaryReport.result.status, 0);
assertDiagnostic(runtimeBoundaryReport.json, "air.artifact.runtime_boundary_violation");

const profileMismatchArtifact = cloneJson(artifact);
profileMismatchArtifact.abi.hostAbiRequired = "9.99";
const profileMismatchOut = path.join(tmp, "profile-mismatch.airpkg.json");
writeJson(profileMismatchOut, profileMismatchArtifact);
const profileMismatchReport = statusJson(["check-airpkg", profileMismatchOut, "--profile", "cli", "--json"]);
assert.notStrictEqual(profileMismatchReport.result.status, 0);
assertDiagnostic(profileMismatchReport.json, "air.artifact.profile_mismatch");

const missing = runStatus(["package", path.join(tmp, "missing-package"), "-o", path.join(tmp, "missing.airpkg.json"), "--profile", "cli"]);
assert.notStrictEqual(missing.status, 0);
assert.match(missing.stderr, /missing air\.package\.json/);

const minimalSource = path.join(root, "test", "fixtures", "package_minimal");
const minimalCopy = path.join(tmp, "package-minimal-stale");
fs.cpSync(minimalSource, minimalCopy, { recursive: true });
fs.appendFileSync(path.join(minimalCopy, "generated", "assets.air"), "\n# stale for airpkg test\n");
const staleOut = path.join(tmp, "stale.airpkg.json");
const stale = runStatus(["package", minimalCopy, "-o", staleOut, "--profile", "browser-webgpu"]);
assert.notStrictEqual(stale.status, 0);
const staleArtifact = readJson(staleOut);
assert.strictEqual(staleArtifact.report.packageStatus, "fail");
assert.strictEqual(
  staleArtifact.generatedArtifacts.generatedHandles.files.find((item) => item.path === "generated/assets.air").status,
  "stale"
);
assert(staleArtifact.report.diagnosticsSummary.byCode["air.generated.stale"] >= 1);
assertNoAbsolutePaths(staleArtifact);
assertNoTimestampLikeFields(staleArtifact);

console.log("ok: airpkg tests");
