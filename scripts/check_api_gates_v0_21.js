#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const failures = [];
const warnings = [];

const scanRoots = [
  "src",
  "stdlib",
  "spec",
  "hosts",
  "data",
  "examples",
  "kits"
];

const textExtensions = new Set([
  ".air",
  ".js",
  ".cjs",
  ".mjs",
  ".ts",
  ".tsx",
  ".json",
  ".md",
  ".toml",
  ".wit"
]);

const allowedEventImportFiles = [
  /^test\//,
  /^docs\//,
  /^requests\//,
  /^REVIEW_RESULTS\//
];

const allowedRejectionMetadata = new Set([
  "src/surface.js",
  "src/sdk.js",
  "spec/HOST_PROFILES.md",
  "spec/AIR_PACKAGE_MANIFEST.md"
]);

const acceptedOutputEmitV026Files = new Set([
  "src/host_abi.js",
  "src/sdk.js",
  "src/mock_host_policy.js",
  "src/verifier_safety_fuzz.js",
  "src/verifier.js",
  "spec/CAPABILITIES.md",
  "spec/HOST_PROFILES.md",
  "spec/AIR_PACKAGE_MANIFEST.md",
  "data/host_profiles/mock-output-v011.json"
]);

function main() {
  const files = scanRoots.flatMap((dir) => listFiles(path.join(root, dir)));
  for (const file of files) {
    const rel = normalize(path.relative(root, file));
    if (!textExtensions.has(path.extname(file))) continue;
    const text = fs.readFileSync(file, "utf8");
    checkRawChrome(rel, text);
    checkEventImports(rel, text);
    checkHostAbi(rel, text);
    checkHostHandles(rel, text);
  }

  warnings.push("runtime JSON/object-model gate is docs/validator-reviewed in v0.21; broad payload/data heuristics are not release-blocking yet");

  if (warnings.length) {
    for (const warning of warnings) console.warn(`warn: ${warning}`);
  }
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exit(1);
  }
  console.log(`api gates v0.21: ok (${files.length} file(s) scanned)`);
}

function checkRawChrome(rel, text) {
  if (/\bchrome\.[A-Za-z_]/.test(text)) {
    failures.push(`${rel}: raw chrome.* access is not allowed in active AIR Core/API paths`);
  }
}

function checkEventImports(rel, text) {
  const rejectedEventImport = /\bextern\s+(?:output\.event|audio\.event|effect\.event)\b/;
  if (rejectedEventImport.test(text) && !allowedEventImportFiles.some((re) => re.test(rel))) {
    failures.push(`${rel}: output/audio/effect event Host ABI extern is not allowed without promotion gate`);
  }
  if (/\bextern\s+output\.emit\b/.test(text) && !acceptedOutputEmitV026Files.has(rel) && !allowedEventImportFiles.some((re) => re.test(rel))) {
    failures.push(`${rel}: output.emit Host ABI extern is allowed only in the accepted v0.26 bounded output emit surface`);
  }

  const eventImplementation = /\b(?:output\.emit|output\.event|audio\.event|effect\.event)\b/;
  if (eventImplementation.test(text) && !allowedRejectionMetadata.has(rel) && !allowedEventImportFiles.some((re) => re.test(rel))) {
    if (/\boutput\.emit\b/.test(text) && acceptedOutputEmitV026Files.has(rel) && !/\b(?:output\.event|audio\.event|effect\.event)\b/.test(text)) return;
    if (/\b(hostImports?|registry|supports|extern|import|capabilit(?:y|ies))\b/i.test(text)) {
      failures.push(`${rel}: output/audio/effect event appears in active implementation metadata; keep it docs/tests/rejection-only until promoted`);
    }
  }
}

function checkHostAbi(rel, text) {
  if (/^data\/host_profiles\/.+\.json$/.test(rel) && /"hostAbi"\s*:\s*"0\.11"/.test(text)) {
    if (!acceptedOutputEmitV026Files.has(rel)) {
      failures.push(`${rel}: Host ABI 0.11 profile support requires an explicit v0.21+ decision record`);
    }
  }
  if (/^src\//.test(rel) && /\b(?:AIR_ABI_VERSION|HOST_ABI_VERSION)\b[^;\n]*["']0\.11["']/.test(text)) {
    failures.push(`${rel}: AIR/Host ABI 0.11 source constant requires an explicit decision record`);
  }
}

function checkHostHandles(rel, text) {
  if (allowedRejectionMetadata.has(rel)) return;
  if (/(?:^|[,{]\s*)["']?hostHandle["']?\s*:/.test(text)) {
    failures.push(`${rel}: hostHandle API fields are not allowed in active Core/API paths`);
  }
}

function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist" || entry.name === "build") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function normalize(value) {
  return value.split(path.sep).join("/");
}

main();
