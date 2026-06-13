#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");

function main() {
  const options = parseArgs(process.argv.slice(2));
  const corpusRoot = options.root
    ? path.resolve(options.root)
    : process.env.AIR_CONSUMER_EVIDENCE_ROOT
      ? path.resolve(process.env.AIR_CONSUMER_EVIDENCE_ROOT)
      : path.join(repoRoot, "consumer_evidence");

  const result = checkConsumerEvidence(corpusRoot);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status !== "passed") process.exit(1);
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--root") {
      options.root = args[index + 1];
      index += 1;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

function checkConsumerEvidence(corpusRoot) {
  const diagnostics = [];
  const warnings = [];
  const demos = [];
  const registryFile = path.join(corpusRoot, "DEMO_REGISTRY.json");
  const registry = readJson(registryFile, diagnostics, corpusRoot, "air.consumer_evidence.registry_invalid");

  if (!registry) {
    return buildReport({ diagnostics, warnings, demos });
  }

  if (registry.schemaVersion !== 1) {
    diagnostics.push(diagnostic("air.consumer_evidence.registry_schema_version_invalid", "fail", rel(registryFile, corpusRoot), "DEMO_REGISTRY.json must use schemaVersion 1."));
  }
  if (!Array.isArray(registry.demos)) {
    diagnostics.push(diagnostic("air.consumer_evidence.registry_demos_invalid", "fail", rel(registryFile, corpusRoot), "DEMO_REGISTRY.json must contain a demos array."));
  }

  const ids = new Set();
  const registryDemos = Array.isArray(registry.demos) ? [...registry.demos].sort((a, b) => String(a.id || "").localeCompare(String(b.id || ""))) : [];
  for (const entry of registryDemos) {
    const demoDiagnostics = [];
    const id = String(entry.id || "");
    if (!id) {
      diagnostics.push(diagnostic("air.consumer_evidence.demo_id_missing", "fail", rel(registryFile, corpusRoot), "Registry demo is missing id."));
      continue;
    }
    if (ids.has(id)) {
      demoDiagnostics.push(diagnostic("air.consumer_evidence.demo_id_duplicate", "fail", `DEMO_REGISTRY.json:${id}`, `Duplicate consumer evidence demo id '${id}'.`));
    }
    ids.add(id);

    const demoDir = path.join(corpusRoot, "demos", id);
    if (!fs.existsSync(demoDir) || !fs.statSync(demoDir).isDirectory()) {
      demoDiagnostics.push(diagnostic("air.consumer_evidence.demo_dir_missing", "fail", `demos/${id}`, `Registry demo '${id}' must have a directory under consumer_evidence/demos/${id}.`));
    } else {
      validateRegistryReferences(entry, corpusRoot, demoDiagnostics);
      validateDemoDirectory(entry, demoDir, corpusRoot, demoDiagnostics);
    }

    demos.push({
      id,
      status: demoDiagnostics.some((item) => item.severity === "fail") ? "failed" : "passed",
      diagnostics: demoDiagnostics
    });
    diagnostics.push(...demoDiagnostics);
  }

  scanSafety(corpusRoot, diagnostics);

  return buildReport({ diagnostics, warnings, demos });
}

function validateRegistryReferences(entry, corpusRoot, diagnostics) {
  for (const key of ["evidencePath", "pressurePath"]) {
    const value = entry[key];
    if (!value) continue;
    const target = path.resolve(corpusRoot, "..", value);
    if (!isWithin(path.resolve(corpusRoot, ".."), target)) {
      diagnostics.push(diagnostic("air.consumer_evidence.reference_path_invalid", "fail", `DEMO_REGISTRY.json:${entry.id}`, `${key} must stay within the repository.`));
      continue;
    }
    if (!fs.existsSync(target) && !hasPendingReason(entry)) {
      diagnostics.push(diagnostic("air.consumer_evidence.reference_missing", "fail", `DEMO_REGISTRY.json:${entry.id}`, `${key} '${value}' does not exist and no pending reason was provided.`));
    }
  }
}

function validateDemoDirectory(entry, demoDir, corpusRoot, diagnostics) {
  const manifestFile = path.join(demoDir, "MANIFEST.json");
  const proofCardFile = path.join(demoDir, "PROOF_CARD.md");
  const promptsFile = path.join(demoDir, "PROMPTS.md");
  const boundaryFile = path.join(demoDir, "reports", "capability_boundary.md");

  const manifest = readJson(manifestFile, diagnostics, corpusRoot, "air.consumer_evidence.manifest_invalid");
  if (manifest) validateManifest(entry, manifest, manifestFile, corpusRoot, diagnostics);

  if (!fs.existsSync(proofCardFile)) {
    diagnostics.push(diagnostic("air.consumer_evidence.proof_card_missing", "fail", rel(proofCardFile, corpusRoot), "PROOF_CARD.md is required."));
  } else {
    validateProofCard(proofCardFile, corpusRoot, diagnostics);
  }

  if (!fs.existsSync(boundaryFile)) {
    diagnostics.push(diagnostic("air.consumer_evidence.capability_boundary_missing", "fail", rel(boundaryFile, corpusRoot), "reports/capability_boundary.md is required."));
  }

  if (entry.hasAiPrompt === true && !fs.existsSync(promptsFile)) {
    diagnostics.push(diagnostic("air.consumer_evidence.prompts_missing", "fail", rel(promptsFile, corpusRoot), "PROMPTS.md is required when hasAiPrompt is true."));
  }

  const replayDir = path.join(demoDir, "replay");
  const replayJsonFiles = listFiles(replayDir).filter((file) => file.endsWith(".json"));
  const pendingReason = hasPendingReason(entry) || hasPendingReason(manifest || {});
  if (replayJsonFiles.length === 0 && !pendingReason) {
    diagnostics.push(diagnostic("air.consumer_evidence.replay_missing", "fail", rel(replayDir, corpusRoot), "Each demo must include at least one replay/*.json or an explicit pending reason."));
  }
}

function validateManifest(entry, manifest, manifestFile, corpusRoot, diagnostics) {
  const requiredStringFields = ["id", "name", "category", "status", "airRole", "hostRole"];
  for (const field of requiredStringFields) {
    if (typeof manifest[field] !== "string" || manifest[field].trim() === "") {
      diagnostics.push(diagnostic("air.consumer_evidence.manifest_field_missing", "fail", rel(manifestFile, corpusRoot), `MANIFEST.json missing required string field '${field}'.`));
    }
  }
  if (manifest.id && entry.id && manifest.id !== entry.id) {
    diagnostics.push(diagnostic("air.consumer_evidence.manifest_id_mismatch", "fail", rel(manifestFile, corpusRoot), `MANIFEST.json id '${manifest.id}' does not match registry id '${entry.id}'.`));
  }

  for (const field of ["allowedCapabilities", "deniedAuthorities", "proofTypes", "privacySafetyNotes"]) {
    if (!Array.isArray(manifest[field]) || manifest[field].length === 0) {
      diagnostics.push(diagnostic("air.consumer_evidence.manifest_array_missing", "fail", rel(manifestFile, corpusRoot), `MANIFEST.json field '${field}' must be a non-empty array.`));
    }
  }
}

function validateProofCard(proofCardFile, corpusRoot, diagnostics) {
  const text = fs.readFileSync(proofCardFile, "utf8");
  const requiredHeadings = [
    "Status",
    "AIR owns",
    "Host owns",
    "Allowed capabilities",
    "Denied authorities",
    "Evidence",
    "Known limitations"
  ];
  for (const heading of requiredHeadings) {
    const re = new RegExp(`^#{1,3}\\s+${escapeRegExp(heading)}\\s*$`, "im");
    const inlineRe = new RegExp(`^${escapeRegExp(heading)}\\s*:`, "im");
    if (!re.test(text) && !inlineRe.test(text)) {
      diagnostics.push(diagnostic("air.consumer_evidence.proof_card_heading_missing", "fail", rel(proofCardFile, corpusRoot), `PROOF_CARD.md missing required heading '${heading}'.`));
    }
  }
}

function scanSafety(corpusRoot, diagnostics) {
  const files = listFiles(corpusRoot).sort();
  for (const file of files) {
    const relative = rel(file, corpusRoot);
    const parts = relative.split(/[\\/]/);
    const lower = relative.toLowerCase();
    const stat = fs.statSync(file);

    if (parts.includes("node_modules")) {
      diagnostics.push(diagnostic("air.consumer_evidence.node_modules_committed", "fail", relative, "node_modules must not be committed in consumer evidence."));
    }
    if (/\.(?:mp4|mov|webm)$/i.test(file) || parts.includes("media")) {
      diagnostics.push(diagnostic("air.consumer_evidence.large_media_committed", "fail", relative, "Large media files must be release artifacts, not committed consumer evidence."));
    }
    if (/\.(?:pcap|pcapng)$/i.test(file)) {
      diagnostics.push(diagnostic("air.consumer_evidence.raw_packet_dump_committed", "fail", relative, "Raw packet dumps must not be committed."));
    }
    if (stat.size > 2 * 1024 * 1024 && !/\.(?:schema\.json|json|md|gitignore)$/i.test(file)) {
      diagnostics.push(diagnostic("air.consumer_evidence.large_file_committed", "fail", relative, "Large generated files must not be committed to consumer evidence."));
    }

    if (!isTextLike(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) {
      diagnostics.push(diagnostic("air.consumer_evidence.private_key_committed", "fail", relative, "Private key blocks must not be committed."));
    }
    if (/(?:api[_-]?key|token|secret|password)\s*[:=]\s*["']?[A-Za-z0-9_\-]{12,}/i.test(text) || /\b(?:sk|ghp|glpat)-[A-Za-z0-9_\-]{12,}\b/.test(text)) {
      diagnostics.push(diagnostic("air.consumer_evidence.secret_like_content", "fail", relative, "Secret-looking content must not be committed."));
    }
    if (/(?:^|[\s"'(])(?:\/Users\/|\/home\/|\/tmp\/|\/var\/folders\/|[A-Za-z]:[\\/])/.test(text)) {
      diagnostics.push(diagnostic("air.consumer_evidence.absolute_path_committed", "fail", relative, "Local absolute paths must not be committed."));
    }
    const urls = text.match(/\bhttps?:\/\/[^\s)>"]+/g) || [];
    for (const url of urls) {
      if (!isAllowedPublicUrl(url)) {
        diagnostics.push(diagnostic("air.consumer_evidence.raw_private_url", "fail", relative, `Raw URL '${url}' must be removed or explicitly sanitized.`));
      }
    }
    if (/\b(?:host\.fetch|chrome\.|indexedDB|localStorage|navigator\.|document\.|window\.|db\.query|cloud\.|socket\.|packet capture)\b/i.test(text) && !/\b(?:denied|deniedAuthorities|rejected|forbidden|must not|not committed|host-owned|demo-local)\b/i.test(text)) {
      diagnostics.push(diagnostic("air.consumer_evidence.raw_host_authority_claim", "fail", relative, "Raw host authority claims must appear only in denied-authority context."));
    }
  }
}

function buildReport({ diagnostics, warnings, demos }) {
  const failed = diagnostics.filter((item) => item.severity === "fail").length;
  const passed = failed === 0;
  const sortedDiagnostics = diagnostics.sort(compareDiagnostic);
  const sortedWarnings = warnings.sort(compareDiagnostic);
  const sortedDemos = demos
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((demo) => ({
      id: demo.id,
      status: demo.status,
      diagnostics: demo.diagnostics.sort(compareDiagnostic)
    }));

  return {
    kind: "air.consumerEvidenceCheck",
    status: passed ? "passed" : "failed",
    demoCount: sortedDemos.length,
    passed: sortedDemos.filter((demo) => demo.status === "passed").length,
    failed: sortedDemos.filter((demo) => demo.status === "failed").length,
    warnings: sortedWarnings,
    diagnostics: sortedDiagnostics,
    demos: sortedDemos
  };
}

function readJson(file, diagnostics, corpusRoot, code) {
  if (!fs.existsSync(file)) {
    diagnostics.push(diagnostic(code, "fail", rel(file, corpusRoot), `${path.basename(file)} is missing.`));
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    diagnostics.push(diagnostic(code, "fail", rel(file, corpusRoot), `${path.basename(file)} is not valid JSON: ${err.message}`));
    return null;
  }
}

function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir).sort()) {
    const file = path.join(dir, name);
    const stat = fs.statSync(file);
    if (stat.isDirectory()) out.push(...listFiles(file));
    else if (stat.isFile()) out.push(file);
  }
  return out;
}

function hasPendingReason(value) {
  return value && typeof value.pendingReason === "string" && value.pendingReason.trim() !== "";
}

function rel(file, corpusRoot) {
  const relative = path.relative(corpusRoot, file).split(path.sep).join("/");
  return relative === "" ? "." : relative;
}

function isWithin(parent, target) {
  const relative = path.relative(parent, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isTextLike(file) {
  return /\.(?:json|md|txt|gitignore)$/i.test(file) || path.basename(file) === ".gitignore";
}

function isAllowedPublicUrl(url) {
  return /^https:\/\/(?:json-schema\.org|airlang\.dev)\//.test(url);
}

function diagnostic(code, severity, file, message) {
  return { code, severity, file, message };
}

function compareDiagnostic(a, b) {
  return `${a.file}\0${a.code}\0${a.message}`.localeCompare(`${b.file}\0${b.code}\0${b.message}`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    const report = buildReport({
      diagnostics: [diagnostic("air.consumer_evidence.internal_error", "fail", ".", err.message)],
      warnings: [],
      demos: []
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exit(1);
  }
}

module.exports = {
  checkConsumerEvidence
};
