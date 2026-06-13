#!/usr/bin/env node

const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const failures = [];

const docs = [
  "docs/API_GATES_v0_39.md",
  "docs/FEATURE_STATUS_v0.39.md",
  "docs/V0_39_RELEASE_PLAN.md",
  "docs/rfcs/v0.39-executable-package-composition.md"
];

const implementationFiles = [
  "bin/airc.js",
  "src/link_plan.js",
  "src/linked_package.js",
  "src/module_graph.js",
  "src/package_graph_ownership.js",
  "src/sdk.js",
  "src/verification_evidence.js"
];

function main() {
  runPriorGate();
  checkDocs();
  checkPackageScript();
  checkRunRcChecks();
  checkImplementationBoundaries();
  checkRuntimeOutputs();
  checkNoAbiExpansion();

  if (failures.length) {
    console.error(failures.join("\n"));
    process.exit(1);
  }
  console.log("api gates v0.39: ok");
}

function runPriorGate() {
  const script = path.join(root, "scripts", "check_api_gates_v0_38.js");
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
    if (!fs.existsSync(path.join(root, rel))) failures.push(`${rel}: required v0.39 gate/status doc is missing`);
  }
  const status = read("docs/FEATURE_STATUS_v0.39.md");
  const release = read("docs/V0_39_RELEASE_PLAN.md");
  const gate = read("docs/API_GATES_v0_39.md");
  const rfc = read("docs/rfcs/v0.39-executable-package-composition.md");
  const combined = `${status}\n${release}\n${gate}\n${rfc}`;

  for (const expected of [
    "Executable Package Composition",
    "Implemented/P0",
    "authoredGraph",
    "executableGraph",
    "ownershipMap",
    "generated executable graph",
    "derived",
    "semantic source of truth"
  ]) {
    if (!combined.includes(expected)) failures.push(`v0.39 docs: expected ${expected}`);
  }
  if (!/AIR ABI remains `0\.10`/.test(combined)) failures.push("v0.39 docs: AIR ABI must remain 0.10");
  if (!/Host ABI (?:unchanged|latest remains `0\.11`)/.test(combined)) failures.push("v0.39 docs: Host ABI must remain unchanged/0.11 bounded output.emit");
  if (!/package registry/i.test(combined) || !/native installer/i.test(combined) || !/host authority/i.test(combined)) {
    failures.push("v0.39 docs: deferred/rejected package registry, native installer, and host authority boundaries must be explicit");
  }
}

function checkPackageScript() {
  const pkg = JSON.parse(read("package.json"));
  if ((pkg.scripts || {})["check:api-gates:v0.39"] !== "node scripts/check_api_gates_v0_39.js") {
    failures.push("package.json: missing check:api-gates:v0.39 script");
  }
}

function checkRunRcChecks() {
  const text = read("scripts/run_rc_checks.sh");
  if (!text.includes("npm run check:api-gates:v0.39")) {
    failures.push("scripts/run_rc_checks.sh: v0.39 API gate must run during RC checks");
  }
}

function checkImplementationBoundaries() {
  for (const rel of implementationFiles) {
    const text = read(rel);
    if (/\b(?:packageRegistry|registryInstall|nativeInstaller|installNative|vite|Vite|browserBundl|assetPipelineRewrite|draw_actor|draw_contra_enemy|platformerWater|bossProjectile)\b/.test(text)) {
      failures.push(`${rel}: package registry/native installer/demo bundler/game API implementation is rejected in v0.39`);
    }
    if (/\b(?:declaredPool|declaredPools|slotGroup|slotGroups)\b/i.test(text) && rel !== "src/sdk.js") {
      failures.push(`${rel}: declared pools remain outside v0.39`);
    }
    if (/\b(?:hostObject|hostHandle|host_object_handle)\b/.test(text) && !["src/sdk.js"].includes(rel)) {
      failures.push(`${rel}: host object handles are rejected in v0.39`);
    }
    if (/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/.test(text) || /\brequire\(["'](?:http|https|net|tls|dns|dgram)["']\)/.test(text)) {
      failures.push(`${rel}: package composition must not add network or raw host authority`);
    }
    if (/\b(?:Date\.now|new Date|performance\.now|Math\.random|crypto\.randomUUID|randomBytes)\b/.test(text) && rel !== "src/sdk.js") {
      failures.push(`${rel}: executable graph metadata must stay deterministic and must not depend on wall clock or random values`);
    }
    if (/\b(?:executableGraphIsSourceOfTruth|generatedArtifactsAreSourceOfTruth|semanticSourceOfTruth\s*:\s*["'](?:executable|generated))\b/.test(text)) {
      failures.push(`${rel}: executable/generated graph must not become semantic source of truth`);
    }
  }
}

function checkRuntimeOutputs() {
  const planText = run([
    "bin/airc.js",
    "link-plan",
    "test/fixtures/package_composition/basic_multi_module",
    "--profile",
    "browser-webgpu",
    "--json"
  ], "link-plan");
  const repeatPlanText = run([
    "bin/airc.js",
    "link-plan",
    "test/fixtures/package_composition/basic_multi_module",
    "--profile",
    "browser-webgpu",
    "--json"
  ], "link-plan deterministic repeat");
  if (planText && repeatPlanText && planText !== repeatPlanText) failures.push("link-plan: output must be deterministic");
  const plan = planText ? parseJson(planText, "link-plan") : null;
  if (plan) {
    assertCompositionMetadata(plan, "link-plan");
    if (plan.abiImpact && plan.abiImpact.airAbi !== "0.10") failures.push("link-plan: AIR ABI must remain 0.10");
    if (plan.abiImpact && plan.abiImpact.airAbiBumpRequired !== false) failures.push("link-plan: AIR ABI bump must not be required");
    if (plan.abiImpact && plan.abiImpact.hostAbiBumpRequired !== false) failures.push("link-plan: Host ABI bump must not be required");
    assertNoUnsafeMetadata(plan, "link-plan");
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "air-v039-gate-"));
  const output = path.join(tmp, "composition.wasm");
  run([
    "bin/airc.js",
    "build",
    "package",
    "test/fixtures/package_composition/basic_multi_module",
    "--linked-wasm",
    "--profile",
    "browser-webgpu",
    "-o",
    output
  ], "linked package build");
  const sidecarPath = `${output}.link.json`;
  if (!fs.existsSync(sidecarPath)) {
    failures.push("linked package build: expected sidecar metadata");
  } else {
    const sidecar = parseJson(fs.readFileSync(sidecarPath, "utf8"), "linked package sidecar");
    if (sidecar) {
      assertCompositionMetadata(sidecar, "linked package sidecar");
      if ((sidecar.executableGraph.linkedOutput || {}).kind !== "wasm") failures.push("linked package sidecar: expected wasm linked output kind");
      if (sidecar.abiImpact && sidecar.abiImpact.airAbi !== "0.10") failures.push("linked package sidecar: AIR ABI must remain 0.10");
      if (sidecar.abiImpact && sidecar.abiImpact.airAbiBumpRequired !== false) failures.push("linked package sidecar: AIR ABI bump must not be required");
      if (sidecar.abiImpact && sidecar.abiImpact.hostAbiBumpRequired !== false) failures.push("linked package sidecar: Host ABI bump must not be required");
      assertNoUnsafeMetadata(sidecar, "linked package sidecar");
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });

  for (const args of [
    ["bin/airc.js", "link-plan", "test/fixtures/package_composition/private_import", "--profile", "cli", "--json"],
    ["bin/airc.js", "link-plan", "test/fixtures/package_composition/unresolved_module", "--profile", "cli", "--json"],
    ["bin/airc.js", "link-plan", "test/fixtures/package_composition/unresolved_symbol", "--profile", "cli", "--json"]
  ]) {
    const report = runJsonExpectFailure(args, `negative fixture ${args[2]}`);
    if (report) assertPackageGraphFailure(report, args[2]);
  }
}

function assertCompositionMetadata(report, label) {
  if (report.status !== "pass") failures.push(`${label}: expected pass status`);
  if (!report.authoredGraph || report.authoredGraph.kind !== "air.authoredPackageGraph") failures.push(`${label}: missing authoredGraph`);
  if (!report.executableGraph || report.executableGraph.kind !== "air.executablePackageGraph") failures.push(`${label}: missing executableGraph`);
  if (!Array.isArray(report.authoredToExecutable) || !report.authoredToExecutable.length) failures.push(`${label}: missing authoredToExecutable mapping`);
  if (!report.ownershipMap || !Array.isArray(report.ownershipMap.symbols)) failures.push(`${label}: missing ownershipMap symbols`);
  if (!report.generatedExecutableFreshness || report.generatedExecutableFreshness.status !== "current") failures.push(`${label}: executable freshness must be current`);
  if (report.generatedExecutableFreshness && report.generatedExecutableFreshness.authorityDrift && report.generatedExecutableFreshness.authorityDrift.status !== "pass") {
    failures.push(`${label}: executable graph must not introduce authority drift`);
  }
  const modules = (report.authoredGraph && report.authoredGraph.modules || []).map((item) => item.path);
  if (modules.join(",") !== "main.air,math.air") failures.push(`${label}: expected stable authored module ordering`);
  const imports = report.ownershipMap && report.ownershipMap.imports || [];
  if (!imports.some((item) => item.module === "main.air" && item.resolved === "math.air")) failures.push(`${label}: expected authored import ownership resolution`);
  const privateSymbols = report.ownershipMap && report.ownershipMap.privateSymbols || [];
  if (!privateSymbols.some((item) => item.authoredModule === "math.air" && item.name === "internal_add_one")) failures.push(`${label}: expected private symbol ownership metadata`);
}

function assertPackageGraphFailure(report, label) {
  if (report.status !== "fail") failures.push(`${label}: expected fail status`);
  const codes = new Set((report.linkDiagnostics || []).map((diagnostic) => diagnostic.code));
  const expected = [
    "air.package_graph.private_symbol_import",
    "air.package_graph.unresolved_module_import",
    "air.package_graph.unresolved_symbol_import"
  ];
  if (!expected.some((code) => codes.has(code))) failures.push(`${label}: expected stable package graph diagnostic`);
  assertNoUnsafeMetadata(report, label);
}

function checkNoAbiExpansion() {
  const version = read("src/version.js");
  if (!/AIR_ABI_VERSION\s*=\s*["']0\.10["']/.test(version)) failures.push("src/version.js: AIR ABI must remain 0.10");
  const manifest = read("src/package_manifest.js");
  if (!/HOST_ABI_VERSION\s*=\s*["']0\.10["']/.test(manifest)) failures.push("src/package_manifest.js: Host ABI baseline/default must remain 0.10");
  for (const rel of implementationFiles) {
    const text = read(rel);
    if (/["']0\.12["']/.test(text) && /\b(?:HOST_ABI|hostAbi|Host ABI)\b/.test(text)) {
      failures.push(`${rel}: Host ABI expansion is rejected in v0.39`);
    }
  }
}

function run(args, label) {
  const result = childProcess.spawnSync(process.execPath, args, {
    cwd: root,
    encoding: "utf8"
  });
  if (result.status !== 0) {
    failures.push(`${label}: command failed: ${(result.stderr || result.stdout || "").trim()}`);
    return null;
  }
  return result.stdout;
}

function runJsonExpectFailure(args, label) {
  const result = childProcess.spawnSync(process.execPath, args, {
    cwd: root,
    encoding: "utf8"
  });
  if (result.status === 0) {
    failures.push(`${label}: expected command to fail`);
    return null;
  }
  return parseJson(result.stdout, label);
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (err) {
    failures.push(`${label}: command did not emit valid JSON: ${err.message}`);
    return null;
  }
}

function assertNoUnsafeMetadata(value, label) {
  walk(value, (item, key) => {
    if (key && /timestamp|createdAt|updatedAt|generatedAt|wallClock|date/i.test(key)) {
      failures.push(`${label}: metadata must not include timestamp-like field ${key}`);
    }
    if (typeof item !== "string") return;
    if (item.startsWith(root) || item.startsWith(os.tmpdir()) || /^[A-Za-z]:[\\/]/.test(item) || item.startsWith("file://")) {
      failures.push(`${label}: metadata must not include absolute path ${item}`);
    }
    if (/\b(?:https?|wss?):\/\/[^\s"')]+/i.test(item)) failures.push(`${label}: metadata must not include raw URL ${item}`);
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:sk|pk|xox[baprs])-?[A-Za-z0-9_-]{12,}|AKIA[0-9A-Z]{12,}|Bearer\s+[A-Za-z0-9._-]{12,}|api[_-]?key\s*[:=]\s*[A-Za-z0-9._-]{8,}/i.test(item)) {
      failures.push(`${label}: metadata must not include credential, token, or secret values`);
    }
  });
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
