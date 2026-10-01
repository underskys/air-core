#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { parseTypeReference } = require("../src/typed_interface");
const { buildVerifiedTypedModule } = require("../src/v052_verified_build");

(async () => {
  for (const type of ["i32", "i64", "bool", "f32", "f64", "ops.policy::Action", "option<i64>", "result<i64,ops.policy::PolicyError>"]) {
    assert.equal(parseTypeReference(type).canonical, type);
  }
  assert.equal(parseTypeReference("void", {allowVoid:true}).kind, "void");
  for (const depth of [2, 64, 65, 8000, 16000]) {
    const type = "option<".repeat(depth) + "i64" + ">".repeat(depth);
    assert.throws(() => parseTypeReference(type), e =>
      e.code === "air.decision.payload_type_unsupported" && !(e instanceof RangeError));
  }
  for (const type of ["", " i64", "option<missing>", "result<i64>"]) {
    assert.throws(() => parseTypeReference(type), e => e.code === "air.v051.type_reference_invalid");
  }
  const dir = path.join(__dirname, "../fixtures/v052/verified_build");
  const source = fs.readFileSync(path.join(dir, "ops_policy.air"), "utf8");
  const descriptor = JSON.parse(fs.readFileSync(path.join(dir, "ops_policy.interface.json"), "utf8"));
  descriptor.exports[0].parameters[0].type = "option<".repeat(8000) + "i64" + ">".repeat(8000);
  assert(Buffer.byteLength(JSON.stringify(descriptor)) < 256 * 1024);
  await assert.rejects(() => buildVerifiedTypedModule({source, descriptor}), e =>
    e.code === "air.decision.payload_type_unsupported" && !(e instanceof RangeError));
  console.log("descriptor depth: admitted forms, shallow errors, 8K/16K invalid nesting and public builder rejection passed (no WABT needed)");
})().catch(e => { console.error(e); process.exitCode=1; });
