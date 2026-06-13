const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const OUTPUT_CONTRACT_SCHEMA_VERSION = "0.18";
const OUTPUT_CONTRACT_KIND = "air.outputContract";
const SCALAR_TYPES = new Set(["i32", "bool"]);
const KNOWN_CHANNELS = new Set([
  "alert",
  "audio",
  "audit",
  "badge",
  "dashboard",
  "extension",
  "focus",
  "notification",
  "pipeline",
  "policy",
  "test",
  "visual"
]);
const STABLE_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const STABLE_STRING_RE = /^[A-Za-z_][A-Za-z0-9_.:-]{0,127}$/;

function validateOutputContractSchemaFile(file, options = {}) {
  const absolute = path.resolve(file);
  const relativePath = normalizeRelativePath(options.relativePath || path.basename(file));
  const errors = [];
  let bytes = null;
  let schema = null;
  try {
    bytes = fs.readFileSync(absolute, "utf8");
  } catch (_err) {
    errors.push(diagnostic("air.output_contract.schema_invalid", `output contract file not found: ${relativePath}`));
  }
  if (bytes !== null) {
    try {
      schema = JSON.parse(bytes);
    } catch (err) {
      errors.push(diagnostic("air.output_contract.schema_invalid", `invalid JSON in output contract ${relativePath}: ${err.message}`));
    }
  }
  const report = validateOutputContractSchema(schema, { ...options, relativePath });
  const combinedErrors = errors.concat(report.diagnostics.filter((item) => item.severity === "fail"));
  const combinedWarnings = report.diagnostics.filter((item) => item.severity === "warn");
  return {
    ...report,
    path: relativePath,
    exists: bytes !== null,
    fingerprint: bytes === null ? null : `sha256:${sha256(bytes)}`,
    diagnostics: combinedErrors.concat(combinedWarnings).sort(compareDiagnosticMessages),
    errors: combinedErrors.map((item) => item.message).sort(),
    warnings: combinedWarnings.map((item) => item.message).sort(),
    ok: bytes !== null && combinedErrors.length === 0
  };
}

function validateOutputContractSchema(schema, options = {}) {
  const diagnostics = [];
  const relativePath = normalizeRelativePath(options.relativePath || null);
  const report = {
    schemaVersion: null,
    kind: null,
    path: relativePath,
    outputs: [],
    diagnostics,
    errors: [],
    warnings: [],
    ok: false
  };

  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    addDiagnostic(diagnostics, "air.output_contract.schema_invalid", "output contract must be a JSON object");
    finalize(report);
    return report;
  }

  scanForForbiddenMetadata(schema, "$", diagnostics);

  if (typeof schema.schemaVersion !== "string" || schema.schemaVersion.trim() === "") {
    addDiagnostic(diagnostics, "air.output_contract.schema_invalid", "schemaVersion is required");
  } else {
    report.schemaVersion = schema.schemaVersion;
  }

  if (schema.kind !== OUTPUT_CONTRACT_KIND) {
    addDiagnostic(diagnostics, "air.output_contract.schema_invalid", `kind must be ${OUTPUT_CONTRACT_KIND}`);
  } else {
    report.kind = schema.kind;
  }

  if (!Array.isArray(schema.outputs)) {
    addDiagnostic(diagnostics, "air.output_contract.schema_invalid", "outputs must be an array");
  } else {
    const seenIds = new Set();
    const seenNames = new Set();
    for (let i = 0; i < schema.outputs.length; i++) {
      const output = validateOutput(schema.outputs[i], i, diagnostics);
      if (!output) continue;
      if (seenIds.has(output.id)) addDiagnostic(diagnostics, "air.output_contract.duplicate_id", `duplicate output id: ${output.id}`);
      seenIds.add(output.id);
      if (seenNames.has(output.name)) addDiagnostic(diagnostics, "air.output_contract.duplicate_name", `duplicate output name: ${output.name}`);
      seenNames.add(output.name);
      report.outputs.push(output);
    }
  }

  report.outputs.sort((a, b) => a.id - b.id || a.name.localeCompare(b.name));
  finalize(report);
  return report;
}

function validateOutput(value, index, diagnostics) {
  const label = `outputs[${index}]`;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    addDiagnostic(diagnostics, "air.output_contract.schema_invalid", `${label} must be an object`);
    return null;
  }
  if (value.dynamic === true || value.unbounded === true) {
    addDiagnostic(diagnostics, "air.output_contract.schema_invalid", `${label} must not be dynamic or unbounded`);
  }
  const id = validatePositiveInteger(value.id, `${label}.id`, diagnostics);
  const name = validateStableName(value.name, `${label}.name`, diagnostics);
  const channel = validateChannel(value.channel, `${label}.channel`, value.experimental === true, diagnostics);
  const capability = validateStableString(value.capability, `${label}.capability`, diagnostics);

  const args = [];
  const seenArgs = new Set();
  if (!Array.isArray(value.args)) {
    addDiagnostic(diagnostics, "air.output_contract.schema_invalid", `${label}.args must be an array`);
  } else {
    for (let i = 0; i < value.args.length; i++) {
      const arg = validateArg(value.args[i], `${label}.args[${i}]`, diagnostics);
      if (!arg) continue;
      if (seenArgs.has(arg.name)) addDiagnostic(diagnostics, "air.output_contract.duplicate_name", `duplicate arg name ${arg.name} in ${label}`);
      seenArgs.add(arg.name);
      args.push(arg);
    }
  }

  const resources = validateOptionalObjectArray(value.resources, `${label}.resources`, diagnostics);
  const profileConstraints = validateOptionalObjectArray(value.profileConstraints, `${label}.profileConstraints`, diagnostics);

  if (id === null || !name || !channel || !capability) return null;
  return {
    id,
    name,
    channel,
    capability,
    argCount: args.length,
    args: args.sort((a, b) => a.name.localeCompare(b.name)),
    resources,
    profileConstraints,
    experimental: value.experimental === true
  };
}

function validateArg(value, label, diagnostics) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    addDiagnostic(diagnostics, "air.output_contract.schema_invalid", `${label} must be an object`);
    return null;
  }
  if (value.dynamic === true || value.unbounded === true) {
    addDiagnostic(diagnostics, "air.output_contract.non_scalar_arg", `${label} must not be dynamic or unbounded`);
  }
  for (const forbidden of ["fields", "properties", "items", "shape", "schema", "payload"]) {
    if (value[forbidden] !== undefined) {
      addDiagnostic(diagnostics, "air.output_contract.non_scalar_arg", `${label}.${forbidden} is not allowed; output args must be scalar`);
    }
  }
  const name = validateStableName(value.name, `${label}.name`, diagnostics);
  const type = typeof value.type === "string" ? value.type : null;
  if (!type) {
    addDiagnostic(diagnostics, "air.output_contract.schema_invalid", `${label}.type is required`);
  } else if (!SCALAR_TYPES.has(type)) {
    addDiagnostic(diagnostics, "air.output_contract.non_scalar_arg", `${label}.type ${JSON.stringify(type)} is not a supported scalar output arg type`);
  }
  return name && type ? { name, type } : null;
}

function validateOptionalObjectArray(value, label, diagnostics) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    addDiagnostic(diagnostics, "air.output_contract.schema_invalid", `${label} must be an array when present`);
    return [];
  }
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      addDiagnostic(diagnostics, "air.output_contract.schema_invalid", `${label}[${index}] must be an object`);
      return null;
    }
    return stableObject(item);
  }).filter(Boolean).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

function validateChannel(value, label, experimental, diagnostics) {
  const channel = validateStableString(value, label, diagnostics);
  if (!channel) return null;
  if (!KNOWN_CHANNELS.has(channel)) {
    if (experimental || channel.startsWith("experimental.")) {
      addDiagnostic(diagnostics, "air.output_contract.schema_invalid", `${label} ${JSON.stringify(channel)} is experimental`, { severity: "warn" });
    } else {
      addDiagnostic(diagnostics, "air.output_contract.schema_invalid", `${label} ${JSON.stringify(channel)} is not a known output channel`);
      return null;
    }
  }
  return channel;
}

function validatePositiveInteger(value, label, diagnostics) {
  if (!Number.isInteger(value) || value <= 0) {
    addDiagnostic(diagnostics, "air.output_contract.schema_invalid", `${label} must be a positive integer`);
    return null;
  }
  return value;
}

function validateStableName(value, label, diagnostics) {
  if (typeof value !== "string" || value.trim() === "") {
    addDiagnostic(diagnostics, "air.output_contract.schema_invalid", `${label} is required`);
    return null;
  }
  if (!STABLE_NAME_RE.test(value)) {
    addDiagnostic(diagnostics, "air.output_contract.schema_invalid", `${label} must be a stable identifier`);
    return null;
  }
  return value;
}

function validateStableString(value, label, diagnostics) {
  if (typeof value !== "string" || value.trim() === "") {
    addDiagnostic(diagnostics, "air.output_contract.schema_invalid", `${label} is required`);
    return null;
  }
  if (!STABLE_STRING_RE.test(value)) {
    addDiagnostic(diagnostics, "air.output_contract.schema_invalid", `${label} must be a stable string`);
    return null;
  }
  return value;
}

function scanForForbiddenMetadata(value, pathLabel, diagnostics) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanForForbiddenMetadata(item, `${pathLabel}[${index}]`, diagnostics));
    return;
  }
  if (!value || typeof value !== "object") {
    if (typeof value === "string" && looksAbsolutePath(value)) {
      addDiagnostic(diagnostics, "air.output_contract.absolute_path", `${pathLabel} must not contain absolute paths`);
    }
    return;
  }
  for (const key of Object.keys(value)) {
    if (/timestamp|createdAt|updatedAt|generatedAt/i.test(key)) {
      addDiagnostic(diagnostics, "air.output_contract.timestamp_field", `${pathLabel}.${key} must not encode timestamps`);
    }
    scanForForbiddenMetadata(value[key], `${pathLabel}.${key}`, diagnostics);
  }
}

function looksAbsolutePath(value) {
  return path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("file://");
}

function addDiagnostic(out, code, message, options = {}) {
  out.push(diagnostic(code, message, options));
}

function diagnostic(code, message, options = {}) {
  return {
    code,
    severity: options.severity || "fail",
    message
  };
}

function finalize(report) {
  report.diagnostics.sort(compareDiagnosticMessages);
  report.errors = report.diagnostics.filter((item) => item.severity === "fail").map((item) => item.message).sort();
  report.warnings = report.diagnostics.filter((item) => item.severity === "warn").map((item) => item.message).sort();
  report.ok = report.errors.length === 0;
}

function compareDiagnosticMessages(a, b) {
  return String(a.code || "").localeCompare(String(b.code || "")) ||
    String(a.message || "").localeCompare(String(b.message || ""));
}

function normalizeRelativePath(value) {
  if (!value) return null;
  return String(value).replace(/\\/g, "/").replace(/^\.\//, "");
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = stableObject(value[key]);
  return out;
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

module.exports = {
  KNOWN_CHANNELS,
  OUTPUT_CONTRACT_KIND,
  OUTPUT_CONTRACT_SCHEMA_VERSION,
  SCALAR_TYPES,
  validateOutputContractSchema,
  validateOutputContractSchemaFile
};
