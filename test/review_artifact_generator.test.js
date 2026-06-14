#!/usr/bin/env node
"use strict";

const assert = require("assert");
const cp = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const generator = path.join(root, "scripts", "new_review_artifact.js");
const protocolCheck = path.join(root, "scripts", "check_review_protocol.js");

const templateNames = [
  "PRESSURE_REQUEST.md",
  "ARCHITECTURE_DECISION.md",
  "CHANGESET_SUMMARY.md",
  "QA_REPORT.md",
  "RELEASE_DECISION.md",
  "BUNDLE_MANIFEST.json"
];

function run(args, cwd = root) {
  return cp.spawnSync(process.execPath, [generator, ...args], {
    cwd,
    encoding: "utf8"
  });
}

function checkProtocol(tempRoot) {
  return cp.spawnSync(process.execPath, [protocolCheck, "--root", tempRoot], {
    cwd: root,
    encoding: "utf8"
  });
}

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function makeTempRoot() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "air-review-artifact-generator-"));
  for (const name of templateNames) {
    const source = path.join(root, "review_artifacts", "templates", name);
    write(path.join(tempRoot, "review_artifacts", "templates", name), fs.readFileSync(source, "utf8"));
  }

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

function cleanup(tempRoot) {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

function manifest(tempRoot, id) {
  return JSON.parse(fs.readFileSync(
    path.join(tempRoot, "review_artifacts", "active", id, "BUNDLE_MANIFEST.json"),
    "utf8"
  ));
}

function assertFiles(tempRoot, id, expected) {
  const dir = path.join(tempRoot, "review_artifacts", "active", id);
  const files = fs.readdirSync(dir).sort();
  assert.deepStrictEqual(files, expected.slice().sort());
}

{
  const tempRoot = makeTempRoot();
  try {
    const result = run(["--root", tempRoot, "--kind", "core-release", "--id", "M45-S1-math-roadmap"]);
    assert.strictEqual(result.status, 0, result.stderr);
    assert(result.stdout.includes("Created core-release review artifact skeleton"));
    assertFiles(tempRoot, "M45-S1-math-roadmap", [
      "BUNDLE_MANIFEST.json",
      "CHANGESET_SUMMARY.md",
      "QA_REPORT.md",
      "RELEASE_DECISION.md"
    ]);
    const data = manifest(tempRoot, "M45-S1-math-roadmap");
    assert.strictEqual(data.kind, "core-release");
    assert.strictEqual(data.sourceRepo, "air-core");
    assert.strictEqual(data.publicClean, true);
    assert.strictEqual(data.npmEligible, true);
    assert.strictEqual(checkProtocol(tempRoot).status, 0);
  } finally {
    cleanup(tempRoot);
  }
}

{
  const tempRoot = makeTempRoot();
  try {
    const result = run(["--root", tempRoot, "--kind", "consumer-demo", "--id", "airmatlab-pressure"]);
    assert.strictEqual(result.status, 0, result.stderr);
    assertFiles(tempRoot, "airmatlab-pressure", [
      "BUNDLE_MANIFEST.json",
      "PRESSURE_REQUEST.md",
      "QA_REPORT.md"
    ]);
    const data = manifest(tempRoot, "airmatlab-pressure");
    assert.strictEqual(data.kind, "consumer-demo");
    assert.strictEqual(data.sourceRepo, "demo");
    assert.strictEqual(data.npmEligible, false);
    assert.strictEqual(checkProtocol(tempRoot).status, 0);
  } finally {
    cleanup(tempRoot);
  }
}

{
  const tempRoot = makeTempRoot();
  try {
    const result = run(["--root", tempRoot, "--kind", "invalid-kind", "--id", "bad"]);
    assert.notStrictEqual(result.status, 0);
    assert(result.stderr.includes("invalid --kind"));
  } finally {
    cleanup(tempRoot);
  }
}

{
  const tempRoot = makeTempRoot();
  try {
    const first = run(["--root", tempRoot, "--kind", "core-hygiene", "--id", "package-identity-cleanup"]);
    assert.strictEqual(first.status, 0, first.stderr);
    fs.rmSync(path.join(tempRoot, "review_artifacts", "active", "package-identity-cleanup"), {
      recursive: true,
      force: true
    });
    const second = run(["--root", tempRoot, "--kind", "core-hygiene", "--id", "package-identity-cleanup"]);
    assert.strictEqual(second.status, 0, second.stderr);
    assert.strictEqual(first.stdout, second.stdout);
  } finally {
    cleanup(tempRoot);
  }
}

console.log("review artifact generator tests passed");
