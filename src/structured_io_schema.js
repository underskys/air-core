const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { validatePackageManifest } = require("./package_manifest");
const { parseAir } = require("./parser");
const { verifyModule } = require("./verifier");

const STRUCTURED_IO_SCHEMA_VERSION = "0.32";
const STRUCTURED_IO_RECORD_KIND = "air.structuredRecordSchema";
const STRUCTURED_IO_ROWSET_KIND = "air.structuredRowsetSchema";
const STRUCTURED_IO_OUTPUT_SUMMARY_KIND = "air.structuredOutputSummarySchema";
const STRUCTURED_IO_HANDLES_AIR = "generated/structured_io_handles.air";
const STRUCTURED_IO_META = "generated/structured_io.meta.json";
const STRUCTURED_IO_GENERATOR = "airc structured-io";
const STRUCTURED_IO_GENERATED_KIND = "air.generatedStructuredIO";

const STABLE_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const ALLOWED_FIELD_TYPES = new Set(["i32", "bool"]);
const FORBIDDEN_RUNTIME_JSON_TYPE_RE = /json|payload/i;
const FORBIDDEN_OBJECT_TYPE_RE = /object|map|any|record|array|list|dict/i;
const FORBIDDEN_KEY_RE = /(^|[_-])(raw_text|raw_url|private_text|token|secret|credential|password|payload|json|object|map|any|nested|children|properties|items|data|values|rows)([_-]|$)|token|secret|credential|password/i;
const FORBIDDEN_PRIVACY_RE = /(^|[_-])(raw_text|raw_url|private_text|token|secret|credential|password|url)([_-]|$)|token|secret|credential|password/i;

function validateStructuredIoSchemaFile(file, options = {}) {
  const relativePath = normalizeSlash(options.relativePath || path.basename(file));
  let json = null;
  const diagnostics = [];
  const warnings = [];
  const errors = [];
  try {
    json = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    addDiagnostic(diagnostics, errors, "air.structured_io.schema_invalid", `structured IO schema invalid JSON: ${err.message}`, { path: relativePath });
    return finalizeSchemaReport({ relativePath, json, diagnostics, warnings, errors });
  }
  validateStructuredIoSchema(json, { relativePath, diagnostics, warnings, errors });
  return finalizeSchemaReport({ relativePath, json, diagnostics, warnings, errors });
}

function validateStructuredIoSchema(schema, context = {}) {
  const diagnostics = context.diagnostics || [];
  const errors = context.errors || [];
  const warnings = context.warnings || [];
  const relativePath = context.relativePath || null;
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    addDiagnostic(diagnostics, errors, "air.structured_io.schema_invalid", "structured IO schema must be a JSON object", { path: relativePath });
    return;
  }
  scanForbiddenShape(schema, diagnostics, errors, "$", relativePath);
  const kind = schema.kind;
  if (!isStructuredIoKind(kind)) {
    addDiagnostic(diagnostics, errors, "air.structured_io.schema_invalid", `structured IO schema kind must be ${STRUCTURED_IO_RECORD_KIND}, ${STRUCTURED_IO_ROWSET_KIND}, or ${STRUCTURED_IO_OUTPUT_SUMMARY_KIND}`, { path: relativePath, kind: kind || null });
  }
  if (schema.schemaVersion !== STRUCTURED_IO_SCHEMA_VERSION) {
    addDiagnostic(diagnostics, errors, "air.structured_io.schema_invalid", `structured IO schemaVersion must be ${STRUCTURED_IO_SCHEMA_VERSION}`, { path: relativePath });
  }
  const name = validateName(schema.name, "name", diagnostics, errors, relativePath);
  const fields = Array.isArray(schema.fields) ? schema.fields : null;
  if (!fields || !fields.length) {
    addDiagnostic(diagnostics, errors, "air.structured_io.schema_invalid", "structured IO schema fields must be a non-empty array", { path: relativePath, name });
  } else {
    validateFields(fields, diagnostics, errors, relativePath);
  }
  if (kind === STRUCTURED_IO_ROWSET_KIND) {
    if (!Number.isInteger(schema.maxRows) || schema.maxRows <= 0) {
      addDiagnostic(diagnostics, errors, "air.structured_io.unbounded_rowset", "structured IO rowset maxRows must be a positive integer", { path: relativePath, name, maxRows: schema.maxRows ?? null });
    }
  } else if (schema.maxRows !== undefined) {
    addWarning(diagnostics, warnings, "air.structured_io.schema_invalid", "maxRows is only meaningful for structured rowsets", { path: relativePath, name });
  }
  validatePrivacyPolicy(schema.privacyPolicy, diagnostics, errors, relativePath, name);
}

function validateFields(fields, diagnostics, errors, relativePath) {
  const seen = new Set();
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    const label = `fields[${index}]`;
    if (!field || typeof field !== "object" || Array.isArray(field)) {
      addDiagnostic(diagnostics, errors, "air.structured_io.schema_invalid", `${label} must be an object`, { path: relativePath, index });
      continue;
    }
    const name = validateName(field.name, `${label}.name`, diagnostics, errors, relativePath);
    if (name) {
      if (seen.has(name)) addDiagnostic(diagnostics, errors, "air.structured_io.schema_invalid", `duplicate structured IO field: ${name}`, { path: relativePath, field: name });
      seen.add(name);
    }
    if (!ALLOWED_FIELD_TYPES.has(field.type)) {
      addDiagnostic(diagnostics, errors, fieldTypeCode(field.type), `structured IO field ${name || index} type must be scalar i32 or bool`, { path: relativePath, field: name || null, type: field.type || null });
    }
    if (field.fields !== undefined || field.columns !== undefined || field.properties !== undefined || field.items !== undefined) {
      addDiagnostic(diagnostics, errors, "air.structured_io.object_field_rejected", `structured IO field ${name || index} must not contain nested fields/properties/items`, { path: relativePath, field: name || null });
    }
    if (field.privacy === undefined && field.classification === undefined) {
      addDiagnostic(diagnostics, errors, "air.structured_io.privacy_violation", `structured IO field ${name || index} must declare privacy or classification`, { path: relativePath, field: name || null });
    }
    for (const key of ["privacy", "classification", "semantic"]) {
      if (field[key] !== undefined && !validClassification(field[key])) {
        addDiagnostic(diagnostics, errors, "air.structured_io.privacy_violation", `structured IO field ${name || index} ${key} is not allowed`, { path: relativePath, field: name || null, [key]: String(field[key]) });
      }
    }
  }
}

function validatePrivacyPolicy(policy, diagnostics, errors, relativePath, name) {
  if (policy === undefined) return;
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    addDiagnostic(diagnostics, errors, "air.structured_io.privacy_violation", "privacyPolicy must be an object when present", { path: relativePath, name });
    return;
  }
  for (const [key, value] of Object.entries(policy)) {
    if (/forbid/i.test(key)) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string" && FORBIDDEN_PRIVACY_RE.test(item)) {
          addDiagnostic(diagnostics, errors, "air.structured_io.privacy_violation", `privacyPolicy marker ${item} is not allowed as an allowed classification`, { path: relativePath, name, marker: item });
        }
      }
    } else if (typeof value === "string" && FORBIDDEN_PRIVACY_RE.test(value)) {
      addDiagnostic(diagnostics, errors, "air.structured_io.privacy_violation", `privacyPolicy marker ${value} is not allowed as an allowed classification`, { path: relativePath, name, marker: value });
    }
  }
}

function generateStructuredIoHandles(packageDir) {
  const base = path.resolve(packageDir);
  const packageManifest = validatePackageManifest(base, { built: false });
  const schemas = collectSchemas(base, packageManifest.structuredIO || []);
  const handles = collectHandles(schemas);
  const duplicateHandles = duplicates(handles.map((handle) => handle.handle));
  if (duplicateHandles.length) throw new Error(`generated structured IO handle name collision: ${duplicateHandles.join(", ")}`);
  const sourceSchemas = schemas.map((schema) => ({ path: schema.path, fingerprint: schema.fingerprint }));
  const airSource = renderStructuredIoHandlesAir({ sourceSchemas, schemas, handles });
  const metadata = {
    schemaVersion: STRUCTURED_IO_SCHEMA_VERSION,
    kind: STRUCTURED_IO_GENERATED_KIND,
    generator: STRUCTURED_IO_GENERATOR,
    sourceSchemas,
    generatedFiles: [{ path: STRUCTURED_IO_HANDLES_AIR, fingerprint: sourceFingerprint(airSource) }],
    schemas: schemas.map((schema) => schema.summary),
    handles
  };
  return {
    airPath: STRUCTURED_IO_HANDLES_AIR,
    metaPath: STRUCTURED_IO_META,
    airSource,
    metadata,
    metadataSource: `${stableStringify(metadata)}\n`,
    sourceSchemas,
    schemas,
    handles
  };
}

function writeGeneratedStructuredIoHandles(packageDir) {
  const base = path.resolve(packageDir);
  const generated = generateStructuredIoHandles(base);
  const airFile = path.join(base, generated.airPath);
  const metaFile = path.join(base, generated.metaPath);
  fs.mkdirSync(path.dirname(airFile), { recursive: true });
  fs.writeFileSync(airFile, generated.airSource);
  fs.writeFileSync(metaFile, generated.metadataSource);
  return [generated.airPath, generated.metaPath];
}

function checkGeneratedStructuredIoHandles(packageDir, options = {}) {
  const base = path.resolve(packageDir);
  const referenced = isStructuredIoHandlesReferenced(options.generatedModules);
  if (!referenced && !options.force) {
    return { ok: true, referenced: false, sets: [], diagnostics: [], warnings: [], errors: [] };
  }
  let expected;
  try {
    expected = generateStructuredIoHandles(base);
  } catch (err) {
    const item = diagnostic("air.structured_io.generated_stale", "fail", err.message || String(err), { path: STRUCTURED_IO_META });
    return { ok: false, referenced: Boolean(referenced), sets: [emptySet("mismatch", [item])], diagnostics: [item], warnings: [], errors: [item.message] };
  }
  const diagnostics = [];
  const errors = [];
  const airFile = path.join(base, STRUCTURED_IO_HANDLES_AIR);
  const metaFile = path.join(base, STRUCTURED_IO_META);
  let actualAir = null;
  let actualMeta = null;
  let status = "fresh";
  if (!fs.existsSync(airFile)) {
    status = "missing";
    addDiagnostic(diagnostics, errors, "air.structured_io.generated_stale", `generated structured IO handle file missing: ${STRUCTURED_IO_HANDLES_AIR}`, { path: STRUCTURED_IO_HANDLES_AIR });
  } else {
    actualAir = fs.readFileSync(airFile, "utf8");
    if (actualAir !== expected.airSource) {
      status = worseStatus(status, "stale");
      addDiagnostic(diagnostics, errors, "air.structured_io.generated_stale", `generated structured IO handle file stale: ${STRUCTURED_IO_HANDLES_AIR}`, {
        path: STRUCTURED_IO_HANDLES_AIR,
        expectedFingerprint: sourceFingerprint(expected.airSource),
        actualFingerprint: sourceFingerprint(actualAir)
      });
    }
  }
  if (!fs.existsSync(metaFile)) {
    status = worseStatus(status, "missing");
    addDiagnostic(diagnostics, errors, "air.structured_io.generated_stale", `generated structured IO metadata missing: ${STRUCTURED_IO_META}`, { path: STRUCTURED_IO_META });
  } else {
    try {
      actualMeta = JSON.parse(fs.readFileSync(metaFile, "utf8"));
      for (const item of validateStructuredIoMetadata(actualMeta, expected, actualAir)) {
        status = worseStatus(status, item.status);
        addDiagnostic(diagnostics, errors, item.code, item.message, item.fields);
      }
    } catch (err) {
      status = worseStatus(status, "mismatch");
      addDiagnostic(diagnostics, errors, "air.structured_io.generated_stale", `generated structured IO metadata invalid: ${STRUCTURED_IO_META}: ${err.message || err}`, { path: STRUCTURED_IO_META });
    }
  }
  const set = {
    path: STRUCTURED_IO_HANDLES_AIR,
    metadataPath: STRUCTURED_IO_META,
    status,
    sourceFingerprint: sourceSetFingerprint(expected.sourceSchemas),
    generatedFingerprint: actualAir ? sourceFingerprint(actualAir) : null,
    expectedGeneratedFingerprint: sourceFingerprint(expected.airSource),
    sourceSchemas: expected.sourceSchemas,
    schemas: actualMeta && Array.isArray(actualMeta.schemas) ? normalizeMetaSchemas(actualMeta.schemas) : expected.metadata.schemas,
    handles: actualMeta && Array.isArray(actualMeta.handles) ? normalizeMetaHandles(actualMeta.handles) : expected.handles,
    diagnostics
  };
  return { ok: errors.length === 0, referenced: Boolean(referenced), sets: [set], diagnostics, warnings: [], errors };
}

function verifyGeneratedStructuredIoHandles(packageDir) {
  const generated = generateStructuredIoHandles(packageDir);
  const mod = parseAir(generated.airSource, path.join(path.resolve(packageDir), generated.airPath));
  verifyModule(mod, { library: true });
  return true;
}

function collectSchemas(base, refs) {
  return (refs || [])
    .map((ref) => ref && ref.path ? ref.path : null)
    .filter(Boolean)
    .sort()
    .map((rel) => {
      const report = validateStructuredIoSchemaFile(path.join(base, rel), { relativePath: rel });
      if (!report.ok) throw new Error(`structured IO schema invalid; cannot generate handles: ${rel}`);
      return {
        path: normalizeSlash(rel),
        fingerprint: report.fingerprint,
        summary: schemaSummary(report)
      };
    });
}

function collectHandles(schemas) {
  const handles = [];
  for (const schema of schemas) {
    const item = schema.summary;
    const prefix = `STRUCT_${safeConst(item.name)}`;
    handles.push({ handle: `${prefix}_KIND`, value: kindId(item.kind), schema: item.name, field: null, kind: "schema_kind" });
    handles.push({ handle: `${prefix}_FIELD_COUNT`, value: item.fields.length, schema: item.name, field: null, kind: "field_count" });
    if (Number.isInteger(item.maxRows)) handles.push({ handle: `${prefix}_MAX_ROWS`, value: item.maxRows, schema: item.name, field: null, kind: "max_rows" });
    item.fields.forEach((field, index) => {
      handles.push({ handle: `${prefix}_FIELD_${safeConst(field.name)}_OFFSET`, value: index, schema: item.name, field: field.name, kind: "field_offset" });
      handles.push({ handle: `${prefix}_FIELD_${safeConst(field.name)}_TYPE`, value: field.type === "bool" ? 2 : 1, schema: item.name, field: field.name, kind: "field_type" });
    });
  }
  return handles.sort((a, b) => a.handle.localeCompare(b.handle));
}

function renderStructuredIoHandlesAir({ sourceSchemas, handles }) {
  const lines = [
    "# Generated file. Do not edit manually.",
    "# Generator: repo:bin/airc.js",
    ...sourceSchemas.map((source) => `# Source: ${source.path}`),
    `# Structured IO schema fingerprint: ${sourceSetFingerprint(sourceSchemas)}`,
    "module structured_io_handles",
    "capabilities { }",
    ""
  ];
  for (const handle of handles) lines.push(`const ${handle.handle}:i32 = ${handle.value}`);
  lines.push("");
  return lines.join("\n");
}

function finalizeSchemaReport({ relativePath, json, diagnostics, warnings, errors }) {
  const kind = json && typeof json === "object" && !Array.isArray(json) ? json.kind : null;
  const fields = json && Array.isArray(json.fields) ? json.fields.map(normalizeField).filter(Boolean) : [];
  const report = {
    ok: errors.length === 0,
    path: relativePath,
    exists: true,
    fingerprint: json ? sourceFingerprint(stableStringify(json)) : null,
    schemaVersion: json && json.schemaVersion || null,
    kind,
    name: json && json.name || null,
    maxRows: Number.isInteger(json && json.maxRows) ? json.maxRows : null,
    fields,
    privacyPolicy: normalizePrivacyPolicy(json && json.privacyPolicy),
    diagnostics,
    warnings,
    errors
  };
  return stableObject(report);
}

function schemaSummary(report) {
  return stableObject({
    path: report.path,
    exists: report.exists !== false,
    ok: Boolean(report.ok),
    fingerprint: report.fingerprint || null,
    schemaVersion: report.schemaVersion || null,
    kind: report.kind || null,
    name: report.name || null,
    maxRows: report.maxRows || null,
    fieldCount: (report.fields || []).length,
    fields: (report.fields || []).map((field) => stableObject({
      name: field.name,
      type: field.type,
      privacy: field.privacy || null,
      classification: field.classification || null,
      semantic: field.semantic || null
    })),
    privacyPolicy: report.privacyPolicy || null,
    diagnostics: (report.diagnostics || []).map((item) => stableObject({ code: item.code, severity: item.severity, message: item.message, fields: item.fields || {} })).sort((a, b) => String(a.code).localeCompare(String(b.code)) || String(a.message).localeCompare(String(b.message))),
    warnings: sortedStrings(report.warnings || []),
    errors: sortedStrings(report.errors || [])
  });
}

function validateStructuredIoMetadata(actual, expected, actualAir) {
  const diagnostics = [];
  if (!actual || typeof actual !== "object" || Array.isArray(actual)) return [metadataInvalid("metadata must be a JSON object")];
  if (actual.schemaVersion !== STRUCTURED_IO_SCHEMA_VERSION) diagnostics.push(metadataInvalid(`metadata schemaVersion must be ${STRUCTURED_IO_SCHEMA_VERSION}`));
  if (actual.kind !== STRUCTURED_IO_GENERATED_KIND) diagnostics.push(metadataInvalid(`metadata kind must be ${STRUCTURED_IO_GENERATED_KIND}`));
  if (actual.generator !== STRUCTURED_IO_GENERATOR) diagnostics.push(metadataInvalid(`metadata generator must be ${STRUCTURED_IO_GENERATOR}`));
  if (!deepEqual(normalizeSources(actual.sourceSchemas), expected.sourceSchemas)) diagnostics.push(staleDiag("generated structured IO source fingerprints stale", { path: STRUCTURED_IO_META }));
  if (!deepEqual(normalizeMetaSchemas(actual.schemas), expected.metadata.schemas)) diagnostics.push(staleDiag("generated structured IO metadata schemas mismatch", { path: STRUCTURED_IO_META }));
  if (!deepEqual(normalizeMetaHandles(actual.handles), expected.handles)) diagnostics.push(staleDiag("generated structured IO metadata handles mismatch", { path: STRUCTURED_IO_META }));
  const actualGeneratedFiles = normalizeGeneratedFiles(actual.generatedFiles);
  if (!deepEqual(actualGeneratedFiles, expected.metadata.generatedFiles)) diagnostics.push(staleDiag("generated structured IO metadata generatedFiles mismatch", { path: STRUCTURED_IO_META }));
  if (actualAir) {
    const fingerprint = sourceFingerprint(actualAir);
    const declared = actualGeneratedFiles.find((file) => file.path === STRUCTURED_IO_HANDLES_AIR);
    if (!declared || declared.fingerprint !== fingerprint) diagnostics.push(staleDiag("generated structured IO metadata does not match generated file", { path: STRUCTURED_IO_META, generatedPath: STRUCTURED_IO_HANDLES_AIR }));
  }
  return diagnostics;
}

function isStructuredIoHandlesReferenced(generatedModules = []) {
  return (generatedModules || []).some((item) => normalizeSlash(typeof item === "string" ? item : item && item.path) === STRUCTURED_IO_HANDLES_AIR);
}

function isStructuredIoKind(kind) {
  return kind === STRUCTURED_IO_RECORD_KIND || kind === STRUCTURED_IO_ROWSET_KIND || kind === STRUCTURED_IO_OUTPUT_SUMMARY_KIND;
}

function validateName(value, label, diagnostics, errors, pathValue) {
  if (typeof value !== "string" || !STABLE_NAME_RE.test(value)) {
    addDiagnostic(diagnostics, errors, "air.structured_io.schema_invalid", `${label} must be a stable identifier`, { path: pathValue, value: value || null });
    return null;
  }
  return value;
}

function fieldTypeCode(type) {
  if (typeof type === "string" && FORBIDDEN_RUNTIME_JSON_TYPE_RE.test(type)) return "air.structured_io.runtime_json_rejected";
  if (typeof type === "string" && FORBIDDEN_OBJECT_TYPE_RE.test(type)) return "air.structured_io.object_field_rejected";
  return "air.structured_io.field_type_invalid";
}

function scanForbiddenShape(value, diagnostics, errors, label, pathValue) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanForbiddenShape(item, diagnostics, errors, `${label}[${index}]`, pathValue));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEY_RE.test(key) && !["fields", "privacyPolicy"].includes(key)) {
      addDiagnostic(diagnostics, errors, key.toLowerCase().includes("json") ? "air.structured_io.runtime_json_rejected" : "air.structured_io.object_field_rejected", `structured IO schema must not contain runtime object/json/payload key ${label}.${key}`, { path: pathValue, key });
    }
    scanForbiddenShape(value[key], diagnostics, errors, `${label}.${key}`, pathValue);
  }
}

function validClassification(value) {
  return typeof value === "string" && value.length > 0 && !FORBIDDEN_PRIVACY_RE.test(value) && !looksAbsolutePath(value);
}

function normalizeField(field) {
  if (!field || typeof field !== "object" || Array.isArray(field)) return null;
  return {
    name: field.name || null,
    type: field.type || null,
    privacy: field.privacy || null,
    classification: field.classification || null,
    semantic: field.semantic || null
  };
}

function normalizePrivacyPolicy(policy) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) return null;
  return stableObject(policy);
}

function normalizeMetaSchemas(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => stableObject({
    path: normalizeSlash(item && item.path),
    exists: item && item.exists !== false,
    ok: Boolean(item && item.ok),
    fingerprint: item && item.fingerprint || null,
    schemaVersion: item && item.schemaVersion || null,
    kind: item && item.kind || null,
    name: item && item.name || null,
    maxRows: Number.isInteger(item && item.maxRows) ? item.maxRows : null,
    fieldCount: Number.isInteger(item && item.fieldCount) ? item.fieldCount : 0,
    fields: Array.isArray(item && item.fields) ? item.fields.map(normalizeField).filter(Boolean) : [],
    privacyPolicy: normalizePrivacyPolicy(item && item.privacyPolicy),
    diagnostics: Array.isArray(item && item.diagnostics) ? item.diagnostics : [],
    warnings: sortedStrings(item && item.warnings || []),
    errors: sortedStrings(item && item.errors || [])
  })).sort((a, b) => String(a.path).localeCompare(String(b.path)));
}

function normalizeMetaHandles(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => stableObject({
    handle: String(item && item.handle || ""),
    value: Number(item && item.value),
    schema: String(item && item.schema || ""),
    field: item && item.field === null ? null : (item && item.field ? String(item.field) : null),
    kind: String(item && item.kind || "")
  })).sort((a, b) => a.handle.localeCompare(b.handle));
}

function normalizeSources(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => ({ path: normalizeSlash(item && item.path), fingerprint: String(item && item.fingerprint || "") })).sort((a, b) => a.path.localeCompare(b.path));
}

function normalizeGeneratedFiles(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => ({ path: normalizeSlash(item && item.path), fingerprint: String(item && item.fingerprint || "") })).sort((a, b) => a.path.localeCompare(b.path));
}

function addDiagnostic(diagnostics, errors, code, message, fields = {}) {
  diagnostics.push(diagnostic(code, "fail", message, fields));
  errors.push(message);
}

function addWarning(diagnostics, warnings, code, message, fields = {}) {
  diagnostics.push(diagnostic(code, "warn", message, fields));
  warnings.push(message);
}

function diagnostic(code, severity, message, fields = {}) {
  return { code, severity, source: "package-check", message, fields: stableObject(fields) };
}

function metadataInvalid(message) {
  return staleDiag(`generated structured IO metadata invalid: ${STRUCTURED_IO_META}: ${message}`, { path: STRUCTURED_IO_META });
}

function staleDiag(message, fields) {
  return { status: "mismatch", code: "air.structured_io.generated_stale", message, fields: fields || {} };
}

function emptySet(status, diagnostics) {
  return {
    path: STRUCTURED_IO_HANDLES_AIR,
    metadataPath: STRUCTURED_IO_META,
    status,
    sourceFingerprint: null,
    generatedFingerprint: null,
    expectedGeneratedFingerprint: null,
    sourceSchemas: [],
    schemas: [],
    handles: [],
    diagnostics
  };
}

function worseStatus(current, next) {
  const order = { fresh: 0, stale: 1, mismatch: 2, missing: 3 };
  return (order[next] || 0) > (order[current] || 0) ? next : current;
}

function safeConst(name) {
  const out = String(name || "unnamed").replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase() || "UNNAMED";
  return /^[0-9]/.test(out) ? `ID_${out}` : out;
}

function kindId(kind) {
  if (kind === STRUCTURED_IO_RECORD_KIND) return 1;
  if (kind === STRUCTURED_IO_ROWSET_KIND) return 2;
  if (kind === STRUCTURED_IO_OUTPUT_SUMMARY_KIND) return 3;
  return 0;
}

function duplicates(values) {
  const seen = new Set();
  const dupes = new Set();
  for (const value of values) {
    if (seen.has(value)) dupes.add(value);
    seen.add(value);
  }
  return Array.from(dupes).sort();
}

function sourceSetFingerprint(sources) {
  return sourceFingerprint(stableStringify(sources || []));
}

function sourceFingerprint(source) {
  return `sha256:${crypto.createHash("sha256").update(String(source)).digest("hex")}`;
}

function stableStringify(value) {
  return JSON.stringify(stableObject(value), null, 2);
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = stableObject(value[key]);
  return out;
}

function deepEqual(a, b) {
  return stableStringify(a) === stableStringify(b);
}

function sortedStrings(values) {
  return Array.from(new Set((values || []).filter((value) => typeof value === "string" && value))).sort();
}

function normalizeSlash(value) {
  return String(value || "").replace(/\\/g, "/");
}

function looksAbsolutePath(value) {
  return /^\/|^[A-Za-z]:[\\/]/.test(String(value || ""));
}

module.exports = {
  STRUCTURED_IO_HANDLES_AIR,
  STRUCTURED_IO_META,
  STRUCTURED_IO_OUTPUT_SUMMARY_KIND,
  STRUCTURED_IO_RECORD_KIND,
  STRUCTURED_IO_ROWSET_KIND,
  checkGeneratedStructuredIoHandles,
  generateStructuredIoHandles,
  validateStructuredIoSchemaFile,
  verifyGeneratedStructuredIoHandles,
  writeGeneratedStructuredIoHandles
};
