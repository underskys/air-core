#!/usr/bin/env node
"use strict";

const { execFileSync } = require("child_process");
const path = require("path");

const root = path.resolve(__dirname, "..");

function fail(message, details = []) {
  console.error(`public package surface check failed: ${message}`);
  for (const detail of details) {
    console.error(`- ${detail}`);
  }
  process.exit(1);
}

function runPackDryRun() {
  const output = execFileSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  const parsed = JSON.parse(output);
  if (!Array.isArray(parsed) || !parsed[0] || !Array.isArray(parsed[0].files)) {
    fail("unexpected npm pack --dry-run --json output");
  }
  return parsed[0];
}

function normalizePackagePath(file) {
  return file.replace(/\\/g, "/").replace(/^\.\//, "");
}

const forbiddenPathRules = [
  { label: "review results", test: (p) => p === "REVIEW_RESULTS" || p.startsWith("REVIEW_RESULTS/") },
  { label: "snapshot metadata", test: (p) => path.basename(p).startsWith("SNAPSHOT_") },
  { label: "bundle metadata", test: (p) => path.basename(p).startsWith("BUNDLE_") },
  { label: "review artifact templates", test: (p) => p === "review_artifacts" || p.startsWith("review_artifacts/") },
  { label: "review artifact instance", test: isReviewArtifactInstance },
  { label: "build output", test: (p) => p === "build" || p.startsWith("build/") || p.includes("/build/") },
  { label: "demo source", test: (p) => p === "demo" || p.startsWith("demo/") || p === "demos" || p.startsWith("demos/") },
  { label: "consumer evidence", test: (p) => p === "consumer_evidence" || p.startsWith("consumer_evidence/") },
  { label: "ABI request pressure docs", test: (p) => p === "docs/abi-requests" || p.startsWith("docs/abi-requests/") },
  { label: "request intake", test: (p) => p === "requests" || p.startsWith("requests/") },
  { label: "AI eval corpus", test: (p) => p === "evals" || p.startsWith("evals/") },
  { label: "prompt material", test: (p) => p === "prompts" || p.startsWith("prompts/") },
  { label: "host implementations", test: (p) => p === "hosts" || p.startsWith("hosts/") },
  { label: "kits", test: (p) => p === "kits" || p.startsWith("kits/") },
  { label: "generated archive", test: (p) => /\.(zip|tgz|tar|tar\.gz)$/i.test(p) },
  { label: "airlang review archive", test: (p) => /(^|\/)[^/]*airlang-review[^/]*\.zip$/i.test(p) },
  { label: "generated wasm", test: (p) => /\.wasm$/i.test(p) },
  { label: "AppleDouble/macOS artifact", test: (p) => /(^|\/)\._|\.DS_Store$/i.test(p) },
  { label: "large media", test: (p) => /\.(mp4|mov|webm)$/i.test(p) }
];

const reviewArtifactNames = new Set([
  "PRESSURE_REQUEST.md",
  "ARCHITECTURE_DECISION.md",
  "CHANGESET_SUMMARY.md",
  "QA_REPORT.md",
  "RELEASE_DECISION.md",
  "BUNDLE_MANIFEST.json",
  "MOBILE_SUMMARY.md",
  "REVIEW_REQUEST.md"
]);

function isReviewArtifactInstance(p) {
  return reviewArtifactNames.has(path.basename(p));
}

const consumerNameRules = [
  "airdoom",
  "airon",
  "airtris",
  "airworld",
  "airops",
  "flowdesk",
  "lan_observer",
  "lan-observer",
  "minesweeper",
  "photoloop",
  "zeitfall",
  "voxel"
];

const allowedExact = new Set([
  "AUTHORS",
  "CHANGELOG.md",
  "CONFORMANCE.md",
  "CONTRIBUTING.md",
  "LICENSE",
  "METHOD.md",
  "NOTICE",
  "README.md",
  "ROADMAP.md",
  "SECURITY.md",
  "SHOWCASE.md",
  "THREAT_MODEL.md",
  "VERSIONING.md",
  "WHY_AIR.md",
  "docs/README.md",
  "docs/RELEASE_NOTES_0_50_0.md",
  "docs/RELEASE_NOTES_0_50_1.md",
  "package.json",
  "package-lock.json"
]);

const allowedPrefixes = [
  "bin/",
  "data/host_profiles/",
  "src/",
  "spec/",
  "stdlib/",
  "examples/public/",
  "examples/borrowed_memory_conformance/",
  "examples/borrowed_slices/",
  "examples/provenance_flow/",
  "examples/realtime_safe/",
  "examples/refinement_types/",
  "examples/resource_certificate/",
  "examples/tool_gate/",
  "test/fixtures/conformance_policy/",
  "test/fixtures/conformance_state/",
  "test/fixtures/profiles/"
];

function isAllowlisted(p) {
  return allowedExact.has(p) || allowedPrefixes.some((prefix) => p.startsWith(prefix));
}

const pack = runPackDryRun();
const files = pack.files.map((entry) => normalizePackagePath(entry.path)).sort();
const failures = [];

for (const p of files) {
  for (const rule of forbiddenPathRules) {
    if (rule.test(p)) {
      failures.push(`${p}: forbidden ${rule.label}`);
    }
  }

  const lower = p.toLowerCase();
  for (const name of consumerNameRules) {
    if (lower.includes(name)) {
      failures.push(`${p}: consumer/demo-specific name '${name}' is not allowed in npm package surface`);
    }
  }

  if (!isAllowlisted(p)) {
    failures.push(`${p}: not in public package allowlist`);
  }
}

if (!files.includes("bin/airc.js")) {
  failures.push("bin/airc.js: missing CLI entrypoint");
}
if (!files.some((p) => p.startsWith("src/"))) {
  failures.push("src/: missing Core source");
}
if (!files.some((p) => p.startsWith("spec/"))) {
  failures.push("spec/: missing spec surface");
}
if (!files.some((p) => p.startsWith("test/fixtures/conformance_"))) {
  failures.push("test/fixtures/conformance_*: missing conformance fixtures");
}
if (!files.some((p) => p.startsWith("examples/public/"))) {
  failures.push("examples/public/: missing public examples");
}

if (failures.length > 0) {
  fail(`${failures.length} package surface issue(s)`, failures);
}

console.log(JSON.stringify({
  kind: "air.publicPackageSurfaceCheck",
  status: "passed",
  package: pack.id,
  entryCount: pack.entryCount,
  size: pack.size,
  unpackedSize: pack.unpackedSize,
  checkedForbiddenSurfaces: forbiddenPathRules.map((rule) => rule.label).sort(),
  allowlistedRoots: allowedPrefixes.slice().sort()
}, null, 2));
