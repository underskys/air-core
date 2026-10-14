#!/usr/bin/env node
"use strict";

// typed-v0.53 P0-02 WorkBound composition foundation
// (AIR-0053-P0-WORKBOUND-COMPOSITION-FOUNDATION-0001).
// Every expected value below is copied from the R3.1 catalogue (VECTORS.md,
// sha256 f5353705...), the frozen V53-WB-H10-INGRESS review (REVIEW.md, sha256
// bd5c91f5...) or a frozen v0.51/v0.52 record. None is taken from the output of
// the implementation under test. The separate F1/RD-3 correction cases follow
// the owner-authorized CT1_RD3_CLARIFICATION.md, not amended catalogue goldens.
// Set AIR_P0_02_VECTOR_RESULTS=<file> to write
// one canonical result record per vector.
const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const wb = require("../src/workbound");
const { lowerToWat, watToWasm } = require("../src/lower_wasm");
const { SOURCE_PROFILE_TYPED_V051, parseSource, verifySource } = require("../src/source_profile");
const { descriptorDigest } = require("../src/typed_interface");
const reference = require("../src/v051_reference");
const { run: runV051Reference } = require("../scripts/run_v051_reference");
const {
  VERIFIED_TYPED_RUNTIME_LIMITS,
  buildVerifiedTypedModule,
  createVerifiedTypedRuntime
} = require("../src/v052_verified_build");

const ROOT = path.resolve(__dirname, "..");
const PROFILE = { sourceProfile: SOURCE_PROFILE_TYPED_V051 };
const { tree: t, summary, evaluate, analyzeModel } = wb;
const WB_MAX = 9223372036854775807n; // VECTORS.md Conventions
const S = (value) => t.lit(summary(value));
const loc = (line, column = 1) => ({ column, file: "<p0-02-model>", line });

const results = [];
const failures = [];
const parts = {};
const correctionResults = [];

function sha256(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

// Independent canonical JSON (sorted keys, no whitespace) for cross-checks.
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function domainDigest(domain, text) {
  return sha256(Buffer.concat([Buffer.from(domain, "utf8"), Buffer.from([0]), Buffer.from(text, "utf8")]));
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

async function correction(id, wanted, action) {
  const record = { VECTOR_ID: id, EXPECTED: plain(wanted), ACTUAL: null, PASS: false };
  try {
    record.ACTUAL = plain(await action());
    assert.deepEqual(record.ACTUAL, record.EXPECTED, id);
    record.PASS = true;
  } catch (error) {
    failures.push(`${id}: ${error && error.stack || error}`);
    record.ERROR = String(error && error.message || error);
  }
  correctionResults.push(record);
}

async function compiledCorrection(body, params, sourceReturnType, args, context = {}) {
  const moduleId = "wb.correction";
  const source = `module ${moduleId}\n${context.declarations || ""}export func f(${params.map((p) => `${p.name}: ${p.type}`).join(", ")}) -> ${sourceReturnType} {\n${body}\n}\n`;
  const mod = typedModule(source, "correction.air");
  const analysis = wb.analyzeVerifiedTypedModule(mod);
  assert.equal(analysis.status, "ok");
  const descriptor = {
    air_abi_lane: "0.12", module_id: moduleId, schema: "air.typed-interface/0.12-candidate.1",
    exports: [{ function: "f", name: "f", parameters: params, return_type: context.descriptorReturnType || sourceReturnType }],
    types: context.types || []
  };
  const build = await buildVerifiedTypedModule({ descriptor, source });
  const binding = wb.inspectBoundWorkBound(build);
  assertBindingKey(binding, build, wb.COST_TABLE_DIGEST);
  const { instance } = await WebAssembly.instantiate(build.wasmBytes, {});
  return {
    B: analysis.functions.get("f").value.steps.toString(),
    E: analysis.entries.get("f").value.steps.toString(),
    bound_E: binding.record.entries.f.steps,
    result: plain(instance.exports.f(...args))
  };
}

function expected(value) {
  return wb.canonicalSummary(summary(value));
}

function okSummary(result, expectedValue, label) {
  assert.equal(result.ok, true, `${label}: expected ok, got ${result.ok ? "ok" : result.failure.code}`);
  const actual = wb.canonicalSummary(result.value);
  assert.deepEqual(actual, expected(expectedValue), label);
  return actual;
}

function failed(result, code, label) {
  assert.equal(result.ok, false, `${label}: expected a failure`);
  assert.equal(result.failure.code, code, label);
  return { code: result.failure.code, reason: result.failure.reason, root: result.failure.root };
}

function typedModule(source, name) {
  const mod = parseSource(source, name, PROFILE);
  verifySource(mod, PROFILE);
  return mod;
}

function readFixture(relative) {
  return fs.readFileSync(path.join(ROOT, relative), "utf8");
}

// R3-N4 evidence identity rule: two summary records are claimed byte-identical
// only when both compiler_implementation_digest and cost_table_digest are
// equal. Across different digests only summary values are compared.
function assertRecordsByteIdentical(left, right, label) {
  assert.equal(left.key.compiler_implementation_digest, right.key.compiler_implementation_digest, `${label}: compiler_implementation_digest`);
  assert.equal(left.key.cost_table_digest, right.key.cost_table_digest, `${label}: cost_table_digest`);
  assert.equal(left.recordBytes, right.recordBytes, `${label}: record bytes`);
  assert.equal(left.recordDigest, right.recordDigest, `${label}: record digest`);
  return {
    byte_identical: true,
    compiler_implementation_digest: left.key.compiler_implementation_digest,
    cost_table_digest: left.key.cost_table_digest,
    record_digest: left.recordDigest
  };
}

// R-WB-20: the private binding is keyed only by the build's existing
// identities plus the CT-1 id and the independently recomputed CT-1 digest.
function assertBindingKey(binding, build, costTableDigest) {
  assert.deepEqual({ ...binding.key, dependencies: [...binding.key.dependencies] }, {
    body_digest: build.sourceDigest,
    compiler_implementation_digest: build.compiler.implementationDigest,
    cost_table: "air.workbound.cost/1",
    cost_table_digest: costTableDigest,
    dependencies: [],
    profile: build.sourceProfile
  });
  assert.equal(build.sourceProfile, "typed-v0.51");
  assert.equal(binding.recordDigest, domainDigest("AIR_WORKBOUND_SUMMARY_V1", canonicalJson(binding.record)));
}

function assertSummaryValuesEqual(left, right, label) {
  assert.deepEqual(left.record.entries, right.record.entries, `${label}: entry summaries`);
  assert.deepEqual(left.functions, right.functions, `${label}: function summaries`);
  return { entries: left.record.entries, summary_values_equal: true };
}

const NUMERIC_DESCRIPTOR = Object.freeze({
  air_abi_lane: "0.12", module_id: "example.checked_numeric",
  schema: "air.typed-interface/0.12-candidate.1", types: [],
  exports: [{ name: "checked_add", function: "checked_add", parameters: [{ name: "left", type: "i64" }, { name: "right", type: "i64" }], return_type: "i64" }]
});
const NUMERIC_SOURCE_PATH = "fixtures/v051/checked_numeric/checked_numeric.air";
// The two V53-WB-H10 sources, regenerated from their frozen generator texts
// (EMISSION: P0-00 probe pressure(1000, 1000), the X-BND-01 source;
// INGRESS: kit 03 §2, frozen by the H10-INGRESS review) and pinned by their
// frozen sha256 below, so the bytes are exactly the frozen fixtures.
const H10_CASES = Array.from({ length: 1000 }, (_, index) => `case${index} = ${index},`).join("\n");
const H10_PARAMS = Array.from({ length: 1000 }, (_, index) => `p${index}: E`).join(", ");
const EMISSION_SOURCE = `module work.pressure\nenum E {\n${H10_CASES}\n}\nfunc hidden(${H10_PARAMS}) -> i32 {\nreturn 0\n}\nexport func run() -> i32 {\nreturn 1\n}\n`;
const INGRESS_SOURCE = `module work.ingress\nenum E {\n${H10_CASES}\n}\nexport func wide(${H10_PARAMS}) -> i32 {\nreturn 0\n}\n`;
const EMISSION_PATH = "h10_emission_source.air";
const INGRESS_PATH = "h10_ingress_source.air";
const EMISSION_SHA256 = "sha256:12398f6081bf05b705bab552e4346e120b03df2bfd2b9ea7201a704ebdc8dc55";
const INGRESS_SHA256 = "sha256:55f00eae360083fef2ac6705546cdc3ac0a92ec425fb877bb068f6ceb03fc4e5";
const EMISSION_DESCRIPTOR = Object.freeze({
  air_abi_lane: "0.12", module_id: "work.pressure", schema: "air.typed-interface/0.12-candidate.1", types: [],
  exports: [{ function: "run", name: "run", parameters: [], return_type: "i32" }]
});

// Child processes for identity vectors: a copy of src/ is loaded from a
// temporary directory, so the shared working tree is never edited.
const CHILD_SCRIPT = `"use strict";
const fs = require("fs");
const path = require("path");
const srcDir = process.argv[2];
const input = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
const { buildVerifiedTypedModule } = require(path.join(srcDir, "v052_verified_build.js"));
const { inspectBoundWorkBound } = require(path.join(srcDir, "workbound.js"));
buildVerifiedTypedModule(input).then((build) => {
  const bound = inspectBoundWorkBound(build);
  process.stdout.write(JSON.stringify({ ok: true, compiler: build.compiler.implementationDigest, functions: bound.functions, key: bound.key,
    record: bound.record, recordBytes: bound.recordBytes, recordDigest: bound.recordDigest, stats: bound.stats }));
}, (error) => {
  process.stdout.write(JSON.stringify({ ok: false, code: error && error.code || null, name: error && error.name || null, message: String(error && error.message) }));
});
`;
const CLOCK_SHIFT = `"use strict";
const shift = 315576000000;
const RealDate = Date;
class ShiftedDate extends RealDate {
  constructor(...args) { if (args.length) super(...args); else super(RealDate.now() + shift); }
  static now() { return RealDate.now() + shift; }
}
global.Date = ShiftedDate;
const { performance } = require("perf_hooks");
const realPerf = performance.now.bind(performance);
performance.now = () => realPerf() + shift;
const realHr = process.hrtime;
process.hrtime = (prev) => realHr(prev);
process.hrtime.bigint = () => realHr.bigint() + BigInt(shift) * 1000000n;
`;

function runChild(dir, srcDir, input, env, extraArgs = []) {
  const script = path.join(dir, "child.js");
  const inputFile = path.join(dir, `input-${crypto.randomBytes(4).toString("hex")}.json`);
  fs.writeFileSync(script, CHILD_SCRIPT);
  fs.writeFileSync(inputFile, JSON.stringify(input));
  const out = childProcess.spawnSync(process.execPath, [...extraArgs, script, srcDir, inputFile], {
    cwd: dir, encoding: "utf8", env, maxBuffer: 16 * 1024 * 1024
  });
  assert.equal(out.status, 0, `child exited ${out.status}: ${out.stderr}`);
  return JSON.parse(out.stdout);
}

function envWithout(names, extra = {}) {
  const env = { ...process.env, ...extra };
  for (const name of names) delete env[name];
  return env;
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "air-v053-p0-02-"));
  try {
    // ------------------------------------------------------------------
    // CT-1 file identity (R-WB-27a). Recomputed here with an independent
    // canonical serializer; recorded in the evidence, not a catalogue value.
    const ctBytes = fs.readFileSync(path.join(ROOT, "src", wb.COST_TABLE_FILE));
    const ctTable = JSON.parse(ctBytes.toString("utf8"));
    assert.equal(ctTable.id, "air.workbound.cost/1");
    assert.equal(wb.COST_TABLE_FILE_SHA256, sha256(ctBytes));
    const ctDigest = domainDigest("AIR_WORKBOUND_COST_TABLE_V1", canonicalJson(ctTable));
    assert.equal(wb.COST_TABLE_DIGEST, ctDigest);
    assert.equal(wb.costTableDigest(ctTable), wb.COST_TABLE_DIGEST);
    assert.equal(wb.WB_MAX, WB_MAX);
    assert.equal(WB_MAX, 2n ** 63n - 1n);

    // ------------------------------------------------------------------
    // Algebra positives (required tests 1-3, 7-10).
    await vector("V53-WB-P01", () => ({ value: okSummary(evaluate(t.seq([S({ steps: 3n }), S({ steps: 4n }), S({ steps: 5n })])).result, { steps: 12n }, "P01") }));
    await vector("V53-WB-P02", () => ({
      value: okSummary(evaluate(t.seq([t.seq([S({ steps: 1n }), S({ steps: 2n })]), t.seq([S({ steps: 3n }), t.seq([S({ steps: 4n }), S({ steps: 5n })])])])).result, { steps: 15n }, "P02")
    }));
    await vector("V53-WB-P03", () => ({ value: okSummary(evaluate(t.call("f"), { summaries: { f: { calls: 2n, steps: 10n } } }).result, { calls: 3n, steps: 11n }, "P03") }));
    await vector("V53-WB-P04", () => {
      const value = okSummary(evaluate(t.loop(100n, S({ effects: { "output.emit": 1n }, steps: 3n }))).result,
        { effects: { "output.emit": 100n }, iterations: 100n, steps: 401n }, "P04");
      parts["V53-WB-H01(a)"] = "PASS";
      return { value };
    });
    await vector("V53-WB-P05", () => {
      const inner = okSummary(evaluate(t.loop(4n, S({ steps: 5n }))).result, { iterations: 4n, steps: 25n }, "P05 inner");
      const outer = okSummary(evaluate(t.loop(3n, t.loop(4n, S({ steps: 5n })))).result, { iterations: 15n, steps: 79n }, "P05 outer");
      return { value: { inner, outer } };
    });
    await vector("V53-WB-P06", () => ({ value: okSummary(evaluate(t.loop(0n, S({ effects: { "debug.metric": 5n }, steps: 1000n }))).result, { steps: 1n }, "P06") }));
    await vector("V53-WB-P07", () => ({ value: okSummary(evaluate(t.loop(2n, S({ steps: 4611686018427387902n }))).result, { iterations: 2n, steps: 9223372036854775807n }, "P07") }));
    await vector("V53-WB-P08", () => ({ value: okSummary(evaluate(t.seq([S({ steps: 9223372036854775806n }), S({ steps: 1n })])).result, { steps: 9223372036854775807n }, "P08") }));
    await vector("V53-WB-P09", () => ({
      value: okSummary(evaluate(t.branch(S({ steps: 5n }), S({ effects: { "output.emit": 1n }, steps: 2n }))).result, { effects: { "output.emit": 1n }, steps: 6n }, "P09")
    }));
    await vector("V53-WB-P10", () => ({ value: okSummary(evaluate(t.extern("output.emit")).result, { effects: { "output.emit": 1n }, steps: 1n }, "P10") }));
    await vector("V53-WB-P11", () => {
      const atoms = okSummary(evaluate(t.match([t.atomArm(), t.atomArm(), t.atomArm()])).result, { steps: 4n }, "P11 atom arms");
      const blocks = okSummary(evaluate(t.match([S({ steps: 2n }), S({ steps: 7n }), S({ steps: 1n })])).result, { steps: 11n }, "P11 block arms");
      return { value: { atoms, blocks } };
    });
    await vector("V53-WB-P12", () => {
      const params = [{ cases: 5n, kind: "enum" }, { kind: "bool" }, { kind: "refined_i32" }, { kind: "option", payload: { kind: "bool" } }];
      const ingress = okSummary(evaluate(t.entry(params, S({}))).result, { steps: 9n }, "P12 ingress");
      const entry = okSummary(evaluate(t.entry(params, S({ steps: 1n }))).result, { steps: 10n }, "P12 entry");
      return { value: { entry, ingress: ingress.steps } };
    });
    await vector("V53-WB-P13", () => {
      const t1 = okSummary(evaluate(t.add(t.row("loop.iteration"), S({ steps: 9223372036854775806n }))).result, { iterations: 1n, steps: 9223372036854775807n }, "P13 t1");
      const total = okSummary(evaluate(t.loop(0n, S({ steps: 9223372036854775806n }))).result, { steps: 1n }, "P13");
      return { value: { result: total, t1 } };
    });
    await vector("V53-WB-P14", () => ({ value: okSummary(evaluate(t.loop(0n, S({ steps: 4611686018427387903n }))).result, { steps: 1n }, "P14") }));

    // ------------------------------------------------------------------
    // Algebra negatives (required tests 4-6, 11-13) and R2/R3 boundaries.
    await vector("V53-WB-N01", () => {
      const tree = failed(evaluate(t.call("g", loc(3))).result, "air.workbound.missing_summary", "N01 tree");
      const model = analyzeModel({ functions: [{ body: t.call("g", loc(3)), exported: true, loc: loc(2), name: "f", params: [] }], module: "v53.vec" });
      assert.equal(model.status, "rejected");
      assert.equal(model.primary.code, "air.workbound.missing_summary");
      return { value: { model: model.primary.code, tree } };
    });
    const cycleVector = (id, functions, cyclePath) => vector(id, () => {
      const model = analyzeModel({ functions, module: "v53.vec" });
      assert.equal(model.status, "rejected");
      assert.equal(model.primary.code, "air.call.recursion_rejected");
      assert.equal(model.primary.cyclePath, cyclePath);
      assert.equal(model.stats.functionSummaries, 0, "no summary is computed after a call-graph cycle");
      const error = wb.analysisError(model);
      assert.match(error.message, /air\.call\.recursion_rejected: local function call cycle /u);
      return { value: { code: model.primary.code, cyclePath: model.primary.cyclePath, cycles: model.cycles.map((item) => item.cyclePath) } };
    });
    await cycleVector("V53-WB-N02", [
      { body: t.call("b", loc(3)), loc: loc(2), name: "a" },
      { body: t.call("a", loc(6)), loc: loc(5), name: "b" }
    ], "@a -> @b -> @a");
    await cycleVector("V53-WB-N03", [{ body: t.call("f", loc(3)), loc: loc(2), name: "f" }], "@f -> @f");
    await vector("V53-WB-N04", () => ({ value: failed(evaluate(t.seq([S({ steps: 9223372036854775807n }), S({ steps: 1n })])).result, "air.workbound.overflow", "N04") }));
    await vector("V53-WB-N05", () => ({ value: failed(evaluate(t.loop(2n, S({ steps: 4611686018427387903n }))).result, "air.workbound.overflow", "N05") }));
    await vector("V53-WB-N06", () => ({ value: failed(evaluate(t.loop({ unknown: true }, S({ steps: 1n }))).result, "air.workbound.unknown_bound", "N06") }));
    await vector("V53-WB-N07", () => ({ value: failed(evaluate(t.loop(-1n, S({ steps: 1n }))).result, "air.workbound.invalid_bound", "N07") }));
    await vector("V53-WB-N08", () => ({
      value: failed(evaluate(t.loop(2n, S({ effects: { "debug.metric": 4611686018427387904n }, steps: 1n }))).result, "air.workbound.overflow", "N08")
    }));
    await vector("V53-WB-N09", () => {
      const model = analyzeModel({
        functions: [
          { body: S({ steps: 1n }), exported: true, loc: loc(2), name: "run", params: [] },
          { body: t.loop(2n, S({ steps: 4611686018427387903n }), loc(6)), loc: loc(5), name: "h" }
        ],
        module: "v53.vec"
      });
      assert.equal(model.status, "rejected", "an unexported, unreachable function still rejects the module (R-WB-11)");
      assert.equal(model.primary.code, "air.workbound.overflow");
      assert.equal(model.primary.function, "h");
      return { value: { code: model.primary.code, function: model.primary.function } };
    });
    await cycleVector("V53-WB-N10", [
      { body: t.loop(1n, t.call("g", loc(3)), loc(3)), loc: loc(2), name: "f" },
      { body: t.call("f", loc(6)), loc: loc(5), name: "g" }
    ], "@f -> @g -> @f");
    await cycleVector("V53-WB-N11", [
      // the cycle edge a -> b sits only in the alternative that is statically never taken
      { body: t.branch(S({ steps: 1n }), t.call("b", loc(3)), loc(3)), loc: loc(2), name: "a" },
      { body: t.call("a", loc(6)), loc: loc(5), name: "b" }
    ], "@a -> @b -> @a");
    await vector("V53-WB-N12", () => {
      const inner = failed(evaluate(t.loop(2n, S({ steps: 4611686018427387903n }))).result, "air.workbound.overflow", "N12 inner");
      const outer = evaluate(t.loop(0n, t.loop(2n, S({ steps: 4611686018427387903n }))));
      failed(outer.result, "air.workbound.overflow", "N12");
      assert.equal(outer.result.failure.root, false, "the outer loop inherits the inner failure");
      assert.equal(outer.roots.length, 1);
      return { value: { inner, result: outer.result.failure.code } };
    });
    await vector("V53-WB-N13", () => ({ value: failed(evaluate(t.loop(0n, t.call("g"))).result, "air.workbound.missing_summary", "N13") }));
    await cycleVector("V53-WB-N14", [
      { body: t.loop(0n, t.call("f", loc(3)), loc(3)), exported: true, loc: loc(2), name: "run", params: [] },
      { body: t.call("h", loc(6)), loc: loc(5), name: "f" },
      { body: t.call("f", loc(9)), loc: loc(8), name: "h" }
    ], "@f -> @h -> @f");
    await vector("V53-WB-N15", () => ({ value: failed(evaluate(t.branch(S({ steps: 1n }), t.failLeaf("unknown_bound"))).result, "air.workbound.unknown_bound", "N15") }));
    await vector("V53-WB-N16", () => {
      const out = evaluate(t.loop(0n, S({ steps: 9223372036854775807n })));
      failed(out.result, "air.workbound.overflow", "N16");
      assert.equal(out.roots.length, 1);
      assert.equal(out.roots[0].reason, "overflow", "t1 overflows before the multiplication by 0");
      return { value: { code: out.result.failure.code } };
    });
    await vector("V53-WB-N17", () => {
      const entry = evaluate(t.entry([{ kind: "bool" }], S({ steps: 9223372036854775807n })));
      failed(entry.result, "air.workbound.overflow", "N17 entry");
      assert.equal(entry.result.failure.root, true, "the overflow is at the entry node");
      const model = analyzeModel({ functions: [{ body: S({ steps: 9223372036854775807n }), exported: true, loc: loc(2), name: "f", params: [{ kind: "bool" }] }], module: "v53.vec" });
      assert.equal(model.status, "rejected");
      assert.equal(model.primary.code, "air.workbound.overflow");
      assert.equal(model.functions.get("f").ok, true, "B itself is ok");
      return { value: { code: model.primary.code } };
    });
    await vector("V53-WB-N18", () => {
      let error = null;
      try { evaluate(t.seq([S({ steps: 1n }), t.row("synthetic.construct_without_ct1_row", loc(4))])); } catch (caught) { error = caught; }
      assert(error instanceof wb.WorkBoundError, "the guard fires as an exception, not as a summary value");
      assert.equal(error.code, "air.workbound.cost_undefined");
      assert.equal(error.disposition, "IMPLEMENTATION_DEFECT");
      assert.equal(wb.FAILURE_REASONS.includes("cost_undefined"), false);
      assert.throws(() => analyzeModel({ functions: [{ body: t.row("synthetic.construct_without_ct1_row"), loc: loc(2), name: "f" }], module: "v53.vec" }),
        (caught) => caught.code === "air.workbound.cost_undefined" && caught.disposition === "IMPLEMENTATION_DEFECT");
      return { status: "PASS", value: { code: error.code, disposition: error.disposition } };
    });
    await vector("V53-WB-N19", () => {
      const out = evaluate(t.seq([S({ steps: 9223372036854775807n }), S({ steps: 1n }), t.failLeaf("unknown_bound")]));
      failed(out.result, "air.workbound.overflow", "N19");
      return { value: { code: out.result.failure.code } };
    });
    await vector("V53-WB-N20", () => {
      const model = analyzeModel({
        functions: [
          { body: t.seq([S({ steps: 1n }), t.failLeaf("unknown_bound", loc(3))]), loc: loc(2), name: "h" },
          { body: t.seq([S({ steps: 9223372036854775807n }), t.lit(summary({ steps: 1n }), loc(10))]), loc: loc(8), name: "g" },
          { body: t.seq([t.call("g", loc(15)), t.call("h", loc(16)), t.row("return", loc(17))]), exported: true, loc: loc(14), name: "run", params: [] }
        ],
        module: "v53.vec"
      });
      assert.equal(model.status, "rejected");
      assert.deepEqual(model.roots.map((item) => [item.reason, item.function]), [["unknown_bound", "h"], ["overflow", "g"]]);
      assert.equal(model.primary.code, "air.workbound.unknown_bound");
      const runFailure = model.functions.get("run").failure;
      assert.equal(runFailure.root, false);
      assert.equal(runFailure.cause.function, "g", "run's cause is its first failing child, the call to g");
      return { value: { primary: model.primary.code, roots: model.roots.map((item) => `${item.reason}@${item.function}`), run_cause: runFailure.cause.function } };
    });

    // ------------------------------------------------------------------
    // Identity (required tests 14-15; R-WB-18..21, R-WB-27a).
    const decideSource = readFixture("fixtures/v051/first_vertical/typed_decide.air");
    const decideAnalysis = wb.analyzeVerifiedTypedModule(typedModule(decideSource, "typed_decide.air"));
    const sampleIdentity = { compilerImplementationDigest: `sha256:${"0".repeat(64)}`, sourceDigest: sha256(decideSource) };
    await vector("V53-WB-ID-01", () => {
      const v051 = wb.bindVerifiedTypedWorkBound(decideAnalysis, { ...sampleIdentity, sourceProfile: "typed-v0.51" });
      const v053 = wb.bindVerifiedTypedWorkBound(decideAnalysis, { ...sampleIdentity, sourceProfile: "typed-v0.53" });
      assert.notEqual(canonicalJson(v051.key), canonicalJson(v053.key));
      assert.notEqual(v051.recordDigest, v053.recordDigest);
      assert.throws(() => wb.compareSuppliedRecord(v051, v053.record), (error) => error.code === "air.workbound.identity_mismatch");
      return { value: { key_differs: true, record_digests: [v051.recordDigest, v053.recordDigest] } };
    });
    const idSource = (n) => `module v53.id\nexport func f() -> i32 {\n%out: i32 = ${n}\nreturn %out\n}\n`;
    const idDescriptor = { air_abi_lane: "0.12", module_id: "v53.id", schema: "air.typed-interface/0.12-candidate.1", types: [],
      exports: [{ function: "f", name: "f", parameters: [], return_type: "i32" }] };
    await vector("V53-WB-ID-02", async () => {
      const one = await buildVerifiedTypedModule({ descriptor: idDescriptor, source: idSource(1) });
      const two = await buildVerifiedTypedModule({ descriptor: idDescriptor, source: idSource(2) });
      const a = wb.inspectBoundWorkBound(one);
      const b = wb.inspectBoundWorkBound(two);
      assertBindingKey(a, one, ctDigest);
      assertBindingKey(b, two, ctDigest);
      assert.notEqual(a.key.body_digest, b.key.body_digest);
      assert.notEqual(canonicalJson(a.key), canonicalJson(b.key));
      assert.notEqual(a.recordDigest, b.recordDigest);
      assert.notEqual(a, b, "each build carries its own recomputed binding");
      assert.equal(a.stats.functionSummaries, 1);
      assert.equal(b.stats.functionSummaries, 1);
      assert.throws(() => wb.compareSuppliedRecord(a, b.record), (error) => error.code === "air.workbound.identity_mismatch");
      parts["V53-WB-H04(a)"] = "PASS";
      return { value: { body_digests: [a.key.body_digest, b.key.body_digest], record_digests: [a.recordDigest, b.recordDigest] } };
    });
    const numericSource = readFixture(NUMERIC_SOURCE_PATH);
    const numericBuild = await buildVerifiedTypedModule({ descriptor: NUMERIC_DESCRIPTOR, source: numericSource });
    const numericBinding = wb.inspectBoundWorkBound(numericBuild);
    assertBindingKey(numericBinding, numericBuild, ctDigest);
    await vector("V53-WB-ID-03", () => {
      assert.deepEqual(numericBinding.record.entries.checked_add, expected({ steps: 2n }));
      assert.throws(() => wb.compareSuppliedEntry(numericBinding, "checked_add", { steps: "1" }), (error) => error.code === "air.workbound.identity_mismatch");
      assert.equal(wb.inspectBoundWorkBound(numericBuild), numericBinding, "the derived binding is retained");
      assert.deepEqual(wb.inspectBoundWorkBound(numericBuild).record.entries.checked_add, expected({ steps: 2n }), "never lowered");
      assert.equal(wb.compareSuppliedEntry(numericBinding, "checked_add", { steps: "2" }), numericBinding);
      return { value: { compared: "air.workbound.identity_mismatch", derived: numericBinding.record.entries.checked_add }, sourceDigest: sha256(numericSource) };
    });
    await vector("V53-WB-ID-04", async () => {
      const supplied = JSON.parse(numericBinding.recordBytes);
      supplied.key.body_digest = sha256(decideSource);
      assert.throws(() => wb.compareSuppliedRecord(numericBinding, supplied), (error) => error.code === "air.workbound.identity_mismatch");
      assert.equal(wb.inspectBoundWorkBound(numericBuild), numericBinding);
      const runtime = createVerifiedTypedRuntime({ admit: async () => true });
      const handle = await runtime.build({ descriptor: NUMERIC_DESCRIPTOR, source: numericSource });
      const value = await runtime.invoke(handle, "checked_add", [{ decimal: "2", type: "i64" }, { decimal: "3", type: "i64" }]);
      assert.deepEqual(value.value, { decimal: "5", type: "i64" }, "admission is unaffected by the supplied record");
      return { value: { compared: "air.workbound.identity_mismatch", ignored_for_admission: true } };
    });
    await vector("V53-WB-ID-05", () => {
      const dir = path.join(tmp, "id05");
      fs.mkdirSync(dir);
      fs.cpSync(path.join(ROOT, "src"), path.join(dir, "src"), { recursive: true });
      fs.appendFileSync(path.join(dir, "src", "version.js"), "// V53-WB-ID-05: one src byte changed\n");
      const input = { descriptor: NUMERIC_DESCRIPTOR, source: numericSource };
      const changed = runChild(dir, path.join(dir, "src"), input, envWithout([], { NODE_PATH: path.join(ROOT, "node_modules") }));
      assert.equal(changed.ok, true, changed.message);
      assert.notEqual(changed.key.compiler_implementation_digest, numericBinding.key.compiler_implementation_digest);
      assert.equal(changed.key.cost_table_digest, numericBinding.key.cost_table_digest);
      assert.notEqual(canonicalJson(changed.key), canonicalJson(numericBinding.key), "the key changes");
      assert.notEqual(changed.recordDigest, numericBinding.recordDigest);
      assert(changed.stats.functionSummaries >= 1, "the other toolchain recomputed the summary");
      // R3-N4: the compiler digests differ, so only summary values are compared.
      const values = assertSummaryValuesEqual({ functions: changed.functions, record: changed.record }, numericBinding, "ID-05");
      parts["V53-WB-H09(ID-05)"] = "PASS";
      return { value: { compiler_implementation_digests: [numericBinding.key.compiler_implementation_digest, changed.key.compiler_implementation_digest], cost_table_digest: numericBinding.key.cost_table_digest, record_digests: [numericBinding.recordDigest, changed.recordDigest], summary_values_equal: values.summary_values_equal } };
    });
    const id06Record = {
      entries: { run: { calls: "0", effects: {}, iterations: "0", steps: "2" } },
      key: {
        body_digest: `sha256:${"1".repeat(64)}`,
        compiler_implementation_digest: `sha256:${"0".repeat(64)}`,
        cost_table: "air.workbound.cost/1",
        cost_table_digest: `sha256:${"2".repeat(64)}`,
        dependencies: [],
        profile: "typed-v0.53"
      },
      schema: "air.workbound.summary/1"
    };
    await vector("V53-WB-ID-06", () => {
      const bytes = wb.recordBytes(id06Record);
      assert.equal(bytes, canonicalJson(id06Record));
      assert.equal(Buffer.byteLength(bytes, "utf8"), 485);
      assert.equal(wb.recordDigest(id06Record), "sha256:839b3d043ad47ede6808111206cfd6d4bdaf2de3a751bdbd57482b67b66ce628");
      assert.equal(sha256(bytes), "sha256:f8656f52f0d915e3831287e83bd4f9831e6cf86d327120f1bd45c44e0f201deb");
      assert.notEqual(wb.recordDigest(id06Record), sha256(bytes), "the undomained digest is never the record digest");
      parts["V53-WB-H09(ID-06)"] = "PASS";
      return { value: { bytes: 485, digest: wb.recordDigest(id06Record) } };
    });
    await vector("V53-WB-ID-07", () => {
      const id07Record = JSON.parse(JSON.stringify(id06Record));
      id07Record.key.cost_table_digest = `sha256:${"3".repeat(64)}`;
      assert.equal(wb.recordDigest(id07Record), "sha256:16cba915b746e79d8df15a6ccf9143f7d85da0f6c6a6682df7cc62180956d4bb");
      // R3-N4: same id and compiler digest, different cost_table_digest: the
      // records are never byte-equal and never compared equal.
      assert.equal(id07Record.key.cost_table, id06Record.key.cost_table);
      assert.equal(id07Record.key.compiler_implementation_digest, id06Record.key.compiler_implementation_digest);
      assert.notEqual(wb.recordBytes(id07Record), wb.recordBytes(id06Record));
      assert.throws(() => wb.compareSuppliedRecord({ recordBytes: wb.recordBytes(id06Record), recordDigest: wb.recordDigest(id06Record) }, id07Record),
        (error) => error.code === "air.workbound.identity_mismatch");
      return { value: { digest: wb.recordDigest(id07Record), shared: false } };
    });

    // ------------------------------------------------------------------
    // Regression (P0-02 "also prove").
    await vector("V53-WB-REG-01", async () => {
      const expectations = {
        "fixtures/v051/first_vertical/typed_decide.air": { decide: 6n, option_bool_identity: 6n, option_identity: 5n, result_bool_identity: 6n, result_identity: 6n, scalar_literals: 7n },
        "fixtures/v051/checked_numeric/checked_numeric.air": Object.fromEntries(["checked_add", "checked_sub", "checked_mul", "checked_neg", "checked_div", "checked_rem", "narrow_i64", "widen_i32", "widen_f32", "narrow_f64"].map((name) => [name, 2n])),
        "fixtures/v051/conformance/typed_refinement_and_comparisons.air": { compare_eq: 2n, compare_ge: 2n, compare_gt: 2n, compare_le: 2n, compare_lt: 2n, compare_ne: 2n, refined_sum: 4n }
      };
      const value = {};
      for (const [relative, entries] of Object.entries(expectations)) {
        const source = readFixture(relative);
        const analysis = wb.analyzeVerifiedTypedModule(typedModule(source, relative));
        assert.equal(analysis.status, "ok");
        assert.deepEqual([...analysis.entries.keys()].sort(), Object.keys(entries).sort(), `${relative}: export set`);
        for (const [name, steps] of Object.entries(entries)) okSummary(analysis.entries.get(name), { steps }, `${relative} ${name}`);
        value[relative] = Object.fromEntries(Object.entries(entries).map(([name, steps]) => [name, steps.toString()]));
      }
      // The build binding carries the same values (same process: both digests equal).
      const pure = wb.bindVerifiedTypedWorkBound(wb.analyzeVerifiedTypedModule(typedModule(numericSource, NUMERIC_SOURCE_PATH)), {
        compilerImplementationDigest: numericBuild.compiler.implementationDigest, sourceDigest: numericBuild.sourceDigest, sourceProfile: numericBuild.sourceProfile
      });
      value.build_binding = assertRecordsByteIdentical(pure, numericBinding, "REG-01 builder vs analysis");
      return { value };
    });
    await vector("V53-WB-REG-02", () => {
      const codes = {};
      for (const statement of ["call @other()", "loop", "br nowhere", "%x: i32 = call @g()"]) {
        const source = `module work.reject\nexport func run() -> i32 {\n${statement}\nreturn 0\n}\n`;
        let code = null;
        try { typedModule(source, "probe.air"); } catch (error) { code = error.code; }
        assert(["air.v051.typed_syntax_invalid", "air.v051.typed_atom_invalid"].includes(code), `${statement}: ${code}`);
        codes[statement] = code;
      }
      return { value: codes };
    });
    await vector("V53-WB-REG-03", () => ({ status: "PASS_BY_COMMAND_LOGS", value: { commands: ["npm test (dev)", "npm test (public)", "node test/run.js", "node test/v052_public_reality_gate.test.js", "git diff --check"] } }));

    // ------------------------------------------------------------------
    // Hostile vectors owned by P0-02.
    await vector("V53-WB-H02", () => {
      const chain = (depth) => {
        let item = t.loop(4096n, S({ steps: 1n }));
        for (let level = 2; level <= depth; level += 1) item = t.loop(4096n, item);
        return item;
      };
      const five = okSummary(evaluate(chain(5)).result, { iterations: 1153203048319815680n, steps: 2306406096639631361n }, "H02 depth 5");
      const six = failed(evaluate(chain(6)).result, "air.workbound.overflow", "H02 depth 6");
      return { value: { depth5: five, depth6: six.code } };
    });
    await vector("V53-WB-H05", () => {
      const freeze = fs.readFileSync(path.join(ROOT, "docs/rfcs/v0.51-final-architecture-freeze.md"), "utf8");
      const literal = (marker) => {
        const at = freeze.indexOf(marker);
        const begin = freeze.indexOf("```json\n", at) + 8;
        return freeze.slice(begin, freeze.indexOf("\n```", begin));
      };
      // (a) frozen DE01 with an added work_bound field
      const de01 = JSON.parse(literal("Example deny vector `DE01`"));
      assert.equal(reference.createFrozenDecisionEvidenceVector(de01).digest, "sha256:74a439506428651773946c8bb6cd4f64ee1d9ce9f68c0e47264a426aa897f165");
      assert.throws(() => reference.normalizeFrozenDecisionEvidenceVector({ ...de01, work_bound: numericBinding.record }), (error) => error.code === "air.v051.record_invalid");
      // (b) the M2 limits and the air.v052.work_limit_* codes as at 94001cd
      assert.deepEqual({ ...VERIFIED_TYPED_RUNTIME_LIMITS }, {
        maxAstNodes: 65536, maxCacheBytes: 67108864, maxCacheEntries: 64, maxConcurrentBuilds: 8, maxDescriptorBytes: 262144,
        maxInvocationLanes: 64, maxSourceBytes: 262144, maxSourceNameBytes: 1024, maxWasmBytes: 4194304, maxWatBytes: 4194304
      });
      const codes = new Set();
      for (const dir of ["src", "bin"]) {
        for (const name of fs.readdirSync(path.join(ROOT, dir))) {
          const file = path.join(ROOT, dir, name);
          if (!fs.statSync(file).isFile()) continue;
          for (const match of fs.readFileSync(file, "utf8").matchAll(/air\.v052\.work_limit_[a-z_]+/gu)) codes.add(match[0]);
        }
      }
      assert.deepEqual([...codes].sort(), ["ast_nodes", "cache_bytes", "concurrent_builds", "descriptor_bytes", "invocation_lanes", "source_bytes", "source_name_bytes", "wasm_bytes", "wat_bytes"].map((name) => `air.v052.work_limit_${name}`));
      // (c) deriveEffectiveAuthority has no WorkBound input; IC06 unchanged
      const frozen = runV051Reference();
      assert.equal(frozen.IC06, "PASS_limit");
      const intent = JSON.parse(literal("Requested `DecisionIntentV1` (1,166 UTF-8 bytes)"));
      const grants = JSON.parse(literal("The complete `SuppliedGrantSet` (2,396 UTF-8 bytes)"));
      const plainDerived = reference.canonical(reference.deriveEffectiveAuthority(intent, grants));
      const withWorkBound = reference.canonical(reference.deriveEffectiveAuthority(intent, grants, { workBound: numericBinding.record }));
      assert.equal(withWorkBound, plainDerived);
      return { value: { a: "air.v051.record_invalid", b: "unchanged", c: frozen.IC06 } };
    });
    await vector("V53-WB-H06", () => {
      const functions = [];
      for (let index = 0; index <= 61; index += 1) {
        functions.push({ body: index === 61 ? S({ steps: 1n }) : t.seq([t.call(`f${index + 1}`, loc(index * 3 + 2)), t.call(`f${index + 1}`, loc(index * 3 + 3))]), loc: loc(index * 3 + 1), name: `f${index}` });
      }
      const model = analyzeModel({ functions, module: "v53.vec" });
      assert.equal(model.status, "ok");
      const f0 = okSummary(model.functions.get("f0"), { calls: 4611686018427387902n, steps: 6917529027641081854n }, "H06 B(f0)");
      assert.equal(model.stats.functionSummaries, 62, "exactly 62 summary compositions");
      const deeper = [{ body: S({ steps: 1n }), loc: loc(500), name: "f62" }, ...functions.slice(0, 61), { body: t.seq([t.call("f62", loc(400)), t.call("f62", loc(401))]), loc: loc(399), name: "f61" }];
      const overflow = analyzeModel({ functions: deeper, module: "v53.vec" });
      assert.equal(overflow.status, "rejected");
      assert.equal(overflow.primary.code, "air.workbound.overflow");
      return { value: { depth62: overflow.primary.code, f0, summaries: model.stats.functionSummaries } };
    });
    await vector("V53-WB-H09", () => {
      assert.equal(parts["V53-WB-H09(ID-05)"], "PASS");
      assert.equal(parts["V53-WB-H09(ID-06)"], "PASS");
      return { value: { "ID-05": "PASS", "ID-06": "PASS", single_toolchain_identity_in_key: "compiler_implementation_digest" } };
    });

    // ------------------------------------------------------------------
    // Pipeline (§3.4).
    const emissionSource = EMISSION_SOURCE;
    assert.equal(sha256(Buffer.from(emissionSource, "utf8")), EMISSION_SHA256);
    assert.equal(Buffer.byteLength(emissionSource, "utf8"), 23772);
    await vector("V53-PIPE-01", async () => {
      const mod = typedModule(emissionSource, EMISSION_PATH);
      assert.throws(() => lowerToWat(mod, { maxWatBytes: 1048576 }), (error) => error.code === "air.v052.work_limit_wat_bytes");
      const runtime = createVerifiedTypedRuntime({ admit: async () => true, limits: { maxWatBytes: 1048576 } });
      await assert.rejects(() => runtime.build({ descriptor: EMISSION_DESCRIPTOR, source: emissionSource }),
        (error) => error.code === "air.v052.work_limit_wat_bytes" && ["V051TypedLoweringError", "V052VerifiedBuildError"].includes(error.name));
      return { value: { build: "BUILD_REFUSED air.v052.work_limit_wat_bytes", verify: "VERIFIED" }, sourceDigest: EMISSION_SHA256 };
    });
    await vector("V53-PIPE-02", () => {
      const dir = path.join(tmp, "pipe02");
      fs.mkdirSync(dir);
      fs.cpSync(path.join(ROOT, "src"), path.join(dir, "src"), { recursive: true });
      const outcome = runChild(dir, path.join(dir, "src"), { descriptor: NUMERIC_DESCRIPTOR, source: numericSource, sourceProfile: "typed-v0.51" },
        envWithout(["NODE_PATH"], { HOME: dir }));
      assert.equal(outcome.ok, false);
      assert.equal(outcome.code, "air.v052.toolchain_input_unavailable");
      assert.equal(outcome.name, "ToolchainIdentityError", "a stable AIR code, no raw error");
      return { value: { code: outcome.code, disposition: "ENVIRONMENT_UNAVAILABLE" }, sourceDigest: sha256(numericSource) };
    });

    // ------------------------------------------------------------------
    // No analysis term in WorkBound (V53-ANA-07).
    await vector("V53-ANA-07", async () => {
      assert.deepEqual([...wb.FAILURE_REASONS], ["overflow", "unknown_bound", "invalid_bound", "missing_summary", "recursion"]);
      const codes = [...Object.values(wb.FAILURE_CODES), wb.IDENTITY_MISMATCH_CODE, wb.COST_UNDEFINED_CODE];
      assert.equal(codes.some((code) => /analysis|capacity/u.test(code)), false);
      assert.deepEqual([...wb.KEY_FIELDS], ["body_digest", "compiler_implementation_digest", "cost_table", "cost_table_digest", "dependencies", "profile"]);
      assert.deepEqual([...wb.RECORD_FIELDS], ["entries", "key", "schema"]);
      assert.deepEqual([...wb.SUMMARY_FIELDS], ["calls", "effects", "iterations", "steps"]);
      const withdrawn = ["air", "workbound", "analysis_limit_exceeded"].join(".");
      for (const dir of ["src", "bin"]) {
        for (const name of fs.readdirSync(path.join(ROOT, dir))) {
          const file = path.join(ROOT, dir, name);
          if (fs.statSync(file).isFile()) assert.equal(fs.readFileSync(file, "utf8").includes(withdrawn), false, `${dir}/${name}`);
        }
      }
      const source = numericSource;
      const lowered = {
        maxAstNodes: 4096, maxDescriptorBytes: 4096, maxSourceBytes: Buffer.byteLength(source, "utf8"), maxWasmBytes: 65536, maxWatBytes: 65536
      };
      const runtime = createVerifiedTypedRuntime({ admit: async () => true, limits: lowered });
      const handle = await runtime.build({ descriptor: NUMERIC_DESCRIPTOR, source });
      const lowHost = wb.inspectBoundWorkBound(handle);
      for (const field of Object.keys(lowHost.key)) assert(wb.KEY_FIELDS.includes(field));
      const identity = assertRecordsByteIdentical(numericBinding, lowHost, "ANA-07 default vs lowered intake");
      return { value: { intake_settings: ["VERIFIED_TYPED_RUNTIME_LIMITS", lowered], ...identity } };
    });

    // ------------------------------------------------------------------
    // Required separations.
    await vector("V53-SEP-WB-01", async () => {
      const frozen = runV051Reference();
      const dispositions = { IC08: frozen.IC08, IC19: frozen.IC19, IC20: frozen.IC20, IC21: frozen.IC21 };
      assert.deepEqual(dispositions, { IC08: "PASS_deny_budget_exceeded", IC19: "PASS_deny_invalid_intent", IC20: "PASS_deny_grant_scope_mismatch", IC21: "PASS_deny_invalid_intent" });
      const freeze = fs.readFileSync(path.join(ROOT, "docs/rfcs/v0.51-final-architecture-freeze.md"), "utf8");
      const literal = (marker) => {
        const at = freeze.indexOf(marker);
        const begin = freeze.indexOf("```json\n", at) + 8;
        return freeze.slice(begin, freeze.indexOf("\n```", begin));
      };
      const intent = JSON.parse(literal("Requested `DecisionIntentV1` (1,166 UTF-8 bytes)"));
      const grants = JSON.parse(literal("The complete `SuppliedGrantSet` (2,396 UTF-8 bytes)"));
      const workBound = numericBinding.record.entries.checked_add;
      // a WorkBound summary presented as an operations Budget (discriminant 2)
      const asBudget = JSON.parse(JSON.stringify(intent));
      asBudget.intent.budgets[0] = workBound;
      assert.deepEqual(reference.deriveEffectiveAuthority(asBudget, grants).reason, "invalid_intent");
      // a WorkBound record presented inside a grant
      const asGrant = JSON.parse(JSON.stringify(grants));
      asGrant.grants[0].work_bound = numericBinding.record;
      assert.deepEqual(reference.deriveEffectiveAuthority(intent, asGrant).reason, "invalid_intent");
      // runtime admission requests carry no WorkBound field
      const requests = [];
      const runtime = createVerifiedTypedRuntime({ admit: async (request) => { requests.push(Object.keys(request).sort().join(",")); return true; } });
      const handle = await runtime.build({ descriptor: NUMERIC_DESCRIPTOR, source: numericSource });
      await runtime.invoke(handle, "checked_add", [{ decimal: "1", type: "i64" }, { decimal: "1", type: "i64" }]);
      assert.deepEqual([...new Set(requests)], ["artifactDigest,compilerImplementationDigest,descriptorDigest,phase,sourceDigest,sourceProfile"]);
      for (const consumer of ["src/v051_reference.js", "src/run_package.js", "src/verifier.js", "src/lower_wasm.js"]) {
        assert.equal(/require\(["']\.\/workbound["']\)/u.test(fs.readFileSync(path.join(ROOT, consumer), "utf8")), false, `${consumer} must not read WorkBound`);
      }
      assert.equal(Object.keys(wb).some((name) => /budget|grant|admi/iu.test(name)), false, "no WorkBound-to-Budget/grant API");
      return { value: { budget_codec: "invalid_intent", dispositions, grant_codec: "invalid_intent" } };
    });
    await vector("V53-SEP-WB-02", () => {
      const dir = path.join(tmp, "sep02");
      fs.mkdirSync(dir);
      const preload = path.join(dir, "clock_shift.js");
      fs.writeFileSync(preload, CLOCK_SHIFT);
      const input = { descriptor: NUMERIC_DESCRIPTOR, source: numericSource };
      const normal = runChild(dir, path.join(ROOT, "src"), input, process.env);
      const shifted = runChild(dir, path.join(ROOT, "src"), input, process.env, ["--require", preload]);
      assert.equal(normal.ok && shifted.ok, true);
      const identity = assertRecordsByteIdentical(normal, shifted, "SEP-WB-02 two processes, shifted clock");
      const text = fs.readFileSync(path.join(ROOT, "src", "workbound.js"), "utf8");
      assert.equal(/\bDate\b|performance\.now|hrtime|setTimeout|setInterval/u.test(text), false, "the summarizer reads no clock");
      return { value: identity };
    });
    await vector("V53-SEP-DE-01", () => {
      const frozen = runV051Reference();
      assert.equal(frozen.DE01, "PASS");
      assert.match(frozen.RECEIPT_BINDING, /^PASS/u);
      assert.equal(reference.DOMAINS.decisionEvidence, "AIR_DECISION_EVIDENCE_V1");
      assert.equal(reference.DOMAINS.effectReceipt, "AIR_EFFECT_RECEIPT_V1");
      const domains = Object.values(reference.DOMAINS);
      assert.equal(new Set(domains).size, domains.length);
      for (const domain of [wb.SUMMARY_DOMAIN, wb.COST_TABLE_DOMAIN]) assert.equal(domains.includes(domain), false);
      return { value: { DE01: frozen.DE01, RECEIPT_BINDING: frozen.RECEIPT_BINDING } };
    });

    // ------------------------------------------------------------------
    // Composite V53-WB-H01..H10 parts run here; composites owned later stay DEFERRED.
    await vector("V53-WB-H10-EMISSION/typed-v0.51", async () => {
      const mod = typedModule(emissionSource, EMISSION_PATH);
      const analysis = wb.analyzeVerifiedTypedModule(mod);
      assert.equal(analysis.status, "ok");
      const run = okSummary(analysis.entries.get("run"), { steps: 1n }, "E(run)");
      const bodyRun = okSummary(analysis.functions.get("run"), { steps: 1n }, "B(run)");
      const hidden = okSummary(analysis.functions.get("hidden"), { steps: 1n }, "B(hidden)");
      assert.equal(analysis.entries.has("hidden"), false, "hidden is not exported");
      assert.equal(BigInt(run.steps) - BigInt(bodyRun.steps), 0n, "ingress(run) = 0");
      // H53 §B: P0_02_BUILD_PASS_CRITERION=false; builds attempted only with
      // explicit accepted limits, each must end in an artifact or a bounded
      // BUILD_REFUSED, never a raw host exception.
      const builds = {};
      assert.throws(() => lowerToWat(mod, { maxWatBytes: VERIFIED_TYPED_RUNTIME_LIMITS.maxWatBytes }), (error) => error.code === "air.v052.work_limit_wat_bytes");
      builds.lowerToWat_with_limits = "BUILD_REFUSED air.v052.work_limit_wat_bytes";
      await assert.rejects(() => buildVerifiedTypedModule({ descriptor: EMISSION_DESCRIPTOR, source: emissionSource }), (error) => error.code === "air.v052.work_limit_wat_bytes");
      builds.sdk_builder = "BUILD_REFUSED air.v052.work_limit_wat_bytes";
      await assert.rejects(() => createVerifiedTypedRuntime({ admit: async () => true }).build({ descriptor: EMISSION_DESCRIPTOR, source: emissionSource }),
        (error) => error.code === "air.v052.work_limit_wat_bytes");
      builds.runtime = "BUILD_REFUSED air.v052.work_limit_wat_bytes";
      const emissionFile = path.join(tmp, EMISSION_PATH);
      fs.writeFileSync(emissionFile, emissionSource);
      const cli = childProcess.spawnSync(process.execPath, [path.join(ROOT, "bin", "airc.js"), "build", emissionFile,
        "--source-profile", "typed-v0.51", "--emit", "wat", "-o", path.join(tmp, "h10_emission.wat")], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
      assert.notEqual(cli.status, 0);
      assert.match(cli.stderr, /air\.v052\.work_limit_wat_bytes/u);
      assert.equal(/\n\s+at /u.test(cli.stderr), false, "no raw stack trace");
      assert.equal(fs.existsSync(path.join(tmp, "h10_emission.wat")), false);
      builds.cli_build = "BUILD_REFUSED air.v052.work_limit_wat_bytes";
      parts["V53-WB-H10(EMISSION typed-v0.51)"] = "PASS";
      return { value: { B_hidden: hidden, E_run: run, builds_attempted_not_pass_criteria: builds, ingress_run: "0", verify: "VERIFIED" }, sourceDigest: EMISSION_SHA256 };
    });
    await vector("V53-WB-H10-INGRESS/typed-v0.51", () => {
      const source = INGRESS_SOURCE;
      assert.equal(sha256(Buffer.from(source, "utf8")), INGRESS_SHA256);
      assert.equal(Buffer.byteLength(source, "utf8"), 23738);
      const mod = typedModule(source, INGRESS_PATH);
      const analysis = wb.analyzeVerifiedTypedModule(mod);
      assert.equal(analysis.status, "ok");
      const body = okSummary(analysis.functions.get("wide"), { steps: 1n }, "B(wide)");
      const entry = okSummary(analysis.entries.get("wide"), { steps: 1000001n }, "E(wide)");
      assert.equal(BigInt(entry.steps) - BigInt(body.steps), 1000000n, "ingress(wide)");
      parts["V53-WB-H10(INGRESS typed-v0.51)"] = "PASS";
      return { value: { B_wide: body, E_wide: entry, ingress_wide: "1000000", verify: "VERIFIED" }, sourceDigest: INGRESS_SHA256 };
    });

    // ------------------------------------------------------------------
    // Deferred ledger (PF-1): never PASS, never skipped.
    results.push(resultRecord("V53-WB-H04", "DEFERRED", { first_executable_slice: "SCALAR", parts: { "(a) = V53-WB-ID-02 @ P0-02": parts["V53-WB-H04(a)"] || "FAIL", "(b) = V53-ASSUR-01 @ SCALAR": "NOT_RUN" } }));
    results.push(resultRecord("V53-WB-H10", "DEFERRED", {
      first_executable_slice: "SCALAR",
      parts: {
        "EMISSION typed-v0.51 @ P0-02 (verify + summary; builds attempted with explicit limits)": parts["V53-WB-H10(EMISSION typed-v0.51)"] || "FAIL",
        "INGRESS typed-v0.51 @ P0-02 (verify + summary)": parts["V53-WB-H10(INGRESS typed-v0.51)"] || "FAIL",
        "EMISSION typed-v0.53 @ SCALAR": "NOT_RUN",
        "INGRESS typed-v0.53 @ SCALAR": "NOT_RUN"
      }
    }));
    results.push(resultRecord("V53-WB-H01", "DEFERRED", { first_executable_slice: "P0-10", owning_slice: "P0-05", parts: { "(a) = V53-WB-P04 @ P0-02": parts["V53-WB-H01(a)"] || "FAIL", "(b) = V53-LOOP-P05 @ P0-10": "NOT_RUN", "(c) = V53-CFG-N02 @ P0-04": "NOT_RUN" } }));

    // ------------------------------------------------------------------
    // Documented CT-1 application readings and RFC-derived properties. These
    // are NOT catalogue vectors; their values follow the readings recorded in
    // docs/v0.53/P0_02_WORKBOUND_FOUNDATION.md and are kept apart from the
    // vector results so that QA can challenge each reading on its own.
    const readings = [];
    const reading = (id, action) => {
      try { readings.push({ id, status: "PASS", value: plain(action()) }); } catch (error) {
        failures.push(`${id}: ${error && error.stack || error}`);
        readings.push({ id, status: "FAIL", value: String(error && error.message || error) });
      }
    };
    const entrySteps = (source, name) => {
      const analysis = wb.analyzeVerifiedTypedModule(typedModule(source, `${name}.air`));
      assert.equal(analysis.status, "ok");
      return { B: wb.canonicalSummary(analysis.functions.get("f").value).steps, E: wb.canonicalSummary(analysis.entries.get("f").value).steps };
    };
    reading("RD-1 empty statement list is the ⊕ identity", () => {
      const value = entrySteps("module v53.rd\nexport func f() -> void {\n}\n", "rd1");
      assert.deepEqual(value, { B: "0", E: "0" });
      return value;
    });
    reading("RD-2 / owner RD-3=2: constructor return charges constructor + return", () => {
      const value = entrySteps("module v53.rd\nexport func f(a: i32) -> option<i32> {\nreturn option.some<i32> %a\n}\n", "rd2");
      assert.deepEqual(value, { B: "2", E: "2" });
      return value;
    });
    reading("RD-3 a constructor statement is one statement.constructor row", () => {
      const value = entrySteps("module v53.rd\nexport func f(a: i32) -> option<i32> {\n%o: option<i32> = option.some<i32> %a\nreturn %o\n}\n", "rd3");
      assert.deepEqual(value, { B: "2", E: "2" });
      return value;
    });
    reading("RD-4 a literal entering a refined local and a refined return", () => {
      const local = entrySteps("module v53.rd\nexport func f() -> i32<0..10> {\n%x: i32<0..10> = 5\nreturn %x\n}\n", "rd4a");
      const ret = entrySteps("module v53.rd\nexport func f() -> i32<0..10> {\nreturn 5\n}\n", "rd4b");
      assert.deepEqual(local, { B: "3", E: "3" });
      assert.deepEqual(ret, { B: "2", E: "2" });
      return { local, ret };
    });
    reading("RD-5 a literal match arm yielding into a refined destination", () => {
      const value = entrySteps("module v53.rd\nenum E {\nA = 0,\nB = 1,\n}\nexport func f(e: E) -> i32<0..10> {\n%o: i32<0..10> = match %e {\nE.A => 1,\nE.B => 2,\n}\nreturn %o\n}\n", "rd5");
      assert.deepEqual(value, { B: "5", E: "7" });
      return value;
    });
    reading("RD-6 a refined parameter: ingress 1, no check on an identical-type reference", () => {
      const value = entrySteps("module v53.rd\nexport func f(a: i32<0..10>) -> i32<0..10> {\nreturn %a\n}\n", "rd6");
      assert.deepEqual(value, { B: "1", E: "2" });
      return value;
    });
    reading("RD-7 §6.6 invalid_bound: LOOP_MAX 4096 and non-integer counts", () => {
      okSummary(evaluate(t.loop(4096n, S({ steps: 1n }))).result, { iterations: 4096n, steps: 8193n }, "LOOP_MAX");
      failed(evaluate(t.loop(4097n, S({ steps: 1n }))).result, "air.workbound.invalid_bound", "LOOP_MAX + 1");
      failed(evaluate(t.loop("1.5", S({ steps: 1n }))).result, "air.workbound.invalid_bound", "non-integer");
      return { "4096": "ok", "4097": "air.workbound.invalid_bound", "1.5": "air.workbound.invalid_bound" };
    });
    reading("RD-8 R-WB-15b: no host recursion proportional to the input", () => {
      const statements = Array.from({ length: 200000 }, () => S({ steps: 1n }));
      okSummary(evaluate(t.seq(statements)).result, { steps: 200000n }, "200000-statement chain");
      const functions = Array.from({ length: 5000 }, (_, index) => ({
        body: index === 4999 ? S({ steps: 1n }) : t.call(`f${index + 1}`, loc(index + 1)), loc: loc(index + 1), name: `f${index}`
      }));
      const model = analyzeModel({ functions, module: "v53.deep" });
      okSummary(model.functions.get("f0"), { calls: 4999n, steps: 5000n }, "5000-deep call chain");
      assert.equal(model.stats.functionSummaries, 5000);
      return { call_chain: 5000, sequence: 200000 };
    });

    // ------------------------------------------------------------------
    // F1/RD-3 correction cases, separate from the unchanged frozen catalogue.
    // Arithmetic values are explicit examples; integer operands use BigInt.
    // Every numeric case has one scalar row + one return row = 2, in either
    // direct or SSA form. No expected value is read from WorkBound output.
    const i64Pair = [{ name: "x", type: "i64" }, { name: "y", type: "i64" }];
    const i64Single = [{ name: "x", type: "i64" }];
    const numericCases = [
      ["ADD", "i64.checked_add %x, %y", "i64", i64Pair, [40n, 2n], 42n],
      ["SUB", "i64.checked_sub %x, %y", "i64", i64Pair, [40n, 2n], 38n],
      ["MUL", "i64.checked_mul %x, %y", "i64", i64Pair, [40n, 2n], 80n],
      ["DIV", "i64.checked_div_s %x, %y", "i64", i64Pair, [40n, 2n], 20n],
      ["REM", "i64.checked_rem_s %x, %y", "i64", i64Pair, [40n, 2n], 0n],
      ["NEG", "i64.checked_neg %x", "i64", i64Single, [40n], -40n],
      ["EQ", "i64.eq %x, %y", "bool", i64Pair, [40n, 2n], 0],
      ["NE", "i64.ne %x, %y", "bool", i64Pair, [40n, 2n], 1],
      ["LT", "i64.lt_s %x, %y", "bool", i64Pair, [40n, 2n], 0],
      ["LE", "i64.le_s %x, %y", "bool", i64Pair, [40n, 2n], 0],
      ["GT", "i64.gt_s %x, %y", "bool", i64Pair, [40n, 2n], 1],
      ["GE", "i64.ge_s %x, %y", "bool", i64Pair, [40n, 2n], 1],
      ["NARROW_I64", "i64.to_i32_checked %x", "i32", i64Single, [40n], 40],
      ["WIDEN_I32", "i32.to_i64 %x", "i64", [{ name: "x", type: "i32" }], [7], 7n],
      ["WIDEN_F32", "f32.to_f64 %x", "f64", [{ name: "x", type: "f32" }], [1.5], 1.5],
      ["NARROW_F64", "f64.to_f32_checked %x", "f32", [{ name: "x", type: "f64" }], [1.5], 1.5]
    ];
    for (const [id, expression, returnType, params, args, value] of numericCases) {
      const wanted = { B: "2", E: "2", bound_E: "2", result: plain(value) };
      await correction(`P002-F1-${id}`, { direct: wanted, ssa: wanted }, async () => ({
        direct: await compiledCorrection(`return ${expression}`, params, returnType, args),
        ssa: await compiledCorrection(`%o: ${returnType} = ${expression}\nreturn %o`, params, returnType, args)
      }));
    }
    const refinedForm = async (body) => {
      const source = `module wb.correction\nexport func f(x: i64) -> i32<0..100> {\n${body}\n}\n`;
      const mod = typedModule(source, "refined-return.air");
      const analysis = wb.analyzeVerifiedTypedModule(mod);
      assert.equal(analysis.status, "ok");
      const descriptor = {
        air_abi_lane: "0.12", module_id: "wb.correction", schema: "air.typed-interface/0.12-candidate.1", types: [],
        exports: [{ function: "f", name: "f", parameters: i64Single, return_type: "i32" }]
      };
      // The frozen builder compares source and descriptor types exactly; do
      // not add refinement descriptor erasure as part of this correction.
      await assert.rejects(() => buildVerifiedTypedModule({ source, descriptor }),
        (error) => error.code === "air.v051.typed_interface_source_invalid");
      const bytes = await watToWasm(lowerToWat(mod, { maxWatBytes: VERIFIED_TYPED_RUNTIME_LIMITS.maxWatBytes }), "refined-return.air");
      const { instance } = await WebAssembly.instantiate(bytes, {});
      const value = instance.exports.f(40n);
      assert.throws(() => instance.exports.f(101n), WebAssembly.RuntimeError);
      return {
        B: analysis.functions.get("f").value.steps.toString(), E: analysis.entries.get("f").value.steps.toString(),
        result: value, verified_builder: "air.v051.typed_interface_source_invalid"
      };
    };
    const refinedExpected = { B: "3", E: "3", result: 40, verified_builder: "air.v051.typed_interface_source_invalid" };
    await correction("P002-F1-REFINED_RETURN", { direct: refinedExpected, ssa: refinedExpected }, async () => ({
      direct: await refinedForm("return i64.to_i32_checked %x"),
      ssa: await refinedForm("%o: i32<0..100> = i64.to_i32_checked %x\nreturn %o")
    }));
    await correction("P002-F1-LITERAL_RETURN", { B: "1", E: "1", bound_E: "1", result: "9007199254740993" },
      () => compiledCorrection("return const.i64 9007199254740993", [], "i64", []));
    await correction("P002-F1-REFERENCE_RETURN", { B: "1", E: "1", bound_E: "1", result: "9007199254740993" },
      () => compiledCorrection("return %x", i64Single, "i64", [9007199254740993n]));

    const errorContext = {
      declarations: "error enum ParseError {\ninvalid = 7,\n}\n",
      types: [{ kind: "error_enum", type_id: "wb.correction::ParseError", cases: [{ discriminant: 7, name: "invalid" }] }]
    };
    const constructorCases = [
      ["NONE", "option.none<i32>", "option<i32>", "option<i32>", [0, 0]],
      ["SOME", "option.some<i32> %a", "option<i32>", "option<i32>", [1, 7]],
      ["OK", "result.ok<i32,ParseError> %a", "result<i32,ParseError>", "result<i32,wb.correction::ParseError>", [0, 7, 0]],
      ["ERR", "result.err<i32,ParseError> ParseError.invalid", "result<i32,ParseError>", "result<i32,wb.correction::ParseError>", [1, 0, 7]]
    ];
    for (const [id, expression, returnType, descriptorReturnType, value] of constructorCases) {
      const wanted = { B: "2", E: "2", bound_E: "2", result: value };
      const context = returnType.startsWith("result") ? { ...errorContext, descriptorReturnType } : {};
      const params = [{ name: "a", type: "i32" }];
      await correction(`P002-RD3-${id}`, { direct: wanted, ssa: wanted }, async () => ({
        direct: await compiledCorrection(`return ${expression}`, params, returnType, [7], context),
        ssa: await compiledCorrection(`%o: ${returnType} = ${expression}\nreturn %o`, params, returnType, [7], context)
      }));
    }
    // 2 enum ingress + 3 dispatch + max(0, 0) + 1 return = 6. The explicit
    // zero-cost constructor atom-arm exemption must survive RD-3.
    const enumContext = {
      declarations: "enum E {\na = 0,\nb = 1,\n}\n",
      types: [{ kind: "enum", type_id: "wb.correction::E", cases: [{ discriminant: 0, name: "a" }, { discriminant: 1, name: "b" }] }]
    };
    const armParams = [{ name: "e", type: "wb.correction::E" }, { name: "a", type: "i32" }];
    const atomArmBody = "%o: option<i32> = match %e {\nE.a => option.some<i32> %a,\nE.b => option.none<i32>,\n}\nreturn %o";
    await correction("P002-RD3-CONSTRUCTOR_ARMS", {
      some: { B: "4", E: "6", bound_E: "6", result: [1, 7] },
      none: { B: "4", E: "6", bound_E: "6", result: [0, 0] }
    }, async () => ({
      some: await compiledCorrection(atomArmBody, armParams, "option<i32>", [0, 7], enumContext),
      none: await compiledCorrection(atomArmBody, armParams, "option<i32>", [1, 7], enumContext)
    }));

    // Operation arms verify but still do not lower in the frozen profile. Do
    // not widen that grammar/runtime surface to make these accounting tests pass.
    for (const [id, destination, armA, armB, B, E] of [
      ["MIXED_ARM", "i64", "i64.checked_add %x, %y", "%x", "5", "7"],
      ["TWO_OPERATION_ARMS", "i64", "i64.checked_add %x, %y", "i64.checked_sub %x, %y", "5", "7"],
      ["REFINED_ARM", "i32<0..10>", "i64.to_i32_checked %x", "1", "6", "8"]
    ]) {
      const source = `module wb.correction\n${enumContext.declarations}export func f(e: E, x: i64, y: i64) -> ${destination} {\n%o: ${destination} = match %e {\nE.a => ${armA},\nE.b => ${armB},\n}\nreturn %o\n}\n`;
      const buildFailure = destination.startsWith("i32") ? "air.v051.typed_interface_source_invalid" : "air.v052.verified_build_emission_failure";
      await correction(`P002-F1-${id}`, { B, E, build: buildFailure }, async () => {
        const analysis = wb.analyzeVerifiedTypedModule(typedModule(source, `${id}.air`));
        assert.equal(analysis.status, "ok");
        const descriptor = {
          air_abi_lane: "0.12", module_id: "wb.correction", schema: "air.typed-interface/0.12-candidate.1", types: enumContext.types,
          exports: [{ function: "f", name: "f", parameters: [{ name: "e", type: "wb.correction::E" }, ...i64Pair], return_type: destination.startsWith("i32") ? "i32" : destination }]
        };
        await assert.rejects(() => buildVerifiedTypedModule({ source, descriptor }),
          (error) => error.code === buildFailure);
        return { B: analysis.functions.get("f").value.steps.toString(), E: analysis.entries.get("f").value.steps.toString(), build: buildFailure };
      });
    }
    await correction("P002-F1-UNKNOWN_EXPRESSION", { code: "air.workbound.cost_undefined", disposition: "IMPLEMENTATION_DEFECT" }, () => {
      const mod = typedModule("module wb.correction\nexport func f() -> i64 {\nreturn 1\n}\n", "unknown-expression.air");
      mod.functions[0].statements[0].value = { kind: "unmodelled_expression" };
      let actual;
      assert.throws(() => wb.analyzeVerifiedTypedModule(mod), (error) => {
        actual = { code: error.code, disposition: error.disposition };
        return error.code === "air.workbound.cost_undefined";
      });
      return actual;
    });
    // Existing fixture: 2 Action ingress + 3 match dispatch + 2 constructor
    // return = 7. Its source/Wasm is unchanged, only the RD-3 summary changes.
    await correction("P002-RD3-OPS_POLICY", { decide: "7", roundtrip_sequence: "1" }, () => {
      const analysis = wb.analyzeVerifiedTypedModule(typedModule(readFixture("fixtures/v052/verified_build/ops_policy.air"), "ops_policy.air"));
      assert.equal(analysis.status, "ok");
      return Object.fromEntries([...analysis.entries].map(([name, value]) => [name, value.value.steps.toString()]));
    });
    await correction("P002-RD3-COST_TABLE_REVISION", { revision: "P0-02-F1-RD3", prior_digest_reused: false }, () => ({
      revision: ctTable.revision,
      prior_digest_reused: wb.COST_TABLE_DIGEST === "sha256:fca8c3db1c12077748e77e40c28324343cc851af79ea806ce34ecd18973768b5"
    }));

    // ------------------------------------------------------------------
    // Corpus: every repository source that verifies as typed-v0.51 has a
    // finite summary, and no real construct reaches the cost_undefined guard.
    const corpus = [];
    const stack = ["fixtures", "examples", "test/fixtures"];
    while (stack.length) {
      const relative = stack.pop();
      for (const entry of fs.readdirSync(path.join(ROOT, relative), { withFileTypes: true })) {
        const child = `${relative}/${entry.name}`;
        if (entry.isDirectory()) { if (entry.name !== "node_modules") stack.push(child); continue; }
        if (!entry.name.endsWith(".air")) continue;
        let mod;
        try { mod = typedModule(readFixture(child), child); } catch (_) { continue; }
        const analysis = wb.analyzeVerifiedTypedModule(mod);
        assert.equal(analysis.status, "ok", child);
        corpus.push(child);
      }
    }
    assert(corpus.length >= 8, `typed-v0.51 corpus too small: ${corpus.length}`);

    const passed = results.filter((item) => item.status === "PASS" || item.status === "PASS_BY_COMMAND_LOGS").length;
    const deferred = results.filter((item) => item.status === "DEFERRED").map((item) => item.vector);
    if (process.env.AIR_P0_02_VECTOR_RESULTS) {
      fs.writeFileSync(process.env.AIR_P0_02_VECTOR_RESULTS, `${JSON.stringify({
        cost_table_digest: wb.COST_TABLE_DIGEST,
        ct1_file_sha256: wb.COST_TABLE_FILE_SHA256,
        correction_results: correctionResults,
        readings,
        results: results.map((item) => JSON.parse(canonicalJson(item))),
        typed_v051_corpus: corpus.sort()
      }, null, 2)}\n`);
    }
    if (failures.length) {
      console.error(failures.join("\n\n"));
      process.exitCode = 1;
      return;
    }
    console.log(JSON.stringify({
      cost_table_digest: wb.COST_TABLE_DIGEST,
      correction_cases: correctionResults.length,
      correction_passed: correctionResults.filter((item) => item.PASS).length,
      deferred,
      passed,
      readings: readings.length,
      status: "PASS",
      typed_v051_corpus_summarised: corpus.length,
      vectors: results.length
    }));
  } finally {
    fs.rmSync(tmp, { force: true, recursive: true });
  }
})().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
