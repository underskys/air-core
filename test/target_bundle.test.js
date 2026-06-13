#!/usr/bin/env node

const assert = require("assert");
const cp = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const airc = path.join(root, "bin", "airc.js");
const tmp = path.join(root, "build", "target-bundle-tests");

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

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
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
const airpkg = path.join(tmp, "policy.airpkg.json");
run(["package", policyPackage, "-o", airpkg, "--profile", "cli"]);

const webDev = path.join(tmp, "web-dev");
const nativeDev = path.join(tmp, "native-dev");
run(["bundle", airpkg, "--target", "web-dev", "-o", webDev]);
run(["bundle", airpkg, "--target", "native-dev", "-o", nativeDev]);

for (const [dir, target] of [[webDev, "web-dev"], [nativeDev, "native-dev"]]) {
  const bundle = readJson(path.join(dir, "bundle.json"));
  assert.strictEqual(bundle.schemaVersion, "0.17");
  assert.strictEqual(bundle.kind, "air.targetBundle");
  assert.strictEqual(bundle.target, target);
  assert.strictEqual(bundle.package.name, "policy-audit-package");
  assert.strictEqual(bundle.package.airpkg.path, "airpkg.json");
  assert.match(bundle.package.airpkg.hash, /^sha256:[a-f0-9]{64}$/);
  assert.strictEqual(bundle.hostProfile.id, "cli");
  assert.strictEqual(bundle.hostProfile.path, "host_profile.json");
  assert.strictEqual(bundle.linkedOutput.status, "planned");
  assert.deepStrictEqual(bundle.boundary.runtimeRequires, []);
  assert(fs.existsSync(path.join(dir, "airpkg.json")));
  assert(fs.existsSync(path.join(dir, "host_profile.json")));
  assert(fs.existsSync(path.join(dir, "README.md")));
  assertNoAbsolutePaths(bundle);
  assertNoTimestampLikeFields(bundle);
  const checkText = run(["check-bundle", dir, "--json"]);
  assert.strictEqual(run(["check-bundle", dir, "--json"]), checkText);
  const check = JSON.parse(checkText);
  assert.strictEqual(check.schemaVersion, "0.17");
  assert.strictEqual(check.kind, "air.targetBundle.validation");
  assert.strictEqual(check.status, "pass");
  assert.deepStrictEqual(check.diagnostics, []);
  assertNoAbsolutePaths(check);
  assertNoTimestampLikeFields(check);
}

const webDevAgain = path.join(tmp, "web-dev-again");
run(["bundle", airpkg, "--target", "web-dev", "-o", webDevAgain]);
assert.strictEqual(
  fs.readFileSync(path.join(webDev, "bundle.json"), "utf8"),
  fs.readFileSync(path.join(webDevAgain, "bundle.json"), "utf8")
);

const linkedPackage = path.join(tmp, "policy-linked");
fs.cpSync(policyPackage, linkedPackage, { recursive: true });
run(["build", "package", linkedPackage, "--linked-wasm", "--profile", "cli", "-o", path.join(linkedPackage, "policy.linked.wasm")]);
const linkedManifest = readJson(path.join(linkedPackage, "air.package.json"));
linkedManifest.wasm = "policy.linked.wasm";
writeJson(path.join(linkedPackage, "air.package.json"), linkedManifest);
const linkedAirpkg = path.join(linkedPackage, "policy.airpkg.json");
run(["package", linkedPackage, "-o", linkedAirpkg, "--profile", "cli"]);
const linkedBundleDir = path.join(tmp, "linked-web-dev");
run(["bundle", linkedAirpkg, "--target", "web-dev", "-o", linkedBundleDir]);
const linkedBundle = readJson(path.join(linkedBundleDir, "bundle.json"));
assert.strictEqual(linkedBundle.linkedOutput.status, "available");
assert.strictEqual(linkedBundle.linkedOutput.kind, "wasm");
assert.strictEqual(linkedBundle.linkedOutput.path, "linked.wasm");
assert.match(linkedBundle.linkedOutput.hash, /^sha256:[a-f0-9]{64}$/);
assert(fs.existsSync(path.join(linkedBundleDir, "linked.wasm")));
assert.strictEqual(JSON.parse(run(["check-bundle", linkedBundleDir, "--json"])).status, "pass");

const missingLinkedDir = path.join(tmp, "missing-linked");
fs.cpSync(linkedBundleDir, missingLinkedDir, { recursive: true });
fs.rmSync(path.join(missingLinkedDir, "linked.wasm"));
const missingLinked = statusJson(["check-bundle", missingLinkedDir, "--json"]);
assert.notStrictEqual(missingLinked.result.status, 0);
assertDiagnostic(missingLinked.json, "air.bundle.missing_file");

const hashMismatchDir = path.join(tmp, "hash-mismatch");
fs.cpSync(linkedBundleDir, hashMismatchDir, { recursive: true });
fs.appendFileSync(path.join(hashMismatchDir, "linked.wasm"), "\nchanged\n");
const hashMismatch = statusJson(["check-bundle", hashMismatchDir, "--json"]);
assert.notStrictEqual(hashMismatch.result.status, 0);
assertDiagnostic(hashMismatch.json, "air.bundle.hash_mismatch");

const absolutePathDir = path.join(tmp, "absolute-path");
fs.cpSync(webDev, absolutePathDir, { recursive: true });
const absoluteBundle = readJson(path.join(absolutePathDir, "bundle.json"));
absoluteBundle.package.airpkg.path = path.join(root, "airpkg.json");
writeJson(path.join(absolutePathDir, "bundle.json"), absoluteBundle);
const absolutePath = statusJson(["check-bundle", absolutePathDir, "--json"]);
assert.notStrictEqual(absolutePath.result.status, 0);
assertDiagnostic(absolutePath.json, "air.bundle.absolute_path");

const runtimeBoundaryDir = path.join(tmp, "runtime-boundary");
fs.cpSync(webDev, runtimeBoundaryDir, { recursive: true });
const runtimeBundle = readJson(path.join(runtimeBoundaryDir, "bundle.json"));
runtimeBundle.boundary.runtimeRequires = ["Node", "Python"];
writeJson(path.join(runtimeBoundaryDir, "bundle.json"), runtimeBundle);
const runtimeBoundary = statusJson(["check-bundle", runtimeBoundaryDir, "--json"]);
assert.notStrictEqual(runtimeBoundary.result.status, 0);
assertDiagnostic(runtimeBoundary.json, "air.bundle.runtime_boundary_violation");

console.log("ok: target bundle tests");
