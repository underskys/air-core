#!/usr/bin/env node

const assert = require("assert");
const cp = require("child_process");
const fs = require("fs");
const path = require("path");
const { parseAir } = require("../src/parser");
const { verifyModule } = require("../src/verifier");
const { lowerToWat, watToWasm } = require("../src/lower_wasm");
const { createOutputImports } = require("../src/sdk");
const { AIR_ABI_VERSION } = require("../src/version");

const root = path.resolve(__dirname, "..");
const airc = path.join(root, "bin", "airc.js");
const outputEmitFixture = path.join(root, "test", "fixtures", "host_interaction", "output_emit");
const tmpRoot = path.join(root, "build", "output-emit-runtime-tests");

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

async function instantiate(source, host) {
  const mod = parseAir(source, "runtime_output_emit.air");
  verifyModule(mod);
  const wat = lowerToWat(mod);
  const wasm = await watToWasm(wat, "runtime_output_emit.air");
  const result = await WebAssembly.instantiate(wasm, createOutputImports(host));
  return { wat, instance: result.instance || result };
}

async function main() {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  fs.mkdirSync(tmpRoot, { recursive: true });

  const outputSource = `module runtime_output_emit
const OUT_NOTIFY:i32 = 1
capabilities { output }
effects { output.emit <= 1 }
extern output.emit(output_id: i32, arg0: i32, arg1: i32, arg2: i32, arg3: i32) -> i32
export func run() -> i32 {
entry:
  %zero:i32 = const.i32 0
  %status:i32 = @output.emit(OUT_NOTIFY, 7, %zero, %zero, %zero)
  return %status
}
`;

  const acceptedCalls = [];
  const accepted = await instantiate(outputSource, {
    emit(outputId, arg0, arg1, arg2, arg3) {
      acceptedCalls.push({ outputId, arg0, arg1, arg2, arg3 });
      return 0;
    }
  });
  assert.match(accepted.wat, /\(import "output" "emit"/);
  assert.strictEqual(accepted.instance.exports.run(), 0);
  assert.deepStrictEqual(acceptedCalls, [{ outputId: 1, arg0: 7, arg1: 0, arg2: 0, arg3: 0 }]);

  const denied = await instantiate(outputSource, {
    emit() {
      return 1;
    }
  });
  assert.strictEqual(denied.instance.exports.run(), 1);

  const plainSource = `module no_output_emit
export func run() -> i32 {
entry:
  return 42
}
`;
  const plain = parseAir(plainSource, "no_output_emit.air");
  verifyModule(plain);
  const plainWat = lowerToWat(plain);
  assert(!plainWat.includes('(import "output" "emit"'));

  assert.throws(() => createOutputImports({}).output.emit(1, 0, 0, 0, 0), /host missing output\.emit/);

  const dynamicSource = outputSource.replace(
    "%status:i32 = @output.emit(OUT_NOTIFY, 7, %zero, %zero, %zero)",
    "%id:i32 = i32.add %zero, 1\n  %status:i32 = @output.emit(%id, 7, %zero, %zero, %zero)"
  );
  assert.throws(() => verifyModule(parseAir(dynamicSource, "dynamic_output_id.air")), /output\.emit output_id must be a statically resolvable/);

  const packageReport = JSON.parse(run(["package-check", outputEmitFixture, "--profile", "mock-output-v011", "--source-only", "--json"]));
  assert.strictEqual(packageReport.status, "pass");
  assert.strictEqual(packageReport.hostAbi, "0.11");
  assert.strictEqual(packageReport.profileSupport.hostAbi, "0.11");
  assert.strictEqual(packageReport.profileSupport.requiredHostAbi, "0.11");
  assert(packageReport.checks.some((check) => check.id === "output-emit" && check.status === "pass"));

  const unsupported = runStatus(["package-check", outputEmitFixture, "--profile", "cli", "--source-only", "--json"]);
  assert.notStrictEqual(unsupported.status, 0);
  const unsupportedReport = JSON.parse(unsupported.stdout);
  assert(unsupportedReport.diagnostics.some((item) => item.code === "air.output_emit.profile_unsupported"));

  const tracePath = path.join(outputEmitFixture, "traces", "accepted_emit.json");
  const allowPolicyPath = path.join(outputEmitFixture, "host_policies", "allow.policy.json");
  const denyPolicyPath = path.join(outputEmitFixture, "host_policies", "deny.policy.json");
  const allowedText = run(["mock-host", outputEmitFixture, "--policy", allowPolicyPath, "--profile", "mock-output-v011", "--trace", tracePath, "--json"]);
  assert.strictEqual(allowedText, run(["mock-host", outputEmitFixture, "--policy", allowPolicyPath, "--profile", "mock-output-v011", "--trace", tracePath, "--json"]));
  const allowedEvidence = JSON.parse(allowedText);
  assert.strictEqual(allowedEvidence.status, "passed");
  assert.strictEqual(allowedEvidence.hostAbi, "0.11");
  assert.strictEqual(allowedEvidence.decisions[0].statusCode, 0);
  assert.strictEqual(allowedEvidence.decisions[0].decision, "allow");
  assert.strictEqual(allowedEvidence.commandRecords[0].kind, "output.emit");
  assert.deepStrictEqual(allowedEvidence.outputContracts, [{
    argCount: 4,
    capability: "output.emit",
    channel: "policy",
    contract: "outputs/output_contracts.json",
    id: 1,
    name: "notify_status_recorded"
  }]);
  for (const key of ["payload", "data", "object", "json", "raw_url", "raw_text", "private_text", "hostObject"]) {
    assert(!Object.prototype.hasOwnProperty.call(allowedEvidence.commandRecords[0], key));
  }
  assert(!allowedText.includes(root));
  assert(!/20[0-9]{2}-[0-9]{2}-[0-9]{2}T/.test(allowedText));

  const hostEvidencePath = path.join(tmpRoot, "host_interaction.evidence.json");
  fs.writeFileSync(hostEvidencePath, allowedText);
  const verificationEvidence = JSON.parse(run(["verify", "package", outputEmitFixture, "--profile", "mock-output-v011", "--host-evidence", hostEvidencePath, "--json"]));
  assert.strictEqual(verificationEvidence.status, "passed");
  assert.strictEqual(verificationEvidence.hostAbi, "0.11");
  assert.strictEqual(verificationEvidence.profileCompatibility.requiredHostAbi, "0.11");
  assert.strictEqual(verificationEvidence.profileCompatibility.supportedHostAbi, "0.11");
  assert.strictEqual(verificationEvidence.outputEmit.count, 1);
  assert.strictEqual(verificationEvidence.outputEmit.outputs[0].outputId, 1);
  assert.strictEqual(verificationEvidence.outputEmit.outputs[0].outputCapability, "output.emit");
  assert.strictEqual(verificationEvidence.outputEmit.outputs[0].outputArgCount, 4);
  assert.strictEqual(verificationEvidence.hostInteractionEvidence.decisions[0].statusCode, 0);

  const deniedEvidence = JSON.parse(run(["mock-host", outputEmitFixture, "--policy", denyPolicyPath, "--profile", "mock-output-v011", "--trace", tracePath, "--json"]));
  assert.strictEqual(deniedEvidence.status, "passed");
  assert.strictEqual(deniedEvidence.decisions[0].statusCode, 1);
  assert.strictEqual(deniedEvidence.decisions[0].decision, "deny");
  assert(deniedEvidence.diagnostics.some((item) => item.code === "air.host_policy.denied_output"));

  const unknownTracePath = path.join(tmpRoot, "unknown_emit.json");
  fs.writeFileSync(unknownTracePath, JSON.stringify({
    observedOutputEmits: [{
      output_id: 99,
      arg0: 7,
      arg1: 0,
      arg2: 0,
      arg3: 0
    }]
  }, null, 2));
  const unknownEvidenceStatus = runStatus(["mock-host", outputEmitFixture, "--policy", allowPolicyPath, "--profile", "mock-output-v011", "--trace", unknownTracePath, "--json"]);
  assert.notStrictEqual(unknownEvidenceStatus.status, 0);
  const unknownEvidence = JSON.parse(unknownEvidenceStatus.stdout);
  assert.strictEqual(unknownEvidence.status, "failed");
  assert.strictEqual(unknownEvidence.decisions[0].statusCode, 3);
  assert(unknownEvidence.diagnostics.some((item) => item.code === "air.host_policy.unknown_output"));

  const unsupportedEvidenceStatus = runStatus(["mock-host", outputEmitFixture, "--policy", allowPolicyPath, "--profile", "cli", "--trace", tracePath, "--json"]);
  assert.notStrictEqual(unsupportedEvidenceStatus.status, 0);
  const unsupportedEvidence = JSON.parse(unsupportedEvidenceStatus.stdout);
  assert.strictEqual(unsupportedEvidence.status, "failed");
  assert(unsupportedEvidence.diagnostics.some((item) => item.code === "air.host_policy.unsupported_profile"));

  assert.strictEqual(AIR_ABI_VERSION, "0.10");
  console.log("output emit runtime tests passed");
}

main().catch((err) => {
  console.error(err && err.stack || err);
  process.exit(1);
});
