#!/usr/bin/env node
"use strict";

// typed-v0.53 P0-10 (card AIR-0053-P0-10-0001): typed host imports through
// the reference adapter. Every expectation comes from R3.1 VECTORS.md, the
// slice text R2.3 (P0_10_SLICE_RFC.md P10-R11..R17, VECTORS_ADDITIONS.md;
// folder SHA256SUMS 570084ad...) or the admission record (dd74fb6d...), never
// from the output of the implementation under test. Each ACCEPT vector is
// verified at the static entrypoints, built by the verified builder and run
// through the typed admission (src/sdk.js admitTypedV053Artifact) with
// explicit handlers; each test host records its own calls (AD-P10-10 (a)).
// The packages are checked in under fixtures/v053/effects/ (FIXTURE_PINS, the
// slice text's generator output). Set AIR_P010_VECTOR_RESULTS_DIR=<dir> to
// write one canonical result record per vector. X-SND-03 is first executed
// here (V53-IMP-P01, V53-WB-H03, V53-EFF-P06) and is not claimed closed.

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const sp = require("../src/source_profile");
const parser = require("../src/parser");
const wb = require("../src/workbound");
const typedClosure = require("../src/typed_closure");
const borrowedSlices = require("../src/borrowed_slices");
const reference = require("../src/v051_reference");
const { admitTypedV053Artifact } = require("../src/sdk");
const { buildVerifiedTypedModule, createVerifiedTypedRuntime, invokeVerifiedTypedExport } = require("../src/v052_verified_build");
const verifiedBuild = require("../src/v052_verified_build");
const { lowerToWat, watToWasm } = require("../src/lower_wasm");

const ROOT = path.resolve(__dirname, "..");
const FIXTURES = path.join(ROOT, "fixtures", "v053", "effects");
const V053 = "typed-v0.53";
const GATED = Object.freeze({ allowCandidateProfile: true, sourceProfile: V053 });
const MAX_WAT = 4194304;
// P10-R26: the adapter's PROPOSED codes (binding errors, D-VAL-09).
const P0_10_ADAPTER_CODES = Object.freeze([
  "air.host.binding_invalid", "air.host.binding_missing", "air.host.call_before_admission", "air.host.import_failed",
  "air.host.reentrancy_forbidden", "air.host.result_invalid"
]);
// P0-08's FIXED AD-3 descriptor of the contract shape (OD-P10-3 (a)).
const V2_HEADER = Object.freeze({
  airAbi: "0.13", feature: "typed-memory-v1", lengthUnit: "bytes", memoryDomains: Object.freeze(["wasm-linear"]),
  schema: "air.borrowed-slice-interface.v2", transferModeRequired: true
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

const hexOf = (text) => crypto.createHash("sha256").update(Buffer.isBuffer(text) || text instanceof Uint8Array ? text : Buffer.from(text, "utf8")).digest("hex");
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
  if (typeof value === "number" && !Number.isFinite(value)) return String(value);
  if (typeof value === "number" && Object.is(value, -0)) return "-0";
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
// The checked-in packages (FIXTURE_PINS) and the entrypoints.

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

// P0-08's v2 descriptor of the contract shape, listing every root export (a
// borrowed export as P0-08's generator writes it), as the caller writes it.
function descriptorOf(pkg) {
  let ast = null;
  try { ast = parser.typedV053.parse(pkg.files[pkg.root], pkg.root); } catch (_) { ast = null; }
  if (!ast) return { ...V2_HEADER, memoryDomains: [...V2_HEADER.memoryDomains], exports: [{ entryContracts: [], name: "run", params: [] }] };
  const borrowed = borrowedSlices.typedV053.interfaceDescriptor(ast);
  const written = new Map(((borrowed && borrowed.exports) || []).map((entry) => [entry.name, entry]));
  return { ...V2_HEADER, memoryDomains: [...V2_HEADER.memoryDomains], exports: ast.functions.filter((item) => item.exported).map((fn) => written.get(fn.name) || {
    entryContracts: [], name: fn.name, params: fn.params.map((parameter) => ({ kind: "value", name: parameter.name, type: parameter.type }))
  }) };
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
  observed.push(out.code);
  return out;
}
function sdkOutcome(pkg) {
  try {
    const ast = sp.parseSource(pkg.files[pkg.root], pkg.rootPath, GATED);
    sp.verifySource(ast, GATED);
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
async function builderOutcome(pkg) {
  try {
    return { built: await buildVerifiedTypedModule(buildInput(pkg)), verdict: "VERIFIED" };
  } catch (error) {
    return failureOf(error);
  }
}
async function runtimeOutcome(pkg) {
  try {
    await createVerifiedTypedRuntime({ admit: async () => true }).build(buildInput(pkg));
    return { verdict: "VERIFIED" };
  } catch (error) {
    return failureOf(error);
  }
}
async function staticReject(pkg, code, line, file = pkg.root) {
  const outcomes = { builder: await builderOutcome(pkg), cli_check: cliOutcome(pkg, "check"), cli_verify: cliOutcome(pkg), runtime: await runtimeOutcome(pkg), sdk: sdkOutcome(pkg) };
  for (const [entrypoint, outcome] of Object.entries(outcomes)) {
    assert.equal(outcome.code, code, `${pkg.label} ${entrypoint}: ${JSON.stringify(outcome)}`);
    assert.equal(outcome.line, line, `${pkg.label} ${entrypoint}: line`);
    if (file !== pkg.root && outcome.file !== undefined) assert.equal(outcome.file, file, `${pkg.label} ${entrypoint}: file`);
  }
  return { code, entrypoints: Object.keys(outcomes), file, line };
}

// ACCEPT at the static entrypoints (SDK verify, lowerToWat, CLI verify, the
// verified builder); the runtime refuses a contract artifact (P10-R17), which
// runs only through the typed admission. Returns the build and the SDK AST.
const builds = new Map();
async function accepted(pkg) {
  if (builds.has(pkg.label)) return builds.get(pkg.label);
  const sdk = sdkOutcome(pkg);
  assert.equal(sdk.verdict, "VERIFIED", `${pkg.label} SDK: ${JSON.stringify(sdk)}`);
  lowerToWat(sdk.ast, { maxWatBytes: MAX_WAT });
  assert.equal(cliOutcome(pkg).verdict, "VERIFIED", `${pkg.label} CLI verify`);
  const builder = await builderOutcome(pkg);
  assert.equal(builder.verdict, "VERIFIED", `${pkg.label} builder: ${JSON.stringify(builder)}`);
  const runtime = await runtimeOutcome(pkg);
  assert.equal(runtime.code, "air.assurance.profile_unsupported", `${pkg.label} runtime refuses a contract artifact`);
  const out = { ast: sdk.ast, built: builder.built };
  builds.set(pkg.label, out);
  return out;
}

// A test host: each handler appends its call to the host log (AD-P10-10 (a):
// the logs are the hosts' own records).
function hostLog(behaviour = {}) {
  const log = [];
  const handlers = {};
  for (const [name, fn] of Object.entries(behaviour)) {
    handlers[name] = (...args) => {
      log.push([name, ...args.map((item) => (item instanceof Uint8Array ? [...item] : item))]);
      return fn(...args);
    };
  }
  return { handlers, log, of: (name) => log.filter((entry) => entry[0] === name).map((entry) => entry.slice(1)) };
}
async function admit(built, handlers, extra = {}) {
  return admitTypedV053Artifact({ record: built, wasmBytes: built.wasmBytes, ...(handlers === undefined ? {} : { handlers }), ...extra });
}
async function invoke(built, handlers, entrypoint, args = {}, bindings = {}) {
  return (await admit(built, handlers)).invoke({ arguments: args, bindings, entrypoint });
}
async function invokeRaw(built, handlers, entrypoint, lanes = []) {
  const instance = await (await admit(built, handlers)).instantiate();
  try {
    return instance.invokeRaw(entrypoint, lanes);
  } catch (error) {
    return { diagnostics: [{ code: error.code }], result: null, thrown: true };
  }
}
const codeOf = (outcome) => {
  const code = outcome.diagnostics && outcome.diagnostics.length ? outcome.diagnostics[0].code : null;
  if (code) observed.push(code);
  return code;
};
async function refusal(action, code, step) {
  try {
    await action();
  } catch (error) {
    assert.equal(error.code, code, `refusal code: ${error && error.stack}`);
    if (step !== undefined) assert.equal(error.step, step, "refusal step");
    observed.push(error.code);
    return { code: error.code, step: error.step === undefined ? null : error.step };
  }
  assert.fail(`expected ${code}`);
  return null;
}
const effects = (map) => Object.fromEntries(Object.entries(map).map(([key, value]) => [key, BigInt(value)]));
const S = (steps, effect = {}, calls = 0, iterations = 0, regionBytes = 0) => wb.canonicalSummary(wb.summary({ calls: BigInt(calls), effects: effects(effect), iterations: BigInt(iterations), region_bytes: BigInt(regionBytes), steps: BigInt(steps) }));
function expectE(built, name, ...args) {
  const actual = wb.inspectBoundWorkBound(built).record.entries[name];
  assert.deepEqual(actual, S(...args), `E(${name})`);
  return actual;
}
const f32Bits = (value) => {
  const view = new DataView(new ArrayBuffer(4));
  view.setFloat32(0, value, true);
  return view.getUint32(0, true).toString(16).padStart(8, "0");
};
const ok = (value) => () => value;
const borrowedBind = (buffer, access, maxLength, alignment) => ({ access, aliasGroup: null, alignment, buffer, maxLength, memoryDomain: "wasm-linear", transferMode: "copied_into_wasm" });

// V53-EFF-P01's artifact rebuilt from its own WAT with one change (V53-EFF-N20
// (vi), (vii); V53-ABI-59, -65's F-STARTFX, VECTORS_ADDITIONS.md §5).
async function variantBytes(ast, from, to) {
  const wat = lowerToWat(ast, { maxWatBytes: MAX_WAT });
  assert.equal(wat.split(from).length, 2, `the WAT has '${from}' once`);
  return Buffer.from(await watToWasm(wat.replace(from, to), "variant.air"));
}
const EMIT = ["output", "emit"].join(".");
const START_LINE = "  (func $__air_v053_contract_start call $__air_v053_contract i32.const 1095324209 i32.ne if unreachable end)";

// ---------------------------------------------------------------------------
// R3.1's generated rows with a host, and the source-and-host additions.

async function sectionHost() {
  const p01 = pkgOf("V53-EFF-P01_one_emit");
  await vector("V53-EFF-P01", async () => {
    const { built } = await accepted(p01);
    const host = hostLog({ [EMIT]: ok(0) });
    const admission = await admit(built, host.handlers);
    // OD-P10-2 (a): the handle's and the instance's keys stay P0-08's.
    assert.deepEqual(Object.keys(admission).sort(), ["digest", "instantiate", "invoke", "trust"], "the admission handle's keys");
    const outcome = await admission.invoke({ arguments: { x: 7 }, bindings: {}, entrypoint: "run" });
    assert.deepEqual([outcome.result, codeOf(outcome)], [0, null], "run(7) = 0");
    assert.deepEqual(host.of(EMIT), [[1, 7, 0, 0, 0]], "one host call [1,7,0,0,0]");
    assert.deepEqual(Object.keys(await admission.instantiate()).sort(), ["invoke", "invokeRaw", "memory"], "the instance's keys");
    const literal = pkgOf("V53-EFF-P01_R3.1_literal");
    const literalBuild = (await accepted(literal)).built;
    const literalHost = hostLog({ [EMIT]: ok(0) });
    const literalOutcome = await invoke(literalBuild, literalHost.handlers, "run", { x: 7 });
    assert.deepEqual([literalOutcome.result, literalHost.of(EMIT)], [0, [[1, 7, 0, 0, 0]]], "R3.1's literal text: the same");
    return { value: { "E(run)": expectE(built, "run", 2, { [EMIT]: 1 }), host_log: host.log, literal: { "E(run)": expectE(literalBuild, "run", 2, { [EMIT]: 1 }), run7: 0 }, run7: 0 } };
  });
  const p01Build = async () => (await accepted(p01)).built;
  await vector("V53-EFF-N11", async () => {
    const host = hostLog({});
    const refused = await refusal(async () => admit(await p01Build(), host.handlers), "air.host.binding_missing", 1);
    assert.deepEqual(host.log, [], "no handler ran; no default or stub handler");
    return { value: { ...refused, host_log: host.log } };
  });
  await vector("V53-EFF-N12", async () => {
    const built = await p01Build();
    const value = {};
    for (const [label, result] of [["2^40", 1099511627776], ["\"0\"", "0"]]) {
      const host = hostLog({ [EMIT]: ok(result) });
      const outcome = await invoke(built, host.handlers, "run", { x: 7 });
      assert.deepEqual([outcome.result, codeOf(outcome), host.log.length], [null, "air.host.result_invalid", 1], `${label}: never the ToInt32 value`);
      value[label] = { code: "air.host.result_invalid", host_calls: 1 };
    }
    return { value };
  });
  await vector("V53-EFF-N13", async () => {
    const { built } = await accepted(pkgOf("V53-EFF-N13_"));
    let calls = 0;
    const host = hostLog({ [EMIT]: () => { calls += 1; if (calls === 2) throw new Error("host failure"); return 0; } });
    const outcome = await invoke(built, host.handlers, "run", { x: 7 });
    assert.deepEqual([outcome.result, codeOf(outcome)], [null, "air.host.import_failed"]);
    assert.deepEqual(host.of(EMIT), [[1, 7, 0, 0, 0], [2, 7, 0, 0, 0]], "both calls; the first effect stands; no third");
    return { value: { code: "air.host.import_failed", host_log: host.log } };
  });
  await vector("V53-EFF-N14", async () => {
    const built = await p01Build();
    const value = {};
    // (i), (ii): through the running instance's invoke and invokeRaw.
    for (const [label, inner] of [["i", (instance) => instance.invoke({ arguments: { x: 5 }, bindings: {}, entrypoint: "run" })], ["ii", (instance) => instance.invokeRaw("run", [5])]]) {
      let instance = null;
      let innerOutcome = null;
      const host = hostLog({ [EMIT]: () => {
        try { innerOutcome = { code: codeOf(inner(instance)), thrown: false }; } catch (error) { innerOutcome = { code: error.code, thrown: true }; observed.push(error.code); }
        return 0;
      } });
      instance = await (await admit(built, host.handlers)).instantiate();
      const outcome = instance.invoke({ arguments: { x: 7 }, bindings: {}, entrypoint: "run" });
      assert.deepEqual(innerOutcome, { code: "air.host.reentrancy_forbidden", thrown: label === "ii" }, `(${label}) the inner call`);
      assert.deepEqual([outcome.result, codeOf(outcome), host.log.length], [null, "air.host.reentrancy_forbidden", 1], `(${label}) the outer invocation`);
      value[label] = { host_calls: 1, inner: innerOutcome, outer: "air.host.reentrancy_forbidden" };
    }
    // (iii): another export of the same instance (V53-EFF-P03's artifact).
    {
      const p03 = (await accepted(pkgOf("V53-EFF-P03_"))).built;
      let instance = null;
      let innerOutcome = null;
      const host = hostLog({ "debug.metric": () => { innerOutcome = codeOf(instance.invoke({ arguments: {}, bindings: {}, entrypoint: "u" })); return undefined; }, "input.button": ok(1), "random.u32": ok(3) });
      instance = await (await admit(p03, host.handlers)).instantiate();
      const outcome = instance.invoke({ arguments: { x: 4 }, bindings: {}, entrypoint: "d" });
      assert.deepEqual([innerOutcome, codeOf(outcome), host.log.length], ["air.host.reentrancy_forbidden", "air.host.reentrancy_forbidden", 1], "(iii)");
      assert.deepEqual(host.of("random.u32"), [], "(iii) the inner invocation never started");
      value.iii = { host_calls: 1, inner: innerOutcome, outer: "air.host.reentrancy_forbidden" };
    }
    // (iv): the admission object's invoke, a promise resolved with the failed result.
    {
      let admission = null;
      let innerPromise = null;
      const host = hostLog({ [EMIT]: () => { innerPromise = admission.invoke({ arguments: { x: 5 }, bindings: {}, entrypoint: "run" }); return 0; } });
      admission = await admit(built, host.handlers);
      const outcome = await admission.invoke({ arguments: { x: 7 }, bindings: {}, entrypoint: "run" });
      const settled = await innerPromise.then((resolved) => ({ code: codeOf(resolved), resolved: true }), () => ({ resolved: false }));
      assert.deepEqual(settled, { code: "air.host.reentrancy_forbidden", resolved: true }, "(iv) resolved, never rejected");
      assert.deepEqual([codeOf(outcome), host.log.length], ["air.host.reentrancy_forbidden", 1], "(iv) the outer invocation");
      value.iv = { host_calls: 1, inner: settled, outer: "air.host.reentrancy_forbidden" };
    }
    // (v): a separately admitted artifact of the same bytes is not guarded.
    {
      const log = [];
      const other = await (await admit(built, { [EMIT]: (...args) => { log.push(args); return 0; } })).instantiate();
      const host = { [EMIT]: (...args) => { log.push(args); const inner = other.invoke({ arguments: { x: 5 }, bindings: {}, entrypoint: "run" }); assert.equal(inner.result, 0); return 0; } };
      const outcome = await invoke(built, host, "run", { x: 7 });
      assert.deepEqual([outcome.result, log], [0, [[1, 7, 0, 0, 0], [1, 5, 0, 0, 0]]], "(v) the separate admission runs; run(7) = 0");
      value.v = { host_log: log, run7: 0 };
    }
    return { value };
  });
  await vector("V53-EFF-N15", async () => {
    // An i64 result: the typed admission's invoke serializes no BigInt result
    // (P0-08's invocation evidence), so the export runs through invokeRaw.
    const { built } = await accepted(pkgOf("V53-EFF-N15_"));
    const value = {};
    for (const [label, result] of [["5", 5], ["\"5\"", "5"], ["true", true], ["2n**63n", 2n ** 63n]]) {
      const host = hostLog({ "time.now_ms": ok(result) });
      const outcome = await invokeRaw(built, host.handlers, "t");
      assert.deepEqual([outcome.result, codeOf(outcome), host.log.length], [null, "air.host.result_invalid", 1], label);
      value[label] = "air.host.result_invalid";
    }
    for (const result of [-(2n ** 63n), 9007199254740993n]) {
      const outcome = await invokeRaw(built, hostLog({ "time.now_ms": ok(result) }).handlers, "t");
      assert.equal(outcome.result, result, `${result} returned exactly`);
      value[result.toString()] = outcome.result;
    }
    return { value: { ...value, "E(t)": expectE(built, "t", 2, { "time.now_ms": 1 }) } };
  });
  await vector("V53-EFF-N16", async () => {
    const { built } = await accepted(pkgOf("V53-EFF-N16_"));
    const value = {};
    for (const [label, result] of [["0.1", 0.1], ["1e39", 1e39], ["\"1\"", "1"]]) {
      const outcome = await invoke(built, hostLog({ "random.f32": ok(result) }).handlers, "u");
      assert.deepEqual([outcome.result, codeOf(outcome)], [null, "air.host.result_invalid"], `${label}: never rounded`);
      value[label] = "air.host.result_invalid";
    }
    for (const [label, result, bits] of [["Math.fround(0.1)", Math.fround(0.1), "3dcccccd"], ["Infinity", Infinity, "7f800000"], ["-0", -0, "80000000"]]) {
      const outcome = await invoke(built, hostLog({ "random.f32": ok(result) }).handlers, "u");
      assert.equal(f32Bits(outcome.result), bits, `${label}: bits ${bits}`);
      value[label] = bits;
    }
    const nan = await invoke(built, hostLog({ "random.f32": ok(NaN) }).handlers, "u");
    assert(Number.isNaN(nan.result), "NaN accepted, classification nan (no bit claim)");
    value.NaN = "nan";
    return { value: { ...value, "E(u)": expectE(built, "u", 2, { "random.f32": 1 }) } };
  });
  await vector("V53-EFF-N17", async () => {
    const rejected = await staticReject(pkgOf("V53-EFF-N17_an_import"), "air.extern.alias_conflict", 8);
    const control = pkgOf("V53-EFF-N17_control");
    const { built } = await accepted(control);
    const host = hostLog({ [EMIT]: ok(0) });
    const outcome = await invoke(built, host.handlers, "run", { x: 7 });
    assert.deepEqual([outcome.result, host.of(EMIT)], [0, [[1, 7, 0, 0, 0]]], "the control: the alias renamed");
    return { value: { control: { run7: 0 }, rejected } };
  });
  await vector("V53-EFF-N20", async () => {
    const built = await p01Build();
    const value = {};
    value.i = await refusal(() => admit(built, { [EMIT]: ok(0), "output.emitt": ok(0) }), "air.host.binding_invalid", 1);
    value.ii = await refusal(() => admit(built, { "output.emitt": ok(0) }), "air.host.binding_missing", 1);
    let reads = 0;
    value.iii = await refusal(() => admit(built, Object.defineProperty({}, EMIT, { enumerable: true, get() { reads += 1; return ok(0); } })), "air.host.binding_invalid", 1);
    assert.equal(reads, 0, "(iii) the getter is never called");
    {
      const handlers = { [EMIT]: ok(0) };
      const admission = await admit(built, handlers);
      handlers[EMIT] = () => { throw new Error("edited"); };
      handlers.extra = ok(0);
      const outcome = await admission.invoke({ arguments: { x: 7 }, bindings: {}, entrypoint: "run" });
      assert.deepEqual([outcome.result, codeOf(outcome)], [0, null], "(iv) the snapshot runs");
      value.iv = { run7: 0 };
    }
    value.v = { p01: await refusal(() => admit(built, undefined), "air.host.binding_missing", 1) };
    {
      // P0-08's borrowed lane with no capability import: absent is {}.
      const source = ["module v53.mem", "", "export func rd(b: borrowed_slice<readonly,len=4..4,align=4>) -> i32 {", "  %v: i32 = slice.load.i32 %b, 0", "  return %v", "}", ""].join("\n");
      const ast = parser.typedV053.parse(source, "rd.air");
      const borrowed = await buildVerifiedTypedModule({ ...GATED, descriptor: borrowedSlices.typedV053.interfaceDescriptor(ast), source, sourceName: "rd.air" });
      const outcome = await (await admit(borrowed, undefined)).invoke({ bindings: { b: borrowedBind(Buffer.from([9, 0, 0, 0]), "readonly", 4, 4) }, entrypoint: "rd" });
      assert.deepEqual([outcome.result, codeOf(outcome)], [9, null], "(v) a P0-08 artifact, handlers absent");
      value.v.p0_08_borrowed = { rd: 9 };
    }
    {
      const ast = sdkOutcome(p01).ast;
      let called = 0;
      const renamed = await variantBytes(ast, "(import \"output\" \"emit\"", "(import \"output\" \"notify\"");
      value.vi = await refusal(() => admitTypedV053Artifact({ handlers: { "output.notify": () => { called += 1; return 0; } }, interfaceDescriptor: built.descriptor, pinnedDigest: sha256(renamed), wasmBytes: renamed }), "air.abi.contract_unsupported", 1);
      const fixed = Buffer.from(await watToWasm(lowerToWat(ast, { maxWatBytes: MAX_WAT })
        .replace("(func $__air_host.output.emit (param i32 i32 i32 i32 i32) (result i32))", "(func $__air_host.output.emit (param i32 i32 i32 i32 i32) (result f32))")
        .replace("call $__air_host.output.emit\n", "call $__air_host.output.emit\n    i32.reinterpret_f32\n"), "retyped.air"));
      value.vii = await refusal(() => admitTypedV053Artifact({ handlers: { [EMIT]: () => { called += 1; return 0; } }, interfaceDescriptor: built.descriptor, pinnedDigest: sha256(fixed), wasmBytes: fixed }), "air.abi.contract_unsupported", 1);
      assert.equal(called, 0, "(vi), (vii) the handler is never called");
    }
    return { value };
  });
  await vector("V53-EFF-N21", async () => {
    const built = await p01Build();
    const direct = await refusal(() => invokeVerifiedTypedExport(built, "run", [7]), "air.assurance.profile_unsupported");
    const runtime = await refusal(() => createVerifiedTypedRuntime({ admit: async () => true }).build(buildInput(p01)), "air.assurance.profile_unsupported");
    const host = hostLog({ [EMIT]: ok(0) });
    assert.equal((await invoke(built, host.handlers, "run", { x: 7 })).result, 0, "the typed admission runs it");
    return { value: { invokeVerifiedTypedExport: direct.code, runtime_invoke: runtime.code, typed_admission: 0 } };
  });
  await vector("V53-EFF-N23", async () => {
    const built = await p01Build();
    let unhandled = 0;
    const listener = () => { unhandled += 1; };
    process.on("unhandledRejection", listener);
    try {
      const value = {};
      const resolved = hostLog({ [EMIT]: () => Promise.resolve(0) });
      const i = await invoke(built, resolved.handlers, "run", { x: 7 });
      assert.deepEqual([codeOf(i), resolved.log.length], ["air.host.import_failed", 1], "(i) a returned promise");
      value.i = "air.host.import_failed";
      const rejecting = hostLog({ [EMIT]: async () => { throw new Error("async host failure"); } });
      const ii = await invoke(built, rejecting.handlers, "run", { x: 7 });
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.deepEqual([codeOf(ii), rejecting.log.length, unhandled], ["air.host.import_failed", 1, 0], "(ii) a rejecting handler; no unhandledRejection");
      value.ii = { code: "air.host.import_failed", unhandled_rejections: unhandled };
      let reads = 0;
      const thenable = hostLog({ [EMIT]: () => Object.defineProperty({}, "then", { get() { reads += 1; return () => {}; } }) });
      const iii = await invoke(built, thenable.handlers, "run", { x: 7 });
      assert.deepEqual([codeOf(iii), thenable.log.length, reads], ["air.host.result_invalid", 1, 0], "(iii) a thenable, its then never read");
      value.iii = { code: "air.host.result_invalid", then_reads: reads };
      return { value };
    } finally {
      process.removeListener("unhandledRejection", listener);
    }
  });
  await vector("V53-EFF-P02", async () => {
    const { built } = await accepted(pkgOf("V53-EFF-P02_"));
    const handlers = () => hostLog({ "audio.play_tone": ok(undefined), "audio.set_gain": ok(undefined) });
    const a = handlers();
    const g = await invoke(built, a.handlers, "g", { x: 1.5 });
    assert.deepEqual([g.result, a.log], [0, [["audio.set_gain", 1.5], ["audio.play_tone", 1.5, 5]]], "g(1.5)");
    const b = handlers();
    await invoke(built, b.handlers, "g", { x: -0 });
    assert(Object.is(b.log[0][1], -0) && Object.is(b.log[1][1], -0), "g(-0): both arguments are -0");
    const c = handlers();
    await invoke(built, c.handlers, "g", { x: NaN });
    const d = handlers();
    await invoke(built, d.handlers, "h", { x: Infinity });
    assert([c.log[0][1], c.log[1][1], d.log[0][1]].every(Number.isNaN), "g(NaN), h(Infinity): every f32 argument is NaN");
    return { value: { "E(g)": expectE(built, "g", 5, { "audio.play_tone": 1, "audio.set_gain": 1 }), "E(h)": expectE(built, "h", 4, { "audio.set_gain": 1 }), g15: a.log } };
  });
  await vector("V53-EFF-P03", async () => {
    const { built } = await accepted(pkgOf("V53-EFF-P03_"));
    const base = { "debug.metric": ok(undefined), "input.button": ok(1), "random.u32": ok(3) };
    const run = async (name, result, entrypoint, args) => invoke(built, hostLog({ ...base, [name]: ok(result) }).handlers, entrypoint, args);
    const value = { b: {}, d: {}, u: {} };
    for (const [result, expected] of [[1, 1], [0, 0]]) assert.equal((await run("input.button", result, "b", { i: 2 })).result, expected, `b: ${result}`);
    for (const [label, result] of [["2", 2], ["true", true], ["\"1\"", "1"], ["-1", -1]]) {
      assert.equal(codeOf(await run("input.button", result, "b", { i: 2 })), "air.host.result_invalid", `b: ${label}`);
      value.b[label] = "air.host.result_invalid";
    }
    assert.equal((await run("debug.metric", undefined, "d", { x: 4 })).result, 4, "d: undefined -> x");
    for (const [label, result] of [["0", 0], ["null", null], ["\"\"", ""]]) {
      assert.equal(codeOf(await run("debug.metric", result, "d", { x: 4 })), "air.host.result_invalid", `d: ${label}`);
      value.d[label] = "air.host.result_invalid";
    }
    for (const result of [2147483647, -2147483648]) assert.equal((await run("random.u32", result, "u", {})).result, result, `u: ${result} exact`);
    assert(Object.is((await run("random.u32", -0, "u", {})).result, 0), "u: -0 -> 0");
    for (const [label, result] of [["2147483648", 2147483648], ["1.5", 1.5], ["NaN", NaN], ["5n", 5n], ["\"5\"", "5"]]) {
      assert.equal(codeOf(await run("random.u32", result, "u", {})), "air.host.result_invalid", `u: ${label}`);
      value.u[label] = "air.host.result_invalid";
    }
    return { value: { ...value, "E(b)": expectE(built, "b", 2, { "input.button": 1 }), "E(d)": expectE(built, "d", 2, { "debug.metric": 1 }), "E(u)": expectE(built, "u", 2, { "random.u32": 1 }) } };
  });
  await vector("V53-EFF-P04", async () => {
    const one = (await accepted(pkgOf("V53-EFF-P04_i_"))).built;
    const imports = WebAssembly.Module.imports(new WebAssembly.Module(one.wasmBytes)).map((item) => `${item.module}.${item.name}`);
    assert.deepEqual(imports, ["air:contract.typed-v0.53.v1", "debug.metric"], "(i) the contract import and the capability import");
    const host = hostLog({ "debug.metric": ok(undefined) });
    const outcome = await invoke(one, host.handlers, "rd", {}, { b: borrowedBind(Buffer.from([7, 0, 0, 0]), "readonly", 4, 4) });
    assert.deepEqual([outcome.result, host.of("debug.metric")], [7, [[2, 7]]], "(i) rd = 7");
    const two = (await accepted(pkgOf("V53-EFF-P04_ii_"))).built;
    const host2 = hostLog({ "debug.metric": ok(undefined) });
    const outcome2 = await invoke(two, host2.handlers, "run", { x: 5 });
    assert.deepEqual([outcome2.result, host2.of("debug.metric")], [5, [[1, 5]]], "(ii) run(5) = 5");
    return { value: { i: { "E(rd)": expectE(one, "rd", 4, { "debug.metric": 1 }), imports, rd: 7 }, ii: { "E(run)": expectE(two, "run", 2, { "debug.metric": 1 }), run5: 5 } } };
  });
  await vector("V53-EFF-P05", async () => {
    const { built } = await accepted(pkgOf("V53-EFF-P05_"));
    const rd = hostLog({ "fs.read_file": (a, b, out) => { out.set([7, 0, 0, 0]); return 0; }, "fs.write_file": ok(0) });
    const read = await invoke(built, rd.handlers, "rd");
    assert.equal(read.result, 7, "rd: the window written back into the region");
    let seen = null;
    const wr = hostLog({ "fs.read_file": ok(0), "fs.write_file": (a, b, src) => { seen = [...src]; src.fill(0); return 0; } });
    const write = await invoke(built, wr.handlers, "wr");
    assert.deepEqual(seen, [0x61, 0x62, 0x63, 0x64], "wr: the handler sees the literal");
    assert.equal(write.result, 1684234849, "wr: the read-only literal view is not written back");
    return { value: { "E(rd)": expectE(built, "rd", 7, { "fs.read_file": 1 }, 0, 0, 16), "E(wr)": expectE(built, "wr", 4, { "fs.write_file": 1 }), rd: 7, wr: 1684234849 } };
  });
  await vector("V53-EFF-P06", async () => {
    const { built } = await accepted(pkgOf("V53-EFF-P06_i_"));
    const host = hostLog({ [EMIT]: ok(0) });
    const outcome = await invoke(built, host.handlers, "run");
    assert.deepEqual([outcome.result, host.log.length], [10, 10], "run() = 10; ten events");
    const rejected = await staticReject(pkgOf("V53-EFF-P06_ii_"), "air.effect.demand_exceeded", 8);
    return { value: { i: { "E(run)": expectE(built, "run", 52, { [EMIT]: 10 }, 10, 10), host_calls: 10, run: 10 }, ii: rejected } };
  });
  await vector("V53-EFF-P07", async () => {
    const { built } = await accepted(pkgOf("V53-EFF-P07_"));
    const imports = WebAssembly.Module.imports(new WebAssembly.Module(built.wasmBytes)).map((item) => `${item.module}.${item.name}`);
    assert.deepEqual(imports, ["air:contract.typed-v0.53.v1", "debug.metric", EMIT], "every declared extern is imported");
    const missing = await refusal(() => admit(built, { [EMIT]: ok(0) }), "air.host.binding_missing", 1);
    const host = hostLog({ "debug.metric": ok(undefined), [EMIT]: ok(0) });
    const outcome = await invoke(built, host.handlers, "run", { x: 7 });
    assert.deepEqual([outcome.result, host.log], [0, [[EMIT, 1, 7, 0, 0, 0]]], "run(7) = 0; debug.metric never called");
    return { value: { "E(run)": expectE(built, "run", 2, { [EMIT]: 1 }), imports, missing, run7: 0 } };
  });
}

// ---------------------------------------------------------------------------
// The inherited DEFERRED vectors with a host (§3), the separations (§2) and
// the ABI rows V53-ABI-59, -65 (§5).

async function sectionInherited() {
  await vector("V53-LOOP-N10", async () => {
    const { built } = await accepted(pkgOf("V53-LOOP-N10_"));
    const host = hostLog({ [EMIT]: ok(0) });
    const outcome = await invoke(built, host.handlers, "run2", { n: 101 });
    assert.deepEqual([outcome.result, codeOf(outcome)], [null, "air.loop.count_out_of_range"]);
    assert.deepEqual(host.of(EMIT), [[1, 0, 0, 0, 0]], "the loop made no call; the earlier emit stands");
    return { value: { "E(run)": expectE(built, "run", 502, { [EMIT]: 100 }, 100, 100), "E(run2)": expectE(built, "run2", 503, { [EMIT]: 101 }, 100, 100), code: "air.loop.count_out_of_range", host_log: host.log } };
  });
  await vector("V53-CFG-P02", async () => {
    // f(c: bool): the typed admission's invoke takes i32-family and f32
    // arguments (P0-08), so a bool lane goes through invokeRaw.
    const { built } = await accepted(pkgOf("V53-CFG-P02_"));
    const yes = hostLog({ "debug.metric": ok(undefined) });
    assert.deepEqual([(await invokeRaw(built, yes.handlers, "f", [1])).result, yes.of("debug.metric")], [1, [[1, 1]]], "f(true) = 1");
    const no = hostLog({ "debug.metric": ok(undefined) });
    assert.deepEqual([(await invokeRaw(built, no.handlers, "f", [0])).result, no.log], [2, []], "f(false) = 2");
    return { value: { "E(f)": expectE(built, "f", 5, { "debug.metric": 1 }), f_false: 2, f_true: 1 } };
  });
  let loopP05 = null;
  await vector("V53-LOOP-P05", async () => {
    const { built } = await accepted(pkgOf("V53-LOOP-P05_i_"));
    const host = hostLog({ [EMIT]: ok(0) });
    const outcome = await invoke(built, host.handlers, "run");
    assert.equal(outcome.result, 100, "run() = 100");
    assert.deepEqual(host.of(EMIT), Array.from({ length: 100 }, (_, acc) => [1, acc, 0, 0, 0]), "100 events, acc 0..99");
    const rejected = await staticReject(pkgOf("V53-LOOP-P05_ii_"), "air.effect.demand_exceeded", 13);
    loopP05 = "PASS";
    return { value: { i: { "E(run)": expectE(built, "run", 502, { [EMIT]: 100 }, 100, 100), host_calls: 100, run: 100 }, ii: rejected } };
  });
  await vector("V53-WB-H01", async () => {
    // Composite (X-SND-01): (a) V53-WB-P04, the P0-02 model; (b) V53-LOOP-P05
    // above; (c) V53-CFG-N02 (P0-04), each rerun here; PASS only when all PASS.
    const t = wb.tree;
    const a = wb.evaluate(t.loop(100n, t.lit(wb.summary({ effects: { [EMIT]: 1n }, steps: 3n })))).result;
    assert(a.ok, "(a) ok");
    assert.deepEqual(wb.canonicalSummary(a.value), S(401, { [EMIT]: 100 }, 0, 100), "(a) S{steps:401, iterations:100, effects{output.emit:100}}");
    assert.equal(loopP05, "PASS", "(b) V53-LOOP-P05");
    const phi = fs.readFileSync(path.join(ROOT, "examples", "phi_loop.air"), "utf8");
    assert.equal(sha256(phi), "sha256:a301fa5044d3d66109f1a4eb586dd58ce4efd4ce9e76f592be2312400b90a7eb", "(c) the P0-04 pin of examples/phi_loop.air");
    let c = null;
    try { sp.verifySource(sp.parseSource(phi, path.join(ROOT, "examples", "phi_loop.air"), GATED), GATED); } catch (error) { c = { code: error.code, line: error.loc && error.loc.line }; }
    assert.deepEqual(c, { code: "air.control.unstructured_unsupported", line: 5 }, "(c) V53-CFG-N02");
    return { value: { parts: { "(a) V53-WB-P04": wb.canonicalSummary(a.value), "(b) V53-LOOP-P05": loopP05, "(c) V53-CFG-N02": c } } };
  });
  await vector("V53-MEM-N34", async () => {
    const { built } = await accepted(pkgOf("V53-MEM-N34_"));
    const value = {};
    for (const [entrypoint, c] of [["r", -1], ["r", 17], ["ri", 5]]) {
      const host = hostLog({ "fs.read_file": ok(0) });
      const outcome = await invoke(built, host.handlers, entrypoint, { c });
      assert.deepEqual([outcome.result, codeOf(outcome), host.log.length], [null, "air.memory.region_bounds_runtime", 0], `${entrypoint}(${c}): value 34 before the call`);
      value[`${entrypoint}(${c})`] = "air.memory.region_bounds_runtime";
    }
    for (const [entrypoint, c] of [["r", 0], ["r", 16], ["ri", 4]]) {
      let window = null;
      const host = hostLog({ "fs.read_file": (a, b, out, cap) => { window = { cap, length: out.length }; return 0; } });
      const outcome = await invoke(built, host.handlers, entrypoint, { c });
      assert.deepEqual([outcome.result, host.log.length, window], [0, 1, { cap: c, length: c }], `${entrypoint}(${c}): one call, a window of exactly cap bytes`);
      value[`${entrypoint}(${c})`] = { cap: c, result: 0 };
    }
    return { value: { ...value, "E(r)": expectE(built, "r", 6, { "fs.read_file": 1 }, 0, 0, 16), "E(ri)": expectE(built, "ri", 8, { "fs.read_file": 1 }, 0, 0, 16) } };
  });
  let impP01 = null;
  await vector("V53-IMP-P01", async () => {
    const pkg = pkgOf("V53-IMP-P01_i_");
    const { ast, built } = await accepted(pkg);
    const host = hostLog({ "debug.metric": ok(undefined) });
    const outcome = await invoke(built, host.handlers, "run", { x: 0 });
    assert.deepEqual([outcome.result, host.of("debug.metric")], [3, [[1, 0], [1, 1], [1, 2]]], "run(0) = 3");
    const closure = typedClosure.closureOf(ast);
    assert.deepEqual(Object.fromEntries(closure.identities), {
      "main.air": "mid-0f99a42472c6298b8e14346af0a4c90940a2c9af2b1782428d93d32c5f29144f",
      "math.air": "mid-34cd44078a707d7e5e6e8f7e77ede5974df36ed6b8f101645a70b436b724365e"
    }, "(i) identities");
    const addOne = wb.analyzeVerifiedTypedModule(closure.records.get("math.air").ast).entries.get("add_one");
    assert.deepEqual(wb.canonicalSummary(addOne.value), S(3, { "debug.metric": 1 }), "E(add_one) in math.air");
    const rejectedPkg = pkgOf("V53-IMP-P01_ii_");
    const rejected = await staticReject(rejectedPkg, "air.effect.demand_exceeded", 8);
    impP01 = { built, closure, host_calls: host.log.length };
    return { value: { i: { "E(add_one)": wb.canonicalSummary(addOne.value), "E(run)": expectE(built, "run", 13, { "debug.metric": 3 }, 3), host_log: host.log, run0: 3 }, ii: rejected } };
  });
  await vector("V53-WB-H03", () => {
    // X-SND-03 = V53-IMP-P01 (i): the host observes exactly 3 debug.metric calls.
    assert(impP01, "V53-IMP-P01 passed");
    assert.equal(impP01.host_calls, 3);
    return { value: { "E(run)": expectE(impP01.built, "run", 13, { "debug.metric": 3 }, 3), host_calls: 3 } };
  });
  await vector("V53-IMP-ID-01", async () => {
    const pkg = pkgOf("V53-IMP-ID-01_");
    const { ast, built } = await accepted(pkg);
    const outcome = await invoke(built, hostLog({ "debug.metric": ok(undefined) }).handlers, "run", { x: 0 });
    assert.equal(outcome.result, 6, "run(0) = 6");
    const closure = typedClosure.closureOf(ast);
    assert.deepEqual(Object.fromEntries(closure.identities), {
      "main.air": "mid-94fa16c53da62228bcc68cb8a03f029be6fc80472c7ad7a76da171b913187ab0",
      "math.air": "mid-a379f4120216c6867a4b987a685fe32dd9d9e37d272da9ed9b3843c163a939fd"
    }, "identities");
    assert(impP01, "V53-IMP-P01 passed");
    const before = wb.inspectBoundWorkBound(impP01.built).record.key.dependencies;
    const after = wb.inspectBoundWorkBound(built).record.key.dependencies;
    assert.notDeepEqual(after, before, "main's WorkBound key (dependencies) differs");
    assert.notEqual(after[0].summary_digest, before[0].summary_digest, "no summary is reused");
    return { value: { dependencies: after, identities: Object.fromEntries(closure.identities), run0: 6 } };
  });
  await vector("V53-EFF-SEP-02", () => {
    // R-EFF-5: a frozen DecisionEvidence and a frozen EffectReceipt record,
    // each with an extra "effect_demand" field, are refused by the codec.
    const de01 = JSON.parse(freezeLiteral("Example deny vector `DE01`"));
    reference.normalizeFrozenDecisionEvidenceVector(JSON.parse(JSON.stringify(de01)));
    const receipt = frozenReceipt();
    reference.normalizeEffectReceipt(JSON.parse(JSON.stringify(receipt)));
    const value = {};
    for (const [label, normalize, record] of [["DecisionEvidence", reference.normalizeFrozenDecisionEvidenceVector, de01], ["EffectReceipt", reference.normalizeEffectReceipt, receipt]]) {
      let code = null;
      try { normalize({ ...record, effect_demand: { "output.emit": 1 } }); } catch (error) { code = error.code; }
      assert.equal(code, "air.v051.record_invalid", `${label} + effect_demand`);
      value[label] = code;
    }
    return { value };
  });
  await vector("V53-SEP-ED-01", async () => {
    // P10-R18: no grant gives deny/grant_missing for an effectful intent with
    // required capabilities, whatever the artifact's demand; demand is not a
    // parameter of deriveEffectiveAuthority (G-14).
    const built = (await accepted(pkgOf("V53-EFF-P01_one_emit"))).built;
    const intent = JSON.parse(freezeLiteral("Requested `DecisionIntentV1` (1,166 UTF-8 bytes)"));
    const grants = JSON.parse(freezeLiteral("The complete `SuppliedGrantSet` (2,396 UTF-8 bytes)"));
    assert(intent.intent.required_capabilities.length > 0, "required_capabilities is non-empty");
    grants.grants = [];
    const derived = reference.deriveEffectiveAuthority(intent, grants, {});
    assert.deepEqual([derived.outcome, derived.reason], ["deny", "grant_missing"]);
    const signature = /^function deriveEffectiveAuthority\(([^)]*)\)/u.exec(reference.deriveEffectiveAuthority.toString())[1];
    assert.equal(signature, "intentInput, grantsInput, context = {}", "no demand input");
    return { value: { demand_of_artifact: { [EMIT]: "1" }, outcome: derived.outcome, reason: derived.reason, signature, wasm: sha256(built.wasmBytes) } };
  });
  const fstartfx = async () => {
    const pkg = pkgOf("V53-EFF-P01_one_emit");
    const { ast, built } = await accepted(pkg);
    const bytes = await variantBytes(ast, START_LINE, START_LINE.replace("(func $__air_v053_contract_start ", `(func $__air_v053_contract_start i32.const 1 i32.const 0 i32.const 0 i32.const 0 i32.const 0 call $__air_host.${EMIT} drop `));
    return { built, bytes };
  };
  await vector("V53-ABI-59", async () => {
    const { built, bytes } = await fstartfx();
    let called = 0;
    const handlers = { [EMIT]: () => { called += 1; return 0; } };
    const delivered = { contractId: "typed-v0.53.v1", lane: "0.13", ownedRange: { end: 16, start: 16 }, wasmDigest: sha256(bytes) };
    const a = await refusal(() => admitTypedV053Artifact({ handlers, record: delivered, wasmBytes: bytes }), "air.abi.record_untrusted", 1);
    const b = await refusal(() => admitTypedV053Artifact({ handlers, interfaceDescriptor: built.descriptor, pinnedDigest: sha256(built.wasmBytes), wasmBytes: bytes }), "air.borrow.module_identity_mismatch", 1);
    assert.equal(called, 0, "the handler is never called");
    return { value: { a, b, handler_calls: called } };
  });
  await vector("V53-ABI-65", async () => {
    const { built, bytes } = await fstartfx();
    // E-6 (characterization): without arming, the start function would run the import once.
    let raw = 0;
    const module = new WebAssembly.Module(bytes);
    try { new WebAssembly.Instance(module, { "air:contract": { "typed-v0.53.v1": () => 1095324209 }, output: { emit: () => { raw += 1; return 0; } } }); } catch (_) { /* characterization only */ }
    assert.equal(raw, 1, "E-6: an unarmed import runs once");
    let called = 0;
    const record = verifiedBuild.typedV053.mintHarnessRecord({ from: built, wasmBytes: bytes });
    const admission = await admitTypedV053Artifact({ handlers: { [EMIT]: () => { called += 1; return 0; } }, record, wasmBytes: bytes });
    const refused = await refusal(() => admission.instantiate(), "air.host.call_before_admission", 2);
    assert.equal(called, 0, "the disarmed wrapper refuses; the handler function never runs");
    return { value: { ...refused, e6_unarmed_calls: raw, handler_calls: called } };
  });
}

// The v0.51 freeze literals (scripts/run_v051_reference.js reads the same).
function freezeLiteral(marker) {
  const text = fs.readFileSync(path.join(ROOT, "docs", "rfcs", "v0.51-final-architecture-freeze.md"), "utf8");
  const at = text.indexOf(marker);
  assert(at >= 0, `freeze literal ${marker}`);
  const begin = text.indexOf("```json\n", at) + 8;
  return text.slice(begin, text.indexOf("\n```", begin));
}
function frozenReceipt() {
  return {
    receipt_id: `sha256:${"1".repeat(64)}`,
    decision_evidence_digest: `sha256:${"2".repeat(64)}`,
    intent_id: `sha256:${"3".repeat(64)}`,
    generation: { domain: "air.runtime", epoch: { decimal: "7", type: "i64" }, fence_id: `sha256:${"4".repeat(64)}` },
    outcome: { discriminant: 0, type: "air.host::ReceiptOutcome" },
    failure_reason: { tag: "none", type: "option<air.host::FailureReason>" },
    consumed_budgets: [],
    host_execution_id: `sha256:${"5".repeat(64)}`,
    terminal_state: { discriminant: 0, type: "air.host::TerminalState" },
    redacted_observation_refs: []
  };
}

async function sectionDiagnostics() {
  await vector("V53-DIAG-01@P0-10-HOST", () => {
    // Every adapter code (a binding error, never a failure-reason value,
    // D-VAL-09) and the verifier's alias_conflict are exercised here; every
    // code reached is registered.
    const seen = new Set(observed);
    const registered = [...P0_10_ADAPTER_CODES, "air.extern.alias_conflict", "air.effect.demand_exceeded", "air.abi.contract_unsupported", "air.abi.record_untrusted",
      "air.assurance.profile_unsupported", "air.borrow.module_identity_mismatch", "air.loop.count_out_of_range", "air.memory.region_bounds_runtime", "air.v051.record_invalid"];
    for (const code of seen) assert(registered.includes(code), `${code} is registered`);
    for (const code of [...P0_10_ADAPTER_CODES, "air.extern.alias_conflict"]) assert(seen.has(code), `${code} is exercised`);
    return { value: { exercised: [...seen].sort() } };
  });
}

// ---------------------------------------------------------------------------
async function main() {
  await sectionHost();
  await sectionInherited();
  await sectionDiagnostics();
  const outDir = process.env.AIR_P010_VECTOR_RESULTS_DIR;
  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "v053_host_binding.results.json"), `${JSON.stringify(results, null, 2)}\n`);
  }
  const passed = results.filter((item) => item.status === "PASS").length;
  for (const result of results) {
    if (result.status === "FAIL") console.log(`not ok - ${result.vector}`);
    else console.log(`ok - ${result.vector} ${result.status}`);
  }
  if (failures.length) {
    for (const failure of failures) console.error(`not ok - ${failure}`);
    console.error(`typed-v0.53 P0-10 host vectors: ${failures.length} FAIL, ${passed} PASS`);
    process.exit(1);
  }
  console.log(`typed-v0.53 P0-10 host vectors: ${passed} PASS`);
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
