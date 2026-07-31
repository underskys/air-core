#!/usr/bin/env node
"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { writeAirpkgArtifact } = require("../src/airpkg");
const { createEvidenceMarkdownReport } = require("../src/evidence_report");
const { parseAir } = require("../src/parser");
const {
  checkPackageDir,
  createPackageResourceCertificate
} = require("../src/sdk");
const {
  checkTargetBundle,
  createTargetBundle
} = require("../src/target_bundle");
const {
  createVerifiedResourceCertificate,
  validateVerifiedResourceCertificate,
  verifyModule
} = require("../src/verifier");
const {
  createPackageVerificationEvidence,
  stableStringify
} = require("../src/verification_evidence");

const root = path.resolve(__dirname, "..");
const example = path.join(root, "examples", "resource_certificate");
const tmp = path.join(root, "build", "verified-resource-certificate-tests");

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function copyPackage(name) {
  const target = path.join(tmp, name);
  fs.cpSync(example, target, { recursive: true });
  return target;
}

function sha256(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function hasDiagnostic(report, code) {
  return (report.diagnostics || []).some((item) => item.code === code);
}

fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });

const certificate = createPackageResourceCertificate(example, { profile: "cli" });
const repeated = createPackageResourceCertificate(example, { profile: "cli" });
assert.strictEqual(stableStringify(certificate), stableStringify(repeated));
assert.strictEqual(certificate.schemaVersion, "1.0");
assert.strictEqual(certificate.kind, "air.verifiedResourceCertificate");
assert.strictEqual(certificate.status, "verified");
assert.strictEqual(certificate.mode, "required");
assert.strictEqual(certificate.requiredBoundsSatisfied, true);
assert.match(certificate.verifier.digest, /^sha256:[a-f0-9]{64}$/);
assert.match(certificate.package.digest, /^sha256:[a-f0-9]{64}$/);
assert.match(certificate.certificateDigest, /^sha256:[a-f0-9]{64}$/);
assert.strictEqual(certificate.bounds.loops.maximumStaticallyBoundedIterations, 4);
assert.strictEqual(certificate.bounds.loops.totalStaticallyBoundedIterations, 4);
assert.strictEqual(certificate.bounds.loops.totalDynamicLoopFuelUpperBound, 0);
assert.strictEqual(certificate.bounds.memory.status, "verified");
assert.strictEqual(certificate.bounds.memory.dynamicAllocationBytesUpperBound, 0);
assert.strictEqual(certificate.bounds.hostCalls.totalUpperBound, 1);
assert.strictEqual(certificate.bounds.outputs.totalHostCallUpperBound, 0);
assert.deepStrictEqual(certificate.bounds.outputs.hostCallUpperBounds, []);
assert.deepStrictEqual(certificate.bounds.outputs.declaredBudgets, []);
assert.deepStrictEqual(certificate.bounds.hostCalls.byCapability, [
  { capability: "debug", upperBound: 1 }
]);
assert(certificate.classifications.verified.some((item) => item.category === "loops"));
assert(certificate.classifications.verified.some((item) => item.category === "outputs"));
assert(certificate.classifications.declared.some((item) => item.key === "debug.metric"));
assert.deepStrictEqual(certificate.classifications.unknown, []);
assert(certificate.classifications.unsupported.some((item) => item.code === "host_enforcement_separate"));
assert.strictEqual(certificate.hostEnforcement, "separate");
assert.strictEqual(validateVerifiedResourceCertificate(certificate, {
  required: true,
  packageName: "verified-resource-certificate-example",
  packageDigest: certificate.package.digest,
  verifierDigest: certificate.verifier.digest
}).status, "pass");
assert.strictEqual(validateVerifiedResourceCertificate(certificate).status, "pass");

const unknownOptionValidation = validateVerifiedResourceCertificate(certificate, {
  unexpectedOption: true
});
assert.strictEqual(unknownOptionValidation.status, "fail");
assert(unknownOptionValidation.diagnostics.some((item) =>
  item.code === "air.resource_certificate.option_unknown" &&
  item.fields.option === "unexpectedOption"));

const misspelledDigestValidation = validateVerifiedResourceCertificate(certificate, {
  expectedPackageDigest: certificate.package.digest
});
assert.strictEqual(misspelledDigestValidation.status, "fail");
assert(misspelledDigestValidation.diagnostics.some((item) =>
  item.code === "air.resource_certificate.option_unknown" &&
  item.fields.option === "expectedPackageDigest"));

const inheritedOptionPrototype = {};
Object.defineProperty(inheritedOptionPrototype, "packageDigest", {
  enumerable: false,
  value: certificate.package.digest
});
const inheritedOptions = Object.create(inheritedOptionPrototype);
const inheritedOptionValidation = validateVerifiedResourceCertificate(certificate, inheritedOptions);
assert.strictEqual(inheritedOptionValidation.status, "fail");
assert(inheritedOptionValidation.diagnostics.some((item) =>
  item.code === "air.resource_certificate.option_unknown" &&
  item.fields.option === "packageDigest"));

const dynamicSourcePath = path.join(root, "examples", "dynamic_collections.air");
const dynamicSource = fs.readFileSync(dynamicSourcePath, "utf8");
const dynamicModule = parseAir(dynamicSource, dynamicSourcePath);
const dynamicCertificate = createVerifiedResourceCertificate(dynamicModule, {
  packageName: "dynamic-collections",
  modulePath: "dynamic_collections.air",
  moduleDigest: sha256(dynamicSource),
  mode: "required"
});
assert.strictEqual(dynamicCertificate.requiredBoundsSatisfied, true);
assert.strictEqual(dynamicCertificate.bounds.loops.maximumDynamicLoopFuel, 3);
assert.strictEqual(dynamicCertificate.bounds.loops.totalDynamicLoopFuelUpperBound, 3);
assert.strictEqual(dynamicCertificate.bounds.loops.maximumStaticallyBoundedIterations, 1);
assert.strictEqual(dynamicCertificate.bounds.memory.totalStaticBytesUpperBound, 16);

const outputSource = `module output_certificate
capabilities { output }
effects { output.emit <= 1 }

extern output.emit(output_id: i32, arg0: i32, arg1: i32, arg2: i32, arg3: i32) -> i32

export func run() -> i32 {
entry:
  %status:i32 = @output.emit(1, 7, 0, 0, 0)
  return %status
}
`;
const outputModule = parseAir(outputSource, "output_certificate.air");
verifyModule(outputModule);
const outputCertificate = createVerifiedResourceCertificate(outputModule, {
  packageName: "output-certificate",
  modulePath: "output_certificate.air",
  moduleDigest: sha256(outputSource)
});
assert.strictEqual(outputCertificate.bounds.outputs.totalHostCallUpperBound, 1);
assert.deepStrictEqual(outputCertificate.bounds.outputs.hostCallUpperBounds, [{
  capability: "output",
  dynamicBoundUsed: false,
  effect: "output.emit",
  upperBound: 1
}]);
assert.deepStrictEqual(outputCertificate.bounds.outputs.declaredBudgets, [{
  key: "output.emit",
  limit: 1,
  module: "output_certificate.air",
  op: "<=",
  scope: "module"
}]);

const tampered = JSON.parse(JSON.stringify(certificate));
tampered.bounds.loops.maximumStaticallyBoundedIterations = 4000;
const tamperedValidation = validateVerifiedResourceCertificate(tampered);
assert.strictEqual(tamperedValidation.status, "fail");
assert(tamperedValidation.diagnostics.some((item) => item.code === "air.resource_certificate.digest_mismatch"));

const substitutedValidation = validateVerifiedResourceCertificate(certificate, {
  packageDigest: `sha256:${"f".repeat(64)}`
});
assert.strictEqual(substitutedValidation.status, "fail");
assert(substitutedValidation.diagnostics.some((item) => item.code === "air.resource_certificate.package_substitution"));

const changedPackage = copyPackage("changed-package");
fs.appendFileSync(path.join(changedPackage, "module.air"), "\n# exact source identity changed\n");
const changedCertificate = createPackageResourceCertificate(changedPackage, { profile: "cli" });
assert.notStrictEqual(changedCertificate.package.digest, certificate.package.digest);
assert.notStrictEqual(changedCertificate.certificateDigest, certificate.certificateDigest);
assert.strictEqual(validateVerifiedResourceCertificate(certificate, {
  packageDigest: changedCertificate.package.digest
}).status, "fail");

const verifierMismatch = copyPackage("verifier-mismatch");
const verifierMismatchManifest = JSON.parse(fs.readFileSync(path.join(verifierMismatch, "air.package.json"), "utf8"));
verifierMismatchManifest.resourceCertificate.verifierDigest = `sha256:${"1".repeat(64)}`;
writeJson(path.join(verifierMismatch, "air.package.json"), verifierMismatchManifest);
const verifierMismatchReport = checkPackageDir(verifierMismatch, { profile: "cli", built: false });
assert.strictEqual(verifierMismatchReport.status, "fail");
assert(hasDiagnostic(verifierMismatchReport, "air.resource_certificate.verifier_mismatch"));

const manifestMismatch = copyPackage("manifest-mismatch");
const manifestMismatchManifest = JSON.parse(fs.readFileSync(path.join(manifestMismatch, "air.package.json"), "utf8"));
manifestMismatchManifest.resourceCertificate.certificateDigest = `sha256:${"2".repeat(64)}`;
writeJson(path.join(manifestMismatch, "air.package.json"), manifestMismatchManifest);
const manifestMismatchReport = checkPackageDir(manifestMismatch, { profile: "cli", built: false });
assert.strictEqual(manifestMismatchReport.status, "fail");
assert(hasDiagnostic(manifestMismatchReport, "air.resource_certificate.manifest_mismatch"));

const packageMismatch = copyPackage("package-mismatch");
const packageMismatchManifest = JSON.parse(fs.readFileSync(path.join(packageMismatch, "air.package.json"), "utf8"));
packageMismatchManifest.resourceCertificate.packageDigest = `sha256:${"3".repeat(64)}`;
writeJson(path.join(packageMismatch, "air.package.json"), packageMismatchManifest);
const packageMismatchReport = checkPackageDir(packageMismatch, { profile: "cli", built: false });
assert.strictEqual(packageMismatchReport.status, "fail");
assert(hasDiagnostic(packageMismatchReport, "air.resource_certificate.package_substitution"));

const invalidPolicy = copyPackage("invalid-policy");
const invalidPolicyManifest = JSON.parse(fs.readFileSync(path.join(invalidPolicy, "air.package.json"), "utf8"));
invalidPolicyManifest.resourceCertificate.requiredBounds = ["telepathy"];
writeJson(path.join(invalidPolicy, "air.package.json"), invalidPolicyManifest);
const invalidPolicyReport = checkPackageDir(invalidPolicy, { profile: "cli", built: false });
assert.strictEqual(invalidPolicyReport.status, "fail");
assert(invalidPolicyReport.errors.some((item) => item.includes("resourceCertificate.requiredBounds")));

const unknownMemory = path.join(tmp, "unknown-memory");
fs.mkdirSync(unknownMemory, { recursive: true });
writeJson(path.join(unknownMemory, "air.package.json"), {
  name: "unknown-memory",
  version: "0.1.0",
  airAbi: "0.10",
  hostAbi: "0.10",
  entry: "module.air",
  capabilities: [],
  targetProfiles: ["cli"],
  resourceCertificate: {
    mode: "required",
    requiredBounds: ["memory"]
  }
});
fs.writeFileSync(path.join(unknownMemory, "module.air"), `module unknown_memory
capabilities { }
effects { memory.alloc <= 1, memory.free <= 1, memory.dynamic_allocations <= 1 }

export func run(bytes: i32) -> i32 {
entry:
  %ptr:ptr = alloc_region %bytes
  free_region %ptr
  return %bytes
}
`);
const requiredUnknownReport = checkPackageDir(unknownMemory, { profile: "cli", built: false });
assert.strictEqual(requiredUnknownReport.status, "fail");
assert(hasDiagnostic(requiredUnknownReport, "air.resource_certificate.required_bound_unknown"));
assert.strictEqual(requiredUnknownReport.resourceCertificate.status, "incomplete");
assert.strictEqual(requiredUnknownReport.resourceCertificate.bounds.memory.status, "unknown");

const optionalPackage = path.join(root, "examples", "policy_audit_package");
const optionalReport = checkPackageDir(optionalPackage, { profile: "cli", built: false });
assert.strictEqual(optionalReport.status, "pass");
assert.strictEqual(optionalReport.resourceCertificate.mode, "optional");

const evidence = createPackageVerificationEvidence(example, {
  profile: "cli",
  certificateRequired: true
});
assert.strictEqual(evidence.status, "passed");
assert.strictEqual(evidence.resourceCertificate.certificateDigest, certificate.certificateDigest);
assert.strictEqual(evidence.resourceCertificate.package.digest, certificate.package.digest);

const markdown = createEvidenceMarkdownReport(example, {
  profile: "cli",
  certificateRequired: true
});
assert(markdown.includes("## Verified Resource Certificate"));
assert(markdown.includes(certificate.certificateDigest));
assert(markdown.includes("Separate host responsibility"));

const airpkg = path.join(tmp, "example.airpkg.json");
writeAirpkgArtifact(example, airpkg, { profile: "cli" });
const bundleDir = path.join(tmp, "target-bundle");
createTargetBundle(airpkg, bundleDir, {
  target: "web-dev",
  resourceCertificate: certificate
});
const bundleReport = checkTargetBundle(bundleDir);
assert.strictEqual(bundleReport.status, "pass");
const bundle = JSON.parse(fs.readFileSync(path.join(bundleDir, "bundle.json"), "utf8"));
assert.strictEqual(bundle.resourceCertificate.certificateDigest, certificate.certificateDigest);
assert.strictEqual(bundle.resourceCertificate.packageDigest, certificate.package.digest);
assert.strictEqual(bundle.resources[0].kind, "verified-resource-certificate");

const substitutedBundle = path.join(tmp, "substituted-bundle");
fs.cpSync(bundleDir, substitutedBundle, { recursive: true });
const substitutedBundleJson = JSON.parse(fs.readFileSync(path.join(substitutedBundle, "bundle.json"), "utf8"));
const changedText = `${stableStringify(changedCertificate)}\n`;
fs.writeFileSync(path.join(substitutedBundle, "resource_certificate.json"), changedText);
substitutedBundleJson.resources[0].hash = sha256(changedText);
substitutedBundleJson.resourceCertificate.hash = sha256(changedText);
substitutedBundleJson.resourceCertificate.certificateDigest = changedCertificate.certificateDigest;
substitutedBundleJson.resourceCertificate.packageDigest = changedCertificate.package.digest;
writeJson(path.join(substitutedBundle, "bundle.json"), substitutedBundleJson);
const substitutedBundleReport = checkTargetBundle(substitutedBundle);
assert.strictEqual(substitutedBundleReport.status, "fail");
assert(hasDiagnostic(substitutedBundleReport, "air.resource_certificate.package_substitution"));

console.log("verified resource certificate tests passed");
