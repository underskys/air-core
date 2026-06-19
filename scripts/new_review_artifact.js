#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const defaultRoot = path.resolve(__dirname, "..");
const root = resolveRoot();

const templateDir = path.join(root, "review_artifacts", "templates");
const activeRoot = path.join(root, "review_artifacts", "active");

const requiredByKind = {
  "core-release": ["CHANGESET_SUMMARY.md", "QA_REPORT.md", "RELEASE_DECISION.md"],
  "core-hygiene": ["CHANGESET_SUMMARY.md", "QA_REPORT.md"],
  "consumer-demo": ["PRESSURE_REQUEST.md", "QA_REPORT.md"],
  "internal-dev": ["CHANGESET_SUMMARY.md"]
};

const sourceRepoByKind = {
  "core-release": "air-core",
  "core-hygiene": "air-core",
  "consumer-demo": "demo",
  "internal-dev": "airlang"
};

function main() {
  const args = parseArgs(process.argv.slice(2));
  const kind = args.kind;
  const id = args.id;

  if (!kind || !id || args.help) {
    printUsage();
    process.exit(args.help ? 0 : 1);
  }

  if (!Object.prototype.hasOwnProperty.call(requiredByKind, kind)) {
    fail(`invalid --kind '${kind}'. Expected one of: ${Object.keys(requiredByKind).join(", ")}`);
  }

  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) {
    fail("--id must be a single path-safe identifier using letters, numbers, dots, underscores, or hyphens");
  }

  const destination = path.join(activeRoot, id);
  if (fs.existsSync(destination) && fs.readdirSync(destination).length > 0) {
    fail(`review artifact directory already exists and is not empty: ${rel(destination)}`);
  }

  fs.mkdirSync(destination, { recursive: true });

  const artifacts = ["BUNDLE_MANIFEST.json", ...requiredByKind[kind]];
  for (const artifact of requiredByKind[kind]) {
    copyTemplate(artifact, destination);
  }

  const manifest = buildManifest(kind, id, artifacts);
  fs.writeFileSync(
    path.join(destination, "BUNDLE_MANIFEST.json"),
    `${JSON.stringify(manifest, null, 2)}\n`
  );

  const created = artifacts.map((artifact) => path.posix.join(rel(destination), artifact)).sort();
  console.log([
    `Created ${kind} review artifact skeleton: ${rel(destination)}`,
    "",
    "Files:",
    ...created.map((file) => `- ${file}`),
    "",
    "Next steps:",
    "- Fill required fields before review handoff.",
    "- Keep review_artifacts/active/ out of npm package contents.",
    "- Commit active artifacts only when they are explicitly intended as release evidence."
  ].join("\n"));
}

function buildManifest(kind, id, artifacts) {
  return {
    kind,
    bundleKind: kind,
    id,
    sourceRepo: sourceRepoByKind[kind],
    targetRepo: "air-core",
    branch: "<branch>",
    commit: "<commit>",
    publicClean: kind === "core-release" || kind === "core-hygiene",
    npmEligible: kind === "core-release",
    forbiddenContentCheck: "pending",
    artifacts,
    internalSlice: "M45-S1",
    publicVersion: kind === "core-release" ? "0.45.1" : undefined,
    npmPackage: "@underskys/air-core",
    packageVersion: "<package-version>",
    airAbi: "0.10",
    hostAbi: "0.11 latest, limited to bounded output.emit; 0.10 baseline supported",
    npmContents: [],
    knownLimitations: []
  };
}

function copyTemplate(name, destination) {
  const source = path.join(templateDir, name);
  if (!fs.existsSync(source)) {
    fail(`missing review artifact template: ${rel(source)}`);
  }
  fs.copyFileSync(source, path.join(destination, name));
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--kind" || arg === "--id" || arg === "--root") {
      parsed[arg.slice(2)] = argv[i + 1];
      i += 1;
    } else {
      fail(`unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function resolveRoot() {
  const argv = process.argv.slice(2);
  const index = argv.indexOf("--root");
  if (index !== -1 && argv[index + 1]) {
    return path.resolve(argv[index + 1]);
  }
  return defaultRoot;
}

function rel(file) {
  return path.relative(root, file).replace(/\\/g, "/") || ".";
}

function printUsage() {
  console.log([
    "Usage:",
    "  node scripts/new_review_artifact.js --kind <kind> --id <id>",
    "",
    "Kinds:",
    ...Object.keys(requiredByKind).map((kind) => `  - ${kind}`),
    "",
    "Examples:",
    "  npm run review:new -- --kind core-release --id M45-S1-math-roadmap",
    "  npm run review:new -- --kind consumer-demo --id airmatlab-pressure",
    "  npm run review:new -- --kind core-hygiene --id package-identity-cleanup"
  ].join("\n"));
}

function fail(message) {
  console.error(`review artifact generator failed: ${message}`);
  process.exit(1);
}

main();
