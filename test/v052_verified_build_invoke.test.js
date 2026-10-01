#!/usr/bin/env node
"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const {
  CHECKED_TYPED_INVOCATION_KIND,
  VERIFIED_TYPED_BUILD_KIND,
  VERIFIED_TYPED_BUILD_SCHEMA,
  V052VerifiedBuildError,
  buildVerifiedTypedModule,
  inspectVerifiedTypedBuild,
  invokeVerifiedTypedExport
} = require("../src/v052_verified_build");

const FIXTURES = path.join(__dirname, "..", "fixtures", "v052", "verified_build");

function fixture(name) {
  return fs.readFileSync(path.join(FIXTURES, name), "utf8");
}

function descriptor(name) {
  return JSON.parse(fixture(name));
}

async function rejectsCode(action, code) {
  await assert.rejects(action, (error) => error && error.code === code && /^air\./.test(error.code));
}

(async () => {
  const policy = await buildVerifiedTypedModule({
    source: fixture("ops_policy.air"),
    sourceName: "fixtures/v052/verified_build/ops_policy.air",
    descriptor: descriptor("ops_policy.interface.json")
  });
  const panel = await buildVerifiedTypedModule({
    source: fixture("panel_control.air"),
    sourceName: "fixtures/v052/verified_build/panel_control.air",
    descriptor: descriptor("panel_control.interface.json")
  });

  assert.strictEqual(policy.kind, VERIFIED_TYPED_BUILD_KIND);
  assert.strictEqual(policy.schema, VERIFIED_TYPED_BUILD_SCHEMA);
  assert.strictEqual(policy.sourceProfile, "typed-v0.51");
  assert.match(policy.sourceDigest, /^sha256:[a-f0-9]{64}$/);
  assert.match(policy.descriptorDigest, /^sha256:[a-f0-9]{64}$/);
  assert.match(policy.wasmDigest, /^sha256:[a-f0-9]{64}$/);
  assert.match(policy.artifactDigest, /^sha256:[a-f0-9]{64}$/);
  assert.strictEqual("verified" in policy, false, "a boolean field is not authority");
  assert.strictEqual(policy.lowering.name, "air.lower_wasm.v051-typed");
  assert(Object.isFrozen(policy.descriptor), "the verified descriptor is immutable after assembly");

  const preciseI64 = { decimal: "9007199254740993", type: "i64" };
  const roundtrip = await invokeVerifiedTypedExport(policy, "roundtrip_sequence", [preciseI64]);
  assert.deepStrictEqual(roundtrip, {
    kind: CHECKED_TYPED_INVOCATION_KIND,
    value: preciseI64
  });

  const decision = await invokeVerifiedTypedExport(policy, "decide", [
    preciseI64,
    { discriminant: 1, type: "ops.policy::Action" }
  ]);
  assert.deepStrictEqual(decision, {
    kind: CHECKED_TYPED_INVOCATION_KIND,
    value: {
      tag: "ok",
      type: "result<ops.policy::Admission,ops.policy::PolicyError>",
      value: { discriminant: 1, type: "ops.policy::Admission" }
    }
  });
  // PolicyError has no zero-valued case. The zero error lane carried by a
  // result.ok is inactive ABI padding, not a value to validate as PolicyError.
  assert.strictEqual(policy.descriptor.types.find((item) => item.type_id === "ops.policy::PolicyError").cases[0].discriminant, 7);

  const visibleBadge = await invokeVerifiedTypedExport(panel, "show_badge", [
    { tag: "some", type: "option<bool>", value: true },
    { discriminant: 1, type: "panel.control::Badge" }
  ]);
  assert.deepStrictEqual(visibleBadge.value, {
    tag: "some",
    type: "option<panel.control::Badge>",
    value: { discriminant: 1, type: "panel.control::Badge" }
  });
  const hiddenBadge = await invokeVerifiedTypedExport(panel, "show_badge", [
    { tag: "none", type: "option<bool>" },
    { discriminant: 1, type: "panel.control::Badge" }
  ]);
  assert.deepStrictEqual(hiddenBadge.value, { tag: "none", type: "option<panel.control::Badge>" });

  await rejectsCode(
    () => invokeVerifiedTypedExport(policy, "roundtrip_sequence", [9007199254740993]),
    "air.v051.typed_value_invalid"
  );
  await rejectsCode(
    () => invokeVerifiedTypedExport(policy, "roundtrip_sequence", [{ decimal: "9223372036854775808", type: "i64" }]),
    "air.v051.typed_value_invalid"
  );
  await rejectsCode(
    () => invokeVerifiedTypedExport(policy, "decide", [preciseI64, { discriminant: 7, type: "ops.policy::Action" }]),
    "air.decision.enum_discriminant_invalid"
  );
  await rejectsCode(
    () => invokeVerifiedTypedExport(panel, "show_badge", [
      { tag: "invalid", type: "option<bool>", value: true },
      { discriminant: 1, type: "panel.control::Badge" }
    ]),
    "air.v051.typed_value_invalid"
  );
  await rejectsCode(
    () => invokeVerifiedTypedExport(policy, "missing", []),
    "air.v052.invocation_export_unknown"
  );

  const substitutedDescriptor = { ...policy, descriptor: panel.descriptor };
  await rejectsCode(
    () => invokeVerifiedTypedExport(substitutedDescriptor, "roundtrip_sequence", [preciseI64]),
    "air.v052.verified_build_untrusted"
  );
  const substitutedWasm = { ...policy, wasmBytes: Buffer.from(panel.wasmBytes) };
  await rejectsCode(
    () => invokeVerifiedTypedExport(substitutedWasm, "roundtrip_sequence", [preciseI64]),
    "air.v052.verified_build_untrusted"
  );
  const mutableWasm = await buildVerifiedTypedModule({
    source: fixture("ops_policy.air"),
    sourceName: "fixtures/v052/verified_build/ops_policy.air",
    descriptor: descriptor("ops_policy.interface.json")
  });
  mutableWasm.wasmBytes[0] ^= 0xff;
  await rejectsCode(
    () => invokeVerifiedTypedExport(mutableWasm, "roundtrip_sequence", [preciseI64]),
    "air.v052.verified_build_wasm_mismatch"
  );

  const inspected = inspectVerifiedTypedBuild(policy);
  assert.strictEqual(inspected.artifactDigest, policy.artifactDigest);
  assert.notStrictEqual(inspected.wasmBytes, policy.wasmBytes);
  await rejectsCode(
    () => invokeVerifiedTypedExport(inspected, "roundtrip_sequence", [preciseI64]),
    "air.v052.verified_build_untrusted"
  );
  await rejectsCode(
    () => buildVerifiedTypedModule({
      source: fixture("ops_policy.air"),
      sourceName: "fixtures/v052/verified_build/ops_policy.air",
      descriptor: {
        ...descriptor("ops_policy.interface.json"),
        exports: descriptor("ops_policy.interface.json").exports.map((item, index) => (
          index === 0 ? { ...item, function: "not_decide" } : item
        ))
      }
    }),
    "air.v051.typed_interface_source_invalid"
  );
  assert.strictEqual(policy instanceof V052VerifiedBuildError, false);

  assert.strictEqual(policy.schema, "air.v052.verifiedTypedBuild/2");
  assert.match(policy.compiler.implementationDigest, /^sha256:[a-f0-9]{64}$/);
  const renamed = await buildVerifiedTypedModule({
    source: fixture("ops_policy.air"), sourceName: "other/display-name.air",
    descriptor: descriptor("ops_policy.interface.json")
  });
  assert.strictEqual(renamed.artifactDigest, policy.artifactDigest,
    "sourceName is display metadata, not semantic identity");
  assert.strictEqual(renamed.compiler.implementationDigest, policy.compiler.implementationDigest);

  const numericSource = fs.readFileSync(path.join(__dirname, "..", "fixtures", "v051", "checked_numeric", "checked_numeric.air"), "utf8");
  const numeric = await buildVerifiedTypedModule({
    source: numericSource,
    descriptor: {
      air_abi_lane: "0.12", module_id: "example.checked_numeric",
      schema: "air.typed-interface/0.12-candidate.1", types: [],
      exports: [
        ...["checked_add", "checked_div"].map((name) => ({
          name, function: name, parameters: [{name: "left", type: "i64"}, {name: "right", type: "i64"}], return_type: "i64"
        })),
        {name: "narrow_i64", function: "narrow_i64", parameters: [{name: "value", type: "i64"}], return_type: "i32"}
      ]
    }
  });
  const i64 = (decimal) => ({type: "i64", decimal});
  for (const [name, args, reason] of [
    ["checked_add", [i64("9223372036854775807"), i64("1")], "overflow"],
    ["checked_div", [i64("1"), i64("0")], "division_by_zero"],
    ["checked_div", [i64("-9223372036854775808"), i64("-1")], "overflow"],
    ["narrow_i64", [i64("2147483648")], "invalid_conversion"]
  ]) {
    await assert.rejects(() => invokeVerifiedTypedExport(numeric, name, args), (error) =>
      error.code === "air.numeric.checked_failure" && error.reason === reason &&
      error.message === `air.numeric.checked_failure: ${reason}`);
  }
  assert.deepStrictEqual((await invokeVerifiedTypedExport(numeric, "checked_add", [i64("9223372036854775807"), i64("0")])).value,
    i64("9223372036854775807"), "a previous trap must not contaminate a new invocation");
  await rejectsCode(() => buildVerifiedTypedModule({source: "module bad\nexport func f() -> i64 {\n nonsense\n}\n", descriptor: {}}),
    "air.v051.typed_syntax_invalid");


  process.stdout.write("v0.52 verified typed build and checked invocation: passed\n");
})().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
