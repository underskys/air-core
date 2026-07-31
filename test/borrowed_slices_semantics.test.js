#!/usr/bin/env node
"use strict";

const assert = require("assert");
const cp = require("child_process");
const fs = require("fs");
const path = require("path");
const { diagnosticHintsFromMessage, normalizeDiagnostic } = require("../src/diagnostics");
const { formatModule } = require("../src/format");
const { lowerToWat } = require("../src/lower_wasm");
const { parseAir } = require("../src/parser");
const {
  assertWasmTargetSupport,
  verifyModule
} = require("../src/verifier");

const root = path.resolve(__dirname, "..");
const airc = path.join(root, "bin", "airc.js");
const sourceFixture = path.join("examples", "borrowed_slices", "source_only", "transform.air");

function parse(source, file = "<borrowed-semantics>") {
  return parseAir(source.trim(), file, { resolveSourceImports: false });
}

function verify(source, file) {
  const mod = typeof source === "string" ? parse(source, file) : source;
  verifyModule(mod, { library: true });
  return mod;
}

function expectReject(source, code) {
  let failure;
  try {
    verify(source);
  } catch (error) {
    failure = error;
  }
  assert(failure, `expected ${code}`);
  assert.match(failure.message, new RegExp(code.replace(/\./g, "\\.")));
  const diagnostic = normalizeDiagnostic(diagnosticHintsFromMessage(failure.message));
  assert.strictEqual(diagnostic.code, code);
  assert.strictEqual(diagnostic.severity, "fail");
  return failure;
}

function runCli(args) {
  return cp.spawnSync(process.execPath, [airc, ...args], {
    cwd: root,
    encoding: "utf8"
  });
}

const fixtureText = fs.readFileSync(path.join(root, sourceFixture), "utf8");
const canonical = verify(fixtureText, sourceFixture);
const [src, dst, count] = canonical.functions[0].params;
assert.deepStrictEqual(src, {
  name: "src",
  type: "borrowed_slice",
  declaredType: "borrowed_slice<readonly,len<=1024,align=4>",
  borrow: {
    access: "readonly",
    length: { unit: "bytes", min: 0, max: 1024 },
    alignment: 4,
    lifetime: "invocation",
    noescape: true,
    growable: false,
    freeable: false,
    returnable: false,
    storable: false
  }
});
assert.strictEqual(dst.borrow.access, "writeonly");
assert.strictEqual(count.type, "i32");
assert.deepStrictEqual(canonical.functions[0].requires[2], {
  kind: "checked_borrow_length",
  borrow: "src",
  unit: "bytes",
  op: ">=",
  parameter: "count",
  multiplier: 4,
  loc: canonical.functions[0].requires[2].loc
});

const formatted = formatModule(canonical);
assert.match(formatted, /borrowed_slice<readonly,len<=1024,align=4>/);
assert.match(formatted, /requires checked bytes src >= param count \* 4/);
const reparsed = verify(formatted);
assert.strictEqual(formatModule(reparsed), formatted);

const verifyFirst = runCli(["verify", sourceFixture]);
const verifySecond = runCli(["verify", sourceFixture]);
assert.strictEqual(verifyFirst.status, 0, verifyFirst.stderr);
assert.strictEqual(verifySecond.status, 0, verifySecond.stderr);
assert.strictEqual(verifySecond.stdout, verifyFirst.stdout);
assert.strictEqual(verifySecond.stderr, verifyFirst.stderr);

const buildFirst = runCli(["build", sourceFixture, "--emit", "wasm"]);
const buildSecond = runCli(["build", sourceFixture, "--emit", "wasm"]);
assert.strictEqual(buildFirst.status, 0, buildFirst.stderr);
assert.strictEqual(buildSecond.status, buildFirst.status);
assert.strictEqual(buildSecond.stdout, buildFirst.stdout);
assert.strictEqual(buildSecond.stderr, buildFirst.stderr);
assertWasmTargetSupport(canonical, { airAbi: "0.11" });
const lowered = lowerToWat(canonical);
assert.match(lowered, /\(param \$src i32\) \(param \$src\$len i32\)/);
assert.match(lowered, /air-feature: borrowed-slice-v1/);
assert.doesNotMatch(lowered, /missing local/);

expectReject(`
module readonly_store
capabilities { }
func run(dst: borrowed_slice<readonly,len<=4,align=4>) -> i32 {
entry:
  %value:f32 = const.f32 1
  slice.store.f32 %dst, 0, %value
  %zero:i32 = const.i32 0
  return %zero
}
`, "air.borrow.mode_violation");

expectReject(`
module writeonly_read
capabilities { }
func run(src: borrowed_slice<writeonly,len<=4,align=4>) -> i32 {
entry:
  %value:i32 = slice.load.i32 %src, 0
  return %value
}
`, "air.borrow.mode_violation");

expectReject(`
module return_escape
capabilities { }
func run(src: borrowed_slice<readonly,len<=4,align=4>) -> borrowed_slice<readonly,len<=4,align=4> {
entry:
  return %src
}
`, "air.borrow.escape_return");

expectReject(`
module global_escape
capabilities { }
global retained:borrowed_slice<readonly,len<=4,align=4> = const.str "x"
func run() -> i32 {
entry:
  %zero:i32 = const.i32 0
  return %zero
}
`, "air.borrow.escape_storage");

expectReject(`
module free_borrow
capabilities { }
func run(src: borrowed_slice<readwrite,len<=4,align=4>) -> i32 {
entry:
  free_region %src
  %zero:i32 = const.i32 0
  return %zero
}
`, "air.borrow.free_forbidden");

expectReject(`
module extern_borrow
capabilities { debug }
extern debug.metric(src: borrowed_slice<readonly,len<=4,align=4>) -> i32
func run(src: borrowed_slice<readonly,len<=4,align=4>) -> i32 {
entry:
  %result:i32 = call @debug.metric(%src)
  return %result
}
`, "air.borrow.extern_opaque");

expectReject(`
module reinterpret
capabilities { }
func run(src: borrowed_slice<readonly,len<=8,align=4>) -> i32 {
entry:
  %part:slice = slice.sub %src, 0, 4
  %zero:i32 = const.i32 0
  return %zero
}
`, "air.borrow.reinterpret_forbidden");

expectReject(`
module mode_change
capabilities { }
func run(src: borrowed_slice<readwrite,len<=8,align=4>) -> i32 {
entry:
  %part:borrowed_slice<readonly,len<=4,align=4> = slice.sub %src, 0, 4
  %zero:i32 = const.i32 0
  return %zero
}
`, "air.borrow.mode_violation");

expectReject(`
module alignment
capabilities { }
func run(src: borrowed_slice<readonly,len<=8,align=1>) -> i32 {
entry:
  %value:i32 = slice.load.i32 %src, 0
  return %value
}
`, "air.borrow.alignment_invalid");

expectReject(`
module impossible_access
capabilities { }
func run(src: borrowed_slice<readonly,len<=0,align=4>) -> i32 {
entry:
  %value:i32 = slice.load.i32 %src, 0
  return %value
}
`, "air.borrow.length_invalid");

expectReject(`
module bare
capabilities { }
func run(src: borrowed_slice) -> i32 {
entry:
  %zero:i32 = const.i32 0
  return %zero
}
`, "air.borrow.syntax_invalid");

expectReject(`
module bad_checked_relation
capabilities { }
requires export run
export func run(src: borrowed_slice<readonly,len<=8,align=4>, count: f32) -> i32 {
  requires checked bytes src >= param count * 4
entry:
  %zero:i32 = const.i32 0
  return %zero
}
`, "air.borrow.syntax_invalid");

verify(`
module local_helper
capabilities { }
func helper(src: borrowed_slice<readonly,len<=16,align=4>) -> i32 {
entry:
  %length:i32 = slice.len %src
  return %length
}
func run(src: borrowed_slice<readonly,len<=8,align=4>) -> i32 {
entry:
  %length:i32 = call @helper(%src)
  return %length
}
`);

verify(`
module valid_subslice
capabilities { }
func run(src: borrowed_slice<readonly,len<=8,align=4>) -> i32 {
entry:
  %part:borrowed_slice<readonly,len<=4,align=4> = slice.sub %src, 4, 4
  %length:i32 = slice.len %part
  return %length
}
`);

verify(fs.readFileSync(path.join(root, "examples", "dynamic_slice.air"), "utf8"), "examples/dynamic_slice.air");

console.log("borrowed slices semantics tests passed");
