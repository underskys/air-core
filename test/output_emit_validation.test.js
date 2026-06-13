#!/usr/bin/env node

const assert = require("assert");
const cp = require("child_process");
const fs = require("fs");
const path = require("path");
const { HOST_ABI_VERSION, SUPPORTED_HOST_ABI_VERSIONS } = require("../src/package_manifest");
const { loadHostProfile } = require("../src/host_profiles");

const root = path.resolve(__dirname, "..");
const airc = path.join(root, "bin", "airc.js");
const tmpRoot = path.join(root, "build", "output-emit-validation-tests");

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
  try {
    run(args.concat("--json"));
  } catch (err) {
    return JSON.parse(err.stdout || "{}");
  }
  throw new Error(`expected command to fail: ${args.join(" ")}`);
}

function writePackage(name, options = {}) {
  const dir = path.join(tmpRoot, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, "outputs"), { recursive: true });
  fs.writeFileSync(path.join(dir, "module.air"), moduleSource(options));
  fs.writeFileSync(path.join(dir, "outputs", "contracts.json"), JSON.stringify(outputContracts(options), null, 2));
  fs.writeFileSync(path.join(dir, "air.package.json"), JSON.stringify({
    name,
    version: "0.1.0",
    airAbi: "0.10",
    hostAbi: options.hostAbi || "0.11",
    entry: "module.air",
    capabilities: options.packageCapabilities === undefined ? ["output"] : options.packageCapabilities,
    targetProfiles: options.targetProfiles || ["mock-output-v011"],
    generatedModules: options.generatedModules || [],
    outputContracts: ["outputs/contracts.json"]
  }, null, 2));
  return dir;
}

function moduleSource(options = {}) {
  const capabilities = options.sourceCapabilities === undefined ? "capabilities { output }\n" : options.sourceCapabilities;
  const effects = options.effects === undefined ? "effects { output.emit <= 1 }\n" : options.effects;
  const outputIdDecl = options.outputIdDecl === undefined
    ? `const ${options.outputConstName || "OUT_ALERT"}:i32 = ${options.outputId === undefined ? 1 : options.outputId}\n`
    : options.outputIdDecl;
  const extern = options.extern || "extern output.emit(output_id: i32, arg0: i32, arg1: i32, arg2: i32, arg3: i32) -> i32";
  const setup = options.setup || "  %zero:i32 = const.i32 0\n";
  const outputArg = options.dynamicOutputId ? "%id" : (options.outputArg || options.outputConstName || "OUT_ALERT");
  const callArgs = options.callArgs || `${outputArg}, %zero, %zero, %zero, %zero`;
  return `module output_emit_test
${outputIdDecl}${capabilities}${effects}${extern}
export func run() -> i32 {
entry:
${setup}  %status:i32 = @output.emit(${callArgs})
  return %status
}
`;
}

function outputContracts(options = {}) {
  return {
    schemaVersion: "0.18",
    kind: "air.outputContract",
    outputs: [{
      id: 1,
      name: "incident_recommend_action",
      channel: "policy",
      capability: "output.emit",
      args: [
        { name: "arg0", type: "i32" },
        { name: "arg1", type: "i32" },
        { name: "arg2", type: "i32" },
        { name: "arg3", type: options.contractArg3Type || "i32" }
      ]
    }]
  };
}

function diagnosticCodes(report) {
  return new Set((report.diagnostics || []).map((diagnostic) => diagnostic.code));
}

fs.rmSync(tmpRoot, { recursive: true, force: true });

assert.strictEqual(HOST_ABI_VERSION, "0.10");
assert(SUPPORTED_HOST_ABI_VERSIONS.has("0.11"));
const outputProfile = loadHostProfile("mock-output-v011");
assert.strictEqual(outputProfile.hostAbi, "0.11");
assert(outputProfile.supports.hostImports.includes("output.emit"));

const valid = runJson(["package-check", writePackage("valid"), "--profile", "mock-output-v011", "--source-only"]);
assert.strictEqual(valid.status, "pass");
assert.deepStrictEqual(valid.hostImports.used, ["output.emit"]);
assert.deepStrictEqual(valid.capabilities.required, ["output"]);
assert(valid.checks.some((check) => check.id === "output-emit" && check.status === "pass"));
assert.strictEqual(valid.outputEmit.used[0].calls[0].outputId, 1);
assert.strictEqual(valid.outputEmit.used[0].calls[0].outputName, "incident_recommend_action");
let codes;

const generatedHandlePackage = writePackage("generated-handle-valid", {
  generatedModules: ["generated/output_handles.air"],
  outputConstName: "OUTPUT_INCIDENT_RECOMMEND_ACTION"
});
runJson(["generate", "output-handles", generatedHandlePackage]);
const generatedHandleReport = runJson(["package-check", generatedHandlePackage, "--profile", "mock-output-v011", "--source-only"]);
assert.strictEqual(generatedHandleReport.status, "pass");
assert.strictEqual(generatedHandleReport.outputHandleSets[0].status, "fresh");
assert(generatedHandleReport.checks.some((check) => check.id === "output-emit" && check.status === "pass"));

const rawOutputIdCanonical = runFailsJson(["package-check", writePackage("generated-handle-raw-id", {
  generatedModules: ["generated/output_handles.air"],
  outputIdDecl: "",
  outputArg: "1"
}), "--profile", "mock-output-v011", "--source-only"]);
codes = diagnosticCodes(rawOutputIdCanonical);
assert(codes.has("air.output_emit.output_handle_required"));

const legacyConstCanonical = runFailsJson(["package-check", writePackage("generated-handle-legacy-const", {
  generatedModules: ["generated/output_handles.air"],
  outputConstName: "OUT_ALERT"
}), "--profile", "mock-output-v011", "--source-only"]);
codes = diagnosticCodes(legacyConstCanonical);
assert(codes.has("air.output_emit.output_handle_required"));

const rawOutputIdLowLevel = runJson(["package-check", writePackage("low-level-raw-id", {
  outputIdDecl: "",
  outputArg: "1"
}), "--profile", "mock-output-v011", "--source-only"]);
assert.strictEqual(rawOutputIdLowLevel.status, "pass");

const hostAbi010 = runFailsJson(["package-check", writePackage("host-abi-010", {
  hostAbi: "0.10",
  targetProfiles: ["cli"]
}), "--profile", "cli", "--source-only"]);
codes = diagnosticCodes(hostAbi010);
assert(codes.has("air.output_emit.host_abi_unsupported"));
assert(codes.has("air.output_emit.profile_unsupported"));

const unknownOutput = runFailsJson(["package-check", writePackage("unknown-output-id", {
  outputId: 99
}), "--profile", "mock-output-v011", "--source-only"]);
codes = diagnosticCodes(unknownOutput);
assert(codes.has("air.output_emit.output_id_invalid"));

const dynamicOutput = runFailsJson(["package-check", writePackage("dynamic-output-id", {
  dynamicOutputId: true,
  setup: "  %zero:i32 = const.i32 0\n  %one:i32 = const.i32 1\n  %id:i32 = i32.add %zero, %one\n"
}), "--profile", "mock-output-v011", "--source-only"]);
codes = diagnosticCodes(dynamicOutput);
assert(codes.has("air.output_emit.output_id_dynamic"));

const badArgs = runFailsJson(["package-check", writePackage("bad-args", {
  extern: "extern output.emit(output_id: i32, arg0: f32, arg1: i32, arg2: i32, arg3: i32) -> i32",
  setup: "  %zero:i32 = const.i32 0\n  %f:f32 = const.f32 1.0\n",
  callArgs: "OUT_ALERT, %f, %zero, %zero, %zero"
}), "--profile", "mock-output-v011", "--source-only"]);
codes = diagnosticCodes(badArgs);
assert(codes.has("air.output_emit.args_invalid"));

const missingCapability = runFailsJson(["package-check", writePackage("missing-capability", {
  sourceCapabilities: "",
  packageCapabilities: []
}), "--profile", "mock-output-v011", "--source-only"]);
codes = diagnosticCodes(missingCapability);
assert(codes.has("air.output_emit.capability_missing"));

const missingBudget = runFailsJson(["package-check", writePackage("missing-budget", {
  effects: ""
}), "--profile", "mock-output-v011", "--source-only"]);
codes = diagnosticCodes(missingBudget);
assert(codes.has("air.output_emit.budget_exceeded"));

const badContract = runFailsJson(["package-check", writePackage("bad-contract", {
  contractArg3Type: "bool"
}), "--profile", "mock-output-v011", "--source-only"]);
codes = diagnosticCodes(badContract);
assert(codes.has("air.output_emit.args_invalid"));

console.log("output emit validation tests passed");
