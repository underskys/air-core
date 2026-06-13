const crypto = require("crypto");
const { normalizeDiagnostic, sortDiagnostics } = require("./diagnostics");
const { moduleIdForPath } = require("./link_symbols");

const PACKAGE_GRAPH_DIAGNOSTICS = Object.freeze({
  UNRESOLVED_MODULE: "air.package_graph.unresolved_module_import",
  UNRESOLVED_SYMBOL: "air.package_graph.unresolved_symbol_import",
  PRIVATE_SYMBOL: "air.package_graph.private_symbol_import",
  DUPLICATE_EXPORT: "air.package_graph.duplicate_public_export",
  EXECUTABLE_STALE: "air.package_graph.executable_stale",
  OWNERSHIP_MISSING: "air.package_graph.ownership_metadata_missing",
  CAPABILITY_DRIFT: "air.package_graph.capability_drift",
  ABSOLUTE_PATH: "air.package_graph.absolute_path_rejected",
  TIMESTAMP: "air.package_graph.timestamp_rejected"
});

function createPackageGraphOwnership(packageReport, options = {}) {
  const modules = sortedModules(packageReport.modules || []);
  const symbols = sortedSymbols(options.symbols || []);
  const diagnostics = options.diagnostics
    ? sortDiagnostics(options.diagnostics.map((diagnostic) => normalizeDiagnostic(diagnostic)))
    : packageGraphDiagnostics(packageReport, packageReport, options);
  const sourceGraphHash = options.sourceGraphHash || objectFingerprint(sourceGraphForHash(packageReport));
  const executableModuleId = options.executableModuleId || `${safePackageId(packageReport.package || "package")}.linked`;

  const authoredGraph = stableObject({
    kind: "air.authoredPackageGraph",
    sourceGraphHash,
    entry: packageReport.entry || null,
    modules: modules.map((mod) => ({
      id: moduleIdForPath(mod.path),
      path: mod.path,
      name: mod.name || null
    })),
    edges: (packageReport.graph && packageReport.graph.edges || []).map((edge) => ({
      from: edge.from || null,
      to: edge.to || null,
      import: edge.import || null
    })).sort(compareGraphEdge)
  });

  const executableGraph = stableObject({
    kind: "air.executablePackageGraph",
    status: options.executableStatus || "derived",
    sourceGraphHash,
    executableModuleId,
    linkedOutput: stableObject(options.linkedOutput || {
      available: Boolean(options.linkedWasm),
      kind: options.linkedWasm ? "wasm" : "metadata",
      path: null
    }),
    modules: modules.map((mod) => ({
      authoredModuleId: moduleIdForPath(mod.path),
      authoredPath: mod.path,
      executableModuleId,
      executablePath: options.executablePath || null
    })),
    symbols: symbols.map((symbol) => ({
      kind: symbol.kind,
      authoredModule: symbol.module || null,
      authoredSymbol: symbol.sourceName || null,
      executableModuleId,
      executableSymbol: symbol.mangledName || null,
      visibility: symbol.visibility || null
    }))
  });

  const ownershipMap = stableObject({
    symbols: symbolOwnership(modules, symbols, executableModuleId),
    exports: exportOwnership(modules, options.packageExports || []),
    imports: importOwnership(packageReport.importClassifications || []),
    privateSymbols: privateSymbolOwnership(modules),
    capabilities: originMapOwnership(packageReport.capabilityOrigins || {}, "capability"),
    effects: effectOwnership(packageReport.effectUsageOrigins || {}),
    outputContracts: outputContractOwnership(packageReport.outputContracts && packageReport.outputContracts.schemas, packageReport.entry),
    tableGroups: tableGroupOwnership(packageReport.tableGroups || [], modules),
    structuredIO: structuredIoOwnership(packageReport.structuredIO && packageReport.structuredIO.schemas, packageReport.entry),
    diagnosticsByModule: diagnosticsByModule(diagnostics, modules)
  });

  const generatedExecutableFreshness = stableObject({
    status: diagnostics.some((diagnostic) => diagnostic.code === PACKAGE_GRAPH_DIAGNOSTICS.EXECUTABLE_STALE) ? "stale" : "current",
    sourceGraphHash,
    ownershipMetadata: ownershipMap ? "present" : "missing",
    generatedArtifacts: generatedStatus(packageReport.generatedArtifacts),
    generatedHandles: generatedStatus(packageReport.generatedHandles),
    authorityDrift: executableAuthorityDrift(packageReport, options),
    diagnostics: diagnostics.filter((diagnostic) => [
      PACKAGE_GRAPH_DIAGNOSTICS.EXECUTABLE_STALE,
      PACKAGE_GRAPH_DIAGNOSTICS.OWNERSHIP_MISSING,
      PACKAGE_GRAPH_DIAGNOSTICS.CAPABILITY_DRIFT,
      PACKAGE_GRAPH_DIAGNOSTICS.ABSOLUTE_PATH,
      PACKAGE_GRAPH_DIAGNOSTICS.TIMESTAMP
    ].includes(diagnostic.code)).map(compactDiagnostic)
  });

  return stableObject({
    authoredGraph,
    executableGraph,
    authoredToExecutable: authoredToExecutable(modules, symbols, executableModuleId),
    ownershipMap,
    linkDiagnostics: diagnostics.map(compactDiagnostic),
    generatedExecutableFreshness
  });
}

function packageGraphDiagnostics(packageReport, checkReport = {}, options = {}) {
  const diagnostics = [];
  const modules = sortedModules(packageReport.modules || []);
  const moduleByPath = new Map(modules.map((mod) => [mod.path, mod]));

  for (const message of sortedStrings((checkReport.errors || []).concat(packageReport.errors || []))) {
    const missing = String(message).match(/AIR import missing file: ([^\s]+)/);
    if (missing) {
      diagnostics.push(diagnostic(PACKAGE_GRAPH_DIAGNOSTICS.UNRESOLVED_MODULE, "fail", "package import references a missing AIR module", {
        import: missing[1]
      }));
    }
    const unknownFunction = String(message).match(/unknown function '([^'.]+)\.([^']+)'/);
    if (unknownFunction) {
      diagnostics.push(diagnostic(PACKAGE_GRAPH_DIAGNOSTICS.UNRESOLVED_SYMBOL, "fail", "authored module attempted to import an unresolved symbol", {
        importAlias: unknownFunction[1],
        symbol: unknownFunction[2]
      }));
    }
    if (/generated (?:handle|artifact).*stale|generated .*stale/i.test(message)) {
      diagnostics.push(diagnostic(PACKAGE_GRAPH_DIAGNOSTICS.EXECUTABLE_STALE, "fail", "derived executable graph input is stale", {
        reason: sanitizeMessage(message)
      }));
    }
  }

  for (const group of packageReport.moduleDiagnostics || []) {
    for (const symbol of group.symbols || []) {
      if (group.code === "AIR_MODULE_MISSING_DIRECT_IMPORT") {
        diagnostics.push(diagnostic(PACKAGE_GRAPH_DIAGNOSTICS.UNRESOLVED_MODULE, "fail", "cross-module call requires a direct authored module import", {
          callerModule: group.callerModule || null,
          targetModule: group.targetModule || null,
          symbol: symbol.name || null,
          line: symbol.line || null
        }));
        continue;
      }
      if (group.code === "AIR_MODULE_PRIVATE_OR_MISSING_EXPORT") {
        const target = moduleByPath.get(group.targetModule || "");
        const privateSymbols = new Set((target && target.privateFunctions) || []);
        const code = privateSymbols.has(symbol.name)
          ? PACKAGE_GRAPH_DIAGNOSTICS.PRIVATE_SYMBOL
          : PACKAGE_GRAPH_DIAGNOSTICS.UNRESOLVED_SYMBOL;
        diagnostics.push(diagnostic(code, "fail", code === PACKAGE_GRAPH_DIAGNOSTICS.PRIVATE_SYMBOL
          ? "authored module attempted to import a private symbol"
          : "authored module attempted to import an unresolved symbol", {
          callerModule: group.callerModule || null,
          targetModule: group.targetModule || null,
          symbol: symbol.name || null,
          line: symbol.line || null
        }));
      }
    }
  }

  for (const duplicate of duplicatePackageExports(options.packageExports || [])) {
    diagnostics.push(diagnostic(PACKAGE_GRAPH_DIAGNOSTICS.DUPLICATE_EXPORT, "fail", "duplicate public package export ownership", {
      export: duplicate.name,
      owners: duplicate.owners
    }));
  }

  const drift = executableAuthorityDrift(packageReport, options);
  if (drift.status === "fail") {
    diagnostics.push(diagnostic(PACKAGE_GRAPH_DIAGNOSTICS.CAPABILITY_DRIFT, "fail", "derived executable graph introduces authority absent from authored graph", drift));
  }

  return sortDiagnostics(diagnostics).map(compactDiagnostic);
}

function duplicatePackageExports(exports = []) {
  const ownersByName = new Map();
  for (const item of exports || []) {
    const name = item && item.name || null;
    if (!name) continue;
    const owner = `${item.module || "<entry>"}:${item.function || name}`;
    const owners = ownersByName.get(name) || [];
    owners.push(owner);
    ownersByName.set(name, owners);
  }
  return Array.from(ownersByName.entries())
    .filter(([, owners]) => owners.length > 1)
    .map(([name, owners]) => ({ name, owners: sortedStrings(owners) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function executableAuthorityDrift(packageReport, options = {}) {
  const authoredCapabilities = new Set(Object.keys(packageReport.capabilityOrigins || {}));
  const executableCapabilities = new Set(options.executableCapabilities || authoredCapabilities);
  const introducedCapabilities = Array.from(executableCapabilities).filter((capability) => !authoredCapabilities.has(capability)).sort();
  return {
    status: introducedCapabilities.length ? "fail" : "pass",
    introducedCapabilities
  };
}

function symbolOwnership(modules, symbols, executableModuleId) {
  return symbols.map((symbol) => ({
    authoredModule: symbol.module || null,
    authoredModuleId: symbol.module ? moduleIdForPath(symbol.module) : null,
    sourceName: symbol.sourceName || null,
    kind: symbol.kind || null,
    visibility: symbol.visibility || null,
    executableModuleId,
    executableSymbol: symbol.mangledName || null
  })).sort(compareSymbolOwner);
}

function exportOwnership(modules, packageExports) {
  const moduleExports = [];
  for (const mod of modules) {
    for (const name of mod.exports || []) {
      moduleExports.push({
        kind: "module-export",
        name,
        authoredModule: mod.path,
        owner: mod.path,
        visibility: "public"
      });
    }
  }
  const packageLevel = (packageExports || []).map((item) => ({
    kind: "package-export",
    name: item.name || null,
    authoredModule: item.module || null,
    function: item.function || null,
    owner: item.module || null,
    visibility: "package-public"
  }));
  return moduleExports.concat(packageLevel).sort((a, b) =>
    String(a.kind).localeCompare(String(b.kind)) ||
    String(a.name || "").localeCompare(String(b.name || "")) ||
    String(a.authoredModule || "").localeCompare(String(b.authoredModule || "")));
}

function importOwnership(importClassifications) {
  return (importClassifications || []).map((item) => ({
    module: item.module || null,
    import: item.import || null,
    alias: item.alias || null,
    resolved: item.resolved || null,
    class: item.class || null,
    status: item.status || null,
    owner: item.resolved || null
  })).sort((a, b) =>
    String(a.module || "").localeCompare(String(b.module || "")) ||
    String(a.import || "").localeCompare(String(b.import || "")));
}

function privateSymbolOwnership(modules) {
  const out = [];
  for (const mod of modules) {
    for (const name of mod.privateFunctions || []) {
      out.push({ authoredModule: mod.path, name, kind: "function", visibility: "private" });
    }
  }
  return out.sort((a, b) => String(a.authoredModule).localeCompare(String(b.authoredModule)) || String(a.name).localeCompare(String(b.name)));
}

function originMapOwnership(origins, kind) {
  return Object.entries(origins || {}).map(([name, owners]) => ({
    kind,
    name,
    owners: sortedStrings(owners || [])
  })).sort((a, b) => a.name.localeCompare(b.name));
}

function effectOwnership(effectOrigins) {
  const out = [];
  for (const [modulePath, effects] of Object.entries(effectOrigins || {}).sort(([a], [b]) => a.localeCompare(b))) {
    for (const [name, budget] of Object.entries(effects || {}).sort(([a], [b]) => a.localeCompare(b))) {
      out.push({ name, owner: modulePath, budget });
    }
  }
  return out;
}

function outputContractOwnership(schemas, defaultOwner) {
  return (schemas || []).map((schema) => ({
    path: schema.path || null,
    owner: schema.owner || defaultOwner || "air.package.json",
    outputs: (schema.outputs || []).map((output) => ({
      id: output.id,
      name: output.name,
      capability: output.capability || null
    })).sort((a, b) => Number(a.id || 0) - Number(b.id || 0) || String(a.name).localeCompare(String(b.name)))
  })).sort((a, b) => String(a.path || "").localeCompare(String(b.path || "")));
}

function tableGroupOwnership(tableGroups, modules) {
  const moduleByGroup = new Map();
  for (const mod of modules) {
    for (const group of mod.tableGroups || []) moduleByGroup.set(`${mod.path}:${group.name}`, mod.path);
  }
  return (tableGroups || []).map((group) => ({
    name: group.name || null,
    owner: group.module || moduleByGroup.get(`${group.module || ""}:${group.name}`) || null,
    length: group.length || 0,
    fields: (group.fields || []).map((field) => ({ name: field.name || null, type: field.type || null })).sort((a, b) => String(a.name).localeCompare(String(b.name)))
  })).sort((a, b) => String(a.owner || "").localeCompare(String(b.owner || "")) || String(a.name || "").localeCompare(String(b.name || "")));
}

function structuredIoOwnership(schemas, defaultOwner) {
  return (schemas || []).map((schema) => ({
    path: schema.path || null,
    owner: schema.owner || defaultOwner || "air.package.json",
    name: schema.name || null,
    kind: schema.kind || null,
    maxRows: schema.maxRows || null,
    fields: (schema.fields || []).map((field) => ({ name: field.name || null, type: field.type || null, privacy: field.privacy || field.classification || null })).sort((a, b) => String(a.name).localeCompare(String(b.name)))
  })).sort((a, b) => String(a.path || "").localeCompare(String(b.path || "")));
}

function diagnosticsByModule(diagnostics, modules) {
  const byModule = new Map(modules.map((mod) => [mod.path, []]));
  for (const diagnostic of diagnostics || []) {
    const modulePath = diagnostic.module || diagnostic.fields && (diagnostic.fields.callerModule || diagnostic.fields.targetModule) || null;
    if (!modulePath) continue;
    const list = byModule.get(modulePath) || [];
    list.push(compactDiagnostic(diagnostic));
    byModule.set(modulePath, list);
  }
  return Array.from(byModule.entries()).map(([module, items]) => ({
    module,
    diagnostics: sortDiagnostics(items)
  })).filter((item) => item.diagnostics.length).sort((a, b) => a.module.localeCompare(b.module));
}

function authoredToExecutable(modules, symbols, executableModuleId) {
  const moduleMappings = modules.map((mod) => ({
    kind: "module",
    authoredModule: mod.path,
    authoredModuleId: moduleIdForPath(mod.path),
    executableModuleId
  }));
  const symbolMappings = symbols.map((symbol) => ({
    kind: symbol.kind || "symbol",
    authoredModule: symbol.module || null,
    authoredSymbol: symbol.sourceName || null,
    executableModuleId,
    executableSymbol: symbol.mangledName || null
  }));
  return moduleMappings.concat(symbolMappings).sort((a, b) =>
    String(a.kind).localeCompare(String(b.kind)) ||
    String(a.authoredModule || "").localeCompare(String(b.authoredModule || "")) ||
    String(a.authoredSymbol || "").localeCompare(String(b.authoredSymbol || "")));
}

function sourceGraphForHash(packageReport) {
  return {
    entry: packageReport.entry || null,
    graph: packageReport.graph || { order: [], edges: [] },
    modules: sortedModules(packageReport.modules || []).map((mod) => ({
      path: mod.path,
      name: mod.name,
      imports: mod.imports || [],
      exports: mod.exports || [],
      privateFunctions: mod.privateFunctions || [],
      functions: (mod.functions || []).map((fn) => ({
        name: fn.name,
        exported: Boolean(fn.exported),
        params: fn.params || [],
        returnType: fn.returnType || "void"
      }))
    }))
  };
}

function generatedStatus(report) {
  if (!report) return "not_declared";
  if ((report.errors || []).length) return "failed";
  if ((report.warnings || []).length) return "warn";
  return report.ok === false ? "failed" : "current";
}

function sortedModules(modules) {
  return (modules || []).slice().sort((a, b) => String(a.path || "").localeCompare(String(b.path || "")));
}

function sortedSymbols(symbols) {
  return (symbols || []).slice().sort((a, b) =>
    String(a.module || "").localeCompare(String(b.module || "")) ||
    String(a.kind || "").localeCompare(String(b.kind || "")) ||
    String(a.sourceName || "").localeCompare(String(b.sourceName || "")) ||
    String(a.mangledName || "").localeCompare(String(b.mangledName || "")));
}

function diagnostic(code, severity, message, fields = {}) {
  return normalizeDiagnostic({
    code,
    severity,
    source: "package-graph",
    message,
    fields: stableObject(fields)
  });
}

function compactDiagnostic(diagnostic) {
  const normalized = normalizeDiagnostic(diagnostic);
  return stableObject({
    code: normalized.code || null,
    severity: normalized.severity || null,
    message: normalized.message || null,
    source: normalized.source || null,
    file: normalized.file || null,
    module: normalized.module || null,
    fields: normalized.fields || {}
  });
}

function compareGraphEdge(a, b) {
  return String(a.from || "").localeCompare(String(b.from || "")) ||
    String(a.to || "").localeCompare(String(b.to || "")) ||
    String(a.import || "").localeCompare(String(b.import || ""));
}

function compareSymbolOwner(a, b) {
  return String(a.authoredModule || "").localeCompare(String(b.authoredModule || "")) ||
    String(a.kind || "").localeCompare(String(b.kind || "")) ||
    String(a.sourceName || "").localeCompare(String(b.sourceName || ""));
}

function objectFingerprint(value) {
  return `sha256:${crypto.createHash("sha256").update(stableStringify(value)).digest("hex")}`;
}

function stableStringify(value) {
  return JSON.stringify(stableObject(value));
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = stableObject(value[key]);
  return out;
}

function sortedStrings(values) {
  return Array.from(new Set((values || []).filter(Boolean).map(String))).sort();
}

function safePackageId(value) {
  return String(value || "package").replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") || "package";
}

function sanitizeMessage(message) {
  return String(message || "").replace(/[A-Za-z]:[\\/][^\s"]+/g, "<absolute-path>").replace(/\/[^\s"]+/g, (match) => match.includes("/") ? "<absolute-path>" : match);
}

module.exports = {
  PACKAGE_GRAPH_DIAGNOSTICS,
  createPackageGraphOwnership,
  packageGraphDiagnostics,
  executableAuthorityDrift
};
