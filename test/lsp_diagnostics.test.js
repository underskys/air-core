#!/usr/bin/env node

const assert = require("assert");
const cp = require("child_process");
const fs = require("fs");
const path = require("path");
const { toLspDiagnostic } = require("../src/lsp_diagnostics");

const root = path.resolve(__dirname, "..");
const airc = path.join(root, "bin", "airc.js");
const tmp = path.join(root, "build", "lsp-diagnostics-test");

fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });

const parserErrorFile = path.join(tmp, "parser_error.air");
fs.writeFileSync(parserErrorFile, `module parser_error
capabilities { }

not valid syntax
`);
const parserError = runFails(["check", parserErrorFile, "--lsp-json"]);
assert.strictEqual(parserError.schemaVersion, "0.15");
assert.strictEqual(parserError.kind, "file");
assert.strictEqual(parserError.status, "fail");
assert(parserError.diagnostics.some((diagnostic) => diagnostic.code === "air.parser.syntax" && diagnostic.file === parserErrorFile && diagnostic.line === 4));

const verifierErrorFile = path.join(tmp, "verifier_error.air");
fs.writeFileSync(verifierErrorFile, `module verifier_error
capabilities { }

extern debug.metric(id: i32, value: i32) -> void

export func run() -> void {
entry:
  @debug.metric(1, 1)
  return
}
`);
const verifierError = runFails(["check", verifierErrorFile, "--lsp-json"]);
assert.strictEqual(verifierError.status, "fail");
assert(verifierError.diagnostics.some((diagnostic) => diagnostic.code === "air.verifier.error" && /requires capability 'debug'/.test(diagnostic.message)));

const compactTableFile = path.join(tmp, "compact_table_error.air");
fs.writeFileSync(compactTableFile, `module compact_table_error
table xs:u8 = [256]
capabilities { }

export func run() -> i32 {
entry:
  %value:i32 = table.get.u8 xs, 0
  return %value
}
`);
const compactTableFileError = runFails(["check", compactTableFile, "--lsp-json"]);
const compactFileDiagnostic = compactTableFileError.diagnostics.find((diagnostic) => diagnostic.code === "air.table.value_out_of_range");
assert(compactFileDiagnostic, "expected compact table diagnostic for file LSP-lite output");
assert.strictEqual(compactFileDiagnostic.fields.table, "xs");
assert.strictEqual(compactFileDiagnostic.fields.storageType, "u8");
assert.strictEqual(compactFileDiagnostic.fields.index, 0);
assert.strictEqual(compactFileDiagnostic.fields.value, 256);
assert.strictEqual(compactFileDiagnostic.fields.allowedRange, "0..255");
assert.strictEqual(compactFileDiagnostic.fields.path, compactTableFile);

const packageProfileError = path.join(tmp, "package-profile-error");
writePackage(packageProfileError, {
  name: "package-profile-error",
  capabilities: ["debug"],
  reviewPolicy: null,
  source: `module package_profile_error
capabilities { debug }

extern debug.metric(id: i32, value: i32) -> void

export func run() -> void {
entry:
  @debug.metric(1, 1)
  return
}
`
});
const packageError = runFails(["check", packageProfileError, "--profile", "verifier-only", "--lsp-json"]);
assert.strictEqual(packageError.kind, "package");
assert.strictEqual(packageError.status, "fail");
assert(packageError.diagnostics.some((diagnostic) => diagnostic.code === "air.package.capability" && diagnostic.file === null));

const reviewWarningPackage = path.join(tmp, "review-warning-package");
writePackage(reviewWarningPackage, {
  name: "review-warning-package",
  capabilities: [],
  reviewPolicy: {
    schemaVersion: "0.15",
    thresholds: {
      largeFunctionStatements: 4
    },
    gates: {
      "air.review.large_function": "warn"
    }
  },
  source: largeAirModule("review_warning", "run", 8)
});
const reviewWarning = run(["check", reviewWarningPackage, "--profile", "verifier-only", "--lsp-json"]);
assert.strictEqual(reviewWarning.status, "warn");
assert(reviewWarning.diagnostics.some((diagnostic) => diagnostic.code === "air.review.large_function" && diagnostic.pathClass === "authored"));

const waivedReviewPackage = path.join(tmp, "waived-review-package");
writePackage(waivedReviewPackage, {
  name: "waived-review-package",
  capabilities: [],
  reviewPolicy: {
    schemaVersion: "0.15",
    thresholds: {
      largeFunctionStatements: 4
    },
    gates: {
      "air.review.large_function": "fail"
    },
    waivers: [
      {
        code: "air.review.large_function",
        file: "module.air",
        reason: "known compact fixture for LSP-lite waiver field preservation"
      }
    ]
  },
  source: largeAirModule("waived_review", "run", 8)
});
const waivedReview = run(["check", waivedReviewPackage, "--profile", "verifier-only", "--lsp-json"]);
const waivedDiagnostic = waivedReview.diagnostics.find((diagnostic) => diagnostic.code === "air.review.large_function");
assert(waivedDiagnostic, "expected waived review diagnostic in LSP-lite output");
assert.strictEqual(waivedDiagnostic.fields.waived, true);
assert.strictEqual(waivedDiagnostic.fields.waiverReason, "known compact fixture for LSP-lite waiver field preservation");

const generatedMissingPackage = path.join(tmp, "generated-missing-package");
writePackage(generatedMissingPackage, {
  name: "generated-missing-package",
  capabilities: [],
  generatedModules: ["generated/assets.air"],
  reviewPolicy: null,
  source: `module generated_missing
capabilities { }

export func run() -> i32 {
entry:
  %ok:i32 = const.i32 1
  return %ok
}
`
});
const generatedMissing = runFails(["check", generatedMissingPackage, "--profile", "verifier-only", "--lsp-json"]);
assert.strictEqual(generatedMissing.status, "fail");
assert(generatedMissing.diagnostics.some((diagnostic) => diagnostic.code === "air.generated.stale" && diagnostic.file === null && /generated module missing/.test(diagnostic.message)));
assert.deepStrictEqual(runFails(["check", generatedMissingPackage, "--profile", "verifier-only", "--lsp-json"]), generatedMissing);

const stateHandlesMissingPackage = path.join(tmp, "state-handles-missing-package");
writePackage(stateHandlesMissingPackage, {
  name: "state-handles-missing-package",
  capabilities: [],
  generatedModules: ["generated/state_handles.air"],
  reviewPolicy: null,
  source: stateModule("state_handles_missing")
});
const stateHandlesMissing = runFails(["check", stateHandlesMissingPackage, "--profile", "verifier-only", "--lsp-json"]);
assert(stateHandlesMissing.diagnostics.some((diagnostic) => diagnostic.code === "air.generated.state_handles_missing"));

const stateHandlesStalePackage = path.join(tmp, "state-handles-stale-package");
writePackage(stateHandlesStalePackage, {
  name: "state-handles-stale-package",
  capabilities: [],
  generatedModules: ["generated/state_handles.air"],
  reviewPolicy: null,
  source: stateModule("state_handles_stale", 4)
});
run(["generate", "state-handles", stateHandlesStalePackage, "--json"]);
fs.writeFileSync(path.join(stateHandlesStalePackage, "module.air"), stateModule("state_handles_stale", 5));
const stateHandlesStale = runFails(["check", stateHandlesStalePackage, "--profile", "verifier-only", "--lsp-json"]);
assert(stateHandlesStale.diagnostics.some((diagnostic) => diagnostic.code === "air.generated.state_handles_stale"));

const stateHandlesMismatchPackage = path.join(tmp, "state-handles-mismatch-package");
writePackage(stateHandlesMismatchPackage, {
  name: "state-handles-mismatch-package",
  capabilities: [],
  generatedModules: ["generated/state_handles.air"],
  reviewPolicy: null,
  source: stateModule("state_handles_mismatch", 4)
});
run(["generate", "state-handles", stateHandlesMismatchPackage, "--json"]);
const stateHandlesMetaPath = path.join(stateHandlesMismatchPackage, "generated", "state_handles.meta.json");
const stateHandlesMeta = JSON.parse(fs.readFileSync(stateHandlesMetaPath, "utf8"));
stateHandlesMeta.states[0].length = 99;
fs.writeFileSync(stateHandlesMetaPath, `${JSON.stringify(stateHandlesMeta, null, 2)}\n`);
const stateHandlesMismatch = runFails(["check", stateHandlesMismatchPackage, "--profile", "verifier-only", "--lsp-json"]);
assert(stateHandlesMismatch.diagnostics.some((diagnostic) => diagnostic.code === "air.generated.state_handles_mismatch"));

const outputHandlesStalePackage = path.join(tmp, "output-handles-stale-package");
writePackage(outputHandlesStalePackage, {
  name: "output-handles-stale-package",
  capabilities: [],
  generatedModules: ["generated/output_handles.air"],
  outputContracts: ["outputs/contracts.json"],
  reviewPolicy: null,
  source: `module output_handles_stale
capabilities { }

export func run() -> i32 {
entry:
  %ok:i32 = const.i32 1
  return %ok
}
`
});
writeJson(path.join(outputHandlesStalePackage, "outputs", "contracts.json"), outputEmitContract());
run(["generate", "output-handles", outputHandlesStalePackage, "--json"]);
writeJson(path.join(outputHandlesStalePackage, "outputs", "contracts.json"), {
  ...outputEmitContract(),
  outputs: [{ ...outputEmitContract().outputs[0], name: "panel_set_badge" }]
});
const outputHandlesStale = runFails(["check", outputHandlesStalePackage, "--profile", "verifier-only", "--lsp-json"]);
assert(outputHandlesStale.diagnostics.some((diagnostic) => diagnostic.code === "air.generated.output_handles_stale"));

const stateAccessorUnsafePackage = path.join(tmp, "state-accessor-unsafe-package");
writePackage(stateAccessorUnsafePackage, {
  name: "state-accessor-unsafe-package",
  capabilities: [],
  reviewPolicy: null,
  source: stateAccessorModule("state_accessor_unsafe", "state.set board, %index, 7")
});
writeJson(path.join(stateAccessorUnsafePackage, "state_accessors.policy.json"), stateAccessorPolicy("board_cell", "board"));
const stateAccessorUnsafe = runFails(["check", stateAccessorUnsafePackage, "--profile", "verifier-only", "--lsp-json"]);
assert(stateAccessorUnsafe.diagnostics.some((diagnostic) =>
  diagnostic.code === "air.state.accessor_not_observation_safe" &&
  diagnostic.fields.reason === "state_write"
));

const stateAccessorInvalidPackage = path.join(tmp, "state-accessor-invalid-package");
writePackage(stateAccessorInvalidPackage, {
  name: "state-accessor-invalid-package",
  capabilities: [],
  reviewPolicy: null,
  source: stateAccessorModule("state_accessor_invalid")
});
writeJson(path.join(stateAccessorInvalidPackage, "state_accessors.policy.json"), {
  schemaVersion: "0.99",
  kind: "air.stateAccessorPolicy",
  helpers: [{ name: "board_cell", state: "board", mode: "readCell", exported: true, observationOnly: true }]
});
const stateAccessorInvalid = runFails(["check", stateAccessorInvalidPackage, "--profile", "verifier-only", "--lsp-json"]);
assert(stateAccessorInvalid.diagnostics.some((diagnostic) => diagnostic.code === "air.state.accessor_policy_invalid"));
assert.deepStrictEqual(stateAccessorInvalid.diagnostics, uniqueDiagnostics(stateAccessorInvalid.diagnostics));
assert.deepStrictEqual(
  stateAccessorInvalid.diagnostics.map((diagnostic) => diagnostic.code),
  stateAccessorInvalid.diagnostics.map((diagnostic) => diagnostic.code).slice().sort()
);

const compactTablePackage = path.join(tmp, "compact-table-package");
writePackage(compactTablePackage, {
  name: "compact-table-package",
  capabilities: [],
  reviewPolicy: null,
  source: `module compact_table_lsp
table xs:u8 = [256]
capabilities { }

export func run() -> i32 {
entry:
  %value:i32 = table.get.u8 xs, 0
  return %value
}
`
});
const compactTableError = runFails(["check", compactTablePackage, "--profile", "verifier-only", "--lsp-json"]);
const compactDiagnostic = compactTableError.diagnostics.find((diagnostic) => diagnostic.code === "air.table.value_out_of_range");
assert(compactDiagnostic, "expected compact table diagnostic in LSP-lite output");
assert.strictEqual(compactDiagnostic.fields.table, "xs");
assert.strictEqual(compactDiagnostic.fields.storageType, "u8");
assert.strictEqual(compactDiagnostic.fields.index, 0);
assert.strictEqual(compactDiagnostic.fields.value, 256);
assert.strictEqual(compactDiagnostic.fields.allowedRange, "0..255");
assert.strictEqual(compactDiagnostic.line, 2);
assert.match(compactDiagnostic.file, /module\.air$/);

const outputEmitDynamicPackage = path.join(tmp, "output-emit-dynamic-package");
writeOutputEmitPackage(outputEmitDynamicPackage, {
  name: "output-emit-dynamic-package",
  source: outputEmitModule("output_emit_dynamic_lsp", {
    setup: "  %zero:i32 = const.i32 0\n  %one:i32 = const.i32 1\n  %id:i32 = i32.add %zero, %one\n",
    outputId: "%id"
  })
});
const outputEmitDynamic = runFails(["check", outputEmitDynamicPackage, "--profile", "mock-output-v011", "--lsp-json"]);
assert(outputEmitDynamic.diagnostics.some((diagnostic) => diagnostic.code === "air.output_emit.output_id_dynamic"));
assert.deepStrictEqual(runFails(["check", outputEmitDynamicPackage, "--profile", "mock-output-v011", "--lsp-json"]), outputEmitDynamic);

const outputEmitInvalidPackage = path.join(tmp, "output-emit-invalid-package");
writeOutputEmitPackage(outputEmitInvalidPackage, {
  name: "output-emit-invalid-package",
  source: outputEmitModule("output_emit_invalid_lsp", { constValue: 99 })
});
const outputEmitInvalid = runFails(["check", outputEmitInvalidPackage, "--profile", "mock-output-v011", "--lsp-json"]);
assert(outputEmitInvalid.diagnostics.some((diagnostic) => diagnostic.code === "air.output_emit.output_id_invalid"));

const outputEmitBadArgsPackage = path.join(tmp, "output-emit-bad-args-package");
writeOutputEmitPackage(outputEmitBadArgsPackage, {
  name: "output-emit-bad-args-package",
  source: outputEmitModule("output_emit_bad_args_lsp", {
    setup: "  %zero:i32 = const.i32 0\n  %f:f32 = const.f32 1.0\n",
    callArgs: "OUT_ALERT, %f, %zero, %zero, %zero"
  })
});
const outputEmitBadArgs = runFails(["check", outputEmitBadArgsPackage, "--profile", "mock-output-v011", "--lsp-json"]);
assert(outputEmitBadArgs.diagnostics.some((diagnostic) => diagnostic.code === "air.output_emit.args_invalid"));

const outputEmitMissingCapabilityPackage = path.join(tmp, "output-emit-missing-capability-package");
writeOutputEmitPackage(outputEmitMissingCapabilityPackage, {
  name: "output-emit-missing-capability-package",
  capabilities: [],
  source: outputEmitModule("output_emit_missing_capability_lsp", {
    capabilities: ""
  })
});
const outputEmitMissingCapability = runFails(["check", outputEmitMissingCapabilityPackage, "--profile", "mock-output-v011", "--lsp-json"]);
assert(outputEmitMissingCapability.diagnostics.some((diagnostic) => diagnostic.code === "air.output_emit.capability_missing"));

const outputEmitMissingBudgetPackage = path.join(tmp, "output-emit-missing-budget-package");
writeOutputEmitPackage(outputEmitMissingBudgetPackage, {
  name: "output-emit-missing-budget-package",
  source: outputEmitModule("output_emit_missing_budget_lsp", { effects: "" })
});
const outputEmitMissingBudget = runFails(["check", outputEmitMissingBudgetPackage, "--profile", "mock-output-v011", "--lsp-json"]);
assert(outputEmitMissingBudget.diagnostics.some((diagnostic) => diagnostic.code === "air.output_emit.budget_exceeded"));

const outputEmitUnsupportedAbiPackage = path.join(tmp, "output-emit-unsupported-abi-package");
writeOutputEmitPackage(outputEmitUnsupportedAbiPackage, {
  name: "output-emit-unsupported-abi-package",
  hostAbi: "0.10",
  targetProfiles: ["cli"]
});
const outputEmitUnsupportedAbi = runFails(["check", outputEmitUnsupportedAbiPackage, "--profile", "cli", "--lsp-json"]);
assert(outputEmitUnsupportedAbi.diagnostics.some((diagnostic) => diagnostic.code === "air.output_emit.host_abi_unsupported"));
assert(outputEmitUnsupportedAbi.diagnostics.some((diagnostic) => diagnostic.code === "air.output_emit.profile_unsupported"));

const outputEmitNoContractsPackage = path.join(tmp, "output-emit-no-contracts-package");
writeOutputEmitPackage(outputEmitNoContractsPackage, {
  name: "output-emit-no-contracts-package",
  outputContracts: []
});
fs.rmSync(path.join(outputEmitNoContractsPackage, "outputs"), { recursive: true, force: true });
const outputEmitNoContracts = runFails(["check", outputEmitNoContractsPackage, "--profile", "mock-output-v011", "--lsp-json"]);
assert(outputEmitNoContracts.diagnostics.some((diagnostic) => diagnostic.code === "air.output_emit.output_id_invalid"));

for (const result of [
  outputEmitDynamic,
  outputEmitInvalid,
  outputEmitBadArgs,
  outputEmitMissingCapability,
  outputEmitMissingBudget,
  outputEmitUnsupportedAbi,
  outputEmitNoContracts
]) {
  assert.deepStrictEqual(result.diagnostics, uniqueDiagnostics(result.diagnostics));
}

const trendDiagnostic = toLspDiagnostic({
  code: "air.trend.diagnostic_count_increased",
  severity: "warn",
  source: "trend",
  category: "trend",
  message: "diagnostic count increased for air.review.debug_metric_event_bus",
  metric: "diagnostics.air.review.debug_metric_event_bus",
  value: 2,
  threshold: 0,
  fields: {
    baseline: 0,
    delta: 2,
    diagnosticCode: "air.review.debug_metric_event_bus"
  }
});
assert.strictEqual(trendDiagnostic.fields.baseline, 0);
assert.strictEqual(trendDiagnostic.fields.delta, 2);
assert.strictEqual(trendDiagnostic.fields.diagnosticCode, "air.review.debug_metric_event_bus");

console.log("ok: LSP-lite diagnostics tests");

function run(args) {
  return JSON.parse(cp.execFileSync(process.execPath, [airc, ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }));
}

function runFails(args) {
  const result = cp.spawnSync(process.execPath, [airc, ...args], {
    cwd: root,
    encoding: "utf8"
  });
  assert.notStrictEqual(result.status, 0, `expected failure: ${args.join(" ")}`);
  return JSON.parse(result.stdout);
}

function writePackage(dir, options) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "module.air"), options.source);
  fs.writeFileSync(path.join(dir, "air.package.json"), JSON.stringify({
    name: options.name,
    version: "0.1.0",
    airAbi: "0.10",
    hostAbi: options.hostAbi || "0.10",
    entry: "module.air",
    capabilities: options.capabilities || [],
    targetProfiles: options.targetProfiles || ["verifier-only"],
    generatedModules: options.generatedModules || [],
    outputContracts: options.outputContracts || [],
    ...(options.reviewPolicy ? { reviewPolicy: options.reviewPolicy } : {})
  }, null, 2));
}

function writeOutputEmitPackage(dir, options = {}) {
  writePackage(dir, {
    name: options.name,
    hostAbi: options.hostAbi || "0.11",
    capabilities: options.capabilities === undefined ? ["output"] : options.capabilities,
    targetProfiles: options.targetProfiles || ["mock-output-v011"],
    outputContracts: options.outputContracts === undefined ? ["outputs/contracts.json"] : options.outputContracts,
    source: options.source || outputEmitModule(options.name.replace(/-/g, "_"))
  });
  if (options.outputContracts !== undefined && options.outputContracts.length === 0) return;
  writeJson(path.join(dir, "outputs", "contracts.json"), outputEmitContract(options.contractArg3Type || "i32"));
}

function outputEmitModule(moduleName, options = {}) {
  const capabilities = options.capabilities === undefined ? "capabilities { output }\n" : options.capabilities;
  const effects = options.effects === undefined ? "effects { output.emit <= 1 }\n" : options.effects;
  const setup = options.setup || "  %zero:i32 = const.i32 0\n";
  const outputId = options.outputId || "OUT_ALERT";
  const callArgs = options.callArgs || `${outputId}, %zero, %zero, %zero, %zero`;
  return `module ${moduleName}
const OUT_ALERT:i32 = ${options.constValue === undefined ? 1 : options.constValue}
${capabilities}${effects}extern output.emit(output_id: i32, arg0: i32, arg1: i32, arg2: i32, arg3: i32) -> i32

export func run() -> i32 {
entry:
${setup}  %status:i32 = @output.emit(${callArgs})
  return %status
}
`;
}

function outputEmitContract(arg3Type = "i32") {
  return {
    schemaVersion: "0.18",
    kind: "air.outputContract",
    outputs: [{
      id: 1,
      name: "incident_recommend_action",
      channel: "policy",
      capability: "output.emit",
      args: [
        { name: "arg0", type: "i32" },
        { name: "arg1", type: "i32" },
        { name: "arg2", type: "i32" },
        { name: "arg3", type: arg3Type }
      ]
    }]
  };
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function largeAirModule(moduleName, functionName, statements) {
  const lines = [
    `module ${moduleName}`,
    "capabilities { }",
    "",
    `export func ${functionName}(value: i32) -> i32 {`,
    "entry:",
    "  %one:i32 = const.i32 1",
    "  %v0:i32 = i32.add %value, %one"
  ];
  for (let i = 1; i < statements; i += 1) {
    lines.push(`  %v${i}:i32 = i32.add %v${i - 1}, %one`);
  }
  lines.push(`  return %v${statements - 1}`);
  lines.push("}");
  lines.push("");
  return lines.join("\n");
}

function stateModule(moduleName, length = 4) {
  return `module ${moduleName}
state board:i32[${length}] = fill 0
capabilities { }

export func run() -> i32 {
entry:
  %value:i32 = state.len board
  return %value
}
`;
}

function stateAccessorModule(moduleName, extraStatement = "") {
  const extra = extraStatement ? `  ${extraStatement}\n` : "";
  return `module ${moduleName}
state board:i32[4] = fill 0
capabilities { }

export func board_cell(index: i32) -> i32 {
entry:
${extra}  %value:i32 = state.get board, %index
  return %value
}
`;
}

function stateAccessorPolicy(name, state) {
  return {
    schemaVersion: "0.24",
    kind: "air.stateAccessorPolicy",
    helpers: [{ name, state, mode: "readCell", exported: true, observationOnly: true }]
  };
}

function uniqueDiagnostics(diagnostics) {
  const out = [];
  const seen = new Set();
  for (const diagnostic of diagnostics || []) {
    const key = JSON.stringify(diagnostic);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(diagnostic);
  }
  return out;
}
