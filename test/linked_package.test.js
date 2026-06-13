#!/usr/bin/env node

const assert = require("assert");
const cp = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const airc = path.join(root, "bin", "airc.js");
const packageCompositionFixtures = path.join(root, "test", "fixtures", "package_composition");
const tmp = path.join(root, "build", "linked-package-tests");

function run(args) {
  return cp.execFileSync(process.execPath, [airc, ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function runFails(args) {
  const result = cp.spawnSync(process.execPath, [airc, ...args], {
    cwd: root,
    encoding: "utf8"
  });
  assert.notStrictEqual(result.status, 0, `expected failure: ${args.join(" ")}`);
  return result;
}

function writePackage(dir, files, manifest = {}) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const [relative, source] of Object.entries(files)) {
    const file = path.join(dir, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, source);
  }
  fs.writeFileSync(path.join(dir, "air.package.json"), JSON.stringify({
    name: path.basename(dir).replace(/[^a-z0-9._-]/gi, "-").toLowerCase(),
    version: "0.1.0",
    airAbi: "0.10",
    hostAbi: "0.10",
    entry: "main.air",
    capabilities: [],
    targetProfiles: ["cli"],
    ...manifest
  }, null, 2));
}

function buildPackage(dir, name = "out.wasm", profile = "cli") {
  const out = path.join(tmp, name);
  run(["build", "package", dir, "--linked-wasm", "--profile", profile, "-o", out]);
  const sidecar = JSON.parse(fs.readFileSync(`${out}.link.json`, "utf8"));
  return { out, sidecar, bytes: fs.readFileSync(out) };
}

function assertNoAbsolutePaths(value) {
  const text = JSON.stringify(value);
  assert(!text.includes(root), "linked package report must not contain repository absolute path");
  assert(!/\"[A-Za-z]:[\\/]/.test(text), "linked package report must not contain Windows absolute path");
}

function assertNoTimestamps(value) {
  const text = JSON.stringify(value);
  assert(!/20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z/.test(text), "linked package report must not contain timestamps");
}

function wasmSafe(name) {
  return String(name || "symbol").replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+/, "_") || "_symbol";
}

async function instantiateRun(wasmPath, imports = {}, arg = 41) {
  const bytes = fs.readFileSync(wasmPath);
  const instance = await WebAssembly.instantiate(bytes, imports);
  return instance.instance.exports.run(arg);
}

(async () => {
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });

  const valid = path.join(root, "test", "fixtures", "package_graph", "valid");
  const first = buildPackage(valid, "valid-a.wasm", "browser-webgpu");
  const second = buildPackage(valid, "valid-b.wasm", "browser-webgpu");
  assert.strictEqual(first.bytes.toString("hex"), second.bytes.toString("hex"));
  assert.strictEqual(first.sidecar.schemaVersion, "0.16");
  assert.strictEqual(first.sidecar.kind, "air.linkedPackageBuild");
  assert.strictEqual(first.sidecar.linkedWasm, true);
  assert.strictEqual(first.sidecar.linkedOutput.available, true);
  assert.strictEqual(first.sidecar.linkedOutput.kind, "wasm");
  assert.match(first.sidecar.linkedOutput.watHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(first.sidecar.linkedOutput.wasmHash, /^sha256:[a-f0-9]{64}$/);
  assert.strictEqual(first.sidecar.status, "warn");
  assert(first.sidecar.diagnostics.diagnostics.some((item) => item.code === "air.package.implicit_package_exports"));
  assert.match(first.sidecar.linkPlanHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(first.sidecar.linkedWasmHash, /^sha256:[a-f0-9]{64}$/);
  assert.strictEqual(first.sidecar.abiImpact.airAbi, "0.10");
  assert.strictEqual(first.sidecar.abiImpact.airAbiBumpRequired, false);
  assert.strictEqual(first.sidecar.abiImpact.hostAbi, "0.10");
  assert.strictEqual(first.sidecar.abiImpact.hostAbiBumpRequired, false);
  assert(!/metadata-only/i.test(first.sidecar.abiImpact.rationale));
  assert.match(first.sidecar.abiImpact.rationale, /existing AIR ABI 0\.10 scalar Wasm import\/export\/memory conventions/);
  assert.deepStrictEqual(first.sidecar.packageExports.map((item) => item.name), ["run"]);
  assert(first.sidecar.packageExports.every((item) => item.targetWasmName && item.targetWasmName === wasmSafe(item.targetSymbol)));
  assert(first.sidecar.graph.edges.some((edge) => edge.from === "main.air" && edge.to === "math.air"));
  assert(first.sidecar.crossModuleCalls.some((edge) => edge.fromModule === "main.air" && edge.toModule === "math.air" && edge.toFunction === "add_one"));
  assert.deepStrictEqual(first.sidecar.hostImports.used, ["debug.metric"]);
  assert(first.sidecar.staticTables.some((table) => table.module === "math.air" && table.name === "offsets"));
  assert.strictEqual(first.sidecar.authoredGraph.kind, "air.authoredPackageGraph");
  assert.strictEqual(first.sidecar.executableGraph.kind, "air.executablePackageGraph");
  assert(first.sidecar.authoredToExecutable.some((item) => item.kind === "module" && item.authoredModule === "main.air"));
  assert(first.sidecar.ownershipMap.imports.some((item) => item.module === "main.air" && item.resolved === "math.air"));
  assert(first.sidecar.generatedExecutableFreshness.authorityDrift.status === "pass");
  const addOneSymbol = first.sidecar.symbols.find((symbol) => symbol.module === "math.air" && symbol.kind === "function" && symbol.sourceName === "add_one");
  assert(addOneSymbol);
  assert.strictEqual(addOneSymbol.wasmName, wasmSafe(addOneSymbol.mangledName));
  assertNoAbsolutePaths(first.sidecar);
  assertNoTimestamps(first.sidecar);
  const metricCalls = [];
  assert.strictEqual(await instantiateRun(first.out, { debug: { metric: (id, value) => metricCalls.push([id, value]) } }, 41), 42);
  assert.deepStrictEqual(metricCalls, [[1, 42]]);

  const watOut = path.join(tmp, "valid.wat");
  run(["build", "package", valid, "--linked-wasm", "--profile", "browser-webgpu", "--emit", "wat", "-o", watOut]);
  const watSidecar = JSON.parse(fs.readFileSync(`${watOut}.link.json`, "utf8"));
  assert.strictEqual(watSidecar.linkedWasm, false);
  assert.strictEqual(watSidecar.linkedOutput.available, true);
  assert.strictEqual(watSidecar.linkedOutput.kind, "wat");
  assert.match(watSidecar.linkedOutput.watHash, /^sha256:[a-f0-9]{64}$/);
  assert.strictEqual(watSidecar.linkedOutput.wasmHash, null);
  const watText = fs.readFileSync(watOut, "utf8");
  const watAddOne = watSidecar.symbols.find((symbol) => symbol.module === "math.air" && symbol.kind === "function" && symbol.sourceName === "add_one");
  assert(watText.includes(`(func $${watAddOne.wasmName}`), "symbol wasmName must match linked WAT function name");
  const watRunExport = watSidecar.packageExports.find((item) => item.name === "run");
  assert(watText.includes(`call $${watRunExport.targetWasmName}`), "package export wrapper must call targetWasmName");

  runFails(["build", "package", path.join(root, "test", "fixtures", "package_graph", "private_call"), "--linked-wasm", "--profile", "browser-webgpu", "-o", path.join(tmp, "private.wasm")]);
  runFails(["build", "package", path.join(root, "test", "fixtures", "package_graph", "unresolved_import"), "--linked-wasm", "--profile", "browser-webgpu", "-o", path.join(tmp, "unresolved.wasm")]);

  const duplicateLocalNames = path.join(tmp, "duplicate-local-names");
  writePackage(duplicateLocalNames, {
    "main.air": `module main
use "./math.air" as math
capabilities { }

func helper(value: i32) -> i32 {
entry:
  return %value
}

export func run(seed: i32) -> i32 {
entry:
  %value:i32 = @math.answer(%seed)
  return %value
}
`,
    "math.air": `module math
capabilities { }

func helper(value: i32) -> i32 {
entry:
  return %value
}

export func answer(value: i32) -> i32 {
entry:
  %out:i32 = @helper(%value)
  return %out
}
`
  });
  const duplicate = buildPackage(duplicateLocalNames, "duplicate.wasm");
  const helperSymbols = duplicate.sidecar.symbols.filter((symbol) => symbol.kind === "function" && symbol.sourceName === "helper");
  assert.strictEqual(helperSymbols.length, 2);
  assert.strictEqual(new Set(helperSymbols.map((symbol) => symbol.mangledName)).size, 2);
  assert.strictEqual(await instantiateRun(duplicate.out, {}, 7), 7);

  const duplicateExports = path.join(tmp, "duplicate-package-exports");
  writePackage(duplicateExports, {
    "main.air": `module main
capabilities { }

export func run(seed: i32) -> i32 {
entry:
  return %seed
}
`
  }, {
    packageExports: [
      { name: "run", module: "main.air", function: "run" },
      { name: "run", module: "main.air", function: "run" }
    ]
  });
  const duplicateExportFailure = runFails(["build", "package", duplicateExports, "--linked-wasm", "--profile", "cli", "-o", path.join(tmp, "duplicate-exports.wasm")]);
  assert.match(`${duplicateExportFailure.stdout}\n${duplicateExportFailure.stderr}`, /duplicate package export name: run|air\.package_graph\.duplicate_public_export|link plan failed/);

  const composition = path.join(packageCompositionFixtures, "basic_multi_module");
  const compositionBuild = buildPackage(composition, "composition.wasm", "browser-webgpu");
  assert.strictEqual(compositionBuild.sidecar.status, "pass");
  assert.strictEqual(compositionBuild.sidecar.authoredGraph.kind, "air.authoredPackageGraph");
  assert.strictEqual(compositionBuild.sidecar.executableGraph.linkedOutput.kind, "wasm");
  assert(compositionBuild.sidecar.ownershipMap.effects.some((item) => item.name === "debug.metric" && item.owner === "main.air"));
  assert.strictEqual(compositionBuild.sidecar.abiImpact.airAbi, "0.10");
  assert.strictEqual(compositionBuild.sidecar.abiImpact.hostAbi, "0.10");
  assert.strictEqual(await instantiateRun(compositionBuild.out, { debug: { metric: () => {} } }, 9), 10);
  assertNoAbsolutePaths(compositionBuild.sidecar);
  assertNoTimestamps(compositionBuild.sidecar);

  const escapingExport = path.join(tmp, "escaping-package-export");
  writePackage(escapingExport, {
    "main.air": `module main
capabilities { }

export func run(seed: i32) -> i32 {
entry:
  return %seed
}
`
  }, {
    packageExports: [
      { name: "run", module: "../main.air", function: "run" }
    ]
  });
  assert.match(runFails(["build", "package", escapingExport, "--linked-wasm", "--profile", "cli", "-o", path.join(tmp, "escaping-export.wasm")]).stderr, /packageExports\[0\]\.module must not contain parent traversal/);

  const hostDedupe = path.join(tmp, "host-dedupe");
  writePackage(hostDedupe, {
    "main.air": `module main
use "./metrics.air" as metrics
capabilities { debug }
extern debug.metric(id: i32, value: i32) -> void

export func run(seed: i32) -> i32 {
entry:
  @debug.metric(1, %seed)
  %value:i32 = @metrics.emit(%seed)
  return %value
}
`,
    "metrics.air": `module metrics
capabilities { debug }
extern debug.metric(id: i32, value: i32) -> void

export func emit(value: i32) -> i32 {
entry:
  @debug.metric(2, %value)
  return %value
}
`
  }, { capabilities: ["debug"], targetProfiles: ["browser-webgpu"] });
  const dedupe = buildPackage(hostDedupe, "host-dedupe.wasm", "browser-webgpu");
  assert.deepStrictEqual(dedupe.sidecar.hostImports.used, ["debug.metric"]);
  const dedupeCalls = [];
  assert.strictEqual(await instantiateRun(dedupe.out, { debug: { metric: (id, value) => dedupeCalls.push([id, value]) } }, 3), 3);
  assert.deepStrictEqual(dedupeCalls, [[1, 3], [2, 3]]);

  const generated = path.join(tmp, "generated");
  fs.cpSync(path.join(root, "test", "fixtures", "package_minimal"), generated, { recursive: true });
  fs.writeFileSync(path.join(generated, "module.air"), `module minimal_package_fixture
use "./generated/assets.air" as assets
capabilities { }

export func run(seed: i32) -> i32 {
entry:
  %count:i32 = @assets.asset_count()
  return %count
}
`);
  const generatedBuild = buildPackage(generated, "generated.wasm", "browser-webgpu");
  assert(generatedBuild.sidecar.generatedArtifacts.generatedHandles.files.some((file) => file.path === "generated/assets.air" && file.status === "current"));
  assert(generatedBuild.sidecar.symbols.some((symbol) => symbol.kind === "generatedModule" && symbol.module === "generated/assets.air"));
  assert(generatedBuild.sidecar.symbols.some((symbol) => symbol.kind === "table" && symbol.module === "generated/assets.air" && symbol.sourceName === "asset_ids"));
  assert.strictEqual(await instantiateRun(generatedBuild.out, {}, 0), 4);

  fs.appendFileSync(path.join(generated, "generated", "assets.air"), "\n# stale for linked package test\n");
  runFails(["build", "package", generated, "--linked-wasm", "--profile", "browser-webgpu", "-o", path.join(tmp, "stale.wasm")]);

  console.log("ok: linked package tests");
})().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exitCode = 1;
});
