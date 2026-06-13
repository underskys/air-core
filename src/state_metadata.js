const path = require("path");
const { collectEffectUsage } = require("./verifier");
const { scalarByteWidth } = require("./types");

function stateSegmentMetadata(mod, options = {}) {
  const usage = options.usage || safeUsage(mod);
  const budgets = stateBudgets(mod);
  return (mod.states || [])
    .map((state) => {
      const byteWidth = scalarByteWidth(state.type) || 0;
      const byteSize = (state.length || 0) * byteWidth;
      return {
        name: state.name,
        cellType: state.type,
        length: state.length,
        byteWidth,
        byteSize,
        staticBytes: byteSize,
        persistent: true,
        exported: false,
        shared: false,
        initializer: {
          kind: state.init && state.init.kind ? state.init.kind : null,
          value: state.init && state.init.value ? state.init.value.value : null
        },
        readBudget: budgets.read,
        writeBudget: budgets.write,
        sizeBudget: budgets.size,
        moduleObservedReads: usage.get("state.read") || 0,
        moduleObservedWrites: usage.get("state.write") || 0,
        diagnostics: stateBudgetDiagnostics(state, usage, budgets),
        module: options.modulePath || mod.name,
        source: stateSource(state),
        origin: stateOrigin(state)
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function stateSegmentSummary(mod, options = {}) {
  const segments = stateSegmentMetadata(mod, options);
  return {
    count: segments.length,
    names: segments.map((segment) => segment.name).sort(),
    totalStaticBytes: segments.reduce((sum, segment) => sum + segment.staticBytes, 0)
  };
}

function stateBudgets(mod) {
  const out = {
    read: null,
    write: null,
    size: null
  };
  for (const budget of mod.effects || []) {
    if (budget.key === "state.read") out.read = budgetSummary(budget);
    if (budget.key === "state.write") out.write = budgetSummary(budget);
    if (budget.key === "state.static_bytes" || budget.key === "memory.static_state_bytes") out.size = budgetSummary(budget);
  }
  return out;
}

function budgetSummary(budget) {
  return {
    key: budget.key,
    op: budget.op || "<=",
    limit: budget.limit
  };
}

function stateBudgetDiagnostics(state, usage, budgets) {
  const diagnostics = [];
  addBudgetDiagnostic(diagnostics, budgets.read, usage.get("state.read") || 0, "air.state.read_budget_exceeded", state);
  addBudgetDiagnostic(diagnostics, budgets.write, usage.get("state.write") || 0, "air.state.write_budget_exceeded", state);
  addBudgetDiagnostic(diagnostics, budgets.size, usage.get("state.static_bytes") || 0, "air.state.size_budget_exceeded", state);
  return diagnostics.sort((a, b) => a.code.localeCompare(b.code) || a.message.localeCompare(b.message));
}

function addBudgetDiagnostic(diagnostics, budget, actual, code, state) {
  if (!budget || compareMetric(actual, budget.op, budget.limit)) return;
  diagnostics.push({
    code,
    severity: "fail",
    message: `module-level state budget '${budget.key} ${budget.op} ${budget.limit}' is not satisfied: ${actual}`,
    fields: {
      state: state.name,
      scope: "module",
      budget: budget.key,
      op: budget.op,
      limit: budget.limit,
      moduleActual: actual
    }
  });
}

function compareMetric(actual, op, limit) {
  if (op === "<=") return actual <= limit;
  if (op === "==") return actual === limit;
  if (op === ">=") return actual >= limit;
  return false;
}

function safeUsage(mod) {
  try {
    return collectEffectUsage(mod);
  } catch (_) {
    return new Map();
  }
}

function stateOrigin(state) {
  const file = state && state.loc && state.loc.file ? state.loc.file.replace(/\\/g, "/") : "";
  return /(^|\/)generated\//.test(file) ? "generated" : "manual";
}

function stateSource(state) {
  const file = state && state.loc && state.loc.file ? state.loc.file : null;
  if (!file) return null;
  return path.normalize(file).replace(/\\/g, "/");
}

module.exports = {
  stateSegmentMetadata,
  stateSegmentSummary
};
