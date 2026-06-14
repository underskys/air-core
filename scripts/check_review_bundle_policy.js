#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "..");

function run(command, args) {
  return execFileSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function normalize(file) {
  return file.replace(/\\/g, "/").replace(/^\.\//, "");
}

function readPackageJson() {
  return JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
}

function gitTrackedFiles() {
  const out = run("git", ["ls-files", "-z"]);
  return out.split("\0").filter(Boolean).map(normalize).sort();
}

function npmPackFiles() {
  const out = run("npm", ["pack", "--dry-run", "--json"]);
  const parsed = JSON.parse(out);
  if (!Array.isArray(parsed) || !parsed[0] || !Array.isArray(parsed[0].files)) {
    throw new Error("unexpected npm pack --dry-run --json output");
  }
  return parsed[0].files.map((entry) => normalize(entry.path)).sort();
}

const forbiddenTrackedRules = [
  { label: "generated tgz archive", test: (p) => /\.tgz$/i.test(p) },
  { label: "airlang review zip", test: (p) => /airlang-review.*\.zip$/i.test(p) },
  { label: "mobile summary artifact", test: (p) => path.basename(p) === "MOBILE_SUMMARY.md" },
  { label: "review request artifact", test: (p) => path.basename(p) === "REVIEW_REQUEST.md" },
  { label: "public export staging", test: (p) => p === "public_export" || p.startsWith("public_export/") },
  { label: "prompt log", test: (p) => /(^|\/)(prompt[-_]?logs?|raw_logs|chat_transcripts)(\/|$)/i.test(p) },
  { label: "raw review bundle directory", test: (p) => /(^|\/)(REVIEW_RESULTS|review[-_]?bundles?|build\/review-bundles)(\/|$)/i.test(p) },
];

const packageForbiddenRules = [
  { label: "review bundle", test: (p) => /(^|\/)(review[-_]?bundles?|REVIEW_RESULTS)(\/|$)/i.test(p) },
  { label: "build/review-bundles", test: (p) => p === "build/review-bundles" || p.startsWith("build/review-bundles/") },
  { label: "public_export", test: (p) => p === "public_export" || p.startsWith("public_export/") },
  { label: "prompts", test: (p) => p === "prompts" || p.startsWith("prompts/") },
  { label: "consumer demo build output", test: (p) => /(^|\/)(demo|demos|demo_snapshots|consumer_evidence)(\/|$)/i.test(p) || /(^|\/)(demo|demos|consumer_evidence)\/[^/]+\/(dist|build|public)(\/|$)/i.test(p) },
  { label: "generated archive", test: (p) => /\.(zip|tgz|tar|tar\.gz)$/i.test(p) },
  { label: "mobile/review markdown artifact", test: (p) => /(^|\/)(MOBILE_SUMMARY|REVIEW_REQUEST)\.md$/i.test(p) },
];

function collectRuleHits(files, rules) {
  const hits = [];
  for (const file of files) {
    for (const rule of rules) {
      if (rule.test(file)) {
        hits.push({ path: file, reason: rule.label });
      }
    }
  }
  return hits;
}

const trackedFiles = gitTrackedFiles();
const packFiles = npmPackFiles();
const pkg = readPackageJson();
const packageFiles = Array.isArray(pkg.files) ? pkg.files.map(normalize) : [];

const trackedForbidden = collectRuleHits(trackedFiles, forbiddenTrackedRules);
const packageForbidden = collectRuleHits(packFiles, packageForbiddenRules);
const packageAllowlistForbidden = collectRuleHits(packageFiles, packageForbiddenRules);

const requiredSurfaceExclusions = [
  "review bundles",
  "build/review-bundles",
  "public_export",
  "prompts",
  "consumer demo build output",
];

const summary = {
  kind: "air.reviewBundlePolicyCheck",
  status: "passed",
  trackedFileCount: trackedFiles.length,
  packageAllowlistCount: packageFiles.length,
  npmPackFileCount: packFiles.length,
  requiredSurfaceExclusions,
  trackedForbidden,
  packageAllowlistForbidden,
  packageForbidden,
};

if (trackedForbidden.length || packageAllowlistForbidden.length || packageForbidden.length) {
  summary.status = "failed";
  console.log(JSON.stringify(summary, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(summary, null, 2));
