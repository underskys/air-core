#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const failures = [];

const scanRoots = [
  "src",
  "stdlib",
  "spec",
  "hosts",
  "data",
  "examples",
  "kits",
  "docs",
  "test"
];

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

const allowedMentionFiles = [
  /^docs\//,
  /^spec\//,
  /^test\//,
  /^requests\//,
  /^REVIEW_RESULTS\//
];

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

const controlledHostAbi011Profiles = new Set([
  "data/host_profiles/mock-output-v011.json"
]);

const rejectionMetadataFiles = new Set([
  "src/surface.js",
  "src/sdk.js",
  "src/mock_host_policy.js",
  "src/types.js"
]);

function main() {
  const files = scanRoots.flatMap((dir) => listFiles(path.join(root, dir)));
  for (const file of files) {
    const rel = normalize(path.relative(root, file));
    if (!textExtensions.has(path.extname(file))) continue;
    const text = fs.readFileSync(file, "utf8");
    checkOutputEmit(rel, text);
    checkEventImports(rel, text);
    checkRawAuthority(rel, text);
    checkRuntimeJsonModel(rel, text);
    checkHostHandles(rel, text);
    checkHostAbiConstants(rel, text);
  }

  if (failures.length) {
    console.error(failures.join("\n"));
    process.exit(1);
  }
  console.log(`api gates v0.26: ok (${files.length} file(s) scanned)`);
}

function checkOutputEmit(rel, text) {
  if (!/\boutput\.emit\b/.test(text)) return;
  if (isAllowedMentionFile(rel)) return;
  if (!isActiveImplementationPath(rel)) return;

  if (!controlledOutputEmitImplementationFiles.has(rel)) {
    failures.push(`${rel}: output.emit appears outside the explicit v0.26 controlled implementation allowlist`);
    return;
  }

  const externMatches = text.match(/\bextern\s+output\.emit\s*\([^)]*\)\s*->\s*[A-Za-z0-9_]+/g) || [];
  for (const match of externMatches) {
    if (!isExactOutputEmitSignature(match)) {
      failures.push(`${rel}: output.emit extern must use exact v0.26 signature output.emit(output_id:i32, arg0:i32, arg1:i32, arg2:i32, arg3:i32) -> i32`);
    }
  }

  if (/\boutput\.emit\s*\([^)]*(?:ptr|slice|string|json|object|map|payload|raw_url|raw_text|private_text)\b/i.test(text)) {
    failures.push(`${rel}: output.emit first slice must not use pointer/slice/string/object/map/json/payload args`);
  }
}

function checkEventImports(rel, text) {
  const eventImport = /\bextern\s+(?:output\.event|audio\.event|effect\.event|effect_event)\b/;
  if (eventImport.test(text) && !isAllowedMentionFile(rel)) {
    failures.push(`${rel}: output/audio/effect event Host ABI extern remains rejected in v0.26`);
  }

  const eventImplementation = /\b(?:output\.event|audio\.event|effect\.event|effect_event)\b/;
  if (eventImplementation.test(text) && isActiveImplementationPath(rel) && !rejectionMetadataFiles.has(rel) && !isAllowedMentionFile(rel)) {
    if (/\b(hostImports?|registry|supports|extern|import|capabilit(?:y|ies))\b/i.test(text)) {
      failures.push(`${rel}: output/audio/effect event appears in active implementation metadata; keep it docs/tests/rejection-only`);
    }
  }
}

function checkRawAuthority(rel, text) {
  if (!isAirPublicSurfacePath(rel)) return;
  if (path.extname(rel) === ".md") return;
  if (rejectionMetadataFiles.has(rel)) return;
  if (/\b(?:chrome\.|document\.|window\.|indexedDB|localStorage|sessionStorage|fetch|XMLHttpRequest|React|DOM|AWS|Postgres|Kubernetes|kubectl|docker|jira)\b/i.test(text)) {
    failures.push(`${rel}: raw platform authority is not allowed in active AIR Core/API paths`);
  }
}

function checkRuntimeJsonModel(rel, text) {
  if (!isAirPublicSurfacePath(rel)) return;
  if (path.extname(rel) === ".md") return;
  if (rejectionMetadataFiles.has(rel)) return;
  if (/(?:^|[,{]\s*)["']?(?:jsonValue|jsonObject|dynamicMap|objectFields|payloadObject|runtimeJson)["']?\s*:/.test(text)) {
    failures.push(`${rel}: runtime JSON/object/dynamic-map API fields are not allowed in active Core implementation`);
  }
}

function checkHostHandles(rel, text) {
  if (!isAirPublicSurfacePath(rel)) return;
  if (path.extname(rel) === ".md") return;
  if (rejectionMetadataFiles.has(rel)) return;
  if (/(?:^|[,{]\s*)["']?(?:hostHandle|hostObject|host_object_handle)["']?\s*:/.test(text)) {
    failures.push(`${rel}: host object handle API fields are not allowed in active Core/API paths`);
  }
}

function checkHostAbiConstants(rel, text) {
  if (/^data\/host_profiles\/.+\.json$/.test(rel) && /"hostAbi"\s*:\s*"0\.11"/.test(text)) {
    if (!controlledHostAbi011Profiles.has(rel)) {
      failures.push(`${rel}: Host ABI 0.11 profile support is limited to explicit v0.26 output.emit validation profiles`);
    }
  }
  if (/^src\//.test(rel) && /\b(?:AIR_ABI_VERSION|HOST_ABI_VERSION)\b[^;\n]*["']0\.11["']/.test(text) && !/SUPPORTED_HOST_ABI_VERSIONS/.test(text)) {
    failures.push(`${rel}: AIR/Host ABI 0.11 source constant is not allowed before accepted implementation`);
  }
}

function isExactOutputEmitSignature(signature) {
  const normalized = signature.replace(/\s+/g, " ");
  return /^extern output\.emit\s*\(\s*output_id\s*:\s*i32\s*,\s*arg0\s*:\s*i32\s*,\s*arg1\s*:\s*i32\s*,\s*arg2\s*:\s*i32\s*,\s*arg3\s*:\s*i32\s*\)\s*->\s*i32$/.test(normalized);
}

function isAllowedMentionFile(rel) {
  return allowedMentionFiles.some((re) => re.test(rel));
}

function isActiveImplementationPath(rel) {
  return /^(?:src|stdlib|hosts|data|examples|kits|bin)\//.test(rel);
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
