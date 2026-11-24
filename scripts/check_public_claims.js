#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

const banned = [
  /formally verified/i,
  /proved correct/i,
  /proves correctness/i,
  /secure AI code/i,
  /faster than JS/i,
  /faster than TypeScript/i,
  /faster than C\+\+/i,
  /faster than all languages/i,
  /impossible to escape/i,
  /AI cannot break out/i,
  /universal sandbox/i,
  /general purpose replacement/i,
  /entire toolchain was written by AI/i
];

const explicitFiles = [
  "docs/RELEASE_NOTES_0_54_0.md",
  "docs/v0.54/n54-01/CONTRACT.md",
  "docs/v0.54/n54-01/THREAT_MODEL.md",
  "docs/v0.54/n54-01/NORMS_TABLE.md",
  "docs/v0.54/n54-01/OPEN_DECISIONS.md",
  "README.md",
  "SHOWCASE.md",
  "WHY_AIR.md",
  "METHOD.md",
  "SECURITY.md",
  "THREAT_MODEL.md",
  "CONFORMANCE.md",
  "ROADMAP.md",
  "VERSIONING.md",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "docs/PUBLIC_CLAIMS.md",
  "docs/RELEASE_NOTES_0_50_0.md",
  "docs/RELEASE_NOTES_0_51_0.md",
  "docs/v0.53/AIR_FOR_MODELS.md",
  "llms.txt",
  "skills/air/SKILL.md"
];

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      out.push(full);
    }
  }
  return out;
}

function toRel(file) {
  return path.relative(root, file).replace(/\\/g, "/");
}

const files = new Set();
for (const rel of explicitFiles) {
  const full = path.join(root, rel);
  if (fs.existsSync(full)) files.add(toRel(full));
}
for (const full of walk(path.join(root, "docs", "public_release"))) {
  files.add(toRel(full));
}
// P0-12 (OD-P12-4 (a)): the shipped typed docs.
for (const full of walk(path.join(root, "docs", "v0.53"))) {
  files.add(toRel(full));
}

const diagnostics = [];
for (const rel of Array.from(files).sort()) {
  const full = path.join(root, rel);
  const lines = fs.readFileSync(full, "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    if (line.includes("public-claims-allow")) return;
    for (const pattern of banned) {
      if (pattern.test(line)) {
        diagnostics.push({
          file: rel,
          line: index + 1,
          pattern: pattern.source,
          text: line.trim()
        });
      }
    }
  });
}

if (diagnostics.length > 0) {
  console.error("public claims check failed:");
  for (const d of diagnostics) {
    console.error(`- ${d.file}:${d.line}: ${d.text}`);
  }
  console.error("Add a safer phrasing, or add an explicit public-claims-allow marker for policy examples only.");
  process.exit(1);
}

console.log(JSON.stringify({
  kind: "air.publicClaimsCheck",
  status: "passed",
  filesChecked: Array.from(files).sort(),
  bannedPhraseCount: banned.length,
  diagnostics: []
}, null, 2));
