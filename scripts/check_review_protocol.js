#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

function addDiagnostic(diagnostics, code, message, file) {
  diagnostics.push({ code, message, file });
}

function includesAll(text, needles) {
  return needles.filter((needle) => !text.includes(needle));
}

const diagnostics = [];

const requiredFiles = [
  "docs/release/ARTIFACT_REVIEW_PROTOCOL.md",
  "docs/release/REVIEW_PROTOCOL.md",
  "docs/release/RELEASE_LANES.md",
  "docs/release/BUNDLE_POLICY.md",
  "docs/release/BUNDLE_KINDS.md",
  "docs/release/RELEASE_VERSIONING_POLICY.md",
  "docs/release/NPM_PACKAGE_BOUNDARY.md",
  "docs/release/BUNDLE_MANIFEST_TEMPLATE.md",
  "docs/release/BUNDLE_MANIFEST_TEMPLATE.json",
  "docs/release/INTERACTION_ARTIFACTS.md",
  "docs/release/RELEASE_SLICES_POLICY.md",
  "docs/release/REVIEW_SYSTEM.md",
  "docs/release/artifact_templates/README.md",
  "docs/release/artifact_templates/PRESSURE_REQUEST.md",
  "docs/release/artifact_templates/ARCHITECTURE_DECISION.md",
  "docs/release/artifact_templates/CHANGESET_SUMMARY.md",
  "docs/release/artifact_templates/QA_REPORT.md",
  "docs/release/artifact_templates/RELEASE_DECISION.md",
  "docs/release/artifact_templates/BUNDLE_MANIFEST.json",
  "review_artifacts/templates/PRESSURE_REQUEST.md",
  "review_artifacts/templates/ARCHITECTURE_DECISION.md",
  "review_artifacts/templates/CHANGESET_SUMMARY.md",
  "review_artifacts/templates/QA_REPORT.md",
  "review_artifacts/templates/RELEASE_DECISION.md",
  "review_artifacts/templates/BUNDLE_MANIFEST.json",
  "schemas/review/bundle_manifest.schema.json",
  "schemas/review/release_decision.schema.json",
  "schemas/review/qa_report.schema.json",
  "schemas/review/changeset_summary.schema.json"
];

for (const file of requiredFiles) {
  if (!exists(file)) {
    addDiagnostic(diagnostics, "air.review_protocol.missing_file", "required review protocol file is missing", file);
  }
}

if (exists("docs/release/ARTIFACT_REVIEW_PROTOCOL.md")) {
  const protocol = read("docs/release/ARTIFACT_REVIEW_PROTOCOL.md");
  const missing = includesAll(protocol, [
    "air-core",
    "production public release source",
    "airlang",
    "private/dev/reference source",
    "Demos are consumer pressure",
    "core-release",
    "core-hygiene",
    "consumer-demo",
    "internal-dev",
    "PRESSURE_REQUEST.md",
    "ARCHITECTURE_DECISION.md",
    "CHANGESET_SUMMARY.md",
    "QA_REPORT.md",
    "RELEASE_DECISION.md",
    "BUNDLE_MANIFEST.json",
    "M45-S1",
    "Do not use npm patch versions for unpublished internal slices",
    "Dev work may not be copied wholesale into `air-core`",
    "Review bundles never enter npm"
  ]);
  for (const needle of missing) {
    addDiagnostic(
      diagnostics,
      "air.review_protocol.missing_policy_text",
      `artifact review protocol is missing required policy text: ${needle}`,
      "docs/release/ARTIFACT_REVIEW_PROTOCOL.md"
    );
  }
}

if (exists("docs/release/REVIEW_PROTOCOL.md")) {
  const protocol = read("docs/release/REVIEW_PROTOCOL.md");
  const missing = includesAll(protocol, [
    "artifact-based",
    "No release decision may be chat-memory-only",
    "Release manager",
    "Architecture reviewer",
    "QA reviewer",
    "Demo/consumer pressure owner",
    "Review bundles are artifacts, never npm package contents"
  ]);
  for (const needle of missing) {
    addDiagnostic(
      diagnostics,
      "air.review_protocol.canonical_doc_gap",
      `review protocol is missing required text: ${needle}`,
      "docs/release/REVIEW_PROTOCOL.md"
    );
  }
}

if (exists("docs/release/RELEASE_LANES.md")) {
  const lanes = read("docs/release/RELEASE_LANES.md");
  const missing = includesAll(lanes, [
    "role: production/public release source",
    "role: consumer pressure, not release source",
    "role: dev/private/reference source",
    "Internal Slice Rule",
    "BUNDLE_MANIFEST.json"
  ]);
  for (const needle of missing) {
    addDiagnostic(
      diagnostics,
      "air.review_protocol.release_lane_gap",
      `release lanes policy is missing required text: ${needle}`,
      "docs/release/RELEASE_LANES.md"
    );
  }
}

if (exists("docs/release/BUNDLE_POLICY.md")) {
  const policy = read("docs/release/BUNDLE_POLICY.md");
  const missing = includesAll(policy, [
    "Review bundles are artifacts; they are never npm package contents.",
    "PRESSURE_REQUEST.md",
    "RELEASE_DECISION.md",
    "NPM Exclusion Rule",
    "scripts/check_public_package_surface.js"
  ]);
  for (const needle of missing) {
    addDiagnostic(
      diagnostics,
      "air.review_protocol.bundle_policy_gap",
      `bundle policy is missing required text: ${needle}`,
      "docs/release/BUNDLE_POLICY.md"
    );
  }
}

if (exists("docs/release/BUNDLE_KINDS.md")) {
  const kinds = read("docs/release/BUNDLE_KINDS.md");
  const missing = includesAll(kinds, [
    "`core-release`",
    "`core-hygiene`",
    "`consumer-demo`",
    "`internal-dev`",
    "Eligible for npm"
  ]);
  for (const needle of missing) {
    addDiagnostic(
      diagnostics,
      "air.review_protocol.bundle_kinds_gap",
      `bundle kinds doc is missing required text: ${needle}`,
      "docs/release/BUNDLE_KINDS.md"
    );
  }
}

if (exists("docs/release/RELEASE_VERSIONING_POLICY.md")) {
  const versioning = read("docs/release/RELEASE_VERSIONING_POLICY.md");
  const missing = includesAll(versioning, [
    "M45-S1",
    "0.45.0",
    "Do not use npm patch versions for unpublished internal slices",
    "AIR ABI and Host ABI are independent version axes"
  ]);
  for (const needle of missing) {
    addDiagnostic(
      diagnostics,
      "air.review_protocol.versioning_policy_gap",
      `release versioning policy is missing required text: ${needle}`,
      "docs/release/RELEASE_VERSIONING_POLICY.md"
    );
  }
}

if (exists("docs/release/NPM_PACKAGE_BOUNDARY.md")) {
  const npmBoundary = read("docs/release/NPM_PACKAGE_BOUNDARY.md");
  const missing = includesAll(npmBoundary, [
    "allowlisted",
    "Review bundles",
    "private prompts",
    "scripts/check_public_package_surface.js",
    "explicit package-surface decision"
  ]);
  for (const needle of missing) {
    addDiagnostic(
      diagnostics,
      "air.review_protocol.npm_boundary_gap",
      `NPM package boundary doc is missing required text: ${needle}`,
      "docs/release/NPM_PACKAGE_BOUNDARY.md"
    );
  }
}

function validateManifestTemplate(file, extraFields = []) {
  if (!exists(file)) return;
  let manifest = null;
  try {
    manifest = JSON.parse(read(file));
  } catch (error) {
    addDiagnostic(diagnostics, "air.review_protocol.invalid_manifest_template", error.message, file);
  }

  if (manifest) {
    const requiredManifestFields = [
      "bundleKind",
      "repo",
      "branch",
      "commit",
      "dirtyTree",
      "releaseAllowed",
      "npmPackage",
      "packageVersion",
      "airAbi",
      "hostAbi",
      "includedPaths",
      "excludedPaths",
      "checksRun",
      "knownLimitations",
      ...extraFields
    ];
    for (const field of requiredManifestFields) {
      if (!(field in manifest)) {
        addDiagnostic(
          diagnostics,
          "air.review_protocol.missing_manifest_field",
          `${path.basename(file)} template is missing field: ${field}`,
          file
        );
      }
    }
    if (manifest.npmPackage !== "@underskys/air-core") {
      addDiagnostic(
        diagnostics,
        "air.review_protocol.manifest_package_mismatch",
        `${path.basename(file)} template must use @underskys/air-core`,
        file
      );
    }
  }
}

validateManifestTemplate("docs/release/BUNDLE_MANIFEST_TEMPLATE.json", ["pressureRequests", "releaseDecision"]);
validateManifestTemplate("docs/release/artifact_templates/BUNDLE_MANIFEST.json", ["internalSlice", "publicVersion"]);
validateManifestTemplate("review_artifacts/templates/BUNDLE_MANIFEST.json", ["internalSlice", "publicVersion"]);

for (const schemaFile of [
  "schemas/review/bundle_manifest.schema.json",
  "schemas/review/release_decision.schema.json",
  "schemas/review/qa_report.schema.json",
  "schemas/review/changeset_summary.schema.json"
]) {
  if (!exists(schemaFile)) continue;
  try {
    const schema = JSON.parse(read(schemaFile));
    for (const field of ["$id", "type", "required", "properties"]) {
      if (!(field in schema)) {
        addDiagnostic(
          diagnostics,
          "air.review_protocol.schema_field_missing",
          `${path.basename(schemaFile)} is missing schema field: ${field}`,
          schemaFile
        );
      }
    }
  } catch (error) {
    addDiagnostic(diagnostics, "air.review_protocol.invalid_schema_json", error.message, schemaFile);
  }
}

const templateRequirements = {
  "docs/release/artifact_templates/README.md": [
    "PRESSURE_REQUEST.md",
    "BUNDLE_MANIFEST.json",
    "review artifacts, not npm package contents"
  ],
  "docs/release/artifact_templates/PRESSURE_REQUEST.md": [
    "## Source",
    "## Target Layer",
    "## Routing Decision",
    "## ABI Impact"
  ],
  "docs/release/artifact_templates/ARCHITECTURE_DECISION.md": [
    "## Status",
    "## Decision",
    "## Boundaries",
    "## Compatibility"
  ],
  "docs/release/artifact_templates/CHANGESET_SUMMARY.md": [
    "## Source",
    "## Public-Clean Review",
    "## ABI Status",
    "## Package Surface Impact"
  ],
  "docs/release/artifact_templates/QA_REPORT.md": [
    "## Checks Run",
    "## Package Surface",
    "## Release Lane",
    "## Residual Risk"
  ],
  "docs/release/artifact_templates/RELEASE_DECISION.md": [
    "## Release Candidate",
    "## Gates",
    "## NPM Status",
    "Publish run by Codex: `no`"
  ],
  "docs/release/BUNDLE_MANIFEST_TEMPLATE.json": [
    "@underskys/air-core",
    "REVIEW_RESULTS/",
    "checksRun"
  ],
  "docs/release/artifact_templates/BUNDLE_MANIFEST.json": [
    "@underskys/air-core",
    "REVIEW_RESULTS/",
    "checksRun"
  ],
  "review_artifacts/templates/PRESSURE_REQUEST.md": [
    "## Required Fields",
    "targetLayer",
    "airAbiImpact",
    "hostAbiImpact"
  ],
  "review_artifacts/templates/ARCHITECTURE_DECISION.md": [
    "## Required Fields",
    "## Decision",
    "## Boundaries"
  ],
  "review_artifacts/templates/CHANGESET_SUMMARY.md": [
    "## Required Fields",
    "packageSurfaceImpact",
    "airAbiStatus",
    "hostAbiStatus"
  ],
  "review_artifacts/templates/QA_REPORT.md": [
    "## Required Fields",
    "checksRun",
    "residualRisk"
  ],
  "review_artifacts/templates/RELEASE_DECISION.md": [
    "## Required Fields",
    "publishRunByCodex: no",
    "## Gates"
  ],
  "review_artifacts/templates/BUNDLE_MANIFEST.json": [
    "@underskys/air-core",
    "REVIEW_RESULTS/",
    "checksRun"
  ]
};

for (const [file, requiredText] of Object.entries(templateRequirements)) {
  if (!exists(file)) continue;
  const text = read(file);
  for (const needle of includesAll(text, requiredText)) {
    addDiagnostic(
      diagnostics,
      "air.review_protocol.template_gap",
      `${path.basename(file)} is missing required text: ${needle}`,
      file
    );
  }
}

const packageJson = JSON.parse(read("package.json"));
const files = Array.isArray(packageJson.files) ? packageJson.files : [];
const forbiddenPackageEntries = [
  "docs/release",
  "docs/release/",
  "REVIEW_RESULTS",
  "REVIEW_RESULTS/",
  "MOBILE_SUMMARY.md",
  "REVIEW_REQUEST.md",
  "public_export",
  "public_export/",
  "snapshots",
  "snapshots/",
  "prompts",
  "prompts/",
  "consumer_evidence",
  "consumer_evidence/"
];

for (const entry of files) {
  for (const forbidden of forbiddenPackageEntries) {
    if (entry === forbidden || entry.startsWith(forbidden)) {
      addDiagnostic(
        diagnostics,
        "air.review_protocol.npm_surface_forbidden",
        `package.json files includes review/private artifact path: ${entry}`,
        "package.json"
      );
    }
  }
}

const summary = {
  kind: "air.reviewProtocolCheck",
  status: diagnostics.length === 0 ? "passed" : "failed",
  checkedFiles: requiredFiles,
  artifactTemplates: Object.keys(templateRequirements),
  diagnostics
};

console.log(JSON.stringify(summary, null, 2));

if (diagnostics.length > 0) {
  process.exit(1);
}
