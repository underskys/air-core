const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { normalizeDiagnostic, sortDiagnostics } = require("./diagnostics");
const { validatePackageManifest, normalizePackageMetadata } = require("./package_manifest");
const { reportPackageDir } = require("./sdk");
const { AIR_ABI_VERSION } = require("./version");

const PACKAGE_DIFF_SCHEMA_VERSION = "0.30";
const PACKAGE_DIFF_KIND = "air.packageDiff";

function createPackageDiff(oldPackageDir, newPackageDir, options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const oldBase = path.resolve(oldPackageDir || "");
  const newBase = path.resolve(newPackageDir || "");
  const diagnostics = [];
  const limitations = [
    "first slice compares package metadata, package reports, schema fingerprints, and generated artifact metadata; it does not diff sensitive payload classes",
    "package paths are normalized relative to each compared package root"
  ];

  const oldSnapshot = loadPackageSnapshot(oldBase, "old", diagnostics);
  const newSnapshot = loadPackageSnapshot(newBase, "new", diagnostics);

  const airAbiDelta = scalarDelta(oldSnapshot.airAbi, newSnapshot.airAbi);
  const hostAbiDelta = scalarDelta(oldSnapshot.hostAbi, newSnapshot.hostAbi);
  const capabilityDelta = setDelta(oldSnapshot.capabilities, newSnapshot.capabilities);
  const effectDelta = effectDeltaFor(oldSnapshot.effects, newSnapshot.effects);
  const outputContractDelta = keyedDelta(oldSnapshot.outputContracts, newSnapshot.outputContracts, "path");
  const factSchemaDelta = keyedDelta(oldSnapshot.factSchemas, newSnapshot.factSchemas, "path");
  const rowsetSchemaDelta = keyedDelta(oldSnapshot.rowsetSchemas, newSnapshot.rowsetSchemas, "path");
  const structuredIODelta = keyedDelta(oldSnapshot.structuredIO, newSnapshot.structuredIO, "path");
  const commandBufferDelta = keyedDelta(oldSnapshot.commandBuffers, newSnapshot.commandBuffers, "path");
  const poolDelta = keyedDelta(oldSnapshot.pools, newSnapshot.pools, "name");
  const generatedArtifactDelta = keyedDelta(oldSnapshot.generatedArtifacts, newSnapshot.generatedArtifacts, "path");

  const deltas = [
    airAbiDelta,
    hostAbiDelta,
    capabilityDelta,
    effectDelta,
    outputContractDelta,
    factSchemaDelta,
    rowsetSchemaDelta,
    structuredIODelta,
    commandBufferDelta,
    poolDelta,
    generatedArtifactDelta
  ];
  const failed = diagnostics.some((diagnostic) => diagnostic.severity === "fail");
  const changed = deltas.some((delta) => delta.changed);
  const status = failed ? "failed" : (changed ? "changed" : "passed");

  const out = {
    schemaVersion: PACKAGE_DIFF_SCHEMA_VERSION,
    kind: PACKAGE_DIFF_KIND,
    status,
    oldPackageHash: oldSnapshot.packageHash,
    newPackageHash: newSnapshot.packageHash,
    airAbiDelta,
    hostAbiDelta,
    capabilityDelta,
    effectDelta,
    outputContractDelta,
    factSchemaDelta,
    rowsetSchemaDelta,
    structuredIODelta,
    commandBufferDelta,
    generatedArtifactDelta,
    diagnostics: sortDiagnostics(diagnostics.map((diagnostic) => normalizeDiagnostic(sanitizeValue(diagnostic, oldBase, newBase, cwd)))),
    limitations: sortedStrings(limitations)
  };
  if ((oldSnapshot.pools || []).length || (newSnapshot.pools || []).length || poolDelta.changed) out.poolDelta = poolDelta;
  return stableObject(out);
}

function loadPackageSnapshot(base, side, diagnostics) {
  if (!base || !fs.existsSync(base) || !fs.statSync(base).isDirectory()) {
    diagnostics.push(diffDiagnostic("air.package_diff.package_missing", "fail", `${side} package directory does not exist`, side, { packageDir: base }));
    return emptySnapshot(base);
  }

  let metadata = null;
  try {
    metadata = normalizePackageMetadata(validatePackageManifest(base, { built: false }));
  } catch (err) {
    for (const message of errorList(err)) {
      diagnostics.push(diffDiagnostic("air.package_diff.package_invalid", "fail", `${side} package manifest invalid: ${message}`, side, {}));
    }
  }

  let report = null;
  try {
    report = reportPackageDir(base);
  } catch (err) {
    diagnostics.push(diffDiagnostic("air.package_diff.report_failed", "fail", `${side} package report failed: ${errorMessage(err)}`, side, {}));
  }
  report = report || {};

  for (const diagnostic of report.diagnostics || []) {
    const severity = diagnostic.severity || diagnostic.status || "info";
    if (severity === "fail" || severity === "warn") {
      diagnostics.push(normalizeDiagnostic({
        ...diagnostic,
        source: "package-diff",
        message: `${side}: ${diagnostic.message || diagnostic.code}`,
        fields: { side, ...(diagnostic.fields || {}) }
      }));
    }
  }
  for (const error of report.errors || []) {
    diagnostics.push(diffDiagnostic("air.package_diff.package_report_error", "fail", `${side}: ${error}`, side, {}));
  }
  for (const warning of report.warnings || []) {
    diagnostics.push(diffDiagnostic("air.package_diff.package_report_warning", "warn", `${side}: ${warning}`, side, {}));
  }

  const facts = (report.facts && Array.isArray(report.facts.schemas)) ? report.facts.schemas : [];
  const factSchemas = facts.filter((schema) => schema.kind !== "air.boundedRowsetSchema").map(summarizeFactSchema);
  const rowsetSchemas = facts.filter((schema) => schema.kind === "air.boundedRowsetSchema").map(summarizeRowsetSchema);
  const outputContracts = (((report.outputContracts || {}).schemas) || []).map(summarizeOutputContract);
  const structuredIO = (((report.structuredIO || {}).schemas) || []).map(summarizeStructuredIoSchema);
  const commandBuffers = (((report.commandBuffers || {}).schemas) || []).map(summarizeCommandBuffer);
  const pools = (report.pools || []).map(summarizePool);
  const generatedArtifacts = summarizeGeneratedArtifacts(report.generatedArtifacts);
  const effects = summarizeEffects(report.effectUsageOrigins || {});
  const capabilities = sortedStrings([...(report.declaredCapabilities || []), ...(report.computedCapabilities || []), ...((metadata && metadata.capabilities) || [])]);
  const airAbi = (metadata && metadata.airAbi) || null;
  const hostAbi = (metadata && metadata.hostAbi) || null;

  const packageSummary = stableObject({
    package: (metadata && metadata.name) || report.package || null,
    airAbi,
    hostAbi,
    capabilities,
    effects,
    outputContracts,
    factSchemas,
    rowsetSchemas,
    commandBuffers,
    generatedArtifacts
  });
  if (structuredIO.length) packageSummary.structuredIO = structuredIO;
  if (pools.length) packageSummary.pools = pools;

  return {
    base,
    airAbi,
    hostAbi,
    capabilities,
    effects,
    outputContracts,
    factSchemas,
    rowsetSchemas,
    structuredIO,
    commandBuffers,
    pools,
    generatedArtifacts,
    packageHash: hashStable(packageSummary)
  };
}

function emptySnapshot(base) {
  return {
    base,
    airAbi: null,
    hostAbi: null,
    capabilities: [],
    effects: [],
    outputContracts: [],
    factSchemas: [],
    rowsetSchemas: [],
    structuredIO: [],
    commandBuffers: [],
    pools: [],
    generatedArtifacts: [],
    packageHash: hashStable({ missing: true })
  };
}

function scalarDelta(oldValue, newValue) {
  return stableObject({
    old: oldValue || null,
    new: newValue || null,
    changed: (oldValue || null) !== (newValue || null)
  });
}

function setDelta(oldValues, newValues) {
  const oldList = sortedStrings(oldValues);
  const newList = sortedStrings(newValues);
  return stableObject({
    old: oldList,
    new: newList,
    added: newList.filter((item) => !oldList.includes(item)),
    removed: oldList.filter((item) => !newList.includes(item)),
    changed: !sameJson(oldList, newList)
  });
}

function effectDeltaFor(oldEffects, newEffects) {
  const oldByKey = mapBy(oldEffects, "key");
  const newByKey = mapBy(newEffects, "key");
  const keys = sortedStrings([...oldByKey.keys(), ...newByKey.keys()]);
  const added = [];
  const removed = [];
  const changed = [];
  for (const key of keys) {
    const oldItem = oldByKey.get(key) || null;
    const newItem = newByKey.get(key) || null;
    if (!oldItem && newItem) added.push(newItem);
    else if (oldItem && !newItem) removed.push(oldItem);
    else if (oldItem && newItem && oldItem.value !== newItem.value) changed.push({ key, old: oldItem.value, new: newItem.value });
  }
  return stableObject({
    old: oldEffects,
    new: newEffects,
    added,
    removed,
    changedItems: changed,
    changed: added.length > 0 || removed.length > 0 || changed.length > 0
  });
}

function keyedDelta(oldItems, newItems, keyField) {
  const oldList = sortByKey(oldItems, keyField);
  const newList = sortByKey(newItems, keyField);
  const oldByKey = mapBy(oldList, keyField);
  const newByKey = mapBy(newList, keyField);
  const keys = sortedStrings([...oldByKey.keys(), ...newByKey.keys()]);
  const added = [];
  const removed = [];
  const changedItems = [];
  for (const key of keys) {
    const oldItem = oldByKey.get(key) || null;
    const newItem = newByKey.get(key) || null;
    if (!oldItem && newItem) added.push(newItem);
    else if (oldItem && !newItem) removed.push(oldItem);
    else if (oldItem && newItem && !sameJson(oldItem, newItem)) changedItems.push({ key, old: oldItem, new: newItem });
  }
  return stableObject({
    old: oldList,
    new: newList,
    added,
    removed,
    changedItems,
    changed: added.length > 0 || removed.length > 0 || changedItems.length > 0
  });
}

function summarizeOutputContract(schema) {
  return stableObject({
    path: schema.path || null,
    exists: schema.exists !== false,
    ok: Boolean(schema.ok),
    fingerprint: schema.fingerprint || null,
    kind: schema.kind || null,
    outputsCount: schema.outputsCount || 0,
    outputs: (schema.outputs || []).map((output) => ({
      id: output.id,
      name: output.name,
      channel: output.channel || null,
      capability: output.capability || null,
      argCount: output.argCount || 0
    })).sort((a, b) => Number(a.id) - Number(b.id) || String(a.name).localeCompare(String(b.name)))
  });
}

function summarizeFactSchema(schema) {
  return stableObject({
    path: schema.path || null,
    exists: schema.exists !== false,
    ok: Boolean(schema.ok),
    fingerprint: schema.fingerprint || null,
    kind: schema.kind || null,
    factCount: (schema.facts || []).length,
    facts: (schema.facts || []).map((fact) => ({
      name: fact.name || null,
      maxRows: fact.maxRows || null,
      columnCount: fact.columnCount || 0
    })).sort((a, b) => String(a.name).localeCompare(String(b.name)))
  });
}

function summarizeRowsetSchema(schema) {
  const rowset = schema.rowset || {};
  return stableObject({
    path: schema.path || null,
    exists: schema.exists !== false,
    ok: Boolean(schema.ok),
    fingerprint: schema.fingerprint || null,
    kind: schema.kind || null,
    name: rowset.name || null,
    layout: rowset.layout || null,
    maxRows: rowset.maxRows || null,
    columnCount: rowset.columnCount || 0,
    columns: (rowset.columns || []).map((column) => ({
      name: column.name,
      type: column.type,
      storageHint: column.storageHint || null,
      privacy: column.privacy || null
    })).sort((a, b) => String(a.name).localeCompare(String(b.name)))
  });
}

function summarizeCommandBuffer(schema) {
  return stableObject({
    path: schema.path || null,
    exists: schema.exists !== false,
    ok: Boolean(schema.ok),
    fingerprint: schema.fingerprint || null,
    kind: schema.kind || null,
    name: schema.name || null,
    maxCommands: schema.maxCommands || null,
    recordCount: schema.recordCount || 0,
    usedOutputIds: (schema.usedOutputIds || []).slice().sort((a, b) => a - b)
  });
}

function summarizeStructuredIoSchema(schema) {
  return stableObject({
    path: schema.path || null,
    exists: schema.exists !== false,
    ok: Boolean(schema.ok),
    fingerprint: schema.fingerprint || null,
    kind: schema.kind || null,
    name: schema.name || null,
    maxRows: schema.maxRows || null,
    fieldCount: schema.fieldCount || 0,
    fields: (schema.fields || []).map((field) => ({
      name: field.name || null,
      type: field.type || null,
      privacy: field.privacy || null,
      classification: field.classification || null,
      semantic: field.semantic || null
    })).sort((a, b) => String(a.name).localeCompare(String(b.name)))
  });
}

function summarizePool(pool) {
  return stableObject({
    name: pool.name || null,
    module: pool.module || pool.ownerModule || null,
    capacity: pool.capacity || 0,
    activeField: pool.activeField || "active",
    storageFootprint: pool.storageFootprint || pool.staticBytes || 0,
    fields: (pool.fields || []).map((field) => ({
      name: field.name || null,
      type: field.type || null,
      byteSize: field.byteSize || 0
    })).sort((a, b) => String(a.name).localeCompare(String(b.name)))
  });
}

function summarizeGeneratedArtifacts(generatedArtifacts) {
  const files = generatedArtifacts && Array.isArray(generatedArtifacts.files) ? generatedArtifacts.files : [];
  return files.map((file) => stableObject({
    path: file.path || null,
    status: file.status || null,
    fingerprint: file.fingerprint || null,
    manifestFingerprint: file.manifestFingerprint || null,
    sources: (file.sources || []).map((source) => ({
      ref: source.ref || null,
      path: source.path || null,
      exists: source.exists !== false
    })).sort((a, b) => String(a.ref).localeCompare(String(b.ref)) || String(a.path).localeCompare(String(b.path))),
    generators: (file.generators || []).map((generator) => ({
      ref: generator.ref || null,
      path: generator.path || null,
      exists: generator.exists !== false
    })).sort((a, b) => String(a.ref).localeCompare(String(b.ref)) || String(a.path).localeCompare(String(b.path)))
  })).sort((a, b) => String(a.path).localeCompare(String(b.path)));
}

function summarizeEffects(effectUsageOrigins) {
  const totals = new Map();
  for (const usage of Object.values(effectUsageOrigins || {})) {
    if (!usage || typeof usage !== "object") continue;
    for (const [key, value] of Object.entries(usage)) {
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      totals.set(key, (totals.get(key) || 0) + value);
    }
  }
  return Array.from(totals.entries())
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function sortByKey(items, keyField) {
  return (items || []).slice().sort((a, b) => String(a[keyField] || "").localeCompare(String(b[keyField] || "")));
}

function mapBy(items, keyField) {
  const out = new Map();
  for (const item of items || []) {
    const key = item && item[keyField] != null ? String(item[keyField]) : "";
    if (key) out.set(key, item);
  }
  return out;
}

function diffDiagnostic(code, severity, message, side, fields) {
  return normalizeDiagnostic({
    code,
    severity,
    source: "package-diff",
    message,
    fields: { side, ...(fields || {}) }
  });
}

function hashStable(value) {
  return `sha256:${crypto.createHash("sha256").update(stableStringify(value)).digest("hex")}`;
}

function stableStringify(value) {
  return `${JSON.stringify(stableObject(value), null, 2)}\n`;
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = stableObject(value[key]);
  return out;
}

function sanitizeValue(value, oldBase, newBase, cwd) {
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, oldBase, newBase, cwd));
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sanitizeValue(value[key], oldBase, newBase, cwd);
    return out;
  }
  if (typeof value === "string") return sanitizeString(value, oldBase, newBase, cwd);
  return value;
}

function sanitizeString(value, oldBase, newBase, cwd) {
  let out = normalizeSlash(value);
  for (const [label, base] of [["old", oldBase], ["new", newBase], ["cwd", cwd]]) {
    const normalizedBase = normalizeSlash(path.resolve(base || ""));
    if (!normalizedBase) continue;
    if (out === normalizedBase) out = label === "cwd" ? "." : `<${label}-package>`;
    else if (out.startsWith(`${normalizedBase}/`)) out = `${label === "cwd" ? "" : `<${label}-package>/`}${out.slice(normalizedBase.length + 1)}`;
  }
  return out;
}

function normalizeSlash(value) {
  return String(value || "").replace(/\\/g, "/");
}

function sameJson(a, b) {
  return JSON.stringify(stableObject(a)) === JSON.stringify(stableObject(b));
}

function sortedStrings(values) {
  return Array.from(new Set((values || []).filter((value) => typeof value === "string" && value))).sort();
}

function errorList(err) {
  if (err && Array.isArray(err.errors)) return err.errors.map((item) => String(item));
  return [errorMessage(err)];
}

function errorMessage(err) {
  return err && err.message ? err.message : String(err);
}

module.exports = {
  PACKAGE_DIFF_SCHEMA_VERSION,
  PACKAGE_DIFF_KIND,
  createPackageDiff,
  stableStringify
};
