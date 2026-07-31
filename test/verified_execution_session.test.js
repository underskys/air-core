#!/usr/bin/env node
"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const air = require("../src");
const { parseAir } = require("../src/parser");
const { lowerToWat, watToWasm } = require("../src/lower_wasm");
const { verifyModule } = require("../src/verifier");

const root = path.resolve(__dirname, "..");

function writeI32(view, value) {
  new DataView(view.buffer, view.byteOffset, view.byteLength).setInt32(0, value, true);
}

function readI32(view) {
  return new DataView(view.buffer, view.byteOffset, view.byteLength).getInt32(0, true);
}

async function createBuiltPackage(name = "session") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `air-realtime-${name}-`));
  const source = fs.readFileSync(path.join(root, "examples", "realtime_safe", "module.air"), "utf8");
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, "examples", "realtime_safe", "air.package.json"), "utf8")
  );
  manifest.name = `realtime-safe-${name}`;
  fs.writeFileSync(path.join(dir, "module.air"), source);
  fs.writeFileSync(path.join(dir, "air.package.json"), JSON.stringify(manifest, null, 2));
  const mod = parseAir(source, path.join(dir, "module.air"));
  verifyModule(mod);
  const wasm = await watToWasm(lowerToWat(mod), path.join(dir, "module.air"));
  fs.writeFileSync(path.join(dir, "module.wasm"), wasm);
  const certificate = air.createPackageResourceCertificate(dir, { certificateRequired: true });
  return { certificate, dir };
}

function memoryPlan() {
  return {
    input: descriptor(0, "readonly"),
    output: descriptor(16, "writeonly"),
    state: descriptor(32, "readwrite")
  };
}

function descriptor(byteOffset, access) {
  return {
    byteOffset,
    actualLength: 4,
    maxLength: 4,
    access,
    alignment: 4,
    aliasGroup: null,
    memoryDomain: "wasm-linear",
    transferMode: "wasm_memory_view"
  };
}

async function prepare(pkg, plan = memoryPlan(), options = {}) {
  return air.createVerifiedExecutionSession({
    packageDir: pkg.dir,
    resourceCertificate: pkg.certificate,
    entrypoint: "step",
    memoryPlan: plan,
    arguments: { delta: 1 },
    ...options
  });
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => error && error.code === code);
}

(async () => {
  assert.strictEqual(typeof air.createVerifiedExecutionSession, "function");
  const pkg = await createBuiltPackage("valid");
  const plan = memoryPlan();
  const session = await prepare(pkg, plan);
  assert.strictEqual(session.kind, "air.verifiedExecutionSession");
  assert.strictEqual(session.schemaVersion, "0.50");
  assert(Object.isFrozen(session));
  assert(Object.isFrozen(plan));
  assert(Object.isFrozen(plan.input));
  assert.match(session.preparationEvidence.preparationDigest, /^sha256:[0-9a-f]{64}$/);
  assert.strictEqual(session.preparationEvidence.warmup, "completed_outside_invocation");

  const input = session.memoryView("input");
  const output = session.memoryView("output");
  const state = session.memoryView("state");
  writeI32(input, 2);
  writeI32(state, 10);
  assert.strictEqual(readI32(state), 10, "warmup must restore explicit state");
  assert.strictEqual(session.invoke(), 13);
  assert.strictEqual(readI32(output), 13);
  assert.strictEqual(readI32(state), 13);
  assert.strictEqual(session.invoke(), 16);
  assert.strictEqual(readI32(state), 16, "explicit borrowed state must persist");
  assert.deepStrictEqual(session.counters(), {
    invocationCount: 2,
    failureCount: 0,
    lastFailureCode: 0,
    maximumObservedBoundedFuel: session.preparationEvidence.profile.instructionUpperBound,
    lastResult: 16,
    closed: false
  });

  const originalStringify = JSON.stringify;
  const originalCreateHash = crypto.createHash;
  JSON.stringify = () => {
    throw new Error("serializer entered realtime path");
  };
  crypto.createHash = () => {
    throw new Error("hash entered realtime path");
  };
  try {
    assert.strictEqual(session.invoke(), 19);
  } finally {
    JSON.stringify = originalStringify;
    crypto.createHash = originalCreateHash;
  }
  const evidence = session.evidence();
  assert.match(evidence.evidenceDigest, /^sha256:[0-9a-f]{64}$/);
  assert.strictEqual(evidence.counters.invocationCount, 3);

  const originalIterator = Array.prototype[Symbol.iterator];
  let reentered = false;
  Array.prototype[Symbol.iterator] = function realtimeReentryProbe() {
    if (!reentered) {
      reentered = true;
      session.invoke();
    }
    return originalIterator.call(this);
  };
  let reentryError = null;
  try {
    session.invoke();
  } catch (error) {
    reentryError = error;
  } finally {
    Array.prototype[Symbol.iterator] = originalIterator;
  }
  assert.strictEqual(reentryError && reentryError.code, "air.realtime.concurrent_invocation");
  expectCode(() => session.invoke(Promise.resolve()), "air.realtime.invoke_arguments_forbidden");
  expectCode(() => session.invoke(() => session.invoke()), "air.realtime.invoke_arguments_forbidden");
  session.close();
  expectCode(() => session.invoke(), "air.realtime.session_closed");

  const reusablePkg = await createBuiltPackage("deterministic");
  const first = await prepare(reusablePkg);
  const second = await prepare(reusablePkg);
  for (const item of [first, second]) {
    writeI32(item.memoryView("input"), 3);
    writeI32(item.memoryView("state"), 4);
  }
  assert.strictEqual(first.invoke(), 8);
  assert.strictEqual(first.invoke(), 12);
  assert.strictEqual(second.invoke(), 8);
  assert.strictEqual(second.invoke(), 12);
  assert.deepStrictEqual(first.counters(), second.counters());
  assert.deepStrictEqual(first.evidence(), second.evidence());

  const stalePlan = memoryPlan();
  const stale = await prepare(reusablePkg, stalePlan);
  assert.throws(() => {
    stalePlan.input.byteOffset = 48;
  }, TypeError);
  const staleView = stale.memoryView("input");
  stale.memory.grow(1);
  assert.strictEqual(staleView.byteLength, 0);
  expectCode(() => stale.invoke(), "air.realtime.memory_changed");

  await assert.rejects(
    () => air.createVerifiedExecutionSession({
      packageDir: reusablePkg.dir,
      resourceCertificate: reusablePkg.certificate,
      entrypoint: "wrong",
      memoryPlan: memoryPlan(),
      arguments: { delta: 1 }
    }),
    (error) => error && error.code === "air.realtime.entrypoint_mismatch"
  );

  const substitutedCertificate = JSON.parse(JSON.stringify(reusablePkg.certificate));
  substitutedCertificate.certificateDigest = `sha256:${"f".repeat(64)}`;
  await assert.rejects(
    () => prepare(reusablePkg, memoryPlan(), { resourceCertificate: substitutedCertificate }),
    (error) => error && error.code === "air.realtime.certificate_substitution"
  );

  const changed = await createBuiltPackage("changed");
  fs.appendFileSync(path.join(changed.dir, "module.air"), "\n# package substitution\n");
  await assert.rejects(
    () => air.createVerifiedExecutionSession({
      packageDir: changed.dir,
      resourceCertificate: reusablePkg.certificate,
      entrypoint: "step",
      memoryPlan: memoryPlan(),
      arguments: { delta: 1 }
    }),
    (error) => error && error.code === "air.realtime.certificate_substitution"
  );

  const overlap = memoryPlan();
  overlap.output.byteOffset = 0;
  await assert.rejects(
    () => prepare(reusablePkg, overlap),
    (error) => error && error.code === "air.realtime.mutable_overlap"
  );

  const legacyRequest = {
    package: {
      directory: path.join(root, "examples", "tool_gate"),
      profile: "mock-output-v011",
      entrypoint: "decide",
      requiredGrant: "agent.tool.invoke",
      arguments: [
        { from: "facts", key: "amount" },
        { from: "effective", key: "amountLimit" },
        { from: "facts", key: "quotaUsed" },
        { from: "effective", key: "quotaLimit" },
        { from: "facts", key: "rateUsed" },
        { from: "effective", key: "rateLimit" },
        { from: "facts", key: "targetId" },
        { from: "effective", key: "allowedTargetId" },
        { from: "effective", key: "now" },
        { from: "effective", key: "expiresAt" },
        { from: "effective", key: "redactionFlag" }
      ]
    },
    facts: {
      amount: 25,
      quotaUsed: 1,
      rateUsed: 1,
      targetId: 7,
      requiresRedaction: true
    },
    grants: [{
      id: "agent.tool.invoke",
      decision: "allow",
      capability: "output",
      effects: ["output.emit"],
      targetId: 7,
      maxAmount: 100,
      quotaLimit: 3,
      rateLimit: 4,
      expiresAt: 2000,
      redaction: "required"
    }],
    limits: {
      maxAmount: 80,
      quotaLimit: 2,
      rateLimit: 3,
      now: 1000,
      maxOutputs: 1,
      maxHostCalls: 1
    },
    adapters: { "output.emit": "capture" }
  };
  const legacy = await air.run(legacyRequest);
  assert.strictEqual(legacy.decision.status, "allow");

  console.log(JSON.stringify({
    status: "pass",
    sessionCases: 21,
    deterministic: true,
    stateContinuity: true,
    legacyFacade: true
  }));
})().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
