#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const root = process.env.AIR_ABI_REQUESTS_ROOT
  ? path.resolve(process.env.AIR_ABI_REQUESTS_ROOT)
  : path.resolve(__dirname, "..");
const indexFile = path.join(root, "docs", "abi-requests.md");
const requestDir = path.join(root, "docs", "abi-requests");
const readmeFile = path.join(requestDir, "README.md");

const allowedStatuses = new Set([
  "proposed",
  "accepted",
  "rejected",
  "deferred",
  "kit-only",
  "project-only",
  "implemented"
]);

const allowedTargetLayers = new Set([
  "core",
  "stdlib",
  "host ABI",
  "manifest schema",
  "reusable kit",
  "project kit",
  "host implementation",
  "docs",
  "examples"
]);

const legacyFileExceptions = new Map([
  ["airdoom.md", "historical project-kit triage summary; new concrete requests must use ## Request: blocks"],
  ["core-data-ergonomics.md", "historical Core RFC stub; implementation requires a separate Core RFC update"],
  ["gfx-showcase.md", "historical showcase triage summary; new concrete requests must use ## Request: blocks"],
  ["network-scanner.md", "historical host capability RFC; implementation remains future policy-gated work"],
  ["ui-dashboard.md", "historical dashboard triage summary; new concrete requests must use ## Request: blocks"]
]);

const requiredLineFields = [
  { name: "Status", re: /^Status:\s*(.+)$/im },
  { name: "Decision", re: /^Decision:\s*(.+)$/im },
  { name: "Source demo/project", re: /^Source\s+demo\/project:\s*(.+)$/im },
  { name: "Target layer", re: /^Target layer:\s*(.+)$/im },
  { name: "Version target", re: /^Version target:\s*(.+)$/im }
];

const requiredSections = [
  { name: "Problem", re: /^#{2,3}\s+Problem\s*$/im },
  { name: "Non-goals", re: /^#{2,3}\s+Non-goals\s*$/im },
  { name: "Verifier impact", re: /^#{2,3}\s+Verifier impact\s*$/im },
  { name: "Host ABI registry impact", re: /^#{2,3}\s+Host ABI registry impact\s*$/im },
  { name: "Manifest / package impact", re: /^#{2,3}\s+Manifest \/ package impact\s*$/im },
  { name: "Conformance tests", re: /^#{2,3}\s+Conformance tests\s*$/im },
  { name: "Acceptance criteria", re: /^#{2,3}\s+Acceptance criteria\s*$/im }
];

const workaroundOrAlternatives = [
  { name: "Current Workaround", re: /^#{2,3}\s+Current Workaround\s*$/im },
  { name: "Alternatives", re: /^#{2,3}\s+Alternatives\s*$/im }
];

function main() {
  const failures = [];
  requireFile(indexFile, failures);
  requireFile(readmeFile, failures);

  if (!fs.existsSync(requestDir)) {
    failures.push(`missing directory: ${relative(requestDir)}`);
    report(failures);
  }

  const files = fs
    .readdirSync(requestDir)
    .filter((name) => name.endsWith(".md") && name !== "README.md")
    .sort();

  for (const name of files) {
    const file = path.join(requestDir, name);
    const source = fs.readFileSync(file, "utf8");
    const blocks = requestBlocks(source);
    if (blocks.length === 0) {
      if (!legacyFileExceptions.has(name)) {
        failures.push(`${relative(file)}: missing '## Request:' block and no documented exception`);
      }
      continue;
    }

    for (const block of blocks) validateRequestBlock(file, block, failures);
  }

  validateTemplate(failures);
  validateIndex(failures);
  report(failures, files.length);
}

function validateRequestBlock(file, block, failures) {
  if (!block.title) {
    failures.push(`${relative(file)}: missing Request title`);
  }

  const fields = new Map();
  for (const field of requiredLineFields) {
    const match = block.body.match(field.re);
    if (!match || !match[1].trim()) {
      failures.push(`${relative(file)}: request '${block.title}' missing ${field.name}`);
    } else {
      fields.set(field.name, match[1].trim());
    }
  }

  const status = fields.get("Status");
  if (status && !allowedStatuses.has(status.toLowerCase())) {
    failures.push(`${relative(file)}: request '${block.title}' has invalid Status '${status}'`);
  }

  const targetLayerText = fields.get("Target layer");
  const targetLayers = targetLayerText ? parseTargetLayers(targetLayerText) : [];
  if (targetLayerText && targetLayers.length === 0) {
    failures.push(`${relative(file)}: request '${block.title}' has no machine-readable target layer in '${targetLayerText}'`);
  }
  for (const layer of targetLayers) {
    if (!allowedTargetLayers.has(layer)) {
      failures.push(`${relative(file)}: request '${block.title}' has invalid Target layer '${layer}'`);
    }
  }

  for (const section of requiredSections) {
    if (!section.re.test(block.body)) {
      failures.push(`${relative(file)}: request '${block.title}' missing ${section.name}`);
    }
  }

  if (!workaroundOrAlternatives.some((section) => section.re.test(block.body))) {
    failures.push(`${relative(file)}: request '${block.title}' missing Current Workaround or Alternatives`);
  }

  const decisionText = (fields.get("Decision") || "").toLowerCase();
  const projectOnly = (status || "").toLowerCase() === "project-only" || decisionText.includes("project-only");
  const onlyProjectKit = targetLayers.length > 0 && targetLayers.every((layer) => layer === "project kit");
  if (!projectOnly && !onlyProjectKit && !/^#{2,3}\s+Why Generic\s*$/im.test(block.body)) {
    failures.push(`${relative(file)}: request '${block.title}' missing Why Generic`);
  }

  const publicAbi = proposesPublicAbi(block.body, targetLayers);
  if (publicAbi) validatePublicAbiRequest(file, block, failures);

  const source = fields.get("Source demo/project") || "";
  const demoSpecific = /project-specific|demo-specific|project-only/i.test(block.body) || projectOnly || targetLayers.includes("project kit");
  if (source && /demo|project/i.test(source) && demoSpecific && targetLayers.includes("host ABI")) {
    failures.push(`${relative(file)}: request '${block.title}' is demo-specific but targets direct public Host ABI`);
  }
}

function validatePublicAbiRequest(file, block, failures) {
  const checks = [
    { name: "spec impact", re: /spec impact/i },
    { name: "host ABI registry impact", re: /^#{2,3}\s+Host ABI registry impact\s*$/im },
    { name: "verifier impact", re: /^#{2,3}\s+Verifier impact\s*$/im },
    { name: "tests", re: /tests|Conformance tests/i },
    { name: "migration notes or not required", re: /migration notes|not required/i }
  ];
  for (const check of checks) {
    if (!check.re.test(block.body)) {
      failures.push(`${relative(file)}: public ABI request '${block.title}' missing ${check.name}`);
    }
  }
}

function validateTemplate(failures) {
  const readme = fs.existsSync(readmeFile) ? fs.readFileSync(readmeFile, "utf8") : "";
  const templateTerms = [
    "Request",
    "Status",
    "Decision",
    "Source demo/project",
    "Target layer",
    "Version target",
    "Problem",
    "Current Workaround",
    "Alternatives",
    "Why Generic",
    "Non-goals",
    "Verifier impact",
    "Host ABI registry impact",
    "Manifest / package impact",
    "Conformance tests",
    "Acceptance criteria"
  ];
  for (const term of templateTerms) {
    if (!readme.includes(term)) {
      failures.push(`${relative(readmeFile)}: request template does not mention ${term}`);
    }
  }
}

function validateIndex(failures) {
  const index = fs.existsSync(indexFile) ? fs.readFileSync(indexFile, "utf8") : "";
  for (const phrase of ["evidence, not authority", "Public ABI changes require", "Target layer"]) {
    if (!index.includes(phrase)) {
      failures.push(`${relative(indexFile)}: missing governance phrase '${phrase}'`);
    }
  }
}

function parseTargetLayers(value) {
  return value
    .split(/\s*(?:\/|,|\bor\b|\band\b)\s*/i)
    .map((item) => item.replace(/[`.;:]/g, "").trim())
    .filter(Boolean)
    .map((item) => normalizeTargetLayer(item));
}

function normalizeTargetLayer(value) {
  const lower = value.toLowerCase();
  for (const allowed of allowedTargetLayers) {
    if (lower === allowed.toLowerCase()) return allowed;
  }
  return value;
}

function proposesPublicAbi(body, targetLayers) {
  if (targetLayers.includes("host ABI")) return true;
  const publicAbiPhrases = [
    /propos(?:e|es|ed|ing)\s+(?:a\s+)?(?:new\s+)?public\s+(?:host\s+)?abi/i,
    /new\s+public\s+(?:host\s+)?abi\s+(?:function|import|signature|surface)/i,
    /add\s+(?:a\s+)?public\s+(?:host\s+)?abi/i
  ];
  return publicAbiPhrases.some((re) => re.test(body));
}

function requestBlocks(source) {
  const matches = Array.from(source.matchAll(/^## Request:\s*(.+)$/gim));
  return matches.map((match, index) => {
    const start = match.index;
    const end = index + 1 < matches.length ? matches[index + 1].index : source.length;
    return { title: match[1].trim(), body: source.slice(start, end) };
  });
}

function requireFile(file, failures) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    failures.push(`missing file: ${relative(file)}`);
  }
}

function relative(file) {
  return path.relative(root, file).replace(/\\/g, "/");
}

function report(failures, checkedFiles = 0) {
  if (failures.length) {
    console.error("ABI request pipeline check failed.");
    console.error("");
    for (const failure of failures) console.error(`- ${failure}`);
    console.error("");
    console.error("New concrete ABI requests must use structured '## Request:' blocks.");
    console.error("Historical summary/RFC docs require explicit exceptions in scripts/check_abi_requests.js.");
    process.exit(1);
  }
  console.log(`abi request pipeline check: ${checkedFiles} file(s), structured requests valid`);
}

main();
