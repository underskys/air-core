const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { parseAir } = require("./parser");
const { SymbolRegistry, symbolKey } = require("./link_symbols");
const { normalizePackageMetadata, PACKAGE_MANIFEST_FILE, validatePackageManifest } = require("./package_manifest");
const { createPackageGraphOwnership, packageGraphDiagnostics } = require("./package_graph_ownership");
const { checkPackageDir, reportPackageDir } = require("./sdk");
const { AIR_ABI_VERSION } = require("./version");

const LINK_PLAN_SCHEMA_VERSION = "0.16";

function createPackageLinkPlan(packageDir, options = {}) {
  const base = path.resolve(packageDir);
  const manifest = validatePackageManifest(base, { built: false });
  const metadata = normalizePackageMetadata(manifest);
  const packageReport = reportPackageDir(base, {
    profile: options.profile,
    releaseCandidate: options.releaseCandidate
  });
  const checkReport = checkPackageDir(base, {
    profile: options.profile,
    built: false,
    releaseCandidate: options.releaseCandidate
  });
  const modules = (packageReport.modules || []).slice().sort((a, b) => a.path.localeCompare(b.path));
  const symbols = buildSymbols(modules, packageReport);
  const symbolIndex = new Map(symbols.map((symbol) => [symbolKey(symbol.module, symbol.kind, symbol.sourceName), symbol]));
  const explicitPackageExports = packageExports(metadata);
  const implicitExportDiagnostic = implicitPackageExportDiagnostic(modules, metadata);
  const graphDiagnostics = packageGraphDiagnostics(packageReport, checkReport, {
    packageExports: explicitPackageExports
  });
  const extraDiagnostics = (implicitExportDiagnostic ? [implicitExportDiagnostic] : []).concat(graphDiagnostics);
  const diagnostics = diagnosticsSummary(packageReport, checkReport, extraDiagnostics, base);
  const sourceGraphHash = objectFingerprint(sourceGraphForHash(packageReport));
  const ownership = createPackageGraphOwnership(packageReport, {
    symbols,
    packageExports: explicitPackageExports,
    diagnostics: graphDiagnostics,
    sourceGraphHash,
    linkedWasm: false
  });
  const plan = stableObject({
    schemaVersion: LINK_PLAN_SCHEMA_VERSION,
    kind: "air.linkPlan",
    package: packageIdentity(base, manifest, metadata),
    entrypoint: {
      module: metadata.entry || null,
      packageExports: explicitPackageExports,
      compatibilityExports: compatibilityExports(modules, metadata)
    },
    moduleOrder: (packageReport.graph && packageReport.graph.order ? packageReport.graph.order : []).slice(),
    sourceGraphHash,
    graph: {
      edges: (packageReport.graph && packageReport.graph.edges ? packageReport.graph.edges : []).slice().sort(compareGraphEdge)
    },
    authoredGraph: ownership.authoredGraph,
    executableGraph: ownership.executableGraph,
    authoredToExecutable: ownership.authoredToExecutable,
    ownershipMap: ownership.ownershipMap,
    linkDiagnostics: ownership.linkDiagnostics,
    generatedExecutableFreshness: ownership.generatedExecutableFreshness,
    symbols,
    crossModuleCalls: collectCrossModuleCalls(base, modules, packageReport, symbolIndex),
    hostImports: hostImportSummary(packageReport, checkReport),
    capabilities: capabilitySummary(packageReport, checkReport),
    generatedArtifacts: generatedSummary(packageReport),
    staticTables: staticTableSummary(modules, symbolIndex),
    abiImpact: abiImpact(metadata),
    linkedWasm: false,
    diagnostics,
    status: linkPlanStatus(packageReport, checkReport, diagnostics)
  });
  assertNoAbsolutePaths(plan);
  return plan;
}

function packageIdentity(base, manifest, metadata) {
  return {
    name: metadata.name,
    version: metadata.version,
    manifestPath: PACKAGE_MANIFEST_FILE,
    manifestFingerprint: fileFingerprint(path.join(base, PACKAGE_MANIFEST_FILE))
  };
}

function packageExports(metadata) {
  const raw = metadata.raw || {};
  const values = Array.isArray(metadata.packageExports) && metadata.packageExports.length
    ? metadata.packageExports
    : Array.isArray(raw.packageExports) ? raw.packageExports : [];
  if (values.length) {
    return values.map((item) => ({
      name: item && item.name || null,
      module: item && item.module || null,
      function: item && item.function || null
    })).sort(comparePackageExport);
  }
  if (Array.isArray(metadata.exports) && metadata.exports.length) {
    return metadata.exports.map((item) => ({
      name: item && item.name || null,
      module: item && item.module || metadata.entry || null,
      function: item && (item.function || item.name) || null
    })).sort(comparePackageExport);
  }
  return [];
}

function implicitPackageExportDiagnostic(modules, metadata) {
  if (modules.length <= 1) return null;
  if (packageExports(metadata).length) return null;
  const entry = modules.find((mod) => mod.path === metadata.entry);
  const exports = entry ? (entry.exports || []).slice().sort() : [];
  if (!exports.length) return null;
  return {
    code: "air.package.implicit_package_exports",
    severity: "warn",
    message: "multi-module linked package is using compatibility package exports because manifest packageExports is missing",
    file: "air.package.json",
    module: metadata.entry || null,
    fields: {
      exports,
      entryModule: metadata.entry || null,
      reason: "manifest packageExports is missing; entry module exports are used as compatibility package exports"
    }
  };
}

function compatibilityExports(modules, metadata) {
  const entry = modules.find((mod) => mod.path === metadata.entry);
  if (!entry) return [];
  return (entry.exports || []).map((name) => ({
    name,
    module: entry.path,
    function: name,
    warning: modules.length > 1 ? "manifest packageExports are not declared; this is compatibility fallback only" : null
  })).sort(comparePackageExport);
}

function buildSymbols(modules, packageReport) {
  const registry = new SymbolRegistry();
  for (const mod of modules) {
    for (const fn of mod.functions || []) {
      registry.add({
        kind: "function",
        modulePath: mod.path,
        moduleName: mod.name,
        sourceName: fn.name,
        visibility: fn.exported ? "module-export" : "module-private",
        signature: {
          params: (fn.params || []).map((param) => ({ name: param.name, type: param.type })),
          returnType: fn.returnType || "void"
        }
      });
    }
    for (const global of mod.globals || []) {
      registry.add({
        kind: "global",
        modulePath: mod.path,
        moduleName: mod.name,
        sourceName: global.name,
        visibility: "module-private",
        type: global.type
      });
    }
    for (const table of mod.staticTables || []) {
      registry.add({
        kind: "table",
        modulePath: mod.path,
        moduleName: mod.name,
        sourceName: table.name,
        visibility: "module-private",
        elementType: table.elementType || table.type,
        length: table.length,
        approximateStorageBytes: table.approximateStorageBytes || table.staticBytes || null
      });
    }
  }
  for (const file of generatedFiles(packageReport)) {
    registry.add({
      kind: "generatedModule",
      modulePath: file.path,
      sourceName: path.basename(file.path, ".air"),
      visibility: "generated-artifact",
      status: file.status,
      fingerprint: prefixFingerprint(file.fingerprint)
    });
  }
  return registry.list();
}

function collectCrossModuleCalls(base, modules, packageReport, symbolIndex) {
  const importByModule = new Map();
  for (const item of packageReport.importClassifications || []) {
    if (item.class !== "package-local" || item.status !== "accepted" || !item.alias || !item.resolved) continue;
    if (!importByModule.has(item.module)) importByModule.set(item.module, new Map());
    importByModule.get(item.module).set(item.alias, item.resolved);
  }
  const out = [];
  for (const modInfo of modules) {
    const aliases = importByModule.get(modInfo.path);
    if (!aliases || !aliases.size) continue;
    const mod = parseAir(fs.readFileSync(path.join(base, modInfo.path), "utf8"), modInfo.path, { resolveSourceImports: false });
    for (const fn of mod.functions || []) {
      for (const block of fn.blocks || []) {
        for (const ins of block.instructions || []) {
          if (ins.op !== "call") continue;
          const parsed = splitQualifiedName(ins.callee);
          if (!parsed) continue;
          const targetModule = aliases.get(parsed.moduleName);
          if (!targetModule) continue;
          const targetSymbol = symbolIndex.get(symbolKey(targetModule, "function", parsed.functionName));
          out.push({
            fromModule: modInfo.path,
            fromFunction: fn.name,
            toModule: targetModule,
            toFunction: parsed.functionName,
            callee: ins.callee,
            targetSymbol: targetSymbol ? targetSymbol.mangledName : null,
            line: ins.loc && Number.isInteger(ins.loc.line) ? ins.loc.line : 0
          });
        }
      }
    }
  }
  return out.sort((a, b) =>
    a.fromModule.localeCompare(b.fromModule) ||
    a.fromFunction.localeCompare(b.fromFunction) ||
    a.toModule.localeCompare(b.toModule) ||
    a.toFunction.localeCompare(b.toFunction) ||
    a.line - b.line);
}

function hostImportSummary(packageReport, checkReport) {
  const used = checkReport.hostImports && checkReport.hostImports.used
    ? checkReport.hostImports.used
    : packageReport.hostImports && packageReport.hostImports.used || [];
  return {
    used: used.slice().sort(),
    unsupported: (checkReport.hostImports && checkReport.hostImports.unsupported || []).slice().sort(),
    origins: stableObject(packageReport.hostImportOrigins || checkReport.hostImportOrigins || {})
  };
}

function capabilitySummary(packageReport, checkReport) {
  return {
    declared: (checkReport.declaredCapabilities || packageReport.declaredCapabilities || []).slice().sort(),
    computed: (checkReport.computedCapabilities || packageReport.computedCapabilities || []).slice().sort(),
    required: (checkReport.capabilities && checkReport.capabilities.required || []).slice().sort(),
    origins: stableObject(packageReport.capabilityOrigins || checkReport.capabilityOrigins || {})
  };
}

function generatedSummary(packageReport) {
  return {
    generatedArtifacts: normalizeGeneratedReport(packageReport.generatedArtifacts),
    generatedHandles: normalizeGeneratedReport(packageReport.generatedHandles)
  };
}

function normalizeGeneratedReport(report) {
  if (!report) return null;
  return {
    ok: Boolean(report.ok),
    files: (report.files || []).map((file) => ({
      path: file.path,
      status: file.status,
      fingerprint: prefixFingerprint(file.fingerprint),
      expectedFingerprint: prefixFingerprint(file.expectedFingerprint),
      manifestFingerprint: file.manifestFingerprint || null,
      expectedManifestFingerprint: file.expectedManifestFingerprint || null,
      sources: (file.sources || []).map((source) => ({
        ref: source.ref,
        path: source.path,
        exists: Boolean(source.exists)
      })).sort(comparePathRef),
      generators: (file.generators || []).map((generator) => ({
        ref: generator.ref,
        path: generator.path,
        exists: Boolean(generator.exists)
      })).sort(comparePathRef)
    })).sort((a, b) => a.path.localeCompare(b.path)),
    warnings: (report.warnings || []).slice().sort(),
    errors: (report.errors || []).slice().sort()
  };
}

function staticTableSummary(modules, symbolIndex) {
  const out = [];
  for (const mod of modules) {
    for (const table of mod.staticTables || []) {
      const symbol = symbolIndex.get(symbolKey(mod.path, "table", table.name));
      out.push({
        module: mod.path,
        name: table.name,
        elementType: table.elementType || table.type,
        length: table.length,
        approximateStorageBytes: table.approximateStorageBytes || table.staticBytes || null,
        origin: table.origin || "manual",
        symbol: symbol ? symbol.mangledName : null
      });
    }
  }
  return out.sort((a, b) => a.module.localeCompare(b.module) || a.name.localeCompare(b.name));
}

function abiImpact(metadata) {
  return {
    airAbi: metadata.airAbi || AIR_ABI_VERSION,
    hostAbi: metadata.hostAbi || metadata.airAbi || AIR_ABI_VERSION,
    airAbiBumpRequired: false,
    hostAbiBumpRequired: false,
    rationale: "link-plan is metadata-only; no executable runtime package contract or Host ABI import changes are introduced"
  };
}

function diagnosticsSummary(packageReport, checkReport, extraDiagnostics = [], base = process.cwd()) {
  const diagnostics = (checkReport.diagnostics || []).concat(packageReport.diagnostics || [], extraDiagnostics);
  const extraWarnings = extraDiagnostics.filter((item) => item.severity === "warn").map((item) => sanitizeString(item.message, base));
  return {
    errors: uniqueStrings((checkReport.errors || []).concat(packageReport.errors || []).map((item) => sanitizeString(item, base))),
    warnings: uniqueStrings((checkReport.warnings || []).concat(packageReport.warnings || [], extraWarnings).map((item) => sanitizeString(item, base))),
    moduleDiagnostics: packageReport.moduleDiagnostics || [],
    diagnostics: diagnostics.map((diagnostic) => ({
      code: diagnostic.code || null,
      severity: diagnostic.severity || null,
      message: sanitizeString(diagnostic.message || null, base),
      file: sanitizeString(diagnostic.file || null, base),
      module: sanitizeString(diagnostic.module || null, base),
      fields: sanitizeValue(diagnostic.fields || {}, base)
    })).sort(compareDiagnostic)
  };
}

function linkPlanStatus(packageReport, checkReport, diagnostics = null) {
  if (packageReport.status === "fail" || checkReport.status === "fail") return "fail";
  if (diagnostics && ((diagnostics.errors || []).length || (diagnostics.diagnostics || []).some((item) => item.severity === "fail"))) return "fail";
  if (diagnostics && ((diagnostics.warnings || []).length || (diagnostics.diagnostics || []).some((item) => item.severity === "warn"))) return "warn";
  if (packageReport.status === "warn" || checkReport.status === "warn") return "warn";
  return "pass";
}

function sourceGraphForHash(packageReport) {
  return {
    entry: packageReport.entry,
    graph: packageReport.graph || { order: [], edges: [] },
    modules: (packageReport.modules || []).map((mod) => ({
      path: mod.path,
      name: mod.name,
      imports: mod.imports || [],
      exports: mod.exports || [],
      privateFunctions: mod.privateFunctions || [],
      globals: mod.globals || [],
      staticTables: mod.staticTables || [],
      functions: (mod.functions || []).map((fn) => ({
        name: fn.name,
        exported: fn.exported,
        params: fn.params || [],
        returnType: fn.returnType
      }))
    })).sort((a, b) => a.path.localeCompare(b.path))
  };
}

function generatedFiles(packageReport) {
  const out = [];
  for (const report of [packageReport.generatedArtifacts, packageReport.generatedHandles]) {
    for (const file of report && report.files || []) out.push(file);
  }
  const seen = new Map();
  for (const file of out) seen.set(file.path, file);
  return Array.from(seen.values()).sort((a, b) => a.path.localeCompare(b.path));
}

function splitQualifiedName(name) {
  const idx = String(name).indexOf(".");
  if (idx <= 0 || idx === String(name).length - 1) return null;
  return {
    moduleName: String(name).slice(0, idx),
    functionName: String(name).slice(idx + 1)
  };
}

function compareGraphEdge(a, b) {
  return String(a.from || "").localeCompare(String(b.from || "")) ||
    String(a.to || "").localeCompare(String(b.to || "")) ||
    String(a.import || "").localeCompare(String(b.import || ""));
}

function comparePackageExport(a, b) {
  return String(a.name || "").localeCompare(String(b.name || "")) ||
    String(a.module || "").localeCompare(String(b.module || "")) ||
    String(a.function || "").localeCompare(String(b.function || ""));
}

function comparePathRef(a, b) {
  return String(a.path || "").localeCompare(String(b.path || "")) ||
    String(a.ref || "").localeCompare(String(b.ref || ""));
}

function compareDiagnostic(a, b) {
  return String(a.code || "").localeCompare(String(b.code || "")) ||
    String(a.file || "").localeCompare(String(b.file || "")) ||
    String(a.message || "").localeCompare(String(b.message || ""));
}

function uniqueStrings(values) {
  return Array.from(new Set((values || []).filter(Boolean))).sort();
}

function fileFingerprint(file) {
  return prefixFingerprint(crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"));
}

function objectFingerprint(value) {
  return prefixFingerprint(crypto.createHash("sha256").update(stableStringify(value)).digest("hex"));
}

function prefixFingerprint(value) {
  if (!value) return null;
  return String(value).startsWith("sha256:") ? value : `sha256:${value}`;
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

function assertNoAbsolutePaths(value) {
  const offenders = [];
  visit(value, (item) => {
    if (typeof item === "string" && looksAbsolutePath(item)) offenders.push(item);
  });
  if (offenders.length) {
    throw new Error(`link plan contains absolute path: ${offenders.slice(0, 3).join(", ")}`);
  }
}

function sanitizeValue(value, base) {
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, base));
  if (!value || typeof value !== "object") return sanitizeString(value, base);
  const out = {};
  for (const [key, item] of Object.entries(value)) out[key] = sanitizeValue(item, base);
  return out;
}

function sanitizeString(value, base) {
  if (typeof value !== "string") return value;
  const normalizedBase = String(base || "").replace(/\\/g, "/");
  let out = value.replace(/\\/g, "/");
  if (normalizedBase) out = out.split(normalizedBase).join("<package>");
  out = out.replace(/[A-Za-z]:\/[^\s"]+/g, "<absolute-path>");
  return out;
}

function visit(value, fn) {
  fn(value);
  if (Array.isArray(value)) {
    for (const item of value) visit(item, fn);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) visit(item, fn);
  }
}

function looksAbsolutePath(value) {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value);
}

module.exports = {
  LINK_PLAN_SCHEMA_VERSION,
  createPackageLinkPlan,
  stableStringify
};
