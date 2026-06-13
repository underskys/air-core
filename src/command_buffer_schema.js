const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const COMMAND_BUFFER_SCHEMA_VERSION = "0.20";
const COMMAND_BUFFER_KIND = "air.commandBuffer";
const STABLE_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

function validateCommandBufferSchemaFile(file, options = {}) {
  const absolute = path.resolve(file);
  const relativePath = normalizeRelativePath(options.relativePath || path.basename(file));
  const knownOutputIds = new Set((options.outputContracts || [])
    .flatMap((contract) => contract.outputs || [])
    .map((output) => output.id)
    .filter((id) => Number.isInteger(id)));
  const diagnostics = [];
  let bytes = null;
  let schema = null;
  try {
    bytes = fs.readFileSync(absolute, "utf8");
  } catch (_err) {
    addDiagnostic(diagnostics, "air.command_buffer.schema_invalid", `command buffer file not found: ${relativePath}`, { path: relativePath });
  }
  if (bytes !== null) {
    try {
      schema = JSON.parse(bytes);
    } catch (err) {
      addDiagnostic(diagnostics, "air.command_buffer.schema_invalid", `invalid JSON in command buffer ${relativePath}: ${err.message}`, { path: relativePath });
    }
  }
  const report = validateCommandBufferSchema(schema, { ...options, relativePath, knownOutputIds });
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

function validateCommandBufferSchema(schema, options = {}) {
  const diagnostics = [];
  const relativePath = normalizeRelativePath(options.relativePath || null);
  const knownOutputIds = options.knownOutputIds || new Set();
  const outputContractsDeclared = options.outputContractsDeclared !== undefined
    ? Boolean(options.outputContractsDeclared)
    : knownOutputIds.size > 0;
  const report = {
    schemaVersion: null,
    kind: null,
    path: relativePath,
    name: null,
    maxCommands: null,
    records: [],
    usedOutputIds: [],
    diagnostics,
    errors: [],
    warnings: [],
    ok: false
  };

  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    addDiagnostic(diagnostics, "air.command_buffer.schema_invalid", "command buffer must be a JSON object", { path: relativePath });
    finalize(report);
    return report;
  }

  scanForForbiddenMetadata(schema, "$", diagnostics, { path: relativePath });

  if (schema.schemaVersion !== COMMAND_BUFFER_SCHEMA_VERSION) {
    addDiagnostic(diagnostics, "air.command_buffer.schema_invalid", `schemaVersion must be ${COMMAND_BUFFER_SCHEMA_VERSION}`, { path: relativePath, field: "schemaVersion", value: schema.schemaVersion });
  } else {
    report.schemaVersion = schema.schemaVersion;
  }

  if (schema.kind !== COMMAND_BUFFER_KIND) {
    addDiagnostic(diagnostics, "air.command_buffer.schema_invalid", `kind must be ${COMMAND_BUFFER_KIND}`, { path: relativePath, field: "kind", value: schema.kind });
  } else {
    report.kind = schema.kind;
  }

  const name = validateStableName(schema.name, "name", diagnostics, { path: relativePath });
  report.name = name;

  const maxCommands = validatePositiveInteger(schema.maxCommands, "maxCommands", diagnostics, { path: relativePath });
  report.maxCommands = maxCommands;

  if (!Array.isArray(schema.records)) {
    addDiagnostic(diagnostics, "air.command_buffer.schema_invalid", "records must be an array", { path: relativePath, field: "records" });
  } else {
    if (maxCommands !== null && schema.records.length > maxCommands) {
      addDiagnostic(diagnostics, "air.command_buffer.capacity_exceeded", `records length ${schema.records.length} exceeds maxCommands ${maxCommands}`, {
        path: relativePath,
        count: schema.records.length,
        maxCommands
      });
    }
    for (let i = 0; i < schema.records.length; i++) {
      const record = validateCommandRecord(schema.records[i], i, diagnostics, { path: relativePath, knownOutputIds, outputContractsDeclared });
      if (record) report.records.push(record);
    }
  }

  report.records.sort((a, b) => a.index - b.index);
  report.usedOutputIds = Array.from(new Set(report.records.map((record) => record.output_id))).sort((a, b) => a - b);
  finalize(report);
  return report;
}

function validateCommandRecord(value, index, diagnostics, context = {}) {
  const label = `records[${index}]`;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    addDiagnostic(diagnostics, "air.command_buffer.schema_invalid", `${label} must be an object`, { path: context.path, field: label });
    return null;
  }
  for (const key of Object.keys(value)) {
    if (!["output_id", "arg0", "arg1", "arg2", "arg3"].includes(key)) {
      addDiagnostic(diagnostics, "air.command_buffer.schema_invalid", `${label}.${key} is not allowed`, { path: context.path, field: `${label}.${key}` });
    }
  }
  const outputId = validateI32(value.output_id, `${label}.output_id`, diagnostics, context);
  const args = [
    validateI32(value.arg0, `${label}.arg0`, diagnostics, context),
    validateI32(value.arg1, `${label}.arg1`, diagnostics, context),
    validateI32(value.arg2, `${label}.arg2`, diagnostics, context),
    validateI32(value.arg3, `${label}.arg3`, diagnostics, context)
  ];
  if (outputId !== null && (!context.outputContractsDeclared || !context.knownOutputIds.has(outputId))) {
    addDiagnostic(diagnostics, "air.command_buffer.unknown_output_id", `${label}.output_id ${outputId} is not declared by outputContracts`, {
      path: context.path,
      index,
      output_id: outputId
    });
  }
  if (outputId === null || args.some((arg) => arg === null)) return null;
  return {
    index,
    output_id: outputId,
    arg0: args[0],
    arg1: args[1],
    arg2: args[2],
    arg3: args[3]
  };
}

function validatePositiveInteger(value, field, diagnostics, context = {}) {
  if (!Number.isInteger(value) || value <= 0) {
    addDiagnostic(diagnostics, "air.command_buffer.schema_invalid", `${field} must be a positive integer`, { ...context, field, value });
    return null;
  }
  return value;
}

function validateI32(value, field, diagnostics, context = {}) {
  if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647) {
    addDiagnostic(diagnostics, "air.command_buffer.non_scalar_arg", `${field} must be an i32 integer`, { ...context, field, value });
    return null;
  }
  return value;
}

function validateStableName(value, field, diagnostics, context = {}) {
  if (typeof value !== "string" || value.trim() === "") {
    addDiagnostic(diagnostics, "air.command_buffer.schema_invalid", `${field} is required`, { ...context, field });
    return null;
  }
  if (!STABLE_NAME_RE.test(value)) {
    addDiagnostic(diagnostics, "air.command_buffer.schema_invalid", `${field} must be a stable identifier`, { ...context, field, value });
    return null;
  }
  return value;
}

function scanForForbiddenMetadata(value, pathLabel, diagnostics, context = {}) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanForForbiddenMetadata(item, `${pathLabel}[${index}]`, diagnostics, context));
    return;
  }
  if (!value || typeof value !== "object") {
    if (typeof value === "string" && looksAbsolutePath(value)) {
      addDiagnostic(diagnostics, "air.command_buffer.absolute_path", `${pathLabel} must not contain absolute paths`, { ...context, field: pathLabel });
    }
    return;
  }
  for (const key of Object.keys(value)) {
    if (/timestamp|createdAt|updatedAt|generatedAt|wallClock|random|nonce|uuid/i.test(key)) {
      addDiagnostic(diagnostics, "air.command_buffer.timestamp_field", `${pathLabel}.${key} must not encode timestamps or nondeterministic values`, { ...context, field: `${pathLabel}.${key}` });
    }
    if (["payload", "data", "values", "rows", "fields", "properties", "items", "json", "map", "object", "hostHandle"].includes(key)) {
      addDiagnostic(diagnostics, "air.command_buffer.schema_invalid", `${pathLabel}.${key} is not allowed; command records are bounded scalar output intents`, { ...context, field: `${pathLabel}.${key}` });
    }
    scanForForbiddenMetadata(value[key], `${pathLabel}.${key}`, diagnostics, context);
  }
}

function finalize(report) {
  report.diagnostics.sort(compareDiagnostics);
  report.errors = report.diagnostics.filter((item) => item.severity === "fail").map((item) => item.message).sort();
  report.warnings = report.diagnostics.filter((item) => item.severity === "warn").map((item) => item.message).sort();
  report.ok = report.errors.length === 0;
}

function addDiagnostic(diagnostics, code, message, fields = {}, options = {}) {
  diagnostics.push({
    code,
    severity: options.severity || "fail",
    message,
    fields: stableObject(fields)
  });
}

function compareDiagnostics(a, b) {
  return String(a.code).localeCompare(String(b.code)) ||
    String(a.message).localeCompare(String(b.message));
}

function normalizeRelativePath(value) {
  if (!value) return null;
  return String(value).replace(/\\/g, "/").replace(/^\.\//, "");
}

function looksAbsolutePath(value) {
  return typeof value === "string" && (/^\/[^/]/.test(value) || /^[A-Za-z]:[\\/]/.test(value));
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = stableObject(value[key]);
  return out;
}

module.exports = {
  COMMAND_BUFFER_SCHEMA_VERSION,
  COMMAND_BUFFER_KIND,
  validateCommandBufferSchema,
  validateCommandBufferSchemaFile
};
