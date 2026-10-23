#!/usr/bin/env node
"use strict";

// typed-v0.53 P0-03 (AIR-0053-P0-03-0001): refinements and checked public
// ingress. Every expected value below is copied from the R3.1 catalogue
// (VECTORS.md, sha256 f5353705..., REF rows) or from the admitted P0-03 slice
// text R2 (VECTORS_ADDITIONS.md; folder SHA256SUMS 29bb12d5...), never from the
// output of the implementation under test. Runtime vectors run through the
// verified builder or runtime with an air.v053.verifiedTypedBuild/1 build
// (slice text P3-R13). A direct invocation calls the Wasm export on a fresh
// instance of the build's Wasm and applies the typed-v0.53 adapter's mapping
// to the trap (slice text §4.4 A-1). Comparisons with the P0-03 base run the
// base src from git objects (dev c284dab / public 965798d) in a child process.
// Set AIR_P003_VECTOR_RESULTS_DIR=<dir> to write one canonical result record
// per vector.
const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const sp = require("../src/source_profile");
const wb = require("../src/workbound");
const { AirLspSession } = require("../src/lsp_server");
const {
  buildVerifiedTypedModule,
  createVerifiedTypedRuntime,
  inspectVerifiedTypedBuild,
  invokeVerifiedTypedExport
} = require("../src/v052_verified_build");
const { lowerToWat, watToWasm } = require("../src/lower_wasm");
const { TYPED_V053_FAILURE_REASONS, typedV053FailureIdentity } = require("../src/v052_numeric_diagnostic");

const ROOT = path.resolve(__dirname, "..");
const V053 = "typed-v0.53";
const GATED = Object.freeze({ allowCandidateProfile: true, sourceProfile: V053 });
const MAX_WAT = 4194304;
// The P0-03 base (admission record): dev c284dab, public 965798d.
const BASE_COMMITS = ["c284dab46d2e05629f85d8f774d9183c9933d5ef", "965798d150555539d3d9b365ae746579f30bb059"];
// The 0.52.x adapter of R-REF-12 (main at v0.52: dev f258ed0, public 7285a25)
// and the sha256 of its numeric mapping file, identical in both.
const OLD_ADAPTER_COMMITS = ["f258ed0df6da99785bacd706f9d5b04f42ba64c0", "7285a25af9985c5da71f3a71a63c907fa20c50f0"];
const OLD_MAPPING_SHA256 = "sha256:8ebbd210ac2b25ebd8143586d79dbf40972c778051a46503f9e07383625ce502";
// CT-1 unchanged (OD-P3-4 (a); slice text §5.3).
const CT1 = Object.freeze({
  blob: "118511fe8df9aa039ee5d3ccbf6d28faec7ad881",
  digest: "sha256:1ae0cddb2b01ca1f16f5b8da059ebd0a594d8c222aea4e5bf8f5e2c6d17e80c9",
  raw: "sha256:1afbe97ffb8b18c34f4591e6a3e99b0cd0d6666e298654ad55d8b93d6739d312",
  revision: "P0-02-F1-RD3"
});
// Slice text §4.4 A-1 (R-REF-9 as amended by AMD-P3-1).
const ADAPTER_TABLE = Object.freeze({
  0: { code: "air.runtime.trap_unclassified" },
  1: { code: "air.numeric.checked_failure", reason: "overflow" },
  2: { code: "air.numeric.checked_failure", reason: "division_by_zero" },
  3: { code: "air.numeric.checked_failure", reason: "invalid_conversion" },
  16: { code: "air.refinement.ingress_out_of_range" },
  17: { code: "air.refinement.assignment_out_of_range" },
  32: { code: "air.loop.count_out_of_range" },
  33: { code: "air.table.index_out_of_range" },
  34: { code: "air.memory.region_bounds_runtime" },
  35: { code: "air.array.index_out_of_range" },
  48: { code: "air.decision.enum_discriminant_invalid" },
  49: { code: "air.decision.payload_tag_invalid" },
  50: { code: "air.decision.bool_lane_invalid" },
  51: { code: "air.decision.payload_lane_noncanonical" }
});
// R-DIAG-2: the SCALAR registry (docs/v0.53/SCALAR.md §6, accepted with SCALAR)
// and the P0-03 additions (docs/v0.53/P0_03_REFINEMENTS.md §5, a dev-side note).
const SCALAR_CODE_REGISTRY = Object.freeze([
  "air.analysis.capacity_exceeded", "air.assurance.profile_unsupported", "air.build.engine_limit", "air.capability.unknown",
  "air.cli.file_invalid", "air.cli.file_too_large", "air.cli.option_unknown", "air.control.statement_after_return",
  "air.decision.enum_discriminant_invalid", "air.decision.enum_discriminant_out_of_range", "air.decision.enum_discriminant_required",
  "air.decision.enum_duplicate_case", "air.decision.enum_duplicate_discriminant", "air.decision.enum_duplicate_type",
  "air.decision.enum_empty", "air.decision.enum_invalid", "air.decision.enum_unknown", "air.decision.match_arm_invalid",
  "air.decision.match_binding_shadow", "air.decision.match_duplicate_arm", "air.decision.match_nonexhaustive",
  "air.decision.match_type_unsupported", "air.decision.match_unknown_value", "air.decision.payload_type_unsupported",
  "air.decision.result_error_type_invalid", "air.numeric.checked_failure", "air.numeric.i64_constant_out_of_range",
  "air.numeric.operation_invalid", "air.numeric.operation_mode_required", "air.refinement.assignment_out_of_range",
  "air.refinement.syntax_invalid", "air.resource_certificate.profile_unsupported", "air.source_profile.ast_mismatch",
  "air.source_profile.candidate_disabled", "air.source_profile.command_unsupported", "air.source_profile.duplicate",
  "air.source_profile.file_missing", "air.source_profile.invalid_form", "air.source_profile.missing",
  "air.source_profile.unsupported", "air.v051.function_duplicate", "air.v051.local_duplicate", "air.v051.local_unknown",
  "air.v051.parameter_duplicate", "air.v051.return_missing", "air.v051.return_type_mismatch", "air.v051.type_reference_invalid",
  "air.v051.typed_atom_invalid", "air.v051.typed_atom_type_mismatch", "air.v051.typed_constructor_invalid",
  "air.v051.typed_constructor_type_mismatch", "air.v051.typed_statement_invalid", "air.v051.typed_syntax_invalid",
  "air.v051.typed_value_invalid", "air.v052.invocation_arguments_invalid", "air.v052.runtime_input_invalid",
  "air.v052.runtime_limits_invalid", "air.v052.toolchain_input_invalid", "air.v052.toolchain_input_unavailable",
  "air.v052.work_limit_ast_nodes", "air.v052.work_limit_descriptor_bytes", "air.v052.work_limit_invocation_lanes",
  "air.v052.work_limit_source_bytes", "air.v052.work_limit_source_name_bytes", "air.v052.work_limit_wasm_bytes",
  "air.v052.work_limit_wat_bytes"
]);
const P0_03_CODE_REGISTRY = Object.freeze([
  "air.refinement.base_type_unsupported", "air.refinement.ingress_out_of_range", "air.runtime.trap_unclassified",
  "air.runtime.failure_reason_unknown", "air.decision.payload_tag_invalid", "air.decision.bool_lane_invalid",
  "air.decision.payload_lane_noncanonical", "air.refinement.range_invalid", "air.refinement.bound_out_of_range",
  "air.v051.typed_interface_source_invalid", "air.v051.record_invalid", "air.v052.invocation_runtime_failure",
  "air.v052.verified_build_invalid", "air.v052.verified_build_descriptor_mismatch"
]);

const results = [];
const failures = [];
const observedFailures = [];
const acceptedSources = new Set();
const frozenInputs = new Set();
const allBuilds = [];

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
  if (typeof value === "number" && Object.is(value, -0)) return "-0";
  if (typeof value === "number" && Number.isNaN(value)) return "NaN";
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
// Sources, in canonical form (two-space indentation, LF, one trailing LF).
const fn = (header, lines) => `${header} {\n${lines.map((line) => `  ${line}`).join("\n")}\n}`;
const M = (...items) => `module v53.vec\n\n${items.join("\n\n")}\n`;
const SRC = Object.freeze({
  g: M(fn("export func g(n: i32<0..10>) -> i32<0..10>", ["return %n"])),
  r: M(fn("export func r(x: i32) -> i32<0..10>", ["return %x"])),
  p02: M(fn("export func h(n: i32<0..10>) -> i32", ["%w: i32 = %n", "return %w"])),
  p03: M(fn("export func h(n: i32<0..10>) -> i32<0..20>", ["%w: i32<0..20> = %n", "return %w"])),
  n05: M(fn("export func k(n: i32) -> i32", ["%x: i32<0..10> = %n", "%w: i32 = %x", "return %w"])),
  wb01: M(fn("export func g(n: i32<0..10>) -> i32<0..10>", ["return %n"]), fn("export func g5(n: i32<0..10>) -> i32<0..5>", ["return %n"])),
  n09: M(
    fn("export func g(n: i32<0..10>) -> i32<0..10>", ["return %n"]),
    fn("export func r(x: i32) -> i32<0..10>", ["return %x"]),
    fn("export func refined_sum(left: i64, right: i64) -> i32<0..10>", ["%sum: i64 = i64.checked_add %left, %right", "%out: i32<0..10> = i64.to_i32_checked %sum", "return %out"])
  ),
  n14: M(fn("export func y(c: bool, n: i32) -> i32", ["%r: i32<0..10> = match %c {", "  false => 0,", "  true => %n,", "}", "return %r"])),
  n16: M(
    fn("error enum E", ["bad = 1,"]),
    fn("export func f(x: option<i32>) -> i32", ["return 1"]),
    fn("export func g(x: option<f32>) -> i32", ["return 1"]),
    fn("export func h(x: option<i64>) -> i32", ["return 1"]),
    fn("export func r(x: result<i32,v53.vec::E>) -> i32", ["return 1"])
  ),
  n17: M(fn("export func f(a: i32, b: i32) -> i32", ["%o: i32 = i32.checked_add %a, %b", "return %o"])),
  n18: M(
    fn("enum Mode", ["off = 1,", "on = 2,"]),
    fn("export func b(x: bool) -> i32", ["return 1"]),
    fn("export func e(m: v53.vec::Mode) -> i32", ["return 1"]),
    fn("export func o(x: option<i32>) -> i32", ["return 1"])
  ),
  wb02: M(
    fn("export func h(n: i32<0..10>) -> i32<0..20>", ["%w: i32<0..20> = %n", "return %w"]),
    fn("export func k(n: i32) -> i32", ["%x: i32<0..10> = %n", "%w: i32 = %x", "return %w"])
  ),
  wb03: M(
    fn("export func c() -> i32<0..10>", ["return 5"]),
    fn("export func d() -> i32<0..10>", ["%x: i32<0..10> = 10", "return %x"]),
    fn("export func e() -> i32", ["%x: i32 = 10", "return %x"]),
    fn("export func y2(c: bool, k: i32<0..10>) -> i32<0..10>", ["%r: i32<0..10> = match %c {", "  false => 3,", "  true => %k,", "}", "return %r"])
  )
});
const N19 = (header, lines) => M(fn(header, lines));
const FIXTURE_REFINED_SUM = "fixtures/v051/conformance/typed_refinement_and_comparisons.air";

function enumDecl(typeId, kind, cases) {
  return { cases: cases.map(([name, discriminant]) => ({ discriminant, name })), kind, type_id: typeId };
}

// The descriptor is desc of the source signature (slice text §4.2): each
// `i32<a..b>` is `i32`, every other type is itself.
function descriptor(exportsList, types = [], moduleId = "v53.vec") {
  return {
    air_abi_lane: "0.12", module_id: moduleId, schema: "air.typed-interface/0.12-candidate.1", types,
    exports: exportsList.map(([name, params, returnType]) => ({
      function: name, name, parameters: params.map(([parameter, type]) => ({ name: parameter, type })), return_type: returnType
    }))
  };
}

const i64 = (decimal) => ({ decimal: String(decimal), type: "i64" });
function f32(value) {
  if (Number.isNaN(value)) return { classification: "nan", type: "f32" };
  const bytes = Buffer.alloc(4);
  bytes.writeFloatBE(value, 0);
  return { bits: bytes.toString("hex"), type: "f32" };
}

function typedV053(source, name = "v.air") {
  const mod = sp.parseSource(source, name, GATED);
  sp.verifySource(mod, GATED);
  return mod;
}

function captureFailure(action) {
  try {
    action();
  } catch (error) {
    return error;
  }
  return null;
}

function verified(source) {
  const mod = typedV053(source);
  acceptedSources.add(source);
  return mod;
}

// STATIC_REJECT: the stated code, its `code:` delimiter and the source location.
function staticReject(source, code, line) {
  const error = captureFailure(() => typedV053(source));
  assert(error, `expected ${code}, got VERIFIED`);
  assert.equal(error.code, code, String(error.message));
  assert.match(String(error.message), new RegExp(`${code.replace(/\./g, "\\.")}:`));
  assert(error.loc && Number.isInteger(error.loc.line), "a static failure carries a source location");
  if (line !== undefined) assert.equal(error.loc.line, line);
  assert(!(error instanceof TypeError) && !(error instanceof RangeError));
  observedFailures.push({ code: error.code, kind: "STATIC_REJECT", line: error.loc.line });
  return { code: error.code, line: error.loc.line, message: String(error.message) };
}

const buildCache = new Map();
async function build(source, desc) {
  const key = `${source}\u0000${canonicalJson(desc)}`;
  if (!buildCache.has(key)) {
    verified(source);
    const built = await buildVerifiedTypedModule({ ...GATED, descriptor: desc, source });
    allBuilds.push(built);
    buildCache.set(key, built);
  }
  return buildCache.get(key);
}

// A typed call through the typed-v0.53 adapter (the verified builder's path).
async function call(built, name, args) {
  try {
    return { value: (await invokeVerifiedTypedExport(built, name, args)).value };
  } catch (error) {
    assert(typeof error.code === "string" && error.code.startsWith("air."), `raw invocation error: ${error && error.stack}`);
    observedFailures.push({ code: error.code, kind: "RUNTIME_FAIL" });
    const outcome = { code: error.code };
    if (error.reason) outcome.reason = error.reason;
    if (error.failureReason !== undefined) outcome.failureReason = error.failureReason;
    return outcome;
  }
}

// A direct invocation on a fresh instance, the adapter's mapping applied.
function direct(built, name, lanes) {
  const instance = new WebAssembly.Instance(new WebAssembly.Module(built.wasmBytes), {});
  try {
    return { value: instance.exports[name](...lanes) };
  } catch (error) {
    assert(error instanceof WebAssembly.RuntimeError, `not a Wasm trap: ${error && error.stack}`);
    const identity = typedV053FailureIdentity(error, instance);
    observedFailures.push({ code: identity.code, kind: "RUNTIME_FAIL" });
    const outcome = { code: identity.code, failureReason: instance.exports.__air_failure_reason.value };
    if (identity.reason) outcome.reason = identity.reason;
    return outcome;
  }
}

function summaryOf(built, name) {
  return wb.inspectBoundWorkBound(built).record.entries[name];
}

function expectSteps(built, name, steps) {
  const actual = summaryOf(built, name);
  assert.deepEqual(actual, wb.canonicalSummary(wb.summary({ steps: BigInt(steps) })), `E(${name})`);
  return actual;
}

function expectAll(cases, label) {
  return cases.map(([what, actual, expected]) => {
    assert.deepEqual(actual, expected, `${label}: ${what}`);
    return { case: what, outcome: actual };
  });
}

const NUMERIC = (reason, value) => ({ code: "air.numeric.checked_failure", failureReason: value, reason });
const INGRESS = { code: "air.refinement.ingress_out_of_range", failureReason: 16 };
const ASSIGN = { code: "air.refinement.assignment_out_of_range", failureReason: 17 };
const REASON = (value) => ({ code: ADAPTER_TABLE[value].code, failureReason: value });

function runCli(args) {
  return childProcess.spawnSync(process.execPath, [path.join(ROOT, "bin", "airc.js"), ...args], {
    cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024
  });
}

function gitObject(commits, file) {
  for (const commit of commits) {
    const out = childProcess.spawnSync("git", ["show", `${commit}:${file}`], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
    if (out.status === 0) return { bytes: out.stdout, commit };
  }
  return null;
}

function baseCommit() {
  for (const commit of BASE_COMMITS) {
    if (childProcess.spawnSync("git", ["cat-file", "-e", `${commit}^{commit}`], { cwd: ROOT }).status === 0) return commit;
  }
  throw new Error("the P0-03 base commit is not in this repository");
}

// The 0.52.x numeric mapping, loaded from its exact git bytes.
function oldMapping(tmp) {
  const object = gitObject(OLD_ADAPTER_COMMITS, "src/v052_numeric_diagnostic.js");
  assert(object, "the 0.52.x adapter commit is not in this repository");
  assert.equal(sha256(object.bytes), OLD_MAPPING_SHA256, "the 0.52.x mapping file is the expected one");
  const file = path.join(tmp, "old_v052_numeric_diagnostic.js");
  fs.writeFileSync(file, object.bytes);
  return { commit: object.commit, map: require(file).checkedNumericFailureReason };
}

// The 0.52.x caller (f258ed0:src/v052_verified_build.js:571-577): the mapping,
// then the generic failure.
function oldAdapter(map, error, instance) {
  const reason = map(error, instance);
  return reason ? { code: "air.numeric.checked_failure", reason } : { code: "air.v052.invocation_runtime_failure" };
}

async function trapInstance(wat) {
  const instance = new WebAssembly.Instance(new WebAssembly.Module(await watToWasm(wat, "synthetic.wat")), {});
  try {
    instance.exports.f();
  } catch (error) {
    return { error, instance };
  }
  throw new Error("the synthetic instance did not trap");
}

const syntheticTrap = (global, value) => `(module\n  (global $g (export "${global}") (mut i32) (i32.const 0))\n  (func (export "f") i32.const ${value} global.set $g unreachable))`;

// The REG01 child: typed-v0.51 parse/verify, the WAT with the accepted explicit
// limit, the Wasm, its exports and the verified build record, per file.
const REG01_CHILD = `"use strict";
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const src = process.argv[2];
const input = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
const r = (m) => require(path.join(src, m));
const sp = r("source_profile.js");
const lw = r("lower_wasm.js");
const vb = r("v052_verified_build.js");
const sha = (bytes) => "sha256:" + crypto.createHash("sha256").update(bytes).digest("hex");
const ENUM = /[a-z][a-z0-9._-]{0,127}::[A-Z][A-Za-z0-9_]{0,127}/g;
(async () => {
  const out = {};
  for (const item of input.files) {
    let mod;
    try {
      mod = sp.parseSource(item.source, item.file, { sourceProfile: "typed-v0.51" });
      sp.verifySource(mod, { sourceProfile: "typed-v0.51" });
    } catch (_) { continue; }
    const entry = {};
    const wat = lw.lowerToWat(mod, { maxWatBytes: input.maxWat });
    const wasm = Buffer.from(await lw.watToWasm(wat, item.file));
    entry.wat = sha(Buffer.from(wat, "utf8"));
    entry.wasm = sha(wasm);
    entry.exports = WebAssembly.Module.exports(new WebAssembly.Module(wasm)).map((e) => e.kind + ":" + e.name).sort();
    const exported = (mod.functions || []).filter((f) => f.exported);
    const referenced = new Set();
    for (const f of exported) for (const t of [...f.params.map((p) => p.type), f.returnType]) for (const m of String(t).match(ENUM) || []) referenced.add(m);
    const descriptor = {
      air_abi_lane: "0.12", module_id: mod.name, schema: "air.typed-interface/0.12-candidate.1",
      types: (mod.enums || []).filter((e) => referenced.has(e.type_id)),
      exports: exported.map((f) => ({ function: f.name, name: f.name, parameters: f.params.map((p) => ({ name: p.name, type: p.type })), return_type: f.returnType }))
    };
    try {
      const b = await vb.buildVerifiedTypedModule({ descriptor, source: item.source, sourceName: item.file });
      entry.record = { descriptor: b.descriptor, descriptorDigest: b.descriptorDigest, kind: b.kind, schema: b.schema, sourceDigest: b.sourceDigest, sourceProfile: b.sourceProfile, wasmDigest: b.wasmDigest };
    } catch (error) {
      entry.record = { error: error && error.code || String(error && error.message) };
    }
    out[item.file] = entry;
  }
  process.stdout.write(JSON.stringify(out));
})().catch((error) => { process.stderr.write(String(error && error.stack)); process.exit(1); });
`;

function runReg01Child(tmp, srcDir, files) {
  const script = path.join(tmp, "reg01_child.js");
  const input = path.join(tmp, `reg01_input_${crypto.randomBytes(4).toString("hex")}.json`);
  fs.writeFileSync(script, REG01_CHILD);
  fs.writeFileSync(input, JSON.stringify({ files, maxWat: MAX_WAT }));
  const out = childProcess.spawnSync(process.execPath, [script, srcDir, input], {
    encoding: "utf8", env: { ...process.env, NODE_PATH: path.join(ROOT, "node_modules") }, maxBuffer: 256 * 1024 * 1024
  });
  assert.equal(out.status, 0, out.stderr);
  return JSON.parse(out.stdout);
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "air-v053-p003-"));
  try {
    // ------------------------------------------------------------------
    // REF — R3.1 rows (VECTORS.md lines 240-259), with the R2 row amendments.
    const fixture = fs.readFileSync(path.join(ROOT, FIXTURE_REFINED_SUM), "utf8");
    frozenInputs.add(fixture);
    const fixtureDesc = descriptor([
      ["refined_sum", [["left", "i64"], ["right", "i64"]], "i32"],
      ...["compare_eq", "compare_ne", "compare_lt", "compare_le", "compare_gt", "compare_ge"].map((name) => [name, [["left", "i64"], ["right", "i64"]], "bool"])
    ], [], "example.frozen_conformance");
    await vector("V53-REF-P01", async () => {
      const built = await build(fixture, fixtureDesc);
      assert.deepEqual(await call(built, "refined_sum", [i64(2), i64(3)]), { value: 5 });
      return { value: { "refined_sum(2,3)": 5 }, sourceDigest: sha256(fixture) };
    });
    await vector("V53-REF-N01", async () => {
      const built = await build(fixture, fixtureDesc);
      const typed = await call(built, "refined_sum", [i64(6), i64(5)]);
      assert.deepEqual(typed, ASSIGN, "the reason is read from the module");
      const lane = direct(built, "refined_sum", [6n, 5n]);
      assert.deepEqual(lane, ASSIGN, "the module's __air_failure_reason holds 17");
      return { value: { direct: lane, typed_call: typed }, sourceDigest: sha256(fixture) };
    });
    await vector("V53-REF-N02", async () => {
      const built = await build(fixture, fixtureDesc);
      const typed = await call(built, "refined_sum", [i64("9223372036854775807"), i64(1)]);
      assert.deepEqual(typed, NUMERIC("overflow", 1), "the numeric failure comes before the refinement check");
      return { value: typed, sourceDigest: sha256(fixture) };
    });
    const gDesc = descriptor([["g", [["n", "i32"]], "i32"]]);
    await vector("V53-REF-N03", async () => {
      const built = await build(SRC.g, gDesc);
      const value = expectAll([
        ["g(11)", await call(built, "g", [11]), INGRESS],
        ["g(-1)", await call(built, "g", [-1]), INGRESS],
        ["g(10)", await call(built, "g", [10]), { value: 10 }],
        // R2 amendment (review F-5): the module performs the entry check.
        ["direct lane 11", direct(built, "g", [11]), INGRESS],
        ["direct lane -1", direct(built, "g", [-1]), INGRESS],
        ["direct lane 10", direct(built, "g", [10]), { value: 10 }]
      ], "N03");
      return { value, sourceDigest: sha256(SRC.g) };
    });
    await vector("V53-REF-N04", () => ({ value: staticReject(M(fn("export func f() -> i32", ["%x: i32<0..10> = 11", "return %x"])), "air.refinement.assignment_out_of_range", 4) }));
    await vector("V53-REF-P02", async () => {
      const built = await build(SRC.p02, descriptor([["h", [["n", "i32"]], "i32"]]));
      assert.deepEqual(await call(built, "h", [7]), { value: 7 });
      return { value: { "h(7)": 7 }, sourceDigest: sha256(SRC.p02) };
    });
    await vector("V53-REF-P03", async () => {
      verified(SRC.p03);
      const built = await build(SRC.p03, descriptor([["h", [["n", "i32"]], "i32"]]));
      return { value: { accepted: true, schema: built.schema }, sourceDigest: sha256(SRC.p03) };
    });
    await vector("V53-REF-N05", async () => {
      const built = await build(SRC.n05, descriptor([["k", [["n", "i32"]], "i32"]]));
      const value = expectAll([
        ["k(11)", await call(built, "k", [11]), ASSIGN],
        ["k(7)", await call(built, "k", [7]), { value: 7 }]
      ], "N05");
      return { value, sourceDigest: sha256(SRC.n05) };
    });
    await vector("V53-REF-N06", () => ({
      value: [
        staticReject(M(fn("export func f(n: i32) -> i32", ["requires checked param n <= 10", "return %n"])), "air.v051.typed_syntax_invalid"),
        staticReject(M(fn("export func f(n: i32) -> i32", ["requires param n <= 10", "return %n"])), "air.v051.typed_syntax_invalid")
      ]
    }));
    await vector("V53-REF-P04", async () => {
      const built = await build(SRC.g, gDesc);
      assert.equal(built.schema, "air.v053.verifiedTypedBuild/1");
      assert.equal(built.sourceProfile, V053);
      assert.deepEqual(built.descriptor.exports[0].parameters, [{ name: "n", type: "i32" }], "the descriptor is (i32) -> i32");
      assert.equal(built.descriptor.exports[0].return_type, "i32");
      assert.deepEqual(built.sourceSignature, [{ function: "g", name: "g", parameters: [{ name: "n", type: "i32<0..10>" }], return_type: "i32<0..10>" }]);
      const inspected = inspectVerifiedTypedBuild(built);
      const { artifactDigest, wasmBytes, ...record } = inspected;
      assert.equal(artifactDigest, sha256(Buffer.from(canonicalJson(record), "utf8")), "artifactDigest covers sourceSignature");
      assert.match(sp.formatSource(typedV053(SRC.g), GATED), /^export func g\(n: i32<0\.\.10>\) -> i32<0\.\.10> \{$/mu, "the formatter spells the signature types");
      const runs = expectAll([
        ["g(5)", await call(built, "g", [5]), { value: 5 }],
        ["g(11)", await call(built, "g", [11]), INGRESS]
      ], "P04");
      const mismatch = await buildVerifiedTypedModule({ ...GATED, descriptor: descriptor([["g", [["n", "i64"]], "i32"]]), source: SRC.g }).then(() => null, (error) => error);
      assert(mismatch, "a descriptor declaring (i64) -> i32 is rejected");
      assert.equal(mismatch.code, "air.v051.typed_interface_source_invalid");
      observedFailures.push({ code: mismatch.code, kind: "BUILD" });
      // The runtime path: same mapping; the handle schema is unchanged (P3-R16).
      const runtime = createVerifiedTypedRuntime({ admit: async () => true });
      const handle = await runtime.build({ ...GATED, descriptor: gDesc, source: SRC.g });
      assert.equal(handle.schema, "air.v052.verifiedRuntimeBuild/1");
      assert.equal(handle.artifactDigest, built.artifactDigest);
      assert.equal((await runtime.invoke(handle, "g", [5])).value, 5);
      const refused = await runtime.invoke(handle, "g", [11]).then(() => null, (error) => error);
      assert.equal(refused && refused.code, "air.refinement.ingress_out_of_range");
      assert.equal(refused.failureReason, 16);
      return {
        value: { descriptor_mismatch: mismatch.code, invocations: runs, runtime: { handle_schema: handle.schema, "g(11)": refused.code }, schema: built.schema, sourceSignature: built.sourceSignature },
        interfaceDigest: built.descriptorDigest,
        sourceDigest: sha256(SRC.g)
      };
    });
    await vector("V53-REF-N07", () => {
      const outcome = staticReject(M(fn("export func f(n: i64<0..10>) -> i32", ["return 1"])), "air.refinement.base_type_unsupported");
      assert.doesNotMatch(outcome.message, /ABI|candidate/u, "the message does not cite the ABI candidate");
      return { value: { code: outcome.code, line: outcome.line } };
    });
    const rDesc = descriptor([["r", [["x", "i32"]], "i32"]]);
    await vector("V53-REF-N08", async () => {
      const built = await build(SRC.r, rDesc);
      const value = expectAll([
        ["r(11)", await call(built, "r", [11]), ASSIGN],
        ["r(10)", await call(built, "r", [10]), { value: 10 }],
        ["direct lane 11", direct(built, "r", [11]), ASSIGN],
        ["direct lane 10", direct(built, "r", [10]), { value: 10 }]
      ], "N08");
      return { value, sourceDigest: sha256(SRC.r) };
    });
    await vector("V53-REF-N09", async () => {
      const built = await build(SRC.n09, descriptor([
        ["g", [["n", "i32"]], "i32"], ["r", [["x", "i32"]], "i32"], ["refined_sum", [["left", "i64"], ["right", "i64"]], "i32"]
      ]));
      const outcomes = [
        await call(built, "g", [11]),
        await call(built, "r", [11]),
        await call(built, "refined_sum", [i64("9223372036854775807"), i64(1)])
      ];
      assert.deepEqual(outcomes, [INGRESS, ASSIGN, NUMERIC("overflow", 1)]);
      assert.equal(new Set(outcomes.map((item) => item.code)).size, 3, "three distinct host-facing codes");
      assert(outcomes.every((item) => item.code !== "air.runtime.trap_unclassified"));
      return { value: outcomes, sourceDigest: sha256(SRC.n09) };
    });
    await vector("V53-REF-N10", () => ({ status: "DEFERRED", value: { first_executable: "P0-04", reason: "internal calls are admitted at P0-04" } }));
    await vector("V53-REF-N11", async () => {
      // No compiler produces an unregistered value: the adapter's mapping is
      // applied to a synthetic artifact whose failure-reason export holds 99.
      const { error, instance } = await trapInstance(syntheticTrap("__air_failure_reason", 99));
      const identity = typedV053FailureIdentity(error, instance);
      assert.equal(identity.code, "air.runtime.failure_reason_unknown");
      assert.equal(identity.value, 99);
      return { value: { code: identity.code, failureReason: identity.value } };
    });
    await vector("V53-REF-N12", async () => {
      // COMPOSITE (owner condition (1)): 13 parts, each at its first executable
      // slice; the vector stays DEFERRED -> P0-08 and is never PASS before.
      const ints = descriptor([["f", [["a", "i32"], ["b", "i32"]], "i32"]]);
      const add = await build(SRC.n17, ints);
      const divSrc = M(fn("export func f(a: i32, b: i32) -> i32", ["%o: i32 = i32.checked_div_s %a, %b", "return %o"]));
      const div = await build(divSrc, ints);
      const convSrc = M(fn("export func f(x: f32) -> i32", ["%o: i32 = f32.trunc_to_i32_checked %x", "return %o"]));
      const conv = await build(convSrc, descriptor([["f", [["x", "f32"]], "i32"]]));
      const enumSrc = M(fn("enum Mode", ["off = 1,", "on = 2,"]), fn("export func f(m: v53.vec::Mode) -> i32", ["return 1"]));
      const enumBuilt = await build(enumSrc, descriptor([["f", [["m", "v53.vec::Mode"]], "i32"]], [enumDecl("v53.vec::Mode", "enum", [["off", 1], ["on", 2]])]));
      const optionSrc = M(fn("export func f(x: option<i32>) -> i32", ["return 1"]));
      const optionBuilt = await build(optionSrc, descriptor([["f", [["x", "option<i32>"]], "i32"]]));
      const boolSrc = M(fn("export func f(x: bool) -> i32", ["return 1"]));
      const boolBuilt = await build(boolSrc, descriptor([["f", [["x", "bool"]], "i32"]]));
      const parts = {
        1: await call(add, "f", [2147483647, 1]),
        2: await call(div, "f", [1, 0]),
        3: await call(conv, "f", [f32(Number.NaN)]),
        16: await call(await build(SRC.g, gDesc), "g", [11]),
        17: await call(await build(SRC.r, rDesc), "r", [11]),
        48: direct(enumBuilt, "f", [7]),
        49: direct(optionBuilt, "f", [2, 0]),
        50: direct(boolBuilt, "f", [2]),
        51: direct(optionBuilt, "f", [0, 5])
      };
      const partResults = {};
      for (const [value, outcome] of Object.entries(parts)) {
        const expected = ADAPTER_TABLE[value].reason ? NUMERIC(ADAPTER_TABLE[value].reason, Number(value)) : REASON(Number(value));
        assert.deepEqual(outcome, expected, `part ${value}`);
        partResults[value] = { first_executable: "P0-03", outcome, status: "PASS" };
      }
      const identities = Object.values(parts).map((item) => `${item.code}/${item.reason || ""}`);
      assert.equal(new Set(identities).size, identities.length, "pairwise distinct identities");
      for (const [value, slice] of [[32, "P0-05"], [33, "P0-06"], [35, "P0-06"], [34, "P0-08"]]) {
        partResults[value] = { first_executable: slice, status: "DEFERRED" };
      }
      return { status: "DEFERRED", value: { first_executable: "P0-08", kind: "COMPOSITE", parts: partResults } };
    });
    const old = oldMapping(tmp);
    await vector("V53-REF-N13", async () => {
      // Option (b): a P0-03 artifact whose refinement ingress failed (16).
      const built = await build(SRC.g, gDesc);
      const instance = new WebAssembly.Instance(new WebAssembly.Module(built.wasmBytes), {});
      let trap;
      try { instance.exports.g(11); } catch (error) { trap = error; }
      assert(trap instanceof WebAssembly.RuntimeError);
      assert.equal(instance.exports.__air_failure_reason.value, 16);
      assert.equal(old.map(trap, instance), null);
      const optionB = oldAdapter(old.map, trap, instance);
      // Option (a) (P3-R15): a synthetic instance whose numeric global holds 16.
      const synthetic = await trapInstance(syntheticTrap("__air_v051_checked_numeric_failure", 16));
      assert.equal(old.map(synthetic.error, synthetic.instance), null);
      const optionA = oldAdapter(old.map, synthetic.error, synthetic.instance);
      for (const outcome of [optionA, optionB]) assert.deepEqual(outcome, { code: "air.v052.invocation_runtime_failure" });
      return { value: { old_adapter: old.commit, option_a: optionA, option_b: optionB }, sourceDigest: sha256(SRC.g) };
    });
    await vector("V53-REF-P05", () => ({ status: "DEFERRED", value: { first_executable: "P0-04", reason: "internal calls are admitted at P0-04" } }));
    await vector("V53-REF-WB01", async () => {
      const built = await build(SRC.wb01, descriptor([["g", [["n", "i32"]], "i32"], ["g5", [["n", "i32"]], "i32"]]));
      return { value: { "E(g)": expectSteps(built, "g", 2), "E(g5)": expectSteps(built, "g5", 3) }, sourceDigest: sha256(SRC.wb01) };
    });

    // ------------------------------------------------------------------
    // REF — the R2 additions (VECTORS_ADDITIONS.md §2).
    await vector("V53-REF-N14", async () => {
      const built = await build(SRC.n14, descriptor([["y", [["c", "bool"], ["n", "i32"]], "i32"]]));
      const value = expectAll([
        ["y(true, 11)", await call(built, "y", [true, 11]), ASSIGN],
        ["y(true, -1)", await call(built, "y", [true, -1]), ASSIGN],
        ["y(true, 7)", await call(built, "y", [true, 7]), { value: 7 }],
        ["y(false, 11)", await call(built, "y", [false, 11]), { value: 0 }]
      ], "N14");
      return { value: { "E(y)": expectSteps(built, "y", 6), invocations: value }, sourceDigest: sha256(SRC.n14) };
    });
    await vector("V53-REF-N15", () => {
      const cases = [
        M(fn("export func f(x: option<i32<0..10>>) -> i32", ["return 1"])),
        M(fn("func h(x: option<i32<0..10>>) -> i32", ["return 1"]), fn("export func f() -> i32", ["return 1"]))
      ].map((source) => {
        const outcome = staticReject(source, "air.decision.payload_type_unsupported", 3);
        assert.doesNotMatch(outcome.message, /ABI|candidate/u);
        return { code: outcome.code, line: outcome.line };
      });
      return { value: cases };
    });
    const n16Desc = descriptor([
      ["f", [["x", "option<i32>"]], "i32"], ["g", [["x", "option<f32>"]], "i32"],
      ["h", [["x", "option<i64>"]], "i32"], ["r", [["x", "result<i32,v53.vec::E>"]], "i32"]
    ], [enumDecl("v53.vec::E", "error_enum", [["bad", 1]])]);
    await vector("V53-REF-N16", async () => {
      const built = await build(SRC.n16, n16Desc);
      const ONE = { value: 1 };
      const value = expectAll([
        ["f(0, 5)", direct(built, "f", [0, 5]), REASON(51)],
        ["f(0, 0)", direct(built, "f", [0, 0]), ONE],
        ["f(1, 5)", direct(built, "f", [1, 5]), ONE],
        ["f(2, 0)", direct(built, "f", [2, 0]), REASON(49)],
        ["f(2, 5)", direct(built, "f", [2, 5]), REASON(49)],
        ["g(0, -0.0)", direct(built, "g", [0, -0]), REASON(51)],
        ["g(0, NaN)", direct(built, "g", [0, Number.NaN]), REASON(51)],
        ["g(0, 0.0)", direct(built, "g", [0, 0]), ONE],
        ["g(1, -0.0)", direct(built, "g", [1, -0]), ONE],
        ["h(0, 1)", direct(built, "h", [0, 1n]), REASON(51)],
        ["h(0, 0)", direct(built, "h", [0, 0n]), ONE],
        ["r(0, 7, 1)", direct(built, "r", [0, 7, 1]), REASON(51)],
        ["r(0, 7, 9)", direct(built, "r", [0, 7, 9]), REASON(51)],
        ["r(0, 7, 0)", direct(built, "r", [0, 7, 0]), ONE],
        ["r(1, 5, 1)", direct(built, "r", [1, 5, 1]), REASON(51)],
        ["r(1, 5, 9)", direct(built, "r", [1, 5, 9]), REASON(51)],
        ["r(1, 0, 9)", direct(built, "r", [1, 0, 9]), REASON(48)],
        ["r(1, 0, 0)", direct(built, "r", [1, 0, 0]), REASON(48)],
        ["r(1, 0, 1)", direct(built, "r", [1, 0, 1]), ONE],
        ["r(2, 0, 0)", direct(built, "r", [2, 0, 0]), REASON(49)],
        ["typed f(none)", await call(built, "f", [{ tag: "none", type: "option<i32>" }]), ONE],
        ["typed r(ok 7)", await call(built, "r", [{ tag: "ok", type: "result<i32,v53.vec::E>", value: 7 }]), ONE],
        ["typed r(err E.bad)", await call(built, "r", [{ error: { discriminant: 1, type: "v53.vec::E" }, tag: "err", type: "result<i32,v53.vec::E>" }]), ONE]
      ], "N16");
      const summaries = { "E(f)": expectSteps(built, "f", 2), "E(g)": expectSteps(built, "g", 2), "E(h)": expectSteps(built, "h", 2), "E(r)": expectSteps(built, "r", 3) };
      return { value: { cases: value, summaries }, sourceDigest: sha256(SRC.n16) };
    });
    await vector("V53-REF-N17", async () => {
      const built = await build(SRC.n17, descriptor([["f", [["a", "i32"], ["b", "i32"]], "i32"]]));
      const adapter = await call(built, "f", [2147483647, 1]);
      assert.deepEqual(adapter, NUMERIC("overflow", 1));
      const instance = new WebAssembly.Instance(new WebAssembly.Module(built.wasmBytes), {});
      let trap;
      try { instance.exports.f(2147483647, 1); } catch (error) { trap = error; }
      assert(trap instanceof WebAssembly.RuntimeError);
      assert.equal(instance.exports.__air_v051_checked_numeric_failure, undefined, "no numeric global in a typed-v0.53 artifact (T-2)");
      assert.equal(old.map(trap, instance), null);
      const oldOutcome = oldAdapter(old.map, trap, instance);
      assert.deepEqual(oldOutcome, { code: "air.v052.invocation_runtime_failure" });
      return { status: "PASS", value: { kind: "CHARACTERIZATION", old_adapter: oldOutcome, typed_v053_adapter: adapter }, sourceDigest: sha256(SRC.n17) };
    });
    await vector("V53-REF-N18", async () => {
      const built = await build(SRC.n18, descriptor([
        ["b", [["x", "bool"]], "i32"], ["e", [["m", "v53.vec::Mode"]], "i32"], ["o", [["x", "option<i32>"]], "i32"]
      ], [enumDecl("v53.vec::Mode", "enum", [["off", 1], ["on", 2]])]));
      const ONE = { value: 1 };
      const typed = expectAll([
        ["b(2)", await call(built, "b", [2]), { code: "air.v051.typed_value_invalid" }],
        ["b()", await call(built, "b", []), { code: "air.v052.invocation_arguments_invalid" }],
        ["e(discriminant 7)", await call(built, "e", [{ discriminant: 7, type: "v53.vec::Mode" }]), { code: "air.decision.enum_discriminant_invalid" }],
        ["e(7)", await call(built, "e", [7]), { code: "air.v051.typed_value_invalid" }],
        ["o(tag maybe, value)", await call(built, "o", [{ tag: "maybe", type: "option<i32>", value: 1 }]), { code: "air.v051.typed_value_invalid" }],
        ["o(tag maybe)", await call(built, "o", [{ tag: "maybe", type: "option<i32>" }]), { code: "air.v051.record_invalid" }],
        ["b(true)", await call(built, "b", [true]), ONE],
        ["e(discriminant 2)", await call(built, "e", [{ discriminant: 2, type: "v53.vec::Mode" }]), ONE],
        ["o(none)", await call(built, "o", [{ tag: "none", type: "option<i32>" }]), ONE]
      ], "N18 typed calls");
      const lanes = expectAll([
        ["b lane 2", direct(built, "b", [2]), REASON(50)],
        ["e lane 7", direct(built, "e", [7]), REASON(48)],
        ["e lane 0", direct(built, "e", [0]), REASON(48)],
        ["o(2, 0)", direct(built, "o", [2, 0]), REASON(49)],
        ["o(0, 5)", direct(built, "o", [0, 5]), REASON(51)],
        ["b lane 1", direct(built, "b", [1]), ONE],
        ["e lane 2", direct(built, "e", [2]), ONE],
        ["o(1, 5)", direct(built, "o", [1, 5]), ONE]
      ], "N18 direct");
      return { value: { direct: lanes, typed_calls: typed }, sourceDigest: sha256(SRC.n18) };
    });
    await vector("V53-REF-N19", async () => {
      const value = {};
      value.i = staticReject(N19("export func f() -> i32", ["%y: i32 = 11", "%x: i32<0..10> = %y", "%w: i32 = %x", "return %w"]), "air.refinement.assignment_out_of_range", 5);
      value.ii = staticReject(N19("export func f() -> i32", ["%x: i32<0..10> = i32.checked_add 5, 6", "%w: i32 = %x", "return %w"]), "air.refinement.assignment_out_of_range", 4);
      const iii = staticReject(N19("export func f() -> i32", ["%x: i32<0..10> = i32.checked_add 2147483647, 1", "%w: i32 = %x", "return %w"]), "air.numeric.checked_failure", 4);
      assert.match(iii.message, /air\.numeric\.checked_failure: overflow/u);
      value.iii = iii;
      const ivSrc = N19("export func f(n: i32<20..30>) -> i32", ["%x: i32<0..10> = %n", "%w: i32 = %x", "return %w"]);
      const iv = await build(ivSrc, descriptor([["f", [["n", "i32"]], "i32"]]));
      value.iv = {
        "E(f)": expectSteps(iv, "f", 5),
        invocations: expectAll([
          ["f(20)", await call(iv, "f", [20]), ASSIGN], ["f(25)", await call(iv, "f", [25]), ASSIGN], ["f(30)", await call(iv, "f", [30]), ASSIGN],
          ["f(19)", await call(iv, "f", [19]), INGRESS], ["f(31)", await call(iv, "f", [31]), INGRESS]
        ], "N19 (iv)")
      };
      const vSrc = N19("export func f() -> i32", ["%y: i32 = i32.wrapping_add 5, 6", "%x: i32<0..10> = %y", "%w: i32 = %x", "return %w"]);
      const v = await build(vSrc, descriptor([["f", [], "i32"]]));
      value.v = { "E(f)": expectSteps(v, "f", 5), invocation: expectAll([["f()", await call(v, "f", []), ASSIGN]], "N19 (v)") };
      const vi = staticReject(N19("export func f() -> i32<0..10>", ["return 11"]), "air.refinement.assignment_out_of_range", 4);
      assert.doesNotMatch(vi.message, /return_out_of_range/u);
      value.vi = vi;
      const viiSrc = N19("export func f() -> i32", ["%y: i32 = 5", "%x: i32<0..10> = %y", "%w: i32 = %x", "return %w"]);
      const vii = await build(viiSrc, descriptor([["f", [], "i32"]]));
      value.vii = { "E(f)": expectSteps(vii, "f", 5), invocation: expectAll([["f()", await call(vii, "f", []), { value: 5 }]], "N19 (vii)") };
      for (const key of ["i", "ii", "iii", "vi"]) delete value[key].message;
      return { value };
    });
    await vector("V53-REF-REG01", async () => {
      const base = baseCommit();
      const tracked = childProcess.spawnSync("git", ["ls-tree", "-r", "--name-only", base], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
      assert.equal(tracked.status, 0, tracked.stderr);
      const list = tracked.stdout.split("\n").filter((item) => item.endsWith(".air")).sort();
      const files = list.map((file) => {
        const object = gitObject([base], file);
        const current = fs.readFileSync(path.join(ROOT, file));
        assert(object && Buffer.compare(object.bytes, current) === 0, `${file} is unchanged since the base`);
        return { file, source: object.bytes.toString("utf8") };
      });
      const baseDir = path.join(tmp, "base");
      fs.mkdirSync(baseDir, { recursive: true });
      const archive = childProcess.spawnSync("sh", ["-c", `git archive ${base} src | tar -x -C "${baseDir}"`], { cwd: ROOT, encoding: "utf8" });
      assert.equal(archive.status, 0, archive.stderr);
      const atBase = runReg01Child(tmp, path.join(baseDir, "src"), files);
      const atCandidate = runReg01Child(tmp, path.join(ROOT, "src"), files);
      assert.deepEqual(Object.keys(atCandidate).sort(), Object.keys(atBase).sort(), "the same set of files verifies at both commits");
      assert(Object.keys(atBase).length > 0, "the corpus has typed-v0.51 programs");
      for (const file of Object.keys(atBase)) {
        assert.deepEqual(atCandidate[file], atBase[file], `${file}: WAT, Wasm, exports and build record`);
        assert(!atBase[file].exports.includes("global:__air_failure_reason"), `${file}: no __air_failure_reason`);
        if (atBase[file].record.schema) assert.equal(atBase[file].record.schema, "air.v052.verifiedTypedBuild/2");
      }
      return {
        value: {
          base,
          files: Object.fromEntries(Object.entries(atBase).map(([file, entry]) => [file, { exports: entry.exports, record_schema: entry.record.schema || entry.record.error, wasm: entry.wasm, wat: entry.wat }])),
          tracked_air_files: list.length,
          typed_v051_files: Object.keys(atBase).length
        }
      };
    });
    await vector("V53-REF-WB02", async () => {
      const built = await build(SRC.wb02, descriptor([["h", [["n", "i32"]], "i32"], ["k", [["n", "i32"]], "i32"]]));
      return { value: { "E(h)": expectSteps(built, "h", 3), "E(k)": expectSteps(built, "k", 4) }, sourceDigest: sha256(SRC.wb02) };
    });
    await vector("V53-REF-WB03", async () => {
      const built = await build(SRC.wb03, descriptor([
        ["c", [], "i32"], ["d", [], "i32"], ["e", [], "i32"], ["y2", [["c", "bool"], ["k", "i32"]], "i32"]
      ]));
      const invocations = expectAll([
        ["c()", await call(built, "c", []), { value: 5 }],
        ["d()", await call(built, "d", []), { value: 10 }],
        ["e()", await call(built, "e", []), { value: 10 }],
        ["y2(true, 4)", await call(built, "y2", [true, 4]), { value: 4 }],
        ["y2(false, 9)", await call(built, "y2", [false, 9]), { value: 3 }]
      ], "WB03");
      const summaries = { "E(c)": expectSteps(built, "c", 2), "E(d)": expectSteps(built, "d", 3), "E(e)": expectSteps(built, "e", 2), "E(y2)": expectSteps(built, "y2", 7) };
      return { value: { invocations, summaries }, sourceDigest: sha256(SRC.wb03) };
    });

    // ------------------------------------------------------------------
    // Slice checks with no vector ID (slice text §4.4, §5.3; card exact_evidence).
    await vector("P0-03-CHECK-ADAPTER-TABLE", async () => {
      const table = Object.fromEntries(Object.entries(TYPED_V053_FAILURE_REASONS).map(([value, identity]) => [value, { ...identity }]));
      assert.deepEqual(table, Object.fromEntries(Object.entries(ADAPTER_TABLE).filter(([value]) => value !== "0")), "the registry is the A-1 table");
      const mapped = {};
      for (const value of [...Object.keys(ADAPTER_TABLE).map(Number), 4, 18, 36, 52, 99, -1]) {
        const { error, instance } = await trapInstance(syntheticTrap("__air_failure_reason", value));
        const identity = typedV053FailureIdentity(error, instance);
        const expected = ADAPTER_TABLE[value] || { code: "air.runtime.failure_reason_unknown" };
        assert.equal(identity.code, expected.code, `value ${value}`);
        assert.equal(identity.reason, expected.reason, `value ${value} reason word`);
        mapped[value] = expected.reason ? `${identity.code}/${identity.reason}` : identity.code;
      }
      assert.equal(typedV053FailureIdentity(new TypeError("host error"), null), null, "A-2: not an AIR trap");
      const notePath = path.join(ROOT, "docs", "v0.53", "P0_03_REFINEMENTS.md");
      if (fs.existsSync(notePath)) {
        const note = fs.readFileSync(notePath, "utf8");
        const section = note.slice(note.indexOf("## 3."), note.indexOf("## 4."));
        for (const [value, identity] of Object.entries(ADAPTER_TABLE)) {
          assert(new RegExp(`^\\| ${value} \\| \`${identity.code.replace(/\./g, "\\.")}\`${identity.reason ? ` / \`${identity.reason}\`` : ""}`, "mu").test(section), `the note lists value ${value}`);
        }
      }
      return { value: mapped };
    });
    await vector("P0-03-CHECK-CT1", () => {
      const file = path.join(ROOT, "src", "workbound_cost_table_v1.json");
      const bytes = fs.readFileSync(file);
      const blob = childProcess.spawnSync("git", ["hash-object", file], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
      const base = baseCommit();
      const baseBlob = childProcess.spawnSync("git", ["rev-parse", `${base}:src/workbound_cost_table_v1.json`], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
      assert.equal(blob, CT1.blob);
      assert.equal(baseBlob, CT1.blob);
      assert.equal(sha256(bytes), CT1.raw);
      assert.equal(wb.COST_TABLE_DIGEST, CT1.digest);
      assert.equal(JSON.parse(bytes.toString("utf8")).revision, CT1.revision);
      return { value: { blob, cost_table_digest: wb.COST_TABLE_DIGEST, raw: sha256(bytes), revision: CT1.revision } };
    });
    await vector("P0-03-CHECK-T1-T4", () => {
      for (const built of allBuilds) {
        const exports = WebAssembly.Module.exports(new WebAssembly.Module(built.wasmBytes));
        assert(exports.some((item) => item.name === "__air_failure_reason" && item.kind === "global"), "T-1");
        assert(!exports.some((item) => item.name === "__air_v051_checked_numeric_failure"), "T-2");
        assert.equal(exports.filter((item) => item.kind === "global").length, 1, "exactly one failure-reason export");
      }
      // T-4: the exhaustive-match fall-through is a bare trap that sets no value.
      const wat = lowerToWat(typedV053(SRC.n14), { maxWatBytes: MAX_WAT });
      assert.match(wat, /^ {2}\(func \$__air_v053_match_unreachable unreachable\)$/mu);
      assert.match(wat, /call \$__air_v053_match_unreachable\n {4}end/u);
      assert.doesNotMatch(wat, /call \$__air_v051_invalid_tag/u, "a bool match never calls the tag-ingress path");
      return { value: { builds_checked: allBuilds.length, single_failure_reason_export: true } };
    });

    // ------------------------------------------------------------------
    // EACH_SLICE vectors re-run on the P0-03 corpus (the SCALAR runs in
    // test/v053_scalar.test.js stay as they are).
    await vector("V53-FMT-01@P0-03", () => {
      for (const source of acceptedSources) {
        const once = sp.formatSource(typedV053(source), GATED);
        if (!frozenInputs.has(source)) assert.equal(once, source, "the source equals the canonical output");
        assert.equal(sp.formatSource(typedV053(once), GATED), once, "idempotent");
      }
      return { value: { sources: acceptedSources.size, judged_by_idempotence: frozenInputs.size } };
    });
    await vector("V53-LSP-01@P0-03", () => {
      const file = path.join(tmp, "lsp01.air");
      fs.writeFileSync(file, M(fn("export func f(n: i64<0..10>) -> i32", ["return 1"])));
      const cli = runCli(["check", file, "--source-profile", V053, "--allow-candidate-profile", "--lsp-json"]);
      const report = JSON.parse(cli.stdout);
      const diagnostic = report.diagnostics[0];
      assert.equal(diagnostic.code, "air.refinement.base_type_unsupported");
      assert.equal(diagnostic.line, 3);
      return { value: { code: diagnostic.code, line: diagnostic.line, status: report.status } };
    });
    await vector("V53-LSP-02@P0-03", () => {
      const session = new AirLspSession({ allowCandidateProfile: true, sourceProfile: V053 });
      const checks = [];
      for (const source of [
        M(fn("export func f(x: option<i32<0..10>>) -> i32", ["return 1"])),
        N19("export func f() -> i32<0..10>", ["return 11"]),
        M(fn("export func f() -> i32", ["%x: i32<0..10> = 11", "return %x"]))
      ]) {
        const thrown = captureFailure(() => typedV053(source));
        const uri = `file://${path.join(tmp, `lsp02-${checks.length}.air`)}`;
        const [published] = session.handleMessage({ jsonrpc: "2.0", method: "textDocument/didOpen", params: { textDocument: { text: source, uri, version: 1 } } });
        const diagnostic = published.params.diagnostics[0];
        assert.equal(diagnostic.code, thrown.code, "err.code preserved");
        checks.push(diagnostic.code);
      }
      return { value: checks };
    });
    await vector("V53-DIAG-01@P0-03", () => {
      const registry = new Set([...SCALAR_CODE_REGISTRY, ...P0_03_CODE_REGISTRY]);
      const notePath = path.join(ROOT, "docs", "v0.53", "P0_03_REFINEMENTS.md");
      if (fs.existsSync(notePath)) {
        const note = fs.readFileSync(notePath, "utf8");
        const section = note.slice(note.indexOf("## 5."), note.indexOf("## 6."));
        const listed = [...section.matchAll(/^\| `(air\.[a-z0-9_.]+)` \|/gmu)].map((match) => match[1]).sort();
        assert.deepEqual(listed, [...P0_03_CODE_REGISTRY].sort(), "the note's registry table lists exactly the P0-03 codes");
      }
      for (const item of observedFailures) {
        assert(registry.has(item.code), `${item.code} is in the registry`);
        if (item.kind === "STATIC_REJECT") assert(Number.isInteger(item.line), `${item.code} has a location`);
      }
      return { value: { failures_checked: observedFailures.length, p0_03_codes: P0_03_CODE_REGISTRY.length } };
    });
    await vector("V53-DIAG-02@P0-03", async () => {
      // Deterministic fuzz of the P0-03 corpus: no raw TypeError, JS stack, WABT
      // text or engine error; a verified source always builds (R-COMP-3).
      let seed = 0x0f0303;
      const next = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed; };
      const ops = ["i32<0..10>", "i32<10..0>", "i32<0..99999999999>", "i64<0..10>", "f32<0..1>", "option<i32<0..10>>", "result<i32<0..1>,v53.vec::E>",
        "i32", "%n", "%x", "11", "-1", "return", "match", "=>", "<", ">", "..", ",", "{", "}", "i32.checked_add", "i32.wrapping_add"];
      const registry = new Set([...SCALAR_CODE_REGISTRY, ...P0_03_CODE_REGISTRY]);
      const corpus = [...acceptedSources];
      let cases = 0;
      let verifiedCount = 0;
      let assembled = 0;
      for (let round = 0; round < 640; round += 1) {
        const lines = corpus[next() % corpus.length].split("\n");
        const mode = next() % 5;
        const at = next() % lines.length;
        if (mode === 0) lines.splice(at, 1);
        else if (mode === 1) lines.splice(at, 0, lines[next() % lines.length]);
        else if (mode === 2) lines[at] = `${lines[at]} ${ops[next() % ops.length]}`;
        else if (mode === 3) lines[at] = lines[at].replace(/[a-z0-9_.]+(?:<[^>]*>)?/u, ops[next() % ops.length]);
        else lines[at] = lines[at].slice(0, next() % (lines[at].length + 1));
        const source = lines.join("\n");
        cases += 1;
        let mod;
        try {
          mod = typedV053(source, "fuzz.air");
          verifiedCount += 1;
        } catch (error) {
          assert(!(error instanceof TypeError) && !(error instanceof RangeError) && !(error instanceof SyntaxError), `${error && error.stack}\n${source}`);
          assert(typeof error.code === "string" && registry.has(error.code), `unregistered or missing code ${error && error.code}: ${error && error.message}\n${source}`);
          assert(!/wabt|\n\s+at /iu.test(String(error.message)));
          continue;
        }
        const wat = lowerToWat(mod, { maxWatBytes: MAX_WAT });
        const wasm = await watToWasm(wat, "fuzz.air");
        new WebAssembly.Module(wasm);
        assembled += 1;
      }
      assert.equal(assembled, verifiedCount, "every verified fuzz source builds");
      return { value: { assembled, cases, verified: verifiedCount } };
    });
  } finally {
    fs.rmSync(tmp, { force: true, recursive: true });
  }

  const outDir = process.env.AIR_P003_VECTOR_RESULTS_DIR;
  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "v053_refinement.results.json"), `${JSON.stringify(results, null, 2)}\n`);
  }
  const passed = results.filter((item) => item.status === "PASS").length;
  const deferred = results.filter((item) => item.status === "DEFERRED").map((item) => item.vector);
  if (failures.length) {
    for (const failure of failures) console.error(`not ok - ${failure}`);
    console.error(`typed-v0.53 P0-03 vectors: ${failures.length} FAIL, ${passed} PASS`);
    process.exit(1);
  }
  for (const item of results) console.log(`ok - ${item.vector} ${item.status}`);
  console.log(`typed-v0.53 P0-03 vectors: ${passed} PASS, ${deferred.length} DEFERRED (${deferred.join(", ")})`);
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
