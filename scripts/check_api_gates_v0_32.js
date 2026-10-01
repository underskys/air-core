#!/usr/bin/env node

const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");
const { declaresHostAbi012, hostAbiDetectorInvariants } = require("./api_gate_detection");

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
  "bin"
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

const allowedRuntimeJsonRejectors = new Set([
  "src/ai_authoring_eval.js",
  "src/command_buffer_schema.js",
  "src/conformance_replay.js",
  "src/airpkg.js",
  "src/evidence_report.js",
  "src/e2e_proof.js",
  "src/facts_schema.js",
  "src/package_diff.js",
  "src/package_manifest.js",
  "src/mock_host_policy.js",
  "src/package_graph_ownership.js",
  "src/sdk.js",
  "src/structured_io_schema.js",
  "src/surface.js",
  "src/verification_evidence.js",
  "src/verified_execution_session.js",
  "src/verifier_safety_fuzz.js"
]);

const acceptedImplementationFiles = new Set([
  "src/structured_io_schema.js",
  "src/sdk.js",
  "src/package_manifest.js",
  "src/package_diff.js",
  "src/evidence_report.js",
  "src/verification_evidence.js",
  "src/conformance_replay.js",
  "src/verifier_safety_fuzz.js",
  "bin/airc.js"
]);

// Ownership metadata may name structured IO/tablegroup owners in reports without
// implementing runtime structured IO, tablegroups, or declared pools.
const acceptedOwnershipMetadataFiles = new Set([
  "src/package_graph_ownership.js"
]);

const acceptedV049StructuredIoConsumers = new Set([
  "src/provenance_flow.js",
  "src/run_package.js",
  "src/semantic_patch.js"
]);

const acceptedV037TablegroupFiles = new Set([
  "src/ai_review.js",
  "src/conformance_report.js",
  "src/diagnostics.js",
  "src/format.js",
  "src/lower_wasm.js",
  "src/module_graph.js",
  "src/parser.js",
  "src/sdk.js",
  "src/table_metadata.js",
  "src/verification_evidence.js",
  "src/verifier.js",
  "test/tablegroups.test.js"
]);

const existingAuthorityMetadataFiles = new Set([
  "src/gfx_manifest.js",
  "src/types.js"
]);

function main() {
  runPriorGate();
  checkDetectorInvariants();

  const files = scanRoots.flatMap((dir) => listFiles(path.join(root, dir)));
  for (const file of files) {
    const rel = normalize(path.relative(root, file));
    if (!textExtensions.has(path.extname(file))) continue;
    const text = fs.readFileSync(file, "utf8");
    checkRuntimeObjectDrift(rel, text);
    checkTablegroupsAndPools(rel, text);
    checkStructuredIoSourceOfTruth(rel, text);
    checkHostExpansion(rel, text);
    checkRawAuthority(rel, text);
  }

  if (failures.length) {
    console.error(failures.join("\n"));
    process.exit(1);
  }
  console.log(`api gates v0.32: ok (${files.length} file(s) scanned)`);
}

function runPriorGate() {
  const script = path.join(root, "scripts", "check_api_gates_v0_28.js");
  const result = childProcess.spawnSync(process.execPath, [script], {
    cwd: root,
    encoding: "utf8"
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) process.exit(result.status || 1);
}

function checkRuntimeObjectDrift(rel, text) {
  if (!isActiveImplementationPath(rel)) return;
  if (/^(?:hosts|examples|kits)\//.test(rel)) return;
  if (path.extname(rel) === ".md") return;
  if (allowedRuntimeJsonRejectors.has(rel)) return;
  if (acceptedV049StructuredIoConsumers.has(rel)) return;
  if (v037TablegroupsAccepted() && acceptedV037TablegroupFiles.has(rel)) return;
  if (/(?:^|[,{]\s*)["']?(?:runtimeJson|jsonObject|jsonValue|dynamicMap|objectFields|objectModel|hostObject|hostHandle)["']?\s*:/.test(text)) {
    failures.push(`${rel}: runtime JSON/object/dynamic-map/host-object fields are rejected in v0.32 Core`);
  }
  if (hasStructuredIoRuntimeJson(rel, text)) {
    failures.push(`${rel}: structured IO first slice must not introduce runtime JSON parsing/serialization semantics`);
  }
}

function checkTablegroupsAndPools(rel, text) {
  if (!isActiveImplementationPath(rel)) return;
  if (path.extname(rel) === ".md" || path.extname(rel) === ".json") return;
  if (allowedRuntimeJsonRejectors.has(rel)) return;
  if (v037TablegroupsAccepted() && acceptedV037TablegroupFiles.has(rel)) {
    if (/\b(?:declaredPool|declaredPools|slotGroup|slotGroups)\b/i.test(text)) {
      failures.push(`${rel}: declared pools remain deferred after v0.32`);
    }
    return;
  }
  if (/\b(?:tablegroup|tablegroups|declaredPool|declaredPools|slotGroup|slotGroups)\b/i.test(text)) {
    failures.push(`${rel}: tablegroups and declared pools remain deferred in v0.32 implementation`);
  }
}

function checkStructuredIoSourceOfTruth(rel, text) {
  if (!isActiveImplementationPath(rel)) return;
  const implementationText = withoutAcceptedManifestMetadata(rel, text);
  if (!/\bstructuredIO\b/.test(implementationText)) return;
  if (!acceptedImplementationFiles.has(rel) && !acceptedOwnershipMetadataFiles.has(rel) && !acceptedV049StructuredIoConsumers.has(rel) && !isAcceptedStructuredIoConsumer(rel)) {
    failures.push(`${rel}: structured IO implementation surface is outside the accepted v0.32 first-slice files`);
  }
  if (/\b(?:generatedBindingsAreSourceOfTruth|generatedArtifactsAreSourceOfTruth|sourceOfTruth\s*:\s*["']generated)/.test(implementationText)) {
    failures.push(`${rel}: generated structured IO bindings must remain derived artifacts, not source of truth`);
  }
}

function checkHostExpansion(rel, text) {
  if (!isActiveImplementationPath(rel)) return;
  if (declaresHostAbi012(text)) {
    failures.push(`${rel}: Host ABI expansion beyond bounded output.emit is rejected in v0.32`);
  }
  if (/\b(?:output\.event|audio\.event|effect\.event|effect_event)\b/.test(text) && !allowedRuntimeJsonRejectors.has(rel)) {
    failures.push(`${rel}: output/audio/effect event APIs remain rejected in v0.32 implementation`);
  }
}

function hasStructuredIoRuntimeJson(rel, text) {
  const implementationText = withoutAcceptedManifestMetadata(rel, text);
  return /\b(?:JSON\.parse|JSON\.stringify)\b/.test(implementationText) &&
    /\b(?:structuredIO|rowset|tablegroup|pool)\b/i.test(implementationText);
}

function withoutAcceptedManifestMetadata(rel, text) {
  if (rel !== "src/typed_interface.js") return text;
  let insideCandidateKeys = false;
  return text.split("\n").map((line) => {
    if (/^const CANDIDATE_MANIFEST_KEYS = new Set\(\[$/.test(line)) insideCandidateKeys = true;
    const normalized = insideCandidateKeys
      ? line.replace(/(["'])structuredIO\1\s*,?/, "")
      : line;
    if (insideCandidateKeys && /^\]\);$/.test(line)) insideCandidateKeys = false;
    return normalized;
  }).join("\n");
}

function checkDetectorInvariants() {
  const checks = [
    [
      hasStructuredIoRuntimeJson("src/example.js", "const structuredIO = JSON.parse(input);"),
      "structured IO JSON detector must reject an implementation surface"
    ],
    [
      !hasStructuredIoRuntimeJson("src/example.js", "const record = JSON.parse(input);"),
      "canonical record JSON must not be classified as structured IO by name alone"
    ],
    [
      !hasStructuredIoRuntimeJson("src/typed_interface.js", "const CANDIDATE_MANIFEST_KEYS = new Set([\n  \"structuredIO\",\n]);\nconst value = JSON.parse(input);"),
      "the legacy manifest key must remain metadata rather than an implementation surface"
    ],
    ...hostAbiDetectorInvariants()
  ];
  for (const [passed, message] of checks) {
    if (!passed) failures.push(`scripts/check_api_gates_v0_32.js: detector invariant failed: ${message}`);
  }
}

function checkRawAuthority(rel, text) {
  if (!isAirPublicSurfacePath(rel)) return;
  if (path.extname(rel) === ".md") return;
  if (/^(?:hosts|examples|kits)\//.test(rel)) return;
  if (existingAuthorityMetadataFiles.has(rel)) return;
  if (allowedRuntimeJsonRejectors.has(rel)) return;
  if (/\b(?:chrome\.|document\.(?:body|cookie|createElement|getElementById|querySelector|write)|window\.|indexedDB|localStorage|sessionStorage|fetch|XMLHttpRequest|React|DOM|Canvas|ImageData|AWS|Azure|GCP|Postgres|Kubernetes|kubectl|docker|jira)\b/i.test(text)) {
    failures.push(`${rel}: raw platform authority is not allowed in active AIR Core/API paths`);
  }
}

function isActiveImplementationPath(rel) {
  return /^(?:src|stdlib|hosts|data|examples|kits|bin)\//.test(rel);
}

function isAirPublicSurfacePath(rel) {
  return /^(?:src|stdlib|data|examples|kits|bin)\//.test(rel);
}

function isAcceptedStructuredIoConsumer(rel) {
  return rel.startsWith("examples/lan_observer_readonly_package/");
}

function v037TablegroupsAccepted() {
  return fs.existsSync(path.join(root, "docs", "FEATURE_STATUS_v0.37.md")) &&
    /Readonly Tablegroups First Slice/.test(fs.readFileSync(path.join(root, "docs", "FEATURE_STATUS_v0.37.md"), "utf8")) &&
    /Implemented\/P0/.test(fs.readFileSync(path.join(root, "docs", "FEATURE_STATUS_v0.37.md"), "utf8"));
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
