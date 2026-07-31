#!/usr/bin/env node

const assert = require("assert");
const cp = require("child_process");
const fs = require("fs");
const path = require("path");
const { AirLspSession, JsonRpcStreamParser, encodeJsonRpcMessage, filePathToUri } = require("../src/lsp_server");

const root = path.resolve(__dirname, "..");
const tmp = path.join(root, "build", "lsp-server-test");

fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });

const session = new AirLspSession({ profile: "cli" });
const init = request(session, 1, "initialize", {
  rootUri: filePathToUri(tmp),
  initializationOptions: { profile: "cli" }
});
assert.strictEqual(init.length, 1);
assert.strictEqual(init[0].result.capabilities.textDocumentSync.openClose, true);
assert.strictEqual(init[0].result.capabilities.textDocumentSync.change, 1);
assert.strictEqual(init[0].result.capabilities.textDocumentSync.save.includeText, false);
assert.deepStrictEqual(Object.keys(init[0].result.capabilities).sort(), [
  "documentFormattingProvider",
  "hoverProvider",
  "textDocumentSync"
]);
assert.strictEqual(init[0].result.capabilities.documentFormattingProvider, true);
assert.strictEqual(init[0].result.capabilities.hoverProvider, true);
assert.strictEqual(init[0].result.capabilities.codeActionProvider, undefined);
assert.strictEqual(init[0].result.capabilities.definitionProvider, undefined);
assert.strictEqual(init[0].result.capabilities.documentSymbolProvider, undefined);

const syntaxUri = filePathToUri(path.join(tmp, "syntax.air"));
let published = notify(session, "textDocument/didOpen", {
  textDocument: {
    uri: syntaxUri,
    languageId: "air",
    version: 1,
    text: `module syntax_error
capabilities { }

not valid syntax
`
  }
});
let syntaxDiagnostics = diagnosticsFor(published, syntaxUri);
assert(syntaxDiagnostics.some((diagnostic) => diagnostic.code === "air.parser.syntax"));
assert.strictEqual(syntaxDiagnostics[0].severity, 1);

published = notify(session, "textDocument/didChange", {
  textDocument: { uri: syntaxUri, version: 2 },
  contentChanges: [{
    text: `module syntax_error
capabilities { }

export func run() -> i32 {
entry:
  %ok:i32 = const.i32 1
  return %ok
}
`
  }]
});
assert.deepStrictEqual(diagnosticsFor(published, syntaxUri), []);

const formatting = request(session, 2, "textDocument/formatting", {
  textDocument: { uri: syntaxUri },
  options: { tabSize: 2, insertSpaces: true }
});
assert.strictEqual(formatting.length, 1);
assert.strictEqual(formatting[0].result.length, 1);
assert.strictEqual(formatting[0].result[0].newText, `module syntax_error
capabilities { }

export func run() -> i32 {
entry:
  %ok:i32 = 1
  return %ok
}
`);

const hoverUri = filePathToUri(path.join(tmp, "hover.air"));
notify(session, "textDocument/didOpen", {
  textDocument: {
    uri: hoverUri,
    languageId: "air",
    version: 1,
    text: `module hover_surface
capabilities { debug }
effects { cpu.instructions <= 12 }

export func run() -> i32 {
entry:
  %ok:i32 = 1
  return %ok
}
`
  }
});
const capabilityHover = request(session, 3, "textDocument/hover", {
  textDocument: { uri: hoverUri },
  position: { line: 1, character: 17 }
});
assert.match(capabilityHover[0].result.contents.value, /`debug`/);
assert.match(capabilityHover[0].result.contents.value, /do not grant host authority/);
const effectHover = request(session, 4, "textDocument/hover", {
  textDocument: { uri: hoverUri },
  position: { line: 2, character: 14 }
});
assert.match(effectHover[0].result.contents.value, /`cpu\.instructions <= 12`/);

const commentUri = filePathToUri(path.join(tmp, "comment.air"));
notify(session, "textDocument/didOpen", {
  textDocument: {
    uri: commentUri,
    languageId: "air",
    version: 1,
    text: `module comment_safe
# Preserve this review note.
capabilities { }

export func run() -> i32 {
entry:
  %ok:i32 = 1
  return %ok
}
`
  }
});
const commentFormatting = request(session, 5, "textDocument/formatting", {
  textDocument: { uri: commentUri },
  options: { tabSize: 2, insertSpaces: true }
});
assert.strictEqual(commentFormatting[0].error.code, -32603);
assert.match(commentFormatting[0].error.message, /air\.format\.comments_not_preserved/);

published = notify(session, "textDocument/didClose", {
  textDocument: { uri: syntaxUri }
});
assert.deepStrictEqual(diagnosticsFor(published, syntaxUri), []);
assert.strictEqual(session.documents.has(syntaxUri), false);

const verifierUri = filePathToUri(path.join(tmp, "verifier.air"));
published = notify(session, "textDocument/didOpen", {
  textDocument: {
    uri: verifierUri,
    languageId: "air",
    version: 1,
    text: `module verifier_error
capabilities { }

extern debug.metric(id: i32, value: i32) -> void

export func run() -> void {
entry:
  @debug.metric(1, 1)
  return
}
`
  }
});
const verifierDiagnostics = diagnosticsFor(published, verifierUri);
assert(verifierDiagnostics.some((diagnostic) =>
  diagnostic.code === "air.verifier.error" &&
  /requires capability 'debug'/.test(diagnostic.message) &&
  diagnostic.data.repairHint === null
));

published = notify(session, "textDocument/didSave", {
  textDocument: { uri: verifierUri }
});
const verifierSaveDiagnostics = diagnosticsFor(published, verifierUri);
assert(verifierSaveDiagnostics.some((diagnostic) => diagnostic.code === "air.verifier.error"));
assert(!codesFor(published).some((code) => code.startsWith("air.facts.") || code.startsWith("air.output_contract.")));

const factsPackage = writePackage("facts-package", {
  source: validModule("facts_pkg"),
  factSchemas: ["facts/task.facts.json"],
  files: {
    "facts/task.facts.json": {
      schemaVersion: "0.18",
      facts: [{
        id: 1,
        name: "task",
        maxRows: 8,
        columns: [{ name: "payload", type: "object" }]
      }]
    }
  }
});
published = savePackage(session, factsPackage);
assert(codesFor(published).includes("air.facts.non_scalar_column"));

const outputPackage = writePackage("output-package", {
  source: validModule("output_pkg"),
  outputContracts: ["outputs/main.output.json"],
  files: {
    "outputs/main.output.json": {
      schemaVersion: "0.18",
      kind: "air.outputContract",
      outputs: [{
        id: 1,
        name: "bad_output",
        channel: "notification",
        capability: "notify.request",
        args: [{ name: "payload", type: "string" }]
      }]
    }
  }
});
published = savePackage(session, outputPackage);
assert(codesFor(published).includes("air.output_contract.non_scalar_arg"));

const generatedPackage = writePackage("generated-package", {
  source: validModule("generated_pkg"),
  generatedModules: ["generated/missing.air"]
});
published = savePackage(session, generatedPackage);
assert(codesFor(published).includes("air.generated.stale"));

const stateHandlesPackage = writePackage("state-handles-package", {
  source: stateModule("state_handles_pkg", 4),
  generatedModules: ["generated/state_handles.air"]
});
runAirc(["generate", "state-handles", stateHandlesPackage, "--json"]);
fs.writeFileSync(path.join(stateHandlesPackage, "main.air"), stateModule("state_handles_pkg", 5));
published = savePackage(session, stateHandlesPackage);
assert(codesFor(published).includes("air.generated.state_handles_stale"));
const stateHandleDiagnostics = diagnosticsFor(published, filePathToUri(path.join(stateHandlesPackage, "main.air")));
assert.deepStrictEqual(stateHandleDiagnostics, uniqueDiagnostics(stateHandleDiagnostics));
assert.deepStrictEqual(
  stateHandleDiagnostics.map((item) => item.code),
  stateHandleDiagnostics.map((item) => item.code).slice().sort()
);

const outputHandlesPackage = writePackage("output-handles-package", {
  source: validModule("output_handles_pkg"),
  generatedModules: ["generated/output_handles.air"],
  outputContracts: ["outputs/contracts.json"],
  files: {
    "outputs/contracts.json": outputEmitContract()
  }
});
runAirc(["generate", "output-handles", outputHandlesPackage, "--json"]);
fs.writeFileSync(path.join(outputHandlesPackage, "outputs", "contracts.json"), `${JSON.stringify({
  ...outputEmitContract(),
  outputs: [{ ...outputEmitContract().outputs[0], name: "panel_set_badge" }]
}, null, 2)}\n`);
published = savePackage(session, outputHandlesPackage);
assert(codesFor(published).includes("air.generated.output_handles_stale"));
const outputHandleDiagnostics = diagnosticsFor(published, filePathToUri(path.join(outputHandlesPackage, "main.air")));
assert.deepStrictEqual(outputHandleDiagnostics, uniqueDiagnostics(outputHandleDiagnostics));
assert.deepStrictEqual(
  outputHandleDiagnostics.map((item) => item.code),
  outputHandleDiagnostics.map((item) => item.code).slice().sort()
);

const stateAccessorPackage = writePackage("state-accessor-package", {
  source: stateAccessorModule("state_accessor_pkg", "state.set board, %index, 7"),
  files: {
    "state_accessors.policy.json": stateAccessorPolicy("board_cell", "board")
  }
});
published = savePackage(session, stateAccessorPackage);
assert(codesFor(published).includes("air.state.accessor_not_observation_safe"));
const stateAccessorDiagnostics = diagnosticsFor(published, filePathToUri(path.join(stateAccessorPackage, "main.air")));
assert.deepStrictEqual(stateAccessorDiagnostics, uniqueDiagnostics(stateAccessorDiagnostics));
assert.deepStrictEqual(
  stateAccessorDiagnostics.map((item) => item.code),
  stateAccessorDiagnostics.map((item) => item.code).slice().sort()
);

const invalidStateAccessorPackage = writePackage("invalid-state-accessor-package", {
  source: stateAccessorModule("invalid_state_accessor_pkg"),
  files: {
    "state_accessors.policy.json": {
      schemaVersion: "0.99",
      kind: "air.stateAccessorPolicy",
      helpers: [{ name: "board_cell", state: "board", mode: "readCell", exported: true, observationOnly: true }]
    }
  }
});
published = savePackage(session, invalidStateAccessorPackage);
assert(codesFor(published).includes("air.state.accessor_policy_invalid"));

const compactPackage = writePackage("compact-package", {
  source: `module compact_pkg
table xs:u8 = [256]
capabilities { }

export func run() -> i32 {
entry:
  %value:i32 = table.get.u8 xs, 0
  return %value
}
`
});
published = savePackage(session, compactPackage);
assert(codesFor(published).includes("air.table.value_out_of_range"));
const compactDiagnostics = diagnosticsFor(published, filePathToUri(path.join(compactPackage, "main.air")));
const compactDiagnostic = compactDiagnostics.find((diagnostic) => diagnostic.code === "air.table.value_out_of_range");
assert(compactDiagnostic, "expected compact table diagnostic through Full LSP publishDiagnostics");
assert.strictEqual(compactDiagnostic.data.fields.table, "xs");
assert.strictEqual(compactDiagnostic.data.fields.storageType, "u8");
assert.strictEqual(compactDiagnostic.data.fields.index, 0);
assert.strictEqual(compactDiagnostic.data.fields.value, 256);
assert.strictEqual(compactDiagnostic.data.fields.allowedRange, "0..255");

const outputSession = new AirLspSession({ profile: "mock-output-v011" });
request(outputSession, 101, "initialize", {
  rootUri: filePathToUri(tmp),
  initializationOptions: { profile: "mock-output-v011" }
});

const outputEmitDynamicPackage = writeOutputEmitPackage("output-emit-dynamic-package", {
  source: outputEmitModule("output_emit_dynamic_full_lsp", {
    setup: "  %zero:i32 = const.i32 0\n  %one:i32 = const.i32 1\n  %id:i32 = i32.add %zero, %one\n",
    outputId: "%id"
  })
});
published = savePackage(outputSession, outputEmitDynamicPackage);
assert(codesFor(published).includes("air.output_emit.output_id_dynamic"));

const outputEmitInvalidPackage = writeOutputEmitPackage("output-emit-invalid-package", {
  source: outputEmitModule("output_emit_invalid_full_lsp", { constValue: 99 })
});
published = savePackage(outputSession, outputEmitInvalidPackage);
assert(codesFor(published).includes("air.output_emit.output_id_invalid"));

const outputEmitMissingCapabilityPackage = writeOutputEmitPackage("output-emit-missing-capability-package", {
  capabilities: [],
  source: outputEmitModule("output_emit_missing_capability_full_lsp", {
    capabilities: ""
  })
});
published = savePackage(outputSession, outputEmitMissingCapabilityPackage);
assert(codesFor(published).includes("air.output_emit.capability_missing"));
const outputEmitMissingCapabilityDiagnostics = diagnosticsFor(published, filePathToUri(path.join(outputEmitMissingCapabilityPackage, "main.air")));
assert.deepStrictEqual(outputEmitMissingCapabilityDiagnostics, uniqueDiagnostics(outputEmitMissingCapabilityDiagnostics));

const outputEmitMissingBudgetPackage = writeOutputEmitPackage("output-emit-missing-budget-package", {
  source: outputEmitModule("output_emit_missing_budget_full_lsp", { effects: "" })
});
published = savePackage(outputSession, outputEmitMissingBudgetPackage);
assert(codesFor(published).includes("air.output_emit.budget_exceeded"));

const outputEmitUnsupportedProfilePackage = writeOutputEmitPackage("output-emit-unsupported-profile-package", {
  targetProfiles: ["cli"]
});
published = savePackage(session, outputEmitUnsupportedProfilePackage);
assert(codesFor(published).includes("air.output_emit.profile_unsupported"));

const reviewPackage = writePackage("review-package", {
  source: largeAirModule("review_pkg", "run", 8),
  reviewPolicy: {
    schemaVersion: "0.15",
    thresholds: { largeFunctionStatements: 4 },
    gates: { "air.review.large_function": "warn" }
  }
});
published = savePackage(session, reviewPackage);
assert(codesFor(published).includes("air.review.large_function"));

const ordered = diagnosticsFor(published, filePathToUri(path.join(reviewPackage, "main.air")));
assert.deepStrictEqual(ordered, uniqueDiagnostics(ordered));
assert.deepStrictEqual(ordered.map((item) => item.code), ordered.map((item) => item.code).slice().sort());

const nestedPackage = writePackage("nested-package", {
  entry: "src/main.air",
  source: validModule("nested_pkg"),
  factSchemas: ["facts/task.facts.json"],
  files: {
    "facts/task.facts.json": {
      schemaVersion: "0.18",
      facts: [{
        id: 1,
        name: "task",
        maxRows: 4,
        columns: [{ name: "payload", type: "object" }]
      }]
    }
  }
});
const nestedMain = path.join(nestedPackage, "src/main.air");
const nestedUri = filePathToUri(nestedMain);
notify(session, "textDocument/didOpen", {
  textDocument: {
    uri: nestedUri,
    languageId: "air",
    version: 1,
    text: fs.readFileSync(nestedMain, "utf8")
  }
});
published = notify(session, "textDocument/didSave", {
  textDocument: { uri: nestedUri }
});
assert(codesFor(published).includes("air.facts.non_scalar_column"));

const shutdown = request(session, 2, "shutdown", {});
assert.strictEqual(shutdown[0].result, null);
const exit = notify(session, "exit", {});
assert.deepStrictEqual(exit, [{ __airExit: true, code: 0 }]);

const parsed = [];
const parser = new JsonRpcStreamParser((message) => parsed.push(message));
const frame = encodeJsonRpcMessage({ jsonrpc: "2.0", id: 9, method: "initialize", params: {} });
parser.push(Buffer.from(frame.slice(0, 12)));
parser.push(Buffer.from(frame.slice(12)));
assert.deepStrictEqual(parsed, [{ jsonrpc: "2.0", id: 9, method: "initialize", params: {} }]);

const cliMessages = runCliLsp([
  { jsonrpc: "2.0", id: 1, method: "initialize", params: { initializationOptions: { profile: "cli" } } },
  { jsonrpc: "2.0", id: 2, method: "shutdown", params: null },
  { jsonrpc: "2.0", method: "exit", params: null }
]);
assert.strictEqual(cliMessages[0].jsonrpc, "2.0");
assert.strictEqual(cliMessages[0].id, 1);
assert.strictEqual(cliMessages[0].result.capabilities.textDocumentSync.change, 1);
assert.strictEqual(cliMessages[1].id, 2);
assert.strictEqual(cliMessages[1].result, null);

console.log("ok: LSP server tests");

function request(targetSession, id, method, params) {
  return targetSession.handleMessage({ jsonrpc: "2.0", id, method, params });
}

function notify(targetSession, method, params) {
  return targetSession.handleMessage({ jsonrpc: "2.0", method, params });
}

function diagnosticsFor(messages, uri) {
  const message = messages.find((item) =>
    item.method === "textDocument/publishDiagnostics" &&
    item.params &&
    item.params.uri === uri
  );
  return message ? message.params.diagnostics : [];
}

function codesFor(messages) {
  return messages.flatMap((message) =>
    message.method === "textDocument/publishDiagnostics"
      ? message.params.diagnostics.map((diagnostic) => diagnostic.code)
      : []
  );
}

function savePackage(targetSession, packageDir) {
  const main = path.join(packageDir, "main.air");
  const uri = filePathToUri(main);
  notify(targetSession, "textDocument/didOpen", {
    textDocument: {
      uri,
      languageId: "air",
      version: 1,
      text: fs.readFileSync(main, "utf8")
    }
  });
  return notify(targetSession, "textDocument/didSave", {
    textDocument: { uri }
  });
}

function writePackage(name, options) {
  const dir = path.join(tmp, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const entry = options.entry || "main.air";
  fs.mkdirSync(path.dirname(path.join(dir, entry)), { recursive: true });
  fs.writeFileSync(path.join(dir, entry), options.source);
  for (const [rel, value] of Object.entries(options.files || {})) {
    const target = path.join(dir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
  }
  fs.writeFileSync(path.join(dir, "air.package.json"), `${JSON.stringify({
    name,
    version: "0.1.0",
    airAbi: "0.10",
    hostAbi: options.hostAbi || "0.10",
    entry,
    capabilities: options.capabilities || [],
    targetProfiles: options.targetProfiles || ["cli"],
    generatedModules: options.generatedModules || [],
    factSchemas: options.factSchemas || [],
    outputContracts: options.outputContracts || [],
    ...(options.reviewPolicy ? { reviewPolicy: options.reviewPolicy } : {})
  }, null, 2)}\n`);
  return dir;
}

function writeOutputEmitPackage(name, options = {}) {
  const dir = writePackage(name, {
    hostAbi: options.hostAbi || "0.11",
    capabilities: options.capabilities === undefined ? ["output"] : options.capabilities,
    targetProfiles: options.targetProfiles || ["mock-output-v011"],
    outputContracts: options.outputContracts === undefined ? ["outputs/contracts.json"] : options.outputContracts,
    source: options.source || outputEmitModule(name.replace(/-/g, "_"))
  });
  if (options.outputContracts === undefined || options.outputContracts.length) {
    const target = path.join(dir, "outputs", "contracts.json");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(outputEmitContract(), null, 2)}\n`);
  }
  return dir;
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

function outputEmitContract() {
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
        { name: "arg3", type: "i32" }
      ]
    }]
  };
}

function validModule(name) {
  return `module ${name}
capabilities { }

export func run() -> i32 {
entry:
  %ok:i32 = 1
  return %ok
}
`;
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

function runAirc(args) {
  return cp.execFileSync(process.execPath, ["bin/airc.js", ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function uniqueDiagnostics(diagnostics) {
  const out = [];
  const seen = new Set();
  for (const diagnostic of diagnostics) {
    const key = JSON.stringify(diagnostic);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(diagnostic);
  }
  return out;
}

function runCliLsp(messages) {
  const input = messages.map(encodeJsonRpcMessage).join("");
  const result = cp.spawnSync(process.execPath, ["bin/airc.js", "lsp", "--stdio"], {
    cwd: root,
    input,
    encoding: "utf8",
    timeout: 5000
  });
  if (result.error) throw result.error;
  assert.strictEqual(result.status, 0, result.stderr);
  return decodeJsonRpcMessages(result.stdout);
}

function decodeJsonRpcMessages(output) {
  const messages = [];
  const parser = new JsonRpcStreamParser((message) => messages.push(message));
  parser.push(Buffer.from(output, "utf8"));
  return messages;
}
