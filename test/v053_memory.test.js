#!/usr/bin/env node
"use strict";

// typed-v0.53 P0-08 (AIR-0053-P0-08-0001): typed memory (regions, views,
// buffers, literal views) and the borrowed lane under ABI-1 (A): the contract
// import, the start handshake, the typed-memory-v1 marker, the owned range as
// metadata, the owned-range guard (value 64) and the typed admission. Every
// expected value below is copied from the R3.1 catalogue (VECTORS.md) or the
// admitted P0-08 slice text R2.1 (P0_08_SLICE_RFC.md and VECTORS_ADDITIONS.md;
// folder SHA256SUMS 7b27fcad...; admission record 6417643a... with AD-1 to
// AD-8 and M-1 to M-3), never from the output of the implementation under
// test. Fixture bytes come from the slice text's generator
// (tools/derive_p008_r2.py), ported below and pinned by the byte counts,
// sha256 values, lines and measures of its output
// (tool_outputs/derive_p008_r2.out.txt). ACCEPT and RUNTIME_FAIL rows run
// through the verified builder and the generic runtime (borrowed exports
// through the typed admission); a STATIC_REJECT row is checked at every
// entrypoint that verifies (P4-R8). P0-08-SEP-WB is P0-08's separation check
// (P8-R28), P0-08-CHECK-MEM its lowering evidence (P8-R23). The 55 ABI rows
// of VECTORS_ADDITIONS.md §4.2 run here: 52 run, V53-ABI-60 NOT_APPLICABLE,
// V53-ABI-59 and -65 DEFERRED to P0-10. Set AIR_P008_VECTOR_RESULTS_DIR=<dir>
// to write one canonical result record per vector, AIR_P008_CHECK_MEM_FILE=
// <file> to write the CHECK-MEM evidence and AIR_P008_ABI_MATRIX_FILE=<file>
// to write the old/new artifact x host matrix.
const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const sp = require("../src/source_profile");
const parser = require("../src/parser");
const wb = require("../src/workbound");
const air = require("../src/index");
const { measureTypedModule } = require("../src/analysis_capacity");
const { AirLspSession } = require("../src/lsp_server");
const { instantiateAirModule, invokeBorrowedMemory, admitTypedV053Artifact } = require("../src/sdk");
const {
  buildVerifiedTypedModule,
  createVerifiedTypedRuntime,
  inspectVerifiedTypedBuild,
  invokeVerifiedTypedExport
} = require("../src/v052_verified_build");
const verifiedBuild = require("../src/v052_verified_build");
const { lowerToWat, watToWasm } = require("../src/lower_wasm");
const borrowedSlices = require("../src/borrowed_slices");
const { typedV053FailureIdentity } = require("../src/v052_numeric_diagnostic");
const { createVerifiedExecutionSession } = require("../src/verified_execution_session");
const { assertRealtimeSafeProfile } = require("../src/verifier");

const ROOT = path.resolve(__dirname, "..");
const V053 = "typed-v0.53";
const GATED = Object.freeze({ allowCandidateProfile: true, sourceProfile: V053 });
const MAX_WAT = 4194304;
const WORD = 1095324209;
// R-DIAG-2: the codes typed-v0.53 emitted before P0-08 (as in
// test/v053_constants_state.test.js, with the P0-07 codes) and the P0-08
// codes (docs/v0.53/TYPED_MEMORY.md §5).
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
  "air.abi.export_type_unsupported", "air.array.index_out_of_range", "air.table.index_out_of_range", "air.table.readonly",
  "air.const.initializer_invalid", "air.state.cell_type_invalid", "air.state.dynamic_bounds_required", "air.state.dynamic_length",
  "air.state.index_out_of_bounds", "air.state.init_invalid", "air.state.length_invalid", "air.state.op_invalid", "air.state.segment_invalid"
]);
const P0_08_CODE_REGISTRY = Object.freeze([
  "air.abi.borrowed_slice_interface_mismatch", "air.abi.borrowed_slice_requires_0_11", "air.abi.contract_unsupported",
  "air.abi.record_untrusted", "air.abi.slice_return_unsupported", "air.borrow.air_memory_layout_unknown",
  "air.borrow.air_owned_memory_overlap", "air.borrow.module_identity_mismatch", "air.build.memory_backing_limit",
  "air.memory.free_not_owner", "air.memory.readonly_data", "air.memory.region_bounds_runtime", "air.memory.region_bounds_static",
  "air.memory.region_leak", "air.memory.region_not_live", "air.memory.region_size_unsupported", "air.memory.view_escape"
]);
// The frozen borrowed codes the typed lane keeps (P8-R13), listed in the note
// outside the §5 table.
const FROZEN_BORROW_CODES = Object.freeze([
  "air.borrow.free_forbidden", "air.borrow.escape_return", "air.borrow.mode_violation", "air.borrow.alignment_invalid",
  "air.borrow.length_invalid", "air.borrow.reinterpret_forbidden", "air.borrow.call_mismatch", "air.borrow.pointer_out_of_bounds",
  "air.borrow.mutable_overlap", "air.borrow.interface_invalid"
]);
// The P0-08 codes the vectors below must exercise (the §5 table rows reached
// by a pinned input; air.abi.borrowed_slice_interface_mismatch by its own
// reserved-name check).
const P0_08_EXERCISED = P0_08_CODE_REGISTRY;

// ---------------------------------------------------------------------------
// The slice text's generator (tools/derive_p008_r2.py), ported line for line:
// two-space indentation per block level (a line ending in `{` opens one, a
// line starting with `}` closes one), one blank line between module items,
// LF, one trailing LF, lines numbered from the `module` line.
function mod(name, ...items) {
  const lines = [`module ${name}`];
  for (const item of items) lines.push("", ...item);
  return `${lines.join("\n")}\n`;
}
function func(header, body) {
  const out = [`${header} {`];
  let depth = 1;
  for (const line of body) {
    if (line.startsWith("}")) depth -= 1;
    out.push(`${"  ".repeat(depth)}${line}`);
    if (line.endsWith("{")) depth += 1;
  }
  return [...out, "}"];
}
const M = "v53.mem";
const run = (body, header = "export func run() -> i32") => mod(M, func(header, body));
const A16 = "%p: ptr = alloc_region 16";
const FREE = "free_region %p";
const ab = (name, value) => func(`func ${name}() -> i32`, ["%p: ptr = alloc_region 8192", `store.i32 %p, 0, ${value}`, "%v: i32 = load.i32 %p, 0", FREE, "return %v"]);
const COPY = "export func copy_final(src: borrowed_slice<readonly,len=8..8,align=4>, dst: borrowed_slice<writeonly,len=8..8,align=4>, count: i32<0..2>) -> i32";
const P08_IN = ["module v53.mem", "", "export func run(n: i32) -> i32 {", "  %p: ptr = alloc_region %n max 64", "  store.i32 %p, -0, 42",
  "  %v: i32 = call @peek(%p)", "  free_region %p", "  return %v", "}", "", "func peek(p: ptr) -> i32 {",
  "  %v: i32 = load.i32 %p, 0", "  return %v", "}", ""].join("\n");

const F = {
  // == the generated P0-08 set (R3.1): regions and raw access
  P01: run([A16, "store.i32 %p, 12, 42", "%v: i32 = load.i32 %p, 12", FREE, "return %v"]),
  N01: run(["%a: ptr = alloc_region 8192", "%b: ptr = alloc_region 16", "store.i32 %b, 0, 11", "store.i32 %a, 4096, 77", "%v: i32 = load.i32 %b, 0",
    "free_region %a", "free_region %b", "return %v"]),
  N02: run(["%p: ptr = alloc_region 1048576", "store.i32 %p, 1048572, 7", "%v: i32 = load.i32 %p, 1048572", FREE, "return %v"]),
  N03: run([A16, FREE, "%b: buffer<i32,4> = buffer.from_ptr %p", "%v: i32 = buffer.load %b, 0", "return %v"]),
  N04: run([A16, "%b: buffer<i32,2048> = buffer.from_ptr %p", "%v: i32 = buffer.load %b, 0", FREE, "return %v"]),
  N05: run([A16, "%s: slice = slice.from_region %p, 64", "%n: i32 = slice.len %s", FREE, "return %n"]),
  N07: mod(M, func("export func run(p: ptr, i: i32) -> i32", ["return %i"])),
  N09: run([A16, "%v: i32 = load.i32 %p, 0", "store.i32 %p, 0, 41", FREE, "return %v"]),
  N10: run(['%s: slice = "abcd"', "slice.store.i32 %s, 0, 1", "%n: i32 = slice.len %s", "return %n"]),
  N11: mod(M, func("export func run() -> slice", ['%s: slice = "abcd"', "return %s"])),
  N12: run([A16, "%v: i32 = load.i32 %p, 13", FREE, "return %v"]),
  N15: run(["%p: ptr = alloc_region 64", "%b: buffer<f32,64> = buffer.from_ptr %p", "%v: f32 = buffer.load %b, 0", FREE, "%r: i32 = 0", "return %r"]),
  P03: mod(M, func("export func run() -> f32", ["%p: ptr = alloc_region 256", "%b: buffer<f32,64> = buffer.from_ptr %p", "buffer.store %b, 63, 1.5",
    "%v: f32 = buffer.load %b, 63", FREE, "return %v"])),
  N16: run([A16, "%s: slice = slice.from_region %p, 16", "%t: slice = slice.sub %s, 12, 8", "%n: i32 = slice.len %t", FREE, "return %n"]),
  P04: run([A16, "%s: slice = slice.from_region %p, 16", "%t: slice = slice.sub %s, 12, 4", "slice.store.i32 %t, 0, 9", "%v: i32 = load.i32 %p, 12",
    FREE, "return %v"]),
  P05: mod(M, func("export func run() -> i32", ["%p: ptr = alloc_region 8", "store.i32 %p, 0, 2", "store.i32 %p, 4, 3", "%s: slice = slice.from_region %p, 8",
    "%r: i32 = call @sum2(%s)", FREE, "return %r"]),
  func("func sum2(v: slice) -> i32", ["%a: i32 = slice.load.i32 %v, 0", "%b: i32 = slice.load.i32 %v, 4", "%s: i32 = i32.wrapping_add %a, %b", "return %s"])),
  // == noescape, ownership and literals
  N19i: mod(M, func("func leak(v: slice) -> slice", ["return %v"]), func("export func run(i: i32) -> i32", ["return %i"])),
  N19ii: mod(M, func("func mk() -> slice", [A16, "%s: slice = slice.from_region %p, 16", FREE, "return %s"]), func("export func run(i: i32) -> i32", ["return %i"])),
  N20i: mod(M, ["struct S { v: slice }"], func("export func run(i: i32) -> i32", ["return %i"])),
  N20ii: run([A16, "%s: slice = slice.from_region %p, 16", "%a: array<slice,2> = array.new %s, %s", FREE, "%r: i32 = 0", "return %r"]),
  N20iii: mod(M, func("export func run() -> i32", [A16, "%s: slice = slice.from_region %p, 16", "%r: slice = loop.fold @step, %s, 2", FREE, "%z: i32 = 0",
    "return %z"]), func("func step(acc: slice) -> slice", ["return %acc"])),
  N21: mod(M, func("func rel(q: ptr) -> i32", ["free_region %q", "%z: i32 = 0", "return %z"]), func("export func run() -> i32", [A16, "%r: i32 = call @rel(%p)",
    FREE, "return %r"])),
  // == WorkBound region_bytes and backing
  WB01: mod(M, func("export func f() -> i32", ["%a: ptr = alloc_region 64", "%b: ptr = alloc_region 32", "%r: i32 = call @g(1)", "free_region %a",
    "free_region %b", "return %r"]), func("func g(acc: i32) -> i32", ["%p: ptr = alloc_region 128", FREE, "return %acc"]),
  func("export func h() -> i32", ["%r: i32 = loop.fold @g, 0, 10", "return %r"])),
  WB02: mod(M, ab("a", 1), ab("b", 2), func("export func run() -> i32", ["%x: i32 = call @a()", "%y: i32 = call @b()", "%s: i32 = i32.wrapping_add %x, %y", "return %s"])),
  WB03: mod(M, func("export func f() -> i32", ["%p: ptr = alloc_region 64", "store.i32 %p, 0, 7", "%v: i32 = load.i32 %p, 0", FREE, "return %v"])),
  WB04: mod(M, func("export func f() -> i32", ["%a: ptr = alloc_region 64", "%x: i32 = call @g()", "%b: ptr = alloc_region 32", "%y: i32 = call @h()",
    "free_region %a", "free_region %b", "%s: i32 = i32.wrapping_add %x, %y", "return %s"]),
  func("func g() -> i32", ["%p: ptr = alloc_region 128", FREE, "%z: i32 = 1", "return %z"]),
  func("func h() -> i32", ["%p: ptr = alloc_region 16", FREE, "%z: i32 = 2", "return %z"])),
  WB05: mod(M, func("export func f(c: bool) -> i32", ["%r: i32 = if %c {", "%p: ptr = alloc_region 64", FREE, "yield 1", "} else {", "%q: ptr = alloc_region 32",
    "free_region %q", "yield 2", "}", "return %r"])),
  WB06: mod(M, func("export func f() -> i32", ["%p: ptr = alloc_region 64", "%r: i32 = call @g()", FREE, "return %r"]),
    func("func g() -> i32", ["%p: ptr = alloc_region 32", "%r: i32 = call @h()", FREE, "return %r"]),
    func("func h() -> i32", ["%p: ptr = alloc_region 16", FREE, "%z: i32 = 3", "return %z"])),
  WB07: mod(M, func("export func f(n: i32) -> i32", ["%p: ptr = alloc_region %n", FREE, "return %n"])),
  WB08: mod(M, func("func g(acc: i32) -> i32", ["%p: ptr = alloc_region 64", "store.i32 %p, 0, %acc", "%v: i32 = load.i32 %p, 0", FREE,
    "%o: i32 = i32.wrapping_add %v, 1", "return %o"]), func("export func run() -> i32", ["%r: i32 = loop.fold @g, 0, 10", "return %r"])),
  PIPE03: run([0, 1, 2, 3, 4].map((k) => `%p${k}: ptr = alloc_region 16777216`).concat([0, 1, 2, 3, 4].map((k) => `free_region %p${k}`), ["%r: i32 = 0", "return %r"])),
  PIPE05: run(["%p: ptr = alloc_region 16777217", FREE, "%r: i32 = 0", "return %r"]),
  // == NaN canonicalization (OPEN-41 (a))
  N24: run(["%p: ptr = alloc_region 4", "%n: f32 = f32.div 0.0, 0.0", "store.f32 %p, 0, %n", "%b: i32 = load.i32 %p, 0", FREE, "return %b"]),
  // == R-MEM-0 domains (R3)
  N25: run([A16, "%v: i32 = load.i32 %p, -4", FREE, "return %v"]),
  N26: mod(M, func("export func f(o: i32) -> i32", [A16, "store.i32 %p, 0, 5", "%v: i32 = load.i32 %p, %o", FREE, "return %v"])),
  N26twin: mod(M, func("export func f(o: i32) -> i32", ["%p: ptr = alloc_region 65536", "store.i32 %p, 0, 5", "%v: i32 = load.i32 %p, %o", FREE, "return %v"])),
  N28: mod(M, func("export func g(i: i32) -> i32", [A16, "%b: buffer<i32,4> = buffer.from_ptr %p", "buffer.store %b, 3, 9", "%v: i32 = buffer.load %b, %i", FREE,
    "return %v"])),
  N28v: run([A16, "%b: buffer<i32,4> = buffer.from_ptr %p", "%v: i32 = buffer.load %b, -1", FREE, "return %v"]),
  N30: mod(M, func("export func h(n: i32) -> i32", ["%p: ptr = alloc_region %n max 64", FREE, "return %n"])),
  N30v: run(["%p: ptr = alloc_region -1", FREE, "%r: i32 = 0", "return %r"]),
  N31: mod(M, func("export func k(l: i32) -> i32", [A16, "%s: slice = slice.from_region %p, %l", "%n: i32 = slice.len %s", FREE, "return %n"])),
  N32: mod(M, func("export func m(o: i32, l: i32) -> i32", [A16, "%s: slice = slice.from_region %p, 16", "%t: slice = slice.sub %s, %o, %l", "%n: i32 = slice.len %t",
    FREE, "return %n"])),
  N33: mod(M, func("export func q(o: i32) -> i32", [A16, "store.i32 %p, 12, 21", "%s: slice = slice.from_region %p, 16", "%t: slice = slice.sub %s, 12, 4",
    "%v: i32 = slice.load.i32 %t, %o", FREE, "return %v"])),
  N35: run([A16, "%b: buffer<i32,0> = buffer.from_ptr %p", FREE, "%r: i32 = 0", "return %r"]),
  P07: mod(M, func("export func z() -> i32", ["%p: ptr = alloc_region 0", FREE, "%r: i32 = 0", "return %r"])),
  P07ii: mod(M, func("export func z() -> i32", ["%p: ptr = alloc_region 0", "%v: i32 = load.i32 %p, 0", FREE, "return %v"])),
  // == borrowed lane (ABI-1 (A))
  P02: mod(M, func(COPY, ["%value: i32 = slice.load.i32 %src, 4", "slice.store.i32 %dst, 4, %value", "return %count"])),
  N08: mod(M, func("export func peek(src: borrowed_slice<readonly,len=4..4,align=4>) -> i32", [A16, "store.i32 %p, 0, 5", "%v: i32 = slice.load.i32 %src, 0", FREE,
    "return %v"])),
  N22: mod(M, func("export func pair(a: borrowed_slice<readonly,len=8..8,align=4>, b: borrowed_slice<readwrite,len=8..8,align=4>) -> i32",
    ["%x: i32 = slice.load.i32 %a, 0", "%y: i32 = slice.load.i32 %b, 4", "%s: i32 = i32.wrapping_add %x, %y", "return %s"])),
  P06: mod(M, func("export func both(a: borrowed_slice<readonly,len=8..8,align=4>, b: borrowed_slice<readonly,len=8..8,align=4>) -> i32",
    ["%x: i32 = slice.load.i32 %a, 0", "%y: i32 = slice.load.i32 %b, 4", "%s: i32 = i32.wrapping_add %x, %y", "return %s"])),
  N39: mod(M, func("export func peek(b: borrowed_slice<readonly,len=16..16,align=4>, o: i32) -> i32", ["%v: i32 = slice.load.i32 %b, %o", "return %v"])),
  // == reviewed-addition candidates
  P08in: P08_IN,
  P08out: mod(M, func("func peek(p: ptr) -> i32", ["%v: i32 = load.i32 %p, 0", "return %v"]),
    func("export func run(n: i32) -> i32", ["%p: ptr = alloc_region %n max 64", "store.i32 %p, 0, 42", "%v: i32 = call @peek(%p)", FREE, "return %v"])),
  P09: mod(M, func("export func run() -> i32", ["%p: ptr = alloc_region 16", "store.i32 %p, 0, -4194303", "%f: f32 = load.f32 %p, 0", "store.f32 %p, 4, %f",
    "%s: slice = slice.from_region %p, 16", "slice.store.f32 %s, 8, %f", "%b: buffer<f32,4> = buffer.from_ptr %p", "buffer.store %b, 3, %f",
    "%x: i32 = load.i32 %p, 4", "%y: i32 = load.i32 %p, 8", "%z: i32 = load.i32 %p, 12", "%a: i32 = i32.wrapping_add %x, %y", "%c: i32 = i32.wrapping_add %a, %z",
    FREE, "return %c"]),
  func("export func raw() -> i32", ["%p: ptr = alloc_region 4", "store.i32 %p, 0, -4194303", "%f: f32 = load.f32 %p, 0", "%v: i32 = load.i32 %p, 0", FREE, "return %v"])),
  N40i: run([A16, "store.i32 %p, 7", FREE, "%r: i32 = 0", "return %r"]),
  N40ii: run([A16, "%x: i32 = store.i32 %p, 0, 7", FREE, "%r: i32 = 0", "return %r"]),
  N40iii: run([A16, "load.i32 %p, 0", FREE, "%r: i32 = 0", "return %r"]),
  N40iv: run([A16, "%v: i64 = load.i64 %p, 0", FREE, "%r: i32 = 0", "return %r"]),
  N40v: run([A16, "%b: buffer<i64,2> = buffer.from_ptr %p", FREE, "%r: i32 = 0", "return %r"]),
  N40vi: mod(M, func("func mk() -> ptr", [A16, "return %p"]), func("export func run(i: i32) -> i32", ["return %i"])),
  N40vii: run([A16, "%s: slice = slice.from_region %p, 16", "%o: option<slice> = option.some<slice> %s", FREE, "%r: i32 = 0", "return %r"]),
  N40viii: mod(M, ["state s: slice[1] = fill 0"], func("export func run(i: i32) -> i32", ["return %i"])),
  N40ix: mod(M, ["const B: i32 = 64"], func("export func h(n: i32) -> i32", ["%p: ptr = alloc_region %n max B", FREE, "return %n"])),
  N40x: mod(M, func("export func h(n: i32) -> i32", ["%p: ptr = alloc_region %n max 16777217", FREE, "return %n"])),
  N40xi: mod(M, func("export func h(n: i32<0..16777217>) -> i32", ["%p: ptr = alloc_region %n", FREE, "return %n"])),
  N40xii: mod(M, func("export func run(src: borrowed_slice<readonly,len=4..4,align=4>) -> ptr", [A16, "return %p"])),
  N40ixc: mod(M, func("export func h(n: i32) -> i32", ["%p: ptr = alloc_region %n max 64", FREE, "return %n"])),
  N40xic: mod(M, func("export func h(n: i32<0..16777216>) -> i32", ["%p: ptr = alloc_region %n", FREE, "return %n"])),
  N41i: mod(M, func("export func f(c: bool) -> i32", [A16, "%r: i32 = if %c {", FREE, "yield 1", "} else {", "yield 2", "}", "return %r"])),
  N41ii: run([A16, FREE, FREE, "%r: i32 = 0", "return %r"]),
  N41iii: run([A16, FREE, "%v: i32 = load.i32 %p, 0", "return %v"]),
  N41iv: run([A16, "%s: slice = slice.from_region %p, 16", FREE, "%n: i32 = slice.len %s", "return %n"]),
  N41v: mod(M, func("export func run(b: borrowed_slice<readwrite,len=4..4,align=4>) -> i32", ["free_region %b", "%r: i32 = 0", "return %r"])),
  N41ic: mod(M, func("export func f(c: bool) -> i32", [A16, "%r: i32 = if %c {", "yield 1", "} else {", "yield 2", "}", FREE, "return %r"])),
  // == R2 additions (review fixes)
  N42i: mod(M, func("func g(acc: i32) -> i32", [A16, "%v: i32 = load.i32 %p, 0", "store.i32 %p, 0, 99", FREE, "%o: i32 = i32.wrapping_add %acc, %v", "return %o"]),
    func("export func run() -> i32", ["%r: i32 = loop.fold @g, 1, 2", "return %r"])),
  N42ii: mod(M, func("func g() -> i32", [A16, "%v: i32 = load.i32 %p, 0", "store.i32 %p, 0, 99", FREE, "return %v"]),
    func("export func run() -> i32", ["%a: i32 = call @g()", "%b: i32 = call @g()", "%s: i32 = i32.wrapping_add %a, %b", "return %s"])),
  P10: mod(M, func("export func put(dst: borrowed_slice<writeonly,len=4..4,align=4>) -> i32", ["%p: ptr = alloc_region 4", "store.i32 %p, 0, -4194303",
    "%f: f32 = load.f32 %p, 0", FREE, "slice.store.f32 %dst, 0, %f", "%z: i32 = 0", "return %z"])),
  P11: mod(M, ["table t: i32[3] = [1, 2, 3]"], ["state s: i32[2] = fill 0"], func("export func run() -> i32", ['%l: slice = "abcd"', "%p: ptr = alloc_region 100",
    "store.i32 %p, 96, 5", "%v: i32 = load.i32 %p, 96", FREE, "return %v"])),
  N40xiii: mod(M, func("export func h(n: i32<-8..-1>) -> i32", ["%p: ptr = alloc_region %n", FREE, "return %n"])),
  N40xiv: run([A16, "%v: i32 = load.i32 %p", FREE, "return %v"]),
  N41vi: mod(M, func("export func f(c: bool) -> i32", [A16, "%t: slice = slice.from_region %p, 16", "%v: slice = if %c {", "%q: ptr = alloc_region 8",
    "%s: slice = slice.from_region %q, 8", "free_region %q", "yield %s", "} else {", "yield %t", "}", "%n: i32 = slice.len %v", FREE, "return %n"])),
  N41vii: mod(M, func("export func f(c: bool) -> i32", ["%v: i32 = if %c {", "%q: ptr = alloc_region 8", "%s: slice = slice.from_region %q, 8", "%n: i32 = slice.len %s",
    "yield %n", "} else {", "yield 0", "}", "return %v"])),
  N41viic: mod(M, func("export func f(c: bool) -> i32", ["%v: i32 = if %c {", "%q: ptr = alloc_region 8", "%s: slice = slice.from_region %q, 8", "%n: i32 = slice.len %s",
    "free_region %q", "yield %n", "} else {", "yield 0", "}", "return %v"])),
  N41viii: run([A16, "%q: ptr = %p", "free_region %q", "%r: i32 = 0", "return %r"]),
  CM4b: mod(M, func("export func g(i: i32) -> i32", [A16, "%b: buffer<i32,4> = buffer.from_ptr %p", "buffer.store %b, 3, 9", "%v: i32 = buffer.load %b, %i", FREE,
    "return %v"])),
  CM4btwin: mod(M, func("export func g(i: i32) -> i32", ["%p: ptr = alloc_region 65536", "%b: buffer<i32,16384> = buffer.from_ptr %p", "buffer.store %b, 3, 9",
    "%v: i32 = buffer.load %b, %i", FREE, "return %v"])),
  CM4c: mod(M, func("export func k(o: i32) -> i32", [A16, "store.i32 %p, 0, 5", "%s: slice = slice.from_region %p, 16", "%v: i32 = slice.load.i32 %s, %o", FREE,
    "return %v"])),
  CM4ctwin: mod(M, func("export func k(o: i32) -> i32", ["%p: ptr = alloc_region 65536", "store.i32 %p, 0, 5", "%s: slice = slice.from_region %p, 65536",
    "%v: i32 = slice.load.i32 %s, %o", FREE, "return %v"])),
  // == ABI candidate fixtures
  T53: mod(M, func("export func f(src: borrowed_slice<readonly,len=4..4,align=4>) -> i32", [A16, "store.i32 %p, 0, 777", "%seen: i32 = slice.load.i32 %src, 0", FREE,
    "return %seen"])),
  T53LO: mod(M, func("export func f(src: borrowed_slice<readonly,len=0..8,align=1>) -> i32", [A16, FREE, "%l: i32 = slice.len %src", "return %l"])),
  T53LN: mod(M, func("export func f(src: borrowed_slice<readonly,len=0..8,align=1>) -> i32", ["%l: i32 = slice.len %src", "return %l"])),
  // == R2.1 CONDITIONAL carriers (OD-P7-6 (a)); carrier A is P0-08's (AD-8)
  P11ii: mod(M, ["table t: i32[3] = [1, 2, 3]"], ["state s: i32[2] = fill 7"], func("export func run() -> i32", ['%l: slice = "abcd"', "%p: ptr = alloc_region 100",
    "store.i32 %p, 96, 5", "%v: i32 = load.i32 %p, 96", FREE, "state.set s, 0, 9", "%a: i32 = state.get s, 0", "%b: i32 = state.get s, 1",
    "%d: i32 = i32.wrapping_sub %a, %b", "%r: i32 = i32.wrapping_add %v, %d", "return %r"])),
  F1B: mod("v53.state", ["state s: i32[2] = fill 7"], func("export func run() -> i32", ["state.set s, 0, 9", "%a: i32 = state.get s, 0", "%b: i32 = state.get s, 1",
    "%d: i32 = i32.wrapping_sub %a, %b", "return %d"]))
};

// Bytes, sha256 and named line of every fixture, from
// tool_outputs/derive_p008_r2.out.txt (generator order).
const PINS = Object.freeze({
  P01: [153, "8051b784d450ba4771eb2cce070eb68e1742c5e191fd7e4c7b2e0d1c4716ed22", 6],
  N01: [223, "00754e503a443ead0c1b49bb2d017e8a0c6421c57b4134933b265cb47b57aff6", 7],
  N02: [167, "886b54bb6993ae3e4556281099b5256cfa6f2b714540e9170f73f58fd23cb53f", 6],
  N03: [173, "08f4400c4b773b7bfec74f164108ca05f20d3e1f022a1179ea732e712189506b", 6],
  N04: [176, "4833bfa4c8f3735f9c22d162febabb545f68cda67b56068c0116295fd390edaa", 5],
  N05: [166, "e7c13782ce14675ddf6d310bffd97a04318b7a77fa2e3e78f557b8696d708984", 5],
  N07: [71, "a30e63cd38903039391360d4cfe6eac1c79fc756eac210298fcf74894a47213b", 3],
  N09: [151, "e233bbb31d8aee6ed0e04f45f86e1dc80ee690c47deefed2a8c604821baf6def", 6],
  N10: [130, "02aee55309bac37f835f805b83fe6b1b26b204cce8d646ade964be9390c5b499", 5],
  N11: [80, "5243470348fe2ef04ae563c8d244fb10b90ab2b450f8bafa6a8cc3cf063d9d1c", 3],
  N12: [130, "02972af0f9fa091e0847a38d4bab0328f6a68d33aedb993461ea593b2c432dda", 5],
  N15: [188, "dcc474f5324428aeec536e36e0568be9d9b9aa26bde1f4c5c055ed20cbc85a51", 5],
  P03: [203, "b8746c2196c759f7ffd7f3d1f070f38036ecb3b2b8bc9835de6acac5028234e6", 7],
  N16: [200, "3d685b5707a759dacc45a90db87665288e86adbdc09ea5e09d059e45adb6f8fd", 6],
  P04: [230, "3eb7010161c809aa37ffdd8623fe7791f2e18203bd6b9d0d130281a8402e96b8", 7],
  P05: [354, "ac7ac442727ccc93bf6d6b0ea4b74268b5eb41f0c2aa968a0a3d5f5be9abeab0", 8],
  N19i: [109, "c3156ed14f18954dfebd0452f1fa5d8755c4b0df73d0bd1fd074955bd5602fda", 3],
  N19ii: [183, "8680b2f68386bf4381064c6eead6e88b79ca944a468150d9fb808adaff0ca87b", 3],
  N20i: [86, "c0cac219cd127286d4cfe9ba364befdc9314b526eb35a3afbb96e33add699189", 3],
  N20ii: [195, "55e0ed245f4e47765f943559f1ad809dff098110396714423f9997e80f2cd159", 6],
  N20iii: [242, "c4efb13dc917a96fb18bfe66ed7f09d97113ed67494ff03a40488bee39231faa", 6],
  N21: [200, "4767ce49bf631251010e5338edab8e089ffab6eb18b2cebfbbcfe4fd8d39f97e", 4],
  WB01: [329, "515a48f68742308d8b662273fc611024eb57595553ef6d3579a5ab45dd0243e6", 19],
  WB02: [393, "5fd7812940ed61f72bcca7c65c354ae691e83b49591f86fed465942e6a30f008", 21],
  WB03: [148, "f36b5b6dd6e45af9a33ecfb5fbebd1afca22f6d5f03dc3c9bd31de2d001ac787", 4],
  WB04: [410, "b40bdd9d5f71c451f891cbc5a332d2d27f9d454927941bad2d32c0c3b7de2614", 7],
  WB05: [219, "8a41f6d5ac9bb0d273f1d6f4c60fbc1ab3c15ca0989469b650721323023df518", 9],
  WB06: [314, "ca9d2adfbc7ef7fd22b36d35eb940e53c474c552fa4c44c75fb76b77f5370e3b", 5],
  WB07: [106, "20578999d27930bd878e3212fb792324ea4c3d498ad1809a433df81eb77934ae", 4],
  WB08: [261, "79051b59b418df5d83f2179fb694285f3a8be340e1efc4f901eb24679277e5ad", 13],
  PIPE03: [336, "0dec54dab8a8c6cd4c85e9333aa4e9d1ffe1a7b7732469250c5fad82d38bee67", 8],
  PIPE05: [122, "d5c746dbe92ea980c5f369ae182151c91dda17961a220744f4843133e5cf610f", 4],
  N24: [179, "e4ddd87994ac889c55cc756853bb5df55dd92eea8fe7ad528e8be2e524a705db", 6],
  N25: [130, "57a40fe45594912705770127d50aa082eeca69ee0d1707f392bf6dc09fdb20f5", 5],
  N26: [155, "34f25eee819c455791a8aca82bc4064ad6ec8efe9c8c9f3ae9d21763cc05fed5", 6],
  N26twin: [158, "112c81cef7ec4232e705bcfa9a0e19b547eb16ae8edbbec3ad11d896c155205f", 6],
  N28: [202, "ef85369d94b05402254eeda567bfc3340cdb675501a66dfb5b9ddfca2dda93ee", 7],
  N28v: [174, "2184d99f57c6b9a3c50b5bf04f8953a9b1cc7b07ec883914bd40b25be1b1c743", 6],
  N30: [113, "a46c0c6dd198bb17d6a7d94ea3018df8dee97ec5b06e90365d5171b1ff53ab8d", 4],
  N30v: [116, "7ef493babd3595b5f4e369e052efe98cd71ee2f738f6aada077acb4e1d77e61f", 4],
  N31: [170, "8b871dd0d60d451a9b9c6d82fa581fc6ee8d4ac6c9e07c9c78abf4fb35ef39ce", 5],
  N32: [213, "fdd5c748d069848f9d4efa1c92a255ffe1ec9b6d12da40f83ee20f6096dfb840", 6],
  N33: [236, "e98c4773ebb451d4b6880ab3b5b3105a9abc790f76eee6cc7411f00eb3cef7ab", 8],
  N35: [157, "d35c6dd00b49ae2da196087f93a3e25869ec79422c3240e3fbc959cf41d345da", 5],
  P07: [113, "46961791a32fc79d11953ae432406c217c9dada719272ee2f7349104e9c05537", 4],
  P07ii: [126, "6141ffd8d82c08a9aa93ec81ee08820ebd6c1c8743bdd44538257a1831ce303a", 5],
  P02: [254, "9c64eee18d59b6b2628fd13221e70e01fa2bc82a5dca8c038d44b0334e32ec4c", 5],
  N08: [205, "6cdb206a41ba0be7818b61941682dacd098790604825b0f68eb5480d2be09e5e", 6],
  N22: [251, "199c65e25d1ed32dda3aee2e6d7f98a29e1ff724d24737d16d574d0e4db21665", 5],
  P06: [250, "909fa3f375082e4778da64cc28e1506d8b90d55da9c430a55bdc99eba4a185c1", 5],
  N39: [146, "3db1bce5694a9888cd384dac70a9ea0f6f2904563c9b7a05df4b4c6e4c9711fe", 4],
  P08in: [234, "a618ee8b4703ba231837fb1b45e359a8ef448f4a5d2b7b86d94d0a28ae55ced9", 5],
  P08out: [233, "c32aa6271cf4310daa4916e43da20d8e3dada874200fde534046cacaa219fc21", 10],
  P09: [634, "da48bf872edcd127648ef31d7e2ca2ad2e9700ebc1719485b89ea9bfb42f1702", 9],
  N40i: [134, "fcc4eb19c2972ffaac7ac4f317342fb7b4065319b7efbb4d28164f5eadd46ce9", 5],
  N40ii: [147, "9ddf1da4000788f8d0e687a643a4198289159e9b71b1ba5325b977a36748e808", 5],
  N40iii: [133, "a3d86be44d77224cdb482f9fcb1d62ec9cb11ad078ee671dc85e6597b02f54b3", 5],
  N40iv: [143, "b53a1decc620bb9e79dfaf72e8f90244b9c8c1c4fd294902395d05c48990c3db", 5],
  N40v: [157, "19cd9287c9c68f8ae44de363698443c27c6d43b4ff274045ffcbcf6ca4adf03d", 5],
  N40vi: [125, "9141ff3a8d6718b498967e38012e71b7b511fde1b903f4e5b018625034e742bf", 3],
  N40vii: [199, "9364dbe4fe52e11932ffeb322837160adeda88e8b91bfee0f9bb81d08bdcc7fb", 6],
  N40viii: [91, "db82bd57233834b57ed326a10ba4af3c7769cb57f5fe27a5dbbdfa8a77001c2e", 3],
  N40ix: [131, "ed68966d9512d7328b5a1dc1bffdb9aaee24ecf3ef28734adf800cc51cc1d7fd", 6],
  N40x: [119, "3092dd7203a4994e2c39dcbf191092a3f8d969fb65c6b2d14a99b93eff0a9c7b", 4],
  N40xi: [119, "210b1612b108e82551fe9ccf1f05444a01b96c08029acbd0048e31e7b626ac59", 4],
  N40xii: [131, "73da8c5d573ff9baf2373da0ba6658c8485c20787395ce0be2daca268319f410", 3],
  N40ixc: [113, "a46c0c6dd198bb17d6a7d94ea3018df8dee97ec5b06e90365d5171b1ff53ab8d", 4],
  N40xic: [119, "91390c5f54e18b1664c15a1f9a5d2ceba507788d0e2f7c4d319ff29e65e6a014", 4],
  N41i: [168, "1e94decddf265251074bb31d58ef480d0bbe35a2cec7efbb880ac5a0ae79908b", 11],
  N41ii: [133, "00e6b44b0e0c7c3fde30b2a2ae44700615b9aaaf9f66c5f4c6f7b9dc9774fb28", 6],
  N41iii: [129, "fb79089dd09f0749956a7751a82a409f179278e4321abab3786065dc3ff37e80", 6],
  N41iv: [166, "a7950cd8990e06e80ec3e95417362fcf9818e61d989ccb878129601d9267aae7", 7],
  N41v: [133, "dff03cc49a9d44cab64b9631c9d99f4dda26ed823f2762e85e319f584b8b736a", 4],
  N41ic: [166, "5eb7a044ce310a70f67df870a0ed86025f60f341b7a299b84b2e27968dbb2aab", 10],
  N42i: [261, "56df6f0ed90717b540f5739308da43de5fce9f9656c406e9acfc68ab6e26f513", 6],
  N42ii: [264, "0ac0efcbf7db287d093e45bab65a12d7e31c219f62771ed838d9b1d774d46a61", 13],
  P10: [247, "3c7e769b01398214c8e4baadb16a0d34429786b8b7676b1cfde49dfd013a391f", 8],
  P11: [229, "e1d83c82d45345a85430a9ee33db74e6145cf7641edece357e40c5f4781d56dc", 9],
  N40xiii: [114, "a48e125e8603be57fe26bc8196652d4fa13c99688d1c8b07a45b1036f3f6b584", 4],
  N40xiv: [126, "1869ed68494473e887d79a98f29b7faf26fe78c11bc16be11ae66a2efb0c7cfd", 5],
  N41vi: [322, "4d82444ce8d916a8feeec305d7fa0ebf1f96ddbc8355a3316e2e28d32966c028", 6],
  N41vii: [218, "f653f01838f9d16c32b337018cb4957cb6a8d0b666938250b482bb50f9d73c53", 12],
  N41viic: [237, "4cff5d072c402567e5b5f6c1860ca6c0eed7e972835e63a7b180f8761b809ed1", 8],
  N41viii: [131, "68decdbaadbe7ffa59c18b61914ca092d686350d0caa2a2b64475d2c5c2a593c", 5],
  CM4b: [202, "ef85369d94b05402254eeda567bfc3340cdb675501a66dfb5b9ddfca2dda93ee", 7],
  CM4btwin: [209, "f45b7e84575c4a9e69d28370de368af1d3a1a1f81468712c7dbd70340550f842", 7],
  CM4c: [200, "571b05efd7ba04fb6211a8121717bb06dff88e1dcd351eade79f5896b793a99c", 7],
  CM4ctwin: [206, "de6bc6a06ae86544ae623fad0360d6953420c03b11ae657ca38bed567740f7c1", 7],
  T53: [210, "21c1f5fb7fa62719165f237d8f70b5b1f8697690fb8f7cd635b5cd7acf520e06", 5],
  T53LO: [173, "0ad92921a7d2c0289dafbf909d2c76d269800881ac5c1a48e41e6550ce8ad09c", 6],
  T53LN: [128, "bae740d02d1423a3e05431a87309ed5237439248d584cb7af3b50cdc8257b2f8", 4],
  P11ii: [375, "4e36f08ff09e1a738072f157b80d7dcd2702d7cad22c365e5cf3b194ff5df154", 15],
  F1B: [195, "47dc8721e5474abc3130b38e36f58b01e71c387c4aadfdb192406f735ca14c59", 8]
});
// The two CONDITIONAL carriers are printed by the generator but kept out of
// the P0-08-SEP-WB listing; carrier A joins the corpus (AD-8: 89 -> 90).
const CONDITIONAL = new Set(["P11ii", "F1B"]);

// R-WB-15c measures of every fixture that verifies (P8-R27), from
// tool_outputs/derive_p008_r2.out.txt: [analysis_units, decls, stmts,
// call_sites, callback_refs, nesting_depth].
const MEASURES = Object.freeze({
  P01: [7, 1, 5, 0, 0, 1], N01: [10, 1, 8, 0, 0, 1], N02: [7, 1, 5, 0, 0, 1], N09: [7, 1, 5, 0, 0, 1], P03: [8, 1, 6, 0, 0, 1],
  P04: [9, 1, 7, 0, 0, 1], P05: [15, 2, 11, 1, 0, 1], WB01: [17, 3, 11, 1, 1, 1], WB02: [20, 3, 14, 2, 0, 1], WB03: [7, 1, 5, 0, 0, 1],
  WB04: [22, 3, 16, 2, 0, 1], WB05: [10, 1, 8, 0, 0, 2], WB06: [18, 3, 12, 2, 0, 1], WB08: [12, 2, 8, 0, 1, 1], PIPE03: [14, 1, 12, 0, 0, 1],
  N24: [8, 1, 6, 0, 0, 1], N26: [7, 1, 5, 0, 0, 1], N26twin: [7, 1, 5, 0, 0, 1], N28: [8, 1, 6, 0, 0, 1], N30: [5, 1, 3, 0, 0, 1],
  N31: [7, 1, 5, 0, 0, 1], N32: [8, 1, 6, 0, 0, 1], N33: [9, 1, 7, 0, 0, 1], P07: [6, 1, 4, 0, 0, 1], P02: [5, 1, 3, 0, 0, 1],
  N08: [7, 1, 5, 0, 0, 1], N22: [6, 1, 4, 0, 0, 1], P06: [6, 1, 4, 0, 0, 1], N39: [4, 1, 2, 0, 0, 1], P08in: [11, 2, 7, 1, 0, 1],
  P08out: [11, 2, 7, 1, 0, 1], P09: [24, 2, 21, 0, 0, 1], N40ixc: [5, 1, 3, 0, 0, 1], N40xic: [5, 1, 3, 0, 0, 1], N41ic: [8, 1, 6, 0, 0, 2],
  N42i: [12, 2, 8, 0, 1, 1], N42ii: [14, 2, 9, 2, 0, 1], P10: [9, 1, 7, 0, 0, 1], P11: [10, 3, 6, 0, 0, 1], N41viic: [10, 1, 8, 0, 0, 2],
  CM4b: [8, 1, 6, 0, 0, 1], CM4btwin: [8, 1, 6, 0, 0, 1], CM4c: [8, 1, 6, 0, 0, 1], CM4ctwin: [8, 1, 6, 0, 0, 1], T53: [7, 1, 5, 0, 0, 1],
  T53LO: [6, 1, 4, 0, 0, 1], T53LN: [4, 1, 2, 0, 0, 1], P11ii: [15, 3, 11, 0, 0, 1], F1B: [8, 2, 5, 0, 0, 1]
});
const MEASURE_ORDER = ["analysis_units", "decls", "stmts", "call_sites", "callback_refs", "nesting_depth"];

// P0-08-SEP-WB corpus (slice text P8-R28 item 1): the 89 distinct texts of
// the last section of derive_p008_r2.out.txt, sorted by sha256, plus carrier A
// (AD-8, VECTORS_ADDITIONS.md §3: 89 -> 90).
const SEP_CORPUS_SHA256 = Object.freeze([
  "00754e503a443ead0c1b49bb2d017e8a0c6421c57b4134933b265cb47b57aff6", "00e6b44b0e0c7c3fde30b2a2ae44700615b9aaaf9f66c5f4c6f7b9dc9774fb28",
  "02972af0f9fa091e0847a38d4bab0328f6a68d33aedb993461ea593b2c432dda", "02aee55309bac37f835f805b83fe6b1b26b204cce8d646ade964be9390c5b499",
  "08f4400c4b773b7bfec74f164108ca05f20d3e1f022a1179ea732e712189506b", "0ac0efcbf7db287d093e45bab65a12d7e31c219f62771ed838d9b1d774d46a61",
  "0ad92921a7d2c0289dafbf909d2c76d269800881ac5c1a48e41e6550ce8ad09c", "0dec54dab8a8c6cd4c85e9333aa4e9d1ffe1a7b7732469250c5fad82d38bee67",
  "112c81cef7ec4232e705bcfa9a0e19b547eb16ae8edbbec3ad11d896c155205f", "1869ed68494473e887d79a98f29b7faf26fe78c11bc16be11ae66a2efb0c7cfd",
  "199c65e25d1ed32dda3aee2e6d7f98a29e1ff724d24737d16d574d0e4db21665", "19cd9287c9c68f8ae44de363698443c27c6d43b4ff274045ffcbcf6ca4adf03d",
  "1e94decddf265251074bb31d58ef480d0bbe35a2cec7efbb880ac5a0ae79908b", "20578999d27930bd878e3212fb792324ea4c3d498ad1809a433df81eb77934ae",
  "210b1612b108e82551fe9ccf1f05444a01b96c08029acbd0048e31e7b626ac59", "2184d99f57c6b9a3c50b5bf04f8953a9b1cc7b07ec883914bd40b25be1b1c743",
  "21c1f5fb7fa62719165f237d8f70b5b1f8697690fb8f7cd635b5cd7acf520e06", "3092dd7203a4994e2c39dcbf191092a3f8d969fb65c6b2d14a99b93eff0a9c7b",
  "34f25eee819c455791a8aca82bc4064ad6ec8efe9c8c9f3ae9d21763cc05fed5", "3c7e769b01398214c8e4baadb16a0d34429786b8b7676b1cfde49dfd013a391f",
  "3d685b5707a759dacc45a90db87665288e86adbdc09ea5e09d059e45adb6f8fd", "3db1bce5694a9888cd384dac70a9ea0f6f2904563c9b7a05df4b4c6e4c9711fe",
  "3eb7010161c809aa37ffdd8623fe7791f2e18203bd6b9d0d130281a8402e96b8", "46961791a32fc79d11953ae432406c217c9dada719272ee2f7349104e9c05537",
  "4767ce49bf631251010e5338edab8e089ffab6eb18b2cebfbbcfe4fd8d39f97e", "4833bfa4c8f3735f9c22d162febabb545f68cda67b56068c0116295fd390edaa",
  "4cff5d072c402567e5b5f6c1860ca6c0eed7e972835e63a7b180f8761b809ed1", "4d82444ce8d916a8feeec305d7fa0ebf1f96ddbc8355a3316e2e28d32966c028",
  "4e36f08ff09e1a738072f157b80d7dcd2702d7cad22c365e5cf3b194ff5df154",
  "515a48f68742308d8b662273fc611024eb57595553ef6d3579a5ab45dd0243e6", "5243470348fe2ef04ae563c8d244fb10b90ab2b450f8bafa6a8cc3cf063d9d1c",
  "55e0ed245f4e47765f943559f1ad809dff098110396714423f9997e80f2cd159", "56df6f0ed90717b540f5739308da43de5fce9f9656c406e9acfc68ab6e26f513",
  "571b05efd7ba04fb6211a8121717bb06dff88e1dcd351eade79f5896b793a99c", "57a40fe45594912705770127d50aa082eeca69ee0d1707f392bf6dc09fdb20f5",
  "5eb7a044ce310a70f67df870a0ed86025f60f341b7a299b84b2e27968dbb2aab", "5fd7812940ed61f72bcca7c65c354ae691e83b49591f86fed465942e6a30f008",
  "6141ffd8d82c08a9aa93ec81ee08820ebd6c1c8743bdd44538257a1831ce303a", "68decdbaadbe7ffa59c18b61914ca092d686350d0caa2a2b64475d2c5c2a593c",
  "6cdb206a41ba0be7818b61941682dacd098790604825b0f68eb5480d2be09e5e", "73da8c5d573ff9baf2373da0ba6658c8485c20787395ce0be2daca268319f410",
  "79051b59b418df5d83f2179fb694285f3a8be340e1efc4f901eb24679277e5ad", "7ef493babd3595b5f4e369e052efe98cd71ee2f738f6aada077acb4e1d77e61f",
  "8051b784d450ba4771eb2cce070eb68e1742c5e191fd7e4c7b2e0d1c4716ed22", "8680b2f68386bf4381064c6eead6e88b79ca944a468150d9fb808adaff0ca87b",
  "886b54bb6993ae3e4556281099b5256cfa6f2b714540e9170f73f58fd23cb53f", "8a41f6d5ac9bb0d273f1d6f4c60fbc1ab3c15ca0989469b650721323023df518",
  "8b871dd0d60d451a9b9c6d82fa581fc6ee8d4ac6c9e07c9c78abf4fb35ef39ce", "909fa3f375082e4778da64cc28e1506d8b90d55da9c430a55bdc99eba4a185c1",
  "91390c5f54e18b1664c15a1f9a5d2ceba507788d0e2f7c4d319ff29e65e6a014", "9141ff3a8d6718b498967e38012e71b7b511fde1b903f4e5b018625034e742bf",
  "9364dbe4fe52e11932ffeb322837160adeda88e8b91bfee0f9bb81d08bdcc7fb", "9c64eee18d59b6b2628fd13221e70e01fa2bc82a5dca8c038d44b0334e32ec4c",
  "9ddf1da4000788f8d0e687a643a4198289159e9b71b1ba5325b977a36748e808", "a30e63cd38903039391360d4cfe6eac1c79fc756eac210298fcf74894a47213b",
  "a3d86be44d77224cdb482f9fcb1d62ec9cb11ad078ee671dc85e6597b02f54b3", "a46c0c6dd198bb17d6a7d94ea3018df8dee97ec5b06e90365d5171b1ff53ab8d",
  "a48e125e8603be57fe26bc8196652d4fa13c99688d1c8b07a45b1036f3f6b584", "a618ee8b4703ba231837fb1b45e359a8ef448f4a5d2b7b86d94d0a28ae55ced9",
  "a7950cd8990e06e80ec3e95417362fcf9818e61d989ccb878129601d9267aae7", "ac7ac442727ccc93bf6d6b0ea4b74268b5eb41f0c2aa968a0a3d5f5be9abeab0",
  "b40bdd9d5f71c451f891cbc5a332d2d27f9d454927941bad2d32c0c3b7de2614", "b53a1decc620bb9e79dfaf72e8f90244b9c8c1c4fd294902395d05c48990c3db",
  "b8746c2196c759f7ffd7f3d1f070f38036ecb3b2b8bc9835de6acac5028234e6", "bae740d02d1423a3e05431a87309ed5237439248d584cb7af3b50cdc8257b2f8",
  "c0cac219cd127286d4cfe9ba364befdc9314b526eb35a3afbb96e33add699189", "c3156ed14f18954dfebd0452f1fa5d8755c4b0df73d0bd1fd074955bd5602fda",
  "c32aa6271cf4310daa4916e43da20d8e3dada874200fde534046cacaa219fc21", "c4efb13dc917a96fb18bfe66ed7f09d97113ed67494ff03a40488bee39231faa",
  "ca9d2adfbc7ef7fd22b36d35eb940e53c474c552fa4c44c75fb76b77f5370e3b", "d35c6dd00b49ae2da196087f93a3e25869ec79422c3240e3fbc959cf41d345da",
  "d5c746dbe92ea980c5f369ae182151c91dda17961a220744f4843133e5cf610f", "da48bf872edcd127648ef31d7e2ca2ad2e9700ebc1719485b89ea9bfb42f1702",
  "db82bd57233834b57ed326a10ba4af3c7769cb57f5fe27a5dbbdfa8a77001c2e", "dcc474f5324428aeec536e36e0568be9d9b9aa26bde1f4c5c055ed20cbc85a51",
  "de6bc6a06ae86544ae623fad0360d6953420c03b11ae657ca38bed567740f7c1", "dff03cc49a9d44cab64b9631c9d99f4dda26ed823f2762e85e319f584b8b736a",
  "e1d83c82d45345a85430a9ee33db74e6145cf7641edece357e40c5f4781d56dc", "e233bbb31d8aee6ed0e04f45f86e1dc80ee690c47deefed2a8c604821baf6def",
  "e4ddd87994ac889c55cc756853bb5df55dd92eea8fe7ad528e8be2e524a705db", "e7c13782ce14675ddf6d310bffd97a04318b7a77fa2e3e78f557b8696d708984",
  "e98c4773ebb451d4b6880ab3b5b3105a9abc790f76eee6cc7411f00eb3cef7ab", "ed68966d9512d7328b5a1dc1bffdb9aaee24ecf3ef28734adf800cc51cc1d7fd",
  "ef85369d94b05402254eeda567bfc3340cdb675501a66dfb5b9ddfca2dda93ee", "f36b5b6dd6e45af9a33ecfb5fbebd1afca22f6d5f03dc3c9bd31de2d001ac787",
  "f45b7e84575c4a9e69d28370de368af1d3a1a1f81468712c7dbd70340550f842", "f653f01838f9d16c32b337018cb4957cb6a8d0b666938250b482bb50f9d73c53",
  "fb79089dd09f0749956a7751a82a409f179278e4321abab3786065dc3ff37e80", "fcc4eb19c2972ffaac7ac4f317342fb7b4065319b7efbb4d28164f5eadd46ce9",
  "fdd5c748d069848f9d4efa1c92a255ffe1ec9b6d12da40f83ee20f6096dfb840"
]);
// P8-R28 item 6: the largest real values among the verifying corpus modules
// (V53-PIPE-03 steps; V53-MEM-WB01 h and WB08 run, calls and iterations).
const P08_MAXIMA = Object.freeze({ calls: "10", iterations: "10", steps: "10485772" });
// P8-R28 item 3: PHASE_P08 = PHASE_P05.
const PHASE_P08 = Object.freeze(["air.call.recursion_rejected", "air.workbound.overflow", "air.workbound.unknown_bound",
  "air.workbound.invalid_bound", "air.workbound.missing_summary", "air.workbound.assertion_exceeded"]);
// The accepted base (P0-07, OD-P7-6 (a)): its CT-1 file and its src/ (the
// pair characterization).
const BASE_COMMITS = ["491aad12e49a6683029b410af890dcfa86e7d64c", "fb17d750b5f4c1d037010ba56d9ac797e95fc509"];
// Old hosts from git objects, per projection [dev, public] (VECTORS_ADDITIONS
// §4.1): the 0.52.1 compiler and SDK (94001cd in the dev history; its public
// projection 9c2b178), 0.52.0 (f258ed0; 60822f5) and 0.50 (the public tag
// v0.50.1 91c3e7b; the dev history's 0.50.0 d5a6d7a, "0.50.0 and 0.51.0 have
// the same code at the cited line", V53-ABI-12).
const OLD_HOSTS = Object.freeze({
  "0.52.1": ["94001cd1c822ccd914874c85543aa99e91d6ae4e", "9c2b1788a42f747bf6d61f2517c8348a7d519159"],
  "0.52.0": ["f258ed0df6da99785bacd706f9d5b04f42ba64c0", "60822f55c1f60f7dd63220b4985db91bb3173bbb"],
  "0.50": ["91c3e7b7805b6e76bbb0cb9cfa5f14ef6d5a01d8", "d5a6d7ac55c57d8be75dd7b389443ff215fe3368"]
});
// ART-L521's source: the R1 proposal's probe/src.air (VECTORS_ADDITIONS §4.1),
// and its build by the 0.52.1 compiler.
const L521_SOURCE = ["module borrow_region_alias", "capabilities { }", "requires export f",
  "export func f(src: borrowed_slice<readonly,len=4..4,align=4>) -> i32 {", "entry:", "  %n:i32 = 16", "  %p:ptr = alloc_region %n",
  "  %z:i32 = 0", "  %v:i32 = 777", "  store.i32 %p, %z, %v", "  %seen:i32 = slice.load.i32 %src, %z", "  free_region %p", "  return %seen", "}", ""].join("\n");
const L521_PIN = Object.freeze({ source: [304, "8fe55cc7135b22c0324c9ffdca0a0e6e827afd285ec3e72d6923c8868c9d05d6"], wasm: [461, "a82c793a4530506c523f29d94fa5ee6ae8a7ba7bcecb3af823779afb6410c54c"] });

const results = [];
const failures = [];
const observedFailures = [];
const acceptedSources = new Map();

function sha256(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}
const hexOf = (text) => crypto.createHash("sha256").update(Buffer.isBuffer(text) || text instanceof Uint8Array ? text : Buffer.from(text, "utf8")).digest("hex");

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
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return { bytes: value.length, sha256: sha256(value) };
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

// Every fixture equals the generator's bytes (its byte count and sha256).
function pinned(key) {
  const source = F[key];
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

async function captureAsync(action) {
  try {
    await action();
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
// the descriptor image `i32`. A borrowed-lane module takes the v2 borrowed
// descriptor (P8-R13, P8-R15), made by the typed path of borrowed_slices.js
// from the parsed source.
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
const borrowedLane = (source) => borrowedSlices.typedV053.moduleUsesBorrowedSlices(parser.typedV053.parse(source, "lane.air"));
const v2Of = (source) => borrowedSlices.typedV053.interfaceDescriptor(parser.typedV053.parse(source, "descriptor.air"));
const descriptorFor = (source) => (borrowedLane(source) ? v2Of(source) : descriptorOf(source));
const FALLBACK_DESCRIPTOR = Object.freeze({
  air_abi_lane: "0.12", module_id: M, schema: "air.typed-interface/0.12-candidate.1", types: [],
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
// stated value or failure through both, in order (one invocation each). A
// borrowed-lane module is built here and invoked through the typed admission
// by its vector (the plain verified paths refuse it, P8-R24).
async function accepted(source, invocations, label, buildInput = {}) {
  const ast = typedV053(source, `${label}.air`);
  const wat = lowerToWat(ast, { maxWatBytes: MAX_WAT });
  const file = path.join(tmp, `${label}.air`);
  fs.writeFileSync(file, source);
  const cli = runCli(["verify", file, "--source-profile", V053, "--allow-candidate-profile"]);
  assert.equal(cli.status, 0, `${label}: CLI verify ${cli.stderr}`);
  const desc = descriptorFor(source);
  const built = await buildVerifiedTypedModule({ ...GATED, descriptor: desc, source, ...buildInput });
  const outcomes = {};
  if (invocations.length) {
    const handle = await runtimeHost.build({ ...GATED, descriptor: desc, source });
    for (const [name, args, expected] of invocations) {
      const viaBuilder = await invocationOutcome(() => invokeVerifiedTypedExport(built, name, args));
      const viaRuntime = await invocationOutcome(() => runtimeHost.invoke(handle, name, args));
      assert.deepEqual(viaBuilder, expected, `${label}: builder ${name}(${args.join(", ")})`);
      assert.deepEqual(viaRuntime, expected, `${label}: runtime ${name}(${args.join(", ")})`);
      const key = `${name}(${args.join(", ")})`;
      outcomes[key] = outcomes[key] ? [].concat(outcomes[key], [viaBuilder]) : viaBuilder;
    }
  }
  const runRecord = { ast, built, entrypoints: ["sdk_verify", "lowerToWat", "cli_verify", "builder", ...(invocations.length ? ["runtime"] : [])], invocations: outcomes, label, source, wat };
  acceptedSources.set(label, runRecord);
  return runRecord;
}

// The adapter's value forms: an i32 is a JS number, a float `{ bits, type }`
// (its IEEE 754 bits, big-endian hex).
const f32 = (number) => {
  const bytes = Buffer.alloc(4);
  bytes.writeFloatBE(number);
  return { value: { bits: bytes.toString("hex"), type: "f32" } };
};
const R34 = Object.freeze({ code: "air.memory.region_bounds_runtime", failureReason: 34 });
const v = (value) => ({ value });

// A summary (P8-R20: `region_bytes` only when non-zero). Where a row states no
// `region_bytes`, the value is P8-R19's closed form, as VECTORS_ADDITIONS.md
// (its conventions, "region_bytes uses the closed form of P8-R19") directs:
// for these fixtures one site of B bytes and no callee site gives B.
const S = (steps, calls = 0, iterations = 0, regionBytes = 0) => wb.canonicalSummary(wb.summary({ calls: BigInt(calls), iterations: BigInt(iterations), region_bytes: BigInt(regionBytes), steps: BigInt(steps) }));

function expectE(built, name, steps, calls = 0, iterations = 0, regionBytes = 0) {
  const actual = wb.inspectBoundWorkBound(built).record.entries[name];
  assert.deepEqual(actual, S(steps, calls, iterations, regionBytes), `E(${name})`);
  return actual;
}

function expectB(built, name, steps, calls = 0, iterations = 0, regionBytes = 0) {
  const actual = wb.inspectBoundWorkBound(built).functions[name];
  assert.deepEqual(actual, S(steps, calls, iterations, regionBytes), `B(${name})`);
  return actual;
}

// The two reported quantities of P8-R22 (the build's non-enumerable `memory`).
function expectBacking(built, backingBytes, regionSlotBytes) {
  assert.deepEqual({ ...built.memory }, { backingBytes, regionSlotBytes }, "backing_bytes and region-slot bytes");
  assert(!Object.keys(built).includes("memory"), "the report is not an enumerable key of the build");
  return { backing_bytes: backingBytes, region_slot_bytes: regionSlotBytes };
}

const MEASURE_FIELDS = ["analysis_units", "call_sites", "callback_refs", "decls", "import_edges", "modules", "nesting_depth", "stmts"];
function expectMeasures(key) {
  const expected = Object.fromEntries(MEASURE_ORDER.map((field, index) => [field, MEASURES[key][index]]));
  const measures = measureTypedModule(parser.typedV053.parse(F[key], "measure.air"));
  const actual = Object.fromEntries(MEASURE_ORDER.map((field) => [field, measures[field]]));
  assert.deepEqual(actual, expected, `${key}: R-WB-15c measures (slice text P8-R27)`);
  return Object.fromEntries(MEASURE_FIELDS.map((field) => [field, measures[field]]));
}

function functionWat(wat, name) {
  const begin = wat.indexOf(`  (func $${name} `);
  assert(begin >= 0, `function $${name} is lowered`);
  const end = wat.indexOf("\n  )", begin);
  return wat.slice(begin, end);
}

// The raw exports of one fresh instance (R-STATE-1); a borrowed-lane artifact
// gets the deliberate contract word (H-DELIB).
const delibImports = () => ({ "air:contract": { "typed-v0.53.v1": () => WORD } });
function rawInstance(bytes, imports) {
  const module = new WebAssembly.Module(bytes);
  return new WebAssembly.Instance(module, imports || (WebAssembly.Module.imports(module).length ? delibImports() : {}));
}

// A raw call's outcome: a value, or the trap with the instance's reason value
// and whether it passed through `$__air_borrow_failure`.
function rawCall(instance, name, args) {
  try {
    return { value: instance.exports[name](...args) };
  } catch (error) {
    assert(error instanceof WebAssembly.RuntimeError, `raw call: ${error && error.stack}`);
    const flag = instance.exports.__air_failure_reason;
    return { borrowFrame: /\bat __air_borrow_failure\b/u.test(String(error.stack)), reason: flag ? flag.value : null, trap: error.message };
  }
}

// A binding descriptor of the frozen v1 binding (src/borrowed_memory_binding.js).
const bind = (buffer, access, maxLength, alignment, transferMode = "wasm_memory_view") => ({
  access, aliasGroup: null, alignment, buffer, maxLength, memoryDomain: "wasm-linear", transferMode
});
const viewAt = (memory, offset, bytes) => {
  const view = new Uint8Array(memory.buffer, offset, bytes.length);
  view.set(bytes);
  return view;
};
const word = (value) => [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255];
const outcomeOf = (result) => (result.diagnostics && result.diagnostics.length ? { code: result.diagnostics[0].code } : { value: result.result });

// ---------------------------------------------------------------------------
// P0-08-CHECK-MEM (slice text P8-R23), read from the fixture text (never from
// the implementation): per function, its top-level statement lines (no
// fixture of the check set has a block statement).
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

// A function's instructions, without its header and local declarations.
function bodyInstructions(wat, name) {
  return functionWat(wat, name).split("\n").slice(1).map((line) => line.trim()).filter((line) => !line.startsWith("(local "));
}

const MEMORY_TYPES = /^(?:ptr|slice|borrowed_slice<.*>)$/u;
// Part 1: each statement's lowered lines, from its first instruction through
// the instruction that writes its result (the store into the destination
// local's last lane, the one memory store, `return`); `free_region` lowers to
// no instruction. An exported borrowed function's entry preflight comes first
// (its ingress, P8-R14) and ends at the last `end` of a `$__air_borrow_failure`
// block before the first statement's result. The segments must cover the body
// exactly, so a statement's sequence is never cut short.
function statementSegments(wat, name, statements) {
  const lines = bodyInstructions(wat, name);
  const segments = [];
  let cursor = 0;
  const endOf = (statement) => {
    const local = /^%([A-Za-z_][A-Za-z0-9_]*): (\S+) = (.*)$/u.exec(statement);
    if (local) return lines.indexOf(`local.set $${local[1]}$${MEMORY_TYPES.test(local[2]) ? 1 : 0}`, cursor);
    if (/^(?:store\.|slice\.store\.|buffer\.store )/u.test(statement)) return lines.findIndex((line, index) => index >= cursor && /^(?:i32|f32)\.store$/u.test(line));
    if (/^free_region /u.test(statement)) return cursor - 1;
    if (/^return\b/u.test(statement)) return lines.indexOf("return", cursor);
    return assert.fail(`no end marker for '${statement}'`);
  };
  const firstEnd = endOf(statements[0]);
  let ingressEnd = -1;
  for (let index = 1; index < firstEnd; index += 1) if (lines[index] === "end" && lines[index - 1] === "call $__air_borrow_failure") ingressEnd = index;
  if (ingressEnd >= 0) {
    segments.push({ ingress: true, lines: lines.slice(0, ingressEnd + 1), statement: "(entry preflight)" });
    cursor = ingressEnd + 1;
  }
  for (const statement of statements) {
    const end = endOf(statement);
    assert(end >= cursor - 1, `${name}: the lowered lines of '${statement}' are found`);
    segments.push({ lines: lines.slice(cursor, end + 1), statement });
    cursor = end + 1;
  }
  assert.equal(cursor, lines.length, `${name}: the statement segments cover the body exactly`);
  return segments;
}

const LOCAL_OP = /^local\.(?:get|set|tee) \$[A-Za-z0-9_$]+$/u;
const I32_CONST = /^i32\.const -?[0-9]+$/u;
const I32_OP = /^i32\.(?:add|sub|mul|and|or|xor|shl|shr_s|shr_u|eq|ne|eqz|lt_s|lt_u|gt_s|gt_u|le_s|le_u|ge_s|ge_u)$/u;
const ACCESS = /^(?:i32|f32)\.(?:load|store)$/u;
const MEMORY_STATEMENT = /^(?:%[A-Za-z_][A-Za-z0-9_]*: \S+ = )?(?:load\.|store\.|slice\.(?:load|store|from_region|sub|len)|buffer\.(?:load|store|from_ptr)|alloc_region)/u;

// Part 2: the whitelist of one memory statement's sequence. Domain checks are
// `if` ... `end` blocks whose failing path calls the value-34 helper and ends
// in `unreachable`, or, on a borrowed view, calls the frozen
// `$__air_borrow_failure` transport (P8-R16). An f32 store carries exactly the
// canonicalization (`f32.eq` of the value with itself, the canonical NaN made
// by `i32.const 0x7fc00000` and `f32.reinterpret_i32`, one `select`); an f32
// literal operand is its one `f32.const` (TYPED_MEMORY.md §8). An access has
// exactly one load or store of its width; a view or buffer statement none.
function classifyMemory(sequence, statement, types = new Map()) {
  const problems = [];
  const access = /(?:^|= )(?:slice\.)?(?:load|store)\.(i32|f32)\b|(?:^|= )buffer\.(?:load|store) /u.exec(statement);
  const buffer = /^buffer\.store %([A-Za-z_][A-Za-z0-9_]*),/u.exec(statement);
  const f32Store = /^(?:slice\.)?store\.f32 /u.test(statement) || Boolean(buffer && /^buffer<f32,/u.test(types.get(buffer[1]) || ""));
  let accesses = 0;
  let typedConstants = 0;
  let canon = { eq: 0, nan: 0, reinterpret: 0, select: 0 };
  sequence.forEach((line, index) => {
    if (ACCESS.test(line)) accesses += 1;
    else if (LOCAL_OP.test(line) || I32_OP.test(line) || line === "if" || line === "end" || line === "unreachable" ||
      line === "call $__air_v053_region_bounds_runtime" || line === "call $__air_borrow_failure") return;
    else if (I32_CONST.test(line)) { if (line === "i32.const 2143289344") canon.nan += 1; }
    else if (line === "f32.eq" || line === "f32.ne") canon.eq += 1;
    else if (line === "select") canon.select += 1;
    else if (line === "f32.reinterpret_i32") canon.reinterpret += 1;
    else if (/^f32\.const /u.test(line)) typedConstants += 1;
    else problems.push(`${index}: '${line}' is not admitted in a memory statement's sequence`);
  });
  const want = access ? 1 : 0;
  if (accesses !== want) problems.push(`${accesses} memory accesses; exactly ${want} admitted`);
  if (f32Store && (canon.eq !== 1 || canon.select !== 1 || canon.reinterpret !== 1 || canon.nan < 1)) problems.push(`f32 store without exactly the canonicalization (${JSON.stringify(canon)})`);
  if (!f32Store && (canon.eq || canon.select || canon.reinterpret)) problems.push("a canonicalization instruction outside an f32 store");
  if (typedConstants > (f32Store ? 1 : 0)) problems.push(`${typedConstants} f32 constants`);
  return problems;
}

// The declared type of every parameter and local of a fixture function.
function sourceTypes(source, name) {
  const types = new Map();
  const header = new RegExp(`^(?:export )?func ${name}\\(([^)]*)\\)`, "mu").exec(source);
  for (const part of header && header[1] ? header[1].split(/,\s*(?![^<]*>)/u) : []) {
    const parameter = /^([A-Za-z_][A-Za-z0-9_]*): (.+)$/u.exec(part.trim());
    if (parameter) types.set(parameter[1], parameter[2]);
  }
  for (const statement of sourceFunctions(source).get(name) || []) {
    const local = /^%([A-Za-z_][A-Za-z0-9_]*): (\S+) = /u.exec(statement);
    if (local) types.set(local[1], local[2]);
  }
  return types;
}

// Part 3: an `alloc_region` lowers to its size checks, then exactly one
// `memory.fill` of value `i32.const 0`, destination the site's base (the
// address the binding then holds) and length the runtime size or the slot.
function classifyZeroing(sequence) {
  const problems = [];
  const fills = sequence.map((line, index) => (line === "memory.fill" ? index : -1)).filter((index) => index >= 0);
  if (fills.length !== 1) return [`${fills.length} memory.fill instructions; exactly one admitted`];
  const at = fills[0];
  const base = /^i32\.const ([0-9]+)$/u.exec(sequence[at - 3] || "");
  if (!base) problems.push("the fill destination is not a constant base");
  if (sequence[at - 2] !== "i32.const 0") problems.push("the fill value is not i32.const 0");
  if (!/^(?:local\.get \$\S+|i32\.const [0-9]+)$/u.test(sequence[at - 1] || "")) problems.push("the fill length is not the runtime size or the slot");
  if (base && sequence[at + 1] !== `i32.const ${base[1]}`) problems.push("the binding does not hold the filled base");
  for (const line of sequence.slice(0, at - 3)) {
    if (!(LOCAL_OP.test(line) || I32_CONST.test(line) || I32_OP.test(line) || ["if", "end", "unreachable", "call $__air_v053_region_bounds_runtime"].includes(line))) problems.push(`'${line}' before the fill`);
  }
  return problems;
}

// ---------------------------------------------------------------------------
// P0-08-SEP-WB (slice text P8-R28; the P0-05 P5-R13b method, as P0-07 P7-R19
// applies it). Each corpus source is verified with the real WorkBound phase,
// with the phase disabled (an empty `status: "ok"` analysis) and with an
// outcome-preserving stub (+7919 steps, +13 calls, +17 iterations on every
// `ok` summary; region_bytes is not perturbed, item 2). Item 5: a source that
// verifies in real mode is lowered in each mode, and the WAT must be
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
const PHASE_P08 = new Set(${JSON.stringify(PHASE_P08)});
const PERTURB = { calls: 13n, iterations: 17n, steps: 7919n };
const real = wb.analyzeVerifiedTypedModule;
const perturb = (values) => new Map([...values].map(([name, value]) => [name, value && value.ok ? { ok: true, value: wb.summary({
  calls: value.value.calls + PERTURB.calls,
  effects: value.value.effects,
  iterations: value.value.iterations + PERTURB.iterations,
  ...(value.value.region_bytes !== undefined ? { region_bytes: value.value.region_bytes } : {}),
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
  const phase = got.real.verdict === "REJECTED" && PHASE_P08.has(got.real.code);
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

// Controls (P8-R28 item 6): each mutant is applied to a scratch copy of src/,
// never to the repository's src/. C2, C3, C4 and C7 must make the verdict
// comparison report a difference; C8 changes no verdict and must make the WAT
// comparison (item 5) report one. C8 rewrites at the P0-07 anchors.
const PHASE_OK_ANCHOR = "  if (analysis.status === \"ok\") {\n    verifyV053WorkAssertion(mod, analysis);\n    return;\n  }";
function thresholdMutant(dimension) {
  return PHASE_OK_ANCHOR.replace("    return;", [
    "    if (!mod.work) for (const fn of mod.functions || []) {",
    "      const entry = fn.exported && analysis.entries instanceof Map ? analysis.entries.get(fn.name) : null;",
    `      if (entry && entry.ok && entry.value.${dimension} > ${P08_MAXIMA[dimension]}n) throw new VerificationError("air.workbound.assertion_exceeded: mutant threshold on ${dimension}", fn.loc);`,
    "    }",
    "    return;"
  ].join("\n"));
}
// C7: the static memory-domain check reads the WorkBound summary: a module
// with a memory statement is rejected when an export's E(e).steps exceeds 7.
const C7_REPLACEMENT = PHASE_OK_ANCHOR.replace("    verifyV053WorkAssertion(mod, analysis);", [
  "    const __mem = (list) => (list || []).some((s) => s && (s.kind === \"memory\" || (s.value && s.value.kind === \"memory_operation\") || (Array.isArray(s.blocks) && s.blocks.some((b) => __mem(b.statements)))));",
  "    if ((mod.functions || []).some((fn) => __mem(fn.statements))) for (const fn of mod.functions || []) {",
  "      const entry = fn.exported && analysis.entries instanceof Map ? analysis.entries.get(fn.name) : null;",
  "      if (entry && entry.ok && entry.value.steps > 7n) throw new VerificationError(\"air.memory.region_bounds_static: mutant reads E(e).steps\", fn.loc);",
  "    }",
  "    verifyV053WorkAssertion(mod, analysis);"
].join("\n"));
// C8: the lowering reads the WorkBound summary and emits one `nop` in each
// function whose E(e).steps exceeds 7.
const C8_FEATURES_ANCHOR = "    const features = v053ModuleFeatures(mod);\n    const header = v053ModuleHeaderLines(features);";
const C8_BODY_ANCHOR = "  for (const record of records) emitV053TypedRuntimeValidation(state, record);";
const MUTANTS = Object.freeze({
  C2: { description: `reject a module without work when E(e).steps > ${P08_MAXIMA.steps}`, edits: [["verifier.js", PHASE_OK_ANCHOR, thresholdMutant("steps")]] },
  C3: { description: `reject a module without work when E(e).calls > ${P08_MAXIMA.calls}`, edits: [["verifier.js", PHASE_OK_ANCHOR, thresholdMutant("calls")]] },
  C4: { description: `reject a module without work when E(e).iterations > ${P08_MAXIMA.iterations}`, edits: [["verifier.js", PHASE_OK_ANCHOR, thresholdMutant("iterations")]] },
  C7: { description: "the static memory-domain check reads the WorkBound summary (reject a module with a memory statement when E(e).steps > 7)", edits: [["verifier.js", PHASE_OK_ANCHOR, C7_REPLACEMENT]] },
  C8: {
    description: "the lowering reads the WorkBound summary (one nop in each function whose E(e).steps > 7)",
    edits: [
      ["lower_wasm.js", C8_FEATURES_ANCHOR, C8_FEATURES_ANCHOR.replace("\n    const header", "\n    features.__wbEntries = require(\"./workbound\").analyzeVerifiedTypedModule(mod).entries;\n    const header")],
      ["lower_wasm.js", C8_BODY_ANCHOR, `${C8_BODY_ANCHOR}\n  const __wbEntry = features.__wbEntries && features.__wbEntries.get(fn.name);\n  if (__wbEntry && __wbEntry.ok && __wbEntry.value.steps > 7n) state.body.push("nop");`]
    ]
  }
});

// ---------------------------------------------------------------------------
// Forgeries of ART-T53 (VECTORS_ADDITIONS.md §4.1), made by editing its WAT
// and assembling it again (inputs, not expectations).
const GUARD_BLOCK = /\n {4}local\.get \$src\$1\n {4}i32\.const 0\n {4}i32\.ne\n[\s\S]*?\n {4}i32\.const 64\n {4}global\.set \$__air_failure_reason\n {4}i32\.const 4\n {4}call \$__air_borrow_failure\n {4}end/u;
function forgeWat(wat, kind) {
  const once = (text, from, to) => {
    assert.equal(text.split(from).length, 2, `${kind}: '${String(from).slice(0, 60)}' occurs once`);
    return text.replace(from, to);
  };
  const strip = (text) => {
    let out = text.split("\n").filter((line) => !line.startsWith("  (import \"air:contract\"") && !line.startsWith("  (func $__air_v053_contract_start") && line !== "  (start $__air_v053_contract_start)").join("\n");
    assert(!out.includes("air:contract") && !out.includes("(start "), `${kind}: import and start removed`);
    return out;
  };
  if (kind === "F-STRIP") return strip(wat);
  if (kind === "F-V1") {
    return once(strip(wat), "  (global (export \"__air_abi_feature_typed_memory_v1\") i32 (i32.const 851969))", "  (global (export \"__air_abi_feature_borrowed_slice_v1\") i32 (i32.const 720897))");
  }
  if (kind === "F-EMPTY") return once(wat, "(global (export \"__air_owned_memory_end\") i32 (i32.const 32))", "(global (export \"__air_owned_memory_end\") i32 (i32.const 16))");
  if (kind === "F-UNDER") return once(wat, "(global (export \"__air_owned_memory_end\") i32 (i32.const 32))", "(global (export \"__air_owned_memory_end\") i32 (i32.const 20))");
  if (kind === "F-WORD") return once(wat, `i32.const ${WORD} i32.ne`, `i32.const ${WORD + 1} i32.ne`);
  if (kind === "F-NOGUARD") {
    assert(GUARD_BLOCK.test(wat), "F-NOGUARD: the guard block is found");
    return wat.replace(GUARD_BLOCK, "");
  }
  if (kind === "F-NOGUARD-EMPTY") return forgeWat(forgeWat(wat, "F-NOGUARD"), "F-EMPTY");
  if (kind === "F-NOMARKER") return once(wat, "  (global (export \"__air_abi_feature_typed_memory_v1\") i32 (i32.const 851969))\n", "");
  if (kind === "F-V2ID") return once(wat, "(import \"air:contract\" \"typed-v0.53.v1\"", "(import \"air:contract\" \"typed-v0.53.v2\"");
  // V53-MEM-N23 (a) the owned-range exports absent, (b) end < base.
  if (kind === "F-NORANGE") {
    const out = wat.split("\n").filter((line) => !/^ {2}\(global \(export "__air_owned_memory_(?:base|end)"\)/u.test(line)).join("\n");
    assert(!out.includes("__air_owned_memory_"), `${kind}: owned-range exports removed`);
    return out;
  }
  if (kind === "F-ENDLOW") return once(wat, "(global (export \"__air_owned_memory_end\") i32 (i32.const 32))", "(global (export \"__air_owned_memory_end\") i32 (i32.const 8))");
  return assert.fail(`unknown forgery ${kind}`);
}
const forge = async (wat, kind) => Buffer.from(await watToWasm(forgeWat(wat, kind), `${kind}.air`));

// ---------------------------------------------------------------------------
// Old hosts and compilers from git objects (V53-ABI-01..-16, -28, -29),
// extracted once each into the scratch directory, run in bounded child
// processes.
const oldHostCache = new Map();
function oldHost(version) {
  if (oldHostCache.has(version)) return oldHostCache.get(version);
  let commit = null;
  for (const candidate of OLD_HOSTS[version]) {
    if (childProcess.spawnSync("git", ["cat-file", "-e", `${candidate}^{commit}`], { cwd: ROOT }).status === 0) { commit = candidate; break; }
  }
  assert(commit, `the ${version} host is not in this repository's objects`);
  const dir = path.join(tmp, `host-${version}`);
  fs.mkdirSync(dir, { recursive: true });
  // stdlib/ too: a legacy `import std.*` resolves against it (V53-ABI-05).
  const paths = ["src", "package.json", ...(childProcess.spawnSync("git", ["cat-file", "-e", `${commit}:stdlib`], { cwd: ROOT }).status === 0 ? ["stdlib"] : [])];
  const archive = childProcess.spawnSync("sh", ["-c", `git archive ${commit} ${paths.join(" ")} | tar -x -C "${dir}"`], { cwd: ROOT, encoding: "utf8" });
  assert.equal(archive.status, 0, archive.stderr);
  const version_ = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).version;
  const host = { commit, dir, version: version_ };
  oldHostCache.set(version, host);
  return host;
}

// Runs `body` (the text of an async function of (src, input)) in a child
// process against the old host's src/, with `input` (JSON; byte arrays as hex
// under keys ending in "Hex"), and returns its JSON output.
function runOld(version, body, input = {}) {
  const host = oldHost(version);
  const script = path.join(host.dir, `probe_${fileCounter += 1}.js`);
  fs.writeFileSync(script, `"use strict";
const path = require("path");
const src = (m) => require(path.join(${JSON.stringify(path.join(host.dir, "src"))}, m));
const input = JSON.parse(process.argv[2]);
for (const key of Object.keys(input)) if (key.endsWith("Hex")) input[key.slice(0, -3)] = Buffer.from(input[key], "hex");
(async (src, input) => { ${body} })(src, input).then((out) => process.stdout.write(JSON.stringify(out === undefined ? null : out)), (error) => {
  process.stdout.write(JSON.stringify({ uncaught: { code: error && error.code || null, message: String(error && error.message || error), name: error && error.name || null } }));
});
`);
  const out = childProcess.spawnSync(process.execPath, [script, JSON.stringify(input)], {
    cwd: host.dir, encoding: "utf8", env: { ...process.env, NODE_PATH: path.join(ROOT, "node_modules") }, killSignal: "SIGKILL", maxBuffer: 64 * 1024 * 1024, timeout: 120000
  });
  assert(!out.error && out.signal === null && out.status === 0, `old host ${version}: ${out.stderr || out.error}`);
  return { commit: host.commit, out: JSON.parse(out.stdout), version: host.version };
}
const hexBytes = (bytes) => Buffer.from(bytes).toString("hex");

// wasmtime 44.0.1 (V53-ABI-71), bounded.
function wasmtime(args) {
  const out = childProcess.spawnSync("wasmtime", args, { cwd: tmp, encoding: "utf8", killSignal: "SIGKILL", maxBuffer: 16 * 1024 * 1024, timeout: 60000 });
  assert(!out.error, `wasmtime: ${out.error && out.error.code}`);
  return { status: out.status, stderr: out.stderr, stdout: out.stdout.trim() };
}

// The accepted base (P0-07) runs from git objects in a bounded child process
// (the pair characterization, slice text §10).
function baseVerdicts(keys) {
  const dir = path.join(tmp, "p008_base");
  let commit = null;
  for (const candidate of BASE_COMMITS) {
    if (childProcess.spawnSync("git", ["cat-file", "-e", `${candidate}^{commit}`], { cwd: ROOT }).status === 0) { commit = candidate; break; }
  }
  assert(commit, "the accepted P0-08 base commit is not in this repository");
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
    fs.writeFileSync(file, F[key]);
    return file;
  });
  const out = childProcess.spawnSync(process.execPath, [script, path.join(dir, "src"), ...files], {
    encoding: "utf8", env: { ...process.env, NODE_PATH: path.join(ROOT, "node_modules") }, killSignal: "SIGKILL", maxBuffer: 16 * 1024 * 1024, timeout: 120000
  });
  assert(!out.error && out.signal === null && out.status === 0, `base probe: ${out.stderr || out.error}`);
  return { commit, verdicts: JSON.parse(out.stdout) };
}

// ---------------------------------------------------------------------------
// The generated P0-08 set (VECTORS_ADDITIONS.md §2.1-§2.4).
const ctx = {};
const rejectVector = (id, key, code, sourceLine = lineOf(key), messagePart) => vector(id, async () => ({ value: (await staticReject(pinned(key), code, sourceLine, messagePart)).outcome, sourceDigest: sha256(F[key]) }));

async function sectionRegions() {
  await vector("V53-MEM-P01", async () => {
    const r = await accepted(pinned("P01"), [["run", [], v(42)]], "p01");
    ctx.p01 = r;
    return { value: { "E(run)": expectE(r.built, "run", 7, 0, 0, 16), backing: expectBacking(r.built, 16, 16), invocations: r.invocations, measures: expectMeasures("P01") }, sourceDigest: sha256(F.P01) };
  });
  await vector("V53-MEM-N01", async () => {
    const r = await accepted(pinned("N01"), [["run", [], v(11)]], "n01");
    return { value: { "E(run)": expectE(r.built, "run", 1034, 0, 0, 8208), backing: expectBacking(r.built, 8208, 8208), invocations: r.invocations, measures: expectMeasures("N01") } };
  });
  await vector("V53-MEM-N02", async () => {
    const r = await accepted(pinned("N02"), [["run", [], v(7)]], "n02");
    const refused = await captureAsync(() => buildVerifiedTypedModule({ ...GATED, descriptor: descriptorOf(F.N02), memoryBackingLimit: 1048575, source: F.N02 }));
    assert(refused && refused.code === "air.build.memory_backing_limit" && refused.disposition === "BUILD_REFUSED", String(refused && refused.message));
    assertNoRawError(refused.message, "N02 limit");
    observedFailures.push({ code: refused.code, kind: "BUILD_REFUSED" });
    return { value: { "E(run)": expectE(r.built, "run", 131077, 0, 0, 1048576), backing: expectBacking(r.built, 1048576, 1048576), invocations: r.invocations, limit_1048575: { code: refused.code, disposition: refused.disposition }, measures: expectMeasures("N02") } };
  });
  await rejectVector("V53-MEM-N12", "N12", "air.memory.region_bounds_static");
  await rejectVector("V53-MEM-N25", "N25", "air.memory.region_bounds_static");
  await vector("V53-MEM-N26", async () => {
    const r = await accepted(pinned("N26"), [["f", [-4], R34], ["f", [0], v(5)], ["f", [12], v(0)], ["f", [13], R34]], "n26");
    ctx.n26 = r;
    return { value: { "E(f)": expectE(r.built, "f", 7, 0, 0, 16), invocations: r.invocations, measures: expectMeasures("N26") } };
  });
  await vector("V53-MEM-N13", async () => ({ value: (await accepted(pinned("N26"), [["f", [13], R34]], "n13")).invocations }));
  await vector("V53-MEM-N27", async () => ({ value: (await accepted(pinned("N26"), [["f", [2147483645], R34], ["f", [2147483647], R34]], "n27")).invocations }));
  await vector("V53-MEM-N09", async () => {
    const r = await accepted(pinned("N09"), [["run", [], v(0)], ["run", [], v(0)]], "n09");
    // (ii) R2: one SDK instance, two calls (P8-R24): zeroing does not depend on freshness.
    const instance = await instantiateAirModule({ wasmBytes: inspectVerifiedTypedBuild(r.built).wasmBytes });
    const twice = [instance.exports.run(), instance.exports.run()];
    assert.deepEqual(twice, [0, 0], "N09 (ii): one instantiateAirModule instance, two calls");
    ctx.n09 = r;
    return { value: { "E(run)": expectE(r.built, "run", 7, 0, 0, 16), i: r.invocations, ii: twice, measures: expectMeasures("N09") } };
  });
  await vector("V53-MEM-P07", async () => {
    const r = await accepted(pinned("P07"), [["z", [], v(0)]], "p07");
    const ii = (await staticReject(pinned("P07ii"), "air.memory.region_bounds_static", lineOf("P07ii"))).outcome;
    return { value: { "E(z)": expectE(r.built, "z", 4), backing: expectBacking(r.built, 0, 0), ii, invocations: r.invocations, measures: expectMeasures("P07") } };
  });
  await vector("V53-MEM-N30", async () => {
    const r = await accepted(pinned("N30"), [["h", [-1], R34], ["h", [0], v(0)], ["h", [64], v(64)], ["h", [65], R34]], "n30");
    const fifth = (await staticReject(pinned("N30v"), "air.memory.region_bounds_static", lineOf("N30v"))).outcome;
    return { value: { "E(h)": expectE(r.built, "h", 11, 0, 0, 64), invocations: r.invocations, measures: expectMeasures("N30"), v: fifth } };
  });
  await rejectVector("V53-PIPE-05", "PIPE05", "air.memory.region_size_unsupported");
  await vector("V53-PIPE-03", async () => {
    const ast = typedV053(pinned("PIPE03"));
    const analysis = wb.analyzeVerifiedTypedModule(ast);
    assert.deepEqual(wb.canonicalSummary(analysis.entries.get("run").value), S(10485772, 0, 0, 83886080), "E(run)");
    const refused = await captureAsync(() => buildVerifiedTypedModule({ ...GATED, descriptor: descriptorOf(F.PIPE03), source: F.PIPE03 }));
    assert(refused && refused.code === "air.build.memory_backing_limit" && refused.disposition === "BUILD_REFUSED", String(refused && refused.message));
    assertNoRawError(refused.message, "PIPE-03");
    // Before lowering: with a WAT limit too small for any module the refusal is still the backing limit.
    const tiny = createVerifiedTypedRuntime({ admit: async () => true, limits: { maxWatBytes: 64 } });
    const runtime = await captureAsync(() => tiny.build({ ...GATED, descriptor: descriptorOf(F.PIPE03), source: F.PIPE03 }));
    assert(runtime && runtime.code === "air.build.memory_backing_limit", String(runtime && runtime.message));
    return { value: { "E(run)": S(10485772, 0, 0, 83886080), build: { code: refused.code, disposition: refused.disposition }, measures: expectMeasures("PIPE03"), refused_before_lowering: runtime.code, verdict: "VERIFIED" } };
  });
  await rejectVector("V53-MEM-WB07", "WB07", "air.workbound.unknown_bound");

  // §2.2 Views, buffers, literals
  await vector("V53-MEM-N05", async () => {
    const i = (await staticReject(pinned("N05"), "air.memory.region_bounds_static", lineOf("N05"))).outcome;
    const ii = (await accepted(pinned("N31"), [["k", [64], R34]], "n05ii")).invocations;
    return { value: { i, ii } };
  });
  await vector("V53-MEM-N31", async () => {
    const r = await accepted(pinned("N31"), [["k", [-1], R34], ["k", [0], v(0)], ["k", [16], v(16)], ["k", [17], R34]], "n31");
    return { value: { "E(k)": expectE(r.built, "k", 7, 0, 0, 16), invocations: r.invocations, measures: expectMeasures("N31") } };
  });
  await rejectVector("V53-MEM-N16", "N16", "air.memory.region_bounds_static");
  await vector("V53-MEM-P04", async () => {
    const r = await accepted(pinned("P04"), [["run", [], v(9)]], "p04");
    return { value: { "E(run)": expectE(r.built, "run", 9, 0, 0, 16), invocations: r.invocations, measures: expectMeasures("P04") } };
  });
  await vector("V53-MEM-N32", async () => {
    const r = await accepted(pinned("N32"), [["m", [-1, 1], R34], ["m", [0, -1], R34], ["m", [16, 0], v(0)], ["m", [17, 0], R34], ["m", [15, 1], v(1)],
      ["m", [16, 1], R34], ["m", [12, 4], v(4)], ["m", [12, 5], R34]], "n32");
    return { value: { "E(m)": expectE(r.built, "m", 8, 0, 0, 16), invocations: r.invocations, measures: expectMeasures("N32") } };
  });
  await vector("V53-MEM-N17", async () => ({ value: (await accepted(pinned("N32"), [["m", [2147483647, 2], R34]], "n17")).invocations }));
  await vector("V53-MEM-N33", async () => {
    const r = await accepted(pinned("N33"), [["q", [0], v(21)], ["q", [1], R34], ["q", [-1], R34], ["q", [2147483645], R34]], "n33");
    return { value: { "E(q)": expectE(r.built, "q", 9, 0, 0, 16), invocations: r.invocations, measures: expectMeasures("N33") } };
  });
  await rejectVector("V53-MEM-N04", "N04", "air.memory.region_bounds_static");
  await rejectVector("V53-MEM-N15", "N15", "air.memory.region_bounds_static");
  await vector("V53-MEM-P03", async () => {
    const r = await accepted(pinned("P03"), [["run", [], f32(1.5)]], "p03");
    return { value: { "E(run)": expectE(r.built, "run", 39, 0, 0, 256), invocations: r.invocations, measures: expectMeasures("P03") } };
  });
  await vector("V53-MEM-N28", async () => {
    const r = await accepted(pinned("N28"), [["g", [-1], R34], ["g", [0], v(0)], ["g", [3], v(9)], ["g", [4], R34]], "n28");
    const fifth = (await staticReject(pinned("N28v"), "air.memory.region_bounds_static", lineOf("N28v"))).outcome;
    return { value: { "E(g)": expectE(r.built, "g", 8, 0, 0, 16), invocations: r.invocations, measures: expectMeasures("N28"), v: fifth } };
  });
  await vector("V53-MEM-N29", async () => ({ value: (await accepted(pinned("N28"), [["g", [1073741824], R34], ["g", [1073741825], R34]], "n29")).invocations }));
  await rejectVector("V53-MEM-N35", "N35", "air.v051.type_reference_invalid");
  await rejectVector("V53-MEM-N10", "N10", "air.memory.readonly_data");
  await vector("V53-MEM-N24", async () => {
    const r = await accepted(pinned("N24"), [["run", [], v(2143289344)]], "n24");
    return { value: { "E(run)": expectE(r.built, "run", 8, 0, 0, 4), invocations: r.invocations, measures: expectMeasures("N24") } };
  });

  // §2.3 Liveness, noescape, ownership
  await rejectVector("V53-MEM-N03", "N03", "air.memory.region_not_live");
  await rejectVector("V53-MEM-N07", "N07", "air.abi.export_type_unsupported");
  await rejectVector("V53-MEM-N11", "N11", "air.abi.slice_return_unsupported");
  await vector("V53-MEM-P05", async () => {
    const r = await accepted(pinned("P05"), [["run", [], v(5)]], "p05");
    return { value: { "E(run)": expectE(r.built, "run", 12, 1, 0, 8), backing: expectBacking(r.built, 16, 16), invocations: r.invocations, measures: expectMeasures("P05") } };
  });
  await vector("V53-MEM-N19", async () => ({
    value: {
      i: (await staticReject(pinned("N19i"), "air.memory.view_escape", lineOf("N19i"))).outcome,
      ii: (await staticReject(pinned("N19ii"), "air.memory.view_escape", lineOf("N19ii"))).outcome
    }
  }));
  await vector("V53-MEM-N20", async () => ({
    value: {
      i: (await staticReject(pinned("N20i"), "air.memory.view_escape", lineOf("N20i"))).outcome,
      ii: (await staticReject(pinned("N20ii"), "air.memory.view_escape", lineOf("N20ii"))).outcome,
      // (iii) at the fold, before the step function's header at a later line: source order.
      iii: (await staticReject(pinned("N20iii"), "air.memory.view_escape", lineOf("N20iii"))).outcome
    }
  }));
  await rejectVector("V53-MEM-N21", "N21", "air.memory.free_not_owner");

  // §2.4 region_bytes and backing
  await vector("V53-MEM-WB01", async () => {
    const r = await accepted(pinned("WB01"), [["f", [], v(1)], ["h", [], v(0)]], "wb01");
    return { value: { "E(f)": expectE(r.built, "f", 37, 1, 0, 224), "E(h)": expectE(r.built, "h", 212, 10, 10, 128), backing: expectBacking(r.built, 224, 224), invocations: r.invocations, measures: expectMeasures("WB01") } };
  });
  await vector("V53-MEM-WB02", async () => {
    const r = await accepted(pinned("WB02"), [["run", [], v(3)]], "wb02");
    return { value: { "E(run)": expectE(r.built, "run", 2062, 2, 0, 8192), backing: expectBacking(r.built, 16384, 16384), invocations: r.invocations, measures: expectMeasures("WB02") } };
  });
  await vector("V53-MEM-WB03", async () => {
    const r = await accepted(pinned("WB03"), [["f", [], v(7)]], "wb03");
    return { value: { "E(f)": expectE(r.built, "f", 13, 0, 0, 64), invocations: r.invocations, measures: expectMeasures("WB03") } };
  });
  await vector("V53-MEM-WB04", async () => {
    const r = await accepted(pinned("WB04"), [["f", [], v(3)]], "wb04");
    return { value: { "E(f)": expectE(r.built, "f", 46, 2, 0, 224), backing: expectBacking(r.built, 240, 240), invocations: r.invocations, measures: expectMeasures("WB04") } };
  });
  await vector("V53-MEM-WB05", async () => {
    const r = await accepted(pinned("WB05"), [["f", [true], v(1)], ["f", [false], v(2)]], "wb05");
    return { value: { "E(f)": expectE(r.built, "f", 14, 0, 0, 96), invocations: r.invocations, measures: expectMeasures("WB05") } };
  });
  await vector("V53-MEM-WB06", async () => {
    const r = await accepted(pinned("WB06"), [["f", [], v(3)]], "wb06");
    const peaks = Object.fromEntries(["h", "g", "f"].map((name) => [name, wb.inspectBoundWorkBound(r.built).functions[name].region_bytes]));
    assert.deepEqual(peaks, { f: "112", g: "48", h: "16" }, "peak h 16, g 48, f 112");
    return { value: { "E(f)": expectE(r.built, "f", 26, 2, 0, 112), invocations: r.invocations, measures: expectMeasures("WB06"), peaks } };
  });
  await vector("V53-MEM-WB08", async () => {
    const r = await accepted(pinned("WB08"), [["run", [], v(10)]], "wb08");
    return { value: { "E(run)": expectE(r.built, "run", 162, 10, 10, 64), invocations: r.invocations, measures: expectMeasures("WB08") } };
  });
}

// The R-REF-9 registry as P0-03's A-1 table states it, with value 64 added by
// ABI-6 (b) / OD-P8-5 (SCOPE_AMENDMENT_3): V53-REF-N12's 14 parts.
const ADAPTER_TABLE = Object.freeze({
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
  51: { code: "air.decision.payload_lane_noncanonical" },
  64: { code: "air.borrow.air_owned_memory_overlap" }
});

async function buildTyped(source, extra = {}) {
  return buildVerifiedTypedModule({ ...GATED, descriptor: descriptorFor(source), source, ...extra });
}

// A raw call on a fresh instance of a non-borrowed build, mapped by the
// typed-v0.53 registry (the adapter's mapping).
function direct(built, name, lanes) {
  const instance = new WebAssembly.Instance(new WebAssembly.Module(built.wasmBytes), {});
  try {
    return { value: instance.exports[name](...lanes) };
  } catch (error) {
    assert(error instanceof WebAssembly.RuntimeError, `not a Wasm trap: ${error && error.stack}`);
    const identity = typedV053FailureIdentity(error, instance);
    observedFailures.push({ code: identity.code, kind: "RUNTIME_FAIL" });
    return { code: identity.code, failureReason: instance.exports.__air_failure_reason.value, ...(identity.reason ? { reason: identity.reason } : {}) };
  }
}

// One typed admission invocation (H-NEW, T1) of a borrowed-lane build.
async function admitted(built, request, prepare) {
  const handle = await admitTypedV053Artifact({ record: built, wasmBytes: built.wasmBytes });
  const instance = await handle.instantiate();
  const bindings = prepare ? prepare(instance.memory) : request.bindings;
  const result = instance.invoke({ ...request, bindings });
  if (result.diagnostics.length) observedFailures.push({ code: result.diagnostics[0].code, kind: "BINDING" });
  return { instance, outcome: outcomeOf(result), result };
}

async function sectionBorrowed() {
  // §2.5 The borrowed lane (P8-R13..P8-R16; the artifact contract of P8-R15)
  await vector("V53-MEM-P02", async () => {
    const r = await accepted(pinned("P02"), [], "p02");
    ctx.p02 = r;
    const src = new Uint8Array([1, 0, 0, 0, 0x2a, 0, 0, 0]);
    const dst = new Uint8Array(8);
    const { outcome } = await admitted(r.built, { arguments: { count: 2 }, bindings: { dst: bind(dst, "writeonly", 8, 4, "copied_into_wasm"), src: bind(src, "readonly", 8, 4, "copied_into_wasm") }, entrypoint: "copy_final" });
    assert.deepEqual(outcome, { value: 2 });
    assert.deepEqual([...dst.subarray(4)], [0x2a, 0, 0, 0], "dst bytes 4..7 = 2A 00 00 00");
    return { value: { "E(copy_final)": expectE(r.built, "copy_final", 7), dst: [...dst], measures: expectMeasures("P02"), outcome, owned_range: verifiedBuild.typedV053.readBorrowedLaneRecord(r.built).ownedRange } };
  });
  await vector("V53-MEM-N14", async () => {
    // The same module requested on the AIR ABI 0.12 candidate lane (a typed-interface descriptor).
    const source = pinned("P02");
    assert(!capture(() => typedV053(source)), "the source verifies; the lane is the build's");
    const outcomes = {};
    for (const [entrypoint, build] of [["builder", () => buildVerifiedTypedModule({ ...GATED, descriptor: descriptorOf(source), source })],
      ["runtime", () => runtimeHost.build({ ...GATED, descriptor: descriptorOf(source), source })]]) {
      const error = await captureAsync(build);
      assert(error, `${entrypoint}: no artifact`);
      assert.equal(error.code, "air.abi.borrowed_slice_requires_0_11", String(error.message));
      assert.equal(error.loc && error.loc.line, 3, `${entrypoint}: line 3`);
      assert(/0\.13/u.test(error.message), `${entrypoint}: the message names lane 0.13: ${error.message}`);
      outcomes[entrypoint] = { code: error.code, line: error.loc.line, message: String(error.message) };
    }
    observedFailures.push({ code: "air.abi.borrowed_slice_requires_0_11", kind: "STATIC_REJECT", line: 3 });
    return { value: outcomes };
  });
  await vector("V53-MEM-N08", async () => {
    const r = await accepted(pinned("N08"), [], "n08");
    ctx.n08 = r;
    // Over 4 bytes inside the region slot [16, 32): refused before invocation; no store ran (the host word stays).
    const inside = await admitted(r.built, { entrypoint: "peek" }, (memory) => ({ src: bind(viewAt(memory, 20, word(3)), "readonly", 4, 4) }));
    assert.deepEqual(inside.outcome, { code: "air.borrow.air_owned_memory_overlap" });
    assert.deepEqual([...new Uint8Array(inside.instance.memory.buffer, 16, 8)], [0, 0, 0, 0, 3, 0, 0, 0], "no module store executed");
    const disjoint = await admitted(r.built, { entrypoint: "peek" }, (memory) => ({ src: bind(viewAt(memory, 64, word(1234)), "readonly", 4, 4) }));
    assert.deepEqual(disjoint.outcome, { value: 1234 });
    return { value: { "E(peek)": expectE(r.built, "peek", 8, 0, 0, 16), disjoint: disjoint.outcome, inside_slot: inside.outcome, measures: expectMeasures("N08") } };
  });
  await vector("V53-MEM-P06", async () => {
    const r = await accepted(pinned("P06"), [], "p06");
    const host = new Uint8Array([...word(1), ...word(2), ...word(3)]);
    const { outcome } = await admitted(r.built, { bindings: { a: bind(host.subarray(0, 8), "readonly", 8, 4, "copied_into_wasm"), b: bind(host.subarray(4, 12), "readonly", 8, 4, "copied_into_wasm") }, entrypoint: "both" });
    assert.deepEqual(outcome, { value: 4 });
    return { value: { "E(both)": expectE(r.built, "both", 6), measures: expectMeasures("P06"), outcome } };
  });
  await vector("V53-MEM-N22", async () => {
    const r = await accepted(pinned("N22"), [], "n22");
    const host = new Uint8Array([...word(1), ...word(2), ...word(3)]);
    const { outcome } = await admitted(r.built, { bindings: { a: bind(host.subarray(0, 8), "readonly", 8, 4, "copied_into_wasm"), b: bind(host.subarray(4, 12), "readwrite", 8, 4, "copied_into_wasm") }, entrypoint: "pair" });
    assert.deepEqual(outcome, { code: "air.borrow.mutable_overlap" });
    return { value: { "E(pair)": expectE(r.built, "pair", 7), measures: expectMeasures("N22"), outcome } };
  });
  await vector("V53-MEM-N39", async () => {
    const r = await accepted(pinned("N39"), [], "n39");
    const host = () => new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x2a, 0, 0, 0]);
    const thirteen = await admitted(r.built, { arguments: { o: 13 }, bindings: { b: bind(host(), "readonly", 16, 4, "copied_into_wasm") }, entrypoint: "peek" });
    const twelve = await admitted(r.built, { arguments: { o: 12 }, bindings: { b: bind(host(), "readonly", 16, 4, "copied_into_wasm") }, entrypoint: "peek" });
    assert.deepEqual(thirteen.outcome, { code: "air.borrow.pointer_out_of_bounds" });
    assert.deepEqual(twelve.outcome, { value: 42 });
    // The raw trap: through $__air_borrow_failure, reason 0 (never 34 or trap_unclassified).
    const instance = rawInstance(r.built.wasmBytes);
    viewAt(instance.exports.memory, 64, host());
    const raw = rawCall(instance, "peek", [64, 16, 13]);
    assert(raw.borrowFrame && raw.reason === 0, JSON.stringify(raw));
    return { value: { "E(peek)": expectE(r.built, "peek", 3), measures: expectMeasures("N39"), o12: twelve.outcome, o13: thirteen.outcome, raw_trap: raw } };
  });
  await vector("V53-MEM-N23", async () => {
    // The N38 harness: a verified build record and a module with matching digests (builder-defect seam).
    const n08 = ctx.n08.built;
    const out = {};
    for (const [label, kind] of [["a", "F-NORANGE"], ["b", "F-ENDLOW"]]) {
      const bytes = await forge(ctx.n08.wat, kind);
      const record = verifiedBuild.typedV053.mintHarnessRecord({ from: n08, wasmBytes: bytes });
      const handle = await admitTypedV053Artifact({ record, wasmBytes: bytes });
      const error = await captureAsync(() => handle.instantiate());
      assert(error && error.code === "air.borrow.air_memory_layout_unknown" && error.step === 3, String(error && error.message));
      observedFailures.push({ code: error.code, kind: "BINDING" });
      out[label] = { code: error.code, step: error.step };
    }
    return { value: out };
  });
  for (const [id, kind] of [["V53-MEM-N36", "F-EMPTY"], ["V53-MEM-N37", "F-UNDER"]]) {
    await vector(id, async () => {
      const bytes = await forge(ctx.n08.wat, kind);
      const error = await captureAsync(() => admitTypedV053Artifact({ record: ctx.n08.built, wasmBytes: bytes }));
      assert(error && error.code === "air.borrow.module_identity_mismatch" && error.step === 1, String(error && error.message));
      observedFailures.push({ code: error.code, kind: "BINDING" });
      return { value: { code: error.code, forged: kind, step: error.step } };
    });
  }
  await vector("V53-MEM-N38", async () => {
    const n08 = ctx.n08.built;
    const a = await captureAsync(async () => (await admitTypedV053Artifact({ record: verifiedBuild.typedV053.mintHarnessRecord({ from: n08, ownedRange: { end: 24, start: 16 } }), wasmBytes: n08.wasmBytes })).instantiate());
    const emptyBytes = await forge(ctx.n08.wat, "F-EMPTY");
    const b = await captureAsync(async () => (await admitTypedV053Artifact({ record: verifiedBuild.typedV053.mintHarnessRecord({ from: n08, ownedRange: { end: 32, start: 16 }, wasmBytes: emptyBytes }), wasmBytes: emptyBytes })).instantiate());
    for (const error of [a, b]) assert(error && error.code === "air.borrow.air_memory_layout_unknown" && error.step === 3, String(error && error.message));
    // (c) V53-MEM-N39's module: recorded and exported ranges both empty: accepted.
    const n39 = acceptedSources.get("n39").built;
    assert.deepEqual({ ...verifiedBuild.typedV053.readBorrowedLaneRecord(n39).ownedRange }, { end: 16, start: 16 });
    const c = await admitted(n39, { arguments: { o: 12 }, bindings: { b: bind(new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 7, 0, 0, 0]), "readonly", 16, 4, "copied_into_wasm") }, entrypoint: "peek" });
    assert.deepEqual(c.outcome, { value: 7 });
    return { value: { a: { code: a.code, step: a.step }, b: { code: b.code, step: b.step }, c: c.outcome } };
  });

  // §3 New rows
  await vector("V53-MEM-P08", async () => {
    const out = pinned("P08out");
    const once = sp.formatSource(typedV053(pinned("P08in")), GATED);
    assert.equal(once, out, "format(in) is the pinned canonical output");
    assert.equal(sp.formatSource(typedV053(out), GATED), out, "format(out) == out");
    const runs = {};
    for (const key of ["P08in", "P08out"]) {
      const r = await accepted(F[key], [["run", [4], v(42)], ["run", [0], R34]], key.toLowerCase());
      runs[key] = { "E(run)": expectE(r.built, "run", 15, 1, 0, 64), invocations: r.invocations, measures: expectMeasures(key) };
    }
    return { value: { formatted_sha256: hexOf(once), runs } };
  });
  await vector("V53-MEM-P09", async () => {
    const r = await accepted(pinned("P09"), [["raw", [], v(-4194303)], ["run", [], v(2134900736)]], "p09");
    return { value: { "E(raw)": expectE(r.built, "raw", 7, 0, 0, 4), "E(run)": expectE(r.built, "run", 20, 0, 0, 16), backing: expectBacking(r.built, 32, 32), invocations: r.invocations, measures: expectMeasures("P09") } };
  });
  const N40 = [["i", "air.v051.typed_syntax_invalid"], ["ii", "air.numeric.operation_invalid"], ["iii", "air.v051.typed_syntax_invalid"],
    ["iv", "air.numeric.operation_invalid"], ["v", "air.v051.type_reference_invalid"], ["vi", "air.memory.view_escape"], ["vii", "air.memory.view_escape"],
    ["viii", "air.state.cell_type_invalid"], ["ix", "air.workbound.invalid_bound"], ["x", "air.memory.region_size_unsupported"],
    ["xi", "air.memory.region_size_unsupported"], ["xii", "air.abi.export_type_unsupported"], ["xiii", "air.memory.region_bounds_static"],
    ["xiv", "air.numeric.operation_invalid"]];
  await vector("V53-MEM-N40", async () => {
    const value = {};
    for (const [tag, code] of N40) value[tag] = (await staticReject(pinned(`N40${tag}`), code, lineOf(`N40${tag}`))).outcome;
    const ix = await accepted(pinned("N40ixc"), [], "n40ixc");
    const xi = await accepted(pinned("N40xic"), [["h", [16777216], v(16777216)], ["h", [0], v(0)]], "n40xic");
    value.ix_control = { verdict: "VERIFIED", measures: expectMeasures("N40ixc"), built: Boolean(ix.built) };
    value.xi_control = { "E(h)": expectE(xi.built, "h", 2097156, 0, 0, 16777216), invocations: xi.invocations, measures: expectMeasures("N40xic") };
    return { value };
  });
  const N41 = [["i", "air.memory.region_leak"], ["ii", "air.memory.region_not_live"], ["iii", "air.memory.region_not_live"], ["iv", "air.memory.region_not_live"],
    ["v", "air.borrow.free_forbidden"], ["vi", "air.memory.view_escape"], ["vii", "air.memory.region_leak"], ["viii", "air.memory.view_escape"]];
  await vector("V53-MEM-N41", async () => {
    const value = {};
    for (const [tag, code] of N41) value[tag] = (await staticReject(pinned(`N41${tag}`), code, lineOf(`N41${tag}`))).outcome;
    const ic = await accepted(pinned("N41ic"), [["f", [true], v(1)], ["f", [false], v(2)]], "n41ic");
    const viic = await accepted(pinned("N41viic"), [["f", [true], v(8)], ["f", [false], v(0)]], "n41viic");
    value.i_control = { "E(f)": expectE(ic.built, "f", 8, 0, 0, 16), invocations: ic.invocations, measures: expectMeasures("N41ic") };
    value.vii_control = { "E(f)": expectE(viic.built, "f", 9, 0, 0, 8), backing: expectBacking(viic.built, 16, 16), invocations: viic.invocations, measures: expectMeasures("N41viic") };
    return { value };
  });
  await vector("V53-MEM-N42", async () => {
    const value = {};
    for (const [tag, expected, summary] of [["i", 1, [22, 2, 2]], ["ii", 0, [18, 2, 0]]]) {
      const r = await accepted(pinned(`N42${tag}`), [["run", [], v(expected)]], `n42${tag}`);
      // Both hold on a reused instance too (P8-R24).
      const instance = await instantiateAirModule({ wasmBytes: inspectVerifiedTypedBuild(r.built).wasmBytes });
      const reused = [instance.exports.run(), instance.exports.run()];
      assert.deepEqual(reused, [expected, expected], `N42 (${tag}): one instance, two calls`);
      value[tag] = { "E(run)": expectE(r.built, "run", ...summary, 16), backing: expectBacking(r.built, 16, 16), invocations: r.invocations, measures: expectMeasures(`N42${tag}`), reused };
    }
    ctx.n42 = value;
    return { value };
  });
  await vector("V53-MEM-P10", async () => {
    const r = await accepted(pinned("P10"), [], "p10");
    ctx.p10 = r;
    const host = new Uint8Array([0x11, 0x22, 0x33, 0x44]);
    const { outcome } = await admitted(r.built, { bindings: { dst: bind(host, "writeonly", 4, 4, "copied_into_wasm") }, entrypoint: "put" });
    assert.deepEqual(outcome, { value: 0 });
    assert.deepEqual([...host], [0, 0, 0xc0, 0x7f], "the host buffer holds the canonical NaN 0x7fc00000");
    assert(/i32\.const 64\n {4}global\.set \$__air_failure_reason/u.test(r.wat), "the guard is emitted (BASE 16 < END 32)");
    return { value: { "E(put)": expectE(r.built, "put", 10, 0, 0, 4), backing: expectBacking(r.built, 16, 16), guard: true, host: [...host], measures: expectMeasures("P10"), outcome } };
  });
  await vector("V53-MEM-P11", async () => {
    const r = await accepted(pinned("P11"), [["run", [], v(5)]], "p11");
    const at160 = await buildTyped(F.P11, { memoryBackingLimit: 160 });
    assert.equal((await invokeVerifiedTypedExport(at160, "run", [])).value, 5, "limit 160 builds, run() = 5");
    const at159 = await captureAsync(() => buildTyped(F.P11, { memoryBackingLimit: 159 }));
    assert(at159 && at159.code === "air.build.memory_backing_limit" && at159.disposition === "BUILD_REFUSED", String(at159 && at159.message));
    assertNoRawError(at159.message, "P11 limit 159");
    return { value: { "E(run)": expectE(r.built, "run", 19, 0, 0, 100), backing: expectBacking(r.built, 160, 112), invocations: r.invocations, limit_159: { code: at159.code, disposition: at159.disposition }, limit_160: 5, measures: expectMeasures("P11") } };
  });
  await vector("V53-MEM-P11 (ii)", async () => {
    // AD-8: carrier A of OD-P7-6 (a) (P0-07 exact-SHA QA F-1).
    const r = await accepted(pinned("P11ii"), [["run", [], v(7)], ["run", [], v(7)]], "p11ii");
    const instance = await instantiateAirModule({ wasmBytes: inspectVerifiedTypedBuild(r.built).wasmBytes });
    const reused = [instance.exports.run(), instance.exports.run()];
    assert.deepEqual(reused, [7, 7], "one instantiateAirModule instance, two calls");
    return { value: { "E(run)": expectE(r.built, "run", 24, 0, 0, 100), backing: expectBacking(r.built, 160, 112), invocations: r.invocations, measures: expectMeasures("P11ii"), reused } };
  });
  await vector("V53-MEM-N06", () => ({ status: "DEFERRED", value: { first_executable: "P0-10" } }));
  await vector("V53-MEM-N34", () => ({ status: "DEFERRED", value: { first_executable: "P0-10" } }));
  await vector("V53-REF-N12@P0-08", async () => {
    // COMPOSITE (owner condition (1)): 14 parts, every one run here; part 34
    // is first executable here (V53-MEM-N26's f(13) through the adapter),
    // part 64 too (V53-ABI-36's guard trap).
    // The raw parts need no descriptor: the verified AST's own lowering.
    const T = async (items) => ({ wasmBytes: Buffer.from(await watToWasm(lowerToWat(typedV053(mod(M, ...items)), { maxWatBytes: MAX_WAT }), "ref.air")) });
    const fx = (header, body) => func(header, body);
    const parts = {
      1: direct(await T([fx("export func f(a: i32, b: i32) -> i32", ["%o: i32 = i32.checked_add %a, %b", "return %o"])]), "f", [2147483647, 1]),
      2: direct(await T([fx("export func f(a: i32, b: i32) -> i32", ["%o: i32 = i32.checked_div_s %a, %b", "return %o"])]), "f", [1, 0]),
      3: direct(await T([fx("export func f(x: f32) -> i32", ["%o: i32 = f32.trunc_to_i32_checked %x", "return %o"])]), "f", [Number.NaN]),
      16: direct(await T([fx("export func g(x: i32<0..10>) -> i32", ["return %x"])]), "g", [11]),
      17: direct(await T([fx("export func r(x: i32) -> i32", ["%y: i32<0..10> = %x", "return %y"])]), "r", [11]),
      32: direct(await T([fx("func s(acc: i32) -> i32", ["return %acc"]), fx("export func run(n: i32) -> i32", ["%r: i32 = loop.fold @s, 0, %n max 4", "return %r"])]), "run", [5]),
      33: direct(await T([["table t: i32[2] = [1, 2]"], fx("export func get(i: i32) -> i32", ["%v: i32 = table.get t, %i", "return %v"])]), "get", [2]),
      34: await invocationOutcome(() => invokeVerifiedTypedExport(ctx.n26.built, "f", [13])),
      35: direct(await T([fx("export func a(i: i32) -> i32", ["%arr: array<i32,2> = array.new 1, 2", "%v: i32 = array.get %arr, %i", "return %v"])]), "a", [2]),
      48: direct(await T([fx("enum Mode", ["off = 1,", "on = 2,"]), fx("export func f(m: v53.mem::Mode) -> i32", ["return 1"])]), "f", [7]),
      49: direct(await T([fx("export func f(x: option<i32>) -> i32", ["return 1"])]), "f", [2, 0]),
      50: direct(await T([fx("export func f(x: bool) -> i32", ["return 1"])]), "f", [2]),
      51: direct(await T([fx("export func f(x: option<i32>) -> i32", ["return 1"])]), "f", [0, 5])
    };
    const t53 = await buildTyped(pinned("T53"));
    const guard = (await (await admitTypedV053Artifact({ record: t53, wasmBytes: t53.wasmBytes })).instantiate()).invokeRaw("f", [16, 4]);
    parts[64] = { code: guard.diagnostics[0].code, failureReason: 64 };
    const partResults = {};
    for (const [value, outcome] of Object.entries(parts)) {
      const entry = ADAPTER_TABLE[value];
      const expected = { code: entry.code, failureReason: Number(value), ...(entry.reason ? { reason: entry.reason } : {}) };
      assert.deepEqual(outcome, expected, `part ${value}`);
      partResults[value] = { outcome, status: "PASS" };
    }
    assert.equal(Object.keys(partResults).length, 14, "14 parts");
    const identities = Object.values(parts).map((item) => `${item.code}/${item.reason || ""}`);
    assert.equal(new Set(identities).size, 14, "pairwise distinct identities");
    return { value: { kind: "COMPOSITE", parts: partResults } };
  });
}

// ---------------------------------------------------------------------------
// The slice checks: P0-08-CHECK-MEM, -CHECK-CT1, -CHECK-EXPORTS, -SEP-WB.
const CHECK_SET = Object.freeze({ N26: "n26", N28: "n28", N31: "n31", N32: "n32", N33: "n33", P01: "p01", P03: "p03", P04: "p04", P09: "p09", P10: "p10" });
const removeFill = (wat) => wat.replace(/\n(\s*)memory\.fill/gu, "\n$1drop\n$1drop\n$1drop");

async function sectionChecks(checkMem) {
  await vector("P0-08-CHECK-MEM", async () => {
    // Parts 1-2: every memory statement of the check set.
    const part2 = {};
    const samples = {};
    for (const [key, label] of Object.entries(CHECK_SET)) {
      const r = acceptedSources.get(label);
      assert(r, `${key} ran`);
      assert.equal(r.source, F[key], `${key}: the pinned text`);
      for (const [name, statements] of sourceFunctions(r.source)) {
        const types = sourceTypes(r.source, name);
        for (const segment of statementSegments(r.wat, name, statements)) {
          if (segment.ingress || !MEMORY_STATEMENT.test(segment.statement)) continue;
          const problems = /alloc_region/u.test(segment.statement) ? classifyZeroing(segment.lines) : classifyMemory(segment.lines, segment.statement, types);
          assert.deepEqual(problems, [], `${key} ${name}: '${segment.statement}'`);
          part2[`${key}:${name}:${segment.statement}`] = segment.lines;
          if (!samples.load && /= load\.i32 %p, 12$/u.test(segment.statement)) samples.load = segment.lines;
          if (!samples.alloc && /alloc_region 16$/u.test(segment.statement)) samples.alloc = segment.lines;
        }
      }
    }
    // Part 3: one fill per site in every module built here; none without a site.
    const part3 = {};
    for (const [label, r] of acceptedSources) {
      const fills = (r.wat.match(/^\s*memory\.fill$/gmu) || []).length;
      const sites = (r.source.match(/\balloc_region\b/gu) || []).length;
      assert.equal(fills, sites, `${label}: one memory.fill per alloc_region site`);
      part3[label] = { fills, sites };
    }
    // Part 4: the per-access instruction list across extents, extent immediates aside.
    const extentPairs = new Set(["16/65536", "4/16384"]);
    const sequenceOf = (r, fn, needle) => statementSegments(r.wat, fn, sourceFunctions(r.source).get(fn)).find((segment) => segment.statement.endsWith(needle)).lines;
    const pairs = {};
    for (const [tag, left, right, fn, needle, energies] of [
      ["a", ["N26", "n26"], ["N26twin", "n26twin"], "f", "load.i32 %p, %o", [[7, 16], [8197, 65536]]],
      ["b", ["CM4b", "cm4b"], ["CM4btwin", "cm4btwin"], "g", "buffer.load %b, %i", [[8, 16], [8198, 65536]]],
      ["c", ["CM4c", "cm4c"], ["CM4ctwin", "cm4ctwin"], "k", "slice.load.i32 %s, %o", [[8, 16], [8198, 65536]]]]) {
      const runs = [];
      for (const [key, label] of [left, right]) runs.push(acceptedSources.get(label) || await accepted(pinned(key), [], label));
      runs.forEach((r, index) => expectE(r.built, fn, energies[index][0], 0, 0, energies[index][1]));
      const [a, b] = runs.map((r) => sequenceOf(r, fn, needle));
      assert.equal(a.length, b.length, `${tag}: same instruction count`);
      a.forEach((line, index) => {
        if (line === b[index]) return;
        const x = /^i32\.const (\d+)$/u.exec(line);
        const y = /^i32\.const (\d+)$/u.exec(b[index]);
        assert(x && y && extentPairs.has(`${x[1]}/${y[1]}`), `${tag}: '${line}' vs '${b[index]}' differ beyond an extent immediate`);
      });
      pairs[tag] = { instructions: a.length, statement: needle };
    }
    const twin = await accepted(pinned("N26twin"), [["f", [65532], v(0)], ["f", [65533], R34]], "n26twin_run");
    // Part 5: discriminating controls on real sequences.
    const controls = {
      loop: [...samples.load.slice(0, -1), "loop", "end", ...samples.load.slice(-1)],
      compare_chain: [...samples.load.slice(0, -1), "local.get $o", "i32.const 0", "i32.eq", "br_if 0", "local.get $o", "i32.const 4", "i32.eq", "br_if 0", ...samples.load.slice(-1)],
      memory_copy: [...samples.load.slice(0, -1), "i32.const 0", "i32.const 0", "i32.const 4", "memory.copy", ...samples.load.slice(-1)],
      extra_call: [...samples.load.slice(0, -1), "call $__air_v051_invalid_tag", ...samples.load.slice(-1)],
      second_access: [...samples.load.slice(0, -1), "i32.load", "drop", ...samples.load.slice(-1)]
    };
    const rejected = {};
    for (const [name, sequence] of Object.entries(controls)) {
      const problems = classifyMemory(sequence, "%v: i32 = load.i32 %p, 12");
      assert(problems.length > 0, `control ${name} must be rejected`);
      rejected[name] = problems[0];
    }
    const noFill = samples.alloc.filter((line) => line !== "memory.fill");
    assert(classifyZeroing(noFill).length > 0, "control fill_removed must be rejected");
    rejected.fill_removed = classifyZeroing(noFill)[0];
    // The fill removed in the artifact: N42 (i) 100, (ii) 99, N09 (ii) 41 on its second call.
    const unfilled = async (key) => rawInstance(Buffer.from(await watToWasm(removeFill(lowerToWat(typedV053(F[key]), { maxWatBytes: MAX_WAT })), `${key}.air`)));
    const behaviour = { n09_ii: [], n42_i: (await unfilled("N42i")).exports.run(), n42_ii: (await unfilled("N42ii")).exports.run() };
    const n09 = await unfilled("N09");
    behaviour.n09_ii = [n09.exports.run(), n09.exports.run()];
    assert.deepEqual(behaviour, { n09_ii: [0, 41], n42_i: 100, n42_ii: 99 }, "the fill-removed control changes N42 (i), (ii) and N09 (ii)");
    Object.assign(checkMem, { controls: rejected, fill_removed_behaviour: behaviour, pairs, part2, part3, twin: twin.invocations });
    return { value: { controls: rejected, fill_removed_behaviour: behaviour, pairs, part1_2_statements: Object.keys(part2).length, part3_modules: Object.keys(part3).length, twin: twin.invocations } };
  });
  await vector("P0-08-CHECK-CT1", () => {
    // The CT-1 identity P0-08-MEM-1 (OD-P8-1 (a), AD-1).
    const file = path.join(ROOT, "src", "workbound_cost_table_v1.json");
    const blob = childProcess.spawnSync("git", ["hash-object", file], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
    const bytes = fs.readFileSync(file);
    const table = JSON.parse(bytes.toString("utf8"));
    assert.equal(blob, "4a5c2055b761e223173cbe8fc225191854d0eec2");
    assert.equal(sha256(bytes), "sha256:4f9b6ea3f84cd077e13c279a65f8862991b0d03cb5c8a3018de6f08880133c87");
    assert.equal(bytes.length, 7253);
    assert.equal(wb.COST_TABLE_DIGEST, "sha256:e12c77da26fdf47dedde297ea79f3a0790580a1be0ee7031f936472f1cb56a53");
    assert.equal(table.revision, "P0-08-MEM-1");
    assert.equal(table.rows.length, 28);
    const row = (construct) => {
      const found = table.rows.find((item) => item.construct === construct);
      assert(found, `${construct} row`);
      const { ct1, ...weights } = found;
      return weights;
    };
    const weights = {
      "ingress.borrowed_alias": row("ingress.borrowed_alias"), "ingress.borrowed_slice": row("ingress.borrowed_slice"), "memory.access": row("memory.access"),
      "memory.alloc": row("memory.alloc"), "memory.f32_canonical": row("memory.f32_canonical"), "memory.view": row("memory.view")
    };
    const one = { calls: "0", iterations: "0", steps: "1" };
    for (const name of ["ingress.borrowed_alias", "ingress.borrowed_slice", "memory.access", "memory.f32_canonical", "memory.view"]) assert.deepEqual({ ...weights[name] }, { construct: name, ...one });
    assert.deepEqual({ ...weights["memory.alloc"] }, { construct: "memory.alloc", ...one, steps_per_8_bytes: "1" }, "memory.alloc = 1 + ceil(B/8)");
    const access = table.rows.find((item) => item.construct === "aggregate.access");
    assert.match(access.ct1, /state\.get, state\.set/u, "aggregate.access names state.get and state.set (the P0-07 binding note)");
    let base = null;
    for (const commit of BASE_COMMITS) {
      const shown = childProcess.spawnSync("git", ["show", `${commit}:src/workbound_cost_table_v1.json`], { cwd: ROOT, encoding: null });
      if (shown.status === 0) { base = { bytes: shown.stdout, commit }; break; }
    }
    assert(base, "the base CT-1 is readable from git objects");
    const baseTable = JSON.parse(base.bytes.toString("utf8"));
    assert(!bytes.equals(base.bytes) && baseTable.revision === "P0-06-AGG-1" && baseTable.rows.length === 22, "the base's CT-1 is P0-06-AGG-1 (22 rows)");
    const loader = fs.readFileSync(path.join(ROOT, "src", "workbound.js"), "utf8");
    assert(loader.includes("(CT-1 revision P0-08-MEM-1)") && !loader.includes("(CT-1 revision P0-06-AGG-1)"), "the loader comment names P0-08-MEM-1 (P8-R29)");
    assert(loader.includes("\"steps_per_8_bytes\""), "the loader admits steps_per_8_bytes");
    return { value: { base_commit: base.commit, blob, bytes: bytes.length, cost_table_digest: wb.COST_TABLE_DIGEST, raw_sha256: sha256(bytes), revision: table.revision, rows: table.rows.length, weights } };
  });
  await vector("P0-08-CHECK-EXPORTS", () => {
    // No memory, region or literal export from an artifact without a borrowed
    // export; a borrowed-lane artifact exports exactly memory, the marker and
    // the owned range besides its functions (P8-R15, P8-R23).
    const value = {};
    for (const [label, r] of acceptedSources) {
      const module = new WebAssembly.Module(r.built.wasmBytes);
      const exportsOf = WebAssembly.Module.exports(module).map((item) => `${item.kind}:${item.name}`).sort();
      const functions = r.ast.functions.filter((fn) => fn.exported).map((fn) => `function:${fn.name}`);
      const imports = WebAssembly.Module.imports(module).map((item) => `${item.module}.${item.name}:${item.kind}`);
      if (borrowedLane(r.source)) {
        assert.deepEqual(exportsOf, [...functions, "global:__air_abi_feature_typed_memory_v1", "global:__air_failure_reason", "global:__air_owned_memory_base", "global:__air_owned_memory_end", "memory:memory"].sort(), `${label}: exports`);
        assert.deepEqual(imports, ["air:contract.typed-v0.53.v1:function"], `${label}: the one contract import`);
      } else {
        assert.deepEqual(exportsOf, [...functions, "global:__air_failure_reason"].sort(), `${label}: exports`);
        assert.deepEqual(imports, [], `${label}: no import`);
      }
      value[label] = exportsOf;
    }
    assert(Object.keys(value).length >= 40, "every P0-08 module built here");
    return { value };
  });
  await vector("P0-08-CHECK-FLAGS", () => {
    // EXPORTED_RAW_PTR=false: no export of a built module takes or returns a
    // ptr, slice or buffer (N07, N11, N40 (xii) are refused); VIEW_ESCAPE_ADMITTED=false
    // (N19, N20, N40 (vi), (vii), N41 (vi), (viii) are refused);
    // OWNED_RANGE_EXPORTED=true, metadata only (A1).
    for (const [label, r] of acceptedSources) {
      for (const fn of r.ast.functions.filter((item) => item.exported)) {
        for (const type of [...fn.params.map((parameter) => parameter.type), fn.returnType]) assert(!/^(?:ptr|slice|buffer<)/u.test(type), `${label}: export ${fn.name} carries ${type}`);
      }
    }
    return { value: { EXPORTED_RAW_PTR: false, OWNED_RANGE_EXPORTED: "true (metadata only; A1)", QA_STATUS: "AWAITING_INDEPENDENT_EXACT_SHA_QA", VIEW_ESCAPE_ADMITTED: false } };
  });

  // P0-08-SEP-WB (slice text P8-R28).
  await vector("P0-08-SEP-WB", () => {
    const texts = new Map();
    for (const key of Object.keys(PINS)) if (key !== "F1B") texts.set(hexOf(F[key]), F[key]);
    const corpusShas = [...texts.keys()].sort();
    assert.equal(corpusShas.length, 90, "89 distinct fixture texts and carrier A");
    assert.deepEqual(corpusShas, [...SEP_CORPUS_SHA256], "the corpus is exactly the listed sha256 set");
    const label = new Map(Object.entries(PINS).map(([key, [, digest]]) => [digest, key]));
    const dir = path.join(tmp, "sep08");
    fs.mkdirSync(dir);
    const corpusFile = path.join(dir, "corpus.jsonl");
    fs.writeFileSync(corpusFile, `${corpusShas.map((digest) => JSON.stringify({ options: GATED, sha256: digest, source: texts.get(digest) })).join("\n")}\n`);
    const compareScript = path.join(dir, "compare.js");
    fs.writeFileSync(compareScript, SEP_COMPARE);
    const compare = (srcDir) => {
      const out = childProcess.spawnSync(process.execPath, [compareScript, srcDir, corpusFile], {
        cwd: dir, encoding: "utf8", env: { ...process.env, NODE_PATH: path.join(ROOT, "node_modules") }, killSignal: "SIGKILL", maxBuffer: 256 * 1024 * 1024, timeout: 600000
      });
      assert(!out.error && out.signal === null && out.status === 0, `compare: ${out.stderr || out.error}`);
      return JSON.parse(out.stdout);
    };
    const firstDifference = (behaviour) => {
      const item = behaviour.differences[0];
      return item ? { mode: item.mode, real: item.got.real, source: label.get(item.sha256) || item.sha256, stubbed_or_disabled: item.got[item.mode] } : null;
    };
    // The texts the generator measures (its ACCEPT fixtures) verify: 46 distinct.
    const accepts = new Set(Object.keys(MEASURES).filter((key) => key !== "F1B").map((key) => hexOf(F[key])));
    const behaviour = compare(path.join(ROOT, "src"));
    assert.deepEqual(behaviour.budgetOrGrantExports, [], "no verifier export accepts or returns a Budget or grant");
    assert.equal(behaviour.counts.sources, 90);
    assert.equal(behaviour.counts.workSources, 0, "no corpus text declares work: the stub perturbs every dimension");
    assert.equal(behaviour.counts.verified, accepts.size, `the ${accepts.size} texts the generator measures verify in real mode`);
    assert.equal(behaviour.counts.phaseRejections, 2, "two phase rejections (WB07, N40 (ix))");
    assert.equal(behaviour.differenceCount, 0, `WorkBound changed a verdict: ${JSON.stringify(behaviour.differences, null, 2).slice(0, 4000)}`);
    assert.equal(behaviour.watDifferenceCount, 0, `WorkBound changed lowered code: ${JSON.stringify(behaviour.watDifferences)}`);
    assert.equal(behaviour.counts.loweredInEveryMode, accepts.size, "every verified text lowers");
    for (const key of ["WB07", "N40ix"]) {
      const phase = capture(() => typedV053(F[key]));
      assert(phase && PHASE_P08.includes(phase.code), `${key} is a phase rejection`);
    }
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
      fs.rmSync(scratch, { force: true, recursive: true });
      const sources = [...new Set(mutated.differences.map((item) => `${label.get(item.sha256) || item.sha256} (${item.mode})`))].sort();
      const watSources = [...new Set(mutated.watDifferences.map((item) => `${label.get(item.sha256) || item.sha256} (${item.mode})`))].sort();
      controls[name] = { description: mutant.description, differences: mutated.differenceCount, first_difference: firstDifference(mutated), sources, wat_differences: mutated.watDifferenceCount, wat_sources: watSources };
    }
    for (const name of ["C2", "C3", "C4", "C7"]) assert(controls[name].differences > 0, `${name} (${MUTANTS[name].description}) must make P0-08-SEP-WB fail`);
    assert(controls.C7.sources.includes("P01 (stubbed)"), "C7 is caught at V53-MEM-P01 by the stubbed comparison");
    assert.equal(controls.C8.differences, 0, "C8 changes no verdict");
    assert(controls.C8.wat_sources.includes("P01 (stubbed)"), "C8 is caught by the WAT comparison at V53-MEM-P01 (stubbed)");
    return {
      value: {
        PHASE_P08,
        controls,
        corpus: { count: corpusShas.length, sha256_set_digest: sha256(corpusShas.join("\n")), sorted_sha256: corpusShas },
        coverage: behaviour.counts,
        differences: 0,
        modes: { disabled: "empty status ok analysis", real: "analyzeVerifiedTypedModule", stubbed: "+7919 steps, +13 calls, +17 iterations on every ok summary; region_bytes not perturbed (item 2)" },
        thresholds: P08_MAXIMA,
        verified_asts_unchanged: behaviour.unchangedAsts,
        wat_differences: 0
      }
    };
  });
}

// ---------------------------------------------------------------------------
// The ABI rows (VECTORS_ADDITIONS.md §4.2; ABI-1 (A); AD-7). Every artifact
// is pinned (§4.1); "5 / 777": the host writes 5 at the bound range before
// the call, 777 means ART-T53's region store ran over it.
const PKG = `sha256:${"a".repeat(64)}`;
// The legacy binding case of the proposal's probe (compat_probe.js
// `sdkCase`), on any host: instantiate, write 5 at the view, invoke.
const LEGACY_CASE = `
  const host = { instantiateAirModule: sdk.instantiateAirModule, invokeBorrowedMemory: sdk.invokeBorrowedMemory };
  let inst;
  try { inst = await host.instantiateAirModule({ wasmBytes: input.bytes, packageDigest: input.pkg }); }
  catch (e) { return { class: "INSTANTIATE_REJECTED", error: { message: String(e.message), name: e.name } }; }
  const memory = inst.exports.memory;
  let view;
  if (input.mode === "wasm_memory_view") { view = new Uint8Array(memory.buffer, input.offset, 4); new DataView(memory.buffer).setInt32(input.offset, 5, true); }
  else { view = new Uint8Array(4); new DataView(view.buffer).setInt32(0, 5, true); }
  const opts = { instance: inst, interfaceDescriptor: input.descriptor, packageDigest: input.pkg, entrypoint: "f", arguments: {},
    bindings: { src: { buffer: view, access: "readonly", maxLength: 4, alignment: 4, aliasGroup: "in", memoryDomain: "wasm-linear", transferMode: input.mode } } };
  if (input.moduleDigest) opts.moduleDigest = input.moduleDigest;
  let r;
  try { r = host.invokeBorrowedMemory(opts); } catch (e) { return { class: "RAW_THROW", error: { message: String(e.message), name: e.name } }; }
  const after = input.mode === "wasm_memory_view" ? new DataView(memory.buffer).getInt32(input.offset, true) : new DataView(view.buffer).getInt32(0, true);
  const codes = (r.diagnostics || []).map((d) => d.code);
  return { class: codes.length ? "REJECT:" + codes.join(",") : (after === 777 ? "UNPROTECTED_MUTATED" : "RAN_NOT_MUTATED"), codes, hostReadonlyAfter: after, result: r.result };
`;
const legacyCaseHere = new Function("sdk", "input", `return (async () => {${LEGACY_CASE}})();`);
async function legacyCase(where, bytes, descriptor, options = {}) {
  const input = { descriptor, mode: options.mode || "wasm_memory_view", moduleDigest: options.moduleDigest, offset: options.offset === undefined ? 1024 : options.offset, pkg: PKG };
  if (where === "H-NEW") return legacyCaseHere(air, { ...input, bytes: Buffer.from(bytes) });
  return runOld(where, `const sdk = src("sdk.js");${LEGACY_CASE}`, { ...input, bytesHex: hexBytes(bytes) }).out;
}

// ART-L521 / ART-L520: the probe source built by the 0.52.1 / 0.52.0
// compiler, as the proposal's probe builds it.
const legacyBuilds = new Map();
function legacyBuild(version) {
  if (!legacyBuilds.has(version)) {
    const { commit, out } = runOld(version, `
      const index = src("index.js");
      const low = src("lower_wasm.js");
      const mod = index.parseSource(input.source, "src.air", { resolveSourceImports: false });
      index.verifySource(mod);
      const wat = low.lowerToWat(mod);
      const wasm = await low.watToWasm(wat, "V0_genuine_0521.wat");
      return { descriptor: index.borrowedSliceInterfaceDescriptor(mod), wasmHex: Buffer.from(wasm).toString("hex"), wat };
    `, { source: L521_SOURCE });
    assert(!out.uncaught, JSON.stringify(out.uncaught));
    legacyBuilds.set(version, { commit, descriptor: out.descriptor, wasm: Buffer.from(out.wasmHex, "hex"), wat: out.wat });
  }
  return legacyBuilds.get(version);
}

const trap = (fn) => {
  try {
    fn();
    return null;
  } catch (error) {
    return { message: String(error.message), name: error.name };
  }
};
const trapAsync = async (fn) => {
  try {
    await fn();
    return null;
  } catch (error) {
    return { message: String(error.message), name: error.name };
  }
};
const admissionRefusal = async (action, code, step) => {
  const error = await captureAsync(action);
  assert(error && error.code === code && error.step === step, `expected ${code} at step ${step}: ${error && error.message}`);
  observedFailures.push({ code, kind: "BINDING" });
  return { code: error.code, step: error.step };
};
const pinOf = (bytes) => sha256(bytes);
const leRead = (memory, offset) => new DataView(memory.buffer).getInt32(offset, true);

async function sectionAbi(matrix) {
  const t53 = acceptedSources.get("t53") || await accepted(pinned("T53"), [], "t53");
  const lo = acceptedSources.get("t53lo") || await accepted(pinned("T53LO"), [], "t53lo");
  const ln = acceptedSources.get("t53ln") || await accepted(pinned("T53LN"), [], "t53ln");
  const bytes = t53.built.wasmBytes;
  const cell = (row, artifact, host, outcome) => matrix.push({ artifact, host, outcome: plain(outcome), row });
  await vector("ART-T53", () => ({
    value: {
      "E(f)": expectE(t53.built, "f", 8, 0, 0, 16), backing: expectBacking(t53.built, 16, 16), bytes: bytes.length, measures: expectMeasures("T53"),
      owned_range: { ...verifiedBuild.typedV053.readBorrowedLaneRecord(t53.built).ownedRange }, sha256: sha256(bytes)
    }
  }));
  await vector("ART-T53-LEN-OWNED", () => ({ value: { "E(f)": expectE(lo.built, "f", 7, 0, 0, 16), measures: expectMeasures("T53LO"), owned_range: { ...verifiedBuild.typedV053.readBorrowedLaneRecord(lo.built).ownedRange } } }));
  await vector("ART-T53-LEN-NOOWN", () => ({ value: { "E(f)": expectE(ln.built, "f", 3), measures: expectMeasures("T53LN"), owned_range: { ...verifiedBuild.typedV053.readBorrowedLaneRecord(ln.built).ownedRange } } }));
  await vector("ART-L521", () => {
    assert.equal(Buffer.byteLength(L521_SOURCE), L521_PIN.source[0]);
    assert.equal(hexOf(L521_SOURCE), L521_PIN.source[1]);
    const l = legacyBuild("0.52.1");
    assert.equal(l.wasm.length, L521_PIN.wasm[0], "461 bytes");
    assert.equal(hexOf(l.wasm), L521_PIN.wasm[1], "the pinned 0.52.1 build");
    assert(/__air_owned_memory_base"\) i32 \(i32\.const 1024\)/u.test(l.wat) && /__air_owned_memory_end"\) i32 \(i32\.const 5120\)/u.test(l.wat), "owned range [1024, 5120)");
    return { value: { builder: l.commit, bytes: l.wasm.length, owned_range: [1024, 5120], sha256: sha256(l.wasm) } };
  });

  await vector("V53-ABI-01", async () => {
    const l = legacyBuild("0.52.1");
    const out = { pinned: await legacyCase("H-NEW", l.wasm, l.descriptor, { moduleDigest: pinOf(l.wasm) }), unpinned: await legacyCase("H-NEW", l.wasm, l.descriptor) };
    for (const item of Object.values(out)) assert.deepEqual({ codes: item.codes, host: item.hostReadonlyAfter }, { codes: ["air.borrow.air_owned_memory_overlap"], host: 5 });
    cell("V53-ABI-01", "ART-L521", "H-NEW legacy binding", out);
    return { value: out };
  });
  await vector("V53-ABI-02", async () => {
    const l = legacyBuild("0.52.0");
    assert(!/__air_owned_memory_/u.test(l.wat), "ART-L520 has no owned-range exports");
    const view = await legacyCase("H-NEW", l.wasm, l.descriptor);
    const copied = await legacyCase("H-NEW", l.wasm, l.descriptor, { mode: "copied_into_wasm" });
    assert.deepEqual(view.codes, ["air.borrow.air_memory_layout_unknown"]);
    assert.deepEqual({ codes: copied.codes, result: copied.result }, { codes: [], result: 5 });
    cell("V53-ABI-02", "ART-L520", "H-NEW legacy binding", { copied, view });
    return { value: { builder: l.commit, copied, view } };
  });
  await vector("V53-ABI-03", async () => {
    // CHARACTERIZATION: recorded, not judged; never a typed-v0.53 or protected cell.
    const l = legacyBuild("0.52.1");
    const out = {};
    for (const [label, from, to] of [["empty_1024_1024", /(__air_owned_memory_end"\) i32 \(i32\.const )5120/u, "$11024"], ["understated_2048_5120", /(__air_owned_memory_base"\) i32 \(i32\.const )1024/u, "$12048"]]) {
      const forged = Buffer.from(await watToWasm(l.wat.replace(from, to), `${label}.wat`));
      out[label] = await legacyCase("H-NEW", forged, l.descriptor);
    }
    cell("V53-ABI-03", "ART-L521 rewritten exports", "H-NEW legacy binding (unpinned)", out);
    return { status: "OBSERVED", value: { note: "legacy residual (R-ABI53-6), recorded not judged; QA52 observed 777", observed: out } };
  });
  await vector("V53-ABI-04", async () => {
    const l = legacyBuild("0.52.1");
    const t2 = await admissionRefusal(() => admitTypedV053Artifact({ pinnedDigest: pinOf(l.wasm), wasmBytes: l.wasm }), "air.abi.contract_unsupported", 1);
    const record = verifiedBuild.typedV053.mintHarnessRecord({ from: t53.built, wasmBytes: l.wasm });
    const t1 = await admissionRefusal(() => admitTypedV053Artifact({ record, wasmBytes: l.wasm }), "air.abi.contract_unsupported", 1);
    cell("V53-ABI-04", "ART-L521", "H-NEW typed admission", { t1, t2 });
    return { value: { t1_harness: t1, t2 } };
  });
  await vector("V53-ABI-05", async () => {
    // REGRESSION: the legacy and typed-v0.51 corpus compiled by the v0.53
    // compiler is byte-identical to the H52 baseline (0.52.1).
    const files = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".air")) files.push(full);
      }
    };
    walk(path.join(ROOT, "examples"));
    const typed = [];
    const walkTyped = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walkTyped(full);
        else if (entry.name.endsWith(".air")) typed.push(full);
      }
    };
    walkTyped(path.join(ROOT, "fixtures", "v051"));
    // Absolute paths: a source import resolves the same way on both sides.
    const corpus = [...files.map((file) => ({ file: path.relative(ROOT, file), path: file, profile: "legacy", source: fs.readFileSync(file, "utf8") })),
      ...typed.map((file) => ({ file: path.relative(ROOT, file), path: file, profile: "typed-v0.51", source: fs.readFileSync(file, "utf8") }))];
    const COMPILE = `
      const out = {};
      for (const item of input.corpus) {
        try {
          let wat;
          if (item.profile === "legacy") { const mod = src("parser.js").parseAir(item.source, item.path); src("verifier.js").verifyModule(mod); wat = src("lower_wasm.js").lowerToWat(mod); }
          else { const spm = src("source_profile.js"); const mod = spm.parseSource(item.source, item.path, { sourceProfile: "typed-v0.51" }); spm.verifySource(mod, { sourceProfile: "typed-v0.51" }); wat = src("lower_wasm.js").lowerToWat(mod); }
          const wasm = await src("lower_wasm.js").watToWasm(wat, item.path);
          out[item.file] = { sha256: require("crypto").createHash("sha256").update(Buffer.from(wasm)).digest("hex") };
        } catch (e) { out[item.file] = { error: String(e.code || e.name) }; }
      }
      return out;
    `;
    const old = runOld("0.52.1", COMPILE, { corpus });
    const here = await new Function("src", "input", "require", `return (async () => {${COMPILE}})();`)((m) => require(path.join(ROOT, "src", m)), { corpus }, require);
    let compiled = 0;
    for (const item of corpus) {
      assert.deepEqual(here[item.file], old.out[item.file], `${item.file}: the same outcome as the H52 baseline`);
      if (here[item.file].sha256) compiled += 1;
    }
    assert(compiled >= 40, `${compiled} corpus modules compiled`);
    return { value: { baseline: old.commit, compiled, files: corpus.length, identical: true } };
  });
  for (const [id, version] of [["V53-ABI-10", "0.52.1"], ["V53-ABI-11", "0.52.0"], ["V53-ABI-12", "0.50"]]) {
    await vector(id, () => {
      const { commit, out, version: shipped } = runOld(version, `
        const sdk = src("sdk.js");
        try { await sdk.instantiateAirModule({ wasmBytes: input.bytes }); return { instantiated: true }; }
        catch (e) { return { message: String(e.message), name: e.name }; }
      `, { bytesHex: hexBytes(bytes) });
      assert.equal(out.name, "TypeError", JSON.stringify(out));
      assert.match(out.message, /Import #0 "air:contract"/u);
      cell(id, "ART-T53", `H-OLD ${shipped} instantiateAirModule`, out);
      return { value: { host: commit, outcome: out, sdk_version: shipped, binding: "unreachable: no instance" } };
    });
  }
  await vector("V53-ABI-13", () => {
    const value = {};
    for (const version of ["0.52.1", "0.52.0"]) {
      const { commit, out } = runOld(version, `
        const vb = src("v052_verified_build.js");
        const text = require("fs").readFileSync(input.file, "utf8");
        const forged = { artifactDigest: "sha256:" + "0".repeat(64), schema: "air.v052.verifiedTypedBuild/2", wasmBytes: input.bytes };
        let invoked;
        try { await vb.invokeVerifiedTypedExport(forged, "f", [16, 4]); invoked = { ok: true }; } catch (e) { invoked = { code: e.code || e.name }; }
        return { empty_import_objects: (text.match(/WebAssembly\\.instantiate\\(wasmBytes, \\{\\}\\)|new WebAssembly\\.Instance\\([^,]+, \\{\\}\\)/gu) || []).length, invoked };
      `, { bytesHex: hexBytes(bytes), file: path.join(oldHost(version).dir, "src", "v052_verified_build.js") });
      assert.equal(out.invoked.code, "air.v052.verified_build_untrusted", JSON.stringify(out));
      assert(out.empty_import_objects >= 1, "the 0.52.x runtime instantiates with {}");
      value[version] = { host: commit, ...out };
    }
    cell("V53-ABI-13", "ART-T53", "0.52.x verified typed runtime", value);
    return { value };
  });
  const realtimePackage = (label, source, wasm) => {
    const dir = path.join(tmp, `pkg-${label}`);
    fs.mkdirSync(dir, { recursive: true });
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "examples", "realtime_safe", "air.package.json"), "utf8"));
    manifest.name = `realtime-safe-${label}`;
    fs.writeFileSync(path.join(dir, "air.package.json"), JSON.stringify(manifest, null, 2));
    fs.writeFileSync(path.join(dir, "module.air"), source);
    fs.writeFileSync(path.join(dir, "module.wasm"), wasm);
    return dir;
  };
  await vector("V53-ABI-14", () => {
    const dir = realtimePackage("abi14", F.T53, bytes);
    const value = {};
    for (const version of ["0.52.1", "0.52.0"]) {
      const { commit, out } = runOld(version, `
        const sdk = src("sdk.js");
        let calls = 0;
        const original = sdk.instantiateAirModule;
        sdk.instantiateAirModule = async (...args) => { calls += 1; return original(...args); };
        try { await src("verified_execution_session.js").createVerifiedExecutionSession({ packageDir: input.dir, resourceCertificate: {} }); return { calls, created: true }; }
        catch (e) { return { calls, code: e.code || null, name: e.name }; }
      `, { dir });
      assert(!out.created && out.calls === 0, `refused before instantiation: ${JSON.stringify(out)}`);
      value[version] = { host: commit, ...out };
    }
    cell("V53-ABI-14", "typed-v0.53 package (ART-T53)", "0.52.x realtime session", value);
    return { value };
  });
  await vector("V53-ABI-15", async () => {
    const objects = {
      createOutputImports: air.createOutputImports({}),
      createUtilityImports: air.createUtilityImports({}),
      // The run facade's explicit capture (src/run_package.js createExplicitImports): only output.emit.
      run_facade_capture: { output: { emit: () => 0 } }
    };
    const value = {};
    for (const [name, imports] of Object.entries(objects)) {
      assert(!Object.prototype.hasOwnProperty.call(imports, "air:contract"), `${name}: no air:contract key`);
      const refused = await trapAsync(() => WebAssembly.instantiate(bytes, imports));
      assert(refused && ["TypeError", "LinkError"].includes(refused.name), `${name}: refused at instantiation (${JSON.stringify(refused)})`);
      value[name] = refused;
    }
    cell("V53-ABI-15", "ART-T53", "SDK import factories / run-facade capture", value);
    return { value };
  });
  await vector("V53-ABI-16", () => {
    const host = oldHost("0.52.1");
    const grep = childProcess.spawnSync("git", ["grep", "-n", "-e", "Module.imports", "-e", "new Proxy", host.commit, "--", "src", "bin"], { cwd: ROOT, encoding: "utf8" });
    assert.equal(grep.stdout.trim(), "", "no Module.imports enumeration or Proxy import object in src/ or bin/");
    const fnText = (commit) => {
      const text = childProcess.spawnSync("git", ["show", `${commit}:src/sdk.js`], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).stdout;
      const begin = text.indexOf("async function instantiateAirModule(");
      return text.slice(begin, text.indexOf("\n}\n", begin) + 2);
    };
    const v050 = oldHost("0.50");
    assert.equal(fnText(host.commit), fnText(v050.commit), "instantiateAirModule unchanged since v0.50");
    return { value: { at: host.commit, compared_with: v050.commit, instantiateAirModule_sha256: sha256(fnText(host.commit)), proxy_or_imports_enumeration: 0 } };
  });
  await vector("V53-ABI-20", async () => {
    const refused = await trapAsync(() => WebAssembly.instantiate(bytes, {}));
    assert(refused && refused.name === "TypeError", JSON.stringify(refused));
    cell("V53-ABI-20", "ART-T53", "raw WebAssembly.instantiate(bytes, {})", refused);
    return { value: refused };
  });
  await vector("V53-ABI-21", async () => {
    const refused = await trapAsync(() => WebAssembly.instantiate(bytes, { "air:contract": {} }));
    assert(refused && refused.name === "LinkError", JSON.stringify(refused));
    cell("V53-ABI-21", "ART-T53", "{ air:contract: {} }", refused);
    return { value: refused };
  });
  await vector("V53-ABI-22", async () => {
    const stubs = {
      hand_returns_0: { "air:contract": { "typed-v0.53.v1": () => 0 } },
      hand_returns_undefined: { "air:contract": { "typed-v0.53.v1": () => undefined } },
      proxy_autostub: new Proxy({}, { get: () => new Proxy({}, { get: () => () => 0 }) })
    };
    const value = {};
    for (const [name, imports] of Object.entries(stubs)) {
      const refused = await trapAsync(() => WebAssembly.instantiate(bytes, imports));
      assert(refused && refused.name === "RuntimeError" && /unreachable/u.test(refused.message), `${name}: the start traps (${JSON.stringify(refused)})`);
      value[name] = refused;
    }
    value.engine_unknown_imports_default = "V53-ABI-71 (c)";
    cell("V53-ABI-22", "ART-T53", "stubbed contract import", value);
    return { value };
  });
  await vector("V53-ABI-23", () => ({ value: { characterized_by: "V53-ABI-71 (b): wasmtime -W unknown-imports-trap=y" } }));
  await vector("V53-ABI-24", () => {
    const instance = rawInstance(bytes, delibImports());
    viewAt(instance.exports.memory, 16, word(5));
    const out = rawCall(instance, "f", [16, 4]);
    assert(out.trap && out.borrowFrame && out.reason === 64, JSON.stringify(out));
    assert.equal(leRead(instance.exports.memory, 16), 5, "byte 16 still reads 5");
    cell("V53-ABI-24", "ART-T53", "H-DELIB raw f(16, 4)", out);
    return { value: { ...out, byte16: 5 } };
  });
  await vector("V53-ABI-25", () => {
    const instance = rawInstance(bytes, delibImports());
    viewAt(instance.exports.memory, 64, word(41));
    const out = rawCall(instance, "f", [64, 4]);
    assert.deepEqual(out, { value: 41 });
    cell("V53-ABI-25", "ART-T53", "H-DELIB raw f(64, 4)", out);
    return { value: out };
  });
  await vector("V53-ABI-26", async () => {
    const noguard = rawInstance(await forge(t53.wat, "F-NOGUARD"), delibImports());
    viewAt(noguard.exports.memory, 16, word(5));
    const out = rawCall(noguard, "f", [16, 4]);
    assert.deepEqual(out, { value: 777 });
    assert.equal(leRead(noguard.exports.memory, 16), 777, "byte 16 reads 777: C1 alone does not protect H-DELIB");
    cell("V53-ABI-26", "F-NOGUARD", "H-DELIB raw f(16, 4)", out);
    return { status: "OBSERVED", value: { ...out, byte16: 777 } };
  });
  await vector("V53-ABI-27", () => {
    const owned = rawInstance(lo.built.wasmBytes, delibImports());
    const noOwned = rawInstance(ln.built.wasmBytes, delibImports());
    const cases = { a: [owned, [32, 4], 4], b: [owned, [12, 4], 4], c: [owned, [12, 5], "trap"], d: [owned, [31, 1], "trap"], e: [owned, [16, 0], 0], f: [owned, [28, 4], "trap"],
      g: [noOwned, [12, 8], 8], h: [noOwned, [15, 1], 1], i: [noOwned, [8, 8], 8], j: [noOwned, [16, 4], 4], k: [noOwned, [16, 0], 0] };
    const value = {};
    for (const [tag, [instance, args, expected]] of Object.entries(cases)) {
      const out = rawCall(instance, "f", args);
      if (expected === "trap") assert(out.trap && out.borrowFrame && out.reason === 64, `${tag}: guard trap ${JSON.stringify(out)}`);
      else assert.deepEqual(out, { value: expected }, `${tag}`);
      value[tag] = { args, out };
    }
    assert(!/i32\.const 64\n {4}global\.set/u.test(ln.wat), "LEN-NOOWN: no guard emitted (BASE = END)");
    cell("V53-ABI-27", "ART-T53-LEN-OWNED / -NOOWN", "H-DELIB raw", value);
    return { value };
  });
  await vector("V53-ABI-28", async () => {
    const strip = await forge(t53.wat, "F-STRIP");
    const l = legacyBuild("0.52.1");
    const value = {};
    for (const version of ["0.52.1", "0.52.0"]) {
      const outside = await legacyCase(version, strip, l.descriptor, { offset: 64 });
      const overlap = await legacyCase(version, strip, l.descriptor, { offset: 16 });
      assert.deepEqual(outside.codes, ["air.borrow.interface_invalid"], `${version}: ${JSON.stringify(outside)}`);
      if (version === "0.52.1") assert.deepEqual(overlap.codes, ["air.borrow.air_owned_memory_overlap"], JSON.stringify(overlap));
      value[version] = { outside, overlap };
    }
    cell("V53-ABI-28", "F-STRIP", "H-0521 / H-OLD invokeBorrowedMemory", value);
    return { value };
  });
  await vector("V53-ABI-29", async () => {
    const strip = await forge(t53.wat, "F-STRIP");
    assert.deepEqual(WebAssembly.Module.imports(new WebAssembly.Module(strip)), [], "F-STRIP imports nothing");
    const instance = rawInstance(strip, {});
    const out = rawCall(instance, "f", [16, 4]);
    assert(out.trap && out.borrowFrame, JSON.stringify(out));
    // The old SDK's mapping: its own predicate applied to the trap, and the code it maps to.
    const host = oldHost("0.52.1");
    const binding = fs.readFileSync(path.join(host.dir, "src", "borrowed_memory_binding.js"), "utf8");
    const predicate = binding.slice(binding.indexOf("function isGeneratedBorrowFailure("), binding.indexOf("\n}\n", binding.indexOf("function isGeneratedBorrowFailure(")) + 2);
    let error;
    try { instance.exports.f(16, 4); } catch (caught) { error = caught; }
    const mapped = new Function("error", `${predicate}\nreturn isGeneratedBorrowFailure(error);`)(error);
    assert(mapped && /if \(!isGeneratedBorrowFailure\(error\)\) throw error;\n\s+const code = "air\.borrow\.pointer_out_of_bounds";/u.test(binding), "the old SDK maps the guard trap to air.borrow.pointer_out_of_bounds");
    cell("V53-ABI-29", "F-STRIP", "raw call; old-SDK mapping", { ...out, old_sdk_maps_to: "air.borrow.pointer_out_of_bounds" });
    return { value: { ...out, old_sdk: host.commit, old_sdk_maps_to: "air.borrow.pointer_out_of_bounds" } };
  });
  await vector("V53-ABI-30", async () => {
    const value = {};
    for (const [root, options] of [["T1", { record: t53.built }], ["T2", { interfaceDescriptor: t53.built.descriptor, pinnedDigest: pinOf(bytes) }]]) {
      const admittedInstance = await (await admitTypedV053Artifact({ ...options, wasmBytes: bytes })).instantiate();
      const view = viewAt(admittedInstance.memory, 16, word(5));
      const outcome = outcomeOf(admittedInstance.invoke({ bindings: { src: bind(view, "readonly", 4, 4) }, entrypoint: "f" }));
      assert.deepEqual(outcome, { code: "air.borrow.air_owned_memory_overlap" }, root);
      assert.equal(leRead(admittedInstance.memory, 16), 5, `${root}: host value 5 (the guard was not reached)`);
      observedFailures.push({ code: outcome.code, kind: "BINDING" });
      value[root] = { host: 5, outcome };
    }
    cell("V53-ABI-30", "ART-T53", "H-NEW typed admission, overlap view", value);
    return { value };
  });
  await vector("V53-ABI-31", async () => {
    const handle = await admitTypedV053Artifact({ record: t53.built, wasmBytes: bytes });
    const viewInstance = await handle.instantiate();
    const view = viewAt(viewInstance.memory, 64, word(41));
    const viewed = outcomeOf(viewInstance.invoke({ bindings: { src: bind(view, "readonly", 4, 4) }, entrypoint: "f" }));
    const host = new Uint8Array(word(9));
    const copied = outcomeOf(await handle.invoke({ bindings: { src: bind(host, "readonly", 4, 4, "copied_into_wasm") }, entrypoint: "f" }));
    assert.deepEqual({ copied, viewed }, { copied: { value: 9 }, viewed: { value: 41 } });
    assert.deepEqual([...host], word(9), "the host range is not mutated");
    assert.equal(leRead(viewInstance.memory, 64), 41, "the viewed range is not mutated");
    cell("V53-ABI-31", "ART-T53", "H-NEW typed admission, outside view / copied", { copied, viewed });
    return { value: { copied, viewed } };
  });
  await vector("V53-ABI-32", async () => ({
    value: {
      neither: await admissionRefusal(() => admitTypedV053Artifact({ wasmBytes: bytes }), "air.abi.record_untrusted", 1),
      plain_record: await admissionRefusal(() => admitTypedV053Artifact({ record: { ...t53.built }, wasmBytes: bytes }), "air.abi.record_untrusted", 1)
    }
  }));
  await vector("V53-ABI-33", async () => ({
    value: {
      t1_other: await admissionRefusal(() => admitTypedV053Artifact({ record: lo.built, wasmBytes: bytes }), "air.borrow.module_identity_mismatch", 1),
      t2_other: await admissionRefusal(() => admitTypedV053Artifact({ pinnedDigest: pinOf(lo.built.wasmBytes), wasmBytes: bytes }), "air.borrow.module_identity_mismatch", 1)
    }
  }));
  await vector("V53-ABI-34", async () => {
    const v2 = await forge(t53.wat, "F-V2ID");
    const trace = [];
    const out = await admissionRefusal(() => admitTypedV053Artifact({ pinnedDigest: pinOf(v2), trace, wasmBytes: v2 }), "air.abi.contract_unsupported", 1);
    assert(!trace.includes("step2.instantiate"), "no instantiation, no retry without the import");
    return { value: { ...out, trace } };
  });
  await vector("V53-ABI-35", async () => {
    const value = {};
    for (const [root, options] of [["T1", { record: t53.built }], ["T2", { interfaceDescriptor: t53.built.descriptor, pinnedDigest: pinOf(bytes) }]]) {
      const trace = [];
      const handle = await admitTypedV053Artifact({ ...options, trace, wasmBytes: bytes });
      const outcomes = [];
      for (let call = 0; call < 2; call += 1) outcomes.push(outcomeOf(await handle.invoke({ bindings: { src: bind(new Uint8Array(word(6)), "readonly", 4, 4, "copied_into_wasm") }, entrypoint: "f" })));
      assert.deepEqual(outcomes, [{ value: 6 }, { value: 6 }]);
      const count = (event) => trace.filter((item) => item === event).length;
      assert.deepEqual({ calls: count("step2.contract_call"), instantiations: count("step2.instantiate") }, { calls: 2, instantiations: 2 }, `${root}: one instantiation and one handshake call per invocation`);
      value[root] = { handshake_calls: 2, instantiations: 2, outcomes };
    }
    const entry = wb.inspectBoundWorkBound(t53.built).record.entries.f;
    assert.deepEqual(entry, S(8, 0, 0, 16), "E(f) = S{steps:8}, region_bytes 16");
    assert.deepEqual(entry.effects, {}, "no effect key");
    return { value: { ...value, "E(f)": entry } };
  });
  await vector("V53-ABI-36", async () => {
    const admittedInstance = await (await admitTypedV053Artifact({ record: t53.built, wasmBytes: bytes })).instantiate();
    const raw = admittedInstance.invokeRaw("f", [16, 4]);
    assert.deepEqual(outcomeOf(raw), { code: "air.borrow.air_owned_memory_overlap" });
    assert.equal(raw.diagnostics[0].message, "the typed-v0.53 artifact trapped with failure reason 64", "no runtime detail");
    observedFailures.push({ code: "air.borrow.air_owned_memory_overlap", kind: "RUNTIME_FAIL" });
    cell("V53-ABI-36", "ART-T53", "H-NEW raw f(16, 4)", outcomeOf(raw));
    return { value: { failure_reason: 64, outcome: outcomeOf(raw) } };
  });
  for (const [id, kind] of [["V53-ABI-40", "F-EMPTY"], ["V53-ABI-41", "F-UNDER"], ["V53-ABI-44", "F-STRIP"]]) {
    await vector(id, async () => {
      const forged = await forge(t53.wat, kind);
      return {
        value: {
          forged: kind,
          t1: await admissionRefusal(() => admitTypedV053Artifact({ record: t53.built, wasmBytes: forged }), "air.borrow.module_identity_mismatch", 1),
          t2: await admissionRefusal(() => admitTypedV053Artifact({ pinnedDigest: pinOf(bytes), wasmBytes: forged }), "air.borrow.module_identity_mismatch", 1)
        }
      };
    });
  }
  await vector("V53-ABI-42", async () => {
    const a = await admissionRefusal(async () => (await admitTypedV053Artifact({ record: verifiedBuild.typedV053.mintHarnessRecord({ from: t53.built, ownedRange: { end: 24, start: 16 } }), wasmBytes: bytes })).instantiate(), "air.borrow.air_memory_layout_unknown", 3);
    const empty = await forge(t53.wat, "F-EMPTY");
    const b = await admissionRefusal(async () => (await admitTypedV053Artifact({ record: verifiedBuild.typedV053.mintHarnessRecord({ from: t53.built, ownedRange: { end: 32, start: 16 }, wasmBytes: empty }), wasmBytes: empty })).instantiate(), "air.borrow.air_memory_layout_unknown", 3);
    const c = await (await admitTypedV053Artifact({ record: ln.built, wasmBytes: ln.built.wasmBytes })).instantiate();
    return { value: { a, b, c: { accepted: Boolean(c && c.memory) } } };
  });
  await vector("V53-ABI-43", async () => {
    const empty = rawInstance(await forge(t53.wat, "F-EMPTY"), delibImports());
    const under = rawInstance(await forge(t53.wat, "F-UNDER"), delibImports());
    const out = { f_empty_16_4: rawCall(empty, "f", [16, 4]), f_under_24_4: rawCall(under, "f", [24, 4]) };
    for (const item of Object.values(out)) assert(item.trap && item.borrowFrame && item.reason === 64, JSON.stringify(item));
    cell("V53-ABI-43", "F-EMPTY / F-UNDER", "H-DELIB raw", out);
    return { value: out };
  });
  await vector("V53-ABI-45", async () => {
    const v1 = await forge(t53.wat, "F-V1");
    const l = legacyBuild("0.52.1");
    const outside = await legacyCase("H-NEW", v1, l.descriptor, { offset: 64 });
    const overlap = await legacyCase("H-NEW", v1, l.descriptor, { offset: 16 });
    const raw = rawCall(rawInstance(v1, {}), "f", [16, 4]);
    assert(raw.trap && raw.borrowFrame, "the guard survives in F-V1: an overlapping call traps");
    cell("V53-ABI-45", "F-V1", "legacy API, unpinned", { outside, overlap, raw });
    return { status: "OBSERVED", value: { disclosed: "legacy residual (V53-ABI-03): DISCLOSED downgrade, never a typed-v0.53 claim (release-note statement 5)", outside, overlap, raw } };
  });
  await vector("V53-ABI-46", async () => {
    const wordForged = await forge(t53.wat, "F-WORD");
    const hNew = await admissionRefusal(() => admitTypedV053Artifact({ record: t53.built, wasmBytes: wordForged }), "air.borrow.module_identity_mismatch", 1);
    const delib = trap(() => rawInstance(wordForged, delibImports()));
    assert(delib && delib.name === "RuntimeError", `H-DELIB: the start traps (${JSON.stringify(delib)})`);
    cell("V53-ABI-46", "F-WORD", "H-NEW / H-DELIB", { delib, hNew });
    return { value: { h_delib: delib, h_new: hNew } };
  });
  await vector("V53-ABI-47", () => {
    // By inspection: the typed admission instantiates in exactly one place,
    // with the import object it creates for that instantiation, and never
    // through instantiateAirModule; and by V53-ABI-34.
    const binding = fs.readFileSync(path.join(ROOT, "src", "borrowed_memory_binding.js"), "utf8");
    const typed = binding.slice(binding.indexOf("// P0-08 typed-v0.53 admission"));
    assert.deepEqual(typed.match(/new WebAssembly\.Instance\([^)]*\)|WebAssembly\.instantiate\(/gu), ["new WebAssembly.Instance(module, importObject)"]);
    assert(/const importObject = \{ \[TYPED_CONTRACT\.module\]: \{ \[TYPED_CONTRACT\.field\]: contractFunction \} \};/u.test(typed), "a fresh import object per instantiation");
    assert(!/instantiateAirModule\(/u.test(typed), "never instantiateAirModule");
    return { value: { instantiation_sites: 1, legacy_marker_refused_at_step_3: true, by: ["inspection", "V53-ABI-34"] } };
  });
  await vector("V53-ABI-50", async () => {
    const p02 = ctx.p02;
    const module = new WebAssembly.Module(p02.built.wasmBytes);
    const imports = WebAssembly.Module.imports(module).map((item) => `${item.kind}:${item.module}.${item.name}`);
    const exportsOf = WebAssembly.Module.exports(module).map((item) => `${item.kind}:${item.name}`);
    assert.deepEqual(imports, ["function:air:contract.typed-v0.53.v1"], "one import, no memory import");
    assert(exportsOf.includes("memory:memory") && exportsOf.includes("global:__air_abi_feature_typed_memory_v1") && !exportsOf.includes("global:__air_abi_feature_borrowed_slice_v1"));
    assert(p02.wat.includes("  (import \"air:contract\" \"typed-v0.53.v1\" (func $__air_v053_contract (result i32)))"), "() -> i32");
    assert(p02.wat.includes(`  (func $__air_v053_contract_start call $__air_v053_contract i32.const ${WORD} i32.ne if unreachable end)\n  (start $__air_v053_contract_start)`), "the start calls only the import; no memory, global or table");
    assert(/\(memory \(export "memory"\) 1\)/u.test(p02.wat), "module-defined memory exported as memory");
    const instance = rawInstance(p02.built.wasmBytes, delibImports());
    assert.equal(instance.exports.__air_abi_feature_typed_memory_v1.value, 851969);
    assert.deepEqual([instance.exports.__air_owned_memory_base.value, instance.exports.__air_owned_memory_end.value], [16, 16], "owned range [16, 16)");
    assert(!/i32\.const 64\n {4}global\.set/u.test(p02.wat), "no guard");
    const descriptor = p02.built.descriptor;
    assert.deepEqual([descriptor.schema, descriptor.airAbi, descriptor.feature], ["air.borrowed-slice-interface.v2", "0.13", "typed-memory-v1"]);
    expectE(p02.built, "copy_final", 7);
    return { value: { descriptor: { airAbi: descriptor.airAbi, feature: descriptor.feature, schema: descriptor.schema }, exports: exportsOf, imports, marker: 851969, owned_range: [16, 16] } };
  });
  await vector("V53-ABI-53", () => {
    const entries = { "ART-T53": wb.inspectBoundWorkBound(t53.built).record.entries.f, "ART-T53-LEN-NOOWN": wb.inspectBoundWorkBound(ln.built).record.entries.f };
    assert.equal(entries["ART-T53"].steps, "8");
    assert.equal(entries["ART-T53-LEN-NOOWN"].steps, "3");
    for (const entry of Object.values(entries)) assert.deepEqual([entry.calls, entry.iterations, entry.effects], ["0", "0", {}], "no handshake term, no effect key");
    return { value: entries };
  });
  await vector("V53-ABI-55", () => {
    // The rollback drill on a scratch copy (the committed tree keeps the kill switch off).
    const copy = path.join(tmp, "rollback");
    fs.mkdirSync(copy);
    fs.cpSync(path.join(ROOT, "src"), path.join(copy, "src"), { recursive: true });
    const profileFile = path.join(copy, "src", "source_profile.js");
    const text = fs.readFileSync(profileFile, "utf8");
    assert.equal(text.split("const disable_typed_v053_profile = false;").length, 2, "exactly one kill-switch constant, off");
    fs.writeFileSync(profileFile, text.replace("const disable_typed_v053_profile = false;", "const disable_typed_v053_profile = true;"));
    const script = path.join(copy, "drill.js");
    fs.writeFileSync(script, `"use strict";
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const src = (m) => require(path.join(process.argv[2], "src", m));
(async () => {
  const out = {};
  try { src("source_profile.js").parseSource(fs.readFileSync(process.argv[3], "utf8"), "t.air", { allowCandidateProfile: true, sourceProfile: "typed-v0.53" }); out.typed = "parsed"; }
  catch (e) { out.typed = String(e.code); }
  const legacy = src("parser.js").parseAir(fs.readFileSync(process.argv[4], "utf8"), "l.air"); src("verifier.js").verifyModule(legacy);
  out.legacy = crypto.createHash("sha256").update(Buffer.from(await src("lower_wasm.js").watToWasm(src("lower_wasm.js").lowerToWat(legacy), "l.air"))).digest("hex");
  const spm = src("source_profile.js"); const typed = spm.parseSource(fs.readFileSync(process.argv[5], "utf8"), "v.air", { sourceProfile: "typed-v0.51" }); spm.verifySource(typed, { sourceProfile: "typed-v0.51" });
  out.v051 = crypto.createHash("sha256").update(Buffer.from(await src("lower_wasm.js").watToWasm(src("lower_wasm.js").lowerToWat(typed), "v.air"))).digest("hex");
  process.stdout.write(JSON.stringify(out));
})();
`);
    const t53File = path.join(tmp, "drill_t53.air");
    fs.writeFileSync(t53File, F.T53);
    const legacyFile = path.join(ROOT, "examples", "grep.air");
    const v051File = path.join(ROOT, "fixtures", "v051", "first_vertical", "typed_decide.air");
    const run = (dir) => {
      const out = childProcess.spawnSync(process.execPath, [script, dir, t53File, legacyFile, v051File], { encoding: "utf8", env: { ...process.env, NODE_PATH: path.join(ROOT, "node_modules") }, killSignal: "SIGKILL", timeout: 120000 });
      assert(!out.error && out.status === 0, out.stderr);
      return JSON.parse(out.stdout);
    };
    const drill = run(copy);
    const live = run(ROOT);
    fs.rmSync(copy, { force: true, recursive: true });
    assert.equal(drill.typed, "air.source_profile.unsupported");
    assert.deepEqual({ legacy: drill.legacy, v051: drill.v051 }, { legacy: live.legacy, v051: live.v051 }, "legacy and typed-v0.51 bytes unchanged");
    return { value: { built_artifacts_on_old_hosts: "do not instantiate (V53-ABI-10, -11, -12)", legacy_sha256: drill.legacy, typed_v053: drill.typed, v051_sha256: drill.v051 } };
  });
  await vector("V53-ABI-57", async () => {
    const trace = [];
    const handle = await admitTypedV053Artifact({ record: t53.built, trace, wasmBytes: bytes });
    assert.deepEqual(Object.keys(handle).sort(), ["digest", "instantiate", "invoke", "trust"], "the handle exposes no export");
    const admittedInstance = await handle.instantiate();
    assert.deepEqual(Object.keys(admittedInstance).sort(), ["invoke", "invokeRaw", "memory"], "no export reaches the caller; memory only after step 3");
    outcomeOf(admittedInstance.invoke({ bindings: { src: bind(new Uint8Array(word(3)), "readonly", 4, 4, "copied_into_wasm") }, entrypoint: "f" }));
    const order = ["step1.private_copy", "step1.digest", "step1.compile", "step1.contract_id", "step2.instantiate", "step2.contract_call", "step3.owned_range", "step3.marker", "step4.arm", "step4.bind", "step4.invoke"];
    let at = -1;
    for (const event of order) {
      const next = trace.indexOf(event, at + 1);
      assert(next > at, `${event} after the previous event: ${trace.join(" ")}`);
      at = next;
    }
    assert.equal(trace.filter((event) => event === "step2.contract_call").length, 1, "the contract import is called exactly once");
    assert(trace.indexOf("step4.arm") > trace.lastIndexOf("step3.marker"), "handlers armed (the empty set) after step 3");
    return { value: { trace } };
  });
  await vector("V53-ABI-58", async () => {
    const a = await admissionRefusal(async () => (await admitTypedV053Artifact({ record: verifiedBuild.typedV053.mintHarnessRecord({ from: t53.built, ownedRange: { end: 24, start: 16 } }), wasmBytes: bytes })).instantiate(), "air.borrow.air_memory_layout_unknown", 3);
    const noMarker = await forge(t53.wat, "F-NOMARKER");
    const b = await admissionRefusal(async () => (await admitTypedV053Artifact({ record: verifiedBuild.typedV053.mintHarnessRecord({ from: t53.built, wasmBytes: noMarker }), wasmBytes: noMarker })).instantiate(), "air.borrow.interface_invalid", 3);
    return { value: { a, b, instance: "discarded; the caller never receives it; no handler armed (the set is empty at P0-08)" } };
  });
  await vector("V53-ABI-59", () => ({ status: "DEFERRED", value: { first_executable: "P0-10", reason: "F-STARTFX needs a capability import" } }));
  await vector("V53-ABI-60", () => ({ status: "NOT_APPLICABLE", value: { reason: "the optional step-1 static decoder is not adopted (R-ABI53-3); step 3 runs in every case" } }));
  await vector("V53-ABI-61", async () => {
    const forged = await forge(t53.wat, "F-NOGUARD-EMPTY");
    // (a) genuine bytes in the caller's buffer, rewritten while admission is pending.
    const bufferA = Uint8Array.from(bytes);
    const pendingA = admitTypedV053Artifact({ record: t53.built, wasmBytes: bufferA });
    bufferA.fill(0);
    bufferA.set(forged.subarray(0, Math.min(forged.length, bufferA.length)));
    const admittedA = await (await pendingA).instantiate();
    const view = viewAt(admittedA.memory, 16, word(5));
    const a = outcomeOf(admittedA.invoke({ bindings: { src: bind(view, "readonly", 4, 4) }, entrypoint: "f" }));
    assert.deepEqual(a, { code: "air.borrow.air_owned_memory_overlap" }, "admitted as ART-T53; the view refused from the record");
    assert.equal(leRead(admittedA.memory, 16), 5, "the host view unchanged");
    // (b) forged bytes rewritten to genuine ones while pending, T2 pin of the genuine digest.
    const bufferB = Uint8Array.from(forged);
    const pendingB = admitTypedV053Artifact({ pinnedDigest: pinOf(bytes), wasmBytes: bufferB });
    bufferB.set(bytes.subarray(0, bufferB.length));
    const b = await admissionRefusal(() => pendingB, "air.borrow.module_identity_mismatch", 1);
    return { value: { a, b, instantiateAirModule: "never called (V53-ABI-47)" } };
  });
  await vector("V53-ABI-62", async () => {
    const forged = await forge(t53.wat, "F-NOGUARD-EMPTY");
    const trace = [];
    const record = { ownedRange: { end: 16, start: 16 }, wasmDigest: pinOf(forged) };
    const host = new Uint8Array(word(5));
    const out = await admissionRefusal(() => admitTypedV053Artifact({ record, trace, wasmBytes: forged }), "air.abi.record_untrusted", 1);
    assert(!trace.includes("step2.instantiate"), "no instantiation");
    assert.deepEqual([...host], word(5), "the host view stays 5");
    return { value: out };
  });
  await vector("V53-ABI-63", async () => {
    const forged = await forge(t53.wat, "F-NOGUARD-EMPTY");
    return { value: await admissionRefusal(() => admitTypedV053Artifact({ pinnedDigest: pinOf(bytes), record: { ownedRange: { end: 16, start: 16 }, wasmDigest: pinOf(forged) }, wasmBytes: forged }), "air.borrow.module_identity_mismatch", 1) };
  });
  await vector("V53-ABI-64", async () => {
    const a = await (await admitTypedV053Artifact({ record: t53.built, wasmBytes: bytes })).instantiate();
    const handleB = await admitTypedV053Artifact({ interfaceDescriptor: t53.built.descriptor, pinnedDigest: pinOf(bytes), wasmBytes: bytes });
    const admittedB = await handleB.instantiate();
    const b = outcomeOf(admittedB.invoke({ bindings: { src: bind(viewAt(admittedB.memory, 16, word(5)), "readonly", 4, 4) }, entrypoint: "f" }));
    assert.deepEqual(b, { code: "air.borrow.air_owned_memory_overlap" }, "(b) admitted with [16, 32) read from the pinned bytes; the view refused");
    const c = await admissionRefusal(async () => (await admitTypedV053Artifact({ interfaceDescriptor: t53.built.descriptor, pinnedDigest: pinOf(bytes), record: { ownedRange: { end: 48, start: 16 } }, wasmBytes: bytes })).instantiate(), "air.borrow.air_memory_layout_unknown", 3);
    return { value: { a: { admitted: Boolean(a.memory) }, b, c } };
  });
  await vector("V53-ABI-65", () => ({ status: "DEFERRED", value: { expected: "air.host.call_before_admission", first_executable: "P0-10", reason: "a start that calls a capability import needs one" } }));
  await vector("V53-ABI-66", async () => {
    assert(!/i32\.const 64\n {4}global\.set/u.test(ln.wat), "no guard emitted");
    const admittedInstance = await (await admitTypedV053Artifact({ record: ln.built, wasmBytes: ln.built.wasmBytes })).instantiate();
    const bound = outcomeOf(admittedInstance.invoke({ bindings: { src: bind(viewAt(admittedInstance.memory, 12, [1, 2, 3, 4, 5, 6, 7, 8]), "readonly", 8, 1) }, entrypoint: "f" }));
    const raw = rawCall(rawInstance(ln.built.wasmBytes, delibImports()), "f", [12, 8]);
    assert.deepEqual({ bound, raw }, { bound: { value: 8 }, raw: { value: 8 } });
    return { value: { bound, raw } };
  });
  await vector("V53-ABI-67", async () => {
    const sdkModule = require("../src/sdk");
    const original = { checkPackageDir: sdkModule.checkPackageDir, instantiateAirModule: sdkModule.instantiateAirModule };
    const reached = [];
    sdkModule.checkPackageDir = () => { reached.push("checkPackageDir"); throw new Error("reached checkPackageDir"); };
    sdkModule.instantiateAirModule = async () => { reached.push("instantiateAirModule"); throw new Error("reached instantiation"); };
    const value = {};
    try {
      for (const [label, source] of [["a", F.T53], ["b", fs.readFileSync(path.join(ROOT, "examples", "realtime_safe", "module.air"), "utf8")]]) {
        const dir = realtimePackage(`abi67${label}`, source, bytes);
        const error = await captureAsync(() => createVerifiedExecutionSession({ packageDir: dir, resourceCertificate: {} }));
        assert(error && error.code === "air.assurance.profile_unsupported", `${label}: ${error && error.message}`);
        assertNoRawError(error.message, label);
        value[label] = { code: error.code };
      }
    } finally {
      Object.assign(sdkModule, original);
    }
    assert.deepEqual(reached, [], "refused before checkPackageDir, the legacy parser and instantiation");
    const profile = JSON.parse(fs.readFileSync(path.join(ROOT, "examples", "realtime_safe", "air.package.json"), "utf8")).executionProfile;
    const assertion = capture(() => assertRealtimeSafeProfile(typedV053(F.T53), profile, {}));
    assert(assertion && assertion.code === "air.assurance.profile_unsupported", String(assertion && assertion.message));
    value.assertRealtimeSafeProfile = { code: assertion.code };
    observedFailures.push({ code: "air.assurance.profile_unsupported", kind: "REFUSED" });
    cell("V53-ABI-67", "typed-v0.53 package / ART-T53 Wasm", "0.53 realtime session", value);
    return { value };
  });
  await vector("V53-ABI-68", () => {
    const value = {};
    for (const label of ["t53", "t53lo", "t53ln", "p02", "n08", "p06", "n22", "n39", "p10"]) {
      const r = acceptedSources.get(label);
      const end = 16 + r.built.memory.backingBytes;
      const module = new WebAssembly.Module(r.built.wasmBytes);
      assert(!WebAssembly.Module.imports(module).some((item) => item.kind === "memory"), `${label}: no memory import`);
      assert(!/memory\.grow/u.test(r.wat), `${label}: no memory.grow`);
      const addresses = [...r.wat.matchAll(/\(data \(i32\.const (\d+)\)/gu)].map((match) => Number(match[1]));
      const lines = r.wat.split("\n").map((line) => line.trim());
      lines.forEach((line, index) => {
        const set = /^local\.set \$[A-Za-z_][A-Za-z0-9_]*\$0$/u.exec(lines[index + 1] || "");
        const constant = /^i32\.const (\d+)$/u.exec(line);
        if (constant && set && r.source.includes(`${lines[index + 1].slice(11, -2)}: ptr`)) addresses.push(Number(constant[1]));
        if (line === "memory.fill") addresses.push(Number(/^i32\.const (\d+)$/u.exec(lines[index - 3])[1]));
      });
      for (const address of addresses) assert(address >= 16 && address < Math.max(end, 17), `${label}: address ${address} in [16, ${end})`);
      value[label] = { addresses, owned: [16, end] };
    }
    return { value };
  });
  await vector("V53-ABI-69", async () => {
    assert(![0, 1, -1].includes(WORD | 0), "the word as i32 is not 0, 1 or -1");
    const traps = {};
    for (const [name, result] of [["undefined", undefined], ["null", null], ["false", false], ["NaN", Number.NaN], ["true", true], ["minus_one", -1]]) {
      traps[name] = await trapAsync(() => WebAssembly.instantiate(bytes, { "air:contract": { "typed-v0.53.v1": () => result } }));
      assert(traps[name] && traps[name].name === "RuntimeError", `${name}: the handshake traps`);
    }
    const publicValues = [...Object.entries(air), ...Object.entries(require("../src/sdk"))];
    for (const [name, value] of publicValues) {
      assert(!/contract(?:function|word|factory)|typedv053contract/iu.test(name), `public export ${name}`);
      assert(value !== WORD, `public export ${name} holds the word`);
    }
    const binding = fs.readFileSync(path.join(ROOT, "src", "borrowed_memory_binding.js"), "utf8");
    const body = binding.slice(binding.indexOf("function typedAdmissionInstantiate("), binding.indexOf("function normalizeTypedInterfaceEntry("));
    assert(/const contractFunction = \(\) => \{/u.test(body) && /const importObject = /u.test(body), "a fresh contract function and import object per instantiation");
    return { value: { handshake_traps: traps, word: WORD } };
  });
  await vector("V53-ABI-70", async () => {
    await admitTypedV053Artifact({ record: t53.built, wasmBytes: bytes });
    const trace = [];
    const second = await admitTypedV053Artifact({ record: t53.built, trace, wasmBytes: bytes });
    await second.instantiate();
    for (const event of ["step1.trust", "step1.contract_id", "step3.owned_range", "step3.marker"]) assert(trace.includes(event), `(a) ${event} runs again`);
    const b = await admissionRefusal(() => admitTypedV053Artifact({ wasmBytes: bytes }), "air.abi.record_untrusted", 1);
    return { value: { a: trace, b } };
  });
  await vector("V53-ABI-71", async () => {
    const probe = wasmtime(["--version"]);
    assert.match(probe.stdout, /^wasmtime 44\.0\.1\b/u, `wasmtime 44.0.1 is required: ${probe.stdout || probe.stderr}`);
    const write = async (name, data) => {
      const file = path.join(tmp, name);
      fs.writeFileSync(file, typeof data === "string" ? Buffer.from(await watToWasm(data, name)) : data);
      return name;
    };
    const art = await write("art.wasm", bytes);
    const noguard = await write("noguard.wasm", await forge(t53.wat, "F-NOGUARD"));
    const stub = (value) => `(module (func (export "typed-v0.53.v1") (result i32) i32.const ${value}))`;
    const stub0 = await write("stub0.wasm", stub(0));
    const stubWord = await write("stubw.wasm", stub(WORD));
    const main = (address, value, pointer) => `(module (import "t" "memory" (memory 1)) (import "t" "f" (func $f (param i32 i32) (result i32))) (func (export "main") (result i32) i32.const ${address} i32.const ${value} i32.store i32.const ${pointer} i32.const 4 call $f))`;
    const mainE = await write("main_e.wasm", main(16, 5, 16));
    const mainF = await write("main_f.wasm", main(64, 41, 64));
    const cases = {
      a: wasmtime(["run", "--invoke", "f", art, "16", "4"]),
      b: wasmtime(["run", "-W", "unknown-imports-trap=y", "--invoke", "f", art, "16", "4"]),
      c: wasmtime(["run", "-W", "unknown-imports-default=y", "--invoke", "f", art, "16", "4"]),
      d: wasmtime(["run", "--preload", `air:contract=${stub0}`, "--invoke", "f", art, "16", "4"]),
      e: wasmtime(["run", "--preload", `air:contract=${stubWord}`, "--preload", `t=${art}`, "--invoke", "main", mainE]),
      f: wasmtime(["run", "--preload", `air:contract=${stubWord}`, "--preload", `t=${art}`, "--invoke", "main", mainF]),
      g: wasmtime(["run", "--preload", `air:contract=${stubWord}`, "--preload", `t=${noguard}`, "--invoke", "main", mainE])
    };
    assert(cases.a.status !== 0 && /unknown import: `air:contract::typed-v0\.53\.v1` has not been defined/u.test(cases.a.stderr), "(a) unknown import, no instance");
    assert(cases.b.status !== 0 && /failed to instantiate/u.test(cases.b.stderr) && /__air_v053_contract_start/u.test(cases.b.stderr), "(b) the trapping stub is called in the handshake");
    for (const tag of ["c", "d"]) assert(cases[tag].status !== 0 && /__air_v053_contract_start/u.test(cases[tag].stderr) && /unreachable/u.test(cases[tag].stderr), `(${tag}) unreachable in the handshake`);
    assert(cases.e.status !== 0 && /__air_borrow_failure/u.test(cases.e.stderr), "(e) guard trap");
    assert.equal(cases.f.stdout, "41", "(f) runs (41)");
    assert.equal(cases.g.stdout, "777", "(g) 777");
    const value = Object.fromEntries(Object.entries(cases).map(([tag, out]) => [tag, { status: out.status, stdout: out.stdout, trap_frame: (/<unknown>!(\S+)/u.exec(out.stderr) || [])[1] || null }]));
    cell("V53-ABI-71", "ART-T53 / F-NOGUARD", "wasmtime 44.0.1", value);
    return { value: { engine: probe.stdout, ...value } };
  });
}

// ---------------------------------------------------------------------------
// EACH_SLICE vectors re-run on the P0-08 corpus, and the reserved marker name.
async function sectionEachSlice() {
  await vector("P0-08-RESERVED-MARKER", async () => {
    // P8-R15: the typed-memory-v1 marker's export name is reserved (as the v1 name is).
    const source = mod(M, func("export func __air_abi_feature_typed_memory_v1() -> i32", ["%r: i32 = 0", "return %r"]));
    return { value: (await staticReject(source, "air.abi.borrowed_slice_interface_mismatch", 3)).outcome };
  });
  await vector("V53-FMT-01@P0-08", () => {
    // Every accepted source formats idempotently and keeps every E(e). P8-R25:
    // every ACCEPT fixture is canonical, except the formatter input
    // (V53-MEM-P08) and V53-MEM-P09, whose pinned text lists `run` before `raw`
    // (the formatter prints functions by name; TYPED_MEMORY.md §8).
    const p09Canonical = mod(M, func("export func raw() -> i32", ["%p: ptr = alloc_region 4", "store.i32 %p, 0, -4194303", "%f: f32 = load.f32 %p, 0",
      "%v: i32 = load.i32 %p, 0", FREE, "return %v"]), ...F.P09.split("\n\n").slice(1, 2).map((text) => text.trimEnd().split("\n")));
    let canonical = 0;
    for (const [, r] of acceptedSources) {
      const once = sp.formatSource(typedV053(r.source), GATED);
      assert.equal(sp.formatSource(typedV053(once), GATED), once, "idempotent");
      const summaries = [r.source, once].map((text) => {
        const analysis = wb.analyzeVerifiedTypedModule(typedV053(text));
        return Object.fromEntries([...analysis.entries].map(([name, entry]) => [name, wb.canonicalSummary(entry.value)]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
      });
      assert.deepEqual(summaries[1], summaries[0], "formatting keeps every E(e)");
      if (r.source === F.P08in) assert.equal(once, F.P08out);
      else if (r.source === F.P09) assert.equal(once, p09Canonical, "V53-MEM-P09 formats to its functions in name order");
      else {
        assert.equal(once, r.source, `${r.label}: the ACCEPT fixture is canonical`);
        canonical += 1;
      }
    }
    return { value: { canonical_fixtures: canonical, judged_by_idempotence: acceptedSources.size, not_canonical: { "V53-MEM-P09": "functions not in name order (run before raw)" } } };
  });
  await vector("V53-LSP-01@P0-08", () => {
    const file = path.join(tmp, "lsp01.air");
    fs.writeFileSync(file, pinned("N12"));
    const report = JSON.parse(runCli(["check", file, "--source-profile", V053, "--allow-candidate-profile", "--lsp-json"]).stdout);
    assert.equal(report.diagnostics[0].code, "air.memory.region_bounds_static");
    assert.equal(report.diagnostics[0].line, 5);
    return { value: { code: report.diagnostics[0].code, line: report.diagnostics[0].line, status: report.status } };
  });
  await vector("V53-LSP-02@P0-08", () => {
    const session = new AirLspSession({ allowCandidateProfile: true, sourceProfile: V053 });
    const checks = [];
    for (const key of ["N03", "N10", "N11", "N21", "N41v", "WB07", "PIPE05"]) {
      const thrown = capture(() => typedV053(F[key]));
      const [published] = session.handleMessage({ jsonrpc: "2.0", method: "textDocument/didOpen", params: { textDocument: { text: F[key], uri: `file://${path.join(tmp, `lsp02-${checks.length}.air`)}`, version: 1 } } });
      assert.equal(published.params.diagnostics[0].code, thrown.code, "err.code preserved");
      checks.push(thrown.code);
    }
    return { value: checks };
  });
  const inRegistry = (code) => EARLIER_CODE_REGISTRY.includes(code) || P0_08_CODE_REGISTRY.includes(code) || /^air\.borrow\./u.test(code);
  await vector("V53-DIAG-01@P0-08", () => {
    // The note is dev-side (the public projection mirrors src/ and the tests).
    const notePath = path.join(ROOT, "docs", "v0.53", "TYPED_MEMORY.md");
    if (fs.existsSync(notePath)) {
      const note = fs.readFileSync(notePath, "utf8");
      const section = note.slice(note.indexOf("## 5."), note.indexOf("## 6."));
      const listed = [...section.matchAll(/^\| `(air\.[a-z0-9_.]+)` \|/gmu)].map((match) => match[1]).sort();
      assert.deepEqual(listed, [...P0_08_CODE_REGISTRY].sort(), "the note's registry table lists exactly the P0-08 codes");
      for (const code of FROZEN_BORROW_CODES) assert(section.includes(`\`${code.slice("air.borrow.".length)}\``), `the note names the frozen ${code}`);
    }
    const hints = require("../src/diagnostics");
    const hintText = fs.readFileSync(path.join(ROOT, "src", "diagnostics.js"), "utf8");
    for (const code of P0_08_CODE_REGISTRY) assert(hintText.includes(`"${code}"`), `${code} has a hint`);
    for (const item of observedFailures) {
      assert(inRegistry(item.code), `${item.code} is in the registry`);
      if (item.kind === "STATIC_REJECT") assert(Number.isInteger(item.line), `${item.code} has a location`);
    }
    const seen = new Set(observedFailures.map((item) => item.code));
    for (const code of P0_08_EXERCISED) assert(seen.has(code), `${code} is exercised`);
    return { value: { failures_checked: observedFailures.length, hints: Object.keys(hints).length > 0, p0_08_codes: P0_08_CODE_REGISTRY.length } };
  });
  await vector("V53-DIAG-02@P0-08", async () => {
    // Deterministic fuzz of the P0-08 corpus: no raw TypeError, JS stack,
    // WABT text or engine error; a verified source always builds (R-COMP-3).
    let seed = 0x0f0808;
    const next = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed; };
    const ops = ["alloc_region 16", "alloc_region %n", "alloc_region %n max 64", "free_region %p", "load.i32 %p, 0", "store.i32 %p, 0, 1", "load.f32 %p, 4",
      "slice.from_region %p, 8", "slice.sub %s, 0, 4", "slice.len %s", "buffer.from_ptr %p", "buffer.load %b, 0", "buffer.store %b, 0, 1", "\"ab\"",
      "ptr", "slice", "buffer<i32,4>", "buffer<i32,0>", "borrowed_slice<readonly,len=4..4,align=4>", "-0", "+0", "%p", "%q", "16777217", ",", "max"];
    const corpus = Object.keys(PINS).map((key) => F[key]).filter((text) => Buffer.byteLength(text, "utf8") <= 4096);
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
        assert(typeof error.code === "string" && inRegistry(error.code), `unregistered or missing code ${error && error.code}: ${error && error.message}\n${source}`);
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
}

// ---------------------------------------------------------------------------
async function main() {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "air-v053-p008-"));
  const checkMem = {};
  const matrix = [];
  try {
    for (const key of Object.keys(PINS)) pinned(key);
    assert.equal(Object.keys(PINS).length, 93, "every generated fixture is pinned");
    for (const key of Object.keys(MEASURES)) assert(PINS[key], `${key}: measured fixtures are pinned`);
    await sectionRegions();
    await sectionBorrowed();
    await sectionChecks(checkMem);
    await sectionAbi(matrix);
    await sectionEachSlice();
  } finally {
    fs.rmSync(tmp, { force: true, recursive: true });
  }

  const outDir = process.env.AIR_P008_VECTOR_RESULTS_DIR;
  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "v053_memory.results.json"), `${JSON.stringify(results, null, 2)}\n`);
  }
  if (process.env.AIR_P008_CHECK_MEM_FILE) fs.writeFileSync(process.env.AIR_P008_CHECK_MEM_FILE, `${JSON.stringify(plain(checkMem), null, 2)}\n`);
  if (process.env.AIR_P008_ABI_MATRIX_FILE) fs.writeFileSync(process.env.AIR_P008_ABI_MATRIX_FILE, `${JSON.stringify(matrix, null, 2)}\n`);
  const passed = results.filter((item) => item.status === "PASS").length;
  const other = results.filter((item) => !["PASS", "FAIL"].includes(item.status)).map((item) => `${item.vector} ${item.status}`);
  if (failures.length) {
    for (const failure of failures) console.error(`not ok - ${failure}`);
    console.error(`typed-v0.53 P0-08 vectors: ${failures.length} FAIL, ${passed} PASS`);
    process.exit(1);
  }
  for (const item of results) console.log(`ok - ${item.vector} ${item.status}`);
  console.log(`typed-v0.53 P0-08 vectors: ${passed} PASS, ${other.length} other${other.length ? ` (${other.join(", ")})` : ""}`);
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
