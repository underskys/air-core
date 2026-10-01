#!/usr/bin/env node

const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");
const { declaresHostAbi012 } = require("./api_gate_detection");

const root = path.resolve(__dirname, "..");
const failures = [];

const docs = [
  "docs/API_GATES_v0_41.md",
  "docs/FEATURE_STATUS_v0.41.md",
  "docs/V0_41_RELEASE_PLAN.md",
  "docs/rfcs/v0.41-declared-pools-first-slice.md"
];

const activeRoots = ["src", "bin", "spec"];
const docsAllowlistPrefixes = ["docs/", "README.md", "CHANGELOG.md"];
const acceptedV049PoolAnalysisFiles = new Set([
  "src/provenance_flow.js"
]);

const acceptedPoolOps = new Set([
  "pool.capacity",
  "pool.get.i32",
  "pool.get.bool",
  "pool.set.i32",
  "pool.set.bool"
]);

const rejectedPoolOps = [
  "pool.spawn",
  "pool.free",
  "pool.find_inactive",
  "pool.clear",
  "pool.iter"
];

function main() {
  runPriorGate();
  checkDocs();
  checkPackageScript();
  checkRunRcChecks();
  checkActiveImplementationBoundaries();
  checkNoAbiExpansion();

  if (failures.length) {
    console.error(failures.join("\n"));
    process.exit(1);
  }
  console.log("api gates v0.41: ok");
}

function runPriorGate() {
  const script = path.join(root, "scripts", "check_api_gates_v0_40.js");
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
    if (!fs.existsSync(path.join(root, rel))) failures.push(`${rel}: required v0.41 gate/status doc is missing`);
  }

  const status = read("docs/FEATURE_STATUS_v0.41.md");
  const release = read("docs/V0_41_RELEASE_PLAN.md");
  const gate = read("docs/API_GATES_v0_41.md");
  const rfc = read("docs/rfcs/v0.41-declared-pools-first-slice.md");
  const combined = `${status}\n${release}\n${gate}\n${rfc}`;

  for (const expected of [
    "Declared Fixed-Capacity Pools First Slice",
    "pool projectiles capacity 8",
    "active:bool",
    "pool.capacity",
    "pool.get.i32",
    "pool.get.bool",
    "pool.set.i32",
    "pool.set.bool",
    "implemented first slice",
    "AIR ABI remains `0.10`",
    "Host ABI"
  ]) {
    if (!combined.includes(expected)) failures.push(`v0.41 docs: expected ${expected}`);
  }

  for (const rejected of [
    /pool\.spawn/,
    /pool\.free/,
    /pool\.find_inactive/,
    /dynamic capacity/i,
    /heap\/GC|GC/i,
    /runtime JSON\/object model|runtime JSON/i,
    /host object handles/i,
    /Host ABI expansion/i
  ]) {
    if (!rejected.test(combined)) failures.push(`v0.41 docs: missing rejected/deferred boundary ${rejected}`);
  }
}

function checkPackageScript() {
  const pkg = JSON.parse(read("package.json"));
  if ((pkg.scripts || {})["check:api-gates:v0.41"] !== "node scripts/check_api_gates_v0_41.js") {
    failures.push("package.json: missing check:api-gates:v0.41 script");
  }
}

function checkRunRcChecks() {
  const text = read("scripts/run_rc_checks.sh");
  if (!text.includes("npm run check:api-gates:v0.41")) {
    failures.push("scripts/run_rc_checks.sh: v0.41 API gate must run during RC checks");
  }
}

function checkActiveImplementationBoundaries() {
  for (const rel of listRelevantFiles()) {
    const text = read(rel);
    const isDocs = docsAllowlistPrefixes.some((prefix) => rel === prefix.replace(/\/$/, "") || rel.startsWith(prefix));

    if (!isDocs) {
      for (const op of rejectedPoolOps) {
        if (text.includes(op)) failures.push(`${rel}: ${op} is deferred and rejected in active v0.41 implementation`);
      }

      for (const match of text.matchAll(/\bpool\.(?:get|set)\.[A-Za-z_][A-Za-z0-9_]*/g)) {
        const op = match[0];
        if (acceptedPoolOps.has(op)) continue;
        failures.push(`${rel}: only pool.get.i32/pool.get.bool and pool.set.i32/pool.set.bool are accepted in v0.41, found ${op}`);
      }

      if (/\b(?:dynamicPoolCapacity|poolCapacityExpr|poolCapacityFrom|capacityFromValue|capacityParam)\b/.test(text)) {
        failures.push(`${rel}: dynamic pool capacity is rejected in v0.41`);
      }
      if (/\b(?:poolFieldType|poolFieldTypes|allowedPoolFieldTypes)\b[\s\S]{0,200}\b(?:string|str|slice|ptr|map|object|json|any|record|struct)\b/i.test(text)) {
        failures.push(`${rel}: pool field types must stay i32/bool only`);
      }
      if (/\b(?:hostVisiblePoolLayout|poolHostLayout|hostPoolLayout|exportPoolLayout|poolLayoutContract)\b/i.test(text)) {
        failures.push(`${rel}: host-visible pool layout contract is rejected`);
      }
      if (!acceptedV049PoolAnalysisFiles.has(rel) && /\b(?:poolPointer|poolSlice|poolReference|poolRef|poolAddress|slotPointer|slotReference|slotAddress)\b/i.test(text)) {
        failures.push(`${rel}: pool pointer/slice/reference escape is rejected`);
      }
      if (/\b(?:poolObject|objectPool|jsonPool|mapPool|gcPool|heapPool|poolDict|poolDictionary)\b/i.test(text)) {
        failures.push(`${rel}: runtime JSON/object/map/GC pool implementation is rejected`);
      }
      if (/\btablegroup\.(?:set|mut|mutable|push|append|store)\b/.test(text)) {
        failures.push(`${rel}: tablegroup mutation remains rejected`);
      }
      if (/\b(?:draw_actor|draw_contra_enemy|platformerWater|bossProjectile|bulletHell|projectilePoolApi|enemyPoolApi)\b/.test(text)) {
        if (rel !== "src/surface.js") failures.push(`${rel}: platformer/game-specific Core APIs are rejected`);
      }
      if (/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/.test(text) || /\brequire\(["'](?:http|https|net|tls|dns|dgram)["']\)/.test(text)) {
        failures.push(`${rel}: raw host/network authority is rejected`);
      }
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
    if (declaresHostAbi012(text)) {
      failures.push(`${rel}: Host ABI expansion is rejected in v0.41`);
    }
    if (/(?:^|[^A-Za-z0-9_])AIR_ABI_VERSION\s*=\s*["'](?!0\.10)/.test(text)) {
      failures.push(`${rel}: AIR ABI expansion is rejected in v0.41`);
    }
  }
}

function listRelevantFiles() {
  const files = [];
  for (const rel of activeRoots) {
    files.push(...listFiles(path.join(root, rel)));
  }
  for (const rel of [
    "package.json",
    "scripts/run_rc_checks.sh",
    "docs/V0_41_RELEASE_PLAN.md",
    "docs/FEATURE_STATUS_v0.41.md",
    "docs/rfcs/v0.41-declared-pools-first-slice.md",
    "docs/API_GATES_v0_41.md"
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
