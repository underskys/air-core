#!/usr/bin/env node

const assert = require("assert");
const cp = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const airc = path.join(root, "bin", "airc.js");
const tmpRoot = path.join(root, "build", "package-manifest-tests");

function run(args, options = {}) {
  return cp.execFileSync(process.execPath, [airc, ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options
  });
}

function assertFails(args, pattern) {
  assert.throws(() => run(args), pattern);
}

function copyDir(src, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
}

function writePackage(dir, manifest) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "module.air"), "module sample\nexport func run() -> i32 {\nentry:\n  %one:i32 = 1\n  return %one\n}\n");
  fs.writeFileSync(path.join(dir, "air.package.json"), JSON.stringify(manifest, null, 2));
}

function baseManifest(overrides = {}) {
  return {
    name: "sample",
    version: "0.1.0",
    airAbi: "0.10",
    hostAbi: "0.10",
    entry: "module.air",
    wasm: "module.wasm",
    capabilities: ["debug"],
    targetProfiles: ["cli"],
    ...overrides
  };
}

fs.rmSync(tmpRoot, { recursive: true, force: true });
fs.mkdirSync(tmpRoot, { recursive: true });

const sample = path.join(root, "examples", "package_manifest");
const manifestOut = run(["package-manifest-check", sample]);
assert.match(manifestOut, /^ok: /m);
assert.strictEqual(JSON.parse(manifestOut.trim().split("\n").at(-1)).name, "package-manifest-example");

const built = path.join(tmpRoot, "built");
copyDir(sample, built);
fs.writeFileSync(path.join(built, "module.wasm"), "placeholder wasm for built package-check\n");
const builtOut = run(["package-check", built]);
assert.match(builtOut, /^ok: /m);
assert.strictEqual(JSON.parse(builtOut.trim().split("\n").at(-1)).format, "air.package.json");

const missingEntry = path.join(tmpRoot, "missing-entry");
writePackage(missingEntry, baseManifest({ entry: "missing.air" }));
assertFails(["package-manifest-check", missingEntry], /entry does not exist: missing\.air/);

const unknownCapability = path.join(tmpRoot, "unknown-capability");
writePackage(unknownCapability, baseManifest({ capabilities: ["debug", "telepathy"] }));
assertFails(["package-manifest-check", unknownCapability], /unknown capability: telepathy/);

const unknownProfile = path.join(tmpRoot, "unknown-profile");
writePackage(unknownProfile, baseManifest({ targetProfiles: ["dream-host"] }));
assertFails(["package-manifest-check", unknownProfile], /unknown target profile: dream-host/);

const traversal = path.join(tmpRoot, "traversal");
writePackage(traversal, baseManifest({ manifests: { assets: "../assets.json" } }));
assertFails(["package-manifest-check", traversal], /manifests\.assets must not contain parent traversal/);

const generatedTraversal = path.join(tmpRoot, "generated-traversal");
writePackage(generatedTraversal, baseManifest({ generatedModules: ["../generated/assets.air"] }));
assertFails(["package-manifest-check", generatedTraversal], /generatedModules\[0\] must not contain parent traversal/);

const invalidAiReviewPolicy = path.join(tmpRoot, "invalid-ai-review-policy");
writePackage(invalidAiReviewPolicy, baseManifest({ aiReview: { thresholds: { maxExportedEntryStatements: -1 }, failOn: ["entry-frame-budget"] } }));
assertFails(["package-manifest-check", invalidAiReviewPolicy], /aiReview\.thresholds\.maxExportedEntryStatements must be a non-negative number/);

const invalidReviewPolicyWaiver = path.join(tmpRoot, "invalid-review-policy-waiver");
writePackage(invalidReviewPolicyWaiver, baseManifest({ reviewPolicy: { waivers: [{ code: "air.review.large_function" }] } }));
assertFails(["package-manifest-check", invalidReviewPolicyWaiver], /reviewPolicy\.waivers\[0\]\.reason is required/);

const builtMissingWasm = path.join(tmpRoot, "built-missing-wasm");
writePackage(builtMissingWasm, baseManifest());
assertFails(["package-check", builtMissingWasm], /wasm does not exist: module\.wasm/);
const missingWasmProfile = cp.spawnSync(process.execPath, [airc, "package-check", builtMissingWasm, "--profile", "cli", "--json"], {
  cwd: root,
  encoding: "utf8"
});
assert.notStrictEqual(missingWasmProfile.status, 0);
const missingWasmReport = JSON.parse(missingWasmProfile.stdout);
assert(missingWasmReport.repairHints.some((hint) => /node bin\/airc\.js build <entry\.air> --emit wasm -o <path>/.test(hint)));
const sourceOnlyMissingWasm = JSON.parse(run(["package-check", builtMissingWasm, "--profile", "cli", "--source-only", "--json"]));
assert.strictEqual(sourceOnlyMissingWasm.mode, "source");
assert.strictEqual(sourceOnlyMissingWasm.status, "warn");
assert(sourceOnlyMissingWasm.checks.some((check) => check.id === "wasm" && check.status === "skip" && /source\/audit mode/.test(check.message)));
assert.deepStrictEqual(sourceOnlyMissingWasm.declaredCapabilities, ["debug"]);
assert.deepStrictEqual(sourceOnlyMissingWasm.computedCapabilities, []);

console.log("ok: package manifest tests");
