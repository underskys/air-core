#!/usr/bin/env node
"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const {
  VERIFIED_TYPED_RUNTIME_BUILD_KIND,
  VERIFIED_TYPED_RUNTIME_BUILD_SCHEMA,
  VERIFIED_TYPED_RUNTIME_LIMITS,
  VERIFIED_TYPED_RUNTIME_STATUS_SCHEMA,
  createVerifiedTypedRuntime
} = require("../src/v052_verified_build");

const FIXTURES = path.join(__dirname, "..", "fixtures", "v052", "verified_build");
const source = (name) => fs.readFileSync(path.join(FIXTURES, name), "utf8");
const descriptor = (name) => JSON.parse(source(name));
const POLICY = Object.freeze({
  descriptor: descriptor("ops_policy.interface.json"),
  source: source("ops_policy.air"),
  sourceName: "fixtures/v052/verified_build/ops_policy.air"
});
const PANEL = Object.freeze({
  descriptor: descriptor("panel_control.interface.json"),
  source: source("panel_control.air"),
  sourceName: "fixtures/v052/verified_build/panel_control.air"
});

async function rejectsCode(action, code) {
  await assert.rejects(action, (error) => error && error.code === code && /^air\./.test(error.code));
}

function runtimeWithLimit(name, value) {
  return createVerifiedTypedRuntime({ admit: async () => true, limits: { [name]: value } });
}

(async () => {
  assert.deepStrictEqual(VERIFIED_TYPED_RUNTIME_LIMITS, {
    maxAstNodes: 65536,
    maxCacheBytes: 67108864,
    maxCacheEntries: 64,
    maxConcurrentBuilds: 8,
    maxDescriptorBytes: 262144,
    maxInvocationLanes: 64,
    maxSourceBytes: 262144,
    maxSourceNameBytes: 1024,
    maxWasmBytes: 4194304,
    maxWatBytes: 4194304
  });

  let originalAdmissionCalls = 0;
  const mutableOptions = { admit: async () => { originalAdmissionCalls += 1; return true; } };
  const pinnedAdmission = createVerifiedTypedRuntime(mutableOptions);
  mutableOptions.admit = async () => false;
  await pinnedAdmission.build(PANEL);
  assert(originalAdmissionCalls > 0, "runtime must pin its admission hook at construction");

  let admitted = true;
  const admissionCalls = [];
  const runtime = createVerifiedTypedRuntime({
    admit: async (request, context) => {
      admissionCalls.push({ context, request });
      return admitted && context && context.principal === "allowed";
    }
  });
  const allowed = { principal: "allowed", request: 1 };
  const first = await runtime.build(POLICY, allowed);
  assert.strictEqual(first.kind, VERIFIED_TYPED_RUNTIME_BUILD_KIND);
  assert.strictEqual(first.schema, VERIFIED_TYPED_RUNTIME_BUILD_SCHEMA);
  assert.strictEqual("wasmBytes" in first, false);
  assert.strictEqual("descriptor" in first, false);
  assert.strictEqual("cacheKey" in first, false);

  const renamed = await runtime.build({ ...POLICY, sourceName: "another/display-name.air" }, {
    principal: "allowed", request: 2
  });
  assert.strictEqual(renamed.artifactDigest, first.artifactDigest);
  assert.strictEqual(runtime.inspect().counters.compilations, 1, "sourceName must not enter cache identity");
  assert.strictEqual(runtime.inspect().counters.cacheHits, 1);
  assert.strictEqual(
    admissionCalls.find((item) => item.context.request === 2 && item.request.phase === "build").request.artifactDigest,
    first.artifactDigest,
    "cache-hit admission must receive the cached artifact identity"
  );

  const preciseI64 = { decimal: "9007199254740993", type: "i64" };
  assert.deepStrictEqual(
    (await runtime.invoke(first, "roundtrip_sequence", [preciseI64], allowed)).value,
    preciseI64
  );
  assert.deepStrictEqual(
    (await runtime.invoke(first, "roundtrip_sequence", [preciseI64], allowed)).value,
    preciseI64
  );
  assert.strictEqual(runtime.inspect().counters.instantiations, 2, "each invocation must create a fresh instance");

  const descriptorAlias = {
    ...POLICY.descriptor,
    exports: POLICY.descriptor.exports.map((entry) => (
      entry.name === "roundtrip_sequence" ? { ...entry, name: "sequence_alias" } : entry
    ))
  };
  const alias = await runtime.build({ ...POLICY, descriptor: descriptorAlias }, allowed);
  assert.notStrictEqual(alias.descriptorDigest, first.descriptorDigest);
  assert.deepStrictEqual((await runtime.invoke(alias, "sequence_alias", [preciseI64], allowed)).value, preciseI64);
  const changedSource = await runtime.build({ ...POLICY, source: `${POLICY.source}\n` }, allowed);
  assert.notStrictEqual(changedSource.sourceDigest, first.sourceDigest);
  assert.strictEqual(runtime.inspect().counters.compilations, 3, "source and descriptor identity changes must compile");

  admitted = false;
  await rejectsCode(() => runtime.build(POLICY, allowed), "air.v052.runtime_admission_denied");
  await rejectsCode(
    () => runtime.invoke(first, "roundtrip_sequence", [preciseI64], allowed),
    "air.v052.runtime_admission_denied"
  );
  admitted = true;
  const afterRevocation = await runtime.build(POLICY, { principal: "allowed", request: 3 });
  assert.strictEqual(afterRevocation.artifactDigest, first.artifactDigest);
  assert.strictEqual(runtime.inspect().counters.compilations, 3, "admission state must not enter or poison cache identity");
  assert(admissionCalls.some((item) => item.context.request === 1));
  assert(admissionCalls.some((item) => item.context.request === 2));
  assert(admissionCalls.some((item) => item.context.request === 3));
  for (const { request } of admissionCalls) {
    assert.strictEqual("source" in request, false);
    assert.strictEqual("sourceName" in request, false);
    assert.strictEqual("admission" in request, false);
  }

  const copiedHandle = { ...first };
  await rejectsCode(
    () => runtime.invoke(copiedHandle, "roundtrip_sequence", [preciseI64], allowed),
    "air.v052.runtime_handle_untrusted"
  );
  await rejectsCode(
    () => runtime.build({ ...POLICY, wasmDigest: first.wasmDigest }, allowed),
    "air.v052.runtime_input_invalid"
  );
  await rejectsCode(
    () => runtime.build({ ...POLICY, buildOptions: { optimize: true } }, allowed),
    "air.v052.runtime_input_invalid"
  );

  const singleFlight = createVerifiedTypedRuntime({ admit: async () => true });
  const simultaneous = await Promise.all([
    singleFlight.build(POLICY, { principal: "one" }),
    singleFlight.build(POLICY, { principal: "two" }),
    singleFlight.build(POLICY, { principal: "three" })
  ]);
  assert(simultaneous.every((item) => item.artifactDigest === simultaneous[0].artifactDigest));
  assert.strictEqual(singleFlight.inspect().counters.compilations, 1);
  assert.strictEqual(singleFlight.inspect().counters.singleFlightJoins, 2);

  const lru = createVerifiedTypedRuntime({ admit: async () => true, limits: { maxCacheEntries: 2 } });
  const lruPolicy = await lru.build(POLICY);
  const lruPanel = await lru.build(PANEL);
  await lru.build(POLICY);
  const lruThird = await lru.build({ ...POLICY, source: `${POLICY.source}\n` });
  assert.strictEqual(lru.inspect().cache.entries, 2);
  assert.strictEqual(lru.inspect().counters.evictions, 1);
  await rejectsCode(
    () => lru.invoke(lruPanel, "show_badge", [], null),
    "air.v052.runtime_handle_stale"
  );
  assert.deepStrictEqual((await lru.invoke(lruPolicy, "roundtrip_sequence", [preciseI64])).value, preciseI64);
  lru.invalidate(lruThird);
  await rejectsCode(
    () => lru.invoke(lruThird, "roundtrip_sequence", [preciseI64]),
    "air.v052.runtime_handle_stale"
  );

  await rejectsCode(() => runtimeWithLimit("maxSourceBytes", 1).build(POLICY), "air.v052.work_limit_source_bytes");
  await rejectsCode(() => runtimeWithLimit("maxSourceNameBytes", 1).build(POLICY), "air.v052.work_limit_source_name_bytes");
  await rejectsCode(() => runtimeWithLimit("maxDescriptorBytes", 1).build(POLICY), "air.v052.work_limit_descriptor_bytes");
  await rejectsCode(() => createVerifiedTypedRuntime({ admit: async () => true }).build({
    ...POLICY,
    descriptor: { ...POLICY.descriptor, module_id: `a${"x".repeat(262144)}` }
  }), "air.v052.work_limit_descriptor_bytes");
  const cyclicDescriptor = { ...POLICY.descriptor };
  cyclicDescriptor.cycle = cyclicDescriptor;
  await rejectsCode(
    () => createVerifiedTypedRuntime({ admit: async () => true }).build({ ...POLICY, descriptor: cyclicDescriptor }),
    "air.v052.runtime_input_invalid"
  );
  await rejectsCode(() => runtimeWithLimit("maxAstNodes", 1).build(POLICY), "air.v052.work_limit_ast_nodes");
  await rejectsCode(() => runtimeWithLimit("maxWatBytes", 1).build(POLICY), "air.v052.work_limit_wat_bytes");
  await rejectsCode(() => runtimeWithLimit("maxWasmBytes", 1).build(POLICY), "air.v052.work_limit_wasm_bytes");
  await rejectsCode(() => runtimeWithLimit("maxCacheBytes", 1).build(POLICY), "air.v052.work_limit_cache_bytes");
  const oneLane = runtimeWithLimit("maxInvocationLanes", 1);
  const oneLaneBuild = await oneLane.build(POLICY);
  await rejectsCode(
    () => oneLane.invoke(oneLaneBuild, "roundtrip_sequence", [preciseI64]),
    "air.v052.work_limit_invocation_lanes"
  );
  const oneBuild = runtimeWithLimit("maxConcurrentBuilds", 1);
  const concurrent = await Promise.allSettled([
    oneBuild.build(POLICY),
    oneBuild.build(PANEL)
  ]);
  assert.strictEqual(concurrent.filter((item) => item.status === "rejected" &&
    item.reason.code === "air.v052.work_limit_concurrent_builds").length, 1);

  const status = runtime.inspect();
  assert.strictEqual(status.schema, VERIFIED_TYPED_RUNTIME_STATUS_SCHEMA);
  assert.strictEqual(JSON.stringify(status).includes("ops_policy.air"), false);
  assert.strictEqual(JSON.stringify(status).includes("principal"), false);
  assert.strictEqual(JSON.stringify(status).includes("cacheKey"), false);
  assert(Object.isFrozen(status));

  process.stdout.write("v0.52 verified generic runtime, work bounds, and cache: passed\n");
})().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
