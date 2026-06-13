#!/usr/bin/env node

const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const failures = [];

const readonlyTablegroupFiles = [
  "src/parser.js",
  "src/verifier.js",
  "src/lower_wasm.js",
  "src/format.js",
  "src/diagnostics.js",
  "src/table_metadata.js",
  "src/conformance_report.js",
  "src/verification_evidence.js",
  "src/module_graph.js",
  "src/ai_review.js",
  "test/tablegroups.test.js"
];

const docs = [
  "docs/API_GATES_v0_37.md",
  "docs/FEATURE_STATUS_v0.37.md",
  "docs/V0_37_RELEASE_PLAN.md",
  "docs/rfcs/v0.37-readonly-tablegroups.md",
  "docs/rfcs/v0.37-tablegroups-decision-record.md"
];

function main() {
  runPriorGate();
  checkDocs();
  checkPackageScript();
  checkReadonlyBoundaries();
  checkNoAbiExpansion();

  if (failures.length) {
    console.error(failures.join("\n"));
    process.exit(1);
  }
  console.log("api gates v0.37: ok");
}

function runPriorGate() {
  const script = path.join(root, "scripts", "check_api_gates_v0_33.js");
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
    if (!fs.existsSync(path.join(root, rel))) failures.push(`${rel}: required v0.37 gate/status doc is missing`);
  }
  const status = read("docs/FEATURE_STATUS_v0.37.md");
  const release = read("docs/V0_37_RELEASE_PLAN.md");
  const gate = read("docs/API_GATES_v0_37.md");
  if (!/Readonly Tablegroups First Slice/.test(status)) failures.push("docs/FEATURE_STATUS_v0.37.md: expected readonly tablegroups status");
  if (!/Implemented\/P0/.test(status)) failures.push("docs/FEATURE_STATUS_v0.37.md: expected implemented P0 status");
  if (!/AIR ABI remains `0\.10`/.test(status + release + gate)) failures.push("v0.37 docs: AIR ABI must remain 0.10");
  if (!/Host ABI (?:unchanged|latest remains `0\.11`)/.test(status + release + gate)) failures.push("v0.37 docs: Host ABI must remain unchanged/0.11 bounded output.emit");
  if (!/readonly/i.test(status + release + gate) || !/fixed[- ]length|fixed length/i.test(status + release + gate) || !/scalar-only|scalar fields/i.test(status + release + gate)) {
    failures.push("v0.37 docs: tablegroups must remain readonly, fixed-length, and scalar-only");
  }
}

function checkPackageScript() {
  const pkg = JSON.parse(read("package.json"));
  if ((pkg.scripts || {})["check:api-gates:v0.37"] !== "node scripts/check_api_gates_v0_37.js") {
    failures.push("package.json: missing check:api-gates:v0.37 script");
  }
}

function checkReadonlyBoundaries() {
  for (const rel of readonlyTablegroupFiles) {
    const text = read(rel);
    if (/\b(?:declaredPool|declaredPools|slotGroup|slotGroups)\b/i.test(text) && rel !== "src/ai_review.js") {
      failures.push(`${rel}: declared pools remain outside v0.37 implementation`);
    }
    if (/["']0\.12["']/.test(text) && /\b(?:HOST_ABI|hostAbi|Host ABI)\b/.test(text)) {
      failures.push(`${rel}: Host ABI expansion is rejected in v0.37`);
    }
  }

  const lower = read("src/lower_wasm.js");
  if (/\btablegroup\.set\b/.test(lower) || /\btablegroup\.(?:json|object|method)\b/.test(lower)) {
    failures.push("src/lower_wasm.js: tablegroup lowering must stay readonly and scalar-only");
  }

  const verifier = read("src/verifier.js");
  if (!/\^tablegroup\\\.\(\?:set\|mut\|mutable\|push\|append\|store\)/.test(verifier) || !/readonly tablegroups cannot mutate/.test(verifier)) {
    failures.push("src/verifier.js: expected explicit tablegroup mutation rejection");
  }
  if (!/\^tablegroup\\\.\(\?:addr\|ptr\|pointer\|ref\|reference\|slice\|object\|json\|method\)/.test(verifier) || !/object\/JSON semantics/.test(verifier)) {
    failures.push("src/verifier.js: expected tablegroup object-model rejection path");
  }

  const tests = read("test/tablegroups.test.js");
  for (const expected of [
    "air.tablegroup.length_mismatch",
    "air.tablegroup.field_type_invalid",
    "air.tablegroup.index_out_of_bounds",
    "air.tablegroup.mutable_rejected",
    "air.tablegroup.object_model_rejected"
  ]) {
    if (!tests.includes(expected)) failures.push(`test/tablegroups.test.js: missing ${expected} coverage`);
  }
}

function checkNoAbiExpansion() {
  const files = listFiles(path.join(root, "src"))
    .concat(listFiles(path.join(root, "bin")))
    .map((file) => path.relative(root, file).split(path.sep).join("/"))
    .filter((rel) => /\.(?:js|json|air|wit)$/.test(rel));

  for (const rel of files) {
    const text = read(rel);
    if (/\b(?:draw_actor|draw_contra_enemy|platformerWater|bossProjectile)\b/.test(text) && rel !== "src/surface.js") {
      failures.push(`${rel}: demo-specific platformer APIs are rejected in v0.37 Core`);
    }
    if (/\b(?:hostObject|hostHandle|host_object_handle)\b/.test(text) && !["src/types.js", "src/sdk.js", "src/surface.js", "src/mock_host_policy.js", "src/command_buffer_schema.js"].includes(rel)) {
      failures.push(`${rel}: host object handles are rejected in active Core implementation`);
    }
  }
}

function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist" || entry.name === "build") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

main();
