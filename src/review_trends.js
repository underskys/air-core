const fs = require("fs");
const { normalizeDiagnostic, sortDiagnostics } = require("./diagnostics");

const BASELINE_SCHEMA_VERSION = "0.15";

function createReviewBaseline(report) {
  const modules = {};
  for (const moduleReview of (report.moduleReviews || []).slice().sort((a, b) => a.path.localeCompare(b.path))) {
    const metrics = moduleReview.metrics || {};
    const functions = {};
    for (const fn of (metrics.functionsDetail || []).slice().sort((a, b) => a.name.localeCompare(b.name))) {
      functions[fn.name] = stableObject({
        blocks: fn.blocks || 0,
        exported: Boolean(fn.exported),
        statements: fn.statements || 0
      });
    }
    modules[moduleReview.path] = stableObject({
      pathClass: moduleReview.pathClass || "authored",
      lines: metrics.lines || 0,
      statements: metrics.statements || 0,
      mutableGlobals: metrics.globals || 0,
      functions
    });
  }
  return stableObject({
    schemaVersion: BASELINE_SCHEMA_VERSION,
    package: report.package || null,
    profile: report.profile || null,
    pathClasses: (report.reviewPolicyReport && report.reviewPolicyReport.pathClassOrder) || [],
    metrics: {
      graph: {
        modules: (report.modules || []).length,
        edges: ((report.graph && report.graph.edges) || []).length
      },
      modules,
      diagnostics: diagnosticCounts(report),
      generated: generatedFreshnessMetrics(report),
      manifests: manifestMetrics(report)
    }
  });
}

function compareReviewBaseline(report, baselineInput, options = {}) {
  const baseline = typeof baselineInput === "string" ? JSON.parse(fs.readFileSync(baselineInput, "utf8")) : baselineInput;
  const current = createReviewBaseline(report);
  const policy = options.policy || report.reviewPolicy || {};
  const trendPolicy = policy.trend || {};
  const diagnostics = [];
  compareGraphMetrics(diagnostics, baseline, current, trendPolicy);
  compareModuleMetrics(diagnostics, baseline, current, trendPolicy);
  compareDiagnosticCounts(diagnostics, baseline, current, trendPolicy);
  const sorted = sortDiagnostics(diagnostics);
  return {
    schemaVersion: BASELINE_SCHEMA_VERSION,
    baseline: typeof baselineInput === "string" ? baselineInput : null,
    status: sorted.some((diagnostic) => diagnostic.packageStatusImpact === "fail") ? "fail" : (sorted.length ? "warn" : "pass"),
    diagnostics: sorted
  };
}

function compareGraphMetrics(out, baseline, current, policy) {
  const base = baseline.metrics?.graph || {};
  const next = current.metrics?.graph || {};
  addTrendIfIncreased(out, {
    code: "air.trend.graph_modules_increased",
    message: "package module count increased",
    metric: "graph.modules",
    file: null,
    baseline: base.modules || 0,
    value: next.modules || 0,
    threshold: threshold(policy, "graphModuleDelta", 1),
    policy
  });
  addTrendIfIncreased(out, {
    code: "air.trend.graph_edges_increased",
    message: "package module edge count increased",
    metric: "graph.edges",
    file: null,
    baseline: base.edges || 0,
    value: next.edges || 0,
    threshold: threshold(policy, "graphEdgeDelta", 1),
    policy
  });
}

function compareModuleMetrics(out, baseline, current, policy) {
  const baselineModules = baseline.metrics?.modules || {};
  const currentModules = current.metrics?.modules || {};
  const ignored = new Set((policy.ignorePathClasses || []).concat(policy.ignoredPathClasses || []));
  for (const file of Object.keys(currentModules).sort()) {
    const now = currentModules[file];
    if (ignored.has(now.pathClass)) continue;
    const before = baselineModules[file] || {};
    addTrendIfIncreased(out, {
      code: "air.trend.module_statements_increased",
      message: `module ${file} statement count increased`,
      metric: "module.statements",
      file,
      pathClass: now.pathClass,
      baseline: before.statements || 0,
      value: now.statements || 0,
      threshold: threshold(policy, "moduleStatementDelta", 20),
      policy
    });
    addTrendIfIncreased(out, {
      code: "air.trend.module_lines_increased",
      message: `module ${file} line count increased`,
      metric: "module.lines",
      file,
      pathClass: now.pathClass,
      baseline: before.lines || 0,
      value: now.lines || 0,
      threshold: threshold(policy, "moduleLineDelta", 20),
      policy
    });
    addTrendIfIncreased(out, {
      code: "air.trend.mutable_globals_increased",
      message: `module ${file} mutable global count increased`,
      metric: "module.mutableGlobals",
      file,
      pathClass: now.pathClass,
      baseline: before.mutableGlobals || 0,
      value: now.mutableGlobals || 0,
      threshold: threshold(policy, "mutableGlobalDelta", 1),
      policy
    });
    const beforeFunctions = before.functions || {};
    const nowFunctions = now.functions || {};
    for (const name of Object.keys(nowFunctions).sort()) {
      addTrendIfIncreased(out, {
        code: "air.trend.function_statements_increased",
        message: `function ${name} statement count increased`,
        metric: "function.statements",
        file,
        symbol: name,
        pathClass: now.pathClass,
        baseline: (beforeFunctions[name] && beforeFunctions[name].statements) || 0,
        value: nowFunctions[name].statements || 0,
        threshold: threshold(policy, "functionStatementDelta", 8),
        policy
      });
    }
  }
}

function compareDiagnosticCounts(out, baseline, current, policy) {
  const baselineCounts = baseline.metrics?.diagnostics || {};
  const currentCounts = current.metrics?.diagnostics || {};
  const codes = Array.from(new Set(Object.keys(baselineCounts).concat(Object.keys(currentCounts)))).sort();
  for (const code of codes) {
    addTrendIfIncreased(out, {
      code: "air.trend.diagnostic_count_increased",
      message: `diagnostic count increased for ${code}`,
      metric: `diagnostics.${code}`,
      file: null,
      baseline: baselineCounts[code] || 0,
      value: currentCounts[code] || 0,
      threshold: threshold(policy, "diagnosticCountDelta", 1),
      policy,
      fields: { diagnosticCode: code }
    });
  }
}

function addTrendIfIncreased(out, input) {
  const delta = input.value - input.baseline;
  if (delta <= input.threshold) return;
  const gate = gateForTrend(input, input.policy || null);
  if (gate === "off") return;
  const diagnostic = normalizeDiagnostic({
    code: input.code,
    severity: gate,
    source: "trend",
    category: "trend",
    message: `${input.message}: baseline ${input.baseline}, current ${input.value}, delta ${delta}, threshold ${input.threshold}`,
    repairHint: "reduce the review metric or update the baseline through an explicit review",
    file: input.file,
    module: input.file,
    symbol: input.symbol || null,
    metric: input.metric,
    value: input.value,
    threshold: input.threshold,
    pathClass: input.pathClass || null,
    gateAction: gate,
    packageStatusImpact: gate,
    fields: {
      ...(input.fields || {}),
      baseline: input.baseline,
      delta
    }
  });
  out.push(diagnostic);
}

function gateForTrend(input, policy) {
  const gates = (policy && policy.gates) || {};
  return gates[input.code] || gates[input.metric] || "warn";
}

function threshold(policy, key, fallback) {
  return Number.isFinite(policy.thresholds && policy.thresholds[key]) ? policy.thresholds[key] : fallback;
}

function diagnosticCounts(report) {
  const counts = {};
  for (const diagnostic of report.diagnostics || []) {
    if (!diagnostic.code) continue;
    counts[diagnostic.code] = (counts[diagnostic.code] || 0) + 1;
  }
  return stableObject(counts);
}

function generatedFreshnessMetrics(report) {
  const generatedArtifacts = report.generatedArtifacts || {};
  const generatedHandles = report.generatedHandles || {};
  return stableObject({
    artifactErrors: (generatedArtifacts.errors || []).length,
    artifactWarnings: (generatedArtifacts.warnings || []).length,
    handleErrors: (generatedHandles.errors || []).length
  });
}

function manifestMetrics(report) {
  return stableObject({
    manifestErrors: (report.errors || []).filter((item) => /manifest/i.test(item)).length,
    manifestWarnings: (report.warnings || []).filter((item) => /manifest/i.test(item)).length
  });
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = stableObject(value[key]);
  return out;
}

module.exports = {
  BASELINE_SCHEMA_VERSION,
  createReviewBaseline,
  compareReviewBaseline
};
