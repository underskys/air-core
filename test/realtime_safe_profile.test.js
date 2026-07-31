#!/usr/bin/env node
"use strict";

const assert = require("assert");
const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { parseAir } = require("../src/parser");
const { validatePackageManifest } = require("../src/package_manifest");
const {
  assertRealtimeSafeProfile,
  createVerifiedResourceCertificate,
  verifyModule
} = require("../src/verifier");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "examples", "realtime_safe", "module.air"), "utf8");
const profile = {
  mode: "realtime_safe",
  entrypoint: "step",
  maximumFuel: 64,
  airAbi: "0.11",
  feature: "borrowed-slice-v1",
  stateParameters: ["state"]
};
const policy = {
  mode: "required",
  requiredBounds: ["borrowedMemory", "effects", "hostCalls", "loops", "memory"]
};

function parsed(text = source) {
  return parseAir(text.trim(), "<realtime-safe-profile>", { resolveSourceImports: false });
}

function certificate(mod) {
  return createVerifiedResourceCertificate(mod, {
    packageName: "realtime-safe-profile-test",
    mode: "required",
    policy
  });
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => error && String(error.message).includes(code));
}

const valid = parsed();
verifyModule(valid);
const validCertificate = certificate(valid);
const result = assertRealtimeSafeProfile(valid, profile, validCertificate);
assert.strictEqual(result.mode, "realtime_safe");
assert.strictEqual(result.entrypoint, "step");
assert.strictEqual(result.airAbi, "0.11");
assert.strictEqual(result.feature, "borrowed-slice-v1");
assert(result.instructionUpperBound > 0);
assert(result.instructionUpperBound <= profile.maximumFuel);
assert.strictEqual(result.loopFuelUpperBound, 0);

const capability = parsed();
capability.capabilities.add("debug");
expectCode(
  () => assertRealtimeSafeProfile(capability, profile, certificate(capability)),
  "air.realtime.capability_forbidden"
);

const hostCall = parsed();
hostCall.externs.push({
  name: "debug.metric",
  external: true,
  params: [],
  returnType: "void",
  loc: { file: "<realtime-safe-profile>", line: 1 }
});
expectCode(
  () => assertRealtimeSafeProfile(hostCall, profile, certificate(hostCall)),
  "air.realtime.host_call_forbidden"
);

const effect = parsed();
effect.effects.push({ key: "memory.load", op: "<=", limit: 1 });
expectCode(
  () => assertRealtimeSafeProfile(effect, profile, certificate(effect)),
  "air.realtime.effect_forbidden"
);

const logging = parsed();
logging.functions[0].blocks[0].instructions.splice(-1, 0, {
  op: "print",
  args: [{ kind: "string", value: "forbidden" }],
  loc: { file: "<realtime-safe-profile>", line: 4 }
});
expectCode(
  () => assertRealtimeSafeProfile(logging, profile, validCertificate),
  "air.realtime.logging_forbidden"
);

const allocation = parsed();
allocation.functions[0].blocks[0].instructions.splice(-1, 0, {
  op: "alloc_region",
  result: "temporary",
  resultType: "ptr",
  args: [{ kind: "number", value: 4 }],
  loc: { file: "<realtime-safe-profile>", line: 4 }
});
expectCode(
  () => assertRealtimeSafeProfile(allocation, profile, validCertificate),
  "air.realtime.allocation_forbidden"
);

const freeing = parsed();
freeing.functions[0].blocks[0].instructions.splice(-1, 0, {
  op: "free_region",
  args: [{ kind: "value", name: "temporary" }],
  loc: { file: "<realtime-safe-profile>", line: 4 }
});
expectCode(
  () => assertRealtimeSafeProfile(freeing, profile, validCertificate),
  "air.realtime.free_forbidden"
);

const hiddenState = parsed();
hiddenState.globals.push({
  name: "hidden",
  type: "i32",
  init: { op: "const.i32", args: [{ kind: "number", value: 0 }] },
  loc: { file: "<realtime-safe-profile>", line: 1 }
});
expectCode(
  () => assertRealtimeSafeProfile(hiddenState, profile, validCertificate),
  "air.realtime.hidden_state_forbidden"
);

const unbounded = parsed();
unbounded.functions[0].blocks[0].instructions.splice(-1, 0, {
  op: "loop.fold.i32",
  result: "loop_result",
  resultType: "i32",
  args: [
    { kind: "function", name: "step" },
    { kind: "number", value: 0 },
    { kind: "value", name: "unknown_count" }
  ],
  loc: { file: "<realtime-safe-profile>", line: 4 }
});
expectCode(
  () => assertRealtimeSafeProfile(unbounded, profile, validCertificate),
  "air.realtime.unbounded_work_forbidden"
);

const asyncWork = parsed();
asyncWork.functions[0].blocks[0].instructions.splice(-1, 0, {
  op: "io.poll_bounded",
  result: "poll_result",
  resultType: "i32",
  args: [{ kind: "number", value: 0 }, { kind: "number", value: 1 }],
  loc: { file: "<realtime-safe-profile>", line: 4 }
});
expectCode(
  () => assertRealtimeSafeProfile(asyncWork, profile, validCertificate),
  "air.realtime.async_forbidden"
);

expectCode(
  () => assertRealtimeSafeProfile(valid, { ...profile, airAbi: "0.10" }, validCertificate),
  "air.realtime.abi_feature_mismatch"
);
expectCode(
  () => assertRealtimeSafeProfile(valid, { ...profile, entrypoint: "missing" }, validCertificate),
  "air.realtime.entrypoint_invalid"
);
expectCode(
  () => assertRealtimeSafeProfile(valid, { ...profile, stateParameters: ["input"] }, validCertificate),
  "air.realtime.state_parameter_invalid"
);
expectCode(
  () => assertRealtimeSafeProfile(valid, { ...profile, maximumFuel: 1 }, validCertificate),
  "air.realtime.fuel_exceeded"
);

const optionalCertificate = createVerifiedResourceCertificate(valid, {
  packageName: "realtime-safe-profile-test",
  mode: "optional"
});
expectCode(
  () => assertRealtimeSafeProfile(valid, profile, optionalCertificate),
  "air.realtime.certificate_invalid"
);

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "air-realtime-profile-"));
fs.copyFileSync(
  path.join(root, "examples", "realtime_safe", "module.air"),
  path.join(temp, "module.air")
);
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, "examples", "realtime_safe", "air.package.json"), "utf8")
);
manifest.executionProfile.surprise = true;
fs.writeFileSync(path.join(temp, "air.package.json"), JSON.stringify(manifest, null, 2));
assert.throws(
  () => validatePackageManifest(temp, { built: false }),
  /executionProfile\.surprise is not supported/
);
delete manifest.executionProfile.surprise;
manifest.executionProfile.airAbi = "0.10";
fs.writeFileSync(path.join(temp, "air.package.json"), JSON.stringify(manifest, null, 2));
assert.throws(
  () => validatePackageManifest(temp, { built: false }),
  /executionProfile\.airAbi must be 0\.11/
);

fs.copyFileSync(
  path.join(root, "examples", "realtime_safe", "air.package.json"),
  path.join(temp, "air.package.json")
);
const cli = path.join(root, "bin", "airc.js");
const modulePath = path.join(temp, "module.air");
const wasmPath = path.join(temp, "module.wasm");
const build = childProcess.spawnSync(
  process.execPath,
  [cli, "build", modulePath, "--emit", "wasm", "-o", wasmPath],
  { cwd: root, encoding: "utf8" }
);
assert.strictEqual(build.status, 0, build.stderr || build.stdout);

fs.writeFileSync(modulePath, source.replace("capabilities { }", "capabilities { debug }"));
function runPackageCheck() {
  return childProcess.spawnSync(
    process.execPath,
    [cli, "package-check", temp, "--json"],
    { cwd: root, encoding: "utf8" }
  );
}

const failedPackageCheck = runPackageCheck();
assert.strictEqual(failedPackageCheck.status, 1, failedPackageCheck.stderr || failedPackageCheck.stdout);
const failedPackageReport = JSON.parse(failedPackageCheck.stdout);
assert.strictEqual(failedPackageReport.status, "fail");
const executionProfileCheck = failedPackageReport.checks.find(
  (check) => check.id === "execution-profile:realtime_safe"
);
assert(executionProfileCheck, "package-check must evaluate the declared realtime_safe profile");
assert.match(executionProfileCheck.message, /air\.realtime\.capability_forbidden/);
assert.doesNotMatch(`${failedPackageCheck.stdout}\n${failedPackageCheck.stderr}`, /\n\s*at\s+/);

const repeatedPackageCheck = runPackageCheck();
assert.strictEqual(repeatedPackageCheck.status, 1);
assert.strictEqual(repeatedPackageCheck.stdout, failedPackageCheck.stdout);
assert.strictEqual(repeatedPackageCheck.stderr, failedPackageCheck.stderr);

console.log(JSON.stringify({
  status: "pass",
  realtimeRules: 14,
  profileManifestCases: 2,
  cliFailClosedCases: 1,
  instructionUpperBound: result.instructionUpperBound
}));
