#!/usr/bin/env node
"use strict";

// typed-v0.53 P0-07 (AIR-0053-P0-07-0001): exact module constants and
// invocation-scoped state cells with static indexes, charged by the existing
// aggregate.access row (OD-P7-1 (a′); CT-1 unchanged at P0-06-AGG-1), the
// formatter, decls (OD-P7-2 (a)), the typed refusal of `generate
// state-handles` (P7-R14 with the admission's BA-1) and the module header
// before any module item (BA-2). Every expected value below is copied from the
// R3.1 catalogue (VECTORS.md, sha256 f5353705..., rows 315-316, 328-330, 494)
// or the admitted P0-07 slice text R2 (P0_07_SLICE_RFC.md and
// VECTORS_ADDITIONS.md; folder SHA256SUMS a7ac98e4...; admission record
// e5b0f2e7... with BINDING_ADDITIONS BA-1 and BA-2), never from the output of
// the implementation under test. Fixture bytes come from the slice text's
// generator (tools/derive_p007.py), ported below and pinned by the byte
// counts, sha256 values, lines and measures of its output
// (tool_outputs/derive_p007.out.txt). ACCEPT and RUNTIME_FAIL rows run through
// the verified builder and the generic runtime with the descriptor of the
// source signature; a STATIC_REJECT row is checked at every entrypoint that
// verifies (P4-R8). P0-07-SEP-WB is P0-07's separation check (P7-R19) and
// P0-07-CHECK-STATE its O(1) and initialization evidence (P7-R11). Set
// AIR_P007_VECTOR_RESULTS_DIR=<dir> to write one canonical result record per
// vector, and AIR_P007_CHECK_STATE_FILE=<file> to write the CHECK-STATE
// evidence.
const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const sp = require("../src/source_profile");
const parser = require("../src/parser");
const wb = require("../src/workbound");
const { measureTypedModule } = require("../src/analysis_capacity");
const { AirLspSession } = require("../src/lsp_server");
const { instantiateAirModule } = require("../src/sdk");
const {
  buildVerifiedTypedModule,
  createVerifiedTypedRuntime,
  inspectVerifiedTypedBuild,
  invokeVerifiedTypedExport
} = require("../src/v052_verified_build");
const { lowerToWat, watToWasm } = require("../src/lower_wasm");

const ROOT = path.resolve(__dirname, "..");
const V053 = "typed-v0.53";
const GATED = Object.freeze({ allowCandidateProfile: true, sourceProfile: V053 });
const MAX_WAT = 4194304;
// R-DIAG-2: the codes typed-v0.53 emitted before P0-07 (as in
// test/v053_tables_aggregates.test.js) and the P0-07 codes
// (docs/v0.53/P0_07_STATE.md §5): the PROPOSED air.const.initializer_invalid
// and the EXISTING legacy air.state.* codes reused with their meaning (G-4).
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
  "air.v052.verified_build_invalid", "air.v052.verified_build_descriptor_mismatch",
  "air.call.argument_count_mismatch", "air.call.recursion_rejected", "air.call.result_unbound", "air.call.unknown_function",
  "air.control.unstructured_unsupported", "air.control.yield_missing", "air.workbound.overflow",
  "air.loop.count_out_of_range", "air.loop.form_unsupported", "air.workbound.assertion_exceeded",
  "air.workbound.invalid_bound", "air.workbound.unknown_bound",
  "air.abi.export_type_unsupported", "air.array.index_out_of_range", "air.table.index_out_of_range", "air.table.readonly"
]);
const P0_07_CODE_REGISTRY = Object.freeze([
  "air.const.initializer_invalid", "air.state.cell_type_invalid", "air.state.dynamic_bounds_required", "air.state.dynamic_length",
  "air.state.index_out_of_bounds", "air.state.init_invalid", "air.state.length_invalid", "air.state.op_invalid", "air.state.segment_invalid"
]);

// ---------------------------------------------------------------------------
// The slice text's generator (tools/derive_p007.py), ported line for line:
// two-space indentation per block level, one blank line between module items,
// LF, one trailing LF, lines numbered from the `module` line.
function mod(name, ...items) {
  const lines = [`module ${name}`];
  for (const item of items) lines.push("", ...item);
  return `${lines.join("\n")}\n`;
}
const func = (header, body) => [`${header} {`, ...body.map((line) => `  ${line}`), "}"];
const AGG = "v53.agg";
const ST = "v53.state";
const RUN = func("export func run(i: i32) -> i32", ["return %i"]);
const T2 = ["table t: i64[2] = [9007199254740993, 9223372036854775807]"];
const S2 = ["state s: i32[2] = fill 0"];
const G = (body, sig = "export func run(i: i32) -> i32") => func(sig, body);
const BUMP = func("export func bump() -> i32", ["%v: i32 = state.get s, 0", "%n: i32 = i32.wrapping_add %v, 1", "state.set s, 0, %n", "return %n"]);
const INC = func("func inc() -> i64", ["%v: i64 = state.get c, 0", "%n: i64 = i64.checked_add %v, ONE", "state.set c, 0, %n", "return %n"]);
const FMT_IN = [`module ${ST}`, "", "export func get(i: i32) -> i32 {", "  %v: i32 = state.get s, 1", "  %w: i32 = i32.wrapping_add %v, K",
  "  return %w", "}", "", "state s : i32 [ 2 ]=fill -0", "const K: i32 = 7", "state d: f64[1] = fill 1", "table t: i32[1] = [5]",
  "const B: bool = true", ""].join("\n");
const FMT_OUT = mod(ST, ["const B: bool = true"], ["const K: i32 = 7"], ["table t: i32[1] = [5]"], ["state d: f64[1] = fill 1.0"],
  ["state s: i32[2] = fill 0"], func("export func get(i: i32) -> i32", ["%v: i32 = state.get s, 1", "%w: i32 = i32.wrapping_add %v, K", "return %w"]));
const STEP = func("func step(acc: i32) -> i32", ["%v: i32 = state.get s, 0", "%n: i32 = i32.wrapping_add %v, 1", "state.set s, 0, %n",
  "%r: i32 = i32.wrapping_add %acc, %n", "return %r"]);
const BIGS = (n) => mod(ST, [`state s: i32[${n}] = fill 0`], func("export func run(i: i32) -> i32",
  [`state.set s, ${n - 1}, %i`, `%v: i32 = state.get s, ${n - 1}`, "return %v"]));

const F = {
  "AGG-P03": mod(AGG, ["const BASE: i64 = 9007199254740993"], func("export func run(i: i32) -> i64", ["%v: i64 = i64.checked_add BASE, 0", "return %v"])),
  "AGG-N04": mod(AGG, ["const C: i32 = i32.wrapping_add 1, 2"], RUN),
  "STATE-P01": mod(ST, S2, BUMP),
  "STATE-N01": {
    i: mod(ST, S2, func("export func h() -> s", ["return 0"])),
    ii: mod(ST, S2, func("export func h(x: s) -> i32", ["return 0"]))
  },
  "AGG-P10": {
    i: mod(AGG, ["const BIG: i64 = -9223372036854775808"], ["const FLAG: bool = true"], ["const IDX: i32 = 1"], ["const SCALE: f64 = 1.0"],
      ["const TINY: f32 = 16777217.0"], T2,
      func("export func flag() -> bool", ["return FLAG"]),
      func("export func run(i: i32) -> i64", ["%a: i64 = table.get t, IDX", "%b: i64 = BIG", "%c: i64 = i64.checked_add %a, %b", "return %c"]),
      func("export func scale() -> f64", ["return SCALE"]),
      func("export func tiny() -> f32", ["return TINY"])),
    ii: mod(AGG, ["const K: i32 = 3"], func("func g(acc: i32) -> i32", ["return %acc"]),
      func("export func run() -> i32", ["%r: i32<0..9> = K", "%o: option<i32> = option.some<i32> K", "%f: i32 = loop.fold @g, K, 2", "return %f"]))
  },
  "AGG-N15": {
    i: mod(AGG, ["const A: i32 = 1"], ["const A: i32 = 2"], RUN),
    ii: mod(AGG, ["const base: i32 = 1"], RUN),
    iii: mod(AGG, ["const R: i32<0..9> = 3"], RUN),
    iv: mod(AGG, ["const C: i32 = 3000000000"], RUN),
    v: mod(AGG, ["const C: bool = 1"], RUN),
    vi: mod(AGG, ["const C: i32 = 007"], RUN),
    vii: mod(AGG, ["const A: i32 = 1"], ["const B: i32 = A"], RUN),
    viii: mod(AGG, func("export func run(i: i32) -> i32", ["%v: i32 = NOPE", "return %v"])),
    ix: mod(AGG, ["const IDX: i32 = 2"], T2, func("export func get(i: i32) -> i64", ["%v: i64 = table.get t, IDX", "return %v"])),
    x: mod(AGG, ["const C: i32 = 1"], func("export func run(i: i32) -> i64", ["%v: i64 = i64.checked_add C, 0", "return %v"])),
    xi: mod(AGG, ["const ONE: i32 = 1"], ["table t: i32[1] = [ONE]"], RUN),
    xii: mod(AGG, ["const LIMIT: i32 = 3"], func("func g(acc: i32) -> i32", ["return %acc"]),
      func("export func run(i: i32) -> i32", ["%r: i32 = loop.fold @g, %i, LIMIT", "return %r"])),
    xiii: mod(AGG, ["const TEN: i32 = 10"], func("export func run(i: i32) -> i32", ["%r: i32<0..9> = TEN", "return %i"])),
    iip: mod(AGG, ["const BASE: i32 = 1"], RUN),
    iiip: mod(AGG, ["const R: i32 = 3"], RUN),
    viiip: mod(AGG, ["const NOPE: i32 = 1"], func("export func run(i: i32) -> i32", ["%v: i32 = NOPE", "return %v"])),
    xp: mod(AGG, ["const C: i32 = 1"], func("export func run(i: i32) -> i64", ["%v: i64 = i64.checked_add 1, 0", "return %v"])),
    xiv: mod(AGG, ["const K: i32 = 5"], func("export func run(i: i32) -> i32", ["%v: i32 = const.i32 K", "return %v"])),
    xv: mod(AGG, ["const C: i32 = const.i32 5"], RUN),
    xvi: mod(AGG, ["const HI: i64 = 9223372036854775807"], func("export func run(i: i32) -> i64", ["%v: i64 = i64.checked_add HI, 1", "return %v"])),
    xvii: mod(AGG, func("export func run(i: i32) -> i32", ["const K: i32 = 1", "return %i"])),
    xivp: mod(AGG, ["const K: i32 = 5"], func("export func run(i: i32) -> i32", ["%v: i32 = const.i32 5", "return %v"])),
    xviip: mod(AGG, ["const K: i32 = 1"], RUN)
  },
  "STATE-P02": {
    i: mod(ST, ["const ONE: i64 = 1"], ["state c: i64[1] = fill -9223372036854775808"], ["state f: f64[2] = fill 1.0"], ["state ok: bool[1] = fill true"],
      func("export func flag() -> bool", ["%v: bool = state.get ok, 0", "return %v"]),
      func("export func fo() -> f64", ["%v: f64 = state.get f, 0", "return %v"]),
      func("export func fz() -> f64", ["state.set f, 1, -0.0", "%v: f64 = state.get f, 1", "return %v"]),
      INC, func("export func run() -> i64", ["%a: i64 = call @inc()", "%b: i64 = call @inc()", "return %b"])),
    ii: mod(ST, ["state s: i32[1] = fill 0"], func("export func run() -> i32", ["%r: i32 = loop.fold @step, 0, 3", "return %r"]), STEP),
    iii: BIGS(65536),
    iii2: BIGS(2),
    iv: mod(ST, ["state s: i32[1] = fill 20"], func("export func run() -> i32", ["%r: i32<0..9> = state.get s, 0", "return %r"]))
  },
  "STATE-P03": { in: FMT_IN, out: FMT_OUT },
  "STATE-N03": {
    i: mod(ST, ["state s: u8[2] = fill 0"], RUN),
    ii: mod(ST, ["struct P { x: i32 }"], ["state s: P[2] = fill 0"], RUN),
    iii: mod(ST, ["state s: i32[0] = fill 0"], RUN),
    iv: mod(ST, ["state s: i32[65537] = fill 0"], RUN),
    v: mod(ST, ["state s: i32[02] = fill 0"], RUN),
    vi: mod(ST, ["state s: i32[N] = fill 0"], RUN),
    vii: mod(ST, ["state s: i32[2] = [1, 2]"], RUN),
    viii: mod(ST, ["state s: i32[2] = fill 3000000000"], RUN),
    ix: mod(ST, ["const Z: i32 = 0"], ["state s: i32[2] = fill Z"], RUN),
    x: mod(ST, ["state s: i32[2] = fill true"], RUN),
    xi: mod(ST, S2, ["state s: i32[1] = fill 1"], RUN),
    xii: mod(ST, ["table s: i32[1] = [1]"], S2, RUN),
    xiii: mod(ST, ["state s i32[2] = fill 0"], RUN),
    xiv: mod(ST, ["global g: i32 = const.i32 0"], RUN),
    xivp: mod(ST, ["state g: i32[1] = fill 0"], RUN),
    xv: mod(ST, ["state s: i32[1] = fill 0 persistent"], RUN),
    xvi: mod(ST, ["state s: i32[1] = fill 0"], ["table s: i32[1] = [1]"], RUN),
    xvii: mod(ST, ["state s: i32[1] = fill const.i32 0"], RUN)
  },
  "STATE-N04": {
    i: mod(ST, S2, G(["%v: i32 = state.get s, 2", "return %v"])),
    ii: mod(ST, S2, G(["state.set s, -1, 0", "return %i"])),
    iii: mod(ST, S2, G(["%v: i32 = state.get s, %i", "return %v"])),
    iv: mod(ST, S2, G(["%k: i32 = i32.wrapping_add 0, 1", "%v: i32 = state.get s, %k", "return %v"])),
    viii: mod(ST, S2, G(["%v: i32 = state.get nope, 0", "return %v"])),
    ix: mod(ST, S2, G(["%x: i32 = state.set s, 0, 1", "return %i"])),
    x: mod(ST, S2, G(["%n: i32 = state.len s", "return %n"])),
    xi: mod(ST, S2, G(["state.set s, 0, true", "return %i"])),
    xii: mod(ST, S2, G(["%v: i64 = state.get s, 0", "return %i"])),
    xiii: mod(ST, S2, G(["return s"])),
    xiv: mod(ST, S2, func("func g() -> s", ["return 0"]), RUN),
    xv: mod(ST, S2, G(["state.get s, 0", "return %i"])),
    xvi: mod(ST, S2, G(["%v: i32 = state.get s", "return %v"])),
    xvii: mod(ST, S2, G(["%v: i32 = state.get s, +0", "return %v"])),
    v: mod(ST, S2, G(["%k: i32 = 1", "%v: i32 = state.get s, %k", "return %v"])),
    vi: mod(ST, S2, G(["%v: i32 = state.get s, -0", "return %v"])),
    viout: mod(ST, S2, G(["%v: i32 = state.get s, 0", "return %v"])),
    vii: mod(ST, ["const IDX: i32 = 1"], S2, G(["%v: i32 = state.get s, IDX", "return %v"])),
    xiiip: mod(ST, S2, G(["%v: i32 = state.get s, 1", "return %v"])),
    xivp: mod(ST, S2, func("func g() -> i32", ["return 0"]), RUN)
  },
  "CACHE-01": {
    ii: mod(ST, ["state s: i32[1] = fill 0"],
      func("export func bad() -> i32", ["state.set s, 0, 5", "%r: i32<0..3> = state.get s, 0", "return %r"]),
      func("export func peek() -> i32", ["%v: i32 = state.get s, 0", "return %v"]))
  }
};

// Bytes, sha256 and named line of every fixture, from
// tool_outputs/derive_p007.out.txt (generator order).
const PINS = Object.freeze({
  "AGG-P03": [135, "f7af7b6790a73b7445ec9701e846bde24c99d5abce0ed3d15403a990c126011a", 3], // V53-AGG-P03 (adopted from P0-06 R2)
  "AGG-N04": [101, "955a2815ea990066b388e6572ffe5beeb0fec40d70fa6de00447bf7d15d9fd35", 3], // V53-AGG-N04 (adopted from P0-06 R2)
  "STATE-P01": [169, "a15ccff86fd79c983252d68b229d5d0ed8ac54531d2b2fb3862bac79db275755", 8], // V53-STATE-P01 = V53-SEP-CACHE-01 module
  "STATE-N01.i": [80, "30bc81714b3b8924323351b2f02eada8b52e0c0a310ed689c36c4cffa26c581e", 5], // V53-STATE-N01 (i) state name as an export result type
  "STATE-N01.ii": [86, "9ff3a27985e0ed2f147f66e46ee9ec6a3b0d89d32b260ba8171e67aeb9aa490f", 5], // V53-STATE-N01 (ii) state name as an export parameter type
  "AGG-P10.i": [478, "a02bb8048aab72f040784b1418745afbe526b00edbca413e7bd7bce04196a3f1", 20], // V53-AGG-P10 constants of every type, statically known index
  "AGG-N15.i": [99, "142d6347e484fa42c75821f73dfcab96b9e788ca1851611a7fed2042966508f8", 5], // V53-AGG-N15 (i) duplicate constant
  "AGG-N15.ii": [84, "db2545f15fc755113bee6038798a03174c6eb5182fead8da02bd03c4de500f45", 3], // V53-AGG-N15 (ii) lowercase constant name
  "AGG-N15.iii": [87, "10ba60d03ab0adac2c17eed34ae0597bdf61c5420b7bf34965e274b7356fdb23", 3], // V53-AGG-N15 (iii) refined constant type
  "AGG-N15.iv": [90, "96759840404df9d28d579b829be096888d25fe48bceb54f6e67e959fe1ced15a", 3], // V53-AGG-N15 (iv) i32 literal out of range
  "AGG-N15.v": [82, "3b049224fa356ea018462d12216a93389280af29061439c47dd71b4085022e4b", 3], // V53-AGG-N15 (v) literal of another kind
  "AGG-N15.vi": [83, "08cf7a6feaa1ac00ca04b64906f9099088b1b94e1a88c3fa8ed9e1d058f8abdb", 3], // V53-AGG-N15 (vi) malformed literal
  "AGG-N15.vii": [99, "e24eae200ebc4a01bb64bf9a454d6f01ed919fc71043fac9bcfec42c46dd3614", 5], // V53-AGG-N15 (vii) constant reference as an initializer
  "AGG-N15.viii": [80, "13dad151a658dc08581990da49c00445736747bca9eeb18a3a56ac99cb458f44", 4], // V53-AGG-N15 (viii) unknown constant reference
  "AGG-N15.ix": [171, "af231fd858fb34f8d269d0d859478c8203d73105799bd8eb37ba95e59d5a29f1", 8], // V53-AGG-N15 (ix) constant index statically out of range
  "AGG-N15.x": [114, "a84a905d23fcbcf7d246e6f56ba8186dd4ebe0a391d9b8b38884a8a46e27bba6", 6], // V53-AGG-N15 (x) typed constant where another type is required
  "AGG-N15.xi": [108, "36d17cd813b7a78d8fdbc819310c63c6ba1a18dcb83edc408ba320e6ca855264", 5], // V53-AGG-N15 (xi) constant in a table literal
  "AGG-N15.xii": [164, "864c81ad58fe3abf6f85a4f51d43badcf91f191d41e371b1e2ec23666e3c97b0", 10], // V53-AGG-N15 (xii) constant as a fold count
  "AGG-N15.xiii": [106, "df8f833a4690793919af9e4cc0d2d066b63ea8e1085cffe1e54c3f2370090761", 6], // V53-AGG-N15 (xiii) statically known constant outside a refinement
  "AGG-N15.iip": [84, "0d9661272f1ea705f35a6058a8676b5a58afb401daac55784677cd47407982ce", 3], // V53-AGG-N15 (ii) pair control (+): an uppercase name
  "AGG-N15.iiip": [81, "86d4c1b56ae0b7ffcf18722f1e667a4bcd21281f31d1f29a93fa91b2d390861d", 3], // V53-AGG-N15 (iii) pair control (+): an unrefined type
  "AGG-N15.viiip": [101, "bc7c0202558e1d6f98f66f041f6fb09fbe81998ff2a1934714374703044d70e5", 6], // V53-AGG-N15 (viii) pair control (+): the constant declared
  "AGG-N15.xp": [114, "88e3b6627c76685e1b848cbbf4da0379e61ad50441eb56a5f5b694f97e525a40", 6], // V53-AGG-N15 (x) pair control (+): a literal instead of the typed constant
  "STATE-P02.i": [582, "bc60a4b73f8f98f4b12ee6dfc208d84ae834b3b1f72962c6bced43f55d803842", 36], // V53-STATE-P02 state shared within one invocation; i64, f64 and bool cells
  "STATE-P03.in": [241, "03852c36ed2a4ba74b0f7da0dfde277598bb19c27ead05d6211e7ce7da46b0a9", 9], // V53-STATE-P03 formatter input (non-canonical)
  "STATE-P03.out": [244, "1b37e2af5ac667e25a634b35cce0b2b1f7163fb7138905822d235f29cf405100", 11], // V53-STATE-P03 canonical output
  "STATE-N03.i": [90, "78126b4d69a6304a2fed746e41f2b206f7e439733be477b795058e4e0d85a580", 3], // V53-STATE-N03 (i) compact cell type
  "STATE-N03.ii": [110, "d7c62e092067fc54ca98e912ae74b4c1e94700bcc0bf368a53afac15d516ebfd", 5], // V53-STATE-N03 (ii) aggregate cell type
  "STATE-N03.iii": [91, "f15fd0ee85bbc1f274c82930c20ed07109c04cb7eaeab0c5e2d5f2a58c98a47a", 3], // V53-STATE-N03 (iii) length 0
  "STATE-N03.iv": [95, "81b2b7d2dc3d8373ac8189ea4c9b4fd0d1beafd01e5f1b5a8151879cde6174b2", 3], // V53-STATE-N03 (iv) length 65537
  "STATE-N03.v": [92, "f55f5e6e910f3a25339078f46991df75ff8954e706241a2453ae2141b0c967fb", 3], // V53-STATE-N03 (v) length with a leading zero
  "STATE-N03.vi": [91, "1fd1719880126432a92c0a6eb9deda40a3b67dca49a4e62eee6b3218caa4e58f", 3], // V53-STATE-N03 (vi) dynamic length
  "STATE-N03.vii": [91, "e893d14bf15ba57a395961bb03c5b990caca2c06eaf5be77fbf7cbc72a90f6e3", 3], // V53-STATE-N03 (vii) initializer is not fill
  "STATE-N03.viii": [100, "3b7436bd3bdc89d9f560ebc459726215c839f2b1f14252f26a412ef06868f53c", 3], // V53-STATE-N03 (viii) fill literal out of range
  "STATE-N03.ix": [109, "5dbcbcee7d4f5abda99f437ad39a74e4955f117f9faf499e22b115f0e4fa6cf7", 5], // V53-STATE-N03 (ix) fill with a constant
  "STATE-N03.x": [94, "66b2007496ce786a0e4f46d35a9901be2f47cf934afe1e478145f0df39bd8cfc", 3], // V53-STATE-N03 (x) fill literal of another kind
  "STATE-N03.xi": [117, "a4443b54cc2002ca3712a8f17fc9486eaf2344b537f027fe8ee2360995ee09e4", 5], // V53-STATE-N03 (xi) duplicate state
  "STATE-N03.xii": [114, "ba720d9b5273991a1196d06c7eb5088117e48f77de4638d7833520fbe66a8461", 5], // V53-STATE-N03 (xii) state with a table's name
  "STATE-N03.xiii": [90, "fd1d5cc910bc8f292ca7ec9af32f8ff2ce26f2dc7355b165e78cc5834919e681", 3], // V53-STATE-N03 (xiii) malformed state line
  "STATE-N03.xiv": [94, "e3f3fd4f7093666f775910253b4ef04a4b41d1283892f73b1e606024ad2c13d9", 3], // V53-STATE-N03 (xiv) legacy global line
  "STATE-N03.xivp": [91, "06354c82165c101c1200c9122178ddde5391553dd9e2bf309485256836960f94", 3], // V53-STATE-N03 (xiv) pair control (+): a state segment of one cell
  "STATE-N04.i": [118, "a372919a4852724546564b94ef8c829286b0d1ed20bc74f6010b8bf9f9f6ca99", 6], // V53-STATE-N04 (i) static index out of bounds
  "STATE-N04.ii": [112, "f8ec51ef4c6eac1631a29ba6f6130617ebb616fbd0f52c081701870f6612fea9", 6], // V53-STATE-N04 (ii) static index -1 on state.set
  "STATE-N04.iii": [119, "19c72571f73749456dda0bb7f361f491611bdcb40e884da5e71087f3d75f0a59", 6], // V53-STATE-N04 (iii) dynamic index (R3-N11)
  "STATE-N04.iv": [153, "e9b8d44ae73e190203ab00bfc65afb051ba026810bd8a01c64324156fb2d691a", 7], // V53-STATE-N04 (iv) index not statically known
  "STATE-N04.viii": [121, "e22f229729f6d4f1ad39b6bf414cc9e7fb8cbd5d67b44c4e406224f0cd2f816b", 6], // V53-STATE-N04 (viii) unknown state
  "STATE-N04.ix": [121, "3336229b6870414c2460044f56cbe4254f07e7ab62d39314a41b3d81e76adc71", 6], // V53-STATE-N04 (ix) state.set with a result binding
  "STATE-N04.x": [115, "560c0181d3d0468623f4c3ba0a689359ffb455131bb8e9c3c2b584f423fec67c", 6], // V53-STATE-N04 (x) state.len
  "STATE-N04.xi": [114, "282d51cb1c040c3b2963bfa3bde691ca456947123c5232bbca00a5c64d8edb28", 6], // V53-STATE-N04 (xi) value of another type
  "STATE-N04.xii": [118, "967a774b1090fee230140385dc088bcd81a4010d5f56755eac2655022895833e", 6], // V53-STATE-N04 (xii) result of another type
  "STATE-N04.xiii": [90, "c46ed99d0dd9f047f2a89c8935254cee21da4ac8baf02b3d4a0b008d04124915", 6], // V53-STATE-N04 (xiii) a state name as a value
  "STATE-N04.xiv": [121, "71e83ede72da4c0823ec66b3b65c8ed886ca3318327036c22c5a386ba43c4616", 5], // V53-STATE-N04 (xiv) a state name as an internal type
  "STATE-N04.xv": [108, "e686840294e89b4647a7e88c3607219e8d323eda67b47473a2618df48b8661bc", 6], // V53-STATE-N04 (xv) state.get without a binding
  "STATE-N04.xvi": [115, "2af061cd79c919cd0bdf10927dc411f010d43d1e6273e5b2bab9db6f9bb11c3b", 6], // V53-STATE-N04 (xvi) state.get operand count
  "STATE-N04.xvii": [119, "a38621eb3394f75288f786b1ed525c269e2543839b5707aac6402ab03cc7ec28", 6], // V53-STATE-N04 (xvii) index +0
  "STATE-N04.v": [133, "006180ee765eb47a5a840b682b6c450fc506f2d3998f7feefc5b15528867f9c3", 7], // V53-STATE-N04 (v) control: statically known local index
  "STATE-N04.vi": [119, "5e3c3c7c621ea6b8913235086bf345d08894f6e74797935408ad66fe7e340815", 6], // V53-STATE-N04 (vi) control: index -0
  "STATE-N04.viout": [118, "b751c1a670dbc5901549e2fa6583739359d1b68933ea41d77f419ee94cf4c80f", 6], // V53-STATE-N04 (vi) canonical output
  "STATE-N04.vii": [140, "890a727ba7d44e83e407dfb27a8150cab80368b0e971b477d567f00641b6ebf0", 8], // V53-STATE-N04 (vii) control: constant index
  "STATE-N04.xiiip": [118, "6cef1a4265e9c8e6b2f17ddde51e7f7b81b5a758cf9c9e531949f0f12a6fb10f", 6], // V53-STATE-N04 (xiii) pair control (+): read the state
  "STATE-N04.xivp": [123, "e696ef39976697d51f4c4594b98844211b22dfc12d8f8c97f6830e6f61dc9788", 5], // V53-STATE-N04 (xiv) pair control (+): an internal function of a value type
  "AGG-P10.ii": [208, "95e74d8e1d0ad0adb913ac8696cc255f52b07ff22cc82aceb70c4213b3da3380", 12], // V53-AGG-P10 (ii) a constant in a refined destination, a constructor payload and a fold seed
  "AGG-N15.xiv": [105, "306dc119a85f1e803628493f09e0235195c00679237d68f303f626b3229a315a", 6], // V53-AGG-N15 (xiv) a literal carrier over a constant (X-VL-01)
  "AGG-N15.xv": [91, "d727738d23cf0d9d55fe27b7f432eaaa14367467e7a4317d3eae76ccdc855537", 3], // V53-AGG-N15 (xv) a literal carrier as a constant initializer
  "AGG-N15.xvi": [134, "7081139f19967c23a223eb392a7e99a331fd830553e164af731a8b34ef3eb63a", 6], // V53-AGG-N15 (xvi) a checked operation over constants that overflows
  "AGG-N15.xvii": [82, "565d94c7db8d85386e257f16fb30a49e321ce5499fc7718304b8022bb5850581", 4], // V53-AGG-N15 (xvii) a const line inside a function body
  "AGG-N15.xivp": [105, "c7d2cf64ea552ba9ae8c3573beea62281da4084c7a2e009e40e6f7c423bef543", 6], // V53-AGG-N15 (xiv) pair control (+): a literal carrier
  "AGG-N15.xviip": [81, "ce2b1835e17075d594722dea6a232696dfc309a177d1ea4541a686c066fb7033", 3], // V53-AGG-N15 (xvii) pair control (+): the const line at module level
  "STATE-P02.ii": [284, "95e2c09c541153aaf9835dd436856b4906dcd057cf6525487b7d6b2d0d7e55e8", 6], // V53-STATE-P02 (ii) state in a fold callback
  "STATE-P02.iii": [151, "17b8d69eef3cdf1d0dac2e306b000ebc3c1d1bddc56e71dec86c79b7d2d8a543", 7], // V53-STATE-P02 (iii) the largest state, N = 65536
  "STATE-P02.iii2": [139, "537ef6ebcc5d7e1983b6de067a3e15aecbdf09324d710dc2556789e6ec6b8560", 7], // V53-STATE-P02 (iii) comparison module, N = 2
  "STATE-P02.iv": [119, "1ef20c859f8e3743cec40c4eb075c05a8d62f25feb256696cbf093dfadea5d39", 6], // V53-STATE-P02 (iv) a refined destination on state.get
  "CACHE-01.ii": [208, "bfd74a8ba970900a5fd568a1aaff979ade8d380ae7005fc0837309f25b1f4b5a", 6], // V53-SEP-CACHE-01 (ii) failure-isolation module
  "STATE-N03.xv": [102, "43d1043bf887ce413589210e5862931d9c5d0a49c5f111efb5d2f975b97a6f58", 3], // V53-STATE-N03 (xv) a persistence-looking trailing word
  "STATE-N03.xvi": [114, "16b954c595de7d1da2b6163192ff4839dd64a8f968daf5bf7c815c079b2476c6", 5], // V53-STATE-N03 (xvi) a table after a state of the same name
  "STATE-N03.xvii": [101, "46b8b8b765d03b160b4b68ab27df752637ab7914cf317813a413ba1884cbc3fa", 3] // V53-STATE-N03 (xvii) a literal carrier as the fill value
});

// R-WB-15c measures of every fixture that verifies (P7-R17), from
// tool_outputs/derive_p007.out.txt.
const MEASURES = Object.freeze({
  "AGG-P03": { analysis_units: 5, decls: 2, stmts: 2, call_sites: 0, callback_refs: 0, nesting_depth: 1 },
  "STATE-P01": { analysis_units: 7, decls: 2, stmts: 4, call_sites: 0, callback_refs: 0, nesting_depth: 1 },
  "AGG-P10.i": { analysis_units: 18, decls: 10, stmts: 7, call_sites: 0, callback_refs: 0, nesting_depth: 1 },
  "AGG-N15.iip": { analysis_units: 4, decls: 2, stmts: 1, call_sites: 0, callback_refs: 0, nesting_depth: 1 },
  "AGG-N15.iiip": { analysis_units: 4, decls: 2, stmts: 1, call_sites: 0, callback_refs: 0, nesting_depth: 1 },
  "AGG-N15.viiip": { analysis_units: 5, decls: 2, stmts: 2, call_sites: 0, callback_refs: 0, nesting_depth: 1 },
  "AGG-N15.xp": { analysis_units: 5, decls: 2, stmts: 2, call_sites: 0, callback_refs: 0, nesting_depth: 1 },
  "STATE-P02.i": { analysis_units: 26, decls: 9, stmts: 14, call_sites: 2, callback_refs: 0, nesting_depth: 1 },
  "STATE-P03.in": { analysis_units: 10, decls: 6, stmts: 3, call_sites: 0, callback_refs: 0, nesting_depth: 1 },
  "STATE-P03.out": { analysis_units: 10, decls: 6, stmts: 3, call_sites: 0, callback_refs: 0, nesting_depth: 1 },
  "STATE-N03.xivp": { analysis_units: 4, decls: 2, stmts: 1, call_sites: 0, callback_refs: 0, nesting_depth: 1 },
  "STATE-N04.v": { analysis_units: 6, decls: 2, stmts: 3, call_sites: 0, callback_refs: 0, nesting_depth: 1 },
  "STATE-N04.vi": { analysis_units: 5, decls: 2, stmts: 2, call_sites: 0, callback_refs: 0, nesting_depth: 1 },
  "STATE-N04.viout": { analysis_units: 5, decls: 2, stmts: 2, call_sites: 0, callback_refs: 0, nesting_depth: 1 },
  "STATE-N04.vii": { analysis_units: 6, decls: 3, stmts: 2, call_sites: 0, callback_refs: 0, nesting_depth: 1 },
  "STATE-N04.xiiip": { analysis_units: 5, decls: 2, stmts: 2, call_sites: 0, callback_refs: 0, nesting_depth: 1 },
  "STATE-N04.xivp": { analysis_units: 6, decls: 3, stmts: 2, call_sites: 0, callback_refs: 0, nesting_depth: 1 },
  "AGG-P10.ii": { analysis_units: 10, decls: 3, stmts: 5, call_sites: 0, callback_refs: 1, nesting_depth: 1 },
  "AGG-N15.xivp": { analysis_units: 5, decls: 2, stmts: 2, call_sites: 0, callback_refs: 0, nesting_depth: 1 },
  "AGG-N15.xviip": { analysis_units: 4, decls: 2, stmts: 1, call_sites: 0, callback_refs: 0, nesting_depth: 1 },
  "STATE-P02.ii": { analysis_units: 12, decls: 3, stmts: 7, call_sites: 0, callback_refs: 1, nesting_depth: 1 },
  "STATE-P02.iii": { analysis_units: 6, decls: 2, stmts: 3, call_sites: 0, callback_refs: 0, nesting_depth: 1 },
  "STATE-P02.iii2": { analysis_units: 6, decls: 2, stmts: 3, call_sites: 0, callback_refs: 0, nesting_depth: 1 },
  "STATE-P02.iv": { analysis_units: 5, decls: 2, stmts: 2, call_sites: 0, callback_refs: 0, nesting_depth: 1 },
  "CACHE-01.ii": { analysis_units: 9, decls: 3, stmts: 5, call_sites: 0, callback_refs: 0, nesting_depth: 1 }
});

// P0-07-SEP-WB corpus (slice text P7-R19 item 1): the 76 distinct fixture
// texts, sorted by sha256 (the last section of derive_p007.out.txt).
const SEP_CORPUS_SHA256 = Object.freeze([
  "006180ee765eb47a5a840b682b6c450fc506f2d3998f7feefc5b15528867f9c3", "03852c36ed2a4ba74b0f7da0dfde277598bb19c27ead05d6211e7ce7da46b0a9",
  "06354c82165c101c1200c9122178ddde5391553dd9e2bf309485256836960f94", "08cf7a6feaa1ac00ca04b64906f9099088b1b94e1a88c3fa8ed9e1d058f8abdb",
  "0d9661272f1ea705f35a6058a8676b5a58afb401daac55784677cd47407982ce", "10ba60d03ab0adac2c17eed34ae0597bdf61c5420b7bf34965e274b7356fdb23",
  "13dad151a658dc08581990da49c00445736747bca9eeb18a3a56ac99cb458f44", "142d6347e484fa42c75821f73dfcab96b9e788ca1851611a7fed2042966508f8",
  "16b954c595de7d1da2b6163192ff4839dd64a8f968daf5bf7c815c079b2476c6", "17b8d69eef3cdf1d0dac2e306b000ebc3c1d1bddc56e71dec86c79b7d2d8a543",
  "19c72571f73749456dda0bb7f361f491611bdcb40e884da5e71087f3d75f0a59", "1b37e2af5ac667e25a634b35cce0b2b1f7163fb7138905822d235f29cf405100",
  "1ef20c859f8e3743cec40c4eb075c05a8d62f25feb256696cbf093dfadea5d39", "1fd1719880126432a92c0a6eb9deda40a3b67dca49a4e62eee6b3218caa4e58f",
  "282d51cb1c040c3b2963bfa3bde691ca456947123c5232bbca00a5c64d8edb28", "2af061cd79c919cd0bdf10927dc411f010d43d1e6273e5b2bab9db6f9bb11c3b",
  "306dc119a85f1e803628493f09e0235195c00679237d68f303f626b3229a315a", "30bc81714b3b8924323351b2f02eada8b52e0c0a310ed689c36c4cffa26c581e",
  "3336229b6870414c2460044f56cbe4254f07e7ab62d39314a41b3d81e76adc71", "36d17cd813b7a78d8fdbc819310c63c6ba1a18dcb83edc408ba320e6ca855264",
  "3b049224fa356ea018462d12216a93389280af29061439c47dd71b4085022e4b", "3b7436bd3bdc89d9f560ebc459726215c839f2b1f14252f26a412ef06868f53c",
  "43d1043bf887ce413589210e5862931d9c5d0a49c5f111efb5d2f975b97a6f58", "46b8b8b765d03b160b4b68ab27df752637ab7914cf317813a413ba1884cbc3fa",
  "537ef6ebcc5d7e1983b6de067a3e15aecbdf09324d710dc2556789e6ec6b8560", "560c0181d3d0468623f4c3ba0a689359ffb455131bb8e9c3c2b584f423fec67c",
  "565d94c7db8d85386e257f16fb30a49e321ce5499fc7718304b8022bb5850581", "5dbcbcee7d4f5abda99f437ad39a74e4955f117f9faf499e22b115f0e4fa6cf7",
  "5e3c3c7c621ea6b8913235086bf345d08894f6e74797935408ad66fe7e340815", "66b2007496ce786a0e4f46d35a9901be2f47cf934afe1e478145f0df39bd8cfc",
  "6cef1a4265e9c8e6b2f17ddde51e7f7b81b5a758cf9c9e531949f0f12a6fb10f", "7081139f19967c23a223eb392a7e99a331fd830553e164af731a8b34ef3eb63a",
  "71e83ede72da4c0823ec66b3b65c8ed886ca3318327036c22c5a386ba43c4616", "78126b4d69a6304a2fed746e41f2b206f7e439733be477b795058e4e0d85a580",
  "81b2b7d2dc3d8373ac8189ea4c9b4fd0d1beafd01e5f1b5a8151879cde6174b2", "864c81ad58fe3abf6f85a4f51d43badcf91f191d41e371b1e2ec23666e3c97b0",
  "86d4c1b56ae0b7ffcf18722f1e667a4bcd21281f31d1f29a93fa91b2d390861d", "88e3b6627c76685e1b848cbbf4da0379e61ad50441eb56a5f5b694f97e525a40",
  "890a727ba7d44e83e407dfb27a8150cab80368b0e971b477d567f00641b6ebf0", "955a2815ea990066b388e6572ffe5beeb0fec40d70fa6de00447bf7d15d9fd35",
  "95e2c09c541153aaf9835dd436856b4906dcd057cf6525487b7d6b2d0d7e55e8", "95e74d8e1d0ad0adb913ac8696cc255f52b07ff22cc82aceb70c4213b3da3380",
  "96759840404df9d28d579b829be096888d25fe48bceb54f6e67e959fe1ced15a", "967a774b1090fee230140385dc088bcd81a4010d5f56755eac2655022895833e",
  "9ff3a27985e0ed2f147f66e46ee9ec6a3b0d89d32b260ba8171e67aeb9aa490f", "a02bb8048aab72f040784b1418745afbe526b00edbca413e7bd7bce04196a3f1",
  "a15ccff86fd79c983252d68b229d5d0ed8ac54531d2b2fb3862bac79db275755", "a372919a4852724546564b94ef8c829286b0d1ed20bc74f6010b8bf9f9f6ca99",
  "a38621eb3394f75288f786b1ed525c269e2543839b5707aac6402ab03cc7ec28", "a4443b54cc2002ca3712a8f17fc9486eaf2344b537f027fe8ee2360995ee09e4",
  "a84a905d23fcbcf7d246e6f56ba8186dd4ebe0a391d9b8b38884a8a46e27bba6", "af231fd858fb34f8d269d0d859478c8203d73105799bd8eb37ba95e59d5a29f1",
  "b751c1a670dbc5901549e2fa6583739359d1b68933ea41d77f419ee94cf4c80f", "ba720d9b5273991a1196d06c7eb5088117e48f77de4638d7833520fbe66a8461",
  "bc60a4b73f8f98f4b12ee6dfc208d84ae834b3b1f72962c6bced43f55d803842", "bc7c0202558e1d6f98f66f041f6fb09fbe81998ff2a1934714374703044d70e5",
  "bfd74a8ba970900a5fd568a1aaff979ade8d380ae7005fc0837309f25b1f4b5a", "c46ed99d0dd9f047f2a89c8935254cee21da4ac8baf02b3d4a0b008d04124915",
  "c7d2cf64ea552ba9ae8c3573beea62281da4084c7a2e009e40e6f7c423bef543", "ce2b1835e17075d594722dea6a232696dfc309a177d1ea4541a686c066fb7033",
  "d727738d23cf0d9d55fe27b7f432eaaa14367467e7a4317d3eae76ccdc855537", "d7c62e092067fc54ca98e912ae74b4c1e94700bcc0bf368a53afac15d516ebfd",
  "db2545f15fc755113bee6038798a03174c6eb5182fead8da02bd03c4de500f45", "df8f833a4690793919af9e4cc0d2d066b63ea8e1085cffe1e54c3f2370090761",
  "e22f229729f6d4f1ad39b6bf414cc9e7fb8cbd5d67b44c4e406224f0cd2f816b", "e24eae200ebc4a01bb64bf9a454d6f01ed919fc71043fac9bcfec42c46dd3614",
  "e3f3fd4f7093666f775910253b4ef04a4b41d1283892f73b1e606024ad2c13d9", "e686840294e89b4647a7e88c3607219e8d323eda67b47473a2618df48b8661bc",
  "e696ef39976697d51f4c4594b98844211b22dfc12d8f8c97f6830e6f61dc9788", "e893d14bf15ba57a395961bb03c5b990caca2c06eaf5be77fbf7cbc72a90f6e3",
  "e9b8d44ae73e190203ab00bfc65afb051ba026810bd8a01c64324156fb2d691a", "f15fd0ee85bbc1f274c82930c20ed07109c04cb7eaeab0c5e2d5f2a58c98a47a",
  "f55f5e6e910f3a25339078f46991df75ff8954e706241a2453ae2141b0c967fb", "f7af7b6790a73b7445ec9701e846bde24c99d5abce0ed3d15403a990c126011a",
  "f8ec51ef4c6eac1631a29ba6f6130617ebb616fbd0f52c081701870f6612fea9", "fd1d5cc910bc8f292ca7ec9af32f8ff2ce26f2dc7355b165e78cc5834919e681"
]);
// The P0-07-SEP-WB control thresholds (P7-R19 item 6): the largest real value
// of each dimension among the corpus modules that verify (tools/ct1_p007.py,
// check "P7-R19"): V53-STATE-P02 (ii)'s `run`, 23 steps, 3 calls, 3 iterations.
const P07_MAXIMA = Object.freeze({ calls: "3", iterations: "3", steps: "23" });
// P7-R19 item 3: PHASE_P07 = PHASE_P05.
const PHASE_P07 = Object.freeze(["air.call.recursion_rejected", "air.workbound.overflow", "air.workbound.unknown_bound",
  "air.workbound.invalid_bound", "air.workbound.missing_summary", "air.workbound.assertion_exceeded"]);
// The accepted base (P0-06), whose `src/` the pair characterization runs and
// whose CT-1 file P0-07-CHECK-CT1 compares.
const BASE_COMMITS = ["f9ab344e050e7ba25d96497c66e47f1429665a71", "f873b68a20be9bb7af79db0f30f405498b0d0c9d"];

const results = [];
const failures = [];
const observedFailures = [];
const acceptedSources = new Map();

function sha256(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}
const hexOf = (text) => crypto.createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");

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

function fixture(key) {
  const [group, item] = key.split(".");
  return item === undefined ? F[group] : F[group][item];
}

// Every fixture equals the generator's bytes (its byte count and sha256).
function pinned(key) {
  const source = fixture(key);
  const [bytes, digest] = PINS[key];
  assert.equal(Buffer.byteLength(source, "utf8"), bytes, `${key}: pinned byte length`);
  assert.equal(hexOf(source), digest, `${key}: pinned sha256`);
  return source;
}
const lineOf = (key) => PINS[key][2];

function typedV053(source, name = "v.air", options = GATED) {
  const ast = sp.parseSource(source, name, options);
  sp.verifySource(ast, options);
  return ast;
}

function capture(action) {
  try {
    action();
  } catch (error) {
    return error;
  }
  return null;
}

// A subprocess bound: a timeout is a failure, never a pass.
function runCli(args, timeoutMs = 60000, cwd = ROOT) {
  const out = childProcess.spawnSync(process.execPath, [path.join(ROOT, "bin", "airc.js"), ...args], {
    cwd, encoding: "utf8", killSignal: "SIGKILL", maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs
  });
  assert(!out.error && out.signal === null, `airc ${args[0]} did not finish within ${timeoutMs} ms (${out.error && out.error.code || out.signal})`);
  return out;
}

function assertNoRawError(text, label) {
  assert.doesNotMatch(String(text), /RangeError|Maximum call stack|TypeError|\n\s+at /u, `${label}: no raw error`);
}

// The descriptor of the source signature (P0-03 P3-R13): a refined type has
// the descriptor image `i32`.
function descriptorOf(source) {
  const ast = parser.typedV053.parse(source, "descriptor.air");
  const image = (type) => (/^i32</u.test(type) ? "i32" : type);
  return {
    air_abi_lane: "0.12", module_id: ast.name, schema: "air.typed-interface/0.12-candidate.1", types: [],
    exports: ast.functions.filter((item) => item.exported).map((item) => ({
      function: item.name, name: item.name, parameters: item.params.map((parameter) => ({ name: parameter.name, type: image(parameter.type) })), return_type: image(item.returnType)
    }))
  };
}
const FALLBACK_DESCRIPTOR = Object.freeze({
  air_abi_lane: "0.12", module_id: "v53.state", schema: "air.typed-interface/0.12-candidate.1", types: [],
  exports: [{ function: "run", name: "run", parameters: [], return_type: "i32" }]
});

let tmp;
let fileCounter = 0;
const runtimeHost = createVerifiedTypedRuntime({ admit: async () => true });

// STATIC_REJECT at every entrypoint that verifies (P4-R8): SDK verify, CLI
// verify, CLI check --lsp-json, the LSP session, the builder and the runtime.
async function staticReject(source, code, line, messagePart) {
  const outcomes = {};
  const sdk = capture(() => typedV053(source));
  assert(sdk, `SDK: expected ${code}, got VERIFIED`);
  assert(!(sdk instanceof TypeError) && !(sdk instanceof RangeError), String(sdk && sdk.stack));
  assert.equal(sdk.code, code, String(sdk.message));
  assert.match(String(sdk.message), new RegExp(`${code.replace(/\./g, "\\.")}:`));
  if (messagePart !== undefined) assert(String(sdk.message).includes(messagePart), `SDK message names '${messagePart}': ${sdk.message}`);
  assert(sdk.loc && Number.isInteger(sdk.loc.line), "a static failure carries a source location");
  assert.equal(sdk.loc.line, line, `SDK line: ${sdk.message}`);
  outcomes.sdk = { code: sdk.code, line: sdk.loc.line };
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
  const builder = await buildVerifiedTypedModule({ ...GATED, descriptor: FALLBACK_DESCRIPTOR, source }).then(() => null, (error) => error);
  assert(builder, "builder: no artifact");
  outcomes.builder = { code: builder.code, line: builder.loc && builder.loc.line };
  const runtime = await runtimeHost.build({ ...GATED, descriptor: FALLBACK_DESCRIPTOR, source }).then(() => null, (error) => error);
  assert(runtime, "runtime: no artifact");
  outcomes.runtime = { code: runtime.code, line: runtime.loc && runtime.loc.line };
  for (const [entrypoint, outcome] of Object.entries(outcomes)) {
    assert.equal(outcome.code, code, `${entrypoint}: ${JSON.stringify(outcome)}`);
    if (outcome.line !== undefined) assert.equal(outcome.line, line, `${entrypoint} line`);
  }
  observedFailures.push({ code, kind: "STATIC_REJECT", line: sdk.loc.line });
  return { error: sdk, outcome: { code, line: sdk.loc.line, entrypoints: Object.keys(outcomes) } };
}

async function invocationOutcome(invoke) {
  try {
    return { value: (await invoke()).value };
  } catch (error) {
    assert(typeof error.code === "string" && error.code.startsWith("air."), `raw invocation error: ${error && error.stack}`);
    observedFailures.push({ code: error.code, kind: "RUNTIME_FAIL" });
    const outcome = { code: error.code };
    if (error.reason) outcome.reason = error.reason;
    if (error.failureReason !== undefined) outcome.failureReason = error.failureReason;
    return outcome;
  }
}

// ACCEPT (and RUNTIME_FAIL invocations): SDK verify, lowerToWat, CLI verify,
// the verified builder and the generic runtime; every invocation gives the
// stated value or failure through both, in order (one invocation each).
async function accepted(source, invocations, label) {
  const ast = typedV053(source, `${label}.air`);
  const wat = lowerToWat(ast, { maxWatBytes: MAX_WAT });
  const file = path.join(tmp, `${label}.air`);
  fs.writeFileSync(file, source);
  const cli = runCli(["verify", file, "--source-profile", V053, "--allow-candidate-profile"]);
  assert.equal(cli.status, 0, `${label}: CLI verify ${cli.stderr}`);
  const desc = descriptorOf(source);
  const built = await buildVerifiedTypedModule({ ...GATED, descriptor: desc, source });
  const handle = await runtimeHost.build({ ...GATED, descriptor: desc, source });
  const outcomes = {};
  for (const [name, args, expected] of invocations) {
    const viaBuilder = await invocationOutcome(() => invokeVerifiedTypedExport(built, name, args));
    const viaRuntime = await invocationOutcome(() => runtimeHost.invoke(handle, name, args));
    assert.deepEqual(viaBuilder, expected, `${label}: builder ${name}(${args.join(", ")})`);
    assert.deepEqual(viaRuntime, expected, `${label}: runtime ${name}(${args.join(", ")})`);
    const key = `${name}(${args.join(", ")})`;
    outcomes[key] = outcomes[key] ? [].concat(outcomes[key], [viaBuilder]) : viaBuilder;
  }
  const run = { ast, built, entrypoints: ["sdk_verify", "lowerToWat", "cli_verify", "builder", "runtime"], invocations: outcomes, label, source, wat };
  acceptedSources.set(label, run);
  return run;
}

// The adapter's value forms: an i32 is a JS number, an i64 `{ decimal, type }`,
// a float `{ bits, type }` (its IEEE 754 bits, big-endian hex).
const i64 = (decimal) => ({ value: { decimal, type: "i64" } });
const f64 = (number) => {
  const bytes = Buffer.alloc(8);
  bytes.writeDoubleBE(number);
  return { value: { bits: bytes.toString("hex"), type: "f64" } };
};
const f32 = (number) => {
  const bytes = Buffer.alloc(4);
  bytes.writeFloatBE(number);
  return { value: { bits: bytes.toString("hex"), type: "f32" } };
};
const R17 = Object.freeze({ code: "air.refinement.assignment_out_of_range", failureReason: 17 });

const S = (steps, calls = 0, iterations = 0) => wb.canonicalSummary(wb.summary({ calls: BigInt(calls), iterations: BigInt(iterations), steps: BigInt(steps) }));

function expectE(built, name, steps, calls = 0, iterations = 0) {
  const actual = wb.inspectBoundWorkBound(built).record.entries[name];
  assert.deepEqual(actual, S(steps, calls, iterations), `E(${name})`);
  return actual;
}

function expectB(built, name, steps, calls = 0, iterations = 0) {
  const actual = wb.inspectBoundWorkBound(built).functions[name];
  assert.deepEqual(actual, S(steps, calls, iterations), `B(${name})`);
  return actual;
}

const MEASURE_FIELDS = ["analysis_units", "call_sites", "callback_refs", "decls", "import_edges", "modules", "nesting_depth", "stmts"];
function expectMeasures(key) {
  const expected = MEASURES[key];
  assert(expected, `${key}: measures are pinned`);
  const measures = measureTypedModule(parser.typedV053.parse(fixture(key), "measure.air"));
  const actual = Object.fromEntries(MEASURE_FIELDS.filter((field) => expected[field] !== undefined).map((field) => [field, measures[field]]));
  assert.deepEqual(actual, { ...expected }, `${key}: R-WB-15c measures (slice text P7-R17)`);
  return Object.fromEntries(MEASURE_FIELDS.map((field) => [field, measures[field]]));
}

function functionWat(wat, name) {
  const begin = wat.indexOf(`  (func $${name} `);
  assert(begin >= 0, `function $${name} is lowered`);
  const end = wat.indexOf("\n  )", begin);
  return wat.slice(begin, end);
}

// The canonical formatter output, and formatting it again changes nothing.
function expectFormat(input, output) {
  const once = sp.formatSource(typedV053(input), GATED);
  assert.equal(once, output, `the canonical formatter output (sha256 ${hexOf(output).slice(0, 8)}...)`);
  assert.equal(sp.formatSource(typedV053(once), GATED), once, "formatting it again changes nothing");
  return { formatted_sha256: hexOf(once), idempotent: true };
}

// The raw exports of one fresh instance (R-STATE-1), for values the adapter
// encodes: f32/f64 results as JS numbers, i64 as BigInt.
function rawExports(built) {
  return new WebAssembly.Instance(new WebAssembly.Module(built.wasmBytes), {}).exports;
}

// ---------------------------------------------------------------------------
// The source side of P0-07-CHECK-STATE, read from the fixture text (never from
// the implementation): the state declarations and, per function, its
// statement lines (no fixture of the check set has a block statement).
const STATE_LINE = /^state[ \t]+([A-Za-z_][A-Za-z0-9_]*)[ \t]*:[ \t]*([a-z0-9]+)[ \t]*\[[ \t]*([0-9]+)[ \t]*\][ \t]*=[ \t]*fill[ \t]+(\S+)$/u;
const CELL = Object.freeze({ bool: { wat: "i32", width: 4 }, f32: { wat: "f32", width: 4 }, f64: { wat: "f64", width: 8 }, i32: { wat: "i32", width: 4 }, i64: { wat: "i64", width: 8 } });

function sourceStates(source) {
  return source.split("\n").map((line) => STATE_LINE.exec(line)).filter(Boolean)
    .map(([, name, type, length, fill]) => ({ fill, length: Number(length), name, type }));
}

function sourceFunctions(source) {
  const functions = new Map();
  let current = null;
  for (const line of source.split("\n")) {
    const header = /^(?:export )?func ([A-Za-z_][A-Za-z0-9_]*)\(/u.exec(line);
    if (header) {
      current = [];
      functions.set(header[1], current);
    } else if (line === "}") {
      current = null;
    } else if (current) {
      assert(/^ {2}\S/u.test(line), `a top-level statement line: '${line}'`);
      current.push(line.trim());
    }
  }
  return functions;
}

// The bytes one cell holds after instantiation (P7-R11): the `fill` literal in
// the cell's width, little-endian; bool 0 or 1 in an i32.
function fillBytes(type, literal) {
  const bytes = Buffer.alloc(CELL[type].width);
  if (type === "bool") bytes.writeInt32LE(literal === "true" ? 1 : 0);
  else if (type === "i32") bytes.writeInt32LE(Number(BigInt(literal)));
  else if (type === "i64") bytes.writeBigInt64LE(BigInt(literal));
  else if (type === "f32") bytes.writeFloatLE(Math.fround(Number(literal)));
  else bytes.writeDoubleLE(Number(literal));
  return bytes;
}

function dataSegments(wat) {
  return [...wat.matchAll(/^ {2}\(data \(i32\.const ([0-9]+)\) "((?:\\[0-9a-f]{2})*)"\)$/gmu)]
    .map(([, base, text]) => ({ base: Number(base), bytes: Buffer.from(text.replace(/\\/gu, ""), "hex") }));
}

// A function's instructions, without its header and local declarations.
function bodyInstructions(wat, name) {
  return functionWat(wat, name).split("\n").slice(1).map((line) => line.trim()).filter((line) => !line.startsWith("(local "));
}

// P7-R11 part 1: each statement's lowered lines, from its first instruction
// through the instruction that writes its result (the store into the
// destination local, the one cell write of state.set, `return`). The segments
// must cover the body exactly, so a statement's sequence is never cut short.
function statementSegments(wat, name, statements) {
  const lines = bodyInstructions(wat, name);
  const segments = [];
  let cursor = 0;
  for (const statement of statements) {
    const local = /^%([A-Za-z_][A-Za-z0-9_]*): (\S+) = (.*)$/u.exec(statement);
    const set = /^state\.set ([A-Za-z_][A-Za-z0-9_]*), ([^,]+), (.+)$/u.exec(statement);
    let end;
    if (local) end = lines.indexOf(`local.set $${local[1]}$0`, cursor);
    else if (set) end = lines.findIndex((line, index) => index >= cursor && /^(?:i32|i64|f32|f64)\.store$/u.test(line));
    else if (/^return\b/u.test(statement)) end = lines.indexOf("return", cursor);
    else assert.fail(`no end marker for '${statement}'`);
    assert(end >= cursor, `${name}: the lowered lines of '${statement}' are found`);
    segments.push({ lines: lines.slice(cursor, end + 1), statement });
    cursor = end + 1;
  }
  assert.equal(cursor, lines.length, `${name}: the statement segments cover the body exactly`);
  return segments;
}

const LOCAL_OP = /^local\.(?:get|set|tee) \$[A-Za-z0-9_$]+$/u;
const INTEGER_CONST = /^(?:i32|i64)\.const -?[0-9]+$/u;
const INTEGER_ARITHMETIC = /^(?:i32|i64)\.(?:add|sub|mul|and|or|xor|shl|shr_s|shr_u|rotl|rotr)$/u;

// P7-R11 part 2: the whitelist. `literalValue`: the state.set value operand is
// a literal or a constant, which admits one constant of the cell's type.
function classifyAccess(sequence, op, type, literalValue) {
  const problems = [];
  const cell = CELL[type];
  const access = op === "state.get" ? `${cell.wat}.load` : `${cell.wat}.store`;
  let accesses = 0;
  let typedConstants = 0;
  sequence.forEach((line, index) => {
    if (line === access) accesses += 1;
    else if (LOCAL_OP.test(line) || INTEGER_CONST.test(line) || INTEGER_ARITHMETIC.test(line)) return;
    else if (op === "state.set" && literalValue && (cell.wat === "f32" || cell.wat === "f64") && line.startsWith(`${cell.wat}.const `)) typedConstants += 1;
    else problems.push(`${index}: '${line}' is not admitted in a per-access sequence`);
  });
  if (accesses !== 1) problems.push(`${accesses} cell accesses (${access}); exactly one is admitted`);
  if (typedConstants > 1) problems.push(`${typedConstants} constants of the cell type; at most one is admitted`);
  return problems;
}

// Every state access statement of the check set with an unrefined destination.
function stateAccesses(run) {
  const states = new Map(sourceStates(run.source).map((item) => [item.name, item]));
  const out = [];
  for (const [name, statements] of sourceFunctions(run.source)) {
    if (!statements.some((statement) => /state\.(?:get|set)\b/u.test(statement))) continue;
    for (const segment of statementSegments(run.wat, name, statements)) {
      const get = /^%[A-Za-z_][A-Za-z0-9_]*: (\S+) = state\.get ([A-Za-z_][A-Za-z0-9_]*), (\S+)$/u.exec(segment.statement);
      const set = /^state\.set ([A-Za-z_][A-Za-z0-9_]*), ([^,]+), (.+)$/u.exec(segment.statement);
      if (get && get[1].includes("<")) continue; // a refined destination is excluded (part 1)
      if (!get && !set) continue;
      const state = states.get(get ? get[2] : set[1]);
      out.push({ fn: name, index: (get ? get[3] : set[2]).trim(), literalValue: Boolean(set) && !set[3].trim().startsWith("%"),
        op: get ? "state.get" : "state.set", sequence: segment.lines, state, statement: segment.statement });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// P0-07-SEP-WB (slice text P7-R19; the P0-05 P5-R13b method). Each corpus
// source is verified with the real WorkBound phase, with the phase disabled
// (an empty `status: "ok"` analysis) and with an outcome-preserving stub
// (+7919 steps, +13 calls, +17 iterations on every `ok` summary; no corpus
// text declares `work`, so every dimension is perturbed). Item 5: a source
// that verifies in real mode is lowered in each mode, and the WAT must be
// byte-identical.
const SEP_COMPARE = `"use strict";
const fs = require("fs");
const path = require("path");
const [srcDir, corpusFile] = process.argv.slice(2);
const r = (m) => require(path.join(srcDir, m));
const sp = r("source_profile.js");
const verifier = r("verifier.js");
const wb = r("workbound.js");
const { lowerToWat } = r("lower_wasm.js");
const PHASE_P07 = new Set(${JSON.stringify(PHASE_P07)});
const PERTURB = { calls: 13n, iterations: 17n, steps: 7919n };
const real = wb.analyzeVerifiedTypedModule;
const perturb = (values) => new Map([...values].map(([name, value]) => [name, value && value.ok ? { ok: true, value: wb.summary({
  calls: value.value.calls + PERTURB.calls,
  effects: value.value.effects,
  iterations: value.value.iterations + PERTURB.iterations,
  steps: value.value.steps + PERTURB.steps
}) } : value]));
const modes = {
  real,
  disabled: () => ({ cycles: [], entries: new Map(), functions: new Map(), primary: null, roots: [], stats: {}, status: "ok" }),
  stubbed: (mod) => {
    const analysis = real(mod);
    return { ...analysis, entries: perturb(analysis.entries), functions: perturb(analysis.functions) };
  }
};
const json = (mod) => JSON.stringify(mod, (key, value) => (value instanceof Set ? [...value] : typeof value === "bigint" ? String(value) : value));
let unchangedAsts = 0;
function outcome(entry, mode) {
  wb.analyzeVerifiedTypedModule = modes[mode];
  try {
    const mod = sp.parseSource(entry.source, "probe.air", entry.options);
    const before = json(mod);
    sp.verifySource(mod, entry.options);
    if (mode === "real") {
      if (json(mod) !== before) throw new Error("verification attached data to the AST");
      unchangedAsts += 1;
    }
    let wat;
    try { wat = lowerToWat(mod, { maxWatBytes: 4194304 }); } catch (error) { wat = "LOWERING FAILED: " + String(error.code || error.message); }
    return { result: { verdict: "VERIFIED" }, wat };
  } catch (error) {
    return { result: { code: error.code || null, cyclePath: error.cyclePath || null, disposition: error.disposition || null, line: error.loc && error.loc.line || null, message: String(error.message), verdict: "REJECTED" }, wat: null };
  } finally {
    wb.analyzeVerifiedTypedModule = real;
  }
}
const differences = [];
const watDifferences = [];
const counts = { loweredInEveryMode: 0, phaseRejections: 0, rejected: 0, sources: 0, verified: 0, workSources: 0 };
for (const line of fs.readFileSync(corpusFile, "utf8").split("\\n").filter(Boolean)) {
  const entry = JSON.parse(line);
  counts.sources += 1;
  if (/^work[\\s{]/mu.test(entry.source)) counts.workSources += 1;
  const runs = { disabled: outcome(entry, "disabled"), real: outcome(entry, "real"), stubbed: outcome(entry, "stubbed") };
  const got = { disabled: runs.disabled.result, real: runs.real.result, stubbed: runs.stubbed.result };
  const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  const phase = got.real.verdict === "REJECTED" && PHASE_P07.has(got.real.code);
  counts[got.real.verdict === "VERIFIED" ? "verified" : "rejected"] += 1;
  if (phase) counts.phaseRejections += 1;
  if (!same(got.stubbed, got.real)) differences.push({ got, mode: "stubbed", sha256: entry.sha256 });
  if (phase ? got.disabled.verdict !== "VERIFIED" : !same(got.disabled, got.real)) differences.push({ got, mode: "disabled", sha256: entry.sha256 });
  if (got.real.verdict === "VERIFIED") {
    for (const mode of ["disabled", "stubbed"]) {
      if (runs[mode].wat !== runs.real.wat) watDifferences.push({ mode, sha256: entry.sha256 });
    }
    if (runs.real.wat !== null && !runs.real.wat.startsWith("LOWERING FAILED")) counts.loweredInEveryMode += 1;
  }
}
const exportNames = [...Object.keys(verifier), ...Object.keys(verifier.typedV053 || {})];
process.stdout.write(JSON.stringify({ budgetOrGrantExports: exportNames.filter((name) => /budget|grant|admi/iu.test(name)), counts, differenceCount: differences.length, differences: differences.slice(0, 80), unchangedAsts, watDifferenceCount: watDifferences.length, watDifferences: watDifferences.slice(0, 80) }));
`;

// Controls (P7-R19 item 6): each mutant is applied to a scratch copy of src/,
// never to the repository's src/. C2, C3, C4 and C7 must make the verdict
// comparison report a difference; C8 changes no verdict and must make the WAT
// comparison (item 5) report one.
const PHASE_OK_ANCHOR = "  if (analysis.status === \"ok\") {\n    verifyV053WorkAssertion(mod, analysis);\n    return;\n  }";
function thresholdMutant(dimension) {
  return PHASE_OK_ANCHOR.replace("    return;", [
    "    if (!mod.work) for (const fn of mod.functions || []) {",
    "      const entry = fn.exported && analysis.entries instanceof Map ? analysis.entries.get(fn.name) : null;",
    `      if (entry && entry.ok && entry.value.${dimension} > ${P07_MAXIMA[dimension]}n) throw new VerificationError("air.workbound.assertion_exceeded: mutant threshold on ${dimension}", fn.loc);`,
    "    }",
    "    return;"
  ].join("\n"));
}
// C7: the static state-index check reads the WorkBound summary: a module with
// states is rejected when an export's E(e).steps exceeds 4.
const C7_REPLACEMENT = PHASE_OK_ANCHOR.replace("    verifyV053WorkAssertion(mod, analysis);", [
  "    if (Array.isArray(mod.states) && mod.states.length) for (const fn of mod.functions || []) {",
  "      const entry = fn.exported && analysis.entries instanceof Map ? analysis.entries.get(fn.name) : null;",
  "      if (entry && entry.ok && entry.value.steps > 4n) throw new VerificationError(\"air.state.index_out_of_bounds: mutant reads E(e).steps\", fn.loc);",
  "    }",
  "    verifyV053WorkAssertion(mod, analysis);"
].join("\n"));
// C8: the lowering reads the WorkBound summary and emits one `nop` in each
// function whose E(e).steps exceeds 4.
const C8_FEATURES_ANCHOR = "    const features = v053ModuleFeatures(mod);\n    const header = v053ModuleHeaderLines(features);";
const C8_BODY_ANCHOR = "  for (const record of records) emitV053TypedRuntimeValidation(state, record);";
const MUTANTS = Object.freeze({
  C2: { description: `reject a module without work when E(e).steps > ${P07_MAXIMA.steps}`, edits: [["verifier.js", PHASE_OK_ANCHOR, thresholdMutant("steps")]] },
  C3: { description: `reject a module without work when E(e).calls > ${P07_MAXIMA.calls}`, edits: [["verifier.js", PHASE_OK_ANCHOR, thresholdMutant("calls")]] },
  C4: { description: `reject a module without work when E(e).iterations > ${P07_MAXIMA.iterations}`, edits: [["verifier.js", PHASE_OK_ANCHOR, thresholdMutant("iterations")]] },
  C7: { description: "the static state-index check reads the WorkBound summary (reject a module with states when E(e).steps > 4)", edits: [["verifier.js", PHASE_OK_ANCHOR, C7_REPLACEMENT]] },
  C8: {
    description: "the lowering reads the WorkBound summary (one nop in each function whose E(e).steps > 4)",
    edits: [
      ["lower_wasm.js", C8_FEATURES_ANCHOR, C8_FEATURES_ANCHOR.replace("\n    const header", "\n    features.__wbEntries = require(\"./workbound\").analyzeVerifiedTypedModule(mod).entries;\n    const header")],
      ["lower_wasm.js", C8_BODY_ANCHOR, `${C8_BODY_ANCHOR}\n  const __wbEntry = features.__wbEntries && features.__wbEntries.get(fn.name);\n  if (__wbEntry && __wbEntry.ok && __wbEntry.value.steps > 4n) state.body.push("nop");`]
    ]
  }
});

// ---------------------------------------------------------------------------
// Base characterization (slice text §10, "Discriminating negative controls"):
// the accepted base (P0-06, f9ab344e / f873b68a) runs from git objects in a
// bounded child process.
function baseVerdicts(keys) {
  const dir = path.join(tmp, "p007_base");
  let commit = null;
  for (const candidate of BASE_COMMITS) {
    if (childProcess.spawnSync("git", ["cat-file", "-e", `${candidate}^{commit}`], { cwd: ROOT }).status === 0) { commit = candidate; break; }
  }
  assert(commit, "the accepted P0-07 base commit is not in this repository");
  fs.mkdirSync(dir, { recursive: true });
  const archive = childProcess.spawnSync("sh", ["-c", `git archive ${commit} src | tar -x -C "${dir}"`], { cwd: ROOT, encoding: "utf8" });
  assert.equal(archive.status, 0, archive.stderr);
  const script = path.join(dir, "probe.js");
  fs.writeFileSync(script, `"use strict";
const path = require("path");
const fs = require("fs");
const sp = require(path.join(process.argv[2], "source_profile.js"));
const options = { allowCandidateProfile: true, sourceProfile: "typed-v0.53" };
const out = {};
for (const file of process.argv.slice(3)) {
  try { sp.verifySource(sp.parseSource(fs.readFileSync(file, "utf8"), "base.air", options), options); out[path.basename(file, ".air")] = { verdict: "VERIFIED" }; }
  catch (error) { out[path.basename(file, ".air")] = { code: error.code || error.name, line: error.loc && error.loc.line, verdict: "REJECTED" }; }
}
process.stdout.write(JSON.stringify(out));
`);
  const files = keys.map((key) => {
    const file = path.join(dir, `${key}.air`);
    fs.writeFileSync(file, fixture(key));
    return file;
  });
  const out = childProcess.spawnSync(process.execPath, [script, path.join(dir, "src"), ...files], {
    encoding: "utf8", env: { ...process.env, NODE_PATH: path.join(ROOT, "node_modules") }, killSignal: "SIGKILL", maxBuffer: 16 * 1024 * 1024, timeout: 120000
  });
  assert(!out.error && out.signal === null && out.status === 0, `base probe: ${out.stderr || out.error}`);
  return { commit, verdicts: JSON.parse(out.stdout) };
}

// The STATIC_REJECT sub-cases: [fixture, code, line] from VECTORS_ADDITIONS.md
// (the N15, N03 and N04 tables) and the R3.1/R2 rows of AGG-N04 and STATE-N01.
const NEGATIVES = Object.freeze([
  ["AGG-N04", "air.const.initializer_invalid", 3],
  ["STATE-N01.i", "air.abi.export_type_unsupported", 5],
  ["STATE-N01.ii", "air.abi.export_type_unsupported", 5],
  ["AGG-N15.i", "air.v051.typed_syntax_invalid", 5],
  ["AGG-N15.ii", "air.v051.typed_syntax_invalid", 3],
  ["AGG-N15.iii", "air.v051.typed_syntax_invalid", 3],
  ["AGG-N15.iv", "air.v051.typed_atom_type_mismatch", 3],
  ["AGG-N15.v", "air.v051.typed_atom_type_mismatch", 3],
  ["AGG-N15.vi", "air.v051.typed_atom_invalid", 3],
  ["AGG-N15.vii", "air.const.initializer_invalid", 5],
  ["AGG-N15.viii", "air.v051.typed_atom_invalid", 4],
  ["AGG-N15.ix", "air.table.index_out_of_range", 8],
  ["AGG-N15.x", "air.v051.typed_atom_type_mismatch", 6],
  ["AGG-N15.xi", "air.v051.typed_atom_invalid", 5],
  ["AGG-N15.xii", "air.workbound.invalid_bound", 10],
  ["AGG-N15.xiii", "air.refinement.assignment_out_of_range", 6],
  ["AGG-N15.xiv", "air.v051.typed_atom_invalid", 6],
  ["AGG-N15.xv", "air.const.initializer_invalid", 3],
  ["AGG-N15.xvi", "air.numeric.checked_failure", 6, "overflow"],
  ["AGG-N15.xvii", "air.v051.typed_syntax_invalid", 4],
  ["STATE-N03.i", "air.state.cell_type_invalid", 3],
  ["STATE-N03.ii", "air.state.cell_type_invalid", 5],
  ["STATE-N03.iii", "air.state.length_invalid", 3],
  ["STATE-N03.iv", "air.state.length_invalid", 3],
  ["STATE-N03.v", "air.state.length_invalid", 3],
  ["STATE-N03.vi", "air.state.dynamic_length", 3],
  ["STATE-N03.vii", "air.state.init_invalid", 3],
  ["STATE-N03.viii", "air.state.init_invalid", 3],
  ["STATE-N03.ix", "air.state.init_invalid", 5],
  ["STATE-N03.x", "air.state.init_invalid", 3],
  ["STATE-N03.xi", "air.state.segment_invalid", 5],
  ["STATE-N03.xii", "air.state.segment_invalid", 5],
  ["STATE-N03.xiii", "air.state.segment_invalid", 3],
  ["STATE-N03.xiv", "air.v051.typed_syntax_invalid", 3],
  ["STATE-N03.xv", "air.state.init_invalid", 3],
  ["STATE-N03.xvi", "air.v051.typed_syntax_invalid", 5],
  ["STATE-N03.xvii", "air.state.init_invalid", 3],
  ["STATE-N04.i", "air.state.index_out_of_bounds", 6],
  ["STATE-N04.ii", "air.state.index_out_of_bounds", 6],
  ["STATE-N04.iii", "air.state.dynamic_bounds_required", 6],
  ["STATE-N04.iv", "air.state.dynamic_bounds_required", 7],
  ["STATE-N04.viii", "air.state.op_invalid", 6],
  ["STATE-N04.ix", "air.state.op_invalid", 6],
  ["STATE-N04.x", "air.state.op_invalid", 6],
  ["STATE-N04.xi", "air.v051.typed_atom_type_mismatch", 6],
  ["STATE-N04.xii", "air.v051.typed_atom_type_mismatch", 6],
  ["STATE-N04.xiii", "air.v051.typed_atom_invalid", 6],
  ["STATE-N04.xiv", "air.v051.type_reference_invalid", 5],
  ["STATE-N04.xv", "air.v051.typed_syntax_invalid", 6],
  ["STATE-N04.xvi", "air.state.op_invalid", 6],
  ["STATE-N04.xvii", "air.v051.typed_atom_invalid", 6]
]);
// The five negatives the base already rejects the expected way, each with its
// minimal pair (slice text §10): [negative, control].
const BASE_PAIRS = Object.freeze([["AGG-N15.ii", "AGG-N15.iip"], ["AGG-N15.iii", "AGG-N15.iiip"], ["AGG-N15.viii", "AGG-N15.viiip"],
  ["AGG-N15.xvii", "AGG-N15.xviip"], ["STATE-N03.xiv", "STATE-N03.xivp"]]);

// BA-2 (admission record, binding): V53-AGG-N04's text without its `module`
// line, and the same text with its `const` line replaced by a valid state line.
const NO_HEADER = Object.freeze({
  "N04-NOHEADER": () => pinned("AGG-N04").split("\n").slice(1).join("\n"),
  "STATE-NOHEADER": () => pinned("AGG-N04").split("\n").slice(1).join("\n").replace("const C: i32 = i32.wrapping_add 1, 2", "state s: i32[2] = fill 0")
});

// ---------------------------------------------------------------------------
async function main() {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "air-v053-p007-"));
  const checkState = {};
  try {
    for (const key of Object.keys(PINS)) pinned(key);
    assert.equal(Object.keys(PINS).length, 76, "every generated fixture is pinned");

    // ------------------------------------------------------------------
    // The generated P0-07 set (OD-P6-2 (b)): AGG-P03/N04, STATE-P01/N01/N02, SEP-CACHE-01.
    await vector("V53-AGG-P03", async () => {
      const run = await accepted(pinned("AGG-P03"), [["run", [0], i64("9007199254740993")]], "agg_p03");
      return { value: { "E(run)": expectE(run.built, "run", 2), invocations: run.invocations, measures: expectMeasures("AGG-P03") } };
    });
    await vector("V53-AGG-N04", async () => ({ value: (await staticReject(pinned("AGG-N04"), "air.const.initializer_invalid", lineOf("AGG-N04"))).outcome }));
    for (const [id, text] of Object.entries(NO_HEADER)) {
      await vector(`P0-07-BA2-${id}`, async () => {
        const source = text();
        assert(source.split("\n")[1].startsWith(id === "N04-NOHEADER" ? "const " : "state "), "line 2 is the module item");
        const rejected = await staticReject(source, "air.v051.typed_syntax_invalid", 2, "missing module declaration");
        return { value: { ...rejected.outcome, message: String(rejected.error.message), source_sha256: hexOf(source) } };
      });
    }
    let p01Built = null;
    await vector("V53-STATE-P01", async () => {
      const source = pinned("STATE-P01");
      typedV053(source);
      // Built once and invoked three times through the direct path (P7-R12).
      const built = await buildVerifiedTypedModule({ ...GATED, descriptor: descriptorOf(source), source });
      p01Built = built;
      const values = [];
      for (let index = 0; index < 3; index += 1) values.push((await invokeVerifiedTypedExport(built, "bump", [])).value);
      assert.deepEqual(values, [1, 1, 1], "bump() = 1, 1, 1 (legacy gave 1, 2, 3)");
      const run = await accepted(source, [["bump", [], { value: 1 }], ["bump", [], { value: 1 }]], "state_p01");
      return { value: { "E(bump)": expectE(built, "bump", 4), direct_path: values, invocations: run.invocations, measures: expectMeasures("STATE-P01") } };
    });
    await vector("V53-STATE-P01 (ii)", async () => {
      // Characterization of P7-R9's host-path table (not a requirement on
      // hosts): cells live in the instance; invocation scope comes from one
      // instance per invocation.
      assert(p01Built, "V53-STATE-P01 ran first");
      const wasmBytes = inspectVerifiedTypedBuild(p01Built).wasmBytes;
      const one = await instantiateAirModule({ wasmBytes });
      const sameInstance = [one.exports.bump(), one.exports.bump()];
      const twoInstances = [(await instantiateAirModule({ wasmBytes })).exports.bump(), (await instantiateAirModule({ wasmBytes })).exports.bump()];
      assert.deepEqual(sameInstance, [1, 2], "one instance: 1, 2");
      assert.deepEqual(twoInstances, [1, 1], "two instances: 1, 1");
      return { value: { one_instance: sameInstance, two_instances: twoInstances } };
    });
    await vector("V53-SEP-CACHE-01", async () => {
      const source = pinned("STATE-P01");
      const runtime = createVerifiedTypedRuntime({ admit: async () => true });
      const desc = descriptorOf(source);
      const handle = await runtime.build({ ...GATED, descriptor: desc, source });
      const first = [(await runtime.invoke(handle, "bump", [])).value, (await runtime.invoke(handle, "bump", [])).value];
      assert.deepEqual(first, [1, 1]);
      const afterTwo = runtime.inspect().counters;
      assert.equal(afterTwo.compilations, 1);
      assert.equal(afterTwo.instantiations, 2);
      const again = await runtime.build({ ...GATED, descriptor: desc, source });
      const afterRebuild = runtime.inspect().counters;
      assert.equal(afterRebuild.cacheHits, 1, "the second build hits the cache");
      assert.equal(afterRebuild.compilations, 1, "no recompilation");
      const third = (await runtime.invoke(again, "bump", [])).value;
      assert.equal(third, 1);
      const final = runtime.inspect().counters;
      assert.equal(final.instantiations, 3);
      assert.equal(final.admissionChecks, 6, "admission is not cached (2 for the first build, 1 for the second, 1 per invoke)");
      return { value: { CACHE_HOLDS_STATE: false, PERSISTENT_STATE: false, after_rebuild: afterRebuild, after_two_invokes: afterTwo, final, invocations: [...first, third] } };
    });
    await vector("V53-SEP-CACHE-01 (ii)", async () => {
      const source = pinned("CACHE-01.ii");
      const runtime = createVerifiedTypedRuntime({ admit: async () => true });
      const handle = await runtime.build({ ...GATED, descriptor: descriptorOf(source), source });
      const bad = await invocationOutcome(() => runtime.invoke(handle, "bad", []));
      assert.deepEqual(bad, R17, "bad() sets the cell to 5 and fails with 17");
      const peek = await invocationOutcome(() => runtime.invoke(handle, "peek", []));
      assert.deepEqual(peek, { value: 0 }, "peek() reads the fill value, not 5");
      const counters = runtime.inspect().counters;
      assert.equal(counters.compilations, 1);
      assert.equal(counters.instantiations, 2);
      assert.equal(counters.invocationRequests, 2);
      assert.equal(counters.successfulInvocations, 1);
      assert.equal(counters.admissionChecks, 4);
      const run = await accepted(source, [["bad", [], R17], ["peek", [], { value: 0 }]], "cache_ii");
      return { value: { "E(bad)": expectE(run.built, "bad", 4), "E(peek)": expectE(run.built, "peek", 2), bad, counters, measures: expectMeasures("CACHE-01.ii"), peek } };
    });
    await vector("V53-STATE-N01", async () => ({
      value: {
        i: (await staticReject(pinned("STATE-N01.i"), "air.abi.export_type_unsupported", lineOf("STATE-N01.i"))).outcome,
        ii: (await staticReject(pinned("STATE-N01.ii"), "air.abi.export_type_unsupported", lineOf("STATE-N01.ii"))).outcome
      }
    }));
    await vector("V53-STATE-N02", () => {
      // Each run in a fresh scratch directory; `D` is an empty directory there.
      const message = "air.source_profile.command_unsupported: 'generate state-handles' does not support 'typed-v0.53' source";
      const cases = {
        i: [["--source-profile", V053], "refused"],
        ii: [["D", "--source-profile", V053], "refused"],
        iii: [["--source-profile", V053, "D"], "refused"],
        iv: [["D", "--source-profile", V053, "--allow-candidate-profile"], "refused"],
        v: [["D"], "legacy"],
        vi: [["D", "--source-profile", "typed-v0.51"], "legacy"],
        vii: [["D", `--source-profile=${V053}`], "refused"]
      };
      const listing = (dir) => {
        const out = [];
        const walk = (at) => { for (const entry of fs.readdirSync(at, { withFileTypes: true })) { const full = path.join(at, entry.name); out.push(path.relative(dir, full)); if (entry.isDirectory()) walk(full); } };
        walk(dir);
        return out.sort();
      };
      const value = {};
      for (const [label, [args, expectation]] of Object.entries(cases)) {
        const dir = fs.mkdtempSync(path.join(tmp, `n02-${label}-`));
        fs.mkdirSync(path.join(dir, "D"));
        const before = listing(dir);
        const out = runCli(["generate", "state-handles", ...args], 60000, dir);
        const first = `${out.stdout}${out.stderr}`.trim().split("\n")[0];
        assert.equal(out.status, 1, `(${label}) exit code`);
        if (expectation === "refused") assert.equal(first, message, `(${label}) first line`);
        else {
          const legacy = /^PackageManifestError: missing air\.package\.json in (.+)$/u.exec(first);
          assert(legacy && fs.realpathSync(legacy[1]) === fs.realpathSync(path.join(dir, "D")), `(${label}) unchanged legacy behaviour: ${first}`);
        }
        assert.deepEqual(listing(dir), before, `(${label}) no file written`);
        value[label] = { args, exit: out.status, first_line: first.split(fs.realpathSync(dir)).join("<scratch>").split(dir).join("<scratch>"), files_written: 0 };
      }
      return { value };
    });

    // ------------------------------------------------------------------
    // Reviewed additions (VECTORS_ADDITIONS.md §3).
    await vector("V53-AGG-P10", async () => {
      const one = await accepted(pinned("AGG-P10.i"), [["flag", [], { value: true }], ["run", [5], i64("-1")], ["scale", [], f64(1)], ["tiny", [], f32(16777216)]], "agg_p10_i");
      const two = await accepted(pinned("AGG-P10.ii"), [["run", [], { value: 3 }]], "agg_p10_ii");
      return {
        value: {
          i: { "E(flag)": expectE(one.built, "flag", 1), "E(run)": expectE(one.built, "run", 4), "E(scale)": expectE(one.built, "scale", 1), "E(tiny)": expectE(one.built, "tiny", 1), invocations: one.invocations, measures: expectMeasures("AGG-P10.i") },
          ii: { "E(run)": expectE(two.built, "run", 11, 2, 2), invocations: two.invocations, measures: expectMeasures("AGG-P10.ii") }
        }
      };
    });
    await vector("V53-AGG-N15", async () => {
      const value = {};
      for (const [key, code, line, part] of NEGATIVES.filter(([key]) => key.startsWith("AGG-N15."))) {
        value[key.split(".")[1]] = (await staticReject(pinned(key), code, line, part)).outcome;
      }
      // The six controls (four of them pairs).
      const controls = [["iip", [["run", [5], { value: 5 }]], 1], ["iiip", [["run", [5], { value: 5 }]], 1], ["viiip", [["run", [5], { value: 1 }]], 2],
        ["xp", [["run", [5], i64("1")]], 2], ["xivp", [["run", [5], { value: 5 }]], 2], ["xviip", [["run", [5], { value: 5 }]], 1]];
      for (const [item, invocations, steps] of controls) {
        const run = await accepted(pinned(`AGG-N15.${item}`), invocations, `agg_n15_${item}`);
        value[`${item} (control)`] = { "E(run)": expectE(run.built, "run", steps), invocations: run.invocations, measures: expectMeasures(`AGG-N15.${item}`) };
      }
      return { value };
    });
    const p02 = {};
    await vector("V53-STATE-P02", async () => {
      // (i): two invocations of run each give fill + 2 (state shared within
      // one invocation, never across).
      p02.i = await accepted(pinned("STATE-P02.i"), [["run", [], i64("-9223372036854775806")], ["run", [], i64("-9223372036854775806")],
        ["fo", [], f64(1)], ["fz", [], f64(-0)], ["flag", [], { value: true }]], "state_p02_i");
      assert(Object.is(rawExports(p02.i.built).fz(), -0), "fz() is -0 (Object.is)");
      const i = { "B(inc)": expectB(p02.i.built, "inc", 4), "E(flag)": expectE(p02.i.built, "flag", 2), "E(fo)": expectE(p02.i.built, "fo", 2),
        "E(fz)": expectE(p02.i.built, "fz", 3), "E(run)": expectE(p02.i.built, "run", 11, 2), invocations: p02.i.invocations, measures: expectMeasures("STATE-P02.i") };
      p02.ii = await accepted(pinned("STATE-P02.ii"), [["run", [], { value: 6 }], ["run", [], { value: 6 }]], "state_p02_ii");
      const ii = { "B(step)": expectB(p02.ii.built, "step", 5), "E(run)": expectE(p02.ii.built, "run", 23, 3, 3), invocations: p02.ii.invocations, measures: expectMeasures("STATE-P02.ii") };
      p02.iii = await accepted(pinned("STATE-P02.iii"), [["run", [5], { value: 5 }], ["run", [7], { value: 7 }]], "state_p02_iii");
      p02.iii2 = await accepted(pinned("STATE-P02.iii2"), [["run", [5], { value: 5 }], ["run", [7], { value: 7 }]], "state_p02_iii2");
      const iii = {
        "N=65536": { "E(run)": expectE(p02.iii.built, "run", 3), invocations: p02.iii.invocations, measures: expectMeasures("STATE-P02.iii"), wasm_bytes: p02.iii.built.wasmBytes.length },
        "N=2": { "E(run)": expectE(p02.iii2.built, "run", 3), invocations: p02.iii2.invocations, measures: expectMeasures("STATE-P02.iii2"), wasm_bytes: p02.iii2.built.wasmBytes.length }
      };
      p02.iv = await accepted(pinned("STATE-P02.iv"), [["run", [], R17], ["run", [], R17]], "state_p02_iv");
      const iv = { "E(run)": expectE(p02.iv.built, "run", 3), invocations: p02.iv.invocations, measures: expectMeasures("STATE-P02.iv") };
      return { value: { i, ii, iii, iv } };
    });
    await vector("V53-STATE-P03", async () => {
      const formatted = expectFormat(pinned("STATE-P03.in"), pinned("STATE-P03.out"));
      const input = await accepted(pinned("STATE-P03.in"), [["get", [5], { value: 7 }]], "state_p03_in");
      const output = await accepted(pinned("STATE-P03.out"), [["get", [5], { value: 7 }]], "state_p03_out");
      return {
        value: {
          format: formatted,
          input: { "E(get)": expectE(input.built, "get", 3), invocations: input.invocations, measures: expectMeasures("STATE-P03.in") },
          output: { "E(get)": expectE(output.built, "get", 3), invocations: output.invocations, measures: expectMeasures("STATE-P03.out") }
        }
      };
    });
    await vector("V53-STATE-N03", async () => {
      const value = {};
      for (const [key, code, line, part] of NEGATIVES.filter(([key]) => key.startsWith("STATE-N03."))) {
        value[key.split(".")[1]] = (await staticReject(pinned(key), code, line, part)).outcome;
      }
      const control = await accepted(pinned("STATE-N03.xivp"), [["run", [5], { value: 5 }]], "state_n03_xivp");
      value["xiv (control)"] = { "E(run)": expectE(control.built, "run", 1), invocations: control.invocations, measures: expectMeasures("STATE-N03.xivp") };
      return { value };
    });
    await vector("V53-STATE-N04", async () => {
      const value = {};
      for (const [key, code, line, part] of NEGATIVES.filter(([key]) => key.startsWith("STATE-N04."))) {
        value[key.split(".")[1]] = (await staticReject(pinned(key), code, line, part)).outcome;
      }
      const controls = [["v", 0, 3], ["vi", 0, 2], ["viout", 0, 2], ["vii", 0, 2], ["xiiip", 0, 2], ["xivp", 5, 1]];
      for (const [item, result, steps] of controls) {
        const run = await accepted(pinned(`STATE-N04.${item}`), [["run", [5], { value: result }]], `state_n04_${item}`);
        value[`${item} (control)`] = { "E(run)": expectE(run.built, "run", steps), invocations: run.invocations, measures: expectMeasures(`STATE-N04.${item}`) };
      }
      // (vi): VERIFIED at every entrypoint (SDK verify, airc check, the LSP);
      // it formats as the canonical output (index 0), which formats to itself.
      const file = path.join(tmp, "n04_vi.air");
      fs.writeFileSync(file, pinned("STATE-N04.vi"));
      const check = JSON.parse(runCli(["check", file, "--source-profile", V053, "--allow-candidate-profile", "--lsp-json"]).stdout);
      assert.deepEqual(check.diagnostics, [], "(vi): airc check reports no diagnostic");
      const session = new AirLspSession({ allowCandidateProfile: true, sourceProfile: V053 });
      const [published] = session.handleMessage({ jsonrpc: "2.0", method: "textDocument/didOpen", params: { textDocument: { text: pinned("STATE-N04.vi"), uri: `file://${file}`, version: 1 } } });
      assert.deepEqual(published.params.diagnostics, [], "(vi): the LSP publishes no diagnostic");
      value["vi (entrypoints)"] = { check: check.status, format: expectFormat(pinned("STATE-N04.vi"), pinned("STATE-N04.viout")), lsp_diagnostics: 0 };
      return { value };
    });

    // ------------------------------------------------------------------
    // Slice checks with no vector ID (slice text §6).
    await vector("P0-07-CHECK-STATE", async () => {
      assert(p02.i && p02.ii && p02.iii && p02.iii2 && acceptedSources.has("state_p01"), "the builds ran first");
      // Parts 1 and 2: extraction and the whitelist, on V53-STATE-P01, P02 (i),
      // (ii) and (iii) (both modules).
      const set = [["V53-STATE-P01", acceptedSources.get("state_p01")], ["V53-STATE-P02 (i)", p02.i], ["V53-STATE-P02 (ii)", p02.ii],
        ["V53-STATE-P02 (iii) N=65536", p02.iii], ["V53-STATE-P02 (iii) N=2", p02.iii2]];
      const parts12 = {};
      const extracted = new Map();
      for (const [label, run] of set) {
        const accesses = stateAccesses(run);
        assert(accesses.length > 0, `${label}: state accesses are extracted`);
        extracted.set(label, accesses);
        parts12[label] = accesses.map((access) => {
          const problems = classifyAccess(access.sequence, access.op, access.state.type, access.literalValue);
          assert.deepEqual(problems, [], `${label} ${access.fn}: '${access.statement}' part 2`);
          return { fn: access.fn, problems, sequence: access.sequence, statement: access.statement };
        });
      }
      // Part 3: the same shape at N = 65536 and N = 2, differing at most in the
      // immediate that names the cell (base + i·w).
      const big = extracted.get("V53-STATE-P02 (iii) N=65536");
      const small = extracted.get("V53-STATE-P02 (iii) N=2");
      assert.equal(big.length, small.length);
      const [bigBase, smallBase] = [p02.iii, p02.iii2].map((run) => dataSegments(run.wat)[0].base);
      const part3 = big.map((access, index) => {
        const other = small[index];
        assert.equal(access.op, other.op);
        assert.equal(access.sequence.length, other.sequence.length, `${access.op}: the same length`);
        const differing = access.sequence.flatMap((line, at) => (line === other.sequence[at] ? [] : [{ at, "N=2": other.sequence[at], "N=65536": line }]));
        assert(differing.length <= 1, `${access.op}: at most the cell's immediate differs`);
        for (const item of differing) {
          assert.equal(item["N=65536"], `i32.const ${bigBase + 65535 * 4}`, "the N=65536 cell address (base + 65535·4)");
          assert.equal(item["N=2"], `i32.const ${smallBase + 1 * 4}`, "the N=2 cell address (base + 1·4)");
        }
        return { differing, length: access.sequence.length, op: access.op };
      });
      // Part 4: the classifier rejects five synthetic sequences, each a real
      // extracted sequence with one addition.
      const real = small.find((access) => access.op === "state.get");
      const seq = real.sequence;
      const last = seq.length - 1;
      const synthetic = {
        loop: [...seq.slice(0, last), "loop", "end", seq[last]],
        compare_chain: [...seq.slice(0, last), ...[0, 1].flatMap((cell) => [`i32.const ${smallBase + cell * 4}`, "i32.load", "i32.const 0", "i32.eq", "drop"]), seq[last]],
        memory_copy: [...seq.slice(0, last), "i32.const 0", "i32.const 4", "i32.const 4", "memory.copy", seq[last]],
        call: [...seq.slice(0, last), "call $run", seq[last]],
        second_access: [...seq.slice(0, last), "local.set $v$0", `i32.const ${smallBase + 4}`, "i32.load", seq[last]]
      };
      const part4 = {};
      for (const [name, sequence] of Object.entries(synthetic)) {
        const problems = classifyAccess(sequence, "state.get", "i32", false);
        const shape = sequence.length === seq.length ? [] : [`length ${sequence.length} differs from the real sequence's ${seq.length}`];
        assert(problems.length > 0, `part 4: the classifier rejects the ${name} control`);
        part4[name] = { problems: [...problems, ...shape], rejected: true };
      }
      assert(part4.second_access.problems.some((problem) => /2 cell accesses/u.test(problem)), "the second-access control is rejected for its second access");
      // Part 5: initialization through active data segments only; no start
      // function; the cell writes of each body equal its state.set count; on
      // every P0-07 module with states that builds.
      const part5 = {};
      for (const [label, run] of acceptedSources) {
        const states = sourceStates(run.source);
        if (!states.length) continue;
        const tables = run.source.split("\n").filter((line) => /^table[ \t]/u.test(line)).length;
        const segments = dataSegments(run.wat);
        assert.equal(segments.length, tables + states.length, `${label}: one data segment per table and per state`);
        assert.doesNotMatch(run.wat, /\(start |memory\.fill|memory\.init|data\.drop/u, `${label}: no start function and no bulk memory initialization`);
        assert.equal((run.wat.match(/^ {2}\(global /gmu) || []).length, 1, `${label}: the failure-reason global is the only global`);
        states.forEach((state, index) => {
          const segment = segments[tables + index];
          const cell = fillBytes(state.type, state.fill);
          assert.equal(segment.bytes.length, cell.length * state.length, `${label}: state ${state.name} has N cells of its width`);
          for (let offset = 0; offset < segment.bytes.length; offset += cell.length) {
            assert(segment.bytes.subarray(offset, offset + cell.length).equals(cell), `${label}: state ${state.name} cell ${offset / cell.length} holds its fill value`);
          }
        });
        const writes = {};
        for (const [name, statements] of sourceFunctions(run.source)) {
          const stores = bodyInstructions(run.wat, name).filter((line) => /^(?:i32|i64|f32|f64)\.store(?:\s|$)/u.test(line)).length;
          const sets = statements.filter((statement) => statement.startsWith("state.set ")).length;
          assert.equal(stores, sets, `${label} ${name}: cell writes equal state.set statements`);
          writes[name] = { cell_writes: stores, state_set_statements: sets };
        }
        part5[label] = { data_segments: segments.map((segment) => ({ base: segment.base, bytes: segment.bytes.length, sha256: sha256(segment.bytes) })), states: states.map((state) => `${state.name}: ${state.type}[${state.length}] = fill ${state.fill}`), writes };
      }
      assert(Object.keys(part5).length >= 10, "part 5 covers every P0-07 module with states that builds");
      checkState.part1_part2 = parts12;
      checkState.part3 = part3;
      checkState.part4 = part4;
      checkState.part5 = part5;
      return {
        value: {
          lowering: "memory cells: one active data segment per state at an 8-aligned base, N cells of the element width; static address",
          part1_extraction: "from the first instruction lowered for the statement through local.set of its destination (state.get) or its one cell store (state.set); the segments cover each body exactly",
          part2: parts12,
          part3_shape_across_n: part3,
          part4_controls: part4,
          part5_initialization: part5
        }
      };
    });
    await vector("P0-07-CHECK-EXPORTS", () => {
      // P7-R10: no state cell, segment, address or memory is exported, and no
      // import is added.
      const value = {};
      for (const [label, run] of acceptedSources) {
        const module = new WebAssembly.Module(run.built.wasmBytes);
        const exportsOf = WebAssembly.Module.exports(module).map((item) => `${item.kind}:${item.name}`).sort();
        const functions = [...run.source.matchAll(/^export func ([A-Za-z_][A-Za-z0-9_]*)\(/gmu)].map((match) => `function:${match[1]}`);
        assert.deepEqual(exportsOf, [...functions, "global:__air_failure_reason"].sort(), `${label}: exports`);
        assert.deepEqual(WebAssembly.Module.imports(module), [], `${label}: no import`);
        value[label] = exportsOf;
      }
      assert(Object.keys(value).length >= 20, "every P0-07 ACCEPT module that builds");
      return { value };
    });
    await vector("P0-07-CHECK-CT1", () => {
      // OD-P7-1 (a′): no CT-1 change at P0-07; state.get and state.set are
      // charged by the existing aggregate.access row.
      const file = path.join(ROOT, "src", "workbound_cost_table_v1.json");
      const blob = childProcess.spawnSync("git", ["hash-object", file], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
      const bytes = fs.readFileSync(file);
      const table = JSON.parse(bytes.toString("utf8"));
      assert.equal(blob, "3b6b7a0a4a8512f884347b50ead1a7d78ef968a6");
      assert.equal(sha256(bytes), "sha256:b3b1730afdce68b2f739d988ba08faf5e1e4ffc6cc3d8f63af4f98e920c55e19");
      assert.equal(bytes.length, 7634);
      assert.equal(wb.COST_TABLE_DIGEST, "sha256:b53e8e6a5755c61a2c755acc8746a9bdadf5c755bbbf203a7e5d26896dc92f70");
      assert.equal(table.revision, "P0-10-EFF-1");
      assert.equal(table.rows.length, 29);
      let base = null;
      for (const commit of BASE_COMMITS) {
        const shown = childProcess.spawnSync("git", ["show", `${commit}:src/workbound_cost_table_v1.json`], { cwd: ROOT, encoding: null });
        if (shown.status === 0) { base = { bytes: shown.stdout, commit }; break; }
      }
      assert(base, "the base CT-1 is readable from git objects");
      const p07 = ["491aad12e49a6683029b410af890dcfa86e7d64c", "fb17d750b5f4c1d037010ba56d9ac797e95fc509"].map((commit) => childProcess.spawnSync("git", ["show", `${commit}:src/workbound_cost_table_v1.json`], { cwd: ROOT, encoding: null })).find((shown) => shown.status === 0);
      assert(p07 && p07.stdout.equals(base.bytes), "P0-07 itself changed no CT-1 byte: the accepted P0-07 commit's CT-1 file is the P0-06 base's");
      assert(!bytes.equals(base.bytes) && sha256(bytes) === "sha256:b3b1730afdce68b2f739d988ba08faf5e1e4ffc6cc3d8f63af4f98e920c55e19", "OD-P10-1 (d): the CT-1 file is P0-10-EFF-1, not the P0-06 base's");
      const access = table.rows.find((row) => row.construct === "aggregate.access");
      assert.deepEqual({ ...access, ct1: undefined }, { calls: "0", construct: "aggregate.access", ct1: undefined, iterations: "0", steps: "1" });
      assert.match(access.ct1, /element or field access with a static index/u, "the leading clause OD-P7-1 (a′) reads");
      // The coverage table (slice text §5), checked on summaries: STATE-P01's
      // bump is aggregate.access + statement.scalar + aggregate.access + return.
      assert(p01Built, "V53-STATE-P01 ran first");
      const coverage = {
        "const line, state line": "none",
        "constant reference": "none (atom); refinement.check in a refined destination (V53-AGG-P10 (ii))",
        "refined D on state.get": "aggregate.access + refinement.check (V53-STATE-P02 (iv): E = 3)",
        "state.get, state.set (static index)": "aggregate.access (V53-STATE-P01: E(bump) = 4)"
      };
      expectE(p01Built, "bump", 4);
      return { value: { aggregate_access: access, base_commit: base.commit, blob, bytes: bytes.length, cost_table_digest: wb.COST_TABLE_DIGEST, coverage, raw_sha256: sha256(bytes), revision: table.revision, rows: table.rows.length } };
    });
    await vector("P0-07-CHECK-FLAGS", () => ({
      value: { CACHE_HOLDS_STATE: false, PERSISTENT_STATE: "false (qualified to the verified invocation paths, P7-R9)", QA_STATUS: "AWAITING_EXACT_SHA_QA" }
    }));
    await vector("P0-07-CHECK-PAIRS", () => {
      // The five negatives the base already rejects the expected way, each with
      // its control; every other negative differs from the base by code or line.
      const keys = [...new Set([...NEGATIVES.map(([key]) => key), ...BASE_PAIRS.flat()])];
      const base = baseVerdicts(keys);
      const value = { base_commit: base.commit, differs_from_base: 0, pairs: {} };
      const pairNegatives = new Set(BASE_PAIRS.map(([negative]) => negative));
      for (const [key, code, line] of NEGATIVES) {
        const same = base.verdicts[key].verdict === "REJECTED" && base.verdicts[key].code === code && base.verdicts[key].line === line;
        if (pairNegatives.has(key)) assert(same, `${key}: base result equals the expectation (a pair)`);
        else {
          assert(!same, `${key}: differs from the base by code or line (${JSON.stringify(base.verdicts[key])})`);
          value.differs_from_base += 1;
        }
      }
      for (const [negative, plus] of BASE_PAIRS) {
        assert.equal(base.verdicts[plus].verdict, "REJECTED", `${plus}: the base rejects the control`);
        assert(!capture(() => typedV053(fixture(plus))), `${plus}: the control verifies on this build`);
        value.pairs[negative] = { base: base.verdicts[negative], control: plus, control_base: base.verdicts[plus], control_now: "VERIFIED" };
      }
      return { value };
    });

    // ------------------------------------------------------------------
    // P0-07-SEP-WB (slice text P7-R19).
    await vector("P0-07-SEP-WB", () => {
      const texts = new Map();
      for (const key of Object.keys(PINS)) texts.set(hexOf(fixture(key)), fixture(key));
      const corpusShas = [...texts.keys()].sort();
      assert.equal(corpusShas.length, 76, "76 distinct fixture texts");
      assert.deepEqual(corpusShas, [...SEP_CORPUS_SHA256], "the corpus is exactly the listed sha256 set");
      const label = new Map(Object.entries(PINS).map(([key, [, digest]]) => [digest, key]));
      const dir = path.join(tmp, "sep07");
      fs.mkdirSync(dir);
      const corpusFile = path.join(dir, "corpus.jsonl");
      fs.writeFileSync(corpusFile, `${corpusShas.map((digest) => JSON.stringify({ options: GATED, sha256: digest, source: texts.get(digest) })).join("\n")}\n`);
      const compareScript = path.join(dir, "compare.js");
      fs.writeFileSync(compareScript, SEP_COMPARE);
      const compare = (srcDir) => {
        const out = childProcess.spawnSync(process.execPath, [compareScript, srcDir, corpusFile], {
          cwd: dir, encoding: "utf8", env: { ...process.env, NODE_PATH: path.join(ROOT, "node_modules") }, killSignal: "SIGKILL", maxBuffer: 256 * 1024 * 1024, timeout: 300000
        });
        assert(!out.error && out.signal === null && out.status === 0, `compare: ${out.stderr || out.error}`);
        return JSON.parse(out.stdout);
      };
      const firstDifference = (behaviour) => {
        const item = behaviour.differences[0];
        return item ? { mode: item.mode, real: item.got.real, source: label.get(item.sha256) || item.sha256, stubbed_or_disabled: item.got[item.mode] } : null;
      };
      // Items 2-5: the real src/.
      const behaviour = compare(path.join(ROOT, "src"));
      assert.deepEqual(behaviour.budgetOrGrantExports, [], "no verifier export accepts or returns a Budget or grant");
      assert.equal(behaviour.counts.sources, 76);
      assert.equal(behaviour.counts.workSources, 0, "no corpus text declares work: the stub perturbs every dimension");
      assert.equal(behaviour.counts.verified, 25, "the 25 texts VECTORS_ADDITIONS.md §4 lists verify in real mode");
      assert.equal(behaviour.counts.phaseRejections, 1, "one phase rejection");
      assert.equal(behaviour.differenceCount, 0, `WorkBound changed a verdict: ${JSON.stringify(behaviour.differences, null, 2).slice(0, 4000)}`);
      assert.equal(behaviour.watDifferenceCount, 0, `WorkBound changed lowered code: ${JSON.stringify(behaviour.watDifferences)}`);
      assert.equal(behaviour.counts.loweredInEveryMode, 25, "every verified text lowers");
      // The one phase rejection is V53-AGG-N15 (xii), which the disabled mode turns into VERIFIED.
      const phaseSource = hexOf(fixture("AGG-N15.xii"));
      const phase = capture(() => typedV053(fixture("AGG-N15.xii")));
      assert(phase && phase.code === "air.workbound.invalid_bound" && PHASE_P07.includes(phase.code), "V53-AGG-N15 (xii) is the phase rejection");
      // Item 6: the controls, each on a scratch copy of src/.
      const controls = {};
      for (const [name, mutant] of Object.entries(MUTANTS)) {
        const scratch = path.join(dir, `src-${name}`);
        fs.cpSync(path.join(ROOT, "src"), scratch, { recursive: true });
        for (const [file, anchor, replacement] of mutant.edits) {
          const text = fs.readFileSync(path.join(scratch, file), "utf8");
          assert.equal(text.split(anchor).length, 2, `${name}: the anchor occurs exactly once in ${file}`);
          fs.writeFileSync(path.join(scratch, file), text.replace(anchor, replacement));
        }
        const mutated = compare(scratch);
        const sources = [...new Set(mutated.differences.map((item) => `${label.get(item.sha256) || item.sha256} (${item.mode})`))].sort();
        const watSources = [...new Set(mutated.watDifferences.map((item) => `${label.get(item.sha256) || item.sha256} (${item.mode})`))].sort();
        controls[name] = { description: mutant.description, differences: mutated.differenceCount, first_difference: firstDifference(mutated), sources, wat_differences: mutated.watDifferenceCount, wat_sources: watSources };
      }
      for (const name of ["C2", "C3", "C4", "C7"]) assert(controls[name].differences > 0, `${name} (${MUTANTS[name].description}) must make P0-07-SEP-WB fail`);
      // C7 is caught by the stubbed comparison on V53-STATE-P01 (stubbed
      // E(bump) = 7923) and changes the real verdict of V53-STATE-P02 (i) (E(run) = 11).
      assert(controls.C7.sources.includes("STATE-P01 (stubbed)"), "C7 is caught at V53-STATE-P01 by the stubbed comparison");
      assert(controls.C7.sources.includes("STATE-P02.i (disabled)"), "C7 changes the real-mode verdict of V53-STATE-P02 (i)");
      // C8 changes no verdict; item 5 catches it on V53-STATE-P01 in stubbed mode.
      assert.equal(controls.C8.differences, 0, "C8 changes no verdict");
      assert(controls.C8.wat_sources.includes("STATE-P01 (stubbed)"), "C8 is caught by the WAT comparison at V53-STATE-P01 (stubbed)");
      return {
        value: {
          PHASE_P07,
          controls,
          corpus: { count: corpusShas.length, sha256_set_digest: sha256(corpusShas.join("\n")), sorted_sha256: corpusShas },
          coverage: behaviour.counts,
          differences: 0,
          modes: { disabled: "empty status ok analysis", real: "analyzeVerifiedTypedModule", stubbed: "+7919 steps, +13 calls, +17 iterations on every ok summary (no corpus text declares work); effects kept (empty before P0-10)" },
          phase_rejection: { code: phase.code, source: "AGG-N15.xii", sha256: phaseSource },
          thresholds: P07_MAXIMA,
          verified_asts_unchanged: behaviour.unchangedAsts,
          wat_differences: 0
        }
      };
    });

    // ------------------------------------------------------------------
    // EACH_SLICE vectors re-run on the P0-07 corpus.
    await vector("V53-FMT-01@P0-07", () => {
      // Every accepted source formats idempotently and keeps every E(e); the
      // two canonical outputs are pinned (V53-STATE-P03, V53-STATE-N04 (vi)).
      // P7-R16: every ACCEPT fixture except the formatter inputs is canonical.
      // The V53-AGG-N15 (xiv) pair control is the exception the base fixes: its
      // literal carrier `const.i32 5` prints as `5` (G-10, X-VL-01), so its
      // canonical form is its text with that one carrier replaced.
      const inputs = new Set([pinned("STATE-P03.in"), pinned("STATE-N04.vi")]);
      const carrierControl = pinned("AGG-N15.xivp");
      let canonical = 0;
      for (const [, run] of acceptedSources) {
        const once = sp.formatSource(typedV053(run.source), GATED);
        assert.equal(sp.formatSource(typedV053(once), GATED), once, "idempotent");
        const summaries = [run.source, once].map((text) => {
          const analysis = wb.analyzeVerifiedTypedModule(typedV053(text));
          return Object.fromEntries([...analysis.entries].map(([name, entry]) => [name, wb.canonicalSummary(entry.value)]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
        });
        assert.deepEqual(summaries[1], summaries[0], "formatting keeps every E(e)");
        if (inputs.has(run.source)) continue;
        if (run.source === carrierControl) assert.equal(once, carrierControl.replace("%v: i32 = const.i32 5", "%v: i32 = 5"), "the carrier control's base normalization");
        else {
          assert.equal(once, run.source, `${run.label}: the ACCEPT fixture is canonical`);
          canonical += 1;
        }
      }
      assert.equal(sp.formatSource(typedV053(fixture("STATE-P03.in")), GATED), fixture("STATE-P03.out"));
      assert.equal(sp.formatSource(typedV053(fixture("STATE-N04.vi")), GATED), fixture("STATE-N04.viout"));
      return { value: { canonical_fixtures: canonical, canonical_pinned: 2, carrier_control: "AGG-N15.xivp formats with its carrier printed as the literal (base G-10)", judged_by_idempotence: acceptedSources.size } };
    });
    await vector("V53-LSP-01@P0-07", () => {
      const file = path.join(tmp, "lsp01.air");
      fs.writeFileSync(file, pinned("STATE-N04.i"));
      const report = JSON.parse(runCli(["check", file, "--source-profile", V053, "--allow-candidate-profile", "--lsp-json"]).stdout);
      assert.equal(report.diagnostics[0].code, "air.state.index_out_of_bounds");
      assert.equal(report.diagnostics[0].line, 6);
      return { value: { code: report.diagnostics[0].code, line: report.diagnostics[0].line, status: report.status } };
    });
    await vector("V53-LSP-02@P0-07", () => {
      const session = new AirLspSession({ allowCandidateProfile: true, sourceProfile: V053 });
      const checks = [];
      for (const key of ["AGG-N04", "STATE-N01.i", "STATE-N03.vii", "STATE-N04.iii", "STATE-N04.x", "AGG-N15.xii"]) {
        const thrown = capture(() => typedV053(fixture(key)));
        const [published] = session.handleMessage({ jsonrpc: "2.0", method: "textDocument/didOpen", params: { textDocument: { text: fixture(key), uri: `file://${path.join(tmp, `lsp02-${checks.length}.air`)}`, version: 1 } } });
        assert.equal(published.params.diagnostics[0].code, thrown.code, "err.code preserved");
        checks.push(thrown.code);
      }
      return { value: checks };
    });
    await vector("V53-DIAG-01@P0-07", () => {
      const registry = new Set([...EARLIER_CODE_REGISTRY, ...P0_07_CODE_REGISTRY]);
      // The note is dev-side (the public projection mirrors src/ and the tests).
      const notePath = path.join(ROOT, "docs", "v0.53", "P0_07_STATE.md");
      if (fs.existsSync(notePath)) {
        const note = fs.readFileSync(notePath, "utf8");
        const section = note.slice(note.indexOf("## 5."), note.indexOf("## 6."));
        const listed = [...section.matchAll(/^\| `(air\.[a-z0-9_.]+)` \|/gmu)].map((match) => match[1]).sort();
        assert.deepEqual(listed, [...P0_07_CODE_REGISTRY].sort(), "the note's registry table lists exactly the P0-07 codes");
      }
      for (const item of observedFailures) {
        assert(registry.has(item.code), `${item.code} is in the registry`);
        if (item.kind === "STATIC_REJECT") assert(Number.isInteger(item.line), `${item.code} has a location`);
      }
      const seen = new Set(observedFailures.map((item) => item.code));
      for (const code of P0_07_CODE_REGISTRY) assert(seen.has(code), `${code} is exercised`);
      return { value: { failures_checked: observedFailures.length, p0_07_codes: P0_07_CODE_REGISTRY.length } };
    });
    await vector("V53-DIAG-02@P0-07", async () => {
      // Deterministic fuzz of the P0-07 corpus: no raw TypeError, JS stack,
      // WABT text or engine error; a verified source always builds (R-COMP-3).
      let seed = 0x0f0707;
      const next = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed; };
      const ops = ["state.get s, 0", "state.get s, %i", "state.set s, 0, 1", "state.set s, 2, %i", "state.len s", "state s: i32[2] = fill 0",
        "state s: u8[2] = fill 0", "state s: i32[65537] = fill 0", "state s: f64[1] = fill 1", "const K: i32 = 7", "const k: i32 = 7", "const K: i32 = K",
        "const K: i64 = 9223372036854775808", "K", "IDX", "fill", "-0", "+0", "%k", "global g: i32 = const.i32 0", ",", "[]", "persistent"];
      const registry = new Set([...EARLIER_CODE_REGISTRY, ...P0_07_CODE_REGISTRY]);
      const corpus = Object.keys(PINS).map(fixture).filter((text) => Buffer.byteLength(text, "utf8") <= 4096);
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
        else if (mode === 3) lines[at] = lines[at].replace(/[a-z0-9_.@%<>,]+/u, ops[next() % ops.length]);
        else lines[at] = lines[at].slice(0, next() % (lines[at].length + 1));
        const source = lines.join("\n");
        cases += 1;
        let ast;
        try {
          ast = typedV053(source, "fuzz.air");
          verifiedCount += 1;
        } catch (error) {
          assert(!(error instanceof TypeError) && !(error instanceof RangeError) && !(error instanceof SyntaxError), `${error && error.stack}\n${source}`);
          assert(typeof error.code === "string" && registry.has(error.code), `unregistered or missing code ${error && error.code}: ${error && error.message}\n${source}`);
          assert(!/wabt|\n\s+at /iu.test(String(error.message)));
          continue;
        }
        const wat = lowerToWat(ast, { maxWatBytes: MAX_WAT });
        new WebAssembly.Module(await watToWasm(wat, "fuzz.air"));
        assembled += 1;
      }
      assert.equal(assembled, verifiedCount, "every verified fuzz source builds");
      return { value: { assembled, cases, verified: verifiedCount } };
    });
  } finally {
    fs.rmSync(tmp, { force: true, recursive: true });
  }

  const outDir = process.env.AIR_P007_VECTOR_RESULTS_DIR;
  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "v053_constants_state.results.json"), `${JSON.stringify(results, null, 2)}\n`);
  }
  if (process.env.AIR_P007_CHECK_STATE_FILE) fs.writeFileSync(process.env.AIR_P007_CHECK_STATE_FILE, `${JSON.stringify(plain(checkState), null, 2)}\n`);
  const passed = results.filter((item) => item.status === "PASS").length;
  const deferred = results.filter((item) => item.status === "DEFERRED").map((item) => item.vector);
  if (failures.length) {
    for (const failure of failures) console.error(`not ok - ${failure}`);
    console.error(`typed-v0.53 P0-07 vectors: ${failures.length} FAIL, ${passed} PASS`);
    process.exit(1);
  }
  for (const item of results) console.log(`ok - ${item.vector} ${item.status}`);
  console.log(`typed-v0.53 P0-07 vectors: ${passed} PASS, ${deferred.length} DEFERRED${deferred.length ? ` (${deferred.join(", ")})` : ""}`);
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
