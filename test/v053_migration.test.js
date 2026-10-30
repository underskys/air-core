#!/usr/bin/env node
"use strict";

// typed-v0.53 P0-11 (card AIR-0053-P0-11-0001), first increment I1: M(), the
// deterministic legacy-v0.50 -> typed-v0.53 migration. Every expected value
// comes from R3.1 VECTORS.md, the slice text R2.3 (P0_11_SLICE_RFC.md,
// VECTORS_ADDITIONS.md, fixtures/; folder SHA256SUMS d848be7c...) or the
// admission record (6b9d4d1b...), never from M(). The vectors' packages and the
// corpus are checked in under fixtures/v053/migration/, pinned by
// FIXTURES_TREE_SHA256 (the slice text's own digests). The corpus's values come
// from the evaluator below, which interprets the legacy I1 subset with
// typed-v0.53's normative semantics and shares no code with src/migrate_v053.js
// or the lowerer (P11-R17, OD-P11-5 (a)). witness.json is read, never produced
// here: legacy at H52_BASELINE, outside every defect domain (P11-R18, OD-P11-8
// (a)). The candidate's legacy path never runs as a witness.
// Set AIR_P011_VECTOR_RESULTS_DIR=<dir> to write the result records and
// AIR_P011_MIGRATION_RECORDS_DIR=<dir> to write each input's output and record
// from both runs of P11-R20.

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { migrateV053 } = require("../src/migrate_v053");
const { repairHintForDiagnosticCode } = require("../src/diagnostics");
const parser = require("../src/parser");
const sp = require("../src/source_profile");
const { buildVerifiedTypedModule, invokeVerifiedTypedExport } = require("../src/v052_verified_build");

const ROOT = path.resolve(__dirname, "..");
const FIXTURES = path.join(ROOT, "fixtures", "v053", "migration");
const GATED = Object.freeze({ allowCandidateProfile: true, sourceProfile: "typed-v0.53" });
const CODE = "air.migration.unsupported_construct";
// sha256 over the sorted lines "<sha256>  <path>" of the slice text's SHA256SUMS `fixtures/` rows.
const FIXTURES_TREE_SHA256 = "f22710e37f61e193e251b1cd34693025b0c1cea8d19c1f507cf09970ca91d24f";
const CORPUS_SHA256 = "69fe5be1a66a8c788192055c852fcdc44d2d36d5f277aa4b1b1794b1bab1e338";
const WITNESS_SHA256 = "303587f9de172e93b85ef538a583322dc7a0a678f7ec37b24d02baa72e96b27b";
const H52_DEV = "94001cd1c822ccd914874c85543aa99e91d6ae4e";
const H52_PUBLIC = "9c2b1788a42f747bf6d61f2517c8348a7d519159";
// AD-P11-1 (a): the projection comes from package.json's name.
const PROJECTIONS = Object.freeze({
  "@underskys/air-core": Object.freeze({ label: "public", migrated: 27, rows: 157 }),
  "airlang-dev-workspace": Object.freeze({ label: "dev", migrated: 28, rows: 165 })
});

const results = [];
const failures = [];

const hexOf = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const sha256 = (bytes) => `sha256:${hexOf(bytes)}`;

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function resultRecord(vectorId, status, value) {
  const valueOrFailure = value === undefined ? null : value;
  return {
    evidence_digest: sha256(canonicalJson({ status, value_or_failure: valueOrFailure, vector: vectorId })),
    status,
    value_or_failure: valueOrFailure,
    vector: vectorId
  };
}

async function vector(id, action) {
  try {
    const outcome = (await action()) || {};
    results.push(resultRecord(id, "PASS", outcome.value));
  } catch (error) {
    failures.push(`${id}: ${error && error.stack || error}`);
    results.push(resultRecord(id, "FAIL", { error: String(error && error.message || error) }));
  }
}

function runCli(args, cwd = ROOT) {
  const out = childProcess.spawnSync(process.execPath, [path.join(ROOT, "bin", "airc.js"), ...args], {
    cwd, encoding: "utf8", killSignal: "SIGKILL", maxBuffer: 64 * 1024 * 1024, timeout: 120000
  });
  assert(!out.error && out.signal === null, `airc ${args[0]} did not finish`);
  return out;
}
function assertNoRawError(text, label) {
  assert.doesNotMatch(String(text), /RangeError|Maximum call stack|TypeError|\n\s+at /u, `${label}: no raw error`);
}

// ---------------------------------------------------------------------------
// The packages.

function packageNames() {
  return fs.readdirSync(FIXTURES).filter((name) => fs.statSync(path.join(FIXTURES, name)).isDirectory()).sort();
}
function pkgOf(prefix) {
  const names = packageNames().filter((name) => name.startsWith(prefix));
  assert.equal(names.length, 1, `exactly one package starts with '${prefix}': ${names.join(", ")}`);
  const dir = path.join(FIXTURES, names[0]);
  const expectedOutput = path.join(dir, "expected.air");
  return {
    dir,
    expectedOutput: fs.existsSync(expectedOutput) ? fs.readFileSync(expectedOutput, "utf8") : null,
    expectedRecord: fs.readFileSync(path.join(dir, "expected.record.json"), "utf8"),
    input: path.join(dir, "input.air"),
    label: names[0]
  };
}
function walkFiles(dir, base = dir) {
  return fs.readdirSync(dir).sort().flatMap((name) => {
    const file = path.join(dir, name);
    return fs.statSync(file).isDirectory() ? walkFiles(file, base) : [path.relative(base, file)];
  });
}

// The 39 packages: id, prefix, and the --module-id of the one control that takes one.
const VECTOR_PACKAGES = Object.freeze([
  ["V53-MIG-P01", "V53-MIG-P01_"], ["V53-MIG-P02", "V53-MIG-P02_"], ["V53-MIG-N01", "V53-MIG-N01_an_"], ["V53-MIG-N01 (ii)", "V53-MIG-N01_ii_"],
  ["V53-MIG-N01 (iii)", "V53-MIG-N01_iii_"], ["V53-MIG-N01 (iv)", "V53-MIG-N01_iv_"], ["V53-MIG-N01 (v)", "V53-MIG-N01_v_"], ["V53-MIG-N01 (vi)", "V53-MIG-N01_vi_"],
  ["V53-MIG-N03", "V53-MIG-N03_module_"], ["V53-MIG-N03 (ii)", "V53-MIG-N03_ii_", "plugin"], ["V53-MIG-N05", "V53-MIG-N05_"], ["V53-MIG-P05", "V53-MIG-P05_"],
  ["V53-MIG-P03", "V53-MIG-P03_"], ["V53-MIG-N02", "V53-MIG-N02_"], ["V53-MIG-N04", "V53-MIG-N04_"], ["V53-MIG-N06", "V53-MIG-N06_"],
  ["V53-MIG-P06", "V53-MIG-P06_"], ["V53-MIG-P07", "V53-MIG-P07_"], ["V53-MIG-P08", "V53-MIG-P08_"], ["V53-MIG-P09", "V53-MIG-P09_"],
  ["V53-MIG-P10", "V53-MIG-P10_"], ["V53-MIG-P11", "V53-MIG-P11_"], ["V53-MIG-N08", "V53-MIG-N08_"], ["V53-MIG-N09", "V53-MIG-N09_"],
  ["V53-MIG-N10", "V53-MIG-N10_an_"], ["V53-MIG-N10 (ii)", "V53-MIG-N10_ii_"], ["V53-MIG-N11", "V53-MIG-N11_"], ["V53-MIG-N12", "V53-MIG-N12_"],
  ["V53-MIG-N13", "V53-MIG-N13_"], ["V53-MIG-N14", "V53-MIG-N14_a_"], ["V53-MIG-N14 (ii)", "V53-MIG-N14_ii_"], ["V53-MIG-N14 (iii)", "V53-MIG-N14_iii_"],
  ["V53-MIG-N14 (iv)", "V53-MIG-N14_iv_"], ["V53-MIG-N14 (v)", "V53-MIG-N14_v_"], ["V53-MIG-N15", "V53-MIG-N15_an_"], ["V53-MIG-N15 (ii)", "V53-MIG-N15_ii_"],
  ["V53-MIG-N15 (iii)", "V53-MIG-N15_iii_"], ["V53-MIG-N15 (iv)", "V53-MIG-N15_iv_"], ["V53-MIG-N15 (v)", "V53-MIG-N15_v_"]
]);

// ---------------------------------------------------------------------------
// Values. A value's key: i32 and i64 in decimal, a float as its hex bits or
// `nan` (R3.1 §5.3: a NaN is a classification), a bool as `true` or `false`.

const f32Hex = (value) => { const b = Buffer.alloc(4); b.writeFloatBE(value, 0); return b.toString("hex"); };
const f64Hex = (value) => { const b = Buffer.alloc(8); b.writeDoubleBE(value, 0); return b.toString("hex"); };
function valueKey(type, value) {
  if (type === "f32") return Number.isNaN(value) ? "nan" : f32Hex(value);
  if (type === "f64") return Number.isNaN(value) ? "nan" : f64Hex(value);
  return String(value);
}
function typedArgument(type, value) {
  if (type === "i64") return { decimal: String(value), type };
  if (type === "f32" || type === "f64") return Number.isNaN(value) ? { classification: "nan", type } : { bits: valueKey(type, value), type };
  return value;
}
function typedResultKey(value) {
  if (value && typeof value === "object") return value.classification === "nan" ? "nan" : value.bits !== undefined ? value.bits : value.decimal;
  return String(value);
}

// P11-R21, in its order.
const FLOAT_POINTS = Object.freeze([0, -0, 1, -1, 0.5, 0.3, 1e8, Infinity, NaN]);
const POINTS = Object.freeze({
  bool: Object.freeze([true, false]),
  f32: FLOAT_POINTS,
  f64: FLOAT_POINTS,
  i32: Object.freeze([0, 1, -1, 7, -7, 2147483647, -2147483648]),
  i64: Object.freeze([0n, 1n, -1n, 9007199254740993n, -9223372036854775808n])
});
function refinementOf(text) {
  const match = /^i32<(-?[0-9]+)\.\.(-?[0-9]+)>$/.exec(text || "");
  return match ? { hi: Number(match[2]), lo: Number(match[1]) } : null;
}
function pointsOf(parameter) {
  const refined = refinementOf(parameter.declaredType);
  if (!refined) return POINTS[parameter.type];
  return [refined.lo, refined.hi, Math.floor((refined.lo + refined.hi) / 2), refined.lo - 1, refined.hi + 1];
}
function combinations(params) {
  let rows = [[]];
  for (const parameter of params) {
    const next = [];
    for (const row of rows) for (const point of pointsOf(parameter)) if (next.length < 64) next.push([...row, point]);
    rows = next;
  }
  return rows;
}

// ---------------------------------------------------------------------------
// The evaluator (P11-R17): the legacy I1 subset, with typed-v0.53's normative
// semantics: wrapping and checked i32, IEEE f32, entry checks. It reads the
// legacy AST and nothing else: no src/migrate_v053.js, no lowerer.

class EvaluatorFailure extends Error {
  constructor(key) {
    super(key);
    this.key = key;
  }
}
const CHECKED = "FAIL air.numeric.checked_failure";
const INT_MIN = -2147483648;
const fr = Math.fround;

const EVAL_OPS = Object.freeze({
  "bool.and": (a, b) => a && b,
  "bool.not": (a) => !a,
  "bool.or": (a, b) => a || b,
  "f32.add": (a, b) => fr(a + b),
  "f32.div": (a, b) => fr(a / b),
  "f32.eq": (a, b) => a === b,
  "f32.ge": (a, b) => a >= b,
  "f32.gt": (a, b) => a > b,
  "f32.le": (a, b) => a <= b,
  "f32.lt": (a, b) => a < b,
  "f32.max": (a, b) => Math.max(a, b),
  "f32.min": (a, b) => Math.min(a, b),
  "f32.mul": (a, b) => fr(a * b),
  "f32.ne": (a, b) => a !== b,
  "f32.sub": (a, b) => fr(a - b),
  "i32.add": (a, b) => (a + b) | 0,
  "i32.and": (a, b) => a & b,
  "i32.div_s": (a, b) => {
    if (b === 0) throw new EvaluatorFailure(`${CHECKED}: division_by_zero`);
    if (a === INT_MIN && b === -1) throw new EvaluatorFailure(`${CHECKED}: overflow`);
    return (a / b) | 0;
  },
  "i32.eq": (a, b) => a === b,
  "i32.ge_s": (a, b) => a >= b,
  "i32.gt_s": (a, b) => a > b,
  "i32.le_s": (a, b) => a <= b,
  "i32.lt_s": (a, b) => a < b,
  "i32.mul": (a, b) => Math.imul(a, b),
  "i32.ne": (a, b) => a !== b,
  "i32.or": (a, b) => a | b,
  "i32.rem_s": (a, b) => {
    if (b === 0) throw new EvaluatorFailure(`${CHECKED}: division_by_zero`);
    return (a % b) | 0;
  },
  "i32.shl": (a, b) => a << (b & 31),
  "i32.shr_u": (a, b) => (a >>> (b & 31)) | 0,
  "i32.sub": (a, b) => (a - b) | 0,
  "i32.trunc_f32_s": (a) => {
    if (Number.isNaN(a) || a >= 2147483648 || a <= -2147483649) throw new EvaluatorFailure(`${CHECKED}: invalid_conversion`);
    return Math.trunc(a) | 0;
  },
  "i32.xor": (a, b) => a ^ b,
  "select.bool": (c, a, b) => (c ? a : b),
  "select.f32": (c, a, b) => (c ? a : b),
  "select.i32": (c, a, b) => (c ? a : b)
});

function literalValue(op, atom) {
  if (op === "const.bool") return atom.value;
  if (op === "const.i64") return BigInt(atom.raw);
  if (op === "const.i32") return Number(BigInt(atom.raw));
  return op === "const.f32" ? fr(Number(atom.raw)) : Number(atom.raw);
}

function evaluate(mod, name, args) {
  const fn = mod.functions.find((item) => item.name === name);
  const env = new Map();
  fn.params.forEach((parameter, index) => {
    const refined = refinementOf(parameter.declaredType);
    if (refined && (args[index] < refined.lo || args[index] > refined.hi)) throw new EvaluatorFailure("FAIL air.refinement.ingress_out_of_range");
    env.set(`%${parameter.name}`, args[index]);
  });
  const read = (atom) => (atom.kind === "value" ? env.get(atom.name) : atom.kind === "bool" ? atom.value : Number(atom.raw));
  let block = fn.blocks[0];
  let previous = null;
  for (let steps = 0; steps < 1000000; steps += 1) {
    let next = null;
    for (const ins of block.instructions) {
      if (ins.op.startsWith("phi.")) {
        env.set(ins.result, env.get(ins.args.find((arg) => arg.label === previous).value));
      } else if (ins.op.startsWith("const.")) {
        env.set(ins.result, literalValue(ins.op, ins.args[0]));
      } else if (ins.op === "call") {
        env.set(ins.result, evaluate(mod, ins.callee, ins.args.map(read)));
      } else if (ins.op === "return") {
        return read(ins.args[0]);
      } else if (ins.op === "br") {
        [next] = ins.labels;
      } else if (ins.op === "br_if") {
        next = ins.labels[read(ins.args[0]) ? 0 : 1];
      } else {
        const operation = EVAL_OPS[ins.op];
        assert(operation, `the evaluator has no '${ins.op}' (I1 maps none)`);
        env.set(ins.result, operation(...ins.args.map(read)));
      }
    }
    previous = block.label;
    block = fn.blocks.find((item) => item.label === next);
  }
  throw new Error(`${name}: the evaluator did not finish`);
}

function reference(mod, fn, args) {
  try {
    return valueKey(fn.returnType, evaluate(mod, fn.name, args));
  } catch (error) {
    if (error instanceof EvaluatorFailure) return error.key;
    throw error;
  }
}

// The typed side: M()'s output, built and invoked through the verified builder.
async function typedBuild(source) {
  const mod = sp.parseSource(source, "<typed>", GATED);
  // P0-03: the descriptor image of `i32<a..b>` is `i32`.
  const image = (type) => (refinementOf(type) ? "i32" : type);
  const descriptor = {
    air_abi_lane: "0.12", exports: mod.functions.filter((fn) => fn.exported).map((fn) => ({
      function: fn.name, name: fn.name, parameters: fn.params.map((parameter) => ({ name: parameter.name, type: image(parameter.type) })), return_type: image(fn.returnType)
    })), module_id: mod.name, schema: "air.typed-interface/0.12-candidate.1", types: []
  };
  return buildVerifiedTypedModule({ ...GATED, descriptor, source });
}
async function typedOutcome(build, fn, args) {
  try {
    const invoked = await invokeVerifiedTypedExport(build, fn.name, args.map((value, index) => typedArgument(fn.params[index].type, value)));
    return typedResultKey(invoked.value);
  } catch (error) {
    assert(error && error.code, `${fn.name}: a failure with a code: ${error && error.stack}`);
    return `FAIL ${error.code}${error.reason ? `: ${error.reason}` : ""}`;
  }
}

// ---------------------------------------------------------------------------
// The reference values of VECTORS_ADDITIONS.md, each as its text gives it. `true`
// in the last place: "the witness must agree" (a FAIL point: legacy traps raw).

const F = (hex) => Buffer.from(hex, "hex").readFloatBE(0);
const DIFFERENTIAL = Object.freeze([
  ["V53-MIG-P01", "f", [2147483647, 1], "-2147483648", true], ["V53-MIG-P01", "f", [1, 2], "3", true], ["V53-MIG-P01", "f", [-1, -1], "-2", true],
  ["V53-MIG-P01", "f", [-2147483648, -1], "2147483647", true],
  ["V53-MIG-P02", "f", [7, 2], "3", true], ["V53-MIG-P02", "f", [-7, 2], "-3", true],
  ["V53-MIG-P02", "f", [-2147483648, -1], `${CHECKED}: overflow`, true], ["V53-MIG-P02", "f", [1, 0], `${CHECKED}: division_by_zero`, true],
  ["V53-MIG-N01", "f", [], "9007199254740993", false], ["V53-MIG-N01 (ii)", "f", [], "4611686018427387904", false],
  ["V53-MIG-N01 (iii)", "f", [], "-9223372036854775808", false], ["V53-MIG-N01 (iv)", "f", [], "9007199254740994", true],
  ["V53-MIG-N01 (v)", "f", [], "0", true], ["V53-MIG-N01 (vi)", "f", [], "7", true], ["V53-MIG-N03 (ii)", "f", [7], "7", true],
  ["V53-MIG-P05", "f", [100000000, fr(0.3), 1], "00000000", true], ["V53-MIG-P05", "f", [0, 10, 0.5], "40a00000", true],
  ["V53-MIG-P05", "f", [1, 3, 0.25], "3fc00000", true], ["V53-MIG-P05", "f", [NaN, 1, 0.5], "nan", true],
  ["V53-MIG-P03", "run", [], "5", false],
  ["V53-MIG-N04", "keep_score", [50], "50", true], ["V53-MIG-N04", "keep_score", [150], "FAIL air.refinement.ingress_out_of_range", false],
  ["V53-MIG-P06", "f", [3], "10", true], ["V53-MIG-P06", "f", [-1], "2", true], ["V53-MIG-P06", "f", [46341], "-2147479014", true],
  ["V53-MIG-P07", "sign", [-5], "-1", true], ["V53-MIG-P07", "sign", [0], "1", true], ["V53-MIG-P07", "sign", [7], "1", true],
  ["V53-MIG-P07", "sign", [-2147483648], "-1", true],
  ["V53-MIG-P08", "run", [3, true], "6", true], ["V53-MIG-P08", "run", [3, false], "12", true], ["V53-MIG-P08", "run", [1073741824, false], "0", true],
  ["V53-MIG-P09", "clamp", [5, 0, 1], "3f800000", true], ["V53-MIG-P09", "clamp", [0.5, 1, 0], "00000000", true], ["V53-MIG-P09", "clamp", [NaN, 0, 1], "nan", true],
  ["V53-MIG-P09", "inv", [1, 3, 2], "3f000000", true], ["V53-MIG-P09", "inv", [2, 2, 1], "ff800000", true], ["V53-MIG-P09", "quad", [0.5], "3f400000", true],
  ["V53-MIG-P09", "quad", [2], "00000000", true], ["V53-MIG-P09", "smooth", [0.5], "3f000000", true], ["V53-MIG-P09", "smooth", [F("3dcccccd")], "3ce56042", true],
  ["V53-MIG-P10", "f", [F("402ccccd")], "2", true], ["V53-MIG-P10", "f", [F("c02ccccd")], "-2", true],
  ["V53-MIG-P10", "f", [NaN], `${CHECKED}: invalid_conversion`, true], ["V53-MIG-P10", "f", [3000000000], `${CHECKED}: invalid_conversion`, true]
]);

function readWitness() {
  const bytes = fs.readFileSync(path.join(FIXTURES, "witness.json"));
  assert.equal(hexOf(bytes), WITNESS_SHA256, "witness.json is the pinned H52 table");
  return JSON.parse(bytes.toString("utf8"));
}
// A witness never sets a value: it is compared with the reference, and a trap agrees with a FAIL.
function assertWitness(label, witnessed, expected) {
  assert.equal(witnessed, expected.startsWith("FAIL ") ? "trap" : expected, `${label}: the witness and the reference disagree (a finding to triage, P11-R18)`);
}

async function sectionVectors(witness) {
  const packages = new Map();
  for (const [id, prefix, moduleId] of VECTOR_PACKAGES) {
    const pkg = pkgOf(prefix);
    packages.set(id, pkg);
    await vector(id, async () => {
      const bytes = fs.readFileSync(pkg.input);
      const options = { path: pkg.input, ...(moduleId ? { moduleId } : {}) };
      const result = migrateV053(bytes, options);
      assert.equal(result.record, pkg.expectedRecord, "the record's exact bytes");
      assert.equal(result.output === undefined ? null : result.output, pkg.expectedOutput, "the output's exact bytes");
      const record = JSON.parse(result.record);
      assert.equal(record.input_sha256, hexOf(bytes));

      // The CLI: bytes from a file, with the path as written in the package's folder.
      const cliOutput = path.join(scratch, `${hexOf(id)}.air`);
      const cliRecord = path.join(scratch, `${hexOf(id)}.json`);
      const cli = runCli(["migrate", "input.air", ...(moduleId ? ["--module-id", moduleId] : []), "-o", cliOutput, "--record", cliRecord], pkg.dir);
      assert.equal(fs.readFileSync(cliRecord, "utf8"), pkg.expectedRecord, "the CLI's record");
      if (pkg.expectedOutput === null) {
        const { rejection } = record;
        assert.equal(cli.status, 1, "REJECTED exits 1");
        assert.equal(fs.existsSync(cliOutput), false, "a rejection writes no output");
        const lines = cli.stderr.trimEnd().split("\n");
        assert.equal(lines[0], `input.air:${rejection.line}: ${CODE}: ${rejection.construct} (${rejection.reason})`, "the CLI's refusal line");
        if (rejection.legacy_message !== undefined) assert.equal(lines[1], rejection.legacy_message, "legacy's message follows");
        if (rejection.origin) assert(lines.at(-1).includes(`${rejection.origin.file}:${rejection.origin.line}`), "the origin follows");
        assertNoRawError(cli.stderr, id);
      } else {
        assert.equal(cli.status, 0, `the CLI migrates: ${cli.stderr}`);
        assert.equal(fs.readFileSync(cliOutput, "utf8"), pkg.expectedOutput, "the CLI's output");
        // P11-R19, V53-MIG-P04: the output verifies and passes format --check.
        const checked = runCli(["format", "--check", cliOutput, "--source-profile", GATED.sourceProfile, "--allow-candidate-profile"]);
        assert.equal(checked.status, 0, `format --check: ${checked.stdout}${checked.stderr}`);
        sp.verifySource(sp.parseSource(pkg.expectedOutput, "<typed>", GATED), GATED);
      }
      return { value: { class: record.class || null, disposition: result.kind, output_sha256: result.output === undefined ? null : hexOf(result.output), record_sha256: hexOf(result.record) } };
    });
  }

  await vector("V53-MIG-DIFFERENTIAL", async () => {
    const builds = new Map();
    const points = [];
    for (const [id, name, args, expected, hasWitness] of DIFFERENTIAL) {
      const pkg = packages.get(id);
      if (!builds.has(id)) builds.set(id, { build: await typedBuild(pkg.expectedOutput), mod: parser.parseAir(fs.readFileSync(pkg.input, "utf8"), pkg.input) });
      const { build, mod } = builds.get(id);
      const fn = mod.functions.find((item) => item.name === name);
      const label = `${id} ${name}(${args.map(String).join(", ")})`;
      assert.equal(await typedOutcome(build, fn, args), expected, label);
      const argsKey = args.map((value, index) => valueKey(fn.params[index].type, value)).join(",");
      const row = witness.vectors[id];
      if (hasWitness) assertWitness(label, row.exports[name][argsKey], expected);
      else assert(!row || !row.exports[name] || row.exports[name][argsKey] === undefined, `${label}: inside a defect domain, no witness (P11-R18)`);
      points.push([label, expected]);
    }
    return { value: { points: points.length } };
  });

  await vector("V53-MIG-ORACLE-01", async () => {
    assert.equal(witness.schema, "air.migration-witness/1");
    assert.equal(witness.provenance.dev_commit, H52_DEV);
    assert.equal(witness.provenance.public_commit, H52_PUBLIC);
    for (const id of ["V53-MIG-N01", "V53-MIG-N01 (ii)", "V53-MIG-N01 (iii)", "V53-MIG-P03"]) assert.equal(witness.vectors[id], undefined, `${id} lies inside a defect domain`);
    assert.equal(witness.corpus["examples/phi_loop.air"].domain, "X-SND-01");
    assert.deepEqual(witness.corpus["examples/phi_loop.air"].exports, {});
    for (const [row, entry] of Object.entries(witness.corpus)) if (entry.domain) assert.deepEqual(entry.exports, {}, `${row}: no witness inside ${entry.domain}`);
    return { value: { vectors_with_a_witness: Object.keys(witness.vectors).length } };
  });
  return packages;
}

// ---------------------------------------------------------------------------
// The corpus (P11-R20; AD-P11-1 (a)).

function readCorpus() {
  const bytes = fs.readFileSync(path.join(FIXTURES, "corpus_I1.tsv"));
  assert.equal(hexOf(bytes), CORPUS_SHA256, "corpus_I1.tsv is the slice text's file");
  return bytes.toString("utf8").split("\n").filter((line) => line && !line.startsWith("#")).map((line) => {
    const cells = line.split("\t");
    assert.equal(cells.length, 9, `${cells[0]}: nine columns`);
    const [file, digest, disposition, construct, reportedLine, reason, origin, imports, projection] = cells;
    return { construct, digest, disposition, file, imports, line: reportedLine, origin, projection, reason };
  });
}
function importFile(row, key) {
  if (key.startsWith("std:")) return path.join(ROOT, "stdlib", `${key.slice("std:".length)}.air`);
  return path.join(ROOT, path.dirname(row.file), key);
}

// The second run of P11-R20: another working directory, another locale, the path in another form.
function secondRun(inputs) {
  const dir = fs.mkdtempSync(path.join(scratch, "second-run-"));
  const list = path.join(dir, "inputs.json");
  fs.writeFileSync(list, JSON.stringify(inputs.map((item) => ({ ...item, file: path.relative(dir, item.file) }))));
  const env = { ...process.env, LANG: "tr_TR.UTF-8", LC_ALL: "tr_TR.UTF-8" };
  const out = childProcess.spawnSync(process.execPath, [__filename, "--second-run", list], { cwd: dir, encoding: "utf8", env, maxBuffer: 256 * 1024 * 1024, timeout: 300000 });
  assert.equal(out.status, 0, `the second run: ${out.stderr}`);
  return JSON.parse(out.stdout);
}
function runSecondRunChild(listFile) {
  assert.equal(new Intl.Collator().resolvedOptions().locale, "tr-TR", "another locale reaches this process");
  const inputs = JSON.parse(fs.readFileSync(listFile, "utf8"));
  const out = inputs.map((item) => {
    const result = migrateV053(fs.readFileSync(item.file), { moduleId: item.moduleId, path: item.file });
    return { key: item.key, output: result.output === undefined ? null : result.output, record: result.record };
  });
  process.stdout.write(JSON.stringify(out));
}

function writeRecords(dir, key, output, record) {
  fs.mkdirSync(dir, { recursive: true });
  const name = key.replace(/[^A-Za-z0-9_.-]+/g, "__");
  fs.writeFileSync(path.join(dir, `${name}.record.json`), record);
  if (output !== null && output !== undefined) fs.writeFileSync(path.join(dir, `${name}.air`), output);
}

async function sectionCorpus(witness, projection) {
  const rows = readCorpus();
  assert.equal(rows.length, 165, "the corpus has 165 rows");
  const selected = rows.filter((row) => projection.label === "dev" || row.projection === "both");
  const recordsDir = process.env.AIR_P011_MIGRATION_RECORDS_DIR;
  const first = new Map();
  const tally = { MIGRATED: 0, later_increment: 0, legacy_invalid: 0, not_admitted: 0, source_profile: 0 };

  await vector("V53-MIG-CORPUS", async () => {
    assert.equal(selected.length, projection.rows, `the ${projection.label} projection runs ${projection.rows} rows (AD-P11-1 (a))`);
    for (const row of selected) {
      const file = path.join(ROOT, row.file);
      const bytes = fs.readFileSync(file);
      assert.equal(hexOf(bytes), row.digest, `${row.file}: the pinned bytes`);
      const pins = row.imports === "-" ? [] : row.imports.split(";").map((item) => item.split("="));
      for (const [key, digest] of pins) assert.equal(hexOf(fs.readFileSync(importFile(row, key))), digest, `${row.file}: ${key}'s pinned bytes`);
      const result = migrateV053(bytes, { path: file });
      const record = JSON.parse(result.record);
      assert.equal(result.kind, row.disposition, row.file);
      assert.deepEqual(record.imports.map((item) => [item.path, item.sha256]), pins, `${row.file}: the record pins its imports`);
      assert.equal(record.input_sha256, row.digest);
      if (row.disposition === "REJECTED") {
        const { rejection } = record;
        assert.equal(rejection.code, CODE, row.file);
        assert.equal(rejection.construct, row.construct, row.file);
        assert.equal(String(rejection.line === null ? "-" : rejection.line), row.line, row.file);
        assert.equal(rejection.reason, row.reason, row.file);
        const origin = rejection.origin ? `${rejection.origin.file}:${rejection.origin.line}|${rejection.origin.construct}` : "-";
        assert.equal(origin, row.origin, row.file);
        tally[row.construct === "source-profile" ? "source_profile" : rejection.reason] += 1;
      } else {
        tally.MIGRATED += 1;
      }
      first.set(row.file, result);
    }
    assert.equal(tally.MIGRATED, projection.migrated, "MIGRATED rows");
    return { value: { projection: projection.label, rows: selected.length, tally } };
  });

  await vector("V53-MIG-CORPUS-DOUBLE-RUN", async () => {
    const second = new Map(secondRun(selected.map((row) => ({ file: path.join(ROOT, row.file), key: row.file }))).map((item) => [item.key, item]));
    for (const row of selected) {
      const one = first.get(row.file);
      const two = second.get(row.file);
      assert.equal(two.record, one.record, `${row.file}: the records are byte-identical`);
      assert.equal(two.output, one.output === undefined ? null : one.output, `${row.file}: the outputs are byte-identical`);
      if (recordsDir) {
        writeRecords(path.join(recordsDir, projection.label, "run1"), row.file, one.output, one.record);
        writeRecords(path.join(recordsDir, projection.label, "run2"), row.file, two.output, two.record);
      }
    }
    return { value: { rows: selected.length } };
  });

  await vector("V53-MIG-CORPUS-DIFFERENTIAL", async () => {
    let points = 0;
    let witnessed = 0;
    for (const row of selected.filter((item) => item.disposition === "MIGRATED")) {
      const result = first.get(row.file);
      assert.equal(sp.formatSource(sp.parseSource(result.output, "<typed>", GATED), GATED), result.output, `${row.file}: canonical`);
      const mod = parser.parseAir(fs.readFileSync(path.join(ROOT, row.file), "utf8"), path.join(ROOT, row.file));
      const exported = mod.functions.filter((fn) => fn.exported);
      if (!exported.length) continue;
      const build = await typedBuild(result.output);
      const entry = witness.corpus[row.file];
      assert(entry, `${row.file}: the witness table has the row`);
      assert.equal(entry.sha256, row.digest, `${row.file}: the witness ran these bytes`);
      for (const fn of exported) {
        if (!fn.params.every((parameter) => POINTS[parameter.type])) continue;
        for (const args of combinations(fn.params)) {
          const expected = reference(mod, fn, args);
          const label = `${row.file} ${fn.name}(${args.map(String).join(", ")})`;
          assert.equal(await typedOutcome(build, fn, args), expected, label);
          points += 1;
          const argsKey = args.map((value, index) => valueKey(fn.params[index].type, value)).join(",");
          const witnessedValue = entry.exports[fn.name] && entry.exports[fn.name][argsKey];
          if (entry.domain) continue;
          if (expected === "FAIL air.refinement.ingress_out_of_range") {
            assert.equal(witnessedValue, undefined, `${label}: inside X-SND-09's domain, no witness`);
            continue;
          }
          assertWitness(label, witnessedValue, expected);
          witnessed += 1;
        }
      }
    }
    return { value: { points, witnessed } };
  });
}

// V53-MIG-P04: every MIG input, twice.
async function sectionProperty(packages) {
  await vector("V53-MIG-P04", async () => {
    const inputs = VECTOR_PACKAGES.map(([id, , moduleId]) => ({ file: packages.get(id).input, key: id, moduleId }));
    const second = new Map(secondRun(inputs).map((item) => [item.key, item]));
    const recordsDir = process.env.AIR_P011_MIGRATION_RECORDS_DIR;
    let migrated = 0;
    for (const item of inputs) {
      const pkg = packages.get(item.key);
      const two = second.get(item.key);
      assert.equal(two.record, pkg.expectedRecord, `${item.key}: the second run's record`);
      assert.equal(two.output, pkg.expectedOutput, `${item.key}: the second run's output`);
      if (recordsDir) writeRecords(path.join(recordsDir, "vectors"), item.key, two.output, two.record);
      if (two.output !== null) migrated += 1;
    }
    return { value: { inputs: inputs.length, migrated } };
  });
}

// ---------------------------------------------------------------------------
// Rule checks beyond the vectors, each input written here and each expected
// value read from the rule it names. In-memory inputs have no imports.

const moduleOf = (body, header = "capabilities { }") => `module rule_check\n${header}\n\n${body}\n`;
const fnOf = (signature, lines) => `export func ${signature} {\nentry:\n${lines.map((line) => `  ${line}`).join("\n")}\n}`;
function run(text, options = {}) {
  const result = migrateV053(text, { path: path.join(scratch, "rule_check.air"), ...options });
  return { ...result, parsed: JSON.parse(result.record) };
}
const entryOf = (result, construct) => result.parsed.entries.filter((item) => item.construct === construct);
const COUNTER = (entry, header, body, exit = ["return %i"], returnType = "i32") => fnOf(`run() -> ${returnType}`, [
  ...entry, "br loop", "loop:", "  %i:i32 = phi.i32 entry:%zero, body:%next", ...header, "  %done:bool = i32.ge_s %i, %limit", "  br_if %done, exit, body",
  "body:", ...body, "  br loop", "exit:", ...exit
]);
const STEP = ["  %one:i32 = 1", "  %next:i32 = add %i, %one"];

async function sectionRules() {
  await vector("P0-11-CHECK-LITERALS", async () => {
    // OD-P11-12 (A): every literal inside the domain has this whole entry, also when its text does not change.
    const defectEntry = (from, to, legacyValue) => ({ class: "LEGACY_DEFECT_CORRECTED", construct: "literal", from, ledger: "X-SND-08", legacy_value: legacyValue, line: 6, rule: "P11-R8", to });
    // P11-R8: a compact literal inside the domain changes value, so it has its entry (P11-R1: nothing changes silently).
    const compact = run(moduleOf(fnOf("f() -> i64", ["%x:i64 = 9007199254740993", "return %x"])));
    assert.equal(compact.kind, "MIGRATED");
    assert.equal(compact.class, "LEGACY_DEFECT_CORRECTED");
    assert.deepEqual(entryOf(compact, "literal"), [defectEntry("9007199254740993", "9007199254740993", "9007199254740992")]);
    // P11-R8: legacy writes the text of -0's Number, `0`, which denotes +0.0; the literal denotes -0.0.
    for (const type of ["f32", "f64"]) {
      for (const [from, line] of [["-0.0", `%x:${type} = -0.0`], [`const.${type} -0.0`, `%x:${type} = const.${type} -0.0`]]) {
        const zero = run(moduleOf(fnOf(`f() -> ${type}`, [line, "return %x"])));
        assert.equal(zero.class, "LEGACY_DEFECT_CORRECTED", line);
        assert.deepEqual(entryOf(zero, "literal"), [defectEntry(from, "-0.0", "0")], line);
        assert.match(zero.output, /= -0\.0\n/u);
      }
    }
    assert.equal(run(moduleOf(fnOf("f() -> f32", ["%x:f32 = 0.0", "return %x"]))).class, "EXACT");
    // f32: the literal lies just below the tie 1 + 2^-24, so it rounds to 1.0; the text of its Number,
    // 1.0000000596046448, lies above it, so legacy's value is the next binary32. Control: both round up.
    const twice = run(moduleOf(fnOf("f() -> f32", ["%x:f32 = 1.00000005960464477539", "return %x"])));
    assert.equal(twice.class, "LEGACY_DEFECT_CORRECTED");
    assert.deepEqual(entryOf(twice, "literal"), [defectEntry("1.00000005960464477539", "1.00000005960464477539", "1.0000000596046448")]);
    assert.equal(run(moduleOf(fnOf("f() -> f32", ["%x:f32 = 1.0000000596046448887", "return %x"]))).class, "EXACT");
    assert.equal(run(moduleOf(fnOf("f() -> f32", ["%x:f32 = 0.1", "return %x"]))).class, "EXACT");
    // An integer-spelled float (OPEN-4 (a)), a carrier, a canonical integer spelling.
    const spelled = run(moduleOf(fnOf("f() -> f32", ["%x:f32 = 3", "return %x"])));
    assert.deepEqual([entryOf(spelled, "literal")[0].from, entryOf(spelled, "literal")[0].to, spelled.class], ["3", "3.0", "EXACT"]);
    const flag = run(moduleOf(fnOf("f() -> bool", ["%x:bool = const.bool true", "return %x"])));
    assert.deepEqual([entryOf(flag, "literal")[0].from, entryOf(flag, "literal")[0].to], ["const.bool true", "true"]);
    assert.equal(entryOf(run(moduleOf(fnOf("f() -> bool", ["%x:bool = true", "return %x"]))), "literal").length, 0, "the text does not change");
    // A literal typed-v0.53 cannot read fails P11-R19's check, and an operand is kept as written.
    for (const line of ["%x:i32 = 1.5", "%x:i32 = 99999999999"]) {
      const refused = run(moduleOf(fnOf("f() -> i32", [line, "return %x"])));
      assert.deepEqual([refused.construct, refused.line, refused.reason, refused.typed_code], ["typed-verification", 1, "not_admitted", "air.v051.typed_atom_type_mismatch"]);
    }
    const operand = run(moduleOf(fnOf("f(a: i32) -> i32", ["%x:i32 = i32.add %a, 007", "return %x"])));
    assert.deepEqual([operand.construct, operand.typed_code], ["typed-verification", "air.v051.typed_atom_invalid"]);
    // A carrier's operand that is no literal of its type has no typed spelling.
    for (const [type, line] of [["f32", "%x:f32 = const.f32 1e5"], ["i32", "%x:i32 = const.i32 %a"], ["bool", "%x:bool = const.bool 1"]]) {
      const refused = run(moduleOf(fnOf(`f(a: i32) -> ${type}`, [line, "return %x"])));
      assert.deepEqual([refused.construct, refused.reason], [`const.${type}`, "not_admitted"]);
    }
  });

  await vector("P0-11-CHECK-FRESH-NAMES", async () => {
    // P11-R11: a helper's names skip what the function holds.
    const helper = run(moduleOf(fnOf("f(a: f32, b: f32, t: f32) -> f32", ["%o__1:f32 = f32.add %a, %b", "%o:f32 = f32.lerp %o__1, %b, %t", "return %o"])));
    assert.match(helper.output, /%o__2: f32 = f32\.sub %b, %o__1\n {2}%o__3: f32 = f32\.mul %o__2, %t\n {2}%o: f32 = f32\.add %o__3, %o__1\n/u);
    const split = run(moduleOf(fnOf("f(c: bool) -> i32", ["br_if %c, a, b", "a:", "  %ret:i32 = 1", "  return %ret", "b:", "  %ret__1:i32 = 2", "  return %ret__1"])));
    assert.match(split.output, /%ret__2: i32 = if %c \{/u);
    assert.equal(entryOf(split, "return-split")[0].to, "%ret__2: i32 = if %c");
    const taken = run(moduleOf(`func run__loop(x: i32) -> i32 {\nentry:\n  return %x\n}\n\n${COUNTER(["  %zero:i32 = 0"], ["  %limit:i32 = 2"], STEP)}`));
    assert.match(taken.output, /loop\.fold @run__loop__1, %zero, 2/u);
  });

  await vector("P0-11-CHECK-COUNTER-LOOP", async () => {
    const shapes = [
      ["the limit in the entry", COUNTER(["  %zero:i32 = 0", "  %limit:i32 = 3"], [], STEP), 3],
      ["carrier constants", COUNTER(["  %zero:i32 = const.i32 0"], ["  %limit:i32 = const.i32 3"], ["  %one:i32 = const.i32 1", "  %next:i32 = i32.add %i, %one"]), 3],
      ["an immediate 1, first", COUNTER(["  %zero:i32 = 0"], ["  %limit:i32 = 3"], ["  %next:i32 = add 1, %i"]), 3],
      ["no iteration", COUNTER(["  %zero:i32 = 9"], ["  %limit:i32 = 3"], STEP), 0],
      ["LOOP_MAX", COUNTER(["  %zero:i32 = 0"], ["  %limit:i32 = 4096"], STEP), 4096],
      ["the exit reads the entry", COUNTER(["  %zero:i32 = 0", "  %k:i32 = 2"], ["  %limit:i32 = 3"], STEP, ["  %r:i32 = add %i, %k", "  return %r"]), 3],
      ["the operands swapped", COUNTER(["  %zero:i32 = 0"], ["  %limit:i32 = 3"], STEP).replace("entry:%zero, body:%next", "body:%next, entry:%zero"), 3],
      ["the start in the header", COUNTER([], ["  %zero:i32 = 0", "  %limit:i32 = 3"], STEP), 3]
    ];
    for (const [label, text, count] of shapes) {
      const result = run(moduleOf(text));
      assert.equal(result.kind, "MIGRATED", `${label}: ${result.construct} ${result.typed_code}`);
      assert.match(result.output, new RegExp(`loop\\.fold @run__loop, %zero, ${count}\\n`, "u"), label);
      assert.equal(result.class, "EXACT_ON_SUCCESS", label);
    }
    const refused = [
      ["one past LOOP_MAX", COUNTER(["  %zero:i32 = 0"], ["  %limit:i32 = 4097"], STEP)],
      ["a step of 2", COUNTER(["  %zero:i32 = 0"], ["  %limit:i32 = 3"], ["  %next:i32 = add %i, 2"])],
      ["the step reads the entry", COUNTER(["  %zero:i32 = 0", "  %k:i32 = 1"], ["  %limit:i32 = 3"], ["  %next:i32 = add %i, %k"])],
      ["the body reads the entry", COUNTER(["  %zero:i32 = 0", "  %k:i32 = 4"], ["  %limit:i32 = 3"], ["  %s:i32 = add %i, %k", ...STEP])],
      ["the exit reads the header", COUNTER(["  %zero:i32 = 0"], ["  %limit:i32 = 3"], STEP, ["  return %limit"])],
      ["the exit reads the body", COUNTER(["  %zero:i32 = 0"], ["  %limit:i32 = 3"], ["  %one:i32 = 1", "  %next:i32 = add %i, %one"], ["  return %next"])],
      ["an immediate limit", COUNTER(["  %zero:i32 = 0"], ["  %limit:i32 = 3"], STEP).replace("i32.ge_s %i, %limit", "i32.ge_s %i, 3")],
      ["a test on another value", COUNTER(["  %zero:i32 = 0"], ["  %limit:i32 = 3"], STEP).replace("i32.ge_s %i, %limit", "i32.ge_s %limit, %i")],
      ["a parameter start", COUNTER([], ["  %limit:i32 = 3"], STEP).replace("run()", "run(zero: i32)")]
    ];
    for (const [label, text] of refused) {
      const result = run(moduleOf(text));
      assert.deepEqual([result.kind, result.construct, result.reason], ["REJECTED", "phi-loop", "not_admitted"], label);
    }
  });

  await vector("P0-11-CHECK-CONTROL-FLOW", async () => {
    // P11-R5: the smallest line among every never-admitted construct.
    const both = run(moduleOf(fnOf("f(c: bool, x: i32, y: i32) -> i32", ["br_if %c, a, b", "dead:", "  return %x", "a:", "  %r:i32 = phi.i32 entry:%x, b:%y", "  return %r", "b:", "  return %y"])));
    assert.deepEqual([both.construct, both.line], ["unstructured-cfg", 7], "the unreachable block's label comes first");
    const reversed = run(moduleOf(fnOf("f(c: bool) -> i32", ["br_if %c, b, a", "a:", "  return 1", "b:", "  return 2"])));
    assert.match(reversed.output, /if %c \{\n {4}yield 2\n {2}\} else \{\n {4}yield 1\n/u, "the then-arm is the branch's first label, wherever it sits");
    const refined = run(moduleOf(fnOf("f(c: bool) -> i32<0..5>", ["br_if %c, a, b", "a:", "  return 1", "b:", "  return 2"])));
    assert.match(refined.output, /%ret: i32<0\.\.5> = if %c/u);
    assert.equal(run(moduleOf(fnOf("f() -> i32", ["br_if true, a, b", "a:", "  return 1", "b:", "  return 2"]))).kind, "MIGRATED");
  });

  await vector("P0-11-CHECK-OPERATIONS", async () => {
    const aliases = [["add", "f32.add"], ["sub", "f32.sub"], ["mul", "f32.mul"], ["div", "f32.div"], ["min", "f32.min"], ["max", "f32.max"]];
    for (const [alias, full] of aliases) {
      const result = run(moduleOf(fnOf("f(a: f32) -> f32", [`%x:f32 = ${alias} %a, %a`, "return %x"])));
      const [item] = entryOf(result, full);
      assert.deepEqual([item.from, item.to, item.class], [alias, full, "EXACT"], alias);
    }
    const helper = run(moduleOf(fnOf("f(a: f32) -> f32", ["%x:f32 = clamp %a, %a, %a", "return %x"])));
    assert.deepEqual([entryOf(helper, "f32.clamp")[0].from, entryOf(helper, "f32.clamp")[0].to], ["clamp", "f32.max, f32.min"]);
    // P11-R23: a function line with two unmapped types reports the first in reading order.
    const types = run(moduleOf("func f(a: vec3, b: quat) -> i32 {\nentry:\n  %x:i32 = 1\n  return %x\n}\n\nexport func g() -> i32 {\nentry:\n  %x:i32 = 1\n  return %x\n}"));
    assert.deepEqual([types.construct, types.reason], ["type vec3", "not_admitted"]);
    assert.equal(run(moduleOf("export func f(a: i32) -> void {\nentry:\n  return\n}")).construct, "type void");
  });

  await vector("P0-11-CHECK-MODULE-IDENTITY", async () => {
    const text = moduleOf(fnOf("f() -> i32", ["%x:i32 = 1", "return %x"])).replace("module rule_check", "module Mapped");
    const mapped = run(text, { moduleId: "mapped.v2" });
    assert.match(mapped.output, /^module mapped\.v2\n/u);
    assert.deepEqual(mapped.parsed.options, { module_id: "mapped.v2" });
    const bad = run(text, { moduleId: "Bad" });
    assert.deepEqual([bad.construct, bad.reason, bad.parsed.options], ["module-identity", "not_admitted", { module_id: "Bad" }]);
    const replaced = run(moduleOf(fnOf("f() -> i32", ["%x:i32 = 1", "return %x"])), { moduleId: "other" });
    assert.match(replaced.output, /^module other\n/u, "a mapping replaces a valid id in the same way (P11-R7)");
    assert.deepEqual([entryOf(replaced, "module-identity")[0].from, entryOf(replaced, "module-identity")[0].to], ["rule_check", "other"]);
    const twice = run(moduleOf(fnOf("f() -> i32", ["%x:i32 = 1", "return %x"]), "capabilities { }\ncapabilities {}"));
    assert.deepEqual(entryOf(twice, "capabilities").map((item) => [item.line, item.from]), [[2, "capabilities { }"], [3, "capabilities {}"]]);
    const caps = run(moduleOf(fnOf("f() -> i32", ["%x:i32 = 1", "return %x"]), "capabilities { debug }"));
    assert.deepEqual([caps.construct, caps.line, caps.reason], ["capabilities", 2, "later_increment"]);
  });

  await vector("P0-11-CHECK-IMPORTS", async () => {
    const dir = fs.mkdtempSync(path.join(scratch, "imports-"));
    const write = (name, text) => {
      fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
      fs.writeFileSync(path.join(dir, name), text);
      return path.join(dir, name);
    };
    const leaf = (name, line = "%y:i32 = add %x, %x") => `module ${name}\ncapabilities { }\n\nfunc g(x: i32) -> i32 {\nentry:\n  ${line}\n  return %y\n}\n`;
    const importer = (uses, call = "@l.g(%x)") => `module top\n${uses.join("\n")}\ncapabilities { }\n\nexport func f(x: i32) -> i32 {\nentry:\n  %y:i32 = ${call}\n  return %y\n}\n`;

    // A file read twice has one `imports` row; the reported line is the smallest `use` line.
    write("d/leaf.air", leaf("leaf", "%y:f32 = f32.sin %x").replace(/x: i32\) -> i32/u, "x: f32) -> f32"));
    write("d/a.air", 'module a\nuse "./leaf.air" as l\ncapabilities { }\n\nfunc g(x: f32) -> f32 {\nentry:\n  %y:f32 = @l.g(%x)\n  return %y\n}\n');
    write("d/b.air", 'module b\nuse "./leaf.air" as l\ncapabilities { }\n\nfunc g(x: f32) -> f32 {\nentry:\n  %y:f32 = @l.g(%x)\n  return %y\n}\n');
    const diamond = write("d/top.air", 'module top\nuse "./a.air" as a\nuse "./b.air" as b\ncapabilities { }\n\nexport func f(x: f32) -> f32 {\nentry:\n  %y:f32 = @a.g(%x)\n  %z:f32 = @b.g(%y)\n  return %z\n}\n');
    const twice = migrateV053(fs.readFileSync(diamond), { path: diamond });
    const record = JSON.parse(twice.record);
    assert.deepEqual(record.imports.map((item) => item.path), ["a.air", "b.air", "leaf.air"], "sorted, one row each");
    assert.deepEqual(record.rejection.origin, { construct: "f32.sin", file: "leaf.air", line: 6 }, "the deepest construct is the origin");
    assert.equal(record.rejection.line, 2, "the smallest `use` line");

    // A refusal in a file two `use` lines reach: the smallest of the two (P11-R2 step 4).
    write("r/leaf.air", leaf("leaf", "%y:i32 = add %x, %nope"));
    write("r/a.air", 'module a\nuse "./leaf.air" as l\ncapabilities { }\n\nfunc g(x: i32) -> i32 {\nentry:\n  %y:i32 = @l.g(%x)\n  return %y\n}\n');
    write("r/b.air", 'module b\nuse "./leaf.air" as l\ncapabilities { }\n\nfunc g(x: i32) -> i32 {\nentry:\n  %y:i32 = @l.g(%x)\n  return %y\n}\n');
    const shared = write("r/top.air", 'module top\nuse "./a.air" as a\nuse "./b.air" as b\ncapabilities { }\n\nexport func f(x: i32) -> i32 {\nentry:\n  %y:i32 = @a.g(%x)\n  %z:i32 = @b.g(%y)\n  return %z\n}\n');
    const reached = JSON.parse(migrateV053(fs.readFileSync(shared), { path: shared }).record).rejection;
    assert.equal(reached.line, 2, "the smallest `use` line that reaches the file");
    assert.deepEqual(reached.origin, { construct: "legacy-invalid", file: "leaf.air", line: 6 });

    // `..` above the input's folder stays a path from that folder.
    write("up/lib.air", leaf("lib"));
    const above = write("up/deep/er/top.air", importer(['use "../../lib.air" as l']));
    assert.deepEqual(JSON.parse(migrateV053(fs.readFileSync(above), { path: above }).record).imports.map((item) => item.path), ["../../lib.air"]);

    // An absolute `use` keeps its path, and so does what that file brings in (P11-R3).
    const absolute = write("abs/lib.air", 'module lib\nuse "./inner.air" as i\ncapabilities { }\n\nfunc g(x: i32) -> i32 {\nentry:\n  %y:i32 = @i.g(%x)\n  return %y\n}\n');
    const inner = write("abs/inner.air", leaf("inner"));
    const viaAbsolute = write("abs/top/in.air", importer([`use "${absolute}" as l`]));
    assert.deepEqual(JSON.parse(migrateV053(fs.readFileSync(viaAbsolute), { path: viaAbsolute }).record).imports.map((item) => item.path), [absolute, inner].sort());

    // A cycle is a legacy refusal with its location; nothing of the host reaches the record.
    write("cyc/a.air", 'module a\nuse "./b.air" as b\ncapabilities { }\n\nfunc g(x: i32) -> i32 {\nentry:\n  return %x\n}\n');
    write("cyc/b.air", 'module b\nuse "./a.air" as a\ncapabilities { }\n\nfunc g(x: i32) -> i32 {\nentry:\n  return %x\n}\n');
    const cycle = write("cyc/top.air", importer(['use "./a.air" as l']));
    const cycled = JSON.parse(migrateV053(fs.readFileSync(cycle), { path: cycle }).record);
    assert.equal(cycled.rejection.construct, "legacy-invalid");
    assert.equal(cycled.rejection.line, 2);
    assert.deepEqual(cycled.rejection.origin, { construct: "legacy-invalid", file: "b.air", line: 2 });
    assert(!cycled.rejection.legacy_message.includes(dir), "no host path in the message");

    // An import that is a folder is an I/O failure: no record (P11-R2 step 4), and the CLI exits 1.
    fs.mkdirSync(path.join(dir, "io", "adir"), { recursive: true });
    const io = write("io/top.air", importer(['use "./adir" as l']));
    assert.throws(() => migrateV053(fs.readFileSync(io), { path: io }), (error) => error.syscall !== undefined);
    const recordFile = path.join(dir, "io", "record.json");
    const cli = runCli(["migrate", io, "--record", recordFile]);
    assert.equal(cli.status, 1);
    assert.equal(fs.existsSync(recordFile), false, "no record");
    assert.equal(runCli(["migrate", path.join(dir, "missing.air")]).status, 1, "an unreadable file exits 1");
  });

  await vector("P0-11-CHECK-CLI", async () => {
    const pkg = pkgOf("V53-MIG-P01_");
    const plainRun = runCli(["migrate", pkg.input]);
    assert.equal(plainRun.status, 0);
    assert.equal(plainRun.stdout, pkg.expectedOutput, "stdout is the output alone");
    assert.equal(plainRun.stderr, pkg.expectedRecord, "the record goes to stderr without --record");
    const refused = pkgOf("V53-MIG-N15_ii_");
    const noRecord = runCli(["migrate", refused.input]);
    assert.equal(noRecord.status, 1);
    assert.equal(noRecord.stdout, "");
    assert.equal(noRecord.stderr.split("\n").at(-2), refused.expectedRecord.trimEnd());
    for (const args of [["migrate"], ["migrate", pkg.input, "--module-id"], ["migrate", pkg.input, "--nope"]]) {
      const usage = runCli(args);
      assert.equal(usage.status, 1, args.join(" "));
      assert.match(usage.stderr, /air\.(cli|source_profile)\./u);
      assertNoRawError(usage.stderr, args.join(" "));
    }
  });

  await vector("P0-11-CHECK-DIAGNOSTICS", async () => {
    const hint = repairHintForDiagnosticCode(CODE);
    assert.equal(typeof hint, "string");
    for (const reason of ["later_increment", "not_admitted", "legacy_invalid"]) assert(hint.includes(reason), reason);
    const note = path.join(ROOT, "docs", "v0.53", "MIGRATION.md");
    if (fs.existsSync(note)) {
      const text = fs.readFileSync(note, "utf8");
      for (const word of ["EXACT_ON_SUCCESS", "LEGACY_DEFECT_CORRECTED", "later_increment", "not_admitted", "legacy_invalid", "airc migrate"]) assert(text.includes(word), word);
    }
  });

  await vector("P0-11-CHECK-FIXTURES", async () => {
    const listed = walkFiles(FIXTURES).filter((name) => name !== "witness.json");
    const text = listed.sort((a, b) => (a < b ? -1 : 1)).map((name) => `${hexOf(fs.readFileSync(path.join(FIXTURES, name)))}  ${name}\n`).join("");
    assert.equal(hexOf(text), FIXTURES_TREE_SHA256, "fixtures/v053/migration/** are the slice text's 103 files, plus witness.json");
    return { value: { files: listed.length } };
  });
}

const scratch = fs.mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "air-p011-"));

async function main() {
  if (process.argv[2] === "--second-run") {
    runSecondRunChild(process.argv[3]);
    return;
  }
  const projection = PROJECTIONS[require("../package.json").name];
  assert(projection, "package.json's name is neither projection's (AD-P11-1 (a))");
  const witness = readWitness();
  const packages = await sectionVectors(witness);
  await sectionProperty(packages);
  await sectionCorpus(witness, projection);
  await sectionRules();
  fs.rmSync(scratch, { force: true, recursive: true });
  const outDir = process.env.AIR_P011_VECTOR_RESULTS_DIR;
  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "v053_migration.results.json"), `${JSON.stringify(results, null, 2)}\n`);
  }
  const passed = results.filter((item) => item.status === "PASS").length;
  for (const result of results) {
    if (result.status === "FAIL") console.log(`not ok - ${result.vector}`);
    else console.log(`ok - ${result.vector} ${result.status}`);
  }
  if (failures.length) {
    for (const failure of failures) console.error(`not ok - ${failure}`);
    console.error(`typed-v0.53 P0-11 migration: ${failures.length} FAIL, ${passed} PASS`);
    process.exit(1);
  }
  console.log(`typed-v0.53 P0-11 migration: ${passed} PASS`);
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
