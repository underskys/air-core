#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const cwd = process.cwd();
const diagnostics = [];
const warnings = [];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function existing(paths) {
  return paths.filter((item) => fs.existsSync(path.join(root, item)));
}

function walkMarkdown(dir, out = []) {
  const fullDir = path.join(root, dir);
  if (!fs.existsSync(fullDir)) return out;
  for (const entry of fs.readdirSync(fullDir, { withFileTypes: true })) {
    const rel = path.join(dir, entry.name).replace(/\\/g, "/");
    if (entry.isDirectory()) {
      if (["archive", "release", "rfcs", "public_release"].includes(entry.name)) continue;
      walkMarkdown(rel, out);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      out.push(rel);
    }
  }
  return out;
}

const pkg = readJson(path.join(root, "package.json"));
if (!String(pkg.name || "").startsWith("@underskys/air-core")) {
  diagnostics.push({
    code: "air.repo_roles.package_name",
    message: `package name must start with @underskys/air-core, got ${pkg.name || "<missing>"}`,
    file: "package.json",
  });
}

if (/(^|\/)airlang\/?$/.test(cwd.replace(/\\/g, "/"))) {
  warnings.push({
    code: "air.repo_roles.cwd_airlang",
    message: "current working directory appears to be airlang; release checks must run from air-core",
  });
}

const activeDocs = existing([
  "README.md",
  "VERSIONING.md",
  "docs/README.md",
  "docs/CHANGE_WORKFLOW.md",
  "docs/RC_REVIEW_BUNDLE_POLICY.md",
  "docs/REPO_ROLES.md",
  "docs/INTERACTION_ARTIFACTS.md",
  "docs/ARCHITECTURE_GATES.md",
  "docs/PUBLIC_CLAIMS.md",
  ".gitlab-ci.yml",
  "package.json",
]).concat(walkMarkdown("docs").filter((file) =>
  !file.startsWith("docs/archive/") &&
  !file.startsWith("docs/release/") &&
  !file.startsWith("docs/rfcs/") &&
  !file.startsWith("docs/public_release/")
));

const uniqueDocs = Array.from(new Set(activeDocs)).sort();
const staleRules = [
  { code: "air.repo_roles.air_verifier", pattern: /\bair-verifier\b/, message: "stale air-verifier reference" },
  { code: "air.repo_roles.airlang_install", pattern: /npm\s+install\s+-g\s+airlang\b/, message: "stale airlang install command" },
  { code: "air.repo_roles.unscoped_air_core_install", pattern: /npm\s+install\s+-g\s+air-core(?:@|\b)/, message: "unscoped air-core install command" },
];

for (const file of uniqueDocs) {
  const text = fs.readFileSync(path.join(root, file), "utf8");
  for (const rule of staleRules) {
    if (rule.pattern.test(text)) {
      diagnostics.push({ code: rule.code, message: rule.message, file });
    }
  }
}

const summary = {
  kind: "air.repoRolesCheck",
  status: diagnostics.length ? "failed" : "passed",
  packageName: pkg.name,
  packageVersion: pkg.version,
  cwd,
  activeDocsChecked: uniqueDocs.length,
  warnings,
  diagnostics,
};

console.log(JSON.stringify(summary, null, 2));
if (diagnostics.length) process.exit(1);

