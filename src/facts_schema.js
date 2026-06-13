const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const FACTS_SCHEMA_VERSION = "0.18";
const ROWSET_SCHEMA_VERSION = "0.20";
const ROWSET_KIND = "air.boundedRowsetSchema";
const SCALAR_TYPES = new Set(["i32", "bool"]);
const PRIVACY_CLASSIFICATIONS = new Set(["public", "minimized", "sensitive", "forbidden"]);
const FORBIDDEN_PRIVACY_MARKERS = new Set(["raw_text", "raw_url", "token", "secret"]);
const STORAGE_HINTS = new Set(["u8", "u16", "i16", "i32", "bool"]);
const STORAGE_HINT_BYTES = Object.freeze({ bool: 1, u8: 1, u16: 2, i16: 2, i32: 4 });
const STABLE_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

class FactsSchemaError extends Error {
  constructor(errors, report = null) {
    super(errors.join("\n"));
    this.name = "FactsSchemaError";
    this.errors = errors;
    this.report = report;
  }
}

function validateFactsSchemaFile(file, options = {}) {
  const absolute = path.resolve(file);
  const relativePath = normalizeRelativePath(options.relativePath || path.basename(file));
  const diagnostics = [];
  let bytes = null;
  let schema = null;
  try {
    bytes = fs.readFileSync(absolute, "utf8");
  } catch (err) {
    addDiagnostic(diagnostics, "air.facts.schema_missing", `facts schema file not found: ${relativePath}`, { path: relativePath });
  }
  if (bytes !== null) {
    try {
      schema = JSON.parse(bytes);
    } catch (err) {
      addDiagnostic(diagnostics, "air.facts.schema_invalid", `invalid JSON in facts schema ${relativePath}: ${err.message}`, { path: relativePath });
    }
  }
  const report = validateFactsSchema(schema, { ...options, relativePath });
  const combinedDiagnostics = diagnostics.concat(report.diagnostics || []).sort(compareDiagnostics);
  const combined = {
    ...report,
    path: relativePath,
    exists: bytes !== null,
    fingerprint: bytes === null ? null : `sha256:${sha256(bytes)}`,
    diagnostics: combinedDiagnostics,
    errors: combinedDiagnostics.filter((item) => item.severity === "fail").map((item) => item.message).sort(),
    warnings: combinedDiagnostics.filter((item) => item.severity === "warn").map((item) => item.message).sort()
  };
  combined.ok = combined.exists && combined.errors.length === 0;
  return combined;
}

function validateFactsSchema(schema, options = {}) {
  const diagnostics = [];
  const relativePath = normalizeRelativePath(options.relativePath || null);
  const report = {
    schemaVersion: null,
    kind: null,
    path: relativePath,
    privacyPolicy: null,
    facts: [],
    rowset: null,
    diagnostics,
    errors: [],
    warnings: [],
    ok: false
  };

  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    addDiagnostic(diagnostics, "air.facts.schema_invalid", "facts schema must be a JSON object", { path: relativePath });
    finalize(report);
    return report;
  }

  scanForForbiddenRuntimeShape(schema, "$", diagnostics, { path: relativePath, codePrefix: schema.kind === ROWSET_KIND ? "air.rowset" : "air.facts" });

  if (typeof schema.schemaVersion !== "string" || schema.schemaVersion.trim() === "") {
    addDiagnostic(diagnostics, "air.facts.schema_invalid", "schemaVersion is required", { path: relativePath, field: "schemaVersion" });
  } else {
    report.schemaVersion = schema.schemaVersion;
  }

  if (schema.kind === ROWSET_KIND) {
    report.kind = ROWSET_KIND;
    if (schema.schemaVersion !== ROWSET_SCHEMA_VERSION) {
      addDiagnostic(diagnostics, "air.rowset.schema_invalid", `bounded rowset schemaVersion must be ${ROWSET_SCHEMA_VERSION}`, { path: relativePath, field: "schemaVersion", value: schema.schemaVersion });
    }
    report.privacyPolicy = validatePrivacyPolicy(schema.privacyPolicy, diagnostics, { path: relativePath, codePrefix: "air.rowset" });
    report.rowset = validateRowset(schema, diagnostics, { path: relativePath });
    finalize(report);
    return report;
  }

  if (schema.kind !== undefined) {
    addDiagnostic(diagnostics, "air.facts.schema_invalid", `kind must be ${ROWSET_KIND} or omitted for legacy facts schema`, { path: relativePath, field: "kind" });
  }

  report.kind = "air.factsSchema";
  report.privacyPolicy = validatePrivacyPolicy(schema.privacyPolicy, diagnostics, { path: relativePath, codePrefix: "air.facts" });

  if (!Array.isArray(schema.facts)) {
    addDiagnostic(diagnostics, "air.facts.schema_invalid", "facts must be an array", { path: relativePath, field: "facts" });
  } else {
    const seenFactNames = new Set();
    const seenFactIds = new Set();
    for (let i = 0; i < schema.facts.length; i++) {
      const fact = validateFact(schema.facts[i], i, diagnostics, { path: relativePath });
      if (!fact) continue;
      if (seenFactNames.has(fact.name)) addDiagnostic(diagnostics, "air.facts.duplicate_fact", `duplicate fact name: ${fact.name}`, { path: relativePath, fact: fact.name });
      seenFactNames.add(fact.name);
      if (fact.id !== null) {
        if (seenFactIds.has(fact.id)) addDiagnostic(diagnostics, "air.facts.duplicate_fact", `duplicate fact id: ${fact.id}`, { path: relativePath, factId: fact.id });
        seenFactIds.add(fact.id);
      }
      report.facts.push(fact);
    }
  }

  report.facts.sort((a, b) => a.name.localeCompare(b.name) || Number(a.id || 0) - Number(b.id || 0));
  finalize(report);
  return report;
}

function validateRowset(schema, diagnostics, context = {}) {
  const name = validateStableName(schema.name, "name", diagnostics, context, "air.rowset.schema_invalid");
  scanForForbiddenRowsetPayloadKeys(schema, "$", diagnostics, { ...context, rowset: name });
  if (schema.layout !== "columnar") {
    addDiagnostic(diagnostics, "air.rowset.schema_invalid", "layout must be columnar", { ...context, field: "layout", value: schema.layout });
  }
  const maxRows = validatePositiveInteger(schema.maxRows, "maxRows", diagnostics, context, {
    missingCode: "air.rowset.schema_invalid",
    invalidCode: "air.rowset.unbounded_rows"
  });
  if (schema.maxRows === undefined) addDiagnostic(diagnostics, "air.rowset.schema_invalid", "maxRows is required", { ...context, rowset: name, field: "maxRows" });
  if (schema.dynamic === true || schema.unbounded === true) addDiagnostic(diagnostics, "air.rowset.unbounded_rows", "rowset must not be dynamic or unbounded", { ...context, rowset: name });

  if (!Array.isArray(schema.columns)) {
    addDiagnostic(diagnostics, "air.rowset.schema_invalid", "columns must be an array", { ...context, rowset: name, field: "columns" });
  } else if (schema.columns.length === 0) {
    addDiagnostic(diagnostics, "air.rowset.schema_invalid", "columns must not be empty", { ...context, rowset: name, field: "columns" });
  }

  const columns = [];
  const seenColumns = new Set();
  if (Array.isArray(schema.columns)) {
    for (let i = 0; i < schema.columns.length; i++) {
      const column = validateRowsetColumn(schema.columns[i], `columns[${i}]`, diagnostics, { ...context, rowset: name, maxRows });
      if (!column) continue;
      if (seenColumns.has(column.name)) addDiagnostic(diagnostics, "air.rowset.duplicate_column", `duplicate column ${column.name}`, { ...context, rowset: name, column: column.name });
      seenColumns.add(column.name);
      columns.push(column);
    }
  }

  const compact = compactStorageSummary(columns, maxRows);
  return {
    name,
    kind: ROWSET_KIND,
    layout: schema.layout === "columnar" ? "columnar" : null,
    maxRows,
    columnCount: columns.length,
    columns: columns.sort((a, b) => a.name.localeCompare(b.name)),
    storage: compact
  };
}

function validateRowsetColumn(value, label, diagnostics, context = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    addDiagnostic(diagnostics, "air.rowset.schema_invalid", `${label} must be an object`, { ...context, field: label });
    return null;
  }
  const name = validateStableName(value.name, `${label}.name`, diagnostics, context, "air.rowset.schema_invalid");
  if (value.dynamic === true || value.unbounded === true) addDiagnostic(diagnostics, "air.rowset.unbounded_rows", `${label} must not be dynamic or unbounded`, { ...context, column: name });
  for (const forbidden of ["fields", "properties", "items", "shape", "schema", "json", "map", "object"]) {
    if (value[forbidden] !== undefined) addDiagnostic(diagnostics, "air.rowset.non_scalar_column", `${label}.${forbidden} is not allowed; rowset columns must be scalar`, { ...context, column: name, field: `${label}.${forbidden}` });
  }
  const type = typeof value.type === "string" ? value.type : null;
  if (!type) {
    addDiagnostic(diagnostics, "air.rowset.schema_invalid", `${label}.type is required`, { ...context, column: name, field: `${label}.type` });
  } else if (!SCALAR_TYPES.has(type)) {
    addDiagnostic(diagnostics, "air.rowset.non_scalar_column", `${label}.type ${JSON.stringify(type)} is not a supported bounded rowset scalar type`, { ...context, column: name, type });
  }
  const storageHint = validateStorageHint(value.storageHint, `${label}.storageHint`, diagnostics, { ...context, column: name });
  const range = validateRange(value.range, `${label}.range`, diagnostics, { ...context, column: name });
  const privacy = validateOptionalPrivacy(value.privacy, `${label}.privacy`, diagnostics, { ...context, column: name, codePrefix: "air.rowset" });
  return name && type ? {
    name,
    type,
    enum: typeof value.enum === "string" ? value.enum : null,
    storageHint,
    privacy,
    range
  } : null;
}

function validateStorageHint(value, label, diagnostics, context = {}) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !STORAGE_HINTS.has(value)) {
    addDiagnostic(diagnostics, "air.rowset.storage_hint_invalid", `${label} must be one of: ${Array.from(STORAGE_HINTS).sort().join(", ")}`, { ...context, field: label, value });
    return null;
  }
  return value;
}

function validateRange(value, label, diagnostics, context = {}) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length !== 2 || !Number.isInteger(value[0]) || !Number.isInteger(value[1]) || value[0] > value[1]) {
    addDiagnostic(diagnostics, "air.rowset.schema_invalid", `${label} must be [min, max] integer bounds`, { ...context, field: label });
    return null;
  }
  return [value[0], value[1]];
}

function validateFact(value, index, diagnostics, context = {}) {
  const label = `facts[${index}]`;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    addDiagnostic(diagnostics, "air.facts.schema_invalid", `${label} must be an object`, { ...context, field: label });
    return null;
  }

  const id = validateOptionalInteger(value.id, `${label}.id`, diagnostics, context);
  const name = validateStableName(value.name, `${label}.name`, diagnostics, context);
  const maxRows = validatePositiveInteger(value.maxRows, `${label}.maxRows`, diagnostics, context);
  if (value.maxRows === undefined) addDiagnostic(diagnostics, "air.facts.schema_invalid", `${label}.maxRows is required`, { ...context, fact: name, field: `${label}.maxRows` });
  if (value.dynamic === true || value.unbounded === true) addDiagnostic(diagnostics, "air.facts.dynamic_or_unbounded", `${label} must not be dynamic or unbounded`, { ...context, fact: name });

  const columnsValue = Array.isArray(value.columns) ? value.columns : value.fields;
  if (!Array.isArray(columnsValue)) {
    addDiagnostic(diagnostics, "air.facts.schema_invalid", `${label}.columns must be an array`, { ...context, fact: name, field: `${label}.columns` });
  }

  const columns = [];
  const seenColumns = new Set();
  if (Array.isArray(columnsValue)) {
    for (let i = 0; i < columnsValue.length; i++) {
      const column = validateColumn(columnsValue[i], `${label}.columns[${i}]`, diagnostics, { ...context, fact: name });
      if (!column) continue;
      if (seenColumns.has(column.name)) addDiagnostic(diagnostics, "air.facts.duplicate_column", `duplicate column ${column.name} in ${label}`, { ...context, fact: name, column: column.name });
      seenColumns.add(column.name);
      columns.push(column);
    }
  }

  return {
    id,
    name,
    maxRows,
    columns: columns.sort((a, b) => a.name.localeCompare(b.name)),
    columnCount: columns.length,
    capability: typeof value.capability === "string" ? value.capability : null,
    privacy: validateOptionalPrivacy(value.privacy, `${label}.privacy`, diagnostics, { ...context, fact: name })
  };
}

function validateColumn(value, label, diagnostics, context = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    addDiagnostic(diagnostics, "air.facts.schema_invalid", `${label} must be an object`, { ...context, field: label });
    return null;
  }
  const name = validateStableName(value.name, `${label}.name`, diagnostics, context);
  if (value.dynamic === true || value.unbounded === true) addDiagnostic(diagnostics, "air.facts.dynamic_or_unbounded", `${label} must not be dynamic or unbounded`, { ...context, column: name });
  for (const forbidden of ["fields", "properties", "items", "shape", "schema"]) {
    if (value[forbidden] !== undefined) addDiagnostic(diagnostics, "air.facts.non_scalar_column", `${label}.${forbidden} is not allowed; fact columns must be scalar`, { ...context, column: name, field: `${label}.${forbidden}` });
  }
  const type = typeof value.type === "string" ? value.type : null;
  if (!type) {
    addDiagnostic(diagnostics, "air.facts.schema_invalid", `${label}.type is required`, { ...context, column: name, field: `${label}.type` });
  } else if (!SCALAR_TYPES.has(type)) {
    addDiagnostic(diagnostics, "air.facts.non_scalar_column", `${label}.type ${JSON.stringify(type)} is not a supported bounded scalar type`, { ...context, column: name, type });
  }
  return name && type ? {
    name,
    type,
    semantic: typeof value.semantic === "string" ? value.semantic : null,
    enum: typeof value.enum === "string" ? value.enum : null,
    privacy: validateOptionalPrivacy(value.privacy, `${label}.privacy`, diagnostics, { ...context, column: name })
  } : null;
}

function validatePrivacyPolicy(value, diagnostics, context = {}) {
  if (value === undefined) return null;
  const label = "privacyPolicy";
  const code = privacyCode(context);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    addDiagnostic(diagnostics, code, `${label} must be an object when present`, { ...context, field: label });
    return null;
  }
  const out = {
    defaultClassification: null,
    forbiddenByDefault: []
  };
  if (value.defaultClassification !== undefined) {
    out.defaultClassification = validatePrivacyClassification(value.defaultClassification, `${label}.defaultClassification`, diagnostics, context);
  }
  if (value.forbiddenByDefault !== undefined) {
    if (!Array.isArray(value.forbiddenByDefault)) {
      addDiagnostic(diagnostics, code, `${label}.forbiddenByDefault must be an array when present`, { ...context, field: `${label}.forbiddenByDefault` });
    } else {
      const seen = new Set();
      for (let i = 0; i < value.forbiddenByDefault.length; i++) {
        const item = validateStableString(value.forbiddenByDefault[i], `${label}.forbiddenByDefault[${i}]`, diagnostics, context);
        if (!item) continue;
        if (seen.has(item)) addDiagnostic(diagnostics, code, `duplicate ${label}.forbiddenByDefault item: ${item}`, { ...context, field: `${label}.forbiddenByDefault`, value: item });
        seen.add(item);
      }
      out.forbiddenByDefault = Array.from(seen).sort();
    }
  }
  return out;
}

function validateOptionalPrivacy(value, label, diagnostics, context = {}) {
  if (value === undefined || value === null) return null;
  return validatePrivacyClassification(value, label, diagnostics, context);
}

function validatePrivacyClassification(value, label, diagnostics, context = {}) {
  const code = privacyCode(context);
  const classification = validateStableString(value, label, diagnostics, context);
  if (!classification) return null;
  if (FORBIDDEN_PRIVACY_MARKERS.has(classification)) {
    addDiagnostic(diagnostics, code, `${label} must not use forbidden privacy marker ${classification} as an allowed classification`, { ...context, field: label, value: classification });
    return null;
  }
  if (!PRIVACY_CLASSIFICATIONS.has(classification)) {
    addDiagnostic(diagnostics, code, `${label} must be one of: ${Array.from(PRIVACY_CLASSIFICATIONS).sort().join(", ")}`, { ...context, field: label, value: classification });
    return null;
  }
  return classification;
}

function validateStableString(value, label, diagnostics, context = {}) {
  const code = privacyCode(context);
  if (typeof value !== "string" || value.trim() === "") {
    addDiagnostic(diagnostics, code, `${label} must be a non-empty stable string`, { ...context, field: label });
    return null;
  }
  if (!STABLE_NAME_RE.test(value)) {
    addDiagnostic(diagnostics, code, `${label} must be a stable string`, { ...context, field: label, value });
    return null;
  }
  return value;
}

function validateStableName(value, label, diagnostics, context = {}, code = "air.facts.schema_invalid") {
  if (typeof value !== "string" || value.trim() === "") {
    addDiagnostic(diagnostics, code, `${label} is required`, { ...context, field: label });
    return null;
  }
  if (!STABLE_NAME_RE.test(value)) {
    addDiagnostic(diagnostics, code, `${label} must be a stable identifier`, { ...context, field: label, value });
    return null;
  }
  return value;
}

function validatePositiveInteger(value, label, diagnostics, context = {}, codes = {}) {
  if (!Number.isInteger(value) || value <= 0) {
    addDiagnostic(diagnostics, codes.invalidCode || "air.facts.schema_invalid", `${label} must be a positive integer`, { ...context, field: label, value });
    return null;
  }
  return value;
}

function validateOptionalInteger(value, label, diagnostics, context = {}) {
  if (value === undefined || value === null) return null;
  if (!Number.isInteger(value) || value < 0) {
    addDiagnostic(diagnostics, "air.facts.schema_invalid", `${label} must be a non-negative integer when present`, { ...context, field: label, value });
    return null;
  }
  return value;
}

function scanForForbiddenRuntimeShape(value, pathLabel, diagnostics, context = {}) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanForForbiddenRuntimeShape(item, `${pathLabel}[${index}]`, diagnostics, context));
    return;
  }
  if (!value || typeof value !== "object") {
    if (typeof value === "string" && looksAbsolutePath(value)) {
      addDiagnostic(diagnostics, context.codePrefix === "air.rowset" ? "air.rowset.absolute_path" : "air.facts.absolute_path", `${pathLabel} must not contain absolute paths`, { ...context, field: pathLabel });
    }
    return;
  }
  for (const key of Object.keys(value)) {
    if (/timestamp|createdAt|updatedAt|generatedAt/i.test(key)) {
      addDiagnostic(diagnostics, context.codePrefix === "air.rowset" ? "air.rowset.timestamp_field" : "air.facts.timestamp_field", `${pathLabel}.${key} must not encode timestamps`, { ...context, field: `${pathLabel}.${key}` });
    }
    scanForForbiddenRuntimeShape(value[key], `${pathLabel}.${key}`, diagnostics, context);
  }
}

function scanForForbiddenRowsetPayloadKeys(value, pathLabel, diagnostics, context = {}) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanForForbiddenRowsetPayloadKeys(item, `${pathLabel}[${index}]`, diagnostics, context));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const key of Object.keys(value)) {
    if (["rows", "data", "values"].includes(key)) {
      addDiagnostic(diagnostics, "air.rowset.schema_invalid", `${pathLabel}.${key} is not allowed; bounded rowset schemas describe shape only, not runtime rows or values`, { ...context, field: `${pathLabel}.${key}` });
    }
    scanForForbiddenRowsetPayloadKeys(value[key], `${pathLabel}.${key}`, diagnostics, context);
  }
}

function compactStorageSummary(columns, maxRows) {
  if (!Number.isInteger(maxRows) || maxRows <= 0) {
    return { estimatedI32Bytes: null, estimatedStorageBytes: null, estimatedSavingsBytes: null };
  }
  let estimatedI32Bytes = 0;
  let estimatedStorageBytes = 0;
  for (const column of columns || []) {
    estimatedI32Bytes += maxRows * 4;
    const hint = column.storageHint || (column.type === "bool" ? "bool" : "i32");
    estimatedStorageBytes += maxRows * (STORAGE_HINT_BYTES[hint] || 4);
  }
  return {
    estimatedI32Bytes,
    estimatedStorageBytes,
    estimatedSavingsBytes: Math.max(0, estimatedI32Bytes - estimatedStorageBytes)
  };
}

function privacyCode(context = {}) {
  return context.codePrefix === "air.rowset" ? "air.rowset.privacy_invalid" : "air.facts.privacy_invalid";
}

function addDiagnostic(out, code, message, fields = {}) {
  out.push({
    code,
    severity: "fail",
    message,
    fields: stableObject(fields)
  });
}

function finalize(report) {
  report.diagnostics.sort(compareDiagnostics);
  report.errors = report.diagnostics.filter((item) => item.severity === "fail").map((item) => item.message).sort();
  report.warnings = report.diagnostics.filter((item) => item.severity === "warn").map((item) => item.message).sort();
  report.ok = report.errors.length === 0;
}

function compareDiagnostics(a, b) {
  return String(a.code || "").localeCompare(String(b.code || "")) ||
    String(a.message || "").localeCompare(String(b.message || ""));
}

function looksAbsolutePath(value) {
  return path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("file://");
}

function normalizeRelativePath(value) {
  if (!value) return null;
  return String(value).replace(/\\/g, "/").replace(/^\.\//, "");
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const key of Object.keys(value).sort()) {
    if (value[key] !== undefined && value[key] !== null) out[key] = stableObject(value[key]);
  }
  return out;
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

module.exports = {
  FACTS_SCHEMA_VERSION,
  FactsSchemaError,
  PRIVACY_CLASSIFICATIONS,
  ROWSET_KIND,
  ROWSET_SCHEMA_VERSION,
  SCALAR_TYPES,
  STORAGE_HINTS,
  validateFactsSchema,
  validateFactsSchemaFile
};
