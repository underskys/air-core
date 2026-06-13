#!/usr/bin/env node

const assert = require("assert");
const cp = require("child_process");
const fs = require("fs");
const path = require("path");
const { reportPackageDir } = require("../src/sdk");
const { createPackageVerificationEvidence } = require("../src/verification_evidence");
const { packageGraphDiagnostics } = require("../src/package_graph_ownership");

const root = path.resolve(__dirname, "..");
const airc = path.join(root, "bin", "airc.js");
const packageGraphFixtures = path.join(root, "test", "fixtures", "package_graph");
const packageCompositionFixtures = path.join(root, "test", "fixtures", "package_composition");
const tmp = path.join(root, "build", "link-plan-tests");

function run(args) {
  return cp.execFileSync(process.execPath, [airc, ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function runJson(dir, profile = "browser-webgpu") {
  return JSON.parse(run(["link-plan", dir, "--profile", profile, "--json"]));
}

function runFailsJson(args) {
  const result = cp.spawnSync(process.execPath, [airc, ...args], {
    cwd: root,
    encoding: "utf8"
  });
  assert.notStrictEqual(result.status, 0, `expected failure: ${args.join(" ")}`);
  return JSON.parse(result.stdout);
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

function assertNoAbsolutePaths(value) {
  const text = JSON.stringify(value);
  assert(!text.includes(root), "link plan must not contain repository absolute path");
  assert(!/\"[A-Za-z]:[\\/]/.test(text), "link plan must not contain Windows absolute path");
}

function assertNoTimestamps(value) {
  const text = JSON.stringify(value);
  assert(!/20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z/.test(text), "link metadata must not contain timestamps");
}

fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });

const valid = path.join(packageGraphFixtures, "valid");
const first = run(["link-plan", valid, "--profile", "browser-webgpu", "--json"]);
const second = run(["link-plan", valid, "--profile", "browser-webgpu", "--json"]);
assert.strictEqual(first, second);

const plan = JSON.parse(first);
assert.strictEqual(plan.schemaVersion, "0.16");
assert.strictEqual(plan.kind, "air.linkPlan");
assert.strictEqual(plan.package.name, "package-graph-valid");
assert.deepStrictEqual(plan.moduleOrder, ["main.air", "math.air"]);
assert.match(plan.sourceGraphHash, /^sha256:[a-f0-9]{64}$/);
assert.strictEqual(plan.linkedWasm, false);
assert.deepStrictEqual(plan.abiImpact, {
  airAbi: "0.10",
  airAbiBumpRequired: false,
  hostAbi: "0.10",
  hostAbiBumpRequired: false,
  rationale: "link-plan is metadata-only; no executable runtime package contract or Host ABI import changes are introduced"
});
assert.deepStrictEqual(plan.capabilities.computed, ["debug"]);
assert.deepStrictEqual(plan.hostImports.used, ["debug.metric"]);
assert(plan.symbols.some((symbol) => symbol.kind === "function" && symbol.module === "math.air" && symbol.sourceName === "add_one"));
assert(plan.symbols.some((symbol) => symbol.kind === "global" && symbol.module === "math.air" && symbol.sourceName === "cached"));
assert(plan.staticTables.some((table) => table.module === "math.air" && table.name === "offsets" && table.elementType === "i32" && table.length === 2));
assert.deepStrictEqual(plan.crossModuleCalls.map((edge) => ({
  fromModule: edge.fromModule,
  fromFunction: edge.fromFunction,
  toModule: edge.toModule,
  toFunction: edge.toFunction,
  callee: edge.callee
})), [
  {
    fromModule: "main.air",
    fromFunction: "run",
    toModule: "math.air",
    toFunction: "add_one",
    callee: "math.add_one"
  }
]);
assertNoAbsolutePaths(plan);
assertNoTimestamps(plan);

const composition = path.join(packageCompositionFixtures, "basic_multi_module");
const compositionPlanText = run(["link-plan", composition, "--profile", "browser-webgpu", "--json"]);
assert.strictEqual(compositionPlanText, run(["link-plan", composition, "--profile", "browser-webgpu", "--json"]));
const compositionPlan = JSON.parse(compositionPlanText);
assert.strictEqual(compositionPlan.status, "pass");
assert.strictEqual(compositionPlan.package.name, "package-composition-basic");
assert.deepStrictEqual(compositionPlan.moduleOrder, ["main.air", "math.air"]);
assert.strictEqual(compositionPlan.authoredGraph.kind, "air.authoredPackageGraph");
assert.strictEqual(compositionPlan.executableGraph.kind, "air.executablePackageGraph");
assert.strictEqual(compositionPlan.generatedExecutableFreshness.status, "current");
assert.strictEqual(compositionPlan.generatedExecutableFreshness.authorityDrift.status, "pass");
assert(compositionPlan.authoredToExecutable.some((item) => item.kind === "module" && item.authoredModule === "main.air"));
assert(compositionPlan.ownershipMap.imports.some((item) => item.module === "main.air" && item.resolved === "math.air"));
assert(compositionPlan.ownershipMap.privateSymbols.some((item) => item.authoredModule === "math.air" && item.name === "internal_add_one"));
assert(compositionPlan.ownershipMap.capabilities.some((item) => item.name === "debug" && item.owners.includes("main.air")));
assert(compositionPlan.ownershipMap.effects.some((item) => item.name === "debug.metric" && item.owner === "main.air"));
assert(compositionPlan.ownershipMap.exports.some((item) => item.kind === "package-export" && item.name === "run" && item.owner === "main.air"));
assertNoAbsolutePaths(compositionPlan);
assertNoTimestamps(compositionPlan);

const compositionReport = reportPackageDir(composition, { profile: "browser-webgpu" });
assert.strictEqual(compositionReport.authoredGraph.kind, "air.authoredPackageGraph");
assert.strictEqual(compositionReport.executableGraph.kind, "air.executablePackageGraph");
assert(compositionReport.ownershipMap.capabilities.some((item) => item.name === "debug"));
assertNoAbsolutePaths(compositionReport);
assertNoTimestamps(compositionReport);

const compositionEvidence = createPackageVerificationEvidence(composition, { profile: "browser-webgpu" });
assert.strictEqual(compositionEvidence.authoredGraph.kind, "air.authoredPackageGraph");
assert.strictEqual(compositionEvidence.executableGraph.kind, "air.executablePackageGraph");
assert(compositionEvidence.ownershipMap.imports.some((item) => item.module === "main.air" && item.resolved === "math.air"));
assertNoAbsolutePaths(compositionEvidence);
assertNoTimestamps(compositionEvidence);

const duplicateLocalNames = path.join(tmp, "duplicate-local-names");
writePackage(duplicateLocalNames, {
  "main.air": `module main
use "./math.air"
capabilities { }

func helper(value: i32) -> i32 {
entry:
  return %value
}

export func run() -> i32 {
entry:
  %value:i32 = @math.answer(40)
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
  return %value
}
`
});
const duplicatePlan = runJson(duplicateLocalNames, "cli");
const helperSymbols = duplicatePlan.symbols.filter((symbol) => symbol.kind === "function" && symbol.sourceName === "helper");
assert.strictEqual(helperSymbols.length, 2);
assert.strictEqual(new Set(helperSymbols.map((symbol) => symbol.mangledName)).size, 2);

const privatePlan = runFailsJson(["link-plan", path.join(packageGraphFixtures, "private_call"), "--profile", "browser-webgpu", "--json"]);
assert.strictEqual(privatePlan.status, "fail");
assert(privatePlan.diagnostics.moduleDiagnostics.some((item) => item.code === "AIR_MODULE_PRIVATE_OR_MISSING_EXPORT"));
assert(privatePlan.linkDiagnostics.some((item) => item.code === "air.package_graph.private_symbol_import"));

const unresolvedPlan = runFailsJson(["link-plan", path.join(packageGraphFixtures, "unresolved_import"), "--profile", "browser-webgpu", "--json"]);
assert.strictEqual(unresolvedPlan.status, "fail");
assert(unresolvedPlan.diagnostics.errors.some((error) => /AIR import missing file: missing\.air/.test(error)));
assert(unresolvedPlan.linkDiagnostics.some((item) => item.code === "air.package_graph.unresolved_module_import"));

const privateCompositionPlan = runFailsJson(["link-plan", path.join(packageCompositionFixtures, "private_import"), "--profile", "cli", "--json"]);
assert(privateCompositionPlan.linkDiagnostics.some((item) => item.code === "air.package_graph.private_symbol_import"));

const unresolvedModuleCompositionPlan = runFailsJson(["link-plan", path.join(packageCompositionFixtures, "unresolved_module"), "--profile", "cli", "--json"]);
assert(unresolvedModuleCompositionPlan.linkDiagnostics.some((item) => item.code === "air.package_graph.unresolved_module_import"));

const unresolvedSymbolCompositionPlan = runFailsJson(["link-plan", path.join(packageCompositionFixtures, "unresolved_symbol"), "--profile", "cli", "--json"]);
assert(unresolvedSymbolCompositionPlan.linkDiagnostics.some((item) => item.code === "air.package_graph.unresolved_symbol_import"));

const duplicateExportDiagnostics = packageGraphDiagnostics({ modules: [], graph: { order: [], edges: [] }, capabilityOrigins: {} }, { errors: [] }, {
  packageExports: [
    { name: "run", module: "main.air", function: "run" },
    { name: "run", module: "other.air", function: "run" }
  ]
});
assert(duplicateExportDiagnostics.some((item) => item.code === "air.package_graph.duplicate_public_export"));

const generatedPackage = path.join(tmp, "generated-package");
fs.cpSync(path.join(root, "test", "fixtures", "package_minimal"), generatedPackage, { recursive: true });
const generatedPlan = runJson(generatedPackage, "browser-webgpu");
assert.strictEqual(generatedPlan.status, "pass");
assert(generatedPlan.generatedArtifacts.generatedHandles.files.some((file) => file.path === "generated/assets.air" && file.status === "current"));
assert(generatedPlan.symbols.some((symbol) => symbol.kind === "generatedModule" && symbol.module === "generated/assets.air"));

fs.appendFileSync(path.join(generatedPackage, "generated", "assets.air"), "\n# stale for link-plan test\n");
const stalePlan = runFailsJson(["link-plan", generatedPackage, "--profile", "browser-webgpu", "--json"]);
assert.strictEqual(stalePlan.status, "fail");
assert(stalePlan.generatedArtifacts.generatedHandles.errors.some((error) => /generated handle file stale: generated\/assets\.air/.test(error)));

console.log("ok: link plan tests");
