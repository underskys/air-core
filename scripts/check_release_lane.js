#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "..");

function runGit(args, fallback = "") {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return fallback;
  }
}

function toRel(file) {
  return path.relative(root, file).replace(/\\/g, "/");
}

function isIgnored(rel) {
  try {
    execFileSync("git", ["check-ignore", "-q", "--", rel], { cwd: root, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function isTracked(rel) {
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", "--", rel], { cwd: root, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function shouldReportArtifact(rel) {
  return isTracked(rel) || !isIgnored(rel);
}

function listRootForbiddenArtifacts() {
  const artifacts = [];
  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const name = entry.name;
    const rel = name;
    const matched =
      /\.tgz$/i.test(name) ||
      /airlang-review.*\.zip$/i.test(name) ||
      name === "MOBILE_SUMMARY.md" ||
      name === "REVIEW_REQUEST.md" ||
      name === "public_export" ||
      name === "node_modules" ||
      name.startsWith("._");
    if (matched && shouldReportArtifact(rel)) {
      artifacts.push(rel);
    }
  }
  return artifacts.sort();
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      walk(full, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

const publicDocRoots = [
  "README.md",
  "CHANGELOG.md",
  "VERSIONING.md",
  "CONFORMANCE.md",
  "SECURITY.md",
  "THREAT_MODEL.md",
  "WHY_AIR.md",
  "METHOD.md",
  "ROADMAP.md",
  "SHOWCASE.md",
  "docs/README.md",
  "docs/project-identity.md",
  "docs/public_release",
  "docs/release"
];

function publicDocFiles() {
  const files = [];
  for (const rel of publicDocRoots) {
    const full = path.join(root, rel);
    if (!fs.existsSync(full)) continue;
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      files.push(...walk(full).filter((file) => file.endsWith(".md")));
    } else if (stat.isFile()) {
      files.push(full);
    }
  }
  return Array.from(new Set(files.map(toRel))).sort();
}

const staleRules = [
  {
    label: "active air-verifier package/install reference",
    pattern: /\bair-verifier\b/i
  },
  {
    label: "airlang global npm install reference",
    pattern: /npm\s+install\s+-g\s+airlang\b/i
  },
  {
    label: "local absolute path",
    pattern: /(?:^|[\s('"`])(?:\/Users\/|\/home\/)/i
  }
];

function findStaleReferences() {
  const refs = [];
  for (const rel of publicDocFiles()) {
    const text = fs.readFileSync(path.join(root, rel), "utf8");
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (line.includes("release-lane-allow")) return;
      for (const rule of staleRules) {
        if (rule.pattern.test(line)) {
          refs.push({
            file: rel,
            line: index + 1,
            label: rule.label,
            text: line.trim()
          });
        }
      }
    });
  }
  return refs;
}

const branch = runGit(["branch", "--show-current"], "unknown") || "unknown";
const commit = runGit(["rev-parse", "HEAD"], "unknown") || "unknown";
const porcelain = runGit(["status", "--porcelain"], "");
const dirty = porcelain.length > 0;
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const forbiddenArtifacts = listRootForbiddenArtifacts();
const staleReferences = findStaleReferences();

const isReleaseBranch = branch === "main" || branch.startsWith("release/");
const isDemoBranch = branch.startsWith("demo/") || branch.includes("/demo/");
const packageOk = packageJson.name === "@underskys/air-core";
const releaseAllowed =
  isReleaseBranch &&
  !isDemoBranch &&
  !dirty &&
  packageOk &&
  forbiddenArtifacts.length === 0 &&
  staleReferences.length === 0;

const diagnostics = [];
if (!isReleaseBranch) diagnostics.push("branch is not main or release/*");
if (isDemoBranch) diagnostics.push("demo branch is never release-allowed");
if (dirty) diagnostics.push("working tree is dirty");
if (!packageOk) diagnostics.push("package name is not @underskys/air-core");
if (forbiddenArtifacts.length > 0) diagnostics.push("forbidden root artifacts detected");
if (staleReferences.length > 0) diagnostics.push("stale public release references detected");

const status = forbiddenArtifacts.length === 0 && staleReferences.length === 0 && packageOk
  ? "passed"
  : "failed";

const summary = {
  kind: "air.releaseLaneCheck",
  status,
  branch,
  commit,
  packageName: packageJson.name,
  packageVersion: packageJson.version,
  dirty,
  forbiddenArtifacts,
  staleReferences,
  releaseAllowed,
  diagnostics
};

console.log(JSON.stringify(summary, null, 2));

if (status !== "passed") {
  process.exit(1);
}
