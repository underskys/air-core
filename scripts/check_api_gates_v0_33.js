#!/usr/bin/env node

const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const failures = [];

const activeEvalFiles = [
  "bin/airc.js",
  "src/ai_authoring_eval.js",
  "src/verifier_safety_fuzz.js",
  "test/ai_authoring_eval.test.js",
  "test/verifier_safety_fuzz.test.js"
];

const implementationFiles = [
  "bin/airc.js",
  "src/ai_authoring_eval.js",
  "src/verifier_safety_fuzz.js"
];

const formalClaimFiles = [
  "docs/VERIFIER_SAFETY_CONTRACT.md",
  "docs/FEATURE_STATUS_v0.33.md",
  "docs/rfcs/v0.33-ai-authoring-eval-deepening.md",
  "docs/rfcs/v0.33-verifier-safety-deepening.md",
  "src/verifier_safety_fuzz.js"
];

function main() {
  runPriorGate();
  checkNoProviderSdkDependencies();
  checkActiveEvalImplementation();
  checkEvalAndFuzzReports();
  checkEvalFixtureShape();
  checkFormalVerificationClaims();

  if (failures.length) {
    console.error(failures.join("\n"));
    process.exit(1);
  }
  console.log("api gates v0.33: ok");
}

function runPriorGate() {
  const script = path.join(root, "scripts", "check_api_gates_v0_32.js");
  const result = childProcess.spawnSync(process.execPath, [script], {
    cwd: root,
    encoding: "utf8"
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) process.exit(result.status || 1);
}

function checkNoProviderSdkDependencies() {
  const packageFiles = [
    "package.json",
    "package-lock.json"
  ].filter((rel) => fs.existsSync(path.join(root, rel)));
  const providerDependency = /(?:^|["/@_-])(?:openai|anthropic|claude|google-genai|vertexai|bedrock|mistral|cohere|langchain|llamaindex|ai-sdk)(?:["/@_-]|$)/i;
  for (const rel of packageFiles) {
    const text = fs.readFileSync(path.join(root, rel), "utf8");
    if (providerDependency.test(text)) {
      failures.push(`${rel}: v0.33 eval replay must not add provider-specific SDK dependencies`);
    }
  }
}

function checkActiveEvalImplementation() {
  for (const rel of activeEvalFiles) {
    const text = read(rel);
    if (implementationFiles.includes(rel)) {
      if (/\b(?:fetch|XMLHttpRequest|WebSocket)\b/.test(text) || /\brequire\(["'](?:http|https|net|tls|dns)["']\)/.test(text)) {
        failures.push(`${rel}: eval/fuzz implementation must not use network APIs`);
      }
      if (/\bprocess\.env\.[A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PROVIDER|MODEL)[A-Z0-9_]*\b/.test(text)) {
        failures.push(`${rel}: eval-ai implementation must not load provider keys, tokens, or model/provider environment`);
      }
      if (/\b(?:Date\.now|new Date|performance\.now|Math\.random|crypto\.randomUUID|randomBytes)\b/.test(text)) {
        failures.push(`${rel}: v0.33 eval/fuzz reports must remain deterministic and seed-driven`);
      }
      if (/\b(?:codeAction|workspaceEdit|applyEdit|automaticRepair|autoRepair|applyRepair|rewriteSource|fixIt)\b/.test(text)) {
        failures.push(`${rel}: v0.33 must not add code actions or automatic repair`);
      }
      if (/["']0\.12["']/.test(text) && /\b(?:HOST_ABI|hostAbi|Host ABI)\b/.test(text)) {
        failures.push(`${rel}: Host ABI expansion is rejected in v0.33`);
      }
      if (rel !== "src/ai_authoring_eval.js" && /\b(?:tablegroup|tablegroups|declaredPool|declaredPools|slotGroup|slotGroups)\b/i.test(text)) {
        failures.push(`${rel}: tablegroups and declared pools remain outside v0.33 implementation`);
      }
    }
  }
}

function checkEvalAndFuzzReports() {
  const evalReport = runJson(["bin/airc.js", "eval-ai", "evals/ai_authoring", "--json"], "eval-ai replay");
  const regressionReport = runJson(["bin/airc.js", "eval-ai", "evals/ai_authoring", "--json", "--regression"], "eval-ai regression");
  const fuzzReport = runJson(["bin/airc.js", "fuzz-safety", "--seed", "1", "--cases", "50", "--json"], "fuzz-safety");

  if (evalReport) {
    if (evalReport.kind !== "air.aiAuthoringEvalReport") failures.push("eval-ai replay: unexpected report kind");
    assertReplayRunConfig(evalReport, "eval-ai replay");
    assertNoUnsafeReportFields(evalReport, "eval-ai replay");
  }
  if (regressionReport) {
    if (regressionReport.kind !== "air.aiAuthoringEvalRegressionReport") failures.push("eval-ai regression: unexpected report kind");
    assertReplayRunConfig(regressionReport, "eval-ai regression");
    assertNoUnsafeReportFields(regressionReport, "eval-ai regression");
    if (regressionReport.previousMetrics !== null) failures.push("eval-ai regression: no-baseline report must use previousMetrics: null");
    if (!Array.isArray(regressionReport.deltas)) failures.push("eval-ai regression: deltas must be a stable array");
  }
  if (fuzzReport) {
    if (fuzzReport.kind !== "air.verifierSafetyFuzzReport") failures.push("fuzz-safety: unexpected report kind");
    if (fuzzReport.seed !== 1) failures.push("fuzz-safety: expected deterministic seed 1 in gate run");
    if (!Array.isArray(fuzzReport.families) || !fuzzReport.families.length) failures.push("fuzz-safety: expected family coverage summary");
    assertNoUnsafeReportFields(fuzzReport, "fuzz-safety");
  }
}

function checkEvalFixtureShape() {
  const evalRoot = path.join(root, "evals", "ai_authoring");
  const requiredDirs = [
    "prompts",
    "captured/model_outputs",
    "captured/repair_transcripts",
    "expected"
  ];
  for (const rel of requiredDirs) {
    const full = path.join(evalRoot, rel);
    if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) failures.push(`evals/ai_authoring/${rel}: expected deterministic replay fixture directory`);
  }
  const constraints = path.join(evalRoot, "expected", "constraints.json");
  if (!fs.existsSync(constraints)) {
    failures.push("evals/ai_authoring/expected/constraints.json: missing replay constraints");
    return;
  }
  const text = fs.readFileSync(constraints, "utf8");
  if (/\b(?:api[_-]?key|token|secret|password)\b/i.test(text)) {
    failures.push("evals/ai_authoring/expected/constraints.json: eval fixtures must not contain credentials");
  }
}

function checkFormalVerificationClaims() {
  for (const rel of formalClaimFiles) {
    const text = read(rel);
    const lines = text.split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      const lower = line.toLowerCase();
      const claim = /\b(?:formally verified|provides formal verification|guarantees formal verification|proves? correctness|proof of correctness|guarantees correctness)\b/.test(lower);
      const negated = /\b(?:not|no|does not|do not|without|reject|rejected|unsupported|overclaim|non-goal|doesn't|must not)\b/.test(lower);
      if (claim && !negated) {
        failures.push(`${rel}:${index + 1}: v0.33 must not claim formal verification`);
      }
    }
  }
}

function assertReplayRunConfig(report, label) {
  const runConfig = report.runConfig || {};
  if (runConfig.liveModelCalls !== false) failures.push(`${label}: liveModelCalls must be false`);
  if (runConfig.network !== false) failures.push(`${label}: network must be false`);
  if (runConfig.apiKeysRequired !== false) failures.push(`${label}: apiKeysRequired must be false`);
}

function assertNoUnsafeReportFields(value, label) {
  walk(value, (item, key) => {
    if (key && /timestamp|createdAt|updatedAt|generatedAt|wallClock/i.test(key)) failures.push(`${label}: report must not include timestamp-like field ${key}`);
    if (typeof item === "string") {
      if (item.startsWith(root) || /^[A-Za-z]:[\\/]/.test(item)) failures.push(`${label}: report must not include absolute path ${item}`);
      if (/sk-[A-Za-z0-9_-]{8,}|api[_-]?key|token|secret/i.test(item)) failures.push(`${label}: report must not include credentials or provider metadata`);
    }
  });
}

function runJson(args, label) {
  const result = childProcess.spawnSync(process.execPath, args, {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      OPENAI_API_KEY: "",
      ANTHROPIC_API_KEY: "",
      AIR_EVAL_DISABLE_NETWORK: "1"
    }
  });
  if (result.status !== 0) {
    failures.push(`${label}: command failed: ${(result.stderr || result.stdout || "").trim()}`);
    return null;
  }
  try {
    return JSON.parse(result.stdout);
  } catch (err) {
    failures.push(`${label}: command did not emit valid JSON: ${err.message}`);
    return null;
  }
}

function walk(value, fn, key = null) {
  fn(value, key);
  if (Array.isArray(value)) value.forEach((item, index) => walk(item, fn, String(index)));
  else if (value && typeof value === "object") Object.keys(value).forEach((childKey) => walk(value[childKey], fn, childKey));
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

main();
