"use strict";
// SEC53-09: the signed i32 range at the four call sites outside air.run (the e2e proof's fixture facts, conformance replay's step and
// state-digest helper arguments, and the runtime benchmark's arguments). An argument to a parameter that is i32 in Wasm (i32, bool,
// ptr, slice, borrowed_slice) must be a boolean or a signed i32; other parameter types keep today's conversion. The arguments go to
// Wasm lanes: a borrowed slice is two i32 lanes, pointer and length. The rows are SPEC VECTORS.md's: E, C and B on single-module
// packages, C-L on linked multi-module packages (SEC53-02 OD-S2-5 (a)), and C-S and B-S on borrowed-slice exports.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const air = require("../src");
const { createE2eProofReport } = require("../src/e2e_proof");
const { createConformanceReplayReport } = require("../src/conformance_replay");
const { createBenchmarkReport } = require("../src/benchmark_report");
const { buildLinkedPackage } = require("../src/linked_package");

const tmp = path.join(root, "build", "v053-other-entry-argument-range");
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });
const P31 = 2 ** 31;
const F32_EXPORT = "\nexport func echo_f32(x: f32) -> f32 {\nentry:\n  return %x\n}\n";
const COPY_SOURCE = () => fs.readFileSync(path.join(root, "examples", "borrowed_slices", "wasm", "copy_final_i32.air"), "utf8");
const MIXED_SOURCE = "module slice_then_scalars\n\ncapabilities { }\n\nexport func k(s: borrowed_slice<readonly,len<=8,align=4>, x: f32, y: i32) -> i32 {\nentry:\n  return %y\n}\n";
let counter = 0;
const fresh = (label) => path.join(tmp, `${label}-${(counter += 1)}`);
const step = (args, ret, exportName = "write_cell") => [{ id: "row", call: { export: exportName, args }, expect: { return: ret } }];

const E2E_PKG = path.join(root, "examples", "lan_observer_readonly_package");
async function e2e(change) {
  const fixture = JSON.parse(fs.readFileSync(path.join(E2E_PKG, "traces", "pass.json"), "utf8"));
  Object.assign(fixture.rowsets[0].rows[0], change);
  const file = `${fresh("fixture")}.json`;
  fs.writeFileSync(file, JSON.stringify(fixture));
  const report = await createE2eProofReport(E2E_PKG, { fixture: file, policy: path.join(E2E_PKG, "host_policies", "lan_observer_readonly.policy.json"), profile: "cli" });
  return { status: report.status, text: JSON.stringify(report) };
}

async function statePackage(extraSource = "") {
  const dir = fresh("state");
  fs.cpSync(path.join(root, "test", "fixtures", "conformance_state"), dir, { recursive: true });
  const sourcePath = path.join(dir, "module.air");
  if (extraSource) fs.appendFileSync(sourcePath, extraSource);
  const mod = air.parseAir(fs.readFileSync(sourcePath, "utf8"), sourcePath);
  air.verifyModule(mod);
  fs.writeFileSync(path.join(dir, "module.wasm"), Buffer.from(await air.watToWasm(air.lowerToWat(mod), sourcePath)));
  return dir;
}

async function sourcePackage(name, source) {
  const dir = fresh(name);
  fs.mkdirSync(path.join(dir, "traces"), { recursive: true });
  fs.writeFileSync(path.join(dir, "air.package.json"), `${JSON.stringify({ name, version: "0.1.0", airAbi: "0.10", hostAbi: "0.10", entry: "module.air", wasm: "module.wasm", capabilities: [], targetProfiles: ["cli"] }, null, 2)}\n`);
  const sourcePath = path.join(dir, "module.air");
  fs.writeFileSync(sourcePath, source);
  const mod = air.parseAir(source, sourcePath);
  air.verifyModule(mod);
  fs.writeFileSync(path.join(dir, "module.wasm"), Buffer.from(await air.watToWasm(air.lowerToWat(mod), sourcePath)));
  return { dir, name };
}

async function sliceReplay(name, source, exportName, args, ret) {
  const pkg = await sourcePackage(name, source);
  const tracePath = path.join(pkg.dir, "traces", "row.json");
  fs.writeFileSync(tracePath, JSON.stringify({ schemaVersion: "0.16", kind: "air.conformance.trace", id: "row", package: name, profile: "cli", steps: step(args, ret, exportName) }));
  try {
    return replayResult(await createConformanceReplayReport(pkg.dir, { profile: "cli", trace: tracePath }));
  } catch (error) {
    return { threw: String(error && error.message) };
  }
}

async function sliceBenchmark(name, source, exportName, args) {
  const pkg = await sourcePackage(name, source);
  const dir = fresh("bench");
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "benchmark.json"), JSON.stringify({ schemaVersion: "0.29", kind: "air.benchmark", benchmarkName: name, benchmarkId: name, packageDir: pkg.dir, profile: "cli", buildWasm: true, repeat: 1, runtime: { export: exportName, args } }));
  const report = await createBenchmarkReport(dir, { cwd: dir });
  return { status: report.status, diagnostics: (report.diagnostics || []).map((d) => `${d.severity}: ${d.code}: ${String(d.message)}`) };
}

function replayResult(report) {
  return { status: report.status, steps: report.steps.map((s) => ({ observed: s.observed })), mismatches: report.mismatches.map((m) => `${m.code || m.kind}: ${m.message || ""}`) };
}

async function conformance({ steps, helpers, extraSource } = {}) {
  const dir = await statePackage(extraSource);
  const trace = JSON.parse(fs.readFileSync(path.join(dir, "traces", "pass.json"), "utf8"));
  if (steps) trace.steps = steps;
  if (helpers) trace.stateDigest.helpers = helpers;
  if (steps || helpers) delete trace.stateDigest.expected;
  if (!trace.stateDigest.expected && trace.stateDigest) trace.stateDigest = steps && !helpers ? undefined : trace.stateDigest;
  const tracePath = path.join(dir, "traces", "row.json");
  fs.writeFileSync(tracePath, JSON.stringify(trace));
  try {
    return replayResult(await createConformanceReplayReport(dir, { profile: "cli", trace: tracePath }));
  } catch (error) {
    return { threw: String(error && error.message) };
  }
}

async function linked({ fixture, exports: packageExports, exportName, args, ret }) {
  const dir = fresh("linked");
  fs.cpSync(path.join(root, fixture), dir, { recursive: true });
  const manifestPath = path.join(dir, "air.package.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.wasm = "linked.wasm";
  if (packageExports) manifest.packageExports = packageExports;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await buildLinkedPackage(dir, path.join(dir, "linked.wasm"), { profile: "cli" });
  fs.mkdirSync(path.join(dir, "traces"), { recursive: true });
  const tracePath = path.join(dir, "traces", "row.json");
  fs.writeFileSync(tracePath, JSON.stringify({ schemaVersion: "0.16", kind: "air.conformance.trace", id: "row", package: manifest.name, profile: "cli", steps: step(args, ret, exportName) }));
  try {
    return replayResult(await createConformanceReplayReport(dir, { profile: "cli", trace: tracePath }));
  } catch (error) {
    return { threw: String(error && error.message) };
  }
}

async function benchmark({ args, exportName, extraSource } = {}) {
  const dir = fresh("bench");
  fs.mkdirSync(dir);
  const pkg = await statePackage(extraSource);
  const config = JSON.parse(fs.readFileSync(path.join(root, "benchmarks", "fixed_state_basic", "benchmark.json"), "utf8"));
  config.packageDir = pkg;
  config.trace = path.join(pkg, "traces", "pass.json");
  config.repeat = 1;
  if (exportName) config.runtime.export = exportName;
  if (args) config.runtime.args = args;
  fs.writeFileSync(path.join(dir, "benchmark.json"), JSON.stringify(config));
  const report = await createBenchmarkReport(dir, { cwd: dir });
  return { status: report.status, diagnostics: (report.diagnostics || []).map((d) => `${d.severity}: ${d.code}: ${String(d.message)}`) };
}

const refusedE2e = (key) => (g) => g.status === "failed" && g.text.includes(`fixture fact ${key} must be an i32`);
const refusedStep = (n) => (g) => !g.threw && g.status === "fail" && g.steps.length === 0 && g.mismatches.includes(`air.conformance.wrong_args: trace step row argument ${n} must be a signed i32`);
const refusedStepAt = (id, n) => (g) => !g.threw && g.status === "fail" && g.steps.length === 0 && g.mismatches.includes(`air.conformance.wrong_args: trace step ${id} argument ${n} must be a signed i32`);
const refusedHelper = (n) => (g) => Boolean(g.threw) && g.threw.includes(`trace.stateDigest.helpers[0].args[${n}] must be i32`);
const ranStep = (ret) => (g) => !g.threw && g.status === "pass" && g.steps.length === 1 && g.steps[0].observed.return === ret;
const refusedBench = (n) => (g) => g.diagnostics.some((d) => d.includes(`air.benchmark.argument_invalid: runtime.args[${n}] must be a signed i32`));
const ranBench = (g) => !g.diagnostics.some((d) => d.includes("argument_invalid") || d.includes("runtime_unavailable"));
const COMPOSITION = path.join("test", "fixtures", "package_composition", "conformance_multi_module");
const POLICY = path.join("examples", "policy_audit_package");
const PLUS2 = [{ name: "plus2", module: "math.air", function: "add_two" }];

const ROWS = [
  ["E-P1", "e2e proof: the shipped fixture", () => e2e({}), (g) => g.status === "passed"],
  ["E-P2", "e2e proof: latency_ms = 2^31 - 1", () => e2e({ latency_ms: P31 - 1 }), (g) => !g.text.includes("must be an i32")],
  ["E-N1", "e2e proof: latency_ms = 2^31 is refused", () => e2e({ latency_ms: P31 }), refusedE2e("latency_ms")],
  ["E-N2", "e2e proof: observation_age_ms = -2^31 - 1 is refused", () => e2e({ observation_age_ms: -P31 - 1 }), refusedE2e("observation_age_ms")],
  ["C-P1", "conformance: the shipped state trace", () => conformance(), (g) => !g.threw && g.status === "pass"],
  ["C-P2", "conformance: write_cell(2, 2^31 - 1)", () => conformance({ steps: step([2, P31 - 1], P31 - 1) }), ranStep(P31 - 1)],
  ["C-P3", "conformance: write_cell(2, -2^31)", () => conformance({ steps: step([2, -P31], -P31) }), ranStep(-P31)],
  ["C-B1", "conformance: write_cell(2, true), a boolean", () => conformance({ steps: step([2, true], 1) }), ranStep(1)],
  ["C-F1", "conformance: echo_f32(3000000000), an f32 parameter", () => conformance({ steps: step([3000000000], 3000000000, "echo_f32"), extraSource: F32_EXPORT }), ranStep(3000000000)],
  ["C-N1", "conformance: write_cell(2, 2^31) is refused", () => conformance({ steps: step([2, P31], -P31) }), refusedStep(1)],
  ["C-N2", "conformance: write_cell(2, 2^32 + 1) is refused", () => conformance({ steps: step([2, 2 ** 32 + 1], 1) }), refusedStep(1)],
  ["C-N3", "conformance: write_cell(2, 1.5) is refused", () => conformance({ steps: step([2, 1.5], 1) }), refusedStep(1)],
  ["C-H1", "conformance: state-digest helper board_cell(2^31 + 2) is refused", () => conformance({ helpers: [{ export: "board_cell", args: [P31 + 2] }] }), refusedHelper(0)],
  ["C-N4", "conformance: write_cell(2, -2^31 - 1) is refused", () => conformance({ steps: step([2, -P31 - 1], P31 - 1) }), refusedStep(1)],
  ["C-N5", "conformance: write_cell(2, \"5\"), a string to an i32 parameter, is refused", () => conformance({ steps: step([2, "5"], 5) }), refusedStep(1)],
  ["C-N6", "conformance: write_cell(2, null) is refused", () => conformance({ steps: step([2, null], 0) }), refusedStep(1)],
  ["C-H2", "conformance: state-digest helper board_cell(-2^31 - 1) is refused", () => conformance({ helpers: [{ export: "board_cell", args: [-P31 - 1] }] }), refusedHelper(0)],
  ["C-S1", "conformance, borrowed slices: copy_final(0, 8, 64, 8, 2), five Wasm lanes", () => sliceReplay("slice-copy", COPY_SOURCE(), "copy_final", [0, 8, 64, 8, 2], 2), ranStep(2)],
  ["C-S2", "conformance, borrowed slices: copy_final count 2^32 + 2 (lane 4) is refused", () => sliceReplay("slice-copy", COPY_SOURCE(), "copy_final", [0, 8, 64, 8, 2 ** 32 + 2], 2), refusedStepAt("row", 4)],
  ["C-S3", "conformance, borrowed slice then f32: k(0, 8, 1.5, 7)", () => sliceReplay("slice-mixed", MIXED_SOURCE, "k", [0, 8, 1.5, 7], 7), ranStep(7)],
  ["C-S4", "conformance, borrowed slice then f32 and i32: k(0, 8, 1, 2^32 + 7), lane 3, is refused", () => sliceReplay("slice-mixed", MIXED_SOURCE, "k", [0, 8, 1, 2 ** 32 + 7], 7), refusedStepAt("row", 3)],
  ["X-PTR1", "conformance, a ptr parameter: pf(2^32 + 5, 1), lane 0, is refused (QA's N1)", () => sliceReplay("ptr-param", "module ptr_param\n\ncapabilities { }\n\nexport func pf(x: ptr, y: i32) -> i32 {\nentry:\n  return %y\n}\n", "pf", [2 ** 32 + 5, 1], 1), refusedStepAt("row", 0)],
  ["X-BOOL1", "conformance, a bool parameter: bf(2^32 + 1, 1), lane 0, is refused (QA's N1)", () => sliceReplay("bool-param", "module bool_param\n\ncapabilities { }\n\nexport func bf(x: bool, y: i32) -> i32 {\nentry:\n  return %y\n}\n", "bf", [2 ** 32 + 1, 1], 1), refusedStepAt("row", 0)],
  ["C-L1", "conformance, linked: plus2 (math.air's add_two), 2^32 + 7 is refused", () => linked({ fixture: COMPOSITION, exports: PLUS2, exportName: "plus2", args: [2 ** 32 + 7], ret: 9 }), refusedStep(0)],
  ["C-L2", "conformance, linked: plus2(7)", () => linked({ fixture: COMPOSITION, exports: PLUS2, exportName: "plus2", args: [7], ret: 9 }), ranStep(9)],
  ["C-L3", "conformance, linked: run(2^32 + 7) is refused", () => linked({ fixture: COMPOSITION, exportName: "run", args: [2 ** 32 + 7], ret: 9 }), refusedStep(0)],
  ["C-L4", "conformance, linked: policy_audit_package service_retry_budget_ms(1)", () => linked({ fixture: POLICY, exportName: "service_retry_budget_ms", args: [1], ret: 250 }), ranStep(250)],
  ["C-L5", "conformance, linked: policy_audit_package service_retry_budget_ms(2^32 + 1) is refused", () => linked({ fixture: POLICY, exportName: "service_retry_budget_ms", args: [2 ** 32 + 1], ret: 250 }), refusedStep(0)],
  ["B-P1", "benchmark: the shipped config, write_cell(1, 7)", () => benchmark(), ranBench],
  ["B-F1", "benchmark: echo_f32(3000000000), an f32 parameter", () => benchmark({ exportName: "echo_f32", args: [3000000000], extraSource: F32_EXPORT }), ranBench],
  ["B-N1", "benchmark: write_cell(1, 2^31) is refused before the timed calls", () => benchmark({ args: [1, P31] }), refusedBench(1)],
  ["B-N2", "benchmark: write_cell(-2^31 - 1, 7) is refused before the timed calls", () => benchmark({ args: [-P31 - 1, 7] }), refusedBench(0)],
  ["B-N3", "benchmark: write_cell(1, 1.5) is refused before the timed calls", () => benchmark({ args: [1, 1.5] }), refusedBench(1)],
  ["B-B1", "benchmark: write_cell(1, true), a boolean", () => benchmark({ args: [1, true] }), ranBench],
  ["B-S1", "benchmark, borrowed slices: copy_final count 2^32 + 2 (lane 4) is refused before the timed calls", () => sliceBenchmark("slice-copy", COPY_SOURCE(), "copy_final", [0, 8, 64, 8, 2 ** 32 + 2]), refusedBench(4)],
  ["B-S2", "benchmark, borrowed slice then f32: k(0, 8, 1.5, 7)", () => sliceBenchmark("slice-mixed", MIXED_SOURCE, "k", [0, 8, 1.5, 7]), ranBench]
];

(async () => {
  const failures = [];
  for (const [id, what, make, check] of ROWS) {
    let got;
    try { got = await make(); } catch (error) { got = { error: `${error && error.name}: ${String(error && error.message)}` }; }
    const pass = !got.error && check(got);
    if (pass) {
      console.log(`ok - SEC53-09 ${id} ${what}`);
    } else {
      console.log(`not ok - SEC53-09 ${id} ${what}`);
      failures.push(`${id}: ${JSON.stringify(got).slice(0, 300)}`);
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  assert.deepEqual(failures, [], failures.join("\n"));
  console.log(`SEC53-09 argument range: ${ROWS.length} PASS`);
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
