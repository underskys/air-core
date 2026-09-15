#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { buildVerifiedTypedModule } = require("../src/v052_verified_build");

const root = path.resolve(__dirname, "..");
const fixtures = path.join(root, "fixtures", "v052", "public_reality");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "air-v052-browser-"));

(async () => {
  const built = await buildVerifiedTypedModule({
    source: fs.readFileSync(path.join(fixtures, "limit.air"), "utf8"),
    descriptor: JSON.parse(fs.readFileSync(path.join(fixtures, "limit.interface.json"), "utf8")),
    sourceProfile: "typed-v0.51"
  });
  const wasmPath = path.join(tmp, "limit.wasm");
  fs.writeFileSync(wasmPath, built.wasmBytes);

  const stdout = execFileSync(process.execPath, [
    path.join(root, "scripts", "v052_reality", "browser_runtime.mjs"),
    wasmPath
  ], { cwd: root, encoding: "utf8", env: process.env, maxBuffer: 1024 * 1024 });
  const report = JSON.parse(stdout);

  assert.equal(report.kind, "air.v052.verifiedRuntimeBrowserConformance");
  assert.equal(report.browser, "playwright-chromium");
  assert.deepEqual(report.result, {
    checkedAdd: "3",
    exactI64: "9007199254740993",
    withinLimit: 1
  });

  console.log(JSON.stringify({
    status: "pass",
    browserResult: "pass:playwright-chromium",
    checkedI64: "pass",
    exactI64: "pass"
  }));
})().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
}).finally(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});
