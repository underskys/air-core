// QA52 P2-8: deterministic structural bound for the observation-safety
// analysis. A non-semantic tooling limit (same maintenance figure as the
// legacy verifier summary work); exceeding it fails closed with
// `analysis_limit_exceeded`, never with a JavaScript stack overflow.
const OBSERVATION_ANALYSIS_WORK_LIMIT = 4194304;

function analyzeObservationOnlyFunctions(mod, options = {}) {
  const label = options.label || "observation helper";
  const functions = new Map((mod.functions || []).map((fn) => [fn.name, fn]));
  const externs = new Set((mod.externs || []).map((ex) => ex.name));
  const diagnostics = new Map();
  const meter = { units: 0, limit: OBSERVATION_ANALYSIS_WORK_LIMIT, exceeded: false };
  // Callee summaries do not depend on the call path when the local call graph
  // is acyclic, so they are shared by every root; with local recursion each
  // root keeps its own memo, as the former per-root walk did.
  const sharedMemo = localCallGraphAcyclic(functions, externs) ? new Map() : null;
  for (const fn of mod.functions || []) {
    const issues = observationIssuesForRoot(fn, functions, externs, label, sharedMemo || new Map(), meter);
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

function observationIssuesForRoot(root, functions, externs, label, memo, meter) {
  const limitIssue = [{
    reason: "analysis_limit_exceeded",
    message: `${label} ${root.name} exceeds the observation analysis limit ${meter.limit}`
  }];
  if (meter.exceeded) return limitIssue;
  try {
    return runObservationAnalysis(root, functions, externs, label, memo, meter)
      .map((issue) => ({ reason: issue.reason, message: issue.message }));
  } catch (error) {
    if (error !== OBSERVATION_LIMIT) throw error;
    meter.exceeded = true;
    return limitIssue;
  }
}

const OBSERVATION_LIMIT = Symbol("observation analysis limit");

function chargeObservation(meter, units) {
  meter.units += units;
  if (meter.units > meter.limit) throw OBSERVATION_LIMIT;
}

// Explicit frame stack instead of recursion. A callee already on the active
// path contributes nothing (as before); any other callee is summarised once
// per memo. A summary keeps each distinct origin issue once, with the first
// call path that reaches it, so its size is bounded by the number of origin
// issues instead of the number of call paths. The set of reasons and origin
// issues is the same as the former exhaustive walk.
function runObservationAnalysis(root, functions, externs, label, memo, meter) {
  const frames = [];
  const active = new Set();
  const enter = (fn) => {
    chargeObservation(meter, 1);
    frames.push({ fn, steps: observationSteps(fn, functions, externs, label, meter) });
    active.add(fn.name);
  };
  enter(root);
  let input;
  for (;;) {
    const frame = frames[frames.length - 1];
    const step = frame.steps.next(input);
    input = undefined;
    if (step.done) {
      frames.pop();
      active.delete(frame.fn.name);
      if (!frames.length) return step.value;
      memo.set(frame.fn.name, step.value);
      input = step.value;
      continue;
    }
    const callee = step.value;
    chargeObservation(meter, 1);
    if (active.has(callee.name)) input = [];
    else if (memo.has(callee.name)) input = memo.get(callee.name);
    else enter(callee);
  }
}

function* observationSteps(fn, functions, externs, label, meter) {
  const issues = [];
  const addIssue = (reason, message) => issues.push({ reason, message, origin: message });
  for (const block of fn.blocks || []) {
    for (const ins of block.instructions || []) {
      chargeObservation(meter, 1);
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
        const nested = yield callee;
        chargeObservation(meter, nested.length);
        for (const issue of nested) {
          issues.push({
            reason: issue.reason,
            message: `${label} ${fn.name} calls ${callee.name}: ${issue.message}`,
            origin: issue.origin
          });
        }
      }
    }
  }
  return firstIssuePerOrigin(issues);
}

function firstIssuePerOrigin(issues) {
  const seen = new Set();
  return issues.filter((issue) => {
    const key = `${issue.reason}\0${issue.origin}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function localCallGraphAcyclic(functions, externs) {
  const state = new Map();
  for (const root of functions.keys()) {
    if (state.has(root)) continue;
    const stack = [{ name: root, callees: localObservationCallees(functions.get(root), functions, externs), next: 0 }];
    state.set(root, "active");
    while (stack.length) {
      const top = stack[stack.length - 1];
      if (top.next >= top.callees.length) {
        state.set(top.name, "done");
        stack.pop();
        continue;
      }
      const callee = top.callees[top.next];
      top.next += 1;
      const seen = state.get(callee);
      if (seen === "active") return false;
      if (seen) continue;
      state.set(callee, "active");
      stack.push({ name: callee, callees: localObservationCallees(functions.get(callee), functions, externs), next: 0 });
    }
  }
  return true;
}

function localObservationCallees(fn, functions, externs) {
  const callees = [];
  for (const block of fn.blocks || []) {
    for (const ins of block.instructions || []) {
      if (ins.op !== "call" || externs.has(ins.callee) || looksHostImportCall(ins.callee)) continue;
      if (functions.has(ins.callee)) callees.push(ins.callee);
    }
  }
  return callees;
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

module.exports = {
  analyzeObservationOnlyFunctions,
  observationSafetyDiagnostics,
  isMemoryWriteOp,
  looksHostImportCall
};
