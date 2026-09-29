#!/usr/bin/env node
"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  SOURCE_PROFILE_LEGACY,
  SOURCE_PROFILE_TYPED_V051,
  parseSource,
  verifySource
} = require("../src");

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "bin", "airc.js");
const TYPED_FIXTURE = path.join(ROOT, "fixtures", "v052", "numerics", "g2_existing_numeric.air");
const LEGACY_FIXTURE = path.join(ROOT, "examples", "refinement_types", "contract_bridge.air");

function run(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 10000
  });
}

function expectPass(result, label) {
  assert.strictEqual(result.status, 0, `${label}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
}

function expectStableFailure(result, code, label) {
  assert.strictEqual(result.error, undefined, `${label}: CLI did not terminate normally`);
  assert.notStrictEqual(result.status, 0, `${label} unexpectedly passed`);
  assert.match(result.stderr, new RegExp(code.replaceAll(".", "\\."), "u"));
  assert.doesNotMatch(result.stderr, /(?:TypeError|ReferenceError|\n\s+at\s)/u);
}

function expectFailureWithoutStack(result, label) {
  assert.notStrictEqual(result.status, 0, `${label} unexpectedly passed`);
  assert.doesNotMatch(result.stderr, /(?:TypeError|ReferenceError|\n\s+at\s)/u);
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "air-v052-source-profile-"));

try {
  const { normalizeSourceProfile } = require("../src/source_profile");
  assert.strictEqual(normalizeSourceProfile(), "legacy-v0.50");
  for (const value of [null, false, 0, "", {}, {toString() { throw new Error("must not coerce"); }}]) {
    assert.throws(() => normalizeSourceProfile(value), (error) => error.code === "air.source_profile.unsupported");
  }
  assert.strictEqual(SOURCE_PROFILE_LEGACY, "legacy-v0.50");
  assert.strictEqual(SOURCE_PROFILE_TYPED_V051, "typed-v0.51");
  const sdkTyped = parseSource(fs.readFileSync(TYPED_FIXTURE, "utf8"), TYPED_FIXTURE, {
    sourceProfile: SOURCE_PROFILE_TYPED_V051
  });
  verifySource(sdkTyped, { sourceProfile: SOURCE_PROFILE_TYPED_V051 });
  assert.throws(
    () => parseSource("module direct.error\nexport func run() -> i32 {\nbr nowhere\nreturn 0\n}\n", "direct.air", {
      sourceProfile: SOURCE_PROFILE_TYPED_V051
    }),
    (error) => error.code === "air.v051.typed_syntax_invalid"
  );

  const typedVerify = run(["verify", TYPED_FIXTURE, "--source-profile", "typed-v0.51"]);
  expectPass(typedVerify, "typed source verify");
  expectPass(
    run(["verify", "--source-profile", "typed-v0.51", TYPED_FIXTURE]),
    "typed source verify accepts source profile before file"
  );

  const typedWat = path.join(tempDir, "typed.wat");
  const typedBuild = run(["build", TYPED_FIXTURE, "--source-profile", "typed-v0.51", "--emit", "wat", "-o", typedWat]);
  expectPass(typedBuild, "typed source build");
  const wat = fs.readFileSync(typedWat, "utf8");
  assert.match(wat, /\(export "i64_checked_add"/u);
  assert.match(wat, /i64\.add/u);
  const typedWatWithOptionsFirst = path.join(tempDir, "typed-options-first.wat");
  expectPass(
    run(["build", "--source-profile", "typed-v0.51", "--emit", "wat", "-o", typedWatWithOptionsFirst, TYPED_FIXTURE]),
    "typed source build selects file after source-profile and output options"
  );

  const typedFormat = run(["format", TYPED_FIXTURE, "--source-profile", "typed-v0.51"]);
  expectPass(typedFormat, "typed source format");
  const canonicalTyped = path.join(tempDir, "canonical-typed.air");
  fs.writeFileSync(canonicalTyped, typedFormat.stdout);
  expectPass(
    run(["format", canonicalTyped, "--source-profile", "typed-v0.51", "--check"]),
    "typed canonical format check"
  );

  expectPass(
    run(["verify", LEGACY_FIXTURE, "--source-profile", "legacy-v0.50"]),
    "legacy source verify"
  );
  expectStableFailure(
    run(["verify", LEGACY_FIXTURE, "--source-profile", "typed-v0.51"]),
    "air.v051.typed_syntax_invalid",
    "typed profile must not heuristically accept legacy source"
  );

  const defaultLegacy = run(["verify", TYPED_FIXTURE]);
  assert.notStrictEqual(defaultLegacy.status, 0);
  assert.doesNotMatch(defaultLegacy.stderr, /\n\s+at\s/u);
  assert.match(defaultLegacy.stderr, /--source-profile typed-v0\.51/u);

  expectStableFailure(
    run(["verify", path.join(tempDir, "missing.air")]),
    "air.cli.file_missing",
    "missing source file has a stable diagnostic"
  );
  expectStableFailure(
    run(["verify", tempDir]),
    "air.cli.file_invalid",
    "directory source path has a stable diagnostic"
  );
  const regular = path.join(tempDir, "regular.air");
  fs.writeFileSync(regular, fs.readFileSync(TYPED_FIXTURE));
  const loop = path.join(tempDir, "loop.air");
  fs.symlinkSync(loop, loop);
  const oversized = path.join(tempDir, "oversized.air");
  fs.writeFileSync(oversized, Buffer.alloc(4 * 1024 * 1024 + 1));
  const fifo = path.join(tempDir, "fifo.air");
  if (process.platform !== "win32") {
    const mkfifo = spawnSync("mkfifo", [fifo], { encoding: "utf8" });
    assert.strictEqual(mkfifo.status, 0, mkfifo.stderr);
  }
  for (const command of ["verify", "fmt", "format", "build"]) {
    for (const invalid of [path.join(regular, "child.air"), loop, tempDir]) {
      expectStableFailure(run([command, invalid]), "air.cli.file_invalid", `${command}: invalid file path`);
    }
    expectStableFailure(run([command, oversized]), "air.cli.file_too_large", `${command}: bounded source read`);
    if (process.platform !== "win32") {
      expectStableFailure(run([command, "/dev/zero"]), "air.cli.file_invalid", `${command}: device rejected`);
      expectStableFailure(run([command, fifo]), "air.cli.file_invalid", `${command}: FIFO rejected without blocking`);
    }
  }
  const linked = path.join(tempDir, "linked.air");
  fs.symlinkSync(regular, linked);
  expectPass(run(["verify", linked, "--source-profile", "typed-v0.51"]), "regular-file symlink remains supported");
  expectStableFailure(
    run(["check", "--source-profile", "typed-v0.51", TYPED_FIXTURE]),
    "air.source_profile.command_unsupported",
    "check rejects source-profile before selecting a target"
  );

  expectStableFailure(
    run(["verify", TYPED_FIXTURE, "--source-profile", "future"]),
    "air.source_profile.unsupported",
    "unknown source profile"
  );
  expectStableFailure(
    run(["verify", TYPED_FIXTURE, "--source-profile=typed-v0.51"]),
    "air.source_profile.invalid_form",
    "equals source profile form fails closed"
  );
  expectStableFailure(
    run(["verify", TYPED_FIXTURE, "--source-profile", "legacy-v0.50", "--source-profile", "typed-v0.51"]),
    "air.source_profile.duplicate",
    "duplicate source profile fails closed"
  );
  expectStableFailure(
    run(["verify", TYPED_FIXTURE, "--source-profile"]),
    "air.source_profile.missing",
    "missing source profile value"
  );
  expectFailureWithoutStack(
    run(["verify", TYPED_FIXTURE, "--source-profile", "legacy-v0.50"]),
    "legacy profile must not accept typed source"
  );

  expectPass(run(["verify", "--library", "--source-profile", "legacy-v0.50", LEGACY_FIXTURE]),
    "library before source/profile uses the same parser");
  expectPass(run(["verify", LEGACY_FIXTURE, "--library", "--source-profile", "legacy-v0.50"]),
    "library after source uses the same parser");
  expectStableFailure(run(["verify", "--library"]), "air.source_profile.file_missing", "missing library source fails closed");
  expectStableFailure(run(["unknown-command"]), "air.cli.command_unknown", "unknown CLI command has no raw stack");
  expectStableFailure(
    run(["build", TYPED_FIXTURE, "--source-profile", "typed-v0.51", "--out", path.join(tempDir, "wrong.wasm")]),
    "air.cli.option_unknown",
    "build rejects the gfx-only --out option"
  );
  expectStableFailure(
    run(["verify", TYPED_FIXTURE, "--source-profile", "typed-v0.51", "--mystery"]),
    "air.cli.option_unknown",
    "source commands reject unknown options"
  );
  // Invalid AIR under gfx-build fails at the parser, not on opening --out's
  // directory as if it were the source. It must fail before any Wasm compile.
  const badGfx = path.join(tempDir, "bad-gfx.air");
  fs.writeFileSync(badGfx, "module bad\ncapabilities {}\nfunc f() -> i32 {\nentry:\nbr_if %c, , done\n}\n");
  const outFirst = run(["gfx-build", "--out", tempDir, badGfx]);
  const outLast = run(["gfx-build", badGfx, "--out", tempDir]);
  expectStableFailure(outFirst, "air.control.br_if_syntax_invalid", "--out before source consumes its own value");
  assert.strictEqual(outFirst.stderr, outLast.stderr);

  const malformedBranch = path.join(tempDir, "malformed-branch.air");
  fs.writeFileSync(malformedBranch, `module malformed_branch
capabilities { }

func main(args: slice) -> i32 {
entry:
  %cond:bool = const.bool true
  br_if %cond, , exit
exit:
  %zero:i32 = const.i32 0
  return %zero
}
`);
  expectStableFailure(
    run(["verify", malformedBranch, "--source-profile", "legacy-v0.50"]),
    "air.control.br_if_syntax_invalid",
    "malformed branch diagnostic"
  );

  process.stdout.write("v0.52 source profiles: explicit typed/legacy CLI routing and stable malformed-branch diagnostics passed\n");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
