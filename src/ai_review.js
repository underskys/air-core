const { normalizeDiagnostic } = require("./diagnostics");

const DEFAULT_AI_REVIEW_THRESHOLDS = Object.freeze({
  repeatedLiteralCount: 3,
  magicHostLiteralMinAbs: 2,
  largeModuleLines: 220,
  largeModuleStatements: 180,
  largeFunctionStatements: 80,
  largeFunctionBlocks: 20,
  tableLikeGroupSize: 3,
  maxExportedEntryStatements: 80,
  maxMutableGlobalsPerModule: 64,
  topItemsLimit: 5
});

function createAiReviewReport(mod, options = {}) {
  const thresholds = { ...DEFAULT_AI_REVIEW_THRESHOLDS, ...normalizeThresholdAliases(options.thresholds || {}) };
  const source = typeof options.source === "string" ? options.source : "";
  const warnings = [];
  const repairHints = [];
  const literalStats = collectLiteralStats(mod);
  const usage = collectUsage(mod);
  const metrics = moduleMetrics(mod, source);
  const repeatedLiterals = repeatedLiteralCounts(literalStats, thresholds);
  const magicHandleCandidates = magicHostLiterals(mod, thresholds);
  const unused = unusedItems(mod, usage);
  const tablePatterns = tableLikePatterns(mod, thresholds);
  const selectChainTables = selectChainAsTablePatterns(mod, thresholds);
  const debugMetricEvents = suspiciousDebugMetrics(mod);
  const packageProfileMismatch = packageMismatch(options.packageReport);
  const entryFrameBudget = exportedEntryFrameBudget(metrics, thresholds);
  const mutableGlobalBudget = mutableGlobalsBudget(metrics, thresholds);
  const topLargeFunctions = metrics.functionsDetail
    .slice()
    .sort((a, b) => b.statements - a.statements || b.blocks - a.blocks || a.name.localeCompare(b.name))
    .slice(0, thresholds.topItemsLimit);
  const topLargeModules = [{
    module: mod.name,
    lines: metrics.lines,
    statements: metrics.statements,
    functions: metrics.functions,
    globals: metrics.globals
  }];

  if (metrics.lines >= thresholds.largeModuleLines || metrics.statements >= thresholds.largeModuleStatements) {
    addWarning(warnings, repairHints, {
      id: "large-module",
      severity: "warn",
      message: `module has ${metrics.lines} line(s) and ${metrics.statements} statement(s)`,
      repairHint: "split package-local modules or move generated static data into static scalar tables"
    });
  }
  for (const fn of metrics.functionsDetail) {
    if (fn.statements >= thresholds.largeFunctionStatements || fn.blocks >= thresholds.largeFunctionBlocks) {
      addWarning(warnings, repairHints, {
        id: `large-function:${fn.name}`,
        severity: "warn",
        message: `function ${fn.name} has ${fn.statements} statement(s) and ${fn.blocks} block(s)`,
        repairHint: "split the function into smaller exported/private helpers while preserving explicit effects and capabilities",
        fields: {
          function: fn.name,
          metric: "statements",
          value: fn.statements,
          threshold: thresholds.largeFunctionStatements
        }
      });
    }
  }
  for (const item of entryFrameBudget) {
    addWarning(warnings, repairHints, {
      id: `entry-frame-budget:${item.function}`,
      severity: "warn",
      message: `exported entry/frame function ${item.function} has ${item.statements} statement(s), budget ${thresholds.maxExportedEntryStatements}`,
      repairHint: "keep exported entry/frame functions as orchestration shells and move subsystem logic into package-local modules or helpers",
      fields: {
        function: item.function,
        metric: "statements",
        value: item.statements,
        threshold: thresholds.maxExportedEntryStatements
      }
    });
  }
  if (mutableGlobalBudget) {
    addWarning(warnings, repairHints, {
      id: "mutable-global-budget",
      severity: "warn",
      message: `module has ${metrics.globals} mutable global(s), budget ${thresholds.maxMutableGlobalsPerModule}`,
      repairHint: "move static values to constants/tables and split mutable state by package-local module ownership"
    });
  }
  for (const item of repeatedLiterals) {
    addWarning(warnings, repairHints, {
      id: `repeated-literal:${item.kind}:${item.value}`,
      severity: "warn",
      message: `literal ${item.value} appears ${item.count} time(s)`,
      repairHint: "introduce a module constant or generated package-local handle instead of repeating the literal"
    });
  }
  if (magicHandleCandidates.length) {
    addWarning(warnings, repairHints, {
      id: "magic-host-literals",
      severity: "warn",
      message: `${magicHandleCandidates.length} host call literal candidate(s) may be magic handles or IDs`,
      repairHint: "use generated handles or named module constants for manifest-backed IDs, material IDs, metric IDs, and asset handles"
    });
  }
  if (unused.externs.length || unused.constants.length || unused.imports.length) {
    addWarning(warnings, repairHints, {
      id: "unused-public-surface",
      severity: "warn",
      message: `unused declarations: externs=${unused.externs.length}, constants=${unused.constants.length}, imports=${unused.imports.length}`,
      repairHint: "remove unused declarations or connect them to verified behavior before review"
    });
  }
  if (tablePatterns.length) {
    addWarning(warnings, repairHints, {
      id: "table-like-patterns",
      severity: "warn",
      message: `${tablePatterns.length} repeated indexed naming pattern(s) look like static scalar tables`,
      repairHint: "classify repeated indexed data before changing it: readonly related static data belongs in readonly tablegroups; mutable repeated state belongs to future declared pools; generated IDs belong in generated handles; command streams belong in command buffers"
    });
  }
  if (selectChainTables.length) {
    addWarning(warnings, repairHints, {
      id: "select-chain-as-table",
      severity: "warn",
      message: `${selectChainTables.length} select-chain pattern(s) look like table lookups encoded as branches`,
      repairHint: "replace repeated select chains with static read-only scalar data. Consider a readonly tablegroup if these values are related by row."
    });
  }
  if (debugMetricEvents.length) {
    addWarning(warnings, repairHints, {
      id: "debug-metric-event-bus",
      severity: "warn",
      message: `${debugMetricEvents.length} debug.metric call(s) look event-like`,
      repairHint: "keep debug.metric diagnostic only; use explicit capability-qualified event ABI only after it is accepted",
      fields: {
        eventCount: debugMetricEvents.length,
        functions: Array.from(new Set(debugMetricEvents.map((item) => item.function))).sort(),
        events: debugMetricEvents
      }
    });
  }
  if (packageProfileMismatch && packageProfileMismatch.status !== "pass") {
    addWarning(warnings, repairHints, {
      id: "package-profile-mismatch",
      severity: packageProfileMismatch.status === "fail" ? "error" : "warn",
      message: "package/profile compatibility report contains unsupported or hidden-authority diagnostics",
      repairHint: "declare missing capabilities, remove unsupported imports/manifests/assets, or choose a compatible host profile"
    });
  }

  const sortedWarnings = sortWarnings(warnings);
  return {
    version: "0.15",
    status: packageProfileMismatch && packageProfileMismatch.status === "fail" ? "fail" : (sortedWarnings.length ? "warn" : "pass"),
    reviewPolicy: {
      profile: (options.reviewPolicy && options.reviewPolicy.profile) || null,
      pathClass: (options.reviewPolicy && options.reviewPolicy.pathClass) || null,
      gates: (options.reviewPolicy && options.reviewPolicy.gates) || {}
    },
    thresholds,
    metrics: {
      lines: metrics.lines,
      statements: metrics.statements,
      functions: metrics.functions,
      blocks: metrics.blocks,
      constants: metrics.constants,
      tables: metrics.tables,
      globals: metrics.globals,
      externs: metrics.externs,
      functionsDetail: metrics.functionsDetail
    },
    capabilities: Array.from(mod.capabilities || []).sort(),
    hostImports: hostImports(mod),
    effectBudgetSummary: effectBudgetSummary(mod),
    repeatedLiterals,
    magicHandleCandidates,
    unused,
    largeFunctions: metrics.functionsDetail.filter((fn) => fn.statements >= thresholds.largeFunctionStatements || fn.blocks >= thresholds.largeFunctionBlocks),
    entryFrameBudget,
    mutableGlobalBudget,
    topLargeFunctions,
    topLargeModules,
    tableLikePatterns: tablePatterns,
    selectChainAsTablePatterns: selectChainTables,
    debugMetricEvents,
    packageProfileMismatch,
    warnings: sortedWarnings,
    repairHints: Array.from(new Set(repairHints)).sort()
  };
}

function normalizeThresholdAliases(thresholds) {
  const out = { ...thresholds };
  if (Number.isFinite(out.largeEntryStatements) && !Number.isFinite(out.maxExportedEntryStatements)) {
    out.maxExportedEntryStatements = out.largeEntryStatements;
  }
  if (Number.isFinite(out.mutableGlobalsPerModule) && !Number.isFinite(out.maxMutableGlobalsPerModule)) {
    out.maxMutableGlobalsPerModule = out.mutableGlobalsPerModule;
  }
  return out;
}

function exportedEntryFrameBudget(metrics, thresholds) {
  if (!Number.isFinite(thresholds.maxExportedEntryStatements)) return [];
  return metrics.functionsDetail
    .filter((fn) => fn.exported && /^(run|main|frame|update|tick|step)$/i.test(fn.name))
    .filter((fn) => fn.statements >= thresholds.maxExportedEntryStatements)
    .map((fn) => ({
      function: fn.name,
      statements: fn.statements,
      budget: thresholds.maxExportedEntryStatements
    }))
    .sort((a, b) => b.statements - a.statements || a.function.localeCompare(b.function));
}

function mutableGlobalsBudget(metrics, thresholds) {
  if (!Number.isFinite(thresholds.maxMutableGlobalsPerModule)) return null;
  if (metrics.globals <= thresholds.maxMutableGlobalsPerModule) return null;
  return {
    globals: metrics.globals,
    budget: thresholds.maxMutableGlobalsPerModule
  };
}

function moduleMetrics(mod, source) {
  const functionsDetail = (mod.functions || []).map((fn) => ({
    name: fn.name,
    exported: Boolean(fn.exported),
    statements: (fn.blocks || []).reduce((sum, block) => sum + (block.instructions || []).length, 0),
    blocks: (fn.blocks || []).length
  })).sort((a, b) => a.name.localeCompare(b.name));
  return {
    lines: source ? source.split(/\r?\n/).filter((line) => line.trim()).length : maxLine(mod),
    statements: functionsDetail.reduce((sum, fn) => sum + fn.statements, 0),
    functions: (mod.functions || []).length,
    blocks: functionsDetail.reduce((sum, fn) => sum + fn.blocks, 0),
    constants: (mod.constants || []).length,
    tables: (mod.tables || []).length,
    globals: (mod.globals || []).length,
    externs: (mod.externs || []).length,
    functionsDetail
  };
}

function collectLiteralStats(mod) {
  const out = new Map();
  const add = (arg, context) => {
    if (!arg || !["number", "bool", "string"].includes(arg.kind)) return;
    const key = `${arg.kind}:${arg.raw || String(arg.value)}`;
    const existing = out.get(key) || { kind: arg.kind, value: arg.raw || String(arg.value), count: 0, contexts: [] };
    existing.count += 1;
    existing.contexts.push(context);
    out.set(key, existing);
  };
  for (const constant of mod.constants || []) add(constant.value, `const:${constant.name}`);
  for (const global of mod.globals || []) for (const arg of (global.init && global.init.args) || []) add(arg, `global:${global.name}`);
  forEachInstruction(mod, (fn, block, ins) => {
    for (const arg of ins.args || []) add(arg, `${fn.name}:${block.label}:${ins.op}`);
  });
  return Array.from(out.values()).sort((a, b) => a.kind.localeCompare(b.kind) || String(a.value).localeCompare(String(b.value)));
}

function repeatedLiteralCounts(literalStats, thresholds) {
  return literalStats
    .filter((item) => item.count >= thresholds.repeatedLiteralCount && !isTrivialLiteral(item))
    .map((item) => ({
      kind: item.kind,
      value: item.value,
      count: item.count,
      contexts: item.contexts.slice(0, 5).sort()
    }))
    .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind) || String(a.value).localeCompare(String(b.value)));
}

function magicHostLiterals(mod, thresholds) {
  const externs = new Set((mod.externs || []).map((ex) => ex.name));
  const out = new Map();
  forEachInstruction(mod, (fn, block, ins) => {
    if (ins.op !== "call" || !externs.has(ins.callee) || !isHostImport(ins.callee)) return;
    (ins.args || []).forEach((arg, index) => {
      if (!arg || arg.kind !== "number") return;
      if (Math.abs(arg.value) < thresholds.magicHostLiteralMinAbs) return;
      const key = `${ins.callee}:${index}:${arg.raw || arg.value}`;
      const existing = out.get(key) || {
        callee: ins.callee,
        argIndex: index,
        value: arg.raw || String(arg.value),
        count: 0,
        contexts: []
      };
      existing.count += 1;
      existing.contexts.push(`${fn.name}:${block.label}`);
      out.set(key, existing);
    });
  });
  return Array.from(out.values()).sort((a, b) => a.callee.localeCompare(b.callee) || a.argIndex - b.argIndex || String(a.value).localeCompare(String(b.value)));
}

function collectUsage(mod) {
  const called = new Set();
  const symbols = new Set();
  forEachInstruction(mod, (_fn, _block, ins) => {
    if (ins.op === "call") called.add(ins.callee);
    for (const arg of ins.args || []) {
      if (arg.kind === "symbol") symbols.add(arg.name);
      if (arg.kind === "function") called.add(arg.name);
    }
  });
  for (const table of mod.tables || []) {
    for (const value of table.values || []) {
      if (value.kind === "symbol") symbols.add(value.name);
    }
  }
  for (const global of mod.globals || []) {
    for (const arg of (global.init && global.init.args) || []) {
      if (arg.kind === "symbol") symbols.add(arg.name);
    }
  }
  return { called, symbols };
}

function unusedItems(mod, usage) {
  const importedSources = new Set();
  for (const group of [mod.constants, mod.externs, mod.functions, mod.structs]) {
    for (const item of group || []) if (item.importedFrom) importedSources.add(item.importedFrom);
  }
  const usedImportAliases = new Set();
  for (const callee of usage.called || []) {
    const alias = String(callee || "").split(".")[0];
    if (alias && alias !== callee) usedImportAliases.add(alias);
  }
  return {
    externs: (mod.externs || []).filter((ex) => !ex.generated && !ex.importedFrom && !usage.called.has(ex.name)).map((ex) => ex.name).sort(),
    constants: (mod.constants || []).filter((constant) => !constant.importedFrom && !usage.symbols.has(constant.name)).map((constant) => constant.name).sort(),
    imports: (mod.uses || [])
      .filter((use) => use.kind === "source" && !importedSources.has(use.name) && !(use.alias && usedImportAliases.has(use.alias)))
      .map((use) => use.name)
      .sort()
  };
}

function tableLikePatterns(mod, thresholds) {
  const names = [];
  for (const constant of mod.constants || []) names.push(`const:${constant.name}`);
  for (const global of mod.globals || []) names.push(`global:${global.name}`);
  forEachInstruction(mod, (fn, _block, ins) => {
    if (ins.result && ins.op.startsWith("const.")) names.push(`local:${fn.name}:${ins.result.slice(1)}`);
  });
  const groups = new Map();
  for (const name of names) {
    const parsed = parseIndexedName(name);
    if (!parsed) continue;
    const key = `${parsed.scope}\0${parsed.prefix}\0${parsed.suffix}`;
    const existing = groups.get(key) || [];
    existing.push(parsed.name);
    groups.set(key, existing);
  }
  return Array.from(groups.entries())
    .filter(([, values]) => values.length >= thresholds.tableLikeGroupSize)
    .map(([key, values]) => {
      const [, prefix, suffix] = key.split("\0");
      return { prefix, suffix, count: values.length, names: values.sort() };
    })
    .sort((a, b) => b.count - a.count || a.prefix.localeCompare(b.prefix) || a.suffix.localeCompare(b.suffix));
}

function selectChainAsTablePatterns(mod, thresholds) {
  const out = [];
  for (const func of mod.functions || []) {
    const selects = [];
    for (const block of func.blocks || []) {
      for (const ins of block.instructions || []) {
        if (!/^select\.(i32|f32)$/.test(ins.op)) continue;
        const literalValues = (ins.args || [])
          .slice(1)
          .filter((arg) => arg && (arg.kind === "number" || arg.kind === "bool"))
          .map((arg) => arg.raw || String(arg.value));
        if (!literalValues.length) continue;
        selects.push({
          result: ins.result || null,
          block: block.label,
          op: ins.op,
          literalValues
        });
      }
    }
    if (selects.length < thresholds.tableLikeGroupSize) continue;
    const text = [
      func.name,
      ...selects.map((item) => `${item.result || ""} ${item.literalValues.join(" ")}`)
    ].join(" ");
    const generatedCandidate = /asset|material|\bmat|sprite|level|handle|id/i.test(text);
    out.push({
      function: func.name,
      count: selects.length,
      valueSamples: Array.from(new Set(selects.flatMap((item) => item.literalValues))).slice(0, 8).sort(),
      generatedCandidate,
      suggestion: generatedCandidate ? "generated static table module" : "static scalar table",
      selects: selects.slice(0, 8)
    });
  }
  return out.sort((a, b) => b.count - a.count || a.function.localeCompare(b.function));
}

function suspiciousDebugMetrics(mod) {
  const out = [];
  forEachInstruction(mod, (fn, block, ins) => {
    if (ins.op !== "call" || ins.callee !== "debug.metric") return;
    const valueArg = (ins.args || [])[1];
    const idArg = (ins.args || [])[0];
    const idText = argText(idArg);
    const valueText = argText(valueArg);
    const eventLikeName = /event|action|play|sfx|sound|shoot|hit|jump|open|close|state/i.test(`${idText} ${valueText}`);
    const pulseLiteral = valueArg && valueArg.kind === "number" && (valueArg.value === 0 || valueArg.value === 1);
    if (eventLikeName || pulseLiteral) {
      out.push({
        function: fn.name,
        block: block.label,
        metric: idText,
        value: valueText,
        reason: pulseLiteral ? "literal pulse value" : "event-like metric name"
      });
    }
  });
  return out.sort((a, b) => a.function.localeCompare(b.function) || a.block.localeCompare(b.block) || String(a.metric).localeCompare(String(b.metric)));
}

function packageMismatch(packageReport) {
  if (!packageReport) return null;
  const unsupportedCapabilities = (((packageReport.profileSupport || {}).capabilities || {}).unsupported || packageReport.capabilities && packageReport.capabilities.unsupported || []).slice().sort();
  const unsupportedHostImports = (((packageReport.profileSupport || {}).hostImports || {}).unsupported || packageReport.hostImports && packageReport.hostImports.unsupported || []).slice().sort();
  const unsupportedManifestKinds = (((packageReport.profileSupport || {}).manifestKinds || {}).unsupported || []).slice().sort();
  const unsupportedAssetKinds = (((packageReport.profileSupport || {}).assetKinds || {}).unsupported || packageReport.assetKinds && packageReport.assetKinds.unsupported || []).slice().sort();
  const hiddenAuthority = (packageReport.hiddenAuthority || []).slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const status = packageReport.status === "fail" || unsupportedCapabilities.length || unsupportedHostImports.length || unsupportedManifestKinds.length || unsupportedAssetKinds.length || hiddenAuthority.length ? "fail" : (packageReport.status === "warn" ? "warn" : "pass");
  return {
    status,
    unsupportedCapabilities,
    unsupportedHostImports,
    unsupportedManifestKinds,
    unsupportedAssetKinds,
    hiddenAuthority
  };
}

function effectBudgetSummary(mod) {
  const moduleEffects = (mod.effects || []).map(formatEffect).sort();
  const functionEffects = (mod.functions || [])
    .filter((fn) => (fn.effects || []).length)
    .map((fn) => ({ function: fn.name, effects: (fn.effects || []).map(formatEffect).sort() }))
    .sort((a, b) => a.function.localeCompare(b.function));
  return { module: moduleEffects, functions: functionEffects };
}

function hostImports(mod) {
  return (mod.externs || [])
    .filter((ex) => !ex.generated && isHostImport(ex.name))
    .map((ex) => ex.name)
    .sort();
}

function forEachInstruction(mod, fn) {
  for (const func of mod.functions || []) {
    for (const block of func.blocks || []) {
      for (const ins of block.instructions || []) fn(func, block, ins);
    }
  }
}

function isHostImport(name) {
  return /^[A-Za-z_][A-Za-z0-9_]*\./.test(name);
}

function isTrivialLiteral(item) {
  if (item.kind === "bool") return true;
  if (item.kind !== "number") return false;
  const value = Number(item.value);
  return value === -1 || value === 0 || value === 1;
}

function parseIndexedName(raw) {
  const parts = raw.split(":");
  const name = parts.pop();
  const scope = parts.join(":");
  const match = name.match(/^(.+?)(?:_|)(\d+)(?:_|)([A-Za-z][A-Za-z0-9_]*)?$/);
  if (!match) return null;
  return { scope, name, prefix: match[1].replace(/_$/, ""), index: Number(match[2]), suffix: match[3] || "" };
}

function formatEffect(effect) {
  return `${effect.key}${effect.op || "<="}${effect.limit}`;
}

function argText(arg) {
  if (!arg) return "?";
  if (arg.kind === "value" || arg.kind === "symbol") return arg.name;
  if (arg.kind === "number" || arg.kind === "bool" || arg.kind === "string") return arg.raw || String(arg.value);
  if (arg.kind === "function") return `@${arg.name}`;
  if (arg.kind === "phi") return arg.raw || `${arg.label}:${arg.value}`;
  return "?";
}

function maxLine(mod) {
  let max = 0;
  const visit = (item) => {
    if (item && item.loc && Number.isFinite(item.loc.line)) max = Math.max(max, item.loc.line);
  };
  for (const group of [mod.uses, mod.constants, mod.globals, mod.externs, mod.functions]) {
    for (const item of group || []) visit(item);
  }
  forEachInstruction(mod, (_fn, block, ins) => {
    visit(block);
    visit(ins);
  });
  return max;
}

function addWarning(warnings, repairHints, warning) {
  const diagnostic = normalizeDiagnostic({
    ...warning,
    legacyId: warning.id,
    source: "ai-review",
    fields: warning.fields || fieldsForWarning(warning)
  });
  warnings.push({
    ...warning,
    code: diagnostic.code,
    category: diagnostic.category,
    diagnostic
  });
  repairHints.push(warning.repairHint);
}

function sortWarnings(warnings) {
  return warnings.slice().sort((a, b) => a.id.localeCompare(b.id) || a.message.localeCompare(b.message));
}

function fieldsForWarning(warning) {
  const id = warning.id || "";
  const fields = {};
  const parts = id.split(":");
  if (id.startsWith("large-function:")) fields.function = parts.slice(1).join(":");
  if (id.startsWith("entry-frame-budget:")) fields.function = parts.slice(1).join(":");
  if (id.startsWith("repeated-literal:")) {
    fields.literalKind = parts[1] || null;
    fields.literal = parts.slice(2).join(":") || null;
  }
  return fields;
}

module.exports = {
  DEFAULT_AI_REVIEW_THRESHOLDS,
  createAiReviewReport
};
