#!/usr/bin/env node

const assert = require("assert");
const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");
const { parseAir } = require("../src/parser");
const { formatModule } = require("../src/format");
const { verifyModule } = require("../src/verifier");
const { checkPackageDir } = require("../src/sdk");
const { createPackageVerificationEvidence } = require("../src/verification_evidence");
const { createEvidenceMarkdownReport } = require("../src/evidence_report");
const { validateFactsSchema } = require("../src/facts_schema");
const { validateStructuredIoSchema } = require("../src/structured_io_schema");
const { validateOutputContractSchema } = require("../src/output_contract_schema");

const tmp = path.join(__dirname, "..", "build", "provenance-flow-tests");
const cliTmp = path.join(__dirname, "..", "build", "provenance-flow-cli-tests");

function moduleSource(options = {}) {
  const sourceLabel = options.sourceLabel || "sensitive";
  const sinkLabel = options.sinkLabel || "public";
  const paramType = options.paramType || "i32";
  const body = options.body || "  return %secret";
  const extra = options.extra || "";
  const helpers = options.helpers || "";
  return `module flow_case
capabilities { ${options.capabilities || ""} }
flow policy required
flow source param decide.secret ${sourceLabel}
flow sink return decide ${sinkLabel}
${extra}${extra ? "\n" : ""}
${helpers}export func decide(secret: ${paramType}) -> i32 {
entry:
${body}
}
`;
}

function verify(source, options = {}) {
  const mod = parseAir(source, options.file || "flow_case.air");
  verifyModule(mod, options);
  return mod;
}

function expectFlowError(source, code, options = {}) {
  let caught = null;
  try {
    verify(source, options);
  } catch (err) {
    caught = err;
  }
  assert(caught, `expected ${code}`);
  assert(caught.evidence, `expected provenance evidence for ${caught.message}`);
  assert(caught.evidence.diagnostics.some((item) => item.code === code), JSON.stringify(caught.evidence.diagnostics, null, 2));
  return caught.evidence;
}

const canonicalInput = moduleSource({ sinkLabel: "restricted" });
const canonical = formatModule(parseAir(canonicalInput, "canonical.air"));
assert.strictEqual(formatModule(parseAir(canonical, "canonical.air")), canonical);
assert.match(canonical, /flow policy required\nflow source param decide\.secret sensitive\nflow sink return decide restricted/);

assert.throws(
  () => parseAir(moduleSource().replace("sensitive", "top_secret"), "bad-label.air"),
  /air\.flow\.label_invalid/
);

expectFlowError(
  moduleSource({ sinkLabel: "restricted", extra: "flow source param decide.secret sensitive" }),
  "air.flow.policy_invalid"
);

expectFlowError(
  moduleSource({ sinkLabel: "restricted" }).replace("decide.secret sensitive", "decide.missing sensitive"),
  "air.flow.source_unresolved"
);

const direct = expectFlowError(moduleSource(), "air.flow.forbidden");
assert.strictEqual(direct.rejectedFlows.length, 1);
assert.deepStrictEqual(direct.rejectedFlows[0].sourceIdentities, ["param:flow_case.decide.secret"]);

fs.rmSync(cliTmp, { recursive: true, force: true });
fs.mkdirSync(cliTmp, { recursive: true });
const cliForbiddenPath = path.join(cliTmp, "forbidden.air");
fs.writeFileSync(cliForbiddenPath, moduleSource());
const cliResult = childProcess.spawnSync(process.execPath, [
  path.join(__dirname, "..", "bin", "airc.js"),
  "verify",
  cliForbiddenPath
], { encoding: "utf8" });
assert.notStrictEqual(cliResult.status, 0);
assert.match(cliResult.stderr, /FAIL air\.flow\.forbidden /);
assert.match(cliResult.stderr, /forbidden\.air:\d+:/);
assert.doesNotMatch(cliResult.stderr, /\n\s*at [^(]+\(/);

const upward = verify(moduleSource({ sinkLabel: "restricted" }));
assert.strictEqual(upward.provenanceFlowEvidence.status, "passed");
assert.strictEqual(upward.provenanceFlowEvidence.acceptedFlows.length, 1);

expectFlowError(moduleSource({
  body: "  %one:i32 = 1\n  %sum:i32 = i32.add %secret, %one\n  return %sum"
}), "air.flow.forbidden");

expectFlowError(moduleSource({
  paramType: "bool",
  body: "  %a:i32 = 1\n  %b:i32 = 0\n  %picked:i32 = select.i32 %secret, %a, %b\n  return %picked"
}), "air.flow.forbidden");

expectFlowError(moduleSource({
  helpers: `func relay(value: i32) -> i32 {
entry:
  return %value
}

`,
  body: "  %out:i32 = call @relay(%secret)\n  return %out"
}), "air.flow.forbidden");

expectFlowError(`module phi_control
capabilities { }
flow policy required
flow source param run.limit sensitive
flow sink return run public

export func run(limit: i32) -> i32 {
entry:
  %zero:i32 = 0
  br loop
loop:
  %i:i32 = phi.i32 entry:%zero, body:%next
  %done:bool = i32.ge_s %i, %limit
  br_if %done, exit, body
body:
  %one:i32 = 1
  %next:i32 = i32.add %i, %one
  br loop
exit:
  return %i
}
`, "air.flow.control_forbidden");

expectFlowError(`module fold_data
capabilities { }
flow policy required
flow source param run.seed sensitive
flow source param run.count public
flow sink return run public

func step(value: i32) -> i32 {
entry:
  %one:i32 = 1
  %next:i32 = i32.add %value, %one
  return %next
}

export func run(seed: i32, count: i32) -> i32 {
entry:
  %out:i32 = loop.fold.i32 @step, %seed, %count
  return %out
}
`, "air.flow.forbidden");

expectFlowError(`module array_loop_data
capabilities { }
flow policy required
flow source param run.count sensitive
flow sink return run public

func inc(value: i32) -> i32 {
entry:
  %one:i32 = 1
  %next:i32 = i32.add %value, %one
  return %next
}

export func run(count: i32) -> i32 {
entry:
  %one:i32 = 1
  %items:array<i32,2> = array.new %one, %one
  %looped:array<i32,2> = loop.array.i32 @inc, %items, %count
  %out:i32 = array.get %looped, 0
  return %out
}
`, "air.flow.forbidden");

expectFlowError(`module buffer_loop_data
capabilities { }
effects { memory.alloc <= 1, memory.free <= 1, memory.load <= 1, memory.store <= 1, memory.static_alloc_bytes <= 16, memory.dynamic_allocations <= 0, cpu.loops <= 1, cpu.loop_iterations_upper_bound <= 4, effects.dynamic <= 1 }
flow policy required
flow source param run.count sensitive
flow sink return run public

func step(value: f32) -> f32 {
entry:
  return %value
}

export func run(count: i32) -> i32 {
entry:
  %bytes:i32 = 16
  %ptr:ptr = alloc_region %bytes
  %buffer:buffer<f32,4> = buffer.from_ptr %ptr
  %zero:i32 = 0
  %seed:f32 = 1.0
  buffer.store %buffer, %zero, %seed
  loop.buffer.f32 @step, %buffer, %count
  %loaded:f32 = buffer.load %buffer, %zero
  %out:i32 = i32.trunc_f32_s %loaded
  free_region %ptr
  return %out
}
`, "air.flow.forbidden");

const control = expectFlowError(moduleSource({
  paramType: "bool",
  body: "  br_if %secret, yes, no\nyes:\n  %one:i32 = 1\n  return %one\nno:\n  %zero:i32 = 0\n  return %zero"
}), "air.flow.control_forbidden");
assert(control.rejectedFlows.every((item) => item.classification === "control"));
assert(control.rejectedFlows.every((item) => item.block));

verify(moduleSource({
  paramType: "bool",
  sourceLabel: "public",
  body: "  br_if %secret, yes, no\nyes:\n  %one:i32 = 1\n  return %one\nno:\n  %zero:i32 = 0\n  return %zero"
}));

expectFlowError(moduleSource({
  paramType: "bool",
  capabilities: "stdio",
  extra: "flow sink print arg 0 public",
  body: "  br_if %secret, yes, no\nyes:\n  %message:slice = \"yes\"\n  print %message\n  %one:i32 = 1\n  return %one\nno:\n  %zero:i32 = 0\n  return %zero"
}), "air.flow.control_forbidden");

expectFlowError(`module storage_case
capabilities { }
global cache:i32 = const.i32 0
flow policy required
flow source param write.value sensitive
flow sink return write public
flow storage global cache public

export func write(value: i32) -> i32 {
entry:
  global.set cache, %value
  %zero:i32 = 0
  return %zero
}
`, "air.flow.forbidden");

expectFlowError(`module storage_read_case
global cache:i32 = const.i32 0
capabilities { }
flow policy required
flow source global cache sensitive
flow sink return read public
flow storage global cache sensitive

export func read() -> i32 {
entry:
  %value:i32 = global.get cache
  return %value
}
`, "air.flow.forbidden");

expectFlowError(`module state_storage_case
state board:i32[4] = fill 0
capabilities { }
flow policy required
flow source param write.index public
flow source param write.value sensitive
flow sink return write public
flow storage state board public

export func write(index: i32, value: i32) -> i32 {
entry:
  state.set board, %index, %value
  %zero:i32 = 0
  return %zero
}
`, "air.flow.forbidden");

expectFlowError(`module pool_storage_case
pool objects capacity 4 {
  active:bool = false
  owner:i32 = 0
}
capabilities { }
flow policy required
flow source param write.index public
flow source param write.value sensitive
flow sink return write public
flow storage pool objects.active public
flow storage pool objects.owner public

export func write(index: i32, value: i32) -> i32 {
entry:
  pool.set.i32 @objects.owner, %index, %value
  %zero:i32 = 0
  return %zero
}
`, "air.flow.forbidden");

expectFlowError(moduleSource({
  body: "  %zero:i32 = 0\n  %array:array<i32,2> = array.new %zero, %zero\n  %value:i32 = array.get %array, %secret\n  return %value"
}), "air.flow.forbidden");

expectFlowError(`module region_flow
capabilities { }
flow policy required
flow source param run.secret sensitive
flow sink return run public

export func run(secret: i32) -> i32 {
entry:
  %bytes:i32 = 16
  %ptr:ptr = alloc_region %bytes
  %zero:i32 = 0
  %slice:slice = slice.from_region %ptr, %bytes
  slice.store.i32 %slice, %zero, %secret
  %out:i32 = slice.load.i32 %slice, %zero
  free_region %ptr
  return %out
}
`, "air.flow.forbidden");

const randomExtern = `module extern_source
capabilities { random }
flow policy required
flow source extern random.u32 return restricted
flow sink return run public
extern random.u32() -> i32

export func run() -> i32 {
entry:
  %value:i32 = call @random.u32()
  return %value
}
`;
expectFlowError(randomExtern, "air.flow.forbidden");
expectFlowError(
  randomExtern.replace("flow source extern random.u32 return restricted\n", ""),
  "air.flow.source_missing"
);

expectFlowError(`module extern_sink
capabilities { debug }
effects { debug.metric <= 1 }
flow policy required
flow source param run.secret sensitive
flow sink return run public
flow sink extern debug.metric arg 0 public
flow sink extern debug.metric arg 1 public
extern debug.metric(id: i32, value: i32) -> void

export func run(secret: i32) -> i32 {
entry:
  call @debug.metric(1, %secret)
  %zero:i32 = 0
  return %zero
}
`, "air.flow.forbidden");

const declassifierModule = moduleSource({
  helpers: `func redact(value: i32) -> i32 {
entry:
  %mask:i32 = 255
  %out:i32 = i32.and %value, %mask
  return %out
}

`,
  extra: "flow declassifier redact_sensitive function redact from sensitive to public",
  body: "  %out:i32 = call @redact(%secret)\n  return %out"
});
expectFlowError(declassifierModule, "air.flow.declassification_unauthorized");

const declassifierPolicy = {
  mode: "required",
  sourceBindings: [],
  declassifiers: [{
    id: "redact_sensitive",
    module: "flow_case",
    function: "redact",
    from: "sensitive",
    to: "public",
    reasonCode: "PII_REDACTION_V1"
  }]
};
const declassified = verify(declassifierModule, { provenancePolicy: declassifierPolicy });
assert.strictEqual(declassified.provenanceFlowEvidence.status, "passed");
assert.strictEqual(declassified.provenanceFlowEvidence.declassifications.length, 1);
assert.strictEqual(declassified.provenanceFlowEvidence.declassifications[0].reasonCode, "PII_REDACTION_V1");

const impureDeclassifier = declassifierModule
  .replace(/capabilities \{\s*\}/, "global cache:i32 = const.i32 0\ncapabilities { }")
  .replace(
    "flow declassifier redact_sensitive function redact from sensitive to public",
    "flow storage global cache sensitive\nflow declassifier redact_sensitive function redact from sensitive to public"
  )
  .replace("  %mask:i32 = 255", "  global.set cache, %value\n  %mask:i32 = 255");
expectFlowError(impureDeclassifier, "air.flow.declassification_mismatch", { provenancePolicy: declassifierPolicy });

expectFlowError(
  declassifierModule.replace("flow source param decide.secret sensitive", "flow source param decide.secret restricted"),
  "air.flow.declassification_mismatch",
  { provenancePolicy: declassifierPolicy }
);

const controlledDeclassification = declassifierModule
  .replace("decide(secret: i32)", "decide(secret: i32)")
  .replace(
    "  %out:i32 = call @redact(%secret)\n  return %out",
    "  %zero:i32 = 0\n  %guard:bool = i32.gt_s %secret, %zero\n  br_if %guard, yes, no\nyes:\n  %out:i32 = call @redact(%secret)\n  return %out\nno:\n  return %zero"
  );
expectFlowError(controlledDeclassification, "air.flow.control_forbidden", { provenancePolicy: declassifierPolicy });

const deterministicA = verify(moduleSource({ sinkLabel: "restricted" })).provenanceFlowEvidence;
const deterministicB = verify(moduleSource({ sinkLabel: "restricted" })).provenanceFlowEvidence;
assert.deepStrictEqual(deterministicA, deterministicB);
assert.match(deterministicA.policyDigest, /^sha256:[a-f0-9]{64}$/);
assert.match(deterministicA.analyzerDigest, /^sha256:[a-f0-9]{64}$/);
assert.match(deterministicA.summaryDigest, /^sha256:[a-f0-9]{64}$/);
assert(deterministicA.unsupportedChannels.includes("timing"));
assert(deterministicA.unsupportedChannels.includes("termination"));
assert(deterministicA.sources.every((item) => item.location && Number.isInteger(item.location.line)));
assert(!JSON.stringify(deterministicA).includes("runtimeValue"));

const manyParams = Array.from({ length: 33 }, (_, index) => `p${index}: i32`).join(", ");
const manySources = Array.from({ length: 33 }, (_, index) => `flow source param run.p${index} sensitive`).join("\n");
const manyAdds = Array.from({ length: 32 }, (_, index) =>
  `  %sum${index}:i32 = i32.add ${index === 0 ? "%p0" : `%sum${index - 1}`}, %p${index + 1}`
).join("\n");
expectFlowError(`module source_budget
capabilities { }
flow policy required
${manySources}
flow sink return run restricted

export func run(${manyParams}) -> i32 {
entry:
${manyAdds}
  return %sum31
}
`, "air.flow.analysis_budget_exceeded");

const longPathAdds = Array.from({ length: 70 }, (_, index) =>
  `  %path${index}:i32 = i32.add ${index === 0 ? "%seed" : `%path${index - 1}`}, 1`
).join("\n");
expectFlowError(`module path_budget
capabilities { }
flow policy required
flow source param run.seed sensitive
flow sink return run restricted

export func run(seed: i32) -> i32 {
entry:
${longPathAdds}
  return %path69
}
`, "air.flow.analysis_budget_exceeded");

const nodeBudgetBody = Array.from({ length: 2050 }, (_, index) => `  %node${index}:i32 = ${index}`).join("\n");
expectFlowError(`module node_budget
capabilities { }
flow policy required
flow sink return run public

export func run() -> i32 {
entry:
${nodeBudgetBody}
  return %node2049
}
`, "air.flow.analysis_budget_exceeded");

const helperFunctions = Array.from({ length: 257 }, (_, index) => `func helper${index}() -> i32 {
entry:
  %zero:i32 = 0
  return %zero
}
`).join("\n");
expectFlowError(`module function_budget
capabilities { }
flow policy required
flow sink return run public

${helperFunctions}
export func run() -> i32 {
entry:
  %zero:i32 = 0
  return %zero
}
`, "air.flow.analysis_budget_exceeded");

const declassifierFunctions = Array.from({ length: 33 }, (_, index) => `flow declassifier lower${index} function lower${index} from sensitive to public`).join("\n");
const declassifierBodies = Array.from({ length: 33 }, (_, index) => `func lower${index}(value: i32) -> i32 {
entry:
  return %value
}
`).join("\n");
const declassifierBudgetPolicy = {
  mode: "required",
  sourceBindings: [],
  declassifiers: Array.from({ length: 33 }, (_, index) => ({
    id: `lower${index}`,
    module: "declassifier_budget",
    function: `lower${index}`,
    from: "sensitive",
    to: "public",
    reasonCode: `BOUNDED_TEST_${index}`
  }))
};
expectFlowError(`module declassifier_budget
capabilities { }
flow policy required
flow sink return run public
${declassifierFunctions}

${declassifierBodies}
export func run() -> i32 {
entry:
  %zero:i32 = 0
  return %zero
}
`, "air.flow.analysis_budget_exceeded", { provenancePolicy: declassifierBudgetPolicy });

const legacy = `module legacy
capabilities { }

export func run() -> i32 {
entry:
  %one:i32 = 1
  return %one
}
`;
const legacyMod = verify(legacy);
assert.strictEqual(legacyMod.provenanceFlowEvidence.mode, "absent");
assert.strictEqual(formatModule(legacyMod), formatModule(parseAir(legacy)));

const facts = validateFactsSchema({
  schemaVersion: "0.18",
  facts: [{
    id: 1,
    name: "request_data",
    maxRows: 1,
    columns: [{ name: "score", type: "i32", flowLabel: "sensitive" }]
  }]
});
assert.strictEqual(facts.ok, true);
assert.strictEqual(facts.facts[0].columns[0].flowLabel, "sensitive");
assert.strictEqual(validateFactsSchema({
  schemaVersion: "0.18",
  facts: [{ id: 1, name: "request_data", maxRows: 1, columns: [{ name: "score", type: "i32", flowLabel: "secret" }] }]
}).diagnostics.some((item) => item.code === "air.flow.label_invalid"), true);

const structuredDiagnostics = [];
const structuredErrors = [];
validateStructuredIoSchema({
  schemaVersion: "0.32",
  kind: "air.structuredRecordSchema",
  name: "request",
  fields: [{ name: "score", type: "i32", privacy: "public", flowLabel: "restricted" }]
}, { diagnostics: structuredDiagnostics, errors: structuredErrors });
assert.strictEqual(structuredErrors.length, 0);

const output = validateOutputContractSchema({
  schemaVersion: "0.18",
  kind: "air.outputContract",
  outputs: [{
    id: 1,
    name: "decision",
    channel: "policy",
    capability: "output",
    args: [{ name: "result", type: "i32", flowLabel: "public" }]
  }]
});
assert.strictEqual(output.ok, true);
assert.strictEqual(output.outputs[0].args[0].flowLabel, "public");

fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(path.join(tmp, "facts"), { recursive: true });
fs.writeFileSync(path.join(tmp, "module.air"), `module bound_package
capabilities { }
flow policy required
flow source param decide.secret from fact request_data.score sensitive
flow sink return decide restricted

export func decide(secret: i32) -> i32 {
entry:
  return %secret
}
`);
fs.writeFileSync(path.join(tmp, "facts", "request.facts.json"), `${JSON.stringify({
  schemaVersion: "0.18",
  facts: [{
    id: 1,
    name: "request_data",
    maxRows: 1,
    columns: [{ name: "score", type: "i32", flowLabel: "sensitive" }]
  }]
}, null, 2)}\n`);
fs.writeFileSync(path.join(tmp, "air.package.json"), `${JSON.stringify({
  name: "bound-package",
  version: "0.1.0",
  airAbi: "0.10",
  hostAbi: "0.10",
  entry: "module.air",
  capabilities: [],
  targetProfiles: ["cli"],
  factSchemas: ["facts/request.facts.json"],
  provenanceFlow: {
    mode: "required",
    sourceBindings: [{
      from: "fact:request_data.score",
      to: "param:bound_package.decide.secret",
      label: "sensitive"
    }],
    declassifiers: []
  }
}, null, 2)}\n`);

const packageReport = checkPackageDir(tmp, { built: false });
assert.notStrictEqual(packageReport.status, "fail", packageReport.errors.join("\n"));
assert.strictEqual(packageReport.provenanceFlow.status, "passed");
const evidence = createPackageVerificationEvidence(tmp);
assert.strictEqual(evidence.status, "passed");
assert.strictEqual(evidence.provenanceFlow.status, "passed");
assert.strictEqual(evidence.provenanceFlow.policyDigest, packageReport.provenanceFlow.policyDigest);
assert.strictEqual(evidence.factSchemas[0].facts[0].columns[0].flowLabel, "sensitive");
const markdown = createEvidenceMarkdownReport(tmp);
assert.match(markdown, /## Provenance Flow/);
assert.match(markdown, /Bounded explicit data\/control dependencies only/);

const tampered = JSON.parse(fs.readFileSync(path.join(tmp, "air.package.json"), "utf8"));
tampered.provenanceFlow.sourceBindings[0].label = "public";
fs.writeFileSync(path.join(tmp, "air.package.json"), `${JSON.stringify(tampered, null, 2)}\n`);
const tamperedReport = checkPackageDir(tmp, { built: false });
assert.strictEqual(tamperedReport.status, "fail");
assert(tamperedReport.diagnostics.some((item) => item.code === "air.flow.package_binding_mismatch"));
const tamperedEvidence = createPackageVerificationEvidence(tmp);
assert.notStrictEqual(tamperedEvidence.packageHash, evidence.packageHash);

const multi = path.join(tmp, "multi");
fs.mkdirSync(multi, { recursive: true });
fs.writeFileSync(path.join(multi, "main.air"), `module main
use "./helper.air" as helper
capabilities { }
flow policy required
flow source param run.secret sensitive
flow sink return run public

export func run(secret: i32) -> i32 {
entry:
  %out:i32 = call @helper.relay(%secret)
  return %out
}
`);
fs.writeFileSync(path.join(multi, "helper.air"), `module helper
capabilities { }
flow policy required
flow source param relay.value sensitive
flow sink return relay restricted

export func relay(value: i32) -> i32 {
entry:
  return %value
}
`);
fs.writeFileSync(path.join(multi, "air.package.json"), `${JSON.stringify({
  name: "multi-flow",
  version: "0.1.0",
  airAbi: "0.10",
  hostAbi: "0.10",
  entry: "main.air",
  capabilities: [],
  targetProfiles: ["cli"],
  provenanceFlow: { mode: "required", sourceBindings: [], declassifiers: [] }
}, null, 2)}\n`);
const multiReport = checkPackageDir(multi, { built: false });
assert.strictEqual(multiReport.status, "fail");
assert(multiReport.provenanceFlow.rejectedFlows.some((item) => item.sink === "return:main.run"));

const outputPackage = path.join(tmp, "output");
fs.mkdirSync(path.join(outputPackage, "outputs"), { recursive: true });
fs.writeFileSync(path.join(outputPackage, "module.air"), `module output_flow
const OUT_DECISION:i32 = 1
capabilities { output }
effects { output.emit <= 1 }
flow policy required
flow source param run.secret sensitive
flow source extern output.emit return public
flow sink return run public
extern output.emit(output_id: i32, arg0: i32, arg1: i32, arg2: i32, arg3: i32) -> i32

export func run(secret: i32) -> i32 {
entry:
  %status:i32 = call @output.emit(OUT_DECISION, %secret, 0, 0, 0)
  return %status
}
`);
fs.writeFileSync(path.join(outputPackage, "outputs", "decision.output.json"), `${JSON.stringify({
  schemaVersion: "0.18",
  kind: "air.outputContract",
  outputs: [{
    id: 1,
    name: "decision",
    channel: "policy",
    capability: "output.emit",
    args: [
      { name: "result", type: "i32", flowLabel: "public" },
      { name: "arg1", type: "i32", flowLabel: "public" },
      { name: "arg2", type: "i32", flowLabel: "public" },
      { name: "arg3", type: "i32", flowLabel: "public" }
    ]
  }]
}, null, 2)}\n`);
fs.writeFileSync(path.join(outputPackage, "air.package.json"), `${JSON.stringify({
  name: "output-flow",
  version: "0.1.0",
  airAbi: "0.10",
  hostAbi: "0.11",
  entry: "module.air",
  capabilities: ["output"],
  targetProfiles: ["mock-output-v011"],
  outputContracts: ["outputs/decision.output.json"],
  provenanceFlow: { mode: "required", sourceBindings: [], declassifiers: [] }
}, null, 2)}\n`);
const outputReport = checkPackageDir(outputPackage, { built: false });
assert.strictEqual(outputReport.status, "fail");
assert(outputReport.provenanceFlow.rejectedFlows.some((item) => item.sink === "extern:output.emit:arg:1"));

const outputModule = fs.readFileSync(path.join(outputPackage, "module.air"), "utf8");
fs.writeFileSync(path.join(outputPackage, "module.air"), outputModule.replace("OUT_DECISION:i32 = 1", "OUT_DECISION:i32 = 2"));
const wrongOutputId = checkPackageDir(outputPackage, { built: false });
assert.strictEqual(wrongOutputId.status, "fail");
assert(wrongOutputId.provenanceFlow.diagnostics.some((item) => item.code === "air.flow.sink_missing"));
fs.writeFileSync(path.join(outputPackage, "module.air"), outputModule);

const outputContractPath = path.join(outputPackage, "outputs", "decision.output.json");
const incompleteOutputContract = JSON.parse(fs.readFileSync(outputContractPath, "utf8"));
delete incompleteOutputContract.outputs[0].args[3].flowLabel;
fs.writeFileSync(outputContractPath, `${JSON.stringify(incompleteOutputContract, null, 2)}\n`);
const outputArityMismatch = checkPackageDir(outputPackage, { built: false });
assert.strictEqual(outputArityMismatch.status, "fail");
assert(outputArityMismatch.provenanceFlow.diagnostics.some((item) => item.code === "air.flow.sink_missing"));

const structuredPackage = path.join(tmp, "structured");
fs.mkdirSync(path.join(structuredPackage, "schemas"), { recursive: true });
fs.writeFileSync(path.join(structuredPackage, "module.air"), `module structured_flow
capabilities { }
flow policy required
flow source param decide.score from structured request.score internal
flow sink return decide restricted

export func decide(score: i32) -> i32 {
entry:
  return %score
}
`);
fs.writeFileSync(path.join(structuredPackage, "schemas", "request.structured.rowset.json"), `${JSON.stringify({
  schemaVersion: "0.32",
  kind: "air.structuredRowsetSchema",
  name: "request",
  maxRows: 1,
  privacyPolicy: { defaultClassification: "minimized", forbiddenByDefault: [] },
  fields: [{ name: "score", type: "i32", privacy: "minimized", semantic: "score", flowLabel: "internal" }]
}, null, 2)}\n`);
fs.writeFileSync(path.join(structuredPackage, "air.package.json"), `${JSON.stringify({
  name: "structured-flow",
  version: "0.1.0",
  airAbi: "0.10",
  hostAbi: "0.10",
  entry: "module.air",
  capabilities: [],
  targetProfiles: ["cli"],
  structuredIO: ["schemas/request.structured.rowset.json"],
  provenanceFlow: {
    mode: "required",
    sourceBindings: [{
      from: "structured:request.score",
      to: "param:structured_flow.decide.score",
      label: "internal"
    }],
    declassifiers: []
  }
}, null, 2)}\n`);
const structuredReport = checkPackageDir(structuredPackage, { built: false });
assert.notStrictEqual(structuredReport.status, "fail", structuredReport.errors.join("\n"));
const structuredEvidence = createPackageVerificationEvidence(structuredPackage);
assert.strictEqual(structuredEvidence.structuredIO.schemas[0].fields[0].flowLabel, "internal");
const substitutedPackage = path.join(tmp, "substituted");
fs.cpSync(structuredPackage, substitutedPackage, { recursive: true });
const substitutedManifest = JSON.parse(fs.readFileSync(path.join(substitutedPackage, "air.package.json"), "utf8"));
substitutedManifest.name = "structured-flow-substituted";
fs.writeFileSync(path.join(substitutedPackage, "air.package.json"), `${JSON.stringify(substitutedManifest, null, 2)}\n`);
const substitutedEvidence = createPackageVerificationEvidence(substitutedPackage);
assert.notStrictEqual(substitutedEvidence.packageHash, structuredEvidence.packageHash);

console.log("provenance flow MVP tests passed");
