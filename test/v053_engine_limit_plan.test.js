"use strict";

// P0-12 row P12-MB6-01 (OD-P12-5 (a), slice text R5 amendment A4): the typed-v0.53 engine-limit plan counts the types the emitted
// module has. P0-08's correction (OD-P8-7) added the plain-lane borrow helper `$__air_borrow_failure` (i32 -> ) to the plan's type
// set; its QA (P3-1) found that removing that line (mutant MB6) left every test passing. This row compares the plan's type count with
// the type section of the module the lowering emits, for P0-08's fixture (a): R2.4 VECTORS_ADDITIONS.md section 3b, module
// v53.imp.b1, a plain export and an internal function taking a borrowed_slice (179 bytes, sha256 13b32afc...). It reaches the plan
// through require("../src/lower_wasm").typedV053.checkEngineLimits, with no src change. It then applies MB6 to a scratch copy of
// src/ (under build/, so wabt resolves) and requires the same comparison to fail there.
// Usage: node test/v053_engine_limit_plan.test.js   (internally: --check <src folder>)
const assert = require("node:assert");
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const FIXTURE_A = "module v53.imp.b1\n\nfunc peek(b: borrowed_slice<readonly,len=8..8,align=4>) -> i32 {\n  %v: i32 = slice.load.i32 %b, 0\n  return %v\n}\n\nexport func run(x: i32) -> i32 {\n  return %x\n}\n";
const FIXTURE_A_SHA256 = "13b32afce2cafb49556501e000fd98aa0e1dfc16f2d5987eb50ae5148239c4fa";
const MB6_LINE = "  else if (features.memory.borrowedParameter) signatures.add(\"i32->\");\n";
const GATED = Object.freeze({ allowCandidateProfile: true, sourceProfile: "typed-v0.53" });

function leb(bytes, offset) {
  let value = 0; let shift = 0; let at = offset;
  for (;;) {
    const byte = bytes[at++];
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return [value, at];
    shift += 7;
  }
}

// The number of entries in a Wasm binary's type section (id 1); 0 when the module has none.
function typeSectionCount(wasm) {
  assert.deepStrictEqual([...wasm.subarray(0, 8)], [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00], "not a Wasm 1.0 binary");
  let at = 8;
  while (at < wasm.length) {
    const id = wasm[at];
    const [size, body] = leb(wasm, at + 1);
    if (id === 1) return leb(wasm, body)[0];
    at = body + size;
  }
  return 0;
}

// One comparison against the src folder given: the plan's totals.types and the emitted module's type count.
async function compare(srcDir) {
  const sp = require(path.join(srcDir, "source_profile.js"));
  const { lowerToWat, watToWasm, typedV053 } = require(path.join(srcDir, "lower_wasm.js"));
  const ast = sp.parseSource(FIXTURE_A, "main.air", GATED);
  sp.verifySource(ast, GATED);
  const plan = typedV053.checkEngineLimits(ast);
  const wat = lowerToWat(ast, { allowCandidateProfile: true, maxWatBytes: 4194304 });
  const wasm = Buffer.from(await watToWasm(wat, "main.air"));
  return { planTypes: plan.totals.types, emittedTypes: typeSectionCount(wasm), wasmBytes: wasm.length, helperDefined: wat.includes("(func $__air_borrow_failure") };
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--check") {
    process.stdout.write(`${JSON.stringify(await compare(path.resolve(args[1])))}\n`);
    return;
  }
  const rows = [];
  const sha = crypto.createHash("sha256").update(FIXTURE_A).digest("hex");
  rows.push({ id: "fixture (a)", pass: sha === FIXTURE_A_SHA256 && Buffer.byteLength(FIXTURE_A) === 179, detail: { sha256: sha, bytes: Buffer.byteLength(FIXTURE_A) } });
  const real = await compare(path.join(ROOT, "src"));
  rows.push({ id: "P12-MB6-01", pass: real.planTypes === real.emittedTypes && real.helperDefined, detail: real });
  // MB6 on a scratch copy of src/: the plan then counts one type fewer than the module emits, and the comparison must fail.
  fs.mkdirSync(path.join(ROOT, "build"), { recursive: true });
  const scratch = fs.mkdtempSync(path.join(ROOT, "build", "v053-engine-limit-plan-"));
  try {
    fs.cpSync(path.join(ROOT, "src"), path.join(scratch, "src"), { recursive: true });
    const file = path.join(scratch, "src", "lower_wasm.js");
    const text = fs.readFileSync(file, "utf8");
    const applied = text.split(MB6_LINE).length === 2;
    if (applied) fs.writeFileSync(file, text.replace(MB6_LINE, ""));
    const out = childProcess.spawnSync(process.execPath, [__filename, "--check", path.join(scratch, "src")], { encoding: "utf8" });
    let mutant = null;
    try { mutant = JSON.parse(out.stdout); } catch (_) { mutant = { error: (out.stderr || "").slice(0, 300) }; }
    const caught = applied && mutant && typeof mutant.planTypes === "number" && mutant.planTypes !== mutant.emittedTypes;
    rows.push({ id: "MB6", pass: caught, detail: { applied, ran: out.status === 0, ...mutant } });
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  for (const row of rows) process.stdout.write(`${row.pass ? "PASS" : "FAIL"} ${row.id} ${JSON.stringify(row.detail)}\n`);
  const failed = rows.filter((row) => !row.pass).length;
  process.stdout.write(`P12-MB6-01 engine-limit plan: ${rows.length - failed}/${rows.length} PASS\n`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((error) => { process.stdout.write(`FAIL threw ${error && error.stack || error}\n`); process.exitCode = 1; });
