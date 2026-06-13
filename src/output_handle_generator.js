const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { validatePackageManifest } = require("./package_manifest");
const { parseAir } = require("./parser");
const { validateOutputContractSchemaFile } = require("./output_contract_schema");
const { verifyModule } = require("./verifier");

const OUTPUT_HANDLES_AIR = "generated/output_handles.air";
const OUTPUT_HANDLES_META = "generated/output_handles.meta.json";
const OUTPUT_HANDLE_GENERATOR = "airc output-handles";
const OUTPUT_HANDLE_KIND = "air.generatedOutputHandles";
const OUTPUT_HANDLE_SCHEMA_VERSION = "0.27";

function generateOutputHandleSet(packageDir) {
  const base = path.resolve(packageDir);
  const packageManifest = validatePackageManifest(base, { built: false });
  const contracts = collectOutputContracts(base, packageManifest.outputContracts || []);
  const outputs = collectOutputs(contracts);
  const duplicateIds = duplicates(outputs.map((output) => output.id));
  if (duplicateIds.length) {
    throw new Error(`generated output handle id collision: ${duplicateIds.join(", ")}`);
  }
  const duplicateHandles = duplicates(outputs.map((output) => output.handle));
  if (duplicateHandles.length) {
    throw new Error(`generated output handle name collision: ${duplicateHandles.join(", ")}`);
  }

  const sourceContracts = contracts.map((contract) => ({
    path: contract.path,
    fingerprint: contract.fingerprint
  }));
  const airSource = renderOutputHandlesAir({ sourceContracts, outputs });
  const metadata = {
    schemaVersion: OUTPUT_HANDLE_SCHEMA_VERSION,
    kind: OUTPUT_HANDLE_KIND,
    generator: OUTPUT_HANDLE_GENERATOR,
    sourceContracts,
    generatedFiles: [{
      path: OUTPUT_HANDLES_AIR,
      fingerprint: sourceFingerprint(airSource)
    }],
    outputs
  };
  return {
    airPath: OUTPUT_HANDLES_AIR,
    metaPath: OUTPUT_HANDLES_META,
    airSource,
    metadata,
    metadataSource: `${stableStringify(metadata)}\n`,
    sourceContracts,
    outputs
  };
}

function writeGeneratedOutputHandles(packageDir) {
  const base = path.resolve(packageDir);
  const generated = generateOutputHandleSet(base);
  const airFile = path.join(base, generated.airPath);
  const metaFile = path.join(base, generated.metaPath);
  fs.mkdirSync(path.dirname(airFile), { recursive: true });
  fs.writeFileSync(airFile, generated.airSource);
  fs.writeFileSync(metaFile, generated.metadataSource);
  return [generated.airPath, generated.metaPath];
}

function checkGeneratedOutputHandles(packageDir, options = {}) {
  const base = path.resolve(packageDir);
  const referenced = isOutputHandleReferenced(options.generatedModules);
  if (!referenced && !options.force) {
    return {
      ok: true,
      referenced: false,
      sets: [],
      diagnostics: [],
      warnings: [],
      errors: []
    };
  }

  let expected;
  try {
    expected = generateOutputHandleSet(base);
  } catch (err) {
    const item = diagnostic("air.generated.output_metadata_invalid", "fail", err.message || String(err), {
      path: OUTPUT_HANDLES_META
    });
    return {
      ok: false,
      referenced: Boolean(referenced),
      sets: [emptySet("mismatch", [item])],
      diagnostics: [item],
      warnings: [],
      errors: [item.message]
    };
  }

  const diagnostics = [];
  const errors = [];
  const airFile = path.join(base, OUTPUT_HANDLES_AIR);
  const metaFile = path.join(base, OUTPUT_HANDLES_META);
  let actualAir = null;
  let actualMeta = null;
  let status = "fresh";

  if (!fs.existsSync(airFile)) {
    status = "missing";
    addDiagnostic(diagnostics, errors, "air.generated.output_handles_missing", `generated output handle file missing: ${OUTPUT_HANDLES_AIR}`, {
      path: OUTPUT_HANDLES_AIR
    });
  } else {
    actualAir = fs.readFileSync(airFile, "utf8");
    if (actualAir !== expected.airSource) {
      status = worseStatus(status, "stale");
      addDiagnostic(diagnostics, errors, "air.generated.output_handles_stale", `generated output handle file stale: ${OUTPUT_HANDLES_AIR}`, {
        path: OUTPUT_HANDLES_AIR,
        expectedFingerprint: sourceFingerprint(expected.airSource),
        actualFingerprint: sourceFingerprint(actualAir)
      });
    }
    for (const item of validateOutputHandleConstants(actualAir, expected.outputs)) {
      status = worseStatus(status, item.status);
      addDiagnostic(diagnostics, errors, item.code, item.message, item.fields);
    }
  }

  if (!fs.existsSync(metaFile)) {
    status = worseStatus(status, "missing");
    addDiagnostic(diagnostics, errors, "air.generated.output_metadata_invalid", `generated output handle metadata missing: ${OUTPUT_HANDLES_META}`, {
      path: OUTPUT_HANDLES_META
    });
  } else {
    try {
      actualMeta = JSON.parse(fs.readFileSync(metaFile, "utf8"));
      const metaDiagnostics = validateOutputHandleMetadata(actualMeta, expected, actualAir);
      for (const item of metaDiagnostics) {
        status = worseStatus(status, item.status);
        addDiagnostic(diagnostics, errors, item.code, item.message, item.fields);
      }
    } catch (err) {
      status = worseStatus(status, "mismatch");
      addDiagnostic(diagnostics, errors, "air.generated.output_metadata_invalid", `generated output handle metadata invalid: ${OUTPUT_HANDLES_META}: ${err.message || err}`, {
        path: OUTPUT_HANDLES_META
      });
    }
  }

  const generatedFingerprint = actualAir ? sourceFingerprint(actualAir) : null;
  const set = {
    path: OUTPUT_HANDLES_AIR,
    metadataPath: OUTPUT_HANDLES_META,
    status,
    sourceFingerprint: sourceSetFingerprint(expected.sourceContracts),
    generatedFingerprint,
    expectedGeneratedFingerprint: sourceFingerprint(expected.airSource),
    sourceContracts: expected.sourceContracts,
    outputs: actualMeta && Array.isArray(actualMeta.outputs) ? normalizeOutputs(actualMeta.outputs) : expected.outputs,
    diagnostics
  };
  return {
    ok: errors.length === 0,
    referenced: Boolean(referenced),
    sets: [set],
    diagnostics,
    warnings: [],
    errors
  };
}

function verifyGeneratedOutputHandles(packageDir) {
  const generated = generateOutputHandleSet(packageDir);
  const mod = parseAir(generated.airSource, path.join(path.resolve(packageDir), generated.airPath));
  verifyModule(mod, { library: true });
  return true;
}

function isOutputHandleReferenced(generatedModules = []) {
  return (generatedModules || []).some((item) => {
    const rel = typeof item === "string" ? item : item && item.path;
    return normalizeSlash(rel) === OUTPUT_HANDLES_AIR;
  });
}

function collectOutputContracts(base, refs) {
  return (refs || [])
    .map((ref) => ref && ref.path ? ref.path : null)
    .filter(Boolean)
    .sort()
    .map((rel) => {
      const report = validateOutputContractSchemaFile(path.join(base, rel), { relativePath: rel });
      if (!report.ok) {
        throw new Error(`output contract invalid; cannot generate output handles: ${rel}`);
      }
      return {
        path: normalizeSlash(rel),
        fingerprint: report.fingerprint,
        outputs: report.outputs || []
      };
    });
}

function collectOutputs(contracts) {
  return contracts
    .flatMap((contract) => (contract.outputs || []).map((output) => ({
      id: output.id,
      name: output.name,
      handle: outputHandleName(output.name),
      channel: output.channel || null,
      capability: output.capability || null,
      argCount: output.argCount,
      argTypes: (output.args || []).map((arg) => arg.type),
      sourceContract: contract.path
    })))
    .sort((a, b) => a.id - b.id || a.name.localeCompare(b.name));
}

function renderOutputHandlesAir({ sourceContracts, outputs }) {
  const lines = [
    "# Generated file. Do not edit manually.",
    "# Generator: repo:bin/airc.js",
    ...sourceContracts.map((source) => `# Source: ${source.path}`),
    `# Output contract fingerprint: ${sourceSetFingerprint(sourceContracts)}`,
    "module output_handles",
    "capabilities { }",
    ""
  ];
  for (const output of outputs) {
    lines.push(`const ${output.handle}:i32 = ${output.id}`);
    lines.push(`const ${output.handle}_ID:i32 = ${output.id}`);
    lines.push(`const ${output.handle}_ARG_COUNT:i32 = ${output.argCount}`);
    lines.push("");
  }
  return lines.join("\n");
}

function validateOutputHandleMetadata(actual, expected, actualAir) {
  const diagnostics = [];
  if (!actual || typeof actual !== "object" || Array.isArray(actual)) {
    diagnostics.push(metadataInvalid("metadata must be a JSON object"));
    return diagnostics;
  }
  if (actual.schemaVersion !== OUTPUT_HANDLE_SCHEMA_VERSION) {
    diagnostics.push(metadataInvalid(`metadata schemaVersion must be ${OUTPUT_HANDLE_SCHEMA_VERSION}`));
  }
  if (actual.kind !== OUTPUT_HANDLE_KIND) {
    diagnostics.push(metadataInvalid(`metadata kind must be ${OUTPUT_HANDLE_KIND}`));
  }
  if (actual.generator !== OUTPUT_HANDLE_GENERATOR) {
    diagnostics.push(metadataInvalid(`metadata generator must be ${OUTPUT_HANDLE_GENERATOR}`));
  }
  const actualSources = normalizeSourceContracts(actual.sourceContracts);
  if (!deepEqual(actualSources, expected.sourceContracts)) {
    diagnostics.push({
      status: "stale",
      code: "air.generated.output_handles_stale",
      message: `generated output handle source fingerprints stale: ${OUTPUT_HANDLES_META}`,
      fields: {
        path: OUTPUT_HANDLES_META,
        expectedSourceFingerprint: sourceSetFingerprint(expected.sourceContracts),
        actualSourceFingerprint: sourceSetFingerprint(actualSources)
      }
    });
  }
  const actualOutputs = normalizeOutputs(actual.outputs);
  if (!deepEqual(actualOutputs, expected.outputs)) {
    diagnostics.push({
      status: "mismatch",
      code: "air.generated.output_handles_mismatch",
      message: `generated output handle metadata outputs mismatch: ${OUTPUT_HANDLES_META}`,
      fields: { path: OUTPUT_HANDLES_META }
    });
  }
  const actualGeneratedFiles = normalizeGeneratedFiles(actual.generatedFiles);
  const expectedGeneratedFiles = expected.metadata.generatedFiles;
  if (!deepEqual(actualGeneratedFiles, expectedGeneratedFiles)) {
    diagnostics.push({
      status: "mismatch",
      code: "air.generated.output_handles_mismatch",
      message: `generated output handle metadata generatedFiles mismatch: ${OUTPUT_HANDLES_META}`,
      fields: { path: OUTPUT_HANDLES_META }
    });
  }
  if (actualAir) {
    const actualAirFingerprint = sourceFingerprint(actualAir);
    const declaredAir = actualGeneratedFiles.find((file) => file.path === OUTPUT_HANDLES_AIR);
    if (!declaredAir || declaredAir.fingerprint !== actualAirFingerprint) {
      diagnostics.push({
        status: "mismatch",
        code: "air.generated.output_handles_mismatch",
        message: `generated output handle metadata does not match generated file: ${OUTPUT_HANDLES_AIR}`,
        fields: {
          path: OUTPUT_HANDLES_META,
          generatedPath: OUTPUT_HANDLES_AIR,
          actualFingerprint: actualAirFingerprint,
          declaredFingerprint: declaredAir ? declaredAir.fingerprint : null
        }
      });
    }
  }
  return diagnostics;
}

function validateOutputHandleConstants(source, outputs) {
  const diagnostics = [];
  const constants = parseOutputHandleConstants(source);
  const expectedByHandle = new Map(outputs.map((output) => [output.handle, output]));
  for (const output of outputs) {
    const handleValue = constants.get(output.handle);
    const idValue = constants.get(`${output.handle}_ID`);
    const argCountValue = constants.get(`${output.handle}_ARG_COUNT`);
    if (handleValue !== output.id || idValue !== output.id || argCountValue !== output.argCount) {
      diagnostics.push({
        status: "mismatch",
        code: "air.output_handle.missing_output",
        message: `generated output handle missing or stale for output ${output.name}: ${output.handle}`,
        fields: {
          path: OUTPUT_HANDLES_AIR,
          outputId: output.id,
          outputName: output.name,
          handle: output.handle
        }
      });
    }
  }
  for (const [name, value] of constants.entries()) {
    if (!name.startsWith("OUTPUT_")) continue;
    if (name.endsWith("_ID") || name.endsWith("_ARG_COUNT") || name.endsWith("_CAPABILITY_ID")) continue;
    const expected = expectedByHandle.get(name);
    if (!expected || expected.id !== value) {
      diagnostics.push({
        status: "mismatch",
        code: "air.output_handle.unknown_output",
        message: `generated output handle references unknown output: ${name}`,
        fields: {
          path: OUTPUT_HANDLES_AIR,
          outputId: value,
          handle: name
        }
      });
    }
  }
  return diagnostics;
}

function parseOutputHandleConstants(source) {
  const out = new Map();
  const re = /^const\s+(OUTPUT_[A-Z0-9_]+)\s*:\s*i32\s*=\s*(-?\d+)\s*$/gm;
  let match;
  while ((match = re.exec(source))) {
    out.set(match[1], Number(match[2]));
  }
  return out;
}

function metadataInvalid(message) {
  return {
    status: "mismatch",
    code: "air.generated.output_metadata_invalid",
    message: `generated output handle metadata invalid: ${OUTPUT_HANDLES_META}: ${message}`,
    fields: { path: OUTPUT_HANDLES_META }
  };
}

function emptySet(status, diagnostics) {
  return {
    path: OUTPUT_HANDLES_AIR,
    metadataPath: OUTPUT_HANDLES_META,
    status,
    sourceFingerprint: null,
    generatedFingerprint: null,
    expectedGeneratedFingerprint: null,
    sourceContracts: [],
    outputs: [],
    diagnostics
  };
}

function addDiagnostic(diagnostics, errors, code, message, fields = {}) {
  const item = diagnostic(code, "fail", message, fields);
  diagnostics.push(item);
  errors.push(message);
}

function diagnostic(code, severity, message, fields = {}) {
  return {
    code,
    severity,
    source: "package-check",
    message,
    fields
  };
}

function worseStatus(current, next) {
  const order = { fresh: 0, stale: 1, mismatch: 2, missing: 3 };
  return (order[next] || 0) > (order[current] || 0) ? next : current;
}

function normalizeSourceContracts(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => ({
    path: normalizeSlash(item && item.path),
    fingerprint: String(item && item.fingerprint || "")
  })).sort((a, b) => a.path.localeCompare(b.path));
}

function normalizeOutputs(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => ({
    id: Number(item && item.id),
    name: String(item && item.name || ""),
    handle: String(item && item.handle || ""),
    channel: item && item.channel === null ? null : String(item && item.channel || ""),
    capability: item && item.capability === null ? null : String(item && item.capability || ""),
    argCount: Number(item && item.argCount),
    argTypes: Array.isArray(item && item.argTypes) ? item.argTypes.map((arg) => String(arg)) : [],
    sourceContract: String(item && item.sourceContract || "")
  })).sort((a, b) => a.id - b.id || a.name.localeCompare(b.name));
}

function normalizeGeneratedFiles(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => ({
    path: normalizeSlash(item && item.path),
    fingerprint: String(item && item.fingerprint || "")
  })).sort((a, b) => a.path.localeCompare(b.path));
}

function outputHandleName(name) {
  const suffix = String(name || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase() || "UNNAMED";
  return `OUTPUT_${/^[0-9]/.test(suffix) ? `ID_${suffix}` : suffix}`;
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

function sourceSetFingerprint(sourceContracts) {
  return sourceFingerprint(stableStringify(sourceContracts || []));
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

function normalizeSlash(value) {
  return String(value || "").replace(/\\/g, "/");
}

module.exports = {
  OUTPUT_HANDLES_AIR,
  OUTPUT_HANDLES_META,
  checkGeneratedOutputHandles,
  generateOutputHandleSet,
  verifyGeneratedOutputHandles,
  writeGeneratedOutputHandles
};
