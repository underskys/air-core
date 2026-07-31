"use strict";

const crypto = require("crypto");
const cp = require("child_process");
const fs = require("fs");
const path = require("path");
const { stableStringify } = require("./ai_authoring_eval");

const BENCHMARK_SCHEMA_VERSION = "0.49";
const BENCHMARK_KIND = "air.aiAuthoringComparisonBenchmark";
const BENCHMARK_REPORT_KIND = "air.aiAuthoringComparisonReport";
const CAPTURE_KIND = "air.aiAuthoringComparisonCapture";
const HARNESS_VERSION = "0.49.0";
const TARGETS = ["air", "typescript"];
const TASK_CLASSES = new Set([
  "policy_decision",
  "quota_rate_limit",
  "schema_mapping",
  "redaction",
  "bounded_state_machine",
  "tool_call_boundary",
  "capability_effect_constraint",
  "repair_defective_candidate"
]);
const SENSITIVE_KEY_RE = /api.?key|access.?token|secret|credential|authorization|cookie|private.?key|environment|env/i;
const SECRET_VALUE_RE = /-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:sk|xox[baprs]|glpat|gh[pousr])[-_A-Za-z0-9]{12,}\b|Bearer\s+\S{12,}/i;

function createAiAuthoringBenchmarkReport(benchmarkDir, options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  try {
    const benchmark = readBenchmark(benchmarkDir, cwd);
    const capture = readCapture(options.captureDir, benchmark, cwd);
    return buildReport(benchmark, capture, { mode: "import", cwd });
  } catch (error) {
    return failedReport(error);
  }
}

function runAiAuthoringBenchmarkAdapter(benchmarkDir, adapterConfigFile, options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  try {
    const benchmark = readBenchmark(benchmarkDir, cwd);
    const adapter = readAdapterConfig(adapterConfigFile, cwd);
    const runs = [];
    for (const task of benchmark.tasks) {
      for (const target of TARGETS) {
        runs.push(invokeAdapter(adapter, benchmark, task, target, cwd));
      }
    }
    const capture = normalizeCapture({
      captureId: adapter.runId,
      captureMode: "external_adapter",
      modelProvider: adapter.modelProvider,
      modelIdentifier: adapter.modelIdentifier,
      temperature: adapter.temperature,
      samplingParameters: adapter.samplingParameters,
      retryPolicy: adapter.retryPolicy,
      repairBudget: adapter.repairBudget,
      tokenCountSource: adapter.tokenCountSource,
      timestamp: adapter.timestamp,
      harnessVersion: HARNESS_VERSION,
      importedTranscriptDigest: null,
      adapterInvocations: runs.length,
      runs
    }, benchmark);
    return buildReport(benchmark, capture, { mode: "external_adapter", cwd });
  } catch (error) {
    return failedReport(error);
  }
}

function readBenchmark(benchmarkDir, cwd) {
  const base = path.resolve(benchmarkDir || "");
  if (!benchmarkDir || !isDirectory(base)) throw codedError("air.ai_benchmark.missing_dir", "benchmark directory does not exist");
  const file = path.join(base, "benchmark.json");
  const raw = readJson(file, "benchmark.json");
  assertObject(raw, "benchmark.json");
  if (raw.kind !== BENCHMARK_KIND) throw codedError("air.ai_benchmark.schema_invalid", `benchmark kind must be ${BENCHMARK_KIND}`);
  if (raw.schemaVersion !== BENCHMARK_SCHEMA_VERSION) throw codedError("air.ai_benchmark.schema_invalid", `benchmark schemaVersion must be ${BENCHMARK_SCHEMA_VERSION}`);
  if (raw.harnessVersion !== HARNESS_VERSION) throw codedError("air.ai_benchmark.schema_invalid", `harnessVersion must be ${HARNESS_VERSION}`);
  if (!stableId(raw.corpusId)) throw codedError("air.ai_benchmark.schema_invalid", "corpusId must be stable");
  if (!Array.isArray(raw.tasks) || raw.tasks.length !== TASK_CLASSES.size) {
    throw codedError("air.ai_benchmark.task_set_invalid", `benchmark must contain exactly ${TASK_CLASSES.size} task classes`);
  }
  const ids = new Set();
  const classes = new Set();
  const tasks = raw.tasks.map((task, index) => {
    assertObject(task, `tasks[${index}]`);
    if (!stableId(task.id) || ids.has(task.id)) throw codedError("air.ai_benchmark.task_set_invalid", `task id must be unique and stable: ${task.id}`);
    if (!TASK_CLASSES.has(task.taskClass) || classes.has(task.taskClass)) {
      throw codedError("air.ai_benchmark.task_set_invalid", `task class must appear exactly once: ${task.taskClass}`);
    }
    ids.add(task.id);
    classes.add(task.taskClass);
    const promptPath = safeRelativePath(task.prompt, `tasks[${index}].prompt`);
    const promptFile = path.resolve(base, promptPath);
    requireWithin(base, promptFile, `tasks[${index}].prompt`);
    if (!fs.existsSync(promptFile)) throw codedError("air.ai_benchmark.task_set_invalid", `missing prompt: ${promptPath}`);
    const prompt = normalizeText(fs.readFileSync(promptFile, "utf8"));
    if (!prompt.trim()) throw codedError("air.ai_benchmark.task_set_invalid", `prompt is empty: ${promptPath}`);
    if (!Array.isArray(task.behavioralRequirements) || !task.behavioralRequirements.length) {
      throw codedError("air.ai_benchmark.task_set_invalid", `task ${task.id} requires behavioralRequirements`);
    }
    if (!Number.isInteger(task.repairBudget) || task.repairBudget < 0 || task.repairBudget > 3) {
      throw codedError("air.ai_benchmark.task_set_invalid", `task ${task.id} repairBudget must be 0..3`);
    }
    const canonicalTask = stableObject({
      behavioralRequirements: task.behavioralRequirements.map(String),
      defectiveCandidate: task.defectiveCandidate || null,
      id: task.id,
      repairBudget: task.repairBudget,
      taskClass: task.taskClass
    });
    return stableObject({
      ...canonicalTask,
      prompt: promptPath,
      promptDigest: digest(prompt),
      taskDigest: digest(stableStringify(canonicalTask))
    });
  });
  if (classes.size !== TASK_CLASSES.size) throw codedError("air.ai_benchmark.task_set_invalid", "required task classes are incomplete");
  const evaluationRules = normalizeEvaluationRules(raw.evaluationRules);
  return stableObject({
    base,
    corpusId: raw.corpusId,
    corpusDigest: digest(stableStringify({
      corpusId: raw.corpusId,
      evaluationRules,
      tasks
    })),
    evaluationRules,
    harnessVersion: HARNESS_VERSION,
    tasks
  });
}

function readCapture(captureDir, benchmark, cwd) {
  const base = path.resolve(captureDir || "");
  if (!captureDir || !isDirectory(base)) throw codedError("air.ai_benchmark.capture_missing", "capture directory does not exist");
  const manifest = readJson(path.join(base, "MANIFEST.json"), "MANIFEST.json");
  assertSafeValue(manifest, "$.MANIFEST");
  assertObject(manifest, "MANIFEST.json");
  if (manifest.kind !== CAPTURE_KIND || manifest.schemaVersion !== BENCHMARK_SCHEMA_VERSION) {
    throw codedError("air.ai_benchmark.capture_invalid", "capture kind or schemaVersion is invalid");
  }
  const resultsPath = safeRelativePath(manifest.results, "MANIFEST.results");
  const resultsFile = path.resolve(base, resultsPath);
  requireWithin(base, resultsFile, "MANIFEST.results");
  const bytes = fs.readFileSync(resultsFile);
  const actualDigest = digest(bytes);
  if (manifest.resultsDigest !== actualDigest) {
    throw codedError("air.ai_benchmark.capture_digest_mismatch", `capture digest mismatch: expected ${manifest.resultsDigest}, received ${actualDigest}`);
  }
  let results;
  try {
    results = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw codedError("air.ai_benchmark.malformed_json", `results are malformed: ${error.message}`);
  }
  assertSafeValue(results, "$.results");
  assertObject(results, "results");
  if (!Array.isArray(results.runs)) throw codedError("air.ai_benchmark.capture_invalid", "results.runs must be an array");
  return normalizeCapture({
    ...manifest,
    importedTranscriptDigest: actualDigest,
    adapterInvocations: 0,
    runs: results.runs
  }, benchmark);
}

function readAdapterConfig(file, cwd) {
  const raw = readJson(path.resolve(file || ""), "adapter config");
  assertObject(raw, "adapter config");
  const allowed = new Set([
    "kind", "schemaVersion", "runId", "command", "args", "modelProvider",
    "modelIdentifier", "temperature", "samplingParameters", "retryPolicy",
    "repairBudget", "tokenCountSource", "timestamp"
  ]);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) throw codedError("air.ai_benchmark.adapter_invalid", `adapter config field is not allowed: ${key}`);
  }
  if (raw.kind !== "air.aiAuthoringProviderAdapter" || raw.schemaVersion !== BENCHMARK_SCHEMA_VERSION) {
    throw codedError("air.ai_benchmark.adapter_invalid", "adapter config kind or schemaVersion is invalid");
  }
  if (typeof raw.command !== "string" || !raw.command.trim()) throw codedError("air.ai_benchmark.adapter_invalid", "adapter command is required");
  if (!Array.isArray(raw.args) || raw.args.some((item) => typeof item !== "string")) {
    throw codedError("air.ai_benchmark.adapter_invalid", "adapter args must be an array of strings");
  }
  const normalized = {
    ...raw,
    args: raw.args.slice(),
    repairBudget: boundedInteger(raw.repairBudget, "adapter repairBudget", 0, 3),
    retryPolicy: normalizeRetryPolicy(raw.retryPolicy),
    samplingParameters: stableObject(raw.samplingParameters || {})
  };
  for (const field of ["runId", "modelProvider", "modelIdentifier", "tokenCountSource", "timestamp"]) {
    if (typeof normalized[field] !== "string" || !normalized[field]) throw codedError("air.ai_benchmark.adapter_invalid", `${field} is required`);
  }
  if (!Number.isFinite(normalized.temperature)) throw codedError("air.ai_benchmark.adapter_invalid", "temperature must be finite");
  return normalized;
}

function invokeAdapter(adapter, benchmark, task, target, cwd) {
  const languageTarget = target === "air" ? "canonical_readable_air" : "typescript_with_tests";
  const request = stableObject({
    behavioralRequirements: task.behavioralRequirements,
    corpusId: benchmark.corpusId,
    harnessVersion: HARNESS_VERSION,
    languageTarget,
    promptDigest: task.promptDigest,
    repairBudget: Math.min(task.repairBudget, adapter.repairBudget),
    retryPolicy: adapter.retryPolicy,
    taskClass: task.taskClass,
    taskDigest: task.taskDigest,
    taskId: task.id,
    target
  });
  const started = process.hrtime.bigint();
  const result = cp.spawnSync(adapter.command, adapter.args, {
    cwd,
    input: stableStringify(request),
    encoding: "utf8",
    env: process.env,
    maxBuffer: 4 * 1024 * 1024,
    timeout: 120000
  });
  const wallTimeMs = Number((process.hrtime.bigint() - started) / 1000000n);
  if (result.error || result.status !== 0) {
    throw codedError("air.ai_benchmark.adapter_failed", `provider adapter failed for ${task.id}/${target}: ${result.error ? result.error.message : `exit ${result.status}`}`);
  }
  let response;
  try {
    response = JSON.parse(result.stdout);
  } catch (error) {
    throw codedError("air.ai_benchmark.adapter_failed", `provider adapter returned malformed JSON for ${task.id}/${target}: ${error.message}`);
  }
  assertSafeValue(response, `$.adapter.${task.id}.${target}`);
  return {
    ...response,
    taskId: task.id,
    target,
    wallTimeMs: Number.isFinite(response.wallTimeMs) ? response.wallTimeMs : wallTimeMs
  };
}

function normalizeCapture(input, benchmark) {
  for (const field of ["captureId", "captureMode", "modelProvider", "modelIdentifier", "tokenCountSource", "timestamp"]) {
    if (typeof input[field] !== "string" || !input[field]) throw codedError("air.ai_benchmark.capture_invalid", `${field} is required`);
  }
  if (!Number.isFinite(input.temperature)) throw codedError("air.ai_benchmark.capture_invalid", "temperature must be finite");
  const retryPolicy = normalizeRetryPolicy(input.retryPolicy);
  const repairBudget = boundedInteger(input.repairBudget, "capture repairBudget", 0, 3);
  if (input.harnessVersion !== HARNESS_VERSION) throw codedError("air.ai_benchmark.capture_invalid", `capture harnessVersion must be ${HARNESS_VERSION}`);
  const taskById = new Map(benchmark.tasks.map((task) => [task.id, task]));
  const seen = new Set();
  const runs = (input.runs || []).map((run, index) => normalizeRun(run, index, taskById, retryPolicy, repairBudget));
  for (const run of runs) {
    const key = `${run.taskId}:${run.target}`;
    if (seen.has(key)) throw codedError("air.ai_benchmark.duplicate_run", `duplicate run: ${key}`);
    seen.add(key);
  }
  for (const task of benchmark.tasks) {
    for (const target of TARGETS) {
      if (!seen.has(`${task.id}:${target}`)) throw codedError("air.ai_benchmark.capture_incomplete", `missing run: ${task.id}:${target}`);
    }
  }
  if (runs.length !== benchmark.tasks.length * TARGETS.length) {
    throw codedError("air.ai_benchmark.capture_incomplete", "capture contains unexpected runs");
  }
  return stableObject({
    adapterInvocations: boundedInteger(input.adapterInvocations || 0, "adapterInvocations", 0, runs.length),
    captureId: input.captureId,
    captureMode: input.captureMode,
    harnessVersion: HARNESS_VERSION,
    importedTranscriptDigest: input.importedTranscriptDigest || null,
    modelIdentifier: input.modelIdentifier,
    modelProvider: input.modelProvider,
    repairBudget,
    retryPolicy,
    runs: runs.sort(compareRuns),
    samplingParameters: stableObject(input.samplingParameters || {}),
    temperature: input.temperature,
    timestamp: input.timestamp,
    tokenCountSource: input.tokenCountSource
  });
}

function normalizeRun(run, index, taskById, retryPolicy, repairBudget) {
  assertObject(run, `runs[${index}]`);
  const task = taskById.get(run.taskId);
  if (!task || !TARGETS.includes(run.target)) throw codedError("air.ai_benchmark.capture_invalid", `invalid run identity at runs[${index}]`);
  const providerAttempts = boundedInteger(run.providerAttempts, `runs[${index}].providerAttempts`, 1, 100);
  if (providerAttempts > retryPolicy.maxAttempts) {
    throw codedError("air.ai_benchmark.hidden_retry", `provider attempts exceed declared retry policy for ${run.taskId}/${run.target}`);
  }
  const firstPass = normalizeGateSet(run.firstPass, run.target, `runs[${index}].firstPass`);
  const repairs = Array.isArray(run.repairs) ? run.repairs.map((repair, repairIndex) => {
    assertObject(repair, `runs[${index}].repairs[${repairIndex}]`);
    if (repair.iteration !== repairIndex + 1 || repair.iteration > Math.min(task.repairBudget, repairBudget)) {
      throw codedError("air.ai_benchmark.repair_invalid", `repair iterations must be ordered and within budget for ${run.taskId}/${run.target}`);
    }
    return stableObject({
      accepted: Boolean(repair.accepted),
      gates: normalizeGateSet(repair.gates, run.target, `runs[${index}].repairs[${repairIndex}].gates`),
      iteration: repair.iteration
    });
  }) : [];
  const rawFailures = Array.isArray(run.rawFailures) ? run.rawFailures.map((failure, failureIndex) => {
    assertObject(failure, `runs[${index}].rawFailures[${failureIndex}]`);
    if (typeof failure.code !== "string" || typeof failure.summary !== "string") {
      throw codedError("air.ai_benchmark.capture_invalid", `raw failure requires code and summary for ${run.taskId}/${run.target}`);
    }
    return stableObject({ code: failure.code, phase: String(failure.phase || "unknown"), summary: failure.summary });
  }) : [];
  const failedGateCount = Object.values(firstPass).filter((value) => value === false).length;
  if (failedGateCount && !rawFailures.length) {
    throw codedError("air.ai_benchmark.raw_failure_missing", `failed first pass must preserve rawFailures for ${run.taskId}/${run.target}`);
  }
  const generatedTokens = normalizeTokens(run.generatedTokens, `runs[${index}].generatedTokens`);
  return stableObject({
    capabilityEffectViolations: stringArray(run.capabilityEffectViolations),
    falseRejection: Boolean(run.falseRejection),
    firstPass,
    forbiddenApis: stringArray(run.forbiddenApis),
    generatedTokens,
    humanReviewTimeMs: run.humanReviewTimeMs === null || run.humanReviewTimeMs === undefined
      ? null
      : boundedInteger(run.humanReviewTimeMs, `runs[${index}].humanReviewTimeMs`, 0, Number.MAX_SAFE_INTEGER),
    promptDigest: task.promptDigest,
    providerAttempts,
    rawFailures,
    repairs,
    target: run.target,
    taskDigest: task.taskDigest,
    taskId: task.id,
    transcriptDigest: digest(stableStringify(run)),
    unsafeAcceptance: Boolean(run.unsafeAcceptance),
    wallTimeMs: boundedInteger(run.wallTimeMs, `runs[${index}].wallTimeMs`, 0, Number.MAX_SAFE_INTEGER)
  });
}

function normalizeGateSet(value, target, label) {
  assertObject(value, label);
  const out = {
    syntaxParse: boolean(value.syntaxParse, `${label}.syntaxParse`),
    airVerify: target === "air" ? boolean(value.airVerify, `${label}.airVerify`) : null,
    airPackageCheck: target === "air" ? boolean(value.airPackageCheck, `${label}.airPackageCheck`) : null,
    typescriptCompile: target === "typescript" ? boolean(value.typescriptCompile, `${label}.typescriptCompile`) : null,
    typescriptTest: target === "typescript" ? boolean(value.typescriptTest, `${label}.typescriptTest`) : null
  };
  return stableObject(out);
}

function normalizeEvaluationRules(value) {
  assertObject(value, "evaluationRules");
  if (value.repairSuccessWithin !== 3 || value.noHiddenRetry !== true || value.preserveRawFailures !== true) {
    throw codedError("air.ai_benchmark.schema_invalid", "evaluationRules must require three-iteration repair, no hidden retry, and raw failure preservation");
  }
  return stableObject({
    confidenceLevel: value.confidenceLevel === 0.95 ? 0.95 : 0.95,
    noHiddenRetry: true,
    preserveRawFailures: true,
    repairSuccessWithin: 3
  });
}

function normalizeRetryPolicy(value) {
  assertObject(value, "retryPolicy");
  return stableObject({
    maxAttempts: boundedInteger(value.maxAttempts, "retryPolicy.maxAttempts", 1, 100),
    strategy: typeof value.strategy === "string" && value.strategy ? value.strategy : "none"
  });
}

function normalizeTokens(value, label) {
  assertObject(value, label);
  return stableObject({
    input: boundedInteger(value.input, `${label}.input`, 0, Number.MAX_SAFE_INTEGER),
    output: boundedInteger(value.output, `${label}.output`, 0, Number.MAX_SAFE_INTEGER)
  });
}

function buildReport(benchmark, capture, context) {
  const runs = capture.runs;
  const targetMetrics = Object.fromEntries(TARGETS.map((target) => [target, metricsForRuns(runs.filter((run) => run.target === target), target)]));
  const pairs = benchmark.tasks.map((task) => {
    const air = runs.find((run) => run.taskId === task.id && run.target === "air");
    const typescript = runs.find((run) => run.taskId === task.id && run.target === "typescript");
    return stableObject({
      air: summarizeRun(air),
      behavioralRequirements: task.behavioralRequirements,
      promptDigest: task.promptDigest,
      taskClass: task.taskClass,
      taskDigest: task.taskDigest,
      taskId: task.id,
      typescript: summarizeRun(typescript)
    });
  });
  const replayDigest = digest(stableStringify({
    benchmark: { corpusDigest: benchmark.corpusDigest, evaluationRules: benchmark.evaluationRules },
    capture,
    pairs
  }));
  const limitations = [
    "checked-in replay fixtures are historical deterministic baseline data, not live-model evidence",
    "the harness does not claim AIR superiority",
    "token counts are accepted only with their declared source and are not normalized across providers",
    "human review time is absent unless explicitly supplied",
    "confidence intervals describe this bounded corpus only"
  ];
  if (context.mode === "external_adapter") limitations.splice(0, 1, "external adapter results are evidence only for the declared provider, model, parameters, timestamp, and corpus");
  return stableObject({
    capture: {
      captureId: capture.captureId,
      captureMode: capture.captureMode,
      importedTranscriptDigest: capture.importedTranscriptDigest,
      modelIdentifier: capture.modelIdentifier,
      modelProvider: capture.modelProvider,
      repairBudget: capture.repairBudget,
      retryPolicy: capture.retryPolicy,
      samplingParameters: capture.samplingParameters,
      temperature: capture.temperature,
      timestamp: capture.timestamp,
      tokenCountSource: capture.tokenCountSource
    },
    corpusDigest: benchmark.corpusDigest,
    corpusId: benchmark.corpusId,
    diagnostics: [],
    evaluationRules: benchmark.evaluationRules,
    harnessVersion: HARNESS_VERSION,
    kind: BENCHMARK_REPORT_KIND,
    limitations,
    metrics: stableObject({
      adapterInvocations: capture.adapterInvocations,
      duplicateRunCount: 0,
      pairedTaskEquivalence: true,
      replayDigest,
      replayReproducible: context.mode === "import",
      targetMetrics
    }),
    mode: context.mode,
    pairs,
    rawResults: runs,
    recommendation: "NEEDS_MORE_EVIDENCE",
    schemaVersion: BENCHMARK_SCHEMA_VERSION,
    status: "passed"
  });
}

function metricsForRuns(runs, target) {
  const total = runs.length;
  const firstPassSuccess = runs.filter((run) => gateSuccess(run.firstPass, target) && !run.unsafeAcceptance).length;
  const repairNeeded = runs.filter((run) => !gateSuccess(run.firstPass, target) || run.unsafeAcceptance);
  const successAt1 = repairNeeded.filter((run) => repairSuccessIteration(run, target) !== null && repairSuccessIteration(run, target) <= 1).length;
  const successAt3 = repairNeeded.filter((run) => repairSuccessIteration(run, target) !== null && repairSuccessIteration(run, target) <= 3).length;
  const completedRepairIterations = repairNeeded.map((run) => {
    const success = repairSuccessIteration(run, target);
    return success === null ? run.repairs.length : success;
  });
  const metric = (predicate) => rateMetric(runs.filter(predicate).length, total);
  return stableObject({
    averageRepairIterations: average(completedRepairIterations),
    capabilityEffectViolationCount: sum(runs.map((run) => run.capabilityEffectViolations.length)),
    falseRejectionCount: runs.filter((run) => run.falseRejection).length,
    firstPassAirPackageCheck: target === "air" ? metric((run) => run.firstPass.airPackageCheck) : null,
    firstPassAirVerify: target === "air" ? metric((run) => run.firstPass.airVerify) : null,
    firstPassOverallSuccess: rateMetric(firstPassSuccess, total),
    firstPassSyntaxParse: metric((run) => run.firstPass.syntaxParse),
    firstPassTypeScriptCompile: target === "typescript" ? metric((run) => run.firstPass.typescriptCompile) : null,
    firstPassTypeScriptTest: target === "typescript" ? metric((run) => run.firstPass.typescriptTest) : null,
    forbiddenApiCount: sum(runs.map((run) => run.forbiddenApis.length)),
    generatedInputTokens: sum(runs.map((run) => run.generatedTokens.input)),
    generatedOutputTokens: sum(runs.map((run) => run.generatedTokens.output)),
    humanReviewTimeMs: nullableSum(runs.map((run) => run.humanReviewTimeMs)),
    providerAttemptCount: sum(runs.map((run) => run.providerAttempts)),
    repairCases: repairNeeded.length,
    repairSuccessWithin1: rateMetric(successAt1, repairNeeded.length),
    repairSuccessWithin3: rateMetric(successAt3, repairNeeded.length),
    totalRuns: total,
    unsafeAcceptanceCount: runs.filter((run) => run.unsafeAcceptance).length,
    wallTimeMs: sum(runs.map((run) => run.wallTimeMs))
  });
}

function summarizeRun(run) {
  return stableObject({
    firstPassSuccess: gateSuccess(run.firstPass, run.target) && !run.unsafeAcceptance,
    repairSuccessIteration: repairSuccessIteration(run, run.target),
    transcriptDigest: run.transcriptDigest
  });
}

function gateSuccess(gates, target) {
  return target === "air"
    ? gates.syntaxParse && gates.airVerify && gates.airPackageCheck
    : gates.syntaxParse && gates.typescriptCompile && gates.typescriptTest;
}

function repairSuccessIteration(run, target) {
  const found = run.repairs.find((repair) => repair.accepted && gateSuccess(repair.gates, target));
  return found ? found.iteration : null;
}

function rateMetric(successes, total) {
  const rate = total ? round(successes / total) : null;
  return stableObject({ confidenceInterval95: wilson(successes, total), rate, successes, total });
}

function wilson(successes, total) {
  if (!total) return null;
  const z = 1.959963984540054;
  const p = successes / total;
  const denominator = 1 + (z * z) / total;
  const center = (p + (z * z) / (2 * total)) / denominator;
  const margin = (z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total)) / denominator;
  return [round(Math.max(0, center - margin)), round(Math.min(1, center + margin))];
}

function failedReport(error) {
  return stableObject({
    diagnostics: [{
      code: error.code || "air.ai_benchmark.failed",
      message: error.message,
      severity: "fail",
      source: "ai-authoring-benchmark"
    }],
    harnessVersion: HARNESS_VERSION,
    kind: BENCHMARK_REPORT_KIND,
    limitations: ["benchmark did not produce evidence because validation or execution failed"],
    recommendation: "NEEDS_MORE_EVIDENCE",
    schemaVersion: BENCHMARK_SCHEMA_VERSION,
    status: "failed"
  });
}

function assertSafeValue(value, location) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeValue(item, `${location}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (SENSITIVE_KEY_RE.test(key)) throw codedError("air.ai_benchmark.credential_rejected", `sensitive field is not allowed: ${location}.${key}`);
      assertSafeValue(item, `${location}.${key}`);
    }
    return;
  }
  if (typeof value === "string" && SECRET_VALUE_RE.test(value)) {
    throw codedError("air.ai_benchmark.credential_rejected", `secret-like value is not allowed: ${location}`);
  }
}

function readJson(file, label) {
  if (!file || !fs.existsSync(file)) throw codedError("air.ai_benchmark.file_missing", `${label} is missing`);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw codedError("air.ai_benchmark.malformed_json", `${label} is malformed: ${error.message}`);
  }
}

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw codedError("air.ai_benchmark.schema_invalid", `${label} must be an object`);
}

function safeRelativePath(value, label) {
  if (typeof value !== "string" || !value || path.isAbsolute(value) || value.split(/[\\/]/).includes("..")) {
    throw codedError("air.ai_benchmark.path_invalid", `${label} must be a package-local relative path`);
  }
  return value.replace(/\\/g, "/");
}

function requireWithin(base, candidate, label) {
  if (candidate !== base && !candidate.startsWith(`${base}${path.sep}`)) {
    throw codedError("air.ai_benchmark.path_invalid", `${label} escapes the benchmark directory`);
  }
}

function boundedInteger(value, label, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw codedError("air.ai_benchmark.schema_invalid", `${label} must be an integer in ${min}..${max}`);
  return value;
}

function boolean(value, label) {
  if (typeof value !== "boolean") throw codedError("air.ai_benchmark.schema_invalid", `${label} must be boolean`);
  return value;
}

function stringArray(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw codedError("air.ai_benchmark.schema_invalid", "expected an array of strings");
  return Array.from(new Set(value)).sort();
}

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isDirectory(value) {
  return fs.existsSync(value) && fs.statSync(value).isDirectory();
}

function stableId(value) {
  return typeof value === "string" && /^[a-z][a-z0-9_:-]{0,127}$/.test(value);
}

function normalizeText(value) {
  return String(value).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function digest(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableObject(value[key])]));
}

function compareRuns(a, b) {
  return `${a.taskId}:${a.target}`.localeCompare(`${b.taskId}:${b.target}`);
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function nullableSum(values) {
  const present = values.filter((value) => value !== null);
  return present.length ? sum(present) : null;
}

function average(values) {
  return values.length ? round(sum(values) / values.length) : null;
}

function round(value) {
  return Number(value.toFixed(4));
}

module.exports = {
  BENCHMARK_KIND,
  BENCHMARK_REPORT_KIND,
  BENCHMARK_SCHEMA_VERSION,
  CAPTURE_KIND,
  HARNESS_VERSION,
  createAiAuthoringBenchmarkReport,
  runAiAuthoringBenchmarkAdapter,
  stableStringify
};
