#!/usr/bin/env node
"use strict";

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

function toRel(file) {
  return path.relative(root, file).replace(/\\/g, "/");
}

function gitLsFiles() {
  const output = execFileSync("git", ["ls-files"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  return output.split(/\r?\n/).filter(Boolean);
}

function walkMarkdown(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkMarkdown(full));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      out.push(toRel(full));
    }
  }
  return out;
}

const packageJson = require(path.join(root, "package.json"));
const diagnostics = [];
const warnings = [];

if (packageJson.name !== "@underskys/air-core") {
  diagnostics.push({
    code: "air.public_release_source.package_name",
    message: `package name must be @underskys/air-core; got ${packageJson.name}`
  });
}

const activeDocFiles = new Set([
  "README.md",
  "ROADMAP.md",
  "CHANGELOG.md",
  "CONFORMANCE.md",
  "CONTRIBUTING.md",
  "METHOD.md",
  "SECURITY.md",
  "SHOWCASE.md",
  "THREAT_MODEL.md",
  "VERSIONING.md",
  "WHY_AIR.md",
  "docs/README.md",
  "docs/PUBLIC_CLAIMS.md",
  "docs/project-identity.md",
  "docs/air-overview.md",
  "docs/PROJECT_BOUNDARIES.md",
  "docs/BUILD_RUNTIME_BOUNDARY.md",
  "docs/TARGET_PRODUCT_MODEL.md"
]);

for (const rel of walkMarkdown(path.join(root, "docs", "public_release"))) {
  activeDocFiles.add(rel);
}
for (const rel of walkMarkdown(path.join(root, "docs", "release"))) {
  activeDocFiles.add(rel);
}

const activeDocRules = [
  {
    code: "air.public_release_source.legacy_air_verifier",
    pattern: /\bair-verifier\b/i,
    message: "active public docs must not refer to stale air-verifier identity"
  },
  {
    code: "air.public_release_source.airlang_install",
    pattern: /npm\s+install\s+-g\s+airlang\b/i,
    message: "active public docs must not advertise npm install -g airlang"
  },
  {
    code: "air.public_release_source.unscoped_air_core_install",
    pattern: /npm\s+install\s+-g\s+air-core\b/i,
    message: "active public docs must use scoped @underskys/air-core install identity"
  }
];

for (const rel of Array.from(activeDocFiles).sort()) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) continue;
  const lines = fs.readFileSync(full, "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    if (line.includes("public-release-source-allow")) return;
    for (const rule of activeDocRules) {
      if (rule.pattern.test(line)) {
        diagnostics.push({
          code: rule.code,
          file: rel,
          line: index + 1,
          message: rule.message,
          text: line.trim()
        });
      }
    }
  });
}

const tracked = gitLsFiles();
const forbiddenTrackedRules = [
  { code: "air.public_release_source.tgz_artifact", test: (p) => /\.tgz$/i.test(p), message: "tracked npm tarball artifact" },
  { code: "air.public_release_source.airlang_review_zip", test: (p) => /(^|\/)[^/]*airlang-review[^/]*\.zip$/i.test(p), message: "tracked airlang review zip" },
  { code: "air.public_release_source.mobile_summary", test: (p) => path.basename(p) === "MOBILE_SUMMARY.md", message: "tracked mobile summary review artifact" },
  { code: "air.public_release_source.review_request", test: (p) => path.basename(p) === "REVIEW_REQUEST.md", message: "tracked review request artifact" },
  { code: "air.public_release_source.public_export", test: (p) => p === "public_export" || p.startsWith("public_export/"), message: "tracked public_export staging directory" },
  { code: "air.public_release_source.raw_prompt_log", test: (p) => /(^|\/)(prompt[-_]?logs?|raw[-_]?prompt[-_]?logs?|raw[-_]?logs|chat[-_]?transcripts)(\/|$)/i.test(p), message: "tracked raw prompt log path" },
  { code: "air.public_release_source.raw_prompt_file", test: (p) => /(^|\/)(raw[-_]?prompt|prompt[-_]?log|chat[-_]?transcript)[^/]*\.(md|txt|json|jsonl|log)$/i.test(p), message: "tracked raw prompt log file" }
];

for (const rel of tracked) {
  for (const rule of forbiddenTrackedRules) {
    if (rule.test(rel)) {
      diagnostics.push({
        code: rule.code,
        file: rel,
        message: rule.message
      });
    }
  }
}

if (fs.existsSync(path.join(root, "PUBLIC_EXPORT_MANIFEST.md"))) {
  warnings.push({
    code: "air.public_release_source.historical_export_manifest",
    file: "PUBLIC_EXPORT_MANIFEST.md",
    message: "historical export manifest is not treated as active public release docs"
  });
}

const summary = {
  kind: "air.publicReleaseSourceCheck",
  status: diagnostics.length === 0 ? "passed" : "failed",
  package: {
    name: packageJson.name,
    version: packageJson.version,
    bin: packageJson.bin || {}
  },
  activeDocsChecked: Array.from(activeDocFiles).filter((rel) => fs.existsSync(path.join(root, rel))).sort(),
  trackedFilesChecked: tracked.length,
  forbiddenTrackedRules: forbiddenTrackedRules.map((rule) => rule.code).sort(),
  warnings,
  diagnostics
};

const json = JSON.stringify(summary, null, 2);
if (diagnostics.length > 0) {
  console.error(json);
  process.exit(1);
}

console.log(json);
