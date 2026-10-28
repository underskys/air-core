#!/usr/bin/env node
"use strict";

// typed-v0.53 P0-04 (AIR-0053-P0-04-0001): typed local calls, structured
// control flow, the call graph and `void`. Every expected value below is
// copied from the R3.1 catalogue (VECTORS.md, sha256 f5353705..., CALL/CFG and
// ANA rows), the frozen SCALAR additions (V53-ANA-09/10/11) or the admitted
// P0-04 slice text R2 (VECTORS_ADDITIONS.md; folder SHA256SUMS 98d6ce53...),
// never from the output of the implementation under test. ACCEPT and
// RUNTIME_FAIL rows run through the verified builder or runtime with the
// descriptor of the source signature; a STATIC_REJECT row is checked at every
// entrypoint that verifies (slice text P4-R8). Generated fixtures are pinned
// by their sha256 (R2 row amendments).
// Set AIR_P004_VECTOR_RESULTS_DIR=<dir> to write one canonical result record
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
const {
  buildVerifiedTypedModule,
  createVerifiedTypedRuntime,
  invokeVerifiedTypedExport,
  verifiedTypedAstNodeCount
} = require("../src/v052_verified_build");
const { lowerToWat, watToWasm } = require("../src/lower_wasm");
const { typedV053FailureIdentity } = require("../src/v052_numeric_diagnostic");

const ROOT = path.resolve(__dirname, "..");
const V053 = "typed-v0.53";
const GATED = Object.freeze({ allowCandidateProfile: true, sourceProfile: V053 });
const MAX_WAT = 4194304;
// R-DIAG-2: the codes typed-v0.53 emits after P0-03 (docs/v0.53/SCALAR.md §6
// and docs/v0.53/P0_03_REFINEMENTS.md §5) and the P0-04 additions
// (docs/v0.53/P0_04_CALLS_CFG.md §5, a dev-side note).
const EARLIER_CODE_REGISTRY = Object.freeze([
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
  "air.v052.work_limit_wat_bytes",
  "air.refinement.base_type_unsupported", "air.refinement.ingress_out_of_range", "air.runtime.trap_unclassified",
  "air.runtime.failure_reason_unknown", "air.decision.payload_tag_invalid", "air.decision.bool_lane_invalid",
  "air.decision.payload_lane_noncanonical", "air.refinement.range_invalid", "air.refinement.bound_out_of_range",
  "air.v051.typed_interface_source_invalid", "air.v051.record_invalid", "air.v052.invocation_runtime_failure",
  "air.v052.verified_build_invalid", "air.v052.verified_build_descriptor_mismatch"
]);
const P0_04_CODE_REGISTRY = Object.freeze([
  "air.call.argument_count_mismatch", "air.call.recursion_rejected", "air.call.result_unbound", "air.call.unknown_function",
  "air.control.unstructured_unsupported", "air.control.yield_missing", "air.workbound.overflow"
]);
// Pinned fixtures (R2 row amendments; frozen SCALAR V53-ANA-09).
const PINS = Object.freeze({
  chain2000: { bytes: 139777, sha256: "sha256:7344e18aa774ec4fcc2f3c6cc83f25de66f9145e8afb99dfae96c88a5644430c" },
  doubling61: { bytes: 5709, sha256: "sha256:c01ed3366c61f9761dcafdc17506a7b03741c1f5f02557721e3a65d8137d7aae" },
  doubling62: { bytes: 5802, sha256: "sha256:f25a69eb1b178f4a9585c73bcf0a68c5fb7481fca6673946c82fd67e2f934f27" },
  fanout: { bytes: 2303, sha256: "sha256:4e5c9a8f823122797f40bdaca4ee18143f0a580be9427a75e0fb53d2547cb80b" },
  nest63: { bytes: 3188, sha256: "sha256:36c402e2d719642d2038713985f96bc7f19afdd6b16de4c823de75886d1b8c8f" },
  nest64: { bytes: 3238, sha256: "sha256:a0b3613abf8d0429d56c264753d90f3abdbd30eb162d36ad2774154dabc967bb" },
  nest4894: { bytes: 262114, sha256: "sha256:cd7f3faf2f5642867f5647248ff7ec3992c4ba757ee27c3926d940f72d581f18" },
  phiLoop: { sha256: "sha256:a301fa5044d3d66109f1a4eb586dd58ce4efd4ce9e76f592be2312400b90a7eb" }
});

const results = [];
const failures = [];
const observedFailures = [];
const acceptedSources = new Set();
const prescribedOrder = new Set();

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
// Sources, in canonical layout (two-space indentation per block level, one
// blank line between items, LF, one trailing LF).
const fn = (header, lines) => `${header} {\n${lines.map((line) => `  ${line}`).join("\n")}\n}`;
const M = (moduleId, ...items) => `module ${moduleId}\n\n${items.join("\n\n")}\n`;

// Generators of tools/derive_p004.py and the frozen SCALAR nest(k).
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
function chain(n) {
  const parts = ["module v53.ana", ""];
  for (let i = 0; i < n - 1; i += 1) parts.push(`${i === 0 ? "export func" : "func"} f${i}(x: i32) -> i32 {`, `  %r: i32 = call @f${i + 1}(%x)`, "  return %r", "}", "");
  parts.push(`func f${n - 1}(x: i32) -> i32 {`, "  return %x", "}");
  return `${parts.join("\n")}\n`;
}
function fanout() {
  const parts = ["module v53.call", "", "func f24(x: i32) -> i32 {", "  %o: i32 = i32.wrapping_add %x, 1", "  return %o", "}", ""];
  for (let i = 23; i >= 0; i -= 1) parts.push(`${i === 0 ? "export func" : "func"} f${i}(x: i32) -> i32 {`, `  %a: i32 = call @f${i + 1}(%x)`, `  %b: i32 = call @f${i + 1}(%a)`, "  return %b", "}", "");
  return `${parts.slice(0, -1).join("\n")}\n`;
}
function doubling(L) {
  const parts = ["module v53.call", ""];
  for (let i = 0; i < L; i += 1) parts.push(`${i === 0 ? "export func" : "func"} f${i}(x: i32) -> i32 {`, `  %a: i32 = call @f${i + 1}(%x)`, `  %b: i32 = call @f${i + 1}(%a)`, "  return %b", "}", "");
  parts.push(`func f${L}(x: i32) -> i32 {`, "  return %x", "}");
  return `${parts.join("\n")}\n`;
}

function pinned(source, pin) {
  if (pin.bytes !== undefined) assert.equal(Buffer.byteLength(source, "utf8"), pin.bytes, "pinned byte length");
  assert.equal(sha256(Buffer.from(source, "utf8")), pin.sha256, "pinned sha256");
  return source;
}

function descriptor(moduleId, exportsList, types = []) {
  return {
    air_abi_lane: "0.12", module_id: moduleId, schema: "air.typed-interface/0.12-candidate.1", types,
    exports: exportsList.map(([name, params, returnType]) => ({
      function: name, name, parameters: params.map(([parameter, type]) => ({ name: parameter, type })), return_type: returnType
    }))
  };
}
const enumDecl = (typeId, cases) => ({ cases: cases.map(([name, discriminant]) => ({ discriminant, name })), kind: "enum", type_id: typeId });

function typedV053(source, name = "v.air", options = GATED) {
  const mod = sp.parseSource(source, name, options);
  sp.verifySource(mod, options);
  return mod;
}

function capture(action) {
  try {
    action();
  } catch (error) {
    return error;
  }
  return null;
}

function moduleIdOf(source) {
  const match = /^module\s+(\S+)/mu.exec(source);
  return match ? match[1] : "v53.vec";
}

function runCli(args) {
  return childProcess.spawnSync(process.execPath, [path.join(ROOT, "bin", "airc.js"), ...args], {
    cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024
  });
}

function assertNoRawError(text, label) {
  assert.doesNotMatch(String(text), /RangeError|Maximum call stack|TypeError|\n\s+at /u, `${label}: no raw error`);
}

let tmp;
let fileCounter = 0;
const runtimeHost = createVerifiedTypedRuntime({ admit: async () => true });

// STATIC_REJECT at every entrypoint that verifies (P4-R8): SDK verify, CLI
// verify, CLI check --lsp-json, the LSP session, the builder and the runtime.
async function staticReject(source, code, line, options = {}) {
  const outcomes = {};
  const sdk = capture(() => typedV053(source));
  assert(sdk, `SDK: expected ${code}, got VERIFIED`);
  assert(!(sdk instanceof TypeError) && !(sdk instanceof RangeError), String(sdk && sdk.stack));
  assert.equal(sdk.code, code, String(sdk.message));
  assert.match(String(sdk.message), new RegExp(`${code.replace(/\./g, "\\.")}:`));
  assert(sdk.loc && Number.isInteger(sdk.loc.line), "a static failure carries a source location");
  if (line !== undefined) assert.equal(sdk.loc.line, line, `SDK line: ${sdk.message}`);
  outcomes.sdk = { code: sdk.code, line: sdk.loc.line };
  if (sdk.cyclePath) outcomes.sdk.cyclePath = sdk.cyclePath;
  const file = path.join(tmp, `reject_${fileCounter += 1}.air`);
  fs.writeFileSync(file, source);
  const cli = runCli(["verify", file, "--source-profile", V053, "--allow-candidate-profile"]);
  assert.notEqual(cli.status, 0);
  assertNoRawError(cli.stderr, "CLI verify");
  const first = cli.stderr.trim().split("\n")[0];
  const cliMatch = /^.*?:(\d+): (air\.[a-z0-9_.]+):/u.exec(first);
  assert(cliMatch, `CLI verify output: ${first}`);
  outcomes.cli_verify = { code: cliMatch[2], line: Number(cliMatch[1]) };
  const check = runCli(["check", file, "--source-profile", V053, "--allow-candidate-profile", "--lsp-json"]);
  const report = JSON.parse(check.stdout);
  outcomes.cli_check = { code: report.diagnostics[0].code, line: report.diagnostics[0].line };
  const session = new AirLspSession({ allowCandidateProfile: true, sourceProfile: V053 });
  const [published] = session.handleMessage({ jsonrpc: "2.0", method: "textDocument/didOpen", params: { textDocument: { text: source, uri: `file://${file}`, version: 1 } } });
  outcomes.lsp = { code: published.params.diagnostics[0].code };
  const desc = options.descriptor || descriptor(moduleIdOf(source), [["f", [], "i32"]]);
  const builder = await buildVerifiedTypedModule({ ...GATED, descriptor: desc, source }).then(() => null, (error) => error);
  assert(builder, "builder: no artifact");
  outcomes.builder = { code: builder.code, line: builder.loc && builder.loc.line };
  const runtime = await runtimeHost.build({ ...GATED, descriptor: desc, source }).then(() => null, (error) => error);
  assert(runtime, "runtime: no artifact");
  outcomes.runtime = { code: runtime.code, line: runtime.loc && runtime.loc.line };
  for (const [entrypoint, outcome] of Object.entries(outcomes)) {
    assert.equal(outcome.code, code, `${entrypoint}: ${JSON.stringify(outcome)}`);
    if (line !== undefined && outcome.line !== undefined) assert.equal(outcome.line, line, `${entrypoint} line`);
  }
  observedFailures.push({ code, kind: "STATIC_REJECT", line: sdk.loc.line });
  return { code, line: sdk.loc.line, ...(sdk.cyclePath ? { cyclePath: sdk.cyclePath } : {}), entrypoints: Object.keys(outcomes) };
}

const buildCache = new Map();
async function build(source, desc) {
  const key = `${source}\u0000${canonicalJson(desc)}`;
  if (!buildCache.has(key)) {
    typedV053(source);
    acceptedSources.add(source);
    buildCache.set(key, await buildVerifiedTypedModule({ ...GATED, descriptor: desc, source }));
  }
  return buildCache.get(key);
}

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

function direct(built, name, lanes) {
  const instance = new WebAssembly.Instance(new WebAssembly.Module(built.wasmBytes), {});
  try {
    return { value: instance.exports[name](...lanes) };
  } catch (error) {
    assert(error instanceof WebAssembly.RuntimeError, `not a Wasm trap: ${error && error.stack}`);
    const identity = typedV053FailureIdentity(error, instance);
    return { code: identity.code, failureReason: identity.value };
  }
}

function entry(built, name) {
  return wb.inspectBoundWorkBound(built).record.entries[name];
}

function expectSummary(built, name, steps, calls = 0n) {
  const actual = entry(built, name);
  assert.deepEqual(actual, wb.canonicalSummary(wb.summary({ calls: BigInt(calls), steps: BigInt(steps) })), `E(${name})`);
  return actual;
}

function expectAll(cases, label) {
  return cases.map(([what, actual, expected]) => {
    assert.deepEqual(actual, expected, `${label}: ${what}`);
    return { case: what, outcome: actual };
  });
}

function assertAnalysisRefused(error, measure, required, capacity, label) {
  assert(error, `${label}: expected ANALYSIS_REFUSED`);
  assert(!(error instanceof RangeError) && !(error instanceof TypeError), `${label}: ${error && error.stack}`);
  assert.equal(error.code, "air.analysis.capacity_exceeded", `${label}: ${error.message}`);
  assert.equal(error.disposition, "ANALYSIS_REFUSED", `${label}: never STATIC_REJECT`);
  assert.deepEqual({ capacity: error.capacity, measure: error.measure, required: error.required }, { capacity, measure, required }, label);
  return { capacity, code: error.code, disposition: error.disposition, measure, required };
}

// V53-ANA-09 at every entrypoint: SDK parse, CLI verify, builder, runtime; no
// cache entry, no compilation, no WorkBound record.
async function analysisRefusedEverywhere(source, measure, required, capacity, analysisCapacity) {
  const options = analysisCapacity ? { ...GATED, analysisCapacity } : GATED;
  const outcomes = {};
  outcomes.sdk = assertAnalysisRefused(capture(() => sp.parseSource(source, "ana.air", options)), measure, required, capacity, "SDK");
  const desc = descriptor(moduleIdOf(source), [["f", [["c", "bool"]], "i32"]]);
  outcomes.builder = assertAnalysisRefused(await buildVerifiedTypedModule({ ...options, descriptor: desc, source }).then(() => null, (error) => error), measure, required, capacity, "builder");
  const runtime = createVerifiedTypedRuntime({ admit: async () => true, ...(analysisCapacity ? { analysisCapacity } : {}) });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    outcomes.runtime = assertAnalysisRefused(await runtime.build({ ...GATED, descriptor: desc, source }).then(() => null, (error) => error), measure, required, capacity, "runtime");
  }
  const status = runtime.inspect();
  assert.equal(status.cache.entries, 0, "nothing cached");
  assert.equal(status.counters.compilations, 0, "nothing compiled");
  if (!analysisCapacity) {
    const file = path.join(tmp, `ana_${fileCounter += 1}.air`);
    fs.writeFileSync(file, source);
    const cli = runCli(["verify", file, "--source-profile", V053, "--allow-candidate-profile"]);
    assert.notEqual(cli.status, 0);
    assertNoRawError(cli.stderr, "CLI verify");
    assert.match(cli.stderr, /air\.analysis\.capacity_exceeded/u);
    outcomes.cli_verify = cli.stderr.trim().split("\n")[0].replace(file, "ana.air");
  }
  return { cache_entries: 0, compilations: 0, outcomes, workbound_evidence: "none" };
}

// ---------------------------------------------------------------------------
// P04-QA-F-1 regression helpers. Generators: one block-bodied match nesting per
// level (armNest), alternating with value `if` (mixedNest), and two
// block-bodied sibling arms with a call (siblingNest); unindented, LF.
function closeArmLevels(k, kinds, lines) {
  for (let i = k - 1; i >= 0; i -= 1) {
    if (kinds[i] === "match") lines.push("}", "}");
    else lines.push("} else {", "yield 0", "}");
    if (i > 0) lines.push(`yield %r${i}`);
  }
}
function armNest(k) {
  const lines = ["module v53.ana", "export func f(c: bool) -> i32 {"];
  for (let i = 0; i < k; i += 1) lines.push(`%r${i}: i32 = match %c {`, "false => 0,", "true => {");
  lines.push("yield 1");
  closeArmLevels(k, Array(k).fill("match"), lines);
  lines.push("return %r0", "}");
  return `${lines.join("\n")}\n`;
}
function mixedNest(k) {
  const kinds = Array.from({ length: k }, (_, i) => (i % 2 === 0 ? "match" : "if"));
  const lines = ["module v53.ana", "export func f(c: bool) -> i32 {"];
  for (let i = 0; i < k; i += 1) {
    if (kinds[i] === "match") lines.push(`%r${i}: i32 = match %c {`, "false => 0,", "true => {");
    else lines.push(`%r${i}: i32 = if %c {`);
  }
  lines.push("yield 1");
  closeArmLevels(k, kinds, lines);
  lines.push("return %r0", "}");
  return `${lines.join("\n")}\n`;
}
function siblingNest(k) {
  const lines = ["module v53.ana", "func g(x: i32) -> i32 {", "return %x", "}", "export func f(c: bool) -> i32 {"];
  for (let i = 0; i < k; i += 1) lines.push(`%r${i}: i32 = match %c {`, "false => {", `%z${i}: i32 = call @g(0)`, `yield %z${i}`, "}", "true => {");
  lines.push("yield 1");
  closeArmLevels(k, Array(k).fill("match"), lines);
  lines.push("return %r0", "}");
  return `${lines.join("\n")}\n`;
}

// A subprocess bound: a timeout is a failure, never a pass.
function runCliBounded(args, timeoutMs = 60000) {
  const out = childProcess.spawnSync(process.execPath, [path.join(ROOT, "bin", "airc.js"), ...args], {
    cwd: ROOT, encoding: "utf8", killSignal: "SIGKILL", maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs
  });
  assert(!out.error && out.signal === null, `airc ${args[0]} did not finish within ${timeoutMs} ms (${out.error && out.error.code || out.signal})`);
  return out;
}

// Every object of the AST reached through enumerable properties, with the
// number of paths that reach it: a tree reaches each object exactly once.
function enumerablePathCounts(root) {
  const counts = new Map();
  const stack = [root];
  while (stack.length) {
    const value = stack.pop();
    if (!value || typeof value !== "object") continue;
    counts.set(value, (counts.get(value) || 0) + 1);
    for (const item of Array.isArray(value) ? value : Object.values(value)) stack.push(item);
  }
  return counts;
}

// VERIFIED at every entrypoint: SDK verify, lowerToWat, CLI verify, CLI check
// (LSP JSON), the LSP session, the verified builder and the generic runtime;
// the invocations give the values derived from the source.
async function regVerifiedEverywhere(source, cases, label) {
  const file = path.join(tmp, `${label}.air`);
  fs.writeFileSync(file, source);
  const mod = typedV053(source, `${label}.air`);
  assert.match(lowerToWat(mod, { maxWatBytes: MAX_WAT }), /\(func \$f \(export "f"\)/u, `${label}: lowerToWat`);
  const verify = runCliBounded(["verify", file, "--source-profile", V053, "--allow-candidate-profile"]);
  assert.equal(verify.status, 0, `${label}: CLI verify ${verify.stderr}`);
  const check = runCliBounded(["check", file, "--source-profile", V053, "--allow-candidate-profile", "--lsp-json"]);
  assert.equal(check.status, 0, `${label}: CLI check ${check.stdout.slice(0, 400)}`);
  assert.deepEqual(JSON.parse(check.stdout).diagnostics, [], `${label}: CLI check diagnostics`);
  const session = new AirLspSession({ allowCandidateProfile: true, sourceProfile: V053 });
  const [published] = session.handleMessage({ jsonrpc: "2.0", method: "textDocument/didOpen", params: { textDocument: { text: source, uri: `file://${file}`, version: 1 } } });
  assert.deepEqual(published.params.diagnostics, [], `${label}: LSP diagnostics`);
  const desc = descriptor("v53.ana", [["f", [["c", "bool"]], "i32"]]);
  const built = await buildVerifiedTypedModule({ ...GATED, descriptor: desc, source });
  const runtime = createVerifiedTypedRuntime({ admit: async () => true });
  const handle = await runtime.build({ ...GATED, descriptor: desc, source });
  const values = {};
  for (const [argument, expected] of cases) {
    assert.equal((await invokeVerifiedTypedExport(built, "f", [argument])).value, expected, `${label}: builder f(${argument})`);
    assert.equal((await runtime.invoke(handle, "f", [argument])).value, expected, `${label}: runtime f(${argument})`);
    values[`f(${argument})`] = expected;
  }
  return { built, entrypoints: ["sdk_verify", "lowerToWat", "cli_verify", "cli_check", "lsp", "builder", "runtime"], mod, values };
}

// ANALYSIS_REFUSED {nesting_depth, 65, 64} at every entrypoint, never INTAKE_REFUSED,
// STATIC_REJECT, a raw exception or a hang; nothing cached or compiled.
async function regRefusedEverywhere(source, label) {
  const expected = ["nesting_depth", 65, 64];
  const refused = (error, where) => assertAnalysisRefused(error, ...expected, `${label}: ${where}`);
  const outcomes = {};
  outcomes.sdk_verify = refused(capture(() => sp.parseSource(source, `${label}.air`, GATED)), "SDK");
  outcomes.lowerToWat = refused(capture(() => lowerToWat(parser.typedV053.parse(source, `${label}.air`), { maxWatBytes: MAX_WAT })), "lowerToWat");
  const file = path.join(tmp, `${label}.air`);
  fs.writeFileSync(file, source);
  const verify = runCliBounded(["verify", file, "--source-profile", V053, "--allow-candidate-profile"]);
  assert.notEqual(verify.status, 0);
  assertNoRawError(verify.stderr, `${label}: CLI verify`);
  assert.match(verify.stderr, /air\.analysis\.capacity_exceeded/u);
  assert.doesNotMatch(verify.stderr, /work_limit_ast_nodes/u);
  outcomes.cli_verify = verify.stderr.trim().split("\n")[0].replace(file, `${label}.air`);
  const check = runCliBounded(["check", file, "--source-profile", V053, "--allow-candidate-profile", "--lsp-json"]);
  const report = JSON.parse(check.stdout);
  assert.equal(report.diagnostics[0].code, "air.analysis.capacity_exceeded", `${label}: CLI check`);
  assert.equal(report.disposition, "ANALYSIS_REFUSED", `${label}: CLI check disposition`);
  outcomes.cli_check = { code: report.diagnostics[0].code, disposition: report.disposition, status: report.status };
  const session = new AirLspSession({ allowCandidateProfile: true, sourceProfile: V053 });
  const [published] = session.handleMessage({ jsonrpc: "2.0", method: "textDocument/didOpen", params: { textDocument: { text: source, uri: `file://${file}`, version: 1 } } });
  assert.equal(published.params.diagnostics[0].code, "air.analysis.capacity_exceeded", `${label}: LSP`);
  outcomes.lsp = { code: published.params.diagnostics[0].code };
  const desc = descriptor("v53.ana", [["f", [["c", "bool"]], "i32"]]);
  outcomes.builder = refused(await buildVerifiedTypedModule({ ...GATED, descriptor: desc, source }).then(() => null, (error) => error), "builder");
  const runtime = createVerifiedTypedRuntime({ admit: async () => true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    outcomes.runtime = refused(await runtime.build({ ...GATED, descriptor: desc, source }).then(() => null, (error) => error), "runtime");
  }
  const status = runtime.inspect();
  assert.equal(status.cache.entries, 0, `${label}: nothing cached`);
  assert.equal(status.counters.compilations, 0, `${label}: nothing compiled`);
  return outcomes;
}

function regMeasures(source) {
  const ast = parser.typedV053.parse(source, "measure.air");
  const measures = require("../src/analysis_capacity").measureTypedModule(ast);
  return { analysis_units: measures.analysis_units, call_sites: measures.call_sites, intake_ast_nodes: verifiedTypedAstNodeCount(ast), nesting_depth: measures.nesting_depth };
}

// The P0-04 base (dev 74e4780c / public 0fd4b4be), run from git objects in a
// bounded child process: the defect this correction removes.
const P04_QA_F1_BASE_COMMITS = ["74e4780c6f22ae2998f373409147c0d47cc237dd", "0fd4b4be12f0fddc5647aa7b9e2e838c5242f162"];
function regBaseline(ks) {
  const dir = path.join(tmp, "p04_qa_f1_base");
  let commit = null;
  for (const candidate of P04_QA_F1_BASE_COMMITS) {
    if (childProcess.spawnSync("git", ["cat-file", "-e", `${candidate}^{commit}`], { cwd: ROOT }).status === 0) { commit = candidate; break; }
  }
  assert(commit, "the P0-04 base commit is not in this repository");
  fs.mkdirSync(dir, { recursive: true });
  const archive = childProcess.spawnSync("sh", ["-c", `git archive ${commit} src | tar -x -C "${dir}"`], { cwd: ROOT, encoding: "utf8" });
  assert.equal(archive.status, 0, archive.stderr);
  const script = path.join(dir, "probe.js");
  fs.writeFileSync(script, `"use strict";
const path = require("path");
const src = process.argv[2];
const source = require("fs").readFileSync(process.argv[3], "utf8");
const sp = require(path.join(src, "source_profile.js"));
const parser = require(path.join(src, "parser.js"));
const { verifiedTypedAstNodeCount } = require(path.join(src, "v052_verified_build.js"));
const out = { intake_ast_nodes: verifiedTypedAstNodeCount(parser.typedV053.parse(source, "base.air")) };
try { const options = { allowCandidateProfile: true, sourceProfile: "typed-v0.53" }; sp.verifySource(sp.parseSource(source, "base.air", options), options); out.disposition = "VERIFIED"; }
catch (error) { out.disposition = error.disposition || error.name; out.code = error.code || null; }
process.stdout.write(JSON.stringify(out));
`);
  const outcomes = {};
  for (const k of ks) {
    const sourceFile = path.join(dir, `arm_${k}.air`);
    fs.writeFileSync(sourceFile, armNest(k));
    const run = childProcess.spawnSync(process.execPath, [script, path.join(dir, "src"), sourceFile], {
      encoding: "utf8", env: { ...process.env, NODE_PATH: path.join(ROOT, "node_modules") }, killSignal: "SIGKILL", maxBuffer: 16 * 1024 * 1024, timeout: 60000
    });
    assert(!run.error && run.signal === null, `base probe k=${k} did not finish within 60 s`);
    assert.equal(run.status, 0, run.stderr);
    outcomes[k] = JSON.parse(run.stdout);
  }
  return { commit, outcomes };
}

async function regP04QaF1() {
  await vector("REG-P04-QA-F1-BASELINE", () => {
    // Before the correction the arm block was reached twice: 2^(k+4) − 5 nodes.
    const base = regBaseline([12, 13]);
    assert.deepEqual(base.outcomes[12], { disposition: "VERIFIED", intake_ast_nodes: 65531 });
    assert.deepEqual(base.outcomes[13], { code: "air.v052.work_limit_ast_nodes", disposition: "INTAKE_REFUSED", intake_ast_nodes: 131067 });
    return { value: { base_commit: base.commit, k12: base.outcomes[12], k13: base.outcomes[13], k13_sha256: sha256(Buffer.from(armNest(13), "utf8")) } };
  });
  await vector("REG-P04-QA-F1-K13", async () => {
    const source = armNest(13);
    assert.deepEqual(regMeasures(source), { analysis_units: 29, call_sites: 0, intake_ast_nodes: 167, nesting_depth: 14 });
    const run = await regVerifiedEverywhere(source, [[true, 1], [false, 0]], "reg_k13");
    return { value: { "E(f)": expectSummary(run.built, "f", 54), entrypoints: run.entrypoints, measures: regMeasures(source), values: run.values }, sourceDigest: sha256(Buffer.from(source, "utf8")) };
  });
  await vector("REG-P04-QA-F1-K63", async () => {
    const source = armNest(63);
    assert.deepEqual(regMeasures(source), { analysis_units: 129, call_sites: 0, intake_ast_nodes: 767, nesting_depth: 64 });
    const run = await regVerifiedEverywhere(source, [[true, 1], [false, 0]], "reg_k63");
    return { value: { "E(f)": expectSummary(run.built, "f", 254), entrypoints: run.entrypoints, measures: regMeasures(source), values: run.values }, sourceDigest: sha256(Buffer.from(source, "utf8")) };
  });
  await vector("REG-P04-QA-F1-K64", async () => {
    const source = armNest(64);
    assert.deepEqual(regMeasures(source), { analysis_units: 131, call_sites: 0, intake_ast_nodes: 779, nesting_depth: 65 });
    return { value: { measures: regMeasures(source), outcomes: await regRefusedEverywhere(source, "reg_k64") }, sourceDigest: sha256(Buffer.from(source, "utf8")) };
  });
  await vector("REG-P04-QA-F1-MIXED", async () => {
    const source = mixedNest(63);
    // m = 32 match levels, v = 31 if levels: units 2k + v + 3, nodes 11 + 12m + 11v.
    assert.deepEqual(regMeasures(source), { analysis_units: 160, call_sites: 0, intake_ast_nodes: 736, nesting_depth: 64 });
    const run = await regVerifiedEverywhere(source, [[true, 1], [false, 0]], "reg_mixed63");
    const refused = await regRefusedEverywhere(mixedNest(64), "reg_mixed64");
    return { value: { "E(f)": expectSummary(run.built, "f", 192), k64: refused, measures: regMeasures(source), values: run.values }, sourceDigest: sha256(Buffer.from(source, "utf8")) };
  });
  await vector("REG-P04-QA-F1-SIBLING", async () => {
    const source = siblingNest(63);
    // Two block arms and one call per level: units 5k + 5 (63 call sites), nodes 18 + 20k.
    assert.deepEqual(regMeasures(source), { analysis_units: 320, call_sites: 63, intake_ast_nodes: 1278, nesting_depth: 64 });
    const run = await regVerifiedEverywhere(source, [[true, 1], [false, 0]], "reg_sibling63");
    const refused = await regRefusedEverywhere(siblingNest(64), "reg_sibling64");
    return { value: { "E(f)": expectSummary(run.built, "f", 256, 1), k64: refused, measures: regMeasures(source), values: run.values }, sourceDigest: sha256(Buffer.from(source, "utf8")) };
  });
  await vector("REG-P04-QA-F1-LINEAR", () => {
    // The intake count at depths 1, 13, 31 and 63 is 11 + 12k: a constant increment.
    const counts = Object.fromEntries([1, 13, 31, 63].map((k) => [k, regMeasures(armNest(k)).intake_ast_nodes]));
    assert.deepEqual(counts, { 1: 23, 13: 167, 31: 383, 63: 767 });
    // Structurally: the enumerable object graph is a tree (every object reached once),
    // every arm still refers to its block, and each block is the `blocks` entry.
    const structure = {};
    for (const [name, source] of [["armNest63", armNest(63)], ["mixedNest63", mixedNest(63)], ["siblingNest63", siblingNest(63)]]) {
      const ast = parser.typedV053.parse(source, `${name}.air`);
      const paths = enumerablePathCounts(ast);
      assert([...paths.values()].every((count) => count === 1), `${name}: every object is reached through exactly one enumerable path`);
      assert.equal(paths.size, verifiedTypedAstNodeCount(ast));
      let blockArms = 0;
      const stack = [...ast.functions];
      while (stack.length) {
        const item = stack.pop();
        for (const statement of item.statements || []) {
          for (const arm of statement.kind === "match" ? statement.arms : []) {
            if (!Object.prototype.hasOwnProperty.call(arm, "block")) continue;
            blockArms += 1;
            assert.equal(Object.getOwnPropertyDescriptor(arm, "block").enumerable, false);
            assert(statement.blocks.includes(arm.block), `${name}: the arm's block is a 'blocks' entry`);
          }
          for (const block of statement.blocks || []) stack.push(block);
        }
      }
      structure[name] = { block_arms: blockArms, objects: paths.size };
    }
    assert.equal(structure.armNest63.block_arms, 63);
    assert.equal(structure.siblingNest63.block_arms, 126);
    return { value: { counts, increment: 12, structure } };
  });
  await vector("REG-P04-QA-F1-FMT", () => {
    // Formatter idempotence, and the formatted source keeps the measures, the
    // summary and the verdict (blocks are formatted from the arms).
    const checked = {};
    for (const [name, source] of [["armNest13", armNest(13)], ["armNest63", armNest(63)], ["mixedNest63", mixedNest(63)], ["siblingNest63", siblingNest(63)]]) {
      const once = sp.formatSource(typedV053(source, `${name}.air`), GATED);
      assert.equal(sp.formatSource(typedV053(once, `${name}-fmt.air`), GATED), once, `${name}: idempotent`);
      const before = regMeasures(source);
      const after = regMeasures(once);
      assert.deepEqual({ ...after, intake_ast_nodes: before.intake_ast_nodes }, before, `${name}: formatting keeps the measures`);
      assert.equal(after.intake_ast_nodes, before.intake_ast_nodes, `${name}: formatting keeps the AST`);
      const summaries = [source, once].map((text) => wb.canonicalSummary(wb.analyzeVerifiedTypedModule(typedV053(text, `${name}-wb.air`)).entries.get("f").value));
      assert.deepEqual(summaries[1], summaries[0], `${name}: formatting keeps E(f)`);
      checked[name] = { formatted_bytes: Buffer.byteLength(once, "utf8"), "E(f)": summaries[0] };
    }
    return { value: checked };
  });
}

async function main() {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "air-v053-p004-"));
  try {
    // ------------------------------------------------------------------
    // CALL — R3.1 rows (VECTORS.md lines 262-269), with the R2 row amendments.
    const incSrc = M("v53.call", fn("func inc(x: i32) -> i32", ["%o: i32 = i32.wrapping_add %x, 1", "return %o"]), fn("export func run(x: i32) -> i32", ["%r: i32 = call @inc(%x)", "return %r"]));
    await vector("V53-CALL-P01", async () => {
      const built = await build(incSrc, descriptor("v53.call", [["run", [["x", "i32"]], "i32"]]));
      assert.deepEqual(await call(built, "run", [41]), { value: 42 });
      return { value: { "E(run)": expectSummary(built, "run", 4, 1), "run(41)": 42 }, sourceDigest: sha256(incSrc) };
    });
    const pickSrc = M("v53.call",
      fn("enum Mode", ["off = 0,", "on = 1,"]),
      fn("func pick(m: v53.call::Mode) -> option<i32>", ["%r: option<i32> = match %m {", "  Mode.off => option.none<i32>,", "  Mode.on => option.some<i32> 7,", "}", "return %r"]),
      fn("export func run(m: v53.call::Mode) -> option<i32>", ["%r: option<i32> = call @pick(%m)", "return %r"]));
    await vector("V53-CALL-P02", async () => {
      const built = await build(pickSrc, descriptor("v53.call", [["run", [["m", "v53.call::Mode"]], "option<i32>"]], [enumDecl("v53.call::Mode", [["off", 0], ["on", 1]])]));
      const mode = (discriminant) => ({ discriminant, type: "v53.call::Mode" });
      const value = expectAll([
        ["run(1)", await call(built, "run", [mode(1)]), { value: { tag: "some", type: "option<i32>", value: 7 } }],
        ["run(0)", await call(built, "run", [mode(0)]), { value: { tag: "none", type: "option<i32>" } }],
        ["run(2)", await call(built, "run", [mode(2)]), { code: "air.decision.enum_discriminant_invalid" }]
      ], "CALL-P02");
      const lanes = direct(built, "run", [1]).value;
      const layout = Buffer.concat(lanes.map((lane) => { const bytes = Buffer.alloc(4); bytes.writeInt32LE(lane, 0); return bytes; })).toString("hex");
      assert.equal(layout, "0100000007000000", "the some(7) layout");
      return { value: { "E(run)": expectSummary(built, "run", 8, 1), invocations: value, layout }, sourceDigest: sha256(pickSrc) };
    });
    const fan = pinned(fanout(), PINS.fanout);
    prescribedOrder.add(fan);
    await vector("V53-CALL-P03", async () => {
      const built = await build(fan, descriptor("v53.call", [["f0", [["x", "i32"]], "i32"]]));
      assert.deepEqual(await call(built, "f0", [0]), { value: 16777216 });
      const stats = wb.analyzeVerifiedTypedModule(typedV053(fan)).stats;
      assert.equal(stats.functionSummaries, 25, "25 function summaries, never one per path");
      assert.equal(stats.entrySummaries, 1);
      return { value: { "E(f0)": expectSummary(built, "f0", "83886077", "33554430"), "f0(0)": 16777216, summaries: { entry: stats.entrySummaries, function: stats.functionSummaries } }, sourceDigest: sha256(fan) };
    });
    await vector("V53-CALL-N01", async () => {
      const outcome = await staticReject(M("v53.call", fn("export func f(x: i32) -> i32", ["%r: i32 = call @f(%x)", "return %r"])), "air.call.recursion_rejected", 4);
      assert.equal(outcome.cyclePath, "@f -> @f");
      return { value: outcome };
    });
    await vector("V53-CALL-N02", async () => {
      const outcome = await staticReject(M("v53.call",
        fn("func a(x: i32) -> i32", ["%r: i32 = call @b(%x)", "return %r"]),
        fn("export func b(x: i32) -> i32", ["%r: i32 = call @a(%x)", "return %r"])), "air.call.recursion_rejected");
      assert.equal(outcome.cyclePath, "@a -> @b -> @a");
      return { value: outcome };
    });
    await vector("V53-CALL-N03", async () => ({
      value: await staticReject(M("v53.call", fn("func inc(x: i32) -> i32", ["return %x"]), fn("export func run(x: i32) -> i32", ["call @inc(%x)", "return %x"])), "air.call.result_unbound", 8)
    }));
    await vector("V53-CALL-N04", async () => ({
      value: await staticReject(M("v53.call", fn("func inc(x: i32) -> i32", ["return %x"]), fn("export func run(y: i64) -> i32", ["%r: i32 = call @inc(%y)", "return %r"])), "air.v051.typed_atom_type_mismatch", 8)
    }));
    await vector("V53-CALL-N05", async () => ({
      value: await staticReject(M("v53.call", fn("export func run(x: i32) -> i32", ["call @missing(%x)", "return %x"])), "air.call.unknown_function", 4)
    }));

    // ------------------------------------------------------------------
    // CFG — R3.1 rows (VECTORS.md lines 270-279), with the R2 row amendments.
    const cfgP01 = M("v53.cfg", fn("export func f(c: bool) -> i32", ["%r: i32 = if %c {", "  yield 1", "} else {", "  yield 2", "}", "return %r"]));
    await vector("V53-CFG-P01", async () => {
      const built = await build(cfgP01, descriptor("v53.cfg", [["f", [["c", "bool"]], "i32"]]));
      const value = expectAll([["f(true)", await call(built, "f", [true]), { value: 1 }], ["f(false)", await call(built, "f", [false]), { value: 2 }]], "CFG-P01");
      return { value: { E: expectSummary(built, "f", 4), invocations: value }, sourceDigest: sha256(cfgP01) };
    });
    await vector("V53-CFG-P02", () => ({ status: "DEFERRED", value: { first_executable: "P0-10", reason: "typed extern debug.metric arrives with P0-10", recorded_expectation: "E = S{steps:5, effects{debug.metric:1}}" } }));
    const cfgP03 = M("v53.cfg", fn("export func f() -> void", ["return"]));
    await vector("V53-CFG-P03", async () => {
      const built = await build(cfgP03, descriptor("v53.cfg", [["f", [], "void"]]));
      const wat = lowerToWat(typedV053(cfgP03), { maxWatBytes: MAX_WAT });
      assert.match(wat, /\(func \$f \(export "f"\)$/mu, "lowers to a function without a result");
      assert.deepEqual(await call(built, "f", []), { value: null });
      return { value: { lowers: true, runs: true, value: null }, sourceDigest: sha256(cfgP03) };
    });
    const cfgN01 = "module v53.cfg\n\nexport func f(c: bool, x: i32) -> i32 {\nentry:\n  br_if %c, done\n  br done\ndone:\n  return %x\n}\n";
    await vector("V53-CFG-N01", async () => ({ value: await staticReject(cfgN01, "air.control.unstructured_unsupported", 4) }));
    const phiLoop = pinned(fs.readFileSync(path.join(ROOT, "examples", "phi_loop.air"), "utf8"), PINS.phiLoop);
    let cfgN02;
    await vector("V53-CFG-N02", async () => {
      cfgN02 = await staticReject(phiLoop, "air.control.unstructured_unsupported", 5);
      return { value: cfgN02, sourceDigest: sha256(phiLoop) };
    });
    await vector("V53-CFG-N03", async () => ({
      value: await staticReject(M("v53.cfg", fn("export func f(c: bool) -> i32", ["%r: i32 = if %c {", "  yield 1", "} else {", "  %z: i32 = 2", "}", "return %r"])), "air.control.yield_missing", 6)
    }));
    await vector("V53-CFG-N04", async () => ({
      value: await staticReject(M("v53.cfg", fn("export func f(c: bool) -> i32", ["%r: i32 = if %c {", "  %z: i32 = 1", "  yield %z", "} else {", "  yield 2", "}", "return %z"])), "air.v051.local_unknown", 10)
    }));
    await vector("V53-CFG-N05", async () => {
      const source = M("v53.cfg", fn("export func f(c: bool, a: i64, b: i64) -> i64", ["%r: i64 = match %c {", "  false => i64.checked_add %a, %b,", "  true => %a,", "}", "return %r"]));
      const outcome = await staticReject(source, "air.decision.match_arm_invalid");
      assert.doesNotMatch(String(capture(() => typedV053(source)).message), /wabt/iu, "never a raw WABT error");
      return { value: outcome };
    });
    await vector("V53-CFG-N06", async () => ({
      value: await staticReject(M("v53.cfg", fn("export func f() -> i32", ["return 1", "%x: i32 = 2"])), "air.control.statement_after_return", 5)
    }));

    // ------------------------------------------------------------------
    // ANA — R3.1 rows (VECTORS.md lines 230, 231, 234) and the frozen SCALAR
    // additions deferred to P0-04 (V53-ANA-09, -10, -11 with OD-P4-1 (b)).
    await vector("V53-ANA-04", async () => {
      const mod = typedV053(fan);
      const measures = require("../src/analysis_capacity").measureTypedModule(mod);
      assert.equal(measures.analysis_units, 148);
      const stats = wb.analyzeVerifiedTypedModule(mod).stats;
      assert.equal(stats.functionSummaries, 25, "harness counter: exactly 25 summaries");
      assert.equal(stats.entrySummaries, 1);
      const built = await build(fan, descriptor("v53.call", [["f0", [["x", "i32"]], "i32"]]));
      return { value: { "E(f0)": expectSummary(built, "f0", "83886077", "33554430"), analysis_units: measures.analysis_units, summaries: stats.functionSummaries }, sourceDigest: sha256(fan) };
    });
    const chainSrc = pinned(chain(2000), PINS.chain2000);
    prescribedOrder.add(chainSrc);
    await vector("V53-ANA-05", async () => {
      const mod = typedV053(chainSrc);
      const measures = require("../src/analysis_capacity").measureTypedModule(mod);
      assert.equal(measures.analysis_units, 7999);
      const file = path.join(tmp, "ana05.air");
      fs.writeFileSync(file, chainSrc);
      const cli = runCli(["verify", file, "--source-profile", V053, "--allow-candidate-profile"]);
      assert.equal(cli.status, 0, cli.stderr);
      assertNoRawError(cli.stderr, "CLI verify");
      const cliBuild = runCli(["build", file, "--source-profile", V053, "--allow-candidate-profile", "--emit", "wasm", "-o", path.join(tmp, "ana05.wasm")]);
      assert.equal(cliBuild.status, 0, cliBuild.stderr);
      const built = await build(chainSrc, descriptor("v53.ana", [["f0", [["x", "i32"]], "i32"]]));
      assert.deepEqual(await call(built, "f0", [7]), { value: 7 });
      const handle = await runtimeHost.build({ ...GATED, descriptor: descriptor("v53.ana", [["f0", [["x", "i32"]], "i32"]]), source: chainSrc });
      assert.equal((await runtimeHost.invoke(handle, "f0", [7])).value, 7);
      const small = createVerifiedTypedRuntime({ admit: async () => true, analysisCapacity: { maxAnalysisUnits: 7998 } });
      const refused = assertAnalysisRefused(await small.build({ ...GATED, descriptor: descriptor("v53.ana", [["f0", [["x", "i32"]], "i32"]]), source: chainSrc }).then(() => null, (error) => error), "analysis_units", 7999, 7998, "host below 7999");
      return { value: { "E(f0)": expectSummary(built, "f0", 3999, 1999), "f0(7)": 7, analysis_units: 7999, below_capacity: refused, raw_range_error: false }, sourceDigest: sha256(chainSrc) };
    });
    await vector("V53-ANA-08", async () => {
      const depth64 = pinned(nest(63), PINS.nest63);
      const depth65 = pinned(nest(64), PINS.nest64);
      prescribedOrder.add(depth64);
      typedV053(depth64);
      acceptedSources.add(depth64);
      const refused = await analysisRefusedEverywhere(depth65, "nesting_depth", 65, 64);
      return { value: { depth64: "VERIFIED", depth65: refused } };
    });
    const nest4894 = pinned(nest(4894), PINS.nest4894);
    await vector("V53-ANA-09", async () => {
      // Precondition (frozen SCALAR rule): intake admits the fixture.
      const ast = parser.typedV053.parse(nest4894, "ana09.air");
      const nodes = verifiedTypedAstNodeCount(ast);
      assert(nodes <= 65536, `intake admits the fixture (${nodes} nodes)`);
      const refused = await analysisRefusedEverywhere(nest4894, "nesting_depth", 4895, 64);
      return { value: { ast_nodes: nodes, k: 4894, ...refused }, sourceDigest: sha256(nest4894) };
    });
    await vector("V53-ANA-10", async () => ({
      value: await analysisRefusedEverywhere(nest4894, "analysis_units", 14685, 14684, { maxAnalysisUnits: 14684 }),
      sourceDigest: sha256(nest4894)
    }));
    await vector("V53-ANA-11", async () => {
      // OD-P4-1 (b): on P0-04 and later the bytes are admitted grammar and the
      // expected result is V53-ANA-09's; line 4,897 is the SCALAR/P0-03 reference.
      const refused = await analysisRefusedEverywhere(nest4894, "nesting_depth", 4895, 64);
      return { value: { expectation: "V53-ANA-09 (OD-P4-1 (b))", ...refused }, sourceDigest: sha256(nest4894) };
    });

    // ------------------------------------------------------------------
    // Inherited deferrals: V53-REF-P05, V53-REF-N10 (P0-03), V53-WB-H01 part (c).
    const refP05 = M("v53.call", fn("func h(n: i32<0..10>) -> i32", ["return %n"]), fn("export func run(x: i32) -> i32", ["%r: i32 = call @h(%x)", "return %r"]));
    await vector("V53-REF-P05", async () => {
      const built = await build(refP05, descriptor("v53.call", [["run", [["x", "i32"]], "i32"]]));
      assert.deepEqual(await call(built, "run", [4]), { value: 4 });
      return { value: { "E(run)": expectSummary(built, "run", 4, 1), "run(4)": 4 }, sourceDigest: sha256(refP05) };
    });
    await vector("V53-REF-N10", async () => {
      const built = await build(refP05, descriptor("v53.call", [["run", [["x", "i32"]], "i32"]]));
      const outcome = await call(built, "run", [11]);
      assert.deepEqual(outcome, { code: "air.refinement.assignment_out_of_range", failureReason: 17 }, "at the call site, before h runs");
      // The call-site check precedes the call (P4-R6): h's entry check never runs.
      const wat = lowerToWat(typedV053(refP05), { maxWatBytes: MAX_WAT });
      const runBody = wat.slice(wat.indexOf("(func $run"));
      assert(runBody.indexOf("call $__air_v053_refinement_assignment_out_of_range") < runBody.indexOf("call $h"), "checked before the call");
      return { value: outcome, sourceDigest: sha256(refP05) };
    });
    await vector("V53-WB-H01", () => ({
      status: "DEFERRED",
      value: { first_executable: "P0-10", kind: "COMPOSITE", parts: { a: { slice: "P0-02", status: "PASS (V53-WB-P04)" }, b: { slice: "P0-10", status: "DEFERRED" }, c: { outcome: cfgN02 || null, slice: "P0-04", status: cfgN02 ? "PASS" : "FAIL" } } }
    }));

    // ------------------------------------------------------------------
    // The R2 additions (VECTORS_ADDITIONS.md §2).
    await vector("V53-CALL-N06", async () => {
      const ok = pinned(doubling(61), PINS.doubling61);
      const over = pinned(doubling(62), PINS.doubling62);
      prescribedOrder.add(ok);
      const mod = typedV053(ok);
      const analysis = wb.analyzeVerifiedTypedModule(mod);
      assert.equal(analysis.stats.functionSummaries, 62);
      const built = await build(ok, descriptor("v53.call", [["f0", [["x", "i32"]], "i32"]]));
      const summary = expectSummary(built, "f0", "9223372036854775805", "4611686018427387902");
      const rejected = await staticReject(over, "air.workbound.overflow", 5, { descriptor: descriptor("v53.call", [["f0", [["x", "i32"]], "i32"]]) });
      return { value: { "E(f0)": summary, L62: rejected, summaries: 62 } };
    });
    await vector("V53-CALL-N07", async () => {
      const outcome = await staticReject(M("v53.call", fn("export func f(x: i32) -> i32", ["%r: i32 = if false {", "  %a: i32 = call @f(%x)", "  yield %a", "} else {", "  yield %x", "}", "return %r"])), "air.call.recursion_rejected", 5);
      assert.equal(outcome.cyclePath, "@f -> @f");
      return { value: outcome };
    });
    await vector("V53-CALL-N08", async () => {
      const inc = fn("func inc(x: i32) -> i32", ["return %x"]);
      return {
        value: {
          i: await staticReject(M("v53.call", inc, fn("export func run(x: i32) -> i32", ["%r: i32 = call @inc(%x, %x)", "return %r"])), "air.call.argument_count_mismatch", 8),
          ii: await staticReject(M("v53.call", fn("func g() -> void", ["return"]), fn("export func run() -> i32", ["%r: i32 = call @g()", "return %r"])), "air.v051.typed_atom_type_mismatch", 8),
          iii: await staticReject(M("v53.call", fn("export func run(x: i32) -> i32", ["%r: i32 = call @debug.metric(%x)", "return %r"])), "air.call.unknown_function", 4),
          iv: await staticReject(M("v53.call", inc, fn("export func run(x: i32) -> i32", ["%r: i32 = call @inc(call @inc(%x))", "return %r"])), "air.v051.typed_atom_invalid", 8)
        }
      };
    });
    const callP04 = M("v53.call",
      fn("func h(x: i32) -> i32", ["return %x"]),
      fn("func k(x: i32<0..5>) -> i32<0..5>", ["return %x"]),
      fn("export func run(x: i32) -> i32<0..10>", ["%r: i32<0..5> = call @h(%x)", "%s: i32<0..10> = call @k(%r)", "return %s"]));
    await vector("V53-CALL-P04", async () => {
      const built = await build(callP04, descriptor("v53.call", [["run", [["x", "i32"]], "i32"]]));
      const value = expectAll([
        ["run(3)", await call(built, "run", [3]), { value: 3 }],
        ["run(6)", await call(built, "run", [6]), { code: "air.refinement.assignment_out_of_range", failureReason: 17 }],
        ["run(-1)", await call(built, "run", [-1]), { code: "air.refinement.assignment_out_of_range", failureReason: 17 }]
      ], "CALL-P04");
      return { value: { "E(run)": expectSummary(built, "run", 6, 2), invocations: value }, sourceDigest: sha256(callP04) };
    });
    const callP05 = M("v53.call",
      fn("func id(o: option<i32>) -> option<i32>", ["return %o"]),
      fn("export func f(c: bool, x: i32) -> option<i32>", ["%a: option<i32> = call @id(option.none<i32>)", "%r: option<i32> = if %c {", "  yield option.some<i32> %x", "} else {", "  yield %a", "}", "return %r"]));
    prescribedOrder.add(callP05);
    await vector("V53-CALL-P05", async () => {
      const built = await build(callP05, descriptor("v53.call", [["f", [["c", "bool"], ["x", "i32"]], "option<i32>"]]));
      const value = expectAll([
        ["f(true, 5)", await call(built, "f", [true, 5]), { value: { tag: "some", type: "option<i32>", value: 5 } }],
        ["f(false, 5)", await call(built, "f", [false, 5]), { value: { tag: "none", type: "option<i32>" } }]
      ], "CALL-P05");
      const measures = require("../src/analysis_capacity").measureTypedModule(typedV053(callP05));
      assert.equal(measures.analysis_units, 10);
      assert.equal(measures.nesting_depth, 2);
      return { value: { "E(f)": expectSummary(built, "f", 7, 1), analysis_units: 10, invocations: value, nesting_depth: 2 }, sourceDigest: sha256(callP05) };
    });
    await vector("V53-CFG-N07", async () => {
      const F = (header, lines) => M("v53.cfg", fn(header, lines));
      return {
        value: {
          i: await staticReject(F("export func f(c: bool) -> i32", ["%r: i32 = if %c {", "  return 1", "} else {", "  yield 2", "}", "return %r"]), "air.v051.typed_syntax_invalid", 5),
          ii: await staticReject(F("export func f(x: i32) -> i32", ["yield %x", "return %x"]), "air.v051.typed_syntax_invalid", 4),
          iii: await staticReject(F("export func f(c: bool) -> i32", ["%r: i32 = if %c {", "  yield 1", "  %z: i32 = 2", "} else {", "  yield 2", "}", "return %r"]), "air.v051.typed_syntax_invalid", 6),
          iv: await staticReject(F("export func f(c: bool) -> i32", ["%r: i32 = if %c {", "  yield 1", "}", "return %r"]), "air.control.yield_missing", 4),
          v: await staticReject(F("export func f(c: bool) -> i32", ["if %c {", "  yield 1", "} else {", "  yield 2", "}", "return 1"]), "air.v051.typed_syntax_invalid", 4),
          vi: await staticReject(F("export func f(c: bool, x: i32) -> i32", ["%r: i32 = if %c {", "  yield i32.wrapping_add %x, 1", "} else {", "  yield %x", "}", "return %r"]), "air.v051.typed_syntax_invalid", 5),
          vii: await staticReject(F("export func f(x: i32) -> i32", ["%r: i32 = if %x {", "  yield 1", "} else {", "  yield 2", "}", "return %r"]), "air.v051.typed_atom_type_mismatch", 4),
          viii: await staticReject(F("export func f(x: i32) -> void", ["return %x"]), "air.v051.return_type_mismatch", 4),
          ix: await staticReject(F("export func f(x: i32) -> i32", ["return"]), "air.v051.return_type_mismatch", 4)
        }
      };
    });
    const cfgP04 = M("v53.cfg",
      fn("enum Mode", ["off = 0,", "on = 1,"]),
      fn("export func f(m: v53.cfg::Mode, c: bool) -> i32", ["%r: i32 = match %m {", "  Mode.off => 0,", "  Mode.on => {", "    %a: i32 = if %c {", "      yield 10", "    } else {", "      yield 20", "    }", "    yield %a", "  }", "}", "return %r"]));
    await vector("V53-CFG-P04", async () => {
      assert.equal(sp.formatSource(typedV053(cfgP04), GATED), cfgP04, "the canonical formatter output equals the input");
      const built = await build(cfgP04, descriptor("v53.cfg", [["f", [["m", "v53.cfg::Mode"], ["c", "bool"]], "i32"]], [enumDecl("v53.cfg::Mode", [["off", 0], ["on", 1]])]));
      const mode = (discriminant) => ({ discriminant, type: "v53.cfg::Mode" });
      const value = expectAll([
        ["f(off, true)", await call(built, "f", [mode(0), true]), { value: 0 }],
        ["f(on, true)", await call(built, "f", [mode(1), true]), { value: 10 }],
        ["f(on, false)", await call(built, "f", [mode(1), false]), { value: 20 }]
      ], "CFG-P04");
      const measures = require("../src/analysis_capacity").measureTypedModule(typedV053(cfgP04));
      assert.equal(measures.analysis_units, 9);
      assert.equal(measures.nesting_depth, 3);
      return { value: { "E(f)": expectSummary(built, "f", 10), analysis_units: 9, canonical: true, invocations: value, nesting_depth: 3 }, sourceDigest: sha256(cfgP04) };
    });
    const cfgP05 = M("v53.cfg",
      fn("func note(x: i32) -> void", ["return"]),
      fn("export func f(x: i32) -> i32", ["call @note(%x)", "return %x"]),
      fn("export func g() -> void", ["call @note(1)", "return"]));
    prescribedOrder.add(cfgP05);
    await vector("V53-CFG-P05", async () => {
      const built = await build(cfgP05, descriptor("v53.cfg", [["f", [["x", "i32"]], "i32"], ["g", [], "void"]]));
      const value = expectAll([["f(5)", await call(built, "f", [5]), { value: 5 }], ["g()", await call(built, "g", []), { value: null }]], "CFG-P05");
      const measures = require("../src/analysis_capacity").measureTypedModule(typedV053(cfgP05));
      assert.equal(measures.analysis_units, 11);
      return { value: { "E(f)": expectSummary(built, "f", 3, 1), "E(g)": expectSummary(built, "g", 3, 1), analysis_units: 11, invocations: value }, sourceDigest: sha256(cfgP05) };
    });

    // ------------------------------------------------------------------
    // Slice checks with no vector ID (card exact_evidence; slice text §4.5).
    await vector("P0-04-CHECK-CT1", () => {
      const file = path.join(ROOT, "src", "workbound_cost_table_v1.json");
      const blob = childProcess.spawnSync("git", ["hash-object", file], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
      assert.equal(blob, "4a5c2055b761e223173cbe8fc225191854d0eec2");
      assert.equal(sha256(fs.readFileSync(file)), "sha256:4f9b6ea3f84cd077e13c279a65f8862991b0d03cb5c8a3018de6f08880133c87");
      assert.equal(wb.COST_TABLE_DIGEST, "sha256:e12c77da26fdf47dedde297ea79f3a0790580a1be0ee7031f936472f1cb56a53");
      return { value: { blob, cost_table_digest: wb.COST_TABLE_DIGEST, revision: JSON.parse(fs.readFileSync(file, "utf8")).revision } };
    });
    await vector("P0-04-CHECK-FLAGS", () => {
      // NEW_LOOP_SYNTAX_ENABLED=false: no loop form is admitted in typed-v0.53.
      const loop = capture(() => typedV053(M("v53.loop", fn("export func f(x: i32) -> i32", ["%r: i32 = loop.fold @f, %x, 4", "return %r"]))));
      assert(loop && /^air\./u.test(loop.code), "a loop form is refused");
      // PHI_ADMITTED_IN_TYPED=false: a phi value is unstructured.
      const phi = capture(() => typedV053(M("v53.cfg", fn("export func f(x: i32) -> i32", ["%r: i32 = phi.i32 a:%x, b:%x", "return %r"]))));
      assert.equal(phi && phi.code, "air.control.unstructured_unsupported");
      // The legacy CFG codes stay legacy-only and unchanged.
      const legacy = capture(() => { const mod = sp.parseSource("module legacy\ncapabilities { }\n\nexport func run() -> i32 {\nentry:\n  br\n}\n", "legacy.air"); sp.verifySource(mod); });
      assert.equal(legacy && legacy.code, "air.control.br_syntax_invalid");
      const legacyPhi = sp.parseSource(phiLoop, "phi_loop.air");
      sp.verifySource(legacyPhi);
      return { value: { NEW_LOOP_SYNTAX_ENABLED: false, PHI_ADMITTED_IN_TYPED: false, RAW_STACK_OVERFLOW_POSSIBLE: false, legacy_br: legacy.code, legacy_phi_loop: "VERIFIED", loop_form: loop.code } };
    });

    // ------------------------------------------------------------------
    // EACH_SLICE vectors re-run on the P0-04 corpus.
    await vector("V53-FMT-01@P0-04", () => {
      // OPEN-3 (a) keeps the typed-v0.51 rule: functions in name order. The R2
      // fixtures with a pinned other order are judged by idempotence (as R-6
      // does for frozen inputs); every other source equals its canonical output.
      for (const source of acceptedSources) {
        const once = sp.formatSource(typedV053(source), GATED);
        if (!prescribedOrder.has(source)) assert.equal(once, source, "the source equals the canonical output");
        assert.equal(sp.formatSource(typedV053(once), GATED), once, "idempotent");
      }
      return { value: { judged_by_idempotence: [...acceptedSources].filter((source) => prescribedOrder.has(source)).length, sources: acceptedSources.size } };
    });
    await vector("V53-LSP-01@P0-04", () => {
      const file = path.join(tmp, "lsp01.air");
      fs.writeFileSync(file, M("v53.call", fn("export func run(x: i32) -> i32", ["call @missing(%x)", "return %x"])));
      const report = JSON.parse(runCli(["check", file, "--source-profile", V053, "--allow-candidate-profile", "--lsp-json"]).stdout);
      assert.equal(report.diagnostics[0].code, "air.call.unknown_function");
      assert.equal(report.diagnostics[0].line, 4);
      return { value: { code: report.diagnostics[0].code, line: report.diagnostics[0].line, status: report.status } };
    });
    await vector("V53-LSP-02@P0-04", () => {
      const session = new AirLspSession({ allowCandidateProfile: true, sourceProfile: V053 });
      const checks = [];
      for (const source of [cfgN01, M("v53.call", fn("export func f(x: i32) -> i32", ["%r: i32 = call @f(%x)", "return %r"]))]) {
        const thrown = capture(() => typedV053(source));
        const [published] = session.handleMessage({ jsonrpc: "2.0", method: "textDocument/didOpen", params: { textDocument: { text: source, uri: `file://${path.join(tmp, `lsp02-${checks.length}.air`)}`, version: 1 } } });
        assert.equal(published.params.diagnostics[0].code, thrown.code, "err.code preserved");
        checks.push(thrown.code);
      }
      return { value: checks };
    });
    await vector("V53-DIAG-01@P0-04", () => {
      const registry = new Set([...EARLIER_CODE_REGISTRY, ...P0_04_CODE_REGISTRY]);
      const notePath = path.join(ROOT, "docs", "v0.53", "P0_04_CALLS_CFG.md");
      if (fs.existsSync(notePath)) {
        const note = fs.readFileSync(notePath, "utf8");
        const section = note.slice(note.indexOf("## 5."), note.indexOf("## 6."));
        const listed = [...section.matchAll(/^\| `(air\.[a-z0-9_.]+)` \|/gmu)].map((match) => match[1]).sort();
        assert.deepEqual(listed, [...P0_04_CODE_REGISTRY].sort(), "the note's registry table lists exactly the P0-04 codes");
      }
      for (const item of observedFailures) {
        assert(registry.has(item.code), `${item.code} is in the registry`);
        if (item.kind === "STATIC_REJECT") assert(Number.isInteger(item.line), `${item.code} has a location`);
      }
      return { value: { failures_checked: observedFailures.length, p0_04_codes: P0_04_CODE_REGISTRY.length } };
    });
    await vector("V53-DIAG-02@P0-04", async () => {
      // Deterministic fuzz of the P0-04 corpus: no raw TypeError, JS stack, WABT
      // text or engine error; a verified source always builds (R-COMP-3).
      let seed = 0x0f0404;
      const next = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed; };
      const ops = ["call @inc(%x)", "call @missing()", "call", "@f", "yield %r", "yield 1", "} else {", "}", "{", "if %c {", "return", "entry:", "br done", "phi.i32 a:%x",
        "%x: i32 = call @f(%x)", "match", "=>", "void", "i32<0..10>", "%r", ",", "(", ")"];
      const registry = new Set([...EARLIER_CODE_REGISTRY, ...P0_04_CODE_REGISTRY]);
      const corpus = [...acceptedSources].filter((source) => Buffer.byteLength(source, "utf8") < 8192);
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
        else if (mode === 3) lines[at] = lines[at].replace(/[a-z0-9_.@%]+/u, ops[next() % ops.length]);
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
        new WebAssembly.Module(await watToWasm(wat, "fuzz.air"));
        assembled += 1;
      }
      assert.equal(assembled, verifiedCount, "every verified fuzz source builds");
      return { value: { assembled, cases, verified: verifiedCount } };
    });

    // ------------------------------------------------------------------
    // REG-P04-QA-F1-*: additive regression tests for the independent QA finding
    // P04-QA-F-1 (nested block-bodied match arms were reached twice by the intake
    // AST-node walk). Test-local IDs, not catalogue vectors. Expected values are
    // derived from R-WB-15/15c, R-CFG-1 and the CT-1 composition of slice text R2
    // §4.6 before the correction (evidence expectations/EXPECTATIONS.md).
    await regP04QaF1();
  } finally {
    fs.rmSync(tmp, { force: true, recursive: true });
  }

  const outDir = process.env.AIR_P004_VECTOR_RESULTS_DIR;
  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "v053_calls_cfg.results.json"), `${JSON.stringify(results, null, 2)}\n`);
  }
  const passed = results.filter((item) => item.status === "PASS").length;
  const deferred = results.filter((item) => item.status === "DEFERRED").map((item) => item.vector);
  if (failures.length) {
    for (const failure of failures) console.error(`not ok - ${failure}`);
    console.error(`typed-v0.53 P0-04 vectors: ${failures.length} FAIL, ${passed} PASS`);
    process.exit(1);
  }
  for (const item of results) console.log(`ok - ${item.vector} ${item.status}`);
  console.log(`typed-v0.53 P0-04 vectors: ${passed} PASS, ${deferred.length} DEFERRED (${deferred.join(", ")})`);
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
