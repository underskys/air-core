const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { parseAir } = require("./parser");
const { lowerToWat, watToWasm } = require("./lower_wasm");
const { createPackageLinkPlan, stableStringify } = require("./link_plan");
const { mangleSymbol, moduleIdForPath, symbolKey } = require("./link_symbols");
const { normalizePackageMetadata, validatePackageManifest } = require("./package_manifest");
const { reportPackageDir } = require("./sdk");

const LINKED_PACKAGE_SCHEMA_VERSION = "0.16";

async function buildLinkedPackage(packageDir, output, options = {}) {
  const base = path.resolve(packageDir);
  const manifest = validatePackageManifest(base, { built: false });
  const metadata = normalizePackageMetadata(manifest);
  const profile = options.profile;
  const linkPlan = createPackageLinkPlan(base, { profile, releaseCandidate: options.releaseCandidate });
  if (linkPlan.status === "fail") {
    const err = new Error("cannot build linked package: link plan failed");
    err.report = linkedBuildReport(linkPlan, null, null, { status: "fail" });
    throw err;
  }

  const packageReport = reportPackageDir(base, {
    profile,
    releaseCandidate: options.releaseCandidate
  });
  const merged = mergePackageModules(base, metadata, packageReport, linkPlan);
  const wat = withPackageExportWrappers(lowerToWat(merged.module), merged.exportWrappers);
  const linkedWatHash = fingerprintText(wat);
  const emit = options.emit || (String(output).endsWith(".wat") ? "wat" : "wasm");
  const outPath = path.resolve(output);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  let linkedWasmHash = null;
  if (emit === "wat") {
    fs.writeFileSync(outPath, wat);
  } else if (emit === "wasm") {
    const wasm = await watToWasm(wat, `${metadata.name || "package"}.linked.wat`);
    linkedWasmHash = fingerprintBuffer(wasm);
    fs.writeFileSync(outPath, wasm);
  } else {
    throw new Error(`unsupported linked package emit format: ${emit}`);
  }
  const sidecar = `${outPath}.link.json`;
  const report = linkedBuildReport(linkPlan, linkedWatHash, linkedWasmHash, {
    status: removeLinkedDeferredStatus(linkPlan),
    outputFormat: emit,
    outputPath: path.basename(outPath),
    profile,
    packageExports: merged.exportWrappers.map((item) => ({
      name: item.name,
      module: item.module,
      function: item.function,
      targetSymbol: item.targetSymbol,
      targetWasmName: item.targetWasmName
    }))
  });
  fs.writeFileSync(sidecar, `${stableStringify(report)}\n`);
  return { output: outPath, sidecar, wat, report };
}

function mergePackageModules(base, metadata, packageReport, linkPlan) {
  const symbolByKey = new Map(linkPlan.symbols.map((symbol) => [symbolKey(symbol.module, symbol.kind, symbol.sourceName), symbol]));
  const modules = [];
  for (const rel of linkPlan.moduleOrder) {
    const file = path.join(base, rel);
    modules.push({
      path: rel,
      ast: parseAir(fs.readFileSync(file, "utf8"), rel, { resolveSourceImports: false })
    });
  }
  const callEdges = new Map();
  for (const edge of linkPlan.crossModuleCalls || []) {
    callEdges.set(callEdgeKey(edge.fromModule, edge.fromFunction, edge.callee, edge.line), edge);
  }

  const merged = {
    name: sanitizeModuleName(metadata.name || "linked_package"),
    uses: [],
    constants: [],
    tables: [],
    capabilities: new Set(),
    explicitCapabilities: new Set(),
    generatedCapabilities: new Set(),
    effects: [],
    requires: [],
    ensures: [],
    structs: [],
    globals: [],
    externs: [],
    functions: []
  };
  const externs = new Map();
  const exportWrappers = [];

  for (const item of modules) {
    const maps = moduleRenameMaps(item.path, item.ast, symbolByKey);
    for (const cap of item.ast.capabilities || []) merged.capabilities.add(cap);
    for (const cap of item.ast.explicitCapabilities || []) merged.explicitCapabilities.add(cap);
    for (const cap of item.ast.generatedCapabilities || []) merged.generatedCapabilities.add(cap);
    merged.effects.push(...(item.ast.effects || []));
    merged.requires.push(...(item.ast.requires || []));
    merged.ensures.push(...(item.ast.ensures || []));
    if ((item.ast.structs || []).length) {
      throw new Error(`linked package first slice does not support structs yet: ${item.path}`);
    }
    for (const constant of item.ast.constants || []) {
      merged.constants.push({ ...constant, name: maps.constants.get(constant.name) });
    }
    for (const table of item.ast.tables || []) {
      merged.tables.push({
        ...table,
        name: maps.tables.get(table.name),
        values: (table.values || []).map((value) => renameArg(value, maps))
      });
    }
    for (const global of item.ast.globals || []) {
      merged.globals.push({
        ...global,
        name: maps.globals.get(global.name),
        init: { ...global.init, args: (global.init.args || []).map((arg) => renameArg(arg, maps)) }
      });
    }
    for (const ex of item.ast.externs || []) addExtern(externs, ex);
    for (const fn of item.ast.functions || []) {
      merged.functions.push(renameFunction(item.path, fn, maps, callEdges));
    }
  }
  merged.externs = Array.from(externs.values()).sort((a, b) => a.name.localeCompare(b.name));

  const exports = packageExports(linkPlan);
  const seenExportNames = new Set();
  for (const item of exports) {
    const modulePath = item.module || metadata.entry;
    const functionName = item.function || item.name;
    const target = symbolByKey.get(symbolKey(modulePath, "function", functionName));
    if (!target) throw new Error(`package export target missing: ${modulePath}:${functionName}`);
    if (seenExportNames.has(item.name)) throw new Error(`duplicate package export name: ${item.name}`);
    seenExportNames.add(item.name);
    exportWrappers.push(createExportWrapper(item.name, modulePath, functionName, target));
  }

  return { module: merged, exportWrappers };
}

function moduleRenameMaps(modulePath, mod, symbolByKey) {
  const maps = {
    functions: new Map(),
    globals: new Map(),
    tables: new Map(),
    constants: new Map()
  };
  for (const fn of mod.functions || []) maps.functions.set(fn.name, wasmSafe(symbolFor(symbolByKey, modulePath, "function", fn.name)));
  for (const global of mod.globals || []) maps.globals.set(global.name, wasmSafe(symbolFor(symbolByKey, modulePath, "global", global.name)));
  for (const table of mod.tables || []) maps.tables.set(table.name, wasmSafe(symbolFor(symbolByKey, modulePath, "table", table.name)));
  for (const constant of mod.constants || []) {
    maps.constants.set(constant.name, constantSymbol(modulePath, constant.name));
  }
  return maps;
}

function renameFunction(modulePath, fn, maps, callEdges) {
  return {
    ...fn,
    name: maps.functions.get(fn.name),
    exported: false,
    blocks: (fn.blocks || []).map((block) => ({
      ...block,
      instructions: (block.instructions || []).map((ins) => renameInstruction(modulePath, fn.name, ins, maps, callEdges))
    }))
  };
}

function renameInstruction(modulePath, functionName, ins, maps, callEdges) {
  const renamed = {
    ...ins,
    args: (ins.args || []).map((arg) => renameArg(arg, maps))
  };
  if (ins.op === "call") {
    const edge = callEdges.get(callEdgeKey(modulePath, functionName, ins.callee, ins.loc && ins.loc.line || 0));
    if (edge && edge.targetSymbol) {
      renamed.callee = wasmSafe(edge.targetSymbol);
    } else if (maps.functions.has(ins.callee)) {
      renamed.callee = maps.functions.get(ins.callee);
    } else {
      renamed.callee = ins.callee;
    }
  }
  return renamed;
}

function renameArg(arg, maps) {
  if (!arg || typeof arg !== "object") return arg;
  if (arg.kind === "symbol" && maps.constants.has(arg.name)) return { ...arg, name: maps.constants.get(arg.name) };
  if (arg.kind === "symbol" && maps.tables.has(arg.name)) return { ...arg, name: maps.tables.get(arg.name) };
  if (arg.kind === "symbol" && maps.globals.has(arg.name)) return { ...arg, name: maps.globals.get(arg.name) };
  if (arg.kind === "symbol" && maps.functions.has(arg.name)) return { ...arg, name: maps.functions.get(arg.name) };
  return arg;
}

function addExtern(externs, ex) {
  const prior = externs.get(ex.name);
  if (!prior) {
    externs.set(ex.name, ex);
    return;
  }
  const sameReturn = prior.returnType === ex.returnType;
  const sameParams = JSON.stringify(prior.params || []) === JSON.stringify(ex.params || []);
  if (!sameReturn || !sameParams) throw new Error(`host import signature mismatch for ${ex.name}`);
}

function createExportWrapper(name, modulePath, functionName, target) {
  if ((target.signature.params || []).some((param) => !isScalarType(param.type)) || !isScalarType(target.signature.returnType || "void")) {
    throw new Error(`linked package first slice supports scalar package exports only: ${modulePath}:${functionName}`);
  }
  return {
    name,
    module: modulePath,
    function: functionName,
    targetSymbol: target.mangledName,
    targetWasmName: wasmSafe(target.mangledName),
    params: target.signature.params || [],
    returnType: target.signature.returnType || "void"
  };
}

function withPackageExportWrappers(wat, wrappers) {
  if (!wrappers.length) return wat;
  const insertAt = wat.lastIndexOf("\n)");
  if (insertAt < 0) throw new Error("cannot insert package export wrappers into WAT");
  const wrapperWat = wrappers.map(exportWrapperWat).join("\n");
  return `${wat.slice(0, insertAt)}\n${wrapperWat}${wat.slice(insertAt)}`;
}

function exportWrapperWat(wrapper) {
  const params = wrapper.params.map((param, idx) => `(param $p${idx} ${watType(param.type)})`).join(" ");
  const result = wrapper.returnType === "void" ? "" : ` (result ${watType(wrapper.returnType)})`;
  const body = wrapper.params.map((_, idx) => `    local.get $p${idx}`).concat(`    call $${wrapper.targetWasmName}`);
  return [`  (func $__air_export_${wasmSafe(wrapper.name)} (export "${escapeWatString(wrapper.name)}")${params ? ` ${params}` : ""}${result}`, ...body, `  )`].join("\n");
}

function packageExports(linkPlan) {
  const explicit = linkPlan.entrypoint.packageExports || [];
  if (explicit.length) return explicit.map((item) => ({ name: item.name, module: item.module, function: item.function }));
  return (linkPlan.entrypoint.compatibilityExports || []).map((item) => ({
    name: item.name,
    module: item.module,
    function: item.function
  }));
}

function linkedBuildReport(linkPlan, linkedWatHash, linkedWasmHash, extras = {}) {
  const outputFormat = extras.outputFormat || null;
  const isWasm = outputFormat === "wasm";
  const isWat = outputFormat === "wat";
  return {
    schemaVersion: LINKED_PACKAGE_SCHEMA_VERSION,
    kind: "air.linkedPackageBuild",
    package: linkPlan.package,
    profile: extras.profile || null,
    linkedWasm: isWasm,
    linkedOutput: {
      available: Boolean(isWasm || isWat),
      kind: isWasm ? "wasm" : isWat ? "wat" : "none",
      watHash: linkedWatHash || null,
      wasmHash: linkedWasmHash || null,
      path: extras.outputPath || null
    },
    linkedWatHash,
    linkedWasmHash,
    linkPlanHash: objectFingerprint(linkPlan),
    sourceGraphHash: linkPlan.sourceGraphHash,
    graph: linkPlan.graph,
    authoredGraph: linkPlan.authoredGraph || null,
    executableGraph: linkedExecutableGraph(linkPlan.executableGraph, extras),
    authoredToExecutable: linkPlan.authoredToExecutable || [],
    ownershipMap: linkPlan.ownershipMap || null,
    linkDiagnostics: linkPlan.linkDiagnostics || [],
    generatedExecutableFreshness: linkPlan.generatedExecutableFreshness || null,
    moduleOrder: linkPlan.moduleOrder,
    crossModuleCalls: linkPlan.crossModuleCalls || [],
    symbols: linkedSymbolReport(linkPlan.symbols),
    packageExports: extras.packageExports || [],
    hostImports: linkPlan.hostImports,
    capabilities: linkPlan.capabilities,
    generatedArtifacts: linkPlan.generatedArtifacts,
    staticTables: linkPlan.staticTables,
    abiImpact: linkedBuildAbiImpact(linkPlan.abiImpact),
    diagnostics: removeLinkedDeferredDiagnostics(linkPlan.diagnostics),
    status: extras.status || removeLinkedDeferredStatus(linkPlan),
    outputFormat
  };
}

function linkedExecutableGraph(executableGraph, extras = {}) {
  if (!executableGraph) return null;
  return {
    ...executableGraph,
    status: extras.status || executableGraph.status || "derived",
    linkedOutput: {
      available: Boolean(extras.outputFormat),
      kind: extras.outputFormat || (executableGraph.linkedOutput && executableGraph.linkedOutput.kind) || "metadata",
      path: extras.outputPath || null
    }
  };
}

function linkedSymbolReport(symbols = []) {
  return symbols.map((symbol) => {
    const out = { ...symbol };
    if (["function", "global", "table"].includes(symbol.kind)) out.wasmName = wasmSafe(symbol.mangledName);
    return out;
  });
}

function linkedBuildAbiImpact(linkPlanAbiImpact = {}) {
  return {
    airAbi: linkPlanAbiImpact.airAbi || "0.10",
    airAbiBumpRequired: false,
    hostAbi: linkPlanAbiImpact.hostAbi || "0.10",
    hostAbiBumpRequired: false,
    rationale: "linked output uses existing AIR ABI 0.10 scalar Wasm import/export/memory conventions and does not require an ABI bump in this first slice"
  };
}

function removeLinkedDeferredStatus(linkPlan) {
  const diagnostics = removeLinkedDeferredDiagnostics(linkPlan.diagnostics);
  if (diagnostics.errors.length || (linkPlan.status === "fail")) return "fail";
  if (diagnostics.warnings.length || diagnostics.diagnostics.some((item) => item.severity === "warn")) return "warn";
  return "pass";
}

function removeLinkedDeferredDiagnostics(diagnostics) {
  const isDeferred = (item) => item && item.code === "air.package.linked_wasm_deferred";
  return {
    errors: (diagnostics && diagnostics.errors || []).slice().sort(),
    warnings: (diagnostics && diagnostics.warnings || []).filter((item) => !/linked multi-module Wasm output is deferred/i.test(item)).sort(),
    moduleDiagnostics: diagnostics && diagnostics.moduleDiagnostics || [],
    diagnostics: (diagnostics && diagnostics.diagnostics || []).filter((item) => !isDeferred(item))
  };
}

function symbolFor(symbolByKey, modulePath, kind, name) {
  const found = symbolByKey.get(symbolKey(modulePath, kind, name));
  if (found) return found.mangledName;
  return mangleSymbol(modulePath, kind, name);
}

function constantSymbol(modulePath, name) {
  return wasmSafe(`__air$${moduleIdForPath(modulePath)}$const$${name}$${shortHash(`${modulePath}\0const\0${name}`)}`);
}

function callEdgeKey(modulePath, functionName, callee, line) {
  return `${modulePath}\0${functionName}\0${callee}\0${line || 0}`;
}

function wasmSafe(name) {
  return String(name || "symbol").replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+/, "_") || "_symbol";
}

function sanitizeModuleName(name) {
  const safe = String(name || "linked_package").replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  return /^[A-Za-z_]/.test(safe) ? safe : `_${safe}`;
}

function isScalarType(type) {
  return ["void", "i32", "i64", "f32", "f64", "bool", "ptr", "slice"].includes(type);
}

function watType(type) {
  if (["i32", "bool", "ptr", "slice"].includes(type)) return "i32";
  if (type === "i64") return "i64";
  if (type === "f32") return "f32";
  if (type === "f64") return "f64";
  throw new Error(`cannot lower linked package export type ${type}`);
}

function escapeWatString(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function fingerprintText(value) {
  return `sha256:${crypto.createHash("sha256").update(String(value)).digest("hex")}`;
}

function fingerprintBuffer(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function objectFingerprint(value) {
  return fingerprintText(stableStringify(value));
}

function shortHash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 8);
}

module.exports = {
  LINKED_PACKAGE_SCHEMA_VERSION,
  buildLinkedPackage,
  linkedBuildReport
};
