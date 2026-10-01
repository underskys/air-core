#!/usr/bin/env node
"use strict";
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createToolchainGuard } = require("../src/v052_toolchain_identity");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "air-toolchain-identity-"));
const src = path.join(dir, "src");
const dep = path.join(dir, "wabt");
const code = "module.exports = {};\n";
function fails(action, expected) {
  assert.throws(action, (error) => error.code === expected);
}
try {
  fs.mkdirSync(src); fs.mkdirSync(dep);
  for (const file of ["parser.js", "verifier.js", "typed_interface.js", "lower_wasm.js", "v051_reference.js", "v052_verified_build.js"]) {
    fs.writeFileSync(path.join(src, file), code);
  }
  fs.writeFileSync(path.join(dep, "package.json"), '{"name":"wabt","version":"1.0.39"}');
  fs.writeFileSync(path.join(dep, "index.js"), code);
  const guard = createToolchainGuard(src, () => dep);
  const baseline = guard.snapshot();
  assert.strictEqual(guard.snapshot().implementationDigest, baseline.implementationDigest);
  assert(Object.isFrozen(baseline.manifest.sources));
  for (const file of ["parser.js", "verifier.js", "typed_interface.js", "lower_wasm.js", "v051_reference.js", "v052_verified_build.js"]) {
    fs.writeFileSync(path.join(src, file), code + "// changed without a package-version bump\n");
    fails(() => guard.snapshot(), "air.v052.toolchain_changed");
    const next = createToolchainGuard(src, () => dep).snapshot();
    assert.notStrictEqual(next.implementationDigest, baseline.implementationDigest, file);
    fs.writeFileSync(path.join(src, file), code);
  }
  fs.writeFileSync(path.join(src, "future_dependency.js"), code);
  fails(() => guard.snapshot(), "air.v052.toolchain_changed");
  fs.unlinkSync(path.join(src, "future_dependency.js"));
  fs.writeFileSync(path.join(dep, "index.js"), code + "// changed dependency bytes\n");
  fails(() => guard.snapshot(), "air.v052.toolchain_changed");
  assert.notStrictEqual(createToolchainGuard(src, () => dep).snapshot().implementationDigest, baseline.implementationDigest);
  fs.writeFileSync(path.join(dep, "index.js"), code);
  const movedSrc = path.join(dir, "moved-src");
  const movedDep = path.join(dir, "moved-dep");
  fs.cpSync(src, movedSrc, { recursive: true }); fs.cpSync(dep, movedDep, { recursive: true });
  assert.strictEqual(createToolchainGuard(movedSrc, () => movedDep).snapshot().implementationDigest, baseline.implementationDigest,
    "absolute installation paths are not identity");
  fs.symlinkSync(path.join(src, "parser.js"), path.join(src, "escape.js"));
  fails(() => createToolchainGuard(src, () => dep), "air.v052.toolchain_input_invalid");
  fs.unlinkSync(path.join(src, "escape.js"));
  fs.unlinkSync(path.join(src, "verifier.js"));
  fails(() => guard.snapshot(), "air.v052.toolchain_changed");
  fails(() => createToolchainGuard(path.join(dir, "absent"), () => dep), "air.v052.toolchain_input_unavailable");
  console.log("v0.52 toolchain identity: six implementation mutations, dependency/add/remove/symlink/path-independence checks passed");
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
