#!/usr/bin/env node
"use strict";

// SEC53-02 (AIR_V053_SEC53_02_RAW_VERIFIED_EXECUTION_SPEC_R4_2026_11_12): the raw vs verified Wasm execution
// boundary. VECTORS.md section 1's 23 rows (V1-), section 5's linked-package cases with the lowering rows C1 and C3
// (V5-), and section 6's parameter-lane and replay-message rows (V6-). SPEC sections 7 and 13's mutants M1-M15,
// MA0-MA5, MP1-MP4 and MM1 each run on a scratch copy of the tree, against the rows of their own section; a mutant is
// caught when a row it names fails. The rows run in a child process on a given tree (this file with --rows). Every
// package, trace, benchmark and consumer is built in a fresh folder outside every tree.
// Set AIR_SEC53_02_RESULTS_DIR=<dir> to write the results.

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const PKG = `sha256:${"0".repeat(64)}`;
const MARKER = "(global (export \"__air_abi_feature_borrowed_slice_v1\") i32 (i32.const 0x000b0001))";
const CHILD_MS = 600000;
const sha = (bytes) => `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
const short = (e) => `${e && e.name ? `${e.name}: ` : ""}${String(e && e.message ? e.message : e).split("\n")[0].slice(0, 160)}`;
const codesOf = (result) => (result.diagnostics || []).map((item) => item.code);
const thrown = async (fn) => { try { await fn(); return null; } catch (error) { return error; } };

// ---------------------------------------------------------------------------
// Child side: the rows, on the tree at ctx.tree.

function rowContext(tree) {
  const work = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "air-sec53-02-"));
  const ctx = { tree, work, n: 0 };
  ctx.S = (rel) => require(path.join(tree, rel));
  ctx.R = (rel) => require(path.join(ROOT, rel));
  ctx.folder = (name) => { ctx.n += 1; const dir = path.join(work, `${name}-${ctx.n}`); fs.mkdirSync(dir, { recursive: true }); return dir; };
  return ctx;
}

// QA's decoy and type-section patch (SEC53-02 tools/s2_vectors.js, from SEC53-04 QA's own shapes): a reader that takes
// one byte per value type reads the decoy as two types and stops one type early, so the export's appended real type is
// read as the decoy's tail, whose results it reports as ["i32"].
function decoy() {
  const tail = [0x63, 0x00];
  for (let k = 0; k < 4; k += 1) tail.push(0x63, 0x00);
  for (let k = 0; k < 89; k += 1) tail.push(0x7f);
  tail.push(0x63, 0x01, 0x7f);
  return [0x60, 0x01, 0x63, 0x00, 0x60, ...tail];
}
const leb = (n) => { const out = []; do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; out.push(b); } while (n); return out; };
function readLeb(buf, at) { let r = 0; let s = 0; let b; do { b = buf[at++]; r += (b & 0x7f) * 2 ** s; s += 7; } while (b & 0x80); return [r, at]; }
function patchType(bytes, exportName, appended) {
  const list = []; let at = 8;
  while (at < bytes.length) { const id = bytes[at]; const [size, p] = readLeb(bytes, at + 1); list.push({ id, payload: bytes.subarray(p, p + size) }); at = p + size; }
  const typeS = list.find((x) => x.id === 1); const [typeCount, tAt] = readLeb(typeS.payload, 0);
  typeS.payload = Buffer.concat([Buffer.from(leb(typeCount + appended.length)), typeS.payload.subarray(tAt), ...appended.map((t) => Buffer.from(t))]);
  const last = typeCount + appended.length - 1;
  const imp = list.find((x) => x.id === 2); let importedFuncs = 0;
  { let [n, i] = readLeb(imp.payload, 0); for (; n > 0; n -= 1) { let len; [len, i] = readLeb(imp.payload, i); i += len; [len, i] = readLeb(imp.payload, i); i += len;
    const kind = imp.payload[i++]; if (kind === 0) { importedFuncs += 1; [, i] = readLeb(imp.payload, i); } else throw new Error("non-function import"); } }
  const exp = list.find((x) => x.id === 7); let funcIndex = -1;
  { let [n, i] = readLeb(exp.payload, 0); for (; n > 0; n -= 1) { let len; [len, i] = readLeb(exp.payload, i); const nm = exp.payload.subarray(i, i + len).toString(); i += len;
    const kind = exp.payload[i++]; let idx; [idx, i] = readLeb(exp.payload, i); if (kind === 0 && nm === exportName) funcIndex = idx; } }
  const fnS = list.find((x) => x.id === 3); const [fnCount, fAt0] = readLeb(fnS.payload, 0); let fAt = fAt0; const idxs = [];
  for (let k = 0; k < fnCount; k += 1) { let v; [v, fAt] = readLeb(fnS.payload, fAt); idxs.push(v); }
  idxs[funcIndex - importedFuncs] = last;
  fnS.payload = Buffer.from([...leb(fnCount), ...idxs.flatMap(leb)]);
  const parts = [Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00])];
  for (const x of list) parts.push(Buffer.from([x.id, ...leb(x.payload.length)]), Buffer.from(x.payload));
  return Buffer.concat(parts);
}

// VECTORS.md section 1: the shipped example's module (library), entry copy_final; crafted bytes are hand-written WAT
// with memory, the borrowed-slice-v1 marker and an export copy_final that calls the counted host import env.effect.
function lane(ctx) {
  if (ctx.lane) return ctx.lane;
  const air = ctx.S("src/index.js");
  const raw = ctx.S("src/raw.js");
  const sourcePath = path.join(ctx.tree, "examples/borrowed_slices/wasm/copy_final_i32.air");
  const source = fs.readFileSync(sourcePath, "utf8");
  const mod = air.parseAir(source, sourcePath, { resolveSourceImports: false });
  const descriptor = air.borrowedSliceInterfaceDescriptor(mod);
  const flat = descriptor.exports.find((e) => e.name === "copy_final").params.reduce((n, p) => n + (p.kind === "borrowed_slice" ? 2 : 1), 0);
  const params = Array.from({ length: flat }, () => "i32").join(" ");
  const binding = (buffer, access) => ({ buffer, access, maxLength: 8, alignment: 4, aliasGroup: null, memoryDomain: "wasm-linear", transferMode: "copied_into_wasm" });
  const options = (instance) => {
    const src = new Uint8Array(8);
    new DataView(src.buffer).setInt32(4, 42, true);
    return { instance, interfaceDescriptor: descriptor, packageDigest: PKG, entrypoint: "copy_final", arguments: { count: 2 },
      bindings: { src: binding(src, "readonly"), dst: binding(new Uint8Array(8), "writeonly") } };
  };
  const counter = { effects: 0 };
  const hostImports = () => ({ env: { effect: () => { counter.effects += 1; return 0n; } } });
  const crafted = async (body) => air.watToWasm(`(module (import "env" "effect" (func $e (result i64))) (memory (export "memory") 1) ${MARKER} ${body})`, "crafted.wat");
  const rawCrafted = async () => raw.instantiateRawWasm({ wasmBytes: await crafted(`(func (export "copy_final") (param ${params}) (result i32) call $e drop i32.const 7)`), packageDigest: PKG, imports: hostImports() });
  ctx.lane = { air, raw, sourcePath, source, mod, descriptor, flat, params, options, counter, hostImports, crafted, rawCrafted };
  return ctx.lane;
}

function consumer(ctx) {
  if (ctx.consumer) return ctx.consumer;
  const dir = ctx.folder("consumer");
  const installed = path.join(dir, "node_modules/@underskys/air-core");
  for (const part of ["src", "data", "stdlib", "package.json"]) fs.cpSync(path.join(ctx.tree, part), path.join(installed, part), { recursive: true });
  ctx.consumer = (code, type = "cjs") => {
    const file = path.join(dir, type === "esm" ? "probe.mjs" : "probe.cjs");
    fs.writeFileSync(file, code);
    const out = childProcess.spawnSync(process.execPath, [file], { cwd: dir, encoding: "utf8" });
    return out.status === 0 ? JSON.parse(out.stdout) : { error: out.stderr.split("\n").find((l) => /Error|ERR_/u.test(l)) || out.stderr.slice(0, 160) };
  };
  return ctx.consumer;
}

const ROOT_HAS = ["instantiateVerifiedAirModule", "invokeBorrowedMemory", "prepareBorrowedMemoryInvocation", "admitTypedV053Artifact", "run"];
const RAW_NAMES = ["instantiateRawWasm", "invokeRawBorrowedMemory", "prepareRawBorrowedMemoryInvocation"];
const ROOT_LACKS = ["instantiateAirModule", ...RAW_NAMES, "instantiateRegisteredWasm", "registerBorrowedMemoryInstanceIdentity"];

async function benchmark(ctx, label, breakSource) {
  const { air } = lane(ctx);
  const root = ctx.folder(`bench-${label}`);
  fs.cpSync(path.join(ROOT, "benchmarks/output_emit_basic"), path.join(root, "benchmarks/output_emit_basic"), { recursive: true });
  const pkg = path.join(root, "test/fixtures/host_interaction/output_emit");
  fs.cpSync(path.join(ROOT, "test/fixtures/host_interaction/output_emit"), pkg, { recursive: true });
  if (breakSource) {
    const m = JSON.parse(fs.readFileSync(path.join(pkg, "air.package.json"), "utf8"));
    const good = fs.readFileSync(path.join(pkg, m.entry), "utf8");
    fs.writeFileSync(path.join(pkg, m.wasm || "module.wasm"), await air.watToWasm(air.lowerToWat(air.parseAir(good, m.entry)), m.entry));
    fs.writeFileSync(path.join(pkg, m.entry), `${good}\nthis is not AIR\n`);
  }
  return ctx.S("src/benchmark_report.js").createBenchmarkReport(path.join(root, "benchmarks/output_emit_basic"), { cwd: root });
}

async function replayState(ctx, extra) {
  const { air } = lane(ctx);
  const fixture = ctx.folder("conformance_state");
  fs.cpSync(path.join(ROOT, "test/fixtures/conformance_state"), fixture, { recursive: true });
  const meta = JSON.parse(fs.readFileSync(path.join(fixture, "air.package.json"), "utf8"));
  const entry = path.join(fixture, meta.entry);
  const text = `${fs.readFileSync(entry, "utf8")}${extra}`;
  fs.writeFileSync(path.join(fixture, meta.wasm), Buffer.from(await air.watToWasm(air.lowerToWat(air.parseAir(text, entry)), entry)));
  return air.createConformanceReplayReport(fixture, { profile: meta.targetProfiles && meta.targetProfiles[0], trace: path.join(fixture, "traces/pass.json") });
}

const V1 = {
  "V1-P1": async (ctx) => {
    const { air, raw, source, sourcePath, options } = lane(ctx);
    const verified = await air.instantiateVerifiedAirModule({ source, sourceName: sourcePath, library: true, packageDigest: PKG });
    const a = air.invokeBorrowedMemory(options(verified));
    const bytes = await air.watToWasm(air.lowerToWat(air.parseAir(source, sourcePath, { resolveSourceImports: false })), sourcePath);
    const b = raw.invokeRawBorrowedMemory(options(await raw.instantiateRawWasm({ wasmBytes: bytes, packageDigest: PKG })));
    const equal = JSON.stringify(a) === JSON.stringify(b);
    return { ok: a.result === 2 && equal, detail: { result: a.result, codes: codesOf(a), equalToRaw: equal } };
  },
  "V1-P2": async (ctx) => {
    const out = childProcess.spawnSync(process.execPath, [path.join(ctx.tree, "examples/borrowed_slices/sdk/copied_binding.js")], { cwd: ctx.work, encoding: "utf8" });
    const parsed = out.status === 0 ? JSON.parse(out.stdout) : null;
    return { ok: Boolean(parsed && parsed.result === 2 && parsed.output === 42), detail: parsed ? { result: parsed.result, output: parsed.output, stdoutSha256: sha(out.stdout) } : String(out.stderr).slice(0, 160) };
  },
  "V1-C1": async (ctx) => {
    const { raw, params, options, counter, hostImports, crafted } = lane(ctx);
    counter.effects = 0;
    const inst = await raw.instantiateRawWasm({ wasmBytes: await crafted(`(func (export "copy_final") (param ${params}) (result i32) call $e drop i32.const 7)`), packageDigest: PKG, imports: hostImports() });
    const r = raw.invokeRawBorrowedMemory(options(inst));
    return { ok: r.result === 7 && counter.effects === 1, detail: { result: r.result, effects: counter.effects } };
  },
  "V1-H1": async (ctx) => {
    const { air, options, counter, rawCrafted } = lane(ctx);
    counter.effects = 0;
    const r = air.invokeBorrowedMemory(options(await rawCrafted()));
    return { ok: codesOf(r).includes("air.borrow.instance_unverified") && counter.effects === 0 && r.result == null, detail: { codes: codesOf(r), effects: counter.effects, result: r.result } };
  },
  "V1-H1p": async (ctx) => {
    const { air, options, counter, rawCrafted } = lane(ctx);
    counter.effects = 0;
    const e = await thrown(async () => air.prepareBorrowedMemoryInvocation(options(await rawCrafted())));
    return { ok: Boolean(e && e.code === "air.borrow.instance_unverified" && e.name === "BorrowedMemoryBindingError") && counter.effects === 0, detail: { code: e && e.code, name: e && e.name, effects: counter.effects } };
  },
  ...Object.fromEntries([
    ["V1-H2", "an i64 result (the export calls the host first)", (p) => `(func (export "copy_final") (param ${p}) (result i64) call $e)`],
    ["V1-H2b", "a void result", (p) => `(func (export "copy_final") (param ${p}) call $e drop)`],
    ["V1-H2c", "two i32 results", (p) => `(func (export "copy_final") (param ${p}) (result i32 i32) call $e drop i32.const 1 i32.const 2)`],
    ["V1-H2d", "the host import itself (returning i64) re-exported as the entry", () => "(export \"copy_final\" (func $e))"]
  ].map(([id, , body]) => [id, async (ctx) => {
    const { air, raw, params, options, counter, hostImports, crafted } = lane(ctx);
    counter.effects = 0;
    const bytes = id === "V1-H2d"
      ? await air.watToWasm(`(module (import "env" "effect" (func $e (param ${params}) (result i64))) (memory (export "memory") 1) ${MARKER} ${body(params)})`, "crafted.wat")
      : await crafted(body(params));
    const imports = id === "V1-H2d" ? { env: { effect: () => { counter.effects += 1; return 0n; } } } : hostImports();
    const inst = await raw.instantiateRawWasm({ wasmBytes: bytes, packageDigest: PKG, imports });
    const r = raw.invokeRawBorrowedMemory(options(inst));
    const e = await thrown(() => raw.prepareRawBorrowedMemoryInvocation(options(inst)));
    return { ok: codesOf(r).includes("air.borrow.result_unsupported") && r.result == null && Boolean(e && e.code === "air.borrow.result_unsupported") && counter.effects === 0,
      detail: { codes: codesOf(r), prepare: e && e.code, effects: counter.effects } };
  }])),
  "V1-H2e": async (ctx) => {
    const { raw, params, options } = lane(ctx);
    const wabt = await require("wabt")();
    const bytes = Buffer.from(wabt.parseWat("tag.wat", `(module (import "env" "tag" (tag)) (memory (export "memory") 1) ${MARKER}
      (func (export "copy_final") (param ${params}) (result i32) i32.const 7))`, { exceptions: true }).toBinary({}).buffer);
    const inst = await raw.instantiateRawWasm({ wasmBytes: bytes, packageDigest: PKG, imports: { env: { tag: new WebAssembly.Tag({ parameters: [] }) } } });
    const r = raw.invokeRawBorrowedMemory(options(inst));
    const e = await thrown(() => raw.prepareRawBorrowedMemoryInvocation(options(inst)));
    return { ok: codesOf(r).includes("air.borrow.result_unsupported") && r.result == null && Boolean(e && e.code === "air.borrow.result_unsupported"),
      detail: { codes: codesOf(r), prepare: e && e.code, result: r.result } };
  },
  "V1-H2r": async (ctx) => {
    const { air, source, options } = lane(ctx);
    const voidSource = source.replace(") -> i32 {", ") -> void {").replace("  return %count\n", "  return\n");
    if (voidSource === source) throw new Error("void variant not built");
    const inst = await air.instantiateVerifiedAirModule({ source: voidSource, sourceName: "copy_final_void.air", library: true, packageDigest: PKG });
    const o = options(inst);
    const r = air.invokeBorrowedMemory({ ...o, interfaceDescriptor: air.borrowedSliceInterfaceDescriptor(air.parseAir(voidSource, "copy_final_void.air", { resolveSourceImports: false })) });
    const written = new DataView(o.bindings.dst.buffer.buffer).getInt32(4, true);
    return { ok: codesOf(r).includes("air.borrow.result_unsupported") && r.result == null && written === 0, detail: { codes: codesOf(r), result: r.result, dstAt4: written } };
  },
  "V1-H2f": async (ctx) => {
    const { raw, params, flat, options, counter, hostImports, crafted } = lane(ctx);
    counter.effects = 0;
    const plain = await crafted(`(func (export "copy_final") (param ${params}) (result i64) call $e)`);
    const real = [0x60, flat, ...Array(flat).fill(0x7f), 0x01, 0x7e];
    const bytes = patchType(Buffer.from(plain), "copy_final", [decoy(), real]);
    const inst = await raw.instantiateRawWasm({ wasmBytes: bytes, packageDigest: PKG, imports: hostImports() });
    const r = raw.invokeRawBorrowedMemory(options(inst));
    const e = await thrown(() => raw.prepareRawBorrowedMemoryInvocation(options(inst)));
    return { ok: codesOf(r).includes("air.borrow.result_unsupported") && r.result == null && Boolean(e && e.code === "air.borrow.result_unsupported") && counter.effects === 0,
      detail: { codes: codesOf(r), prepare: e && e.code, effects: counter.effects } };
  },
  "V1-H3": async (ctx) => {
    const { air } = lane(ctx);
    const bad = "module bad\ncapabilities { }\n\nextern output.emit(output_id: i32, arg0: i32, arg1: i32, arg2: i32, arg3: i32) -> i32\n\nexport func f() -> i32 {\nentry:\n  %one:i32 = 1\n  %s:i32 = @output.emit(%one, %one, %one, %one, %one)\n  return %s\n}\n";
    let instantiated = 0;
    const original = WebAssembly.instantiate;
    WebAssembly.instantiate = function counted(...args) { instantiated += 1; return original.apply(this, args); };
    let e;
    try { e = await thrown(() => air.instantiateVerifiedAirModule({ source: bad, sourceName: "bad.air", imports: { output: { emit: () => 0 } } })); }
    finally { WebAssembly.instantiate = original; }
    return { ok: Boolean(e) && String(e.message).startsWith("output host call 'output.emit' requires an explicit effect budget") && instantiated === 0,
      detail: { message: e && String(e.message).slice(0, 100), instantiated } };
  },
  "V1-H4": async (ctx) => {
    const { air, mod, source, sourcePath } = lane(ctx);
    const bytes = await air.watToWasm(air.lowerToWat(mod), sourcePath);
    const a = await thrown(() => air.instantiateVerifiedAirModule({ wasmBytes: bytes }));
    const b = await thrown(() => air.instantiateVerifiedAirModule({ source, wasmBytes: bytes }));
    const want = "air.instantiate.source_required: instantiateVerifiedAirModule takes AIR source text, never Wasm bytes";
    return { ok: Boolean(a && b && a.message === want && b.message === want), detail: [a && a.message, b && b.message] };
  },
  "V1-P3": async (ctx) => {
    const r = await replayState(ctx, "");
    return { ok: r.status === "pass", detail: { status: r.status, kinds: (r.mismatches || []).map((m) => m.kind) } };
  },
  "V1-H5": async (ctx) => {
    const r = await replayState(ctx, "\nexport func probe_extra() -> i32 {\nentry:\n  %v:i32 = 9\n  return %v\n}\n");
    const m = (r.mismatches || []).find((x) => x.kind === "wasm-source-mismatch");
    return { ok: r.status === "fail" && Boolean(m && m.message.startsWith("air.conformance.wasm_source_mismatch:")) && (r.steps || []).length === 0,
      detail: { status: r.status, kinds: (r.mismatches || []).map((x) => x.kind), steps: (r.steps || []).length } };
  },
  "V1-P4": async (ctx) => {
    const r = await benchmark(ctx, "ok", false);
    const unavailable = (r.diagnostics || []).filter((d) => d.code === "air.benchmark.runtime_unavailable");
    return { ok: typeof r.metrics.wasmExecutionMs === "number" && unavailable.length === 0, detail: { ms: typeof r.metrics.wasmExecutionMs, unavailable: unavailable.length } };
  },
  "V1-H6": async (ctx) => {
    const r = await benchmark(ctx, "broken", true);
    const unavailable = (r.diagnostics || []).find((d) => d.code === "air.benchmark.runtime_unavailable");
    const limited = (r.limitations || []).includes("wasmExecutionMs unavailable because runtime execution could not complete");
    return { ok: Boolean(unavailable) && unavailable.message.startsWith("air.benchmark.wasm_unbuilt:") && limited, detail: { message: unavailable && unavailable.message.slice(0, 80), limited } };
  },
  "V1-I1": async (ctx) => {
    const keys = consumer(ctx)("process.stdout.write(JSON.stringify(Object.keys(require('@underskys/air-core'))))");
    return { ok: Array.isArray(keys) && ROOT_HAS.every((k) => keys.includes(k)) && ROOT_LACKS.every((k) => !keys.includes(k)),
      detail: Array.isArray(keys) ? { missing: ROOT_HAS.filter((k) => !keys.includes(k)), present: ROOT_LACKS.filter((k) => keys.includes(k)), names: keys.length } : keys };
  },
  "V1-I2": async (ctx) => {
    const keys = consumer(ctx)("process.stdout.write(JSON.stringify(Object.keys(require('@underskys/air-core/raw')).sort()))");
    return { ok: JSON.stringify(keys) === JSON.stringify(RAW_NAMES.slice().sort()), detail: keys };
  },
  "V1-I3": async (ctx) => {
    const result = consumer(ctx)("const out = {}; for (const s of ['@underskys/air-core/src/raw.js', '@underskys/air-core/src/raw', '@underskys/air-core/src/sdk.js', '@underskys/air-core/src/borrowed_memory_binding.js']) { try { require.resolve(s); out[s] = 'resolved'; } catch (e) { out[s] = e.code; } } process.stdout.write(JSON.stringify(out));");
    return { ok: Boolean(result) && Object.values(result).length === 4 && Object.values(result).every((v) => v === "ERR_PACKAGE_PATH_NOT_EXPORTED"), detail: result };
  },
  "V1-I4": async (ctx) => {
    const kinds = consumer(ctx)("const m = await import('@underskys/air-core/raw'); process.stdout.write(JSON.stringify(['instantiateRawWasm','invokeRawBorrowedMemory','prepareRawBorrowedMemoryInvocation'].map((k) => typeof m[k])));", "esm");
    return { ok: JSON.stringify(kinds) === JSON.stringify(["function", "function", "function"]), detail: kinds };
  },
  "V1-B1": async (ctx) => {
    const count = (text) => (text.match(/WebAssembly\.(?:instantiate|compile)\(|new WebAssembly\.(?:Instance|Module)\(/gu) || []).length;
    const binding = fs.readFileSync(path.join(ctx.tree, "src/borrowed_memory_binding.js"), "utf8");
    const marker = binding.indexOf("// P0-08 typed-v0.53 admission");
    const sdk = count(fs.readFileSync(path.join(ctx.tree, "src/sdk.js"), "utf8"));
    const rawFile = count(fs.readFileSync(path.join(ctx.tree, "src/raw.js"), "utf8"));
    const before = marker < 0 ? -1 : count(binding.slice(0, marker));
    return { ok: sdk === 0 && rawFile === 0 && before === 1, detail: { sdk, raw: rawFile, bindingAboveTypedAdmission: before } };
  }
};

// VECTORS.md section 5 (SPEC 4.1): linked packages in conformance replay. The packages are built with this tree's
// linked builder and lowering (ctx.R); the replay under test is the tree at ctx.tree (ctx.S).
async function linkedCases(ctx) {
  if (ctx.cases) return ctx.cases;
  const { buildLinkedPackage } = ctx.R("src/linked_package.js");
  const { parseAir } = ctx.R("src/parser.js");
  const { verifyModule } = ctx.R("src/verifier.js");
  const { lowerToWat, watToWasm } = ctx.R("src/lower_wasm.js");
  const lowerFile = async (file) => { const mod = parseAir(fs.readFileSync(file, "utf8"), file); verifyModule(mod); return Buffer.from(await watToWasm(lowerToWat(mod), file)); };
  const lowerText = async (text, file) => Buffer.from(await watToWasm(lowerToWat(parseAir(text, file)), file));
  const traceFile = (dir, name, pkg, exportName, args, expectReturn) => {
    fs.mkdirSync(path.join(dir, "traces"), { recursive: true });
    const file = path.join(dir, "traces", `${name}.json`);
    fs.writeFileSync(file, `${JSON.stringify({ schemaVersion: "0.16", kind: "air.conformance.trace", id: name, package: pkg, profile: "cli", steps: [{ id: "s1", call: { export: exportName, args }, expect: { return: expectReturn } }] }, null, 2)}\n`);
    return file;
  };
  const cases = {};
  const l1 = ctx.folder("L1");
  fs.cpSync(path.join(ROOT, "test/fixtures/package_composition/conformance_multi_module"), l1, { recursive: true });
  await buildLinkedPackage(l1, path.join(l1, "linked.wasm"), { profile: "cli" });
  cases["V5-L1"] = { dir: l1, trace: path.join(l1, "traces/pass.json"), expect: "pass" };
  const l2 = ctx.folder("L2");
  fs.cpSync(l1, l2, { recursive: true });
  const math = path.join(l2, "math.air");
  const good = fs.readFileSync(math, "utf8");
  const other = good.replace("  %two:i32 = 2\n  %next:i32 = add %value, %two\n", "  %one:i32 = 1\n  %half:i32 = add %value, %one\n  %next:i32 = add %half, %one\n");
  if (other === good) throw new Error("L2: math.air moved");
  fs.writeFileSync(math, other);
  await buildLinkedPackage(l2, path.join(l2, "linked.wasm"), { profile: "cli" });
  fs.writeFileSync(math, good);
  cases["V5-L2"] = { dir: l2, trace: path.join(l2, "traces/pass.json"), expect: "wasm-source-mismatch" };
  const l3 = ctx.folder("L3");
  fs.cpSync(l1, l3, { recursive: true });
  const bytes = fs.readFileSync(path.join(l3, "linked.wasm"));
  bytes[bytes.indexOf(Buffer.from([0x41, 0x02])) + 1] = 0x03;
  fs.writeFileSync(path.join(l3, "linked.wasm"), bytes);
  cases["V5-L3"] = { dir: l3, trace: path.join(l3, "traces/pass.json"), expect: "wasm-source-mismatch" };
  const p1 = ctx.folder("P1");
  fs.cpSync(path.join(ROOT, "examples/policy_audit_package"), p1, { recursive: true });
  const mp = JSON.parse(fs.readFileSync(path.join(p1, "air.package.json"), "utf8"));
  mp.wasm = "linked.wasm";
  fs.writeFileSync(path.join(p1, "air.package.json"), `${JSON.stringify(mp, null, 2)}\n`);
  await buildLinkedPackage(p1, path.join(p1, "linked.wasm"), { profile: "cli" });
  cases["V5-P1"] = { dir: p1, trace: traceFile(p1, "budget", mp.name, "service_retry_budget_ms", [1], 250), expect: "pass" };
  const p2 = ctx.folder("P2");
  fs.cpSync(p1, p2, { recursive: true });
  const allow = path.join(p2, "allowlist.air");
  const allowGood = fs.readFileSync(allow, "utf8");
  const allowOther = allowGood.replace("const RETRY_SLOW_MS:i32 = 250", "const RETRY_SLOW_MS:i32 = 251");
  if (allowOther === allowGood) throw new Error("P2: allowlist.air moved");
  fs.writeFileSync(allow, allowOther);
  await buildLinkedPackage(p2, path.join(p2, "linked.wasm"), { profile: "cli" });
  fs.writeFileSync(allow, allowGood);
  cases["V5-P2"] = { dir: p2, trace: traceFile(p2, "budget-api", mp.name, "service_retry_budget_ms", [0], 100), expect: "wasm-source-mismatch" };
  const s1 = ctx.folder("S1");
  fs.cpSync(path.join(ROOT, "test/fixtures/conformance_policy"), s1, { recursive: true });
  fs.writeFileSync(path.join(s1, "module.wasm"), await lowerFile(path.join(s1, "module.air")));
  cases["V5-S1"] = { dir: s1, trace: path.join(s1, "traces/basic.json"), expect: "pass" };
  const s2 = ctx.folder("S2");
  fs.cpSync(s1, s2, { recursive: true });
  const s2src = fs.readFileSync(path.join(s2, "module.air"), "utf8");
  fs.writeFileSync(path.join(s2, "module.wasm"), await lowerText(`${s2src}\nexport func probe_extra() -> i32 {\nentry:\n  %v:i32 = 9\n  return %v\n}\n`, path.join(s2, "module.air")));
  cases["V5-S2"] = { dir: s2, trace: path.join(s2, "traces/basic.json"), expect: "wasm-source-mismatch" };
  const s3 = ctx.folder("S3");
  const struct = fs.readFileSync(path.join(ROOT, "examples/player_state.air"), "utf8");
  fs.writeFileSync(path.join(s3, "module.air"), struct);
  fs.writeFileSync(path.join(s3, "air.package.json"), `${JSON.stringify({ name: "s3-struct", version: "0.1.0", airAbi: "0.10", hostAbi: "0.10", entry: "module.air", wasm: "module.wasm", capabilities: [], targetProfiles: ["cli"] }, null, 2)}\n`);
  fs.writeFileSync(path.join(s3, "module.wasm"), await lowerText(`${struct}\nexport func probe_extra() -> i32 {\nentry:\n  %v:i32 = 9\n  return %v\n}\n`, path.join(s3, "module.air")));
  cases["V5-S3"] = { dir: s3, trace: traceFile(s3, "run", "s3-struct", "run", [], 2), expect: "wasm-source-mismatch" };
  const s4 = ctx.folder("S4");
  fs.cpSync(s3, s4, { recursive: true });
  fs.writeFileSync(path.join(s4, "module.wasm"), await lowerFile(path.join(s4, "module.air")));
  cases["V5-S4"] = { dir: s4, trace: path.join(s4, "traces/run.json"), expect: "pass" };
  ctx.cases = cases;
  return cases;
}

async function replayOutcome(ctx, id) {
  const c = (await linkedCases(ctx))[id];
  const r = await ctx.S("src/conformance_replay.js").createConformanceReplayReport(c.dir, { profile: "cli", trace: c.trace });
  const kinds = (r.mismatches || []).map((m) => m.kind);
  let outcome;
  if (r.status === "pass") outcome = "pass";
  else if (kinds.length === 1 && kinds[0] === "wasm-source-mismatch" && (r.steps || []).length === 0) outcome = "wasm-source-mismatch";
  else outcome = `fail:${kinds.join(",")}:steps=${(r.steps || []).length}`;
  return { ok: outcome === c.expect, detail: { outcome, expect: c.expect } };
}

const V5 = {
  ...Object.fromEntries(["V5-L1", "V5-L2", "V5-L3", "V5-P1", "V5-P2", "V5-S1", "V5-S2", "V5-S3", "V5-S4"].map((id) => [id, (ctx) => replayOutcome(ctx, id)])),
  // C1: the linked lowering is a fixed function of the verified source: two builds, and the build against the in-memory
  // lowering with the profile "cli", unset and releaseCandidate; the name given to wabt does not reach the bytes.
  "V5-C1": async (ctx) => {
    const linked = ctx.S("src/linked_package.js");
    const dir = ctx.folder("C1");
    fs.cpSync(path.join(ROOT, "test/fixtures/package_composition/conformance_multi_module"), dir, { recursive: true });
    await linked.buildLinkedPackage(dir, path.join(dir, "a.wasm"), { profile: "cli" });
    await linked.buildLinkedPackage(dir, path.join(dir, "b.wasm"), { profile: "cli" });
    const a = fs.readFileSync(path.join(dir, "a.wasm"));
    const b = fs.readFileSync(path.join(dir, "b.wasm"));
    const memo = {};
    for (const [label, options] of [["cli", { profile: "cli" }], ["unset", {}], ["releaseCandidate", { profile: "cli", releaseCandidate: true }]]) {
      memo[label] = Buffer.from((await linked.linkedPackageWasm(dir, options)).wasm).equals(a);
    }
    const lowering = await linked.linkedPackageWasm(dir, { profile: "cli" });
    const renamed = Buffer.from(await ctx.S("src/lower_wasm.js").watToWasm(lowering.wat, "another-name.wat")).equals(a);
    return { ok: a.equals(b) && Object.values(memo).every(Boolean) && renamed, detail: { twoBuilds: a.equals(b), inMemory: memo, renamed, wasm: sha(a) } };
  },
  // C3: the linked lowering adds no name to the package root, and linked_package's enumerable exports stay the base's three.
  "V5-C3": async (ctx) => {
    const root = Object.keys(ctx.S("src/index.js"));
    const linked = ctx.S("src/linked_package.js");
    const own = Object.keys(linked);
    return { ok: !root.includes("linkedPackageWasm") && JSON.stringify(own) === JSON.stringify(["LINKED_PACKAGE_SCHEMA_VERSION", "buildLinkedPackage", "linkedBuildReport"]) && typeof linked.linkedPackageWasm === "function",
      detail: { rootNames: root.length, linkedPackageWasmOnRoot: root.includes("linkedPackageWasm"), enumerable: own } };
  }
};

// VECTORS.md section 6 (SPEC OD-S2-6 and 4.1 step 3): parameter lanes on the borrowed lane and the typed invoke, and
// the replay message when no verified lowering exists.
const G = { allowCandidateProfile: true, sourceProfile: "typed-v0.53" };
const V2 = { airAbi: "0.13", feature: "typed-memory-v1", lengthUnit: "bytes", memoryDomains: ["wasm-linear"], schema: "air.borrowed-slice-interface.v2", transferModeRequired: true };

async function borrowedRow(ctx, label, extraParam, descriptorType, args, which) {
  const air = ctx.S("src/index.js");
  const base = fs.readFileSync(path.join(ctx.tree, "examples/borrowed_slices/wasm/copy_final_i32.air"), "utf8");
  const source = extraParam ? base.replace("count: i32) -> i32 {", `count: i32, x: ${extraParam}) -> i32 {`) : base;
  if (extraParam && source === base) throw new Error("the example's signature moved");
  const sourceName = `${label}.air`;
  const packageDigest = sha(Buffer.from(source));
  const mod = air.parseAir(source, sourceName, { resolveSourceImports: false });
  air.verifyModule(mod, { library: true });
  const raw = ctx.S("src/raw.js");
  const instance = which === "raw"
    ? await raw.instantiateRawWasm({ wasmBytes: Buffer.from(await air.watToWasm(air.lowerToWat(mod), sourceName)), packageDigest })
    : await air.instantiateVerifiedAirModule({ source, sourceName, library: true, packageDigest });
  const descriptor = JSON.parse(JSON.stringify(air.borrowedSliceInterfaceDescriptor(mod)));
  if (descriptorType) for (const e of descriptor.exports || []) for (const p of e.params || []) if (p.name === "x") p.type = descriptorType;
  const slot = (buffer, access) => ({ buffer, access, maxLength: 8, alignment: 4, aliasGroup: null, memoryDomain: "wasm-linear", transferMode: "copied_into_wasm" });
  const src = new Uint8Array(8); const dst = new Uint8Array(8); new DataView(src.buffer).setInt32(4, 42, true);
  const invoke = which === "raw" ? raw.invokeRawBorrowedMemory : air.invokeBorrowedMemory;
  const written = () => new DataView(dst.buffer).getInt32(4, true) === 42;
  try {
    const r = invoke({ instance, interfaceDescriptor: descriptor, packageDigest, entrypoint: "copy_final", bindings: { src: slot(src, "readonly"), dst: slot(dst, "writeonly") }, arguments: args });
    const codes = codesOf(r);
    return codes.length ? { kind: "refused", codes, dstWritten: written() } : { kind: "ran", result: r.result, dstWritten: written() };
  } catch (e) {
    return { kind: "thrown", error: short(e), code: e.code || null, dstWritten: written() };
  }
}

async function typedRow(ctx, label, craftedSig) {
  const sp = ctx.S("src/source_profile.js");
  const parser = ctx.S("src/parser.js");
  const bs = ctx.S("src/borrowed_slices.js");
  const { lowerToWat } = ctx.S("src/lower_wasm.js");
  const { buildVerifiedTypedModule } = ctx.S("src/v052_verified_build.js");
  const { admitTypedV053Artifact } = ctx.S("src/sdk.js");
  const source = ["module v53.r4", "capabilities { debug }", "demand { debug.metric <= 1 }", "", "extern debug.metric(id: i32, value: i32) -> void", "",
    "export func i(x: i32) -> i32 {", "  call @debug.metric(1, %x)", "  return %x", "}", ""].join("\n");
  const ast = parser.typedV053.parse(source, "main.air");
  const written = new Map(((bs.typedV053.interfaceDescriptor(ast) || {}).exports || []).map((e) => [e.name, e]));
  const descriptor = { ...V2, memoryDomains: [...V2.memoryDomains], exports: ast.functions.filter((f) => f.exported).map((f) => written.get(f.name) || { entryContracts: [], name: f.name, params: f.params.map((p) => ({ kind: "value", name: p.name, type: p.type })) }) };
  await buildVerifiedTypedModule({ ...G, descriptor, source, sourceName: "main.air" });
  let wat = lowerToWat(sp.parseSource(source, "main.air", G), { allowCandidateProfile: true, maxWatBytes: 4194304 });
  const entry = descriptor.exports.find((e) => e.name === "i");
  let entrypoint = "i";
  if (craftedSig) {
    const imp = /\(import "debug" "metric" \(func (\$[^\s)]+)/.exec(wat)[1];
    wat = wat.replace(/\)\s*$/, `\n  (func (export "crafted") ${craftedSig} (call ${imp} (i32.const 9) (i32.const 9)) (i32.const 1))\n)\n`);
    descriptor.exports = [...descriptor.exports, { ...entry, name: "crafted" }];
    entrypoint = "crafted";
  }
  const wabt = await require("wabt")();
  const bytes = Buffer.from(wabt.parseWat(`${label}.wat`, wat, { multi_value: true }).toBinary({}).buffer);
  const log = []; const trace = [];
  const handlers = { "debug.metric": (...a) => { log.push(a.length); } };
  let admission;
  try { admission = await admitTypedV053Artifact({ handlers, interfaceDescriptor: descriptor, pinnedDigest: sha(bytes), trace, wasmBytes: bytes }); }
  catch (e) { return { kind: "admission_refused", code: e.code || null, hostCalls: log.length }; }
  try {
    const r = await admission.invoke({ arguments: { x: 7 }, bindings: {}, entrypoint });
    const codes = codesOf(r);
    return codes.length ? { kind: "refused", codes, hostCalls: log.length, invoked: trace.includes("step4.invoke") } : { kind: "passed", result: r.result, hostCalls: log.length };
  } catch (e) {
    return { kind: "thrown", error: short(e), code: e.code || null, hostCalls: log.length };
  }
}

async function replayRow(ctx, label, kind) {
  const dir = ctx.folder(label);
  fs.mkdirSync(path.join(dir, "traces"), { recursive: true });
  if (kind === "none") {
    fs.writeFileSync(path.join(dir, "main.air"), ["module main", "use \"./lib.air\" as lib", "capabilities { }", "", "struct Pair { a: i32, b: i32 }", "",
      "export func run(seed: i32) -> i32 {", "entry:", "  %pair:Pair = struct.new %seed, %seed", "  %a:i32 = struct.get.a %pair", "  %next:i32 = @lib.add_k(%a)", "  return %next", "}", ""].join("\n"));
    fs.writeFileSync(path.join(dir, "lib.air"), ["module lib", "const K:i32 = 2", "table ks:i32[1] = [K]", "capabilities { }", "", "export func add_k(value: i32) -> i32 {", "entry:", "  %k:i32 = table.get ks, 0", "  %next:i32 = add %value, %k", "  return %next", "}", ""].join("\n"));
  } else {
    fs.writeFileSync(path.join(dir, "main.air"), ["module main", "capabilities { }", "", "export func run(seed: i32) -> i32 {", "entry:", "  %two:i32 = 2", "  %next:i32 = add %seed, %two", "  return %next", "}", ""].join("\n"));
  }
  fs.writeFileSync(path.join(dir, "air.package.json"), `${JSON.stringify({ name: label, version: "0.1.0", airAbi: "0.10", hostAbi: "0.10", entry: "main.air", wasm: "module.wasm", capabilities: [], targetProfiles: ["cli"] }, null, 2)}\n`);
  const wabt = await require("wabt")();
  fs.writeFileSync(path.join(dir, "module.wasm"), Buffer.from(wabt.parseWat("other.wat", "(module (func (export \"run\") (param i32) (result i32) (i32.add (local.get 0) (i32.const 2))))").toBinary({}).buffer));
  const trace = path.join(dir, "traces", "pass.json");
  fs.writeFileSync(trace, `${JSON.stringify({ schemaVersion: "0.16", kind: "air.conformance.trace", id: label, package: label, profile: "cli", steps: [{ id: "s1", call: { export: "run", args: [7] }, expect: { return: 9 } }] }, null, 2)}\n`);
  const r = await ctx.S("src/conformance_replay.js").createConformanceReplayReport(dir, { profile: "cli", trace });
  return { status: r.status, kinds: (r.mismatches || []).map((m) => m.kind), messages: (r.mismatches || []).map((m) => String(m.message).slice(0, 120)), stepsRun: (r.steps || []).length };
}

const refusedLanes = (r) => r.kind === "refused" && JSON.stringify(r.codes) === "[\"air.borrow.interface_invalid\"]";
const v6 = (fn, expected) => async (ctx) => { const r = await fn(ctx); return { ok: expected(r), detail: r }; };
const V6 = {
  "V6-P0": v6((ctx) => borrowedRow(ctx, "p0", null, null, { count: 2 }), (r) => r.kind === "ran" && r.dstWritten),
  "V6-P1": v6((ctx) => borrowedRow(ctx, "p1", "i64", null, { count: 2, x: 5 }), (r) => r.kind === "refused" && JSON.stringify(r.codes) === "[\"air.borrow.argument_invalid\"]" && !r.dstWritten),
  "V6-P3": v6((ctx) => borrowedRow(ctx, "p3", "i64", "i32", { count: 2, x: 5 }), (r) => refusedLanes(r) && !r.dstWritten),
  "V6-PF": v6((ctx) => borrowedRow(ctx, "pf", "f32", null, { count: 2, x: 1.5 }), (r) => r.kind === "ran" && r.dstWritten),
  "V6-PW": v6((ctx) => borrowedRow(ctx, "pw", "f32", "i32", { count: 2, x: 5 }), (r) => refusedLanes(r) && !r.dstWritten),
  "V6-PR": v6((ctx) => borrowedRow(ctx, "pr", "i64", "i32", { count: 2, x: 5 }, "raw"), (r) => refusedLanes(r) && !r.dstWritten),
  "V6-T0": v6((ctx) => typedRow(ctx, "t0", null), (r) => r.kind === "passed" && r.hostCalls === 1),
  "V6-T1": v6((ctx) => typedRow(ctx, "t1", "(param i64) (result i32)"), (r) => refusedLanes(r) && r.hostCalls === 0 && !r.invoked),
  "V6-T2": v6((ctx) => typedRow(ctx, "t2", "(param f64) (result i32)"), (r) => refusedLanes(r) && r.hostCalls === 0 && !r.invoked),
  "V6-M1": v6((ctx) => replayRow(ctx, "m1", "none"), (r) => r.status === "fail" && r.kinds.join() === "wasm-source-mismatch" && r.stepsRun === 0
    && r.messages[0] === "air.conformance.wasm_source_mismatch: no verified lowering could be made"),
  "V6-M2": v6((ctx) => replayRow(ctx, "m2", "single"), (r) => r.status === "fail" && r.kinds.join() === "wasm-source-mismatch" && r.stepsRun === 0
    && r.messages[0].startsWith("air.conformance.wasm_source_mismatch: package Wasm does not match"))
};

const ROWS = { ...V1, ...V5, ...V6 };

async function runRows(tree, ids) {
  const ctx = rowContext(tree);
  const out = {};
  try {
    for (const id of ids) {
      try {
        const r = await ROWS[id](ctx);
        out[id] = { ok: Boolean(r.ok), detail: r.detail };
      } catch (error) {
        out[id] = { ok: false, threw: short(error) };
      }
    }
  } finally {
    fs.rmSync(ctx.work, { force: true, recursive: true });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Orchestrator side: the mutants (SPEC section 7's M1-M15, section 4.1's MA0-MA5, VECTORS.md section 6's MP1-MP4
// and MM1). Each edit's anchor must occur exactly once in its file of the scratch copy, or the mutant is not applied.

const BMB = "src/borrowed_memory_binding.js";
const SDK = "src/sdk.js";
const REPLAY = "src/conformance_replay.js";
const LINKED = "linkedPackageWasm(base, { profile }).catch(() => null);";
const MUTANTS = {
  M1: { group: "V1", rows: ["V1-H1", "V1-H1p"], description: "the root lane accepts raw instances", edits: [[BMB, "if (!identity.verified && !allowRaw) {", "if (false) {"]] },
  M2: { group: "V1", rows: ["V1-H1", "V1-H1p"], description: "/raw registers its instances as verified", edits: [["src/raw.js", "verified: false", "verified: true"]] },
  M3: { group: "V1", rows: ["V1-H2", "V1-H2b", "V1-H2c", "V1-H2d"], description: "the result-lane check removed",
    edits: [[BMB, "if (!resultLanes || resultLanes.length !== 1 || !BORROWED_RESULT_LANES.includes(resultLanes[0])) {", "if (false) {"]] },
  M4: { group: "V1", rows: ["V1-H2e"], description: "an export with no recorded lanes is allowed",
    edits: [[BMB, "if (!resultLanes || resultLanes.length !== 1 || !BORROWED_RESULT_LANES.includes(resultLanes[0])) {", "if (resultLanes && (resultLanes.length !== 1 || !BORROWED_RESULT_LANES.includes(resultLanes[0]))) {"]] },
  M5: { group: "V1", rows: ["V1-H2"], description: "i64 added to the allowed lanes", edits: [[BMB, "Object.freeze([\"i32\", \"f32\", \"f64\"])", "Object.freeze([\"i32\", \"i64\", \"f32\", \"f64\"])"]] },
  M6: { group: "V1", rows: ["V1-H3"], description: "the verified entry skips verifyModule", edits: [[SDK, "  verifyModule(mod, { library: options.library === true });\n", ""]] },
  M7: { group: "V1", rows: ["V1-H4"], description: "the verified entry accepts bytes beside source", edits: [[SDK, " ||\n      options.wasmBytes !== undefined || options.wasmPath !== undefined", ""]] },
  M8: { group: "V1", rows: ["V1-H5"], description: "conformance replay's binding removed (re-anchored on the binding's opening test, which R3's (a) replaced)",
    edits: [[REPLAY, "if (!single || !single.equals(wasm)) {", "if (false) {"]] },
  M9: { group: "V1", rows: ["V1-H6"], description: "the benchmark runs the package's file when it built nothing",
    edits: [["src/benchmark_report.js", "  if (!builtWasm) throw new Error(\"air.benchmark.wasm_unbuilt: the runtime runs only the Wasm this benchmark built from the verified source\");",
      "  builtWasm = builtWasm || fs.readFileSync(path.join(packageDir, metadata.wasm || \"module.wasm\"));"]] },
  M10: { group: "V1", rows: ["V1-I1"], description: "the raw entries also exported from the root",
    edits: [[SDK, "  instantiateVerifiedAirModule,\n  admitTypedV053Artifact,", "  instantiateVerifiedAirModule,\n  ...require(\"./raw\"),\n  admitTypedV053Artifact,"]] },
  M11: { group: "V1", rows: ["V1-I2", "V1-I4"], description: "the map lacks ./raw", edits: [["package.json", ",\n    \"./raw\": \"./src/raw.js\"", ""]] },
  M12: { group: "V1", rows: ["V1-B1"], description: "a direct instantiation site added in sdk.js",
    edits: [[SDK, "  const wasm = await watToWasm(lowerToWat(mod), sourceName);\n", "  const wasm = await watToWasm(lowerToWat(mod), sourceName);\n  await WebAssembly.compile(wasm);\n"]] },
  M13: { group: "V1", rows: ["V1-I3"], description: "the map opens src/", edits: [["package.json", "\"./raw\": \"./src/raw.js\"", "\"./raw\": \"./src/raw.js\",\n    \"./src/*\": \"./src/*\""]] },
  M14: { group: "V1", rows: ["V1-H2r"], description: "the result-lane check applied on /raw only (QA's R1 review, P2-1)",
    edits: [[BMB, "if (!resultLanes || resultLanes.length !== 1 || !BORROWED_RESULT_LANES.includes(resultLanes[0])) {", "if (allowRaw && (!resultLanes || resultLanes.length !== 1 || !BORROWED_RESULT_LANES.includes(resultLanes[0]))) {"]] },
  M15: { group: "V1", rows: ["V1-H2f"], description: "SEC53-04's A3 reverted: the reader reads each value type as one byte",
    edits: [[BMB, "params.push(valueType());", "params.push(TYPED_WASM_VALTYPES[byte()] || \"other\");"], [BMB, "results.push(valueType());", "results.push(TYPED_WASM_VALTYPES[byte()] || \"other\");"]] },
  MA0: { group: "V5", rows: ["V5-L1", "V5-P1"], description: "the linked fallback removed (R2's behaviour)", edits: [[REPLAY, `linked = await ${LINKED}`, "linked = null;"]] },
  MA1: { group: "V5", rows: ["V5-L2", "V5-L3", "V5-P2", "V5-S2"], description: "the linked candidate accepted without comparing bytes",
    edits: [[REPLAY, "if (!linked || !Buffer.from(linked.wasm).equals(wasm)) {", "if (!linked) {"]] },
  MA2: { group: "V5", rows: ["V5-P1", "V5-P2"], description: "the entry's parse and verify unguarded (R2's order)",
    edits: [[REPLAY, "} catch (_) {\n      mod = null;\n    }", "} catch (err) {\n      throw err;\n    }"]] },
  MA3: { group: "V5", rows: ["V5-L1"], description: "the linked lowering tried only when the entry does not stand alone",
    edits: [[REPLAY, `linked = await ${LINKED}`, `linked = single ? null : await ${LINKED}`]] },
  MA4: { group: "V5", rows: ["V5-L2", "V5-L3", "V5-S2", "V5-S3"], description: "the single-entry candidate accepted without comparing bytes",
    edits: [[REPLAY, "if (!single || !single.equals(wasm)) {", "if (!single) {"]] },
  MA5: { group: "V5", rows: ["V5-S3"], description: "an error in the linked lowering accepts the bytes",
    edits: [[REPLAY, `linked = await ${LINKED}`, "linked = await linkedPackageWasm(base, { profile }).catch(() => ({ wasm }));"]] },
  MP1: { group: "V6", rows: ["V6-P3", "V6-PW", "V6-PR"], description: "the borrowed lane's param-lane check removed",
    edits: [[BMB, "\n  if (!paramLanes || paramLanes.join() !== borrowedParamLanes(entry).join()) {", "\n  if (false) {"]] },
  MP2: { group: "V6", rows: ["V6-T1", "V6-T2"], description: "the typed invoke's param-lane check removed",
    edits: [[BMB, "\n        if (!paramLanes || paramLanes.join() !== borrowedParamLanes(entry).join()) {", "\n        if (false) {"]] },
  MP3: { group: "V6", rows: ["V6-P0", "V6-PF", "V6-T1", "V6-T2"], description: "the reader records results as params",
    edits: [[BMB, "exportParams.set(exported, functionTypes[index].params);", "exportParams.set(exported, functionTypes[index].results);"]] },
  MP4: { group: "V6", rows: ["V6-PF"], description: "an f32 parameter flattened as i32", edits: [[BMB, "[param.type === \"f32\" ? \"f32\" : \"i32\"]", "[\"i32\"]"]] },
  MM1: { group: "V6", rows: ["V6-M1"], description: "the no-candidate message replaced by R3's",
    edits: [[REPLAY, "            : \"air.conformance.wasm_source_mismatch: no verified lowering could be made\"\n",
      "            : \"air.conformance.wasm_source_mismatch: package Wasm does not match deterministic lowering of the verified source\"\n"]] }
};
const GROUPS = { V1: Object.keys(V1), V5: Object.keys(V5).filter((id) => !id.startsWith("V5-C")), V6: Object.keys(V6) };

function scratchTree(name, mutant) {
  const scratch = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), `air-sec53-02-${name}-`));
  for (const part of ["src", "stdlib", "data", "package.json", "examples/borrowed_slices"]) fs.cpSync(path.join(ROOT, part), path.join(scratch, part), { recursive: true });
  fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(scratch, "node_modules"), "dir");
  let applied = true;
  for (const [file, from, to] of mutant.edits) {
    const target = path.join(scratch, file);
    const text = fs.readFileSync(target, "utf8");
    if (text.split(from).length !== 2) { applied = false; continue; }
    fs.writeFileSync(target, text.replace(from, () => to));
  }
  return { applied, scratch };
}

function runChild(tree, ids) {
  const outFile = path.join(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "air-sec53-02-out-")), "rows.json");
  const out = childProcess.spawnSync(process.execPath, [__filename, "--rows", tree, outFile, ...ids], {
    cwd: os.tmpdir(), encoding: "utf8", killSignal: "SIGKILL", maxBuffer: 64 * 1024 * 1024, timeout: CHILD_MS
  });
  let results = null;
  if (!out.signal && out.status === 0 && fs.existsSync(outFile)) results = JSON.parse(fs.readFileSync(outFile, "utf8"));
  fs.rmSync(path.dirname(outFile), { force: true, recursive: true });
  if (results) return { ran: true, results };
  const reason = out.signal ? `killed by ${out.signal} (timeout)` : `exit ${out.status}: ${String(out.stderr).slice(0, 400)}`;
  return { ran: Boolean(out.signal), results: Object.fromEntries(ids.map((id) => [id, { ok: false, child: reason }])) };
}

async function main() {
  const failures = [];
  const allRows = Object.keys(ROWS);
  const real = runChild(ROOT, allRows);
  for (const id of allRows) {
    const row = real.results[id];
    if (row && row.ok) console.log(`ok - ${id}`);
    else failures.push(`${id}: ${JSON.stringify(row)}`);
  }
  const mutants = {};
  for (const [name, mutant] of Object.entries(MUTANTS)) {
    const { applied, scratch } = scratchTree(name, mutant);
    let ran = false;
    let failing = [];
    let set = { results: {} };
    if (applied) {
      set = runChild(scratch, GROUPS[mutant.group]);
      ran = set.ran;
      failing = GROUPS[mutant.group].filter((id) => !(set.results[id] && set.results[id].ok));
    }
    fs.rmSync(scratch, { force: true, recursive: true });
    const caughtBy = mutant.rows.filter((id) => failing.includes(id));
    const caught = applied && ran && caughtBy.length > 0;
    // Why each named row failed under the mutant (its detail, the error it threw, or the child's end), cut to 300 characters.
    const caughtDetail = Object.fromEntries(caughtBy.map((id) => [id, JSON.stringify(set.results[id]).slice(0, 300)]));
    mutants[name] = { applied, caught, caught_by: caughtBy, caught_detail: caughtDetail, description: mutant.description, failing_rows: failing, group: mutant.group, named_rows: mutant.rows, ran };
    if (caught) console.log(`ok - mutant ${name} (${mutant.description}): applied, ran, caught by ${caughtBy.join(", ")}${failing.length > caughtBy.length ? `; also failing ${failing.filter((id) => !caughtBy.includes(id)).join(", ")}` : ""}`);
    else failures.push(`mutant ${name} (${mutant.description}): applied ${applied}, ran ${ran}, caught ${caught}, failing ${failing.join(", ") || "none"}`);
  }
  const list = Object.values(mutants);
  const totals = { applied: list.filter((item) => item.applied).length, caught: list.filter((item) => item.caught).length, mutants: list.length, ran: list.filter((item) => item.ran).length };
  if (process.env.AIR_SEC53_02_RESULTS_DIR) {
    fs.mkdirSync(process.env.AIR_SEC53_02_RESULTS_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.AIR_SEC53_02_RESULTS_DIR, "v053_execution_boundary.results.json"), `${JSON.stringify({ mutants, platform: process.platform, rows: real.results, totals }, null, 2)}\n`);
  }
  if (failures.length) {
    for (const failure of failures) console.error(`not ok - ${failure}`);
    console.error(`SEC53-02 execution boundary: ${failures.length} failed`);
    process.exitCode = 1;
    return;
  }
  assert.equal(totals.applied, totals.mutants);
  console.log(`SEC53-02 execution boundary: ${allRows.length} rows PASS (${GROUPS.V1.length} VECTORS.md section 1 rows, ${Object.keys(V5).length} section 5 rows, ${GROUPS.V6.length} section 6 rows); mutants applied ${totals.applied}, ran ${totals.ran}, caught ${totals.caught} of ${totals.mutants} (${process.platform})`);
}

if (process.argv[2] === "--rows") {
  const outFile = process.argv[4];
  runRows(path.resolve(process.argv[3]), process.argv.slice(5)).then((out) => fs.writeFileSync(outFile, JSON.stringify(out)), (error) => {
    console.error(error && error.stack || error);
    process.exitCode = 1;
  });
} else {
  main().catch((error) => {
    console.error(error && error.stack || error);
    process.exitCode = 1;
  });
}
