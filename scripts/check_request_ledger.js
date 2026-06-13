#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const defaultRoot = path.resolve(__dirname, "..");
const root = resolveRoot(process.argv.slice(2));
const requestRoot = path.join(root, "requests");
const requestDirs = ["accepted", "rejected", "archive", "inbox"];
const abiRequestDir = path.join(root, "docs", "abi-requests");
const consumerRegistry = path.join(root, "consumer_evidence", "DEMO_REGISTRY.json");

const allowedStatuses = new Set([
  "implemented",
  "accepted/planned",
  "rejected/kit",
  "rejected/project-only",
  "rejected/post-1.0",
  "archive/historical"
]);

const allowedLayers = new Set([
  "core",
  "stdlib",
  "host ABI",
  "manifest schema",
  "reusable kit",
  "project kit",
  "host implementation"
]);

const allowedAlternatives = new Set(["kit", "project-local", "host-owned", "post-1.0", "no-action"]);

const fieldAliases = {
  title: ["title", "Title"],
  source: ["source", "Source", "Source demo/project"],
  sourcePath: ["sourcePath", "Source path", "Original source path"],
  targetLayer: ["targetLayer", "Target layer"],
  status: ["status", "Status"],
  decision: ["decision", "Decision"],
  rationale: ["rationale", "Rationale"],
  compatibilityRisk: ["compatibilityRisk", "Compatibility risk"],
  versionTarget: ["versionTarget", "Version target"],
  closedByVersion: ["closedByVersion", "Closed in"],
  owner: ["owner", "Owner"],
  decisionOwner: ["decisionOwner", "Decision owner", "Owner"],
  reason: ["reason", "Reason", "Rejection reason"],
  alternative: ["alternative", "Alternative"],
  whyNotCore: ["whyNotCore", "Why not Core"],
  historicalReason: ["historicalReason", "Historical reason", "Archived because"],
  activeRoadmapItem: ["activeRoadmapItem", "Active roadmap item"],
  noActivePressureReason: ["noActivePressureReason", "No active pressure reason"]
};

const baseRequired = ["title", "source", "sourcePath", "targetLayer", "status", "decision", "rationale"];

function main() {
  const diagnostics = [];
  const entries = readEntries(diagnostics);

  validateEntries(entries, diagnostics);
  const uncoveredAbiRequests = validateAbiRequestCoverage(entries, diagnostics);
  validateConsumerEvidenceCoverage(entries, diagnostics);
  validateInboxReadme(entries, diagnostics);

  diagnostics.sort(compareDiagnostic);

  const missingFields = diagnostics
    .filter((item) => item.code === "air.request_ledger.missing_field")
    .map((item) => ({ path: item.path, field: item.field }))
    .sort(comparePathField);
  const unresolvedInbox = diagnostics
    .filter((item) => item.code === "air.request_ledger.inbox_unresolved")
    .map((item) => item.path)
    .sort();

  const counts = countEntries(entries);
  const report = {
    kind: "air.requestLedgerCheck",
    status: diagnostics.length === 0 ? "passed" : "failed",
    requestCount: entries.length,
    accepted: counts.accepted,
    rejected: counts.rejected,
    archived: counts.archived,
    inbox: counts.inbox,
    missingFields,
    uncoveredAbiRequests,
    unresolvedInbox,
    diagnostics
  };

  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  if (diagnostics.length > 0) process.exit(1);
}

function resolveRoot(args) {
  const idx = args.indexOf("--root");
  if (idx !== -1 && args[idx + 1]) return path.resolve(args[idx + 1]);
  if (process.env.AIR_REQUEST_LEDGER_ROOT) return path.resolve(process.env.AIR_REQUEST_LEDGER_ROOT);
  return defaultRoot;
}

function readEntries(diagnostics) {
  const entries = [];
  for (const dirName of requestDirs) {
    const dir = path.join(requestRoot, dirName);
    if (!fs.existsSync(dir)) {
      addDiagnostic(diagnostics, "air.request_ledger.directory_missing", rel(dir), `missing request directory: ${rel(dir)}`);
      continue;
    }
    for (const name of fs.readdirSync(dir).sort()) {
      if (!name.endsWith(".md") || name === "README.md") continue;
      const file = path.join(dir, name);
      const text = fs.readFileSync(file, "utf8");
      const rawFields = parseFields(text);
      entries.push({ file, path: rel(file), dirName, text, rawFields, fields: normalizeFields(rawFields) });
    }
  }
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

function parseFields(text) {
  const fields = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z][A-Za-z /]+):\s*(.+)$/);
    if (!match) continue;
    fields[match[1].trim()] = match[2].trim();
  }
  return fields;
}

function normalizeFields(rawFields) {
  const fields = {};
  for (const [canonical, aliases] of Object.entries(fieldAliases)) {
    for (const alias of aliases) {
      if (rawFields[alias]) {
        fields[canonical] = rawFields[alias];
        break;
      }
    }
  }
  return fields;
}

function validateEntries(entries, diagnostics) {
  const seenTitles = new Map();
  for (const entry of entries) {
    for (const field of baseRequired) {
      if (!entry.fields[field]) {
        addDiagnostic(diagnostics, "air.request_ledger.missing_field", entry.path, `${entry.path}: missing ${field}`, { field });
      }
    }

    const { status, targetLayer, title } = entry.fields;
    if (status && !allowedStatuses.has(status)) {
      addDiagnostic(diagnostics, "air.request_ledger.status_invalid", entry.path, `${entry.path}: unsupported status '${status}'`);
    }

    if (targetLayer && !allowedLayers.has(targetLayer)) {
      addDiagnostic(diagnostics, "air.request_ledger.target_layer_invalid", entry.path, `${entry.path}: unsupported targetLayer '${targetLayer}'`);
    }

    if (title) {
      if (seenTitles.has(title)) {
        addDiagnostic(diagnostics, "air.request_ledger.title_duplicate", entry.path, `${entry.path}: duplicate title also used by ${seenTitles.get(title)}`);
      }
      seenTitles.set(title, entry.path);
    }

    if (entry.dirName === "inbox") validateInbox(entry, diagnostics);
    if (status === "implemented" || status === "accepted/planned") validateAccepted(entry, diagnostics);
    if (status && status.startsWith("rejected/")) validateRejected(entry, diagnostics);
    if (status === "archive/historical") validateArchived(entry, diagnostics);

    if (/chrome-extension Host ABI|Chrome Extension Host ABI/i.test(title || "") && status !== "rejected/post-1.0") {
      addDiagnostic(diagnostics, "air.request_ledger.chrome_host_abi_not_rejected", entry.path, `${entry.path}: chrome-extension Host ABI must remain rejected/post-1.0 before 1.0`);
    }
  }
}

function validateInbox(entry, diagnostics) {
  if (!entry.fields.status || !entry.fields.decisionOwner) {
    addDiagnostic(diagnostics, "air.request_ledger.inbox_unresolved", entry.path, `${entry.path}: inbox proposal must include status and decisionOwner`);
  }
}

function validateAccepted(entry, diagnostics) {
  if (!entry.fields.targetLayer) missing(entry, diagnostics, "targetLayer");
  if (!entry.fields.versionTarget && !entry.fields.closedByVersion) missing(entry, diagnostics, "versionTarget or closedByVersion");
  if (!entry.fields.compatibilityRisk) missing(entry, diagnostics, "compatibilityRisk");
  if (entry.fields.status === "accepted/planned" && !entry.fields.owner && !entry.fields.decisionOwner) {
    addDiagnostic(diagnostics, "air.request_ledger.missing_field", entry.path, `${entry.path}: accepted/planned request missing owner or decisionOwner`, { field: "owner or decisionOwner" });
  }
}

function validateRejected(entry, diagnostics) {
  if (!entry.fields.reason) missing(entry, diagnostics, "reason");
  if (!entry.fields.alternative) {
    missing(entry, diagnostics, "alternative");
  } else if (!allowedAlternatives.has(entry.fields.alternative)) {
    addDiagnostic(diagnostics, "air.request_ledger.alternative_invalid", entry.path, `${entry.path}: rejected request has unsupported alternative '${entry.fields.alternative}'`);
  }
  if (!entry.fields.whyNotCore) missing(entry, diagnostics, "whyNotCore");
}

function validateArchived(entry, diagnostics) {
  if (!entry.fields.historicalReason) missing(entry, diagnostics, "historicalReason");
  if (!entry.fields.sourcePath) missing(entry, diagnostics, "sourcePath");
  const active = String(entry.fields.activeRoadmapItem || "").toLowerCase();
  if (active === "yes" || active === "true") {
    addDiagnostic(diagnostics, "air.request_ledger.archive_active_roadmap", entry.path, `${entry.path}: archived request must not be active roadmap item`);
  }
}

function missing(entry, diagnostics, field) {
  addDiagnostic(diagnostics, "air.request_ledger.missing_field", entry.path, `${entry.path}: missing ${field}`, { field });
}

function validateAbiRequestCoverage(entries, diagnostics) {
  if (!fs.existsSync(abiRequestDir)) return [];
  const abiFiles = fs.readdirSync(abiRequestDir)
    .filter((name) => name.endsWith(".md") && name !== "README.md")
    .map((name) => `docs/abi-requests/${name}`)
    .sort();
  const uncovered = [];
  for (const sourcePath of abiFiles) {
    if (!entries.some((entry) => sourceMatches(entry, sourcePath) || explicitArchiveOrException(entry, sourcePath))) {
      uncovered.push(sourcePath);
      addDiagnostic(diagnostics, "air.request_ledger.abi_request_uncovered", sourcePath, `${sourcePath}: no matching requests/* ledger entry`);
    }
  }
  return uncovered.sort();
}

function validateConsumerEvidenceCoverage(entries, diagnostics) {
  if (!fs.existsSync(consumerRegistry)) return;
  const registry = JSON.parse(fs.readFileSync(consumerRegistry, "utf8"));
  const demos = Array.isArray(registry.demos) ? registry.demos : [];
  for (const demo of demos) {
    if (!demo || demo.id === "template_demo") continue;
    const id = String(demo.id || "");
    const manifestPath = `consumer_evidence/demos/${id}/MANIFEST.json`;
    const source = String(demo.source || "");
    const covered = entries.some((entry) =>
      sourceMatches(entry, manifestPath) ||
      (source && sourceMatches(entry, source)) ||
      entry.text.includes(id)
    );
    const noActivePressureReason = String(demo.noActivePressureReason || demo.pendingReason || "");
    if (!covered && !noActivePressureReason) {
      addDiagnostic(diagnostics, "air.request_ledger.consumer_evidence_uncovered", manifestPath, `${manifestPath}: no formal request entry or no active pressure reason`);
    }
  }
}

function validateInboxReadme(entries, diagnostics) {
  if (entries.some((entry) => entry.dirName === "inbox")) return;
  const readme = path.join(requestRoot, "inbox", "README.md");
  if (!fs.existsSync(readme)) {
    addDiagnostic(diagnostics, "air.request_ledger.inbox_readme_missing", rel(readme), `${rel(readme)}: empty inbox requires README explanation`);
    return;
  }
  const text = fs.readFileSync(readme, "utf8");
  if (!/empty|no unresolved|no active inbox/i.test(text)) {
    addDiagnostic(diagnostics, "air.request_ledger.inbox_readme_no_empty_reason", rel(readme), `${rel(readme)}: empty inbox README must say why it is empty`);
  }
}

function explicitArchiveOrException(entry, sourcePath) {
  return entry.fields.status === "archive/historical" && sourceMatches(entry, sourcePath);
}

function sourceMatches(entry, sourcePath) {
  const value = entry.fields.sourcePath || "";
  return value === sourcePath || value.split(/\s*,\s*/).includes(sourcePath) || entry.text.includes(sourcePath);
}

function countEntries(entries) {
  const counts = { accepted: 0, rejected: 0, archived: 0, inbox: 0 };
  for (const entry of entries) {
    const status = entry.fields.status || "";
    if (status === "implemented" || status === "accepted/planned") counts.accepted += 1;
    if (status.startsWith("rejected/")) counts.rejected += 1;
    if (status === "archive/historical") counts.archived += 1;
    if (entry.dirName === "inbox") counts.inbox += 1;
  }
  return counts;
}

function addDiagnostic(diagnostics, code, itemPath, message, extra = {}) {
  diagnostics.push({ code, path: itemPath, message, ...extra });
}

function compareDiagnostic(a, b) {
  return (a.path || "").localeCompare(b.path || "") ||
    (a.code || "").localeCompare(b.code || "") ||
    (a.field || "").localeCompare(b.field || "") ||
    (a.message || "").localeCompare(b.message || "");
}

function comparePathField(a, b) {
  return a.path.localeCompare(b.path) || a.field.localeCompare(b.field);
}

function rel(file) {
  return path.relative(root, file).replace(/\\/g, "/");
}

main();
