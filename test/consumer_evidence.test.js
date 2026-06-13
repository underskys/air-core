#!/usr/bin/env node

const assert = require("assert");
const cp = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const script = path.join(root, "scripts", "check_consumer_evidence.js");

function run(corpusRoot) {
  return cp.spawnSync(process.execPath, [script, "--root", corpusRoot], {
    cwd: root,
    encoding: "utf8"
  });
}

function parse(result) {
  return JSON.parse(result.stdout);
}

function makeTempCorpus() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "air-consumer-evidence-"));
  const corpusRoot = path.join(tempRoot, "consumer_evidence");
  fs.mkdirSync(path.join(corpusRoot, "demos", "template_demo", "reports"), { recursive: true });
  fs.mkdirSync(path.join(corpusRoot, "demos", "template_demo", "replay"), { recursive: true });
  fs.mkdirSync(path.join(corpusRoot, "demos", "template_demo", "metrics"), { recursive: true });
  fs.copyFileSync(
    path.join(root, "consumer_evidence", "demos", "_template", "MANIFEST.json"),
    path.join(corpusRoot, "demos", "template_demo", "MANIFEST.json")
  );
  fs.copyFileSync(
    path.join(root, "consumer_evidence", "demos", "_template", "PROOF_CARD.md"),
    path.join(corpusRoot, "demos", "template_demo", "PROOF_CARD.md")
  );
  fs.copyFileSync(
    path.join(root, "consumer_evidence", "demos", "_template", "PROMPTS.md"),
    path.join(corpusRoot, "demos", "template_demo", "PROMPTS.md")
  );
  fs.copyFileSync(
    path.join(root, "consumer_evidence", "demos", "_template", "reports", "capability_boundary.md"),
    path.join(corpusRoot, "demos", "template_demo", "reports", "capability_boundary.md")
  );
  fs.writeFileSync(path.join(corpusRoot, "demos", "template_demo", "replay", "summary.json"), JSON.stringify({
    schemaVersion: 1,
    kind: "air.consumerEvidenceReplayManifest",
    demoId: "template_demo",
    replays: []
  }, null, 2));
  fs.writeFileSync(path.join(corpusRoot, "DEMO_REGISTRY.json"), JSON.stringify({
    schemaVersion: 1,
    kind: "air.consumerEvidenceRegistry",
    demos: [
      {
        id: "template_demo",
        name: "Template Consumer Evidence Entry",
        category: "experimental_demo_pressure",
        status: "proposed",
        owner: "AIR Core",
        source: "template",
        airRole: "Own bounded deterministic logic and evidence metadata.",
        hostRole: "Own rich platform state and real side effects.",
        allowedCapabilities: ["bounded facts"],
        deniedAuthorities: ["raw host authority"],
        proofTypes: ["capability-boundary"],
        replayCount: 1,
        hasAiPrompt: true,
        hasRepairTranscript: false,
        evidencePath: "consumer_evidence/demos/template_demo/reports/capability_boundary.md",
        pressurePath: "consumer_evidence/demos/template_demo/PROOF_CARD.md",
        notes: []
      }
    ]
  }, null, 2));
  return { tempRoot, corpusRoot };
}

function cleanup(tempRoot) {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

function codes(report) {
  return report.diagnostics.map((item) => item.code).sort();
}

function assertNoAbsolutePaths(value) {
  const offenders = [];
  walk(value, (item) => {
    if (typeof item === "string" && (item.startsWith(root) || item.startsWith(os.tmpdir()) || /^[A-Za-z]:[\\/]/.test(item))) {
      offenders.push(item);
    }
  });
  assert.deepStrictEqual(offenders, []);
}

function walk(value, fn) {
  fn(value);
  if (Array.isArray(value)) value.forEach((item) => walk(item, fn));
  else if (value && typeof value === "object") Object.keys(value).forEach((key) => walk(value[key], fn));
}

{
  const result = run(path.join(root, "consumer_evidence"));
  assert.strictEqual(result.status, 0, result.stdout || result.stderr);
  const report = parse(result);
  assert.strictEqual(report.kind, "air.consumerEvidenceCheck");
  assert.strictEqual(report.status, "passed");
  assert(report.demoCount >= 3);
  assertNoAbsolutePaths(report);
}

{
  const { tempRoot, corpusRoot } = makeTempCorpus();
  try {
    const result = run(corpusRoot);
    assert.strictEqual(result.status, 0, result.stdout || result.stderr);
    const report = parse(result);
    assert.strictEqual(report.status, "passed");
    assert.strictEqual(report.demoCount, 1);
    assertNoAbsolutePaths(report);
  } finally {
    cleanup(tempRoot);
  }
}

{
  const { tempRoot, corpusRoot } = makeTempCorpus();
  try {
    fs.rmSync(path.join(corpusRoot, "demos", "template_demo", "PROOF_CARD.md"));
    const result = run(corpusRoot);
    assert.notStrictEqual(result.status, 0);
    assert(codes(parse(result)).includes("air.consumer_evidence.proof_card_missing"));
  } finally {
    cleanup(tempRoot);
  }
}

{
  const { tempRoot, corpusRoot } = makeTempCorpus();
  try {
    const registryPath = path.join(corpusRoot, "DEMO_REGISTRY.json");
    const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
    registry.demos.push({ ...registry.demos[0] });
    fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
    const result = run(corpusRoot);
    assert.notStrictEqual(result.status, 0);
    assert(codes(parse(result)).includes("air.consumer_evidence.demo_id_duplicate"));
  } finally {
    cleanup(tempRoot);
  }
}

{
  const { tempRoot, corpusRoot } = makeTempCorpus();
  try {
    fs.writeFileSync(path.join(corpusRoot, "demos", "template_demo", "reports", "leak.md"), "api_key = fixture_secret_value_1234567890\n");
    const result = run(corpusRoot);
    assert.notStrictEqual(result.status, 0);
    assert(codes(parse(result)).includes("air.consumer_evidence.secret_like_content"));
  } finally {
    cleanup(tempRoot);
  }
}

{
  const { tempRoot, corpusRoot } = makeTempCorpus();
  try {
    fs.writeFileSync(path.join(corpusRoot, "demos", "template_demo", "clip.mp4"), "fake media");
    const result = run(corpusRoot);
    assert.notStrictEqual(result.status, 0);
    assert(codes(parse(result)).includes("air.consumer_evidence.large_media_committed"));
  } finally {
    cleanup(tempRoot);
  }
}

{
  const { tempRoot, corpusRoot } = makeTempCorpus();
  try {
    fs.rmSync(path.join(corpusRoot, "demos", "template_demo", "replay"), { recursive: true, force: true });
    const result = run(corpusRoot);
    assert.notStrictEqual(result.status, 0);
    assert(codes(parse(result)).includes("air.consumer_evidence.replay_missing"));
  } finally {
    cleanup(tempRoot);
  }
}

{
  const first = run(path.join(root, "consumer_evidence"));
  const second = run(path.join(root, "consumer_evidence"));
  assert.strictEqual(first.stdout, second.stdout, "consumer evidence check output must be deterministic");
}

console.log("consumer evidence validator tests passed");
