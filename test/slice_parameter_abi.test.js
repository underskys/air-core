#!/usr/bin/env node
"use strict";

const assert = require("assert");
const cp = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { diagnosticHintsFromMessage, normalizeDiagnostic } = require("../src/diagnostics");
const { lowerToWat } = require("../src/lower_wasm");
const { parseAir } = require("../src/parser");
const {
  assertWasmTargetSupport,
  VerificationError
} = require("../src/verifier");

const root = path.resolve(__dirname, "..");
const airc = path.join(root, "bin", "airc.js");
const fixtureRoot = path.join("fixtures", "v050", "slice_parameter");
const exportedSlice = path.join(fixtureRoot, "exported_slice.air");
const unusedExportedSlice = path.join(fixtureRoot, "exported_slice_unused.air");
const packageDir = path.join(fixtureRoot, "package");
const expectedCode = "air.abi.borrowed_slice_lowering_unavailable";

function run(args) {
  return cp.spawnSync(process.execPath, [airc, ...args], {
    cwd: root,
    encoding: "utf8"
  });
}

function assertStableRejection(args, functionName = "downmix", parameterName = "src") {
  const first = run(args);
  const second = run(args);
  assert.notStrictEqual(first.status, 0, `expected failure: ${args.join(" ")}`);
  assert.strictEqual(second.status, first.status);
  assert.strictEqual(second.stdout, first.stdout);
  assert.strictEqual(second.stderr, first.stderr);

  const output = `${first.stdout}${first.stderr}`;
  assert.match(output, new RegExp(expectedCode.replace(/\./g, "\\.")));
  assert.match(output, new RegExp(`function '${functionName}'`));
  assert.match(output, new RegExp(`parameter '${parameterName}'`));
  assert.match(output, /exported_slice(?:_unused)?\.air:6:/);
  assert.doesNotMatch(output, /missing local for %src\$len/);
  assert.doesNotMatch(output, /\n\s+at /);
  return first;
}

const verifyFailure = assertStableRejection(["verify", exportedSlice]);
const verifyDiagnostic = normalizeDiagnostic(diagnosticHintsFromMessage(verifyFailure.stderr));
assert.strictEqual(verifyDiagnostic.code, expectedCode);
assert.strictEqual(verifyDiagnostic.severity, "fail");
assert.strictEqual(verifyDiagnostic.line, 6);
assert.strictEqual(verifyDiagnostic.fields.function, "downmix");
assert.strictEqual(verifyDiagnostic.fields.parameter, "src");

const buildOutput = path.join(os.tmpdir(), `airlang-v050-exported-slice-${process.pid}.wasm`);
fs.rmSync(buildOutput, { force: true });
const buildFailure = assertStableRejection(["build", exportedSlice, "--emit", "wasm", "-o", buildOutput]);
assert.strictEqual(buildFailure.stderr, verifyFailure.stderr);
assert.strictEqual(fs.existsSync(buildOutput), false, "unsupported export must fail before emitting output");

assertStableRejection(["verify", unusedExportedSlice]);

const directModule = parseAir(
  fs.readFileSync(path.join(root, exportedSlice), "utf8"),
  exportedSlice
);
for (const invoke of [
  () => assertWasmTargetSupport(directModule),
  () => lowerToWat(directModule)
]) {
  let failure = null;
  try {
    invoke();
  } catch (err) {
    failure = err;
  }
  assert(failure instanceof VerificationError);
  assert.match(failure.message, new RegExp(expectedCode.replace(/\./g, "\\.")));
  assert.doesNotMatch(failure.message, /missing local for %src\$len/);
}

const packageArgs = [
  "package-check",
  packageDir,
  "--profile",
  "verifier-only",
  "--source-only",
  "--json"
];
const packageFailure = run(packageArgs);
const repeatedPackageFailure = run(packageArgs);
assert.notStrictEqual(packageFailure.status, 0);
assert.strictEqual(repeatedPackageFailure.status, packageFailure.status);
assert.strictEqual(repeatedPackageFailure.stdout, packageFailure.stdout);
assert.strictEqual(repeatedPackageFailure.stderr, packageFailure.stderr);
assert.strictEqual(packageFailure.stderr, "");
const packageReport = JSON.parse(packageFailure.stdout);
assert.strictEqual(packageReport.status, "fail");
const packageDiagnostic = packageReport.diagnostics.find((item) => item.code === expectedCode);
assert(packageDiagnostic, `expected ${expectedCode} in package diagnostics`);
assert.strictEqual(path.basename(packageDiagnostic.file), "module.air");
assert.strictEqual(packageDiagnostic.line, 6);
assert.strictEqual(packageDiagnostic.fields.function, "downmix");
assert.strictEqual(packageDiagnostic.fields.parameter, "src");

const internalSliceWasm = path.join(os.tmpdir(), `airlang-v050-internal-slice-${process.pid}.wasm`);
fs.rmSync(internalSliceWasm, { force: true });
const internalVerify = run(["verify", path.join("examples", "dynamic_slice.air")]);
assert.strictEqual(internalVerify.status, 0, internalVerify.stderr);
const internalBuild = run([
  "build",
  path.join("examples", "dynamic_slice.air"),
  "--emit",
  "wasm",
  "-o",
  internalSliceWasm
]);
assert.strictEqual(internalBuild.status, 0, internalBuild.stderr);
assert.strictEqual(fs.existsSync(internalSliceWasm), true);
fs.rmSync(internalSliceWasm, { force: true });

console.log("slice parameter ABI tests passed");
