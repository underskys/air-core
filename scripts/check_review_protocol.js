#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const defaultRoot = path.resolve(__dirname, "..");
const root = resolveRoot();

const bundleKinds = new Set(["core-release", "core-hygiene", "consumer-demo", "internal-dev"]);
const sourceRepos = new Set(["air-core", "airlang", "demo"]);
const targetRepos = new Set(["air-core", "airlang", "demo"]);
const semverPattern = /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/;
const internalSlicePattern = /^M[0-9]+-S[0-9]+$/;

const requiredTemplates = [
  "review_artifacts/templates/PRESSURE_REQUEST.md",
  "review_artifacts/templates/ARCHITECTURE_DECISION.md",
  "review_artifacts/templates/CHANGESET_SUMMARY.md",
  "review_artifacts/templates/QA_REPORT.md",
  "review_artifacts/templates/RELEASE_DECISION.md",
  "review_artifacts/templates/BUNDLE_MANIFEST.json"
];

const requiredSchemas = [
  "schemas/review/bundle_manifest.schema.json",
  "schemas/review/release_decision.schema.json",
  "schemas/review/qa_report.schema.json",
  "schemas/review/changeset_summary.schema.json"
];

const optionalPolicyFiles = [
  "docs/release/REVIEW_PROTOCOL.md",
  "docs/release/REPOSITORY_ROLES.md",
  "docs/release/BUNDLE_KINDS.md",
  "docs/release/INTERACTION_ARTIFACTS.md",
  "docs/release/RELEASE_VERSIONING_POLICY.md",
  "docs/release/NPM_PACKAGE_BOUNDARY.md"
];

const diagnostics = [];
const warnings = [];
const checkedTemplates = [];
const checkedSchemas = [];
const checkedBundles = [];

main();

function main() {
  validateRequiredFiles();
  validatePolicyDocs();
  validateSchemas();
  validateBundleManifests();
  validateForbiddenTrackedContent();
  validatePackageSurfaceBoundary();

  const summary = {
    kind: "air.reviewProtocolCheck",
    status: diagnostics.length === 0 ? "passed" : "failed",
    checkedTemplates,
    checkedSchemas,
    checkedBundles,
    diagnostics: diagnostics.sort(compareDiagnostic),
    warnings: warnings.sort(compareDiagnostic)
  };

  console.log(JSON.stringify(summary, null, 2));
  if (diagnostics.length > 0) process.exit(1);
}

function resolveRoot() {
  const args = process.argv.slice(2);
  const index = args.indexOf("--root");
  if (index !== -1 && args[index + 1]) return path.resolve(args[index + 1]);
  return defaultRoot;
}

function validateRequiredFiles() {
  for (const file of requiredTemplates) {
    checkedTemplates.push(file);
    if (!exists(file)) {
      addDiagnostic("air.review_protocol.missing_template", "required review artifact template is missing", file);
    }
  }
  for (const file of requiredSchemas) {
    checkedSchemas.push(file);
    if (!exists(file)) {
      addDiagnostic("air.review_protocol.missing_schema", "required review schema is missing", file);
    }
  }
}

function validatePolicyDocs() {
  const expectations = {
    "docs/release/REVIEW_PROTOCOL.md": [
      "artifact-based",
      "No release decision may be chat-memory-only",
      "Release manager",
      "Architecture reviewer",
      "QA reviewer",
      "Demo/consumer pressure owner",
      "Review bundles are artifacts"
    ],
    "docs/release/REPOSITORY_ROLES.md": [
      "air-core",
      "production",
      "airlang",
      "dev/private",
      "release source"
    ],
    "docs/release/BUNDLE_KINDS.md": [
      "core-release",
      "core-hygiene",
      "consumer-demo",
      "internal-dev",
      "Eligible for npm"
    ],
    "docs/release/INTERACTION_ARTIFACTS.md": [
      "PRESSURE_REQUEST.md",
      "ARCHITECTURE_DECISION.md",
      "CHANGESET_SUMMARY.md",
      "QA_REPORT.md",
      "RELEASE_DECISION.md",
      "BUNDLE_MANIFEST.json"
    ],
    "docs/release/RELEASE_VERSIONING_POLICY.md": [
      "M45-S1",
      "0.45.1",
      "Do not use npm patch versions for unpublished internal slices",
      "AIR ABI and Host ABI are independent version axes"
    ],
    "docs/release/NPM_PACKAGE_BOUNDARY.md": [
      "allowlisted",
      "Review bundles",
      "private prompts",
      "scripts/check_public_package_surface.js",
      "explicit package-surface decision"
    ]
  };

  for (const file of optionalPolicyFiles) {
    if (!exists(file)) continue;
    const text = read(file);
    for (const phrase of expectations[file] || []) {
      if (!text.includes(phrase)) {
        addDiagnostic("air.review_protocol.policy_gap", `policy file is missing required text: ${phrase}`, file);
      }
    }
  }
}

function validateSchemas() {
  for (const file of requiredSchemas) {
    if (!exists(file)) continue;
    let schema = null;
    try {
      schema = JSON.parse(read(file));
    } catch (error) {
      addDiagnostic("air.review_protocol.invalid_schema_json", error.message, file);
      continue;
    }

    for (const field of ["$id", "type", "required", "properties"]) {
      if (!(field in schema)) {
        addDiagnostic("air.review_protocol.schema_field_missing", `${path.basename(file)} is missing field: ${field}`, file);
      }
    }
  }
}

function validateBundleManifests() {
  const manifests = listFiles(root)
    .filter((file) => path.basename(file) === "BUNDLE_MANIFEST.json")
    .map(toRel)
    .filter((file) => !isTemplateManifest(file))
    .sort();

  for (const file of manifests) {
    checkedBundles.push(file);
    let manifest = null;
    try {
      manifest = JSON.parse(read(file));
    } catch (error) {
      addDiagnostic("air.review_protocol.invalid_bundle_manifest_json", error.message, file);
      continue;
    }
    validateBundleManifest(file, manifest);
  }
}

function validateBundleManifest(file, manifest) {
  const kind = manifest.kind || manifest.bundleKind;
  if (!bundleKinds.has(kind)) {
    addDiagnostic("air.review_protocol.invalid_bundle_kind", `invalid bundle kind: ${String(kind)}`, file);
  }

  if (!sourceRepos.has(manifest.sourceRepo)) {
    addDiagnostic("air.review_protocol.invalid_source_repo", `invalid sourceRepo: ${String(manifest.sourceRepo)}`, file);
  }

  if ("targetRepo" in manifest && !targetRepos.has(manifest.targetRepo)) {
    addDiagnostic("air.review_protocol.invalid_target_repo", `invalid targetRepo: ${String(manifest.targetRepo)}`, file);
  }

  for (const field of ["commit", "forbiddenContentCheck", "artifacts"]) {
    if (!(field in manifest)) {
      addDiagnostic("air.review_protocol.missing_bundle_field", `bundle manifest is missing field: ${field}`, file);
    }
  }

  if (typeof manifest.publicClean !== "boolean") {
    addDiagnostic("air.review_protocol.public_clean_missing", "bundle manifest must include boolean publicClean", file);
  }

  if (typeof manifest.npmEligible !== "boolean") {
    addDiagnostic("air.review_protocol.npm_eligible_missing", "bundle manifest must include boolean npmEligible", file);
  }

  const artifacts = Array.isArray(manifest.artifacts) ? manifest.artifacts : [];
  if (!Array.isArray(manifest.artifacts)) {
    addDiagnostic("air.review_protocol.artifact_list_missing", "bundle manifest artifacts must be an array", file);
  }

  validateRequiredArtifacts(file, kind, artifacts, manifest);
  validateRepositoryRules(file, kind, manifest);
  validateVersioning(file, manifest);
  validateForbiddenNpmArtifacts(file, manifest);
}

function validateRequiredArtifacts(file, kind, artifacts, manifest) {
  const requiredByKind = {
    "core-release": ["BUNDLE_MANIFEST.json", "CHANGESET_SUMMARY.md", "QA_REPORT.md", "RELEASE_DECISION.md"],
    "core-hygiene": ["BUNDLE_MANIFEST.json", "CHANGESET_SUMMARY.md", "QA_REPORT.md"],
    "consumer-demo": ["BUNDLE_MANIFEST.json", "PRESSURE_REQUEST.md"],
    "internal-dev": ["BUNDLE_MANIFEST.json", "CHANGESET_SUMMARY.md"]
  };

  for (const required of requiredByKind[kind] || []) {
    if (!artifacts.includes(required)) {
      addDiagnostic("air.review_protocol.required_artifact_missing", `${kind} bundle missing required artifact: ${required}`, file);
    }
  }

  if (kind === "consumer-demo" && !artifacts.includes("QA_REPORT.md") && !manifest.qaPendingReason) {
    addDiagnostic(
      "air.review_protocol.qa_missing",
      "consumer-demo bundle requires QA_REPORT.md or explicit qaPendingReason",
      file
    );
  }

  const dir = path.dirname(file);
  for (const artifact of artifacts) {
    if (artifact.includes("/") || artifact.includes("\\")) continue;
    if (!exists(path.join(dir, artifact))) {
      addWarning("air.review_protocol.artifact_not_present", `artifact is listed but not present beside manifest: ${artifact}`, file);
    }
  }
}

function validateRepositoryRules(file, kind, manifest) {
  if (kind === "core-release" && manifest.sourceRepo === "airlang") {
    addDiagnostic("air.review_protocol.core_release_from_airlang", "core-release bundle cannot use sourceRepo=airlang", file);
  }
  if (kind === "core-release" && manifest.publicClean === false) {
    addDiagnostic("air.review_protocol.core_release_not_public_clean", "core-release bundle cannot have publicClean=false", file);
  }
  if (kind === "consumer-demo" && manifest.npmEligible === true) {
    addDiagnostic("air.review_protocol.consumer_demo_npm_eligible", "consumer-demo bundle cannot be npm eligible", file);
  }
  if (kind === "internal-dev" && manifest.npmEligible === true) {
    addDiagnostic("air.review_protocol.internal_dev_npm_eligible", "internal-dev bundle cannot be npm eligible", file);
  }
}

function validateVersioning(file, manifest) {
  if ("internalSlice" in manifest && !internalSlicePattern.test(manifest.internalSlice)) {
    addDiagnostic("air.review_protocol.invalid_internal_slice", `invalid internalSlice: ${String(manifest.internalSlice)}`, file);
  }
  if ("publicVersion" in manifest && !semverPattern.test(manifest.publicVersion)) {
    addDiagnostic("air.review_protocol.invalid_public_version", `invalid publicVersion: ${String(manifest.publicVersion)}`, file);
  }
  if (manifest.releaseDecision === "publish" && !manifest.artifacts?.includes("RELEASE_DECISION.md")) {
    addDiagnostic("air.review_protocol.publish_without_release_decision", "npm publish decisions require RELEASE_DECISION.md", file);
  }
}

function validateForbiddenNpmArtifacts(file, manifest) {
  const npmContents = Array.isArray(manifest.npmContents) ? manifest.npmContents : [];
  const offenders = npmContents.filter(isForbiddenNpmContent);
  for (const offender of offenders) {
    addDiagnostic("air.review_protocol.forbidden_npm_content", `bundle lists forbidden npm content: ${offender}`, file);
  }
}

function validateForbiddenTrackedContent() {
  const files = trackedOrAllFiles().filter((file) => !isAllowedTemplatePath(file)).sort();
  for (const file of files) {
    if (isForbiddenTrackedContent(file)) {
      addDiagnostic("air.review_protocol.forbidden_tracked_artifact", "tracked source contains forbidden review/private/generated artifact", file);
    }
  }
}

function validatePackageSurfaceBoundary() {
  if (!exists("package.json")) return;
  let pkg = null;
  try {
    pkg = JSON.parse(read("package.json"));
  } catch (error) {
    addDiagnostic("air.review_protocol.invalid_package_json", error.message, "package.json");
    return;
  }

  for (const entry of Array.isArray(pkg.files) ? pkg.files : []) {
    if (isForbiddenNpmContent(entry) || entry === "review_artifacts" || entry.startsWith("review_artifacts/")) {
      addDiagnostic("air.review_protocol.package_files_forbidden", `package.json files includes review/private path: ${entry}`, "package.json");
    }
  }
}

function trackedOrAllFiles() {
  try {
    const out = execFileSync("git", ["ls-files", "-z"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    return out.split("\0").filter(Boolean).map(normalizeRel);
  } catch {
    return listFiles(root)
      .map(toRel)
      .filter((file) => !isGeneratedFallbackPath(file));
  }
}

function listFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = toRel(full);
    if (entry.isDirectory()) {
      if (entry.name === ".git") continue;
      if (entry.name === "node_modules") {
        out.push(full);
        continue;
      }
      listFiles(full, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function isForbiddenTrackedContent(file) {
  return (
    /^snapshots\/[^/]+\.zip$/i.test(file) ||
    /(^|\/)[^/]*airlang-review[^/]*\.zip$/i.test(file) ||
    file === "MOBILE_SUMMARY.md" ||
    file === "REVIEW_REQUEST.md" ||
    /(^|\/)(prompt[-_]?logs?|raw[-_]?prompt[-_]?logs?)(\/|$)/i.test(file) ||
    /(^|\/)(chat[-_]?transcripts?|raw[-_]?chat[-_]?transcripts?)(\/|$)/i.test(file) ||
    /(^|\/)(review[-_]?bundles?|REVIEW_RESULTS)(\/|$)/i.test(file) ||
    /\.tgz$/i.test(file) ||
    /(^|\/)node_modules(\/|$)/i.test(file) ||
    /(^|\/)(build|dist|tmp)(\/|$)/i.test(file)
  );
}

function isGeneratedFallbackPath(file) {
  return /(^|\/)(build|dist|tmp|node_modules|REVIEW_RESULTS|snapshots)(\/|$)/i.test(file);
}

function isForbiddenNpmContent(file) {
  return (
    /(^|\/)(review[-_]?bundles?|REVIEW_RESULTS)(\/|$)/i.test(file) ||
    /(^|\/)(snapshots|prompts|prompt[-_]?logs?|chat[-_]?transcripts?)(\/|$)/i.test(file) ||
    file === "MOBILE_SUMMARY.md" ||
    file === "REVIEW_REQUEST.md" ||
    /\.zip$/i.test(file) ||
    /\.tgz$/i.test(file) ||
    /(^|\/)node_modules(\/|$)/i.test(file) ||
    /(^|\/)(build|dist|tmp)(\/|$)/i.test(file)
  );
}

function isTemplateManifest(file) {
  return file === "review_artifacts/templates/BUNDLE_MANIFEST.json" ||
    file === "docs/release/artifact_templates/BUNDLE_MANIFEST.json";
}

function isAllowedTemplatePath(file) {
  return file.startsWith("review_artifacts/templates/") ||
    file.startsWith("docs/release/artifact_templates/") ||
    file.startsWith("schemas/review/");
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

function toRel(file) {
  return normalizeRel(path.relative(root, file));
}

function normalizeRel(file) {
  return file.replace(/\\/g, "/").replace(/^\.\//, "");
}

function addDiagnostic(code, message, file) {
  diagnostics.push({ code, message, file: normalizeRel(file) });
}

function addWarning(code, message, file) {
  warnings.push({ code, message, file: normalizeRel(file) });
}

function compareDiagnostic(a, b) {
  return a.code.localeCompare(b.code) || a.file.localeCompare(b.file) || a.message.localeCompare(b.message);
}
