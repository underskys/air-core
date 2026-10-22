#!/usr/bin/env node
"use strict";

// typed-v0.53 SCALAR slice (AIR-0053-P0-SCALAR-0001): the R-WB-15c analysis
// capacity guard and R3-N1. Expected values are copied from R3.1 VECTORS.md
// (V53-ANA-01..03, -06, as amended by AMD-9) and from the admitted slice text's
// VECTORS_ADDITIONS.md (V53-ANA-09..13), never from the implementation under
// test. The measures use the R3.1 R-WB-15c formula, unchanged under
// R3_N2_CHOICE=A (formula version recorded with every measure).
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
const { measureTypedModule } = require("../src/analysis_capacity");
const { buildVerifiedTypedModule, createVerifiedTypedRuntime } = require("../src/v052_verified_build");

const ROOT = path.resolve(__dirname, "..");
const V053 = "typed-v0.53";
const GATED = Object.freeze({ allowCandidateProfile: true, sourceProfile: V053 });
const FORMULA = "R3.1 R-WB-15c (analysis_units, nesting_depth); unchanged under R3_N2_CHOICE=A";
const COST_TABLE_DIGEST = "sha256:1ae0cddb2b01ca1f16f5b8da059ebd0a594d8c222aea4e5bf8f5e2c6d17e80c9";
const ANA01_SOURCE = "module v53.ana\nexport func f(a: i32, b: i32) -> i32 {\n%o: i32 = i32.checked_add %a, %b\nreturn %o\n}\n";
const ANA01_DESCRIPTOR = Object.freeze({
  air_abi_lane: "0.12", module_id: "v53.ana", schema: "air.typed-interface/0.12-candidate.1", types: [],
  exports: [{ function: "f", name: "f", parameters: [{ name: "a", type: "i32" }, { name: "b", type: "i32" }], return_type: "i32" }]
});
const results = [];
const failures = [];
const measures = {};

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

function capture(action) {
  try {
    action();
  } catch (error) {
    return error;
  }
  return null;
}

function measured(label, mod) {
  const value = measureTypedModule(mod);
  measures[label] = { formula: FORMULA, analysis_units: value.analysis_units, nesting_depth: value.nesting_depth };
  return value;
}

function assertAnalysisRefused(error, measure, required, capacity) {
  assert(error, "expected ANALYSIS_REFUSED");
  assert.equal(error.code, "air.analysis.capacity_exceeded");
  assert.equal(error.disposition, "ANALYSIS_REFUSED", "never STATIC_REJECT");
  assert.notEqual(error.name, "VerificationError");
  assert.deepEqual({ capacity: error.capacity, measure: error.measure, required: error.required }, { capacity, measure, required });
  return { capacity, code: error.code, disposition: error.disposition, measure, required };
}

// V53-ANA-09 generator nest(k) (VECTORS_ADDITIONS.md): k nested value `if`, unindented, LF.
function nest(k) {
  const lines = ["module v53.ana", "export func f(c: bool) -> i32 {"];
  for (let i = 0; i < k; i += 1) lines.push(`%r${i}: i32 = if %c {`);
  lines.push("yield 1");
  for (let i = k - 1; i >= 0; i -= 1) {
    lines.push("} else {", "yield 0", "}");
    if (i > 0) lines.push(`yield %r${i}`);
  }
  lines.push("return %r0", "}");
  return `${lines.join("\n")}\n`;
}

const CHILD_SCRIPT = `"use strict";
const path = require("path");
const src = process.argv[2];
const input = JSON.parse(require("fs").readFileSync(process.argv[3], "utf8"));
const { buildVerifiedTypedModule, invokeVerifiedTypedExport } = require(path.join(src, "v052_verified_build.js"));
const { inspectBoundWorkBound } = require(path.join(src, "workbound.js"));
buildVerifiedTypedModule(input).then(async (build) => {
  const bound = inspectBoundWorkBound(build);
  const value = (await invokeVerifiedTypedExport(build, "f", [2, 3])).value;
  process.stdout.write(JSON.stringify({ ok: true, compiler: build.compiler.implementationDigest, key: bound.key, record: bound.record, recordBytes: bound.recordBytes, recordDigest: bound.recordDigest, value }));
}, (error) => process.stdout.write(JSON.stringify({ ok: false, code: error && error.code || null, message: String(error && error.message) })));
`;

function runChild(dir, srcDir, input) {
  const script = path.join(dir, "child.js");
  const inputFile = path.join(dir, `input-${crypto.randomBytes(4).toString("hex")}.json`);
  fs.writeFileSync(script, CHILD_SCRIPT);
  fs.writeFileSync(inputFile, JSON.stringify(input));
  const out = childProcess.spawnSync(process.execPath, [script, srcDir, inputFile], {
    cwd: dir, encoding: "utf8", env: { ...process.env, NODE_PATH: path.join(ROOT, "node_modules") }, maxBuffer: 16 * 1024 * 1024
  });
  assert.equal(out.status, 0, out.stderr);
  return JSON.parse(out.stdout);
}

function runCli(args) {
  return childProcess.spawnSync(process.execPath, [path.join(ROOT, "bin", "airc.js"), ...args], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "air-v053-capacity-"));
  try {
    const host = (capacity) => createVerifiedTypedRuntime({ admit: async () => true, ...(capacity ? { analysisCapacity: capacity } : {}) });
    const buildOn = async (runtime) => {
      const handle = await runtime.build({ ...GATED, descriptor: ANA01_DESCRIPTOR, source: ANA01_SOURCE });
      return { bound: wb.inspectBoundWorkBound(handle), value: (await runtime.invoke(handle, "f", [2, 3])).value };
    };
    let ana01Record;

    await vector("V53-ANA-01", async () => {
      const mod = sp.parseSource(ANA01_SOURCE, "ana01.air", { ...GATED, analysisCapacity: { maxAnalysisUnits: 5 } });
      const m = measured("V53-ANA-01", mod);
      assert.equal(m.analysis_units, 4, "1 module + 1 declaration + 2 statements");
      assert.equal(m.nesting_depth, 1);
      sp.verifySource(mod, { ...GATED, analysisCapacity: { maxAnalysisUnits: 5 } });
      const { bound, value } = await buildOn(host({ maxAnalysisUnits: 5 }));
      assert.equal(value, 5, "f(2,3) = 5");
      assert.deepEqual(bound.record.entries.f, wb.canonicalSummary(wb.summary({ steps: 2n })), "E(f) = S{steps:2}");
      ana01Record = bound;
      return { value: { E_f: bound.record.entries.f, analysis_units: 4, f_2_3: value, nesting_depth: 1 }, sourceDigest: sha256(ANA01_SOURCE) };
    });
    await vector("V53-ANA-02", async () => {
      const { bound } = await buildOn(host({ maxAnalysisUnits: 4 }));
      assert.equal(bound.key.compiler_implementation_digest, ana01Record.key.compiler_implementation_digest);
      assert.equal(bound.key.cost_table_digest, ana01Record.key.cost_table_digest);
      assert.equal(bound.recordBytes, ana01Record.recordBytes, "the summary record is byte-identical to V53-ANA-01");
      measures["V53-ANA-02"] = { ...measures["V53-ANA-01"], capacity: 4 };
      return { value: { capacity: 4, record_digest: bound.recordDigest, verdict: "VERIFIED" } };
    });
    await vector("V53-ANA-03", async () => {
      const parse = capture(() => sp.parseSource(ANA01_SOURCE, "ana03.air", { ...GATED, analysisCapacity: { maxAnalysisUnits: 3 } }));
      const refusal = assertAnalysisRefused(parse, "analysis_units", 4, 3);
      // Before any phase-S analysis: an AST entrypoint refuses before verification.
      const ast = sp.parseSource(ANA01_SOURCE, "ana03.air", GATED);
      assertAnalysisRefused(capture(() => sp.verifySource(ast, { ...GATED, analysisCapacity: { maxAnalysisUnits: 3 } })), "analysis_units", 4, 3);
      // No WorkBound evidence and nothing cached as a rejection.
      const runtime = host({ maxAnalysisUnits: 3 });
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const error = await runtime.build({ ...GATED, descriptor: ANA01_DESCRIPTOR, source: ANA01_SOURCE }).then(() => null, (caught) => caught);
        assertAnalysisRefused(error, "analysis_units", 4, 3);
      }
      const status = runtime.inspect();
      assert.equal(status.cache.entries, 0);
      assert.equal(status.counters.compilations, 0);
      const builder = await buildVerifiedTypedModule({ ...GATED, analysisCapacity: { maxAnalysisUnits: 3 }, descriptor: ANA01_DESCRIPTOR, source: ANA01_SOURCE }).then(() => null, (caught) => caught);
      assertAnalysisRefused(builder, "analysis_units", 4, 3);
      measures["V53-ANA-03"] = { ...measures["V53-ANA-01"], capacity: 3 };
      return { value: { ...refusal, cache_entries: 0, compilations: 0, workbound_evidence: "none" } };
    });
    await vector("V53-ANA-06", async () => {
      // AMD-9: A, B and C run the same implementation (equal compiler and cost-table digests).
      const a = ana01Record;
      const b = await host({ maxAnalysisUnits: 3 }).build({ ...GATED, descriptor: ANA01_DESCRIPTOR, source: ANA01_SOURCE }).then(() => null, (caught) => caught);
      assertAnalysisRefused(b, "analysis_units", 4, 3);
      const dir = path.join(tmp, "host-c");
      fs.mkdirSync(dir);
      const c = runChild(dir, path.join(ROOT, "src"), { ...GATED, descriptor: ANA01_DESCRIPTOR, source: ANA01_SOURCE });
      assert.equal(c.ok, true, c.message);
      const digests = {
        A: { compiler_implementation_digest: a.key.compiler_implementation_digest, cost_table_digest: a.key.cost_table_digest },
        C: { compiler_implementation_digest: c.key.compiler_implementation_digest, cost_table_digest: c.key.cost_table_digest }
      };
      assert.deepEqual(digests.A, digests.C, "the same implementation, named before byte identity is claimed");
      assert.equal(c.recordBytes, a.recordBytes, "C: a record byte-identical to R");
      return { value: { A: "VERIFIED", B: "ANALYSIS_REFUSED", C: "VERIFIED", digests, record_digest: a.recordDigest } };
    });
    results.push(resultRecord("V53-ANA-09", "DEFERRED", { first_executable_slice: "P0-04", owning_slice: "SCALAR", reason: "value if (R-CFG-1) arrives with P0-04" }));
    results.push(resultRecord("V53-ANA-10", "DEFERRED", { first_executable_slice: "P0-04", owning_slice: "SCALAR", reason: "value if (R-CFG-1) arrives with P0-04" }));
    await vector("V53-ANA-11", async () => {
      const source = nest(4894);
      assert.equal(Buffer.byteLength(source, "utf8"), 262114);
      assert.equal(sha256(Buffer.from(source, "utf8")), "sha256:cd7f3faf2f5642867f5647248ff7ec3992c4ba757ee27c3926d940f72d581f18");
      const outcomes = {};
      const check = (label, error) => {
        assert(error, `${label}: never VERIFIED`);
        assert(!(error instanceof TypeError) && !(error instanceof RangeError), `${label}: ${error && error.stack}`);
        assert(typeof error.code === "string" && error.code.startsWith("air."), `${label}: registered typed code with .code set`);
        assert.notEqual(error.code, "air.analysis.capacity_exceeded");
        assert(!/^air\.v052\.work_limit_/u.test(error.code), `${label}: never INTAKE_REFUSED`);
        assert(!error.disposition || error.disposition === "STATIC_REJECT", `${label}: STATIC_REJECT`);
        const line = error.loc && error.loc.line;
        assert(line === 3 || line === 4897, `${label}: line 3 or 4,897, got ${line}`);
        outcomes[label] = { code: error.code, line };
      };
      check("sdk_parse", capture(() => sp.parseSource(source, "ana11.air", GATED)));
      const file = path.join(tmp, "ana11.air");
      fs.writeFileSync(file, source);
      const cli = runCli(["verify", file, "--source-profile", V053, "--allow-candidate-profile"]);
      assert.notEqual(cli.status, 0);
      assert.doesNotMatch(cli.stderr, /RangeError|Maximum call stack|\n\s+at /u);
      outcomes.cli_verify = cli.stderr.trim().split("\n")[0].replace(file, "ana11.air");
      const descriptor = { ...ANA01_DESCRIPTOR, exports: [{ function: "f", name: "f", parameters: [{ name: "c", type: "bool" }], return_type: "i32" }] };
      check("builder", await buildVerifiedTypedModule({ ...GATED, descriptor, source }).then(() => null, (caught) => caught));
      check("runtime", await host().build({ ...GATED, descriptor, source }).then(() => null, (caught) => caught));
      // N-2: the evidence records which line and code occurred; the HOLD on
      // pinning line 3 is not resolved here.
      const lines = new Set(Object.values(outcomes).filter((item) => typeof item === "object").map((item) => item.line));
      assert.equal(lines.size, 1, "every entrypoint reports the same line");
      return { value: { occurred: outcomes.sdk_parse, outcomes }, sourceDigest: sha256(source) };
    });
    await vector("V53-ANA-12", async () => {
      const type = `${"option<".repeat(12000)}i32${">".repeat(12000)}`;
      const source = `module v53.ana\nexport func f(a: ${type}) -> i32 {\nreturn 0\n}\n`;
      assert.equal(Buffer.byteLength(source, "utf8"), 96057);
      assert.equal(sha256(Buffer.from(source, "utf8")), "sha256:691e03c570947b071164135f3362675c03ce6c98506812ea13deafbd483dec2e");
      const error = capture(() => sp.parseSource(source, "ana12.air", GATED));
      assert(error && !(error instanceof RangeError), "no raw RangeError");
      assert.equal(error.code, "air.decision.payload_type_unsupported");
      assert.equal(error.loc && error.loc.line, 2);
      const file = path.join(tmp, "ana12.air");
      fs.writeFileSync(file, source);
      const cli = runCli(["verify", file, "--source-profile", V053, "--allow-candidate-profile"]);
      assert.match(cli.stderr, /air\.decision\.payload_type_unsupported:/u);
      assert.doesNotMatch(cli.stderr, /RangeError|Maximum call stack/u);
      return { value: { code: error.code, line: 2 }, sourceDigest: sha256(source) };
    });
    await vector("V53-ANA-13", async () => {
      // Two implementations that differ in one src byte outside the CT-1 file (as V53-WB-ID-05).
      const dir = path.join(tmp, "impl-y");
      fs.mkdirSync(dir);
      fs.cpSync(path.join(ROOT, "src"), path.join(dir, "src"), { recursive: true });
      fs.appendFileSync(path.join(dir, "src", "version.js"), "// V53-ANA-13: one src byte changed\n");
      const y = runChild(dir, path.join(dir, "src"), { ...GATED, descriptor: ANA01_DESCRIPTOR, source: ANA01_SOURCE });
      const x = ana01Record;
      assert.equal(y.ok, true, y.message);
      assert.equal(y.value, 5, "f(2,3) = 5 on both");
      assert.deepEqual(y.record.entries, x.record.entries, "equal entry summaries E(f) = S{steps:2}");
      assert.equal(y.key.cost_table_digest, x.key.cost_table_digest);
      assert.equal(x.key.cost_table_digest, COST_TABLE_DIGEST);
      assert.notEqual(y.key.compiler_implementation_digest, x.key.compiler_implementation_digest);
      assert.notEqual(y.recordBytes, x.recordBytes, "the records differ (in the key) and are compared by values only");
      return {
        value: {
          compared_by: "values",
          entries: x.record.entries,
          host_A_build_X: { compiler_implementation_digest: x.key.compiler_implementation_digest, cost_table_digest: x.key.cost_table_digest },
          host_D_build_Y: { compiler_implementation_digest: y.key.compiler_implementation_digest, cost_table_digest: y.key.cost_table_digest }
        }
      };
    });
    await vector("V53-ANA-MEASURES", () => {
      // The measures of the other SCALAR capacity inputs (VECTORS_ADDITIONS.md §4, V53-PIPE-10).
      const cases = 1000;
      const casesText = Array.from({ length: cases }, (_, index) => `case${index} = ${index},`).join("\n");
      const params = Array.from({ length: cases }, (_, index) => `p${index}: E`).join(", ");
      const emission = `module work.pressure\nenum E {\n${casesText}\n}\nfunc hidden(${params}) -> i32 {\nreturn 0\n}\nexport func run() -> i32 {\nreturn 1\n}\n`;
      const ingress = `module work.ingress\nenum E {\n${casesText}\n}\nexport func wide(${params}) -> i32 {\nreturn 0\n}\n`;
      const pipe10 = `module v53.vec\nexport func f(${Array.from({ length: 1001 }, (_, index) => `p${index}: i32`).join(", ")}) -> i32 {\nreturn %p0\n}\n`;
      const expected = { "H10-EMISSION": [emission, 6], "H10-INGRESS": [ingress, 4], "V53-PIPE-10": [pipe10, 3] };
      for (const [label, [source, units]] of Object.entries(expected)) {
        const m = measured(label, sp.parseSource(source, `${label}.air`, GATED));
        assert.deepEqual({ analysis_units: m.analysis_units, nesting_depth: m.nesting_depth }, { analysis_units: units, nesting_depth: 1 }, label);
      }
      return { status: "PASS", value: measures };
    });
  } finally {
    fs.rmSync(tmp, { force: true, recursive: true });
  }

  const passed = results.filter((item) => item.status === "PASS").length;
  if (process.env.AIR_SCALAR_VECTOR_RESULTS_DIR) {
    fs.mkdirSync(process.env.AIR_SCALAR_VECTOR_RESULTS_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.AIR_SCALAR_VECTOR_RESULTS_DIR, "v053_analysis_capacity.results.json"), `${JSON.stringify(results.map((item) => JSON.parse(canonicalJson(item))), null, 2)}\n`);
  }
  if (failures.length) {
    for (const failure of failures) console.error(failure);
    console.error(`typed-v0.53 analysis capacity: ${failures.length} failed, ${passed} passed`);
    process.exitCode = 1;
    return;
  }
  const deferred = results.filter((item) => item.status === "DEFERRED").map((item) => item.vector);
  console.log(`typed-v0.53 analysis capacity: ${passed} PASS, ${deferred.length} DEFERRED (${deferred.join(", ")} -> P0-04)`);
})().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
