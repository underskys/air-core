const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { parseAir } = require("./parser");
const { verifyModule } = require("./verifier");
const { lowerToWat, watToWasm } = require("./lower_wasm");
const { checkPackageDir, reportPackageDir, createOutputImports } = require("./sdk");
const { createPackageVerificationEvidence } = require("./verification_evidence");
const { createConformanceReplayReport } = require("./conformance_replay");
const { createMockHostInteractionEvidence } = require("./mock_host_policy");
const { createEvidenceMarkdownReport } = require("./evidence_report");
const { createE2eProofReport } = require("./e2e_proof");
const { validatePackageManifest, normalizePackageMetadata, HOST_ABI_VERSION } = require("./package_manifest");
const { AIR_ABI_VERSION } = require("./version");

const BENCHMARK_SCHEMA_VERSION = "0.29";
const BENCHMARK_REPORT_KIND = "air.benchmarkReport";
const BENCHMARK_CONFIG_KIND = "air.benchmark";
const BENCHMARK_CONFIG_FILE = "benchmark.json";

async function createBenchmarkReport(benchmarkDir, options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const benchmarkBase = path.resolve(benchmarkDir || "");
  if (!benchmarkDir || !fs.existsSync(benchmarkBase) || !fs.statSync(benchmarkBase).isDirectory()) {
    return finalizeReport({
      cwd,
      benchmarkBase,
      status: "fail",
      benchmarkName: path.basename(benchmarkBase || cwd) || null,
      benchmarkId: null,
      packageHash: null,
      hostAbi: HOST_ABI_VERSION,
      runConfig: defaultRunConfig(),
      metrics: defaultMetrics(),
      diagnostics: [diagnostic("air.benchmark.missing_dir", "fail", "benchmark directory does not exist", {
        benchmarkDir: sanitizePath(benchmarkBase, cwd)
      })],
      limitations: ["benchmark did not run because the benchmark directory was missing"]
    });
  }

  let config = null;
  try {
    config = readBenchmarkConfig(benchmarkBase, cwd);
  } catch (err) {
    return finalizeReport({
      cwd,
      benchmarkBase,
      status: "fail",
      benchmarkName: path.basename(benchmarkBase),
      benchmarkId: null,
      packageHash: null,
      hostAbi: HOST_ABI_VERSION,
      runConfig: defaultRunConfig(),
      metrics: defaultMetrics(),
      diagnostics: [diagnostic("air.benchmark.config_invalid", "fail", err.message, {
        benchmarkDir: sanitizePath(benchmarkBase, cwd)
      })],
      limitations: ["benchmark did not run because benchmark.json was invalid"]
    });
  }

  const workRoot = path.resolve(options.workRoot || path.join(cwd, "build", "benchmarks", config.benchmarkId));
  fs.rmSync(workRoot, { recursive: true, force: true });
  fs.mkdirSync(workRoot, { recursive: true });

  const runConfig = stableObject({
    benchmarkDir: sanitizePath(benchmarkBase, cwd),
    profile: config.profile || null,
    repeat: config.repeat,
    sourceOnly: true,
    runtime: config.runtime || null,
    e2eProof: config.e2eProof || null,
    trace: config.trace || null
  });
  const metrics = defaultMetrics();
  const diagnostics = [];
  const limitations = [];
  let packageDir = path.resolve(benchmarkBase, config.packageDir);
  let workingPackageDir = packageDir;
  let packageCheck = null;
  let packageReport = null;
  let evidence = null;
  let conformanceReport = null;
  let e2eProofReport = null;

  try {
    metrics.packageSizeBytes = directorySizeBytes(packageDir);
  } catch (err) {
    diagnostics.push(diagnostic("air.benchmark.package_size_unavailable", "warn", err.message, {}));
    limitations.push("packageSizeBytes unavailable because package files could not be scanned");
  }

  const buildWasm = Boolean(config.buildWasm || config.runtime || config.traceRequiresWasm);
  if (buildWasm) {
    workingPackageDir = path.join(workRoot, "package");
    fs.cpSync(packageDir, workingPackageDir, { recursive: true });
    packageDir = workingPackageDir;
    const built = await measureAsync(async () => buildPackageWasm(packageDir, config));
    metrics.wasmBuildMs = built.ms;
    if (built.error) {
      diagnostics.push(diagnostic("air.benchmark.wasm_build_failed", "fail", built.error.message, {}));
    } else {
      metrics.wasmSizeBytes = built.value.wasmSizeBytes;
    }
  }

  const check = measureSync(() => checkPackageDir(packageDir, {
    profile: config.profile || null,
    built: false,
    releaseCandidate: Boolean(config.releaseCandidate)
  }));
  metrics.packageCheckMs = check.ms;
  if (check.error) diagnostics.push(diagnostic("air.benchmark.package_check_failed", "fail", check.error.message, {}));
  else packageCheck = check.value;

  const report = measureSync(() => reportPackageDir(packageDir, {
    profile: config.profile || null,
    releaseCandidate: Boolean(config.releaseCandidate)
  }));
  metrics.reportMs = report.ms;
  if (report.error) diagnostics.push(diagnostic("air.benchmark.report_failed", "fail", report.error.message, {}));
  else packageReport = report.value;

  const verify = measureSync(() => {
    const result = createPackageVerificationEvidence(packageDir, {
      profile: config.profile || null,
      releaseCandidate: Boolean(config.releaseCandidate)
    });
    if (result.status === "failed") {
      const err = new Error((result.errors || []).join("; ") || "verification evidence status failed");
      err.evidence = result;
      throw err;
    }
    return result;
  });
  metrics.verifierMs = verify.ms;
  metrics.evidenceMs = verify.ms;
  if (verify.error) {
    evidence = verify.error.evidence || null;
    diagnostics.push(diagnostic("air.benchmark.verify_failed", "fail", verify.error.message, {}));
  } else {
    evidence = verify.value;
  }

  if (config.trace) {
    const conformance = await measureAsync(() => createConformanceReplayReport(packageDir, {
      profile: config.profile || null,
      trace: path.resolve(benchmarkBase, config.trace)
    }));
    metrics.conformanceReplayMs = conformance.ms;
    if (conformance.error) diagnostics.push(diagnostic("air.benchmark.conformance_failed", "fail", conformance.error.message, {}));
    else {
      conformanceReport = conformance.value;
      if (conformanceReport.status === "fail") {
        diagnostics.push(diagnostic("air.benchmark.conformance_failed", "fail", "conformance replay failed", {}));
      }
    }
  } else {
    limitations.push("conformanceReplayMs unavailable because benchmark does not declare a trace");
  }

  if (config.runtime) {
    const runtime = await measureAsync(() => runRuntimeBenchmark(packageDir, config));
    metrics.wasmExecutionMs = runtime.ms;
    if (runtime.error) {
      diagnostics.push(diagnostic("air.benchmark.runtime_unavailable", "warn", runtime.error.message, {}));
      limitations.push("wasmExecutionMs unavailable because runtime execution could not complete");
    }
  } else {
    limitations.push("wasmExecutionMs unavailable because benchmark does not declare runtime execution");
  }

  if (config.e2eProof) {
    const fixture = path.resolve(benchmarkBase, config.e2eProof.fixture);
    const policy = path.resolve(benchmarkBase, config.e2eProof.policy);
    const e2e = await measureAsync(() => createE2eProofReport(packageDir, {
      profile: config.profile || null,
      fixture,
      policy
    }));
    metrics.e2eProofMs = e2e.ms;
    if (e2e.error) {
      diagnostics.push(diagnostic("air.benchmark.e2e_proof_failed", "fail", e2e.error.message, {}));
    } else {
      e2eProofReport = e2e.value;
      if (e2eProofReport.status === "failed") diagnostics.push(diagnostic("air.benchmark.e2e_proof_failed", "fail", "E2E execution proof failed", {}));
      metrics.outputIntentCount = e2eProofReport.executionProof && Number.isInteger(e2eProofReport.executionProof.outputIntentCount)
        ? e2eProofReport.executionProof.outputIntentCount
        : null;
    }

    const mockHost = measureSync(() => createMockHostInteractionEvidence(packageDir, {
      profile: config.profile || null,
      policy,
      trace: fixture
    }));
    metrics.mockHostPolicyMs = mockHost.ms;
    if (mockHost.error) diagnostics.push(diagnostic("air.benchmark.mock_host_policy_failed", "fail", mockHost.error.message, {}));

    const evidenceReport = measureSync(() => createEvidenceMarkdownReport(packageDir, {
      profile: config.profile || null,
      e2eProof: e2eProofReport || null
    }));
    metrics.evidenceReportMs = evidenceReport.ms;
    if (evidenceReport.error) diagnostics.push(diagnostic("air.benchmark.evidence_report_failed", "fail", evidenceReport.error.message, {}));
  } else {
    limitations.push("e2eProofMs unavailable because benchmark does not declare e2eProof");
    limitations.push("evidenceReportMs unavailable because benchmark does not declare e2eProof");
    limitations.push("mockHostPolicyMs unavailable because benchmark does not declare e2eProof policy");
    limitations.push("outputIntentCount unavailable because benchmark does not declare e2eProof");
  }

  metrics.outputEmitCount = countOutputEmit(packageCheck, packageReport, evidence, conformanceReport);
  metrics.commandBufferRecordCount = countCommandBufferRecords(packageCheck, packageReport, evidence, conformanceReport);
  if (config.e2eProof) {
    metrics.hostCrossings = Number.isInteger(metrics.outputEmitCount) ? metrics.outputEmitCount : 0;
  } else {
    metrics.hostCrossings = Number.isInteger(metrics.outputEmitCount) && metrics.outputEmitCount > 0
      ? metrics.outputEmitCount
      : null;
  }
  if (metrics.hostCrossings === null) limitations.push("hostCrossings unavailable unless output.emit calls are statically measurable");
  if (metrics.wasmBuildMs === null) limitations.push("wasmBuildMs unavailable because benchmark does not request Wasm build");
  if (metrics.wasmSizeBytes === null) limitations.push("wasmSizeBytes unavailable because benchmark does not produce a Wasm artifact");

  const packageHash = evidence && evidence.packageHash ? evidence.packageHash : hashPackageInputs(packageReport || packageCheck || {});
  const hostAbi = (evidence && evidence.hostAbi) || (packageReport && packageReport.hostAbi) || (packageCheck && packageCheck.hostAbi) || HOST_ABI_VERSION;
  const status = diagnostics.some((item) => item.severity === "fail") ? "fail" : "pass";
  return finalizeReport({
    cwd,
    benchmarkBase,
    status,
    benchmarkName: config.benchmarkName,
    benchmarkId: config.benchmarkId,
    packageHash,
    hostAbi,
    runConfig,
    metrics,
    diagnostics,
    limitations
  });
}

function readBenchmarkConfig(benchmarkBase, cwd) {
  const configPath = path.join(benchmarkBase, BENCHMARK_CONFIG_FILE);
  if (!fs.existsSync(configPath)) throw new Error(`missing ${BENCHMARK_CONFIG_FILE}`);
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("benchmark config must be a JSON object");
  if (config.kind && config.kind !== BENCHMARK_CONFIG_KIND) throw new Error(`benchmark kind must be ${BENCHMARK_CONFIG_KIND}`);
  if (typeof config.benchmarkName !== "string" || config.benchmarkName.trim() === "") throw new Error("benchmarkName is required");
  if (typeof config.benchmarkId !== "string" || !/^[a-z][a-z0-9_:-]{0,127}$/.test(config.benchmarkId)) throw new Error("benchmarkId must be a stable identifier");
  if (typeof config.packageDir !== "string" || config.packageDir.trim() === "") throw new Error("packageDir is required");
  const packageDir = path.resolve(benchmarkBase, config.packageDir);
  if (!fs.existsSync(packageDir) || !fs.statSync(packageDir).isDirectory()) {
    throw new Error(`packageDir not found: ${sanitizePath(packageDir, cwd)}`);
  }
  if (config.trace !== undefined && typeof config.trace !== "string") throw new Error("trace must be a string when present");
  if (config.profile !== undefined && typeof config.profile !== "string") throw new Error("profile must be a string when present");
  if (config.e2eProof !== undefined) validateE2eProofConfig(config.e2eProof, benchmarkBase, cwd);
  const repeat = Number.isInteger(config.repeat) && config.repeat > 0 ? Math.min(config.repeat, 100000) : 1;
  return stableObject({
    benchmarkName: config.benchmarkName,
    benchmarkId: config.benchmarkId,
    packageDir: config.packageDir,
    profile: config.profile || null,
    trace: config.trace || null,
    buildWasm: Boolean(config.buildWasm),
    traceRequiresWasm: Boolean(config.traceRequiresWasm),
    runtime: config.runtime || null,
    e2eProof: config.e2eProof ? stableObject({
      fixture: config.e2eProof.fixture,
      policy: config.e2eProof.policy
    }) : null,
    repeat,
    releaseCandidate: Boolean(config.releaseCandidate)
  });
}

function validateE2eProofConfig(value, benchmarkBase, cwd) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("e2eProof must be an object when present");
  if (typeof value.fixture !== "string" || value.fixture.trim() === "") throw new Error("e2eProof.fixture is required");
  if (typeof value.policy !== "string" || value.policy.trim() === "") throw new Error("e2eProof.policy is required");
  for (const [field, rel] of [["fixture", value.fixture], ["policy", value.policy]]) {
    const full = path.resolve(benchmarkBase, rel);
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
      throw new Error(`e2eProof.${field} not found: ${sanitizePath(full, cwd)}`);
    }
  }
}

async function buildPackageWasm(packageDir, config) {
  const manifest = validatePackageManifest(packageDir, { built: false });
  const metadata = normalizePackageMetadata(manifest);
  const entryPath = path.join(packageDir, metadata.entry);
  const source = fs.readFileSync(entryPath, "utf8");
  const mod = parseAir(source, metadata.entry);
  verifyModule(mod);
  const wat = lowerToWat(mod);
  const wasm = await watToWasm(wat, entryPath);
  const wasmName = metadata.wasm || "module.wasm";
  const wasmPath = path.join(packageDir, wasmName);
  fs.writeFileSync(wasmPath, wasm);
  return {
    wasmPath,
    wasmSizeBytes: wasm.length,
    benchmarkId: config.benchmarkId
  };
}

async function runRuntimeBenchmark(packageDir, config) {
  const manifest = validatePackageManifest(packageDir, { built: false });
  const metadata = normalizePackageMetadata(manifest);
  const runtime = config.runtime || {};
  if (!runtime.export || typeof runtime.export !== "string") throw new Error("runtime.export is required");
  const repeat = config.repeat || 1;
  const wasmPath = path.join(packageDir, metadata.wasm || "module.wasm");
  if (!fs.existsSync(wasmPath)) throw new Error(`missing wasm for runtime execution: ${metadata.wasm || "module.wasm"}`);
  const imports = runtime.imports === "output" ? createOutputImports({ emit: () => 0 }) : {};
  const loaded = await WebAssembly.instantiate(fs.readFileSync(wasmPath), imports);
  const instance = loaded.instance || loaded;
  const fn = instance.exports[runtime.export];
  if (typeof fn !== "function") throw new Error(`missing runtime export ${runtime.export}`);
  const args = Array.isArray(runtime.args) ? runtime.args : [];
  for (let index = 0; index < repeat; index += 1) fn(...args);
  return { repeat };
}

function measureSync(fn) {
  const started = process.hrtime.bigint();
  try {
    const value = fn();
    return { value, ms: elapsedMs(started), error: null };
  } catch (error) {
    return { value: null, ms: elapsedMs(started), error };
  }
}

async function measureAsync(fn) {
  const started = process.hrtime.bigint();
  try {
    const value = await fn();
    return { value, ms: elapsedMs(started), error: null };
  } catch (error) {
    return { value: null, ms: elapsedMs(started), error };
  }
}

function elapsedMs(started) {
  return Number((process.hrtime.bigint() - started) / 1000000n);
}

function defaultRunConfig() {
  return stableObject({
    benchmarkDir: null,
    e2eProof: null,
    profile: null,
    repeat: 1,
    runtime: null,
    sourceOnly: true,
    trace: null
  });
}

function defaultMetrics() {
  return stableObject({
    commandBufferRecordCount: null,
    conformanceReplayMs: null,
    e2eProofMs: null,
    evidenceMs: null,
    evidenceReportMs: null,
    hostCrossings: null,
    mockHostPolicyMs: null,
    outputEmitCount: null,
    outputIntentCount: null,
    packageCheckMs: null,
    packageSizeBytes: null,
    reportMs: null,
    verifierMs: null,
    wasmBuildMs: null,
    wasmExecutionMs: null,
    wasmSizeBytes: null
  });
}

function countOutputEmit(packageCheck, packageReport, evidence) {
  const sources = [packageCheck && packageCheck.outputEmit, packageReport && packageReport.outputEmit, evidence && evidence.outputEmit];
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    if (Number.isInteger(source.count)) return source.count;
    if (Array.isArray(source.used)) {
      return source.used.reduce((sum, item) => sum + ((item.calls || []).length), 0);
    }
  }
  return 0;
}

function countCommandBufferRecords(packageCheck, packageReport, evidence, conformanceReport) {
  if (conformanceReport && conformanceReport.commands && Number.isInteger(conformanceReport.commands.observedCount)) {
    return conformanceReport.commands.observedCount;
  }
  for (const source of [packageCheck, packageReport]) {
    const usage = source && source.commandBuffers && source.commandBuffers.outputIntentUsage;
    if (Array.isArray(usage)) {
      return usage.reduce((sum, item) => sum + (Number.isInteger(item.recordCount) ? item.recordCount : 0), 0);
    }
  }
  if (evidence && Array.isArray(evidence.commandBuffers)) {
    return evidence.commandBuffers.reduce((sum, item) => sum + (Number.isInteger(item.recordCount) ? item.recordCount : 0), 0);
  }
  return 0;
}

function directorySizeBytes(dir) {
  let total = 0;
  for (const file of walkFiles(dir)) total += fs.statSync(file).size;
  return total;
}

function walkFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) out.push(...walkFiles(full));
    else if (stat.isFile()) out.push(full);
  }
  return out;
}

function hashPackageInputs(value) {
  return `sha256:${crypto.createHash("sha256").update(stableStringify(value)).digest("hex")}`;
}

function diagnostic(code, severity, message, fields) {
  return stableObject({
    code,
    severity,
    source: "benchmark",
    message,
    fields: fields || {}
  });
}

function finalizeReport(input) {
  return stableObject({
    schemaVersion: BENCHMARK_SCHEMA_VERSION,
    kind: BENCHMARK_REPORT_KIND,
    status: input.status,
    benchmarkName: input.benchmarkName,
    benchmarkId: input.benchmarkId,
    packageHash: input.packageHash,
    airAbi: AIR_ABI_VERSION,
    hostAbi: input.hostAbi || HOST_ABI_VERSION,
    runConfig: input.runConfig,
    metrics: input.metrics,
    diagnostics: (input.diagnostics || []).slice().sort((a, b) =>
      String(a.code).localeCompare(String(b.code)) ||
      String(a.message).localeCompare(String(b.message))),
    limitations: Array.from(new Set(input.limitations || [])).sort()
  });
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = stableObject(value[key]);
  return out;
}

function stableStringify(value) {
  return `${JSON.stringify(stableObject(value), null, 2)}\n`;
}

function sanitizePath(value, cwd) {
  const absolute = path.resolve(value);
  const rel = path.relative(cwd, absolute).replace(/\\/g, "/");
  return rel && !rel.startsWith("..") ? rel : path.basename(absolute);
}

module.exports = {
  BENCHMARK_SCHEMA_VERSION,
  BENCHMARK_REPORT_KIND,
  createBenchmarkReport,
  stableStringify
};
