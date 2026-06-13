const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { checkPackageDir } = require("./sdk");
const { normalizePackageMetadata, validatePackageManifest } = require("./package_manifest");
const { parseAir } = require("./parser");
const { analyzeObservationOnlyFunctions, observationSafetyDiagnostics } = require("./observation_safety");

const CONFORMANCE_SCHEMA_VERSION = "0.16";
const BATCH_CONFORMANCE_SCHEMA_VERSION = "0.20";
const TRACE_KIND = "air.conformance.trace";
const BATCH_TRACE_KIND = "air.conformance.batchFixture";
const STABLE_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const STABLE_STRING_RE = /^[A-Za-z_][A-Za-z0-9_.:-]{0,127}$/;
const FORBIDDEN_PRIVATE_KEY_RE = /(^|[_-])(raw_text|raw_url|private_text|token|secret|credential|note_text|url)([_-]|$)|token|secret|credential/i;
const NONDETERMINISTIC_KEY_RE = /timestamp|createdAt|updatedAt|generatedAt|wallClock|random|nonce|uuid|nondeterministic/i;

async function createConformanceReplayReport(packageDir, options = {}) {
  const base = path.resolve(packageDir);
  const profile = options.profile || null;
  const tracePath = options.trace ? path.resolve(options.trace) : null;
  if (!profile) throw new Error("missing --profile <profile>");
  if (!tracePath) throw new Error("missing --trace <trace.json>");
  const trace = readTrace(tracePath);
  if (trace.kind === BATCH_TRACE_KIND) return createBatchConformanceReport(base, profile, trace);

  const manifest = validatePackageManifest(base, { built: true });
  const metadata = normalizePackageMetadata(manifest);
  const report = {
    schemaVersion: CONFORMANCE_SCHEMA_VERSION,
    kind: "air.conformance.report",
    package: metadata.name || path.basename(base),
    profile,
    trace: {
      id: trace.id,
      fingerprint: traceFingerprint(trace)
    },
    status: "pass",
    mismatches: [],
    unsupported: {
      profile: false,
      features: []
    },
    diagnostics: [],
    steps: [],
    stateDigest: null
  };

  if (trace.package && trace.package !== report.package) {
    addMismatch(report, {
      step: null,
      kind: "package",
      message: `trace package ${trace.package} does not match package ${report.package}`
    });
    return finalizeReport(report);
  }
  if (trace.profile && trace.profile !== profile) {
    addMismatch(report, {
      step: null,
      kind: "profile",
      message: `trace profile ${trace.profile} does not match selected profile ${profile}`
    });
    return finalizeReport(report);
  }

  const packageCheck = checkPackageDir(base, { profile, built: true });
  for (const diagnostic of packageCheck.diagnostics || []) report.diagnostics.push(diagnostic);
  if (packageCheck.status === "fail") {
    report.unsupported.profile = Boolean((packageCheck.checks || []).some((check) => check.id === "target-profile-declared" || check.id === "host-profile"));
    report.unsupported.features = unsupportedFeaturesFromPackageCheck(packageCheck);
    for (const error of packageCheck.errors || []) {
      addMismatch(report, {
        step: null,
        kind: "package-check",
        message: error
      });
    }
    return finalizeReport(report);
  }

  let instance = null;
  try {
    const wasmPath = path.join(base, metadata.wasm);
    const loaded = await WebAssembly.instantiate(fs.readFileSync(wasmPath), {});
    instance = loaded.instance || loaded;
  } catch (err) {
    addMismatch(report, {
      step: null,
      kind: "instantiate",
      message: err && err.message ? err.message : String(err)
    });
    return finalizeReport(report);
  }

  for (const step of (trace.steps || []).slice().sort((a, b) => String(a.id || "").localeCompare(String(b.id || "")))) {
    runStep(report, instance, step);
  }
  if (trace.stateDigest) {
    const safety = loadDigestHelperSafety(base, metadata);
    runStateDigest(report, instance, trace.stateDigest, safety);
  }

  return finalizeReport(report);
}

function readTrace(tracePath) {
  const trace = JSON.parse(fs.readFileSync(tracePath, "utf8"));
  const errors = [];
  if (!trace || typeof trace !== "object" || Array.isArray(trace)) errors.push("trace must be a JSON object");
  if (typeof trace.id !== "string" || trace.id.trim() === "") errors.push("trace.id is required");
  if (typeof trace.package !== "string" || trace.package.trim() === "") errors.push("trace.package is required");
  if (typeof trace.profile !== "string" || trace.profile.trim() === "") errors.push("trace.profile is required");
  if (trace.kind === TRACE_KIND) {
    if (trace.schemaVersion !== CONFORMANCE_SCHEMA_VERSION) errors.push(`trace.schemaVersion must be ${CONFORMANCE_SCHEMA_VERSION}`);
    if (!Array.isArray(trace.steps)) errors.push("trace.steps must be an array");
    for (const [index, step] of (trace.steps || []).entries()) {
      if (!step || typeof step !== "object" || Array.isArray(step)) {
        errors.push(`trace.steps[${index}] must be an object`);
        continue;
      }
      if (typeof step.id !== "string" || step.id.trim() === "") errors.push(`trace.steps[${index}].id is required`);
      if (!step.call || typeof step.call !== "object" || Array.isArray(step.call)) errors.push(`trace.steps[${index}].call must be an object`);
      else {
        if (typeof step.call.export !== "string" || step.call.export.trim() === "") errors.push(`trace.steps[${index}].call.export is required`);
        if (step.call.args !== undefined && !Array.isArray(step.call.args)) errors.push(`trace.steps[${index}].call.args must be an array`);
      }
    }
    validateStateDigestTrace(trace.stateDigest, errors);
  } else if (trace.kind === BATCH_TRACE_KIND) {
    if (trace.schemaVersion !== BATCH_CONFORMANCE_SCHEMA_VERSION) errors.push(`trace.schemaVersion must be ${BATCH_CONFORMANCE_SCHEMA_VERSION}`);
    if (!Array.isArray(trace.rowsets)) errors.push("trace.rowsets must be an array");
    if (!Array.isArray(trace.observedOutputs)) errors.push("trace.observedOutputs must be an array");
    if (!Array.isArray(trace.expectedOutputs)) errors.push("trace.expectedOutputs must be an array");
    if (trace.observedCommands !== undefined && !Array.isArray(trace.observedCommands)) errors.push("trace.observedCommands must be an array when present");
    if (trace.expectedCommands !== undefined && !Array.isArray(trace.expectedCommands)) errors.push("trace.expectedCommands must be an array when present");
  } else {
    errors.push(`trace.kind must be ${TRACE_KIND} or ${BATCH_TRACE_KIND}`);
  }
  if (errors.length) throw new Error(errors.join("\n"));
  return trace;
}

function validateStateDigestTrace(stateDigest, errors) {
  if (stateDigest === undefined) return;
  if (!stateDigest || typeof stateDigest !== "object" || Array.isArray(stateDigest)) {
    errors.push("trace.stateDigest must be an object when present");
    return;
  }
  if (stateDigest.algorithm !== undefined && stateDigest.algorithm !== "sha256") {
    errors.push("trace.stateDigest.algorithm must be sha256 when present");
  }
  if (!Array.isArray(stateDigest.helpers) || !stateDigest.helpers.length) {
    errors.push("trace.stateDigest.helpers must be a non-empty array");
    return;
  }
  if (stateDigest.expected !== undefined && !/^sha256:[a-f0-9]{64}$/.test(String(stateDigest.expected))) {
    errors.push("trace.stateDigest.expected must be a sha256 digest when present");
  }
  for (const [index, helper] of stateDigest.helpers.entries()) {
    if (!helper || typeof helper !== "object" || Array.isArray(helper)) {
      errors.push(`trace.stateDigest.helpers[${index}] must be an object`);
      continue;
    }
    if (typeof helper.export !== "string" || helper.export.trim() === "") errors.push(`trace.stateDigest.helpers[${index}].export is required`);
    if (helper.args !== undefined && !Array.isArray(helper.args)) errors.push(`trace.stateDigest.helpers[${index}].args must be an array`);
    for (const [argIndex, arg] of (helper.args || []).entries()) {
      if (!Number.isInteger(arg)) errors.push(`trace.stateDigest.helpers[${index}].args[${argIndex}] must be i32`);
    }
  }
}

function createBatchConformanceReport(base, profile, trace) {
  const manifest = validatePackageManifest(base, { built: false });
  const metadata = normalizePackageMetadata(manifest);
  const report = {
    schemaVersion: BATCH_CONFORMANCE_SCHEMA_VERSION,
    kind: "air.conformance.report",
    mode: "batch",
    package: metadata.name || path.basename(base),
    profile,
    trace: {
      id: trace.id,
      kind: trace.kind,
      fingerprint: traceFingerprint(trace)
    },
    replayChecksum: null,
    status: "pass",
    mismatches: [],
    unsupported: {
      profile: false,
      features: []
    },
    diagnostics: [],
    rowsets: [],
    outputs: {
      observedCount: 0,
      expectedCount: 0,
      observed: [],
      expected: []
    },
    commands: {
      observedCount: 0,
      expectedCount: 0,
      observed: [],
      expected: []
    },
    steps: []
  };

  if (trace.package && trace.package !== report.package) {
    addMismatch(report, {
      step: null,
      kind: "package",
      code: "air.conformance.package_mismatch",
      message: `trace package ${trace.package} does not match package ${report.package}`
    });
    return finalizeBatchReport(report);
  }
  if (trace.profile && trace.profile !== profile) {
    report.unsupported.profile = true;
    addMismatch(report, {
      step: null,
      kind: "unsupported_profile",
      code: "air.conformance.unsupported_profile",
      expected: trace.profile,
      actual: profile,
      message: `trace profile ${trace.profile} does not match selected profile ${profile}`
    });
    return finalizeBatchReport(report);
  }

  const packageCheck = checkPackageDir(base, { profile, built: false });
  for (const diagnostic of packageCheck.diagnostics || []) report.diagnostics.push(sanitizeValue(diagnostic, base));
  if (packageCheck.status === "fail") {
    report.unsupported.profile = Boolean((packageCheck.checks || []).some((check) => check.id === "target-profile-declared" || check.id === "host-profile"));
    report.unsupported.features = unsupportedFeaturesFromPackageCheck(packageCheck);
    for (const error of packageCheck.errors || []) {
      addMismatch(report, {
        step: null,
        kind: report.unsupported.profile ? "unsupported_profile" : "package-check",
        code: report.unsupported.profile ? "air.conformance.unsupported_profile" : "air.conformance.package_check_failed",
        message: sanitizeString(error, base)
      });
    }
    return finalizeBatchReport(report);
  }

  validateBatchTraceMetadata(report, trace);
  validateBatchRowsets(report, trace.rowsets || [], packageCheck);
  validateBatchOutputs(report, trace.observedOutputs || [], trace.expectedOutputs || []);
  validateBatchCommands(report, trace.observedCommands || [], trace.expectedCommands || [], packageCheck);
  return finalizeBatchReport(report);
}

function runStep(report, instance, step) {
  const exportName = step.call.export;
  const args = step.call.args || [];
  const fn = instance.exports[exportName];
  const stepReport = {
    id: step.id,
    export: exportName,
    args,
    status: "pass",
    observed: {}
  };
  if (typeof fn !== "function") {
    stepReport.status = "fail";
    stepReport.observed.error = `missing export ${exportName}`;
    report.steps.push(stepReport);
    addMismatch(report, {
      step: step.id,
      kind: "missing-export",
      message: `missing export ${exportName}`
    });
    return;
  }
  try {
    const value = normalizeWasmValue(fn(...args));
    stepReport.observed.return = value;
    const expectedReturn = step.expect && Object.prototype.hasOwnProperty.call(step.expect, "return") ? step.expect.return : undefined;
    if (expectedReturn !== undefined && value !== expectedReturn) {
      stepReport.status = "fail";
      addMismatch(report, {
        step: step.id,
        kind: "return",
        export: exportName,
        expected: expectedReturn,
        actual: value,
        message: `expected ${exportName} to return ${expectedReturn}, got ${value}`
      });
    }
  } catch (err) {
    stepReport.status = "fail";
    stepReport.observed.error = err && err.message ? err.message : String(err);
    addMismatch(report, {
      step: step.id,
      kind: "exception",
      export: exportName,
      message: stepReport.observed.error
    });
  }
  report.steps.push(stepReport);
}

function runStateDigest(report, instance, stateDigest, safety) {
  const helperResults = [];
  const helperReports = [];
  for (let index = 0; index < stateDigest.helpers.length; index += 1) {
    const helper = stateDigest.helpers[index];
    const exportName = helper.export;
    const args = helper.args || [];
    const helperReport = {
      index,
      export: exportName,
      args,
      status: "pass"
    };
    const safetyDiagnostics = digestHelperSafetyDiagnostics(safety, exportName);
    if (safetyDiagnostics.length) {
      helperReport.status = "fail";
      helperReport.error = safetyDiagnostics.map((item) => item.message).join("; ");
      helperReports.push(helperReport);
      for (const diagnostic of safetyDiagnostics) {
        addMismatch(report, {
          step: null,
          kind: "state_digest_helper",
          code: "air.conformance.state_digest_helper_not_observation_safe",
          export: exportName,
          reason: diagnostic.reason,
          message: diagnostic.message
        });
      }
      continue;
    }
    const fn = instance.exports[exportName];
    if (typeof fn !== "function") {
      helperReport.status = "fail";
      helperReport.error = `missing export ${exportName}`;
      helperReports.push(helperReport);
      addMismatch(report, {
        step: null,
        kind: "state_digest_helper",
        code: "air.conformance.state_digest_helper_failed",
        export: exportName,
        message: `missing state digest helper export ${exportName}`
      });
      continue;
    }
    try {
      const value = normalizeWasmValue(fn(...args));
      if (!Number.isInteger(value)) {
        helperReport.status = "fail";
        helperReport.error = `state digest helper ${exportName} returned non-i32 value`;
        addMismatch(report, {
          step: null,
          kind: "state_digest_helper",
          code: "air.conformance.state_digest_helper_failed",
          export: exportName,
          message: helperReport.error
        });
      } else {
        helperResults.push(stableObject({ index, export: exportName, args, return: value }));
      }
    } catch (err) {
      helperReport.status = "fail";
      helperReport.error = err && err.message ? err.message : String(err);
      addMismatch(report, {
        step: null,
        kind: "state_digest_helper",
        code: "air.conformance.state_digest_helper_failed",
        export: exportName,
        message: helperReport.error
      });
    }
    helperReports.push(helperReport);
  }

  const observed = `sha256:${crypto.createHash("sha256").update(stableStringify({
    algorithm: "sha256",
    helpers: helperResults
  })).digest("hex")}`;
  const expected = stateDigest.expected || null;
  const digestReport = {
    algorithm: "sha256",
    expected,
    helperCount: stateDigest.helpers.length,
    helpers: helperReports.map(stableObject),
    observed,
    status: expected && expected !== observed ? "fail" : "pass"
  };
  if (expected && expected !== observed) {
    addMismatch(report, {
      step: null,
      kind: "state_digest",
      code: "air.conformance.state_digest_mismatch",
      expected,
      actual: observed,
      message: `expected final state digest ${expected}, got ${observed}`
    });
  }
  report.stateDigest = stableObject(digestReport);
}

function loadDigestHelperSafety(base, metadata) {
  const entry = metadata && metadata.entry ? path.join(base, metadata.entry) : null;
  if (!entry || !fs.existsSync(entry)) {
    return { functions: new Map(), externs: new Set(), diagnostics: new Map(), unavailable: "AIR source entry is unavailable" };
  }
  try {
    const mod = parseAir(fs.readFileSync(entry, "utf8"), entry);
    return analyzeDigestHelperSafety(mod);
  } catch (err) {
    return {
      functions: new Map(),
      externs: new Set(),
      diagnostics: new Map(),
      unavailable: err && err.message ? err.message : String(err)
    };
  }
}

function analyzeDigestHelperSafety(mod) {
  return analyzeObservationOnlyFunctions(mod, { label: "state digest helper" });
}

function digestHelperSafetyDiagnostics(safety, exportName) {
  return observationSafetyDiagnostics(safety, exportName, { label: "state digest helper", requireExported: true });
}

function normalizeWasmValue(value) {
  if (typeof value === "bigint") {
    const asNumber = Number(value);
    return Number.isSafeInteger(asNumber) ? asNumber : value.toString();
  }
  if (typeof value === "number") return Object.is(value, -0) ? 0 : value;
  if (value === undefined) return null;
  return value;
}

function validateBatchTraceMetadata(report, trace) {
  scanBatchMetadata(report, trace, "$", { allowStableMetadataStrings: true });
}

function validateBatchRowsets(report, rowsets, packageCheck) {
  const schemas = new Map();
  for (const schema of (((packageCheck.facts || {}).schemas) || [])) {
    if (schema && schema.kind === "air.boundedRowsetSchema" && schema.rowset) {
      schemas.set(schema.rowset.name, { source: "facts", path: schema.path, fingerprint: schema.fingerprint || null, maxRows: schema.rowset.maxRows, columns: schema.rowset.columns || [] });
      schemas.set(schema.path, { source: "facts", path: schema.path, fingerprint: schema.fingerprint || null, maxRows: schema.rowset.maxRows, columns: schema.rowset.columns || [] });
    }
  }
  for (const schema of ((((packageCheck.structuredIO || {}).schemas) || []))) {
    if (schema && schema.kind === "air.structuredRowsetSchema" && schema.ok) {
      schemas.set(schema.name, { source: "structuredIO", path: schema.path, fingerprint: schema.fingerprint || null, maxRows: schema.maxRows, columns: schema.fields || [] });
      schemas.set(schema.path, { source: "structuredIO", path: schema.path, fingerprint: schema.fingerprint || null, maxRows: schema.maxRows, columns: schema.fields || [] });
    }
  }

  for (const rowset of rowsets.slice().sort((a, b) => String(a.name || a.schema || "").localeCompare(String(b.name || b.schema || "")))) {
    const summary = {
      name: rowset && rowset.name ? rowset.name : null,
      schema: rowset && rowset.schema ? rowset.schema : null,
      rowCount: Array.isArray(rowset && rowset.rows) ? rowset.rows.length : 0,
      status: "pass",
      diagnostics: []
    };
    report.rowsets.push(summary);

    if (!rowset || typeof rowset !== "object" || Array.isArray(rowset)) {
      addBatchMismatch(report, summary, "rowset_schema", "air.conformance.rowset_schema_invalid", "rowset fixture entry must be an object");
      continue;
    }
    if (!STABLE_NAME_RE.test(String(rowset.name || ""))) {
      addBatchMismatch(report, summary, "rowset_schema", "air.conformance.rowset_schema_invalid", "rowset fixture name must be a stable identifier");
      continue;
    }
    if (!Array.isArray(rowset.rows)) {
      addBatchMismatch(report, summary, "rowset_schema", "air.conformance.rowset_schema_invalid", `rowset ${rowset.name} rows must be an array`);
      continue;
    }

    const schema = schemas.get(rowset.schema || rowset.name);
    if (!schema) {
      addBatchMismatch(report, summary, "rowset_schema", "air.conformance.rowset_schema_invalid", `rowset ${rowset.name} does not match a package bounded rowset or structured IO rowset schema`);
      continue;
    }
    summary.schema = schema.path;
    summary.maxRows = schema.maxRows;
    summary.fingerprint = schema.fingerprint || null;
    if (schema.source === "structuredIO") summary.source = schema.source;
    if (rowset.rows.length > schema.maxRows) {
      addBatchMismatch(report, summary, "row_bound_exceeded", "air.conformance.row_bound_exceeded", `rowset ${rowset.name} has ${rowset.rows.length} row(s), maxRows is ${schema.maxRows}`, {
        rowset: rowset.name,
        rowCount: rowset.rows.length,
        maxRows: schema.maxRows
      });
    }

    validateRowsetRows(report, summary, rowset, schema);
  }
}

function validateRowsetRows(report, summary, rowset, schema) {
  const columns = new Map((schema.columns || []).map((column) => [column.name, column]));
  for (let rowIndex = 0; rowIndex < rowset.rows.length; rowIndex++) {
    const row = rowset.rows[rowIndex];
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      addBatchMismatch(report, summary, "row_shape", "air.conformance.rowset_schema_invalid", `rowset ${rowset.name} row ${rowIndex} must be an object`);
      continue;
    }
    for (const key of Object.keys(row).sort()) {
      if (FORBIDDEN_PRIVATE_KEY_RE.test(key)) {
        addBatchMismatch(report, summary, "privacy_leak", "air.conformance.privacy_leak", `rowset ${rowset.name} row ${rowIndex} field ${key} is not allowed in conformance fixtures`);
      }
      if (!columns.has(key)) {
        addBatchMismatch(report, summary, "row_shape", "air.conformance.rowset_schema_invalid", `rowset ${rowset.name} row ${rowIndex} has undeclared column ${key}`);
      }
    }
    for (const column of Array.from(columns.values()).sort((a, b) => a.name.localeCompare(b.name))) {
      const value = row[column.name];
      if (value === undefined) {
        addBatchMismatch(report, summary, "row_shape", "air.conformance.rowset_schema_invalid", `rowset ${rowset.name} row ${rowIndex} missing column ${column.name}`);
        continue;
      }
      if (column.type === "i32") {
        if (!Number.isInteger(value)) {
          addBatchMismatch(report, summary, "row_shape", "air.conformance.rowset_schema_invalid", `rowset ${rowset.name} row ${rowIndex} column ${column.name} must be i32`);
        } else if (Array.isArray(column.range) && (value < column.range[0] || value > column.range[1])) {
          addBatchMismatch(report, summary, "row_shape", "air.conformance.rowset_schema_invalid", `rowset ${rowset.name} row ${rowIndex} column ${column.name} is outside declared range`);
        }
      } else if (column.type === "bool" && typeof value !== "boolean") {
        addBatchMismatch(report, summary, "row_shape", "air.conformance.rowset_schema_invalid", `rowset ${rowset.name} row ${rowIndex} column ${column.name} must be bool`);
      }
    }
  }
}

function validateBatchOutputs(report, observed, expected) {
  const observedRecords = normalizeOutputRecords(report, observed, "observedOutputs");
  const expectedRecords = normalizeOutputRecords(report, expected, "expectedOutputs");
  report.outputs.observed = observedRecords;
  report.outputs.expected = expectedRecords;
  report.outputs.observedCount = observedRecords.length;
  report.outputs.expectedCount = expectedRecords.length;

  if (observedRecords.length !== expectedRecords.length) {
    addMismatch(report, {
      step: null,
      kind: "wrong_output_count",
      code: "air.conformance.wrong_output_count",
      expected: expectedRecords.length,
      actual: observedRecords.length,
      message: `expected ${expectedRecords.length} output intent record(s), got ${observedRecords.length}`
    });
  }

  const count = Math.min(observedRecords.length, expectedRecords.length);
  for (let i = 0; i < count; i++) {
    const actual = observedRecords[i];
    const wanted = expectedRecords[i];
    if (actual.id !== wanted.id) {
      addMismatch(report, {
        step: null,
        kind: "wrong_output_id",
        code: "air.conformance.wrong_output_id",
        index: i,
        expected: wanted.id,
        actual: actual.id,
        message: `output intent ${i} expected id ${wanted.id}, got ${actual.id}`
      });
    }
    if (actual.channel !== wanted.channel) {
      addMismatch(report, {
        step: null,
        kind: "wrong_output_channel",
        code: "air.conformance.wrong_output_channel",
        index: i,
        expected: wanted.channel,
        actual: actual.channel,
        message: `output intent ${i} expected channel ${wanted.channel}, got ${actual.channel}`
      });
    }
    if (JSON.stringify(actual.args) !== JSON.stringify(wanted.args) || actual.flags !== wanted.flags) {
      addMismatch(report, {
        step: null,
        kind: "wrong_args",
        code: "air.conformance.wrong_args",
        index: i,
        expected: { args: wanted.args, flags: wanted.flags },
        actual: { args: actual.args, flags: actual.flags },
        message: `output intent ${i} args or flags did not match`
      });
    }
  }
}

function validateBatchCommands(report, observed, expected, packageCheck) {
  const knownOutputIds = outputIdsFromPackageCheck(packageCheck);
  const observedRecords = normalizeCommandRecords(report, observed, "observedCommands", knownOutputIds);
  const expectedRecords = normalizeCommandRecords(report, expected, "expectedCommands", knownOutputIds);
  report.commands.observed = observedRecords;
  report.commands.expected = expectedRecords;
  report.commands.observedCount = observedRecords.length;
  report.commands.expectedCount = expectedRecords.length;

  if (observedRecords.length !== expectedRecords.length) {
    addMismatch(report, {
      step: null,
      kind: "wrong_output_count",
      code: "air.conformance.wrong_output_count",
      expected: expectedRecords.length,
      actual: observedRecords.length,
      message: `expected ${expectedRecords.length} command record(s), got ${observedRecords.length}`
    });
  }

  const count = Math.min(observedRecords.length, expectedRecords.length);
  for (let i = 0; i < count; i++) {
    const actual = observedRecords[i];
    const wanted = expectedRecords[i];
    if (actual.output_id !== wanted.output_id) {
      addMismatch(report, {
        step: null,
        kind: "wrong_output_id",
        code: "air.conformance.wrong_output_id",
        index: i,
        expected: wanted.output_id,
        actual: actual.output_id,
        message: `command record ${i} expected output_id ${wanted.output_id}, got ${actual.output_id}`
      });
    }
    for (const field of ["arg0", "arg1", "arg2", "arg3"]) {
      if (actual[field] !== wanted[field]) {
        addMismatch(report, {
          step: null,
          kind: "wrong_args",
          code: "air.conformance.wrong_args",
          index: i,
          expected: { [field]: wanted[field] },
          actual: { [field]: actual[field] },
          message: `command record ${i} ${field} did not match`
        });
      }
    }
  }
}

function normalizeCommandRecords(report, records, field, knownOutputIds) {
  const out = [];
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    scanBatchMetadata(report, record, `${field}[${i}]`, {});
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      addMismatch(report, { step: null, kind: "wrong_args", code: "air.conformance.wrong_args", message: `${field}[${i}] must be an object` });
      continue;
    }
    const normalized = { output_id: record.output_id, arg0: record.arg0, arg1: record.arg1, arg2: record.arg2, arg3: record.arg3 };
    let ok = true;
    for (const [key, value] of Object.entries(normalized)) {
      if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647) {
        addMismatch(report, { step: null, kind: key === "output_id" ? "wrong_output_id" : "wrong_args", code: key === "output_id" ? "air.conformance.wrong_output_id" : "air.conformance.wrong_args", message: `${field}[${i}].${key} must be i32` });
        ok = false;
      }
    }
    if (ok && knownOutputIds.size && !knownOutputIds.has(normalized.output_id)) {
      addMismatch(report, {
        step: null,
        kind: "wrong_output_id",
        code: "air.conformance.wrong_output_id",
        index: i,
        actual: normalized.output_id,
        message: `${field}[${i}].output_id ${normalized.output_id} is not declared by outputContracts`
      });
      ok = false;
    }
    if (ok) out.push(stableObject({ index: i, ...normalized }));
  }
  return out;
}

function outputIdsFromPackageCheck(packageCheck) {
  return new Set((((packageCheck.outputContracts || {}).schemas) || [])
    .flatMap((schema) => schema.outputs || [])
    .map((output) => output.id)
    .filter((id) => Number.isInteger(id)));
}

function normalizeOutputRecords(report, records, field) {
  const out = [];
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      addMismatch(report, { step: null, kind: "wrong_args", code: "air.conformance.wrong_args", message: `${field}[${i}] must be an object` });
      continue;
    }
    scanBatchMetadata(report, record, `${field}[${i}]`, { outputRecord: true });
    const id = Number.isInteger(record.id) && record.id > 0 ? record.id : null;
    const channel = STABLE_STRING_RE.test(String(record.channel || "")) ? record.channel : null;
    const name = record.name === undefined || STABLE_NAME_RE.test(String(record.name)) ? record.name || null : null;
    const flags = record.flags === undefined ? 0 : record.flags;
    const args = Array.isArray(record.args) ? record.args.slice() : null;
    if (id === null) addMismatch(report, { step: null, kind: "wrong_output_id", code: "air.conformance.wrong_output_id", message: `${field}[${i}].id must be a positive integer` });
    if (!channel) addMismatch(report, { step: null, kind: "wrong_output_channel", code: "air.conformance.wrong_output_channel", message: `${field}[${i}].channel must be stable` });
    if (name === null) addMismatch(report, { step: null, kind: "wrong_output_id", code: "air.conformance.wrong_output_id", message: `${field}[${i}].name must be a stable identifier when present` });
    if (!Number.isInteger(flags)) addMismatch(report, { step: null, kind: "wrong_args", code: "air.conformance.wrong_args", message: `${field}[${i}].flags must be an integer` });
    if (!args) {
      addMismatch(report, { step: null, kind: "wrong_args", code: "air.conformance.wrong_args", message: `${field}[${i}].args must be an array` });
      continue;
    }
    for (let argIndex = 0; argIndex < args.length; argIndex++) {
      const arg = args[argIndex];
      if (!(Number.isInteger(arg) || typeof arg === "boolean")) {
        addMismatch(report, { step: null, kind: "wrong_args", code: "air.conformance.wrong_args", message: `${field}[${i}].args[${argIndex}] must be scalar i32/bool` });
      }
    }
    if (id !== null && channel && name !== null && Number.isInteger(flags) && args) {
      out.push(stableObject({ id, name, channel, args, flags }));
    }
  }
  return out;
}

function scanBatchMetadata(report, value, pathLabel, options = {}) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanBatchMetadata(report, item, `${pathLabel}[${index}]`, options));
    return;
  }
  if (!value || typeof value !== "object") {
    if (typeof value === "string" && looksAbsolutePath(value)) {
      addMismatch(report, {
        step: null,
        kind: "privacy_leak",
        code: "air.conformance.privacy_leak",
        message: `${pathLabel} must not contain absolute paths`
      });
    }
    return;
  }
  for (const key of Object.keys(value)) {
    if (NONDETERMINISTIC_KEY_RE.test(key)) {
      addMismatch(report, {
        step: null,
        kind: "nondeterministic_output",
        code: "air.conformance.nondeterministic_output",
        message: `${pathLabel}.${key} is not allowed in deterministic batch conformance fixtures`
      });
    }
    if (FORBIDDEN_PRIVATE_KEY_RE.test(key)) {
      addMismatch(report, {
        step: null,
        kind: "privacy_leak",
        code: "air.conformance.privacy_leak",
        message: `${pathLabel}.${key} may leak private data and is not allowed`
      });
    }
    scanBatchMetadata(report, value[key], `${pathLabel}.${key}`, options);
  }
}

function addBatchMismatch(report, summary, kind, code, message, fields = {}) {
  summary.status = "fail";
  summary.diagnostics.push(stableObject({ code, severity: "fail", message, fields: stableObject(fields) }));
  addMismatch(report, {
    step: null,
    kind,
    code,
    rowset: summary.name || null,
    message,
    ...fields
  });
}

function finalizeBatchReport(report) {
  report.rowsets = (report.rowsets || []).map((rowset) => stableObject({
    ...rowset,
    diagnostics: (rowset.diagnostics || []).slice().sort((a, b) => String(a.code).localeCompare(String(b.code)) || String(a.message).localeCompare(String(b.message)))
  })).sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")) || String(a.schema || "").localeCompare(String(b.schema || "")));
  report.outputs.observed = (report.outputs.observed || []).map(stableObject);
  report.outputs.expected = (report.outputs.expected || []).map(stableObject);
  report.commands.observed = (report.commands.observed || []).map(stableObject);
  report.commands.expected = (report.commands.expected || []).map(stableObject);
  report.replayChecksum = `sha256:${crypto.createHash("sha256").update(stableStringify({
    package: report.package,
    profile: report.profile,
    trace: report.trace,
    rowsets: report.rowsets,
    outputs: report.outputs,
    commands: report.commands
  })).digest("hex")}`;
  return finalizeReport(report);
}

function unsupportedFeaturesFromPackageCheck(packageCheck) {
  return Array.from(new Set([
    ...((packageCheck.capabilities && packageCheck.capabilities.unsupported) || []),
    ...((packageCheck.hostImports && packageCheck.hostImports.unsupported) || []),
    ...((packageCheck.assetKinds && packageCheck.assetKinds.unsupported) || [])
  ])).sort();
}

function addMismatch(report, mismatch) {
  report.mismatches.push(stableObject(mismatch));
}

function finalizeReport(report) {
  report.mismatches = report.mismatches.slice().sort((a, b) =>
    String(a.step || "").localeCompare(String(b.step || "")) ||
    String(a.kind || "").localeCompare(String(b.kind || "")) ||
    String(a.message || "").localeCompare(String(b.message || "")));
  report.diagnostics = (report.diagnostics || []).slice().sort((a, b) =>
    String(a.code || "").localeCompare(String(b.code || "")) ||
    String(a.file || "").localeCompare(String(b.file || "")) ||
    String(a.message || "").localeCompare(String(b.message || "")));
  report.steps = (report.steps || []).slice().sort((a, b) => String(a.id || "").localeCompare(String(b.id || "")));
  report.status = report.mismatches.length ? "fail" : "pass";
  return stableObject(report);
}

function traceFingerprint(trace) {
  return `sha256:${crypto.createHash("sha256").update(stableStringify(trace)).digest("hex")}`;
}

function looksAbsolutePath(value) {
  return typeof value === "string" && (/^\/[^/]/.test(value) || /^[A-Za-z]:[\\/]/.test(value));
}

function sanitizeValue(value, base) {
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, base));
  if (!value || typeof value !== "object") return typeof value === "string" ? sanitizeString(value, base) : value;
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = sanitizeValue(value[key], base);
  return out;
}

function sanitizeString(value, base) {
  const normalizedBase = normalizeSlash(path.resolve(base));
  return normalizeSlash(String(value)).split(normalizedBase).join("<package>");
}

function normalizeSlash(value) {
  return String(value || "").replace(/\\/g, "/");
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

module.exports = {
  CONFORMANCE_SCHEMA_VERSION,
  BATCH_CONFORMANCE_SCHEMA_VERSION,
  createConformanceReplayReport,
  stableStringify
};
