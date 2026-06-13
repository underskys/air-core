#!/usr/bin/env node

const assert = require("assert");
const cp = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { parseAir } = require("../src/parser");
const { collectEffectUsage, verifyModule } = require("../src/verifier");
const { formatModule } = require("../src/format");
const { createFileLspDiagnostics } = require("../src/lsp_diagnostics");
const { createConformanceReport } = require("../src/conformance_report");
const { lowerToWat, watToWasm } = require("../src/lower_wasm");
const { AIR_ABI_VERSION } = require("../src/version");
const { HOST_ABI_VERSION } = require("../src/package_manifest");

const root = path.resolve(__dirname, "..");
const airc = path.join(root, "bin", "airc.js");

function lspDiagnosticsFor(source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "air-state-"));
  const file = path.join(dir, "main.air");
  fs.writeFileSync(file, source);
  return createFileLspDiagnostics(file).diagnostics;
}

function assertDiagnostic(source, code) {
  const diagnostics = lspDiagnosticsFor(source);
  assert(
    diagnostics.some((diagnostic) => diagnostic.code === code),
    `expected ${code}, got ${diagnostics.map((diagnostic) => diagnostic.code).join(", ")}`
  );
}

const validSource = `module state_demo
state board:i32[4] = fill 0
capabilities { }

export func state_length() -> i32 {
entry:
  %len:i32 = state.len board
  return %len
}

export func read_cell(index: i32) -> i32 {
entry:
  %v:i32 = state.get board, %index
  return %v
}

export func write_cell(index: i32, value: i32) -> i32 {
entry:
  state.set board, %index, %value
  return %value
}
`;

const mod = parseAir(validSource, "<fixed-state-test>");
assert.deepStrictEqual(mod.states.map((state) => ({
  name: state.name,
  type: state.type,
  length: state.length,
  init: state.init.value.value
})), [{ name: "board", type: "i32", length: 4, init: 0 }]);
verifyModule(mod, { library: true });

const formatted = formatModule(mod);
assert.match(formatted, /state board:i32\[4\] = fill 0/);
assert.match(formatted, /%len:i32 = state\.len board/);
assert.match(formatted, /%v:i32 = state\.get board, %index/);
assert.match(formatted, /state\.set board, %index, %value/);
assert.strictEqual(formatModule(parseAir(formatted, "<fixed-state-formatted>")), formatted);

const nonZeroFill = parseAir(`module nonzero_state
state counters:i32[2] = fill -7
capabilities { }

export func read() -> i32 {
entry:
  %v:i32 = state.get counters, 0
  return %v
}
`, "<fixed-state-nonzero>");
verifyModule(nonZeroFill, { library: true });
assert.match(formatModule(nonZeroFill), /state counters:i32\[2\] = fill -7/);

const report = createConformanceReport(mod);
assert.deepStrictEqual(report.stateSegments, [{
  name: "board",
  cellType: "i32",
  length: 4,
  byteWidth: 4,
  byteSize: 16,
  staticBytes: 16,
  persistent: true,
  exported: false,
  shared: false,
  initializer: {
    kind: "fill",
    value: 0
  },
  readBudget: null,
  writeBudget: null,
  sizeBudget: null,
  moduleObservedReads: 1,
  moduleObservedWrites: 1,
  diagnostics: [],
  module: "state_demo",
  source: "<fixed-state-test>",
  origin: "manual"
}]);
assert.deepStrictEqual(report.stateSegmentSummary, {
  count: 1,
  names: ["board"],
  totalStaticBytes: 16
});

const loopUsageSource = `module state_loop_budget
state board:i32[4] = fill 0
capabilities { }

func read_once(acc: i32) -> i32 {
entry:
  %v:i32 = state.get board, %acc
  return %v
}

export func run() -> i32 {
entry:
  %out:i32 = loop.fold.i32 @read_once, 0, 3
  return %out
}
`;
const loopUsage = collectEffectUsage(parseAir(loopUsageSource, "<fixed-state-loop>"));
assert.strictEqual(loopUsage.get("state.read"), 3);
assert.strictEqual(loopUsage.get("memory.state_read"), 3);
assert.strictEqual(loopUsage.get("state.static_bytes"), 16);

assertDiagnostic(`module bad_state_type
state board:u8[4] = fill 0
capabilities { }
`, "air.state.cell_type_invalid");

assertDiagnostic(`module bad_state_length
state board:i32[N] = fill 0
capabilities { }
`, "air.state.dynamic_length");

assertDiagnostic(`module bad_state_init
state board:i32[4] = zero
capabilities { }
`, "air.state.init_invalid");

assertDiagnostic(`module bad_state_op
state board:i32[4] = fill 0
capabilities { }

export func read() -> i32 {
entry:
  %v:i32 = state.get missing, 0
  return %v
}
`, "air.state.op_invalid");

assertDiagnostic(`module bad_state_escape
state board:i32[4] = fill 0
capabilities { }

export func leak() -> i32 {
entry:
  %p:i32 = state.slice board
  return %p
}
`, "air.state.pointer_escape");

assertDiagnostic(`module bad_state_oob
state board:i32[4] = fill 0
capabilities { }

export func read() -> i32 {
entry:
  %v:i32 = state.get board, 4
  return %v
}
`, "air.state.index_out_of_bounds");

assertDiagnostic(`module bad_state_read_budget
state board:i32[4] = fill 0
capabilities { }
effects { state.read <= 0 }

export func read() -> i32 {
entry:
  %v:i32 = state.get board, 0
  return %v
}
`, "air.state.read_budget_exceeded");

assertDiagnostic(`module bad_state_write_budget
state board:i32[4] = fill 0
capabilities { }
effects { state.write <= 0 }

export func write(value: i32) -> i32 {
entry:
  state.set board, 0, %value
  return %value
}
`, "air.state.write_budget_exceeded");

assertDiagnostic(`module bad_state_size_budget
state board:i32[4] = fill 0
capabilities { }
effects { state.static_bytes <= 4 }

export func read() -> i32 {
entry:
  %v:i32 = state.get board, 0
  return %v
}
`, "air.state.size_budget_exceeded");

assert.throws(() => parseAir(`module bad_state_export
state board:i32[4] = fill 0
export state board
`, "<bad-state-export>"), /expected module, capabilities, or func declaration/);

const packageDir = fs.mkdtempSync(path.join(os.tmpdir(), "air-state-pkg-"));
fs.writeFileSync(path.join(packageDir, "main.air"), validSource);
fs.writeFileSync(path.join(packageDir, "module.wasm"), "placeholder wasm for fixed state report package\n");
fs.writeFileSync(path.join(packageDir, "air.package.json"), JSON.stringify({
  name: "fixed-state-package",
  version: "0.1.0",
  airAbi: "0.10",
  hostAbi: "0.10",
  entry: "main.air",
  wasm: "module.wasm",
  capabilities: [],
  targetProfiles: ["cli"],
  manifests: {}
}, null, 2));

const packageReport = JSON.parse(runAirc(["report", "package", packageDir, "--json"]));
assert.strictEqual(packageReport.status, "pass");
assert.strictEqual(packageReport.stateSegments.length, 1);
assert.strictEqual(packageReport.stateSegments[0].name, "board");
assert.strictEqual(packageReport.stateSegments[0].byteSize, 16);
assert.strictEqual(packageReport.stateSegments[0].persistent, true);
assert.strictEqual(packageReport.stateSegments[0].exported, false);
assert.strictEqual(packageReport.stateSegments[0].shared, false);
assert.strictEqual(packageReport.stateSegments[0].moduleObservedReads, 1);
assert.strictEqual(packageReport.stateSegments[0].moduleObservedWrites, 1);
assert.strictEqual("observedReads" in packageReport.stateSegments[0], false);
assert.strictEqual("observedWrites" in packageReport.stateSegments[0], false);
assert.strictEqual(packageReport.modules[0].stateSegments[0].name, "board");

const evidence = JSON.parse(runAirc(["verify", "package", packageDir, "--profile", "cli", "--json"]));
assert.strictEqual(evidence.status, "passed");
assert.strictEqual(evidence.stateSegments.length, 1);
assert.strictEqual(evidence.stateSegments[0].name, "board");
assert.strictEqual(evidence.stateSegments[0].byteSize, 16);
assert.strictEqual(evidence.stateSegments[0].persistent, true);
assert.strictEqual(evidence.stateSegments[0].exported, false);
assert.strictEqual(evidence.stateSegments[0].shared, false);
assert.strictEqual(evidence.stateSegments[0].moduleObservedReads, 1);
assert.strictEqual(evidence.stateSegments[0].moduleObservedWrites, 1);
assert.strictEqual("observedReads" in evidence.stateSegments[0], false);
assert.strictEqual("observedWrites" in evidence.stateSegments[0], false);
assert.strictEqual(evidence.modules[0].stateSegments[0].name, "board");

const handlePackage = fs.mkdtempSync(path.join(os.tmpdir(), "air-state-handles-"));
fs.writeFileSync(path.join(handlePackage, "main.air"), validSource);
fs.writeFileSync(path.join(handlePackage, "air.package.json"), JSON.stringify({
  name: "fixed-state-handles-package",
  version: "0.1.0",
  airAbi: "0.10",
  hostAbi: "0.10",
  entry: "main.air",
  capabilities: [],
  targetProfiles: ["cli"],
  generatedModules: ["generated/state_handles.air"]
}, null, 2));

const missingHandles = JSON.parse(runAircFails(["package-check", handlePackage, "--profile", "cli", "--source-only", "--json"]).stdout);
assert.strictEqual(missingHandles.status, "fail");
assert(missingHandles.diagnostics.some((diagnostic) => diagnostic.code === "air.generated.state_handles_missing"));

const generateStateHandles = JSON.parse(runAirc(["generate", "state-handles", handlePackage, "--json"]));
assert.deepStrictEqual(generateStateHandles.written, [
  "generated/state_handles.air",
  "generated/state_handles.meta.json"
]);
const stateHandlesAir = fs.readFileSync(path.join(handlePackage, "generated", "state_handles.air"), "utf8");
assert.match(stateHandlesAir, /const STATE_BOARD_ID:i32 = 1/);
assert.match(stateHandlesAir, /const STATE_BOARD_LEN:i32 = 4/);
assert.match(stateHandlesAir, /const STATE_BOARD_BYTES:i32 = 16/);
assert.match(stateHandlesAir, /const STATE_BOARD_CELL_I32:i32 = 1/);
assert.doesNotMatch(stateHandlesAir, /export func/);
assert.doesNotMatch(stateHandlesAir, /__air_state_/);
runAirc(["verify", "--library", path.join(handlePackage, "generated", "state_handles.air")]);

const stateHandlesMeta = JSON.parse(fs.readFileSync(path.join(handlePackage, "generated", "state_handles.meta.json"), "utf8"));
assert.strictEqual(stateHandlesMeta.schemaVersion, "0.24");
assert.strictEqual(stateHandlesMeta.kind, "air.generatedStateHandles");
assert.strictEqual(stateHandlesMeta.generator, "airc state-handles");
assert.deepStrictEqual(stateHandlesMeta.states, [{
  name: "board",
  id: 1,
  cellType: "i32",
  length: 4,
  byteSize: 16
}]);
assert.match(stateHandlesMeta.sourceModules[0].fingerprint, /^sha256:[a-f0-9]{64}$/);
assert.match(stateHandlesMeta.generatedFiles[0].fingerprint, /^sha256:[a-f0-9]{64}$/);

const handleCheck = JSON.parse(runAirc(["package-check", handlePackage, "--profile", "cli", "--source-only", "--json"]));
assert.strictEqual(handleCheck.status, "pass");
assert.strictEqual(handleCheck.stateHandleSets.length, 1);
assert.strictEqual(handleCheck.stateHandleSets[0].status, "fresh");
assert.strictEqual(handleCheck.stateHandleSets[0].states[0].name, "board");
assert.deepStrictEqual(handleCheck.stateHandleSets[0].diagnostics, []);

const handleReport = JSON.parse(runAirc(["report", "package", handlePackage, "--json"]));
assert.strictEqual(handleReport.status, "pass");
assert.strictEqual(handleReport.stateHandleSets[0].status, "fresh");

const handleEvidence = JSON.parse(runAirc(["verify", "package", handlePackage, "--profile", "cli", "--json"]));
assert.strictEqual(handleEvidence.status, "passed");
assert.strictEqual(handleEvidence.stateHandleSets[0].status, "fresh");
assert.strictEqual(handleEvidence.stateHandleSets[0].states[0].byteSize, 16);

fs.writeFileSync(path.join(handlePackage, "main.air"), validSource.replace("state board:i32[4] = fill 0", "state board:i32[5] = fill 0"));
const staleHandles = JSON.parse(runAircFails(["package-check", handlePackage, "--profile", "cli", "--source-only", "--json"]).stdout);
assert.strictEqual(staleHandles.status, "fail");
assert(staleHandles.diagnostics.some((diagnostic) => diagnostic.code === "air.generated.state_handles_stale"));
fs.writeFileSync(path.join(handlePackage, "main.air"), validSource);
runAirc(["generate", "state-handles", handlePackage]);

const mismatchedMetaPath = path.join(handlePackage, "generated", "state_handles.meta.json");
const mismatchedMeta = JSON.parse(fs.readFileSync(mismatchedMetaPath, "utf8"));
mismatchedMeta.states[0].length = 99;
fs.writeFileSync(mismatchedMetaPath, JSON.stringify(mismatchedMeta, null, 2));
const mismatchedHandles = JSON.parse(runAircFails(["package-check", handlePackage, "--profile", "cli", "--source-only", "--json"]).stdout);
assert.strictEqual(mismatchedHandles.status, "fail");
assert(mismatchedHandles.diagnostics.some((diagnostic) => diagnostic.code === "air.generated.state_handles_mismatch"));
runAirc(["generate", "state-handles", handlePackage]);

fs.rmSync(path.join(handlePackage, "generated", "state_handles.air"));
const missingGeneratedAir = JSON.parse(runAircFails(["package-check", handlePackage, "--profile", "cli", "--source-only", "--json"]).stdout);
assert.strictEqual(missingGeneratedAir.status, "fail");
assert(missingGeneratedAir.diagnostics.some((diagnostic) => diagnostic.code === "air.generated.state_handles_missing"));

const accessorPackage = fs.mkdtempSync(path.join(os.tmpdir(), "air-state-accessor-policy-"));
const accessorSource = `module state_accessor_policy
state board:i32[4] = fill 0
capabilities { }

export func board_cell(index: i32) -> i32 {
entry:
  %value:i32 = state.get board, %index
  return %value
}

func private_cell(index: i32) -> i32 {
entry:
  %value:i32 = state.get board, %index
  return %value
}

export func unsafe_write(index: i32) -> i32 {
entry:
  state.set board, %index, 7
  %value:i32 = state.get board, %index
  return %value
}
`;
fs.writeFileSync(path.join(accessorPackage, "main.air"), accessorSource);
fs.writeFileSync(path.join(accessorPackage, "air.package.json"), JSON.stringify({
  name: "state-accessor-policy-package",
  version: "0.1.0",
  airAbi: "0.10",
  hostAbi: "0.10",
  entry: "main.air",
  capabilities: [],
  targetProfiles: ["cli"]
}, null, 2));
writeJson(path.join(accessorPackage, "state_accessors.policy.json"), {
  schemaVersion: "0.24",
  kind: "air.stateAccessorPolicy",
  helpers: [{
    name: "board_cell",
    state: "board",
    mode: "readCell",
    exported: true,
    observationOnly: true
  }]
});
const accessorCheck = JSON.parse(runAirc(["package-check", accessorPackage, "--profile", "cli", "--source-only", "--json"]));
assert.strictEqual(accessorCheck.status, "pass");
assert.strictEqual(accessorCheck.stateAccessorPolicies.length, 1);
assert.strictEqual(accessorCheck.stateAccessorPolicies[0].status, "pass");
assert.strictEqual(accessorCheck.stateAccessorPolicies[0].helpers[0].name, "board_cell");
assert.strictEqual(accessorCheck.stateAccessorPolicies[0].helpers[0].status, "pass");

const accessorReport = JSON.parse(runAirc(["report", "package", accessorPackage, "--json"]));
assert.strictEqual(accessorReport.status, "pass");
assert.strictEqual(accessorReport.stateAccessorPolicies[0].status, "pass");

const accessorEvidence = JSON.parse(runAirc(["verify", "package", accessorPackage, "--profile", "cli", "--json"]));
assert.strictEqual(accessorEvidence.status, "passed");
assert.strictEqual(accessorEvidence.stateAccessorPolicies[0].helpers[0].observationOnly, true);
assert.strictEqual(accessorEvidence.stateAccessorPolicies[0].helpers[0].status, "pass");

writeJson(path.join(accessorPackage, "state_accessors.policy.json"), {
  schemaVersion: "0.24",
  kind: "air.stateAccessorPolicy",
  helpers: [{ name: "missing_cell", state: "board", mode: "readCell", exported: true, observationOnly: true }]
});
const missingAccessor = JSON.parse(runAircFails(["package-check", accessorPackage, "--profile", "cli", "--source-only", "--json"]).stdout);
assert.strictEqual(missingAccessor.status, "fail");
assert(missingAccessor.diagnostics.some((diagnostic) => diagnostic.code === "air.state.accessor_missing"));

writeJson(path.join(accessorPackage, "state_accessors.policy.json"), {
  schemaVersion: "0.24",
  kind: "air.stateAccessorPolicy",
  helpers: [{ name: "board_cell", state: "missing", mode: "readCell", exported: true, observationOnly: true }]
});
const unknownStateAccessor = JSON.parse(runAircFails(["package-check", accessorPackage, "--profile", "cli", "--source-only", "--json"]).stdout);
assert.strictEqual(unknownStateAccessor.status, "fail");
assert(unknownStateAccessor.diagnostics.some((diagnostic) => diagnostic.code === "air.state.accessor_unknown_state"));

writeJson(path.join(accessorPackage, "state_accessors.policy.json"), {
  schemaVersion: "0.24",
  kind: "air.stateAccessorPolicy",
  helpers: [{ name: "private_cell", state: "board", mode: "readCell", exported: true, observationOnly: true }]
});
const privateAccessor = JSON.parse(runAircFails(["package-check", accessorPackage, "--profile", "cli", "--source-only", "--json"]).stdout);
assert.strictEqual(privateAccessor.status, "fail");
assert(privateAccessor.diagnostics.some((diagnostic) => diagnostic.code === "air.state.accessor_export_mismatch"));

writeJson(path.join(accessorPackage, "state_accessors.policy.json"), {
  schemaVersion: "0.24",
  kind: "air.stateAccessorPolicy",
  helpers: [{ name: "unsafe_write", state: "board", mode: "readCell", exported: true, observationOnly: true }]
});
const unsafeAccessor = JSON.parse(runAircFails(["package-check", accessorPackage, "--profile", "cli", "--source-only", "--json"]).stdout);
assert.strictEqual(unsafeAccessor.status, "fail");
assert(unsafeAccessor.diagnostics.some((diagnostic) =>
  diagnostic.code === "air.state.accessor_not_observation_safe" &&
  diagnostic.fields.reason === "state_write"));

const hostAccessorPackage = fs.mkdtempSync(path.join(os.tmpdir(), "air-state-accessor-host-"));
fs.writeFileSync(path.join(hostAccessorPackage, "main.air"), `module state_accessor_host_policy
state board:i32[4] = fill 0
capabilities { debug }
effects { debug.metric <= 1 }

extern debug.metric(id: i32, value: i32) -> void

export func board_cell(index: i32) -> i32 {
entry:
  %value:i32 = state.get board, %index
  @debug.metric(1, %value)
  return %value
}
`);
fs.writeFileSync(path.join(hostAccessorPackage, "air.package.json"), JSON.stringify({
  name: "state-accessor-host-policy-package",
  version: "0.1.0",
  airAbi: "0.10",
  hostAbi: "0.10",
  entry: "main.air",
  capabilities: ["debug"],
  targetProfiles: ["cli"]
}, null, 2));
writeJson(path.join(hostAccessorPackage, "state_accessors.policy.json"), {
  schemaVersion: "0.24",
  kind: "air.stateAccessorPolicy",
  helpers: [{ name: "board_cell", state: "board", mode: "readCell", exported: true, observationOnly: true }]
});
const hostAccessor = JSON.parse(runAircFails(["package-check", hostAccessorPackage, "--profile", "cli", "--source-only", "--json"]).stdout);
assert.strictEqual(hostAccessor.status, "fail");
assert(hostAccessor.diagnostics.some((diagnostic) =>
  diagnostic.code === "air.state.accessor_not_observation_safe" &&
  diagnostic.fields.reason === "host_call"));

const memoryAccessorPackage = fs.mkdtempSync(path.join(os.tmpdir(), "air-state-accessor-memory-"));
fs.writeFileSync(path.join(memoryAccessorPackage, "main.air"), `module state_accessor_memory_policy
state board:i32[4] = fill 0
global last:i32 = const.i32 0
capabilities { }

export func writes_memory(index: i32) -> i32 {
entry:
  %bytes:i32 = const.i32 4
  %ptr:ptr = alloc_region %bytes
  %off:i32 = const.i32 0
  store.i32 %ptr, %off, %index
  free_region %ptr
  return %index
}

export func writes_global(index: i32) -> i32 {
entry:
  global.set last, %index
  return %index
}

export func ptr_helper(index: i32) -> ptr {
entry:
  %bytes:i32 = const.i32 4
  %ptr:ptr = alloc_region %bytes
  free_region %ptr
  return %ptr
}
`);
fs.writeFileSync(path.join(memoryAccessorPackage, "air.package.json"), JSON.stringify({
  name: "state-accessor-memory-policy-package",
  version: "0.1.0",
  airAbi: "0.10",
  hostAbi: "0.10",
  entry: "main.air",
  capabilities: [],
  targetProfiles: ["cli"]
}, null, 2));
writeJson(path.join(memoryAccessorPackage, "state_accessors.policy.json"), {
  schemaVersion: "0.24",
  kind: "air.stateAccessorPolicy",
  helpers: [
    { name: "writes_memory", state: "board", mode: "readCell", exported: true, observationOnly: true },
    { name: "writes_global", state: "board", mode: "readCell", exported: true, observationOnly: true },
    { name: "ptr_helper", state: "board", mode: "readCell", exported: true, observationOnly: true }
  ]
});
const memoryAccessor = JSON.parse(runAircFails(["package-check", memoryAccessorPackage, "--profile", "cli", "--source-only", "--json"]).stdout);
assert.strictEqual(memoryAccessor.status, "fail");
assert(memoryAccessor.diagnostics.some((diagnostic) =>
  diagnostic.code === "air.state.accessor_not_observation_safe" &&
  diagnostic.fields.reason === "memory_write"));
assert(memoryAccessor.diagnostics.some((diagnostic) =>
  diagnostic.code === "air.state.accessor_not_observation_safe" &&
  diagnostic.fields.reason === "global_write"));
assert(memoryAccessor.diagnostics.some((diagnostic) => diagnostic.code === "air.state.accessor_return_invalid"));

assert.strictEqual(AIR_ABI_VERSION, "0.10");
assert.strictEqual(HOST_ABI_VERSION, "0.10");

runLoweringTests().then(() => {
  console.log("fixed state parser diagnostics and lowering tests passed");
}).catch((error) => {
  console.error(error);
  process.exit(1);
});

function runAirc(args) {
  return cp.execFileSync(process.execPath, [airc, ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function runAircFails(args) {
  try {
    runAirc(args);
  } catch (err) {
    return {
      stdout: err.stdout || "",
      stderr: err.stderr || "",
      message: err.message
    };
  }
  throw new Error(`expected command to fail: ${args.join(" ")}`);
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function runLoweringTests() {
  const wat = lowerToWat(mod);
  assert.match(wat, /\(global \$__air_state_board_0 \(mut i32\) \(i32\.const 0\)\)/);
  assert.match(wat, /\(global \$__air_state_board_3 \(mut i32\) \(i32\.const 0\)\)/);
  assert.doesNotMatch(wat, /\(export "__air_state/);
  assert.doesNotMatch(wat, /\(import /);
  assert.strictEqual(wat, lowerToWat(parseAir(validSource, "<fixed-state-deterministic>")));

  const wasm = await watToWasm(wat, "fixed-state.air");
  const first = await WebAssembly.instantiate(wasm, {});
  assert.strictEqual(first.instance.exports.state_length(), 4);
  assert.strictEqual(first.instance.exports.read_cell(2), 0);
  assert.strictEqual(first.instance.exports.write_cell(2, 99), 99);
  assert.strictEqual(first.instance.exports.read_cell(2), 99);
  assert.throws(() => first.instance.exports.read_cell(4), WebAssembly.RuntimeError);
  assert.throws(() => first.instance.exports.write_cell(-1, 7), WebAssembly.RuntimeError);

  const second = await WebAssembly.instantiate(wasm, {});
  assert.strictEqual(second.instance.exports.read_cell(2), 0);

  const nonZeroWat = lowerToWat(nonZeroFill);
  assert.match(nonZeroWat, /\(global \$__air_state_counters_0 \(mut i32\) \(i32\.const -7\)\)/);
  const nonZeroWasm = await watToWasm(nonZeroWat, "fixed-state-nonzero.air");
  const nonZeroInstance = await WebAssembly.instantiate(nonZeroWasm, {});
  assert.strictEqual(nonZeroInstance.instance.exports.read(), -7);
}
