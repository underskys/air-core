#!/usr/bin/env node

const assert = require("assert");
const cp = require("child_process");
const fs = require("fs");
const path = require("path");
const { validateCommandBufferSchema } = require("../src/command_buffer_schema");
const { AIR_ABI_VERSION } = require("../src/version");
const { HOST_ABI_VERSION } = require("../src/package_manifest");

const root = path.resolve(__dirname, "..");
const airc = path.join(root, "bin", "airc.js");
const fixture = path.join(root, "test", "fixtures", "conformance_batch", "flowdesk");
const tmp = path.join(root, "build", "command-buffer-schema-tests");

function run(args) {
  return cp.execFileSync(process.execPath, [airc, ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function runStatus(args) {
  return cp.spawnSync(process.execPath, [airc, ...args], {
    cwd: root,
    encoding: "utf8"
  });
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function copyFixture(name) {
  const dir = path.join(tmp, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.cpSync(fixture, dir, { recursive: true });
  return dir;
}

function validBuffer(overrides = {}) {
  return {
    schemaVersion: "0.20",
    kind: "air.commandBuffer",
    name: "task_policy_commands",
    maxCommands: 4,
    records: [{
      output_id: 1001,
      arg0: 101,
      arg1: 3,
      arg2: 1,
      arg3: 0
    }],
    ...overrides
  };
}

function assertInvalid(schema, code, message) {
  const report = validateCommandBufferSchema(schema, {
    relativePath: "outputs/task_policy.commands.json",
    knownOutputIds: new Set([1001])
  });
  assert.strictEqual(report.ok, false);
  assert(report.diagnostics.some((diagnostic) => diagnostic.code === code && (!message || message.test(diagnostic.message))), JSON.stringify(report.diagnostics, null, 2));
}

fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });

const valid = validateCommandBufferSchema(validBuffer(), {
  relativePath: "outputs/task_policy.commands.json",
  knownOutputIds: new Set([1001])
});
assert.strictEqual(valid.ok, true);
assert.strictEqual(valid.kind, "air.commandBuffer");
assert.strictEqual(valid.maxCommands, 4);
assert.deepStrictEqual(valid.usedOutputIds, [1001]);

assertInvalid(validBuffer({ records: [{ output_id: 9999, arg0: 0, arg1: 0, arg2: 0, arg3: 0 }] }), "air.command_buffer.unknown_output_id", /not declared/);
assertInvalid(validBuffer({ maxCommands: 1, records: [
  { output_id: 1001, arg0: 1, arg1: 0, arg2: 0, arg3: 0 },
  { output_id: 1001, arg0: 2, arg1: 0, arg2: 0, arg3: 0 }
] }), "air.command_buffer.capacity_exceeded", /exceeds maxCommands/);
assertInvalid(validBuffer({ records: [{ output_id: 1001, arg0: "payload", arg1: 0, arg2: 0, arg3: 0 }] }), "air.command_buffer.non_scalar_arg", /must be an i32/);
assertInvalid(validBuffer({ generatedAt: "2026-05-23T00:00:00Z" }), "air.command_buffer.timestamp_field", /must not encode/);
assertInvalid(validBuffer({ sourcePath: "/tmp/commands.json" }), "air.command_buffer.absolute_path", /absolute paths/);
assertInvalid(validBuffer({ records: [{ output_id: 1001, arg0: 0, arg1: 0, arg2: 0, arg3: 0, payload: { action: "run" } }] }), "air.command_buffer.schema_invalid", /payload is not allowed/);
assertInvalid(validBuffer({ data: [{ output_id: 1001 }] }), "air.command_buffer.schema_invalid", /data is not allowed/);

const validPackage = copyFixture("valid-package");
const check = JSON.parse(run(["package-check", validPackage, "--profile", "cli", "--source-only", "--json"]));
assert.strictEqual(check.status, "pass");
assert.strictEqual(check.commandBuffers.schemas[0].kind, "air.commandBuffer");
assert.strictEqual(check.commandBuffers.schemas[0].maxCommands, 4);
assert.deepStrictEqual(check.commandBuffers.outputIntentUsage.map((item) => item.output_id), [1001]);
assert(!JSON.stringify(check.commandBuffers).includes(root));

const report = JSON.parse(run(["report", "package", validPackage, "--json"]));
assert.strictEqual(report.commandBuffers.schemas[0].records[0].output_id, 1001);
assert.deepStrictEqual(report.commandBuffers.outputIntentUsage[0].buffers, ["outputs/task_policy.commands.json"]);

const evidence = JSON.parse(run(["verify", "package", validPackage, "--profile", "cli", "--json"]));
assert.strictEqual(evidence.status, "passed");
assert(evidence.commandBuffers.some((item) => item.kind === "air.commandBuffer" && item.usedOutputIds.includes(1001)));

const invalidOutput = copyFixture("unknown-output-package");
const invalidBufferPath = path.join(invalidOutput, "outputs", "task_policy.commands.json");
writeJson(invalidBufferPath, validBuffer({ records: [{ output_id: 9999, arg0: 0, arg1: 0, arg2: 0, arg3: 0 }] }));
const invalidOutputStatus = runStatus(["package-check", invalidOutput, "--profile", "cli", "--source-only", "--json"]);
assert.notStrictEqual(invalidOutputStatus.status, 0);
const invalidOutputReport = JSON.parse(invalidOutputStatus.stdout);
assert(invalidOutputReport.diagnostics.some((diagnostic) => diagnostic.code === "air.command_buffer.unknown_output_id"));

const exceeded = copyFixture("capacity-exceeded-package");
writeJson(path.join(exceeded, "outputs", "task_policy.commands.json"), validBuffer({ maxCommands: 1, records: [
  { output_id: 1001, arg0: 101, arg1: 3, arg2: 1, arg3: 0 },
  { output_id: 1001, arg0: 102, arg1: 2, arg2: 0, arg3: 0 }
] }));
const exceededStatus = runStatus(["package-check", exceeded, "--profile", "cli", "--source-only", "--json"]);
assert.notStrictEqual(exceededStatus.status, 0);
const exceededReport = JSON.parse(exceededStatus.stdout);
assert(exceededReport.diagnostics.some((diagnostic) => diagnostic.code === "air.command_buffer.capacity_exceeded"));

const wrongTrace = JSON.parse(fs.readFileSync(path.join(validPackage, "traces", "pass.json"), "utf8"));
wrongTrace.id = "flowdesk-wrong-command-args";
wrongTrace.expectedCommands[0].arg1 = 4;
const wrongTracePath = path.join(tmp, "wrong-command-args.json");
writeJson(wrongTracePath, wrongTrace);
const wrong = runStatus(["conformance", validPackage, "--profile", "cli", "--trace", wrongTracePath, "--json"]);
assert.notStrictEqual(wrong.status, 0);
const wrongReport = JSON.parse(wrong.stdout);
assert(wrongReport.mismatches.some((item) => item.kind === "wrong_args" && /command record/.test(item.message)));

const wrongCountTrace = JSON.parse(fs.readFileSync(path.join(validPackage, "traces", "pass.json"), "utf8"));
wrongCountTrace.id = "flowdesk-wrong-command-count";
wrongCountTrace.expectedCommands.push({ output_id: 1001, arg0: 102, arg1: 2, arg2: 0, arg3: 0 });
const wrongCountTracePath = path.join(tmp, "wrong-command-count.json");
writeJson(wrongCountTracePath, wrongCountTrace);
const wrongCount = runStatus(["conformance", validPackage, "--profile", "cli", "--trace", wrongCountTracePath, "--json"]);
assert.notStrictEqual(wrongCount.status, 0);
const wrongCountReport = JSON.parse(wrongCount.stdout);
assert(wrongCountReport.mismatches.some((item) => item.kind === "wrong_output_count" && /command record/.test(item.message)));

const nondeterministicTrace = JSON.parse(fs.readFileSync(path.join(validPackage, "traces", "pass.json"), "utf8"));
nondeterministicTrace.id = "flowdesk-nondeterministic-command";
nondeterministicTrace.observedCommands[0].generatedAt = "2026-05-23T00:00:00Z";
const nondeterministicTracePath = path.join(tmp, "nondeterministic-command.json");
writeJson(nondeterministicTracePath, nondeterministicTrace);
const nondeterministic = runStatus(["conformance", validPackage, "--profile", "cli", "--trace", nondeterministicTracePath, "--json"]);
assert.notStrictEqual(nondeterministic.status, 0);
const nondeterministicReport = JSON.parse(nondeterministic.stdout);
assert(nondeterministicReport.mismatches.some((item) => item.kind === "nondeterministic_output"));

const first = run(["conformance", validPackage, "--profile", "cli", "--trace", path.join(validPackage, "traces", "pass.json"), "--json"]);
const second = run(["conformance", validPackage, "--profile", "cli", "--trace", path.join(validPackage, "traces", "pass.json"), "--json"]);
assert.strictEqual(first, second);
const conformance = JSON.parse(first);
assert.strictEqual(conformance.commands.observed[0].output_id, 1001);
assert.match(conformance.replayChecksum, /^sha256:[a-f0-9]{64}$/);

assert.strictEqual(AIR_ABI_VERSION, "0.10");
assert.strictEqual(HOST_ABI_VERSION, "0.10");

console.log("ok: command buffer schema tests");
