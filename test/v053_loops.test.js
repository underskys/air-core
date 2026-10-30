#!/usr/bin/env node
"use strict";

// typed-v0.53 P0-05 (AIR-0053-P0-05-0001): bounded loops (`loop.fold`), the
// dynamic-count guard, callback edges, WorkBound charging at n, the other loop
// forms refused, and author `work` assertions. Every expected value below is
// copied from the R3.1 catalogue (VECTORS.md, sha256 f5353705..., LOOP rows
// 282-304) or the admitted P0-05 slice text R2.2 (VECTORS_ADDITIONS.md;
// folder SHA256SUMS 3071676b...), never from the output of the implementation
// under test. Fixture bytes come from the slice text's generator
// (tools/derive_p005.py), ported below and pinned by the sha256 values of its
// output (tool_outputs/derive_p005.out.txt). ACCEPT and RUNTIME_FAIL rows run
// through the verified builder and the generic runtime with the descriptor of
// the source signature; a STATIC_REJECT row is checked at every entrypoint that
// verifies (P4-R8). P0-05-SEP-WB is P0-05's own separation check (P5-R13b).
// Set AIR_P005_VECTOR_RESULTS_DIR=<dir> to write one canonical result record
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
const { measureTypedModule } = require("../src/analysis_capacity");
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
// R-DIAG-2: the codes typed-v0.53 emitted before P0-05 (as in
// test/v053_calls_cfg.test.js) and the P0-05 additions (docs/v0.53/P0_05_LOOPS.md
// §5, a dev-side note): the two PROPOSED loop/work codes, the runtime guard
// identity, and the two WorkBound bound codes that a source reaches first here.
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
  "air.control.unstructured_unsupported", "air.control.yield_missing", "air.workbound.overflow"
]);
const P0_05_CODE_REGISTRY = Object.freeze([
  "air.loop.count_out_of_range", "air.loop.form_unsupported", "air.workbound.assertion_exceeded",
  "air.workbound.invalid_bound", "air.workbound.unknown_bound"
]);

// ---------------------------------------------------------------------------
// The slice text's generator (tools/derive_p005.py), ported line for line:
// two-space indentation per block level, one blank line between module items,
// LF, one trailing LF, lines numbered from the `module` line.
const HEAD = "module v53.loop";
const STEP = ["func step(acc: i32) -> i32 {", "  %o: i32 = i32.wrapping_add %acc, 1", "  return %o", "}"];
const ADD_INDEX = ["func add_index(acc: i32, i: i32) -> i32 {", "  %o: i32 = i32.wrapping_add %acc, %i", "  return %o", "}"];
const KEEP = ["func keep(o: option<i32>) -> option<i32> {", "  return %o", "}"];
const CLAMP = ["func clampstep(acc: i32<0..100>) -> i32<0..100> {", "  return %acc", "}"];
const DIVIDE = ["func divide(acc: i32, i: i32) -> i32 {", "  %o: i32 = i32.checked_div_s %acc, %i", "  return %o", "}"];
const G_STEP = ["func g(acc: i32) -> i32 {", "  %o: i32 = i32.wrapping_add %acc, 1", "  return %o", "}"];
const F_4096 = ["func f(acc: i32) -> i32 {", "  %r: i32 = loop.fold @g, %acc, 4096", "  return %r", "}"];
const G_BARE = ["func g(acc: i32) -> i32 {", "  %r: i32 = loop.fold @step, %acc, %acc", "  return %r", "}"];
const G_CALLS_F = ["func g(acc: i32) -> i32 {", "  %b: i32 = call @f(%acc)", "  return %b", "}"];

function mod(...items) {
  const lines = [HEAD];
  for (const item of items) lines.push("", ...item);
  return `${lines.join("\n")}\n`;
}
const run = (params, result, body) => [`export func run(${params}) -> ${result} {`, ...body.map((line) => `  ${line}`), "}"];
const FOLD = (cb, seed, count, dest = "%r: i32") => `${dest} = loop.fold @${cb}, ${seed}, ${count}`;
const R100 = "i32<0..100>";
const work5 = (work) => mod([work], STEP, run("seed: i32", "i32", [FOLD("step", "%seed", "5"), "return %r"]));
const frame = (line, ret = "return %s") => mod(STEP, run("s: i32", "i32", [line, ret]));

const F = {
  P01: mod(STEP, run("seed: i32", "i32", [FOLD("step", "%seed", "5"), "return %r"])),
  P02: mod(STEP, run("seed: i32, n: i32", "i32", [FOLD("step", "%seed", "%n max 8"), "return %r"])),
  P03: mod(STEP, run("seed: i32", "i32", [FOLD("step", "%seed", "0"), "return %r"])),
  P04: mod(ADD_INDEX, run("", "i32", [FOLD("add_index", "0", "5"), "return %r"])),
  P06: mod(G_STEP, F_4096, run("", "i32", [FOLD("f", "0", "4096"), "return %r"])),
  N03: mod(STEP, run("seed: i32, n: i32", "i32", [FOLD("step", "%seed", "%n"), "return %r"])),
  N04i: mod(STEP, run("seed: i32", "i32", [FOLD("step", "%seed", "4097"), "return %r"])),
  N04ii: mod(STEP, run("seed: i32, n: i32", "i32", [FOLD("step", "%seed", "%n max 4097"), "return %r"])),
  N05: frame("loop.range.i32 @step, %s, 3"),
  N06i: frame("loop.map.i32 @step, %s, 3"),
  N06ii: frame("loop.while.i32 @step, %s"),
  N06iii: frame("for i in 0..4 { }"),
  N07i: frame("loop.poll @io.poll, %r, 4"),
  N07ii: frame("io.poll_bounded %r, 4"),
  N09i: frame("loop.array.i32 @step, %s, 3"),
  N09ii: frame("loop.buffer.f32 @step, %s, 3"),
  N08: mod(["export func f(x: i32) -> i32 {", "  %r: i32 = loop.fold @g, %x, 2", "  return %r", "}"], G_CALLS_F),
  N11: mod(STEP, G_BARE, run("s: i32", "i32", [FOLD("g", "%s", "0"), "return %r"])),
  P07: mod(ADD_INDEX, run("n: i32", "i32", [FOLD("add_index", "0", "%n max 6"), "return %r"])),
  P08: work5("work { steps <= 22, calls <= 5, iterations <= 5 }"),
  P08ii: mod(["work { steps <= 23 }"], STEP, run(`seed: ${R100}`, "i32", [FOLD("step", "%seed", "5"), "return %r"])),
  P08fmt: `${["module v53.loop", "work { steps <= 22, calls <= 5, iterations <= 5 }", "", "export func run(seed: i32) -> i32 {",
    "  %r: i32 = loop.fold @step, %seed, 5", "  return %r", "}", "", ...STEP].join("\n")}\n`,
  P08iii: work5("work {iterations<=5,steps <= 22}"),
  P08iiiFmt: `${["module v53.loop", "work { steps <= 22, iterations <= 5 }", "", "export func run(seed: i32) -> i32 {",
    "  %r: i32 = loop.fold @step, %seed, 5", "  return %r", "}", "", ...STEP].join("\n")}\n`,
  P09: mod(KEEP, run("", "option<i32>", [FOLD("keep", "option.none<i32>", "4", "%r: option<i32>"), "return %r"])),
  N12: {
    i: mod(CLAMP, STEP, run("s: i32", R100, [FOLD("clampstep", "%s", "3", `%r: ${R100}`), "return %r"])),
    ii: mod(CLAMP, STEP, run(`s: ${R100}`, R100, [FOLD("clampstep", "%s", "3", `%r: ${R100}`), "return %r"])),
    iii: mod(CLAMP, STEP, run("", R100, [FOLD("clampstep", "0", "3", `%r: ${R100}`), "return %r"])),
    iv: mod(CLAMP, STEP, run(`s: ${R100}`, "i32", [FOLD("clampstep", "%s", "3"), "return %r"])),
    v: mod(CLAMP, STEP, run("s: i32", R100, [FOLD("step", "%s", "3", `%r: ${R100}`), "return %r"])),
    vi: mod(CLAMP, STEP, run("s: i32<0..50>", R100, [FOLD("clampstep", "%s", "3", `%r: ${R100}`), "return %r"])),
    vii: mod(CLAMP, STEP, run(`s: ${R100}`, "i32<-5..200>", [FOLD("clampstep", "%s", "3", "%r: i32<-5..200>"), "return %r"])),
    viii: mod(CLAMP, STEP, run("s: i32<50..150>", R100, [FOLD("clampstep", "%s", "3", `%r: ${R100}`), "return %r"]))
  },
  N13: {
    i: mod(STEP, run("s: i32", "i32", [FOLD("nope", "%s", "3"), "return %r"])),
    ii: mod(STEP, run("s: i32", "i32", [FOLD("output.emit", "%s", "3"), "return %r"])),
    iii: mod(["func tri(acc: i32, i: i32, j: i32) -> i32 {", "  return %acc", "}"], run("s: i32", "i32", [FOLD("tri", "%s", "3"), "return %r"])),
    iv: mod(["func zero() -> i32 {", "  return 0", "}"], run("s: i32", "i32", [FOLD("zero", "%s", "3"), "return %r"])),
    v: mod(["func flip(acc: bool) -> bool {", "  return %acc", "}"], run("s: i32", "i32", [FOLD("flip", "%s", "3"), "return %r"])),
    vi: mod(["func bad(acc: i32, i: bool) -> i32 {", "  return %acc", "}"], run("s: i32", "i32", [FOLD("bad", "%s", "3"), "return %r"])),
    vii: mod(["func v(acc: i32) -> void {", "  return", "}"], run("s: i32", "i32", [FOLD("v", "%s", "3"), "return %r"])),
    viii: mod(STEP, run("s: i32", "i32", [FOLD("step", "true", "3"), "return %r"])),
    ix: mod(STEP, run("s: i32", "i32", [FOLD("step", "%s", "%k max 4"), "return %r"])),
    x: mod(STEP, run("s: i32, b: bool", "i32", [FOLD("step", "%s", "%b max 4"), "return %r"])),
    xi: mod(STEP, run("s: i32", "i32", [FOLD("step", "%s", "-1"), "return %r"])),
    xii: mod(STEP, run("s: i32, n: i32, m: i32", "i32", [FOLD("step", "%s", "%n max %m"), "return %r"])),
    xiii: mod(STEP, run("s: i32", "i32", [FOLD("step", "%s", "3", "%r: bool"), "return %s"])),
    xiv: mod(STEP, run("s: i32", "i32", ["%r: i32 = loop.fold @step, %s", "return %r"])),
    xv: mod(run("s: i32", "i32", [FOLD("g", "%s", "4097"), "return %r"]), G_BARE, STEP),
    xvi: mod(STEP, run("s: i32, c: i32<0..8>", "i32", [FOLD("step", "%s", "%c"), "return %r"]))
  },
  N14: {
    i: mod(STEP, run("", "i32", ["%k: i32 = 9", FOLD("step", "0", "%k max 8"), "return %r"])),
    ii: mod(STEP, run("n: i32", "i32", [FOLD("step", "7", "%n max 0"), "return %r"])),
    iii: mod(DIVIDE, run("n: i32", "i32", [FOLD("divide", "7", "%n max 4"), "return %r"]))
  },
  N15: {
    i: work5("work { steps <= 21 }"),
    ii: work5("work { iterations <= 4 }"),
    iii: mod(["work { steps <= 1000 }"], STEP, run("seed: i32, n: i32", "i32", [FOLD("step", "%seed", "%n"), "return %r"])),
    iv: mod(["work { steps <= 22 }"], STEP, run(`seed: ${R100}`, "i32", [FOLD("step", "%seed", "5"), "return %r"])),
    v: work5("work { calls <= 4 }")
  },
  N16: {
    i: work5("work { cpu.instructions <= 40 }"),
    ii: work5("work { output.emit <= 1 }"),
    iii: work5("work { steps <= 10, steps <= 20 }"),
    iv: work5("work { }"),
    v: work5("work { steps <= 9223372036854775808 }"),
    vi: mod(["work { steps <= 100 }"], ["work { calls <= 10 }"], STEP, run("seed: i32", "i32", [FOLD("step", "%seed", "5"), "return %r"])),
    vii: work5("work { steps <= 022 }"),
    viii: work5("work { steps <= +22 }")
  },
  N17: {
    i: frame("%r: i32 = loop.fold.i32 @step, %s, 3", "return %r"),
    ii: frame("%r: i32 = loop.range.i32 @step, %s, 3", "return %r"),
    iii: frame("%r: i32 = loop.while.i32 @step, %s", "return %r"),
    iv: frame("loop.fold @step, %s, 3")
  },
  N18: {
    i: mod(["export func f(acc: i32) -> i32 {", "  %r: i32 = loop.fold @f, %acc, 0", "  return %r", "}"]),
    ii: mod(["export func f(x: i32) -> i32 {", "  %r: i32 = if false {", "    %a: i32 = loop.fold @g, %x, 2", "    yield %a",
      "  } else {", "    yield %x", "  }", "  return %r", "}"], G_CALLS_F)
  }
};

// The generator's output: bytes and sha256 of every fixture (row amendments and
// new rows), and the 71 distinct texts of the P0-05-SEP-WB corpus.
const PINS = Object.freeze({
  P01: [186, "660b8832247f860ba9b0039985acca8789dad06ce96feaae62387b3bfbebb8fb"],
  P02: [201, "7b3b9f931f318da875029721c89c24cfe463200a87c355f49d5e71ee1d7f1f7c"],
  P03: [186, "282f110848efd5ae17abb577dcada0b7982705b67dec2a870afa79cd39e73f13"],
  P04: [192, "e1c1f42c8c19f92fb83525d3e24bdadbd6c21665c5ef02f773ee1a6ce37dfc22"],
  P06: [248, "2629413442bb1021c4706e0d6bf3e5b5aaa4b023ffd0ecb01132cc0e2cdb5a8e"],
  N03: [195, "3ecf0c13e2d30938260d40dc62b83fb1b937b5d61a85ee5b026480492221fa01"],
  N04i: [189, "479f2decb2d7e94413e37f5ec4c07dda20a8794f764c1cbf79e5205e74ad547c"],
  N04ii: [204, "010112af9b34526121ccbabfb8021dbd9587d30665660c4cf409b40c0f164652"],
  N05: [175, "9d30e294a679b28330b77d7a6d34c7b6719f8b6c7a4efeed8817fc7de6685f23"],
  N06i: [173, "fb0b60cbe15186a2b31aef313d843c4b75e726f5493fa7a684e86de56565bada"],
  N06ii: [172, "52a2566e86fbc62f8fe3dbcca0c9d8808d4bcdfe406b05e812df576364948157"],
  N06iii: [165, "60a503b37d66040c88790da9879298c1bba9b93847d718e278c28d9f2656d175"],
  N07i: [173, "d7862b5a6a87fcd0c3cad62557e757585055a47d0efeaf7e6e32547cf28638d0"],
  N07ii: [169, "6de76282f52c6e5fb2a7f6e2e11ec09b7d0fcb4d87968bdc2a4f6bf4ecfa628b"],
  N09i: [175, "7c19f9829981ba3f775430e1f16a5b5b19379a0e32a62d9e9947ac9638fb4865"],
  N09ii: [176, "19a657479208f8d92a5a6106b465f158d96262e8b4f4bb24f5155cdb7b2745fa"],
  N08: [161, "f3fee6c3735048a61733810e5e454f0b558a9036587eafba92770b7ed02b0c59"],
  N11: [258, "0015eb50a19142472f31b911c918a67a516968b4678f83f8d5b25efd7eca39ba"],
  P07: [205, "a56335dcfc3b0eea5f0e157fb3abd7f5ffaa3196726b3ee0dceaad4167b5301c"],
  P08: [237, "ac1c8144e53ee8f40ab6590e86bf83d1ef40f3ea9c9bacb4f2efe922bd54d703"],
  P08ii: [216, "b4d89bb99bd23d1ecac0585574ee3026f4640b974e890fd3dd7b59405fff6842"],
  P08fmt: [236, "1ea20e919b5d430e50468176df5a207d518c35d5765d2ef5bc21d57c3e981804"],
  P08iii: [220, "ae4d9b8ac2c9dd723dbce3c0d0b3a1b9cf34cd96b348dbcecd9e65e48bcce1c2"],
  P08iiiFmt: [224, "b2049c2f2bc91fc820874cfec2dca59a703fe68677b1664517096bea590b7922"],
  P09: [181, "fb0dc3638422223b6b6f0fab8b46cbf6d603b4a495bb99e745cdaa753ee3444a"],
  "N12.i": [268, "35bd5ab2df328b37e682b348c5513aa40a640182b88d45885eeb3c6c85779c20"],
  "N12.ii": [276, "95172edfda257a306b91c715ee537ea1b0f1e88cfc22f7d9def037763ea3a1c3"],
  "N12.iii": [261, "2af6b3a97d9426211d19a3d2cd8aa9c66ff5867287344940b3e406b4aa2ace50"],
  "N12.iv": [260, "981a1792254e2f44fb994c4d0a43fc94c91350d45678bf3b36cf392215408748"],
  "N12.v": [263, "ddd228e5d72ed79cd2f5d08e4da5bf8c2a1f21c2cce54fcf13498faf324a0031"],
  "N12.vi": [275, "77c2a7e05f63853128b268a9c8f8d0076a090320b4876e67b0083d3564e46789"],
  "N12.vii": [278, "41815673a54516b3f36320c18470b22c9e9ee1f8ba4669c3006545435b333a9c"],
  "N12.viii": [277, "8ad3397778d4546d5d1cbd8bdbf31f2bf0f64d253ab095c0cd6713ab8f24f0d5"],
  "N13.i": [180, "7448315bf612d6f30c2c0cf7b9c20d08cc7b4f15d13ad72c4d2c3d7b99204f19"],
  "N13.ii": [187, "6ce5948cdd99f9b26771da05959ab386d8bb73abc0b35db3c9c439a1f0db02be"],
  "N13.iii": [159, "ef6e1b54f371063bae1206309d754a84c3237d8e245a675940791e9b63e388ad"],
  "N13.iv": [134, "993b587b5c9ce3652819f3a2f35635d24dd0d6b92813a8acfe647fbc9479825c"],
  "N13.v": [147, "9ee27fb18d4e6625dc92c078fe21c7512fb32cc7ec078b9208057ad225b0bd28"],
  "N13.vi": [152, "e3fa81d2a72d5197ea63e7960c80d6adc4a397a0a32910aa18a713eb252e3681"],
  "N13.vii": [135, "70f4f48695b043cefff6d4c47a22bfd9ae56fdef01f327091cb5458bc449da7f"],
  "N13.viii": [182, "9445e570ac21e794a2a98a672e8fc620e92b32ad243393112f322fd859a528fd"],
  "N13.ix": [187, "ee1e41c8cb85584e24eb620a6c2d81e2b1c847798d0360c1d7713189f3327598"],
  "N13.x": [196, "01016eef6569c833ecb5efc3bcaecfd79eae1e800b2550f5b99c8ae9a0813000"],
  "N13.xi": [181, "95bdb2ef4d4625f2827eed40f4c4b92a3266d09ebeab8a3405b5fdcd59444021"],
  "N13.xii": [204, "e4a461fb15483e67ee20e1ea2e1fdf621cd7d138271fd1e04057fb5e6fa5dec4"],
  "N13.xiii": [181, "77d8d392bfd901d06a170e3780f95e93bb7a89c2c09ffbac509a4ed38d7838e2"],
  "N13.xiv": [177, "1b278f0e58046ce34d0cad273b718c0de1cdfb570a1556bb860ca4c649fd83bc"],
  "N13.xv": [261, "eccff51c647f6528e71ab03eb1a88b7dc238ac86ba6af5d20f71c61b9bf915be"],
  "N13.xvi": [195, "49f3176a85aef5167768f543682d5b253b2001f980c500dfd241f62473f393ad"],
  "N14.i": [194, "b6a9d0cb8a699e6d420268e96b32fae57932b2f7a22d9dd18d87abc81c6c8e5b"],
  "N14.ii": [186, "4ea5c6238fb30c9284685ec4d6840732d88473f248ef38b3f954761339897bbf"],
  "N14.iii": [200, "86e0b32f5cec761d36a2e142d0f0f0cf0468a91f5eebd8de845190b3e6b0d188"],
  "N15.i": [208, "1a9c57ded0ddb6786957f156ff89616ff41a68d273b524fba34ac452483fd0d8"],
  "N15.ii": [212, "990da8d3e177f3b955a6b16f7db4ef8e520e77e163f4401b149ee7485dfc9bca"],
  "N15.iii": [219, "1942bd3205badae186dab9be86e6598389502b184a601fe96566f244b59ae255"],
  "N15.iv": [216, "641423c6fe2cb2cd0b8402cb564ae6c17b4b0928e0d0e44a7ef809ff2021a911"],
  "N15.v": [207, "664cbca51c8c8396450aa30fe4f5c631de19bed0b8a45f30e52f5c49c430963c"],
  "N16.i": [219, "3030a18aab142d1671d991a8f878519890e61c67e806334b3adcaae406da0c22"],
  "N16.ii": [213, "6822fdad8d05bd2b030af95beec40ea359030b4fbf8b10d0d0615a1c3230615c"],
  "N16.iii": [221, "61159f6c6e7ce515ed0c3f07d2f23767d305fa9209201a7f202b07430ae9eade"],
  "N16.iv": [196, "d5f545b6f7091f83c3d80e75915e97008937625f3c987282916ca9ed457e03ed"],
  "N16.v": [225, "b69ab3b8771ab4ae6203a3d844276d088772a35779adb9859b953c0c6972d67e"],
  "N16.vi": [231, "55114ec0a38fd47105ff77510ed28c6f774515a1329f57a62ddebfe8b73e2488"],
  "N16.vii": [209, "ac8cb8a0b4fd30e7c7cb8384c0789838d1327c878f3eb351963cc2f9f2a2b99f"],
  "N16.viii": [209, "0099194d261de6b455df7e192b009abb0a2e8693ff90696f09d04df6bf98326b"],
  "N17.i": [184, "b44239f3f682374ef2e8a7bb17f7fb54594b9d542f938e98144ef304998e63f7"],
  "N17.ii": [185, "1324597fc6cb611d0a3abfd7301a31501b9a5a60f13c191df1e31e89715b3ee4"],
  "N17.iii": [182, "2e653bdae623a434ac4c859827b36676670116e92580ced96439b2b45c1928c4"],
  "N17.iv": [170, "a4375d8d87bff045b4a4df552d4355f67a583cd5bbfcd6f7bf7d2497306ddc50"],
  "N18.i": [98, "7d334f4b4a0031381b00980f21a2a3de30d4602e20c804ae82a52886924ea5b1"],
  "N18.ii": [227, "960ca173633155e2a6498ea6950a4243908f621a79a9b546b30c9e01e21ff421"]
});
const SEP_CORPUS_SHA256 = Object.freeze([
  "0015eb50a19142472f31b911c918a67a516968b4678f83f8d5b25efd7eca39ba", "0099194d261de6b455df7e192b009abb0a2e8693ff90696f09d04df6bf98326b",
  "010112af9b34526121ccbabfb8021dbd9587d30665660c4cf409b40c0f164652", "01016eef6569c833ecb5efc3bcaecfd79eae1e800b2550f5b99c8ae9a0813000",
  "1324597fc6cb611d0a3abfd7301a31501b9a5a60f13c191df1e31e89715b3ee4", "1942bd3205badae186dab9be86e6598389502b184a601fe96566f244b59ae255",
  "19a657479208f8d92a5a6106b465f158d96262e8b4f4bb24f5155cdb7b2745fa", "1a9c57ded0ddb6786957f156ff89616ff41a68d273b524fba34ac452483fd0d8",
  "1b278f0e58046ce34d0cad273b718c0de1cdfb570a1556bb860ca4c649fd83bc", "1ea20e919b5d430e50468176df5a207d518c35d5765d2ef5bc21d57c3e981804",
  "2629413442bb1021c4706e0d6bf3e5b5aaa4b023ffd0ecb01132cc0e2cdb5a8e", "282f110848efd5ae17abb577dcada0b7982705b67dec2a870afa79cd39e73f13",
  "2af6b3a97d9426211d19a3d2cd8aa9c66ff5867287344940b3e406b4aa2ace50", "2e653bdae623a434ac4c859827b36676670116e92580ced96439b2b45c1928c4",
  "3030a18aab142d1671d991a8f878519890e61c67e806334b3adcaae406da0c22", "35bd5ab2df328b37e682b348c5513aa40a640182b88d45885eeb3c6c85779c20",
  "3ecf0c13e2d30938260d40dc62b83fb1b937b5d61a85ee5b026480492221fa01", "41815673a54516b3f36320c18470b22c9e9ee1f8ba4669c3006545435b333a9c",
  "479f2decb2d7e94413e37f5ec4c07dda20a8794f764c1cbf79e5205e74ad547c", "49f3176a85aef5167768f543682d5b253b2001f980c500dfd241f62473f393ad",
  "4ea5c6238fb30c9284685ec4d6840732d88473f248ef38b3f954761339897bbf", "52a2566e86fbc62f8fe3dbcca0c9d8808d4bcdfe406b05e812df576364948157",
  "55114ec0a38fd47105ff77510ed28c6f774515a1329f57a62ddebfe8b73e2488", "60a503b37d66040c88790da9879298c1bba9b93847d718e278c28d9f2656d175",
  "61159f6c6e7ce515ed0c3f07d2f23767d305fa9209201a7f202b07430ae9eade", "641423c6fe2cb2cd0b8402cb564ae6c17b4b0928e0d0e44a7ef809ff2021a911",
  "660b8832247f860ba9b0039985acca8789dad06ce96feaae62387b3bfbebb8fb", "664cbca51c8c8396450aa30fe4f5c631de19bed0b8a45f30e52f5c49c430963c",
  "6822fdad8d05bd2b030af95beec40ea359030b4fbf8b10d0d0615a1c3230615c", "6ce5948cdd99f9b26771da05959ab386d8bb73abc0b35db3c9c439a1f0db02be",
  "6de76282f52c6e5fb2a7f6e2e11ec09b7d0fcb4d87968bdc2a4f6bf4ecfa628b", "70f4f48695b043cefff6d4c47a22bfd9ae56fdef01f327091cb5458bc449da7f",
  "7448315bf612d6f30c2c0cf7b9c20d08cc7b4f15d13ad72c4d2c3d7b99204f19", "77c2a7e05f63853128b268a9c8f8d0076a090320b4876e67b0083d3564e46789",
  "77d8d392bfd901d06a170e3780f95e93bb7a89c2c09ffbac509a4ed38d7838e2", "7b3b9f931f318da875029721c89c24cfe463200a87c355f49d5e71ee1d7f1f7c",
  "7c19f9829981ba3f775430e1f16a5b5b19379a0e32a62d9e9947ac9638fb4865", "7d334f4b4a0031381b00980f21a2a3de30d4602e20c804ae82a52886924ea5b1",
  "86e0b32f5cec761d36a2e142d0f0f0cf0468a91f5eebd8de845190b3e6b0d188", "8ad3397778d4546d5d1cbd8bdbf31f2bf0f64d253ab095c0cd6713ab8f24f0d5",
  "9445e570ac21e794a2a98a672e8fc620e92b32ad243393112f322fd859a528fd", "95172edfda257a306b91c715ee537ea1b0f1e88cfc22f7d9def037763ea3a1c3",
  "95bdb2ef4d4625f2827eed40f4c4b92a3266d09ebeab8a3405b5fdcd59444021", "960ca173633155e2a6498ea6950a4243908f621a79a9b546b30c9e01e21ff421",
  "981a1792254e2f44fb994c4d0a43fc94c91350d45678bf3b36cf392215408748", "990da8d3e177f3b955a6b16f7db4ef8e520e77e163f4401b149ee7485dfc9bca",
  "993b587b5c9ce3652819f3a2f35635d24dd0d6b92813a8acfe647fbc9479825c", "9d30e294a679b28330b77d7a6d34c7b6719f8b6c7a4efeed8817fc7de6685f23",
  "9ee27fb18d4e6625dc92c078fe21c7512fb32cc7ec078b9208057ad225b0bd28", "a4375d8d87bff045b4a4df552d4355f67a583cd5bbfcd6f7bf7d2497306ddc50",
  "a56335dcfc3b0eea5f0e157fb3abd7f5ffaa3196726b3ee0dceaad4167b5301c", "ac1c8144e53ee8f40ab6590e86bf83d1ef40f3ea9c9bacb4f2efe922bd54d703",
  "ac8cb8a0b4fd30e7c7cb8384c0789838d1327c878f3eb351963cc2f9f2a2b99f", "ae4d9b8ac2c9dd723dbce3c0d0b3a1b9cf34cd96b348dbcecd9e65e48bcce1c2",
  "b2049c2f2bc91fc820874cfec2dca59a703fe68677b1664517096bea590b7922", "b44239f3f682374ef2e8a7bb17f7fb54594b9d542f938e98144ef304998e63f7",
  "b4d89bb99bd23d1ecac0585574ee3026f4640b974e890fd3dd7b59405fff6842", "b69ab3b8771ab4ae6203a3d844276d088772a35779adb9859b953c0c6972d67e",
  "b6a9d0cb8a699e6d420268e96b32fae57932b2f7a22d9dd18d87abc81c6c8e5b", "d5f545b6f7091f83c3d80e75915e97008937625f3c987282916ca9ed457e03ed",
  "d7862b5a6a87fcd0c3cad62557e757585055a47d0efeaf7e6e32547cf28638d0", "ddd228e5d72ed79cd2f5d08e4da5bf8c2a1f21c2cce54fcf13498faf324a0031",
  "e1c1f42c8c19f92fb83525d3e24bdadbd6c21665c5ef02f773ee1a6ce37dfc22", "e3fa81d2a72d5197ea63e7960c80d6adc4a397a0a32910aa18a713eb252e3681",
  "e4a461fb15483e67ee20e1ea2e1fdf621cd7d138271fd1e04057fb5e6fa5dec4", "eccff51c647f6528e71ab03eb1a88b7dc238ac86ba6af5d20f71c61b9bf915be",
  "ee1e41c8cb85584e24eb620a6c2d81e2b1c847798d0360c1d7713189f3327598", "ef6e1b54f371063bae1206309d754a84c3237d8e245a675940791e9b63e388ad",
  "f3fee6c3735048a61733810e5e454f0b558a9036587eafba92770b7ed02b0c59", "fb0b60cbe15186a2b31aef313d843c4b75e726f5493fa7a684e86de56565bada",
  "fb0dc3638422223b6b6f0fab8b46cbf6d603b4a495bb99e745cdaa753ee3444a"
]);
// The P0-05-SEP-WB control thresholds (slice text P5-R13b item 6; VA §2a): the
// largest value of each dimension among the corpus's verified modules without
// `work`, V53-LOOP-P06's E(run) (tools/ct1_verify.py).
const P06_MAXIMA = Object.freeze({ calls: "16781312", iterations: "16781312", steps: "67125250" });
const PHASE_P05 = Object.freeze(["air.call.recursion_rejected", "air.workbound.overflow", "air.workbound.unknown_bound",
  "air.workbound.invalid_bound", "air.workbound.missing_summary", "air.workbound.assertion_exceeded"]);

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
  const source = key.includes(".") ? F[key.split(".")[0]][key.split(".")[1]] : F[key];
  const [bytes, digest] = PINS[key];
  assert.equal(Buffer.byteLength(source, "utf8"), bytes, `${key}: pinned byte length`);
  assert.equal(hexOf(source), digest, `${key}: pinned sha256`);
  return source;
}

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
  air_abi_lane: "0.12", module_id: "v53.loop", schema: "air.typed-interface/0.12-candidate.1", types: [],
  exports: [{ function: "run", name: "run", parameters: [], return_type: "i32" }]
});

let tmp;
let fileCounter = 0;
const runtimeHost = createVerifiedTypedRuntime({ admit: async () => true });

// STATIC_REJECT at every entrypoint that verifies (P4-R8): SDK verify, CLI
// verify, CLI check --lsp-json, the LSP session, the builder and the runtime.
// A parse-time rejection is also checked on the typed-v0.53 parser itself.
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
  if (options.parseTime) {
    const parsed = capture(() => parser.typedV053.parse(source, "phase-a.air"));
    assert(parsed && parsed.code === code && parsed.loc.line === line, `parse time (phase A): ${parsed && parsed.message}`);
    outcomes.parser = { code: parsed.code, line: parsed.loc.line };
  }
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
    if (line !== undefined && outcome.line !== undefined) assert.equal(outcome.line, line, `${entrypoint} line`);
  }
  observedFailures.push({ code, kind: "STATIC_REJECT", line: sdk.loc.line });
  const out = { code, line: sdk.loc.line, entrypoints: Object.keys(outcomes) };
  if (sdk.cyclePath) out.cyclePath = sdk.cyclePath;
  if (sdk.workAssertion) out.workAssertion = { ...sdk.workAssertion };
  return { error: sdk, outcome: out };
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
  assert.deepEqual(actual, expected, "R-WB-15c measures (slice text §4.8)");
  return Object.fromEntries(MEASURE_FIELDS.map((field) => [field, measures[field]]));
}

function functionWat(wat, name) {
  const begin = wat.indexOf(`  (func $${name} `);
  assert(begin >= 0, `function $${name} is lowered`);
  const end = wat.indexOf("\n  )", begin);
  return wat.slice(begin, end);
}

function assertWorkAssertion(rejected, expected) {
  assert.deepEqual(rejected.error.workAssertion, expected, "the violation names the export, the key, the bound and E(e)'s value");
  for (const part of [`'${expected.export}'`, expected.key, `${expected.value} exceeds`, `bound ${expected.bound}`]) {
    assert(String(rejected.error.message).includes(part), `message names ${part}: ${rejected.error.message}`);
  }
  assert.equal(rejected.error.disposition, "STATIC_REJECT");
  return rejected.outcome;
}

// ---------------------------------------------------------------------------
// P0-05-SEP-WB (slice text P5-R13b; OD-P5-3 (a)). Each corpus source is
// verified with the real WorkBound phase, with the phase disabled (an empty
// `status: "ok"` analysis) and with an outcome-preserving stub (+7919 steps,
// +13 calls, +17 iterations on every `ok` summary; in a module with `work`,
// the declared dimensions of the entry summaries stay real). `c5` is control
// C5: the stub also perturbs the declared dimensions.
const SEP_COMPARE = `"use strict";
const fs = require("fs");
const path = require("path");
const [srcDir, corpusFile, stubVariant] = process.argv.slice(2);
const r = (m) => require(path.join(srcDir, m));
const sp = r("source_profile.js");
const verifier = r("verifier.js");
const wb = r("workbound.js");
const PHASE_P05 = new Set(${JSON.stringify(PHASE_P05)});
const PERTURB = { calls: 13n, iterations: 17n, steps: 7919n };
const real = wb.analyzeVerifiedTypedModule;
const perturb = (values, keep) => new Map([...values].map(([name, value]) => [name, value && value.ok ? { ok: true, value: wb.summary({
  calls: keep.has("calls") ? value.value.calls : value.value.calls + PERTURB.calls,
  effects: value.value.effects,
  iterations: keep.has("iterations") ? value.value.iterations : value.value.iterations + PERTURB.iterations,
  steps: keep.has("steps") ? value.value.steps : value.value.steps + PERTURB.steps
}) } : value]));
const modes = {
  real,
  disabled: () => ({ cycles: [], entries: new Map(), functions: new Map(), primary: null, roots: [], stats: {}, status: "ok" }),
  stubbed: (mod) => {
    const analysis = real(mod);
    const declared = new Set(stubVariant === "c5" || !mod.work ? [] : mod.work.limits.map((limit) => limit.key));
    return { ...analysis, entries: perturb(analysis.entries, declared), functions: perturb(analysis.functions, new Set()) };
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
const counts = { assertionExceeded: 0, phaseRejections: 0, rejected: 0, sources: 0, verified: 0, workVerified: 0 };
for (const line of fs.readFileSync(corpusFile, "utf8").split("\\n").filter(Boolean)) {
  const entry = JSON.parse(line);
  counts.sources += 1;
  const got = { disabled: outcome(entry, "disabled"), real: outcome(entry, "real"), stubbed: outcome(entry, "stubbed") };
  const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  const phase = got.real.verdict === "REJECTED" && PHASE_P05.has(got.real.code);
  counts[got.real.verdict === "VERIFIED" ? "verified" : "rejected"] += 1;
  if (phase) counts.phaseRejections += 1;
  if (got.real.code === "air.workbound.assertion_exceeded") counts.assertionExceeded += 1;
  if (got.real.verdict === "VERIFIED" && /^work[\\s{]/mu.test(entry.source)) counts.workVerified += 1;
  if (!same(got.stubbed, got.real)) differences.push({ got, mode: "stubbed", sha256: entry.sha256 });
  if (phase ? got.disabled.verdict !== "VERIFIED" : !same(got.disabled, got.real)) differences.push({ got, mode: "disabled", sha256: entry.sha256 });
}
const exportNames = [...Object.keys(verifier), ...Object.keys(verifier.typedV053 || {})];
process.stdout.write(JSON.stringify({ budgetOrGrantExports: exportNames.filter((name) => /budget|grant|admi/iu.test(name)), counts, differenceCount: differences.length, differences: differences.slice(0, 40), unchangedAsts }));
`;

// Controls C1-C4 (P5-R13b item 6 (i)): each mutant is applied to a scratch copy
// of src/, never to the repository's src/, and must make the comparison report
// at least one difference.
const WORK_CHECK_ANCHOR = "    const entry = analysis.entries.get(fn.name);";
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
const MUTANTS = Object.freeze({
  C1: { anchor: WORK_CHECK_ANCHOR, description: "the work check reads B(e) instead of E(e)", replacement: "    const entry = analysis.functions.get(fn.name);" },
  C2: { anchor: PHASE_OK_ANCHOR, description: `reject a module without work when E(e).steps > ${P06_MAXIMA.steps}`, replacement: thresholdMutant("steps") },
  C3: { anchor: PHASE_OK_ANCHOR, description: `reject a module without work when E(e).calls > ${P06_MAXIMA.calls}`, replacement: thresholdMutant("calls") },
  C4: { anchor: PHASE_OK_ANCHOR, description: `reject a module without work when E(e).iterations > ${P06_MAXIMA.iterations}`, replacement: thresholdMutant("iterations") }
});

// ---------------------------------------------------------------------------
// REG-P05-QA-F1-*: regression tests for the independent QA finding P05-QA-F-1
// (a `-0` fold count was VERIFIED but could not be lowered). Test-local IDs,
// not catalogue vectors, and not in the 71-text P0-05-SEP-WB corpus. Expected
// values are R2.2's P5-R3 with P5-R11's decimal form ("no sign and no leading
// zero"): a signed count or maximum is air.workbound.invalid_bound at the fold
// line (9) at every entrypoint (P4-R8).
const signedCount = (count) => mod(STEP, run(/max/u.test(count) ? "s: i32, n: i32" : "s: i32", "i32", [FOLD("step", "%s", count), "return %r"]));
const REG_F1 = Object.freeze({
  NEG0: ["-0"], MAXNEG0: ["%n max -0"], PLUS0: ["+0", "%n max +0"], NEG00: ["-00", "%n max -00"], NEG1: ["-1"]
});
// The P0-05 candidate before the correction (dev b5a4bedf / public 1706d161),
// run from git objects in a bounded child process.
const P05_QA_F1_BASE_COMMITS = ["b5a4bedf67848bfec3c3a2c3da7022c616731be6", "1706d16172adb39fded156f18f16bb67b56c3c3d"];
function regF1Baseline(counts) {
  const dir = path.join(tmp, "p05_qa_f1_base");
  let commit = null;
  for (const candidate of P05_QA_F1_BASE_COMMITS) {
    if (childProcess.spawnSync("git", ["cat-file", "-e", `${candidate}^{commit}`], { cwd: ROOT }).status === 0) { commit = candidate; break; }
  }
  assert(commit, "the P0-05 candidate base commit is not in this repository");
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
const { lowerToWat } = require(path.join(src, "lower_wasm.js"));
const options = { allowCandidateProfile: true, sourceProfile: "typed-v0.53" };
const out = {};
try { sp.verifySource(sp.parseSource(source, "base.air", options), options); out.sdk_verify = "VERIFIED"; } catch (error) { out.sdk_verify = error.code || error.name; }
try { lowerToWat(parser.typedV053.parse(source, "base.air"), { maxWatBytes: 4194304 }); out.lowerToWat = "VERIFIED"; } catch (error) { out.lowerToWat = error.code || error.name; }
process.stdout.write(JSON.stringify(out));
`);
  const outcomes = {};
  for (const count of counts) {
    const sourceFile = path.join(dir, `count_${Object.keys(outcomes).length}.air`);
    fs.writeFileSync(sourceFile, signedCount(count));
    const out = childProcess.spawnSync(process.execPath, [script, path.join(dir, "src"), sourceFile], {
      encoding: "utf8", env: { ...process.env, NODE_PATH: path.join(ROOT, "node_modules") }, killSignal: "SIGKILL", maxBuffer: 16 * 1024 * 1024, timeout: 60000
    });
    assert(!out.error && out.signal === null, `base probe '${count}' did not finish within 60 s`);
    assert.equal(out.status, 0, out.stderr);
    outcomes[count] = JSON.parse(out.stdout);
  }
  return { commit, outcomes };
}

// invalid_bound at line 9 at all seven entrypoints: the six of staticReject
// and lowerToWat on the parsed AST (it verifies first); nothing is built,
// cached or compiled.
async function regF1Rejected(count) {
  const source = signedCount(count);
  const rejected = await staticReject(source, "air.workbound.invalid_bound", 9);
  const lowered = capture(() => lowerToWat(parser.typedV053.parse(source, "reg.air"), { maxWatBytes: MAX_WAT }));
  assert(lowered && lowered.code === "air.workbound.invalid_bound" && lowered.loc && lowered.loc.line === 9, `lowerToWat: ${lowered && lowered.message}`);
  const runtime = createVerifiedTypedRuntime({ admit: async () => true });
  await runtime.build({ ...GATED, descriptor: descriptorOf(source), source }).then(() => assert.fail("runtime: no artifact"), () => null);
  assert.equal(runtime.inspect().cache.entries, 0, "nothing cached");
  assert.equal(runtime.inspect().counters.compilations, 0, "nothing compiled");
  return { ...rejected.outcome, entrypoints: [...rejected.outcome.entrypoints, "lowerToWat"], source_sha256: hexOf(source) };
}

async function regP05QaF1() {
  await vector("REG-P05-QA-F1-BASELINE", () => {
    // Before the correction the count leaf read `-0` as 0: SDK verify said
    // VERIFIED, and the lowering refused the module.
    const base = regF1Baseline(["-0", "%n max -0", "-1"]);
    for (const count of ["-0", "%n max -0"]) assert.deepEqual(base.outcomes[count], { lowerToWat: "air.v051.typed_lowering_unsupported", sdk_verify: "VERIFIED" }, count);
    assert.deepEqual(base.outcomes["-1"], { lowerToWat: "air.workbound.invalid_bound", sdk_verify: "air.workbound.invalid_bound" });
    return { value: { base_commit: base.commit, outcomes: base.outcomes } };
  });
  for (const [name, counts] of Object.entries(REG_F1)) {
    await vector(`REG-P05-QA-F1-${name}`, async () => {
      const value = {};
      for (const count of counts) value[count] = await regF1Rejected(count);
      return { value };
    });
  }
}

// ---------------------------------------------------------------------------
async function main() {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "air-v053-p005-"));
  try {
    // ------------------------------------------------------------------
    // LOOP — R3.1 rows (VECTORS.md lines 282-304) with the R2.2 row amendments.
    const p01 = pinned("P01");
    let p01Run;
    await vector("V53-LOOP-P01", async () => {
      p01Run = await accepted(p01, [["run", [10], { value: 15 }]], "p01");
      return { value: { "E(run)": expectE(p01Run.built, "run", 22, 5, 5), invocations: p01Run.invocations, line: 9, measures: expectMeasures(p01, { analysis_units: 8, call_sites: 0, callback_refs: 1, decls: 2, stmts: 4 }) }, sourceDigest: sha256(p01) };
    });
    const p02 = pinned("P02");
    await vector("V53-LOOP-P02", async () => {
      const run2 = await accepted(p02, [["run", [0, 3], { value: 3 }], ["run", [0, 8], { value: 8 }]], "p02");
      // The guard adds no CT-1 row: the dynamic count is charged at its maximum (P5-R5).
      return { value: { "E(run)": expectE(run2.built, "run", 34, 8, 8), invocations: run2.invocations, measures: expectMeasures(p02, { analysis_units: 8, callback_refs: 1 }) }, sourceDigest: sha256(p02) };
    });
    const guard = { code: "air.loop.count_out_of_range", failureReason: 32 };
    await vector("V53-LOOP-N01", async () => ({ value: (await accepted(p02, [["run", [0, 9], guard]], "n01")).invocations, sourceDigest: sha256(p02) }));
    await vector("V53-LOOP-N02", async () => ({ value: (await accepted(p02, [["run", [0, -1], guard]], "n02")).invocations, sourceDigest: sha256(p02) }));
    await vector("V53-LOOP-N03", async () => ({ value: (await staticReject(pinned("N03"), "air.workbound.unknown_bound", 9)).outcome }));
    await vector("V53-LOOP-N04", async () => ({
      value: {
        i: (await staticReject(pinned("N04i"), "air.workbound.invalid_bound", 9)).outcome,
        ii: (await staticReject(pinned("N04ii"), "air.workbound.invalid_bound", 9)).outcome
      }
    }));
    const p03 = pinned("P03");
    await vector("V53-LOOP-P03", async () => {
      const run3 = await accepted(p03, [["run", [10], { value: 10 }]], "p03");
      return { value: { "E(run)": expectE(run3.built, "run", 2), invocations: run3.invocations }, sourceDigest: sha256(p03) };
    });
    const p04 = pinned("P04");
    await vector("V53-LOOP-P04", async () => {
      const run4 = await accepted(p04, [["run", [], { value: 10 }]], "p04");
      // R2.2 row amendment, informative: E(run) = S{steps:22, calls:5, iterations:5}.
      return { value: { "E(run)": expectE(run4.built, "run", 22, 5, 5), invocations: run4.invocations, measures: expectMeasures(p04, { analysis_units: 8, callback_refs: 1 }) }, sourceDigest: sha256(p04) };
    });
    await vector("V53-LOOP-P05", () => ({
      status: "DEFERRED",
      value: { first_executable: "P0-10", reason: "typed extern output.emit arrives with P0-10; no mock extern (PF-1)", recorded_expectation: "run() = 100; the host sees exactly 100 emits; E = S{steps:502, calls:100, iterations:100, effects{output.emit:100}}; demand { output.emit <= 1 } -> air.effect.demand_exceeded" }
    }));
    const p06 = pinned("P06");
    let p06Run;
    await vector("V53-LOOP-P06", async () => {
      p06Run = await accepted(p06, [["run", [], { value: 16777216 }]], "p06");
      // Accepted as a bound, not a cap (§6.7); no WB_MAX overflow.
      return {
        value: {
          "B(f)": expectB(p06Run.built, "f", 16386, 4096, 4096),
          "E(run)": expectE(p06Run.built, "run", 67125250, 16781312, 16781312),
          invocations: p06Run.invocations,
          measures: expectMeasures(p06, { analysis_units: 12, call_sites: 0, callback_refs: 2, decls: 3, stmts: 6 })
        },
        sourceDigest: sha256(p06)
      };
    });
    const formUnsupported = async (key) => (await staticReject(pinned(key), "air.loop.form_unsupported", 9, { parseTime: true })).outcome;
    await vector("V53-LOOP-N05", async () => ({ value: await formUnsupported("N05") }));
    await vector("V53-LOOP-N06", async () => ({ value: { i: await formUnsupported("N06i"), ii: await formUnsupported("N06ii"), iii: await formUnsupported("N06iii") } }));
    // `%r` is not in scope; the parse-time rejection comes first (P5-R9).
    await vector("V53-LOOP-N07", async () => ({ value: { i: await formUnsupported("N07i"), ii: await formUnsupported("N07ii") } }));
    await vector("V53-LOOP-N08", async () => {
      const rejected = await staticReject(pinned("N08"), "air.call.recursion_rejected", 4);
      assert.equal(rejected.outcome.cyclePath, "@f -> @g -> @f");
      return { value: rejected.outcome };
    });
    await vector("V53-LOOP-N09", async () => ({ value: { i: await formUnsupported("N09i"), ii: await formUnsupported("N09ii") } }));
    // The root failure is g's fold (line 9), not run's (line 14): count 0 does not erase it.
    await vector("V53-LOOP-N11", async () => ({ value: (await staticReject(pinned("N11"), "air.workbound.unknown_bound", 9)).outcome }));

    // ------------------------------------------------------------------
    // Inherited and composite (slice text §6).
    await vector("V53-REF-N12@P0-05", async () => {
      // Part 32 is first executable here: V53-LOOP-P02 run(0, 9) through the
      // typed-v0.53 adapter yields exactly the identity of value 32.
      const built = await buildVerifiedTypedModule({ ...GATED, descriptor: descriptorOf(p02), source: p02 });
      const viaAdapter = await invocationOutcome(() => invokeVerifiedTypedExport(built, "run", [0, 9]));
      assert.deepEqual(viaAdapter, guard);
      const instance = new WebAssembly.Instance(new WebAssembly.Module(built.wasmBytes), {});
      let identity = null;
      try { instance.exports.run(0, 9); } catch (error) { identity = typedV053FailureIdentity(error, instance); }
      assert.deepEqual(identity, { code: "air.loop.count_out_of_range", value: 32 });
      assert(!["air.runtime.trap_unclassified", "air.runtime.failure_reason_unknown"].includes(identity.code));
      return { value: { composite: "DEFERRED -> P0-08 (values 33-35)", part: 32, part_status: "PASS", wasm_identity: identity, adapter: viaAdapter }, sourceDigest: sha256(p02) };
    });
    const phiLoop = fs.readFileSync(path.join(ROOT, "examples", "phi_loop.air"), "utf8");
    assert.equal(sha256(phiLoop), "sha256:a301fa5044d3d66109f1a4eb586dd58ce4efd4ce9e76f592be2312400b90a7eb", "examples/phi_loop.air unchanged");
    await vector("V53-WB-H01", async () => {
      const partC = (await staticReject(phiLoop, "air.control.unstructured_unsupported", 5)).outcome;
      return {
        status: "DEFERRED",
        value: { first_executable: "P0-10", kind: "COMPOSITE", parts: { a: { slice: "P0-02", status: "PASS (V53-WB-P04)" }, b: { slice: "P0-10", status: "DEFERRED (V53-LOOP-P05)" }, c: { outcome: partC, slice: "P0-04", status: "PASS (re-run here)" } } }
      };
    });

    // ------------------------------------------------------------------
    // The R2.2 additions (VECTORS_ADDITIONS.md §2).
    const p07 = pinned("P07");
    await vector("V53-LOOP-P07", async () => {
      const run7 = await accepted(p07, [["run", [0], { value: 0 }], ["run", [3], { value: 3 }], ["run", [6], { value: 15 }], ["run", [7], guard]], "p07");
      return {
        value: {
          "E(run)": expectE(run7.built, "run", 26, 6, 6),
          invocations: run7.invocations,
          measures: expectMeasures(p07, { analysis_units: 8, call_sites: 0, callback_refs: 1, decls: 2, import_edges: 0, modules: 1, nesting_depth: 1, stmts: 4 })
        },
        sourceDigest: sha256(p07)
      };
    });
    const p08 = pinned("P08");
    const p08fmt = pinned("P08fmt");
    const p08iii = pinned("P08iii");
    const p08iiiFmt = pinned("P08iiiFmt");
    let p08Identity;
    await vector("V53-LOOP-P08", async () => {
      const run8 = await accepted(p08, [["run", [10], { value: 15 }]], "p08");
      const measures = expectMeasures(p08, { analysis_units: 9, call_sites: 0, callback_refs: 1, decls: 3, import_edges: 0, modules: 1, stmts: 4 });
      // P5-R13: lowering ignores the declaration; the WAT equals V53-LOOP-P01's.
      assert(p01Run, "V53-LOOP-P01 ran first");
      assert.equal(run8.wat, p01Run.wat, "the lowered WAT is byte-identical to V53-LOOP-P01's");
      // The coupling control (P5-R13b (iii)(b)): same descriptor, descriptor
      // digest, source signature, Wasm, WAT and summary-record entries; the
      // build records differ only in sourceDigest and artifactDigest, and the
      // WorkBoundKeyV1 only in body_digest. No field carries a work key or bound.
      const [a, b] = [p01Run.built, run8.built];
      const differing = Object.keys(a).filter((key) => key !== "wasmBytes" && canonicalJson(a[key]) !== canonicalJson(b[key])).sort();
      assert.deepEqual(differing, ["artifactDigest", "sourceDigest"]);
      assert(Buffer.from(a.wasmBytes).equals(Buffer.from(b.wasmBytes)), "same Wasm bytes");
      const [wa, wbd] = [wb.inspectBoundWorkBound(a), wb.inspectBoundWorkBound(b)];
      assert.deepEqual(wbd.record.entries, wa.record.entries);
      assert.deepEqual(wbd.functions, wa.functions);
      assert.deepEqual(Object.keys(wa.key).filter((key) => canonicalJson(wa.key[key]) !== canonicalJson(wbd.key[key])), ["body_digest"]);
      assert.equal(wbd.key.body_digest, b.sourceDigest);
      // Admission requests, source by source in the same order: only the
      // source identity differs.
      const requestsOf = async (source) => {
        const requests = [];
        const recorder = createVerifiedTypedRuntime({ admit: async (request) => { requests.push(request); return true; } });
        await recorder.invoke(await recorder.build({ ...GATED, descriptor: descriptorOf(source), source }), "run", [10]);
        return requests;
      };
      const [requests01, requests08] = [await requestsOf(p01), await requestsOf(p08)];
      assert.equal(requests08.length, requests01.length, "the same number of admission requests");
      const admissionDiff = [...new Set(requests01.flatMap((request, index) => {
        assert.deepEqual(Object.keys(requests08[index]).sort(), Object.keys(request).sort(), "the same admission request fields");
        return Object.keys(request).filter((key) => canonicalJson(request[key]) !== canonicalJson(requests08[index][key]));
      }))].sort();
      assert.deepEqual(admissionDiff, ["artifactDigest", "sourceDigest"], "no admission input changes but the source identity");
      const withoutBytes = ({ wasmBytes, ...rest }) => rest;
      for (const value of [withoutBytes(a), withoutBytes(b), wa.key, wbd.key, wbd.record, ...requests08]) {
        assert.doesNotMatch(JSON.stringify(plain(value)), /"work"|"limits"|work \{|<= 22/u, "no field carries a work key or bound");
      }
      p08Identity = { admission_request_differs_only_in: admissionDiff, build_record_differs_only_in: differing, key_differs_only_in: ["body_digest"], same: ["descriptor", "descriptorDigest", "sourceSignature", "wasmDigest", "lowered WAT", "summary-record entries"] };
      // V53-FMT-01 (P5-R11): the canonical formatter output, and idempotence.
      const once = sp.formatSource(typedV053(p08), GATED);
      assert.equal(once, p08fmt, "the canonical formatter output (sha256 1ea20e91...)");
      assert.equal(sp.formatSource(typedV053(once), GATED), once, "formatting it again changes nothing");
      assert.equal(once.split("\n")[1], "work { steps <= 22, calls <= 5, iterations <= 5 }", "the work line at line 2");
      return { value: { "E(run)": expectE(run8.built, "run", 22, 5, 5), artifact_identity: p08Identity, formatted_sha256: hexOf(once), invocations: run8.invocations, measures, work_line: 3 }, sourceDigest: sha256(p08) };
    });
    await vector("V53-LOOP-P08 (ii)", async () => {
      const source = pinned("P08ii");
      const run8 = await accepted(source, [["run", [10], { value: 15 }]], "p08ii");
      // E(run) = ingress 1 + B(run) 22 = 23 <= 23 (P5-R12 binds the entry summary).
      return { value: { "B(run)": expectB(run8.built, "run", 22, 5, 5), "E(run)": expectE(run8.built, "run", 23, 5, 5), invocations: run8.invocations, measures: expectMeasures(source, { analysis_units: 9, callback_refs: 1, decls: 3, stmts: 4 }) }, sourceDigest: sha256(source) };
    });
    await vector("V53-LOOP-P08 (iii)", async () => {
      const run8 = await accepted(p08iii, [["run", [10], { value: 15 }]], "p08iii");
      const once = sp.formatSource(typedV053(p08iii), GATED);
      assert.equal(once, p08iiiFmt, "the canonical formatter output (sha256 b2049c2f...)");
      assert.equal(sp.formatSource(typedV053(once), GATED), once, "formatting it again changes nothing");
      return { value: { "E(run)": expectE(run8.built, "run", 22, 5, 5), formatted_sha256: hexOf(once), invocations: run8.invocations, measures: expectMeasures(p08iii, { analysis_units: 9, decls: 3 }) }, sourceDigest: sha256(p08iii) };
    });
    const p09 = pinned("P09");
    await vector("V53-LOOP-P09", async () => {
      const run9 = await accepted(p09, [["run", [], { value: { tag: "none", type: "option<i32>" } }]], "p09");
      return {
        value: {
          "E(run)": expectE(run9.built, "run", 15, 4, 4),
          invocations: run9.invocations,
          measures: expectMeasures(p09, { analysis_units: 7, call_sites: 0, callback_refs: 1, decls: 2, import_edges: 0, modules: 1, nesting_depth: 1, stmts: 3 })
        },
        sourceDigest: sha256(p09)
      };
    });
    await vector("V53-LOOP-N12", async () => {
      const mismatch = "air.v051.typed_atom_type_mismatch";
      const admittedCase = async (key, args, value) => {
        const source = pinned(key);
        const runN = await accepted(source, [["run", args, { value }]], key.replace(".", "_"));
        // No refinement.check is charged or emitted anywhere in the fold (P5-R2a).
        assert(!functionWat(runN.wat, "run").includes("__air_v053_refinement_assignment_out_of_range"), `${key}: no check at the fold`);
        return { "E(run)": expectE(runN.built, "run", 12, 3, 3), invocations: runN.invocations, measures: expectMeasures(source, { analysis_units: 10, callback_refs: 1 }) };
      };
      return {
        value: {
          i: (await staticReject(pinned("N12.i"), mismatch, 13)).outcome,
          ii: await admittedCase("N12.ii", [5], 5),
          iii: (await staticReject(pinned("N12.iii"), mismatch, 13)).outcome,
          iv: await admittedCase("N12.iv", [7], 7),
          v: (await staticReject(pinned("N12.v"), mismatch, 13)).outcome,
          vi: await admittedCase("N12.vi", [50], 50),
          vii: await admittedCase("N12.vii", [7], 7),
          viii: (await staticReject(pinned("N12.viii"), mismatch, 13)).outcome
        }
      };
    });
    await vector("V53-LOOP-N13", async () => {
      const cases = [
        ["i", "air.call.unknown_function", 9], ["ii", "air.call.unknown_function", 9], ["iii", "air.call.argument_count_mismatch", 8],
        ["iv", "air.call.argument_count_mismatch", 8], ["v", "air.v051.typed_atom_type_mismatch", 8], ["vi", "air.v051.typed_atom_type_mismatch", 8],
        ["vii", "air.v051.typed_atom_type_mismatch", 8], ["viii", "air.v051.typed_atom_type_mismatch", 9], ["ix", "air.v051.local_unknown", 9],
        ["x", "air.v051.typed_atom_type_mismatch", 9], ["xi", "air.workbound.invalid_bound", 9], ["xii", "air.workbound.invalid_bound", 9],
        ["xiii", "air.v051.typed_atom_type_mismatch", 9], ["xiv", "air.v051.typed_syntax_invalid", 9],
        // Two roots: run's 4097 (line 4) comes before g's bare count (line 9) by position (R-WB-2f step 4).
        ["xv", "air.workbound.invalid_bound", 4], ["xvi", "air.workbound.unknown_bound", 9]
      ];
      const value = {};
      for (const [label, code, line] of cases) value[label] = (await staticReject(pinned(`N13.${label}`), code, line, { parseTime: label === "xiv" })).outcome;
      return { value };
    });
    await vector("V53-LOOP-N14", async () => {
      const n14i = pinned("N14.i");
      const i = await accepted(n14i, [["run", [], guard]], "n14i");
      const n14ii = pinned("N14.ii");
      const ii = await accepted(n14ii, [["run", [0], { value: 7 }], ["run", [1], guard]], "n14ii");
      const n14iii = pinned("N14.iii");
      const iii = await accepted(n14iii, [["run", [0], { value: 7 }], ["run", [1], { code: "air.numeric.checked_failure", failureReason: 2, reason: "division_by_zero" }], ["run", [5], guard]], "n14iii");
      const iv = await accepted(p02, [["run", [0, 2147483647], guard], ["run", [0, -2147483648], guard], ["run", [0, 0], { value: 0 }]], "n14iv");
      return {
        value: {
          i: { "E(run)": expectE(i.built, "run", 35, 8, 8), invocations: i.invocations, measures: expectMeasures(n14i, { analysis_units: 9, stmts: 5 }), static_rejection: false },
          ii: { "E(run)": expectE(ii.built, "run", 2), invocations: ii.invocations },
          iii: { "E(run)": expectE(iii.built, "run", 18, 4, 4), invocations: iii.invocations, measures: expectMeasures(n14iii, { analysis_units: 8 }) },
          iv: { invocations: iv.invocations }
        }
      };
    });
    await vector("V53-LOOP-N15", async () => {
      const exceeded = "air.workbound.assertion_exceeded";
      return {
        value: {
          i: assertWorkAssertion(await staticReject(pinned("N15.i"), exceeded, 3), { bound: "21", export: "run", key: "steps", value: "22" }),
          ii: assertWorkAssertion(await staticReject(pinned("N15.ii"), exceeded, 3), { bound: "4", export: "run", key: "iterations", value: "5" }),
          // The summary fails first; no assertion is checked.
          iii: (await staticReject(pinned("N15.iii"), "air.workbound.unknown_bound", 11)).outcome,
          // E(run) = 23 although B(run) = 22: the entry summary is bound.
          iv: assertWorkAssertion(await staticReject(pinned("N15.iv"), exceeded, 3), { bound: "22", export: "run", key: "steps", value: "23" }),
          v: assertWorkAssertion(await staticReject(pinned("N15.v"), exceeded, 3), { bound: "4", export: "run", key: "calls", value: "5" })
        }
      };
    });
    await vector("V53-LOOP-N16", async () => {
      const value = {};
      for (const label of ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii"]) {
        value[label] = (await staticReject(pinned(`N16.${label}`), "air.v051.typed_syntax_invalid", label === "vi" ? 5 : 3, { parseTime: true })).outcome;
      }
      return { value };
    });
    await vector("V53-LOOP-N17", async () => ({
      value: {
        i: (await staticReject(pinned("N17.i"), "air.loop.form_unsupported", 9, { parseTime: true })).outcome,
        ii: (await staticReject(pinned("N17.ii"), "air.loop.form_unsupported", 9, { parseTime: true })).outcome,
        iii: (await staticReject(pinned("N17.iii"), "air.loop.form_unsupported", 9, { parseTime: true })).outcome,
        iv: (await staticReject(pinned("N17.iv"), "air.v051.typed_syntax_invalid", 9, { parseTime: true })).outcome
      }
    }));
    await vector("V53-LOOP-N18", async () => {
      const i = await staticReject(pinned("N18.i"), "air.call.recursion_rejected", 4);
      assert.equal(i.outcome.cyclePath, "@f -> @f");
      const n18ii = pinned("N18.ii");
      const measures = expectMeasures(n18ii, { analysis_units: 12, call_sites: 1, callback_refs: 1, decls: 2, nesting_depth: 2, stmts: 7 });
      const ii = await staticReject(n18ii, "air.call.recursion_rejected", 5);
      assert.equal(ii.outcome.cyclePath, "@f -> @g -> @f");
      return { value: { i: i.outcome, ii: { ...ii.outcome, measures } } };
    });

    // ------------------------------------------------------------------
    // Slice checks with no vector ID (card exact_evidence; slice text §4.9, §5).
    await vector("P0-05-CHECK-CT1", () => {
      const file = path.join(ROOT, "src", "workbound_cost_table_v1.json");
      const blob = childProcess.spawnSync("git", ["hash-object", file], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
      assert.equal(blob, "3b6b7a0a4a8512f884347b50ead1a7d78ef968a6");
      assert.equal(sha256(fs.readFileSync(file)), "sha256:b3b1730afdce68b2f739d988ba08faf5e1e4ffc6cc3d8f63af4f98e920c55e19");
      assert.equal(wb.COST_TABLE_DIGEST, "sha256:b53e8e6a5755c61a2c755acc8746a9bdadf5c755bbbf203a7e5d26896dc92f70");
      assert.equal(wb.LOOP_MAX, 4096n, "LOOP_MAX (OPEN-14 (a))");
      return { value: { LOOP_MAX: "4096", blob, cost_table_digest: wb.COST_TABLE_DIGEST, revision: JSON.parse(fs.readFileSync(file, "utf8")).revision } };
    });
    await vector("P0-05-CHECK-FLAGS", () => {
      // LOOP_FORMS_ADMITTED=loop.fold-only: the canonical fold verifies
      // (V53-LOOP-P01..P09 above) and every other form is form_unsupported
      // (V53-LOOP-N05, N06, N07, N09, N17). INDEPENDENT_FUEL=false: a fold
      // lowers to one Wasm `loop` whose size does not depend on n, with no
      // other counter, budget or fuel check.
      assert(p01Run && p06Run, "V53-LOOP-P01 and P06 ran first");
      const literal = (count) => lowerToWat(typedV053(mod(STEP, run("seed: i32", "i32", [FOLD("step", "%seed", count), "return %r"]))), { maxWatBytes: MAX_WAT });
      const [w0, w5, w4096] = [literal("0"), literal("5"), literal("4096")];
      assert.equal(w5, p01Run.wat);
      assert.equal(w0.replace("i32.const 0\n    i32.ge_s", "i32.const N\n    i32.ge_s"), w5.replace("i32.const 5\n    i32.ge_s", "i32.const N\n    i32.ge_s"), "count 0 and 5 differ only in the count literal");
      assert.equal(w4096.replace("i32.const 4096\n    i32.ge_s", "i32.const N\n    i32.ge_s"), w5.replace("i32.const 5\n    i32.ge_s", "i32.const N\n    i32.ge_s"), "count 4096 and 5 differ only in the count literal");
      const loops = (wat) => (wat.match(/^ {4}loop$/gmu) || []).length;
      assert.equal(loops(w5), 1, "one Wasm loop per fold");
      assert.equal(loops(p06Run.wat), 2, "V53-LOOP-P06: two folds, two loops (never unrolled)");
      assert.equal((p06Run.wat.match(/\(global /gu) || []).length, 1, "no fuel global; the one global is __air_failure_reason");
      // The fold's AST is a tree under enumerable properties (P5-R1 note).
      const counts = new Map();
      const stack = [parser.typedV053.parse(p06, "tree.air")];
      while (stack.length) {
        const value = stack.pop();
        if (!value || typeof value !== "object") continue;
        counts.set(value, (counts.get(value) || 0) + 1);
        for (const item of Array.isArray(value) ? value : Object.values(value)) stack.push(item);
      }
      assert([...counts.values()].every((count) => count === 1), "every AST object is reached through exactly one enumerable path");
      return { value: { INDEPENDENT_FUEL: false, LOOP_FORMS_ADMITTED: "loop.fold-only", QA_STATUS: "AWAITING_EXACT_SHA_QA", p06_loops: 2, p06_wat_bytes: Buffer.byteLength(p06Run.wat, "utf8"), wat_bytes_by_count: { 0: Buffer.byteLength(w0, "utf8"), 5: Buffer.byteLength(w5, "utf8"), 4096: Buffer.byteLength(w4096, "utf8") } } };
    });

    // ------------------------------------------------------------------
    // P0-05-SEP-WB (slice text P5-R13b; VA §2a).
    await vector("P0-05-SEP-WB", () => {
      // Item 1: the explicit corpus, every distinct fixture text of the
      // generator, whatever its vector does with it.
      const texts = new Map();
      const collect = (value) => {
        if (typeof value === "string") texts.set(hexOf(value), value);
        else for (const item of Object.values(value)) collect(item);
      };
      collect(F);
      const corpusShas = [...texts.keys()].sort();
      assert.equal(corpusShas.length, 71, "71 distinct fixture texts");
      assert.deepEqual(corpusShas, [...SEP_CORPUS_SHA256], "the corpus is exactly the listed sha256 set");
      const label = new Map();
      for (const [key, [, digest]] of Object.entries(PINS)) if (!label.has(digest)) label.set(digest, key);
      const dir = path.join(tmp, "sep05");
      fs.mkdirSync(dir);
      const corpusFile = path.join(dir, "corpus.jsonl");
      fs.writeFileSync(corpusFile, `${corpusShas.map((digest) => JSON.stringify({ options: GATED, sha256: digest, source: texts.get(digest) })).join("\n")}\n`);
      const compareScript = path.join(dir, "compare.js");
      fs.writeFileSync(compareScript, SEP_COMPARE);
      const compare = (srcDir, variant) => {
        const out = childProcess.spawnSync(process.execPath, [compareScript, srcDir, corpusFile, variant], {
          cwd: dir, encoding: "utf8", env: { ...process.env, NODE_PATH: path.join(ROOT, "node_modules") }, killSignal: "SIGKILL", maxBuffer: 256 * 1024 * 1024, timeout: 300000
        });
        assert(!out.error && out.signal === null && out.status === 0, `compare (${variant}): ${out.stderr || out.error}`);
        return JSON.parse(out.stdout);
      };
      const firstDifference = (behaviour) => {
        const item = behaviour.differences[0];
        return item ? { mode: item.mode, real: item.got.real, source: label.get(item.sha256) || item.sha256, stubbed_or_disabled: item.got[item.mode] } : null;
      };
      // Items 2-5: the real src/ with the outcome-preserving stub.
      const behaviour = compare(path.join(ROOT, "src"), "outcome-preserving");
      assert.deepEqual(behaviour.budgetOrGrantExports, [], "(iii)(a) no verifier export accepts or returns a Budget or grant");
      assert.equal(behaviour.counts.sources, 71);
      assert.equal(behaviour.differenceCount, 0, `WorkBound changed a verdict outside the work boundary: ${JSON.stringify(behaviour.differences, null, 2).slice(0, 4000)}`);
      // Item 6, coverage: a work source that verifies, assertion_exceeded, and R-WB-2 phase rejections.
      assert(behaviour.counts.workVerified >= 1 && behaviour.counts.assertionExceeded >= 1 && behaviour.counts.phaseRejections > behaviour.counts.assertionExceeded, JSON.stringify(behaviour.counts));
      // Item 6 (i): the mutant controls C1-C4, each on a scratch copy of src/.
      const controls = {};
      const verifierText = fs.readFileSync(path.join(ROOT, "src", "verifier.js"), "utf8");
      for (const [name, mutant] of Object.entries(MUTANTS)) {
        assert.equal(verifierText.split(mutant.anchor).length, 2, `${name}: the anchor occurs exactly once`);
        const scratch = path.join(dir, `src-${name}`);
        fs.cpSync(path.join(ROOT, "src"), scratch, { recursive: true });
        fs.writeFileSync(path.join(scratch, "verifier.js"), verifierText.replace(mutant.anchor, mutant.replacement));
        const mutated = compare(scratch, "outcome-preserving");
        assert(mutated.differenceCount > 0, `${name} (${mutant.description}) must make P0-05-SEP-WB fail`);
        const sources = [...new Set(mutated.differences.map((item) => `${label.get(item.sha256) || item.sha256} (${item.mode})`))].sort();
        controls[name] = { description: mutant.description, differences: mutated.differenceCount, first_difference: firstDifference(mutated), sources };
      }
      assert(controls.C1.first_difference.mode === "stubbed" && controls.C1.sources.includes("P08 (stubbed)"), "C1 is caught by the stubbed comparison at V53-LOOP-P08 (i)");
      for (const name of ["C2", "C3", "C4"]) assert.equal(controls[name].first_difference.source, "P06", `${name} is caught at V53-LOOP-P06`);
      // C5: the stub also perturbs the declared dimensions.
      const c5 = compare(path.join(ROOT, "src"), "c5");
      const c5Sources = new Set(c5.differences.filter((item) => item.mode === "stubbed").map((item) => label.get(item.sha256)));
      for (const key of ["P08", "P08ii", "P08iii", "N15.i"]) assert(c5Sources.has(key), `C5 differs on ${key}`);
      controls.C5 = { description: "the stub also perturbs the declared dimensions", differences: c5.differenceCount, first_difference: firstDifference(c5), sources: [...c5Sources].sort() };
      assert(p08Identity, "V53-LOOP-P08 ran first");
      return {
        value: {
          PHASE_P05,
          controls,
          corpus: { count: corpusShas.length, sha256_set_digest: sha256(corpusShas.join("\n")), sorted_sha256: corpusShas },
          coverage: behaviour.counts,
          differences: 0,
          modes: { disabled: "empty status ok analysis", real: "analyzeVerifiedTypedModule", stubbed: "+7919 steps, +13 calls, +17 iterations on every ok summary; declared dimensions of entry summaries kept in modules with work; effects kept (empty at P0-05)" },
          statement_ii: "The assertion's own correctness rests on the real-mode vectors: V53-LOOP-P08 (i)-(iii) hold with equality and V53-LOOP-N15 (i)-(v) are exceeded; a mutant that ignores work or checks < instead of <= passes this comparison by design.",
          statement_iii: { coupling_control: p08Identity, export_name_check: "no verifier export matches budget|grant|admi" },
          verified_asts_unchanged: behaviour.unchangedAsts
        }
      };
    });

    // ------------------------------------------------------------------
    // EACH_SLICE vectors re-run on the P0-05 corpus.
    await vector("V53-FMT-01@P0-05", () => {
      // The fixture function order is prescribed by the generator, so every
      // accepted source is judged by idempotence; the two canonical outputs
      // are pinned (V53-LOOP-P08, P08 (iii)). The formatted source keeps the
      // verdict and every summary.
      for (const source of acceptedSources) {
        const once = sp.formatSource(typedV053(source), GATED);
        assert.equal(sp.formatSource(typedV053(once), GATED), once, "idempotent");
        const summaries = [source, once].map((text) => {
          const analysis = wb.analyzeVerifiedTypedModule(typedV053(text));
          return [...analysis.entries].map(([name, entry]) => [name, wb.canonicalSummary(entry.value)]);
        });
        assert.deepEqual(summaries[1], summaries[0], "formatting keeps every E(e)");
      }
      for (const [source, canonical] of [[p08, p08fmt], [p08iii, p08iiiFmt]]) assert.equal(sp.formatSource(typedV053(source), GATED), canonical);
      return { value: { canonical_pinned: 2, judged_by_idempotence: acceptedSources.size, sources: acceptedSources.size } };
    });
    await vector("V53-LSP-01@P0-05", () => {
      const file = path.join(tmp, "lsp01.air");
      fs.writeFileSync(file, F.N05);
      const report = JSON.parse(runCli(["check", file, "--source-profile", V053, "--allow-candidate-profile", "--lsp-json"]).stdout);
      assert.equal(report.diagnostics[0].code, "air.loop.form_unsupported");
      assert.equal(report.diagnostics[0].line, 9);
      return { value: { code: report.diagnostics[0].code, line: report.diagnostics[0].line, status: report.status } };
    });
    await vector("V53-LSP-02@P0-05", () => {
      const session = new AirLspSession({ allowCandidateProfile: true, sourceProfile: V053 });
      const checks = [];
      for (const source of [F.N05, F.N15.i, F.N03, F.N16.i]) {
        const thrown = capture(() => typedV053(source));
        const [published] = session.handleMessage({ jsonrpc: "2.0", method: "textDocument/didOpen", params: { textDocument: { text: source, uri: `file://${path.join(tmp, `lsp02-${checks.length}.air`)}`, version: 1 } } });
        assert.equal(published.params.diagnostics[0].code, thrown.code, "err.code preserved");
        checks.push(thrown.code);
      }
      return { value: checks };
    });
    await vector("V53-DIAG-01@P0-05", () => {
      const registry = new Set([...EARLIER_CODE_REGISTRY, ...P0_05_CODE_REGISTRY]);
      const notePath = path.join(ROOT, "docs", "v0.53", "P0_05_LOOPS.md");
      if (fs.existsSync(notePath)) {
        const note = fs.readFileSync(notePath, "utf8");
        const section = note.slice(note.indexOf("## 5."), note.indexOf("## 6."));
        const listed = [...section.matchAll(/^\| `(air\.[a-z0-9_.]+)` \|/gmu)].map((match) => match[1]).sort();
        assert.deepEqual(listed, [...P0_05_CODE_REGISTRY].sort(), "the note's registry table lists exactly the P0-05 codes");
      }
      for (const item of observedFailures) {
        assert(registry.has(item.code), `${item.code} is in the registry`);
        if (item.kind === "STATIC_REJECT") assert(Number.isInteger(item.line), `${item.code} has a location`);
      }
      const seen = new Set(observedFailures.map((item) => item.code));
      for (const code of P0_05_CODE_REGISTRY) assert(seen.has(code), `${code} is exercised`);
      return { value: { failures_checked: observedFailures.length, p0_05_codes: P0_05_CODE_REGISTRY.length } };
    });
    await vector("V53-DIAG-02@P0-05", async () => {
      // Deterministic fuzz of the P0-05 corpus: no raw TypeError, JS stack, WABT
      // text or engine error; a verified source always builds (R-COMP-3).
      let seed = 0x0f0505;
      const next = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed; };
      const ops = ["loop.fold @step, %s, 3", "loop.fold @step, %seed, %n max 8", "loop.fold @nope, 0, 1", "loop.range.i32 @step, %s, 3", "loop.fold.i32",
        "for i in 0..4 { }", "while %c {", "io.poll_bounded %r, 4", "%n max 4097", "max", "@step", "-1", "4097", "%k max %m",
        "work { steps <= 1 }", "work { calls <= 0, iterations <= 2 }", "work {}", "work { steps <= 01 }", "steps <=", "i32<0..100>", "option.none<i32>", ",", "%r"];
      const registry = new Set([...EARLIER_CODE_REGISTRY, ...P0_05_CODE_REGISTRY]);
      const corpus = [...SEP_CORPUS_SHA256].map((digest) => [...Object.values(F)].flatMap((value) => (typeof value === "string" ? [value] : Object.values(value))).find((text) => hexOf(text) === digest));
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
    // The intake count admits every P0-05 fixture far below the default
    // maxAstNodes; it is recorded, not an expected value of the slice text.
    await vector("P0-05-CHECK-INTAKE", () => {
      const counts = Object.fromEntries(["P01", "P06", "P08", "P09"].map((key) => [key, verifiedTypedAstNodeCount(parser.typedV053.parse(F[key], `${key}.air`))]));
      for (const count of Object.values(counts)) assert(count < 65536, "admitted by intake");
      return { value: { intake_ast_nodes: counts } };
    });

    // ------------------------------------------------------------------
    // REG-P05-QA-F1-*: the independent QA finding P05-QA-F-1 (expectations in
    // the correction evidence expectations/EXPECTATIONS.md, before the change).
    await regP05QaF1();
  } finally {
    fs.rmSync(tmp, { force: true, recursive: true });
  }

  const outDir = process.env.AIR_P005_VECTOR_RESULTS_DIR;
  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "v053_loops.results.json"), `${JSON.stringify(results, null, 2)}\n`);
  }
  const passed = results.filter((item) => item.status === "PASS").length;
  const deferred = results.filter((item) => item.status === "DEFERRED").map((item) => item.vector);
  if (failures.length) {
    for (const failure of failures) console.error(`not ok - ${failure}`);
    console.error(`typed-v0.53 P0-05 vectors: ${failures.length} FAIL, ${passed} PASS`);
    process.exit(1);
  }
  for (const item of results) console.log(`ok - ${item.vector} ${item.status}`);
  console.log(`typed-v0.53 P0-05 vectors: ${passed} PASS, ${deferred.length} DEFERRED (${deferred.join(", ")})`);
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
