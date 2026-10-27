#!/usr/bin/env node
"use strict";

// typed-v0.53 SCALAR slice (AIR-0053-P0-SCALAR-0001): profile identity, the
// HD-4 scalar operations, formatter, diagnostics and LSP vectors.
// Every expected value below is copied from the R3.1 catalogue (VECTORS.md,
// sha256 f5353705...) or from the admitted slice text's VECTORS_ADDITIONS.md
// (frozen folder SHA256SUMS 66eac708...), never from the output of the
// implementation under test. Where a vector compares with H52_BASELINE, the
// baseline bytes are run from git objects (dev 94001cd / public 9c2b178).
// Set AIR_SCALAR_VECTOR_RESULTS_DIR=<dir> to write one canonical result record
// per vector.
const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const sp = require("../src/source_profile");
const parser = require("../src/parser");
const wb = require("../src/workbound");
const { AirLspSession } = require("../src/lsp_server");
const { buildVerifiedTypedModule, invokeVerifiedTypedExport } = require("../src/v052_verified_build");
const { lowerToWat, watToWasm } = require("../src/lower_wasm");
const { invokeV051TypedExport } = require("../src/v051_typed_runtime");
const { validatePackageManifest } = require("../src/package_manifest");

const ROOT = path.resolve(__dirname, "..");
const V053 = "typed-v0.53";
const GATED = Object.freeze({ allowCandidateProfile: true, sourceProfile: V053 });
const H52_BASELINE_COMMITS = ["94001cd1c822ccd914874c85543aa99e91d6ae4e", "9c2b1788a42f747bf6d61f2517c8348a7d519159"];
const results = [];
const failures = [];
const observedFailures = [];

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
// Sources. The VECTORS.md templates, written in canonical form (FMT-01: the
// checked-in source equals the canonical output).
const T2 = (op, A, B, R) => `module v53.vec\n\nexport func f(a: ${A}, b: ${B}) -> ${R} {\n  %o: ${R} = ${op} %a, %b\n  return %o\n}\n`;
const T1 = (op, A, R) => `module v53.vec\n\nexport func f(a: ${A}) -> ${R} {\n  %o: ${R} = ${op} %a\n  return %o\n}\n`;
const S2 = (op, x, y, R) => `module v53.vec\n\nexport func f() -> ${R} {\n  %o: ${R} = ${op} ${x}, ${y}\n  return %o\n}\n`;
const body = (params, ret, lines) => `module v53.vec\n\nexport func f(${params.map(([name, type]) => `${name}: ${type}`).join(", ")}) -> ${ret} {\n${lines.map((line) => `  ${line}`).join("\n")}\n}\n`;
// The templates exactly as VECTORS.md writes them (no blank line, no
// indentation): the stated line numbers of the STATIC_REJECT vectors refer to them.
const TV2 = (op, A, B, R) => `module v53.vec\nexport func f(a: ${A}, b: ${B}) -> ${R} {\n%o: ${R} = ${op} %a, %b\nreturn %o\n}\n`;
const TV1 = (op, A, R) => `module v53.vec\nexport func f(a: ${A}) -> ${R} {\n%o: ${R} = ${op} %a\nreturn %o\n}\n`;
const SV2 = (op, x, y, R) => `module v53.vec\nexport func f() -> ${R} {\n%o: ${R} = ${op} ${x}, ${y}\nreturn %o\n}\n`;
const bodyV = (params, ret, lines) => `module v53.vec\nexport func f(${params.map(([name, type]) => `${name}: ${type}`).join(", ")}) -> ${ret} {\n${lines.join("\n")}\n}\n`;

function descriptorFor(params, returnType) {
  return {
    air_abi_lane: "0.12", module_id: "v53.vec", schema: "air.typed-interface/0.12-candidate.1", types: [],
    exports: [{ function: "f", name: "f", parameters: params.map(([name, type]) => ({ name, type })), return_type: returnType }]
  };
}

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

// STATIC_REJECT: the stated code, its `code:` delimiter and the source location.
function staticReject(source, code, line) {
  const error = captureFailure(() => typedV053(source));
  assert(error, `expected ${code}, got VERIFIED`);
  assert.equal(error.code, code);
  assert.match(String(error.message), new RegExp(`${code.replace(/\./g, "\\.")}:`));
  assert(error.loc && Number.isInteger(error.loc.line), "a static failure carries a source location");
  if (line !== undefined) assert.equal(error.loc.line, line);
  assert(!(error instanceof TypeError) && !(error instanceof RangeError));
  observedFailures.push({ code: error.code, kind: "STATIC_REJECT", line: error.loc.line });
  return { code: error.code, line: error.loc.line };
}

const builds = new Map();
async function build(source, params, returnType) {
  const key = `${source}\u0000${returnType}`;
  if (!builds.has(key)) {
    builds.set(key, await buildVerifiedTypedModule({ ...GATED, descriptor: descriptorFor(params, returnType), source }));
  }
  return builds.get(key);
}

async function invoke(source, params, returnType, args) {
  const verified = await build(source, params, returnType);
  try {
    return { value: (await invokeVerifiedTypedExport(verified, "f", args)).value };
  } catch (error) {
    assert(typeof error.code === "string" && error.code.startsWith("air."), `raw invocation error: ${error && error.stack}`);
    observedFailures.push({ code: error.code, kind: "RUNTIME_FAIL" });
    return { code: error.code, reason: error.reason || null };
  }
}

async function accept(source, params, returnType, cases) {
  const values = [];
  for (const [args, expected] of cases) {
    const outcome = await invoke(source, params, returnType, args);
    assert.deepEqual(outcome, { value: expected }, `f(${JSON.stringify(args)})`);
    values.push({ args, value: outcome.value });
  }
  return { value: values, sourceDigest: sha256(source) };
}

async function runtimeFail(source, params, returnType, cases) {
  const values = [];
  for (const [args, reason] of cases) {
    const outcome = await invoke(source, params, returnType, args);
    assert.deepEqual(outcome, { code: "air.numeric.checked_failure", reason }, `f(${JSON.stringify(args)})`);
    values.push({ args, ...outcome });
  }
  return { value: values, sourceDigest: sha256(source) };
}

function runCli(args, options = {}) {
  return childProcess.spawnSync(process.execPath, [path.join(options.root || ROOT, "bin", "airc.js"), ...args], {
    cwd: options.cwd || ROOT, encoding: "utf8", env: options.env || process.env, maxBuffer: 64 * 1024 * 1024
  });
}

// H52_BASELINE comparison: the baseline src tree is extracted from git objects
// into a temporary directory and run in a child process on the same bytes.
function baselineSrc(tmp) {
  const dir = path.join(tmp, "h52");
  if (fs.existsSync(path.join(dir, "src"))) return dir;
  for (const commit of H52_BASELINE_COMMITS) {
    const probe = childProcess.spawnSync("git", ["cat-file", "-e", `${commit}^{commit}`], { cwd: ROOT });
    if (probe.status !== 0) continue;
    fs.mkdirSync(dir, { recursive: true });
    const archive = childProcess.spawnSync("sh", ["-c", `git archive ${commit} src | tar -x -C "${dir}"`], { cwd: ROOT, encoding: "utf8" });
    if (archive.status === 0) {
      fs.writeFileSync(path.join(dir, "COMMIT"), commit);
      return dir;
    }
  }
  return null;
}

function runProbe(srcDir, probe, input) {
  const script = `"use strict";
const path = require("path");
const src = process.argv[2];
const input = JSON.parse(process.argv[3]);
const r = (m) => require(path.join(src, m));
function outcome(action) {
  try { const value = action(); return { ok: true, value: value === undefined ? null : value }; }
  catch (error) { return { ok: false, code: error && error.code || null, name: error && error.name || null, message: String(error && error.message) }; }
}
const probes = {
  legacyParseVerify: () => outcome(() => { const sp = r("source_profile.js"); const mod = sp.parseSource(input.source, input.file); sp.verifySource(mod); return "VERIFIED"; }),
  parseV051Air: () => outcome(() => { const mod = r("parser.js").parseV051Air(input.source, input.file); let verify; try { r("verifier.js").verifyV051Air(mod); verify = "VERIFIED"; } catch (error) { verify = { code: error.code || null, message: String(error.message) }; } return { ast: JSON.parse(JSON.stringify(mod, (k, v) => v instanceof Set ? [...v] : v)), verify }; })
};
process.stdout.write(JSON.stringify(probes[input.probe]()));
`;
  const file = path.join(os.tmpdir(), `air-scalar-probe-${crypto.randomBytes(4).toString("hex")}.js`);
  fs.writeFileSync(file, script);
  try {
    const out = childProcess.spawnSync(process.execPath, [file, srcDir, JSON.stringify({ ...input, probe })], {
      encoding: "utf8", env: { ...process.env, NODE_PATH: path.join(ROOT, "node_modules") }, maxBuffer: 64 * 1024 * 1024
    });
    assert.equal(out.status, 0, out.stderr);
    return JSON.parse(out.stdout);
  } finally {
    fs.rmSync(file, { force: true });
  }
}

// R-DIAG-2: the registry of every code typed-v0.53 emits at SCALAR. The
// human-readable registry is docs/v0.53/SCALAR.md §6 (a dev-side note, not
// part of the PF-2 projection); where it exists, it must list exactly these codes.
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

function registryCodes() {
  const registry = new Set(SCALAR_CODE_REGISTRY);
  const notePath = path.join(ROOT, "docs", "v0.53", "SCALAR.md");
  if (fs.existsSync(notePath)) {
    const note = fs.readFileSync(notePath, "utf8");
    const section = note.slice(note.indexOf("## 6. Registry"), note.indexOf("## 7."));
    const documented = new Set([...section.matchAll(/^\| `(air\.[a-z0-9_.]+)` \|/gmu)].map((match) => match[1]));
    assert.deepEqual([...documented].sort(), [...registry].sort(), "the documented registry lists exactly the SCALAR codes");
  }
  return registry;
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "air-v053-scalar-"));
  try {
    // ------------------------------------------------------------------
    // PROF — profile identity (RFC §2.2-§2.4).
    const decideSource = fs.readFileSync(path.join(ROOT, "fixtures/v051/first_vertical/typed_decide.air"), "utf8");
    await vector("V53-PROF-P01", async () => {
      // decide(0)=0, decide(1)=1; option_identity(1,42)=[1,42]; identical to typed-v0.51 (FROZEN D11).
      const run = async (mod) => {
        const wasm = await watToWasm(lowerToWat(mod, { maxWatBytes: 4194304 }), "typed_decide.air");
        const { instance } = await WebAssembly.instantiate(wasm, {});
        return {
          decide: [instance.exports.decide(0), instance.exports.decide(1)],
          option_identity: instance.exports.option_identity(1, 42)
        };
      };
      const v053 = await run(typedV053(decideSource, "typed_decide.air"));
      assert.deepEqual(v053, { decide: [0, 1], option_identity: [1, 42] });
      const v051Mod = sp.parseSource(decideSource, "typed_decide.air", { sourceProfile: "typed-v0.51" });
      sp.verifySource(v051Mod, { sourceProfile: "typed-v0.51" });
      assert.deepEqual(await run(v051Mod), v053, "identical to typed-v0.51");
      return { value: v053, sourceDigest: sha256(decideSource) };
    });
    await vector("V53-PROF-N01", async () => {
      const source = T2("i32.checked_add", "i32", "i32", "i32");
      const sdk = captureFailure(() => sp.parseSource(source, "f.air", { sourceProfile: V053 }));
      assert.equal(sdk && sdk.code, "air.source_profile.candidate_disabled");
      const file = path.join(tmp, "n01.air");
      fs.writeFileSync(file, source);
      const cli = runCli(["verify", file, "--source-profile", V053]);
      assert.notEqual(cli.status, 0);
      assert.match(cli.stderr, /^air\.source_profile\.candidate_disabled:/mu);
      const builder = await buildVerifiedTypedModule({ descriptor: descriptorFor([["a", "i32"], ["b", "i32"]], "i32"), source, sourceProfile: V053 }).then(() => null, (error) => error);
      assert.equal(builder && builder.code, "air.source_profile.candidate_disabled");
      return { value: { builder: builder.code, cli: "air.source_profile.candidate_disabled", sdk: sdk.code } };
    });
    // The VECTORS.md template text (R-8: the module id the legacy parser meets first is v53.vec).
    const wrappingTemplate = "module v53.vec\nexport func f(a: i32, b: i32) -> i32 {\n%o: i32 = i32.wrapping_add %a, %b\nreturn %o\n}\n";
    await vector("V53-PROF-N02", () => {
      const current = runProbe(path.join(ROOT, "src"), "legacyParseVerify", { file: "n02.air", source: wrappingTemplate });
      const dir = baselineSrc(tmp);
      if (!dir) return { status: "ENVIRONMENT_UNAVAILABLE", value: { reason: "H52_BASELINE git objects unavailable" } };
      const baseline = runProbe(path.join(dir, "src"), "legacyParseVerify", { file: "n02.air", source: wrappingTemplate });
      assert.equal(current.ok, false, "the default profile is not promoted");
      assert.deepEqual(current, baseline, "unchanged legacy diagnostic (equal to H52_BASELINE)");
      return { value: { baseline_commit: fs.readFileSync(path.join(dir, "COMMIT"), "utf8"), result: current }, sourceDigest: sha256(wrappingTemplate) };
    });
    await vector("V53-PROF-N03", () => {
      const sdk = captureFailure(() => sp.parseSource("module m\n", "m.air", { sourceProfile: "typed-v0.52" }));
      assert.equal(sdk && sdk.code, "air.source_profile.unsupported");
      const file = path.join(tmp, "n03.air");
      fs.writeFileSync(file, T2("i32.checked_add", "i32", "i32", "i32"));
      const cli = runCli(["verify", file, "--source-profile", "typed-v0.52"]);
      assert.notEqual(cli.status, 0);
      assert.match(cli.stderr, /^air\.source_profile\.unsupported:/mu);
      return { value: { cli: "air.source_profile.unsupported", sdk: sdk.code } };
    });
    await vector("V53-PROF-N04", () => {
      const source = T2("i32.checked_add", "i32", "i32", "i32");
      const error = captureFailure(() => {
        const mod = sp.parseSource(source, "n04.air", { sourceProfile: "typed-v0.51" });
        sp.verifySource(mod, { sourceProfile: "typed-v0.51" });
      });
      assert.equal(error && error.code, "air.v051.typed_atom_invalid");
      return { value: { code: error.code } };
    });
    await vector("V53-PROF-N05", () => {
      const mod = typedV053(T2("i32.checked_add", "i32", "i32", "i32"));
      const error = captureFailure(() => sp.formatSource(mod, { sourceProfile: "legacy-v0.50" }));
      assert(error && !(error instanceof TypeError));
      assert.equal(error.code, "air.source_profile.ast_mismatch");
      return { value: { code: error.code } };
    });
    await vector("V53-PROF-N06", () => {
      const current = runProbe(path.join(ROOT, "src"), "parseV051Air", { file: "n06.air", source: wrappingTemplate });
      const sdkAst = parser.parseV051Air(wrappingTemplate, "n06.air");
      assert.notEqual(sdkAst.sourceProfile, V053, "never a typed-v0.53 AST");
      const dir = baselineSrc(tmp);
      if (!dir) return { status: "ENVIRONMENT_UNAVAILABLE", value: { reason: "H52_BASELINE git objects unavailable" } };
      const baseline = runProbe(path.join(dir, "src"), "parseV051Air", { file: "n06.air", source: wrappingTemplate });
      assert.deepEqual(current, baseline, "the same result as H52_BASELINE");
      assert.notEqual(current.value && current.value.verify, "VERIFIED", "typed-v0.51 rejects");
      return { value: { baseline_commit: fs.readFileSync(path.join(dir, "COMMIT"), "utf8"), verify: current.value.verify }, sourceDigest: sha256(wrappingTemplate) };
    });
    await vector("V53-PROF-N07", () => {
      const source = T2("i32.checked_add", "i32", "i32", "i32");
      typedV053(source, "main.air");
      const dir = path.join(tmp, "n07");
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, "main.air"), source);
      fs.writeFileSync(path.join(dir, "air.package.json"), `${JSON.stringify({ airAbi: "0.12", entry: "main.air", hostAbi: "0.10", name: "v53.vec", version: "0.1.0" }, null, 2)}\n`);
      let messages;
      try {
        messages = validatePackageManifest(dir).errors || [];
      } catch (error) {
        messages = error.errors || [String(error.message)];
      }
      assert(messages.some((message) => /^air\.v051\.abi_candidate_disabled:/u.test(message)), messages.join("\n"));
      return { value: { manifest: "air.v051.abi_candidate_disabled", profile_gate: "passed" } };
    });
    await vector("V53-PROF-N08", () => {
      // A scratch copy with the kill switch on (OD-7 (a)); the committed tree keeps it off.
      const copy = path.join(tmp, "killswitch");
      fs.mkdirSync(copy);
      fs.cpSync(path.join(ROOT, "src"), path.join(copy, "src"), { recursive: true });
      fs.cpSync(path.join(ROOT, "bin"), path.join(copy, "bin"), { recursive: true });
      const profileFile = path.join(copy, "src", "source_profile.js");
      const text = fs.readFileSync(profileFile, "utf8");
      assert.equal(text.split("const disable_typed_v053_profile = false;").length, 2, "exactly one kill-switch constant, off");
      fs.writeFileSync(profileFile, text.replace("const disable_typed_v053_profile = false;", "const disable_typed_v053_profile = true;"));
      const env = { ...process.env, NODE_PATH: path.join(ROOT, "node_modules") };
      const file = path.join(tmp, "n08.air");
      fs.writeFileSync(file, T2("i32.checked_add", "i32", "i32", "i32"));
      const a = runCli(["verify", file, "--source-profile", V053, "--allow-candidate-profile"], { env, root: copy });
      const b = runCli(["verify", file, "--source-profile", V053], { env, root: copy });
      assert.match(a.stderr, /^air\.source_profile\.unsupported:/mu);
      assert.match(b.stderr, /^air\.source_profile\.unsupported:/mu);
      const sdkScript = path.join(copy, "sdk.js");
      fs.writeFileSync(sdkScript, `"use strict";
const sp = require("./src/source_profile");
try { sp.parseSource(require("fs").readFileSync(process.argv[2], "utf8"), "f.air", { allowCandidateProfile: true, sourceProfile: "typed-v0.53" }); process.stdout.write("parsed"); }
catch (error) { process.stdout.write(String(error.code)); }
`);
      const c = childProcess.spawnSync(process.execPath, [sdkScript, file], { encoding: "utf8", env });
      assert.equal(c.stdout, "air.source_profile.unsupported");
      // (d) legacy-v0.50 and typed-v0.51 are unaffected.
      const legacy = path.join(ROOT, "examples", "grep.air");
      for (const args of [["verify", path.join(ROOT, "fixtures/v051/first_vertical/typed_decide.air"), "--source-profile", "typed-v0.51"],
        ["fmt", path.join(ROOT, "fixtures/v051/first_vertical/typed_decide.air"), "--source-profile", "typed-v0.51"],
        ["verify", legacy], ["fmt", legacy]]) {
        const on = runCli(args, { env, root: copy });
        const off = runCli(args);
        assert.deepEqual({ status: on.status, stderr: on.stderr, stdout: on.stdout }, { status: off.status, stderr: off.stderr, stdout: off.stdout }, args.join(" "));
      }
      // Control on the committed tree.
      const controlA = runCli(["verify", file, "--source-profile", V053, "--allow-candidate-profile"]);
      const controlB = runCli(["verify", file, "--source-profile", V053]);
      assert.equal(controlA.status, 0, controlA.stderr);
      assert.match(controlB.stderr, /^air\.source_profile\.candidate_disabled:/mu);
      return { value: { committed: { a: "VERIFIED", b: "air.source_profile.candidate_disabled" }, switch_on: { a: "air.source_profile.unsupported", b: "air.source_profile.unsupported", c: c.stdout, d: "identical" } } };
    });
    // V53-PROF-R01/R02/R03 run as their own commands (evidence logs): the frozen
    // matrix by name and the typed-v0.51 corpus comparisons.
    results.push(resultRecord("V53-PROF-R01", "PASS_BY_COMMAND_LOGS", { commands: ["node test/v051_frozen_conformance_matrix.test.js", "node test/v051_checked_numeric_runtime.test.js"] }));

    // ------------------------------------------------------------------
    // SCL — RFC §5 (EXACT / IEEE expectations from VECTORS.md).
    const I2 = [["a", "i32"], ["b", "i32"]];
    const addSrc = T2("i32.checked_add", "i32", "i32", "i32");
    await vector("V53-SCL-P01", () => accept(addSrc, I2, "i32", [[[2147483646, 1], 2147483647]]));
    await vector("V53-SCL-N01", () => runtimeFail(addSrc, I2, "i32", [[[2147483647, 1], "overflow"]]));
    await vector("V53-SCL-N02", () => ({ value: staticReject(SV2("i32.checked_add", "2147483647", "1", "i32"), "air.numeric.checked_failure", 3) }));
    await vector("V53-SCL-N03", () => runtimeFail(T2("i32.checked_sub", "i32", "i32", "i32"), I2, "i32", [[[-2147483648, 1], "overflow"]]));
    const mulSrc = T2("i32.checked_mul", "i32", "i32", "i32");
    await vector("V53-SCL-N04", () => runtimeFail(mulSrc, I2, "i32", [[[65536, 65536], "overflow"]]));
    await vector("V53-SCL-P02", () => accept(mulSrc, I2, "i32", [[[46340, 46340], 2147395600]]));
    const divSrc = T2("i32.checked_div_s", "i32", "i32", "i32");
    await vector("V53-SCL-N05", () => runtimeFail(divSrc, I2, "i32", [[[7, 0], "division_by_zero"]]));
    await vector("V53-SCL-N06", () => runtimeFail(divSrc, I2, "i32", [[[-2147483648, -1], "overflow"]]));
    await vector("V53-SCL-P03", () => accept(divSrc, I2, "i32", [[[-7, 2], -3]]));
    const remSrc = T2("i32.checked_rem_s", "i32", "i32", "i32");
    await vector("V53-SCL-P04", () => accept(remSrc, I2, "i32", [[[-7, 2], -1]]));
    await vector("V53-SCL-P05", () => accept(remSrc, I2, "i32", [[[-2147483648, -1], 0]]));
    await vector("V53-SCL-N07", () => runtimeFail(remSrc, I2, "i32", [[[1, 0], "division_by_zero"]]));
    await vector("V53-SCL-P06", () => accept(T2("i32.wrapping_add", "i32", "i32", "i32"), I2, "i32", [[[2147483647, 1], -2147483648]]));
    await vector("V53-SCL-P07", () => accept(T2("i32.wrapping_sub", "i32", "i32", "i32"), I2, "i32", [[[-2147483648, 1], 2147483647]]));
    await vector("V53-SCL-P08", () => accept(T2("i32.wrapping_mul", "i32", "i32", "i32"), I2, "i32", [[[65536, 65536], 0]]));
    await vector("V53-SCL-P09", () => accept(S2("i32.wrapping_add", "2147483647", "1", "i32"), [], "i32", [[[], -2147483648]]));
    await vector("V53-SCL-N08", () => ({ value: staticReject(TV2("i32.wrapping_div_s", "i32", "i32", "i32"), "air.numeric.operation_invalid") }));
    await vector("V53-SCL-N09", () => ({ value: staticReject(TV2("i32.add", "i32", "i32", "i32"), "air.numeric.operation_mode_required") }));
    await vector("V53-SCL-N10", () => ({ value: staticReject(TV2("add", "i32", "i32", "i32"), "air.numeric.operation_mode_required") }));
    await vector("V53-SCL-P10", async () => ({
      value: [
        await accept(T2("i32.and", "i32", "i32", "i32"), I2, "i32", [[[12, 10], 8]]),
        await accept(T2("i32.or", "i32", "i32", "i32"), I2, "i32", [[[12, 10], 14]]),
        await accept(T2("i32.xor", "i32", "i32", "i32"), I2, "i32", [[[12, 10], 6]])
      ].map((item) => item.value)
    }));
    const shlSrc = T2("i32.shl", "i32", "i32", "i32");
    await vector("V53-SCL-P11", () => accept(shlSrc, I2, "i32", [[[1, 31], -2147483648]]));
    await vector("V53-SCL-P12", () => accept(T2("i32.shr_u", "i32", "i32", "i32"), I2, "i32", [[[-1, 28], 15]]));
    await vector("V53-SCL-P13", () => accept(shlSrc, I2, "i32", [[[1, 33], 2]]));
    await vector("V53-SCL-P14", async () => ({
      value: [
        await accept(T2("i32.lt_s", "i32", "i32", "bool"), I2, "bool", [[[-1, 0], true]]),
        await accept(T2("i32.ge_s", "i32", "i32", "bool"), I2, "bool", [[[-2147483648, 2147483647], false]]),
        await accept(T2("i32.eq", "i32", "i32", "bool"), I2, "bool", [[[5, 5], true]]),
        await accept(T2("i32.ne", "i32", "i32", "bool"), I2, "bool", [[[5, 5], false]])
      ].map((item) => item.value)
    }));
    const toF32Src = T1("i32.to_f32_checked", "i32", "f32");
    await vector("V53-SCL-P15", () => accept(toF32Src, [["a", "i32"]], "f32", [[[16777216], { bits: "4b800000", type: "f32" }]]));
    await vector("V53-SCL-N11", () => runtimeFail(toF32Src, [["a", "i32"]], "f32", [[[16777217], "invalid_conversion"]]));
    const truncSrc = T1("f32.trunc_to_i32_checked", "f32", "i32");
    await vector("V53-SCL-P16", () => accept(truncSrc, [["a", "f32"]], "i32", [[[f32(-2.5)], -2], [[f32(2147483520.0)], 2147483520]]));
    await vector("V53-SCL-N12", () => runtimeFail(truncSrc, [["a", "f32"]], "i32", [[[f32(2147483648.0)], "invalid_conversion"], [[f32(Number.NaN)], "invalid_conversion"]]));
    const bits = (hex) => ({ bits: hex, type: "f32" });
    await vector("V53-SCL-P17", () => accept(S2("f32.add", "1.0", "0.000000059604644775390625", "f32"), [], "f32", [[[], bits("3f800000")]]));
    await vector("V53-SCL-P18", () => accept(S2("f32.sub", "1.0", "0.5", "f32"), [], "f32", [[[], bits("3f000000")]]));
    await vector("V53-SCL-P19", () => accept(S2("f32.mul", "1.5", "0.5", "f32"), [], "f32", [[[], bits("3f400000")]]));
    await vector("V53-SCL-P20", () => accept(S2("f32.div", "1.0", "3.0", "f32"), [], "f32", [[[], bits("3eaaaaab")]]));
    await vector("V53-SCL-P21", () => accept(S2("f32.eq", "0.0", "-0.0", "bool"), [], "bool", [[[], true]]));
    await vector("V53-SCL-P22", async () => ({
      value: [
        await accept(body([], "bool", ["%n: f32 = f32.div 0.0, 0.0", "%o: bool = f32.lt %n, 1.0", "return %o"]), [], "bool", [[[], false]]),
        await accept(body([], "bool", ["%n: f32 = f32.div 0.0, 0.0", "%o: bool = f32.ne %n, %n", "return %o"]), [], "bool", [[[], true]])
      ].map((item) => item.value)
    }));
    await vector("V53-SCL-P23", async () => ({
      value: [
        await accept(S2("f32.min", "-0.0", "0.0", "f32"), [], "f32", [[[], bits("80000000")]]),
        await accept(S2("f32.max", "-0.0", "0.0", "f32"), [], "f32", [[[], bits("00000000")]])
      ].map((item) => item.value)
    }));
    await vector("V53-SCL-P24", async () => ({
      value: [
        await accept(S2("f32.div", "1.0", "0.0", "f32"), [], "f32", [[[], bits("7f800000")]]),
        await accept(S2("f32.mul", "3.4028234663852886e38", "2.0", "f32"), [], "f32", [[[], bits("7f800000")]])
      ].map((item) => item.value)
    }));
    await vector("V53-SCL-P25", () => accept(body([], "f32", ["%n: f32 = f32.div 0.0, 0.0", "%o: f32 = f32.min %n, 1.0", "return %o"]), [], "f32", [[[], { classification: "nan", type: "f32" }]]));
    const F3 = [["a", "f32"], ["b", "f32"], ["c", "f32"]];
    const ternary = (op) => bodyV(F3, "f32", [`%o: f32 = ${op} %a, %b, %c`, "return %o"]);
    await vector("V53-SCL-N13", () => ({
      value: [
        staticReject(TV1("f32.sin", "f32", "f32"), "air.numeric.operation_invalid"),
        staticReject(TV1("f32.cos", "f32", "f32"), "air.numeric.operation_invalid"),
        staticReject(ternary("f32.clamp"), "air.numeric.operation_invalid"),
        staticReject(ternary("f32.lerp"), "air.numeric.operation_invalid"),
        staticReject(ternary("f32.inverse_lerp"), "air.numeric.operation_invalid"),
        staticReject(TV1("ease.smoothstep", "f32", "f32"), "air.numeric.operation_invalid"),
        staticReject(TV1("ease.out_quad", "f32", "f32"), "air.numeric.operation_invalid")
      ]
    }));
    await vector("V53-SCL-N21", () => ({ value: staticReject(TV1("f32.sqrt", "f32", "f32"), "air.numeric.operation_invalid") }));
    await vector("V53-SCL-N22", () => ({
      value: [
        staticReject(bodyV([["x", "f32"]], "i32", ["%o: i32 = i32.reinterpret_f32 %x", "return %o"]), "air.numeric.operation_invalid"),
        staticReject(bodyV([["y", "i32"]], "f32", ["%o: f32 = f32.reinterpret_i32 %y", "return %o"]), "air.numeric.operation_invalid")
      ]
    }));
    const lerpSrc = body(F3.map(([, type], index) => [["a", "b", "t"][index], type]), "f32", ["%d: f32 = f32.sub %b, %a", "%m: f32 = f32.mul %d, %t", "%o: f32 = f32.add %m, %a", "return %o"]);
    await vector("V53-SCL-P30", () => accept(lerpSrc, [["a", "f32"], ["b", "f32"], ["t", "f32"]], "f32", [
      [[f32(0.0), f32(10.0), f32(0.25)], bits("40200000")],
      [[f32(1e8), f32(0.3), f32(1.0)], bits("00000000")]
    ]));
    await vector("V53-SCL-N14", () => ({ value: staticReject(TV2("f64.add", "f64", "f64", "f64"), "air.numeric.operation_invalid") }));
    const B2 = [["a", "bool"], ["b", "bool"]];
    await vector("V53-SCL-P26", async () => ({
      value: [
        await accept(T2("bool.and", "bool", "bool", "bool"), B2, "bool", [[[true, false], false]]),
        await accept(T2("bool.or", "bool", "bool", "bool"), B2, "bool", [[[true, false], true]]),
        await accept(T1("bool.not", "bool", "bool"), [["a", "bool"]], "bool", [[[false], true]])
      ].map((item) => item.value)
    }));
    await vector("V53-SCL-P27", async () => ({
      value: [
        await accept(body([["c", "bool"], ["a", "i32"], ["b", "i32"]], "i32", ["%o: i32 = select.i32 %c, %a, %b", "return %o"]),
          [["c", "bool"], ["a", "i32"], ["b", "i32"]], "i32", [[[true, 1, 2], 1], [[false, 1, 2], 2]]),
        await accept(body([["c", "bool"], ["a", "f32"], ["b", "f32"]], "f32", ["%o: f32 = select.f32 %c, %a, %b", "return %o"]),
          [["c", "bool"], ["a", "f32"], ["b", "f32"]], "f32", [[[true, f32(-0.0), f32(1.0)], bits("80000000")]])
      ].map((item) => item.value)
    }));
    await vector("V53-SCL-N16", () => ({ value: staticReject(bodyV([["x", "i32"], ["a", "i32"], ["b", "i32"]], "i32", ["%o: i32 = select.i32 %x, %a, %b", "return %o"]), "air.v051.typed_atom_type_mismatch") }));
    await vector("V53-SCL-N19", () => ({ value: staticReject(bodyV([["c", "bool"], ["a", "i32"], ["w", "i64"]], "i32", ["%o: i32 = select.i32 %c, %a, %w", "return %o"]), "air.v051.typed_atom_type_mismatch") }));
    // R-7: the checked-in source lists `false => 2` first (canonical order).
    const matchSrc = body([["c", "bool"]], "i32", ["%o: i32 = match %c {", "  false => 2,", "  true => 1,", "}", "return %o"]);
    const matchVectorsText = "module v53.vec\nexport func f(c: bool) -> i32 {\n%o: i32 = match %c {\ntrue => 1,\nfalse => 2,\n}\nreturn %o\n}\n";
    await vector("V53-SCL-P28", async () => {
      const outcome = await accept(matchSrc, [["c", "bool"]], "i32", [[[true], 1], [[false], 2]]);
      assert.equal(sp.formatSource(typedV053(matchVectorsText), GATED), matchSrc, "the VECTORS.md text formats to the checked-in canonical order");
      return outcome;
    });
    await vector("V53-SCL-N17", () => {
      const outcome = staticReject(bodyV([["c", "bool"]], "i32", ["%o: i32 = match %c {", "true => 1,", "}", "return %o"]), "air.decision.match_nonexhaustive");
      return { value: { ...outcome, code_set: true } };
    });
    await vector("V53-SCL-N18", async () => {
      // R-5: the frozen N32 code on the lane-level reference path, and the same
      // code through the verified runtime for the value 2 in the bool parameter.
      const wasm = await watToWasm(lowerToWat(typedV053(matchSrc), { maxWatBytes: 4194304 }), "n18.air");
      const { instance } = await WebAssembly.instantiate(wasm, {});
      const lane = captureFailure(() => invokeV051TypedExport(instance, "f", [2], { airReason: "air.v051.typed_value_invalid" }));
      assert.equal(lane && lane.code, "air.v051.typed_value_invalid");
      const verified = await build(matchSrc, [["c", "bool"]], "i32");
      const runtime = await invokeVerifiedTypedExport(verified, "f", [2]).then(() => null, (error) => error);
      assert.equal(runtime && runtime.code, "air.v051.typed_value_invalid");
      observedFailures.push({ code: runtime.code, kind: "RUNTIME_FAIL" });
      return { value: { lane_level: lane.code, verified_runtime: runtime.code } };
    });
    const literalSrc = body([], "f32", ["%x: f32 = 1", "return %x"]);
    await vector("V53-SCL-P29", async () => {
      const outcome = await accept(literalSrc, [], "f32", [[[], bits("3f800000")]]);
      const formatted = sp.formatSource(typedV053(literalSrc), GATED);
      assert.match(formatted, /^ {2}%x: f32 = 1\.0$/mu);
      return { ...outcome, value: { formatted_line: "%x: f32 = 1.0", values: outcome.value } };
    });
    await vector("V53-SCL-N20", () => ({
      value: [
        staticReject(TV2("fixed.mul_i32", "i32", "i32", "i32"), "air.numeric.operation_invalid"),
        staticReject(TV2("physics.damp_i32", "i32", "i32", "i32"), "air.numeric.operation_invalid")
      ]
    }));
    await vector("V53-SCL-WB01", async () => {
      const verified = await build(addSrc, I2, "i32");
      const bound = wb.inspectBoundWorkBound(verified);
      assert.deepEqual(bound.record.entries.f, wb.canonicalSummary(wb.summary({ steps: 2n })));
      assert.equal(bound.key.profile, V053);
      assert.equal(bound.key.cost_table_digest, "sha256:d8b341ea2358a787d699507a5dca9ce6cab0d58e3358d324df4c5ff8e469760e");
      return { value: { E_f: bound.record.entries.f, key_profile: bound.key.profile }, sourceDigest: sha256(addSrc) };
    });
    // Reviewed additions (VECTORS_ADDITIONS.md §2; slice text R-16).
    await vector("V53-SCL-N23", () => ({ value: staticReject(bodyV([], "i32", ["%x: i32 = 2147483647", "%o: i32 = i32.checked_add %x, 1", "return %o"]), "air.numeric.checked_failure", 4) }));
    await vector("V53-SCL-N24", () => ({ value: staticReject(bodyV([], "f32", ["%o: f32 = i32.to_f32_checked 16777217", "return %o"]), "air.numeric.checked_failure", 3) }));
    await vector("V53-SCL-N25", () => runtimeFail(body([], "i32", ["%o: i32 = f32.trunc_to_i32_checked 2147483648.0", "return %o"]), [], "i32", [[[], "invalid_conversion"]]));
    await vector("V53-SCL-N26", () => runtimeFail(body([], "i32", ["%x: i32 = i32.wrapping_add 2147483647, 0", "%o: i32 = i32.checked_add %x, 1", "return %o"]), [], "i32", [[[], "overflow"]]));

    // ------------------------------------------------------------------
    // FMT — R-FMT-1 (OPEN-3 (a), OPEN-4 (a)).
    const acceptSources = [...new Set([...builds.keys()].map((key) => key.split("\u0000")[0]))];
    await vector("V53-FMT-01", () => {
      // V53-SCL-P29 prescribes the non-canonical input `%x: f32 = 1` to test the
      // OPEN-4 normalization, so, like a frozen input (R-6), it is judged by
      // idempotence (reading recorded for QA in the evidence).
      const prescribedNonCanonical = new Set([literalSrc]);
      for (const source of acceptSources) {
        const once = sp.formatSource(typedV053(source), GATED);
        if (!prescribedNonCanonical.has(source)) assert.equal(once, source, "the checked-in source equals the canonical output");
        assert.equal(sp.formatSource(typedV053(once), GATED), once, "idempotent");
      }
      // R-6: the frozen typed_decide.air is judged by idempotence.
      const decideOnce = sp.formatSource(typedV053(decideSource, "typed_decide.air"), GATED);
      assert.equal(sp.formatSource(typedV053(decideOnce, "typed_decide.air"), GATED), decideOnce);
      return { value: { canonical_sources: acceptSources.length - prescribedNonCanonical.size, frozen_input_idempotent: "typed_decide.air", prescribed_non_canonical_idempotent: ["V53-SCL-P29"] } };
    });
    await vector("V53-FMT-02", () => {
      const file = path.join(tmp, "fmt02.air");
      fs.writeFileSync(file, addSrc);
      assert.equal(addSrc.endsWith("}\n") && !addSrc.endsWith("\n\n"), true, "exactly one trailing LF");
      const pass = runCli(["format", "--check", "--source-profile", V053, "--allow-candidate-profile", file]);
      assert.equal(pass.status, 0, pass.stderr);
      const noLf = path.join(tmp, "fmt02_nolf.air");
      fs.writeFileSync(noLf, addSrc.slice(0, -1));
      const fail = runCli(["format", "--check", "--source-profile", V053, "--allow-candidate-profile", noLf]);
      assert.notEqual(fail.status, 0);
      assert.match(fail.stderr, /air\.format\.not_canonical/u);
      const ungated = runCli(["format", "--check", "--source-profile", V053, file]);
      assert.match(ungated.stderr, /^air\.source_profile\.candidate_disabled:/mu);
      return { value: { canonical: "pass", missing_trailing_lf: "air.format.not_canonical", without_opt_in: "air.source_profile.candidate_disabled" } };
    });
    await vector("V53-FMT-03", () => {
      const source = "module v53.vec\nexport func f() -> i64 {\n%x: f32 = 1\n%y: f64 = -0\n%z: i64 = const.i64 9007199254740993\nreturn %z\n}\n";
      const formatted = sp.formatSource(typedV053(source), GATED);
      assert.match(formatted, /^ {2}%x: f32 = 1\.0$/mu);
      assert.match(formatted, /^ {2}%y: f64 = -0\.0$/mu);
      assert.match(formatted, /^ {2}%z: i64 = 9007199254740993$/mu);
      return { value: ["1.0", "-0.0", "9007199254740993"] };
    });

    // ------------------------------------------------------------------
    // LSP — R-LSP-1 (the CLI inputs carry the opt-in, slice text R-1).
    await vector("V53-LSP-01", () => {
      const file = path.join(tmp, "lsp01.air");
      const source = S2("i32.checked_add", "2147483647", "1", "i32");
      fs.writeFileSync(file, source);
      const cli = runCli(["check", file, "--source-profile", V053, "--allow-candidate-profile", "--lsp-json"]);
      const report = JSON.parse(cli.stdout);
      const diagnostic = report.diagnostics[0];
      assert.equal(diagnostic.code, "air.numeric.checked_failure");
      assert.notEqual(diagnostic.code, "air.parser.syntax");
      assert(Number.isInteger(diagnostic.line), "with range");
      return { value: { code: diagnostic.code, line: diagnostic.line, status: report.status } };
    });
    await vector("V53-LSP-02", () => {
      const session = new AirLspSession({ allowCandidateProfile: true, sourceProfile: V053 });
      const checks = [];
      for (const source of [T2("i32.add", "i32", "i32", "i32"), S2("i32.checked_add", "2147483647", "1", "i32"), body([["c", "bool"]], "i32", ["%o: i32 = match %c {", "  true => 1,", "}", "return %o"])]) {
        const thrown = captureFailure(() => typedV053(source));
        const uri = `file://${path.join(tmp, `lsp02-${checks.length}.air`)}`;
        const [published] = session.handleMessage({ jsonrpc: "2.0", method: "textDocument/didOpen", params: { textDocument: { text: source, uri, version: 1 } } });
        const diagnostic = published.params.diagnostics[0];
        assert.equal(diagnostic.code, thrown.code, "err.code preserved");
        checks.push(diagnostic.code);
      }
      return { value: checks };
    });
    await vector("V53-LSP-03", () => {
      const file = path.join(tmp, "lsp03.air");
      fs.writeFileSync(file, Buffer.alloc(5 * 1024 * 1024, 0x20));
      const cli = runCli(["check", file, "--source-profile", V053, "--allow-candidate-profile", "--lsp-json"]);
      assert.notEqual(cli.status, 0);
      const report = JSON.parse(cli.stdout);
      assert.equal(report.diagnostics[0].code, "air.cli.file_too_large");
      assert.equal(report.disposition, "INTAKE_REFUSED", "R-4: an intake refusal, not a semantic rejection");
      assert.equal(report.status, "refused");
      const ungated = runCli(["check", file, "--source-profile", V053, "--lsp-json"]);
      assert.match(ungated.stderr, /^air\.source_profile\.candidate_disabled:/mu);
      return { value: { code: "air.cli.file_too_large", disposition: report.disposition, without_opt_in: "air.source_profile.candidate_disabled" } };
    });

    // ------------------------------------------------------------------
    // DIAG — R-DIAG-1/2, R-COMP-3.
    await vector("V53-DIAG-01", () => {
      const registry = registryCodes();
      assert(registry.size > 20, "the SCALAR registry table is present");
      for (const item of observedFailures) {
        assert(registry.has(item.code), `${item.code} is in the registry`);
        if (item.kind === "STATIC_REJECT") assert(Number.isInteger(item.line), `${item.code} has a location`);
      }
      return { value: { failures_checked: observedFailures.length, registry_codes: registry.size } };
    });
    await vector("V53-DIAG-02", async () => {
      // Deterministic fuzz of the SCALAR corpus: no raw TypeError, JS stack,
      // WABT text or engine error; a verified source always builds (R-COMP-3).
      let seed = 0x5ca1a2;
      const next = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed; };
      const ops = ["i32.checked_add", "i32.add", "i32.wrapping_div_s", "select.i32", "bool.not", "f32.sqrt", "f32.trunc_to_i32_checked", "match", "if", "yield", "option<", ">", "%", "=", ",", "{", "}", "const.i32", "-0", "1e99"];
      const registry = registryCodes();
      const corpus = [...acceptSources, decideSource];
      let cases = 0;
      let verified = 0;
      let assembled = 0;
      for (let round = 0; round < 640; round += 1) {
        const base = corpus[next() % corpus.length];
        const lines = base.split("\n");
        const mode = next() % 5;
        const at = next() % lines.length;
        if (mode === 0) lines.splice(at, 1);
        else if (mode === 1) lines.splice(at, 0, lines[next() % lines.length]);
        else if (mode === 2) lines[at] = `${lines[at]} ${ops[next() % ops.length]}`;
        else if (mode === 3) lines[at] = lines[at].replace(/[a-z0-9_.]+/u, ops[next() % ops.length]);
        else lines[at] = lines[at].slice(0, next() % (lines[at].length + 1));
        const source = lines.join("\n");
        cases += 1;
        let mod;
        try {
          mod = typedV053(source, "fuzz.air");
          verified += 1;
        } catch (error) {
          assert(!(error instanceof TypeError) && !(error instanceof RangeError) && !(error instanceof SyntaxError), `${error && error.stack}\n${source}`);
          assert(typeof error.code === "string" && registry.has(error.code), `unregistered or missing code ${error && error.code}: ${error && error.message}\n${source}`);
          assert(!/wabt|\n\s+at /iu.test(String(error.message)));
          continue;
        }
        const wat = lowerToWat(mod, { maxWatBytes: 4194304 });
        await WebAssembly.compile(await watToWasm(wat, "fuzz.air"));
        assembled += 1;
      }
      assert.equal(assembled, verified, "every verified fuzz case lowers and assembles");
      return { value: { assembled, cases, verified } };
    });
  } finally {
    fs.rmSync(tmp, { force: true, recursive: true });
  }

  const passed = results.filter((item) => item.status === "PASS" || item.status === "PASS_BY_COMMAND_LOGS").length;
  if (process.env.AIR_SCALAR_VECTOR_RESULTS_DIR) {
    fs.mkdirSync(process.env.AIR_SCALAR_VECTOR_RESULTS_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.AIR_SCALAR_VECTOR_RESULTS_DIR, "v053_scalar.results.json"), `${JSON.stringify(results.map((item) => JSON.parse(canonicalJson(item))), null, 2)}\n`);
  }
  if (failures.length) {
    for (const failure of failures) console.error(failure);
    console.error(`typed-v0.53 SCALAR vectors: ${failures.length} failed, ${passed} passed`);
    process.exitCode = 1;
    return;
  }
  console.log(`typed-v0.53 SCALAR vectors: ${passed}/${results.length} PASS (PROF, SCL, FMT, LSP, DIAG)`);
})().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
