function analyzeObservationOnlyFunctions(mod, options = {}) {
  const label = options.label || "observation helper";
  const functions = new Map((mod.functions || []).map((fn) => [fn.name, fn]));
  const externs = new Set((mod.externs || []).map((ex) => ex.name));
  const diagnostics = new Map();
  for (const fn of mod.functions || []) {
    const seen = new Set();
    const issues = analyzeFunctionForObservationSafety(fn, functions, externs, seen, label);
    if (issues.length) diagnostics.set(fn.name, issues);
  }
  return { functions, externs, diagnostics, unavailable: null, label };
}

function observationSafetyDiagnostics(safety, functionName, options = {}) {
  if (!safety) return [];
  const label = options.label || safety.label || "observation helper";
  if (safety.unavailable) {
    return [{ reason: "source_unavailable", message: `cannot validate ${label} ${functionName}: ${safety.unavailable}` }];
  }
  const fn = safety.functions.get(functionName);
  if (!fn) return [{ reason: "missing_source", message: `${label} ${functionName} is not visible in AIR source` }];
  if (options.requireExported && !fn.exported) {
    return [{ reason: "missing_export_source", message: `${label} ${functionName} is not an exported AIR function in package source` }];
  }
  return safety.diagnostics.get(functionName) || [];
}

function analyzeFunctionForObservationSafety(fn, functions, externs, seen, label) {
  if (!fn) return [{ reason: "missing_source", message: `${label} is not visible in AIR source` }];
  if (seen.has(fn.name)) return [];
  seen.add(fn.name);
  const issues = [];
  const addIssue = (reason, message) => issues.push({ reason, message });
  for (const block of fn.blocks || []) {
    for (const ins of block.instructions || []) {
      if (ins.op === "state.set") addIssue("state_write", `${label} ${fn.name} writes state`);
      if (ins.op === "global.set") addIssue("global_write", `${label} ${fn.name} writes a mutable global`);
      if (ins.op === "print") addIssue("host_output", `${label} ${fn.name} writes host output`);
      if (isMemoryWriteOp(ins.op)) addIssue("memory_write", `${label} ${fn.name} writes memory`);
      if (ins.op === "call") {
        if (externs.has(ins.callee) || looksHostImportCall(ins.callee)) {
          addIssue("host_call", `${label} ${fn.name} calls host import ${ins.callee}`);
          continue;
        }
        const callee = functions.get(ins.callee);
        if (!callee) {
          addIssue("unknown_call", `${label} ${fn.name} calls unknown function ${ins.callee}`);
          continue;
        }
        for (const issue of analyzeFunctionForObservationSafety(callee, functions, externs, seen, label)) {
          issues.push({
            reason: issue.reason,
            message: `${label} ${fn.name} calls ${callee.name}: ${issue.message}`
          });
        }
      }
    }
  }
  seen.delete(fn.name);
  return dedupeIssues(issues);
}

function isMemoryWriteOp(op) {
  return String(op || "").startsWith("store.") ||
    op === "buffer.store" ||
    String(op || "").startsWith("slice.store.") ||
    op === "mat4.store_f32";
}

function looksHostImportCall(name) {
  return /^(?:debug\.|output\.|audio\.|effect\.|gpu\.|gfx\.|input\.|io\.|ui\.|fs\.|net\.|time\.|random\.|wasi_snapshot_preview1\.)/.test(String(name || ""));
}

function dedupeIssues(issues) {
  const seen = new Set();
  return issues.filter((issue) => {
    const key = `${issue.reason}\0${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

module.exports = {
  analyzeObservationOnlyFunctions,
  observationSafetyDiagnostics,
  isMemoryWriteOp,
  looksHostImportCall
};
