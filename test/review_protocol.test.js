#!/usr/bin/env node
"use strict";

const assert = require("assert");
const cp = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const script = path.join(root, "scripts", "check_review_protocol.js");

function run(protocolRoot) {
  return cp.spawnSync(process.execPath, [script, "--root", protocolRoot], {
    cwd: root,
    encoding: "utf8"
  });
}

function parse(result) {
  return JSON.parse(result.stdout);
}

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function makeTempRoot() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "air-review-protocol-"));

  const templates = {
    "PRESSURE_REQUEST.md": "## Required Fields\n\ntargetLayer\nairAbiImpact\nhostAbiImpact\n",
    "ARCHITECTURE_DECISION.md": "## Required Fields\n\n## Decision\n\n## Boundaries\n",
    "CHANGESET_SUMMARY.md": "## Required Fields\n\npackageSurfaceImpact\nairAbiStatus\nhostAbiStatus\n",
    "QA_REPORT.md": "## Required Fields\n\nchecksRun\nresidualRisk\n",
    "RELEASE_DECISION.md": "## Required Fields\n\npublishRunByCodex: no\n\n## Gates\n"
  };

  for (const [name, text] of Object.entries(templates)) {
    write(path.join(tempRoot, "review_artifacts", "templates", name), text);
  }
  write(path.join(tempRoot, "review_artifacts", "templates", "BUNDLE_MANIFEST.json"), JSON.stringify({
    bundleKind: "core-release",
    repo: "git@gitlab.com:fd.skyrealm/air-core.git",
    branch: "main",
    commit: "<commit>",
    dirtyTree: "no",
    releaseAllowed: "yes",
    npmPackage: "@underskys/air-core",
    packageVersion: "0.45.1",
    airAbi: "0.10",
    hostAbi: "0.11",
    internalSlice: "M45-S1",
    publicVersion: "0.45.1",
    includedPaths: ["README.md"],
    excludedPaths: ["REVIEW_RESULTS/"],
    checksRun: ["npm test"],
    knownLimitations: []
  }, null, 2));

  const schema = (id) => JSON.stringify({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: id,
    type: "object",
    required: ["title"],
    properties: { title: { type: "string" } }
  }, null, 2);
  write(path.join(tempRoot, "schemas", "review", "bundle_manifest.schema.json"), schema("bundle"));
  write(path.join(tempRoot, "schemas", "review", "release_decision.schema.json"), schema("release"));
  write(path.join(tempRoot, "schemas", "review", "qa_report.schema.json"), schema("qa"));
  write(path.join(tempRoot, "schemas", "review", "changeset_summary.schema.json"), schema("changeset"));

  write(path.join(tempRoot, "package.json"), JSON.stringify({
    name: "@underskys/air-core",
    version: "0.0.0",
    files: ["README.md", "src/"]
  }, null, 2));

  return tempRoot;
}

function writeBundle(tempRoot, dirName, manifest) {
  const dir = path.join(tempRoot, dirName);
  fs.mkdirSync(dir, { recursive: true });
  write(path.join(dir, "BUNDLE_MANIFEST.json"), JSON.stringify(manifest, null, 2));
  for (const artifact of manifest.artifacts || []) {
    if (artifact === "BUNDLE_MANIFEST.json") continue;
    write(path.join(dir, artifact), `${artifact}\n`);
  }
}

function validManifest(overrides = {}) {
  return {
    kind: "core-release",
    sourceRepo: "air-core",
    targetRepo: "air-core",
    commit: "abc123",
    publicClean: true,
    npmEligible: true,
    forbiddenContentCheck: "passed",
    artifacts: ["BUNDLE_MANIFEST.json", "CHANGESET_SUMMARY.md", "QA_REPORT.md", "RELEASE_DECISION.md"],
    internalSlice: "M45-S1",
    publicVersion: "0.45.1",
    npmContents: ["README.md", "src/index.js"],
    ...overrides
  };
}

function cleanup(tempRoot) {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

function codes(report) {
  return report.diagnostics.map((item) => item.code).sort();
}

{
  const result = run(root);
  assert.strictEqual(result.status, 0, result.stdout || result.stderr);
  const report = parse(result);
  assert.strictEqual(report.kind, "air.reviewProtocolCheck");
  assert.strictEqual(report.status, "passed");
  assert(report.checkedTemplates.includes("review_artifacts/templates/PRESSURE_REQUEST.md"));
  assert(report.checkedSchemas.includes("schemas/review/bundle_manifest.schema.json"));
}

{
  const tempRoot = makeTempRoot();
  try {
    const result = run(tempRoot);
    assert.strictEqual(result.status, 0, result.stdout || result.stderr);
    const report = parse(result);
    assert.strictEqual(report.status, "passed");
  } finally {
    cleanup(tempRoot);
  }
}

{
  const tempRoot = makeTempRoot();
  try {
    fs.rmSync(path.join(tempRoot, "review_artifacts", "templates", "PRESSURE_REQUEST.md"));
    const result = run(tempRoot);
    assert.notStrictEqual(result.status, 0);
    assert(codes(parse(result)).includes("air.review_protocol.missing_template"));
  } finally {
    cleanup(tempRoot);
  }
}

{
  const tempRoot = makeTempRoot();
  try {
    writeBundle(tempRoot, "bundle", validManifest({ kind: "bad-kind" }));
    const result = run(tempRoot);
    assert.notStrictEqual(result.status, 0);
    assert(codes(parse(result)).includes("air.review_protocol.invalid_bundle_kind"));
  } finally {
    cleanup(tempRoot);
  }
}

{
  const tempRoot = makeTempRoot();
  try {
    writeBundle(tempRoot, "bundle", validManifest({ sourceRepo: "airlang" }));
    const result = run(tempRoot);
    assert.notStrictEqual(result.status, 0);
    assert(codes(parse(result)).includes("air.review_protocol.core_release_from_airlang"));
  } finally {
    cleanup(tempRoot);
  }
}

{
  const tempRoot = makeTempRoot();
  try {
    writeBundle(tempRoot, "bundle", validManifest({
      kind: "consumer-demo",
      sourceRepo: "demo",
      npmEligible: true,
      artifacts: ["BUNDLE_MANIFEST.json", "PRESSURE_REQUEST.md", "QA_REPORT.md"]
    }));
    const result = run(tempRoot);
    assert.notStrictEqual(result.status, 0);
    assert(codes(parse(result)).includes("air.review_protocol.consumer_demo_npm_eligible"));
  } finally {
    cleanup(tempRoot);
  }
}

{
  const tempRoot = makeTempRoot();
  try {
    writeBundle(tempRoot, "bundle", validManifest({ internalSlice: "S45-M1" }));
    const result = run(tempRoot);
    assert.notStrictEqual(result.status, 0);
    assert(codes(parse(result)).includes("air.review_protocol.invalid_internal_slice"));
  } finally {
    cleanup(tempRoot);
  }
}

{
  const first = run(root);
  const second = run(root);
  assert.strictEqual(first.stdout, second.stdout, "review protocol check output must be deterministic");
}

console.log("review protocol validator tests passed");
