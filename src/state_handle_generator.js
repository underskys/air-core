const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { analyzePackageModuleGraph } = require("./module_graph");
const { validatePackageManifest, normalizePackageMetadata } = require("./package_manifest");
const { parseAir } = require("./parser");
const { verifyModule } = require("./verifier");

const STATE_HANDLES_AIR = "generated/state_handles.air";
const STATE_HANDLES_META = "generated/state_handles.meta.json";
const STATE_HANDLE_GENERATOR = "airc state-handles";
const STATE_HANDLE_KIND = "air.generatedStateHandles";
const STATE_HANDLE_SCHEMA_VERSION = "0.24";

function generateStateHandleSet(packageDir) {
  const base = path.resolve(packageDir);
  const packageManifest = validatePackageManifest(base, { built: false });
  const metadata = normalizePackageMetadata(packageManifest);
  const graph = analyzePackageModuleGraph(base, metadata.entry);
  const stateEntries = collectStateEntries(graph);
  const nameCounts = new Map();
  for (const entry of stateEntries) nameCounts.set(entry.name, (nameCounts.get(entry.name) || 0) + 1);
  const duplicateNames = Array.from(nameCounts.entries()).filter(([, count]) => count > 1).map(([name]) => name).sort();
  if (duplicateNames.length) {
    throw new Error(`generated state handle name collision: ${duplicateNames.map((name) => `STATE_${stateConstantName(name)}_*`).join(", ")}`);
  }

  const sourceModules = sourceModulesForStates(base, stateEntries);
  const states = stateEntries.map((entry, index) => ({
    name: entry.name,
    id: index + 1,
    cellType: entry.cellType,
    length: entry.length,
    byteSize: entry.byteSize
  }));
  const airSource = renderStateHandlesAir({ sourceModules, states });
  const meta = {
    schemaVersion: STATE_HANDLE_SCHEMA_VERSION,
    kind: STATE_HANDLE_KIND,
    generator: STATE_HANDLE_GENERATOR,
    sourceModules,
    states,
    generatedFiles: [{
      path: STATE_HANDLES_AIR,
      fingerprint: sourceFingerprint(airSource)
    }]
  };
  return {
    airPath: STATE_HANDLES_AIR,
    metaPath: STATE_HANDLES_META,
    airSource,
    metadata: meta,
    metadataSource: `${stableStringify(meta)}\n`,
    sourceModules,
    states
  };
}

function writeGeneratedStateHandles(packageDir) {
  const base = path.resolve(packageDir);
  const generated = generateStateHandleSet(base);
  const airFile = path.join(base, generated.airPath);
  const metaFile = path.join(base, generated.metaPath);
  fs.mkdirSync(path.dirname(airFile), { recursive: true });
  fs.writeFileSync(airFile, generated.airSource);
  fs.writeFileSync(metaFile, generated.metadataSource);
  return [generated.airPath, generated.metaPath];
}

function checkGeneratedStateHandles(packageDir, options = {}) {
  const base = path.resolve(packageDir);
  const referenced = isStateHandleReferenced(options.generatedModules);
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
    expected = generateStateHandleSet(base);
  } catch (err) {
    const diagnostic = diagnostic("air.generated.state_metadata_invalid", "fail", err.message || String(err), {
      path: STATE_HANDLES_META
    });
    return {
      ok: false,
      referenced: Boolean(referenced),
      sets: [emptySet("mismatch", [diagnostic])],
      diagnostics: [diagnostic],
      warnings: [],
      errors: [diagnostic.message]
    };
  }

  const diagnostics = [];
  const errors = [];
  const airFile = path.join(base, STATE_HANDLES_AIR);
  const metaFile = path.join(base, STATE_HANDLES_META);
  let actualAir = null;
  let actualMeta = null;
  let status = "fresh";

  if (!fs.existsSync(airFile)) {
    status = "missing";
    addDiagnostic(diagnostics, errors, "air.generated.state_handles_missing", `generated state handle file missing: ${STATE_HANDLES_AIR}`, {
      path: STATE_HANDLES_AIR
    });
  } else {
    actualAir = fs.readFileSync(airFile, "utf8");
    if (actualAir !== expected.airSource) {
      status = worseStatus(status, "stale");
      addDiagnostic(diagnostics, errors, "air.generated.state_handles_stale", `generated state handle file stale: ${STATE_HANDLES_AIR}`, {
        path: STATE_HANDLES_AIR,
        expectedFingerprint: sourceFingerprint(expected.airSource),
        actualFingerprint: sourceFingerprint(actualAir)
      });
    }
  }

  if (!fs.existsSync(metaFile)) {
    status = worseStatus(status, "missing");
    addDiagnostic(diagnostics, errors, "air.generated.state_metadata_invalid", `generated state handle metadata missing: ${STATE_HANDLES_META}`, {
      path: STATE_HANDLES_META
    });
  } else {
    try {
      actualMeta = JSON.parse(fs.readFileSync(metaFile, "utf8"));
      const metaDiagnostics = validateStateHandleMetadata(actualMeta, expected, actualAir);
      for (const item of metaDiagnostics) {
        status = worseStatus(status, item.status);
        addDiagnostic(diagnostics, errors, item.code, item.message, item.fields);
      }
    } catch (err) {
      status = worseStatus(status, "mismatch");
      addDiagnostic(diagnostics, errors, "air.generated.state_metadata_invalid", `generated state handle metadata invalid: ${STATE_HANDLES_META}: ${err.message || err}`, {
        path: STATE_HANDLES_META
      });
    }
  }

  const generatedFingerprint = actualAir ? sourceFingerprint(actualAir) : null;
  const set = {
    path: STATE_HANDLES_AIR,
    metadataPath: STATE_HANDLES_META,
    status,
    sourceFingerprint: sourceSetFingerprint(expected.sourceModules),
    generatedFingerprint,
    expectedGeneratedFingerprint: sourceFingerprint(expected.airSource),
    sourceModules: expected.sourceModules,
    states: actualMeta && Array.isArray(actualMeta.states) ? normalizeStates(actualMeta.states) : expected.states,
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

function verifyGeneratedStateHandles(packageDir) {
  const generated = generateStateHandleSet(packageDir);
  const mod = parseAir(generated.airSource, path.join(path.resolve(packageDir), generated.airPath));
  verifyModule(mod, { library: true });
  return true;
}

function isStateHandleReferenced(generatedModules = []) {
  return (generatedModules || []).some((item) => {
    const rel = typeof item === "string" ? item : item && item.path;
    return normalizeSlash(rel) === STATE_HANDLES_AIR;
  });
}

function collectStateEntries(graph) {
  return (graph.modules || [])
    .flatMap((mod) => (mod.stateSegments || []).map((state) => ({
      module: mod.path,
      name: state.name,
      cellType: state.cellType,
      length: state.length,
      byteSize: state.byteSize || state.staticBytes || 0
    })))
    .sort((a, b) => a.module.localeCompare(b.module) || a.name.localeCompare(b.name));
}

function sourceModulesForStates(base, entries) {
  const paths = Array.from(new Set(entries.map((entry) => entry.module))).sort();
  return paths.map((rel) => {
    const source = fs.readFileSync(path.join(base, rel), "utf8");
    return {
      path: normalizeSlash(rel),
      fingerprint: sourceFingerprint(source)
    };
  });
}

function renderStateHandlesAir({ sourceModules, states }) {
  const lines = [
    "# Generated file. Do not edit manually.",
    "# Generator: repo:bin/airc.js",
    ...sourceModules.map((source) => `# Source: ${source.path}`),
    `# State fingerprint: ${sourceSetFingerprint(sourceModules)}`,
    "module state_handles",
    "capabilities { }",
    ""
  ];
  for (const state of states) {
    const name = stateConstantName(state.name);
    lines.push(`const STATE_${name}_ID:i32 = ${state.id}`);
    lines.push(`const STATE_${name}_LEN:i32 = ${state.length}`);
    lines.push(`const STATE_${name}_BYTES:i32 = ${state.byteSize}`);
    lines.push(`const STATE_${name}_CELL_I32:i32 = ${state.cellType === "i32" ? 1 : 0}`);
    lines.push("");
  }
  return lines.join("\n");
}

function validateStateHandleMetadata(actual, expected, actualAir) {
  const diagnostics = [];
  if (!actual || typeof actual !== "object" || Array.isArray(actual)) {
    diagnostics.push(metadataInvalid("metadata must be a JSON object"));
    return diagnostics;
  }
  if (actual.schemaVersion !== STATE_HANDLE_SCHEMA_VERSION) {
    diagnostics.push(metadataInvalid(`metadata schemaVersion must be ${STATE_HANDLE_SCHEMA_VERSION}`));
  }
  if (actual.kind !== STATE_HANDLE_KIND) {
    diagnostics.push(metadataInvalid(`metadata kind must be ${STATE_HANDLE_KIND}`));
  }
  if (actual.generator !== STATE_HANDLE_GENERATOR) {
    diagnostics.push(metadataInvalid(`metadata generator must be ${STATE_HANDLE_GENERATOR}`));
  }
  const actualSources = normalizeSourceModules(actual.sourceModules);
  if (!deepEqual(actualSources, expected.sourceModules)) {
    diagnostics.push({
      status: "stale",
      code: "air.generated.state_handles_stale",
      message: `generated state handle source fingerprints stale: ${STATE_HANDLES_META}`,
      fields: {
        path: STATE_HANDLES_META,
        expectedSourceFingerprint: sourceSetFingerprint(expected.sourceModules),
        actualSourceFingerprint: sourceSetFingerprint(actualSources)
      }
    });
  }
  const actualStates = normalizeStates(actual.states);
  if (!deepEqual(actualStates, expected.states)) {
    diagnostics.push({
      status: "mismatch",
      code: "air.generated.state_handles_mismatch",
      message: `generated state handle metadata states mismatch: ${STATE_HANDLES_META}`,
      fields: { path: STATE_HANDLES_META }
    });
  }
  const actualGeneratedFiles = normalizeGeneratedFiles(actual.generatedFiles);
  const expectedGeneratedFiles = expected.metadata.generatedFiles;
  if (!deepEqual(actualGeneratedFiles, expectedGeneratedFiles)) {
    diagnostics.push({
      status: "mismatch",
      code: "air.generated.state_handles_mismatch",
      message: `generated state handle metadata generatedFiles mismatch: ${STATE_HANDLES_META}`,
      fields: { path: STATE_HANDLES_META }
    });
  }
  if (actualAir) {
    const actualAirFingerprint = sourceFingerprint(actualAir);
    const declaredAir = actualGeneratedFiles.find((file) => file.path === STATE_HANDLES_AIR);
    if (!declaredAir || declaredAir.fingerprint !== actualAirFingerprint) {
      diagnostics.push({
        status: "mismatch",
        code: "air.generated.state_handles_mismatch",
        message: `generated state handle metadata does not match generated file: ${STATE_HANDLES_AIR}`,
        fields: {
          path: STATE_HANDLES_META,
          generatedPath: STATE_HANDLES_AIR,
          actualFingerprint: actualAirFingerprint,
          declaredFingerprint: declaredAir ? declaredAir.fingerprint : null
        }
      });
    }
  }
  return diagnostics;
}

function metadataInvalid(message) {
  return {
    status: "mismatch",
    code: "air.generated.state_metadata_invalid",
    message: `generated state handle metadata invalid: ${STATE_HANDLES_META}: ${message}`,
    fields: { path: STATE_HANDLES_META }
  };
}

function emptySet(status, diagnostics) {
  return {
    path: STATE_HANDLES_AIR,
    metadataPath: STATE_HANDLES_META,
    status,
    sourceFingerprint: null,
    generatedFingerprint: null,
    expectedGeneratedFingerprint: null,
    sourceModules: [],
    states: [],
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

function normalizeSourceModules(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => ({
    path: normalizeSlash(item && item.path),
    fingerprint: String(item && item.fingerprint || "")
  })).sort((a, b) => a.path.localeCompare(b.path));
}

function normalizeStates(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => ({
    name: String(item && item.name || ""),
    id: Number(item && item.id),
    cellType: String(item && item.cellType || ""),
    length: Number(item && item.length),
    byteSize: Number(item && item.byteSize)
  })).sort((a, b) => a.id - b.id || a.name.localeCompare(b.name));
}

function normalizeGeneratedFiles(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => ({
    path: normalizeSlash(item && item.path),
    fingerprint: String(item && item.fingerprint || "")
  })).sort((a, b) => a.path.localeCompare(b.path));
}

function stateConstantName(name) {
  return String(name || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase() || "UNNAMED";
}

function sourceSetFingerprint(sourceModules) {
  return sourceFingerprint(stableStringify(sourceModules || []));
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
  STATE_HANDLES_AIR,
  STATE_HANDLES_META,
  checkGeneratedStateHandles,
  generateStateHandleSet,
  verifyGeneratedStateHandles,
  writeGeneratedStateHandles
};
