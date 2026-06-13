#!/usr/bin/env node

const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const failures = [];

const textExtensions = new Set([
  ".air",
  ".js",
  ".cjs",
  ".mjs",
  ".ts",
  ".tsx",
  ".json",
  ".md",
  ".toml",
  ".wit"
]);

const scanRoots = [
  "src",
  "stdlib",
  "spec",
  "hosts",
  "data",
  "examples",
  "kits",
  "docs",
  "test",
  "demo"
];

const allowedMentionFiles = [
  /^docs\//,
  /^spec\//,
  /^test\//,
  /^requests\//,
  /^REVIEW_RESULTS\//
];

const rejectionMetadataFiles = new Set([
  "src/surface.js",
  "src/sdk.js",
  "src/mock_host_policy.js",
  "src/types.js"
]);

const controlledOutputEmitImplementationFiles = new Set([
  "src/host_abi.js",
  "src/registry.js",
  "src/verifier.js",
  "src/lower_wasm.js",
  "src/sdk.js",
  "src/package_manifest.js",
  "src/host_profiles.js",
  "src/capabilities.js",
  "src/surface.js",
  "src/output_contract_schema.js",
  "src/command_buffer_schema.js",
  "src/mock_host_policy.js",
  "src/verification_evidence.js",
  "src/benchmark_report.js",
  "src/verifier_safety_fuzz.js",
  "bin/airc.js",
  "data/host_profiles/mock-output-v011.json"
]);

const verifierSafetyHarnessFiles = new Set([
  "src/verifier_safety_fuzz.js"
]);

function main() {
  runV026Gate();

  const files = scanRoots.flatMap((dir) => listFiles(path.join(root, dir)));
  for (const file of files) {
    const rel = normalize(path.relative(root, file));
    if (!textExtensions.has(path.extname(file))) continue;
    const text = fs.readFileSync(file, "utf8");
    checkDynamicOutputEmit(rel, text);
    checkOutputEmitPayloadShape(rel, text);
    checkEventExpansion(rel, text);
    checkRawAuthority(rel, text);
    checkHostHandles(rel, text);
    checkAutomaticActionGuarantee(rel, text);
    checkDemoHostAuthority(rel, text);
  }

  if (failures.length) {
    console.error(failures.join("\n"));
    process.exit(1);
  }
  console.log(`api gates v0.27: ok (${files.length} file(s) scanned)`);
}

function runV026Gate() {
  const script = path.join(root, "scripts", "check_api_gates_v0_26.js");
  const result = childProcess.spawnSync(process.execPath, [script], {
    cwd: root,
    encoding: "utf8"
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) process.exit(result.status || 1);
}

function checkDynamicOutputEmit(rel, text) {
  if (isAllowedMentionFile(rel)) return;
  if (verifierSafetyHarnessFiles.has(rel)) return;
  if (!isActiveAirPackagePath(rel)) return;
  if (/@output\.emit\s*\(\s*%/.test(text)) {
    failures.push(`${rel}: output.emit output_id must remain statically resolvable; dynamic SSA values are deferred`);
  }
}

function checkOutputEmitPayloadShape(rel, text) {
  if (isAllowedMentionFile(rel)) return;
  if (!isActiveImplementationPath(rel)) return;
  if (controlledOutputEmitImplementationFiles.has(rel)) return;
  if (!/\boutput\.emit\b/.test(text)) return;
  if (/\b(?:string|str|ptr|pointer|slice|object|map|json|payload|raw_text|raw_url|private_text)\b/i.test(text)) {
    failures.push(`${rel}: v0.27 output.emit gate allows only scalar i32 args; string/object/json/payload/pointer/slice args remain rejected`);
  }
}

function checkEventExpansion(rel, text) {
  if (isAllowedMentionFile(rel)) return;
  if (!isActiveImplementationPath(rel)) return;
  if (rejectionMetadataFiles.has(rel)) return;
  if (/\b(?:output\.event|audio\.event|effect\.event|effect_event)\b/.test(text)) {
    failures.push(`${rel}: output/audio/effect event APIs remain rejected in v0.27 stabilization`);
  }
}

function checkRawAuthority(rel, text) {
  if (isAllowedMentionFile(rel)) return;
  if (!isAirPublicSurfacePath(rel)) return;
  if (path.extname(rel) === ".md") return;
  if (rejectionMetadataFiles.has(rel)) return;
  if (/\b(?:chrome\.|document\.|window\.|indexedDB|localStorage|sessionStorage|fetch|XMLHttpRequest|React|DOM|AWS|Azure|GCP|Postgres|Kubernetes|kubectl|docker|jira)\b/i.test(text)) {
    failures.push(`${rel}: raw platform authority is not allowed in active AIR Core/API paths`);
  }
}

function checkHostHandles(rel, text) {
  if (isAllowedMentionFile(rel)) return;
  if (!isAirPublicSurfacePath(rel)) return;
  if (rejectionMetadataFiles.has(rel)) return;
  if (/(?:^|[,{]\s*)["']?(?:hostHandle|hostObject|host_object_handle)["']?\s*:/.test(text)) {
    failures.push(`${rel}: host object handle API fields remain rejected in v0.27`);
  }
}

function checkAutomaticActionGuarantee(rel, text) {
  if (isAllowedMentionFile(rel)) return;
  if (!isActiveImplementationPath(rel)) return;
  if (/\b(?:auto(?:matic)?(?:ally)?Execute|guaranteedSideEffect|sideEffectGuaranteed|executeWithoutPolicy)\b/.test(text)) {
    failures.push(`${rel}: automatic host-side action guarantees remain rejected; host policy owns execution`);
  }
}

function checkDemoHostAuthority(rel, text) {
  if (!rel.startsWith("demo/")) return;
  if (/\boutput\.emit\b/.test(text)) {
    failures.push(`${rel}: demos must not become Host ABI 0.11 output.emit authority`);
  }
  if (/"hostAbi"\s*:\s*"0\.11"/.test(text) || /\bHost ABI\s+0\.11\b/i.test(text)) {
    failures.push(`${rel}: demos must not define or document Host ABI 0.11 authority`);
  }
}

function isAllowedMentionFile(rel) {
  return allowedMentionFiles.some((re) => re.test(rel));
}

function isActiveImplementationPath(rel) {
  return /^(?:src|stdlib|hosts|data|examples|kits|bin)\//.test(rel);
}

function isActiveAirPackagePath(rel) {
  return /^(?:src|stdlib|data|examples|kits|bin|demo)\//.test(rel);
}

function isAirPublicSurfacePath(rel) {
  return /^(?:src|stdlib|data|examples|kits|bin)\//.test(rel);
}

function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist" || entry.name === "build") continue;
    if (entry.name === "REVIEW_RESULTS" || entry.name === "old_bundles" || entry.name === "tmp_unused") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function normalize(value) {
  return value.split(path.sep).join("/");
}

main();
