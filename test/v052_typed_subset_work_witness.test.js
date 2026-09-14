#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { lowerToWat } = require("../src/lower_wasm");
const {
  SOURCE_PROFILE_TYPED_V051,
  parseSource
} = require("../src/source_profile");
const {
  VERIFIED_TYPED_RUNTIME_LIMITS,
  createVerifiedTypedRuntime
} = require("../src/v052_verified_build");

const ROOT = path.resolve(__dirname, "..");
const PREEMISSION_FIXED_BYTES = 64 * 1024;
const MAX_WAT_BYTES_PER_SOURCE_BYTE = 64;
const MAX_WAT_BYTES_PER_AST_NODE = 384;

function structuredObjectCount(root) {
  let count = 0;
  const stack = [root];
  while (stack.length) {
    const value = stack.pop();
    if (!value || typeof value !== "object") continue;
    count += 1;
    if (Array.isArray(value)) stack.push(...value);
    else stack.push(...Object.values(value));
  }
  return count;
}

function checkedMulModule(localCount) {
  const statements = [];
  for (let index = 0; index < localCount; index += 1) {
    statements.push({
      kind: "local",
      loc: { file: "<max-ast-witness>", line: index + 2 },
      name: `v${index}`,
      type: "i64",
      value: { args: ["%p", "%p"], kind: "numeric_operation", op: "i64.checked_mul" }
    });
  }
  statements.push({ kind: "return", loc: { file: "<max-ast-witness>", line: localCount + 2 }, value: "%p" });
  return {
    name: "work.witness",
    capabilities: new Set(),
    enums: [],
    functions: [{
      name: "run",
      exported: true,
      params: [{ name: "p", type: "i64" }],
      returnType: "i64",
      statements,
      loc: { file: "<max-ast-witness>", line: 1 }
    }],
    v051TypedAst: true,
    v051TypedDecisionCandidate: true
  };
}

function sourceBoundWitness() {
  const prefix = "module work.source_witness\nexport func run(p: i64) -> i64 {\n";
  const suffix = "return %p\n}\n";
  const lines = [];
  let bytes = Buffer.byteLength(prefix + suffix, "utf8");
  for (let index = 0; ; index += 1) {
    const line = `%v${index}: i64 = i64.checked_mul %p, %p\n`;
    const lineBytes = Buffer.byteLength(line, "utf8");
    if (bytes + lineBytes > VERIFIED_TYPED_RUNTIME_LIMITS.maxSourceBytes) break;
    lines.push(line);
    bytes += lineBytes;
  }
  const source = prefix + lines.join("") + suffix;
  return { bytes, source };
}

function assertLinearBound(label, sourceBytes, watBytes) {
  assert(
    watBytes <= PREEMISSION_FIXED_BYTES + sourceBytes * MAX_WAT_BYTES_PER_SOURCE_BYTE,
    `${label}: ${watBytes} WAT bytes exceeds the frozen source expansion witness`
  );
}

(async () => {
  const maxAst = checkedMulModule(16381);
  const maxAstNodes = structuredObjectCount(maxAst);
  assert.equal(VERIFIED_TYPED_RUNTIME_LIMITS.maxAstNodes - maxAstNodes, 1);
  const maxAstWatBytes = Buffer.byteLength(lowerToWat(maxAst), "utf8");
  assert(
    maxAstWatBytes <= PREEMISSION_FIXED_BYTES + maxAstNodes * MAX_WAT_BYTES_PER_AST_NODE,
    "near-max AST lowering exceeded the frozen linear expansion witness"
  );

  const sourceWitness = sourceBoundWitness();
  assert(sourceWitness.bytes > VERIFIED_TYPED_RUNTIME_LIMITS.maxSourceBytes - 128);
  const sourceAst = parseSource(sourceWitness.source, "<max-source-witness>", {
    sourceProfile: SOURCE_PROFILE_TYPED_V051
  });
  const sourceWatBytes = Buffer.byteLength(lowerToWat(sourceAst), "utf8");
  assertLinearBound("max-source checked-mul witness", sourceWitness.bytes, sourceWatBytes);
  assert(sourceWatBytes > VERIFIED_TYPED_RUNTIME_LIMITS.maxWatBytes);

  const descriptor = {
    air_abi_lane: "0.12",
    schema: "air.typed-interface/0.12-candidate.1",
    module_id: "work.source_witness",
    exports: [{
      function: "run",
      name: "run",
      parameters: [{ name: "p", type: "i64" }],
      return_type: "i64"
    }],
    types: []
  };
  const runtime = createVerifiedTypedRuntime({ admit: async () => true });
  await assert.rejects(
    () => runtime.build({ descriptor, source: sourceWitness.source, sourceProfile: SOURCE_PROFILE_TYPED_V051 }),
    (error) => error.code === "air.v052.work_limit_wat_bytes"
  );

  const fixtures = [
    "fixtures/v051/checked_numeric/checked_numeric.air",
    "fixtures/v051/first_vertical/typed_decide.air",
    "fixtures/v052/numerics/g2_existing_numeric.air",
    "fixtures/v052/public_reality/limit.air",
    "fixtures/v052/public_reality/panel.air"
  ];
  for (const relative of fixtures) {
    const source = fs.readFileSync(path.join(ROOT, relative), "utf8");
    const mod = parseSource(source, relative, { sourceProfile: SOURCE_PROFILE_TYPED_V051 });
    const statements = mod.functions.flatMap((fn) => fn.statements || []);
    assert(statements.every((statement) => ["local", "match", "return"].includes(statement.kind)));
    assertLinearBound(relative, Buffer.byteLength(source, "utf8"), Buffer.byteLength(lowerToWat(mod), "utf8"));
  }

  for (const statement of ["call @other()", "loop", "br nowhere"]) {
    const source = `module work.reject\nexport func run() -> i32 {\n${statement}\nreturn 0\n}\n`;
    assert.throws(
      () => parseSource(source, "forbidden.air", { sourceProfile: SOURCE_PROFILE_TYPED_V051 }),
      (error) => error.code === "air.v051.typed_syntax_invalid"
    );
  }

  console.log(JSON.stringify({
    status: "PASS",
    max_ast_nodes_witnessed: maxAstNodes,
    max_ast_wat_bytes: maxAstWatBytes,
    max_source_bytes_witnessed: sourceWitness.bytes,
    max_source_wat_bytes: sourceWatBytes,
    execution_admission_wat_cap: VERIFIED_TYPED_RUNTIME_LIMITS.maxWatBytes,
    forbidden_dynamic_control_flow: ["call", "loop", "br"],
    dynamic_work_bound_abi: false
  }));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
