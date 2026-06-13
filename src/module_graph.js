const fs = require("fs");
const path = require("path");
const { parseAir } = require("./parser");
const { collectEffectUsage, verifyModule } = require("./verifier");
const { requiredCapabilityForExtern } = require("./capabilities");
const { scalarByteWidth } = require("./types");
const { tableGroupMetadata, tableStorageByteWidth } = require("./table_metadata");
const { stateSegmentMetadata } = require("./state_metadata");
const { poolMetadata } = require("./pool_metadata");

const STDLIB_DIR = path.resolve(__dirname, "..", "stdlib");
const REJECTED_STDLIB_IMPORTS = {
  gfx3d: {
    belongsTo: "kits/gfx-basic",
    message: "std.gfx3d is not stdlib; it belongs to kits/gfx-basic",
    repairHint: "vendor/copy kits/gfx-basic/air/gfx3d.air into a package-local generated/kits path, or use an accepted kit import mechanism when introduced; do not use std.* for host-authority wrappers"
  },
  scene: {
    belongsTo: "kits/gfx-basic or project-local code",
    message: "std.scene is not stdlib; it belongs to kits/gfx-basic or project-local code",
    repairHint: "vendor/copy kits/gfx-basic/air/scene.air into a package-local generated/kits path, or use project-local code; do not use std.* for host-authority wrappers"
  },
  voxel: {
    belongsTo: "kits/voxel-basic",
    message: "std.voxel is not stdlib; use kits/voxel-basic as vendored/project-local helper",
    repairHint: "vendor/copy kits/voxel-basic/air/voxel.air into a package-local generated/kits path, or use an accepted kit import mechanism when introduced; do not use std.* for host-authority wrappers"
  },
  ui: {
    belongsTo: "kits/ui-basic",
    message: "std.ui is not stdlib; it belongs to kits/ui-basic",
    repairHint: "vendor/copy kits/ui-basic/air/ui.air into a package-local generated/kits path, or use an accepted kit import mechanism when introduced; do not use std.* for host-authority wrappers"
  }
};

class ModuleGraphError extends Error {
  constructor(errors, partial = null) {
    super(errors.join("\n"));
    this.name = "ModuleGraphError";
    this.errors = errors;
    this.partial = partial;
  }
}

function analyzePackageModuleGraph(packageRoot, entry) {
  const root = path.resolve(packageRoot);
  const rootReal = fs.existsSync(root) ? fs.realpathSync(root) : root;
  const entryErrors = [];
  const entryRef = resolvePackagePath(root, rootReal, entry, "<package>", entryErrors);
  const modulesByPath = new Map();
  const modulesByName = new Map();
  const graphEdges = [];
  const importClassifications = [];
  const rawModuleDiagnostics = [];
  const order = [];
  const errors = entryErrors;

  if (entryRef) visit(entryRef, []);

  validateCrossModuleCalls();
  const moduleDiagnostics = groupModuleDiagnostics(rawModuleDiagnostics);
  for (const diagnostic of moduleDiagnostics) errors.push(formatModuleDiagnostic(diagnostic));

  const modules = order.map((relative) => {
    const item = modulesByPath.get(relative);
    return {
      name: item.mod.name,
      path: relative,
      imports: item.imports.map((importRef) => importRef.relative).sort(),
      capabilities: Array.from(item.mod.capabilities || []).sort(),
      hostImports: hostImportNames(item.mod),
      globals: globalSummaries(item.mod),
      staticTables: staticTableSummaries(item.mod, relative),
      tableGroups: tableGroupSummaries(item.mod, relative),
      stateSegments: stateSegmentSummaries(item.mod, relative),
      pools: poolSummaries(item.mod, relative),
      functions: functionSummaries(item.mod),
      statementCount: moduleStatementCount(item.mod),
      topLargeFunctions: topLargeFunctions(item.mod),
      exports: exportedFunctionNames(item.mod),
      privateFunctions: privateFunctionNames(item.mod)
    };
  });
  const graph = {
    order: modules.map((item) => item.path),
    edges: graphEdges.slice().sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.import.localeCompare(b.import))
  };
  const capabilityOrigins = collectCapabilityOrigins(modulesByPath);
  const hostImportOrigins = collectHostImportOrigins(modulesByPath);
  const effectUsageOrigins = collectEffectUsageOrigins(modulesByPath);
  const authorityChains = collectAuthorityChains(entryRef ? entryRef.relative : null, modulesByPath, graphEdges);
  const report = {
    modules,
    graph,
    capabilityOrigins,
    hostImportOrigins,
    authorityChains,
    importClassifications: importClassifications.slice().sort(compareImportClassification),
    moduleDiagnostics,
    effectUsageOrigins,
    effectComposition: {
      status: "per-module-only",
      message: "package-check validates each reachable module and reports effect usage by origin; linked cross-module effect budget composition is deferred until linked output is implemented."
    },
    linking: {
      status: "available",
      output: "linked-wasm-first-slice",
      message: "package-local module graph analysis is active; deterministic linked Wasm output is available through the linked package build path."
    },
    errors
  };
  if (errors.length) throw new ModuleGraphError(errors, report);
  return report;

  function visit(ref, stack) {
    if (stack.includes(ref.relative)) {
      const cycle = stack.slice(stack.indexOf(ref.relative)).concat(ref.relative).join(" -> ");
      errors.push(`cyclic AIR import: ${cycle}`);
      return;
    }
    if (modulesByPath.has(ref.relative)) return;
    if (!fs.existsSync(ref.absolute)) {
      errors.push(`AIR import missing file: ${ref.relative}`);
      return;
    }
    if (!fs.statSync(ref.absolute).isFile()) {
      errors.push(`AIR import is not a file: ${ref.relative}`);
      return;
    }

    const source = fs.readFileSync(ref.absolute, "utf8");
    let mod = null;
    try {
      mod = parseAir(source, ref.absolute, { resolveSourceImports: false });
    } catch (err) {
      errors.push(errorMessage(err));
      return;
    }
    const existing = modulesByName.get(mod.name);
    if (existing && existing !== ref.relative) {
      errors.push(`duplicate module identity '${mod.name}': ${existing}, ${ref.relative}`);
      return;
    }
    modulesByName.set(mod.name, ref.relative);

    const imports = [];
    const stdImports = [];
    modulesByPath.set(ref.relative, { mod, imports, stdImports });
    order.push(ref.relative);

    const importedNames = new Map();
    for (const use of sourceUses(mod).sort((a, b) => a.name.localeCompare(b.name))) {
      if (use.name.startsWith("std.")) {
        const stdImport = resolveStdlibImport(ref.relative, use, importedNames, errors);
        if (stdImport) stdImports.push(stdImport);
        continue;
      }
      const child = resolvePackageImport(root, rootReal, ref.relative, ref.absolute, use, errors);
      if (!child) continue;
      const childImport = { ...child, alias: use.alias || null };
      const publicName = childImport.alias || modulePublicName(child);
      if (publicName) {
        const existing = importedNames.get(publicName);
        if (existing) {
          errors.push(`duplicate AIR import name '${publicName}' in ${ref.relative}: ${existing}, ${child.relative}`);
        } else {
          importedNames.set(publicName, child.relative);
        }
      }
      imports.push(childImport);
      importClassifications.push({
        module: ref.relative,
        import: use.name,
        class: "package-local",
        status: "accepted",
        alias: childImport.alias || modulePublicName(child),
        resolved: child.relative
      });
      graphEdges.push({ from: ref.relative, to: child.relative, import: use.name });
      visit(child, stack.concat(ref.relative));
    }

    try {
      verifyModule(mod, { library: ref.relative !== entryRef.relative, externalFunctions: externalFunctionStubs(ref.relative) });
    } catch (err) {
      errors.push(errorMessage(err));
    }
  }

  function externalFunctionStubs(relative) {
    const item = modulesByPath.get(relative);
    if (!item) return [];
    const stubs = [];
    for (const importRef of item.imports) {
      const imported = modulesByPath.get(importRef.relative);
      if (!imported) continue;
      const importedName = importRef.alias || imported.mod.name;
      for (const fn of imported.mod.functions || []) {
        stubs.push({
          name: `${importedName}.${fn.name}`,
          params: fn.params,
          returnType: fn.returnType,
          loc: fn.loc
        });
      }
    }
    for (const importRef of item.stdImports || []) {
      for (const fn of importRef.functions || []) {
        stubs.push({
          name: `${importRef.alias}.${fn.name}`,
          params: fn.params,
          returnType: fn.returnType,
          loc: fn.loc
        });
      }
    }
    return stubs.sort((a, b) => a.name.localeCompare(b.name));
  }

  function validateCrossModuleCalls() {
    const moduleByName = new Map();
    for (const [relative, item] of modulesByPath.entries()) moduleByName.set(item.mod.name, { relative, item });
    for (const [relative, item] of modulesByPath.entries()) {
      const directImports = new Map();
      for (const importRef of item.imports) {
        const imported = modulesByPath.get(importRef.relative);
        if (imported) directImports.set(importRef.alias || imported.mod.name, { relative: importRef.relative, item: imported });
      }
      for (const importRef of item.stdImports || []) {
        directImports.set(importRef.alias, { relative: importRef.resolved, item: { mod: importRef.mod }, stdlib: true });
      }
      const localNames = new Set([
        ...(item.mod.externs || []).map((ex) => ex.name),
        ...(item.mod.functions || []).map((fn) => fn.name)
      ]);
      forEachCall(item.mod, (callee, loc) => {
        if (localNames.has(callee)) return;
        const parsed = splitQualifiedName(callee);
        if (!parsed) return;
        const direct = directImports.get(parsed.moduleName);
        if (!direct) {
          if (moduleByName.has(parsed.moduleName)) {
            const target = moduleByName.get(parsed.moduleName);
            rawModuleDiagnostics.push({
              code: "AIR_MODULE_MISSING_DIRECT_IMPORT",
              callerModule: relative,
              targetModule: target.relative,
              symbol: parsed.functionName,
              loc,
              repair: "Add a direct package-local use import for this module alias before calling alias.exported_func."
            });
          }
          return;
        }
        const exported = (direct.item.mod.functions || []).find((fn) => fn.name === parsed.functionName && (direct.stdlib || fn.exported));
        if (!exported) {
          rawModuleDiagnostics.push({
            code: "AIR_MODULE_PRIVATE_OR_MISSING_EXPORT",
            callerModule: relative,
            targetModule: direct.relative,
            symbol: parsed.functionName,
            loc,
            repair: "Export these functions or expose one exported wrapper and keep helpers local."
          });
        }
      });
    }
  }

  function resolveStdlibImport(importerRelative, use, importedNames, errors) {
    const moduleName = use.name.slice("std.".length);
    const rejected = REJECTED_STDLIB_IMPORTS[moduleName];
    const stdFile = path.join(STDLIB_DIR, `${moduleName}.air`);
    const alias = use.alias || moduleName;
    if (rejected || !fs.existsSync(stdFile)) {
      const message = rejected
        ? `${rejected.message} in ${importerRelative}`
        : `${use.name} is not a valid stdlib import in ${importerRelative}; stdlib module '${moduleName}' was not found`;
      errors.push(message);
      importClassifications.push({
        module: importerRelative,
        import: use.name,
        class: rejected ? "rejected-stdlib" : "invalid-stdlib",
        status: "rejected",
        alias,
        resolved: null,
        belongsTo: rejected ? rejected.belongsTo : null,
        repairHint: rejected ? rejected.repairHint : "use an existing stdlib module, or vendor/copy project/kit helpers into a package-local ./ path"
      });
      return null;
    }
    const existing = importedNames.get(alias);
    if (existing) {
      errors.push(`duplicate AIR import name '${alias}' in ${importerRelative}: ${existing}, ${use.name}`);
      return null;
    }
    importedNames.set(alias, use.name);
    let stdMod = null;
    try {
      stdMod = parseAir(fs.readFileSync(stdFile, "utf8"), stdFile, { resolveSourceImports: false });
      verifyModule(stdMod, { library: true });
    } catch (err) {
      errors.push(`stdlib import '${use.name}' failed verification: ${errorMessage(err)}`);
      return null;
    }
    const resolved = `stdlib/${moduleName}.air`;
    importClassifications.push({
      module: importerRelative,
      import: use.name,
      class: "stdlib",
      status: "accepted",
      alias,
      resolved
    });
    return {
      name: use.name,
      alias,
      resolved,
      mod: stdMod,
      functions: stdMod.functions || []
    };
  }
}

function stateSegmentSummaries(mod, modulePath) {
  return stateSegmentMetadata(mod, {
    modulePath,
    usage: collectEffectUsage(mod)
  }).map((segment) => ({
    name: segment.name,
    cellType: segment.cellType,
    length: segment.length,
    byteWidth: segment.byteWidth,
    byteSize: segment.byteSize,
    staticBytes: segment.staticBytes,
    persistent: segment.persistent,
    exported: segment.exported,
    shared: segment.shared,
    initializer: segment.initializer,
    readBudget: segment.readBudget,
    writeBudget: segment.writeBudget,
    sizeBudget: segment.sizeBudget,
    moduleObservedReads: segment.moduleObservedReads,
    moduleObservedWrites: segment.moduleObservedWrites,
    diagnostics: segment.diagnostics,
    module: modulePath,
    origin: segment.origin
  }));
}

function poolSummaries(mod, modulePath) {
  return poolMetadata(mod, {
    modulePath,
    usage: collectEffectUsage(mod)
  }).map((pool) => ({
    name: pool.name,
    ownerModule: pool.ownerModule,
    module: modulePath,
    capacity: pool.capacity,
    fieldCount: pool.fieldCount,
    fields: pool.fields,
    activeField: pool.activeField,
    storageFootprint: pool.storageFootprint,
    staticBytes: pool.staticBytes,
    readBudget: pool.readBudget,
    writeBudget: pool.writeBudget,
    moduleObservedReads: pool.moduleObservedReads,
    moduleObservedWrites: pool.moduleObservedWrites,
    generatedArtifactStatus: pool.generatedArtifactStatus,
    diagnostics: pool.diagnostics,
    origin: pool.origin
  }));
}

function modulePublicName(ref) {
  if (!ref || !fs.existsSync(ref.absolute)) return null;
  try {
    const mod = parseAir(fs.readFileSync(ref.absolute, "utf8"), ref.absolute, { resolveSourceImports: false });
    return mod.name;
  } catch (_) {
    return null;
  }
}

function sourceUses(mod) {
  return (mod.uses || []).filter((use) => use.kind === "source");
}

function resolvePackageImport(root, rootReal, importerRelative, importerAbsolute, use, errors) {
  const name = use.name;
  if (hasUrlScheme(name)) {
    errors.push(`AIR import '${name}' in ${importerRelative} uses a URL scheme; only package-local ./ or ../ imports are supported`);
    return null;
  }
  if (path.isAbsolute(name) || path.posix.isAbsolute(name.replace(/\\/g, "/"))) {
    errors.push(`AIR import '${name}' in ${importerRelative} must be package-local, not absolute`);
    return null;
  }
  if (!name.startsWith("./") && !name.startsWith("../")) {
    errors.push(`AIR import '${name}' in ${importerRelative} must start with ./ or ../`);
    return null;
  }
  if (!name.endsWith(".air")) {
    errors.push(`AIR import '${name}' in ${importerRelative} must reference a .air file`);
    return null;
  }
  return resolvePackagePath(root, rootReal, name, importerAbsolute, errors);
}

function resolvePackagePath(root, rootReal, value, importerAbsolute, errors) {
  if (hasUrlScheme(value)) {
    errors.push(`AIR import '${value}' uses a URL scheme; only package-local ./ or ../ imports are supported`);
    return null;
  }
  if (path.isAbsolute(value) || path.posix.isAbsolute(value.replace(/\\/g, "/"))) {
    errors.push(`AIR import '${value}' must be package-local, not absolute`);
    return null;
  }
  const base = importerAbsolute === "<package>" ? root : path.dirname(importerAbsolute);
  const absolute = path.resolve(base, value);
  const relativeFromRoot = path.relative(root, absolute).replace(/\\/g, "/");
  if (relativeFromRoot === "" || relativeFromRoot.startsWith("../") || relativeFromRoot === ".." || path.isAbsolute(relativeFromRoot)) {
    errors.push(`AIR import '${value}' escapes package root`);
    return null;
  }
  if (fs.existsSync(absolute)) {
    const real = fs.realpathSync(absolute);
    const relativeReal = path.relative(rootReal, real);
    if (relativeReal === "" || relativeReal.startsWith("..") || path.isAbsolute(relativeReal)) {
      errors.push(`AIR import '${value}' resolves outside package root`);
      return null;
    }
  }
  return {
    relative: relativeFromRoot,
    absolute
  };
}

function collectCapabilityOrigins(modulesByPath) {
  const origins = {};
  for (const [relative, item] of modulesByPath.entries()) {
    for (const capability of item.mod.capabilities || []) {
      if (!origins[capability]) origins[capability] = [];
      origins[capability].push(relative);
    }
  }
  return sortOriginMap(origins);
}

function collectHostImportOrigins(modulesByPath) {
  const origins = {};
  for (const [relative, item] of modulesByPath.entries()) {
    for (const ex of item.mod.externs || []) {
      if (!origins[ex.name]) origins[ex.name] = [];
      origins[ex.name].push(relative);
    }
  }
  return sortOriginMap(origins);
}

function collectEffectUsageOrigins(modulesByPath) {
  const out = {};
  for (const [relative, item] of modulesByPath.entries()) {
    try {
      out[relative] = usageMapToObject(collectEffectUsage(item.mod));
    } catch (_) {
      out[relative] = {};
    }
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

function usageMapToObject(usage) {
  const out = {};
  for (const [key, value] of usage.entries()) out[key] = value;
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

function exportedFunctionNames(mod) {
  return (mod.functions || []).filter((fn) => fn.exported).map((fn) => fn.name).sort();
}

function privateFunctionNames(mod) {
  return (mod.functions || []).filter((fn) => !fn.exported).map((fn) => fn.name).sort();
}

function hostImportNames(mod) {
  return (mod.externs || []).map((ex) => ex.name).sort();
}

function globalSummaries(mod) {
  return (mod.globals || [])
    .map((global) => ({
      name: global.name,
      type: global.type
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function staticTableSummaries(mod, modulePath) {
  return (mod.tables || [])
    .map((table) => {
      const byteWidth = tableStorageByteWidth(table.type) || scalarByteWidth(table.type) || 0;
      const staticBytes = (table.length || 0) * byteWidth;
      const equivalentI32Bytes = (table.length || 0) * 4;
      const item = {
        name: table.name,
        type: table.type,
        elementType: table.type,
        storageType: table.type,
        length: table.length,
        byteWidth,
        byteSize: staticBytes,
        equivalentI32Bytes,
        estimatedI32SavingsBytes: Math.max(0, equivalentI32Bytes - staticBytes),
        staticBytes,
        approximateStorageBytes: staticBytes,
        module: modulePath,
        origin: table.tablegroup ? "tablegroup" : (modulePath.includes("/generated/") || modulePath.startsWith("generated/") ? "generated" : "manual")
      };
      if (table.tablegroup) {
        item.tablegroup = table.tablegroup;
        item.tablegroupField = table.tablegroupField || null;
      }
      return item;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function tableGroupSummaries(mod, modulePath) {
  return tableGroupMetadata(mod)
    .map((group) => ({
      ...group,
      module: modulePath,
      fields: (group.fields || []).map((field) => ({
        ...field,
        source: modulePath
      }))
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function functionSummaries(mod) {
  return (mod.functions || [])
    .map((fn) => ({
      name: fn.name,
      exported: Boolean(fn.exported),
      params: fn.params || [],
      returnType: fn.returnType,
      blocks: (fn.blocks || []).length,
      statements: functionStatementCount(fn)
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function moduleStatementCount(mod) {
  return (mod.functions || []).reduce((sum, fn) => sum + functionStatementCount(fn), 0);
}

function functionStatementCount(fn) {
  return (fn.blocks || []).reduce((sum, block) => sum + (block.instructions || []).length, 0);
}

function topLargeFunctions(mod) {
  return functionSummaries(mod)
    .map((fn) => ({
      name: fn.name,
      exported: fn.exported,
      statements: fn.statements,
      blocks: fn.blocks
    }))
    .sort((a, b) => b.statements - a.statements || a.name.localeCompare(b.name))
    .slice(0, 5);
}

function collectAuthorityChains(entryRelative, modulesByPath, graphEdges) {
  if (!entryRelative) return [];
  const adjacency = new Map();
  for (const edge of graphEdges) {
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
    adjacency.get(edge.from).push(edge.to);
  }
  for (const values of adjacency.values()) values.sort();
  const pathsByModule = new Map();
  const visit = (relative, pathSoFar) => {
    if (pathSoFar.includes(relative)) return;
    const path = pathSoFar.concat(relative);
    if (!pathsByModule.has(relative)) pathsByModule.set(relative, []);
    pathsByModule.get(relative).push(path);
    for (const child of adjacency.get(relative) || []) visit(child, path);
  };
  visit(entryRelative, []);
  const out = [];
  for (const [relative, item] of modulesByPath.entries()) {
    for (const ex of item.mod.externs || []) {
      const capability = requiredCapabilityForExtern(ex.name);
      for (const modulePath of pathsByModule.get(relative) || [[relative]]) {
        out.push({
          hostImport: ex.name,
          requiredCapability: capability || null,
          module: relative,
          chain: modulePath.concat(ex.name)
        });
      }
    }
  }
  return out.sort((a, b) => a.hostImport.localeCompare(b.hostImport) || a.module.localeCompare(b.module) || a.chain.join(">").localeCompare(b.chain.join(">")));
}

function groupModuleDiagnostics(items) {
  const groups = new Map();
  for (const item of items) {
    const key = [item.code, item.callerModule, item.targetModule].join("\u0000");
    if (!groups.has(key)) {
      groups.set(key, {
        code: item.code,
        callerModule: item.callerModule,
        targetModule: item.targetModule,
        summary: "",
        symbols: new Map(),
        repair: item.repair
      });
    }
    const group = groups.get(key);
    if (!group.symbols.has(item.symbol)) {
      group.symbols.set(item.symbol, {
        name: item.symbol,
        callSites: 0,
        locations: []
      });
    }
    const symbol = group.symbols.get(item.symbol);
    symbol.callSites += 1;
    symbol.locations.push(normalizeLocation(item.loc, item.callerModule));
  }
  return Array.from(groups.values()).map((group) => {
    const symbols = Array.from(group.symbols.values()).map((symbol) => ({
      name: symbol.name,
      callSites: symbol.callSites,
      locations: symbol.locations
        .filter(Boolean)
        .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
    })).sort((a, b) => a.name.localeCompare(b.name));
    const callSites = symbols.reduce((sum, symbol) => sum + symbol.callSites, 0);
    return {
      code: group.code,
      callerModule: group.callerModule,
      targetModule: group.targetModule,
      summary: moduleDiagnosticSummary(group.code, callSites),
      symbols,
      repair: group.repair
    };
  }).sort(compareModuleDiagnostic);
}

function moduleDiagnosticSummary(code, callSites) {
  const suffix = callSites === 1 ? "call" : "calls";
  if (code === "AIR_MODULE_PRIVATE_OR_MISSING_EXPORT") {
    return `${callSites} private or missing exported function ${suffix} across module boundary`;
  }
  if (code === "AIR_MODULE_MISSING_DIRECT_IMPORT") {
    return `${callSites} cross-module function ${suffix} require a direct use import`;
  }
  return `${callSites} module graph ${suffix}`;
}

function formatModuleDiagnostic(diagnostic) {
  const symbols = diagnostic.symbols.map((symbol) => `${symbol.name}(${symbol.callSites})`).join(", ");
  if (diagnostic.code === "AIR_MODULE_PRIVATE_OR_MISSING_EXPORT") {
    return `${diagnostic.code}: ${diagnostic.callerModule} -> ${diagnostic.targetModule}: ${diagnostic.summary}; calls must target exported functions: ${symbols}`;
  }
  if (diagnostic.code === "AIR_MODULE_MISSING_DIRECT_IMPORT") {
    return `${diagnostic.code}: ${diagnostic.callerModule} -> ${diagnostic.targetModule}: ${diagnostic.summary}: ${symbols}`;
  }
  return `${diagnostic.code}: ${diagnostic.callerModule} -> ${diagnostic.targetModule}: ${diagnostic.summary}: ${symbols}`;
}

function normalizeLocation(loc, fallbackFile) {
  if (!loc) return { file: fallbackFile, line: 0 };
  return {
    file: fallbackFile,
    line: Number.isInteger(loc.line) ? loc.line : 0
  };
}

function compareModuleDiagnostic(a, b) {
  return a.code.localeCompare(b.code) ||
    a.callerModule.localeCompare(b.callerModule) ||
    a.targetModule.localeCompare(b.targetModule);
}

function forEachCall(mod, fn) {
  for (const func of mod.functions || []) {
    for (const block of func.blocks || []) {
      for (const ins of block.instructions || []) {
        if (ins.op === "call") fn(ins.callee, ins.loc);
      }
    }
  }
}

function splitQualifiedName(name) {
  const idx = name.indexOf(".");
  if (idx <= 0 || idx === name.length - 1) return null;
  return { moduleName: name.slice(0, idx), functionName: name.slice(idx + 1) };
}

function sortOriginMap(map) {
  const out = {};
  for (const key of Object.keys(map).sort()) {
    out[key] = Array.from(new Set(map[key])).sort();
  }
  return out;
}

function compareImportClassification(a, b) {
  return a.module.localeCompare(b.module) || a.import.localeCompare(b.import) || a.class.localeCompare(b.class);
}

function hasUrlScheme(value) {
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value);
}

function errorMessage(err) {
  return err && err.message ? err.message : String(err);
}

module.exports = {
  ModuleGraphError,
  analyzePackageModuleGraph
};
