"use strict";

// typed-v0.53 analysis capacity (RFC R-WB-15c; SCALAR slice text §3.1, §7.3).
// A phase-A host guard, not semantic WorkBound: the refusal is
// ANALYSIS_REFUSED, never STATIC_REJECT, never cached and never part of any
// WorkBound key, summary record or failure reason. Both measures are computed
// from the parsed AST in one iterative pass (AMD-3: no host-stack recursion
// before the capacity check).

const { AirError } = require("./errors");

const ANALYSIS_CAPACITY_CODE = "air.analysis.capacity_exceeded";
// R-WB-15c / OPEN-43 (a): host defaults; a host may lower them, never raise them.
const DEFAULT_ANALYSIS_CAPACITY = Object.freeze({
  maxAnalysisUnits: 1048576,
  maxSyntaxNestingDepth: 64
});
// The conformance floor binds a host that claims typed-v0.53 conformance, not
// the setter: a configured value below it is honoured exactly (R-12).
const ANALYSIS_UNITS_FLOOR = 65536;
const NESTING_DEPTH_FLOOR = 32;

class AnalysisRefusedError extends AirError {
  constructor(measure, required, capacity) {
    super(`${ANALYSIS_CAPACITY_CODE}: ANALYSIS_REFUSED (not a verdict) ${measure} required ${required} exceeds capacity ${capacity}`);
    this.name = "AnalysisRefusedError";
    this.disposition = "ANALYSIS_REFUSED";
    this.measure = measure;
    this.required = required;
    this.capacity = capacity;
    this.fields = Object.freeze({ capacity, measure, required });
  }
}

function capacityInputError(message) {
  // OPEN-2 (a): identical meaning to the runtime limit refusal, a host value
  // outside 1 through its maximum.
  return new AirError(`air.v052.runtime_limits_invalid: ${message}`);
}

// PS-1 (admitted with SCALAR): `analysisCapacity: { maxAnalysisUnits,
// maxSyntaxNestingDepth }`, both optional; each an integer from 1 through the
// default.
function normalizeAnalysisCapacity(input) {
  if (input === undefined) return DEFAULT_ANALYSIS_CAPACITY;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw capacityInputError("analysisCapacity must be an object");
  }
  const names = Object.keys(DEFAULT_ANALYSIS_CAPACITY);
  const unknown = Object.keys(input).filter((key) => !names.includes(key)).sort();
  if (unknown.length) throw capacityInputError(`analysisCapacity has unknown field '${unknown[0]}'`);
  const capacity = {};
  for (const name of names) {
    const value = input[name];
    if (value === undefined) {
      capacity[name] = DEFAULT_ANALYSIS_CAPACITY[name];
      continue;
    }
    if (!Number.isSafeInteger(value) || value < 1 || value > DEFAULT_ANALYSIS_CAPACITY[name]) {
      throw capacityInputError(`${name} must be an integer from 1 through ${DEFAULT_ANALYSIS_CAPACITY[name]}`);
    }
    capacity[name] = value;
  }
  return Object.freeze(capacity);
}

// R-WB-15c measures of one module (the closure of a SCALAR source is the
// module itself: SCALAR admits no imports, so import_edges is 0).
//   analysis_units = (1 + decls + stmts) + call_sites + callback_refs + import_edges
//   nesting_depth  = largest block depth of any function body (a body is 1)
// A statement that contains blocks lists them in `blocks`; each block is an
// object with a `statements` list. SCALAR has no block statement, so every
// SCALAR body measures depth 1.
// P0-05 (slice text §4.8, P5-R14; owner OD-P5-2 (a)): a fold statement is one
// statement and one callback reference, never a call site (its value has
// `op: "loop.fold"`); a `work` declaration is one top-level declaration,
// never a capability declaration. Each block is still reached once, through
// `statement.blocks`.
// P0-06 (slice text P6-R18; owner OD-P6-4 (a)): each struct and each table is
// one top-level declaration; nothing else in the measure changes.
// P0-07 (slice text P7-R17; owner OD-P7-2 (a)): each constant and each state
// is one top-level declaration, whatever its type or length.
function measureTypedModule(mod) {
  const functions = Array.isArray(mod && mod.functions) ? mod.functions : [];
  const decls = functions.length +
    (Array.isArray(mod && mod.enums) ? mod.enums.length : 0) +
    (Number.isSafeInteger(mod && mod.capabilityDeclarations) ? mod.capabilityDeclarations : 0) +
    (mod && mod.work ? 1 : 0) +
    (Array.isArray(mod && mod.structs) ? mod.structs.length : 0) +
    (Array.isArray(mod && mod.tables) ? mod.tables.length : 0) +
    (Array.isArray(mod && mod.constants) ? mod.constants.length : 0) +
    (Array.isArray(mod && mod.states) ? mod.states.length : 0);
  let stmts = 0;
  let callSites = 0;
  let callbackRefs = 0;
  let nestingDepth = 0;
  for (const fn of functions) {
    const stack = [{ depth: 1, statements: Array.isArray(fn && fn.statements) ? fn.statements : [] }];
    while (stack.length) {
      const frame = stack.pop();
      if (frame.depth > nestingDepth) nestingDepth = frame.depth;
      for (const statement of frame.statements) {
        stmts += 1;
        if (statement && statement.value && typeof statement.value === "object" && statement.value.op === "call") callSites += 1;
        if (statement && statement.value && typeof statement.value === "object" && statement.value.kind === "fold") callbackRefs += 1;
        for (const block of (statement && Array.isArray(statement.blocks)) ? statement.blocks : []) {
          stack.push({ depth: frame.depth + 1, statements: Array.isArray(block && block.statements) ? block.statements : [] });
        }
      }
    }
  }
  const modules = 1;
  const importEdges = 0;
  return Object.freeze({
    analysis_units: modules + decls + stmts + callSites + callbackRefs + importEdges,
    call_sites: callSites,
    callback_refs: callbackRefs,
    decls,
    import_edges: importEdges,
    modules,
    nesting_depth: nestingDepth,
    stmts
  });
}

// End of phase A, before any phase-S analysis. A measure equal to the
// capacity is admitted; when both exceed, analysis_units is named first.
function enforceAnalysisCapacity(mod, capacityInput) {
  const capacity = normalizeAnalysisCapacity(capacityInput);
  const measures = measureTypedModule(mod);
  if (measures.analysis_units > capacity.maxAnalysisUnits) {
    throw new AnalysisRefusedError("analysis_units", measures.analysis_units, capacity.maxAnalysisUnits);
  }
  if (measures.nesting_depth > capacity.maxSyntaxNestingDepth) {
    throw new AnalysisRefusedError("nesting_depth", measures.nesting_depth, capacity.maxSyntaxNestingDepth);
  }
  return measures;
}

module.exports = {
  ANALYSIS_CAPACITY_CODE,
  ANALYSIS_UNITS_FLOOR,
  AnalysisRefusedError,
  DEFAULT_ANALYSIS_CAPACITY,
  NESTING_DEPTH_FLOOR,
  enforceAnalysisCapacity,
  measureTypedModule,
  normalizeAnalysisCapacity
};
