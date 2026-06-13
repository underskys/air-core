#!/usr/bin/env node

const assert = require("assert");
const cp = require("child_process");
const fs = require("fs");
const path = require("path");
const { AIR_ABI_VERSION } = require("../src/version");
const { HOST_ABI_VERSION } = require("../src/package_manifest");

const root = path.resolve(__dirname, "..");
const airc = path.join(root, "bin", "airc.js");
const tmpRoot = path.join(root, "build", "output-handle-generator-tests");

function run(args) {
  return cp.execFileSync(process.execPath, [airc, ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function runJson(args) {
  return JSON.parse(run(args.concat("--json")));
}

function runFailsJson(args) {
  const result = cp.spawnSync(process.execPath, [airc, ...args, "--json"], {
    cwd: root,
    encoding: "utf8"
  });
  assert.notStrictEqual(result.status, 0, `expected failure: ${args.join(" ")}`);
  return JSON.parse(result.stdout || "{}");
}

function writePackage(name, options = {}) {
  const dir = path.join(tmpRoot, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, "outputs"), { recursive: true });
  fs.writeFileSync(path.join(dir, "module.air"), `module ${name.replace(/-/g, "_")}
capabilities { }

export func run() -> i32 {
entry:
  %ok:i32 = const.i32 1
  return %ok
}
`);
  fs.writeFileSync(path.join(dir, "outputs", "main.output.json"), `${JSON.stringify(outputContract(options), null, 2)}\n`);
  fs.writeFileSync(path.join(dir, "air.package.json"), `${JSON.stringify({
    name,
    version: "0.1.0",
    airAbi: "0.10",
    hostAbi: options.hostAbi || "0.10",
    entry: "module.air",
    capabilities: [],
    targetProfiles: ["cli"],
    generatedModules: ["generated/output_handles.air"],
    outputContracts: ["outputs/main.output.json"]
  }, null, 2)}\n`);
  return dir;
}

function outputContract(options = {}) {
  return {
    schemaVersion: "0.18",
    kind: "air.outputContract",
    outputs: [{
      id: 1,
      name: options.outputName || "incident_recommend_action",
      channel: "policy",
      capability: "output.emit",
      args: [
        { name: "arg0", type: "i32" },
        { name: "arg1", type: "i32" },
        { name: "arg2", type: "i32" },
        { name: "arg3", type: "i32" }
      ]
    }]
  };
}

function diagnosticCodes(report) {
  return new Set((report.diagnostics || []).map((diagnostic) => diagnostic.code));
}

fs.rmSync(tmpRoot, { recursive: true, force: true });

assert.strictEqual(AIR_ABI_VERSION, "0.10");
assert.strictEqual(HOST_ABI_VERSION, "0.10");

const packageDir = writePackage("output-handle-package");

let missing = runFailsJson(["package-check", packageDir, "--profile", "cli", "--source-only"]);
assert(diagnosticCodes(missing).has("air.generated.output_handles_missing"));

const generated = runJson(["generate", "output-handles", packageDir]);
assert.deepStrictEqual(generated.written, ["generated/output_handles.air", "generated/output_handles.meta.json"]);

const generatedAir = fs.readFileSync(path.join(packageDir, "generated", "output_handles.air"), "utf8");
assert.match(generatedAir, /const OUTPUT_INCIDENT_RECOMMEND_ACTION:i32 = 1/);
assert.match(generatedAir, /const OUTPUT_INCIDENT_RECOMMEND_ACTION_ID:i32 = 1/);
assert.match(generatedAir, /const OUTPUT_INCIDENT_RECOMMEND_ACTION_ARG_COUNT:i32 = 4/);
assert(!/\bfunc\b/.test(generatedAir), "generated output handles must not include emit wrapper functions");
assert(!/@output\.emit\b/.test(generatedAir), "generated output handles must not call output.emit");
run(["verify", "--library", path.join(packageDir, "generated", "output_handles.air")]);

const meta = JSON.parse(fs.readFileSync(path.join(packageDir, "generated", "output_handles.meta.json"), "utf8"));
assert.strictEqual(meta.schemaVersion, "0.27");
assert.strictEqual(meta.kind, "air.generatedOutputHandles");
assert.strictEqual(meta.generator, "airc output-handles");
assert.strictEqual(meta.sourceContracts[0].path, "outputs/main.output.json");
assert.strictEqual(meta.outputs[0].handle, "OUTPUT_INCIDENT_RECOMMEND_ACTION");
assert.deepStrictEqual(meta.outputs[0].argTypes, ["i32", "i32", "i32", "i32"]);

const fresh = runJson(["package-check", packageDir, "--profile", "cli", "--source-only"]);
assert.strictEqual(fresh.status, "pass");
assert.strictEqual(fresh.outputHandleSets[0].status, "fresh");
assert.strictEqual(fresh.outputHandleSets[0].outputs[0].handle, "OUTPUT_INCIDENT_RECOMMEND_ACTION");
assert.strictEqual(fresh.hostAbi, "0.10");

const evidence = runJson(["verify", "package", packageDir, "--profile", "cli"]);
assert.strictEqual(evidence.status, "passed");
assert.strictEqual(evidence.outputHandleSets[0].status, "fresh");
assert.strictEqual(evidence.outputHandleSets[0].outputs[0].handle, "OUTPUT_INCIDENT_RECOMMEND_ACTION");
assert.strictEqual(evidence.airAbi, "0.10");
assert.strictEqual(evidence.hostAbi, "0.10");

const stalePackage = writePackage("output-handle-stale-package");
runJson(["generate", "output-handles", stalePackage]);
fs.writeFileSync(path.join(stalePackage, "outputs", "main.output.json"), `${JSON.stringify(outputContract({ outputName: "panel_set_badge" }), null, 2)}\n`);
const stale = runFailsJson(["package-check", stalePackage, "--profile", "cli", "--source-only"]);
let codes = diagnosticCodes(stale);
assert(codes.has("air.generated.output_handles_stale"));
assert(codes.has("air.output_handle.missing_output"));
assert(codes.has("air.output_handle.unknown_output"));

const mismatchPackage = writePackage("output-handle-mismatch-package");
runJson(["generate", "output-handles", mismatchPackage]);
const metaPath = path.join(mismatchPackage, "generated", "output_handles.meta.json");
const mismatchMeta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
mismatchMeta.outputs[0].argCount = 99;
fs.writeFileSync(metaPath, `${JSON.stringify(mismatchMeta, null, 2)}\n`);
const mismatch = runFailsJson(["package-check", mismatchPackage, "--profile", "cli", "--source-only"]);
codes = diagnosticCodes(mismatch);
assert(codes.has("air.generated.output_handles_mismatch"));

const missingFilePackage = writePackage("output-handle-missing-file-package");
runJson(["generate", "output-handles", missingFilePackage]);
fs.rmSync(path.join(missingFilePackage, "generated", "output_handles.air"));
const missingFile = runFailsJson(["package-check", missingFilePackage, "--profile", "cli", "--source-only"]);
assert(diagnosticCodes(missingFile).has("air.generated.output_handles_missing"));

const lspStale = runFailsJson(["check", stalePackage, "--profile", "cli", "--lsp-json"]);
assert(lspStale.diagnostics.some((diagnostic) => diagnostic.code === "air.generated.output_handles_stale"));

console.log("output handle generator tests passed");
