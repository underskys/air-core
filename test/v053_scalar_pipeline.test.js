#!/usr/bin/env node
"use strict";

// typed-v0.53 SCALAR slice (AIR-0053-P0-SCALAR-0001): pipeline vectors at the
// typed-v0.53 lowering entrypoints E1 (CLI build), E2 (SDK builder), E3
// (runtime) and E4 (direct lowerToWat with explicit limits), and the PF-1
// composites V53-WB-H10 and V53-WB-H04 that first become executable here.
// Expected values are copied from R3.1 VECTORS.md, the H53 record item 11 and
// the admitted slice text's VECTORS_ADDITIONS.md (V53-PIPE-07..10, §4 H10
// parts), never from the implementation under test.
// Set AIR_SCALAR_VECTOR_RESULTS_DIR=<dir> to write one canonical result record
// per vector.
const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const sp = require("../src/source_profile");
const wb = require("../src/workbound");
const { createVerifiedResourceCertificate } = require("../src/verifier");
const { lowerToWat } = require("../src/lower_wasm");
const {
  VERIFIED_TYPED_RUNTIME_LIMITS,
  buildVerifiedTypedModule,
  createVerifiedTypedRuntime,
  invokeVerifiedTypedExport
} = require("../src/v052_verified_build");

const ROOT = path.resolve(__dirname, "..");
const V053 = "typed-v0.53";
const GATED = Object.freeze({ allowCandidateProfile: true, sourceProfile: V053 });
const MAX_WAT = VERIFIED_TYPED_RUNTIME_LIMITS.maxWatBytes;
const BOUNDED_BUILD_CODES = new Set(["air.v052.work_limit_wat_bytes", "air.v052.work_limit_wasm_bytes", "air.build.engine_limit"]);
const results = [];
const failures = [];
const parts = {};

function sha256(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function plain(value) {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value)) if (value[key] !== undefined) out[key] = plain(value[key]);
    return out;
  }
  return value === undefined ? null : value;
}

function resultRecord(vectorId, status, value, extra = {}) {
  const valueOrFailure = plain(value === undefined ? null : value);
  return {
    evidence_digest: sha256(canonicalJson({ status, value_or_failure: valueOrFailure, vector: vectorId })),
    interface_digest: extra.interfaceDigest || null,
    source_digest: extra.sourceDigest || null,
    status,
    value_or_failure: valueOrFailure,
    vector: vectorId
  };
}

async function vector(id, action) {
  try {
    const outcome = (await action()) || {};
    results.push(resultRecord(id, outcome.status || "PASS", outcome.value, outcome));
  } catch (error) {
    failures.push(`${id}: ${error && error.stack || error}`);
    results.push(resultRecord(id, "FAIL", { error: String(error && error.message || error) }));
  }
}

// ---------------------------------------------------------------------------
// The SCALAR ACCEPT and RUNTIME_FAIL sources (VECTORS.md templates, canonical form).
const T2 = (op, A, B, R) => `module v53.vec\n\nexport func f(a: ${A}, b: ${B}) -> ${R} {\n  %o: ${R} = ${op} %a, %b\n  return %o\n}\n`;
const T1 = (op, A, R) => `module v53.vec\n\nexport func f(a: ${A}) -> ${R} {\n  %o: ${R} = ${op} %a\n  return %o\n}\n`;
const S2 = (op, x, y, R) => `module v53.vec\n\nexport func f() -> ${R} {\n  %o: ${R} = ${op} ${x}, ${y}\n  return %o\n}\n`;
const body = (params, ret, lines) => `module v53.vec\n\nexport func f(${params.map(([name, type]) => `${name}: ${type}`).join(", ")}) -> ${ret} {\n${lines.map((line) => `  ${line}`).join("\n")}\n}\n`;
const ACCEPT = {
  "V53-PROF-P01": fs.readFileSync(path.join(ROOT, "fixtures/v051/first_vertical/typed_decide.air"), "utf8"),
  "V53-SCL-P01": T2("i32.checked_add", "i32", "i32", "i32"),
  "V53-SCL-P02": T2("i32.checked_mul", "i32", "i32", "i32"),
  "V53-SCL-P03": T2("i32.checked_div_s", "i32", "i32", "i32"),
  "V53-SCL-P04": T2("i32.checked_rem_s", "i32", "i32", "i32"),
  "V53-SCL-P06": T2("i32.wrapping_add", "i32", "i32", "i32"),
  "V53-SCL-P07": T2("i32.wrapping_sub", "i32", "i32", "i32"),
  "V53-SCL-P08": T2("i32.wrapping_mul", "i32", "i32", "i32"),
  "V53-SCL-P09": S2("i32.wrapping_add", "2147483647", "1", "i32"),
  "V53-SCL-P10/and": T2("i32.and", "i32", "i32", "i32"),
  "V53-SCL-P10/or": T2("i32.or", "i32", "i32", "i32"),
  "V53-SCL-P10/xor": T2("i32.xor", "i32", "i32", "i32"),
  "V53-SCL-P11": T2("i32.shl", "i32", "i32", "i32"),
  "V53-SCL-P12": T2("i32.shr_u", "i32", "i32", "i32"),
  "V53-SCL-P14/lt_s": T2("i32.lt_s", "i32", "i32", "bool"),
  "V53-SCL-P14/ge_s": T2("i32.ge_s", "i32", "i32", "bool"),
  "V53-SCL-P14/eq": T2("i32.eq", "i32", "i32", "bool"),
  "V53-SCL-P14/ne": T2("i32.ne", "i32", "i32", "bool"),
  "V53-SCL-P15": T1("i32.to_f32_checked", "i32", "f32"),
  "V53-SCL-P16": T1("f32.trunc_to_i32_checked", "f32", "i32"),
  "V53-SCL-P17": S2("f32.add", "1.0", "0.000000059604644775390625", "f32"),
  "V53-SCL-P18": S2("f32.sub", "1.0", "0.5", "f32"),
  "V53-SCL-P19": S2("f32.mul", "1.5", "0.5", "f32"),
  "V53-SCL-P20": S2("f32.div", "1.0", "3.0", "f32"),
  "V53-SCL-P21": S2("f32.eq", "0.0", "-0.0", "bool"),
  "V53-SCL-P22/lt": body([], "bool", ["%n: f32 = f32.div 0.0, 0.0", "%o: bool = f32.lt %n, 1.0", "return %o"]),
  "V53-SCL-P22/ne": body([], "bool", ["%n: f32 = f32.div 0.0, 0.0", "%o: bool = f32.ne %n, %n", "return %o"]),
  "V53-SCL-P23/min": S2("f32.min", "-0.0", "0.0", "f32"),
  "V53-SCL-P23/max": S2("f32.max", "-0.0", "0.0", "f32"),
  "V53-SCL-P24/div": S2("f32.div", "1.0", "0.0", "f32"),
  "V53-SCL-P24/mul": S2("f32.mul", "3.4028234663852886e38", "2.0", "f32"),
  "V53-SCL-P25": body([], "f32", ["%n: f32 = f32.div 0.0, 0.0", "%o: f32 = f32.min %n, 1.0", "return %o"]),
  "V53-SCL-P26/and": T2("bool.and", "bool", "bool", "bool"),
  "V53-SCL-P26/or": T2("bool.or", "bool", "bool", "bool"),
  "V53-SCL-P26/not": T1("bool.not", "bool", "bool"),
  "V53-SCL-P27/i32": body([["c", "bool"], ["a", "i32"], ["b", "i32"]], "i32", ["%o: i32 = select.i32 %c, %a, %b", "return %o"]),
  "V53-SCL-P27/f32": body([["c", "bool"], ["a", "f32"], ["b", "f32"]], "f32", ["%o: f32 = select.f32 %c, %a, %b", "return %o"]),
  "V53-SCL-P28": body([["c", "bool"]], "i32", ["%o: i32 = match %c {", "  false => 2,", "  true => 1,", "}", "return %o"]),
  "V53-SCL-P29": body([], "f32", ["%x: f32 = 1", "return %x"]),
  "V53-SCL-P30": body([["a", "f32"], ["b", "f32"], ["t", "f32"]], "f32", ["%d: f32 = f32.sub %b, %a", "%m: f32 = f32.mul %d, %t", "%o: f32 = f32.add %m, %a", "return %o"]),
  "V53-ANA-01": "module v53.ana\nexport func f(a: i32, b: i32) -> i32 {\n%o: i32 = i32.checked_add %a, %b\nreturn %o\n}\n"
};
const RUNTIME_FAIL = {
  "V53-SCL-N03": T2("i32.checked_sub", "i32", "i32", "i32"),
  "V53-SCL-N25": body([], "i32", ["%o: i32 = f32.trunc_to_i32_checked 2147483648.0", "return %o"]),
  "V53-SCL-N26": body([], "i32", ["%x: i32 = i32.wrapping_add 2147483647, 0", "%o: i32 = i32.checked_add %x, 1", "return %o"])
};
const H10_CASES = Array.from({ length: 1000 }, (_, index) => `case${index} = ${index},`).join("\n");
const H10_PARAMS = Array.from({ length: 1000 }, (_, index) => `p${index}: E`).join(", ");
const EMISSION_SOURCE = `module work.pressure\nenum E {\n${H10_CASES}\n}\nfunc hidden(${H10_PARAMS}) -> i32 {\nreturn 0\n}\nexport func run() -> i32 {\nreturn 1\n}\n`;
const INGRESS_SOURCE = `module work.ingress\nenum E {\n${H10_CASES}\n}\nexport func wide(${H10_PARAMS}) -> i32 {\nreturn 0\n}\n`;
const EMISSION_SHA256 = "sha256:12398f6081bf05b705bab552e4346e120b03df2bfd2b9ea7201a704ebdc8dc55";
const INGRESS_SHA256 = "sha256:55f00eae360083fef2ac6705546cdc3ac0a92ec425fb877bb068f6ceb03fc4e5";
const pipe10Source = (count) => `module v53.vec\nexport func f(${Array.from({ length: count }, (_, index) => `p${index}: i32`).join(", ")}) -> i32 {\nreturn %p0\n}\n`;

function typedV053(source, name = "v.air") {
  const mod = sp.parseSource(source, name, GATED);
  sp.verifySource(mod, GATED);
  return mod;
}

// The typed interface descriptor is a build input: it binds every exported
// source function as declared (not an expected value).
function descriptorFromAst(mod) {
  const exported = mod.functions.filter((fn) => fn.exported);
  const signatureText = exported.map((fn) => [fn.returnType, ...fn.params.map((parameter) => parameter.type)].join(" ")).join(" ");
  return {
    air_abi_lane: "0.12", module_id: mod.name, schema: "air.typed-interface/0.12-candidate.1",
    types: (mod.enums || [])
      .filter((item) => new RegExp(`(^|[^A-Za-z0-9_.:-])${item.type_id.replace(/[.]/g, "\\.")}($|[^A-Za-z0-9_])`, "u").test(signatureText))
      .map((item) => ({ cases: item.cases.map((entry) => ({ discriminant: entry.discriminant, name: entry.name })), kind: item.kind, type_id: item.type_id })),
    exports: exported.map((fn) => ({
      function: fn.name, name: fn.name, parameters: fn.params.map((parameter) => ({ name: parameter.name, type: parameter.type })), return_type: fn.returnType
    }))
  };
}

// A valid argument for each parameter type, used only to instantiate and call.
function sampleArgument(type, mod) {
  if (type === "i32") return 1;
  if (type === "bool") return true;
  if (type === "f32") return { bits: "3f800000", type: "f32" };
  if (type === "i64") return { decimal: "1", type: "i64" };
  const declaration = (mod.enums || []).find((item) => item.type_id === type);
  if (declaration) return { discriminant: declaration.cases[0].discriminant, type };
  if (type.startsWith("option<")) return { tag: "none", type };
  throw new Error(`no sample argument for ${type}`);
}

function sampleCall(mod) {
  const fn = mod.functions.find((item) => item.exported);
  return { args: fn.params.map((parameter) => sampleArgument(parameter.type, mod)), exportName: fn.name };
}

async function outcome(action) {
  try {
    return { ok: true, value: await action() };
  } catch (error) {
    return { code: error && error.code || null, error, ok: false };
  }
}

function assertBoundedOrOk(result, label) {
  if (result.ok) return "artifact";
  assert(!(result.error instanceof TypeError) && !(result.error instanceof RangeError), `${label}: raw ${result.error && result.error.stack}`);
  assert(BOUNDED_BUILD_CODES.has(result.code), `${label}: expected an artifact or a bounded BUILD_REFUSED, got ${result.code}: ${result.error && result.error.message}`);
  return `BUILD_REFUSED ${result.code}`;
}

function runCli(args, options = {}) {
  return childProcess.spawnSync(process.execPath, [path.join(options.root || ROOT, "bin", "airc.js"), ...args], {
    cwd: options.cwd || ROOT, encoding: "utf8", env: options.env || process.env, maxBuffer: 64 * 1024 * 1024
  });
}

function envWithout(names, extra = {}) {
  const env = { ...process.env, ...extra };
  for (const name of names) delete env[name];
  return env;
}

const runtime = createVerifiedTypedRuntime({ admit: async () => true });

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "air-v053-pipeline-"));
  try {
    // ------------------------------------------------------------------
    // V53-PIPE-06 / V53-PIPE-08: F3, a stable environment code (slice text §6.1).
    const t2 = ACCEPT["V53-SCL-P01"];
    const t2Descriptor = descriptorFromAst(typedV053(t2));
    const childBuild = (dir, kind) => {
      const script = path.join(dir, `${kind}.js`);
      fs.writeFileSync(script, `"use strict";
const path = require("path");
const vb = require(path.join(process.argv[2], "v052_verified_build.js"));
const input = JSON.parse(process.argv[3]);
const run = ${kind === "runtime" ? "async () => vb.createVerifiedTypedRuntime({ admit: async () => true }).build(input)" : "async () => vb.buildVerifiedTypedModule(input)"};
Promise.resolve().then(run).then(() => process.stdout.write(JSON.stringify({ ok: true })), (error) => process.stdout.write(JSON.stringify({ ok: false, code: error && error.code || null, name: error && error.name || null, message: String(error && error.message) })));
`);
      const out = childProcess.spawnSync(process.execPath, [script, path.join(dir, "src"), JSON.stringify({ ...GATED, descriptor: t2Descriptor, source: t2 })], {
        cwd: dir, encoding: "utf8", env: envWithout(["NODE_PATH"], { HOME: dir })
      });
      assert.equal(out.status, 0, out.stderr);
      return JSON.parse(out.stdout);
    };
    const noWabt = path.join(tmp, "no-wabt");
    fs.mkdirSync(noWabt);
    fs.cpSync(path.join(ROOT, "src"), path.join(noWabt, "src"), { recursive: true });
    fs.cpSync(path.join(ROOT, "bin"), path.join(noWabt, "bin"), { recursive: true });
    await vector("V53-PIPE-06", () => {
      const e2 = childBuild(noWabt, "builder");
      assert.equal(e2.ok, false);
      assert.equal(e2.code, "air.v052.toolchain_input_unavailable");
      assert.equal(e2.name, "ToolchainIdentityError", "a stable AIR code, no raw error");
      return { value: { code: e2.code, disposition: "ENVIRONMENT_UNAVAILABLE" }, sourceDigest: sha256(t2) };
    });
    await vector("V53-PIPE-08", () => {
      const file = path.join(noWabt, "t2.air");
      fs.writeFileSync(file, t2);
      const e1 = runCli(["build", file, "--source-profile", V053, "--allow-candidate-profile", "--emit", "wasm", "-o", path.join(noWabt, "t2.wasm")],
        { cwd: noWabt, env: envWithout(["NODE_PATH"], { HOME: noWabt }), root: noWabt });
      assert.notEqual(e1.status, 0);
      assert.match(e1.stderr, /^air\.v052\.toolchain_input_unavailable:/mu);
      assert.doesNotMatch(e1.stderr, /Cannot find module|\n\s+at /u, "no raw error");
      assert.equal(fs.existsSync(path.join(noWabt, "t2.wasm")), false);
      const e2 = childBuild(noWabt, "builder");
      const e3 = childBuild(noWabt, "runtime");
      assert.equal(e2.code, "air.v052.toolchain_input_unavailable");
      assert.equal(e3.code, "air.v052.toolchain_input_unavailable");
      return { value: { E1: "air.v052.toolchain_input_unavailable", E2: e2.code, E3: e3.code, disposition: "ENVIRONMENT_UNAVAILABLE" }, sourceDigest: sha256(t2) };
    });

    // ------------------------------------------------------------------
    // V53-PIPE-07: R17-a (every byte counts), R17-b (equality admitted), AMD-10.
    await vector("V53-PIPE-07", async () => {
      const rows = [];
      for (const [id, source] of Object.entries(ACCEPT)) {
        const mod = typedV053(source, `${id}.air`);
        const descriptor = descriptorFromAst(mod);
        const wat = lowerToWat(mod, { maxWatBytes: MAX_WAT });
        const L = Buffer.byteLength(wat, "utf8");
        assert.equal(Buffer.byteLength(lowerToWat(mod, { maxWatBytes: L }), "utf8"), L, `${id}: E4 with maxWatBytes = L returns exactly L bytes`);
        assert.throws(() => lowerToWat(mod, { maxWatBytes: L - 1 }), (error) => error.code === "air.v052.work_limit_wat_bytes", `${id}: E4 L-1`);
        const refusedRuntime = createVerifiedTypedRuntime({ admit: async () => true, limits: { maxWatBytes: L - 1 } });
        const refused = await outcome(() => refusedRuntime.build({ ...GATED, descriptor, source }));
        assert.equal(refused.code, "air.v052.work_limit_wat_bytes", `${id}: E3 L-1`);
        const exactRuntime = createVerifiedTypedRuntime({ admit: async () => true, limits: { maxWatBytes: L } });
        assert((await outcome(() => exactRuntime.build({ ...GATED, descriptor, source }))).ok, `${id}: E3 with L builds`);
        // The Wasm cap at E3 (owner amendment OD-1 (b)).
        const defaultBuild = await buildVerifiedTypedModule({ ...GATED, descriptor, source });
        const W = defaultBuild.wasmBytes.length;
        const wasmExact = createVerifiedTypedRuntime({ admit: async () => true, limits: { maxWasmBytes: W } });
        const handle = await wasmExact.build({ ...GATED, descriptor, source });
        assert.equal(handle.wasmDigest, defaultBuild.wasmDigest, `${id}: the W-byte artifact`);
        const wasmShort = createVerifiedTypedRuntime({ admit: async () => true, limits: { maxWasmBytes: W - 1 } });
        const before = wasmShort.inspect();
        const short = await outcome(() => wasmShort.build({ ...GATED, descriptor, source }));
        assert.equal(short.code, "air.v052.work_limit_wasm_bytes", `${id}: E3 W-1`);
        const after = wasmShort.inspect();
        assert.equal(after.cache.entries, before.cache.entries, `${id}: no added cache entry`);
        assert.equal(after.counters.compilations, before.counters.compilations, `${id}: no added compilation`);
        rows.push({ L, W, vector: id });
      }
      return { value: { measured_inputs: rows, sources: rows.length } };
    });

    // ------------------------------------------------------------------
    // V53-PIPE-09: every admitted build compiles and instantiates (R-COMP-3, P2-N4).
    await vector("V53-PIPE-09", async () => {
      const rows = [];
      const sources = { ...ACCEPT, ...RUNTIME_FAIL, "H10-EMISSION": EMISSION_SOURCE, "H10-INGRESS": INGRESS_SOURCE };
      for (const [id, source] of Object.entries(sources)) {
        const mod = typedV053(source, `${id}.air`);
        const descriptor = descriptorFromAst(mod);
        const call = sampleCall(mod);
        const row = { vector: id };
        // E1 --emit wasm
        const file = path.join(tmp, `${id.replace(/[^A-Za-z0-9]/g, "_")}.air`);
        const out = `${file}.wasm`;
        fs.writeFileSync(file, source);
        const cli = runCli(["build", file, "--source-profile", V053, "--allow-candidate-profile", "--emit", "wasm", "-o", out]);
        if (cli.status === 0) {
          const compiled = await WebAssembly.compile(fs.readFileSync(out));
          await WebAssembly.instantiate(compiled, {});
          row.E1 = "artifact";
        } else {
          const code = (cli.stderr.match(/^(air\.[a-z0-9_.]+):/mu) || [])[1];
          assert(BOUNDED_BUILD_CODES.has(code), `${id}: E1 ${cli.stderr}`);
          assert.doesNotMatch(cli.stderr, /\n\s+at |CompileError/u);
          row.E1 = `BUILD_REFUSED ${code}`;
        }
        // E2 build + invoke (instantiates)
        const e2 = await outcome(() => buildVerifiedTypedModule({ ...GATED, descriptor, source }));
        row.E2 = assertBoundedOrOk(e2, `${id} E2`);
        if (e2.ok) {
          const invoked = await outcome(() => invokeVerifiedTypedExport(e2.value, call.exportName, call.args));
          assert(invoked.ok || ["air.numeric.checked_failure", "air.v052.work_limit_invocation_lanes"].includes(invoked.code), `${id}: E2 invoke ${invoked.code}`);
          assert.notEqual(invoked.code, "air.v052.verified_build_wasm_mismatch");
        }
        // E3 build (compiles) + invoke (instantiates)
        const e3 = await outcome(() => runtime.build({ ...GATED, descriptor, source }));
        row.E3 = assertBoundedOrOk(e3, `${id} E3`);
        if (e3.ok) {
          const invoked = await outcome(() => runtime.invoke(e3.value, call.exportName, call.args));
          assert(invoked.ok || ["air.numeric.checked_failure", "air.v052.work_limit_invocation_lanes"].includes(invoked.code), `${id}: E3 invoke ${invoked.code}`);
          assert.notEqual(invoked.code, "air.v052.verified_build_wasm_mismatch");
        }
        rows.push(row);
      }
      return { value: rows };
    });

    // ------------------------------------------------------------------
    // V53-PIPE-10: phase-B engine limit, parameters per function (OD-2 (a)).
    await vector("V53-PIPE-10", async () => {
      const source = pipe10Source(1001);
      assert.equal(Buffer.byteLength(source, "utf8"), 10953);
      assert.equal(sha256(Buffer.from(source, "utf8")), "sha256:eb475689d2904a5f30d806ce9cd3ae23f105ab7923bc6f56f7983067e44963f5");
      const mod = typedV053(source, "pipe10.air");
      const analysis = wb.analyzeVerifiedTypedModule(mod);
      assert.deepEqual(analysis.entries.get("f").value && wb.canonicalSummary(analysis.entries.get("f").value), wb.canonicalSummary(wb.summary({ steps: 1n })), "E(f) = S{steps:1}");
      const descriptor = descriptorFromAst(mod);
      const refusals = {};
      const file = path.join(tmp, "pipe10.air");
      fs.writeFileSync(file, source);
      for (const emit of ["wat", "wasm"]) {
        const out = path.join(tmp, `pipe10.${emit}`);
        const cli = runCli(["build", file, "--source-profile", V053, "--allow-candidate-profile", "--emit", emit, "-o", out]);
        assert.notEqual(cli.status, 0);
        assert.match(cli.stderr, /^air\.build\.engine_limit: .*parameters per function or block/mu);
        assert.equal(fs.existsSync(out), false, "no WAT emitted");
        refusals[`E1 --emit ${emit}`] = "air.build.engine_limit";
      }
      for (const [label, action] of [["E2", () => buildVerifiedTypedModule({ ...GATED, descriptor, source })], ["E3", () => runtime.build({ ...GATED, descriptor, source })]]) {
        const result = await outcome(action);
        assert.equal(result.code, "air.build.engine_limit", `${label}: ${result.error && result.error.message}`);
        assert.equal(result.error.limit, "parameters per function or block");
        assert.equal(result.error.disposition, "BUILD_REFUSED");
        refusals[label] = result.code;
      }
      // Boundary companion: 1,000 parameters is admitted and compiles.
      const boundary = pipe10Source(1000);
      assert.equal(Buffer.byteLength(boundary, "utf8"), 10941);
      assert.equal(sha256(Buffer.from(boundary, "utf8")), "sha256:5e6ccc76000bac4fdd8a101e5f7459c02db7aacfe94bef3f1d04f0ca5ba064ce");
      const boundaryMod = typedV053(boundary, "pipe10b.air");
      const boundaryBuild = await buildVerifiedTypedModule({ ...GATED, descriptor: descriptorFromAst(boundaryMod), source: boundary });
      await WebAssembly.compile(boundaryBuild.wasmBytes);
      const boundaryRuntime = await runtime.build({ ...GATED, descriptor: descriptorFromAst(boundaryMod), source: boundary });
      assert(boundaryRuntime.wasmDigest);
      return { value: { boundary_1000: "artifact compiles", E_f: "S{steps:1}", refusals, verify: "VERIFIED" }, sourceDigest: sha256(source) };
    });

    // ------------------------------------------------------------------
    // V53-WB-H10 parts (VECTORS_ADDITIONS.md §4; H53 item 11). typed-v0.51 parts
    // re-run here; typed-v0.53 parts first run here.
    assert.equal(sha256(Buffer.from(EMISSION_SOURCE, "utf8")), EMISSION_SHA256);
    assert.equal(sha256(Buffer.from(INGRESS_SOURCE, "utf8")), INGRESS_SHA256);
    const emissionDescriptor = { air_abi_lane: "0.12", module_id: "work.pressure", schema: "air.typed-interface/0.12-candidate.1", types: [], exports: [{ function: "run", name: "run", parameters: [], return_type: "i32" }] };
    const okSummary = (result, expectedSummary, label) => {
      assert.equal(result.ok, true, `${label}: ${result.ok ? "" : result.failure.code}`);
      assert.deepEqual(wb.canonicalSummary(result.value), wb.canonicalSummary(wb.summary(expectedSummary)), label);
      return wb.canonicalSummary(result.value);
    };
    const emissionBuilds = async (profileOptions, mod) => {
      const builds = {};
      builds.E4 = assertBoundedOrOk(await outcome(() => lowerToWat(mod, { maxWatBytes: MAX_WAT })), "E4");
      builds.E2 = assertBoundedOrOk(await outcome(() => buildVerifiedTypedModule({ ...profileOptions, descriptor: emissionDescriptor, source: EMISSION_SOURCE })), "E2");
      builds.E3 = assertBoundedOrOk(await outcome(() => runtime.build({ ...profileOptions, descriptor: emissionDescriptor, source: EMISSION_SOURCE })), "E3");
      const file = path.join(tmp, "h10_emission_source.air");
      fs.writeFileSync(file, EMISSION_SOURCE);
      const profileArgs = profileOptions.sourceProfile === V053 ? ["--source-profile", V053, "--allow-candidate-profile"] : ["--source-profile", "typed-v0.51"];
      for (const emit of ["wat", "wasm"]) {
        const out = path.join(tmp, `h10_emission.${emit}`);
        const cli = runCli(["build", file, ...profileArgs, "--emit", emit, "-o", out]);
        if (cli.status === 0) {
          assert(fs.statSync(out).size <= MAX_WAT || emit === "wasm");
          builds[`E1 --emit ${emit}`] = "artifact";
        } else {
          assert.match(cli.stderr, /^air\.v052\.work_limit_wat_bytes:/mu);
          assert.doesNotMatch(cli.stderr, /\n\s+at /u, "no raw stack trace");
          assert.equal(fs.existsSync(out), false);
          builds[`E1 --emit ${emit}`] = "BUILD_REFUSED air.v052.work_limit_wat_bytes";
        }
      }
      return builds;
    };
    await vector("V53-WB-H10-EMISSION/typed-v0.53", async () => {
      const mod = typedV053(EMISSION_SOURCE, "h10_emission_source.air");
      const { measureTypedModule } = require("../src/analysis_capacity");
      const measure = measureTypedModule(mod);
      assert.deepEqual({ analysis_units: measure.analysis_units, nesting_depth: measure.nesting_depth }, { analysis_units: 6, nesting_depth: 1 });
      const analysis = wb.analyzeVerifiedTypedModule(mod);
      const hidden = okSummary(analysis.functions.get("hidden"), { steps: 1n }, "B(hidden)");
      const run = okSummary(analysis.entries.get("run"), { steps: 1n }, "E(run)");
      assert.equal(analysis.entries.has("hidden"), false);
      const builds = await emissionBuilds(GATED, mod);
      parts["typed-v0.53 EMISSION"] = "PASS";
      return { value: { B_hidden: hidden, E_run: run, analysis_units: 6, bare_lowerToWat: "outside the claim; not run, not counted", builds, nesting_depth: 1, verify: "VERIFIED" }, sourceDigest: EMISSION_SHA256 };
    });
    await vector("V53-WB-H10-INGRESS/typed-v0.53", async () => {
      const mod = typedV053(INGRESS_SOURCE, "h10_ingress_source.air");
      const { measureTypedModule } = require("../src/analysis_capacity");
      const measure = measureTypedModule(mod);
      assert.deepEqual({ analysis_units: measure.analysis_units, nesting_depth: measure.nesting_depth }, { analysis_units: 4, nesting_depth: 1 });
      const analysis = wb.analyzeVerifiedTypedModule(mod);
      const B = okSummary(analysis.functions.get("wide"), { steps: 1n }, "B(wide)");
      const E = okSummary(analysis.entries.get("wide"), { steps: 1000001n }, "E(wide)");
      assert.equal(BigInt(E.steps) - BigInt(B.steps), 1000000n, "ingress(wide)");
      assert.deepEqual(E, { calls: "0", effects: {}, iterations: "0", steps: "1000001" });
      const probe = await buildVerifiedTypedModule({ ...GATED, descriptor: descriptorFromAst(typedV053(ACCEPT["V53-SCL-P01"])), source: ACCEPT["V53-SCL-P01"] });
      const binding = wb.bindVerifiedTypedWorkBound(analysis, {
        compilerImplementationDigest: probe.compiler.implementationDigest,
        sourceDigest: INGRESS_SHA256,
        sourceProfile: V053
      });
      assert.equal(binding.key.profile, V053);
      assert.equal(binding.key.cost_table_digest, "sha256:d8b341ea2358a787d699507a5dca9ce6cab0d58e3358d324df4c5ff8e469760e");
      const attempt = assertBoundedOrOk(await outcome(() => buildVerifiedTypedModule({ ...GATED, descriptor: descriptorFromAst(mod), source: INGRESS_SOURCE })), "build attempt");
      parts["typed-v0.53 INGRESS"] = "PASS";
      return { value: { B_wide: B, E_wide: E, analysis_units: 4, build_attempt: attempt, disposition: "VERIFIED + INTERNAL", ingress_wide: "1000000", key: { cost_table_digest: binding.key.cost_table_digest, profile: binding.key.profile }, nesting_depth: 1 }, sourceDigest: INGRESS_SHA256 };
    });
    const v051 = { sourceProfile: "typed-v0.51" };
    await vector("V53-WB-H10-EMISSION/typed-v0.51", async () => {
      const mod = sp.parseSource(EMISSION_SOURCE, "h10_emission_source.air", v051);
      sp.verifySource(mod, v051);
      const analysis = wb.analyzeVerifiedTypedModule(mod);
      okSummary(analysis.functions.get("hidden"), { steps: 1n }, "B(hidden)");
      okSummary(analysis.entries.get("run"), { steps: 1n }, "E(run)");
      const builds = await emissionBuilds(v051, mod);
      parts["typed-v0.51 EMISSION"] = "PASS";
      return { value: { builds, verify: "VERIFIED" }, sourceDigest: EMISSION_SHA256 };
    });
    await vector("V53-WB-H10-INGRESS/typed-v0.51", () => {
      const mod = sp.parseSource(INGRESS_SOURCE, "h10_ingress_source.air", v051);
      sp.verifySource(mod, v051);
      const analysis = wb.analyzeVerifiedTypedModule(mod);
      okSummary(analysis.functions.get("wide"), { steps: 1n }, "B(wide)");
      okSummary(analysis.entries.get("wide"), { steps: 1000001n }, "E(wide)");
      parts["typed-v0.51 INGRESS"] = "PASS";
      return { value: { E_wide: "1000001", verify: "VERIFIED" }, sourceDigest: INGRESS_SHA256 };
    });
    const h10Parts = ["typed-v0.51 EMISSION", "typed-v0.51 INGRESS", "typed-v0.53 EMISSION", "typed-v0.53 INGRESS"];
    results.push(resultRecord("V53-WB-H10", h10Parts.every((part) => parts[part] === "PASS") ? "PASS" : "FAIL",
      { parts: Object.fromEntries(h10Parts.map((part) => [part, parts[part] || "FAIL"])) }));
    if (!h10Parts.every((part) => parts[part] === "PASS")) failures.push("V53-WB-H10: a part did not pass");

    // ------------------------------------------------------------------
    // V53-WB-H04 composite: (a) V53-WB-ID-02 re-run; (b) V53-ASSUR-01.
    await vector("V53-WB-H04", async () => {
      const idSource = (n) => `module v53.id\nexport func f() -> i32 {\n%out: i32 = ${n}\nreturn %out\n}\n`;
      const idDescriptor = { air_abi_lane: "0.12", module_id: "v53.id", schema: "air.typed-interface/0.12-candidate.1", types: [], exports: [{ function: "f", name: "f", parameters: [], return_type: "i32" }] };
      const one = await buildVerifiedTypedModule({ descriptor: idDescriptor, source: idSource(1) });
      const two = await buildVerifiedTypedModule({ descriptor: idDescriptor, source: idSource(2) });
      const a = wb.inspectBoundWorkBound(one);
      const b = wb.inspectBoundWorkBound(two);
      assert.notEqual(a.key.body_digest, b.key.body_digest);
      assert.notEqual(canonicalJson(a.key), canonicalJson(b.key));
      assert.notEqual(a.recordDigest, b.recordDigest);
      assert.throws(() => wb.compareSuppliedRecord(a, b.record), (error) => error.code === "air.workbound.identity_mismatch");
      const ast = typedV053(ACCEPT["V53-SCL-P01"]);
      assert.throws(() => createVerifiedResourceCertificate(ast), (error) => error.code === "air.resource_certificate.profile_unsupported");
      return { value: { parts: { "(a) = V53-WB-ID-02": "PASS", "(b) = V53-ASSUR-01": "PASS" } } };
    });
  } finally {
    fs.rmSync(tmp, { force: true, recursive: true });
  }

  const passed = results.filter((item) => item.status === "PASS").length;
  if (process.env.AIR_SCALAR_VECTOR_RESULTS_DIR) {
    fs.mkdirSync(process.env.AIR_SCALAR_VECTOR_RESULTS_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.AIR_SCALAR_VECTOR_RESULTS_DIR, "v053_scalar_pipeline.results.json"), `${JSON.stringify(results.map((item) => JSON.parse(canonicalJson(item))), null, 2)}\n`);
  }
  if (failures.length) {
    for (const failure of failures) console.error(failure);
    console.error(`typed-v0.53 SCALAR pipeline: ${failures.length} failed, ${passed} passed`);
    process.exitCode = 1;
    return;
  }
  console.log(`typed-v0.53 SCALAR pipeline: ${passed}/${results.length} PASS (PIPE-06..10, WB-H10 composite, WB-H04 composite)`);
})().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
