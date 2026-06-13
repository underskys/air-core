#!/usr/bin/env node
"use strict";

const fs = require("fs");

const [checkFile, branch, commit, formatVersion] = process.argv.slice(2);
if (!checkFile || !branch || !commit) {
  console.error("usage: node scripts/write_consumer_evidence_summary.js <check-json> <branch> <commit> [format-version]");
  process.exit(1);
}

const check = JSON.parse(fs.readFileSync(checkFile, "utf8"));
const registry = JSON.parse(fs.readFileSync("consumer_evidence/DEMO_REGISTRY.json", "utf8"));

function countBy(items, key) {
  const counts = new Map();
  for (const item of items) {
    const value = item[key] || "unknown";
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function flattenUnique(items, key) {
  const values = new Set();
  for (const item of items) {
    for (const value of item[key] || []) values.add(value);
  }
  return [...values].sort();
}

function bulletList(items) {
  if (!items.length) return "- none\n";
  return items.map((item) => `- ${item}`).join("\n") + "\n";
}

function countList(entries) {
  if (!entries.length) return "- none\n";
  return entries.map(([key, count]) => `- ${key}: ${count}`).join("\n") + "\n";
}

const demos = [...(registry.demos || [])].sort((a, b) => String(a.id).localeCompare(String(b.id)));
const pending = demos
  .filter((demo) => demo.replayCount === 0 || demo.status === "proposed" || demo.status === "pressure-evidence")
  .map((demo) => `${demo.id}: ${demo.notes && demo.notes.length ? demo.notes.join("; ") : "pending or pressure-only evidence"}`);

const proofTypes = flattenUnique(demos, "proofTypes");
const allowedCapabilities = flattenUnique(demos, "allowedCapabilities");
const deniedAuthorities = flattenUnique(demos, "deniedAuthorities");
const replayCovered = demos.filter((demo) => Number(demo.replayCount || 0) > 0).map((demo) => demo.id).sort();
const diagnostics = (check.diagnostics || []).map((diagnostic) => `${diagnostic.code}: ${diagnostic.file}: ${diagnostic.message}`);

process.stdout.write(`# AIR Consumer Evidence Summary

${formatVersion ? `Bundle format: ${formatVersion}\n\n` : ""}Branch: ${branch}

Commit: ${commit}

## Validator

- kind: ${check.kind}
- status: ${check.status}
- demos checked: ${check.demoCount}
- passed: ${check.passed}
- failed: ${check.failed}

## Demo Count

${demos.length}

## Categories

${countList(countBy(demos, "category"))}
## Proof Coverage

${bulletList(proofTypes)}
## Allowed Capabilities Coverage

${bulletList(allowedCapabilities)}
## Denied Authorities Coverage

${bulletList(deniedAuthorities)}
## Replay Coverage

${bulletList(replayCovered)}
## Pending Evidence Items

${bulletList(pending)}
## Diagnostics

${bulletList(diagnostics)}
`);
