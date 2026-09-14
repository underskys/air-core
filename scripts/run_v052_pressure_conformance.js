#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { lowerToWat, watToWasm } = require("../src/lower_wasm");
const { parseAir } = require("../src/parser");
const { rawDigest, typedValue } = require("../src/v051_reference");
const { createVerifiedTypedRuntime } = require("../src/v052_verified_build");
const { createVerifiedResourceCertificate, verifyModule } = require("../src/verifier");
const { run: runG2 } = require("./research/v052/run_deterministic_numerics_experiment");

const ROOT = path.resolve(__dirname, "..");
const MANIFEST_PATH = path.join(ROOT, "fixtures/v052/pressure/s4-vector-manifest.json");
const MANIFEST_SHA256 = "142db623a71b301a9c281cb4813d711488e76ac47bffe7efa1eb125f046a44b1";

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function readBrokerBoundary() {
  const candidates = [
    "docs/v0.52/V052_HANDOFF_REQUIREMENT_MATRIX.md",
    "docs/RELEASE_NOTES_0_52_0.md"
  ];
  const relativePath = candidates.find((candidate) => fs.existsSync(path.join(ROOT, candidate)));
  if (!relativePath) {
    throw new Error("air.v052.s4_authority_boundary_missing: no broker-generation authority source is present");
  }
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function loadManifest() {
  const bytes = fs.readFileSync(MANIFEST_PATH);
  if (sha256(bytes) !== MANIFEST_SHA256) {
    throw new Error("air.v052.s4_manifest_identity_mismatch: S4 expected-value manifest changed");
  }
  const manifest = JSON.parse(bytes);
  if (manifest.status !== "FROZEN_EXPECTATIONS_BEFORE_RUNNER") {
    throw new Error("air.v052.s4_manifest_invalid: expected-value manifest is not frozen");
  }
  const ids = manifest.vectors.map((item) => item.VECTOR_ID);
  if (ids.length !== 24 || new Set(ids).size !== ids.length) {
    throw new Error("air.v052.s4_manifest_invalid: vector set must contain 24 unique IDs");
  }
  for (const vector of manifest.vectors) {
    if (vector.match === "literal") {
      if (Object.hasOwn(vector, "accepted_actual")) {
        throw new Error(`air.v052.s4_manifest_invalid: literal vector ${vector.VECTOR_ID} has accepted_actual`);
      }
      continue;
    }
    if (vector.match === "one_of") {
      if (!Array.isArray(vector.accepted_actual) || vector.accepted_actual.length === 0 ||
          new Set(vector.accepted_actual).size !== vector.accepted_actual.length ||
          vector.accepted_actual.some((item) => typeof item !== "string" || item.length === 0)) {
        throw new Error(`air.v052.s4_manifest_invalid: one_of vector ${vector.VECTOR_ID} has invalid accepted_actual`);
      }
      continue;
    }
    throw new Error(`air.v052.s4_manifest_invalid: unsupported match rule for ${vector.VECTOR_ID}`);
  }
  const stateComparison = manifest.vectors.find((item) => item.VECTOR_ID === "S4-STATE-05").comparison;
  if (!stateComparison || stateComparison.left !== "primary_replay.state" ||
      stateComparison.right !== "repeated_replay.state" ||
      stateComparison.runtime_construction !== "distinct_createVerifiedTypedRuntime") {
    throw new Error("air.v052.s4_manifest_invalid: STATE-05 comparison is not frozen to distinct runtime replays");
  }
  for (const anchor of [
    manifest.source_anchors.g2_manifest,
    manifest.source_anchors.existing_typed_source,
    manifest.source_anchors.s4_typed_descriptor
  ]) {
    if (sha256(fs.readFileSync(path.join(ROOT, anchor.path))) !== anchor.sha256) {
      throw new Error(`air.v052.s4_source_identity_mismatch: ${anchor.path}`);
    }
  }
  const copiedResearch = manifest.source_anchors.research_inputs.find((item) =>
    item.path === "fixtures/v052/dss01_draft_vectors.json");
  if (sha256(fs.readFileSync(path.join(ROOT, "fixtures/v052/pressure/dss01_draft_vectors.research.json"))) !== copiedResearch.sha256) {
    throw new Error("air.v052.s4_source_identity_mismatch: DSS research input changed");
  }
  return manifest;
}

function createRecorder(manifest) {
  const expected = new Map(manifest.vectors.map((item) => [item.VECTOR_ID, item]));
  const records = [];
  function record(id, actual, classification = "PASS", evidence = "") {
    const vector = expected.get(id);
    if (!vector) throw new Error(`air.v052.s4_vector_undeclared: ${id}`);
    const matches = vector.match === "literal"
      ? actual === vector.EXPECTED
      : vector.accepted_actual.includes(actual);
    records.push({
      VECTOR_ID: id,
      FAMILY: vector.family,
      EXPECTED: vector.EXPECTED,
      ACTUAL: actual,
      MATCH: vector.match,
      PASS: matches ? classification : "FAIL",
      EVIDENCE: evidence
    });
  }
  function finish() {
    const actualIds = records.map((item) => item.VECTOR_ID);
    if (actualIds.length !== expected.size || new Set(actualIds).size !== actualIds.length) {
      throw new Error("air.v052.s4_vector_accounting_invalid: missing or duplicate executed vector");
    }
    for (const id of expected.keys()) {
      if (!actualIds.includes(id)) throw new Error(`air.v052.s4_vector_missing: ${id}`);
    }
    return records;
  }
  return { record, finish };
}

function i64(decimal) {
  return typedValue({ decimal: String(decimal), type: "i64" }, "S4 i64 state");
}

function diagnosticValue(error) {
  if (!error || typeof error.code !== "string" || !error.code.startsWith("air.")) {
    return "raw_host_exception";
  }
  return error.reason ? `${error.code}:${error.reason}` : error.code;
}

async function captureFailure(action, counters) {
  try {
    await action();
    return "accepted";
  } catch (error) {
    const actual = diagnosticValue(error);
    if (actual === "raw_host_exception") counters.unexpectedHostExceptions += 1;
    return actual;
  }
}

async function replay(runtime, handle, events, context) {
  let state = i64("0");
  const checkpoints = [rawDigest(state)];
  const values = [state.decimal];
  for (const event of events) {
    const result = await runtime.invoke(handle, event.operation, [state, i64(event.operand)], context);
    state = typedValue(result.value, `state at tick ${event.tick}`);
    values.push(state.decimal);
    checkpoints.push(rawDigest(state));
  }
  return { checkpoints, state, values };
}

async function literalLoopResult() {
  const sourcePath = path.join(ROOT, "examples/bounded_loop.air");
  const source = fs.readFileSync(sourcePath, "utf8");
  const mod = parseAir(source, sourcePath);
  verifyModule(mod);
  const wasm = await watToWasm(lowerToWat(mod), sourcePath);
  const loaded = await WebAssembly.instantiate(wasm, {});
  return String((loaded.instance || loaded).exports.run());
}

function dynamicLoopFacts() {
  const sourcePath = path.join(ROOT, "examples/dynamic_collections.air");
  const source = fs.readFileSync(sourcePath, "utf8");
  const certificate = createVerifiedResourceCertificate(parseAir(source, sourcePath), {
    mode: "required",
    moduleDigest: `sha256:${sha256(Buffer.from(source, "utf8"))}`,
    modulePath: "dynamic_collections.air",
    packageName: "dynamic-collections"
  });
  const loops = certificate.bounds.loops;
  return [
    `maximumDynamicLoopFuel=${loops.maximumDynamicLoopFuel}`,
    `maximumStaticallyBoundedIterations=${loops.maximumStaticallyBoundedIterations}`,
    `totalDynamicLoopFuelUpperBound=${loops.totalDynamicLoopFuelUpperBound}`,
    `totalStaticallyBoundedIterations=${loops.totalStaticallyBoundedIterations}`
  ].join(";");
}

async function run() {
  const manifest = loadManifest();
  const recorder = createRecorder(manifest);
  const counters = { unexpectedHostExceptions: 0 };
  const source = fs.readFileSync(path.join(ROOT, manifest.source_anchors.existing_typed_source.path), "utf8");
  const descriptor = readJson(manifest.source_anchors.s4_typed_descriptor.path);
  const buildInput = Object.freeze({
    descriptor,
    source,
    sourceName: manifest.source_anchors.existing_typed_source.path
  });

  const g2 = await runG2();
  const g2Failures = g2.source_execution.records.filter((item) => item.PASS === "FAIL").length +
    g2.swift_native_parity.filter((item) => item.PASS === "FAIL").length;
  recorder.record(
    "S4-G2-01",
    g2.vectors_executed === 38 && g2Failures === 0 ? "38/38_PASS" : `${g2.vectors_executed}/38_FAIL`,
    "PASS",
    g2.manifest_sha256
  );
  recorder.record(
    "S4-G2-02",
    g2.swift_wasm_result,
    "HOLD",
    `cross-host Swift/Wasm remains unproved; environment-specific G2 reason=${g2.swift_wasm_result}`
  );

  const authorityToken = Object.freeze({});
  let activeGeneration = 1;
  const admit = async (_request, context) => Boolean(
    context && context.authorityToken === authorityToken && context.generation === activeGeneration
  );
  const runtime = createVerifiedTypedRuntime({ admit });
  const authorized = { authorityToken, generation: 1, principal: "s4-fixture" };
  const handle = await runtime.build(buildInput, authorized);

  const primary = await replay(runtime, handle, manifest.replay_fixture.primary_events, authorized);
  const repeatedRuntime = createVerifiedTypedRuntime({ admit });
  const repeatedHandle = await repeatedRuntime.build(buildInput, authorized);
  const repeated = await replay(repeatedRuntime, repeatedHandle, manifest.replay_fixture.primary_events, authorized);
  const divergent = await replay(runtime, handle, manifest.replay_fixture.divergent_events, authorized);
  recorder.record("S4-STATE-01", rawDigest(i64(manifest.replay_fixture.initial_state)), "PASS", "frozen v0.51 typed-value codec");
  recorder.record("S4-STATE-02", primary.checkpoints.join("|"), "PASS", "typed source -> verified runtime -> Wasm -> typed-value digest");
  recorder.record("S4-STATE-03", primary.state.decimal, "PASS", "four ordered checked-i64 transitions");
  recorder.record("S4-STATE-04", String(primary.checkpoints.findIndex((value, index) => value !== divergent.checkpoints[index])), "PASS", "first differing typed-value checkpoint");
  const provenanceRecords = [
    { runtimeIdentity: "primary-runtime", stateDigest: rawDigest(primary.state) },
    { runtimeIdentity: "repeated-runtime", stateDigest: rawDigest(repeated.state) }
  ];
  recorder.record(
    "S4-STATE-05",
    provenanceRecords[0].stateDigest === provenanceRecords[1].stateDigest ? "IDENTICAL" : "DIFFERENT",
    "PASS",
    provenanceRecords.map((item) => `${item.runtimeIdentity}=${item.stateDigest}`).join(";")
  );
  recorder.record(
    "S4-STATE-06",
    await captureFailure(() => runtime.invoke(handle, "i64_checked_add", [i64("9223372036854775807"), i64("1")], authorized), counters),
    "FAIL_CLOSED_PASS",
    "checked i64 overflow through verified runtime and Wasm"
  );

  recorder.record("S4-WORK-01", await literalLoopResult(), "PASS", "existing literal bounded-loop verifier and Wasm path");
  recorder.record("S4-WORK-02", dynamicLoopFacts(), "PASS", "existing verified resource certificate facts");
  const sourceLimitedRuntime = createVerifiedTypedRuntime({ admit: async () => true, limits: { maxSourceBytes: 1 } });
  recorder.record(
    "S4-WORK-03",
    await captureFailure(() => sourceLimitedRuntime.build(buildInput), counters),
    "FAIL_CLOSED_PASS",
    "S3 pre-admission source work bound"
  );
  recorder.record(
    "S4-WORK-04",
    (await runtime.invoke(handle, "i64_checked_mul", [i64("4096"), i64("4096")], authorized)).value.decimal,
    "PASS",
    "checked composition through existing i64 operation"
  );
  recorder.record(
    "S4-WORK-05",
    await captureFailure(() => runtime.invoke(handle, "i64_checked_mul", [i64("9223372036854775807"), i64("2")], authorized), counters),
    "FAIL_CLOSED_PASS",
    "checked composition overflow through verified runtime and Wasm"
  );
  recorder.record(
    "S4-WORK-06",
    await captureFailure(() => runtime.build(buildInput, { workBound: { finite: true, maximum: "4096" } }), counters),
    "FAIL_CLOSED_PASS",
    "runtime does not interpret WorkBound-shaped context as authority; admission requires host token identity and generation"
  );

  recorder.record(
    "S4-NA-01",
    await captureFailure(() => runtime.build(buildInput, { message: { operation: "allow" } }), counters),
    "FAIL_CLOSED_PASS",
    "runtime does not interpret message context as authority; admission requires host token identity and generation"
  );
  recorder.record(
    "S4-NA-02",
    await captureFailure(() => runtime.invoke(handle, "i64_checked_add", [i64("1"), i64("2")], { transcript: { result: "approved" } }), counters),
    "FAIL_CLOSED_PASS",
    "runtime does not interpret transcript context as authority; admission requires host token identity and generation"
  );
  recorder.record(
    "S4-NA-03",
    await captureFailure(() => runtime.invoke({ ...handle }, "i64_checked_add", [i64("1"), i64("2")], authorized), counters),
    "FAIL_CLOSED_PASS",
    "copied public evidence is not the closure-held runtime handle"
  );
  activeGeneration = 2;
  recorder.record(
    "S4-NA-04",
    await captureFailure(() => runtime.invoke(handle, "i64_checked_add", [i64("1"), i64("2")], authorized), counters),
    "FAIL_CLOSED_PASS",
    "stale generation is rechecked on cache-hit invocation"
  );
  activeGeneration = 1;
  recorder.record(
    "S4-NA-05",
    await captureFailure(() => runtime.build(buildInput, { stateDigest: primary.checkpoints.at(-1) }), counters),
    "FAIL_CLOSED_PASS",
    "runtime does not interpret digest context as authority; admission requires host token identity and generation"
  );
  runtime.invalidate(handle);
  recorder.record(
    "S4-NA-06",
    await captureFailure(() => runtime.invoke(handle, "i64_checked_add", [i64("1"), i64("2")], authorized), counters),
    "FAIL_CLOSED_PASS",
    "invalidated runtime handle cannot be revived by valid context"
  );

  const dss = readJson("fixtures/v052/pressure/dss01_draft_vectors.research.json");
  const dssUnfrozen = dss.status === "NON_AUTHORITATIVE_CANDIDATE_NOT_CONFORMANCE" &&
    dss.authority.golden_hashes_frozen === false && dss.vectors.every((item) => item.golden_state_digest === null);
  recorder.record(
    "S4-NYP-01",
    dssUnfrozen ? "NOT_YET_PROVEN:DSS_PROFILE_NOT_FROZEN" : "DSS_INPUT_UNEXPECTEDLY_CHANGED",
    "NOT_YET_PROVEN",
    "research fixture has no frozen state bytes or golden state digest"
  );
  const authorityBoundary = readBrokerBoundary();
  const brokerNotPreauthorized = authorityBoundary.includes("BROKER_GENERATION_HOST_CONTRACT_CHANGE_PREAUTHORIZED=false") &&
    authorityBoundary.includes("only currently identified METR-derived");
  recorder.record(
    "S4-NYP-02",
    brokerNotPreauthorized ? "NOT_YET_PROVEN:BROKER_GENERATION_TRANSPORT_NOT_RUNNABLE" : "BROKER_BOUNDARY_UNEXPECTEDLY_CHANGED",
    "NOT_YET_PROVEN",
    "no Host Contract or EffectReceipt change is authorized in S4"
  );
  recorder.record(
    "S4-NYP-03",
    "NOT_YET_PROVEN:CONSUMER_TRANSPORT_FIXTURE_EXTERNAL",
    "NOT_YET_PROVEN",
    "consumer transport and product fixtures are outside this Core source task"
  );
  recorder.record(
    "S4-NYP-04",
    typeof g2.swift_wasm_result === "string" && g2.swift_wasm_result.startsWith("HOLD_CROSS_HOST_SWIFT_")
      ? `NOT_YET_PROVEN:${g2.swift_wasm_result}`
      : `UNEXPECTED:${g2.swift_wasm_result}`,
    "NOT_YET_PROVEN",
    `Swift/Wasm cross-host parity remains unproved; environment-specific G2 reason=${g2.swift_wasm_result}`
  );

  const records = recorder.finish();
  const summary = records.reduce((result, item) => {
    result.vector_count += 1;
    if (item.PASS === "PASS") result.pass_count += 1;
    else if (item.PASS === "FAIL_CLOSED_PASS") result.fail_closed_pass_count += 1;
    else if (item.PASS === "HOLD") result.hold_count += 1;
    else if (item.PASS === "NOT_YET_PROVEN") result.not_yet_proven_count += 1;
    else result.fail_count += 1;
    return result;
  }, { vector_count: 0, pass_count: 0, fail_closed_pass_count: 0, hold_count: 0, not_yet_proven_count: 0, fail_count: 0 });
  summary.unexpected_host_exception_count = counters.unexpectedHostExceptions;

  return {
    schema: "air.v052.s4.pressure-conformance-result/1",
    task_id: manifest.task_id,
    manifest_sha256: `sha256:${MANIFEST_SHA256}`,
    source_anchors: manifest.source_anchors,
    boundaries: manifest.fixture_boundaries,
    summary,
    records
  };
}

if (require.main === module) {
  run().then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.summary.fail_count !== 0 || result.summary.unexpected_host_exception_count !== 0) process.exitCode = 1;
  }).catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
  });
}

module.exports = { MANIFEST_SHA256, run };
