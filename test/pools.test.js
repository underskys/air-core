#!/usr/bin/env node

const assert = require("assert");
const cp = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { parseAir } = require("../src/parser");
const { verifyModule, collectEffectUsage } = require("../src/verifier");
const { formatModule } = require("../src/format");
const { createFileLspDiagnostics } = require("../src/lsp_diagnostics");
const { createConformanceReport } = require("../src/conformance_report");
const { lowerToWat, watToWasm } = require("../src/lower_wasm");
const { AIR_ABI_VERSION } = require("../src/version");
const { HOST_ABI_VERSION } = require("../src/package_manifest");

const root = path.resolve(__dirname, "..");
const airc = path.join(root, "bin", "airc.js");

function runAirc(args, options = {}) {
  return cp.execFileSync(process.execPath, [airc, ...args], {
    cwd: root,
    encoding: "utf8",
    ...options
  });
}

function diagnosticsFor(source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "air-pool-"));
  const file = path.join(dir, "main.air");
  fs.writeFileSync(file, source);
  return createFileLspDiagnostics(file).diagnostics;
}

function assertDiagnostic(source, code) {
  const diagnostics = diagnosticsFor(source);
  assert(
    diagnostics.some((diagnostic) => diagnostic.code === code),
    `expected ${code}, got ${diagnostics.map((diagnostic) => diagnostic.code).join(", ")}`
  );
  return diagnostics.find((diagnostic) => diagnostic.code === code);
}

async function instantiate(source) {
  const mod = parseAir(source, "<pool-test>");
  verifyModule(mod);
  const wasm = await watToWasm(lowerToWat(mod), "<pool-test>");
  const result = await WebAssembly.instantiate(wasm, {});
  return { mod, instance: result.instance || result };
}

function writePackage(dir, source, options = {}) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "main.air"), source);
  fs.writeFileSync(path.join(dir, "module.wasm"), "placeholder wasm for pool report package\n");
  fs.writeFileSync(path.join(dir, "air.package.json"), JSON.stringify({
    name: options.name || "declared-pool-package",
    version: "0.1.0",
    airAbi: "0.10",
    hostAbi: "0.10",
    entry: "main.air",
    wasm: "module.wasm",
    capabilities: [],
    targetProfiles: ["cli"],
    manifests: {}
  }, null, 2));
}

(async () => {
  const source = `module pool_demo
pool projectiles capacity 8 {
  active:bool = false
  x:i32 = 0
  y:i32 = 0
  vx:i32 = 0
  vy:i32 = 0
}
capabilities { }

export func capacity() -> i32 {
entry:
  %cap:i32 = pool.capacity @projectiles
  return %cap
}

export func write_x(index: i32, value: i32) -> i32 {
entry:
  pool.set.i32 @projectiles.x, %index, %value
  %v:i32 = pool.get.i32 @projectiles.x, %index
  return %v
}

export func activate(index: i32) -> bool {
entry:
  pool.set.bool @projectiles.active, %index, true
  %a:bool = pool.get.bool @projectiles.active, %index
  return %a
}
`;

  const { mod, instance } = await instantiate(source);
  assert.strictEqual(instance.exports.capacity(), 8);
  assert.strictEqual(instance.exports.write_x(2, 42), 42);
  assert.strictEqual(instance.exports.activate(2), 1);
  assert.throws(() => instance.exports.write_x(8, 1), /unreachable|RuntimeError/);

  assert.deepStrictEqual(mod.pools.map((pool) => ({
    name: pool.name,
    capacity: pool.capacity,
    activeField: pool.activeField,
    fields: pool.fields.map((field) => ({ name: field.name, type: field.type }))
  })), [{
    name: "projectiles",
    capacity: 8,
    activeField: "active",
    fields: [
      { name: "active", type: "bool" },
      { name: "x", type: "i32" },
      { name: "y", type: "i32" },
      { name: "vx", type: "i32" },
      { name: "vy", type: "i32" }
    ]
  }]);

  const formatted = formatModule(mod);
  assert.match(formatted, /pool projectiles capacity 8 \{/);
  assert.match(formatted, /  active:bool = false/);
  assert.match(formatted, /%cap:i32 = pool\.capacity @projectiles/);
  assert.match(formatted, /pool\.set\.i32 @projectiles\.x, %index, %value/);
  assert.strictEqual(formatModule(parseAir(formatted, "<pool-formatted>")), formatted);

  const usage = collectEffectUsage(mod);
  assert.strictEqual(usage.get("pool.read"), 2);
  assert.strictEqual(usage.get("pool.write"), 2);
  assert.strictEqual(usage.get("pool.static_bytes"), 160);

  const wat = lowerToWat(mod);
  assert(!wat.includes("(import \"pool\""), "pools must not add host imports");

  const report = createConformanceReport(mod);
  assert.deepStrictEqual(report.poolSummary, {
    count: 1,
    names: ["projectiles"],
    totalStaticBytes: 160
  });
  assert.strictEqual(report.pools[0].name, "projectiles");
  assert.strictEqual(report.pools[0].capacity, 8);
  assert.strictEqual(report.pools[0].activeField, "active");
  assert.strictEqual(report.pools[0].storageFootprint, 160);
  assert.strictEqual(report.pools[0].moduleObservedReads, 2);
  assert.strictEqual(report.pools[0].moduleObservedWrites, 2);
  assert.strictEqual(report.pools[0].fields.length, 5);

  assertDiagnostic(`module bad_pool_missing_active
pool projectiles capacity 1 {
  x:i32 = 0
}
capabilities { }
`, "air.pool.active_flag_missing");

  assertDiagnostic(`module bad_pool_capacity
pool projectiles capacity N {
  active:bool = false
}
capabilities { }
`, "air.pool.dynamic_capacity_rejected");

  assertDiagnostic(`module bad_pool_type
pool projectiles capacity 1 {
  active:bool = false
  label:string = "secret"
}
capabilities { }
`, "air.pool.field_type_invalid");

  assertDiagnostic(`module bad_pool_unknown
pool projectiles capacity 1 {
  active:bool = false
}
capabilities { }

export func run() -> i32 {
entry:
  %v:i32 = pool.get.i32 @missing.x, 0
  return %v
}
`, "air.pool.unknown_pool");

  assertDiagnostic(`module bad_pool_field
pool projectiles capacity 1 {
  active:bool = false
}
capabilities { }

export func run() -> i32 {
entry:
  %v:i32 = pool.get.i32 @projectiles.x, 0
  return %v
}
`, "air.pool.unknown_field");

  assertDiagnostic(`module bad_pool_oob
pool projectiles capacity 1 {
  active:bool = false
  x:i32 = 0
}
capabilities { }

export func run() -> i32 {
entry:
  %v:i32 = pool.get.i32 @projectiles.x, 1
  return %v
}
`, "air.pool.index_out_of_bounds");

  assertDiagnostic(`module bad_pool_pointer
pool projectiles capacity 1 {
  active:bool = false
}
capabilities { }

export func run() -> i32 {
entry:
  %v:i32 = pool.slice @projectiles
  return %v
}
`, "air.pool.pointer_escape");

  assertDiagnostic(`module bad_pool_object
pool projectiles capacity 1 {
  active:bool = false
}
capabilities { }

export func run() -> i32 {
entry:
  %v:i32 = pool.json @projectiles
  return %v
}
`, "air.pool.object_model_rejected");

  assertDiagnostic(`module bad_pool_op
pool projectiles capacity 1 {
  active:bool = false
}
capabilities { }

export func run() -> i32 {
entry:
  pool.allocate @projectiles
  return 0
}
`, "air.pool.invalid");

  const packageDir = path.join(root, "test", "fixtures", "pools", "projectile_pool_basic");
  const packageReport = JSON.parse(runAirc(["report", "package", packageDir, "--json"]));
  assert.strictEqual(packageReport.status, "pass");
  assert.strictEqual(packageReport.pools.length, 1);
  assert.strictEqual(packageReport.pools[0].name, "projectiles");
  assert.strictEqual(packageReport.pools[0].capacity, 8);
  assert.strictEqual(packageReport.modules[0].pools[0].fields.length, 5);

  const evidence = JSON.parse(runAirc(["verify", "package", packageDir, "--profile", "cli", "--json"]));
  assert.strictEqual(evidence.status, "passed");
  assert.strictEqual(evidence.airAbi, "0.10");
  assert.strictEqual(evidence.hostAbi, "0.10");
  assert.strictEqual(evidence.pools.length, 1);
  assert.strictEqual(evidence.pools[0].name, "projectiles");
  assert.strictEqual(evidence.modules[0].pools[0].name, "projectiles");

  const oldDir = fs.mkdtempSync(path.join(os.tmpdir(), "air-pool-old-"));
  const newDir = fs.mkdtempSync(path.join(os.tmpdir(), "air-pool-new-"));
  writePackage(oldDir, source);
  writePackage(newDir, source.replace("capacity 8", "capacity 4"));
  const diff = JSON.parse(runAirc(["diff", "package", oldDir, newDir, "--json"]));
  assert.strictEqual(diff.status, "changed");
  assert.strictEqual(diff.poolDelta.changed, true);
  assert.strictEqual(diff.poolDelta.changedItems[0].old.capacity, 8);
  assert.strictEqual(diff.poolDelta.changedItems[0].new.capacity, 4);

  assert.strictEqual(AIR_ABI_VERSION, "0.10");
  assert.strictEqual(HOST_ABI_VERSION, "0.10");

  console.log("declared pool tests passed");
})().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
