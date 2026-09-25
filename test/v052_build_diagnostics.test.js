#!/usr/bin/env node
"use strict";
const assert = require("node:assert");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { buildVerifiedTypedModule } = require("../src/v052_verified_build");
(async () => {
  const malformed = "module bad\nexport func f() -> i64 {\n nonsense\n}\n";
  await assert.rejects(() => buildVerifiedTypedModule({
    source: malformed, descriptor: {}, sourceName: "air.fake.authority: untrusted-display-label"
  }), (error) => error.code === "air.v051.typed_syntax_invalid" &&
    error.loc.file === "air.fake.authority: untrusted-display-label" && error.cause.name === "AirError");
  await assert.rejects(() => buildVerifiedTypedModule({
    source: "module bad\nexport func f() -> i64 {\n %x: i64 = i64.checked_add 9223372036854775807, 1\n return %x\n}\n", descriptor: {}
  }), (error) => error.code === "air.numeric.checked_failure" && error.message === "air.numeric.checked_failure: overflow");
  for (const sourceProfile of [false, null, 0, "", "future"]) {
    await assert.rejects(() => buildVerifiedTypedModule({source: malformed, descriptor: {}, sourceProfile}),
      (error) => error.code === "air.source_profile.unsupported");
  }
  const backendProbe = spawnSync(process.execPath, ["-e", `
    const fs = require("node:fs");
    const lower = require("./src/lower_wasm");
    lower.watToWasm = async () => { throw new WebAssembly.RuntimeError("memory access out of bounds"); };
    const { buildVerifiedTypedModule } = require("./src/v052_verified_build");
    const source = fs.readFileSync("fixtures/v052/verified_build/ops_policy.air", "utf8");
    const descriptor = JSON.parse(fs.readFileSync("fixtures/v052/verified_build/ops_policy.interface.json", "utf8"));
    buildVerifiedTypedModule({ source, descriptor }).then(
      () => process.exit(2),
      (error) => {
        if (error.code !== "air.v052.verified_build_emission_failure" || error.message.includes("memory access out of bounds")) process.exit(3);
        console.log(error.code);
      }
    );
  `], { cwd: path.resolve(__dirname, ".."), encoding: "utf8", timeout: 5000 });
  assert.strictEqual(backendProbe.status, 0, backendProbe.stderr);
  assert.strictEqual(backendProbe.stdout.trim(), "air.v052.verified_build_emission_failure");
  const compileProbe = spawnSync(process.execPath, ["-e", `
    const fs = require("node:fs");
    const lower = require("./src/lower_wasm");
    lower.watToWasm = async () => Buffer.from([0]);
    const { createVerifiedTypedRuntime } = require("./src/v052_verified_build");
    const source = fs.readFileSync("fixtures/v052/verified_build/ops_policy.air", "utf8");
    const descriptor = JSON.parse(fs.readFileSync("fixtures/v052/verified_build/ops_policy.interface.json", "utf8"));
    createVerifiedTypedRuntime({ admit: async () => true }).build({ source, descriptor }).then(
      () => process.exit(2),
      (error) => {
        if (error.code !== "air.v052.verified_build_wasm_mismatch") process.exit(3);
        console.log(error.code);
      }
    );
  `], { cwd: path.resolve(__dirname, ".."), encoding: "utf8", timeout: 5000 });
  assert.strictEqual(compileProbe.status, 0, compileProbe.stderr);
  assert.strictEqual(compileProbe.stdout.trim(), "air.v052.verified_build_wasm_mismatch");
  console.log("v0.52 safe-builder source diagnostics: parser/verifier codes, location isolation and invalid profile rejection passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
