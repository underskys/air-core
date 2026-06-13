const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { repairHintForDiagnosticCode } = require("./diagnostics");

const AI_EVAL_SCHEMA_VERSION = "0.32";
const AI_EVAL_REGRESSION_SCHEMA_VERSION = "0.33";
const AI_EVAL_IMPORT_SCHEMA_VERSION = "0.38";
const AI_EVAL_KIND = "air.aiAuthoringEvalReport";
const AI_EVAL_REGRESSION_KIND = "air.aiAuthoringEvalRegressionReport";
const AI_EVAL_IMPORT_KIND = "air.aiAuthoringEvalImportReport";
const AI_EVAL_CONSTRAINT_KIND = "air.aiAuthoringEvalConstraints";
const AI_EVAL_CAPTURE_KIND = "air.aiAuthoringEvalCapture";
const SENSITIVE_KEY_RE = /(^|[_-])(api_key|apikey|token|secret|credential|provider_request_id|request_id|account_id|account|raw_prompt|prompt_text|raw_url|private_url|network_log|network_logs|provider_metadata|provider|timestamp|created_at|updated_at|generated_at|wall_clock)([_-]|$)|apiKey|providerRequestId|requestId|accountId|rawPrompt|promptText|rawUrl|privateUrl|networkLogs|providerMetadata|createdAt|updatedAt|generatedAt|wallClock/i;
const SECRET_LIKE_RE = /-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:sk|pk|xox[baprs])-?[A-Za-z0-9_-]{12,}|AKIA[0-9A-Z]{12,}|Bearer\s+[A-Za-z0-9._-]{12,}|api[_-]?key\s*[:=]\s*[A-Za-z0-9._-]{8,}/i;
const URL_RE = /\b(?:https?|wss?):\/\/[^\s"')]+/i;

function createAiAuthoringEvalReport(evalDir, options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const base = path.resolve(evalDir || "");
  if (!evalDir || !fs.existsSync(base) || !fs.statSync(base).isDirectory()) {
    return finalizeReport({
      cwd,
      base,
      status: "failed",
      suite: null,
      cases: [],
      diagnostics: [diagnostic("air.eval_ai.missing_dir", "fail", "eval directory does not exist", { evalDir: sanitizePath(base, cwd) })],
      limitations: ["replay did not run because the eval directory was missing"]
    });
  }

  let constraints = null;
  const diagnostics = [];
  try {
    constraints = readConstraints(base);
  } catch (err) {
    return finalizeReport({
      cwd,
      base,
      status: "failed",
      suite: path.basename(base),
      cases: [],
      diagnostics: [diagnostic("air.eval_ai.constraints_invalid", "fail", err.message, { path: "expected/constraints.json" })],
      limitations: ["replay did not run because expected/constraints.json was invalid"]
    });
  }

  const cases = [];
  for (const testCase of constraints.cases) {
    cases.push(readCase(base, testCase, diagnostics));
  }

  const status = diagnostics.some((item) => item.severity === "fail") ? "failed" : "passed";
  return finalizeReport({
    cwd,
    base,
    status,
    suite: constraints.suite || path.basename(base),
    cases,
    diagnostics,
    limitations: [
      "replay mode uses checked-in captured outputs and repair transcripts only",
      "no live model calls, network access, API keys, or wall-clock timestamps are used"
    ]
  });
}

function createAiAuthoringEvalRegressionReport(evalDir, options = {}) {
  const report = createAiAuthoringEvalReport(evalDir, options);
  const metrics = report.metrics || metricsForCases([]);
  const previousMetrics = null;
  return stableObject({
    schemaVersion: AI_EVAL_REGRESSION_SCHEMA_VERSION,
    kind: AI_EVAL_REGRESSION_KIND,
    status: report.status,
    evalSuite: report.suite || null,
    mode: "replay",
    corpusId: report.suite || null,
    corpusFingerprint: corpusFingerprint(report),
    runConfig: stableObject({
      liveModelCalls: false,
      network: false,
      apiKeysRequired: false,
      deterministicFixtures: true
    }),
    metrics,
    previousMetrics,
    deltas: [],
    topDiagnosticCodes: metrics.topDiagnosticCodes || [],
    changedTopDiagnosticCodes: [],
    diagnosticRepairHintCoverage: metrics.diagnosticRepairHintCoverage || stableObject({
      hintedCount: 0,
      missingRepairHints: [],
      rate: 0,
      totalDiagnosticCodes: 0
    }),
    forbiddenSurfaceRate: Number(metrics.forbiddenSurfaceRate || 0),
    repairSuccessRateAt1: Number(metrics.repairSuccessRateAt1 || 0),
    repairSuccessRateAt3: Number(metrics.repairSuccessRateAt3 || 0),
    diagnostics: report.diagnostics || [],
    limitations: sortedStrings([
      "no prior baseline provided",
      "regression mode compares deterministic replay metrics only",
      ...(report.limitations || [])
    ])
  });
}

function createAiAuthoringEvalImportReport(captureDir, options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const base = path.resolve(captureDir || "");
  const diagnostics = [];
  if (!captureDir || !fs.existsSync(base) || !fs.statSync(base).isDirectory()) {
    return finalizeImportReport({
      cwd,
      base,
      status: "failed",
      captureId: null,
      cases: [],
      rejectedCaseCount: 0,
      diagnostics: [diagnostic("air.eval_ai.import_missing_dir", "fail", "capture directory does not exist", { captureDir: sanitizePath(base, cwd) })],
      limitations: ["import did not run because the capture directory was missing"]
    });
  }

  let manifest = null;
  try {
    manifest = readCaptureManifest(base);
  } catch (err) {
    return finalizeImportReport({
      cwd,
      base,
      status: "failed",
      captureId: null,
      cases: [],
      rejectedCaseCount: 0,
      diagnostics: [diagnostic("air.eval_ai.import_manifest_invalid", "fail", err.message, { path: "MANIFEST.json" })],
      limitations: ["import did not run because MANIFEST.json was invalid"]
    });
  }

  scanCaptureSafety(manifest.raw, "$.MANIFEST", diagnostics, { path: "MANIFEST.json" });
  if (diagnostics.some((item) => item.severity === "fail")) {
    return finalizeImportReport({
      cwd,
      base,
      status: "failed",
      captureId: manifest.captureId,
      cases: [],
      rejectedCaseCount: manifest.cases.length,
      diagnostics,
      limitations: [
        "import rejected because MANIFEST.json contains sensitive or nondeterministic capture metadata"
      ]
    });
  }
  const expectedByCase = readImportConstraints(base, diagnostics);
  const cases = [];
  let rejectedCaseCount = 0;
  for (const testCase of manifest.cases) {
    const before = diagnostics.length;
    const imported = readImportedCase(base, testCase, expectedByCase.get(testCase.id), diagnostics);
    const caseFailedSafety = diagnostics.slice(before).some((item) => item.severity === "fail");
    if (caseFailedSafety) {
      rejectedCaseCount += 1;
    } else {
      cases.push(imported);
    }
  }

  const status = diagnostics.some((item) => item.severity === "fail") ? "failed" : "passed";
  return finalizeImportReport({
    cwd,
    base,
    status,
    captureId: manifest.captureId,
    cases,
    rejectedCaseCount,
    diagnostics,
    limitations: [
      "import mode reads sanitized capture files only",
      "no live model calls, network access, API keys, provider SDKs, or wall-clock timestamps are used"
    ]
  });
}

function readConstraints(base) {
  const file = path.join(base, "expected", "constraints.json");
  if (!fs.existsSync(file)) throw new Error("missing expected/constraints.json");
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("constraints must be a JSON object");
  if (parsed.kind !== AI_EVAL_CONSTRAINT_KIND) throw new Error(`constraints kind must be ${AI_EVAL_CONSTRAINT_KIND}`);
  if (parsed.schemaVersion !== AI_EVAL_SCHEMA_VERSION) throw new Error(`constraints schemaVersion must be ${AI_EVAL_SCHEMA_VERSION}`);
  if (!Array.isArray(parsed.cases) || !parsed.cases.length) throw new Error("constraints.cases must be a non-empty array");
  const ids = new Set();
  for (const [index, testCase] of parsed.cases.entries()) {
    if (!testCase || typeof testCase !== "object" || Array.isArray(testCase)) throw new Error(`constraints.cases[${index}] must be an object`);
    if (!stableId(testCase.id)) throw new Error(`constraints.cases[${index}].id must be stable`);
    if (ids.has(testCase.id)) throw new Error(`duplicate eval case id: ${testCase.id}`);
    ids.add(testCase.id);
    for (const key of ["prompt", "modelOutput", "repairTranscript"]) {
      if (typeof testCase[key] !== "string" || testCase[key].trim() === "") throw new Error(`constraints.cases[${index}].${key} is required`);
      validateRelativePath(testCase[key], `constraints.cases[${index}].${key}`);
    }
  }
  return stableObject({
    schemaVersion: parsed.schemaVersion,
    kind: parsed.kind,
    suite: stableId(parsed.suite) ? parsed.suite : "ai_authoring",
    cases: parsed.cases.map((testCase) => stableObject({
      id: testCase.id,
      prompt: testCase.prompt,
      modelOutput: testCase.modelOutput,
      repairTranscript: testCase.repairTranscript,
      expected: normalizeExpected(testCase.expected)
    })).sort((a, b) => a.id.localeCompare(b.id))
  });
}

function readCaptureManifest(base) {
  const file = path.join(base, "MANIFEST.json");
  if (!fs.existsSync(file)) throw new Error("missing MANIFEST.json");
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("MANIFEST.json must be a JSON object");
  if (parsed.kind !== AI_EVAL_CAPTURE_KIND) throw new Error(`MANIFEST.json kind must be ${AI_EVAL_CAPTURE_KIND}`);
  if (parsed.schemaVersion !== AI_EVAL_IMPORT_SCHEMA_VERSION) throw new Error(`MANIFEST.json schemaVersion must be ${AI_EVAL_IMPORT_SCHEMA_VERSION}`);
  if (!stableId(parsed.captureId)) throw new Error("MANIFEST.json captureId must be stable");
  if (!Array.isArray(parsed.cases) || !parsed.cases.length) throw new Error("MANIFEST.json cases must be a non-empty array");
  const ids = new Set();
  const cases = [];
  for (const [index, testCase] of parsed.cases.entries()) {
    if (!testCase || typeof testCase !== "object" || Array.isArray(testCase)) throw new Error(`MANIFEST.json cases[${index}] must be an object`);
    if (!stableId(testCase.id)) throw new Error(`MANIFEST.json cases[${index}].id must be stable`);
    if (ids.has(testCase.id)) throw new Error(`duplicate import case id: ${testCase.id}`);
    ids.add(testCase.id);
    if (typeof testCase.modelOutput !== "string" || testCase.modelOutput.trim() === "") throw new Error(`MANIFEST.json cases[${index}].modelOutput is required`);
    validateRelativePath(testCase.modelOutput, `MANIFEST.json cases[${index}].modelOutput`);
    if (!normalizeSlash(testCase.modelOutput).startsWith("model_outputs/")) throw new Error(`MANIFEST.json cases[${index}].modelOutput must live under model_outputs/`);
    if (testCase.repairTranscript !== undefined) {
      if (typeof testCase.repairTranscript !== "string" || testCase.repairTranscript.trim() === "") throw new Error(`MANIFEST.json cases[${index}].repairTranscript must be a path when present`);
      validateRelativePath(testCase.repairTranscript, `MANIFEST.json cases[${index}].repairTranscript`);
      if (!normalizeSlash(testCase.repairTranscript).startsWith("repair_transcripts/")) throw new Error(`MANIFEST.json cases[${index}].repairTranscript must live under repair_transcripts/`);
    }
    if (testCase.prompt !== undefined) {
      if (typeof testCase.prompt !== "string" || testCase.prompt.trim() === "") throw new Error(`MANIFEST.json cases[${index}].prompt must be a stable id or relative path when present`);
      validateRelativePath(testCase.prompt, `MANIFEST.json cases[${index}].prompt`);
    }
    cases.push(stableObject({
      id: testCase.id,
      prompt: testCase.prompt || `${testCase.id}.prompt`,
      modelOutput: normalizeSlash(testCase.modelOutput),
      repairTranscript: testCase.repairTranscript ? normalizeSlash(testCase.repairTranscript) : null,
      expected: normalizeExpected(testCase.expected)
    }));
  }
  return stableObject({
    captureId: parsed.captureId,
    cases: cases.sort((a, b) => a.id.localeCompare(b.id)),
    raw: parsed
  });
}

function readImportConstraints(base, diagnostics) {
  const file = path.join(base, "constraints.json");
  const out = new Map();
  if (!fs.existsSync(file)) return out;
  let parsed = null;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    diagnostics.push(diagnostic("air.eval_ai.import_constraints_invalid", "fail", `invalid constraints.json: ${err.message}`, { path: "constraints.json" }));
    return out;
  }
  scanCaptureSafety(parsed, "$.constraints", diagnostics, { path: "constraints.json" });
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !Array.isArray(parsed.cases)) {
    diagnostics.push(diagnostic("air.eval_ai.import_constraints_invalid", "fail", "constraints.json must contain a cases array", { path: "constraints.json" }));
    return out;
  }
  for (const item of parsed.cases) {
    if (item && stableId(item.id)) out.set(item.id, normalizeExpected(item.expected || item));
  }
  return out;
}

function readCase(base, testCase, diagnostics) {
  const promptPath = normalizeSlash(testCase.prompt);
  const outputPath = normalizeSlash(testCase.modelOutput);
  const transcriptPath = normalizeSlash(testCase.repairTranscript);
  let output = null;
  let transcript = null;
  const caseDiagnostics = [];
  try {
    output = readJsonFile(path.join(base, outputPath), "model output");
  } catch (err) {
    const item = diagnostic("air.eval_ai.fixture_invalid", "fail", err.message, { caseId: testCase.id, path: outputPath });
    diagnostics.push(item);
    caseDiagnostics.push(item);
  }
  try {
    transcript = readJsonFile(path.join(base, transcriptPath), "repair transcript");
  } catch (err) {
    const item = diagnostic("air.eval_ai.fixture_invalid", "fail", err.message, { caseId: testCase.id, path: transcriptPath });
    diagnostics.push(item);
    caseDiagnostics.push(item);
  }

  const firstPass = normalizeFirstPass(output);
  const attempts = normalizeAttempts(transcript);
  const allDiagnosticCodes = diagnosticCodesForCase(firstPass, attempts);
  const categories = sortedStrings([
    ...(Array.isArray(output && output.hallucinationCategories) ? output.hallucinationCategories : []),
    ...attempts.flatMap((attempt) => attempt.hallucinationCategories || [])
  ]);
  const successIteration = firstPass.packageCheckPassed && firstPass.verifyPassed
    ? 0
    : firstSuccessfulAttempt(attempts);
  const finalAttemptCount = successIteration === null ? attempts.length : successIteration;
  const forbiddenSurface = Boolean(output && output.forbiddenSurface) || allDiagnosticCodes.some((code) => forbiddenDiagnosticCode(code));
  validateExpected(testCase, {
    allDiagnosticCodes,
    categories,
    firstPass,
    successIteration
  }, diagnostics, caseDiagnostics);

  return stableObject({
    id: testCase.id,
    prompt: promptPath,
    modelOutput: outputPath,
    repairTranscript: transcriptPath,
    firstPassVerify: firstPass.verifyStatus,
    firstPassPackageCheck: firstPass.packageCheckStatus,
    firstPassVerifyPassed: firstPass.verifyPassed,
    firstPassPackageCheckPassed: firstPass.packageCheckPassed,
    successIteration,
    repairAttemptCount: attempts.length,
    avgIterationContribution: finalAttemptCount,
    forbiddenSurface,
    hallucinationCategories: categories,
    diagnosticDetails: diagnosticDetailsForCodes(allDiagnosticCodes),
    diagnosticCodes: allDiagnosticCodes,
    diagnostics: caseDiagnostics
  });
}

function readImportedCase(base, testCase, constraintExpected, diagnostics) {
  const outputPath = normalizeSlash(testCase.modelOutput);
  const transcriptPath = testCase.repairTranscript ? normalizeSlash(testCase.repairTranscript) : null;
  let output = null;
  let transcript = null;
  const caseDiagnostics = [];
  try {
    const outputFile = path.join(base, outputPath);
    output = readJsonFile(outputFile, "model output");
    scanCaptureSafety(output, "$.modelOutput", diagnostics, { caseId: testCase.id, path: outputPath });
  } catch (err) {
    const item = diagnostic("air.eval_ai.import_file_invalid", "fail", err.message, { caseId: testCase.id, path: outputPath });
    diagnostics.push(item);
    caseDiagnostics.push(item);
  }
  if (transcriptPath) {
    try {
      const transcriptFile = path.join(base, transcriptPath);
      transcript = readJsonFile(transcriptFile, "repair transcript");
      scanCaptureSafety(transcript, "$.repairTranscript", diagnostics, { caseId: testCase.id, path: transcriptPath });
    } catch (err) {
      const item = diagnostic("air.eval_ai.import_file_invalid", "fail", err.message, { caseId: testCase.id, path: transcriptPath });
      diagnostics.push(item);
      caseDiagnostics.push(item);
    }
  } else {
    transcript = { attempts: [] };
  }

  const expected = Object.keys(testCase.expected || {}).length ? testCase.expected : constraintExpected || {};
  const firstPass = normalizeFirstPass(output);
  const attempts = normalizeAttempts(transcript);
  const allDiagnosticCodes = diagnosticCodesForCase(firstPass, attempts);
  const categories = sortedStrings([
    ...(Array.isArray(output && output.hallucinationCategories) ? output.hallucinationCategories : []),
    ...attempts.flatMap((attempt) => attempt.hallucinationCategories || [])
  ]);
  const successIteration = firstPass.packageCheckPassed && firstPass.verifyPassed
    ? 0
    : firstSuccessfulAttempt(attempts);
  const finalAttemptCount = successIteration === null ? attempts.length : successIteration;
  const forbiddenSurface = Boolean(output && output.forbiddenSurface) || allDiagnosticCodes.some((code) => forbiddenDiagnosticCode(code));
  validateExpected({ id: testCase.id, expected }, {
    allDiagnosticCodes,
    categories,
    firstPass,
    successIteration
  }, diagnostics, caseDiagnostics);

  return stableObject({
    id: testCase.id,
    prompt: normalizeSlash(testCase.prompt || `${testCase.id}.prompt`),
    modelOutput: outputPath,
    repairTranscript: transcriptPath,
    firstPassVerify: firstPass.verifyStatus,
    firstPassPackageCheck: firstPass.packageCheckStatus,
    firstPassVerifyPassed: firstPass.verifyPassed,
    firstPassPackageCheckPassed: firstPass.packageCheckPassed,
    successIteration,
    repairAttemptCount: attempts.length,
    avgIterationContribution: finalAttemptCount,
    forbiddenSurface,
    hallucinationCategories: categories,
    diagnosticDetails: diagnosticDetailsForCodes(allDiagnosticCodes),
    diagnosticCodes: allDiagnosticCodes,
    diagnostics: caseDiagnostics
  });
}

function diagnosticDetailsForCodes(codes) {
  return sortedStrings(codes || []).map((code) => stableObject({
    code,
    repairHint: repairHintForDiagnosticCode(code)
  }));
}

function normalizeExpected(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return stableObject({});
  const out = {};
  if (value.firstPassVerify !== undefined) out.firstPassVerify = normalizeStatus(value.firstPassVerify);
  if (value.firstPassPackageCheck !== undefined) out.firstPassPackageCheck = normalizeStatus(value.firstPassPackageCheck);
  if (Array.isArray(value.requiredDiagnosticCodes)) out.requiredDiagnosticCodes = sortedStrings(value.requiredDiagnosticCodes);
  if (value.repairSuccessIteration === null) out.repairSuccessIteration = null;
  else if (Number.isInteger(value.repairSuccessIteration) && value.repairSuccessIteration >= 0) out.repairSuccessIteration = value.repairSuccessIteration;
  if (typeof value.forbiddenSurfaceCategory === "string" && value.forbiddenSurfaceCategory.trim()) out.forbiddenSurfaceCategory = value.forbiddenSurfaceCategory;
  return stableObject(out);
}

function validateExpected(testCase, actual, diagnostics, caseDiagnostics) {
  const expected = testCase.expected || {};
  const mismatches = [];
  if (expected.firstPassVerify && actual.firstPass.verifyStatus !== expected.firstPassVerify) {
    mismatches.push(`firstPassVerify expected ${expected.firstPassVerify}, got ${actual.firstPass.verifyStatus}`);
  }
  if (expected.firstPassPackageCheck && actual.firstPass.packageCheckStatus !== expected.firstPassPackageCheck) {
    mismatches.push(`firstPassPackageCheck expected ${expected.firstPassPackageCheck}, got ${actual.firstPass.packageCheckStatus}`);
  }
  if (Object.prototype.hasOwnProperty.call(expected, "repairSuccessIteration") && actual.successIteration !== expected.repairSuccessIteration) {
    mismatches.push(`repairSuccessIteration expected ${expected.repairSuccessIteration}, got ${actual.successIteration}`);
  }
  for (const code of expected.requiredDiagnosticCodes || []) {
    if (!actual.allDiagnosticCodes.includes(code)) mismatches.push(`required diagnostic ${code} was not observed`);
  }
  if (expected.forbiddenSurfaceCategory && !actual.categories.includes(expected.forbiddenSurfaceCategory)) {
    mismatches.push(`forbidden surface category ${expected.forbiddenSurfaceCategory} was not observed`);
  }
  if (!mismatches.length) return;
  const item = diagnostic("air.eval_ai.expected_mismatch", "fail", "eval case did not match expected replay constraints", {
    caseId: testCase.id,
    mismatches
  });
  diagnostics.push(item);
  caseDiagnostics.push(item);
}

function normalizeFirstPass(output) {
  const first = output && output.firstPass && typeof output.firstPass === "object" ? output.firstPass : {};
  const verifyStatus = normalizeStatus(first.verify && first.verify.status);
  const packageCheckStatus = normalizeStatus(first.packageCheck && first.packageCheck.status);
  return {
    verifyStatus,
    packageCheckStatus,
    verifyPassed: isPassStatus(verifyStatus),
    packageCheckPassed: isPassStatus(packageCheckStatus),
    diagnostics: [
      ...normalizeDiagnostics(first.verify && first.verify.diagnostics),
      ...normalizeDiagnostics(first.packageCheck && first.packageCheck.diagnostics)
    ]
  };
}

function normalizeAttempts(transcript) {
  const attempts = Array.isArray(transcript && transcript.attempts) ? transcript.attempts : [];
  return attempts.map((attempt, index) => {
    const iteration = Number.isInteger(attempt && attempt.iteration) && attempt.iteration > 0 ? attempt.iteration : index + 1;
    const verifyStatus = normalizeStatus(attempt && attempt.verify && attempt.verify.status);
    const packageCheckStatus = normalizeStatus(attempt && attempt.packageCheck && attempt.packageCheck.status);
    return stableObject({
      iteration,
      verifyStatus,
      packageCheckStatus,
      verifyPassed: isPassStatus(verifyStatus),
      packageCheckPassed: isPassStatus(packageCheckStatus),
      hallucinationCategories: sortedStrings(attempt && attempt.hallucinationCategories || []),
      diagnostics: [
        ...normalizeDiagnostics(attempt && attempt.verify && attempt.verify.diagnostics),
        ...normalizeDiagnostics(attempt && attempt.packageCheck && attempt.packageCheck.diagnostics),
        ...normalizeDiagnostics(attempt && attempt.diagnostics)
      ]
    });
  }).sort((a, b) => a.iteration - b.iteration);
}

function firstSuccessfulAttempt(attempts) {
  for (const attempt of attempts) {
    if (attempt.verifyPassed && attempt.packageCheckPassed) return attempt.iteration;
  }
  return null;
}

function diagnosticCodesForCase(firstPass, attempts) {
  const codes = [];
  for (const diagnostic of firstPass.diagnostics || []) if (diagnostic.code) codes.push(diagnostic.code);
  for (const attempt of attempts || []) {
    for (const diagnostic of attempt.diagnostics || []) if (diagnostic.code) codes.push(diagnostic.code);
  }
  return sortedStrings(codes);
}

function metricsForCases(cases) {
  const total = cases.length;
  const topDiagnosticCodes = countStrings(cases.flatMap((item) => item.diagnosticCodes || []));
  const hallucinationCategoryCounts = countStrings(cases.flatMap((item) => item.hallucinationCategories || []));
  const missingRepairHints = topDiagnosticCodes
    .map((item) => item.key)
    .filter((code) => !repairHintForDiagnosticCode(code))
    .sort();
  const hintedCount = topDiagnosticCodes.length - missingRepairHints.length;
  return stableObject({
    totalCases: total,
    firstPassVerifyRate: rate(cases.filter((item) => item.firstPassVerifyPassed).length, total),
    firstPassPackageCheckRate: rate(cases.filter((item) => item.firstPassPackageCheckPassed).length, total),
    repairSuccessRateAt1: rate(cases.filter((item) => item.successIteration !== null && item.successIteration <= 1).length, total),
    repairSuccessRateAt3: rate(cases.filter((item) => item.successIteration !== null && item.successIteration <= 3).length, total),
    avgRepairIterations: total ? Number((cases.reduce((sum, item) => sum + Number(item.avgIterationContribution || 0), 0) / total).toFixed(4)) : 0,
    forbiddenSurfaceRate: rate(cases.filter((item) => item.forbiddenSurface).length, total),
    diagnosticCodeCoverage: stableObject({
      uniqueCount: topDiagnosticCodes.length,
      codes: topDiagnosticCodes.map((item) => item.key)
    }),
    diagnosticRepairHintCoverage: stableObject({
      hintedCount,
      missingRepairHints,
      rate: rate(hintedCount, topDiagnosticCodes.length),
      totalDiagnosticCodes: topDiagnosticCodes.length
    }),
    hallucinationCategoryCounts,
    topDiagnosticCodes
  });
}

function finalizeReport({ cwd, base, status, suite, cases, diagnostics, limitations }) {
  return stableObject({
    schemaVersion: AI_EVAL_SCHEMA_VERSION,
    kind: AI_EVAL_KIND,
    status,
    mode: "replay",
    suite: suite || null,
    evalDir: base ? sanitizePath(base, cwd) : null,
    runConfig: stableObject({
      liveModelCalls: false,
      network: false,
      apiKeysRequired: false,
      deterministicFixtures: true
    }),
    metrics: metricsForCases(cases),
    cases: cases.slice().sort((a, b) => a.id.localeCompare(b.id)),
    diagnostics: normalizeDiagnostics(diagnostics),
    limitations: sortedStrings(limitations || [])
  });
}

function finalizeImportReport({ cwd, base, status, captureId, cases, rejectedCaseCount, diagnostics, limitations }) {
  return stableObject({
    schemaVersion: AI_EVAL_IMPORT_SCHEMA_VERSION,
    kind: AI_EVAL_IMPORT_KIND,
    status,
    mode: "import",
    captureId,
    captureDir: base ? sanitizePath(base, cwd) : null,
    captureFingerprint: captureFingerprint(captureId, cases),
    importedCaseCount: cases.length,
    rejectedCaseCount,
    runConfig: stableObject({
      liveModelCalls: false,
      network: false,
      apiKeysRequired: false,
      deterministicFixtures: true,
      providerSdkDependencies: false
    }),
    metrics: metricsForCases(cases),
    cases: cases.slice().sort((a, b) => a.id.localeCompare(b.id)),
    diagnostics: normalizeDiagnostics(diagnostics),
    limitations: sortedStrings(limitations || [])
  });
}

function readJsonFile(file, label) {
  if (!fs.existsSync(file)) throw new Error(`missing ${label}: ${normalizeSlash(file)}`);
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${label} must be a JSON object`);
  return parsed;
}

function normalizeDiagnostics(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => stableObject({
    code: typeof item.code === "string" ? item.code : null,
    severity: typeof item.severity === "string" ? item.severity : null,
    message: typeof item.message === "string" ? item.message : null,
    repairHint: typeof item.repairHint === "string" ? item.repairHint : repairHintForDiagnosticCode(item.code)
  })).filter((item) => item.code || item.message)
    .sort((a, b) => String(a.code || "").localeCompare(String(b.code || "")) || String(a.message || "").localeCompare(String(b.message || "")));
}

function countStrings(values) {
  const counts = new Map();
  for (const value of values || []) {
    if (typeof value !== "string" || value.trim() === "") continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function rate(count, total) {
  return total ? Number((count / total).toFixed(4)) : 0;
}

function normalizeStatus(value) {
  if (value === "passed" || value === "pass") return "passed";
  if (value === "failed" || value === "fail") return "failed";
  if (value === "not_run" || value === "not-run") return "not_run";
  return "not_run";
}

function isPassStatus(value) {
  return value === "passed" || value === "pass";
}

function forbiddenDiagnosticCode(code) {
  return /runtime_json|object_field|host_object|raw_host|output\.event|audio\.event|effect\.event|tablegroup|declared_pool|forbidden/i.test(String(code || ""));
}

function diagnostic(code, severity, message, fields = {}) {
  return stableObject({ code, severity, source: "eval-ai", message, fields });
}

function stableStringify(value) {
  return `${JSON.stringify(stableObject(value), null, 2)}\n`;
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = stableObject(value[key]);
  return out;
}

function sortedStrings(values) {
  return Array.from(new Set((values || []).filter((value) => typeof value === "string" && value))).sort();
}

function sanitizePath(value, cwd) {
  const normalized = normalizeSlash(path.resolve(value || ""));
  const root = normalizeSlash(path.resolve(cwd || process.cwd()));
  if (normalized === root) return ".";
  if (normalized.startsWith(`${root}/`)) return normalized.slice(root.length + 1);
  return path.basename(normalized);
}

function validateRelativePath(value, label) {
  const normalized = normalizeSlash(value);
  if (path.isAbsolute(value) || normalized.startsWith("/") || /^[a-z][a-z0-9+.-]*:\/\//i.test(normalized) || normalized.split("/").includes("..")) {
    throw new Error(`${label} must be package-local relative path`);
  }
}

function scanCaptureSafety(value, label, diagnostics, context = {}) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanCaptureSafety(item, `${label}[${index}]`, diagnostics, context));
    return;
  }
  if (!value || typeof value !== "object") {
    if (typeof value === "string") {
      if (looksAbsolutePath(value)) {
        diagnostics.push(diagnostic("air.eval_ai.import_sensitive_content", "fail", `${label} must not contain absolute paths`, { ...context, field: label }));
      }
      if (URL_RE.test(value)) {
        diagnostics.push(diagnostic("air.eval_ai.import_sensitive_content", "fail", `${label} must not contain raw URLs`, { ...context, field: label }));
      }
      if (SECRET_LIKE_RE.test(value)) {
        diagnostics.push(diagnostic("air.eval_ai.import_sensitive_content", "fail", `${label} contains secret-like content`, { ...context, field: label }));
      }
    }
    return;
  }
  for (const key of Object.keys(value).sort()) {
    const field = `${label}.${key}`;
    if (SENSITIVE_KEY_RE.test(key)) {
      diagnostics.push(diagnostic("air.eval_ai.import_sensitive_content", "fail", `${field} is not allowed in imported captures`, { ...context, field }));
    }
    scanCaptureSafety(value[key], field, diagnostics, context);
  }
}

function looksAbsolutePath(value) {
  return typeof value === "string" && (/^\/[^/]/.test(value) || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("file://"));
}

function stableId(value) {
  return typeof value === "string" && /^[A-Za-z_][A-Za-z0-9_.:-]{0,127}$/.test(value);
}

function normalizeSlash(value) {
  return String(value || "").replace(/\\/g, "/");
}

function reportFingerprint(report) {
  return `sha256:${crypto.createHash("sha256").update(stableStringify(report)).digest("hex")}`;
}

function corpusFingerprint(report) {
  return `sha256:${crypto.createHash("sha256").update(stableStringify({
    suite: report && report.suite,
    cases: (report && report.cases || []).map((item) => stableObject({
      id: item.id,
      prompt: item.prompt,
      modelOutput: item.modelOutput,
      repairTranscript: item.repairTranscript
    }))
  })).digest("hex")}`;
}

function captureFingerprint(captureId, cases) {
  return `sha256:${crypto.createHash("sha256").update(stableStringify({
    captureId,
    cases: (cases || []).map((item) => stableObject({
      id: item.id,
      modelOutput: item.modelOutput,
      repairTranscript: item.repairTranscript,
      diagnosticCodes: item.diagnosticCodes,
      successIteration: item.successIteration
    }))
  })).digest("hex")}`;
}

module.exports = {
  AI_EVAL_KIND,
  AI_EVAL_IMPORT_KIND,
  AI_EVAL_REGRESSION_KIND,
  AI_EVAL_SCHEMA_VERSION,
  createAiAuthoringEvalReport,
  createAiAuthoringEvalImportReport,
  createAiAuthoringEvalRegressionReport,
  reportFingerprint,
  stableStringify
};
