#!/usr/bin/env node
"use strict";

// typed-v0.53 P0-10 (card AIR-0053-P0-10-0001): typed host imports and
// effect-demand declarations, the source side. Every expectation comes from
// R3.1 VECTORS.md, the slice text R2.3 (P0_10_SLICE_RFC.md,
// VECTORS_ADDITIONS.md; folder SHA256SUMS 570084ad...) or the admission record
// (dd74fb6d...: AD-P10-1 ... AD-P10-13, each (a); the CLARIFICATION), never
// from the output of the implementation under test. The fixture packages are
// the slice text's generator output (tools/derive_p010.py --write), checked in
// under fixtures/v053/effects/<package>/ with each file's sha256 pinned below
// (FIXTURE_PINS: 61 packages, 71 files, 64 distinct texts, VECTORS_ADDITIONS.md
// §7). This file runs the STATIC_REJECT vectors on every entrypoint that
// carries their package (the SDK and the CLI with the files on disk, the
// verified builder and the runtime with `modules`), V53-IMP-N13 and N14
// (P10-R27, P10-R28), and the slice checks P0-10-CHECK-LINK, -WAT, -CT1,
// -CANON and -ROOTVERIFY (P10-R25, P10-R29); test/v053_host_binding.test.js
// runs every vector with a host. Set AIR_P010_VECTOR_RESULTS_DIR=<dir> to
// write one canonical result record per vector.

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const sp = require("../src/source_profile");
const parser = require("../src/parser");
const wb = require("../src/workbound");
const typedClosure = require("../src/typed_closure");
const borrowedSlices = require("../src/borrowed_slices");
const { AirLspSession } = require("../src/lsp_server");
const { buildVerifiedTypedModule, createVerifiedTypedRuntime } = require("../src/v052_verified_build");
const verifiedBuild = require("../src/v052_verified_build");
const { lowerToWat, watToWasm } = require("../src/lower_wasm");

const ROOT = path.resolve(__dirname, "..");
const FIXTURES = path.join(ROOT, "fixtures", "v053", "effects");
const V053 = "typed-v0.53";
const GATED = Object.freeze({ allowCandidateProfile: true, sourceProfile: V053 });
const MAX_WAT = 4194304;
// P10-R26 (AD-P10-4 (a)): the thirteen PROPOSED codes, each with a typed-v0.53
// hint; the first seven arise in the verifier, the rest in the adapter.
const P0_10_VERIFIER_CODES = Object.freeze([
  "air.capability.required_missing", "air.effect.demand_exceeded", "air.effect.demand_key_invalid", "air.effect.demand_missing",
  "air.extern.alias_conflict", "air.extern.signature_mismatch", "air.extern.unsupported"
]);
const P0_10_ADAPTER_CODES = Object.freeze([
  "air.host.binding_invalid", "air.host.binding_missing", "air.host.call_before_admission", "air.host.import_failed",
  "air.host.reentrancy_forbidden", "air.host.result_invalid"
]);
const P0_10_CODE_REGISTRY = Object.freeze([...P0_10_VERIFIER_CODES, ...P0_10_ADAPTER_CODES].sort());
// The EXISTING codes this file's vectors reach (P10-R26 last row; P9-R24).
const P0_10_EXISTING_CODES = Object.freeze([
  "air.call.argument_count_mismatch", "air.call.result_unbound", "air.capability.unknown", "air.import.bundle_unsupported",
  "air.import.cycle", "air.import.not_found", "air.import.stdlib_unsupported", "air.memory.region_bounds_static",
  "air.v051.function_duplicate", "air.v051.typed_atom_type_mismatch", "air.v051.typed_syntax_invalid"
]);
// P0-08's FIXED AD-3 descriptor of the contract shape (OD-P10-3 (a)).
const V2_HEADER = Object.freeze({
  airAbi: "0.13", feature: "typed-memory-v1", lengthUnit: "bytes", memoryDomains: Object.freeze(["wasm-linear"]),
  schema: "air.borrowed-slice-interface.v2", transferModeRequired: true
});
// CT-1 P0-10-EFF-1 (OD-P10-1 (d); admission record CT1).
const CT1 = Object.freeze({
  blob: "3b6b7a0a4a8512f884347b50ead1a7d78ef968a6",
  bytes: 7634,
  digest: "sha256:b53e8e6a5755c61a2c755acc8746a9bdadf5c755bbbf203a7e5d26896dc92f70",
  raw: "sha256:b3b1730afdce68b2f739d988ba08faf5e1e4ffc6cc3d8f63af4f98e920c55e19",
  revision: "P0-10-EFF-1",
  rows: 29
});
// V53-IMP-P02's package (P0-09 slice text R2.5 VECTORS_ADDITIONS.md §3; its
// sha256 pinned there), the package of P0-10-CHECK-ROOTVERIFY (P10-R29).
const IMP_P02 = Object.freeze({
  "main.air": ["module v53.imp.main", "", "use \"./math.air\" as math", "", "export func run(x: i32) -> i32 {", "  %a: i32 = call @math.add_one(%x)",
    "  %b: i32 = call @math.add_one(%a)", "  %c: i32 = call @math.add_one(%b)", "  return %c", "}", ""].join("\n"),
  "math.air": ["module v53.imp.math", "", "export func add_one(x: i32) -> i32 {", "  %o: i32 = i32.wrapping_add %x, 1", "  return %o", "}", ""].join("\n")
});
const IMP_P02_SHA256 = Object.freeze({
  "main.air": "5398e65f1cedc0cb997ef1538dd03ce3e862a94da2a7cf76adef642174ba021d",
  "math.air": "7ce07386433af1147d00e9051b235f946e0a600c7b161c62111eef310a366bb0"
});

// The slice text's generator output (tools/derive_p010.py --write; MANIFEST.tsv): each
// package's root and every file's sha256.
const FIXTURE_PINS = Object.freeze({
  "V53-EFF-P01_one_emit_within_its_demand": { root: "main.air", files: { "main.air": "766cebae3b720edf9befd1c2b6ef614a0662f745d44af635805faa3098510aa0" } },
  "V53-EFF-P01_R3.1_literal_the_same_module_as_R3.1_writes_it_extern_before_demand_no_blank_line": { root: "main.air", files: { "main.air": "fcfc0ff99075cc791495659cc7c559dd45f3e8b7d617ca62f818b84f81bddc51" } },
  "V53-EFF-N01_no_demand": { root: "main.air", files: { "main.air": "eb73246181459df23fc777aa902cf1b3e6d6d666484bcead740f4c573720624e" } },
  "V53-EFF-N02_two_emits_under_demand_1": { root: "main.air", files: { "main.air": "1d52cc1fdde52b78f2a7164ab740158aa7acec96f72fbfa543cf10a16c218190" } },
  "V53-EFF-N03_a_work_key_in_demand": { root: "main.air", files: { "main.air": "8dfc63db95ba99940c499b21e5f03862c3e79dc1c9d7fb6ae7d24cd0e92aeb7c" } },
  "V53-EFF-N04_a_misspelled_key": { root: "main.air", files: { "main.air": "af7d406a89aa0c675d5f7a819812a01c293de5c16d9596d7ce7a377a7ee521c9" } },
  "V53-EFF-N05_an_extern_not_in_the_registry": { root: "main.air", files: { "main.air": "b97615663722bd9342d03b1fd4ce1b802acbc058b84fcbaf1b51899b0f2e00b1" } },
  "V53-EFF-N06_a_wrong_signature": { root: "main.air", files: { "main.air": "4ce6e5ff054baf3cccc9ca53f15fc48a5730d1da4dea9748ebf0645a9fd2f3e0" } },
  "V53-EFF-N07_no_capability": { root: "main.air", files: { "main.air": "61c920db470cb075e0c701595821e3eb3d268fcdec634d0db9f89aba9dea0e1b" } },
  "V53-EFF-N08_a_Host_Contract_capability_id": { root: "main.air", files: { "main.air": "594cec3fbfed9ff83b9cfdf78e42f6b05ed65d7dace64c1f183c0770445f6d9d" } },
  "V53-EFF-N09_i_fs.read_file_async": { root: "main.air", files: { "main.air": "ad29b8a8e35a9440eeb732e7145409223270d49767696ff8af372cf1880e2844" } },
  "V53-EFF-N09_ii_io.poll": { root: "main.air", files: { "main.air": "63d75cf37189c23716c85b7ab163e011b0c64f753735537ad300c13e8b9050d9" } },
  "V53-EFF-N09_iii_io.result_len": { root: "main.air", files: { "main.air": "5efb339b4ac88854acfa3f89ac8733efb1f415df99982c94dd7dbbe54ef7182b" } },
  "V53-EFF-N10_print": { root: "main.air", files: { "main.air": "90965bf77056f22e596e4b03714ba40387c8871561db931af6aa644e99b3250e" } },
  "V53-EFF-N13_a_handler_that_throws_on_the_second_call": { root: "main.air", files: { "main.air": "27d4efbe0123b54fdcb4bab809858e7ed861aa8c2092e6affcfcf766304c9ec5" } },
  "V53-EFF-N15_i64_results": { root: "main.air", files: { "main.air": "de7199171d759e849d18653ade9d4aee127651d409e1d01efec6c8da1a4c2683" } },
  "V53-EFF-N16_f32_results": { root: "main.air", files: { "main.air": "8221d4717f5fa6053f08439ea00e079b93d66422b9e086945942acb4929c3c64" } },
  "V53-LOOP-N10_a_rejected_dynamic_count_after_one_emit": { root: "main.air", files: { "main.air": "136265eb6f43a338caa0b51d72c4735d798453c91ff08572428c6832bcb13ad7" } },
  "V53-CFG-P02_an_extern_call_in_one_branch": { root: "main.air", files: { "main.air": "f6edb24a12b86bf2572b903384c91b18a50b6cf73b17ad3895dd5187592a73ae" } },
  "V53-LOOP-P05_i_100_emits_in_a_fold": { root: "main.air", files: { "main.air": "c7f45c8c3e881f8ad761511a8880c8b69c0faca5d830e739ab83f23bc53fac9b" } },
  "V53-LOOP-P05_ii_the_same_under_demand_1": { root: "main.air", files: { "main.air": "58b2780236661b8218de68bab562970ac32eaee8b68281ab8476946d419279d3" } },
  "V53-MEM-N06_a_static_capacity_over_the_region": { root: "main.air", files: { "main.air": "cf27362e868bce5274f21f3845745fdc5eeaa95c8e4398365ec2860cf46bc5a0" } },
  "V53-MEM-N34_the_capacity_domain_of_a_ptr_cap_argument": { root: "main.air", files: { "main.air": "039ee38be1884f302015cf76847c22909365ccdd7caaf37f59eeac3ea043bc88" } },
  "V53-IMP-P01_i_three_imported_calls_each_with_one_host_call_X-SND-03_V53-WB-H03": { root: "main.air", files: { "main.air": "595bb8502e6a6c2e1f7f94b5e49c6a8f1496e0bb98179ab090c84f06940d5e31", "math.air": "9eda1f2b386640554b3dd12f537a683050f6b5065012a167586d8aa9b97b7495" } },
  "V53-IMP-P01_ii_the_same_under_demand_1_in_main": { root: "main.air", files: { "main.air": "a1136f47849f8ae5927ad2c9b349b0364276753d8bd805058a1799505c045446", "math.air": "9eda1f2b386640554b3dd12f537a683050f6b5065012a167586d8aa9b97b7495" } },
  "V53-IMP-N01_a_dropped_contract_in_the_imported_module": { root: "main.air", files: { "main.air": "595bb8502e6a6c2e1f7f94b5e49c6a8f1496e0bb98179ab090c84f06940d5e31", "math.air": "2295006b92ccbf42917f034b53a95b2e8058e5e13b1243eb1e06313c09f98c8f" } },
  "V53-IMP-N05_i_main_without_the_capability": { root: "main.air", files: { "main.air": "6c2db58e9844e4361d1cb1f9ebb26a036da89844e00cc1dd871a01329f6f345c", "math.air": "9eda1f2b386640554b3dd12f537a683050f6b5065012a167586d8aa9b97b7495" } },
  "V53-IMP-N05_ii_main_without_the_demand": { root: "main.air", files: { "main.air": "75732d7bf5a661724144588aa5f9f55a7a4b4006a2f3912b8abadbcac1206135", "math.air": "9eda1f2b386640554b3dd12f537a683050f6b5065012a167586d8aa9b97b7495" } },
  "V53-IMP-ID-01_a_body-only_edit_of_math_add_2_": { root: "main.air", files: { "main.air": "595bb8502e6a6c2e1f7f94b5e49c6a8f1496e0bb98179ab090c84f06940d5e31", "math.air": "a77c4d78e7d9d782948e268376ad31cd4e4d5c2ac909aab5d4a8c3c5566f7c5e" } },
  "V53-ABI-51_a_an_extern_spelled_with_the_contract_namespace": { root: "main.air", files: { "main.air": "ebb74a68f74c8f9c02565bf570dbc34a7fa1042230caff55c7fad5e72bc489d3" } },
  "V53-ABI-51_a_a_demand_key_spelled_with_the_contract_namespace": { root: "main.air", files: { "main.air": "06b3bd65992e8f20d801840af8862e18734fa70e2688be863717fb9d9e882f71" } },
  "V53-ABI-51_b_an_extern_naming_the_contract_field_without_": { root: "main.air", files: { "main.air": "e11467e5258587d45a16ede6ddc54079b21daa7fab6f097cb008b72422c175de" } },
  "V53-ABI-51_c_a_demand_key_naming_the_contract_import_without_": { root: "main.air", files: { "main.air": "8e127855ccbeb489465496524724f0162538f4e645400a71ac2d010e5f8fb7da" } },
  "V53-EFF-P02_f32_host_arguments_OPEN-41_a_": { root: "main.air", files: { "main.air": "ba56dfde8de39bfddebd986d1cfde9bb2a26e022e3067d5f39f66bbe3b4cd6c0" } },
  "V53-EFF-P03_result_validation_of_bool_void_and_i32_R-EFF-13_": { root: "main.air", files: { "main.air": "faf2c13a97b665aa7030f156631e473bdde5269f41ebf891f55c831690b266ca" } },
  "V53-EFF-P04_i_an_extern_in_a_borrowed-lane_module_R-COMP-3_on_every_lane_": { root: "main.air", files: { "main.air": "ff4e11a3d8ee8548e63504f9acd459b731c87d7cefa0cbdb5bd883bf098ecb18" } },
  "V53-EFF-P04_ii_B-1_s_shape_with_an_extern_a_plain_export_an_internal_borrowed_slice_function": { root: "main.air", files: { "main.air": "a1646ea5e2c1acfdbd24f1e43b279b50bd9708acbfd78acc6a33e647ddf730c3" } },
  "V53-EFF-P05_the_ptr_cap_window_copy_in_write_back_to_a_writable_view_only": { root: "main.air", files: { "main.air": "3f0458f2871da1b2b5ff29325702d3fef0105b09c96b4f406101770d1f0b0a20" } },
  "V53-EFF-P06_i_effects_through_an_imported_fold_callback_X-SND-03_": { root: "main.air", files: { "lib.air": "47083d805e2c253ffc9e8ded9f8a6f8ac105858402a5093aa48e0a320b0d8eba", "main.air": "20910811db7e71601dcc8f6dea307676d35e7f93adaba6b551b55807c0b52aa0" } },
  "V53-EFF-P06_ii_the_same_under_demand_9": { root: "main.air", files: { "lib.air": "47083d805e2c253ffc9e8ded9f8a6f8ac105858402a5093aa48e0a320b0d8eba", "main.air": "269eaa68ea1911b899bcd94a7d420fe073e2e9312803e773ed19ff9c565d84ec" } },
  "V53-EFF-N17_an_import_alias_equal_to_an_extern_family": { root: "main.air", files: { "main.air": "8442840726bae2498d3ae96c599ced5a4a119365dbfe88d1adf92cc755209df2", "out.air": "8f9ca02f063af779e43f7844a8a736ad5fd98f18682e27f7002d823ce7bc63d7" } },
  "V53-EFF-N17_control_the_alias_renamed": { root: "main.air", files: { "main.air": "61e426eeaa917c9f5412df30c15dd6761d8c174ac2dcbbe0a359da010fa8ef33", "out.air": "8f9ca02f063af779e43f7844a8a736ad5fd98f18682e27f7002d823ce7bc63d7" } },
  "V53-EFF-N18_i_a_duplicate_extern": { root: "main.air", files: { "main.air": "aed2729cffe2b5a57d2fe969bf84c8d3510e6110223db17d53ce9c90238a1748" } },
  "V53-EFF-N18_ii_a_second_demand_line": { root: "main.air", files: { "main.air": "6ac3d06c252396c1aa6a2aafd891ab7356f725104dbc5756c4b883d181be0523" } },
  "V53-EFF-N18_iii_a_duplicate_key": { root: "main.air", files: { "main.air": "775b2cb27a35851eae58c942690fd111d512a21bd26cca64c184ff5bed015340" } },
  "V53-EFF-N18_iv_a_bound_with_a_leading_zero": { root: "main.air", files: { "main.air": "90c8132de5ff64169f5cb9f9ae09d9bc03f2ccedbd9f9ce1d6103845eef7860d" } },
  "V53-EFF-N18_v_a_bound_over_WB_MAX": { root: "main.air", files: { "main.air": "4011a730bc01c0f3460827a041e19440373324053f12c96a21dbfb5dd51d06bf" } },
  "V53-EFF-N18_vi_a_negative_bound": { root: "main.air", files: { "main.air": "1da491012c1d4a93b4b30dcc21853dc79f2b0ecba53e7f3ed1bb70567b1b96ab" } },
  "V53-EFF-N18_vii_a_refined_result_type": { root: "main.air", files: { "main.air": "e72a751e453b0d662e5d86add6fb84514791dd95197c34cf8e27446ef3f6e9ad" } },
  "V53-EFF-N19_i_an_unbound_non-void_result": { root: "main.air", files: { "main.air": "71edfa1bc1798649b707b30036bbac42d3be69c6209e0f6a380cdc3f9d93da68" } },
  "V53-EFF-N19_ii_a_bound_void_result": { root: "main.air", files: { "main.air": "ac68440e4cf86a2de50ce2ecfd27ca62edfb23563cde5825eb0a67cd2e3a0813" } },
  "V53-EFF-N19_iii_an_argument_count": { root: "main.air", files: { "main.air": "465deafedcc290b4ed070d213cb951bc1899a29e52e5cfac9455ba210f2a3a41" } },
  "V53-EFF-N19_iv_a_key_used_only_in_an_internal_function": { root: "main.air", files: { "main.air": "413c99849bf45535667093c69fd3ddb85ec195eca5df52f75877f5d1b5240beb" } },
  "V53-EFF-N19_v_an_i32_passed_as_a_ptr": { root: "main.air", files: { "main.air": "31351c8620fcc2dd48519fd119ee3f3dee0a089b8ea87b755fdbfafe759df233" } },
  "V53-EFF-P07_an_uncalled_extern_an_unused_capability_an_unused_demand_key": { root: "main.air", files: { "main.air": "b92b975f8a8e99682fe4993a590b37ff69e55f2553d2821d1319a26686dba290" } },
  "V53-EFF-N22_i_a_negative_static_capacity": { root: "main.air", files: { "main.air": "b70b31597f8ebebeb8bed7f93a7e6d83b61a05e4fc5c8108d407bcfaa70647a0" } },
  "V53-EFF-N22_ii_a_static_capacity_over_an_interior_view": { root: "main.air", files: { "main.air": "99f0d8c91b0a3628ac94430b8997736df01cecadaec7512d82e6f9f6485f791f" } },
  "V53-IMP-N13_i_use_std.bounds_as_b": { root: "main.air", files: { "main.air": "0a6563b4fb839a62049e459a4b0280e080d9a7ad3566316800f47aec3446565f" } },
  "V53-IMP-N13_ii_use_utility.random_as_r": { root: "main.air", files: { "main.air": "a9f7fa1d12ac36cb79d792a217e1dfce96444a061b2308bcc548edcf430b7f78" } },
  "V53-IMP-N14_a_single-file_self-import": { root: "a.air", files: { "a.air": "8c40cd5a19ef23c862fd95d3cd0d6e6bb954fed36ac7ad45f250a34e1e629b18" } },
  "V53-IMP-N14_iii_a_nested_root_importing_upward_without_modules": { root: "dir/a.air", files: { "dir/a.air": "cbc61e17a4323085a22d45650f9188585e7aa6b3a9b765839ffdcd03450a2634" } },
});

const results = [];
const failures = [];
const observed = [];
let tmp;

const hexOf = (text) => crypto.createHash("sha256").update(Buffer.isBuffer(text) ? text : Buffer.from(text, "utf8")).digest("hex");
function sha256(bytes) {
  return `sha256:${hexOf(bytes)}`;
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
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return { bytes: value.length, sha256: sha256(value) };
  if (value instanceof Map) return plain(Object.fromEntries(value));
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
// The checked-in packages. A package is found by the prefix of its generator
// name; every file's bytes must equal the generator's (FIXTURE_PINS).

function pkgOf(prefix) {
  const names = Object.keys(FIXTURE_PINS).filter((name) => name.startsWith(prefix));
  assert.equal(names.length, 1, `exactly one fixture package starts with '${prefix}': ${names.join(", ")}`);
  const name = names[0];
  const pin = FIXTURE_PINS[name];
  const dir = path.join(FIXTURES, name);
  const files = {};
  for (const [rel, hex] of Object.entries(pin.files)) {
    const text = fs.readFileSync(path.join(dir, rel), "utf8");
    assert.equal(hexOf(text), hex, `${name}/${rel}: the generator's bytes`);
    files[rel] = text;
  }
  return { dir, files, label: name, root: pin.root, rootPath: path.join(dir, pin.root) };
}
const others = (pkg) => {
  const out = Object.fromEntries(Object.entries(pkg.files).filter(([rel]) => rel !== pkg.root));
  return Object.keys(out).length ? out : undefined;
};
const declaresExtern = (pkg) => Object.values(pkg.files).some((text) => /^extern\s/mu.test(text));

function runCli(args, timeoutMs = 120000) {
  const out = childProcess.spawnSync(process.execPath, [path.join(ROOT, "bin", "airc.js"), ...args], {
    cwd: ROOT, encoding: "utf8", killSignal: "SIGKILL", maxBuffer: 256 * 1024 * 1024, timeout: timeoutMs
  });
  assert(!out.error && out.signal === null, `airc ${args[0]} did not finish within ${timeoutMs} ms`);
  return out;
}
function assertNoRawError(text, label) {
  assert.doesNotMatch(String(text), /RangeError|Maximum call stack|TypeError|\n\s+at /u, `${label}: no raw error`);
}

// The caller's descriptor: a contract artifact (a module of the package
// declares an extern) takes P0-08's v2 descriptor listing every root export
// (P10-R11; OD-P10-3 (a)); a borrowed-lane root P0-08's own; any other root
// the typed-interface 0.12 descriptor, as the earlier typed tests write it.
function descriptorOf(pkg) {
  let ast = null;
  try { ast = parser.typedV053.parse(pkg.files[pkg.root], pkg.root); } catch (_) { ast = null; }
  if (!ast) return { ...V2_HEADER, exports: [{ entryContracts: [], name: "run", params: [] }] };
  const borrowed = borrowedSlices.typedV053.interfaceDescriptor(ast);
  const exported = ast.functions.filter((item) => item.exported);
  if (declaresExtern(pkg)) {
    const written = new Map(((borrowed && borrowed.exports) || []).map((entry) => [entry.name, entry]));
    return { ...V2_HEADER, memoryDomains: [...V2_HEADER.memoryDomains], exports: exported.map((fn) => written.get(fn.name) || {
      entryContracts: [], name: fn.name, params: fn.params.map((parameter) => ({ kind: "value", name: parameter.name, type: parameter.type }))
    }) };
  }
  if (borrowed) return borrowed;
  const image = (type) => (/^i32</u.test(type) ? "i32" : type);
  return {
    air_abi_lane: "0.12", module_id: ast.name, schema: "air.typed-interface/0.12-candidate.1", types: [],
    exports: exported.map((item) => ({ function: item.name, name: item.name, parameters: item.params.map((parameter) => ({ name: parameter.name, type: image(parameter.type) })), return_type: image(item.returnType) }))
  };
}
const buildInput = (pkg, extra = {}) => ({ ...GATED, descriptor: descriptorOf(pkg), source: pkg.files[pkg.root], sourceName: pkg.root,
  ...(others(pkg) ? { modules: others(pkg) } : {}), ...extra });

function failureOf(error, dir) {
  assert(error && typeof error.code === "string" && error.code.startsWith("air."), `coded failure: ${error && error.stack}`);
  assertNoRawError(error.message, error.code);
  const out = { code: error.code };
  if (error.loc && Number.isInteger(error.loc.line)) {
    out.line = error.loc.line;
    out.file = dir && path.isAbsolute(error.loc.file) ? path.relative(dir, error.loc.file) : error.loc.file;
  }
  if (error.disposition) out.disposition = error.disposition;
  out.message = String(error.message).replace(/^.*?:\d+: (?=air\.)/u, "");
  observed.push(out.code);
  return out;
}
function sdkOutcome(pkg, options = GATED, rootPath = pkg.rootPath, source = pkg.files[pkg.root]) {
  try {
    const ast = sp.parseSource(source, rootPath, options);
    sp.verifySource(ast, options);
    return { ast, verdict: "VERIFIED" };
  } catch (error) {
    return failureOf(error, pkg.dir);
  }
}
function cliOutcome(pkg, command = "verify") {
  const out = runCli([command, pkg.rootPath, "--source-profile", V053, "--allow-candidate-profile", ...(command === "check" ? ["--lsp-json"] : [])]);
  assertNoRawError(out.stderr, `CLI ${command}`);
  if (command === "check") {
    const report = JSON.parse(out.stdout);
    if (!report.diagnostics.length) return { verdict: "VERIFIED" };
    return { code: report.diagnostics[0].code, line: report.diagnostics[0].line };
  }
  if (out.status === 0) return { verdict: "VERIFIED" };
  const first = out.stderr.trim().split("\n")[0];
  const match = /^(.*?):(\d+): (air\.[a-z0-9_.]+):/u.exec(first);
  if (match) return { code: match[3], file: path.isAbsolute(match[1]) ? path.relative(pkg.dir, match[1]) : match[1], line: Number(match[2]) };
  const coded = /(air\.[a-z0-9_.]+):/u.exec(first);
  assert(coded, `CLI ${command} output: ${first}`);
  return { code: coded[1] };
}
async function builderOutcome(pkg, extra = {}) {
  try {
    return { built: await buildVerifiedTypedModule(buildInput(pkg, extra)), verdict: "VERIFIED" };
  } catch (error) {
    return failureOf(error);
  }
}
async function runtimeOutcome(pkg, extra = {}) {
  const runtime = createVerifiedTypedRuntime({ admit: async () => true });
  try {
    await runtime.build(buildInput(pkg, extra));
    return { verdict: "VERIFIED" };
  } catch (error) {
    return failureOf(error);
  }
}

// STATIC_REJECT at every entrypoint that carries the package: SDK, CLI
// verify, CLI check --lsp-json, builder, runtime; the same code and line (and
// the file, the module key, for a failure inside an imported module). A
// failure with no source line (`air.capability.unknown`, G-5) has none on the
// SDK, the builder and the runtime.
async function staticReject(pkg, code, line, file = pkg.root) {
  const outcomes = {
    builder: await builderOutcome(pkg),
    cli_check: cliOutcome(pkg, "check"),
    cli_verify: cliOutcome(pkg),
    runtime: await runtimeOutcome(pkg),
    sdk: sdkOutcome(pkg)
  };
  for (const [entrypoint, outcome] of Object.entries(outcomes)) {
    assert.equal(outcome.code, code, `${pkg.label} ${entrypoint}: ${JSON.stringify(outcome)}`);
    if (line !== undefined) assert.equal(outcome.line, line, `${pkg.label} ${entrypoint}: line`);
    else if (["builder", "runtime", "sdk"].includes(entrypoint)) assert.equal(outcome.line, undefined, `${pkg.label} ${entrypoint}: no source line`);
    if (file !== pkg.root && outcome.file !== undefined) assert.equal(outcome.file, file, `${pkg.label} ${entrypoint}: file`);
  }
  return { code, entrypoints: Object.keys(outcomes), file, line: line === undefined ? null : line, message: outcomes.sdk.message };
}

// ---------------------------------------------------------------------------
// R3.1's generated STATIC_REJECT rows and V53-WB-H08 (VECTORS_ADDITIONS.md §2).

async function sectionGenerated() {
  await vector("V53-EFF-N01", async () => ({ value: await staticReject(pkgOf("V53-EFF-N01_"), "air.effect.demand_missing", 7) }));
  await vector("V53-EFF-N02", async () => {
    const pkg = pkgOf("V53-EFF-N02_");
    const value = await staticReject(pkg, "air.effect.demand_exceeded", 7);
    // AD-P10-8 (a): at the export's func line, naming the key, the bound and the value.
    let fields = null;
    try { sp.verifySource(sp.parseSource(pkg.files[pkg.root], pkg.rootPath, GATED), GATED); } catch (error) { fields = error.effectDemand; }
    assert.deepEqual({ ...fields }, { bound: "1", export: "run", key: "output.emit", value: "2" });
    for (const part of ["output.emit", " 2 ", " 1"]) assert(value.message.includes(part), `the message names ${part.trim()}: ${value.message}`);
    return { value: { ...value, fields: { ...fields } } };
  });
  const keyInvalid = async (prefix, key) => {
    const value = await staticReject(pkgOf(prefix), "air.effect.demand_key_invalid", 3);
    assert(value.message.includes(`'${key}'`), `the message names ${key}: ${value.message}`);
    return value;
  };
  let n03 = null;
  let n04 = null;
  await vector("V53-EFF-N03", async () => ({ value: (n03 = await keyInvalid("V53-EFF-N03_", "cpu.instructions")) }));
  await vector("V53-EFF-N04", async () => ({ value: (n04 = await keyInvalid("V53-EFF-N04_", "output.emitt")) }));
  await vector("V53-EFF-N05", async () => ({ value: await staticReject(pkgOf("V53-EFF-N05_"), "air.extern.unsupported", 4) }));
  await vector("V53-EFF-N06", async () => ({ value: await staticReject(pkgOf("V53-EFF-N06_"), "air.extern.signature_mismatch", 5) }));
  await vector("V53-EFF-N07", async () => ({ value: await staticReject(pkgOf("V53-EFF-N07_"), "air.capability.required_missing", 4) }));
  await vector("V53-EFF-N08", async () => ({ value: await staticReject(pkgOf("V53-EFF-N08_"), "air.capability.unknown", undefined) }));
  await vector("V53-EFF-N09", async () => {
    const value = {};
    for (const [prefix, label] of [["V53-EFF-N09_i_", "(i) fs.read_file_async"], ["V53-EFF-N09_ii_", "(ii) io.poll"], ["V53-EFF-N09_iii_", "(iii) io.result_len"]]) {
      value[label] = await staticReject(pkgOf(prefix), "air.extern.unsupported", 4);
      assert(value[label].message.includes("DEFERRED_V054"), `${label}: the message names DEFERRED_V054`);
    }
    return { value };
  });
  await vector("V53-EFF-N10", async () => ({ value: await staticReject(pkgOf("V53-EFF-N10_"), "air.v051.typed_syntax_invalid", 8) }));
  await vector("V53-WB-H08", () => {
    // Composite (X-WORK-03): PASS only when V53-EFF-N03 and V53-EFF-N04 PASS.
    assert(n03 && n04, "V53-EFF-N03 and V53-EFF-N04 passed");
    return { value: { parts: { "V53-EFF-N03": n03.code, "V53-EFF-N04": n04.code } } };
  });
}

// ---------------------------------------------------------------------------
// The inherited STATIC_REJECT vectors (§3), the ABI row (§4), the reviewed
// additions without a host (§6) and P0-09's QA corners (§6a).

async function sectionAdditions() {
  await vector("V53-EFF-N18", async () => {
    const value = {};
    for (const [prefix, code, line] of [
      ["V53-EFF-N18_i_", "air.v051.function_duplicate", 6], ["V53-EFF-N18_ii_", "air.v051.typed_syntax_invalid", 4],
      ["V53-EFF-N18_iii_", "air.v051.typed_syntax_invalid", 5], ["V53-EFF-N18_iv_", "air.v051.typed_syntax_invalid", 5],
      ["V53-EFF-N18_v_", "air.v051.typed_syntax_invalid", 5], ["V53-EFF-N18_vi_", "air.v051.typed_syntax_invalid", 5],
      ["V53-EFF-N18_vii_", "air.extern.signature_mismatch", 4]
    ]) value[prefix.slice(12, -1)] = await staticReject(pkgOf(prefix), code, line);
    return { value };
  });
  await vector("V53-EFF-N19", async () => {
    const value = {};
    for (const [prefix, code, line] of [
      ["V53-EFF-N19_i_", "air.call.result_unbound", 9], ["V53-EFF-N19_ii_", "air.v051.typed_atom_type_mismatch", 9],
      ["V53-EFF-N19_iii_", "air.call.argument_count_mismatch", 9], ["V53-EFF-N19_iv_", "air.effect.demand_missing", 9],
      ["V53-EFF-N19_v_", "air.v051.typed_atom_type_mismatch", 8]
    ]) value[prefix.slice(12, -1)] = await staticReject(pkgOf(prefix), code, line);
    return { value };
  });
  await vector("V53-EFF-N22", async () => ({
    value: {
      i: await staticReject(pkgOf("V53-EFF-N22_i_"), "air.memory.region_bounds_static", 9),
      ii: await staticReject(pkgOf("V53-EFF-N22_ii_"), "air.memory.region_bounds_static", 11)
    }
  }));
  await vector("V53-MEM-N06", async () => ({ value: await staticReject(pkgOf("V53-MEM-N06_"), "air.memory.region_bounds_static", 9) }));
  await vector("V53-ABI-51", async () => ({
    value: {
      a: await staticReject(pkgOf("V53-ABI-51_a_an_extern"), "air.v051.typed_syntax_invalid", 5),
      a_prime: await staticReject(pkgOf("V53-ABI-51_a_a_demand"), "air.v051.typed_syntax_invalid", 5),
      b: await staticReject(pkgOf("V53-ABI-51_b_"), "air.extern.unsupported", 3),
      c: await staticReject(pkgOf("V53-ABI-51_c_"), "air.effect.demand_key_invalid", 2)
    }
  }));
  await vector("V53-IMP-N01", async () => {
    // Reported in math.air, verified first (P9-R10); math.air's demand is not dropped.
    const value = await staticReject(pkgOf("V53-IMP-N01_"), "air.effect.demand_exceeded", 7, "math.air");
    return { value };
  });
  await vector("V53-IMP-N05", async () => ({
    value: {
      i: await staticReject(pkgOf("V53-IMP-N05_i_"), "air.capability.required_missing", 8),
      ii: await staticReject(pkgOf("V53-IMP-N05_ii_"), "air.effect.demand_missing", 8)
    }
  }));
  // P10-R27, P10-R28: on the runtime the root is named <typed-source>.
  const runtimeFile = async (pkg, extra = {}) => {
    const runtime = createVerifiedTypedRuntime({ admit: async () => true });
    try {
      await runtime.build(buildInput(pkg, extra));
    } catch (error) {
      return { code: error.code, file: error.loc && error.loc.file, line: error.loc && error.loc.line, message: error.message };
    }
    assert.fail(`${pkg.label}: the runtime refuses`);
    return null;
  };
  await vector("V53-IMP-N13", async () => {
    const value = {};
    for (const [prefix, code] of [["V53-IMP-N13_i_", "air.import.stdlib_unsupported"], ["V53-IMP-N13_ii_", "air.import.bundle_unsupported"]]) {
      const pkg = pkgOf(prefix);
      const outcome = await staticReject(pkg, code, 3);
      const runtime = await runtimeFile(pkg);
      assert.deepEqual([runtime.code, runtime.file, runtime.line], [code, "<typed-source>", 3], `${prefix} runtime`);
      value[prefix.slice(12, -1)] = { ...outcome, runtime_file: runtime.file };
    }
    return { value };
  });
  await vector("V53-IMP-N14", async () => {
    const pkg = pkgOf("V53-IMP-N14_a_");
    const CYCLE = "air.import.cycle: 'a.air' and 'a.air' import each other through a cycle";
    // (i) a.air:3 on CLI verify and build, the SDK and the direct builder;
    // <typed-source>:3 on the runtime, with exactly the builder's message.
    const outcome = await staticReject(pkg, "air.import.cycle", 3);
    const cliBuild = runCli(["build", pkg.rootPath, "--source-profile", V053, "--allow-candidate-profile"]);
    assertNoRawError(cliBuild.stderr, "CLI build");
    assert.notEqual(cliBuild.status, 0, "CLI build refuses");
    assert.match(cliBuild.stderr.trim().split("\n")[0], /a\.air:3: air\.import\.cycle:/u, "CLI build: a.air:3");
    const builder = await builderOutcome(pkg);
    assert.equal(builder.message, CYCLE, "the builder's message");
    const runtime = await runtimeFile(pkg);
    assert.deepEqual([runtime.code, runtime.file, runtime.line, runtime.message], ["air.import.cycle", "<typed-source>", 3, CYCLE], "runtime (i)");
    // (ii) the <input> label: no package, every use not_found (P9-R5).
    const label = sdkOutcome(pkg, GATED, "<input>");
    assert.deepEqual([label.code, label.line], ["air.import.not_found", 3], "(ii) the <input> control");
    // (iii) a nested root importing upward, without modules: not_found on the
    // builder and the runtime (AD-P10-12 (a)).
    const nested = pkgOf("V53-IMP-N14_iii_");
    const NOT_FOUND = "air.import.not_found: no module 'x.air' in the package";
    const nestedBuilder = await builderOutcome(nested);
    assert.deepEqual([nestedBuilder.code, nestedBuilder.line, nestedBuilder.message], ["air.import.not_found", 3, NOT_FOUND], "(iii) builder");
    const nestedRuntime = await runtimeFile(nested);
    assert.deepEqual([nestedRuntime.code, nestedRuntime.file, nestedRuntime.line, nestedRuntime.message], ["air.import.not_found", "<typed-source>", 3, NOT_FOUND], "(iii) runtime");
    // The CLARIFICATION's E11: an upward self-import is the builder's cycle on
    // the runtime too (a further case; no pinned expectation moves).
    const e11 = { ...nested, files: { "dir/a.air": nested.files["dir/a.air"].replace("\"../x.air\"", "\"../dir/a.air\"") }, label: "E11" };
    const e11Builder = await builderOutcome(e11);
    const e11Runtime = await runtimeFile(e11);
    assert.deepEqual([e11Builder.code, e11Builder.line, e11Runtime.code, e11Runtime.file, e11Runtime.line], ["air.import.cycle", 3, "air.import.cycle", "<typed-source>", 3], "E11");
    return { value: { e11: { builder: e11Builder.code, runtime: e11Runtime.code }, i: { ...outcome, cli_build: "a.air:3", runtime_message: runtime.message }, ii: label, iii: { builder: nestedBuilder.message, runtime_file: nestedRuntime.file } } };
  });
}

// ---------------------------------------------------------------------------
// Slice checks (P10-R25, P10-R29).

// Every package whose root verifies at P0-10 (SDK), in generator order.
function acceptedPackages() {
  return Object.keys(FIXTURE_PINS).map((name) => pkgOf(name)).filter((pkg) => {
    try {
      sp.verifySource(sp.parseSource(pkg.files[pkg.root], pkg.rootPath, GATED), GATED);
      return true;
    } catch (_) {
      return false;
    }
  });
}

function scratchSource(name, edits) {
  const scratch = path.join(tmp, `src-${name}`);
  fs.cpSync(path.join(ROOT, "src"), scratch, { recursive: true });
  for (const [file, anchor, replacement] of edits) {
    const text = fs.readFileSync(path.join(scratch, file), "utf8");
    assert.equal(text.split(anchor).length, 2, `${name}: the anchor occurs exactly once in ${file}`);
    fs.writeFileSync(path.join(scratch, file), text.replace(anchor, replacement));
  }
  return scratch;
}
function spawnJson(script, args) {
  const out = childProcess.spawnSync(process.execPath, [script, ...args], {
    cwd: tmp, encoding: "utf8", env: { ...process.env, NODE_PATH: path.join(ROOT, "node_modules") }, killSignal: "SIGKILL", maxBuffer: 256 * 1024 * 1024, timeout: 900000
  });
  assert(!out.error && out.signal === null && out.status === 0, `${path.basename(script)}: ${out.stderr || out.error}`);
  return JSON.parse(out.stdout);
}

// P0-10-CHECK-WAT's facts of one lowered artifact, in a child process on a
// given src/: the import list, and for each host call the f32 arguments
// canonicalized and the region-domain checks since the previous host call.
const WAT_PROBE = `"use strict";
const path = require("path");
const fs = require("fs");
const [srcDir, listFile] = process.argv.slice(2);
const sp = require(path.join(srcDir, "source_profile.js"));
const { lowerToWat } = require(path.join(srcDir, "lower_wasm.js"));
const options = { allowCandidateProfile: true, sourceProfile: "typed-v0.53" };
const out = {};
for (const [label, rootPath] of JSON.parse(fs.readFileSync(listFile, "utf8"))) {
  const mod = sp.parseSource(fs.readFileSync(rootPath, "utf8"), rootPath, options);
  sp.verifySource(mod, options);
  const lines = lowerToWat(mod, {}).split("\\n").map((line) => line.trim());
  const imports = lines.filter((line) => line.startsWith("(import ")).map((line) => { const m = /^\\(import "([^"]+)" "([^"]+)"/.exec(line); return m[1] + "." + m[2]; });
  const calls = [];
  let window = [];
  const HELPER = "call $__air_v053_region_bounds_runtime";
  for (const line of lines) {
    if (line.startsWith("(func ")) window = [];
    const host = /^call \\$__air_host\\.(.+)$/.exec(line);
    if (!host) { window.push(line); continue; }
    // The capacity is the last argument of every memory-carrying entry: the
    // local pushed right before the call, checked 0 <= cap and cap <= extent.
    const last = /^local\\.get (\\S+)$/.exec(window[window.length - 1] || "");
    let checks = 0;
    for (let i = 0; last && i + 4 < window.length; i += 1) {
      if (window[i] !== "local.get " + last[1] || window[i + 3] !== "if" || window[i + 4] !== HELPER) continue;
      if (window[i + 1] === "i32.const 0" && window[i + 2] === "i32.lt_s") checks += 1;
      if (/^local\\.get /.test(window[i + 1]) && window[i + 2] === "i32.gt_s") checks += 1;
    }
    calls.push({ canonical: window.filter((item) => item === "i32.const 2143289344").length, checks, name: host[1] });
    window = [];
  }
  out[label] = { calls, imports, helpers: lines.filter((line) => line.startsWith("(func $__air_borrow_failure ")).length };
}
process.stdout.write(JSON.stringify(out));
`;
const WAT_MUTANTS = Object.freeze({
  W1: { description: "an f32 host argument passed without its NaN canonicalization", edits: [["lower_wasm.js", "      emitV053StoredValue(state, args[index], \"f32\");", "      emitV053TypedExpression(state, args[index], \"f32\");"]] },
  W2: { description: "a (ptr, cap) window passed without its capacity checks", edits: [["lower_wasm.js",
    "    state.body.push(`local.get ${capacity}`, \"i32.const 0\", \"i32.lt_s\");\n    emitV053RegionFailIf(state);\n    state.body.push(`local.get ${capacity}`, `local.get ${view.names[1]}`, \"i32.gt_s\");\n    emitV053RegionFailIf(state);\n", ""]] },
  W3: { description: "only the called externs imported", edits: [["lower_wasm.js",
    "  for (const mod of modules) for (const extern of mod.externs || []) if (!byName.has(extern.name)) byName.set(extern.name, extern);",
    "  for (const mod of modules) for (const extern of (mod.externs || []).filter((item) => JSON.stringify(mod.functions).includes(JSON.stringify(item.name)))) if (!byName.has(extern.name)) byName.set(extern.name, extern);"]] }
});

// P10-R25: the declared externs of a package, every module, by name.
function declaredExterns(pkg) {
  const out = new Map();
  for (const [rel, text] of Object.entries(pkg.files)) {
    for (const extern of parser.typedV053.parse(text, rel).externs || []) out.set(extern.name, extern);
  }
  return out;
}
function watProblems(pkg, facts) {
  const problems = [];
  const externs = declaredExterns(pkg);
  const expected = ["air:contract.typed-v0.53.v1", ...[...externs.keys()].sort()];
  if (JSON.stringify(facts.imports) !== JSON.stringify(expected)) problems.push(`imports ${JSON.stringify(facts.imports)} != ${JSON.stringify(expected)}`);
  for (const call of facts.calls) {
    const extern = externs.get(call.name);
    const f32 = extern.params.filter((parameter) => parameter.type === "f32").length;
    const windows = extern.params.filter((parameter) => parameter.type === "ptr").length;
    if (call.canonical < f32) problems.push(`${call.name}: ${call.canonical} of ${f32} f32 argument(s) canonicalized`);
    if (call.checks < 2 * windows) problems.push(`${call.name}: ${call.checks} capacity check(s) before the call, ${2 * windows} needed`);
  }
  return problems;
}

async function sectionChecks() {
  await vector("P0-10-CHECK-FIXTURES", () => {
    // The checked-in tree is exactly the generator's: every pinned file, no
    // other file, 64 distinct texts (VECTORS_ADDITIONS.md §7).
    const onDisk = [];
    const walk = (dir, rel) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(path.join(dir, entry.name), `${rel}${entry.name}/`);
        else onDisk.push(`${rel}${entry.name}`);
      }
    };
    walk(FIXTURES, "");
    const pinned = Object.entries(FIXTURE_PINS).flatMap(([name, pin]) => Object.keys(pin.files).map((rel) => `${name}/${rel}`));
    assert.deepEqual(onDisk.sort(), pinned.slice().sort(), "fixtures/v053/effects holds exactly the pinned files");
    for (const name of Object.keys(FIXTURE_PINS)) pkgOf(name);
    const texts = new Set(Object.values(FIXTURE_PINS).flatMap((pin) => Object.values(pin.files)));
    assert.equal(texts.size, 64, "64 distinct texts");
    return { value: { distinct_texts: texts.size, files: pinned.length, packages: Object.keys(FIXTURE_PINS).length } };
  });
  await vector("P0-10-CHECK-CT1", () => {
    const file = path.join(ROOT, "src", "workbound_cost_table_v1.json");
    const bytes = fs.readFileSync(file);
    const blob = crypto.createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    const table = JSON.parse(bytes.toString("utf8"));
    assert.deepEqual({ blob, bytes: bytes.length, digest: wb.COST_TABLE_DIGEST, raw: sha256(bytes), revision: table.revision, rows: table.rows.length }, { ...CT1 });
    assert.equal(wb.costTableDigest(table), CT1.digest, "cost_table_digest by the module's own function");
    assert.equal(table.id, "air.workbound.cost/1", "R-WB-27: the id is unchanged");
    const rows = new Map(table.rows.map((row) => [row.construct, row]));
    assert.deepEqual(rows.get("extern.call"), { calls: "0", construct: "extern.call", ct1: "host extern call to key k: (steps 1, effects[k] 1); every domain check of the call included, whether or not lowering elides it: the checks of each Host ABI (ptr, cap) argument pair (R-MEM-3)", effect_per_key: "1", iterations: "0", steps: "1" });
    assert.deepEqual(table.rows[table.rows.length - 1], { calls: "0", construct: "extern.f32_canonical", ct1: "NaN canonicalization of one f32 argument of a host extern call (OPEN-41 (a)), in addition to extern.call", iterations: "0", steps: "1" });
    return { value: { ...CT1, extern_call: rows.get("extern.call"), last_row: table.rows[table.rows.length - 1].construct } };
  });
  const accepted = acceptedPackages();
  await vector("P0-10-CHECK-CANON", () => {
    // P10-R10: every file of every package that verifies is canonical; R3.1's
    // literal V53-EFF-P01 (extern before demand) formats to the canonical twin.
    const literal = pkgOf("V53-EFF-P01_R3.1_literal");
    const canonical = pkgOf("V53-EFF-P01_one_emit");
    const files = [];
    for (const pkg of accepted) {
      if (pkg.label === literal.label) continue;
      for (const [rel, text] of Object.entries(pkg.files)) {
        const once = sp.formatSource(parser.typedV053.parse(text, rel), GATED);
        assert.equal(once, text, `${pkg.label} ${rel}: canonical`);
        files.push(`${pkg.label}/${rel}`);
      }
    }
    const formatted = sp.formatSource(parser.typedV053.parse(literal.files["main.air"], "main.air"), GATED);
    assert.equal(formatted, canonical.files["main.air"], "R3.1's literal V53-EFF-P01 formats to V53-EFF-P01's canonical file");
    return { value: { canonical_files: files.length, literal_formats_to: hexOf(formatted) } };
  });
  await vector("P0-10-CHECK-LINK", async () => {
    // P10-R25 (R-COMP-3): every package that verifies builds on the verified
    // builder and its Wasm compiles; a contract artifact's T1 record names
    // the lane 0.13 and its capability imports.
    const out = {};
    for (const pkg of accepted) {
      const built = await buildVerifiedTypedModule(buildInput(pkg));
      const module = new WebAssembly.Module(built.wasmBytes);
      const imports = WebAssembly.Module.imports(module).map((item) => `${item.module}.${item.name}`);
      const record = verifiedBuild.typedV053.readBorrowedLaneRecord(built);
      const externs = [...declaredExterns(pkg).keys()].sort();
      assert(record, `${pkg.label}: a contract artifact has a T1 record`);
      assert.deepEqual([record.lane, [...record.capabilityImports]], ["0.13", externs], `${pkg.label}: the record's lane and capability imports`);
      assert.deepEqual(imports, ["air:contract.typed-v0.53.v1", ...externs], `${pkg.label}: the artifact's imports`);
      out[pkg.label] = { imports, wasm: sha256(built.wasmBytes) };
    }
    return { value: { built: Object.keys(out).length, packages: out } };
  });
  await vector("P0-10-CHECK-WAT", () => {
    const list = path.join(tmp, "wat-list.json");
    fs.writeFileSync(list, JSON.stringify(accepted.map((pkg) => [pkg.label, pkg.rootPath])));
    const probe = path.join(tmp, "wat-probe.js");
    fs.writeFileSync(probe, WAT_PROBE);
    const real = spawnJson(probe, [path.join(ROOT, "src"), list]);
    const checked = {};
    for (const pkg of accepted) {
      assert.deepEqual(watProblems(pkg, real[pkg.label]), [], `${pkg.label}: P0-10-CHECK-WAT`);
      checked[pkg.label] = { host_calls: real[pkg.label].calls.length, imports: real[pkg.label].imports };
    }
    // V53-EFF-P04 (ii): B-1's shape with an extern defines the borrow-failure helper once.
    assert.equal(real[pkgOf("V53-EFF-P04_ii_").label].helpers, 1, "the borrow-failure helper once");
    const controls = {};
    for (const [name, mutant] of Object.entries(WAT_MUTANTS)) {
      const scratch = scratchSource(name, mutant.edits);
      const mutated = spawnJson(probe, [scratch, list]);
      fs.rmSync(scratch, { force: true, recursive: true });
      const caught = accepted.filter((pkg) => watProblems(pkg, mutated[pkg.label]).length).map((pkg) => pkg.label);
      assert(caught.length > 0, `${name} (${mutant.description}) must fail P0-10-CHECK-WAT`);
      controls[name] = { caught, description: mutant.description };
    }
    assert(controls.W1.caught.some((label) => label.startsWith("V53-EFF-P02_")), "W1 bites on V53-EFF-P02");
    assert(controls.W2.caught.some((label) => label.startsWith("V53-MEM-N34_")), "W2 bites on V53-MEM-N34");
    assert(controls.W3.caught.some((label) => label.startsWith("V53-EFF-P07_")), "W3 bites on V53-EFF-P07");
    return { value: { checked, controls } };
  });
  await vector("P0-10-CHECK-ROOTVERIFY", () => {
    // P10-R29 with AD-P10-13 (a): the root's verify counter on V53-IMP-P02's
    // package reads (i) 1 after one SDK verification, (ii) 1 after a second
    // verifySource, (iii) 1 after a verification and the lowering. M7 (the
    // root's per-module verification doubled in the closure pass) and M8
    // (the root counted on every call) must each fail it.
    const dir = path.join(tmp, "imp-p02");
    fs.mkdirSync(dir, { recursive: true });
    for (const [rel, text] of Object.entries(IMP_P02)) {
      assert.equal(hexOf(text), IMP_P02_SHA256[rel], `V53-IMP-P02 ${rel}: the P0-09 slice text's bytes`);
      fs.writeFileSync(path.join(dir, rel), text);
    }
    const probe = path.join(tmp, "rootverify-probe.js");
    fs.writeFileSync(probe, ROOTVERIFY_PROBE);
    const rootPath = path.join(dir, "main.air");
    const real = spawnJson(probe, [path.join(ROOT, "src"), rootPath]);
    assert.deepEqual(real.counts, { i: 1, ii: 1, iii: 1 }, "the root's verify counts (i)-(iii)");
    assert.deepEqual(real.math, 1, "math.air is verified once");
    const controls = {};
    for (const [name, mutant] of Object.entries(ROOTVERIFY_MUTANTS)) {
      const scratch = scratchSource(name, mutant.edits);
      const mutated = spawnJson(probe, [scratch, rootPath]);
      fs.rmSync(scratch, { force: true, recursive: true });
      assert.notDeepEqual(mutated.counts, { i: 1, ii: 1, iii: 1 }, `${name} (${mutant.description}) must fail P0-10-CHECK-ROOTVERIFY`);
      controls[name] = { counts: mutated.counts, description: mutant.description };
    }
    return { value: { controls, counts: real.counts, math: real.math } };
  });
}

const ROOTVERIFY_PROBE = `"use strict";
const path = require("path");
const fs = require("fs");
const [srcDir, rootPath] = process.argv.slice(2);
const sp = require(path.join(srcDir, "source_profile.js"));
const tc = require(path.join(srcDir, "typed_closure.js"));
const { lowerToWat } = require(path.join(srcDir, "lower_wasm.js"));
const options = { allowCandidateProfile: true, sourceProfile: "typed-v0.53" };
const fresh = () => sp.parseSource(fs.readFileSync(rootPath, "utf8"), rootPath, options);
const a = fresh();
sp.verifySource(a, options);
const i = tc.closureCounters(a)["main.air"].verify;
sp.verifySource(a, options);
const ii = tc.closureCounters(a)["main.air"].verify;
const b = fresh();
sp.verifySource(b, options);
lowerToWat(b, {});
const iii = tc.closureCounters(b)["main.air"].verify;
process.stdout.write(JSON.stringify({ counts: { i, ii, iii }, math: tc.closureCounters(b)["math.air"].verify }));
`;
const ROOTVERIFY_MUTANTS = Object.freeze({
  M7: { description: "the root's per-module verification doubled in the closure pass", edits: [["verifier.js",
    "  verifyV053ClosureModule(mod, closure ? typedClosure.importsOf(mod) : null);\n",
    "  verifyV053ClosureModule(mod, closure ? typedClosure.importsOf(mod) : null);\n  verifyV053ClosureModule(mod, closure ? typedClosure.importsOf(mod) : null);\n"]] },
  M8: { description: "the root counted on every call, the lowering's included", edits: [["verifier.js",
    "  if (context && (context.key !== context.closure.rootKey || !context.closure.verified.has(context.key))) typedClosure.count(mod, \"verify\");",
    "  if (context) typedClosure.count(mod, \"verify\");"]] }
});

// ---------------------------------------------------------------------------
// EACH_SLICE vectors at P0-10 (R3.1 VECTORS.md 448-455).

async function sectionEachSlice() {
  await vector("V53-FMT-01@P0-10", () => {
    // Idempotence over every file of every package that verifies.
    let files = 0;
    for (const pkg of acceptedPackages()) {
      for (const [rel, text] of Object.entries(pkg.files)) {
        const once = sp.formatSource(parser.typedV053.parse(text, rel), GATED);
        assert.equal(sp.formatSource(parser.typedV053.parse(once, rel), GATED), once, `${pkg.label} ${rel}: idempotent`);
        files += 1;
      }
    }
    return { value: { files } };
  });
  await vector("V53-LSP-01@P0-10", () => {
    const pkg = pkgOf("V53-EFF-N01_");
    const report = JSON.parse(runCli(["check", pkg.rootPath, "--source-profile", V053, "--allow-candidate-profile", "--lsp-json"]).stdout);
    assert.deepEqual([report.diagnostics[0].code, report.diagnostics[0].line], ["air.effect.demand_missing", 7]);
    return { value: { code: report.diagnostics[0].code, line: report.diagnostics[0].line, status: report.status } };
  });
  const lsp = (pkg) => {
    const session = new AirLspSession({ allowCandidateProfile: true, sourceProfile: V053 });
    const [published] = session.handleMessage({ jsonrpc: "2.0", method: "textDocument/didOpen", params: { textDocument: { text: pkg.files[pkg.root], uri: `file://${pkg.rootPath}`, version: 1 } } });
    return published.params.diagnostics;
  };
  await vector("V53-LSP-02@P0-10", () => {
    assert.deepEqual(lsp(pkgOf("V53-EFF-P01_one_emit")), [], "an accepted module publishes no diagnostic");
    const diagnostics = lsp(pkgOf("V53-EFF-N05_"));
    assert.deepEqual([diagnostics[0].code, diagnostics[0].range.start.line + 1], ["air.extern.unsupported", 4], "the code is preserved");
    return { value: { accepted: 0, code: diagnostics[0].code, line: diagnostics[0].range.start.line + 1 } };
  });
  await vector("V53-LSP-03@P0-10", () => {
    const diagnostics = lsp(pkgOf("V53-EFF-N19_iv_"));
    assert.deepEqual([diagnostics[0].code, diagnostics[0].range.start.line + 1], ["air.effect.demand_missing", 9]);
    return { value: { code: diagnostics[0].code, line: diagnostics[0].range.start.line + 1 } };
  });
  await vector("V53-DIAG-01@P0-10", () => {
    // Every P0-10 code has a typed-v0.53 hint and a row in the note (the note
    // is dev-side; the public projection mirrors src/ and the tests); every
    // code this file's vectors reached is registered; every verifier code
    // but alias_conflict is exercised here (V53-EFF-N17 runs in
    // test/v053_host_binding.test.js, with every adapter code).
    const hints = fs.readFileSync(path.join(ROOT, "src", "diagnostics.js"), "utf8");
    const notePath = path.join(ROOT, "docs", "v0.53", "P0_10_EFFECT_DEMAND.md");
    if (fs.existsSync(notePath)) {
      const rows = [...fs.readFileSync(notePath, "utf8").matchAll(/^\| `(air\.[a-z0-9_.]+)` \| PROPOSED/gmu)].map((match) => match[1]).sort();
      assert.deepEqual(rows, [...P0_10_CODE_REGISTRY], "the note's table lists exactly the thirteen PROPOSED codes");
    }
    for (const code of P0_10_CODE_REGISTRY) assert(hints.includes(`"${code}"`), `${code} has a hint`);
    const seen = new Set(observed);
    for (const code of seen) assert(P0_10_CODE_REGISTRY.includes(code) || P0_10_EXISTING_CODES.includes(code), `${code} is registered`);
    for (const code of P0_10_VERIFIER_CODES) if (code !== "air.extern.alias_conflict") assert(seen.has(code), `${code} is exercised`);
    return { value: { exercised: [...seen].sort(), failures_checked: observed.length, p0_10_codes: P0_10_CODE_REGISTRY.length } };
  });
  await vector("V53-DIAG-02@P0-10", async () => {
    // Deterministic fuzz of the P0-10 roots: no raw TypeError, JS stack, WABT
    // or engine error; a verified source always builds (R-COMP-3).
    let seed = 0x0f1010;
    const next = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed; };
    const ops = ["extern debug.metric(id: i32, value: i32) -> void", "extern output.notify(id: i32) -> i32", "demand { debug.metric <= 1 }", "demand { cpu.steps <= 1 }",
      "demand { a <= 1 }", "capabilities { debug }", "extern", "demand", "@debug.metric", "call @debug.metric(1, %x)", "%p", "ptr", "f32", "<= 01", "effects { debug }", "-> void"];
    const roots = acceptedPackages().filter((pkg) => Object.keys(pkg.files).length === 1);
    let cases = 0; let verified = 0; let assembled = 0;
    for (let round = 0; round < 240; round += 1) {
      const pkg = roots[next() % roots.length];
      const lines = pkg.files[pkg.root].split("\n");
      const mode = next() % 4;
      const at = next() % lines.length;
      if (mode === 0) lines.splice(at, 1);
      else if (mode === 1) lines.splice(at, 0, ops[next() % ops.length]);
      else if (mode === 2) lines[at] = `${lines[at]} ${ops[next() % ops.length]}`;
      else lines[at] = lines[at].replace(/[a-z0-9_.@%<>"/]+/u, ops[next() % ops.length]);
      const source = lines.join("\n");
      cases += 1;
      let ast;
      try {
        ast = sp.parseSource(source, pkg.rootPath, GATED);
        sp.verifySource(ast, GATED);
        verified += 1;
      } catch (error) {
        assert(!(error instanceof TypeError) && !(error instanceof RangeError) && !(error instanceof SyntaxError), `${error && error.stack}\n${source}`);
        assert(typeof error.code === "string" && error.code.startsWith("air."), `uncoded: ${error && error.message}\n${source}`);
        assert(!/wabt|\n\s+at /iu.test(String(error.message)));
        continue;
      }
      const wat = lowerToWat(ast, { maxWatBytes: MAX_WAT });
      new WebAssembly.Module(await watToWasm(wat, "fuzz.air"));
      assembled += 1;
    }
    assert.equal(assembled, verified, "every verified fuzz source builds");
    return { value: { assembled, cases, verified } };
  });
}

// ---------------------------------------------------------------------------
async function main() {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "air-v053-p010-effects-"));
  try {
    await sectionGenerated();
    await sectionAdditions();
    await sectionChecks();
    await sectionEachSlice();
  } finally {
    fs.rmSync(tmp, { force: true, recursive: true });
  }
  const outDir = process.env.AIR_P010_VECTOR_RESULTS_DIR;
  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "v053_effects.results.json"), `${JSON.stringify(results, null, 2)}\n`);
  }
  const passed = results.filter((item) => item.status === "PASS").length;
  for (const result of results) {
    if (result.status === "FAIL") console.log(`not ok - ${result.vector}`);
    else console.log(`ok - ${result.vector} ${result.status}`);
  }
  if (failures.length) {
    for (const failure of failures) console.error(`not ok - ${failure}`);
    console.error(`typed-v0.53 P0-10 source vectors: ${failures.length} FAIL, ${passed} PASS`);
    process.exit(1);
  }
  console.log(`typed-v0.53 P0-10 source vectors: ${passed} PASS`);
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
