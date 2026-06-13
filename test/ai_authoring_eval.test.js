#!/usr/bin/env node

const assert = require("assert");
const cp = require("child_process");
const path = require("path");
const { AIR_ABI_VERSION } = require("../src/version");
const { HOST_ABI_VERSION } = require("../src/package_manifest");
const { normalizeDiagnostic, repairHintForDiagnosticCode } = require("../src/diagnostics");

const root = path.resolve(__dirname, "..");
const airc = path.join(root, "bin", "airc.js");
const evalDir = path.join(root, "evals", "ai_authoring");
const importFixtures = path.join(root, "test", "fixtures", "ai_eval_import");

function run(args, env = {}) {
  return cp.execFileSync(process.execPath, [airc, ...args], {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function walk(value, fn, key = null) {
  fn(value, key);
  if (Array.isArray(value)) value.forEach((item, index) => walk(item, fn, String(index)));
  else if (value && typeof value === "object") Object.keys(value).forEach((childKey) => walk(value[childKey], fn, childKey));
}

function assertNoAbsolutePaths(value) {
  const offenders = [];
  walk(value, (item) => {
    if (typeof item === "string" && (item.startsWith(root) || /^[A-Za-z]:[\\/]/.test(item))) offenders.push(item);
  });
  assert.deepStrictEqual(offenders, []);
}

function assertNoTimestampFields(value) {
  const offenders = [];
  walk(value, (_item, key) => {
    if (key && /timestamp|createdAt|updatedAt|generatedAt|wallClock/i.test(key)) offenders.push(key);
  });
  assert.deepStrictEqual(offenders, []);
}

function byKey(items) {
  return Object.fromEntries((items || []).map((item) => [item.key, item.count]));
}

assert.strictEqual(AIR_ABI_VERSION, "0.10");
assert.strictEqual(HOST_ABI_VERSION, "0.10");
assert.strictEqual(
  normalizeDiagnostic({ code: "air.structured_io.runtime_json_rejected", severity: "fail", message: "runtime JSON is rejected" }).repairHint,
  "Use a bounded scalar structured IO schema instead of unbounded payload data."
);
assert.strictEqual(
  normalizeDiagnostic({ code: "air.output_emit.output_id_dynamic", severity: "fail", message: "dynamic output id" }).repairHint,
  "Use a generated OUTPUT_* handle or a static output id declared by Output Contracts."
);
assert.strictEqual(
  repairHintForDiagnosticCode("air.api_gate.raw_host_authority_rejected"),
  "Move raw host access to a host adapter; AIR may emit bounded scalar intent only."
);

const first = run(["eval-ai", evalDir, "--json"], {
  OPENAI_API_KEY: "",
  ANTHROPIC_API_KEY: "",
  AIR_EVAL_DISABLE_NETWORK: "1"
});
const second = run(["eval-ai", evalDir, "--json"], {
  OPENAI_API_KEY: "",
  ANTHROPIC_API_KEY: "",
  AIR_EVAL_DISABLE_NETWORK: "1"
});
assert.strictEqual(second, first, "eval replay output must be deterministic");

const report = JSON.parse(first);
assert.strictEqual(report.schemaVersion, "0.32");
assert.strictEqual(report.kind, "air.aiAuthoringEvalReport");
assert.strictEqual(report.status, "passed");
assert.strictEqual(report.mode, "replay");
assert.strictEqual(report.suite, "ai_authoring");
assert.deepStrictEqual(report.runConfig, {
  apiKeysRequired: false,
  deterministicFixtures: true,
  liveModelCalls: false,
  network: false
});
assert.strictEqual(report.metrics.totalCases, 12);
assert.strictEqual(report.metrics.firstPassVerifyRate, 0.6667);
assert.strictEqual(report.metrics.firstPassPackageCheckRate, 0.4167);
assert.strictEqual(report.metrics.repairSuccessRateAt1, 0.5833);
assert.strictEqual(report.metrics.repairSuccessRateAt3, 0.5833);
assert.strictEqual(report.metrics.avgRepairIterations, 0.75);
assert.strictEqual(report.metrics.forbiddenSurfaceRate, 0.5833);
assert.strictEqual(report.metrics.diagnosticCodeCoverage.uniqueCount, 7);
assert(report.metrics.diagnosticCodeCoverage.codes.includes("air.structured_io.runtime_json_rejected"));
assert(report.metrics.diagnosticCodeCoverage.codes.includes("air.output_emit.output_id_dynamic"));
assert(report.metrics.diagnosticCodeCoverage.codes.includes("air.api_gate.raw_host_authority_rejected"));
assert(report.metrics.diagnosticCodeCoverage.codes.includes("air.structured_io.object_field_rejected"));
assert.deepStrictEqual(report.metrics.diagnosticRepairHintCoverage, {
  hintedCount: 7,
  missingRepairHints: [],
  rate: 1,
  totalDiagnosticCodes: 7
});
assert.strictEqual(byKey(report.metrics.hallucinationCategoryCounts).runtime_json, 3);
assert.strictEqual(byKey(report.metrics.hallucinationCategoryCounts).dynamic_output_id, 1);
assert.strictEqual(byKey(report.metrics.hallucinationCategoryCounts).object_model, 1);
assert.strictEqual(byKey(report.metrics.hallucinationCategoryCounts).raw_host_authority, 3);
assert.strictEqual(byKey(report.metrics.topDiagnosticCodes)["air.structured_io.runtime_json_rejected"], 3);
assert.strictEqual(byKey(report.metrics.topDiagnosticCodes)["air.api_gate.raw_host_authority_rejected"], 3);

const structured = report.cases.find((item) => item.id === "structured_io_module");
assert(structured);
assert.strictEqual(structured.successIteration, 0);
assert.deepStrictEqual(structured.hallucinationCategories, []);

const validSmall = report.cases.find((item) => item.id === "valid_small_module");
assert(validSmall);
assert.strictEqual(validSmall.firstPassVerify, "passed");
assert.strictEqual(validSmall.firstPassPackageCheck, "passed");

const outputEmit = report.cases.find((item) => item.id === "output_emit_module");
assert(outputEmit);
assert.strictEqual(outputEmit.successIteration, 0);
assert.deepStrictEqual(outputEmit.diagnosticCodes, []);

const dynamicOutput = report.cases.find((item) => item.id === "dynamic_output_id_hallucination");
assert(dynamicOutput);
assert.strictEqual(dynamicOutput.forbiddenSurface, true);
assert(dynamicOutput.diagnosticCodes.includes("air.output_emit.output_id_dynamic"));
assert(dynamicOutput.diagnostics.length === 0);

const hostAuthority = report.cases.find((item) => item.id === "host_authority_hallucination");
assert(hostAuthority);
assert.strictEqual(hostAuthority.forbiddenSurface, true);
assert(hostAuthority.diagnosticCodes.includes("air.api_gate.raw_host_authority_rejected"));

const lanObserver = report.cases.find((item) => item.id === "lan_observer_readonly_proof");
assert(lanObserver);
assert.strictEqual(lanObserver.firstPassVerify, "failed");
assert.strictEqual(lanObserver.firstPassPackageCheck, "failed");
assert.strictEqual(lanObserver.successIteration, 1);
assert.deepStrictEqual(lanObserver.hallucinationCategories, ["raw_host_authority", "runtime_json"]);
assert(lanObserver.diagnosticCodes.includes("air.api_gate.raw_host_authority_rejected"));
assert(lanObserver.diagnosticCodes.includes("air.structured_io.runtime_json_rejected"));

const objectMap = report.cases.find((item) => item.id === "dynamic_object_map_hallucination");
assert(objectMap);
assert.deepStrictEqual(objectMap.hallucinationCategories, ["dynamic_map", "object_model"]);
assert(objectMap.diagnosticCodes.includes("air.structured_io.object_field_rejected"));

const runtimeJson = report.cases.find((item) => item.id === "runtime_json_hallucination");
assert(runtimeJson);
assert(runtimeJson.diagnosticCodes.includes("air.structured_io.runtime_json_rejected"));

const repairable = report.cases.find((item) => item.id === "repairable_invalid_module");
assert(repairable);
assert.strictEqual(repairable.successIteration, 1);
assert(repairable.diagnosticCodes.includes("air.structured_io.field_type_invalid"));

const allFixtureDiagnostics = report.cases.flatMap((item) => item.diagnostics || []);
assert.deepStrictEqual(allFixtureDiagnostics, []);
const rawReport = JSON.stringify(report);
assert(rawReport.includes("Use a bounded scalar structured IO schema instead of unbounded payload data."));
assert(rawReport.includes("Use a generated OUTPUT_* handle or a static output id declared by Output Contracts."));
assert(rawReport.includes("Move raw host access to a host adapter; AIR may emit bounded scalar intent only."));
assert(!/use host\.fetch|call chrome\.|use chrome\.|connect to db|call cloud/i.test(rawReport), "repair hints must not suggest raw host authority");

const negative = report.cases.find((item) => item.id === "hallucination_negative_case");
assert(negative);
assert.strictEqual(negative.successIteration, null);
assert.strictEqual(negative.repairAttemptCount, 3);
assert.strictEqual(negative.forbiddenSurface, true);
assert.deepStrictEqual(report.diagnostics, []);

assertNoAbsolutePaths(report);
assertNoTimestampFields(report);
assert(!first.includes("sk-"), "eval report must not include API keys");

const regressionFirst = run(["eval-ai", evalDir, "--json", "--regression"], {
  OPENAI_API_KEY: "",
  ANTHROPIC_API_KEY: "",
  AIR_EVAL_DISABLE_NETWORK: "1"
});
const regressionSecond = run(["eval-ai", evalDir, "--json", "--regression"], {
  OPENAI_API_KEY: "",
  ANTHROPIC_API_KEY: "",
  AIR_EVAL_DISABLE_NETWORK: "1"
});
assert.strictEqual(regressionSecond, regressionFirst, "eval regression report must be deterministic");
const regression = JSON.parse(regressionFirst);
assert.strictEqual(regression.schemaVersion, "0.33");
assert.strictEqual(regression.kind, "air.aiAuthoringEvalRegressionReport");
assert.strictEqual(regression.status, "passed");
assert.strictEqual(regression.evalSuite, "ai_authoring");
assert.strictEqual(regression.mode, "replay");
assert.strictEqual(regression.corpusId, "ai_authoring");
assert(/^sha256:[a-f0-9]{64}$/.test(regression.corpusFingerprint));
assert.deepStrictEqual(regression.runConfig, {
  apiKeysRequired: false,
  deterministicFixtures: true,
  liveModelCalls: false,
  network: false
});
assert.strictEqual(regression.previousMetrics, null);
assert.deepStrictEqual(regression.deltas, []);
assert.deepStrictEqual(regression.changedTopDiagnosticCodes, []);
assert.deepStrictEqual(regression.metrics, report.metrics);
assert.deepStrictEqual(regression.topDiagnosticCodes, report.metrics.topDiagnosticCodes);
assert.deepStrictEqual(regression.diagnosticRepairHintCoverage, report.metrics.diagnosticRepairHintCoverage);
assert.strictEqual(regression.forbiddenSurfaceRate, report.metrics.forbiddenSurfaceRate);
assert.strictEqual(regression.repairSuccessRateAt1, report.metrics.repairSuccessRateAt1);
assert.strictEqual(regression.repairSuccessRateAt3, report.metrics.repairSuccessRateAt3);
assert(regression.limitations.includes("no prior baseline provided"));
assertNoAbsolutePaths(regression);
assertNoTimestampFields(regression);
assert(!regressionFirst.includes("sk-"), "eval regression report must not include API keys");

const importFirst = run(["eval-ai", "import", path.join(importFixtures, "valid"), "--json"], {
  OPENAI_API_KEY: "",
  ANTHROPIC_API_KEY: "",
  AIR_EVAL_DISABLE_NETWORK: "1"
});
const importSecond = run(["eval-ai", "import", path.join(importFixtures, "valid"), "--json"], {
  OPENAI_API_KEY: "",
  ANTHROPIC_API_KEY: "",
  AIR_EVAL_DISABLE_NETWORK: "1"
});
assert.strictEqual(importSecond, importFirst, "eval import report must be deterministic");
const imported = JSON.parse(importFirst);
assert.strictEqual(imported.schemaVersion, "0.38");
assert.strictEqual(imported.kind, "air.aiAuthoringEvalImportReport");
assert.strictEqual(imported.status, "passed");
assert.strictEqual(imported.mode, "import");
assert.strictEqual(imported.captureId, "valid_import_capture");
assert(/^sha256:[a-f0-9]{64}$/.test(imported.captureFingerprint));
assert.strictEqual(imported.importedCaseCount, 2);
assert.strictEqual(imported.rejectedCaseCount, 0);
assert.deepStrictEqual(imported.runConfig, {
  apiKeysRequired: false,
  deterministicFixtures: true,
  liveModelCalls: false,
  network: false,
  providerSdkDependencies: false
});
assert.strictEqual(imported.metrics.totalCases, 2);
assert.strictEqual(imported.metrics.firstPassVerifyRate, 1);
assert.strictEqual(imported.metrics.firstPassPackageCheckRate, 0.5);
assert.strictEqual(imported.metrics.repairSuccessRateAt1, 1);
assert.strictEqual(imported.metrics.repairSuccessRateAt3, 1);
assert.strictEqual(imported.metrics.avgRepairIterations, 0.5);
assert.strictEqual(imported.metrics.forbiddenSurfaceRate, 0.5);
assert.strictEqual(imported.metrics.diagnosticRepairHintCoverage.rate, 1);
assert.strictEqual(byKey(imported.metrics.hallucinationCategoryCounts).runtime_json, 1);
assert.strictEqual(byKey(imported.metrics.topDiagnosticCodes)["air.structured_io.runtime_json_rejected"], 1);
assert.deepStrictEqual(imported.diagnostics, []);
assertNoAbsolutePaths(imported);
assertNoTimestampFields(imported);
assert(!importFirst.includes("sk-"), "eval import report must not include API keys");

const secretImport = cp.spawnSync(process.execPath, [airc, "eval-ai", "import", path.join(importFixtures, "secret"), "--json"], {
  cwd: root,
  env: { ...process.env, OPENAI_API_KEY: "", ANTHROPIC_API_KEY: "", AIR_EVAL_DISABLE_NETWORK: "1" },
  encoding: "utf8"
});
assert.notStrictEqual(secretImport.status, 0);
const secretReport = JSON.parse(secretImport.stdout);
assert.strictEqual(secretReport.status, "failed");
assert.strictEqual(secretReport.importedCaseCount, 0);
assert.strictEqual(secretReport.rejectedCaseCount, 1);
assert(secretReport.diagnostics.some((item) => item.code === "air.eval_ai.import_sensitive_content"));
assert(!secretImport.stdout.includes("sk-testsecretvalue"), "secret-like capture content must not be echoed");
assertNoAbsolutePaths(secretReport);

const providerImport = cp.spawnSync(process.execPath, [airc, "eval-ai", "import", path.join(importFixtures, "provider_metadata"), "--json"], {
  cwd: root,
  env: { ...process.env, OPENAI_API_KEY: "", ANTHROPIC_API_KEY: "", AIR_EVAL_DISABLE_NETWORK: "1" },
  encoding: "utf8"
});
assert.notStrictEqual(providerImport.status, 0);
const providerReport = JSON.parse(providerImport.stdout);
assert.strictEqual(providerReport.status, "failed");
assert.strictEqual(providerReport.importedCaseCount, 0);
assert.strictEqual(providerReport.rejectedCaseCount, 1);
assert(providerReport.diagnostics.some((item) => item.code === "air.eval_ai.import_sensitive_content"));
assert(!providerImport.stdout.includes("req_1234567890"), "provider request ids must not be echoed");
assertNoAbsolutePaths(providerReport);

console.log("AI authoring eval replay tests passed");
