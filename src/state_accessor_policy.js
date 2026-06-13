const fs = require("fs");
const path = require("path");
const { analyzePackageModuleGraph } = require("./module_graph");
const { validatePackageManifest, normalizePackageMetadata } = require("./package_manifest");
const { parseAir } = require("./parser");
const { analyzeObservationOnlyFunctions, observationSafetyDiagnostics } = require("./observation_safety");

const STATE_ACCESSOR_POLICY_FILE = "state_accessors.policy.json";
const STATE_ACCESSOR_POLICY_KIND = "air.stateAccessorPolicy";
const STATE_ACCESSOR_POLICY_SCHEMA_VERSION = "0.24";
const SCALAR_RETURN_TYPES = new Set(["i32", "i64", "f32", "f64", "bool"]);

function checkStateAccessorPolicies(packageDir, options = {}) {
  const base = path.resolve(packageDir);
  const policyPath = options.policyPath || STATE_ACCESSOR_POLICY_FILE;
  const absolutePolicyPath = path.join(base, policyPath);
  if (!fs.existsSync(absolutePolicyPath)) {
    return {
      ok: true,
      policies: [],
      diagnostics: [],
      warnings: [],
      errors: []
    };
  }

  const diagnostics = [];
  const errors = [];
  let policy = null;
  try {
    policy = JSON.parse(fs.readFileSync(absolutePolicyPath, "utf8"));
  } catch (err) {
    addDiagnostic(diagnostics, errors, "air.state.accessor_policy_invalid", `state accessor policy invalid: ${policyPath}: ${err.message || err}`, {
      path: policyPath
    });
    return finish(policyPath, diagnostics, errors, []);
  }

  const schemaDiagnostics = validatePolicySchema(policy, policyPath);
  for (const diagnostic of schemaDiagnostics) {
    diagnostics.push(diagnostic);
    errors.push(diagnostic.message);
  }
  if (schemaDiagnostics.length) return finish(policyPath, diagnostics, errors, helperSummaries(policy && policy.helpers));

  let graph = null;
  try {
    const manifest = validatePackageManifest(base, { built: false });
    const metadata = normalizePackageMetadata(manifest);
    graph = analyzePackageModuleGraph(base, metadata.entry);
  } catch (err) {
    addDiagnostic(diagnostics, errors, "air.state.accessor_policy_invalid", `state accessor policy could not inspect package graph: ${err.message || err}`, {
      path: policyPath
    });
    return finish(policyPath, diagnostics, errors, helperSummaries(policy.helpers));
  }

  const knownStates = new Set((graph.modules || []).flatMap((mod) => (mod.stateSegments || []).map((state) => state.name)));
  const functionIndex = indexFunctions(base, graph);
  const helpers = [];
  for (let index = 0; index < policy.helpers.length; index += 1) {
    const helper = policy.helpers[index];
    const helperReport = validateHelper(helper, index, policyPath, knownStates, functionIndex);
    helpers.push(helperReport.summary);
    diagnostics.push(...helperReport.diagnostics);
    errors.push(...helperReport.diagnostics.map((diagnostic) => diagnostic.message));
  }
  return finish(policyPath, diagnostics, errors, helpers);
}

function validatePolicySchema(policy, policyPath) {
  const diagnostics = [];
  const add = (message, fields = {}) => diagnostics.push(diagnostic("air.state.accessor_policy_invalid", "fail", message, { path: policyPath, ...fields }));
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    add(`state accessor policy must be a JSON object: ${policyPath}`);
    return diagnostics;
  }
  if (policy.schemaVersion !== STATE_ACCESSOR_POLICY_SCHEMA_VERSION) {
    add(`state accessor policy schemaVersion must be ${STATE_ACCESSOR_POLICY_SCHEMA_VERSION}`, { field: "schemaVersion" });
  }
  if (policy.kind !== STATE_ACCESSOR_POLICY_KIND) {
    add(`state accessor policy kind must be ${STATE_ACCESSOR_POLICY_KIND}`, { field: "kind" });
  }
  if (!Array.isArray(policy.helpers)) {
    add("state accessor policy helpers must be an array", { field: "helpers" });
    return diagnostics;
  }
  const seen = new Set();
  policy.helpers.forEach((helper, index) => {
    const prefix = `helpers[${index}]`;
    if (!helper || typeof helper !== "object" || Array.isArray(helper)) {
      add(`${prefix} must be an object`, { field: prefix });
      return;
    }
    if (!isStableIdent(helper.name)) {
      add(`${prefix}.name must be a stable AIR function identifier`, { field: `${prefix}.name` });
    } else if (seen.has(helper.name)) {
      add(`${prefix}.name duplicates helper ${helper.name}`, { field: `${prefix}.name`, helper: helper.name });
    } else {
      seen.add(helper.name);
    }
    if (!isStableIdent(helper.state)) add(`${prefix}.state must be a stable state identifier`, { field: `${prefix}.state` });
    if (helper.mode !== "readCell") add(`${prefix}.mode must be readCell in v0.24 P0`, { field: `${prefix}.mode`, helper: helper.name || null });
    if (typeof helper.exported !== "boolean") add(`${prefix}.exported must be a boolean`, { field: `${prefix}.exported`, helper: helper.name || null });
    if (typeof helper.observationOnly !== "boolean") add(`${prefix}.observationOnly must be a boolean`, { field: `${prefix}.observationOnly`, helper: helper.name || null });
    if (helper.observationOnly !== true) add(`${prefix}.observationOnly must be true in v0.24 P0`, { field: `${prefix}.observationOnly`, helper: helper.name || null });
  });
  return diagnostics;
}

function validateHelper(helper, index, policyPath, knownStates, functionIndex) {
  const diagnostics = [];
  const summary = {
    name: helper.name,
    state: helper.state,
    exported: Boolean(helper.exported),
    observationOnly: Boolean(helper.observationOnly),
    status: "pass"
  };
  const fields = { path: policyPath, helper: helper.name, state: helper.state, index };

  if (!knownStates.has(helper.state)) {
    diagnostics.push(diagnostic("air.state.accessor_unknown_state", "fail", `state accessor helper ${helper.name} references unknown state ${helper.state}`, fields));
  }

  const candidates = functionIndex.byName.get(helper.name) || [];
  if (!candidates.length) {
    diagnostics.push(diagnostic("air.state.accessor_missing", "fail", `state accessor helper missing: ${helper.name}`, fields));
    return failIfNeeded(summary, diagnostics);
  }
  if (candidates.length > 1) {
    diagnostics.push(diagnostic("air.state.accessor_policy_invalid", "fail", `state accessor helper ${helper.name} is ambiguous across package modules`, {
      ...fields,
      modules: candidates.map((candidate) => candidate.modulePath).sort()
    }));
    return failIfNeeded(summary, diagnostics);
  }

  const candidate = candidates[0];
  const fn = candidate.fn;
  summary.module = candidate.modulePath;
  summary.returnType = fn.returnType;
  if (helper.exported && !fn.exported) {
    diagnostics.push(diagnostic("air.state.accessor_export_mismatch", "fail", `state accessor helper ${helper.name} must be exported`, {
      ...fields,
      module: candidate.modulePath
    }));
  }
  if (!SCALAR_RETURN_TYPES.has(fn.returnType)) {
    diagnostics.push(diagnostic("air.state.accessor_return_invalid", "fail", `state accessor helper ${helper.name} must return a scalar non-reference value, got ${fn.returnType}`, {
      ...fields,
      module: candidate.modulePath,
      returnType: fn.returnType
    }));
  }
  for (const param of fn.params || []) {
    if (isReferenceLikeType(param.type)) {
      diagnostics.push(diagnostic("air.state.accessor_return_invalid", "fail", `state accessor helper ${helper.name} must not expose pointer/slice/reference parameter ${param.name}: ${param.type}`, {
        ...fields,
        module: candidate.modulePath,
        param: param.name,
        paramType: param.type
      }));
    }
  }
  const safetyDiagnostics = observationSafetyDiagnostics(candidate.safety, fn.name, {
    label: "state accessor helper",
    requireExported: Boolean(helper.exported)
  });
  for (const safety of safetyDiagnostics) {
    diagnostics.push(diagnostic("air.state.accessor_not_observation_safe", "fail", safety.message, {
      ...fields,
      module: candidate.modulePath,
      reason: safety.reason
    }));
  }
  return failIfNeeded(summary, diagnostics);
}

function indexFunctions(base, graph) {
  const byName = new Map();
  for (const modInfo of graph.modules || []) {
    const modulePath = modInfo.path;
    const source = fs.readFileSync(path.join(base, modulePath), "utf8");
    const mod = parseAir(source, path.join(base, modulePath), { resolveSourceImports: false });
    const safety = analyzeObservationOnlyFunctions(mod, { label: "state accessor helper" });
    for (const fn of mod.functions || []) {
      const list = byName.get(fn.name) || [];
      list.push({ modulePath, fn, mod, safety });
      byName.set(fn.name, list);
    }
  }
  return { byName };
}

function helperSummaries(helpers) {
  if (!Array.isArray(helpers)) return [];
  return helpers
    .filter((helper) => helper && typeof helper === "object")
    .map((helper) => ({
      name: helper.name || null,
      state: helper.state || null,
      exported: Boolean(helper.exported),
      observationOnly: Boolean(helper.observationOnly),
      status: "not_checked"
    }));
}

function failIfNeeded(summary, diagnostics) {
  if (diagnostics.length) summary.status = "fail";
  return { summary, diagnostics };
}

function finish(policyPath, diagnostics, errors, helpers) {
  const policy = {
    path: policyPath,
    status: errors.length ? "fail" : "pass",
    helpers: helpers.sort((a, b) => String(a.name).localeCompare(String(b.name))),
    diagnostics: diagnostics.sort(compareDiagnostics)
  };
  return {
    ok: errors.length === 0,
    policies: [policy],
    diagnostics: policy.diagnostics,
    warnings: [],
    errors: Array.from(new Set(errors)).sort()
  };
}

function diagnostic(code, severity, message, fields = {}) {
  return {
    code,
    severity,
    source: "package-check",
    message,
    fields
  };
}

function compareDiagnostics(a, b) {
  return String(a.code).localeCompare(String(b.code)) || String(a.message).localeCompare(String(b.message));
}

function isStableIdent(value) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(value || ""));
}

function isReferenceLikeType(type) {
  return type === "ptr" || type === "slice" || /(?:ptr|slice|ref|reference)/i.test(String(type || ""));
}

module.exports = {
  STATE_ACCESSOR_POLICY_FILE,
  checkStateAccessorPolicies
};
