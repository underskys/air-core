#!/usr/bin/env node
"use strict";

// typed-v0.53 P0-06 (AIR-0053-P0-06-0001): read-only scalar tables with O(1)
// lowering, internal structs and arrays with value semantics, lane-weighted
// WorkBound charging (CT-1 revision P0-06-AGG-1), the formatter, and the
// refusal of compact tables, tablegroups and pools. Every expected value below
// is copied from the R3.1 catalogue (VECTORS.md, sha256 f5353705..., AGG rows
// 310-327, V53-WB-H07 row 203) or the admitted P0-06 slice text R2
// (VECTORS_ADDITIONS.md; folder SHA256SUMS 8090cf23...; admission record
// 1f1d47a9... with its BINDING_ADDITION on P0-06-CHECK-O1), never from the
// output of the implementation under test. Fixture bytes come from the slice
// text's generator (tools/derive_p006.py), ported below and pinned by the
// byte counts, sha256 values and lines of its output
// (tool_outputs/derive_p006.out.txt). ACCEPT and RUNTIME_FAIL rows run through
// the verified builder and the generic runtime with the descriptor of the
// source signature; a STATIC_REJECT row is checked at every entrypoint that
// verifies (P4-R8). P0-06-SEP-WB is P0-06's own separation check (P6-R20) and
// P0-06-CHECK-O1 its O(1) evidence (P6-R5, P6-R19). Set
// AIR_P006_VECTOR_RESULTS_DIR=<dir> to write one canonical result record per
// vector, and AIR_P006_CHECK_O1_FILE=<file> to write the CHECK-O1 evidence.
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
const {
  buildVerifiedTypedModule,
  createVerifiedTypedRuntime,
  invokeVerifiedTypedExport,
  verifiedTypedAstNodeCount
} = require("../src/v052_verified_build");
const { lowerToWat, watToWasm } = require("../src/lower_wasm");

const ROOT = path.resolve(__dirname, "..");
const V053 = "typed-v0.53";
const GATED = Object.freeze({ allowCandidateProfile: true, sourceProfile: V053 });
const MAX_WAT = 4194304;
// R-DIAG-2: the codes typed-v0.53 emitted before P0-06 (as in
// test/v053_loops.test.js, with its P0-05 additions) and the P0-06 additions
// (docs/v0.53/P0_06_AGGREGATES.md §5): the two PROPOSED codes and the two
// index-domain identities (values 33 and 35) that a source reaches first here.
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
  "air.workbound.invalid_bound", "air.workbound.unknown_bound"
]);
const P0_06_CODE_REGISTRY = Object.freeze([
  "air.abi.export_type_unsupported", "air.array.index_out_of_range", "air.table.index_out_of_range", "air.table.readonly"
]);

// ---------------------------------------------------------------------------
// The slice text's generator (tools/derive_p006.py), ported line for line:
// two-space indentation per block level, one blank line between module items,
// LF, one trailing LF, lines numbered from the `module` line.
const HEAD = "module v53.agg";
function mod(...items) {
  const lines = [HEAD];
  for (const item of items) lines.push("", ...item);
  return `${lines.join("\n")}\n`;
}
const func = (header, body) => [`${header} {`, ...body.map((line) => `  ${line}`), "}"];
const RUN = func("export func run(i: i32) -> i32", ["return %i"]);
const P = ["struct P { x: i32, y: i32 }"];
const T2 = ["table t: i64[2] = [9007199254740993, 9223372036854775807]"];
const GET64 = (index) => func("export func get(i: i32) -> i64", [`%v: i64 = table.get t, ${index}`, "return %v"]);
const GET32 = func("export func get(i: i32) -> i32", ["%v: i32 = table.get t, %i", "return %v"]);
const tableLine = (name, n, values) => [`table ${name}: i32[${n}] = [${values.join(", ")}]`];
const GETX = (body) => func("export func run(i: i32) -> i32", body);
const STEP4 = func("func step4(acc: array<i32,4>) -> array<i32,4>", ["%b: array<i32,4> = %acc", "return %b"]);
const WB03 = (n) => mod(STEP4, func("export func run() -> i32", ["%s: array<i32,4> = array.new 1, 2, 3, 4",
  `%r: array<i32,4> = loop.fold @step4, %s, ${n}`, "%v: i32 = array.get %r, 0", "return %v"]));
const PS = ["%p0: P = struct.new 1, 2", "%p1: P = struct.new 3, 4", "%p2: P = struct.new 5, 6", "%ps: array<P,3> = array.new %p0, %p1, %p2"];
const Q = ["struct Q { o: option<i32>, a: array<i32,2> }"];
const A4 = "%a: array<i32,4> = array.new 1, 2, 3, 4";
const GETT = (name, type, table) => func(`export func ${name}(i: i32) -> ${type}`, [`%v: ${type} = table.get ${table}, %i`, "return %v"]);
const PX = (type) => func("export func px(i: i32) -> i32", [`%p: ${type} = struct.new %i, 2`, "%r: i32 = struct.get.x %p", "return %r"]);
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, index) => String(from + index));

const F = {
  P01: mod(T2, GET64("%i")),
  N01: mod(T2, GET64("2")),
  N03: mod(T2, func("export func get(i: i32) -> i64", ["table.set t, 0, 1", "%v: i64 = table.get t, %i", "return %v"])),
  P02: mod(tableLine("t", 65536, [...Array(65535).fill("0"), "65535"]), GET32),
  P02_16: mod(tableLine("t", 16, [...Array(15).fill("0"), "15"]), GET32),
  P04: mod(P, func("export func run(a: i32) -> i32", ["%p: P = struct.new 1, 2", "%q: P = struct.set.x %p, %a", "%r: i32 = struct.get.x %p", "return %r"])),
  P05: mod(func("export func run(i: i32) -> i32", [A4, "%v: i32 = array.get %a, %i", "return %v"])),
  N05: mod(["table xs: u8 = [0, 1]"], RUN),
  N06: mod(["tablegroup g len 2 {", "  a: i32 = [1, 2]", "}"], RUN),
  N07: mod(["pool p capacity 8 {", "}"], RUN),
  N08: mod(P, func("export func f(p: P) -> i32", ["%x: i32 = struct.get.x %p", "return %x"])),
  N09: mod(func("export func run(i: i32) -> i32", ["%a: array<i32,0> = array.new", "return %i"])),
  WB01: mod(func("export func f() -> i32", [A4, "%b: array<i32,4> = %a", "%v: i32 = array.get %b, 3", "return %v"])),
  WB02: mod(P, func("func swap(p: P) -> P", ["%x: i32 = struct.get.x %p", "%y: i32 = struct.get.y %p", "%q: P = struct.new %y, %x", "return %q"]),
    func("export func run(a: i32, b: i32) -> i32", ["%p: P = struct.new %a, %b", "%q: P = call @swap(%p)", "%r: i32 = struct.get.x %q", "return %r"])),
  WB03: WB03(3),
  WB04: WB03(0),
  P03: mod(["const BASE: i64 = 9007199254740993"], func("export func run(i: i32) -> i64", ["%v: i64 = i64.checked_add BASE, 0", "return %v"])),
  N04: mod(["const C: i32 = i32.wrapping_add 1, 2"], RUN),
  P06: {
    i: mod(P, func("export func run() -> i32", [...PS, "%q: P = array.get %ps, 2", "%r: i32 = struct.get.y %q", "return %r"])),
    ii: mod(P, func("export func run(i: i32) -> i32", [...PS, "%q: P = array.get %ps, %i", "%r: i32 = struct.get.y %q", "return %r"]))
  },
  P07: mod(func("export func run(i: i32) -> i32", [A4, "%b: array<i32,4> = array.set %a, %i, 9", "%x: i32 = array.get %a, %i",
    "%y: i32 = array.get %b, %i", "%s: i32 = i32.wrapping_add %x, %y", "return %s"])),
  P08: mod(Q, func("export func run(c: bool) -> i32", ["%arr: array<i32,2> = array.new 5, 6", "%q1: Q = struct.new option.none<i32>, %arr",
    "%q2: Q = if %c {", "  yield %q1", "} else {", "  %q3: Q = struct.set.o %q1, option.some<i32> 9", "  yield %q3", "}",
    "%b: array<i32,2> = struct.get.a %q2", "%v: i32 = array.get %b, 1", "return %v"])),
  P09: {
    in: [HEAD, "", "export func run(i: i32) -> i64 {", "  %v: i64 = table.get t, %i", "  return %v", "}", "",
      "table t :i64 [ 2 ] = [9007199254740993,9223372036854775807]", "", "struct P {x: i32,y: i32}", ""].join("\n"),
    out: mod(P, T2, func("export func run(i: i32) -> i64", ["%v: i64 = table.get t, %i", "return %v"]))
  },
  P09ii: {
    in: [HEAD, "", "export func run(i: i32) -> i32 {", "  %v: i32 = table.get z, %i", "  return %v", "}", "",
      "table z: i32[1] = [-0]", "table f: f64[2] = [-0.0,1.50]", "table b : bool[2]=[true,false]", ""].join("\n"),
    out: mod(["table b: bool[2] = [true, false]"], ["table f: f64[2] = [-0.0, 1.50]"], ["table z: i32[1] = [0]"],
      func("export func run(i: i32) -> i32", ["%v: i32 = table.get z, %i", "return %v"]))
  },
  N10ii: mod(T2, func("export func get(i: i32) -> i64", ["%k: i32 = i32.wrapping_add 1, 1", "%v: i64 = table.get t, %k", "return %v"])),
  N11: {
    i: mod(["table t: i32[0] = []"], RUN),
    ii: mod(["table t: i32[65537] = [0]"], RUN),
    iii: mod(func("export func run(i: i32) -> i32", ["%a: array<i32,65537> = array.new 0", "return %i"])),
    iv: mod(["struct W { a: array<array<i32,256>,257> }"], RUN),
    v: mod(["struct W { a: array<array<i32,256>,256> }"], RUN),
    vi: mod(["struct W { a: array<i32,65537> }"], RUN),
    vip: mod(["struct W { a: array<i32,65536> }"], RUN)
  },
  N12: {
    i: mod(["table t: i32[3] = [1, 2]"], RUN),
    ii: mod(["table t: i32[1] = [3000000000]"], RUN),
    iii: mod(["table t: i64[1] = [9223372036854775808]"], RUN),
    iv: mod(["table t: i32[1] = [true]"], RUN),
    v: mod(["table t: i32[1] = [1]"], ["table t: i32[1] = [2]"], RUN),
    vi: mod(["table t: u16[2] = [0, 1]"], RUN),
    vii: mod(["table t: i32[1] = [1]"], func("export func run(i: i32) -> i32", ["%v: i32 = table.get nope, %i", "return %v"])),
    viii: mod(["table t: i32[1] = [1]"], func("export func run(b: bool) -> i32", ["%v: i32 = table.get t, %b", "return %v"])),
    ip: mod(["table t: i32[3] = [1, 2, 3]"], RUN),
    vip: mod(["table t: i32[2] = [0, 1]"], RUN)
  },
  N13: {
    i: mod(["struct E { }"], RUN),
    ii: mod(["struct P { x: i32, x: i64 }"], RUN),
    iii: mod(["struct R { r: R }"], RUN),
    iv: mod(["struct R { a: array<R,2> }"], RUN),
    v: mod(P, GETX(["%p: P = struct.new 1, 2", "%v: i32 = struct.get.z %p", "return %v"])),
    vi: mod(P, GETX(["%p: P = struct.new 1", "return %i"])),
    vii: mod(GETX(["%a: array<i32,4> = array.new 1, 2, 3", "return %i"])),
    viii: mod(P, GETX(["%p: P = struct.new 1, true", "return %i"])),
    ix: mod(["enum Mode {", "  off = 0,", "}"], ["struct Mode { x: i32 }"], RUN),
    x: mod(["struct P { x: i32<0..10> }"], RUN),
    xi: mod(func("export func run(a: array<i32,2>) -> i32", ["%v: i32 = array.get %a, 0", "return %v"])),
    xii: mod(P, func("export func mk(i: i32) -> P", ["%p: P = struct.new %i, %i", "return %p"])),
    xiii: mod(P, func("func f(o: option<P>) -> i32", ["return 0"]), RUN),
    xiv: mod(["struct A { b: B }"], ["struct B { a: A }"], RUN),
    ip: mod(["struct E { x: i32 }"], RUN),
    iip: mod(["struct P { x: i32, y: i64 }"], RUN)
  },
  N14: {
    i: mod(GETX([A4, "%v: i32 = array.get %a, 4", "return %v"])),
    ii: mod(T2, func("export func get(i: i32) -> i64", ["%k: i32 = 2", "%v: i64 = table.get t, %k", "return %v"])),
    iii: mod(GETX([A4, "%b: array<i32,4> = array.set %a, -1, 0", "return %i"])),
    iv: mod(T2, GET64("-1")),
    v: mod(GETX([A4, "%v: i32 = array.get %a, -0", "return %v"])),
    vout: mod(GETX([A4, "%v: i32 = array.get %a, 0", "return %v"])),
    vi: mod(T2, GET64("-0")),
    viout: mod(T2, GET64("0")),
    vii: mod(T2, GET64("+0")),
    viii: mod(T2, GET64("-00"))
  },
  P05_4096: mod(func("export func run(i: i32) -> i32", [`%a: array<i32,4096> = array.new ${range(1, 4096).join(", ")}`, "%v: i32 = array.get %a, %i", "return %v"])),
  N05p: mod(["table xs: i32[2] = [0, 1]"], RUN),
  ARR1: mod(func("export func run(i: i32) -> i32", ["%a: array<i32,1> = array.new 0", "return %i"])),
  N10iii: mod(T2, func("export func get(i: i32<0..9>) -> i64", ["%v: i64 = table.get t, %i", "return %v"])),
  P09iii: {
    in: mod(PX("P"), ["struct S { m: Mode }", "struct P { x: i32, y: i32 }"], ["enum Mode {", "  on = 1,", "  off = 0,", "}"],
      ["table l: i64[2] = [-9223372036854775808, 9223372036854775807]", "table f: f32[3] = [16777217, -0.0, 0.1]", "table d: f64[2] = [1, -0.0]"],
      GETT("getl", "i64", "l"), GETT("getf", "f32", "f"), GETT("getd", "f64", "d")),
    out: mod(["enum Mode {", "  off = 0,", "  on = 1,", "}"], ["struct P { x: i32, y: i32 }"], ["struct S { m: v53.agg::Mode }"],
      ["table d: f64[2] = [1.0, -0.0]"], ["table f: f32[3] = [16777217.0, -0.0, 0.1]"],
      ["table l: i64[2] = [-9223372036854775808, 9223372036854775807]"], GETT("getd", "f64", "d"), GETT("getf", "f32", "f"),
      GETT("getl", "i64", "l"), PX("v53.agg::P"))
  }
};

// Bytes, sha256 and named line of every fixture, from
// tool_outputs/derive_p006.out.txt (generator order).
const PINS = Object.freeze({
  "P01": [150, "e38c375fbb1fe4687113e55d96c26a880f8a7a5e7a9d3ad91f0a3884b6b6dffd", 6], // V53-AGG-P01 / N02
  "N01": [149, "1a1ea2388644d6821b851944f537658604160a61a27c4ca21f442c34579b7d89", 6], // V53-AGG-N01
  "N03": [170, "cf8a1110a612875c7254a4ab18df4f3105c5cac5cd6efeae0682412c317c694f", 6], // V53-AGG-N03
  "P02": [196727, "54580bf55b1bac71b1695e335fdeb239a1a4475bae8a0563c103d781bac7e5cb", 6], // V53-AGG-P02 = V53-WB-H07, OD-P6-5 (a), N = 65536 (65535 zeros, then 65535)
  "P02_16": [161, "3a78e5408cbbc4aafd709cc810e9452c86731fe2d6b51eaeba08e4210f699986", 6], // V53-AGG-P02, OD-P6-5 (a), N = 16 (15 zeros, then 15)
  "P04": [176, "866e8f424c2513be287b1c0e9dd8023ffe3cdc2e9ae4aefbc244114919d3e024", 7], // V53-AGG-P04
  "P05": [134, "6ba920611d80b6a535cb02087b23b2438746a66400c947c3bcbcf06a3043246a", 5], // V53-AGG-P05 / N10
  "N05": [86, "4e1b24faa3c6ee68170bbd0507952ff23064fa73ba26b13bddce8f7c7af91f55", 3], // V53-AGG-N05
  "N06": [105, "1bd226ffb295a1670fe7f0c95a7d2c0910c8168976d5ae71647ffadd4568dde8", 3], // V53-AGG-N06
  "N07": [86, "433b20a018cc57f7d78c109e6ea05bd7f128ffcf28b9d850d7e09e55212293b5", 3], // V53-AGG-N07
  "N08": [116, "ffdd3c7ad06c07cb1bd6c7a2c93cb590418db6335c33bb698b20994311af40ac", 5], // V53-AGG-N08
  "N09": [94, "7bfeb29c641f9c5d14af0b0634947fede9732ef93ccadc368448ca42a0bc0f34", 4], // V53-AGG-N09
  "WB01": [149, "5e00479e5ffc3c58fc209f66ca3332fc8d0a68c83d001b88592f62dd141d5c68", 6], // V53-AGG-WB01 (MODEL; source form)
  "WB02": [303, "7810c7d5ae02d925c062a8c69d2b90c96c3aa7d625037d8849eb585748f5d894", 14], // V53-AGG-WB02
  "WB03": [261, "f4383a8f5d420ebb502e81d341640afb17ef23b59f9b411f09fd798162c4486d", 10], // V53-AGG-WB03
  "WB04": [261, "007a6682e1deb2670d48452099c83369d7e48da3abfecf822b9967bf0a2e1631", 10], // V53-AGG-WB04
  "P03": [135, "f7af7b6790a73b7445ec9701e846bde24c99d5abce0ed3d15403a990c126011a", 3], // V53-AGG-P03
  "N04": [101, "955a2815ea990066b388e6572ffe5beeb0fec40d70fa6de00447bf7d15d9fd35", 3], // V53-AGG-N04
  "P06.i": [266, "94a4e8209121ffff87eff19ef896ace9a9b2d0cf6d02ae0566252f7e217504e4", 10], // V53-AGG-P06 (i) static index (R3-N12 spelling)
  "P06.ii": [273, "cf22c7821b3a8eee0e4887355bf878ed533800e93140bdc3c826d6bc8887aa03", 10], // V53-AGG-P06 (ii) dynamic index
  "P07": [240, "64d5a01bf15f8aceb8de64678c019b9b6fe4e634c84fba510ad82fc50040b14d", 5], // V53-AGG-P07 (R3-N12 array.set)
  "P08": [371, "3b3a8d7653dffbe9ed0df1034e6716bd1b29833401489a16daed5892c9e9c403", 8], // V53-AGG-P08 (lanes, constructor operands, aggregate branch)
  "P09.in": [178, "27d248bafe5f6e9694da3565337ab51e3574c4823b35b287f41c0864ed79c2a0", 8], // V53-AGG-P09 formatter input (non-canonical)
  "P09.out": [179, "28898d867ba32ab68e0983cbab645c788cd1aefe63bc3b2718b682b271ca6587", 5], // V53-AGG-P09 canonical output (V53-FMT-01)
  "P09ii.in": [176, "775a5c3df7abb2ba5c53d172e0c61fd6bf96e136ab9197634c90a02a60900b38", 8], // V53-AGG-P09 (ii) formatter input (literal spellings)
  "P09ii.out": [180, "cb4fa89eac74fd3881522fea43bc6408443e773012a8a92cdbedad294c807465", 7], // V53-AGG-P09 (ii) canonical output
  "N10ii": [184, "265fb700b9e9801aae7c3ea9c54248975ca5140b8ef1df9c86915cce65c48986", 7], // V53-AGG-N10 (ii) index not statically known (SCALAR R-16)
  "N11.i": [85, "eefecd0be73e36a545140515e3ac91db4b530893bb625c4c1591375bee523dce", 3], // V53-AGG-N11 (i) table length 0
  "N11.ii": [90, "0cbf41333a89eb62816fd12a62c88345c2c5cd2eb73f9221f2266573f37f8e75", 3], // V53-AGG-N11 (ii) table length 65537
  "N11.iii": [100, "bb82c7fba32e66b9c148f3d74dfdbcb5d95c80d0a3a9c65cac40028c5a9aa0e8", 4], // V53-AGG-N11 (iii) array count 65537
  "N11.iv": [106, "9f4ac8caf471d786a6e1686f6889cc442acb770a3d808a24f840aa92e8e91df1", 3], // V53-AGG-N11 (iv) aggregate over the lane cap (OD-P6-6 (a)): 257 x 256 = 65792 lanes
  "N11.v": [106, "92aae4b80671dfc05e0dc5ff26bf0c37e60c01a8719f6ec82a6265db3af068bd", 3], // V53-AGG-N11 (v) control at the lane cap (OD-P6-6 (a)): 256 x 256 = 65536 lanes
  "N12.i": [89, "49ce760013b6064619310ed376e384a00ca921ebb9743417cb3dc0844e95069b", 3], // V53-AGG-N12 (i) literal count
  "N12.ii": [95, "1ce96fec0ead7f8b2f6267a66ed925c42070e905a665fa75ea208a00801e6e6d", 3], // V53-AGG-N12 (ii) i32 literal out of range
  "N12.iii": [104, "fc69b9f8d691d8d71a405fbad5baf72ba1de9c02a3af70cbde2b58521bd85bf0", 3], // V53-AGG-N12 (iii) i64 literal out of range
  "N12.iv": [89, "5c30389bfb9c38c1550080f9c668fe4d7fd28d41794be533f13fbdb04a5b63f0", 3], // V53-AGG-N12 (iv) literal of another kind
  "N12.v": [109, "92d485d0a504e211433c89a5d6f45851c8d9788a723136f2b70afa9c586db5e5", 5], // V53-AGG-N12 (v) duplicate table
  "N12.vi": [89, "b8435d7f4bf9bf594bf7882b549b22a01971dafeec1df640bf6e3a0748193184", 3], // V53-AGG-N12 (vi) compact element type with a length
  "N12.vii": [117, "388d7765b9c9300cbd492d5033f4c5b2e019bfeec3687d2eb0be9ed53b61e562", 6], // V53-AGG-N12 (vii) unknown table
  "N12.viii": [115, "3bdc160881af7fb358b15cc4212ffd90f55e3e9da9ffa1e119aa7fa280798cb8", 6], // V53-AGG-N12 (viii) index of another type
  "N13.i": [77, "795143ebb3a25fd74376dfc8cf9907e3ba74bc7eccbfdd2e7b409d61e2a33cfb", 3], // V53-AGG-N13 (i) struct without fields
  "N13.ii": [92, "39a7f301b251ecfe614ff8b037ab921c7061133bd3db282c222624d1e7beb419", 3], // V53-AGG-N13 (ii) duplicate field
  "N13.iii": [82, "9b3e00eb3bb8f3b0ee9ddd08b1ea85a3b32df3968d5c6c762cb396d611c0df78", 3], // V53-AGG-N13 (iii) direct recursion
  "N13.iv": [91, "e05f5707a91db54b6a2a12600896a0432c7012113ebc8f8622bcc978e7f8b4e5", 3], // V53-AGG-N13 (iv) recursion through an array
  "N13.v": [146, "388149c87b737a8193b9372661f6b33e7759d9a767d7ace011ec1d6b33320170", 7], // V53-AGG-N13 (v) unknown field
  "N13.vi": [115, "0a1c52df76811aa266a0ca3e86b3461c9e8896f94e971eadc57c927b43e37f24", 6], // V53-AGG-N13 (vi) struct.new operand count
  "N13.vii": [102, "de63b70192e4bf6b2859dbb5029273cf07cf3db742271c564813590f03e59987", 4], // V53-AGG-N13 (vii) array.new operand count
  "N13.viii": [121, "ad5557f7afa6b20c2cf404753a9389f618b81208aa7d90e3bb3573078bee765f", 6], // V53-AGG-N13 (viii) struct.new operand type
  "N13.ix": [113, "b1726a1c1d4c1f0da8f5c6ed583e36e4766b46438dee8053dc3dfc180c155f1d", 7], // V53-AGG-N13 (ix) duplicate type name
  "N13.x": [91, "c921955a9108e17cc2f3b716ddf85b3e147705580e30a1863cb460c6ae98bb4f", 3], // V53-AGG-N13 (x) refined field type (OD-P6-3 (a))
  "N13.xi": [100, "bfa71d0e86614cf5d978cf5d62b17210a9c28296c06a5409617f0eecf9485f88", 3], // V53-AGG-N13 (xi) array parameter at an export
  "N13.xii": [117, "08c26e58b4f4f744475ea018ddef08fccd7357cca0def5fe8966e2dc35415fe4", 5], // V53-AGG-N13 (xii) struct result at an export
  "N13.xiii": [136, "b5c706403f393e1443732ae80c87d5c9df33682b24c72d679891a8cf62ff0885", 5], // V53-AGG-N13 (xiii) aggregate option payload
  "N14.i": [133, "63f08b67f2e0a19d4cb20125d364b564fb98796ed8319cfae3ddde6b3942eabc", 5], // V53-AGG-N14 (i) static array index
  "N14.ii": [164, "5493f94f82594194ad569cd01645f864e512ca377413d7a6a6089f4a58752199", 7], // V53-AGG-N14 (ii) statically known table index
  "N14.iii": [146, "d3d95a6a57e08887c814ee57078de89b7f821c6457e6d02e67d0e25ad225bc1e", 5], // V53-AGG-N14 (iii) static array.set index
  "N14.iv": [150, "cbaa82622e469d67012a882f30017356df7f5f5ea990f5090aec33a18c48e076", 6], // V53-AGG-N14 (iv) negative literal table index
  "P05_4096": [23594, "f6efd2f5224575ca7663def791c1f76f096379354dba9610125a306311def3cc", 5], // V53-AGG-P05 comparison module, array<i32,4096> (P1-1; P6-R19)
  "N05p": [90, "c2a70f9dc3dab29f528a2685c22bb14d548f14fdc8a637df1eb7c26b313e181a", 3], // V53-AGG-N05 pair control (+): table xs: i32[2]
  "ARR1": [96, "6cd8037ac0edbe5a7f33fc440899fe1ca9fcb83589c5d72a17daa56441b7264d", 4], // V53-AGG-N09 and N11 (iii) pair control (+): array<i32,1>
  "N11.vi": [97, "5c5d008be4f98a03c63552245d708c91e137c4edf885e32e4ff35be0ba8ad434", 3], // V53-AGG-N11 (vi) array count 65537 in a struct field
  "N11.vip": [97, "ce6559a098cbeaff1e74ec46845617f3c5826dc6c9ca54fdce181266a81c3e33", 3], // V53-AGG-N11 (vi) pair control (+): array count 65536 in a struct field
  "N12.ip": [92, "e16e11d79a8081413a1869efbae5b5f538bba72d54021e5226904e66bbee5c8b", 3], // V53-AGG-N12 (i) pair control (+): three literals
  "N12.vip": [89, "0233d576475fd1f4b3b875b50404e735e3f58baeded75bf2e3b582b9299c4a39", 3], // V53-AGG-N12 (vi) pair control (+): element type i32
  "N13.ip": [84, "1255da6f2bd9f6bb4d5b8f661cb28e6bd46b1f71e6e9e94dd12abcd1267de821", 3], // V53-AGG-N13 (i) pair control (+): one field
  "N13.iip": [92, "4842b9914cad6d5efa5dc83cf9decf1f16571688170ad15011d84a22d994743c", 3], // V53-AGG-N13 (ii) pair control (+): distinct fields
  "N14.v": [134, "8d27fee571bada6e74afb45dc3db3321c43d592eaa6de5ae288e7df5fff7cb66", 5], // V53-AGG-N14 (v) control: array.get index -0
  "N14.vout": [133, "fd73428d337ec4f55fe7cc376757095146471798eb8b6ed3fe298f77660b04c2", 5], // V53-AGG-N14 (v) canonical output
  "N14.vi": [150, "cdf87832faf770b5b1e5e899e4f12ea7e855d8a035f56eefb0d3ee1e2737bddf", 6], // V53-AGG-N14 (vi) control: table.get index -0
  "N14.viout": [149, "5b2ad0630073520c7dc19f6b40fd707a8eec865a538c8033a33d4cdf7a2aaa60", 6], // V53-AGG-N14 (vi) canonical output
  "N14.vii": [150, "e23ef3ca629d2ead95fa0411ada5b71532355f99a8099a4945872520dc573a3a", 6], // V53-AGG-N14 (vii) index +0
  "N14.viii": [151, "4f6c74b269a514521dcfb610f21b72bd8a0cac80a958dee68047bb53edfe5cdc", 6], // V53-AGG-N14 (viii) index -00
  "N10iii": [156, "12e0c9b906289d24efa92c130be949ee38af8048a3979f7468461b971d4effe5", 6], // V53-AGG-N10 (iii) refined index: ingress check before the table check
  "N13.xiv": [101, "1e31b597cbbf4f888f323b38ca2b53d807fdbc3532ba59c07ead807456fcbb01", 3], // V53-AGG-N13 (xiv) mutual recursion
  "P09iii.in": [565, "8b8eeb45b2ccccc0ac7ad8e538958f34cc2fd3ee11a4080d7ec50dd2e1699c94", 18], // V53-AGG-P09 (iii) formatter input (enum, structs, float and i64 tables)
  "P09iii.out": [590, "bf2d5ee14c38e2d08aefc18a65eba388e1180c255c210c2eeec5c61dc3c9ea3c", 14] // V53-AGG-P09 (iii) canonical output
});

// P0-06-SEP-WB corpus (slice text P6-R20 item 1): the 76 distinct fixture
// texts, sorted by sha256 (the last section of derive_p006.out.txt).
const SEP_CORPUS_SHA256 = Object.freeze([
  "007a6682e1deb2670d48452099c83369d7e48da3abfecf822b9967bf0a2e1631", "0233d576475fd1f4b3b875b50404e735e3f58baeded75bf2e3b582b9299c4a39",
  "08c26e58b4f4f744475ea018ddef08fccd7357cca0def5fe8966e2dc35415fe4", "0a1c52df76811aa266a0ca3e86b3461c9e8896f94e971eadc57c927b43e37f24",
  "0cbf41333a89eb62816fd12a62c88345c2c5cd2eb73f9221f2266573f37f8e75", "1255da6f2bd9f6bb4d5b8f661cb28e6bd46b1f71e6e9e94dd12abcd1267de821",
  "12e0c9b906289d24efa92c130be949ee38af8048a3979f7468461b971d4effe5", "1a1ea2388644d6821b851944f537658604160a61a27c4ca21f442c34579b7d89",
  "1bd226ffb295a1670fe7f0c95a7d2c0910c8168976d5ae71647ffadd4568dde8", "1ce96fec0ead7f8b2f6267a66ed925c42070e905a665fa75ea208a00801e6e6d",
  "1e31b597cbbf4f888f323b38ca2b53d807fdbc3532ba59c07ead807456fcbb01", "265fb700b9e9801aae7c3ea9c54248975ca5140b8ef1df9c86915cce65c48986",
  "27d248bafe5f6e9694da3565337ab51e3574c4823b35b287f41c0864ed79c2a0", "28898d867ba32ab68e0983cbab645c788cd1aefe63bc3b2718b682b271ca6587",
  "388149c87b737a8193b9372661f6b33e7759d9a767d7ace011ec1d6b33320170", "388d7765b9c9300cbd492d5033f4c5b2e019bfeec3687d2eb0be9ed53b61e562",
  "39a7f301b251ecfe614ff8b037ab921c7061133bd3db282c222624d1e7beb419", "3a78e5408cbbc4aafd709cc810e9452c86731fe2d6b51eaeba08e4210f699986",
  "3b3a8d7653dffbe9ed0df1034e6716bd1b29833401489a16daed5892c9e9c403", "3bdc160881af7fb358b15cc4212ffd90f55e3e9da9ffa1e119aa7fa280798cb8",
  "433b20a018cc57f7d78c109e6ea05bd7f128ffcf28b9d850d7e09e55212293b5", "4842b9914cad6d5efa5dc83cf9decf1f16571688170ad15011d84a22d994743c",
  "49ce760013b6064619310ed376e384a00ca921ebb9743417cb3dc0844e95069b", "4e1b24faa3c6ee68170bbd0507952ff23064fa73ba26b13bddce8f7c7af91f55",
  "4f6c74b269a514521dcfb610f21b72bd8a0cac80a958dee68047bb53edfe5cdc", "54580bf55b1bac71b1695e335fdeb239a1a4475bae8a0563c103d781bac7e5cb",
  "5493f94f82594194ad569cd01645f864e512ca377413d7a6a6089f4a58752199", "5b2ad0630073520c7dc19f6b40fd707a8eec865a538c8033a33d4cdf7a2aaa60",
  "5c30389bfb9c38c1550080f9c668fe4d7fd28d41794be533f13fbdb04a5b63f0", "5c5d008be4f98a03c63552245d708c91e137c4edf885e32e4ff35be0ba8ad434",
  "5e00479e5ffc3c58fc209f66ca3332fc8d0a68c83d001b88592f62dd141d5c68", "63f08b67f2e0a19d4cb20125d364b564fb98796ed8319cfae3ddde6b3942eabc",
  "64d5a01bf15f8aceb8de64678c019b9b6fe4e634c84fba510ad82fc50040b14d", "6ba920611d80b6a535cb02087b23b2438746a66400c947c3bcbcf06a3043246a",
  "6cd8037ac0edbe5a7f33fc440899fe1ca9fcb83589c5d72a17daa56441b7264d", "775a5c3df7abb2ba5c53d172e0c61fd6bf96e136ab9197634c90a02a60900b38",
  "7810c7d5ae02d925c062a8c69d2b90c96c3aa7d625037d8849eb585748f5d894", "795143ebb3a25fd74376dfc8cf9907e3ba74bc7eccbfdd2e7b409d61e2a33cfb",
  "7bfeb29c641f9c5d14af0b0634947fede9732ef93ccadc368448ca42a0bc0f34", "866e8f424c2513be287b1c0e9dd8023ffe3cdc2e9ae4aefbc244114919d3e024",
  "8b8eeb45b2ccccc0ac7ad8e538958f34cc2fd3ee11a4080d7ec50dd2e1699c94", "8d27fee571bada6e74afb45dc3db3321c43d592eaa6de5ae288e7df5fff7cb66",
  "92aae4b80671dfc05e0dc5ff26bf0c37e60c01a8719f6ec82a6265db3af068bd", "92d485d0a504e211433c89a5d6f45851c8d9788a723136f2b70afa9c586db5e5",
  "94a4e8209121ffff87eff19ef896ace9a9b2d0cf6d02ae0566252f7e217504e4", "955a2815ea990066b388e6572ffe5beeb0fec40d70fa6de00447bf7d15d9fd35",
  "9b3e00eb3bb8f3b0ee9ddd08b1ea85a3b32df3968d5c6c762cb396d611c0df78", "9f4ac8caf471d786a6e1686f6889cc442acb770a3d808a24f840aa92e8e91df1",
  "ad5557f7afa6b20c2cf404753a9389f618b81208aa7d90e3bb3573078bee765f", "b1726a1c1d4c1f0da8f5c6ed583e36e4766b46438dee8053dc3dfc180c155f1d",
  "b5c706403f393e1443732ae80c87d5c9df33682b24c72d679891a8cf62ff0885", "b8435d7f4bf9bf594bf7882b549b22a01971dafeec1df640bf6e3a0748193184",
  "bb82c7fba32e66b9c148f3d74dfdbcb5d95c80d0a3a9c65cac40028c5a9aa0e8", "bf2d5ee14c38e2d08aefc18a65eba388e1180c255c210c2eeec5c61dc3c9ea3c",
  "bfa71d0e86614cf5d978cf5d62b17210a9c28296c06a5409617f0eecf9485f88", "c2a70f9dc3dab29f528a2685c22bb14d548f14fdc8a637df1eb7c26b313e181a",
  "c921955a9108e17cc2f3b716ddf85b3e147705580e30a1863cb460c6ae98bb4f", "cb4fa89eac74fd3881522fea43bc6408443e773012a8a92cdbedad294c807465",
  "cbaa82622e469d67012a882f30017356df7f5f5ea990f5090aec33a18c48e076", "cdf87832faf770b5b1e5e899e4f12ea7e855d8a035f56eefb0d3ee1e2737bddf",
  "ce6559a098cbeaff1e74ec46845617f3c5826dc6c9ca54fdce181266a81c3e33", "cf22c7821b3a8eee0e4887355bf878ed533800e93140bdc3c826d6bc8887aa03",
  "cf8a1110a612875c7254a4ab18df4f3105c5cac5cd6efeae0682412c317c694f", "d3d95a6a57e08887c814ee57078de89b7f821c6457e6d02e67d0e25ad225bc1e",
  "de63b70192e4bf6b2859dbb5029273cf07cf3db742271c564813590f03e59987", "e05f5707a91db54b6a2a12600896a0432c7012113ebc8f8622bcc978e7f8b4e5",
  "e16e11d79a8081413a1869efbae5b5f538bba72d54021e5226904e66bbee5c8b", "e23ef3ca629d2ead95fa0411ada5b71532355f99a8099a4945872520dc573a3a",
  "e38c375fbb1fe4687113e55d96c26a880f8a7a5e7a9d3ad91f0a3884b6b6dffd", "eefecd0be73e36a545140515e3ac91db4b530893bb625c4c1591375bee523dce",
  "f4383a8f5d420ebb502e81d341640afb17ef23b59f9b411f09fd798162c4486d", "f6efd2f5224575ca7663def791c1f76f096379354dba9610125a306311def3cc",
  "f7af7b6790a73b7445ec9701e846bde24c99d5abce0ed3d15403a990c126011a", "fc69b9f8d691d8d71a405fbad5baf72ba1de9c02a3af70cbde2b58521bd85bf0",
  "fd73428d337ec4f55fe7cc376757095146471798eb8b6ed3fe298f77660b04c2", "ffdd3c7ad06c07cb1bd6c7a2c93cb590418db6335c33bb698b20994311af40ac"
]);
// The P0-06-SEP-WB control thresholds (P6-R20 item 5): the largest real value
// of each dimension among the corpus modules that verify (tools/ct1_p006.py,
// check "P6-R20"): 4,098 steps (the array<i32,4096> module), 3 calls and 3
// iterations (V53-AGG-WB03).
const P06_MAXIMA = Object.freeze({ calls: "3", iterations: "3", steps: "4098" });
// P6-R20 item 3: PHASE_P06 = PHASE_P05.
const PHASE_P06 = Object.freeze(["air.call.recursion_rejected", "air.workbound.overflow", "air.workbound.unknown_bound",
  "air.workbound.invalid_bound", "air.workbound.missing_summary", "air.workbound.assertion_exceeded"]);
// The accepted base (P0-05), whose `src/` the pair characterization runs.
const BASE_COMMITS = ["498923178d30b63fbe7708dee2394e802a16a200", "0e735fab1510f5733375e7c05a59eabcb405f888"];

const results = [];
const failures = [];
const observedFailures = [];
const acceptedSources = new Set();

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
function runCli(args, timeoutMs = 60000) {
  const out = childProcess.spawnSync(process.execPath, [path.join(ROOT, "bin", "airc.js"), ...args], {
    cwd: ROOT, encoding: "utf8", killSignal: "SIGKILL", maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs
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
  air_abi_lane: "0.12", module_id: "v53.agg", schema: "air.typed-interface/0.12-candidate.1", types: [],
  exports: [{ function: "run", name: "run", parameters: [], return_type: "i32" }]
});

let tmp;
let fileCounter = 0;
const runtimeHost = createVerifiedTypedRuntime({ admit: async () => true });

// STATIC_REJECT at every entrypoint that verifies (P4-R8): SDK verify, CLI
// verify, CLI check --lsp-json, the LSP session, the builder and the runtime.
async function staticReject(source, code, line) {
  const outcomes = {};
  const sdk = capture(() => typedV053(source));
  assert(sdk, `SDK: expected ${code}, got VERIFIED`);
  assert(!(sdk instanceof TypeError) && !(sdk instanceof RangeError), String(sdk && sdk.stack));
  assert.equal(sdk.code, code, String(sdk.message));
  assert.match(String(sdk.message), new RegExp(`${code.replace(/\./g, "\\.")}:`));
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
// stated value or failure through both.
async function accepted(source, invocations, label) {
  const ast = typedV053(source, `${label}.air`);
  acceptedSources.add(source);
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
    outcomes[`${name}(${args.join(", ")})`] = viaBuilder;
  }
  return { ast, built, entrypoints: ["sdk_verify", "lowerToWat", "cli_verify", "builder", "runtime"], invocations: outcomes, wat };
}

// The adapter's value forms: an i32 is a JS number, an i64 `{ decimal, type }`.
const i64 = (decimal) => ({ value: { decimal, type: "i64" } });
const T33 = Object.freeze({ code: "air.table.index_out_of_range", failureReason: 33 });
const A35 = Object.freeze({ code: "air.array.index_out_of_range", failureReason: 35 });

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
function expectMeasures(source, expected) {
  const measures = measureTypedModule(parser.typedV053.parse(source, "measure.air"));
  const actual = Object.fromEntries(MEASURE_FIELDS.filter((field) => expected[field] !== undefined).map((field) => [field, measures[field]]));
  assert.deepEqual(actual, expected, "R-WB-15c measures (slice text P6-R18)");
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
// P0-06-CHECK-O1 (slice text P6-R5 parts 1-4, P6-R19; the admission record's
// BINDING_ADDITION narrows part 2). Part 1, extraction: the per-access
// sequence is the WAT of the one access statement, from the first instruction
// of its domain check (the first read of the index parameter `i`) through the
// store into its result local `%v`. Part 2, straight-line, with the
// instruction whitelist: local.get/set/tee, integer constants, integer
// arithmetic and comparisons, the domain check's `if`/`end`, the failure
// helper's call and `unreachable`, and exactly one load of the element width;
// every `if` opens a failure path (the helper's call, then `unreachable`, then
// its `end`). Part 3, same shape: equal after every integer immediate is
// replaced by one placeholder. Part 4, equal executed counts, by an
// instruction-counting run of the lowered module: a counter global is
// incremented before every instruction of the non-failing path (the
// sequence's instructions outside the failure paths, `end` excluded), and the
// counter is read after get(0) and get(N - 1) at both N.
const INTEGER_OP = /^(?:i32|i64)\.(?:const -?[0-9]+|add|sub|mul|and|or|xor|shl|shr_s|shr_u|eqz|eq|ne|lt_s|lt_u|gt_s|gt_u|le_s|le_u|ge_s|ge_u)$/u;

function accessSequence(wat, fnName) {
  const lines = functionWat(wat, fnName).split("\n");
  const start = lines.findIndex((line) => /^ {4}local\.get \$i\b/u.test(line));
  const end = lines.findIndex((line, index) => index > start && /^ {4}local\.set \$v\b/u.test(line));
  assert(start > 0 && end > start, `${fnName}: the access statement's sequence is found`);
  return lines.slice(start, end + 1).map((line) => line.trim());
}

function straightLine(sequence, helper, load) {
  const failures = [];
  let loads = 0;
  for (let index = 0; index < sequence.length; index += 1) {
    const line = sequence[index];
    if (line === "if") {
      if (sequence[index + 1] !== `call $${helper}` || sequence[index + 2] !== "unreachable" || sequence[index + 3] !== "end") {
        failures.push(`${index}: an if whose taken path is not the failure path`);
      }
      index += 3;
    } else if (line === load) {
      loads += 1;
    } else if (!(/^local\.(?:get|set|tee) \$[A-Za-z0-9_$]+$/u.test(line) || INTEGER_OP.test(line))) {
      failures.push(`${index}: '${line}' is not admitted in a per-access sequence`);
    }
  }
  if (loads !== 1) failures.push(`${loads} loads of the element width (${load}); exactly one is admitted`);
  return failures;
}

const normalized = (sequence) => sequence.map((line) => line.replace(/^((?:i32|i64)\.const) -?[0-9]+$/u, "$1 _"));

function nonFailingPath(sequence) {
  const path = [];
  for (let index = 0; index < sequence.length; index += 1) {
    if (sequence[index] === "if") {
      path.push(index);
      index += 3;
    } else {
      path.push(index);
    }
  }
  return path;
}

// The counting run: the lowered WAT with a counter increment before each
// instruction of the sequence's non-failing path.
async function countedRuns(wat, fnName, sequence, inputs, n) {
  const lines = wat.split("\n");
  const fnStart = lines.findIndex((line) => line.startsWith(`  (func $${fnName} `));
  const start = lines.findIndex((line, index) => index > fnStart && /^ {4}local\.get \$i\b/u.test(line));
  assert.deepEqual(lines.slice(start, start + sequence.length).map((line) => line.trim()), sequence, "the counted lines are the extracted sequence");
  const counted = new Set(nonFailingPath(sequence).map((offset) => start + offset));
  const out = [];
  lines.forEach((line, index) => {
    if (counted.has(index)) out.push("    global.get $__p006_count", "    i32.const 1", "    i32.add", "    global.set $__p006_count");
    out.push(line);
  });
  out.splice(1, 0, "  (global $__p006_count (export \"__p006_count\") (mut i32) (i32.const 0))");
  const module = new WebAssembly.Module(await watToWasm(out.join("\n"), "counted.wat"));
  const counts = {};
  for (const input of inputs) {
    const instance = new WebAssembly.Instance(module, {});
    instance.exports[fnName](input);
    counts[`${fnName}(${input}) at N=${n}`] = instance.exports.__p006_count.value;
  }
  return counts;
}

async function checkO1Of(label, small, large, fnName, helper, value) {
  const [a, b] = [small, large].map((item) => ({ ...item, sequence: accessSequence(item.wat, fnName) }));
  for (const item of [a, b]) {
    assert(item.wat.includes(`(func $${helper} i32.const ${value} global.set $__air_failure_reason unreachable)`), `${label}: the failure helper raises ${value}`);
  }
  const part2 = { [`N=${a.n}`]: straightLine(a.sequence, helper, "i32.load"), [`N=${b.n}`]: straightLine(b.sequence, helper, "i32.load") };
  for (const [key, problems] of Object.entries(part2)) assert.deepEqual(problems, [], `${label} part 2 at ${key}`);
  assert.deepEqual(normalized(a.sequence), normalized(b.sequence), `${label} part 3: the same normalized shape`);
  assert.equal(a.sequence.length, b.sequence.length);
  const differingImmediates = a.sequence.flatMap((line, index) => (line === b.sequence[index] ? [] : [{ index, [`N=${a.n}`]: line, [`N=${b.n}`]: b.sequence[index] }]));
  for (const item of differingImmediates) assert.match(item[`N=${a.n}`], /^i32\.const -?[0-9]+$/u, `${label}: only integer immediates differ`);
  const staticCount = nonFailingPath(a.sequence).length;
  const counts = {
    ...(await countedRuns(a.wat, fnName, a.sequence, [0, a.n - 1], a.n)),
    ...(await countedRuns(b.wat, fnName, b.sequence, [0, b.n - 1], b.n))
  };
  assert.equal(Object.keys(counts).length, 4, `${label} part 4: four counted runs`);
  assert.equal(new Set(Object.values(counts)).size, 1, `${label} part 4: four equal executed counts ${JSON.stringify(counts)}`);
  assert.equal(Object.values(counts)[0], staticCount, `${label} part 4: the counted run equals the non-failing path's length`);
  return {
    part1_extraction: "from the first `local.get $i` (the domain check's first instruction) through `local.set $v` (the store into the result local)",
    part2_straight_line: { failure_helper: `$${helper} (sets ${value})`, problems: part2, whitelist: "local.get/set/tee, integer constants, integer arithmetic and comparisons, if/end of the domain check, the failure call and unreachable, exactly one i32.load" },
    part3_same_shape: { differing_immediates: differingImmediates, normalized: normalized(a.sequence) },
    part4_executed_counts: { counts, method: "instruction-counting run: a counter increment before each non-failing-path instruction of the sequence (end excluded), read after each call", non_failing_path_length: staticCount },
    raw: { [`N=${a.n}`]: a.sequence, [`N=${b.n}`]: b.sequence }
  };
}

// ---------------------------------------------------------------------------
// P0-06-SEP-WB (slice text P6-R20; the P0-05 P5-R13b method). Each corpus
// source is verified with the real WorkBound phase, with the phase disabled
// (an empty `status: "ok"` analysis) and with an outcome-preserving stub
// (+7919 steps, +13 calls, +17 iterations on every `ok` summary; no corpus
// text declares `work`, so every dimension is perturbed).
const SEP_COMPARE = `"use strict";
const fs = require("fs");
const path = require("path");
const [srcDir, corpusFile] = process.argv.slice(2);
const r = (m) => require(path.join(srcDir, m));
const sp = r("source_profile.js");
const verifier = r("verifier.js");
const wb = r("workbound.js");
const PHASE_P06 = new Set(${JSON.stringify(PHASE_P06)});
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
    return { verdict: "VERIFIED" };
  } catch (error) {
    return { code: error.code || null, cyclePath: error.cyclePath || null, disposition: error.disposition || null, line: error.loc && error.loc.line || null, message: String(error.message), verdict: "REJECTED" };
  } finally {
    wb.analyzeVerifiedTypedModule = real;
  }
}
const differences = [];
const counts = { phaseRejections: 0, rejected: 0, sources: 0, verified: 0, workSources: 0 };
for (const line of fs.readFileSync(corpusFile, "utf8").split("\\n").filter(Boolean)) {
  const entry = JSON.parse(line);
  counts.sources += 1;
  if (/^work[\\s{]/mu.test(entry.source)) counts.workSources += 1;
  const got = { disabled: outcome(entry, "disabled"), real: outcome(entry, "real"), stubbed: outcome(entry, "stubbed") };
  const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  const phase = got.real.verdict === "REJECTED" && PHASE_P06.has(got.real.code);
  counts[got.real.verdict === "VERIFIED" ? "verified" : "rejected"] += 1;
  if (phase) counts.phaseRejections += 1;
  if (!same(got.stubbed, got.real)) differences.push({ got, mode: "stubbed", sha256: entry.sha256 });
  if (phase ? got.disabled.verdict !== "VERIFIED" : !same(got.disabled, got.real)) differences.push({ got, mode: "disabled", sha256: entry.sha256 });
}
const exportNames = [...Object.keys(verifier), ...Object.keys(verifier.typedV053 || {})];
process.stdout.write(JSON.stringify({ budgetOrGrantExports: exportNames.filter((name) => /budget|grant|admi/iu.test(name)), counts, differenceCount: differences.length, differences: differences.slice(0, 80), unchangedAsts }));
`;

// Controls (P6-R20 item 5): each mutant is applied to a scratch copy of src/,
// never to the repository's src/, and must make the comparison report at
// least one difference.
const PHASE_OK_ANCHOR = "  if (analysis.status === \"ok\") {\n    verifyV053WorkAssertion(mod, analysis);\n    return;\n  }";
function thresholdMutant(dimension) {
  return PHASE_OK_ANCHOR.replace("    return;", [
    "    if (!mod.work) for (const fn of mod.functions || []) {",
    "      const entry = fn.exported && analysis.entries instanceof Map ? analysis.entries.get(fn.name) : null;",
    `      if (entry && entry.ok && entry.value.${dimension} > ${P06_MAXIMA[dimension]}n) throw new VerificationError("air.workbound.assertion_exceeded: mutant threshold on ${dimension}", fn.loc);`,
    "    }",
    "    return;"
  ].join("\n"));
}
// C6: table.get's static domain check reads the WorkBound summary: a function
// with a table.get is rejected when E(e).steps exceeds 2.
const C6_REPLACEMENT = PHASE_OK_ANCHOR.replace("    verifyV053WorkAssertion(mod, analysis);", [
  "    for (const fn of mod.functions || []) {",
  "      const reads = (fn.statements || []).some((statement) => statement && statement.value && statement.value.op === \"table.get\");",
  "      const entry = fn.exported && analysis.entries instanceof Map ? analysis.entries.get(fn.name) : null;",
  "      if (reads && entry && entry.ok && entry.value.steps > 2n) throw new VerificationError(\"air.table.index_out_of_range: mutant reads E(e).steps\", fn.loc);",
  "    }",
  "    verifyV053WorkAssertion(mod, analysis);"
].join("\n"));
const MUTANTS = Object.freeze({
  C2: { anchor: PHASE_OK_ANCHOR, description: `reject a module without work when E(e).steps > ${P06_MAXIMA.steps}`, replacement: thresholdMutant("steps") },
  C3: { anchor: PHASE_OK_ANCHOR, description: `reject a module without work when E(e).calls > ${P06_MAXIMA.calls}`, replacement: thresholdMutant("calls") },
  C4: { anchor: PHASE_OK_ANCHOR, description: `reject a module without work when E(e).iterations > ${P06_MAXIMA.iterations}`, replacement: thresholdMutant("iterations") },
  C6: { anchor: PHASE_OK_ANCHOR, description: "table.get's static domain check reads the WorkBound summary (reject when E(e).steps > 2)", replacement: C6_REPLACEMENT }
});

// ---------------------------------------------------------------------------
// Pair characterization (VECTORS_ADDITIONS.md "How to read", review P2-2): a
// negative that the accepted base already rejects the expected way is
// discriminating only together with its control. The base src/ (P0-05,
// 49892317 / 0e735fab) runs from git objects in a bounded child process.
function baseVerdicts(keys) {
  const dir = path.join(tmp, "p006_base");
  let commit = null;
  for (const candidate of BASE_COMMITS) {
    if (childProcess.spawnSync("git", ["cat-file", "-e", `${candidate}^{commit}`], { cwd: ROOT }).status === 0) { commit = candidate; break; }
  }
  assert(commit, "the accepted P0-06 base commit is not in this repository");
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

// ---------------------------------------------------------------------------
async function main() {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "air-v053-p006-"));
  const checkO1 = {};
  try {
    for (const key of Object.keys(PINS)) pinned(key);
    assert.equal(Object.keys(PINS).length, 76, "every generated fixture is pinned");

    // ------------------------------------------------------------------
    // AGG — R3.1 rows (VECTORS.md 310-327) with the R2 row amendments (§3).
    const p01 = pinned("P01");
    await vector("V53-AGG-P01", async () => {
      const run = await accepted(p01, [["get", [0], i64("9007199254740993")], ["get", [1], i64("9223372036854775807")]], "p01");
      return { value: { "E(get)": expectE(run.built, "get", 2), invocations: run.invocations, line: lineOf("P01"), measures: expectMeasures(p01, { analysis_units: 5, decls: 2, stmts: 2 }) }, sourceDigest: sha256(p01) };
    });
    await vector("V53-AGG-N02", async () => {
      const run = await accepted(p01, [["get", [2], T33], ["get", [-1], T33], ["get", [2147483647], T33], ["get", [-2147483648], T33]], "n02");
      return { value: { invocations: run.invocations }, sourceDigest: sha256(p01) };
    });
    await vector("V53-AGG-N01", async () => ({ value: (await staticReject(pinned("N01"), "air.table.index_out_of_range", lineOf("N01"))).outcome }));
    await vector("V53-AGG-N03", async () => ({ value: (await staticReject(pinned("N03"), "air.table.readonly", lineOf("N03"))).outcome }));
    const p02 = pinned("P02");
    const p02small = pinned("P02_16");
    let p02Run;
    let p02SmallRun;
    await vector("V53-AGG-P02", async () => {
      p02Run = await accepted(p02, [["get", [65535], { value: 65535 }], ["get", [0], { value: 0 }], ["get", [65536], T33]], "p02");
      p02SmallRun = await accepted(p02small, [["get", [15], { value: 15 }]], "p02_16");
      // P6-R24: the intake node count does not depend on N.
      const intake = [p02, p02small].map((source) => verifiedTypedAstNodeCount(parser.typedV053.parse(source, "intake.air")));
      assert.equal(intake[0], intake[1], "the intake node count is independent of N");
      return {
        value: {
          "E(get) N=16": expectE(p02SmallRun.built, "get", 2),
          "E(get) N=65536": expectE(p02Run.built, "get", 2),
          bytes: Buffer.byteLength(p02, "utf8"),
          intake_ast_nodes: { "N=16": intake[1], "N=65536": intake[0] },
          invocations: { "N=16": p02SmallRun.invocations, "N=65536": p02Run.invocations },
          measures: expectMeasures(p02, { analysis_units: 5, decls: 2, stmts: 2 })
        },
        sourceDigest: sha256(p02)
      };
    });
    const p04 = pinned("P04");
    await vector("V53-AGG-P04", async () => {
      const run = await accepted(p04, [["run", [7], { value: 1 }]], "p04");
      return { value: { "E(run)": expectE(run.built, "run", 7), invocations: run.invocations, measures: expectMeasures(p04, { analysis_units: 7, decls: 2, stmts: 4 }) }, sourceDigest: sha256(p04) };
    });
    const p05 = pinned("P05");
    let p05Run;
    await vector("V53-AGG-P05", async () => {
      p05Run = await accepted(p05, [["run", [3], { value: 4 }], ["run", [0], { value: 1 }], ["run", [4], A35]], "p05");
      return { value: { "E(run)": expectE(p05Run.built, "run", 6), invocations: p05Run.invocations, measures: expectMeasures(p05, { analysis_units: 5, decls: 1, stmts: 3 }) }, sourceDigest: sha256(p05) };
    });
    const control = async (key, label, steps = 1) => {
      const source = pinned(key);
      const run = await accepted(source, [["run", [5], { value: 5 }]], label);
      return { "E(run)": expectE(run.built, "run", steps), invocations: run.invocations, verdict: "VERIFIED" };
    };
    await vector("V53-AGG-N05", async () => ({
      value: { control_plus: await control("N05p", "n05p"), negative: (await staticReject(pinned("N05"), "air.v051.typed_syntax_invalid", lineOf("N05"))).outcome }
    }));
    await vector("V53-AGG-N06", async () => ({ value: (await staticReject(pinned("N06"), "air.v051.typed_syntax_invalid", lineOf("N06"))).outcome }));
    await vector("V53-AGG-N07", async () => ({ value: (await staticReject(pinned("N07"), "air.v051.typed_syntax_invalid", lineOf("N07"))).outcome }));
    await vector("V53-AGG-N08", async () => ({ value: (await staticReject(pinned("N08"), "air.abi.export_type_unsupported", lineOf("N08"))).outcome }));
    await vector("V53-AGG-N09", async () => ({
      value: { control_plus: await control("ARR1", "arr1", 2), negative: (await staticReject(pinned("N09"), "air.v051.type_reference_invalid", lineOf("N09"))).outcome }
    }));
    const wb01 = pinned("WB01");
    await vector("V53-AGG-WB01", async () => {
      const run = await accepted(wb01, [["f", [], { value: 4 }]], "wb01");
      // INTERNAL (MODEL): one source statement is not constant work. The
      // composition tree charges `%b: array<i32,4> = %a` (line 5) one
      // aggregate.transfer of 4 lanes, not one statement.scalar.
      const model = wb.typedV051Model(parser.typedV053.parse(wb01, "wb01.air"));
      const rows = [];
      const stack = [model.functions[0].body];
      while (stack.length) {
        const item = stack.pop();
        if (item.op === "row") rows.push({ construct: item.construct, lanes: item.lanes === undefined ? undefined : String(item.lanes), line: item.loc.line });
        stack.push(...item.children);
      }
      const assignment = rows.filter((item) => item.line === 5);
      assert.deepEqual(assignment, [{ construct: "aggregate.transfer", lanes: "4", line: 5 }], "the assignment is one transfer of 4 lanes");
      return { value: { "E(f)": expectE(run.built, "f", 10), assignment_rows: assignment, invocations: run.invocations, measures: expectMeasures(wb01, { analysis_units: 6, decls: 1, stmts: 4 }) }, sourceDigest: sha256(wb01) };
    });
    const wb02 = pinned("WB02");
    await vector("V53-AGG-WB02", async () => {
      const run = await accepted(wb02, [["run", [3, 4], { value: 4 }]], "wb02");
      return {
        value: { "B(swap)": expectB(run.built, "swap", 7), "E(run)": expectE(run.built, "run", 14, 1), invocations: run.invocations, measures: expectMeasures(wb02, { analysis_units: 13, call_sites: 1, decls: 3, stmts: 8 }) },
        sourceDigest: sha256(wb02)
      };
    });
    const wb03 = pinned("WB03");
    await vector("V53-AGG-WB03", async () => {
      const run = await accepted(wb03, [["run", [], { value: 1 }]], "wb03");
      return {
        value: { "B(step4)": expectB(run.built, "step4", 9), "E(run)": expectE(run.built, "run", 56, 3, 3), invocations: run.invocations, measures: expectMeasures(wb03, { analysis_units: 10, callback_refs: 1, decls: 2, stmts: 6 }) },
        sourceDigest: sha256(wb03)
      };
    });
    const wb04 = pinned("WB04");
    await vector("V53-AGG-WB04", async () => {
      const run = await accepted(wb04, [["run", [], { value: 1 }]], "wb04");
      return { value: { "E(run)": expectE(run.built, "run", 11), invocations: run.invocations }, sourceDigest: sha256(wb04) };
    });

    // ------------------------------------------------------------------
    // P0-06-CHECK-O1 (P6-R5 for table.get, P6-R19 for a dynamic array.get).
    await vector("P0-06-CHECK-O1", async () => {
      assert(p02Run && p02SmallRun && p05Run, "V53-AGG-P02 and P05 ran first");
      const p054096 = pinned("P05_4096");
      const large = await accepted(p054096, [["run", [0], { value: 1 }], ["run", [4095], { value: 4096 }], ["run", [4096], A35]], "p05_4096");
      checkO1.table = await checkO1Of("table.get (V53-AGG-P02)", { n: 16, wat: p02SmallRun.wat }, { n: 65536, wat: p02Run.wat }, "get", "__air_v053_table_index_out_of_range", 33);
      checkO1.array = await checkO1Of("array.get (V53-AGG-P05)", { n: 4, wat: p05Run.wat }, { n: 4096, wat: large.wat }, "run", "__air_v053_array_index_out_of_range", 35);
      checkO1.array.comparison_module = { "E(run)": expectE(large.built, "run", 4098), invocations: large.invocations, measures: expectMeasures(p054096, { analysis_units: 5, decls: 1, stmts: 3 }) };
      // No compare chain and no br_table anywhere in the four functions.
      for (const wat of [p02SmallRun.wat, p02Run.wat, p05Run.wat, large.wat]) assert.doesNotMatch(wat, /br_table|^\s+loop$/mu, "no compare chain, br_table or loop");
      // The checker's own controls: each forbidden form fails part 2.
      const helper = "__air_v053_table_index_out_of_range";
      const base = accessSequence(p02SmallRun.wat, "get");
      const loadAt = base.indexOf("i32.load");
      const controls = {
        br_table: [...base.slice(0, loadAt), "br_table 0 1", ...base.slice(loadAt)],
        compare_chain: [...base.slice(0, loadAt), "local.get $i$0", "i32.const 1", "i32.eq", "if", "i32.const 7", "local.set $v$0", "end", ...base.slice(loadAt)],
        loop: [...base.slice(0, loadAt), "loop", "br_if 0", "end", ...base.slice(loadAt)],
        memory_copy: [...base.slice(0, loadAt), "i32.const 0", "i32.const 0", "i32.const 4", "memory.copy", ...base.slice(loadAt)],
        second_load: [...base.slice(0, loadAt), "i32.const 0", "i32.load", "local.set $v$0", ...base.slice(loadAt)]
      };
      checkO1.checker_controls = Object.fromEntries(Object.entries(controls).map(([name, sequence]) => {
        const problems = straightLine(sequence, helper, "i32.load");
        assert(problems.length > 0, `${name} fails part 2`);
        return [name, problems];
      }));
      return { value: checkO1 };
    });
    await vector("V53-WB-H07", () => {
      // = V53-AGG-P02 (R3.1 row 203): per-access cost 1, and the per-access
      // lowered code is independent of N (P0-06-CHECK-O1 for table.get).
      assert(checkO1.table, "P0-06-CHECK-O1 ran first");
      const tree = wb.typedV051Model(parser.typedV053.parse(p02, "h07.air")).functions[0].body;
      const access = [];
      const stack = [tree];
      while (stack.length) {
        const item = stack.pop();
        if (item.op === "row" && item.construct === "aggregate.access") access.push(item.loc.line);
        stack.push(...item.children);
      }
      assert.deepEqual(access, [6], "the access is one aggregate.access row (steps 1) at line 6");
      return { value: { "E(get)": expectE(p02Run.built, "get", 2), check_o1: "PASS (table.get)", per_access_rows: ["aggregate.access"] }, sourceDigest: sha256(p02) };
    });

    // ------------------------------------------------------------------
    // The R2 additions (VECTORS_ADDITIONS.md §2).
    await vector("V53-AGG-P06", async () => {
      const i = await accepted(pinned("P06.i"), [["run", [], { value: 6 }]], "p06i");
      const ii = await accepted(pinned("P06.ii"), [["run", [2], { value: 6 }], ["run", [0], { value: 2 }], ["run", [3], A35]], "p06ii");
      const measures = { analysis_units: 10, call_sites: 0, callback_refs: 0, decls: 2, nesting_depth: 1, stmts: 7 };
      return {
        value: {
          i: { "E(run)": expectE(i.built, "run", 17), invocations: i.invocations, measures: expectMeasures(F.P06.i, measures) },
          ii: { "E(run)": expectE(ii.built, "run", 17), invocations: ii.invocations, measures: expectMeasures(F.P06.ii, measures) }
        }
      };
    });
    const p07 = pinned("P07");
    let p07Run;
    await vector("V53-AGG-P07", async () => {
      p07Run = await accepted(p07, [["run", [1], { value: 11 }], ["run", [3], { value: 13 }], ["run", [4], A35]], "p07");
      return { value: { "E(run)": expectE(p07Run.built, "run", 13), invocations: p07Run.invocations, measures: expectMeasures(p07, { analysis_units: 8, call_sites: 0, callback_refs: 0, decls: 1, nesting_depth: 1, stmts: 6 }) }, sourceDigest: sha256(p07) };
    });
    const p08 = pinned("P08");
    await vector("V53-AGG-P08", async () => {
      const run = await accepted(p08, [["run", [true], { value: 6 }], ["run", [false], { value: 6 }]], "p08");
      return { value: { "E(run)": expectE(run.built, "run", 24), invocations: run.invocations, measures: expectMeasures(p08, { analysis_units: 12, call_sites: 0, callback_refs: 0, decls: 2, nesting_depth: 2, stmts: 9 }) }, sourceDigest: sha256(p08) };
    });
    await vector("V53-AGG-P09", async () => {
      const value = {};
      const p09 = { in: pinned("P09.in"), out: pinned("P09.out") };
      value.i = { format: expectFormat(p09.in, p09.out) };
      for (const [name, source] of Object.entries(p09)) {
        const run = await accepted(source, [["run", [0], i64("9007199254740993")]], `p09_${name}`);
        value.i[name] = { "E(run)": expectE(run.built, "run", 2), invocations: run.invocations, measures: expectMeasures(source, { analysis_units: 6, decls: 3, stmts: 2 }) };
      }
      const p09ii = { in: pinned("P09ii.in"), out: pinned("P09ii.out") };
      value.ii = { format: expectFormat(p09ii.in, p09ii.out) };
      for (const [name, source] of Object.entries(p09ii)) {
        const run = await accepted(source, [["run", [0], { value: 0 }]], `p09ii_${name}`);
        value.ii[name] = { "E(run)": expectE(run.built, "run", 2), invocations: run.invocations, measures: expectMeasures(source, { analysis_units: 7, decls: 4, stmts: 2 }) };
      }
      const p09iii = { in: pinned("P09iii.in"), out: pinned("P09iii.out") };
      value.iii = { format: expectFormat(p09iii.in, p09iii.out) };
      for (const [name, source] of Object.entries(p09iii)) {
        const run = await accepted(source, [["getl", [2], T33], ["px", [7], { value: 7 }],
          ["getl", [0], i64("-9223372036854775808")], ["getl", [1], i64("9223372036854775807")]], `p09iii_${name}`);
        // The runtime reads of P6-R3 as numbers: one fresh instance per read.
        const read = (fn, index) => rawExports(run.built)[fn](index);
        const reads = { "getd(0)": read("getd", 0), "getd(1)": read("getd", 1), "getf(0)": read("getf", 0), "getf(1)": read("getf", 1), "getf(2)": read("getf", 2), "getl(0)": read("getl", 0), "getl(1)": read("getl", 1) };
        assert.equal(reads["getf(0)"], 16777216, "f32 rounds 16777217 once, ties-to-even");
        assert(Object.is(reads["getf(1)"], -0), "getf(1) is -0 (sign bit set)");
        assert.equal(reads["getf(2)"], 0.10000000149011612, "the f32 nearest 0.1");
        assert.equal(reads["getd(0)"], 1);
        assert(Object.is(reads["getd(1)"], -0), "getd(1) is -0");
        assert.equal(reads["getl(0)"], -9223372036854775808n);
        assert.equal(reads["getl(1)"], 9223372036854775807n);
        value.iii[name] = {
          "E(getd)": expectE(run.built, "getd", 2), "E(getf)": expectE(run.built, "getf", 2), "E(getl)": expectE(run.built, "getl", 2), "E(px)": expectE(run.built, "px", 4),
          invocations: run.invocations, measures: expectMeasures(source, { analysis_units: 20, decls: 10, stmts: 9 }), runtime_reads: reads
        };
      }
      return { value };
    });
    await vector("V53-AGG-N10", async () => {
      const i = await accepted(p05, [["run", [-1], A35], ["run", [-2147483648], A35]], "n10i");
      const n10ii = pinned("N10ii");
      const ii = await accepted(n10ii, [["get", [0], T33], ["get", [1], T33], ["get", [-7], T33], ["get", [2147483647], T33]], "n10ii");
      const n10iii = pinned("N10iii");
      const iii = await accepted(n10iii, [["get", [5], T33], ["get", [10], { code: "air.refinement.ingress_out_of_range", failureReason: 16 }], ["get", [1], i64("9223372036854775807")]], "n10iii");
      return {
        value: {
          i: { invocations: i.invocations },
          ii: { "E(get)": expectE(ii.built, "get", 3), invocations: ii.invocations, static_rejection: false },
          iii: { "E(get)": expectE(iii.built, "get", 3), invocations: iii.invocations, measures: expectMeasures(n10iii, { analysis_units: 5, decls: 2, stmts: 2 }) }
        }
      };
    });
    await vector("V53-AGG-N11", async () => {
      const invalid = "air.v051.type_reference_invalid";
      const v = pinned("N11.v");
      const runV = await accepted(v, [["run", [5], { value: 5 }]], "n11v");
      return {
        value: {
          i: (await staticReject(pinned("N11.i"), invalid, 3)).outcome,
          ii: (await staticReject(pinned("N11.ii"), invalid, 3)).outcome,
          iii: (await staticReject(pinned("N11.iii"), invalid, 4)).outcome,
          iii_plus: await control("ARR1", "n11iiip", 2),
          iv: (await staticReject(pinned("N11.iv"), invalid, 3)).outcome,
          v: { invocations: runV.invocations, verdict: "VERIFIED" },
          vi: (await staticReject(pinned("N11.vi"), invalid, 3)).outcome,
          vi_plus: await control("N11.vip", "n11vip")
        }
      };
    });
    await vector("V53-AGG-N12", async () => {
      const cases = [["i", "air.v051.typed_syntax_invalid", 3], ["ii", "air.v051.typed_atom_type_mismatch", 3], ["iii", "air.numeric.i64_constant_out_of_range", 3],
        ["iv", "air.v051.typed_atom_type_mismatch", 3], ["v", "air.v051.typed_syntax_invalid", 5], ["vi", "air.v051.typed_syntax_invalid", 3],
        ["vii", "air.numeric.operation_invalid", 6], ["viii", "air.v051.typed_atom_type_mismatch", 6]];
      const value = {};
      for (const [label, code, line] of cases) value[label] = (await staticReject(pinned(`N12.${label}`), code, line)).outcome;
      value.i_plus = await control("N12.ip", "n12ip");
      value.vi_plus = await control("N12.vip", "n12vip");
      return { value };
    });
    await vector("V53-AGG-N13", async () => {
      const cases = [["i", "air.v051.typed_syntax_invalid", 3], ["ii", "air.v051.typed_syntax_invalid", 3], ["iii", "air.v051.type_reference_invalid", 3],
        ["iv", "air.v051.type_reference_invalid", 3], ["v", "air.numeric.operation_invalid", 7], ["vi", "air.numeric.operation_invalid", 6],
        ["vii", "air.numeric.operation_invalid", 4], ["viii", "air.v051.typed_atom_type_mismatch", 6], ["ix", "air.decision.enum_duplicate_type", 7],
        ["x", "air.v051.type_reference_invalid", 3], ["xi", "air.abi.export_type_unsupported", 3], ["xii", "air.abi.export_type_unsupported", 5],
        ["xiii", "air.decision.payload_type_unsupported", 5], ["xiv", "air.v051.type_reference_invalid", 3]];
      const value = {};
      for (const [label, code, line] of cases) value[label] = (await staticReject(pinned(`N13.${label}`), code, line)).outcome;
      value.i_plus = await control("N13.ip", "n13ip");
      value.ii_plus = await control("N13.iip", "n13iip");
      return { value };
    });
    await vector("V53-AGG-N14", async () => {
      const value = {
        i: (await staticReject(pinned("N14.i"), "air.array.index_out_of_range", 5)).outcome,
        ii: (await staticReject(pinned("N14.ii"), "air.table.index_out_of_range", 7)).outcome,
        iii: (await staticReject(pinned("N14.iii"), "air.array.index_out_of_range", 5)).outcome,
        iv: (await staticReject(pinned("N14.iv"), "air.table.index_out_of_range", 6)).outcome
      };
      // (v), (vi): `-0` is index 0 at every entrypoint (P6-R4): VERIFIED by the
      // SDK, `airc check` and the LSP (no diagnostic); it builds and runs.
      const zeroIndex = async (key, out, invocations, fn, steps, label) => {
        const source = pinned(key);
        const file = path.join(tmp, `${label}.air`);
        fs.writeFileSync(file, source);
        const report = JSON.parse(runCli(["check", file, "--source-profile", V053, "--allow-candidate-profile", "--lsp-json"]).stdout);
        assert.deepEqual(report.diagnostics, [], `${label}: airc check reports no diagnostic`);
        const session = new AirLspSession({ allowCandidateProfile: true, sourceProfile: V053 });
        const [published] = session.handleMessage({ jsonrpc: "2.0", method: "textDocument/didOpen", params: { textDocument: { text: source, uri: `file://${file}`, version: 1 } } });
        assert.deepEqual(published.params.diagnostics, [], `${label}: the LSP publishes no diagnostic`);
        const run = await accepted(source, invocations, label);
        return { [`E(${fn})`]: expectE(run.built, fn, steps), airc_check: report.status, format: expectFormat(source, pinned(out)), invocations: run.invocations, lsp_diagnostics: 0 };
      };
      value.v = await zeroIndex("N14.v", "N14.vout", [["run", [5], { value: 1 }]], "run", 6, "n14v");
      value.vi = await zeroIndex("N14.vi", "N14.viout", [["get", [5], i64("9007199254740993")]], "get", 2, "n14vi");
      value.vii = (await staticReject(pinned("N14.vii"), "air.v051.typed_atom_invalid", 6)).outcome;
      value.viii = (await staticReject(pinned("N14.viii"), "air.v051.typed_atom_invalid", 6)).outcome;
      return { value };
    });

    // ------------------------------------------------------------------
    // Slice checks with no vector ID (card exact_evidence; slice text §5, §6).
    await vector("P0-06-CHECK-CT1", () => {
      const file = path.join(ROOT, "src", "workbound_cost_table_v1.json");
      const blob = childProcess.spawnSync("git", ["hash-object", file], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
      const bytes = fs.readFileSync(file);
      const table = JSON.parse(bytes.toString("utf8"));
      assert.equal(blob, "c3a2022be20bfa9511642dad2e82cc238fdffc65");
      assert.equal(sha256(bytes), "sha256:770315ade1bd192dfa65f50aca5458296ff702fae50cdc33b72e5b1b6bbfb5a4");
      assert.equal(bytes.length, 5370);
      assert.equal(wb.COST_TABLE_DIGEST, "sha256:d8b341ea2358a787d699507a5dca9ce6cab0d58e3358d324df4c5ff8e469760e");
      assert.equal(table.revision, "P0-06-AGG-1");
      assert.equal(table.rows.length, 22);
      // The amendment diff P0-02-F1-RD3 -> P0-06-AGG-1 (card exact_evidence):
      // every frozen row keeps its weights; two rows are added after
      // statement.constructor; four row texts are reworded.
      let base = null;
      for (const commit of BASE_COMMITS) {
        const shown = childProcess.spawnSync("git", ["show", `${commit}:src/workbound_cost_table_v1.json`], { cwd: ROOT, encoding: "utf8" });
        if (shown.status === 0) { base = JSON.parse(shown.stdout); break; }
      }
      assert(base, "the base CT-1 is readable from git objects");
      assert.equal(base.revision, "P0-02-F1-RD3");
      const weights = (row) => JSON.stringify(Object.fromEntries(Object.entries(row).filter(([key]) => key !== "ct1")));
      const before = new Map(base.rows.map((row) => [row.construct, row]));
      for (const row of base.rows) assert.equal(weights(table.rows.find((item) => item.construct === row.construct)), weights(row), `${row.construct}: weights unchanged`);
      const added = table.rows.filter((row) => !before.has(row.construct));
      assert.deepEqual(added.map((row) => row.construct), ["aggregate.transfer", "aggregate.access"]);
      assert.deepEqual(table.rows.map((row) => row.construct).slice(1, 4), ["statement.constructor", "aggregate.transfer", "aggregate.access"]);
      assert.deepEqual(added.map(weights), [JSON.stringify({ construct: "aggregate.transfer", steps: "0", steps_per_lane: "1", calls: "0", iterations: "0" }), JSON.stringify({ construct: "aggregate.access", steps: "1", calls: "0", iterations: "0" })]);
      const reworded = base.rows.filter((row) => table.rows.find((item) => item.construct === row.construct).ct1 !== row.ct1).map((row) => row.construct);
      assert.deepEqual(reworded.sort(), ["call", "loop.exit", "match.atom_arm", "return"]);
      return {
        value: {
          amendment_diff: { added: added.map((row) => ({ ...row })), base_cost_table_digest: "sha256:1ae0cddb2b01ca1f16f5b8da059ebd0a594d8c222aea4e5bf8f5e2c6d17e80c9", base_revision: base.revision, reworded_texts: reworded, weights_unchanged: base.rows.length },
          blob, bytes: bytes.length, cost_table_digest: wb.COST_TABLE_DIGEST, raw_sha256: sha256(bytes), revision: table.revision, rows: table.rows.length
        }
      };
    });
    await vector("P0-06-CHECK-FLAGS", () => {
      // EXPORTED_MEMORY=false (P6-R5, P6-R19): the internal memory is never
      // exported or imported; the only exports are the functions and
      // `__air_failure_reason`; one data segment per table; no host import.
      assert(p02Run && p05Run && p07Run, "the builds ran first");
      const flags = {};
      for (const [label, run, exportsExpected, segments] of [["V53-AGG-P02", p02Run, ["__air_failure_reason", "get"], 1], ["V53-AGG-P05", p05Run, ["__air_failure_reason", "run"], 0], ["V53-AGG-P07", p07Run, ["__air_failure_reason", "run"], 0]]) {
        const module = new WebAssembly.Module(run.built.wasmBytes);
        const exportsOf = WebAssembly.Module.exports(module);
        assert.deepEqual(exportsOf.map((item) => item.name).sort(), exportsExpected, `${label}: exports`);
        assert(exportsOf.every((item) => item.kind !== "memory"), `${label}: no memory export`);
        assert.deepEqual(WebAssembly.Module.imports(module), [], `${label}: no import`);
        assert.doesNotMatch(run.wat, /\(export "memory"\)|\(import /u, `${label}: no memory export or import in the WAT`);
        assert.equal((run.wat.match(/^ {2}\(data /gmu) || []).length, segments, `${label}: one data segment per table`);
        assert.equal((run.wat.match(/^ {2}\(memory [0-9]+\)$/gmu) || []).length, 1, `${label}: one internal memory`);
        flags[label] = { data_segments: segments, exports: exportsOf.map((item) => `${item.kind}:${item.name}`), imports: 0 };
      }
      // A module without a table or an aggregate declares no memory: its WAT is the base's.
      assert.doesNotMatch(lowerToWat(typedV053(mod(RUN)), { maxWatBytes: MAX_WAT }), /\(memory |\(data /u, "a table-free, aggregate-free module has no memory");
      return { value: { EXPORTED_MEMORY: false, QA_STATUS: "AWAITING_EXACT_SHA_QA", modules: flags } };
    });
    await vector("P0-06-CHECK-O1 (array.set, informative)", () => {
      // The binding addition names dynamic array.set too: its per-access
      // sequence, after the whole-value copy that aggregate.transfer charges,
      // is the domain check, the address and exactly one store of the element
      // width (in place of the load).
      assert(p07Run, "V53-AGG-P07 ran first");
      const lines = functionWat(p07Run.wat, "run").split("\n").map((line) => line.trim());
      const copy = lines.indexOf("memory.copy");
      const start = lines.findIndex((line, index) => index > copy && /^local\.get \$i\b/u.test(line));
      const end = lines.indexOf("i32.store", start);
      const sequence = lines.slice(start, end + 1);
      const problems = straightLine(sequence.map((line) => (line === "i32.store" ? "i32.load" : line)), "__air_v053_array_index_out_of_range", "i32.load");
      assert.deepEqual(problems, [], "array.set per-access sequence");
      return { value: { sequence, store: "i32.store (one, the element width)", whole_value_copy_before: lines.slice(copy - 3, copy + 1) } };
    });
    await vector("P0-06-CHECK-BUILD-SIZES", async () => {
      // P6-R19 / OD-P6-6 (a): the largest lane count that builds in each
      // position under this lowering (docs/v0.53/P0_06_AGGREGATES.md §4):
      // 65,536 lanes (the cap) as a local, a parameter, a result and a field.
      const zeros = Array(256).fill("0").join(", ");
      const rows = Array(256).fill("%r").join(", ");
      const big = "array<array<i32,256>,256>";
      const fill = [`%r: array<i32,256> = array.new ${zeros}`, `%w: ${big} = array.new ${rows}`];
      const source = mod(["struct W { a: array<array<i32,256>,256> }"],
        func(`func pass(w: ${big}, r: array<i32,256>, i: i32) -> ${big}`, [`%o: ${big} = array.set %w, %i, %r`, "return %o"]),
        func("export func run(i: i32) -> i32", [...fill, `%x: ${big} = call @pass(%w, %r, %i)`, "%s: W = struct.new %x", `%y: ${big} = struct.get.a %s`,
          "%row: array<i32,256> = array.get %y, %i", "%v: i32 = array.get %row, %i", "return %v"]));
      const run = await accepted(source, [["run", [0], { value: 0 }], ["run", [255], { value: 0 }], ["run", [256], A35]], "build_sizes");
      return { value: { "E(run)": wb.inspectBoundWorkBound(run.built).record.entries.run, invocations: run.invocations, lanes: 65536, positions: ["local", "parameter", "result", "field"], wasm_bytes: run.built.wasmBytes.length } };
    });
    await vector("P0-06-CHECK-BUILD-REFUSED", async () => {
      // P6-R19: a VERIFIED module beyond the engine limits is BUILD_REFUSED
      // with air.build.engine_limit, never a STATIC_REJECT, nothing truncated:
      // 8,193 values of 65,536 i64 lanes (512 KiB each) exceed 65,536 pages.
      const zeros = Array(256).fill("0").join(", ");
      const rows = Array(256).fill("%r").join(", ");
      const body = [`%r: array<i64,256> = array.new ${zeros}`, `%w: array<array<i64,256>,256> = array.new ${rows}`, "%s0: W = struct.new %w"];
      for (let index = 1; index <= 8192; index += 1) body.push(`%s${index}: W = %s0`);
      const source = mod(["struct W { a: array<array<i64,256>,256> }"], func("export func run(i: i32) -> i32", [...body, "return %i"]));
      typedV053(source, "refused.air");
      const refused = await buildVerifiedTypedModule({ ...GATED, descriptor: descriptorOf(source), source }).then(() => null, (error) => error);
      assert(refused, "the build is refused");
      assert.equal(refused.code, "air.build.engine_limit", String(refused.message));
      assert.match(String(refused.message), /memory pages/u);
      return { value: { code: refused.code, disposition: refused.disposition || "BUILD_REFUSED", message: String(refused.message), source_bytes: Buffer.byteLength(source, "utf8"), verified: true } };
    });
    await vector("P0-06-CHECK-CONST", async () => {
      // OD-P6-2 (b): V53-AGG-P03 and N04 belong to P0-07; P0-06 runs neither
      // vector. At P0-06 a `const` line keeps failing as typed_syntax_invalid at line 3.
      return {
        value: {
          P03: (await staticReject(pinned("P03"), "air.v051.typed_syntax_invalid", 3)).outcome,
          N04: (await staticReject(pinned("N04"), "air.v051.typed_syntax_invalid", 3)).outcome,
          vectors_run: "none (re-indexed to P0-07)"
        }
      };
    });
    await vector("P0-06-CHECK-PAIRS", () => {
      // Each pair negative's base result equals its expectation, and its
      // control (+), rejected by the base, verifies on this build.
      const pairs = [["N05", "N05p"], ["N09", "ARR1"], ["N11.iii", "ARR1"], ["N12.i", "N12.ip"], ["N12.vi", "N12.vip"], ["N13.i", "N13.ip"], ["N13.ii", "N13.iip"]];
      const expected = { N05: ["air.v051.typed_syntax_invalid", 3], N09: ["air.v051.type_reference_invalid", 4], "N11.iii": ["air.v051.type_reference_invalid", 4],
        "N12.i": ["air.v051.typed_syntax_invalid", 3], "N12.vi": ["air.v051.typed_syntax_invalid", 3], "N13.i": ["air.v051.typed_syntax_invalid", 3], "N13.ii": ["air.v051.typed_syntax_invalid", 3] };
      const keys = [...new Set(pairs.flat()), "N06", "N07"];
      const base = baseVerdicts(keys);
      const value = { base_commit: base.commit, pairs: {} };
      for (const [negative, plus] of pairs) {
        const [code, line] = expected[negative];
        assert.deepEqual(base.verdicts[negative], { code, line, verdict: "REJECTED" }, `${negative}: base result equals the expectation (a pair)`);
        assert.equal(base.verdicts[plus].verdict, "REJECTED", `${plus}: the base rejects the control`);
        assert(!capture(() => typedV053(fixture(plus))), `${plus}: the control verifies on this build`);
        value.pairs[negative] = { base: base.verdicts[negative], control: plus, control_base: base.verdicts[plus], control_now: "VERIFIED" };
      }
      for (const key of ["N06", "N07"]) assert.deepEqual(base.verdicts[key], { code: "air.v051.typed_syntax_invalid", line: 3, verdict: "REJECTED" }, `${key}: catch-all, no control needed`);
      value.catch_all = { N06: base.verdicts.N06, N07: base.verdicts.N07 };
      return { value };
    });

    // ------------------------------------------------------------------
    // P0-06-SEP-WB (slice text P6-R20).
    await vector("P0-06-SEP-WB", () => {
      // Item 1: the explicit corpus, every distinct fixture text of the
      // generator, whatever its vector does with it.
      const texts = new Map();
      for (const key of Object.keys(PINS)) texts.set(hexOf(fixture(key)), fixture(key));
      const corpusShas = [...texts.keys()].sort();
      assert.equal(corpusShas.length, 76, "76 distinct fixture texts");
      assert.deepEqual(corpusShas, [...SEP_CORPUS_SHA256], "the corpus is exactly the listed sha256 set");
      const label = new Map(Object.entries(PINS).map(([key, [, digest]]) => [digest, key]));
      const dir = path.join(tmp, "sep06");
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
      // Items 2-4: the real src/ with the outcome-preserving stub.
      const behaviour = compare(path.join(ROOT, "src"));
      assert.deepEqual(behaviour.budgetOrGrantExports, [], "no verifier export accepts or returns a Budget or grant");
      assert.equal(behaviour.counts.sources, 76);
      assert.equal(behaviour.counts.workSources, 0, "no corpus text declares work: the stub perturbs every dimension");
      assert.equal(behaviour.counts.phaseRejections, 0, "no corpus text is rejected with a PHASE_P06 code");
      assert.equal(behaviour.differenceCount, 0, `WorkBound changed a verdict: ${JSON.stringify(behaviour.differences, null, 2).slice(0, 4000)}`);
      // Item 5: the controls C2, C3, C4 and C6, each on a scratch copy of src/.
      const controls = {};
      const verifierText = fs.readFileSync(path.join(ROOT, "src", "verifier.js"), "utf8");
      for (const [name, mutant] of Object.entries(MUTANTS)) {
        assert.equal(verifierText.split(mutant.anchor).length, 2, `${name}: the anchor occurs exactly once`);
        const scratch = path.join(dir, `src-${name}`);
        fs.cpSync(path.join(ROOT, "src"), scratch, { recursive: true });
        fs.writeFileSync(path.join(scratch, "verifier.js"), verifierText.replace(mutant.anchor, mutant.replacement));
        const mutated = compare(scratch);
        assert(mutated.differenceCount > 0, `${name} (${mutant.description}) must make P0-06-SEP-WB fail`);
        const sources = [...new Set(mutated.differences.map((item) => `${label.get(item.sha256) || item.sha256} (${item.mode})`))].sort();
        controls[name] = { description: mutant.description, differences: mutated.differenceCount, first_difference: firstDifference(mutated), sources };
      }
      // C6 is caught by the stubbed comparison on V53-AGG-P01 (stubbed E(get) =
      // 7921), and changes real-mode verdicts on N10 (ii) and (iii) (E(get) = 3).
      assert(controls.C6.sources.includes("P01 (stubbed)"), "C6 is caught at V53-AGG-P01 by the stubbed comparison");
      for (const key of ["N10ii", "N10iii"]) assert(controls.C6.sources.includes(`${key} (disabled)`), `C6 changes the real-mode verdict of ${key}`);
      return {
        value: {
          PHASE_P06,
          controls,
          corpus: { count: corpusShas.length, sha256_set_digest: sha256(corpusShas.join("\n")), sorted_sha256: corpusShas },
          coverage: behaviour.counts,
          differences: 0,
          modes: { disabled: "empty status ok analysis", real: "analyzeVerifiedTypedModule", stubbed: "+7919 steps, +13 calls, +17 iterations on every ok summary (no corpus text declares work); effects kept (empty before P0-10)" },
          thresholds: P06_MAXIMA,
          verified_asts_unchanged: behaviour.unchangedAsts
        }
      };
    });

    // ------------------------------------------------------------------
    // EACH_SLICE vectors re-run on the P0-06 corpus.
    await vector("V53-FMT-01@P0-06", () => {
      // The fixture item order is prescribed by the generator, so every
      // accepted source is judged by idempotence; the five canonical outputs
      // are pinned (V53-AGG-P09 (i)-(iii), V53-AGG-N14 (v), (vi)). The
      // formatted source keeps the verdict and every summary.
      for (const source of acceptedSources) {
        const once = sp.formatSource(typedV053(source), GATED);
        assert.equal(sp.formatSource(typedV053(once), GATED), once, "idempotent");
        const summaries = [source, once].map((text) => {
          const analysis = wb.analyzeVerifiedTypedModule(typedV053(text));
          return Object.fromEntries([...analysis.entries].map(([name, entry]) => [name, wb.canonicalSummary(entry.value)]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
        });
        // Formatting orders the functions by name; every export keeps its E(e).
        assert.deepEqual(summaries[1], summaries[0], "formatting keeps every E(e)");
      }
      for (const [input, output] of [["P09.in", "P09.out"], ["P09ii.in", "P09ii.out"], ["P09iii.in", "P09iii.out"], ["N14.v", "N14.vout"], ["N14.vi", "N14.viout"]]) {
        assert.equal(sp.formatSource(typedV053(fixture(input)), GATED), fixture(output));
      }
      return { value: { canonical_pinned: 5, judged_by_idempotence: acceptedSources.size, sources: acceptedSources.size } };
    });
    await vector("V53-LSP-01@P0-06", () => {
      const file = path.join(tmp, "lsp01.air");
      fs.writeFileSync(file, F.N03);
      const report = JSON.parse(runCli(["check", file, "--source-profile", V053, "--allow-candidate-profile", "--lsp-json"]).stdout);
      assert.equal(report.diagnostics[0].code, "air.table.readonly");
      assert.equal(report.diagnostics[0].line, 6);
      return { value: { code: report.diagnostics[0].code, line: report.diagnostics[0].line, status: report.status } };
    });
    await vector("V53-LSP-02@P0-06", () => {
      const session = new AirLspSession({ allowCandidateProfile: true, sourceProfile: V053 });
      const checks = [];
      for (const source of [F.N03, F.N08, F.N14.i, F.N12.vii, F.N13.iii]) {
        const thrown = capture(() => typedV053(source));
        const [published] = session.handleMessage({ jsonrpc: "2.0", method: "textDocument/didOpen", params: { textDocument: { text: source, uri: `file://${path.join(tmp, `lsp02-${checks.length}.air`)}`, version: 1 } } });
        assert.equal(published.params.diagnostics[0].code, thrown.code, "err.code preserved");
        checks.push(thrown.code);
      }
      return { value: checks };
    });
    await vector("V53-DIAG-01@P0-06", () => {
      const registry = new Set([...EARLIER_CODE_REGISTRY, ...P0_06_CODE_REGISTRY]);
      // The note is dev-side (the public projection mirrors src/ and the tests).
      const notePath = path.join(ROOT, "docs", "v0.53", "P0_06_AGGREGATES.md");
      if (fs.existsSync(notePath)) {
        const note = fs.readFileSync(notePath, "utf8");
        const section = note.slice(note.indexOf("## 5."), note.indexOf("## 6."));
        const listed = [...section.matchAll(/^\| `(air\.[a-z0-9_.]+)` \|/gmu)].map((match) => match[1]).sort();
        assert.deepEqual(listed, [...P0_06_CODE_REGISTRY].sort(), "the note's registry table lists exactly the P0-06 codes");
      }
      for (const item of observedFailures) {
        assert(registry.has(item.code), `${item.code} is in the registry`);
        if (item.kind === "STATIC_REJECT") assert(Number.isInteger(item.line), `${item.code} has a location`);
      }
      const seen = new Set(observedFailures.map((item) => item.code));
      for (const code of P0_06_CODE_REGISTRY) assert(seen.has(code), `${code} is exercised`);
      return { value: { failures_checked: observedFailures.length, p0_06_codes: P0_06_CODE_REGISTRY.length } };
    });
    await vector("V53-DIAG-02@P0-06", async () => {
      // Deterministic fuzz of the P0-06 corpus (the texts of at most 4,096
      // bytes): no raw TypeError, JS stack, WABT text or engine error; a
      // verified source always builds (R-COMP-3).
      let seed = 0x0f0606;
      const next = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed; };
      const ops = ["table.get t, %i", "table.get t, 2", "table.set t, 0, 1", "struct.new 1, 2", "struct.get.x %p", "struct.set.y %p, 3", "array.new 1, 2, 3, 4",
        "array.get %a, %i", "array.set %a, %i, 9", "array.get %a, -0", "array<i32,4>", "array<P,3>", "array<i32,0>", "array<i32,65537>", "struct P { x: i32 }",
        "struct R { r: R }", "table t: i32[2] = [0, 1]", "table t: u8[2] = [0, 1]", "table t: i64[1] = [9223372036854775807]", "-0", "+0", "-00", "%p", "P", ",", "[]", "{ }"];
      const registry = new Set([...EARLIER_CODE_REGISTRY, ...P0_06_CODE_REGISTRY]);
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

  const outDir = process.env.AIR_P006_VECTOR_RESULTS_DIR;
  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "v053_tables_aggregates.results.json"), `${JSON.stringify(results, null, 2)}\n`);
  }
  if (process.env.AIR_P006_CHECK_O1_FILE) fs.writeFileSync(process.env.AIR_P006_CHECK_O1_FILE, `${JSON.stringify(plain(checkO1), null, 2)}\n`);
  const passed = results.filter((item) => item.status === "PASS").length;
  const deferred = results.filter((item) => item.status === "DEFERRED").map((item) => item.vector);
  if (failures.length) {
    for (const failure of failures) console.error(`not ok - ${failure}`);
    console.error(`typed-v0.53 P0-06 vectors: ${failures.length} FAIL, ${passed} PASS`);
    process.exit(1);
  }
  for (const item of results) console.log(`ok - ${item.vector} ${item.status}`);
  console.log(`typed-v0.53 P0-06 vectors: ${passed} PASS, ${deferred.length} DEFERRED${deferred.length ? ` (${deferred.join(", ")})` : ""}`);
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
