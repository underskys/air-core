#!/usr/bin/env node

const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const failures = [];

const docs = [
  "docs/API_GATES_v0_40.md",
  "docs/FEATURE_STATUS_v0.40.md",
  "docs/V0_40_RELEASE_PLAN.md",
  "docs/rfcs/v0.40-declared-fixed-capacity-pools.md"
];

const implementationRoots = ["src", "bin", "spec"];

function main() {
  runPriorGate();
  checkDocs();
  checkPackageScript();
  checkRunRcChecks();
  checkNoRejectedRuntimeOrHostSurface();
  checkNoAbiExpansion();

  if (failures.length) {
    console.error(failures.join("\n"));
    process.exit(1);
  }
  console.log("api gates v0.40: ok");
}

function runPriorGate() {
  const script = path.join(root, "scripts", "check_api_gates_v0_39.js");
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
    if (!fs.existsSync(path.join(root, rel))) failures.push(`${rel}: required v0.40 gate/status doc is missing`);
  }

  const status = read("docs/FEATURE_STATUS_v0.40.md");
  const release = read("docs/V0_40_RELEASE_PLAN.md");
  const gate = read("docs/API_GATES_v0_40.md");
  const rfc = read("docs/rfcs/v0.40-declared-fixed-capacity-pools.md");
  const combined = `${status}\n${release}\n${gate}\n${rfc}`;

  for (const expected of [
    "Declared Fixed-Capacity Pools",
    "docs/RFC/gates",
    "No pool implementation is accepted in v0.40",
    "implemented",
    "fixed capacity",
    "scalar fields",
    "generated pool handles/bindings are derived artifacts",
    "pool declaration is source of truth"
  ]) {
    if (!combined.includes(expected)) failures.push(`v0.40 docs: expected ${expected}`);
  }

  for (const rejected of [
    /runtime JSON/i,
    /dynamic maps/i,
    /heap\/GC|GC/i,
    /host object handles/i,
    /platformer-specific|game-specific/i
  ]) {
    if (!rejected.test(combined)) failures.push(`v0.40 docs: missing rejected boundary ${rejected}`);
  }

  if (!/AIR ABI remains `0\.10`/.test(combined)) failures.push("v0.40 docs: AIR ABI must remain 0.10");
  if (!/Host ABI (?:unchanged|latest remains `0\.11`)/.test(combined)) failures.push("v0.40 docs: Host ABI must remain unchanged/0.11 bounded output.emit");
}

function checkPackageScript() {
  const pkg = JSON.parse(read("package.json"));
  if ((pkg.scripts || {})["check:api-gates:v0.40"] !== "node scripts/check_api_gates_v0_40.js") {
    failures.push("package.json: missing check:api-gates:v0.40 script");
  }
}

function checkRunRcChecks() {
  const text = read("scripts/run_rc_checks.sh");
  if (!text.includes("npm run check:api-gates:v0.40")) {
    failures.push("scripts/run_rc_checks.sh: v0.40 API gate must run during RC checks");
  }
}

function checkNoRejectedRuntimeOrHostSurface() {
  const files = listRelevantFiles();
  for (const rel of files) {
    if (rel.startsWith("docs/") || rel.startsWith("spec/")) continue;
    const text = read(rel);
    const activeImplementationRel = rel.startsWith("src/") || rel.startsWith("bin/");
    if (/\b(?:draw_actor|draw_contra_enemy|platformerWater|bossProjectile|bulletHell|projectilePoolApi|enemyPoolApi)\b/.test(text)) {
      if (rel !== "src/surface.js") failures.push(`${rel}: platformer/game-specific Core APIs are rejected in v0.40`);
    }
    if (activeImplementationRel && /\b(?:hostObject|hostHandle|host_object_handle)\b/.test(text) && !["src/types.js", "src/sdk.js", "src/surface.js", "src/mock_host_policy.js", "src/command_buffer_schema.js"].includes(rel)) {
      failures.push(`${rel}: host object handles are rejected in active Core implementation`);
    }
    if (/\b(?:dynamicMapPool|poolDynamicMap|poolDictionary|poolDict|slotGroupDictionary|dynamicPoolMap)\b/i.test(text)) {
      failures.push(`${rel}: dynamic maps/dictionaries are rejected for v0.40 pool scope`);
    }
    if (/\b(?:runtimeJsonPool|jsonPool|objectPool|gcPool|heapPool|dynamicCapacityPool)\b/i.test(text)) {
      failures.push(`${rel}: runtime JSON/object/GC/dynamic-capacity pool implementation is rejected`);
    }
    if (/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/.test(text) || /\brequire\(["'](?:http|https|net|tls|dns|dgram)["']\)/.test(text)) {
      failures.push(`${rel}: raw host/network authority is rejected in v0.40`);
    }
  }
}

function checkNoAbiExpansion() {
  const version = read("src/version.js");
  if (!/AIR_ABI_VERSION\s*=\s*["']0\.10["']/.test(version)) failures.push("src/version.js: AIR ABI must remain 0.10");
  const manifest = read("src/package_manifest.js");
  if (!/HOST_ABI_VERSION\s*=\s*["']0\.10["']/.test(manifest)) failures.push("src/package_manifest.js: Host ABI baseline/default must remain 0.10");

  for (const rel of listRelevantFiles()) {
    if (rel.startsWith("docs/") || rel.startsWith("spec/")) continue;
    const text = read(rel);
    if (/["']0\.12["']/.test(text) && /\b(?:HOST_ABI|hostAbi|Host ABI)\b/.test(text)) {
      failures.push(`${rel}: Host ABI expansion is rejected in v0.40`);
    }
    if (/AIR_ABI_VERSION\s*=\s*["'](?!0\.10)/.test(text)) {
      failures.push(`${rel}: AIR ABI expansion is rejected in v0.40`);
    }
  }
}

function listRelevantFiles() {
  const files = [];
  for (const rel of implementationRoots) {
    files.push(...listFiles(path.join(root, rel)));
  }
  for (const rel of [
    "package.json",
    "scripts/run_rc_checks.sh",
    "docs/V0_40_RELEASE_PLAN.md",
    "docs/FEATURE_STATUS_v0.40.md",
    "docs/rfcs/v0.40-declared-fixed-capacity-pools.md",
    "docs/API_GATES_v0_40.md"
  ]) {
    const full = path.join(root, rel);
    if (fs.existsSync(full)) files.push(full);
  }
  return files
    .map((file) => path.relative(root, file).split(path.sep).join("/"))
    .filter((rel) => /\.(?:js|json|air|wit|md|sh)$/.test(rel))
    .sort();
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
