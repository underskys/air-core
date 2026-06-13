#!/usr/bin/env node

const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const failures = [];

const implementationFiles = [
  "src/ai_authoring_eval.js",
  "src/e2e_proof.js"
];

const cliFiles = [
  "bin/airc.js",
  "src/ai_authoring_eval.js",
  "src/e2e_proof.js",
  "src/evidence_report.js",
  "src/benchmark_report.js"
];

const docs = [
  "docs/API_GATES_v0_38.md",
  "docs/FEATURE_STATUS_v0.38.md",
  "docs/V0_38_RELEASE_PLAN.md",
  "docs/rfcs/v0.38-ai-eval-capture-import.md",
  "docs/rfcs/v0.38-end-to-end-execution-proof.md"
];

function main() {
  runPriorGate();
  checkDocs();
  checkPackageScript();
  checkRunRcChecks();
  checkNoProviderSdkDependencies();
  checkActiveImplementationBoundaries();
  checkCliWiring();
  checkRuntimeReports();
  checkNoAbiExpansion();

  if (failures.length) {
    console.error(failures.join("\n"));
    process.exit(1);
  }
  console.log("api gates v0.38: ok");
}

function runPriorGate() {
  const script = path.join(root, "scripts", "check_api_gates_v0_37.js");
  const result = childProcess.spawnSync(process.execPath, [script], {
    cwd: root,
    encoding: "utf8"
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) process.exit(result.status || 1);
}

function checkDocs() {
  for (const rel of docs) {
    if (!fs.existsSync(path.join(root, rel))) failures.push(`${rel}: required v0.38 gate/status doc is missing`);
  }
  const status = read("docs/FEATURE_STATUS_v0.38.md");
  const release = read("docs/V0_38_RELEASE_PLAN.md");
  const gate = read("docs/API_GATES_v0_38.md");
  const combined = `${status}\n${release}\n${gate}`;

  for (const expected of [
    "airc run-proof",
    "eval-ai import",
    "Implemented/P0",
    "air.aiAuthoringEvalImportReport",
    "air.e2eProofReport"
  ]) {
    if (!combined.includes(expected)) failures.push(`v0.38 docs: expected ${expected}`);
  }
  if (!/no live provider calls|without live provider calls/i.test(combined)) failures.push("v0.38 docs: live provider calls must remain rejected");
  if (!/no network access|without network access/i.test(combined)) failures.push("v0.38 docs: network access must remain rejected");
  if (!/AIR ABI remains `0\.10`/.test(combined)) failures.push("v0.38 docs: AIR ABI must remain 0.10");
  if (!/Host ABI (?:unchanged|latest remains `0\.11`)/.test(combined)) failures.push("v0.38 docs: Host ABI must remain unchanged/0.11 bounded output.emit");
}

function checkPackageScript() {
  const pkg = JSON.parse(read("package.json"));
  if ((pkg.scripts || {})["check:api-gates:v0.38"] !== "node scripts/check_api_gates_v0_38.js") {
    failures.push("package.json: missing check:api-gates:v0.38 script");
  }
}

function checkRunRcChecks() {
  const text = read("scripts/run_rc_checks.sh");
  if (!text.includes("npm run check:api-gates:v0.38")) {
    failures.push("scripts/run_rc_checks.sh: v0.38 API gate must run during RC checks");
  }
}

function checkNoProviderSdkDependencies() {
  const packageFiles = ["package.json", "package-lock.json"].filter((rel) => fs.existsSync(path.join(root, rel)));
  const providerDependency = /(?:^|["/@_-])(?:openai|anthropic|claude|google-genai|vertexai|bedrock|mistral|cohere|langchain|llamaindex|ai-sdk)(?:["/@_-]|$)/i;
  for (const rel of packageFiles) {
    const text = read(rel);
    if (providerDependency.test(text)) failures.push(`${rel}: v0.38 must not add provider-specific SDK dependencies`);
  }
}

function checkActiveImplementationBoundaries() {
  for (const rel of implementationFiles) {
    const text = read(rel);
    if (/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/.test(text) || /\brequire\(["'](?:http|https|net|tls|dns|dgram)["']\)/.test(text)) {
      failures.push(`${rel}: eval/run-proof implementation must not use network APIs`);
    }
    if (/\brequire\(["'](?:os|child_process)["']\)/.test(text) || /\b(?:exec|execFile|spawn|spawnSync)\s*\(/.test(text)) {
      failures.push(`${rel}: v0.38 must not add real host adapters or OS command execution`);
    }
    if (/\bprocess\.env\.[A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PROVIDER|MODEL)[A-Z0-9_]*\b/.test(text)) {
      failures.push(`${rel}: eval-ai implementation must not load provider keys, tokens, model, or provider environment`);
    }
    if (/\b(?:Date\.now|new Date|performance\.now|Math\.random|crypto\.randomUUID|randomBytes)\b/.test(text)) {
      failures.push(`${rel}: v0.38 reports must remain deterministic and must not depend on wall clock or random values`);
    }
    if (/\b(?:openai|anthropic|claude|google-genai|vertexai|bedrock|mistral|cohere|langchain|llamaindex|ai-sdk)\b/i.test(text)) {
      failures.push(`${rel}: v0.38 implementation must not reference provider SDKs`);
    }
  }

  const airc = read("bin/airc.js");
  if (/\b(?:liveEval|liveModel|providerCall|providerRequest|apiKey)\b/.test(airc)) {
    failures.push("bin/airc.js: v0.38 CLI must not expose live provider/API-key paths");
  }
}

function checkCliWiring() {
  const airc = read("bin/airc.js");
  if (!/command === "run-proof"/.test(airc)) failures.push("bin/airc.js: missing run-proof command wiring");
  if (!/file === "import"/.test(airc) || !/eval-ai import/.test(airc)) failures.push("bin/airc.js: missing eval-ai import command wiring");
}

function checkRuntimeReports() {
  const e2e = runJson([
    "bin/airc.js",
    "run-proof",
    "examples/lan_observer_readonly_package",
    "--fixture",
    "examples/lan_observer_readonly_package/traces/pass.json",
    "--policy",
    "examples/lan_observer_readonly_package/host_policies/lan_observer_readonly.policy.json",
    "--profile",
    "cli",
    "--json"
  ], "run-proof");
  if (e2e) {
    if (e2e.kind !== "air.e2eProofReport") failures.push("run-proof: unexpected report kind");
    if (e2e.status !== "passed") failures.push("run-proof: expected passed report");
    if (e2e.airAbi !== "0.10") failures.push("run-proof: AIR ABI must remain 0.10");
    const sections = ((e2e.evidenceReport || {}).sections || []).map((section) => section.name);
    for (const expected of [
      "static validation",
      "package policy validation",
      "conformance replay",
      "runtime execution proof",
      "host policy simulation"
    ]) {
      if (!sections.includes(expected)) failures.push(`run-proof: missing evidence report section ${expected}`);
    }
    assertNoUnsafeReportFields(e2e, "run-proof");
    assertNoRawPrivateFacts(e2e, "run-proof");
  }

  const imported = runJson([
    "bin/airc.js",
    "eval-ai",
    "import",
    "test/fixtures/ai_eval_import/valid",
    "--json"
  ], "eval-ai import");
  if (imported) {
    if (imported.kind !== "air.aiAuthoringEvalImportReport") failures.push("eval-ai import: unexpected report kind");
    if (imported.mode !== "import") failures.push("eval-ai import: mode must be import");
    if (imported.status !== "passed") failures.push("eval-ai import: expected passed report");
    const runConfig = imported.runConfig || {};
    if (runConfig.liveModelCalls !== false) failures.push("eval-ai import: liveModelCalls must be false");
    if (runConfig.network !== false) failures.push("eval-ai import: network must be false");
    if (runConfig.apiKeysRequired !== false) failures.push("eval-ai import: apiKeysRequired must be false");
    if (runConfig.providerSdkDependencies !== false) failures.push("eval-ai import: providerSdkDependencies must be false");
    assertNoUnsafeReportFields(imported, "eval-ai import");
  }

  const secret = runJsonExpectFailure([
    "bin/airc.js",
    "eval-ai",
    "import",
    "test/fixtures/ai_eval_import/secret",
    "--json"
  ], "eval-ai secret import");
  if (secret) assertRejectedImport(secret, "eval-ai secret import");

  const provider = runJsonExpectFailure([
    "bin/airc.js",
    "eval-ai",
    "import",
    "test/fixtures/ai_eval_import/provider_metadata",
    "--json"
  ], "eval-ai provider metadata import");
  if (provider) assertRejectedImport(provider, "eval-ai provider metadata import");

  const benchmark = runJson([
    "bin/airc.js",
    "benchmark",
    "benchmarks/e2e_lan_observer_readonly_basic",
    "--json"
  ], "E2E benchmark");
  if (benchmark) {
    if (benchmark.kind !== "air.benchmarkReport") failures.push("E2E benchmark: unexpected report kind");
    if (!benchmark.metrics || !Number.isInteger(benchmark.metrics.e2eProofMs)) failures.push("E2E benchmark: expected e2eProofMs metric");
    if (!benchmark.metrics || !Number.isInteger(benchmark.metrics.outputIntentCount)) failures.push("E2E benchmark: expected outputIntentCount metric");
    assertNoUnsafeReportFields(benchmark, "E2E benchmark");
  }
}

function assertRejectedImport(report, label) {
  if (report.kind !== "air.aiAuthoringEvalImportReport") failures.push(`${label}: unexpected report kind`);
  if (report.status !== "failed") failures.push(`${label}: expected failed status`);
  if (!Number.isInteger(report.rejectedCaseCount) || report.rejectedCaseCount < 1) failures.push(`${label}: expected rejected cases`);
  if (!Array.isArray(report.diagnostics) || !report.diagnostics.some((item) => item.code === "air.eval_ai.import_sensitive_content")) {
    failures.push(`${label}: expected sensitive content diagnostic`);
  }
  assertNoUnsafeReportFields(report, label);
}

function checkNoAbiExpansion() {
  const version = read("src/version.js");
  if (!/AIR_ABI_VERSION\s*=\s*["']0\.10["']/.test(version)) failures.push("src/version.js: AIR ABI must remain 0.10");
  const manifest = read("src/package_manifest.js");
  if (!/HOST_ABI_VERSION\s*=\s*["']0\.10["']/.test(manifest)) failures.push("src/package_manifest.js: Host ABI baseline/default must remain 0.10");

  for (const rel of cliFiles) {
    const text = read(rel);
    if (/["']0\.12["']/.test(text) && /\b(?:HOST_ABI|hostAbi|Host ABI)\b/.test(text)) {
      failures.push(`${rel}: Host ABI expansion is rejected in v0.38`);
    }
  }
}

function runJson(args, label) {
  const result = childProcess.spawnSync(process.execPath, args, {
    cwd: root,
    encoding: "utf8",
    env: cleanEnv()
  });
  if (result.status !== 0) {
    failures.push(`${label}: command failed: ${(result.stderr || result.stdout || "").trim()}`);
    return null;
  }
  return parseJson(result.stdout, label);
}

function runJsonExpectFailure(args, label) {
  const result = childProcess.spawnSync(process.execPath, args, {
    cwd: root,
    encoding: "utf8",
    env: cleanEnv()
  });
  if (result.status === 0) {
    failures.push(`${label}: expected command to fail`);
    return null;
  }
  return parseJson(result.stdout, label);
}

function cleanEnv() {
  return {
    ...process.env,
    OPENAI_API_KEY: "",
    ANTHROPIC_API_KEY: "",
    AIR_EVAL_DISABLE_NETWORK: "1"
  };
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (err) {
    failures.push(`${label}: command did not emit valid JSON: ${err.message}`);
    return null;
  }
}

function assertNoUnsafeReportFields(value, label) {
  walk(value, (item, key) => {
    if (key && /timestamp|createdAt|updatedAt|generatedAt|wallClock/i.test(key)) failures.push(`${label}: report must not include timestamp-like field ${key}`);
    if (typeof item === "string") {
      if (item.startsWith(root) || /^[A-Za-z]:[\\/]/.test(item) || item.startsWith("file://")) failures.push(`${label}: report must not include absolute path ${item}`);
      if (/\b(?:https?|wss?):\/\/[^\s"')]+/i.test(item)) failures.push(`${label}: report must not include raw URL ${item}`);
      if (/-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:sk|pk|xox[baprs])-?[A-Za-z0-9_-]{12,}|AKIA[0-9A-Z]{12,}|Bearer\s+[A-Za-z0-9._-]{12,}|api[_-]?key\s*[:=]\s*[A-Za-z0-9._-]{8,}/i.test(item)) {
        failures.push(`${label}: report must not include credential, token, or secret values`);
      }
      if (/\breq_[A-Za-z0-9_-]{8,}\b/i.test(item)) failures.push(`${label}: report must not include provider request ids`);
    }
  });
}

function assertNoRawPrivateFacts(value, label) {
  const serialized = JSON.stringify(value);
  for (const forbidden of [
    "device_id",
    "latency_ms",
    "packet_loss_x1000",
    "raw_hostname",
    "mac_address",
    "ip_address",
    "packet_dump"
  ]) {
    if (serialized.includes(forbidden)) failures.push(`${label}: report must not expose raw/private fact name ${forbidden}`);
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
