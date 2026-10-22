const crypto = require("crypto");
const { assuranceProfileUnsupported, isTypedV053Ast } = require("./errors");

const FLOW_LABELS = Object.freeze(["public", "internal", "sensitive", "restricted"]);
const FLOW_LABEL_INDEX = new Map(FLOW_LABELS.map((label, index) => [label, index]));
const FLOW_LIMITS = Object.freeze({
  maxSourcesPerValue: 32,
  maxDependencyPathLength: 64,
  maxNodesPerFunction: 2048,
  maxNodesPerPackage: 16384,
  maxFunctions: 256,
  maxDeclassifiers: 32,
  maxFixedPointRises: 3
});
const FLOW_ANALYZER_VERSION = "1.0";
const FLOW_ANALYZER_DOMAIN = "AIR_PROVENANCE_FLOW_ANALYZER_V1";
const FLOW_POLICY_DOMAIN = "AIR_PROVENANCE_FLOW_POLICY_V1";
const FLOW_SUMMARY_DOMAIN = "AIR_PROVENANCE_FLOW_SUMMARY_V1";
const FLOW_UNSUPPORTED_CHANNELS = Object.freeze([
  "timing",
  "termination",
  "covert",
  "microarchitectural",
  "host-side-flow-after-boundary",
  "semantic-correctness-of-declassification",
  "per-element-array-labels",
  "per-byte-region-labels"
]);

class ProvenanceFlowError extends Error {
  constructor(diagnostics, evidence = null) {
    const first = (diagnostics || [])[0];
    super(first ? `${first.code}: ${first.message}` : "air.flow.forbidden: provenance flow verification failed");
    this.name = "ProvenanceFlowError";
    this.diagnostics = diagnostics || [];
    this.errors = this.diagnostics.map((item) => `${item.code}: ${item.message}`);
    this.evidence = evidence;
    this.loc = first && first.loc ? first.loc : null;
  }
}

function analyzeProvenanceModule(mod, options = {}) {
  // R-ASSUR-1 floor (OPEN-30 (a)): never `not_enabled` for a typed-v0.53 AST.
  if (isTypedV053Ast(mod)) throw assuranceProfileUnsupported("analyzeProvenanceModule");
  return analyzeProvenancePackage([{
    path: options.path || modulePath(mod),
    mod,
    imports: options.imports || []
  }], options.policy || null, options.context || {});
}

function analyzeProvenancePackage(records, policy = null, context = {}) {
  if ((Array.isArray(records) ? records : []).some((record) => record && isTypedV053Ast(record.mod))) {
    throw assuranceProfileUnsupported("analyzeProvenancePackage");
  }
  const normalizedRecords = (records || []).map((record) => ({
    path: normalizePath(record.path || modulePath(record.mod)),
    mod: record.mod,
    imports: (record.imports || []).map((item) => ({
      alias: item.alias || item.moduleName || null,
      relative: normalizePath(item.relative || item.path || "")
    })).sort((a, b) => String(a.alias).localeCompare(String(b.alias)) || a.relative.localeCompare(b.relative))
  })).sort((a, b) => a.path.localeCompare(b.path));
  const normalizedPolicy = normalizePolicy(policy);
  const enabled = normalizedPolicy.mode === "required" || normalizedRecords.some((record) =>
    (record.mod.flowDeclarations || []).some((item) => item.kind === "policy" && item.mode === "required"));
  if (!enabled) return disabledEvidence();

  const state = createAnalysisState(normalizedRecords, normalizedPolicy, context);
  validatePackageShape(state);
  if (!state.diagnostics.some((item) => item.severity === "fail")) analyzeEntryFunctions(state);
  return finalizeEvidence(state);
}

function assertProvenanceFlow(evidence) {
  if (evidence && evidence.status === "failed") throw new ProvenanceFlowError(evidence.diagnostics, evidence);
  return evidence;
}

function createAnalysisState(records, policy, context) {
  const recordByPath = new Map(records.map((record) => [record.path, record]));
  const recordByModule = new Map(records.map((record) => [record.mod.name, record]));
  const functions = new Map();
  for (const record of records) {
    for (const fn of record.mod.functions || []) functions.set(`${record.path}\0${fn.name}`, { record, fn });
  }
  return {
    records,
    recordByPath,
    recordByModule,
    functions,
    policy,
    context: normalizeContext(context),
    diagnostics: [],
    diagnosticKeys: new Set(),
    sources: [],
    sinks: [],
    acceptedFlows: [],
    rejectedFlows: [],
    declassifications: [],
    analyzedFunctions: new Set(),
    packageNodeCount: 0,
    analyzerDigest: digest(FLOW_ANALYZER_DOMAIN, {
      version: FLOW_ANALYZER_VERSION,
      lattice: FLOW_LABELS,
      limits: FLOW_LIMITS,
      unsupportedChannels: FLOW_UNSUPPORTED_CHANNELS
    }),
    policyDigest: digest(FLOW_POLICY_DOMAIN, policy)
  };
}

function validatePackageShape(state) {
  if (state.records.length === 0) {
    addDiagnostic(state, flowDiagnostic("air.flow.policy_invalid", "required provenance policy has no AIR modules"));
    return;
  }
  if (state.records.length > FLOW_LIMITS.maxFunctions) {
    addDiagnostic(state, flowDiagnostic("air.flow.analysis_budget_exceeded", `package has too many modules for bounded provenance analysis: ${state.records.length}`));
  }
  if (state.functions.size > FLOW_LIMITS.maxFunctions) {
    addDiagnostic(state, flowDiagnostic("air.flow.analysis_budget_exceeded", `package has ${state.functions.size} functions; maximum is ${FLOW_LIMITS.maxFunctions}`));
  }
  const declassifiers = state.records.flatMap((record) =>
    declarations(record.mod, "declassifier").map((item) => ({ record, item })));
  if (declassifiers.length > FLOW_LIMITS.maxDeclassifiers) {
    addDiagnostic(state, flowDiagnostic("air.flow.analysis_budget_exceeded", `package has ${declassifiers.length} declassifiers; maximum is ${FLOW_LIMITS.maxDeclassifiers}`));
  }
  for (const source of state.context.missingSourceLabels) {
    addDiagnostic(state, flowDiagnostic("air.flow.source_missing", `package source '${source}' requires an explicit schema flowLabel`, null, { source }));
  }
  for (const sink of state.context.missingOutputLabels) {
    addDiagnostic(state, flowDiagnostic("air.flow.sink_missing", `output-contract sink '${sink}' requires an explicit flowLabel`, null, { sink }));
  }
  for (const record of state.records) validateModuleDeclarations(state, record);
  validatePolicyBindings(state);
}

function validateModuleDeclarations(state, record) {
  const mod = record.mod;
  const declarationsList = mod.flowDeclarations || [];
  const policyDeclarations = declarationsList.filter((item) => item.kind === "policy");
  if (policyDeclarations.length !== 1 || policyDeclarations[0].mode !== "required") {
    addDiagnostic(state, flowDiagnostic(
      "air.flow.policy_invalid",
      `module '${mod.name}' must contain exactly one 'flow policy required' declaration`,
      policyDeclarations[0]?.loc,
      { module: record.path }
    ));
  }
  const seen = new Set();
  for (const declaration of declarationsList) {
    const key = declarationKey(declaration);
    if (seen.has(key)) {
      addDiagnostic(state, flowDiagnostic("air.flow.policy_invalid", `duplicate flow declaration '${key}'`, declaration.loc, { module: record.path }));
    }
    seen.add(key);
    if (declaration.label && !isLabel(declaration.label)) {
      addDiagnostic(state, flowDiagnostic("air.flow.label_invalid", `unknown flow label '${declaration.label}'`, declaration.loc, { module: record.path }));
    }
  }

  const functions = new Map((mod.functions || []).map((fn) => [fn.name, fn]));
  const externs = new Map((mod.externs || []).map((item) => [item.name, item]));
  const globals = new Map((mod.globals || []).map((item) => [item.name, item]));
  const states = new Map((mod.states || []).map((item) => [item.name, item]));
  const pools = new Map((mod.pools || []).map((item) => [item.name, item]));

  for (const declaration of declarationsList) {
    if (declaration.kind === "source_param") {
      const fn = functions.get(declaration.function);
      if (!fn || !(fn.params || []).some((param) => param.name === declaration.param)) {
        addDiagnostic(state, unresolved(record, declaration, `source param '${declaration.function}.${declaration.param}'`));
      }
    } else if (declaration.kind === "source_extern") {
      const ex = externs.get(declaration.extern);
      if (!ex || ex.returnType === "void") addDiagnostic(state, unresolved(record, declaration, `extern return '${declaration.extern}'`));
    } else if (declaration.kind === "source_global") {
      if (!globals.has(declaration.global)) addDiagnostic(state, unresolved(record, declaration, `global source '${declaration.global}'`));
    } else if (declaration.kind === "sink_return") {
      const fn = functions.get(declaration.function);
      if (!fn || fn.returnType === "void") addDiagnostic(state, unresolved(record, declaration, `return sink '${declaration.function}'`));
    } else if (declaration.kind === "sink_extern") {
      const ex = externs.get(declaration.extern);
      if (!ex || declaration.argIndex >= (ex.params || []).length) {
        addDiagnostic(state, unresolved(record, declaration, `extern sink '${declaration.extern}' arg ${declaration.argIndex}`));
      }
    } else if (declaration.kind === "storage_global") {
      if (!globals.has(declaration.name)) addDiagnostic(state, unresolved(record, declaration, `global storage '${declaration.name}'`));
    } else if (declaration.kind === "storage_state") {
      if (!states.has(declaration.name)) addDiagnostic(state, unresolved(record, declaration, `state storage '${declaration.name}'`));
    } else if (declaration.kind === "storage_pool") {
      const pool = pools.get(declaration.pool);
      if (!pool || !(pool.fields || []).some((field) => field.name === declaration.field)) {
        addDiagnostic(state, unresolved(record, declaration, `pool storage '${declaration.pool}.${declaration.field}'`));
      }
    } else if (declaration.kind === "declassifier") {
      const fn = functions.get(declaration.function);
      if (!fn) addDiagnostic(state, unresolved(record, declaration, `declassifier function '${declaration.function}'`));
      else validateDeclassifierFunction(state, record, declaration, fn);
    }
  }

  for (const fn of mod.functions || []) {
    if (!(fn.exported || fn.name === "main")) continue;
    for (const param of fn.params || []) {
      if (!findDeclaration(mod, "source_param", (item) => item.function === fn.name && item.param === param.name)) {
        addDiagnostic(state, flowDiagnostic(
          "air.flow.source_missing",
          `exported parameter '${fn.name}.${param.name}' requires an explicit source label`,
          fn.loc,
          { module: record.path, function: fn.name, param: param.name }
        ));
      }
    }
    if (fn.returnType !== "void" && !findDeclaration(mod, "sink_return", (item) => item.function === fn.name)) {
      addDiagnostic(state, flowDiagnostic(
        "air.flow.sink_missing",
        `exported return '${fn.name}' requires an explicit sink ceiling`,
        fn.loc,
        { module: record.path, function: fn.name }
      ));
    }
  }
  const usedExterns = usedExternNames(mod);
  for (const ex of mod.externs || []) {
    if (!usedExterns.has(ex.name)) continue;
    if (ex.returnType !== "void" && !findDeclaration(mod, "source_extern", (item) => item.extern === ex.name)) {
      addDiagnostic(state, flowDiagnostic("air.flow.source_missing", `extern return '${ex.name}' requires an explicit source label`, ex.loc, { module: record.path, extern: ex.name }));
    }
    for (let index = 0; index < (ex.params || []).length; index += 1) {
      if (ex.name === "output.emit") continue;
      if (!findDeclaration(mod, "sink_extern", (item) => item.extern === ex.name && item.argIndex === index)) {
        addDiagnostic(state, flowDiagnostic("air.flow.sink_missing", `extern '${ex.name}' arg ${index} requires an explicit sink ceiling`, ex.loc, { module: record.path, extern: ex.name, argIndex: index }));
      }
    }
  }
  if (moduleUsesOp(mod, "print") && !findDeclaration(mod, "sink_print")) {
    addDiagnostic(state, flowDiagnostic("air.flow.sink_missing", "print arg 0 requires an explicit sink ceiling", mod.loc || { file: record.path, line: 1 }, { module: record.path }));
  }
  for (const global of mod.globals || []) {
    if (!findDeclaration(mod, "storage_global", (item) => item.name === global.name)) {
      addDiagnostic(state, flowDiagnostic("air.flow.storage_label_missing", `global '${global.name}' requires an explicit storage ceiling`, global.loc, { module: record.path, storage: global.name }));
    }
  }
  for (const item of mod.states || []) {
    if (!findDeclaration(mod, "storage_state", (decl) => decl.name === item.name)) {
      addDiagnostic(state, flowDiagnostic("air.flow.storage_label_missing", `state '${item.name}' requires an explicit storage ceiling`, item.loc, { module: record.path, storage: item.name }));
    }
  }
  for (const pool of mod.pools || []) {
    for (const field of pool.fields || []) {
      if (!findDeclaration(mod, "storage_pool", (item) => item.pool === pool.name && item.field === field.name)) {
        addDiagnostic(state, flowDiagnostic("air.flow.storage_label_missing", `pool field '${pool.name}.${field.name}' requires an explicit storage ceiling`, pool.loc, { module: record.path, storage: `${pool.name}.${field.name}` }));
      }
    }
  }
}

function validatePolicyBindings(state) {
  for (const record of state.records) {
    for (const declaration of declarations(record.mod, "source_param")) {
      if (!declaration.bindingKind) continue;
      const from = `${declaration.bindingKind}:${declaration.binding}`;
      const to = `param:${record.mod.name}.${declaration.function}.${declaration.param}`;
      const binding = state.policy.sourceBindings.find((item) => item.from === from && item.to === to && item.label === declaration.label);
      if (!binding) {
        addDiagnostic(state, flowDiagnostic(
          "air.flow.package_binding_mismatch",
          `module source binding '${from}' -> '${to}' (${declaration.label}) is not authorized by package policy`,
          declaration.loc,
          { module: record.path, from, to, label: declaration.label }
        ));
      }
      const schemaLabel = state.context.sourceLabels.get(from);
      if (!schemaLabel) {
        addDiagnostic(state, flowDiagnostic("air.flow.source_unresolved", `source binding '${from}' does not resolve to a schema field with flowLabel`, declaration.loc, { module: record.path, from }));
      } else if (schemaLabel !== declaration.label) {
        addDiagnostic(state, flowDiagnostic("air.flow.package_binding_mismatch", `source binding '${from}' schema label ${schemaLabel} does not match module label ${declaration.label}`, declaration.loc, { module: record.path, from, schemaLabel, moduleLabel: declaration.label }));
      }
    }
    for (const declaration of declarations(record.mod, "declassifier")) {
      const expected = {
        id: declaration.id,
        module: record.mod.name,
        function: declaration.function,
        from: declaration.from,
        to: declaration.to
      };
      const authorized = state.policy.declassifiers.find((item) =>
        item.id === expected.id &&
        item.module === expected.module &&
        item.function === expected.function &&
        item.from === expected.from &&
        item.to === expected.to);
      if (!authorized) {
        addDiagnostic(state, flowDiagnostic(
          "air.flow.declassification_unauthorized",
          `declassifier '${declaration.id}' does not have an exact matching package-policy authority`,
          declaration.loc,
          { module: record.path, ...expected }
        ));
      }
    }
  }
}

function validateDeclassifierFunction(state, record, declaration, fn) {
  if (!isLabel(declaration.from) || !isLabel(declaration.to) || labelIndex(declaration.to) >= labelIndex(declaration.from)) {
    addDiagnostic(state, flowDiagnostic("air.flow.declassification_mismatch", `declassifier '${declaration.id}' must lower from a higher label to a lower label`, declaration.loc, { module: record.path }));
  }
  if (!(fn.params || []).length || !isScalarType(fn.params[0].type) || fn.returnType !== fn.params[0].type) {
    addDiagnostic(state, flowDiagnostic("air.flow.declassification_mismatch", `declassifier '${declaration.id}' must take a scalar data argument and return the same base scalar type`, fn.loc, { module: record.path, function: fn.name }));
  }
  if ((record.mod.capabilities || new Set()).size) {
    addDiagnostic(state, flowDiagnostic("air.flow.declassification_mismatch", `declassifier '${declaration.id}' must be declared in a capability-free module`, fn.loc, { module: record.path, function: fn.name }));
  }
  for (const ins of instructions(fn)) {
    if (ins.op === "call" && isExtern(record.mod, ins.callee)) {
      addDiagnostic(state, flowDiagnostic("air.flow.declassification_mismatch", `declassifier '${declaration.id}' must not call extern '${ins.callee}'`, ins.loc, { module: record.path, function: fn.name }));
    }
    if (["global.set", "state.set", "pool.set.i32", "pool.set.bool", "buffer.store", "slice.store.i32", "slice.store.f32", "store.i32", "store.f32", "print"].includes(ins.op)) {
      addDiagnostic(state, flowDiagnostic("air.flow.declassification_mismatch", `declassifier '${declaration.id}' must not perform mutable writes or effects`, ins.loc, { module: record.path, function: fn.name, op: ins.op }));
    }
    if (ins.op === "call" && declarations(record.mod, "declassifier").some((item) => item.function === ins.callee)) {
      addDiagnostic(state, flowDiagnostic("air.flow.declassification_mismatch", `declassifier '${declaration.id}' must not call another declassifier`, ins.loc, { module: record.path, function: fn.name }));
    }
  }
}

function analyzeEntryFunctions(state) {
  for (const record of state.records) {
    for (const fn of record.mod.functions || []) {
      if (!(fn.exported || fn.name === "main")) continue;
      const args = (fn.params || []).map((param) => {
        const declaration = findDeclaration(record.mod, "source_param", (item) => item.function === fn.name && item.param === param.name);
        const identity = `param:${record.mod.name}.${fn.name}.${param.name}`;
        const value = sourceValue(state, record, declaration, identity);
        return isAggregateType(param.type) ? { ...value, regions: [identity] } : value;
      });
      analyzeFunction(state, record, fn, args, [], publicValue());
    }
  }
}

function analyzeFunction(state, record, fn, args, callStack, initialPc) {
  const identity = `${record.path}:${fn.name}`;
  if (callStack.includes(identity)) {
    addDiagnostic(state, flowDiagnostic("air.flow.operation_unsupported", `recursive provenance summary is unsupported for '${identity}'`, fn.loc, { module: record.path, function: fn.name }));
    return publicValue();
  }
  state.analyzedFunctions.add(identity);
  if (state.analyzedFunctions.size > FLOW_LIMITS.maxFunctions) {
    addDiagnostic(state, flowDiagnostic("air.flow.analysis_budget_exceeded", `analyzed function count exceeds ${FLOW_LIMITS.maxFunctions}`, fn.loc, { module: record.path }));
    return publicValue();
  }

  const values = new Map();
  const regionLabels = new Map();
  for (const constant of record.mod.constants || []) values.set(constant.name, publicValue());
  for (let index = 0; index < (fn.params || []).length; index += 1) {
    values.set(`%${fn.params[index].name}`, args[index] || publicValue());
  }
  const blockPc = new Map();
  if ((fn.blocks || [])[0]) blockPc.set(fn.blocks[0].label, initialPc || publicValue());
  let returnValue = publicValue();
  let changed = true;
  let pass = 0;
  let functionNodes = 0;
  const hasStructuredPhi = instructions(fn).some((ins) => ins.op.startsWith("phi."));
  const maxPasses = hasStructuredPhi ? FLOW_LIMITS.maxFixedPointRises + 1 : 1;
  while (changed && pass < maxPasses) {
    changed = false;
    pass += 1;
    for (const block of fn.blocks || []) {
      const pc = blockPc.get(block.label);
      if (!pc) continue;
      for (const ins of block.instructions || []) {
        functionNodes += 1;
        state.packageNodeCount += 1;
        if (functionNodes > FLOW_LIMITS.maxNodesPerFunction || state.packageNodeCount > FLOW_LIMITS.maxNodesPerPackage) {
          addDiagnostic(state, flowDiagnostic("air.flow.analysis_budget_exceeded", `provenance node budget exceeded in '${identity}'`, ins.loc, { module: record.path, function: fn.name }));
          return returnValue;
        }
        const next = analyzeInstruction(state, record, fn, ins, values, regionLabels, pc, callStack.concat(identity), blockPc);
        if (ins.result && next) {
          const prior = values.get(ins.result);
          const joined = prior ? mergeStableValues(prior, next) : next;
          if (!prior || !sameValue(prior, joined)) {
            values.set(ins.result, joined);
            changed = true;
          }
        }
        if (ins.op === "return" && ins.args.length) {
          const value = valueForArg(values, ins.args[0]);
          returnValue = joinValues(returnValue, withPc(value, pc, ins, state), ins, state);
          if (fn.exported || fn.name === "main") checkReturnSink(state, record, fn, returnValue, ins);
        }
      }
    }
  }
  if (changed && hasStructuredPhi) {
    addDiagnostic(state, flowDiagnostic("air.flow.analysis_budget_exceeded", `fixed-point analysis for '${identity}' exceeded ${FLOW_LIMITS.maxFixedPointRises} label rises`, fn.loc, { module: record.path, function: fn.name }));
  }
  return returnValue;
}

function mergeStableValues(left, right) {
  const label = labelIndex(left.label) >= labelIndex(right.label) ? left.label : right.label;
  return {
    label,
    sources: Array.from(new Set([...(left.sources || []), ...(right.sources || [])])).sort(),
    path: choosePath(left, right),
    aliasUnknown: Boolean(left.aliasUnknown || right.aliasUnknown),
    control: Boolean(left.control || right.control),
    regions: Array.from(new Set([...(left.regions || []), ...(right.regions || [])])).sort()
  };
}

function analyzeInstruction(state, record, fn, ins, values, regionLabels, pc, callStack, blockPc) {
  const args = (ins.args || []).map((arg) => valueForArg(values, arg));
  if (ins.op === "br") {
    updateBlockPc(blockPc, ins.labels[0], pc);
    return null;
  }
  if (ins.op === "br_if") {
    const branchPc = joinValues(pc, args[0], ins, state);
    for (const label of ins.labels || []) updateBlockPc(blockPc, label, branchPc);
    return null;
  }
  if (ins.op === "return") return null;
  if (ins.op === "print") {
    const declaration = findDeclaration(record.mod, "sink_print");
    if (declaration) {
      const value = withPc(args[0], pc, ins, state);
      checkSink(state, record, "print:arg:0", declaration.label, value, ins, flowClassification(value, "effect"));
    }
    return null;
  }
  if (ins.op === "call") return analyzeCall(state, record, fn, ins, args, pc, callStack);
  if (ins.op === "global.get") {
    const name = symbolName(ins.args[0]);
    const declaration = findDeclaration(record.mod, "storage_global", (item) => item.name === name) ||
      findDeclaration(record.mod, "source_global", (item) => item.global === name);
    return withPc(sourceValue(state, record, declaration, `global:${record.mod.name}.${name}`), pc, ins, state);
  }
  if (ins.op === "global.set") {
    checkStorage(state, record, "global", symbolName(ins.args[0]), null, withPc(args[1], pc, ins, state), ins);
    return null;
  }
  if (ins.op === "state.get") {
    const name = symbolName(ins.args[0]);
    const declaration = findDeclaration(record.mod, "storage_state", (item) => item.name === name);
    return withPc(joinValues(sourceValue(state, record, declaration, `state:${record.mod.name}.${name}`), args[1], ins, state), pc, ins, state);
  }
  if (ins.op === "state.set") {
    checkStorage(state, record, "state", symbolName(ins.args[0]), null, joinMany([args[1], args[2], pc], ins, state), ins);
    return null;
  }
  if (ins.op === "pool.get.i32" || ins.op === "pool.get.bool") {
    const ref = poolRef(ins.args[0]);
    const declaration = findDeclaration(record.mod, "storage_pool", (item) => item.pool === ref.pool && item.field === ref.field);
    return withPc(joinValues(sourceValue(state, record, declaration, `pool:${record.mod.name}.${ref.pool}.${ref.field}`), args[1], ins, state), pc, ins, state);
  }
  if (ins.op === "pool.set.i32" || ins.op === "pool.set.bool") {
    const ref = poolRef(ins.args[0]);
    checkStorage(state, record, "pool", ref.pool, ref.field, joinMany([args[1], args[2], pc], ins, state), ins);
    return null;
  }
  if (ins.op.startsWith("loop.buffer.")) {
    const owner = args[1];
    if (!owner || owner.aliasUnknown || !(owner.regions || []).length) {
      addDiagnostic(state, flowDiagnostic("air.flow.alias_unsupported", `${ins.op} cannot resolve a bounded buffer alias`, ins.loc, { module: record.path, function: fn.name, op: ins.op }));
      return null;
    }
    const updated = joinMany(args.concat(pc), ins, state);
    for (const region of owner.regions) {
      const prior = regionLabels.get(region) || publicValue();
      regionLabels.set(region, mergeStableValues(prior, updated));
    }
    return null;
  }
  if (["store.i32", "store.f32", "slice.store.i32", "slice.store.f32", "buffer.store"].includes(ins.op)) {
    const owner = args[0];
    if (!owner || owner.aliasUnknown || !(owner.regions || []).length) {
      addDiagnostic(state, flowDiagnostic("air.flow.alias_unsupported", `${ins.op} cannot resolve a bounded aggregate/region alias`, ins.loc, { module: record.path, function: fn.name, op: ins.op }));
      return null;
    }
    const stored = joinMany(args.slice(1).concat(pc), ins, state);
    for (const region of owner.regions) {
      const prior = regionLabels.get(region) || publicValue();
      regionLabels.set(region, mergeStableValues(prior, stored));
    }
    return null;
  }
  if (ins.op === "alloc_region") {
    const value = joinMany(args.concat(pc), ins, state);
    const region = `region:${record.mod.name}.${fn.name}.${ins.result}`;
    regionLabels.set(region, publicValue());
    return { ...value, regions: [region], aliasUnknown: false };
  }
  if (ins.op === "slice.from_region" || ins.op === "slice.sub" || ins.op === "buffer.from_ptr") {
    const value = joinMany(args.concat(pc), ins, state);
    return { ...value, regions: (args[0] && args[0].regions || []).slice(), aliasUnknown: !(args[0] && (args[0].regions || []).length) };
  }
  if (ins.op.startsWith("load.") || ins.op.startsWith("slice.load.") || ins.op === "buffer.load") {
    const owner = args[0];
    if (!owner || owner.aliasUnknown || !(owner.regions || []).length) {
      addDiagnostic(state, flowDiagnostic("air.flow.alias_unsupported", `${ins.op} cannot resolve a bounded aggregate/region alias`, ins.loc, { module: record.path, function: fn.name, op: ins.op }));
      return publicValue();
    }
    const stored = owner.regions.map((region) => regionLabels.get(region) || publicValue());
    const value = joinMany(args.concat(stored, pc), ins, state);
    return { ...value, regions: [], aliasUnknown: false };
  }
  if (ins.op.startsWith("phi.")) return joinMany(args.concat(pc), ins, state);
  if (ins.result) return joinMany(args.concat(pc), ins, state);
  return null;
}

function analyzeCall(state, record, fn, ins, args, pc, callStack) {
  const local = (record.mod.functions || []).find((item) => item.name === ins.callee);
  if (local) {
    const declaration = findDeclaration(record.mod, "declassifier", (item) => item.function === local.name);
    if (declaration) return applyDeclassifier(state, record, declaration, local, ins, args, pc);
    return withPc(analyzeFunction(state, record, local, args, callStack, pc), pc, ins, state);
  }
  const imported = importedFunction(state, record, ins.callee);
  if (imported) return withPc(analyzeFunction(state, imported.record, imported.fn, args, callStack, pc), pc, ins, state);

  const extern = (record.mod.externs || []).find((item) => item.name === ins.callee);
  if (!extern) {
    addDiagnostic(state, flowDiagnostic("air.flow.operation_unsupported", `call target '${ins.callee}' has no deterministic provenance summary`, ins.loc, { module: record.path, function: fn.name, callee: ins.callee }));
    return publicValue();
  }
  if (labelIndex(pc.label) > 0) {
    checkSink(state, record, `effect:${ins.callee}`, "public", pc, ins, "control");
  }
  for (let index = 0; index < args.length; index += 1) {
    let ceiling = null;
    if (ins.callee === "output.emit" && index > 0) {
      const outputSink = outputSinkFor(state, record.mod, ins.args[0], index - 1);
      ceiling = outputSink.ceiling;
      if (!outputSink.resolved) {
        addDiagnostic(state, flowDiagnostic(
          "air.flow.sink_missing",
          `output.emit arg ${index - 1} requires a statically resolved output-contract flowLabel`,
          ins.loc,
          { module: record.path, function: fn.name, argIndex: index - 1 }
        ));
      }
    }
    const declaration = findDeclaration(record.mod, "sink_extern", (item) => item.extern === ins.callee && item.argIndex === index);
    if (!ceiling && declaration) ceiling = declaration.label;
    if (ceiling) {
      const value = withPc(args[index], pc, ins, state);
      checkSink(state, record, `extern:${ins.callee}:arg:${index}`, ceiling, value, ins, flowClassification(value, "data"));
    }
  }
  if (extern.returnType === "void") return publicValue();
  const source = findDeclaration(record.mod, "source_extern", (item) => item.extern === ins.callee);
  return withPc(sourceValue(state, record, source, `extern:${record.mod.name}.${ins.callee}:return`), pc, ins, state);
}

function applyDeclassifier(state, record, declaration, fn, ins, args, pc) {
  const policy = state.policy.declassifiers.find((item) =>
    item.id === declaration.id &&
    item.module === record.mod.name &&
    item.function === declaration.function &&
    item.from === declaration.from &&
    item.to === declaration.to);
  const data = args[0] || publicValue();
  const additionalPublic = args.slice(1).every((value) => labelIndex(value.label) === 0);
  if (!policy || !additionalPublic || labelIndex(data.label) > labelIndex(declaration.from) || labelIndex(data.label) < labelIndex(declaration.to)) {
    addDiagnostic(state, flowDiagnostic(
      policy ? "air.flow.declassification_mismatch" : "air.flow.declassification_unauthorized",
      `declassifier '${declaration.id}' call does not match its authorized labels and public-argument constraints`,
      ins.loc,
      { module: record.path, function: fn.name, declassifierId: declaration.id, inputLabel: data.label, from: declaration.from, to: declaration.to }
    ));
    return withPc(data, pc, ins, state);
  }
  const lowered = {
    label: declaration.to,
    sources: data.sources.slice(),
    path: boundedPath(data.path.concat(locationNode(record, fn, ins, `declassify:${declaration.id}`)), state, ins),
    aliasUnknown: Boolean(data.aliasUnknown),
    control: false,
    regions: (data.regions || []).slice()
  };
  const output = joinValues(lowered, pc, ins, state);
  state.declassifications.push(stableObject({
    authorityId: declaration.id,
    policyDigest: state.policyDigest,
    functionDigest: digest("AIR_PROVENANCE_DECLASSIFIER_FUNCTION_V1", canonicalFunction(fn)),
    module: record.path,
    function: fn.name,
    callsite: locationFields(ins.loc),
    sources: data.sources,
    from: declaration.from,
    to: declaration.to,
    resultLabel: output.label,
    reasonCode: policy.reasonCode
  }));
  return output;
}

function checkReturnSink(state, record, fn, value, ins) {
  const declaration = findDeclaration(record.mod, "sink_return", (item) => item.function === fn.name);
  if (declaration) checkSink(state, record, `return:${record.mod.name}.${fn.name}`, declaration.label, value, ins, flowClassification(value, "data"));
}

function checkStorage(state, record, kind, name, field, value, ins) {
  const declaration = kind === "pool"
    ? findDeclaration(record.mod, "storage_pool", (item) => item.pool === name && item.field === field)
    : findDeclaration(record.mod, `storage_${kind}`, (item) => item.name === name);
  if (!declaration) return;
  checkSink(state, record, `storage:${record.mod.name}.${name}${field ? `.${field}` : ""}`, declaration.label, value, ins, flowClassification(value, "data"));
}

function checkSink(state, record, sink, ceiling, value, ins, classification) {
  const functionName = functionForLocation(record.mod, ins.loc);
  const blockName = blockForLocation(record.mod, ins.loc);
  const item = stableObject({
    sink,
    ceiling,
    module: record.path,
    function: functionName,
    block: blockName,
    location: locationFields(ins.loc)
  });
  pushUnique(state.sinks, item);
  const flow = stableObject({
    sourceIdentities: value.sources,
    sourceLabel: value.label,
    sink,
    sinkCeiling: ceiling,
    classification,
    dependencyPath: value.path,
    module: record.path,
    function: functionName,
    block: blockName,
    location: locationFields(ins.loc)
  });
  if (labelIndex(value.label) <= labelIndex(ceiling)) {
    pushUnique(state.acceptedFlows, flow);
    return;
  }
  pushUnique(state.rejectedFlows, flow);
  const code = classification === "control" ? "air.flow.control_forbidden" : "air.flow.forbidden";
  addDiagnostic(state, flowDiagnostic(
    code,
    `${classification} flow from ${value.label} source(s) to sink '${sink}' with ceiling ${ceiling} is forbidden`,
    ins.loc,
    {
      module: record.path,
      function: functionName,
      block: blockName,
      sourceIdentities: value.sources,
      sourceLabel: value.label,
      sink,
      sinkCeiling: ceiling,
      classification,
      dependencyPath: value.path,
      repairHint: "Raise the explicit sink ceiling only when policy permits, remove the dependency, or use an exact authorized declassifier."
    }
  ));
}

function sourceValue(state, record, declaration, identity) {
  if (!declaration) return publicValue();
  const source = stableObject({
    identity,
    label: declaration.label,
    module: record.path,
    location: locationFields(declaration.loc),
    binding: declaration.bindingKind && declaration.binding ? `${declaration.bindingKind}:${declaration.binding}` : null
  });
  pushUnique(state.sources, source);
  return {
    label: declaration.label,
    sources: [identity],
    path: [identity],
    aliasUnknown: false,
    control: false,
    regions: []
  };
}

function valueForArg(values, arg) {
  if (!arg) return publicValue();
  if (arg.kind === "value") return values.get(arg.name) || publicValue();
  if (arg.kind === "phi") return values.get(arg.value) || publicValue();
  return publicValue();
}

function joinMany(values, ins, state) {
  const joined = (values || []).reduce((result, value) => joinValues(result, value || publicValue(), null, state), publicValue());
  if (!ins) return joined;
  return { ...joined, path: appendOperation(joined.path, ins, state) };
}

function joinValues(left, right, ins, state) {
  const a = left || publicValue();
  const b = right || publicValue();
  const label = labelIndex(a.label) >= labelIndex(b.label) ? a.label : b.label;
  const sources = Array.from(new Set([...(a.sources || []), ...(b.sources || [])])).sort();
  if (sources.length > FLOW_LIMITS.maxSourcesPerValue) {
    addDiagnostic(state, flowDiagnostic("air.flow.analysis_budget_exceeded", `value source count exceeds ${FLOW_LIMITS.maxSourcesPerValue}`, ins && ins.loc, { sourceCount: sources.length }));
  }
  const pathBase = choosePath(a, b);
  const path = ins ? appendOperation(pathBase, ins, state) : pathBase;
  return {
    label,
    sources: sources.slice(0, FLOW_LIMITS.maxSourcesPerValue),
    path,
    aliasUnknown: Boolean(a.aliasUnknown || b.aliasUnknown),
    control: Boolean(a.control || b.control),
    regions: Array.from(new Set([...(a.regions || []), ...(b.regions || [])])).sort()
  };
}

function withPc(value, pc, ins, state) {
  const joined = joinValues(value || publicValue(), pc || publicValue(), ins, state);
  return {
    ...joined,
    control: Boolean(joined.control || labelIndex((pc || publicValue()).label) > 0)
  };
}

function choosePath(a, b) {
  const ai = labelIndex(a.label);
  const bi = labelIndex(b.label);
  if (ai > bi) return (a.path || []).slice();
  if (bi > ai) return (b.path || []).slice();
  const aPath = a.path || [];
  const bPath = b.path || [];
  if (aPath.length < bPath.length) return aPath.slice();
  if (bPath.length < aPath.length) return bPath.slice();
  const ap = JSON.stringify(aPath);
  const bp = JSON.stringify(bPath);
  return (ap <= bp ? aPath : bPath).slice();
}

function appendOperation(path, ins, state) {
  const node = operationNode(ins);
  const base = (path || []).slice();
  if (base[base.length - 1] !== node) base.push(node);
  return boundedPath(base, state, ins);
}

function boundedPath(path, state, ins) {
  if (path.length <= FLOW_LIMITS.maxDependencyPathLength) return path;
  addDiagnostic(state, flowDiagnostic("air.flow.analysis_budget_exceeded", `dependency path exceeds ${FLOW_LIMITS.maxDependencyPathLength}`, ins && ins.loc, { pathLength: path.length }));
  return path.slice(0, FLOW_LIMITS.maxDependencyPathLength);
}

function updateBlockPc(blockPc, label, value) {
  const prior = blockPc.get(label);
  if (!prior) {
    blockPc.set(label, value);
    return;
  }
  const next = {
    label: labelIndex(prior.label) >= labelIndex(value.label) ? prior.label : value.label,
    sources: Array.from(new Set([...(prior.sources || []), ...(value.sources || [])])).sort(),
    path: choosePath(prior, value),
    aliasUnknown: Boolean(prior.aliasUnknown || value.aliasUnknown),
    control: Boolean(prior.control || value.control || labelIndex(value.label) > 0),
    regions: Array.from(new Set([...(prior.regions || []), ...(value.regions || [])])).sort()
  };
  blockPc.set(label, next);
}

function importedFunction(state, record, callee) {
  const split = splitQualifiedName(callee);
  if (!split) return null;
  const importedRef = record.imports.find((item) => item.alias === split.module);
  const imported = importedRef ? state.recordByPath.get(importedRef.relative) : state.recordByModule.get(split.module);
  if (!imported) return null;
  const fn = (imported.mod.functions || []).find((item) => item.name === split.function && item.exported);
  return fn ? { record: imported, fn } : null;
}

function outputSinkFor(state, mod, outputIdArg, argIndex) {
  const outputId = staticIntegerArg(outputIdArg, mod);
  if (outputId === null || !state.context.outputArgCounts.has(outputId)) return { resolved: false, ceiling: null };
  const argCount = state.context.outputArgCounts.get(outputId);
  if (argIndex >= argCount) return { resolved: true, ceiling: "public" };
  const ceiling = state.context.outputLabels.get(`${outputId}:${argIndex}`) || null;
  return { resolved: Boolean(ceiling), ceiling };
}

function staticIntegerArg(arg, mod) {
  if (arg && arg.kind === "number" && Number.isInteger(arg.value)) return arg.value;
  const name = symbolName(arg);
  if (!name) return null;
  const constant = (mod.constants || []).find((item) => item.name === name);
  if (!constant) return null;
  const value = constant.value && constant.value.value !== undefined ? constant.value.value : constant.value;
  return Number.isInteger(value) ? value : null;
}

function normalizeContext(context) {
  const sourceLabels = new Map();
  const missingSourceLabels = [];
  for (const schema of context.factSchemas || context.facts || []) {
    for (const fact of schema.facts || []) {
      for (const column of fact.columns || []) {
        const identity = `fact:${fact.name}.${column.name}`;
        if (column.flowLabel) sourceLabels.set(identity, column.flowLabel);
        else missingSourceLabels.push(identity);
      }
    }
    if (schema.rowset) {
      for (const column of schema.rowset.columns || []) {
        const identity = `fact:${schema.rowset.name}.${column.name}`;
        if (column.flowLabel) sourceLabels.set(identity, column.flowLabel);
        else missingSourceLabels.push(identity);
      }
    }
  }
  for (const schema of context.structuredIOSchemas || context.structuredIO || []) {
    for (const field of schema.fields || []) {
      const identity = `structured:${schema.name}.${field.name}`;
      if (field.flowLabel) sourceLabels.set(identity, field.flowLabel);
      else missingSourceLabels.push(identity);
    }
  }
  const outputLabels = new Map();
  const outputArgCounts = new Map();
  const missingOutputLabels = [];
  for (const schema of context.outputContracts || []) {
    for (const output of schema.outputs || []) {
      outputArgCounts.set(output.id, (output.args || []).length);
      for (let index = 0; index < (output.args || []).length; index += 1) {
        if (output.args[index].flowLabel) outputLabels.set(`${output.id}:${index}`, output.args[index].flowLabel);
        else missingOutputLabels.push(`output:${output.id}:${output.args[index].name || index}`);
      }
    }
  }
  return {
    sourceLabels,
    outputLabels,
    outputArgCounts,
    missingSourceLabels: Array.from(new Set(missingSourceLabels)).sort(),
    missingOutputLabels: Array.from(new Set(missingOutputLabels)).sort()
  };
}

function normalizePolicy(value) {
  const policy = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return stableObject({
    mode: policy.mode === "required" ? "required" : null,
    sourceBindings: (policy.sourceBindings || []).map((item) => ({
      from: String(item.from || ""),
      to: String(item.to || ""),
      label: String(item.label || "")
    })).sort(compareStable),
    declassifiers: (policy.declassifiers || []).map((item) => ({
      id: String(item.id || ""),
      module: String(item.module || ""),
      function: String(item.function || ""),
      from: String(item.from || ""),
      to: String(item.to || ""),
      reasonCode: String(item.reasonCode || "")
    })).sort(compareStable)
  });
}

function finalizeEvidence(state) {
  const diagnostics = state.diagnostics.slice().sort(compareDiagnostics);
  const payload = stableObject({
    schemaVersion: "1.0",
    mode: "required",
    status: diagnostics.some((item) => item.severity === "fail") ? "failed" : "passed",
    fixedLattice: FLOW_LABELS,
    policyDigest: state.policyDigest,
    analyzerDigest: state.analyzerDigest,
    sources: uniqueStable(state.sources),
    sinks: uniqueStable(state.sinks),
    acceptedFlows: uniqueStable(state.acceptedFlows),
    rejectedFlows: uniqueStable(state.rejectedFlows),
    declassifications: uniqueStable(state.declassifications),
    diagnostics,
    limits: FLOW_LIMITS,
    unsupportedChannels: FLOW_UNSUPPORTED_CHANNELS
  });
  return stableObject({
    ...payload,
    summaryDigest: digest(FLOW_SUMMARY_DOMAIN, payload)
  });
}

function disabledEvidence() {
  const payload = stableObject({
    schemaVersion: "1.0",
    mode: "absent",
    status: "not_enabled",
    fixedLattice: FLOW_LABELS,
    policyDigest: null,
    analyzerDigest: digest(FLOW_ANALYZER_DOMAIN, {
      version: FLOW_ANALYZER_VERSION,
      lattice: FLOW_LABELS,
      limits: FLOW_LIMITS,
      unsupportedChannels: FLOW_UNSUPPORTED_CHANNELS
    }),
    sources: [],
    sinks: [],
    acceptedFlows: [],
    rejectedFlows: [],
    declassifications: [],
    diagnostics: [],
    limits: FLOW_LIMITS,
    unsupportedChannels: FLOW_UNSUPPORTED_CHANNELS
  });
  return stableObject({ ...payload, summaryDigest: digest(FLOW_SUMMARY_DOMAIN, payload) });
}

function flowDiagnostic(code, message, loc = null, fields = {}) {
  return stableObject({
    code,
    severity: "fail",
    source: "provenance-flow",
    message,
    file: normalizePath(loc && loc.file),
    line: loc && Number.isInteger(loc.line) ? loc.line : null,
    col: null,
    module: fields.module || null,
    symbol: fields.function || null,
    repairHint: fields.repairHint || repairHint(code),
    fields: stableObject(fields),
    loc: loc ? { file: normalizePath(loc.file), line: loc.line } : null
  });
}

function repairHint(code) {
  if (code === "air.flow.source_missing") return "Declare the exact exported parameter or extern return source and bind schema-backed sources in package policy.";
  if (code === "air.flow.sink_missing") return "Declare an explicit return, extern argument, print, or output-contract sink ceiling.";
  if (code === "air.flow.storage_label_missing") return "Declare an explicit storage ceiling for every mutable global, state segment, and pool field.";
  if (code.includes("declassification")) return "Use an exact module declaration and matching package-policy declassifier authority; keep the function local and pure.";
  if (code === "air.flow.analysis_budget_exceeded") return "Reduce provenance graph size or request an architecture revision; evidence is never silently truncated.";
  return "Remove the prohibited dependency, raise authority only through explicit reviewed policy, or use an exact authorized declassifier.";
}

function unresolved(record, declaration, identity) {
  return flowDiagnostic("air.flow.source_unresolved", `${identity} does not resolve`, declaration.loc, { module: record.path, identity });
}

function addDiagnostic(state, diagnostic) {
  const key = `${diagnostic.code}\0${diagnostic.file || ""}\0${diagnostic.line || 0}\0${diagnostic.message}`;
  if (state.diagnosticKeys.has(key)) return;
  state.diagnosticKeys.add(key);
  state.diagnostics.push(diagnostic);
}

function declarations(mod, kind) {
  return (mod.flowDeclarations || []).filter((item) => item.kind === kind);
}

function findDeclaration(mod, kind, predicate = null) {
  return (mod.flowDeclarations || []).find((item) => item.kind === kind && (!predicate || predicate(item))) || null;
}

function declarationKey(item) {
  const copy = {};
  for (const key of Object.keys(item).sort()) {
    if (key !== "loc") copy[key] = item[key];
  }
  return JSON.stringify(copy);
}

function usedExternNames(mod) {
  const externs = new Set((mod.externs || []).map((item) => item.name));
  const used = new Set();
  for (const fn of mod.functions || []) {
    for (const ins of instructions(fn)) {
      if (ins.op === "call" && externs.has(ins.callee)) used.add(ins.callee);
    }
  }
  return used;
}

function moduleUsesOp(mod, op) {
  return (mod.functions || []).some((fn) => instructions(fn).some((ins) => ins.op === op));
}

function instructions(fn) {
  return (fn.blocks || []).flatMap((block) => block.instructions || []);
}

function isExtern(mod, name) {
  return (mod.externs || []).some((item) => item.name === name);
}

function isScalarType(type) {
  return ["i32", "i64", "f32", "f64", "bool"].includes(type);
}

function isAggregateType(type) {
  return type === "ptr" || type === "slice" || /^array</.test(type || "") || /^buffer</.test(type || "");
}

function splitQualifiedName(name) {
  const index = String(name || "").indexOf(".");
  if (index <= 0 || index === name.length - 1) return null;
  return { module: name.slice(0, index), function: name.slice(index + 1) };
}

function symbolName(arg) {
  return arg && (arg.kind === "symbol" || arg.kind === "function") ? arg.name : null;
}

function poolRef(arg) {
  return arg && arg.kind === "poolField" ? { pool: arg.pool, field: arg.field } : { pool: null, field: null };
}

function isLabel(value) {
  return FLOW_LABEL_INDEX.has(value);
}

function labelIndex(value) {
  return FLOW_LABEL_INDEX.get(value) ?? 0;
}

function publicValue() {
  return { label: "public", sources: [], path: [], aliasUnknown: false, control: false, regions: [] };
}

function sameValue(a, b) {
  return a.label === b.label &&
    JSON.stringify(a.sources || []) === JSON.stringify(b.sources || []) &&
    JSON.stringify(a.path || []) === JSON.stringify(b.path || []) &&
    Boolean(a.aliasUnknown) === Boolean(b.aliasUnknown) &&
    Boolean(a.control) === Boolean(b.control) &&
    JSON.stringify(a.regions || []) === JSON.stringify(b.regions || []);
}

function flowClassification(value, fallback) {
  return value && value.control ? "control" : fallback;
}

function operationNode(ins) {
  const file = normalizePath(ins && ins.loc && ins.loc.file);
  const line = ins && ins.loc && ins.loc.line || 0;
  return `${ins && (ins.result || ins.op) || "op"}@${file}:${line}`;
}

function locationNode(record, fn, ins, kind) {
  return `${kind}:${record.mod.name}.${fn.name}@${normalizePath(ins.loc && ins.loc.file)}:${ins.loc && ins.loc.line || 0}`;
}

function locationFields(loc) {
  return {
    file: normalizePath(loc && loc.file),
    line: loc && Number.isInteger(loc.line) ? loc.line : null
  };
}

function functionForLocation(mod, loc) {
  for (const fn of mod.functions || []) {
    if (instructions(fn).some((ins) => ins.loc && loc && ins.loc.file === loc.file && ins.loc.line === loc.line)) return fn.name;
  }
  return null;
}

function blockForLocation(mod, loc) {
  for (const fn of mod.functions || []) {
    for (const block of fn.blocks || []) {
      if ((block.instructions || []).some((ins) => ins.loc && loc && ins.loc.file === loc.file && ins.loc.line === loc.line)) {
        return block.label;
      }
    }
  }
  return null;
}

function modulePath(mod) {
  const loc = (mod.functions || [])[0]?.loc || (mod.externs || [])[0]?.loc || null;
  return normalizePath(loc && loc.file) || `${mod.name || "module"}.air`;
}

function normalizePath(value) {
  if (!value) return null;
  const normalized = String(value).replace(/\\/g, "/");
  const cwd = String(process.cwd()).replace(/\\/g, "/");
  return normalized.startsWith(`${cwd}/`) ? normalized.slice(cwd.length + 1) : normalized;
}

function canonicalFunction(fn) {
  return {
    name: fn.name,
    params: (fn.params || []).map((item) => ({ name: item.name, type: item.type })),
    returnType: fn.returnType,
    blocks: (fn.blocks || []).map((block) => ({
      label: block.label,
      instructions: (block.instructions || []).map((ins) => ({
        result: ins.result || null,
        resultType: ins.resultType || null,
        op: ins.op,
        callee: ins.callee || null,
        args: (ins.args || []).map((arg) => arg.raw || arg.name || arg.value || null),
        labels: ins.labels || []
      }))
    }))
  };
}

function digest(domain, value) {
  const hash = crypto.createHash("sha256");
  hash.update(`${domain}\0`, "utf8");
  hash.update(JSON.stringify(stableObject(value)), "utf8");
  return `sha256:${hash.digest("hex")}`;
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = stableObject(value[key]);
  return out;
}

function uniqueStable(values) {
  const map = new Map();
  for (const value of values || []) map.set(JSON.stringify(stableObject(value)), stableObject(value));
  return Array.from(map.values()).sort(compareStable);
}

function pushUnique(target, value) {
  const key = JSON.stringify(stableObject(value));
  if (!(target || []).some((item) => JSON.stringify(stableObject(item)) === key)) target.push(value);
}

function compareStable(a, b) {
  return JSON.stringify(stableObject(a)).localeCompare(JSON.stringify(stableObject(b)));
}

function compareDiagnostics(a, b) {
  return String(a.code).localeCompare(String(b.code)) ||
    String(a.file || "").localeCompare(String(b.file || "")) ||
    Number(a.line || 0) - Number(b.line || 0) ||
    String(a.message).localeCompare(String(b.message));
}

module.exports = {
  FLOW_ANALYZER_VERSION,
  FLOW_LABELS,
  FLOW_LIMITS,
  FLOW_UNSUPPORTED_CHANNELS,
  ProvenanceFlowError,
  analyzeProvenanceModule,
  analyzeProvenancePackage,
  assertProvenanceFlow
};
