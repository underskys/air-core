#!/usr/bin/env node

const assert = require("assert");
const cp = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const script = path.join(root, "scripts", "check_request_ledger.js");

function run(ledgerRoot) {
  return cp.spawnSync(process.execPath, [script, "--root", ledgerRoot], {
    cwd: root,
    encoding: "utf8"
  });
}

function parse(result) {
  return JSON.parse(result.stdout);
}

function makeTempLedger() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "air-request-ledger-"));
  for (const dir of [
    "requests/accepted",
    "requests/rejected",
    "requests/archive",
    "requests/inbox",
    "docs/abi-requests",
    "consumer_evidence"
  ]) {
    fs.mkdirSync(path.join(tempRoot, dir), { recursive: true });
  }

  fs.writeFileSync(path.join(tempRoot, "requests", "accepted", "demo.md"), requestText({
    title: "Demo Accepted Request",
    source: "demo",
    sourcePath: "docs/abi-requests/demo.md",
    targetLayer: "core",
    status: "accepted/planned",
    decision: "Accepted as a generic test request.",
    rationale: "It is generic and bounded.",
    compatibilityRisk: "Low.",
    versionTarget: "v0.test",
    owner: "AIR Core"
  }));
  fs.writeFileSync(path.join(tempRoot, "requests", "rejected", "demo-rejected.md"), requestText({
    title: "Demo Rejected Request",
    source: "demo",
    sourcePath: "docs/abi-requests/demo.md",
    targetLayer: "project kit",
    status: "rejected/project-only",
    decision: "Rejected for Core.",
    rationale: "It is demo-specific.",
    compatibilityRisk: "High if promoted.",
    reason: "Demo-specific.",
    alternative: "project-local",
    whyNotCore: "It contains project vocabulary."
  }));
  fs.writeFileSync(path.join(tempRoot, "requests", "inbox", "README.md"), "Inbox is currently empty; no unresolved public-alpha proposals.\n");
  fs.writeFileSync(path.join(tempRoot, "requests", "archive", "README.md"), "Archive.\n");
  fs.writeFileSync(path.join(tempRoot, "requests", "accepted", "README.md"), "Accepted.\n");
  fs.writeFileSync(path.join(tempRoot, "requests", "rejected", "README.md"), "Rejected.\n");
  fs.writeFileSync(path.join(tempRoot, "docs", "abi-requests", "README.md"), "ABI requests.\n");
  fs.writeFileSync(path.join(tempRoot, "docs", "abi-requests", "demo.md"), "# Demo pressure\n");
  fs.writeFileSync(path.join(tempRoot, "consumer_evidence", "DEMO_REGISTRY.json"), JSON.stringify({
    schemaVersion: 1,
    kind: "air.consumerEvidenceRegistry",
    demos: []
  }, null, 2));
  return tempRoot;
}

function requestText(fields) {
  return Object.entries(fields).map(([key, value]) => `${key}: ${value}`).join("\n") + "\n";
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
  if (Array.isArray(value)) {
    value.forEach((item) => walk(item, fn));
  } else if (value && typeof value === "object") {
    Object.keys(value).forEach((key) => walk(value[key], fn));
  }
}

{
  const result = run(root);
  assert.strictEqual(result.status, 0, result.stdout || result.stderr);
  const report = parse(result);
  assert.strictEqual(report.kind, "air.requestLedgerCheck");
  assert.strictEqual(report.status, "passed");
  assert(report.requestCount >= 26);
  assert.deepStrictEqual(report.missingFields, []);
  assert.deepStrictEqual(report.uncoveredAbiRequests, []);
  assert.deepStrictEqual(report.unresolvedInbox, []);
  assertNoAbsolutePaths(report);
}

{
  const tempRoot = makeTempLedger();
  try {
    const result = run(tempRoot);
    assert.strictEqual(result.status, 0, result.stdout || result.stderr);
    const report = parse(result);
    assert.strictEqual(report.status, "passed");
    assert.strictEqual(report.requestCount, 2);
    assert.strictEqual(report.accepted, 1);
    assert.strictEqual(report.rejected, 1);
    assertNoAbsolutePaths(report);
  } finally {
    cleanup(tempRoot);
  }
}

{
  const tempRoot = makeTempLedger();
  try {
    fs.writeFileSync(path.join(tempRoot, "requests", "accepted", "missing.md"), requestText({
      title: "Missing Source Request",
      sourcePath: "docs/abi-requests/demo.md",
      targetLayer: "core",
      status: "accepted/planned",
      decision: "Accepted.",
      rationale: "Generic.",
      compatibilityRisk: "Low.",
      versionTarget: "v0.test",
      owner: "AIR Core"
    }));
    const result = run(tempRoot);
    assert.notStrictEqual(result.status, 0);
    const report = parse(result);
    assert(codes(report).includes("air.request_ledger.missing_field"));
    assert(report.missingFields.some((item) => item.path === "requests/accepted/missing.md" && item.field === "source"));
  } finally {
    cleanup(tempRoot);
  }
}

{
  const tempRoot = makeTempLedger();
  try {
    fs.writeFileSync(path.join(tempRoot, "docs", "abi-requests", "uncovered.md"), "# Uncovered pressure\n");
    const result = run(tempRoot);
    assert.notStrictEqual(result.status, 0);
    const report = parse(result);
    assert(codes(report).includes("air.request_ledger.abi_request_uncovered"));
    assert(report.uncoveredAbiRequests.includes("docs/abi-requests/uncovered.md"));
  } finally {
    cleanup(tempRoot);
  }
}

{
  const tempRoot = makeTempLedger();
  try {
    fs.writeFileSync(path.join(tempRoot, "requests", "rejected", "bad.md"), requestText({
      title: "Rejected Without Reason",
      source: "demo",
      sourcePath: "docs/abi-requests/demo.md",
      targetLayer: "project kit",
      status: "rejected/project-only",
      decision: "Rejected.",
      rationale: "Demo-specific.",
      compatibilityRisk: "High.",
      alternative: "project-local",
      whyNotCore: "Project vocabulary."
    }));
    const result = run(tempRoot);
    assert.notStrictEqual(result.status, 0);
    const report = parse(result);
    assert(report.missingFields.some((item) => item.path === "requests/rejected/bad.md" && item.field === "reason"));
  } finally {
    cleanup(tempRoot);
  }
}

{
  const tempRoot = makeTempLedger();
  try {
    fs.writeFileSync(path.join(tempRoot, "requests", "accepted", "bad.md"), requestText({
      title: "Accepted Without Version",
      source: "demo",
      sourcePath: "docs/abi-requests/demo.md",
      targetLayer: "core",
      status: "accepted/planned",
      decision: "Accepted.",
      rationale: "Generic.",
      compatibilityRisk: "Low.",
      owner: "AIR Core"
    }));
    const result = run(tempRoot);
    assert.notStrictEqual(result.status, 0);
    const report = parse(result);
    assert(report.missingFields.some((item) => item.path === "requests/accepted/bad.md" && item.field === "versionTarget or closedByVersion"));
  } finally {
    cleanup(tempRoot);
  }
}

{
  const first = run(root);
  const second = run(root);
  assert.strictEqual(first.stdout, second.stdout, "request ledger check output must be deterministic");
}

console.log("request ledger validator tests passed");
