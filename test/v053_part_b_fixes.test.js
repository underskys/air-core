#!/usr/bin/env node
"use strict";

// SEC53-10 (AIR_V053_SEC53_10_PART_B_FIXES_SPEC_R3_2026_11_16, SHA256SUMS d5b2dc78...; admitted 2026-11-16 with OD-S10-1, 2, 3 and 5
// (a) and OD-S10-4 (b); with its erratum 1, AIR_V053_SEC53_10_PART_B_FIXES_SPEC_R3_ERRATUM_1_2026_11_17, SHA256SUMS 7df65949...):
// P0-13 part B's three fixes. The rows are VECTORS.md's and the erratum's, run with this tree's own src/ and bin/:
// - section 1, F-B7-1: an f32 argument at the five entries T, L, S, C and D passes only when binary32 holds it exactly;
// - section 2, F-B1-1: a state.set whose operands hold CR, U+2028 or U+2029 is a coded refusal, never a raw TypeError;
// - section 3, F-B8-1 in M(): an import outside the input's folder is M()'s containment refusal, with no record;
// - section 4, F-B8-1 for legacy-v0.50 single files: the same containment, and SEC53-01's admission inside the folder.
// Every N row also checks that nothing ran: no export call (T: no step4.invoke; C: no instantiation; D: no timed call; L and S: the
// refusal comes before the call), no outside file read (an fs tracer on the API rows; no outside byte in any CLI output), no record.
// Test characters are made with String.fromCharCode. NaN and 1n cannot be written in a JSON trace or benchmark config, so the C and D
// rows that need them hand them to the tree's own JSON.parse of that file (jsonValues below); -0 and the infinities are JSON text.
// Set AIR_SEC53_10_RESULTS_DIR=<dir> to write the results. The file runs on the base too, where the N rows are the expected failures.

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const AIRC = path.join(ROOT, "bin", "airc.js");
const STDLIB = path.join(ROOT, "stdlib");
const air = require("../src");
const raw = require("../src/raw");
const parser = require("../src/parser");
const sp = require("../src/source_profile");
const borrowedSlices = require("../src/borrowed_slices");
const { createConformanceReplayReport } = require("../src/conformance_replay");
const { createBenchmarkReport } = require("../src/benchmark_report");
const { buildLinkedPackage } = require("../src/linked_package");
const { isImportReadFailure, migrateV053 } = require("../src/migrate_v053");
const { AirLspSession, filePathToUri } = require("../src/lsp_server");

const V053 = Object.freeze({ sourceProfile: "typed-v0.53", allowCandidateProfile: true });
const UNCONTAINED = "air.package.path_uncontained";
const SECRET = "SECRET";
const work = fs.mkdtempSync(path.join(os.tmpdir(), "air-sec53-10-"));
let counter = 0;
const fresh = (label) => {
  const dir = path.join(work, `${label}-${(counter += 1)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const ch = (code) => String.fromCharCode(code);
const same = (a, b) => Object.is(a, b);
const shown = (value) => (typeof value === "bigint" ? `${value}n` : Object.is(value, -0) ? "-0" : typeof value === "string" ? JSON.stringify(value) : String(value));

// ---------------------------------------------------------------------------------------------------------------------------------
// Section 1: F-B7-1, the f32 values (SPEC section 2).

const ROUNDING = [["N1", 0.1], ["N2", 1e39], ["N3", -1e39], ["N4", 3.4028235677973366e38], ["N5", 1e-46], ["N6", 5e-324], ["N7", 16777217], ["N8", Number.MAX_VALUE]];
const EXACT = [["P1", 0.5], ["P2", 16777216], ["P3", 3.4028234663852886e38], ["P4", 1.1754943508222875e-38], ["P5", 1.401298464324817e-45], ["P6", 0], ["P7", -0],
  ["P8", NaN], ["P9", Infinity], ["P10", -Infinity]];
const NON_NUMBERS = [["X1", "0.5"], ["X2", null], ["X3", true], ["X4", 1n]];
for (const [, value] of ROUNDING) assert(!Object.is(Math.fround(value), value), "a rounding value binary32 does not hold");
for (const [, value] of EXACT) assert(Number.isNaN(value) || Object.is(Math.fround(value), value), "an exact value binary32 holds");
const FINITE = (value) => typeof value === "number" && Number.isFinite(value);

const TL_MESSAGE = "arguments.x must be an f32 value: a number binary32 holds exactly";
const S_MESSAGE = "arguments.x must be a finite f32 value binary32 holds exactly";
const C_MESSAGE = "trace step row argument 1 must be an f32 value binary32 holds exactly";
const D_MESSAGE = "air.benchmark.argument_invalid: runtime.args[1] must be an f32 value binary32 holds exactly";
const PKG = `sha256:${"c".repeat(64)}`;
const slot = (buffer, access = "readonly") => ({ access, aliasGroup: null, alignment: 4, buffer, maxLength: 4, memoryDomain: "wasm-linear", transferMode: "copied_into_wasm" });
const diagnosticsOf = (result) => (result && Array.isArray(result.diagnostics) ? result.diagnostics : []);

// T: the typed admission's invoke, part B's echo source with an i32 refinement export for F-T-K4.
const T_SOURCE = "module s10.f32echo\n\nexport func echo(b: borrowed_slice<readonly,len=4..4,align=4>, x: f32) -> f32 {\n  return %x\n}\n\n" +
  "export func ref(b: borrowed_slice<readonly,len=4..4,align=4>, n: i32<0..100>) -> i32<0..100> {\n  return %n\n}\n";
let typedBuilt = null;
async function typedInvoke(entrypoint, args) {
  if (!typedBuilt) {
    const descriptor = borrowedSlices.typedV053.interfaceDescriptor(parser.typedV053.parse(T_SOURCE, "t.air"));
    typedBuilt = await air.buildVerifiedTypedModule({ ...V053, descriptor, source: T_SOURCE });
  }
  const trace = [];
  const handle = await air.admitTypedV053Artifact({ record: typedBuilt, wasmBytes: typedBuilt.wasmBytes, trace });
  const result = await handle.invoke({ entrypoint, arguments: args, bindings: { b: slot(new Uint8Array(4)) } });
  return { result, invoked: trace.includes("step4.invoke") };
}
async function fT(value) {
  const { result, invoked } = await typedInvoke("echo", { x: value });
  const codes = diagnosticsOf(result).map((item) => item.code);
  const text = JSON.stringify(diagnosticsOf(result));
  return { refused: codes.includes("air.borrow.argument_invalid") && text.includes(TL_MESSAGE) && !invoked && (result.result === null || result.result === undefined), ran: invoked && codes.length === 0, echo: result.result, codes };
}

// L: a verified legacy instance with a borrowed slice and x: f32, through invokeBorrowedMemory, and through /raw's
// prepareRawBorrowedMemoryInvocation on a raw instance of the same bytes.
const L_SOURCE = "module s10_f32_lane\ncapabilities { }\nrequires export echo\nexport func echo(b: borrowed_slice<readonly,len=4..4,align=4>, x: f32) -> f32 {\nentry:\n  return %x\n}\n";
let lane = null;
async function laneOf() {
  if (!lane) {
    const mod = air.parseAir(L_SOURCE, "l.air", { resolveSourceImports: false });
    air.verifyModule(mod, { library: true });
    const wasmBytes = Buffer.from(await air.watToWasm(air.lowerToWat(mod), "l.air"));
    lane = {
      descriptor: air.borrowedSliceInterfaceDescriptor(mod),
      raw: await raw.instantiateRawWasm({ packageDigest: PKG, wasmBytes }),
      verified: await air.instantiateVerifiedAirModule({ library: true, packageDigest: PKG, source: L_SOURCE, sourceName: "l.air" })
    };
  }
  return lane;
}
async function fL(value) {
  const l = await laneOf();
  const options = (instance) => ({ arguments: { x: value }, bindings: { b: slot(new Uint8Array(4)) }, entrypoint: "echo", instance, interfaceDescriptor: l.descriptor, packageDigest: PKG });
  const result = air.invokeBorrowedMemory(options(l.verified));
  const codes = diagnosticsOf(result).map((item) => item.code);
  const text = JSON.stringify(diagnosticsOf(result));
  let rawOut;
  try {
    const prepared = raw.prepareRawBorrowedMemoryInvocation(options(l.raw));
    const ran = prepared.invoke();
    const rawCodes = diagnosticsOf(ran).map((item) => item.code);
    rawOut = rawCodes.length ? { refused: rawCodes.includes("air.borrow.argument_invalid") && JSON.stringify(diagnosticsOf(ran)).includes(TL_MESSAGE), atInvoke: true } : { echo: ran.result, ran: true };
  } catch (error) {
    rawOut = { refused: error && error.code === "air.borrow.argument_invalid" && String(error.message).includes(TL_MESSAGE), atPrepare: true };
  }
  const refused = codes.includes("air.borrow.argument_invalid") && text.includes(TL_MESSAGE) && result.result === null && result.evidence && result.evidence.status === "failed";
  return { refused: refused && rawOut.refused === true && rawOut.atPrepare === true, ran: codes.length === 0 && rawOut.ran === true, echo: result.result, rawEcho: rawOut.echo, codes, rawOut };
}

// S: a verified execution session on a certified package whose entry stores x (f32) into its output slice and takes y (f64).
const S_SOURCE = "module s10_realtime_f32\n\ncapabilities { }\nrequires export step\n\n" +
  "export func step(input: borrowed_slice<readonly,len=4..4,align=4>, output: borrowed_slice<writeonly,len=4..4,align=4>, state: borrowed_slice<readwrite,len=4..4,align=4>, x: f32, y: f64) -> i32 {\n" +
  "entry:\n  slice.store.f32 %output, 0, %x\n  %zero:i32 = 0\n  return %zero\n}\n";
let sessionPackage = null;
async function sessionPackageOf() {
  if (!sessionPackage) {
    const dir = fresh("session");
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "examples", "realtime_safe", "air.package.json"), "utf8"));
    manifest.name = "realtime-safe-sec53-10";
    fs.writeFileSync(path.join(dir, "module.air"), S_SOURCE);
    fs.writeFileSync(path.join(dir, "air.package.json"), JSON.stringify(manifest, null, 2));
    const mod = air.parseAir(S_SOURCE, path.join(dir, "module.air"));
    air.verifyModule(mod);
    fs.writeFileSync(path.join(dir, "module.wasm"), Buffer.from(await air.watToWasm(air.lowerToWat(mod), path.join(dir, "module.air"))));
    sessionPackage = { certificate: air.createPackageResourceCertificate(dir, { certificateRequired: true }), dir };
  }
  return sessionPackage;
}
const view = (byteOffset, access) => ({ access, actualLength: 4, aliasGroup: null, alignment: 4, byteOffset, maxLength: 4, memoryDomain: "wasm-linear", transferMode: "wasm_memory_view" });
async function fS(value, y = 0.5) {
  const pkg = await sessionPackageOf();
  let session;
  try {
    session = await air.createVerifiedExecutionSession({ arguments: { x: value, y }, entrypoint: "step", memoryPlan: { input: view(0, "readonly"), output: view(16, "writeonly"), state: view(32, "readwrite") },
      packageDir: pkg.dir, resourceCertificate: pkg.certificate });
  } catch (error) {
    return { refused: error && error.code === "air.realtime.argument_invalid" && String(error.message).includes(S_MESSAGE), code: error && error.code, message: String(error && error.message) };
  }
  const result = session.invoke();
  const output = session.memoryView("output");
  return { ran: result === 0, echo: new DataView(output.buffer, output.byteOffset, output.byteLength).getFloat32(0, true) };
}

// C and D: an export (n: i32, x: f32, y: f64), by the entry's lowering and by a linked package's; D through a benchmark config.
const C_EXPORTS = "\nexport func fx(n: i32, x: f32, y: f64) -> f32 {\nentry:\n  return %x\n}\n\nexport func fy(n: i32, x: f32, y: f64) -> f64 {\nentry:\n  return %y\n}\n";
const SENTINELS = { "__s10_NaN__": NaN, "__s10_1n__": 1n };
function jsonValue(value) {
  if (Number.isNaN(value)) return JSON.stringify("__s10_NaN__");
  if (typeof value === "bigint") return JSON.stringify("__s10_1n__");
  if (Object.is(value, -0)) return "-0";
  if (value === Infinity) return "1e999";
  if (value === -Infinity) return "-1e999";
  return JSON.stringify(value);
}
async function jsonValues(fn) {
  const original = JSON.parse;
  JSON.parse = function parseWithSentinels(text, reviver) {
    return original.call(this, text, function revive(key, value) {
      const next = typeof value === "string" && Object.prototype.hasOwnProperty.call(SENTINELS, value) ? SENTINELS[value] : value;
      return reviver ? reviver.call(this, key, next) : next;
    });
  };
  try {
    return await fn();
  } finally {
    JSON.parse = original;
  }
}
async function counted(fn) {
  const original = WebAssembly.instantiate;
  const tally = { calls: [], instantiations: 0 };
  WebAssembly.instantiate = async function countingInstantiate(...args) {
    tally.instantiations += 1;
    const loaded = await original.apply(this, args);
    const instance = loaded.instance || loaded;
    const exports = {};
    for (const [name, item] of Object.entries(instance.exports)) {
      exports[name] = typeof item === "function" ? (...lanes) => { const call = { lanes, name }; tally.calls.push(call); call.returned = item(...lanes); return call.returned; } : item;
    }
    return loaded.instance ? { instance: { exports }, module: loaded.module } : { exports };
  };
  try {
    return { tally, value: await fn() };
  } finally {
    WebAssembly.instantiate = original;
  }
}
async function sourcePackage(name, source) {
  const dir = fresh(name);
  fs.mkdirSync(path.join(dir, "traces"), { recursive: true });
  fs.writeFileSync(path.join(dir, "air.package.json"), `${JSON.stringify({ airAbi: "0.10", capabilities: [], entry: "module.air", hostAbi: "0.10", name, targetProfiles: ["cli"], version: "0.1.0", wasm: "module.wasm" }, null, 2)}\n`);
  const sourcePath = path.join(dir, "module.air");
  fs.writeFileSync(sourcePath, source);
  const mod = air.parseAir(source, sourcePath);
  air.verifyModule(mod);
  fs.writeFileSync(path.join(dir, "module.wasm"), Buffer.from(await air.watToWasm(air.lowerToWat(mod), sourcePath)));
  return { dir, name };
}
let cPackages = null;
async function cPackagesOf() {
  if (!cPackages) {
    const entry = await sourcePackage("s10-f32-lanes", `module s10_f32_lanes\n\ncapabilities { }\n${C_EXPORTS}`);
    const linked = fresh("linked");
    fs.cpSync(path.join(ROOT, "test", "fixtures", "package_composition", "conformance_multi_module"), linked, { recursive: true });
    fs.appendFileSync(path.join(linked, "main.air"), C_EXPORTS);
    const manifestPath = path.join(linked, "air.package.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.packageExports = [...(manifest.packageExports || []), { function: "fx", module: "main.air", name: "fx" }, { function: "fy", module: "main.air", name: "fy" }];
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await buildLinkedPackage(linked, path.join(linked, "linked.wasm"), { profile: "cli" });
    cPackages = { entry, linked: { dir: linked, name: manifest.name } };
  }
  return cPackages;
}
async function replay(pkg, exportName, args) {
  fs.mkdirSync(path.join(pkg.dir, "traces"), { recursive: true });
  const tracePath = path.join(pkg.dir, "traces", `row-${(counter += 1)}.json`);
  fs.writeFileSync(tracePath, `{"schemaVersion":"0.16","kind":"air.conformance.trace","id":"row","package":${JSON.stringify(pkg.name)},"profile":"cli","steps":[{"id":"row","call":{"export":${JSON.stringify(exportName)},"args":[${args.map(jsonValue).join(",")}]}}]}`);
  let threw = null;
  const { tally, value } = await counted(() => jsonValues(() => createConformanceReplayReport(pkg.dir, { profile: "cli", trace: tracePath }).catch((error) => { threw = error; return null; })));
  const calls = tally.calls.filter((call) => call.name === exportName);
  if (threw) return { calls, mismatches: [], observed: [], status: "threw", steps: 0, threw: `${threw.name}: ${String(threw.message).slice(0, 120)}` };
  return { calls, mismatches: value.mismatches.map((item) => `${item.code || item.kind}: ${item.message || ""}`), observed: value.steps.map((step) => step.observed && step.observed.return), status: value.status, steps: value.steps.length };
}
async function fC(value, exportName = "fx", args = [1, value, 0.5]) {
  const packages = await cPackagesOf();
  const out = {};
  for (const which of ["entry", "linked"]) {
    const got = await replay(packages[which], exportName, args);
    const received = got.calls.filter((call) => same(call.lanes[1], args[1]));
    out[which] = {
      echo: received.length ? received[0].returned : undefined,
      reported: got.observed[0],
      ran: got.status === "pass" && got.steps === 1 && received.length === 1,
      refused: got.status === "fail" && got.steps === 0 && got.calls.length === 0 && got.mismatches.includes(`air.conformance.wrong_args: ${C_MESSAGE}`),
      status: got.status,
      threwBeforeAnyCall: got.status === "threw" && got.calls.length === 0 ? got.threw : null,
      mismatches: got.mismatches.slice(0, 2)
    };
  }
  return { ...out, refused: out.entry.refused && out.linked.refused, ran: out.entry.ran && out.linked.ran, threwBeforeAnyCall: Boolean(out.entry.threwBeforeAnyCall && out.linked.threwBeforeAnyCall) };
}
async function fD(value, args = [1, value, 0.5]) {
  const pkg = await sourcePackage(`s10-bench-${(counter += 1)}`, `module s10_bench\n\ncapabilities { }\n${C_EXPORTS}`);
  const dir = fresh("bench");
  fs.writeFileSync(path.join(dir, "benchmark.json"), `{"schemaVersion":"0.29","kind":"air.benchmark","benchmarkName":${JSON.stringify(pkg.name)},"benchmarkId":${JSON.stringify(pkg.name)},"packageDir":${JSON.stringify(pkg.dir)},"profile":"cli","buildWasm":true,"repeat":1,"runtime":{"export":"fx","args":[${args.map(jsonValue).join(",")}]}}`);
  const { tally, value: report } = await counted(() => jsonValues(() => createBenchmarkReport(dir, { cwd: dir })));
  const diagnostics = (report.diagnostics || []).map((item) => `${item.severity}: ${item.code}: ${String(item.message)}`);
  const received = tally.calls.filter((call) => call.name === "fx" && call.lanes.length === 3 && same(call.lanes[1], args[1]));
  return {
    diagnostics: diagnostics.slice(0, 3),
    ran: received.length > 0 && !diagnostics.some((item) => item.includes("argument_invalid") || item.includes("runtime_unavailable")),
    received: received.length,
    refused: received.length === 0 && diagnostics.some((item) => item.includes("air.benchmark.runtime_unavailable") && item.includes(D_MESSAGE))
  };
}

const ENTRIES = { C: fC, D: fD, L: fL, S: fS, T: fT };
const F_ROWS = [];
for (const entry of ["T", "L", "S", "C", "D"]) {
  for (const [id, value] of ROUNDING) F_ROWS.push([`F-${entry}-${id}`, `${entry}: ${shown(value)} is refused, nothing runs`, async () => {
    const got = await ENTRIES[entry](value);
    return { ok: got.refused === true, detail: got };
  }]);
  for (const [id, value] of EXACT) F_ROWS.push([`F-${entry}-${id}`, `${entry}: ${shown(value)} ${entry === "S" && !FINITE(value) ? "is refused, as today" : "passes unchanged"}`, async () => {
    const got = await ENTRIES[entry](value);
    // NaN and the infinities stay refused at S with today's code; the message is SEC53-10's f32 message.
    if (entry === "S" && !FINITE(value)) return { ok: got.code === "air.realtime.argument_invalid", detail: got };
    if (entry === "D") return { ok: got.ran === true, detail: got };
    if (entry === "C") return { ok: got.ran === true && same(got.entry.echo, value) && same(got.linked.echo, value), detail: got };
    if (entry === "L") return { ok: got.ran === true && same(got.echo, value) && same(got.rawEcho, value), detail: got };
    return { ok: got.ran !== false && same(got.echo, value), detail: got };
  }]);
  for (const [id, value] of NON_NUMBERS) F_ROWS.push([`F-${entry}-${id}`, `${entry}: ${shown(value)} is refused${entry === "C" && typeof value === "bigint" ? " (a JSON trace cannot hold it; injected, the report's trace fingerprint throws before any call)" : ""}`, async () => {
    const got = await ENTRIES[entry](value);
    if (entry === "C" && typeof value === "bigint") return { ok: got.threwBeforeAnyCall === true, detail: got };
    return { ok: got.refused === true, detail: got };
  }]);
}
F_ROWS.push(["F-C-K1", "C: 0.1 to the f64 lane passes and is used as 0.1", async () => {
  const got = await fC(0.5, "fy", [1, 0.5, 0.1]);
  return { ok: got.ran && got.entry.echo === 0.1 && got.linked.echo === 0.1, detail: got };
}]);
F_ROWS.push(["F-D-K1", "D: 0.1 to the f64 lane passes", async () => {
  const got = await fD(0.5, [1, 0.5, 0.1]);
  return { ok: got.ran === true, detail: got };
}]);
F_ROWS.push(["F-S-K3", "S: an f64 parameter given 0.1 passes, as today", async () => {
  const got = await fS(0.5, 0.1);
  return { ok: got.ran === true && got.echo === 0.5, detail: got };
}]);
F_ROWS.push(["F-T-K4", "T: an i32 refinement parameter keeps today's refusal of 2^31", async () => {
  const { result, invoked } = await typedInvoke("ref", { n: 2 ** 31 });
  const text = JSON.stringify(diagnosticsOf(result));
  return { ok: !invoked && diagnosticsOf(result).some((item) => item.code === "air.borrow.argument_invalid") && text.includes("arguments.n must be a signed i32"), detail: { invoked, text: text.slice(0, 200) } };
}]);

// ---------------------------------------------------------------------------------------------------------------------------------
// Section 2: F-B1-1, state.set (SPEC section 3).

const STATEMENT = "state.set hits, 0, %n";
const B_SOURCE = (statement) => `module m\nstate hits: i32[4] = fill 0\n\nexport func f(n: i32) -> i32 {\n  ${statement}\n  return %n\n}\n`;
const inserted = (code, at) => B_SOURCE(STATEMENT.slice(0, at) + ch(code) + STATEMENT.slice(at));
const TERMINATORS = [["CR", 0x0d], ["U+2028", 0x2028], ["U+2029", 0x2029]];
const B_FORMAT_SHA256 = "5693faf6f4071f047b43ffad674da74ef33117f71fc1839b5d25c0f2aae2a52e"; // the base's format of B_SOURCE(STATEMENT)
const B_WASM_DIGEST = "sha256:755682b5b4a70de553110d42f7caecc62cf19fcf83dcad47fd631c3a9feb2c1b"; // the base's build of it
const B_DESCRIPTOR = Object.freeze({ air_abi_lane: "0.12", exports: [{ function: "f", name: "f", parameters: [{ name: "n", type: "i32" }], return_type: "i32" }], module_id: "m",
  schema: "air.typed-interface/0.12-candidate.1", types: [] });
const outcomeOf = (source) => {
  try {
    sp.parseSource(source, "x.air", V053);
    return { kind: "parse" };
  } catch (error) {
    const message = String(error && error.message);
    return { code: error && error.code, kind: error instanceof TypeError ? "raw" : /\bair\.[a-z0-9_]+\.[a-z0-9_]+/.test(message) ? "coded" : "raw", message: message.slice(0, 160) };
  }
};
const codedAtLine5 = (error) => error && !(error instanceof TypeError) && (error.code === "air.v051.typed_syntax_invalid" || String(error.message).startsWith("x.air:5: air.v051.typed_syntax_invalid:")) &&
  String(error.message).startsWith("x.air:5: air.v051.typed_syntax_invalid:");
async function bRefused(source) {
  let parse;
  try {
    sp.parseSource(source, "x.air", V053);
    parse = { refused: false };
  } catch (error) {
    parse = { refused: codedAtLine5(error), message: String(error && error.message).slice(0, 200), type: error && error.constructor && error.constructor.name };
  }
  let build;
  try {
    await air.buildVerifiedTypedModule({ ...V053, descriptor: {}, source });
    build = { refused: false };
  } catch (error) {
    // A CR is ASCII and reaches the parser; U+2028 and U+2029 are refused first by the build's ASCII input rule (its own code).
    const ascii = !/[^\x00-\x7f]/.test(source);
    build = { refused: !(error instanceof TypeError) && (ascii ? codedAtLine5(error) || error.code === "air.v051.typed_syntax_invalid" : error.code === "air.v052.verified_build_input_invalid"),
      message: String(error && error.message).slice(0, 200), type: error && error.constructor && error.constructor.name };
  }
  return { build, ok: parse.refused === true && build.refused === true, parse };
}
const B_ROWS = [];
TERMINATORS.forEach(([name, code], group) => {
  for (let at = 11; at <= 20; at += 1) {
    const id = `B-N${group * 10 + (at - 10)}`;
    B_ROWS.push([id, `${name} at point ${at}: air.v051.typed_syntax_invalid at x.air:5, never a TypeError`, async () => {
      const got = await bRefused(inserted(code, at));
      return { ok: got.ok, detail: got };
    }]);
  }
});
function cliRun(args, cwd, input) {
  const out = childProcess.spawnSync(process.execPath, [AIRC, ...args], { cwd, encoding: "utf8", input, killSignal: "SIGKILL", timeout: 15000 });
  return { signal: out.signal, status: out.status, stderr: out.stderr || "", stdout: out.stdout || "" };
}
const oneLine = (text) => text.endsWith("\n") && text.indexOf("\n") === text.length - 1;
B_ROWS.push(["B-N1 (entries)", "CR at point 11 through airc verify, fmt, check, check --lsp-json and the LSP's didOpen", async () => {
  const dir = fresh("b1");
  const file = path.join(dir, "x.air");
  fs.writeFileSync(file, inserted(0x0d, 11));
  const flags = ["--source-profile", "typed-v0.53", "--allow-candidate-profile"];
  const lines = {};
  for (const command of ["verify", "fmt"]) {
    const out = cliRun([command, "x.air", ...flags], dir);
    lines[command] = { ok: out.status === 1 && out.stdout === "" && oneLine(out.stderr) && out.stderr.startsWith("x.air:5: air.v051.typed_syntax_invalid: ") && !out.stderr.includes("    at "), stderr: out.stderr.slice(0, 200), status: out.status };
  }
  // airc check prints its summary on stdout: one FAIL line with the coded refusal at x.air:5.
  const checked = cliRun(["check", "x.air", ...flags], dir);
  const failLines = checked.stdout.split("\n").filter((line) => line.startsWith("FAIL "));
  lines.check = { ok: checked.status === 1 && checked.stderr === "" && failLines.length === 1 && failLines[0].startsWith("FAIL air.v051.typed_syntax_invalid x.air:5: air.v051.typed_syntax_invalid: ") && !checked.stdout.includes("    at "),
    status: checked.status, stdout: checked.stdout.slice(0, 300) };
  const json = cliRun(["check", "x.air", ...flags, "--lsp-json"], dir);
  let lspJson = { ok: false, stdout: json.stdout.slice(0, 300) };
  try {
    const parsed = JSON.parse(json.stdout);
    const items = parsed.diagnostics || [];
    lspJson = { ok: items.length === 1 && items[0].code === "air.v051.typed_syntax_invalid" && items[0].line === 5, codes: items.map((item) => `${item.code}@${item.line}`) };
  } catch (_) { /* recorded */ }
  const session = new AirLspSession();
  session.initialize({ initializationOptions: { allowCandidateProfile: true, sourceProfile: "typed-v0.53" } });
  const published = session.didOpen({ textDocument: { text: inserted(0x0d, 11), uri: filePathToUri(file), version: 1 } });
  const diagnostics = published.flatMap((message) => (message.params && message.params.diagnostics) || []);
  const lsp = { codes: diagnostics.map((item) => `${item.code}@${item.range && item.range.start && item.range.start.line}`), ok: diagnostics.length === 1 && diagnostics[0].code === "air.v051.typed_syntax_invalid" && diagnostics[0].range.start.line === 4 };
  return { ok: lines.verify.ok && lines.fmt.ok && lines.check.ok && lspJson.ok && lsp.ok, detail: { lines, lsp, lspJson } };
}]);
B_ROWS.push(["B-P1", "the well-formed source parses, verifies, formats to the same bytes and builds to the same Wasm digest as today", async () => {
  const source = B_SOURCE(STATEMENT);
  const mod = sp.parseSource(source, "x.air", V053);
  sp.verifySource(mod, V053);
  const formatted = sp.formatSource(mod, V053);
  const built = await air.buildVerifiedTypedModule({ ...V053, descriptor: B_DESCRIPTOR, source });
  return { ok: sha256(formatted) === B_FORMAT_SHA256 && built.wasmDigest === B_WASM_DIGEST, detail: { format: sha256(formatted), wasm: built.wasmDigest } };
}]);
B_ROWS.push(["B-P2", "the source with CRLF line ends parses, as today", async () => ({ ok: outcomeOf(B_SOURCE(STATEMENT).replace(/\n/g, "\r\n")).kind === "parse" })]);
B_ROWS.push(["B-P3", "CR, U+2028 and U+2029 at points 0, 9, 10 and 21 (12 sources) parse, as today", async () => {
  const got = TERMINATORS.flatMap(([name, code]) => [0, 9, 10, 21].map((at) => [`${name}@${at}`, outcomeOf(inserted(code, at)).kind]));
  return { ok: got.length === 12 && got.every(([, kind]) => kind === "parse"), detail: got.filter(([, kind]) => kind !== "parse") };
}]);
B_ROWS.push(["B-P4", "NBSP at all 22 points keeps today's outcomes: 14 parse, 8 coded (points 1-8), never raw", async () => {
  const got = [];
  for (let at = 0; at <= STATEMENT.length; at += 1) got.push([at, outcomeOf(inserted(0xa0, at)).kind]);
  return { ok: got.every(([at, kind]) => kind === (at >= 1 && at <= 8 ? "coded" : "parse")), detail: got.filter(([at, kind]) => kind !== (at >= 1 && at <= 8 ? "coded" : "parse")) };
}]);
B_ROWS.push(["B-P5", "CR, U+2028 and U+2029 at points 1-8 (24 sources) keep today's coded refusal at x.air:5", async () => {
  const got = TERMINATORS.flatMap(([name, code]) => Array.from({ length: 8 }, (_, i) => [`${name}@${i + 1}`, outcomeOf(inserted(code, i + 1))]));
  return { ok: got.length === 24 && got.every(([, out]) => out.kind === "coded" && out.message.startsWith("x.air:5: air.v051.typed_syntax_invalid:")), detail: got.filter(([, out]) => out.kind !== "coded").map(([at]) => at) };
}]);

// ---------------------------------------------------------------------------------------------------------------------------------
// Sections 3 and 4: F-B8-1 (SPEC section 4). The layout: T/in is R; T/secret holds notes.air, plain.txt and the FIFO pipe.air.

const LEAF = "module leaf\ncapabilities { }\nfunc f() -> i32 {\nentry:\nreturn 1\n}\n";
const importer = (uses) => `module input\n${uses.map((name, i) => `use "${name}" as a${i}`).join("\n")}\ncapabilities { }\nexport func f() -> i32 {\nentry:\nreturn 1\n}\n`;
const NOTES = "SECRET-LINE-7f3a\nsecond line\n";
function layout(options = {}) {
  const T = fresh("layout");
  fs.mkdirSync(path.join(T, "in"));
  fs.mkdirSync(path.join(T, "secret"));
  fs.writeFileSync(path.join(T, "secret", "notes.air"), NOTES);
  fs.writeFileSync(path.join(T, "secret", "plain.txt"), "SECRET-TXT-7f3a\n");
  fs.writeFileSync(path.join(T, "in", "lib.air"), LEAF);
  if (options.fifo) {
    const made = childProcess.spawnSync("mkfifo", [path.join(T, "secret", "pipe.air")], { encoding: "utf8", timeout: 5000 });
    assert.equal(made.status, 0, `mkfifo: ${made.stderr}`);
  }
  return T;
}
// Erratum 1's rows: <T> is the row's folder as its own real path, and <TL> a symbolic link to it made in the test's scratch folder,
// so the rows meet a linked ancestor on every platform and with any TMPDIR.
function linkedAncestor(T) {
  const real = fs.realpathSync(T);
  const link = path.join(work, `tl-${(counter += 1)}`);
  fs.symlinkSync(real, link);
  return { T: real, TL: link };
}
const secretDigests = (T) => [sha256(fs.readFileSync(path.join(T, "secret", "notes.air"))), sha256(fs.readFileSync(path.join(T, "secret", "plain.txt")))];
const leaksNothing = (T, text) => !text.includes(SECRET) && !secretDigests(T).some((digest) => text.includes(digest));
const containmentLine = (file, line, spelled) => `${file}:${line}: ${UNCONTAINED}: AIR import '${spelled}' leaves the input's folder`;
const stdRoute = (T, name) => `std.x/${path.relative(path.join(STDLIB, "x"), path.join(T, "secret", name)).split(path.sep).join("/")}`;
// The API rows' tracer: every path an fs call names under secret/ (lexical or real) is a read of it.
function traced(fn) {
  const seen = [];
  const saved = {};
  for (const name of ["accessSync", "existsSync", "lstatSync", "openSync", "readFileSync", "statSync"]) {
    saved[name] = fs[name];
    fs[name] = function tracedCall(target, ...rest) {
      if (typeof target === "string" && target.split(path.sep).includes("secret")) seen.push(`${name} ${target}`);
      return saved[name].call(this, target, ...rest);
    };
  }
  try {
    return { seen, value: fn() };
  } catch (error) {
    return { error, seen };
  } finally {
    Object.assign(fs, saved);
  }
}

// M(): the CLI from T with -o and --record, and the API.
function migrateRow(T, input, line, spelled, options = {}) {
  const out = cliRun(["migrate", input, "-o", "out.air", "--record", "out.json"], T);
  const cli = {
    ok: out.status === 1 && out.stdout === "" && out.stderr === `${containmentLine(input, line, spelled)}\n` && !fs.existsSync(path.join(T, "out.air")) && !fs.existsSync(path.join(T, "out.json")) &&
      leaksNothing(T, out.stdout + out.stderr),
    signal: out.signal,
    status: out.status,
    stderr: out.stderr.slice(0, 240)
  };
  if (options.cliOnly) return { cli, ok: cli.ok };
  const file = path.join(T, input);
  const api = traced(() => migrateV053(fs.readFileSync(file), { path: file }));
  const apiOk = Boolean(api.error) && api.error.code === UNCONTAINED && api.error.message === containmentLine(file, line, spelled) && api.value === undefined && api.seen.length === 0;
  return { api: { message: api.error ? String(api.error.message).slice(0, 240) : null, ok: apiOk, seen: api.seen.slice(0, 3) }, cli, ok: cli.ok && apiOk };
}
const M_ROWS = [
  ["M-N1", "in/a.air: use \"../secret/notes.air\"", (T) => { fs.writeFileSync(path.join(T, "in", "a.air"), importer(["../secret/notes.air"])); return migrateRow(T, "in/a.air", 2, "../secret/notes.air"); }],
  ["M-N2", "in/b.air: an absolute use of <T>/secret/notes.air", (T) => { const target = path.join(T, "secret", "notes.air"); fs.writeFileSync(path.join(T, "in", "b.air"), importer([target])); return migrateRow(T, "in/b.air", 2, target); }],
  ["M-N3", "in/c.air: use \"../secret/plain.txt\"", (T) => { fs.writeFileSync(path.join(T, "in", "c.air"), importer(["../secret/plain.txt"])); return migrateRow(T, "in/c.air", 2, "../secret/plain.txt"); }],
  ["M-N4", "the fixture V53-MIG-N14 (v): use \"/nonexistent/air-migration/missing.air\"", (T) => {
    const fixture = path.join(ROOT, "fixtures", "v053", "migration", "V53-MIG-N14_v_an_unresolved_absolute_import_the_path_is_the_input_s_own", "input.air");
    fs.copyFileSync(fixture, path.join(T, "in", "input.air"));
    return migrateRow(T, "in/input.air", 2, "/nonexistent/air-migration/missing.air");
  }],
  ["M-N5", "in/d.air: use \"./link.air\", a link to ../secret/notes.air", (T) => { fs.symlinkSync(path.join("..", "secret", "notes.air"), path.join(T, "in", "link.air")); fs.writeFileSync(path.join(T, "in", "d.air"), importer(["./link.air"])); return migrateRow(T, "in/d.air", 2, "./link.air"); }],
  ["M-N6", "in/e.air -> in/mid.air -> ../secret/notes.air: the input's line that reaches it", (T) => {
    fs.writeFileSync(path.join(T, "in", "mid.air"), importer(["../secret/notes.air"]).replace("export ", "").replace("module input", "module mid"));
    fs.writeFileSync(path.join(T, "in", "e.air"), importer(["./mid.air"]));
    return migrateRow(T, "in/e.air", 2, "../secret/notes.air");
  }],
  ["M-N7", "M-N1 through migrateV053(bytes, { path }): throws, no record returned", (T) => {
    fs.writeFileSync(path.join(T, "in", "a.air"), importer(["../secret/notes.air"]));
    const file = path.join(T, "in", "a.air");
    const api = traced(() => migrateV053(fs.readFileSync(file), { path: file }));
    return { ok: Boolean(api.error) && api.error.code === UNCONTAINED && api.error.message === containmentLine(file, 2, "../secret/notes.air") && api.value === undefined && api.seen.length === 0, seen: api.seen };
  }],
  ["M-N8", "in/f.air: use \"../secret/pipe.air\", a FIFO outside: refused at once", (T) => { fs.writeFileSync(path.join(T, "in", "f.air"), importer(["../secret/pipe.air"])); return migrateRow(T, "in/f.air", 2, "../secret/pipe.air", { cliOnly: true }); }, { fifo: true }],
  ["M-N9", "in/g.air: use \"./sub/notes.air\", in/sub a link to ../secret", (T) => { fs.symlinkSync(path.join("..", "secret"), path.join(T, "in", "sub")); fs.writeFileSync(path.join(T, "in", "g.air"), importer(["./sub/notes.air"])); return migrateRow(T, "in/g.air", 2, "./sub/notes.air"); }],
  ["M-N10", "P0-11-CHECK-IMPORTS' upward import, restated", (T) => {
    fs.mkdirSync(path.join(T, "in", "deep", "er"), { recursive: true });
    fs.writeFileSync(path.join(T, "in", "lib2.air"), LEAF);
    fs.writeFileSync(path.join(T, "in", "deep", "er", "top.air"), importer(["../../lib2.air"]));
    return migrateRow(T, "in/deep/er/top.air", 2, "../../lib2.air");
  }],
  ["M-N11", "P0-11-CHECK-IMPORTS' absolute import into a sibling folder, restated", (T) => {
    fs.mkdirSync(path.join(T, "in", "top"));
    const target = path.join(T, "in", "lib.air");
    fs.writeFileSync(path.join(T, "in", "top", "in.air"), importer([target]));
    return migrateRow(T, "in/top/in.air", 2, target);
  }],
  ["M-N12", "in/h.air: the std. route to secret/notes: refused before any look", (T) => { const name = stdRoute(T, "notes"); fs.writeFileSync(path.join(T, "in", "h.air"), importer([name])); return migrateRow(T, "in/h.air", 2, name); }],
  ["M-N12b", "the std. route to secret/pipe.air, a FIFO: the containment line at once", (T) => { const name = stdRoute(T, "pipe"); fs.writeFileSync(path.join(T, "in", "h.air"), importer([name])); return migrateRow(T, "in/h.air", 2, name, { cliOnly: true }); }, { fifo: true }],
  ["M-N13", "N34 dangling_link: use \"./q.air\", q.air a link to nothing", (T) => { fs.symlinkSync("gone", path.join(T, "in", "q.air")); fs.writeFileSync(path.join(T, "in", "input.air"), importer(["./q.air"])); return migrateRow(T, "in/input.air", 2, "./q.air"); }],
  ["M-N14", "N34 nul_byte: use \"./a<NUL>b.air\"", (T) => { const name = `./a${ch(0)}b.air`; fs.writeFileSync(path.join(T, "in", "input.air"), importer([name])); return migrateRow(T, "in/input.air", 2, name); }],
  ["M-N15", "N34 link_loop: use \"./a\", a and b linking each other", (T) => { fs.symlinkSync("b", path.join(T, "in", "a")); fs.symlinkSync("a", path.join(T, "in", "b")); fs.writeFileSync(path.join(T, "in", "input.air"), importer(["./a"])); return migrateRow(T, "in/input.air", 2, "./a"); }],
  ["M-N16", "N34 dev_zero: use \"/dev/zero\"", (T) => { fs.writeFileSync(path.join(T, "in", "input.air"), importer(["/dev/zero"])); return migrateRow(T, "in/input.air", 2, "/dev/zero"); }],
  ["M-N17", "N34 dev_null: use \"/dev/null\"", (T) => { fs.writeFileSync(path.join(T, "in", "input.air"), importer(["/dev/null"])); return migrateRow(T, "in/input.air", 2, "/dev/null"); }],
  ["M-N18", "erratum 1: M-N1's form with use \"<TL>/in/loop/lib.air\" (in/loop a link to .): the containment line, no record", (T) => {
    const { TL } = linkedAncestor(T);
    fs.symlinkSync(".", path.join(T, "in", "loop"));
    const spelled = path.join(TL, "in", "loop", "lib.air");
    fs.writeFileSync(path.join(T, "in", "input.air"), importer([spelled]));
    return migrateRow(T, "in/input.air", 2, spelled);
  }],
  // The builder's row for mutant M22: in/lib.air becomes a link to ../secret/notes.air after the observing pass read it, so only the
  // verdict pass's resolver meets the link; its catch must give the containment line, never a REJECTED record.
  ["M-X1", "a link swapped in between M()'s two passes: the verdict pass's catch gives the containment line, no record", (T) => {
    const file = path.join(T, "in", "i.air");
    fs.writeFileSync(file, importer(["./lib.air"]));
    const packagePaths = require("../src/package_paths");
    const read = packagePaths.readAdmittedPackageFile;
    let reads = 0;
    packagePaths.readAdmittedPackageFile = function swapAfterFirstRead(...args) {
      const bytes = read.apply(this, args);
      if ((reads += 1) === 1) { fs.rmSync(path.join(T, "in", "lib.air")); fs.symlinkSync(path.join("..", "secret", "notes.air"), path.join(T, "in", "lib.air")); }
      return bytes;
    };
    try {
      const api = traced(() => migrateV053(fs.readFileSync(file), { path: file }));
      return { message: api.error ? String(api.error.message).slice(0, 200) : null, ok: reads >= 1 && Boolean(api.error) && api.error.code === UNCONTAINED && api.error.message === containmentLine(file, 2, "./lib.air") && api.value === undefined && !JSON.stringify(api.value || "").includes(SECRET), reads, record: api.value ? String(api.value.record).slice(0, 160) : null };
    } finally {
      packagePaths.readAdmittedPackageFile = read;
    }
  }]
];

// The unchanged rows: each record equals the record the rows' text gives, which is the base's record (the builder's base run).
const canonical = (value) => (Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object"
  ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}` : JSON.stringify(value));
const usesRecord = (input, imports) => `${canonical({
  entries: [], from: "legacy-v0.50", imports, increment: "I3", input_sha256: sha256(input), options: {},
  rejection: { code: "air.migration.unsupported_construct", construct: "uses", line: 2, origin: null, reason: "later_increment" }, schema: "air.migration-record/1", to: "typed-v0.53"
})}\n`;
function recordRow(file, imports) {
  const result = migrateV053(fs.readFileSync(file), { path: file });
  const expected = usesRecord(fs.readFileSync(file), imports);
  return { got: result.record.slice(0, 400), ok: result.kind === "REJECTED" && result.record === expected };
}
const libImport = (T, key, file = path.join(T, "in", "lib.air")) => ({ path: key, sha256: sha256(fs.readFileSync(file)) });
// Erratum 1's M() rows: airc migrate from <T>, with -o and --record; REJECTED for the use line, the record the base writes (imports[]
// holding the spelled absolute path with lib.air's sha256), no output file, and no containment line.
function migrateRecordRow(T, input, file, spelled) {
  const out = cliRun(["migrate", input, "-o", "out.air", "--record", "out.json"], T);
  const record = fs.existsSync(path.join(T, "out.json")) ? fs.readFileSync(path.join(T, "out.json"), "utf8") : null;
  const expected = usesRecord(fs.readFileSync(file), [libImport(T, spelled.split(path.sep).join("/"))]);
  return { ok: out.status === 1 && out.stdout === "" && out.stderr === `${input}:2: air.migration.unsupported_construct: uses (later_increment)\n` && record === expected && !fs.existsSync(path.join(T, "out.air")),
    record: record === null ? null : record.slice(0, 400), status: out.status, stderr: out.stderr.slice(0, 240) };
}
M_ROWS.push(
  ["M-P1", "in/i.air: use \"./lib.air\": REJECTED for its use line, imports lib.air with its sha256, as today", (T) => { fs.writeFileSync(path.join(T, "in", "i.air"), importer(["./lib.air"])); return recordRow(path.join(T, "in", "i.air"), [libImport(T, "lib.air")]); }],
  ["M-P2", "in/j.air: use \"sub/lib.air\", a real subfolder", (T) => {
    fs.mkdirSync(path.join(T, "in", "sub"));
    fs.writeFileSync(path.join(T, "in", "sub", "lib.air"), LEAF);
    fs.writeFileSync(path.join(T, "in", "j.air"), importer(["sub/lib.air"]));
    return recordRow(path.join(T, "in", "j.air"), [libImport(T, "sub/lib.air", path.join(T, "in", "sub", "lib.air"))]);
  }],
  ["M-P3", "in/k.air: an absolute use of <T>/in/lib.air keeps the spelled absolute path (P11-R3)", (T) => {
    const target = path.join(T, "in", "lib.air");
    fs.writeFileSync(path.join(T, "in", "k.air"), importer([target]));
    return recordRow(path.join(T, "in", "k.air"), [libImport(T, target.split(path.sep).join("/"))]);
  }],
  ["M-P4", "a stdlib use \"std.bounds\"", (T) => { fs.writeFileSync(path.join(T, "in", "s.air"), importer(["std.bounds"])); return recordRow(path.join(T, "in", "s.air"), [libImport(T, "std:bounds", path.join(STDLIB, "bounds.air"))]); }],
  ["M-P7", "the input given through a linked ancestor folder migrates its in-folder import exactly as M-P1", (T) => {
    fs.writeFileSync(path.join(T, "in", "i.air"), importer(["./lib.air"]));
    const alias = path.join(work, `alias-${(counter += 1)}`);
    fs.symlinkSync(T, alias);
    const viaAlias = recordRow(path.join(alias, "in", "i.air"), [libImport(T, "lib.air")]);
    const direct = migrateV053(fs.readFileSync(path.join(T, "in", "i.air")), { path: path.join(T, "in", "i.air") }).record;
    return { ...viaAlias, ok: viaAlias.ok && viaAlias.got === direct.slice(0, 400) };
  }],
  ["M-P8", "isImportReadFailure is true for air.package.file_invalid and air.package.file_changed", () => ({ ok: isImportReadFailure({ code: "air.package.file_invalid" }) && isImportReadFailure({ code: "air.package.file_changed" }) })],
  ["M-P9", "erratum 1: airc migrate in/k.air from <T> with use \"<TL>/in/lib.air\": the base's REJECTED record, no containment line", (T) => {
    const linked = linkedAncestor(T);
    const spelled = path.join(linked.TL, "in", "lib.air");
    fs.writeFileSync(path.join(T, "in", "k.air"), importer([spelled]));
    return migrateRecordRow(linked.T, "in/k.air", path.join(linked.T, "in", "k.air"), spelled);
  }],
  ["M-P10", "erratum 1: airc migrate <TL>/in/k.air with use \"<T>/in/lib.air\": the base's REJECTED record, no containment line", (T) => {
    const linked = linkedAncestor(T);
    const spelled = path.join(linked.T, "in", "lib.air");
    fs.writeFileSync(path.join(T, "in", "k.air"), importer([spelled]));
    return migrateRecordRow(linked.T, path.join(linked.TL, "in", "k.air"), path.join(linked.T, "in", "k.air"), spelled);
  }]
);

// Legacy single files: airc verify (the default profile) unless the row names another entry.
const hintFree = (line) => line.replace(/ \(default profile: legacy-v0\.50;[^\n]*\)$/, "");
function verifyRefused(T, args, file, line, spelled, options = {}) {
  const out = cliRun(args, options.cwd || T, options.input);
  const first = out.stderr.split("\n")[0];
  const expected = options.code ? null : containmentLine(file, line, spelled);
  const startsRight = options.code ? first.startsWith(`${file}:${line}: ${options.code}: `) : (first.startsWith(expected) && (hintFree(first) === expected));
  return { ok: out.status === 1 && oneLine(out.stderr) && startsRight && !out.stderr.includes("    at ") && leaksNothing(T, out.stdout + out.stderr), signal: out.signal, status: out.status, stderr: out.stderr.slice(0, 260) };
}
const L_ROWS = [
  ["L-N1", "in/a.air: use \"../secret/notes.air\"", (T) => { fs.writeFileSync(path.join(T, "in", "a.air"), importer(["../secret/notes.air"])); return verifyRefused(T, ["verify", "in/a.air"], "in/a.air", 2, "../secret/notes.air"); }],
  ["L-N2", "in/b.air: an absolute use of <T>/secret/notes.air", (T) => { const target = path.join(T, "secret", "notes.air"); fs.writeFileSync(path.join(T, "in", "b.air"), importer([target])); return verifyRefused(T, ["verify", "in/b.air"], "in/b.air", 2, target); }],
  ["L-N3", "in/c.air: use \"../secret/plain.txt\"", (T) => { fs.writeFileSync(path.join(T, "in", "c.air"), importer(["../secret/plain.txt"])); return verifyRefused(T, ["verify", "in/c.air"], "in/c.air", 2, "../secret/plain.txt"); }],
  ["L-N4", "in/d.air: use \"./link.air\", a link to ../secret/notes.air", (T) => { fs.symlinkSync(path.join("..", "secret", "notes.air"), path.join(T, "in", "link.air")); fs.writeFileSync(path.join(T, "in", "d.air"), importer(["./link.air"])); return verifyRefused(T, ["verify", "in/d.air"], "in/d.air", 2, "./link.air"); }],
  ["L-N5", "in/e.air -> in/mid.air -> ../secret/notes.air: refused at in/mid.air:2", (T) => {
    fs.writeFileSync(path.join(T, "in", "mid.air"), importer(["../secret/notes.air"]).replace("export ", "").replace("module input", "module mid"));
    fs.writeFileSync(path.join(T, "in", "e.air"), importer(["./mid.air"]));
    const out = cliRun(["verify", "in/e.air"], T);
    const first = out.stderr.split("\n")[0];
    const at = first.indexOf(":2: ");
    const where = at > 0 ? first.slice(0, at) : "";
    const named = where !== "" && fs.existsSync(where) && fs.realpathSync(where) === fs.realpathSync(path.join(T, "in", "mid.air"));
    const rest = `${UNCONTAINED}: AIR import '../secret/notes.air' leaves the input's folder`;
    return { ok: out.status === 1 && oneLine(out.stderr) && named && hintFree(first).slice(at + 4) === rest && !out.stderr.includes("    at ") && leaksNothing(T, out.stdout + out.stderr), stderr: out.stderr.slice(0, 260) };
  }],
  ["L-N6", "in/h.air: the std. route to secret/notes, refused before any file-system call", (T) => { const name = stdRoute(T, "notes"); fs.writeFileSync(path.join(T, "in", "h.air"), importer([name])); return verifyRefused(T, ["verify", "in/h.air"], "in/h.air", 2, name); }],
  ["L-N7", "in/g.air: use \"./sub/notes.air\", in/sub a link to ../secret", (T) => { fs.symlinkSync(path.join("..", "secret"), path.join(T, "in", "sub")); fs.writeFileSync(path.join(T, "in", "g.air"), importer(["./sub/notes.air"])); return verifyRefused(T, ["verify", "in/g.air"], "in/g.air", 2, "./sub/notes.air"); }],
  ["L-N8", "L-N1 through the SDK: parseSource throws the AirError, buildPackage refuses before any output", async (T) => {
    const file = path.join(T, "in", "a.air");
    fs.writeFileSync(file, importer(["../secret/notes.air"]));
    const parsed = traced(() => sp.parseSource(fs.readFileSync(file, "utf8"), file));
    const parseOk = Boolean(parsed.error) && parsed.error.code === UNCONTAINED && parsed.error.message === containmentLine(file, 2, "../secret/notes.air") && parsed.seen.length === 0;
    const out = path.join(T, "built");
    let build;
    try {
      await air.buildPackage({ air: file, out });
      build = { ok: false };
    } catch (error) {
      build = { code: error && error.code, ok: error && error.code === UNCONTAINED && !fs.existsSync(out) && !String(error.message).includes(SECRET) };
    }
    return { build, ok: parseOk && build.ok, parse: parsed.error ? String(parsed.error.message).slice(0, 200) : null, seen: parsed.seen.slice(0, 3) };
  }],
  ["L-N9", "L-N1 through the LSP's didOpen (no package): one diagnostic, code air.parser.syntax, message beginning air.package.path_uncontained:", (T) => {
    const file = path.join(T, "in", "a.air");
    const text = importer(["../secret/notes.air"]);
    fs.writeFileSync(file, text);
    const session = new AirLspSession();
    const opened = traced(() => session.didOpen({ textDocument: { text, uri: filePathToUri(file), version: 1 } }));
    const diagnostics = (opened.value || []).flatMap((message) => (message.params && message.params.diagnostics) || []);
    return { codes: diagnostics.map((item) => item.code), messages: diagnostics.map((item) => String(item.message).slice(0, 160)),
      ok: diagnostics.length === 1 && diagnostics[0].code === "air.parser.syntax" && String(diagnostics[0].message).startsWith(`${UNCONTAINED}:`) && !JSON.stringify(diagnostics).includes(SECRET) && opened.seen.length === 0 };
  }],
  ["L-N10", "L-N1 through airc fmt, airc build and airc audit: each the same line, exit 1", (T) => {
    fs.writeFileSync(path.join(T, "in", "a.air"), importer(["../secret/notes.air"]));
    const each = ["fmt", "build", "audit"].map((command) => [command, verifyRefused(T, [command, "in/a.air"], "in/a.air", 2, "../secret/notes.air")]);
    return { each: Object.fromEntries(each.map(([command, got]) => [command, { ok: got.ok, stderr: got.stderr.slice(0, 120) }])), ok: each.every(([, got]) => got.ok) };
  }],
  ["L-N11", "in/p.air: use \"./pipe.air\", a FIFO inside: air.package.file_invalid, exit 1, at once", (T) => {
    const made = childProcess.spawnSync("mkfifo", [path.join(T, "in", "pipe.air")], { encoding: "utf8", timeout: 5000 });
    assert.equal(made.status, 0);
    fs.writeFileSync(path.join(T, "in", "p.air"), importer(["./pipe.air"]));
    return verifyRefused(T, ["verify", "in/p.air"], "in/p.air", 2, null, { code: "air.package.file_invalid" });
  }],
  ["L-N12", "an import above 4 MiB inside the folder: air.package.file_invalid", (T) => {
    fs.writeFileSync(path.join(T, "in", "big.air"), `${LEAF}#${" ".repeat(4 * 1024 * 1024 - Buffer.byteLength(LEAF))}`);
    fs.writeFileSync(path.join(T, "in", "q.air"), importer(["./big.air"]));
    return verifyRefused(T, ["verify", "in/q.air"], "in/q.air", 2, null, { code: "air.package.file_invalid" });
  }],
  ["L-N13", "airc format --stdin with use \"../up.air\" from T/in, T/up.air present: one refusal line, up.air not read", (T) => {
    fs.writeFileSync(path.join(T, "up.air"), "module up\nUP-MARKER-7f3a\n");
    const out = cliRun(["format", "--stdin"], path.join(T, "in"), importer(["../up.air"]));
    return { ok: out.status === 1 && oneLine(out.stderr) && out.stderr.includes(`${UNCONTAINED}: AIR import '../up.air' leaves the input's folder`) && !(out.stdout + out.stderr).includes("UP-MARKER"), status: out.status, stderr: out.stderr.slice(0, 220) };
  }],
  ["L-N14", "erratum 1: from <T>, use \"<TL>/in/sub/notes.air\" (in/sub a link to ../secret): the containment line, no SECRET", (T) => {
    const linked = linkedAncestor(T);
    fs.symlinkSync(path.join("..", "secret"), path.join(T, "in", "sub"));
    const spelled = path.join(linked.TL, "in", "sub", "notes.air");
    fs.writeFileSync(path.join(T, "in", "k.air"), importer([spelled]));
    return verifyRefused(T, ["verify", "in/k.air"], "in/k.air", 2, spelled, { cwd: linked.T });
  }],
  ["L-N15", "erratum 1: from <T>, use \"<TL>/in/loop/lib.air\" (in/loop a link to .): the containment line (the topmost ancestor)", (T) => {
    const linked = linkedAncestor(T);
    fs.symlinkSync(".", path.join(T, "in", "loop"));
    const spelled = path.join(linked.TL, "in", "loop", "lib.air");
    fs.writeFileSync(path.join(T, "in", "k.air"), importer([spelled]));
    return verifyRefused(T, ["verify", "in/k.air"], "in/k.air", 2, spelled, { cwd: linked.T });
  }],
  ["L-N16", "erratum 1: from <T>, use \"<TL>/secret/notes.air\": the containment line, no SECRET", (T) => {
    const linked = linkedAncestor(T);
    const spelled = path.join(linked.TL, "secret", "notes.air");
    fs.writeFileSync(path.join(T, "in", "k.air"), importer([spelled]));
    return verifyRefused(T, ["verify", "in/k.air"], "in/k.air", 2, spelled, { cwd: linked.T });
  }],
  ["L-N17", "erratum 1 (QA's P3-2): from <T>, use \"<TL>/in-x/notes.air\", in-x a sibling whose name starts with R's: the containment line", (T) => {
    const linked = linkedAncestor(T);
    fs.mkdirSync(path.join(T, "in-x"));
    fs.writeFileSync(path.join(T, "in-x", "notes.air"), "SECRET-SIBLING-7f3a\n");
    const spelled = path.join(linked.TL, "in-x", "notes.air");
    fs.writeFileSync(path.join(T, "in", "k.air"), importer([spelled]));
    return verifyRefused(T, ["verify", "in/k.air"], "in/k.air", 2, spelled, { cwd: linked.T });
  }],
  ["L-N18", "erratum 1 (QA's P3-2): from <T>, use \"<T>/subalias/lib2.air\", subalias a link to the subfolder in/sub_real: the containment line", (T) => {
    const linked = linkedAncestor(T);
    fs.mkdirSync(path.join(T, "in", "sub_real"));
    fs.writeFileSync(path.join(T, "in", "sub_real", "lib2.air"), LEAF);
    fs.symlinkSync(path.join(linked.T, "in", "sub_real"), path.join(T, "subalias"));
    const spelled = path.join(linked.T, "subalias", "lib2.air");
    fs.writeFileSync(path.join(T, "in", "k.air"), importer([spelled]));
    return verifyRefused(T, ["verify", "in/k.air"], "in/k.air", 2, spelled, { cwd: linked.T });
  }],
  ["L-P1", "in/i.air: use \"./lib.air\" verifies", (T) => { fs.writeFileSync(path.join(T, "in", "i.air"), importer(["./lib.air"])); const out = cliRun(["verify", "in/i.air"], T); return { ok: out.status === 0 && out.stdout === "ok: in/i.air\n" && out.stderr === "", out }; }],
  ["L-P2", "in/j.air: use \"./sub/m.air\", in/sub/m.air using ../lib.air inside R, verifies", (T) => {
    fs.mkdirSync(path.join(T, "in", "sub"));
    fs.writeFileSync(path.join(T, "in", "sub", "m.air"), "module m\nuse \"../lib.air\" as l\ncapabilities { }\nfunc g() -> i32 {\nentry:\nreturn 1\n}\n");
    fs.writeFileSync(path.join(T, "in", "j.air"), importer(["./sub/m.air"]));
    const out = cliRun(["verify", "in/j.air"], T);
    return { ok: out.status === 0 && out.stdout === "ok: in/j.air\n", out };
  }],
  ["L-P3", "the input reached through a linked ancestor folder verifies its in-folder import", (T) => {
    fs.writeFileSync(path.join(T, "in", "i.air"), importer(["./lib.air"]));
    const alias = path.join(work, `alias-${(counter += 1)}`);
    fs.symlinkSync(T, alias);
    const input = path.join(alias, "in", "i.air");
    const out = cliRun(["verify", input], work);
    return { ok: out.status === 0 && out.stdout === `ok: ${input}\n`, out };
  }],
  ["L-P4", "an absolute use of <T>/in/lib.air verifies", (T) => { fs.writeFileSync(path.join(T, "in", "k.air"), importer([path.join(T, "in", "lib.air")])); const out = cliRun(["verify", "in/k.air"], T); return { ok: out.status === 0 && out.stdout === "ok: in/k.air\n", out }; }],
  ["L-P4b", "erratum 1: airc verify in/k.air from <T> (R real) with use \"<TL>/in/lib.air\" verifies, as on the base", (T) => {
    const linked = linkedAncestor(T);
    fs.writeFileSync(path.join(T, "in", "k.air"), importer([path.join(linked.TL, "in", "lib.air")]));
    const out = cliRun(["verify", "in/k.air"], linked.T);
    return { ok: out.status === 0 && out.stdout === "ok: in/k.air\n" && out.stderr === "", out };
  }],
  ["L-P4c", "erratum 1: airc verify <TL>/in/k.air (R through the link) with use \"<T>/in/lib.air\" verifies, as on the base", (T) => {
    const linked = linkedAncestor(T);
    fs.writeFileSync(path.join(T, "in", "k.air"), importer([path.join(linked.T, "in", "lib.air")]));
    const input = path.join(linked.TL, "in", "k.air");
    const out = cliRun(["verify", input], linked.T);
    return { ok: out.status === 0 && out.stdout === `ok: ${input}\n` && out.stderr === "", out };
  }],
  ["L-P5", "use \"std.bounds\" verifies", (T) => { fs.writeFileSync(path.join(T, "in", "s.air"), importer(["std.bounds"])); const out = cliRun(["verify", "in/s.air"], T); return { ok: out.status === 0 && out.stdout === "ok: in/s.air\n", out }; }],
  ["L-P7", "a relative input path, airc verify in/i.air from T, verifies its in-folder import", (T) => { fs.writeFileSync(path.join(T, "in", "i.air"), importer(["./lib.air"])); const out = cliRun(["verify", "in/i.air"], T); return { ok: out.status === 0 && out.stdout === "ok: in/i.air\n", out }; }],
  ["L-P8", "airc format --stdin with use \"./lib.air\", from T/in, resolves against the working folder as today", (T) => {
    const source = importer(["./lib.air"]);
    const out = cliRun(["format", "--stdin"], path.join(T, "in"), source);
    return { ok: out.status === 0 && out.stderr === "" && out.stdout.includes("use \"./lib.air\" as a0"), out: { status: out.status, stderr: out.stderr.slice(0, 200) } };
  }],
  // The builder's row for mutant M26 (R given as its real path): under erratum 1's ancestor rule M-P7 and L-P3 pass with R real too, so
  // this row pins R as the input's lexical folder where the two differ: an input that is itself a link to a file in another folder.
  ["L-X2", "in/k.air, a link to ../other/k.air, with use \"./lib.air\" (in/lib.air): R is the link's folder, and it verifies as on the base", (T) => {
    fs.mkdirSync(path.join(T, "other"));
    fs.writeFileSync(path.join(T, "other", "k.air"), importer(["./lib.air"]));
    fs.symlinkSync(path.join("..", "other", "k.air"), path.join(T, "in", "k.air"));
    const out = cliRun(["verify", "in/k.air"], T);
    return { ok: out.status === 0 && out.stdout === "ok: in/k.air\n" && out.stderr === "", out };
  }]
];

// ---------------------------------------------------------------------------------------------------------------------------------

(async () => {
  const rows = [];
  const record = async (section, id, what, run) => {
    let got;
    try {
      got = await run();
    } catch (error) {
      got = { error: `${error && error.name}: ${String(error && error.message).slice(0, 300)}`, ok: false };
    }
    const pass = Boolean(got && got.ok === true);
    rows.push({ detail: pass ? undefined : got, id, section, status: pass ? "PASS" : "FAIL" });
    console.log(`${pass ? "ok" : "not ok"} - SEC53-10 ${id} ${what}`);
  };
  for (const [id, what, run] of F_ROWS) await record("1", id, what, run);
  for (const [id, what, run] of B_ROWS) await record("2", id, what, run);
  for (const [id, what, run, options] of M_ROWS) await record("3", id, what, () => run(layout(options || {})));
  for (const [id, what, run] of L_ROWS) await record("4", id, what, () => run(layout()));
  const failed = rows.filter((row) => row.status === "FAIL");
  if (process.env.AIR_SEC53_10_RESULTS_DIR) {
    fs.mkdirSync(process.env.AIR_SEC53_10_RESULTS_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.AIR_SEC53_10_RESULTS_DIR, "v053_part_b_fixes.results.json"), `${JSON.stringify({ rows, totals: { fail: failed.length, pass: rows.length - failed.length } }, (key, value) => (typeof value === "bigint" ? `${value}n` : value), 1)}\n`);
  }
  for (const row of failed) console.log(`# ${row.id}: ${JSON.stringify(row.detail, (key, value) => (typeof value === "bigint" ? `${value}n` : value)).slice(0, 600)}`);
  console.log(`SEC53-10 part B fixes: ${rows.length - failed.length} PASS, ${failed.length} FAIL, ${rows.length} rows`);
  fs.rmSync(work, { force: true, recursive: true });
  assert.equal(failed.length, 0, failed.map((row) => row.id).join(", "));
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
