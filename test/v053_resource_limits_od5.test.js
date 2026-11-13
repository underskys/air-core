#!/usr/bin/env node
"use strict";

// SEC53-06 (AIR_V053_SEC53_06_RESOURCE_LIMITS_OD5_SPEC_R6_2026_11_10): parser and resource exhaustion, and the OD-5 typed-v0.51
// defects. VECTORS.md section 1's 61 rows (T01-T15, B01-B07, F01-F02, L01-L07, W00-W03, C01-C07, O01-O04, D01, R01-R03) and SPEC
// section 7's mutants M1-M21, with the anchors of the spec's tools/s6_mutants.js. Each mutant is applied to a scratch copy of the tree and
// runs every row but R01-R03; it must be applied, run, and caught by a row it names.
// The rows run in a child process on a given tree (this file with --rows). The child copies the tree's src, bin, stdlib, data,
// package.json and the frozen sample into a work folder with no node_modules, so WABT resolves from src only where a row puts this
// repository's node_modules on NODE_PATH (C03, C05-C07). Rows marked (child) in VECTORS.md parse in a process of their own under a
// SIGKILL time limit, so a hang fails the row. F01 and F02 compare the tree with 9e9a3783's splitComma and canonicalizeV051SourceType,
// carried below verbatim (SPEC section 8); the helpers those bodies call (AirError, parseRefinementType, parseTypeReference) come from
// the tree under test. R01-R03 run three landed tests in the given tree. R03 reads the SCALAR suite's own per-vector results (reading note
// 2, AIR_V053_SEC53_06_READING_NOTE_2_2026_11_13): exit 0, 74 vectors, each PASS or PASS_BY_COMMAND_LOGS, except V53-PROF-N02 and
// V53-PROF-N06 when the suite gives them ENVIRONMENT_UNAVAILABLE for the H52_BASELINE git objects (74 of 74 in a git checkout, 72 of 74
// without git objects).
// Set AIR_SEC53_06_RESULTS_DIR=<dir> to write the results.

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const WABT_MODULES = path.join(ROOT, "node_modules"); // wabt 1.0.39, from the lockfile
const PARTS = ["src", "bin", "stdlib", "data", "package.json", "fixtures/v051/first_vertical/typed_decide.air"];
const CHILD_MS = 900000;
const ENV0 = Object.fromEntries(["PATH", "HOME", "TMPDIR"].filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]));
const short = (e) => `${e && e.name ? `${e.name}: ` : ""}${String(e && e.message !== undefined ? e.message : e).split("\n")[0].slice(0, 160)}`;

// ---------------------------------------------------------------------------
// F01 and F02's reference: 9e9a3783's src/parser.js, verbatim. Their helpers are bound to the tree under test before each use.

let AirError;
let parseRefinementType;
let parseTypeReference;

// 9e9a3783 src/parser.js:569-593 (SPEC section 8: ":569-592"), verbatim
function canonicalizeV051SourceType(value, moduleId, allowVoid, loc) {
  value = String(value || "").trim();
  if (allowVoid && value === "void") return "void";
  // v0.51 reuses the existing i32 refinement grammar. The refinement remains
  // source/verifier metadata; lowering erases it to the established i32 lane.
  const refinement = parseRefinementType(value, loc);
  if (refinement) {
    if (refinement.base !== "i32") {
      throw new AirError(`air.v051.type_reference_invalid: '${value}' is not an admitted typed refinement`, loc);
    }
    return refinement.canonical;
  }
  if (/^[A-Z][A-Za-z0-9_]{0,127}$/.test(value)) return `${moduleId}::${value}`;
  const option = value.match(/^option\s*<\s*(.+)\s*>$/);
  if (option) return `option<${canonicalizeV051SourceType(option[1], moduleId, false, loc)}>`;
  const result = value.match(/^result\s*<\s*(.+)\s*>$/);
  if (result) {
    const parts = splitComma(result[1]);
    if (parts.length !== 2) throw new AirError("air.v051.type_reference_invalid: result requires exactly two type parameters", loc);
    return `result<${canonicalizeV051SourceType(parts[0], moduleId, false, loc)},${canonicalizeV051SourceType(parts[1], moduleId, false, loc)}>`;
  }
  try { return parseTypeReference(value, { allowVoid }).canonical; } catch (err) {
    throw new AirError(err.message, loc);
  }
}

// 9e9a3783 src/parser.js:1117-1152, verbatim
function splitComma(text) {
  const parts = [];
  let current = "";
  let inString = false;
  let escape = false;
  let angleDepth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      current += ch;
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      current += ch;
      continue;
    }
    if (ch === "<" && text[i + 1] !== "=" && current[current.length - 1] && !/\s/.test(current[current.length - 1])) angleDepth += 1;
    if (ch === ">") angleDepth = Math.max(0, angleDepth - 1);
    if (ch === "," && angleDepth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

// ---------------------------------------------------------------------------
// Child side: the rows, on the copy of the tree at ctx.tree (ctx.given for R01-R03).

const V051 = { sourceProfile: "typed-v0.51" };
const V053 = { sourceProfile: "typed-v0.53", allowCandidateProfile: true };
const NEST = "air.decision.payload_type_unsupported: type nesting exceeds the supported flat-sum surface";
const nested = (d, inner) => `${"option<".repeat(d)}${inner}${">".repeat(d)}`;
const resultNest = (d, inner) => `${"result<".repeat(d)}${inner}${",E>".repeat(d)}`;
const mixed = (d, inner) => { let s = inner; for (let k = 0; k < d; k += 1) s = k % 2 ? `option<${s}>` : `result<${s},E>`; return s; };
const arrays = (d, inner) => `${"array<".repeat(d)}${inner}${",1>".repeat(d)}`;
const balanced = (h) => (h === 0 ? "i32" : `result<${balanced(h - 1)},${balanced(h - 1)}>`);
const ERR = "error enum E {\n  bad = 0,\n}\n\n";
const paramModule = (type) => `module p.q\n\nexport func f(value: ${type}) -> i32 {\n  %out: i32 = 1\n  return %out\n}\n`;
const errParamModule = (type) => `module p.q\n\n${ERR}export func f(value: ${type}) -> i32 {\n  %out: i32 = 1\n  return %out\n}\n`;
const legacyModule = (decl, body = "") => `module p_q\ncapabilities { }\n\n${decl}\n\nexport func run() -> i32 {\nentry:\n${body}  %one:i32 = 1\n  return %one\n}\n`;
const caught = (fn) => { try { fn(); return null; } catch (e) { return e; } };
const nestErr = (e) => Boolean(e) && e.name === "TypedInterfaceError" && e.message === NEST && !e.line;
const said = (e) => (e ? `${e.name}: ${String(e.message).slice(0, 140)}` : "no error");

// A parse in a process of its own: the source and the expected message go through files; the child reports the error's name, whether its
// message equals the expected one, and the parse time. A SIGKILL at the limit is reported as killed.
function childParse(ctx, source, file, opts, expected, limitMs) {
  ctx.children += 1;
  const srcPath = path.join(ctx.work, `child-${ctx.children}.air`);
  const expPath = path.join(ctx.work, `child-${ctx.children}.expected`);
  fs.writeFileSync(srcPath, source);
  fs.writeFileSync(expPath, expected);
  const script = `const fs=require("fs");const air=require(${JSON.stringify(path.join(ctx.tree, "src"))});const src=fs.readFileSync(${JSON.stringify(srcPath)},"utf8");const exp=fs.readFileSync(${JSON.stringify(expPath)},"utf8");const t=process.hrtime.bigint();let o;try{air.parseSource(src,${JSON.stringify(file)},${JSON.stringify(opts)});o={parsed:true};}catch(e){o={name:e&&e.name,equal:Boolean(e)&&e.message===exp,head:String(e&&e.message).slice(0,90),length:String(e&&e.message).length};}o.ms=Number((process.hrtime.bigint()-t)/1000000n);process.stdout.write(JSON.stringify(o));`;
  const started = Date.now();
  const r = childProcess.spawnSync(process.execPath, ["-e", script], { cwd: ctx.work, encoding: "utf8", env: ENV0, killSignal: "SIGKILL", maxBuffer: 1 << 20, timeout: limitMs });
  fs.rmSync(srcPath, { force: true });
  fs.rmSync(expPath, { force: true });
  if (r.signal) return { killed: `${r.signal} after ${Date.now() - started} ms` };
  try { return JSON.parse(r.stdout); } catch { return { crashed: `exit ${r.status}`, stderr: String(r.stderr).split("\n").find((line) => /Error/.test(line)) || "" }; }
}
const childRow = (source, file, opts, name, expected, limitMs) => (ctx) => {
  const r = childParse(ctx, source, file, opts, expected, limitMs);
  return { pass: r.name === name && r.equal === true && r.ms < limitMs, detail: r };
};

// F01, F02: seeded strings (the spec's generator, tokens and seed), each compared on the reference and on the tree.
const TOKENS = ["option", "result", "<", ">", ",", " ", "  ", "\t", "\n", "\r", "\u2028", "\u00a0", "i32", "E", "x", "\"", "\\", "=", "<=", "slice", "len", "0..5", "void", "Bad!", "option <", "result<", "> ", " ,"];
function differential(ctx, fnName, variants) {
  ({ AirError } = require(path.join(ctx.tree, "src/errors.js")));
  ({ parseRefinementType } = require(path.join(ctx.tree, "src/types.js")));
  ({ parseTypeReference } = require(path.join(ctx.tree, "src/typed_interface.js")));
  const reference = { canonicalizeV051SourceType, splitComma };
  const mine = require(path.join(ctx.tree, "src/parser.js"));
  let seed = 0x5ec5306;
  const rand = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const gen = () => { const n = 1 + Math.floor(rand() * 14); let s = rand() < 0.5 ? (rand() < 0.5 ? "option<" : "result<") : ""; for (let k = 0; k < n; k += 1) s += TOKENS[Math.floor(rand() * TOKENS.length)]; if (rand() < 0.6) s += ">"; return s; };
  const out = (fn) => { try { return JSON.stringify({ ok: fn() }); } catch (e) { return JSON.stringify({ name: e.name, message: e.message }); } };
  let differences = 0;
  let first = null;
  for (let k = 0; k < 50000; k += 1) {
    const s = gen();
    for (const v of variants) {
      if (out(() => v(reference, s)) !== out(() => v(mine, s))) { differences += 1; if (!first) first = JSON.stringify(s); }
    }
  }
  return { pass: differences === 0, detail: { fn: fnName, strings: 50000, differences, first } };
}
const LOC = { file: "f.air", line: 7 };

// G-5's sample and the CLI.
function sample(ctx) {
  if (!ctx.sample) {
    const text = fs.readFileSync(path.join(ctx.tree, "fixtures/v051/first_vertical/typed_decide.air"), "utf8");
    const mod = ctx.air.parseSource(text, "typed_decide.air", V051);
    ctx.air.verifySource(mod, V051);
    const full = ctx.air.lowerToWat(mod);
    const file = path.join(ctx.work, "typed_decide.air");
    fs.writeFileSync(file, text);
    ctx.sample = { file, full, mod };
  }
  return ctx.sample;
}
function capped(ctx, cap) {
  try { return { wat: ctx.air.lowerToWat(sample(ctx).mod, { maxWatBytes: cap }) }; } catch (e) { return { code: e.code || e.message, message: String(e.message).slice(0, 120) }; }
}
function cli(ctx, file, extra, env, nodeArgs = []) {
  const o = childProcess.spawnSync(process.execPath, [...nodeArgs, path.join(ctx.tree, "bin/airc.js"), "build", file, "--source-profile", "typed-v0.51", ...extra], { cwd: ctx.work, encoding: "utf8", env });
  return { status: o.status, first: String(o.stderr).split("\n").filter(Boolean)[0] || "", stdout: String(o.stdout).trim().slice(0, 120) };
}
const wasmHex = (file) => (fs.existsSync(file) ? fs.readFileSync(file).toString("hex") : "");
function layout(ctx, id) {
  const root = path.join(ctx.work, `layout-${id}`, "node_modules");
  fs.mkdirSync(root, { recursive: true });
  const source = path.join(WABT_MODULES, "wabt");
  if (id === "L3") {
    fs.cpSync(source, path.join(root, "wabt"), { recursive: true });
    fs.chmodSync(path.join(root, "wabt"), 0o755);
    fs.symlinkSync("LICENSE", path.join(root, "wabt", "LICENSE.link"));
  } else {
    fs.symlinkSync(source, path.join(root, "wabt"), "dir");
  }
  return root;
}
function layoutRow(id, layoutId, nodeArgs) {
  return (ctx) => {
    if (!ctx.referenceHex) return { pass: false, detail: "needs a passing C03" };
    const outFile = path.join(ctx.work, `${id}.wasm`);
    const r = cli(ctx, sample(ctx).file, ["--emit", "wasm", "-o", outFile], { ...ENV0, NODE_PATH: layout(ctx, layoutId) }, nodeArgs);
    return { pass: r.status === 0 && wasmHex(outFile) === ctx.referenceHex, detail: r };
  };
}

// R01-R03: landed tests in the given tree, with nothing but PATH, HOME and TMPDIR (and R03's own results folder) in the environment.
function landed(ctx, test, env = {}) {
  const o = childProcess.spawnSync(process.execPath, [test], { cwd: ctx.given, encoding: "utf8", env: { ...ENV0, ...env }, killSignal: "SIGKILL", maxBuffer: 64 * 1024 * 1024, timeout: CHILD_MS });
  return { status: o.status, signal: o.signal, out: `${o.stdout}${o.stderr}` };
}
const lastLine = (text) => String(text).trim().split("\n").slice(-1)[0].slice(0, 160);
const H52_VECTORS = ["V53-PROF-N02", "V53-PROF-N06"];
function scalarRow(ctx) {
  const dir = path.join(ctx.work, "r03");
  const o = landed(ctx, "test/v053_scalar.test.js", { AIR_SCALAR_VECTOR_RESULTS_DIR: dir });
  const file = path.join(dir, "v053_scalar.results.json");
  if (!fs.existsSync(file)) return { pass: false, detail: { status: o.status, signal: o.signal, last: lastLine(o.out), results: "not written" } };
  const list = JSON.parse(fs.readFileSync(file, "utf8"));
  const passing = list.filter((item) => item.status === "PASS" || item.status === "PASS_BY_COMMAND_LOGS");
  const unavailable = list.filter((item) => item.status === "ENVIRONMENT_UNAVAILABLE");
  const allowed = unavailable.filter((item) => H52_VECTORS.includes(item.vector) && item.value_or_failure && item.value_or_failure.reason === "H52_BASELINE git objects unavailable");
  const other = list.filter((item) => !passing.includes(item) && !allowed.includes(item)).map((item) => `${item.vector}:${item.status}`);
  const setting = allowed.length ? `${passing.length} of ${list.length} (${allowed.map((item) => item.vector).join(", ")} ENVIRONMENT_UNAVAILABLE: H52_BASELINE git objects unavailable)` : `${passing.length} of ${list.length}`;
  return { pass: o.status === 0 && list.length === 74 && other.length === 0 && passing.length + allowed.length === 74, detail: { status: o.status, vectors: list.length, setting, other, last: lastLine(o.out) } };
}

const WS = " ".repeat(65536);
const DENSE = "a <".repeat(200000);
const NAME = "A".repeat(262144);
const LNEST = (line) => `n.air:${line}: ${NEST}`;

const ROWS = [];
const row = (id, what, run) => ROWS.push({ id, what, run });

// G-2
row("T01", "typed-v0.51 param option<i32> parses", (ctx) => { const e = caught(() => ctx.air.parseSource(paramModule(nested(1, "i32")), "g.air", V051)); return { pass: !e, detail: said(e) }; });
row("T02", "depth 64: the existing payload refusal", (ctx) => { const e = caught(() => ctx.air.parseSource(paramModule(nested(64, "i32")), "g.air", V051));
  return { pass: Boolean(e) && e.name === "TypedInterfaceError" && e.message === "air.decision.payload_type_unsupported: option payload 'option<i32>' is unsupported", detail: said(e) }; });
for (const d of [65, 1024]) row(`T03.${d}`, `depth ${d}: the nesting refusal, unchanged`, (ctx) => { const e = caught(() => ctx.air.parseSource(paramModule(nested(d, "i32")), "g.air", V051)); return { pass: nestErr(e), detail: said(e) }; });
for (const d of [1025, 8885, 16000, 32768]) row(`T04.${d}`, `depth ${d}: the nesting refusal, never a RangeError`, (ctx) => { const e = caught(() => ctx.air.parseSource(paramModule(nested(d, "i32")), "g.air", V051)); return { pass: nestErr(e), detail: said(e) }; });
for (const d of [65, 1024]) row(`T05.${d}`, `depth ${d} around Bad!: the inner refusal, unchanged`, (ctx) => { const e = caught(() => ctx.air.parseSource(paramModule(nested(d, "Bad!")), "g.air", V051));
  return { pass: Boolean(e) && e.name === "AirError" && e.message === "g.air:3: air.v051.type_reference_invalid: type reference 'Bad!' is not admitted by AIR ABI 0.12 candidate", detail: said(e) }; });
row("T06", "depth 1025 around Bad!: the nesting refusal (OD-S6-2 (b))", (ctx) => { const e = caught(() => ctx.air.parseSource(paramModule(nested(1025, "Bad!")), "g.air", V051)); return { pass: nestErr(e), detail: said(e) }; });
row("T07", "match arm none => option.none<option^12000<i32>>: the nesting refusal", (ctx) => {
  const src = `module p.q\n\nexport func f(value: option<i32>) -> option<i32> {\n  %out: option<i32> = match %value {\n    none => option.none<${nested(12000, "i32")}>,\n    some(item) => option.some<i32> %item,\n  }\n  return %out\n}\n`;
  const e = caught(() => ctx.air.parseSource(src, "g.air", V051)); return { pass: nestErr(e), detail: said(e) }; });
row("T08", "return type option^16000<i32>: the nesting refusal", (ctx) => {
  const e = caught(() => ctx.air.parseSource(`module p.q\n\nexport func f(value: i32) -> ${nested(16000, "i32")} {\n  return %value\n}\n`, "g.air", V051)); return { pass: nestErr(e), detail: said(e) }; });
row("T09", "depth 1024 around a 200,000-character name: a coded refusal (air.v051.type_reference_invalid) within 5 s", (ctx) => {
  const started = process.hrtime.bigint();
  const e = caught(() => ctx.air.parseSource(paramModule(nested(1024, `A${"a".repeat(199999)}`)), "g.air", V051));
  const ms = Number((process.hrtime.bigint() - started) / 1000000n);
  return { pass: Boolean(e) && e.name === "AirError" && e.message.startsWith("g.air:3: air.v051.type_reference_invalid: ") && ms < 5000, detail: { ms, error: said(e).slice(0, 100) } }; });
row("T10", "typed-v0.53 (candidate opt-in) param option^65<i32>: its own located refusal, unchanged", (ctx) => {
  const e = caught(() => ctx.air.parseSource(`module v53.t\n\nexport func f(value: ${nested(65, "i32")}) -> i32 {\n  return 1\n}\n`, "t.air", V053));
  return { pass: Boolean(e) && e.name === "AirError" && e.message === `t.air:3: ${NEST}`, detail: said(e) }; });
row("T11", "param result^20000<i32,E> (child, 5 s): the nesting refusal", childRow(errParamModule(resultNest(20000, "i32")), "g.air", V051, "TypedInterfaceError", NEST, 5000));
row("T12", "param of 20,000 levels alternating result and option (child, 5 s): the nesting refusal", childRow(errParamModule(mixed(20000, "i32")), "g.air", V051, "TypedInterfaceError", NEST, 5000));
row("T13", "a local %x: option^20000<i32> (child, 5 s): the nesting refusal", childRow(
  `module p.q\n\nexport func f(value: i32) -> i32 {\n  %x: ${nested(20000, "i32")} = option.none<i32>\n  %out: i32 = 1\n  return %out\n}\n`, "g.air", V051, "TypedInterfaceError", NEST, 5000));
row("T14", "a match destination %out: option^20000<i32> (child, 5 s): the nesting refusal", childRow(
  `module p.q\n\nexport func f(value: option<i32>) -> i32 {\n  %out: ${nested(20000, "i32")} = match %value {\n    none => option.none<i32>,\n    some(item) => option.some<i32> %item,\n  }\n  %r: i32 = 1\n  return %r\n}\n`, "g.air", V051, "TypedInterfaceError", NEST, 5000));
row("T15", "param result<option^1024<i32>,E,E> (1,025 levels, the outer type invalid): the nesting refusal", (ctx) => {
  const e = caught(() => ctx.air.parseSource(errParamModule(`result<${nested(1024, "i32")},E,E>`), "g.air", V051)); return { pass: nestErr(e), detail: said(e) }; });

// The worst-case type parse (P2-3): today's exact results, within the time limits.
row("B01", "param option< + 65,536 spaces + x (child, 5 s): today's refusal", childRow(paramModule(`option<${WS}x`), "n.air", V051, "AirError",
  `n.air:3: air.v051.type_reference_invalid: type reference 'option<${WS}x' is not admitted by AIR ABI 0.12 candidate`, 5000));
row("B02", "param result< + 65,536 spaces + x (child, 5 s): today's refusal", childRow(paramModule(`result<${WS}x`), "n.air", V051, "AirError",
  `n.air:3: air.v051.type_reference_invalid: type reference 'result<${WS}x' is not admitted by AIR ABI 0.12 candidate`, 5000));
row("B03", "typed-v0.53 param option< + 65,536 spaces + x, inside its source limit (child, 5 s): today's refusal", childRow(
  `module v53.t\n\nexport func f(value: option<${WS}x) -> i32 {\n  return 1\n}\n`, "n.air", V053, "AirError",
  `n.air:3: air.v051.type_reference_invalid: type reference 'option<${WS}x' is not admitted by AIR ABI 0.12 candidate`, 5000));
row("B04", "typed-v0.51 parameter list value: i32, + 200,000 'a <' (child, 2 s): today's refusal", childRow(
  `module p.q\n\nexport func f(value: i32, ${DENSE}) -> i32 {\n  %out: i32 = 1\n  return %out\n}\n`, "n.air", V051, "AirError", `n.air:3: air.v051.typed_syntax_invalid: invalid parameter '${DENSE.trim()}'`, 2000));
row("B05", "param result^1024 around a 256 KiB name (child, 5 s): today's refusal", childRow(errParamModule(resultNest(1024, NAME)), "n.air", V051, "AirError",
  `n.air:7: air.v051.type_reference_invalid: type reference '${NAME}' is not admitted by AIR ABI 0.12 candidate`, 5000));
row("B06", "param: a balanced result tree of height 18, about 3 MB (child, 5 s): today's refusal", childRow(errParamModule(balanced(18)), "n.air", V051, "TypedInterfaceError",
  "air.decision.payload_type_unsupported: result type 'result<i32,i32>' is unsupported", 5000));
row("B07", "legacy parameter list value: i32, + 200,000 'a <' (child, 2 s): today's refusal", childRow(
  `module p_q\ncapabilities { }\n\nfunc g(value: i32, ${DENSE}) -> i32 {\nentry:\n  %one:i32 = 1\n  return %one\n}\n`, "n.air", {}, "AirError", `n.air:4: invalid parameter '${DENSE.trim()}'`, 2000));

// The linear forms give 9e9a3783's results.
row("F01", "splitComma on 50,000 seeded strings: 9e9a3783's parts", (ctx) => differential(ctx, "splitComma", [(m, s) => m.splitComma(s)]));
row("F02", "canonicalizeV051SourceType on the same strings, allowVoid false and true: 9e9a3783's result or error", (ctx) => differential(ctx, "canonicalizeV051SourceType",
  [(m, s) => m.canonicalizeV051SourceType(s, "p.q", false, LOC), (m, s) => m.canonicalizeV051SourceType(s, "p.q", true, LOC)]));

// Legacy deep types (OD-S6-5 (a)).
row("L01", "legacy struct field array^1024<i32,1>: parses, verifies and lowers", (ctx) => {
  const mod = ctx.air.parseSource(legacyModule(`struct S { x: ${arrays(1024, "i32")} }`), "n.air", {}); ctx.air.verifySource(mod, {}); const wat = ctx.air.lowerToWat(mod);
  return { pass: typeof wat === "string" && wat.length > 0, detail: { watLength: wat.length } }; });
row("L02", "legacy struct field array^1025<i32,1>: the located nesting refusal, n.air:4", (ctx) => {
  const e = caught(() => ctx.air.parseSource(legacyModule(`struct S { x: ${arrays(1025, "i32")} }`), "n.air", {})); return { pass: Boolean(e) && e.name === "AirError" && e.message === LNEST(4), detail: said(e) }; });
row("L03", "legacy param array^20000 (child, 5 s): the located nesting refusal, n.air:4", childRow(legacyModule(`func g(value: ${arrays(20000, "i32")}) -> i32 {\nentry:\n  %one:i32 = 1\n  return %one\n}`), "n.air", {}, "AirError", LNEST(4), 5000));
row("L04", "legacy local %x:array^20000 on line 8 (child, 5 s): the located nesting refusal, n.air:8", childRow(legacyModule("", `  %x:${arrays(20000, "i32")} = 1\n`), "n.air", {}, "AirError", LNEST(8), 5000));
row("L05", "legacy return type array^20000 (child, 5 s): the located nesting refusal, n.air:4", childRow(legacyModule(`func g() -> ${arrays(20000, "i32")} {\nentry:\n  %one:i32 = 1\n  return %one\n}`), "n.air", {}, "AirError", LNEST(4), 5000));
row("L06", "legacy struct field array^1024<Bad!,1>: today's unknown-type refusal", (ctx) => { const type = arrays(1024, "Bad!"); const e = caught(() => ctx.air.parseSource(legacyModule(`struct S { x: ${type} }`), "n.air", {}));
  return { pass: Boolean(e) && e.name === "AirError" && e.message === `n.air:4: unknown type '${type}'`, detail: said(e) }; });
row("L07", "legacy struct field i32< + 1,100 '<' + 1..2>: the refinement refusal still comes first", (ctx) => { const type = `i32<${"<".repeat(1100)}1..2>`; const e = caught(() => ctx.air.parseSource(legacyModule(`struct S { x: ${type} }`), "n.air", {}));
  return { pass: Boolean(e) && e.name === "AirError" && e.message === `n.air:4: air.refinement.syntax_invalid: malformed i32 refinement '${type}'; expected i32<MIN..MAX>`, detail: said(e) }; });

// G-5
row("W00", "lowerToWat(typed_decide): 7,015 bytes", (ctx) => { const bytes = Buffer.byteLength(sample(ctx).full, "utf8"); return { pass: bytes === 7015, detail: bytes }; });
for (const cap of [1, 40, 80, 3507]) row(`W01.${cap}`, `cap ${cap}: air.v052.work_limit_wat_bytes at the per-line charge, unchanged`, (ctx) => { const r = capped(ctx, cap); return { pass: r.code === "air.v052.work_limit_wat_bytes", detail: r.code ? r : Buffer.byteLength(r.wat) }; });
for (const cap of [6815, 7014]) row(`W02.${cap}`, `cap ${cap}: air.v052.work_limit_wat_bytes (it used to return 7,015 bytes)`, (ctx) => { const r = capped(ctx, cap); return { pass: r.code === "air.v052.work_limit_wat_bytes", detail: r.code ? r : Buffer.byteLength(r.wat) }; });
for (const cap of [7015, 7016]) row(`W03.${cap}`, `cap ${cap}: the uncapped WAT, byte for byte`, (ctx) => { const r = capped(ctx, cap); return { pass: r.wat === sample(ctx).full, detail: r.code ? r : Buffer.byteLength(r.wat) }; });

// G-7
row("C01", "airc build typed_decide.air --emit wasm, no resolvable WABT: exit 1, air.v052.toolchain_input_unavailable", (ctx) => {
  const r = cli(ctx, sample(ctx).file, ["--emit", "wasm", "-o", path.join(ctx.work, "a.wasm")], ENV0);
  return { pass: r.status === 1 && r.first === "air.v052.toolchain_input_unavailable: installed WABT identity is unavailable", detail: r }; });
row("C02", "--emit wat, no WABT: exit 0, lowerToWat's WAT", (ctx) => {
  const r = cli(ctx, sample(ctx).file, ["--emit", "wat", "-o", path.join(ctx.work, "a.wat")], ENV0);
  const file = path.join(ctx.work, "a.wat");
  return { pass: r.status === 0 && fs.existsSync(file) && fs.readFileSync(file, "utf8") === sample(ctx).full, detail: r }; });
row("C03", "--emit wasm with WABT 1.0.39: exit 0, the SDK's watToWasm of that WAT", (ctx) => {
  if (!fs.existsSync(path.join(WABT_MODULES, "wabt"))) return { pass: false, detail: `no wabt in ${WABT_MODULES}` };
  const r = cli(ctx, sample(ctx).file, ["--emit", "wasm", "-o", path.join(ctx.work, "b.wasm")], { ...ENV0, NODE_PATH: WABT_MODULES });
  const watFile = path.join(ctx.work, "c03.wat");
  fs.writeFileSync(watFile, sample(ctx).full);
  const sdk = childProcess.spawnSync(process.execPath, ["-e", `require(${JSON.stringify(path.join(ctx.tree, "src"))}).watToWasm(require("fs").readFileSync(${JSON.stringify(watFile)}, "utf8"), "typed_decide.air").then((w) => process.stdout.write(Buffer.from(w).toString("hex")))`],
    { cwd: ctx.work, encoding: "utf8", env: { ...ENV0, NODE_PATH: WABT_MODULES }, maxBuffer: 16 * 1024 * 1024 });
  const cliHex = wasmHex(path.join(ctx.work, "b.wasm"));
  const pass = r.status === 0 && cliHex.length > 0 && cliHex === sdk.stdout;
  if (pass) ctx.referenceHex = cliHex;
  return { pass, detail: { status: r.status, bytes: cliHex.length / 2, first: r.first } }; });
row("C04", "export func f(value: i32) -> void { } with --emit wasm, no WABT: the lowering refusal first, as today", (ctx) => {
  const file = path.join(ctx.work, "typed_void.air");
  fs.writeFileSync(file, "module p.v\n\nexport func f(value: i32) -> void {\n}\n");
  const r = cli(ctx, file, ["--emit", "wasm", "-o", path.join(ctx.work, "v.wasm")], ENV0);
  return { pass: r.status === 1 && r.first.startsWith("air.v051.typed_lowering_unsupported"), detail: r }; });
row("C05", "--emit wasm, NODE_PATH holding node_modules/wabt as a symbolic link to WABT: C03's Wasm", layoutRow("C05", "L1", []));
row("C06", "C05 with node --preserve-symlinks: C03's Wasm", layoutRow("C06", "L2", ["--preserve-symlinks"]));
row("C07", "--emit wasm, a copy of WABT with one symbolic link inside (LICENSE.link to LICENSE): C03's Wasm", layoutRow("C07", "L3", []));

// O-2
row("O01", "auditModule(typed-v0.51 AST): air.assurance.profile_unsupported", (ctx) => { const e = caught(() => ctx.air.auditModule(sample(ctx).mod));
  return { pass: Boolean(e) && e.message === "air.assurance.profile_unsupported: auditModule does not support the 'typed-v0.51' source profile", detail: said(e) }; });
row("O02", "explainModule(typed-v0.51 AST): air.assurance.profile_unsupported", (ctx) => { const e = caught(() => ctx.air.explainModule(sample(ctx).mod));
  return { pass: Boolean(e) && e.message === "air.assurance.profile_unsupported: explainModule does not support the 'typed-v0.51' source profile", detail: said(e) }; });
for (const [id, label, call] of [["O03a", "formatModule", (ctx) => ctx.air.formatModule(sample(ctx).mod)], ["O03b", "formatSource(..., legacy-v0.50)", (ctx) => ctx.air.formatSource(sample(ctx).mod, { sourceProfile: "legacy-v0.50" })]]) {
  row(id, `${label} of a typed-v0.51 AST: air.source_profile.ast_mismatch`, (ctx) => { const e = caught(() => call(ctx));
    return { pass: Boolean(e) && e.message === "air.source_profile.ast_mismatch: the AST was parsed as 'typed-v0.51' and cannot be processed as 'legacy-v0.50'", detail: said(e) }; });
}
row("O04", "formatSource(typed-v0.51 AST, typed-v0.51): today's output, sha256 51c5b276...", (ctx) => { const h = crypto.createHash("sha256").update(ctx.air.formatSource(sample(ctx).mod, V051)).digest("hex");
  return { pass: h === "51c5b2763d2559bb4c39af3011a1c2711619bacef2d5d80643bc92813b14daf5", detail: h.slice(0, 16) }; });

// The code delimiter, unchanged (OD-S6-4 (a)).
row("D01", "a typed-v0.51 match missing a case: d.air:9: air.decision.match_nonexhaustive, unchanged", (ctx) => {
  const src = "module p.q\n\nenum A {\n  x = 0,\n  y = 1,\n}\n\nexport func f(a: A) -> i32 {\n  %out: i32 = match %a {\n    A.x => 1,\n  }\n  return %out\n}\n";
  const e = caught(() => ctx.air.verifySource(ctx.air.parseSource(src, "d.air", V051), V051)); return { pass: Boolean(e) && e.message === "d.air:9: air.decision.match_nonexhaustive", detail: said(e) }; });

// The suites (R01-R03), in the given tree.
row("R01", "node test/v051_frozen_conformance_matrix.test.js passes: N01-N37, D01-D28, H01-H08", (ctx) => { const o = landed(ctx, "test/v051_frozen_conformance_matrix.test.js");
  return { pass: o.status === 0 && o.out.includes("v0.51 frozen Node conformance matrix: N01-N37, D01-D28, H01-H08 passed"), detail: { status: o.status, signal: o.signal, last: lastLine(o.out) } }; });
row("R02", "node test/v051_typed_runtime.test.js passes: RT01-RT10, SUM01-SUM14", (ctx) => { const o = landed(ctx, "test/v051_typed_runtime.test.js");
  return { pass: o.status === 0 && o.out.includes("v0.51 typed first vertical: RT01-RT10 and SUM01-SUM14 passed"), detail: { status: o.status, signal: o.signal, last: lastLine(o.out) } }; });
row("R03", "node test/v053_scalar.test.js: exit 0, 74 vectors, each a pass but the two H52_BASELINE vectors where git objects are absent (reading note 2)", scalarRow);

async function runRows(given, ids) {
  const work = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "air-sec53-06-rows-"));
  const out = {};
  try {
    const tree = path.join(work, "tree");
    for (const part of PARTS) fs.cpSync(path.join(given, part), path.join(tree, part), { recursive: true });
    const ctx = { air: require(path.join(tree, "src")), children: 0, given, referenceHex: "", tree, work };
    const wanted = ids.length ? ROWS.filter((item) => ids.includes(item.id)) : ROWS;
    for (const item of wanted) {
      try {
        const got = await item.run(ctx);
        out[item.id] = { ok: Boolean(got.pass), detail: got.detail };
      } catch (error) {
        out[item.id] = { ok: false, threw: short(error) };
      }
    }
  } finally {
    fs.rmSync(work, { force: true, recursive: true });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Orchestrator side: SPEC section 7's mutants, with the edits of the spec's tools/s6_mutants.js. Each edit's anchor must occur exactly
// once in the scratch copy's file, or the mutant is not applied. M15 restores 9e9a3783's splitComma, the reference carried above.

function functionText(text, name) {
  const start = text.indexOf(`\nfunction ${name}(`) + 1;
  const end = text.indexOf("\n}\n", start) + 3;
  return start > 0 && end > start ? text.slice(start, end) : null;
}
const G7 = "        if (typed) assertWabtResolves();\n";
const SNAPSHOT = "        if (typed) createToolchainGuard(path.join(__dirname, \"..\", \"src\")).snapshot();\n";
const TYPED_LOWER = "        wat = lowerToWat(mod, { maxWatBytes: VERIFIED_TYPED_RUNTIME_LIMITS.maxWatBytes });\n";
const LEGACY_CALL = "  assertLegacyTypeNesting(String(type), loc);\n";
const REFINEMENT = "  const refinement = parseRefinementType(type, loc);\n  if (refinement) return refinement;\n";

const MUTANTS = [
  ["M1", "G-2: the canonicalizer's nesting guard removed", "src/parser.js", [["  assertTypeNesting(text, V051_TYPE_RECURSION_LIMIT);\n", ""]], ["T04.16000", "T07", "T08", "T11"]],
  ["M2", "G-2: the guard one level lower (1023)", "src/parser.js", [["const V051_TYPE_RECURSION_LIMIT = 1024;", "const V051_TYPE_RECURSION_LIMIT = 1023;"]], ["T05.1024"]],
  ["M3", "G-2: parseTypeReference's own limit moved to 65 by the refactor", "src/typed_interface.js", [["  assertTypeNesting(value, 64);\n", "  assertTypeNesting(value, 65);\n"]], ["T03.65"]],
  ["M4", "G-2: the guard throws a located AirError, not today's refusal", "src/parser.js", [["  assertTypeNesting(text, V051_TYPE_RECURSION_LIMIT);\n",
    "  try { assertTypeNesting(text, V051_TYPE_RECURSION_LIMIT); } catch (e) { throw new AirError(e.message, loc); }\n"]], ["T04.1025"]],
  ["M5", "G-5: the whole-WAT check removed", "src/lower_wasm.js", [["    if (budget && Buffer.byteLength(wat, \"utf8\") > options.maxWatBytes) {", "    if (false) {"]], ["W02.7014"]],
  ["M6", "G-5: the check refuses a WAT equal to the cap", "src/lower_wasm.js", [["Buffer.byteLength(wat, \"utf8\") > options.maxWatBytes", "Buffer.byteLength(wat, \"utf8\") >= options.maxWatBytes"]], ["W03.7015"]],
  ["M7", "G-7: the WABT check removed from the typed-v0.51 CLI build", "bin/airc.js", [[G7, ""]], ["C01"]],
  ["M8", "G-7: the check placed before lowering (changes the error order)", "bin/airc.js", [[G7, ""],
    [TYPED_LOWER, `        if (emit === "wasm") assertWabtResolves();\n${TYPED_LOWER}`]], ["C04"]],
  ["M9", "O-2: auditModule's typed-v0.51 guard removed", "src/audit.js", [["  if (mod && mod.v051TypedAst) throw assuranceProfileUnsupported(\"auditModule\", \"typed-v0.51\");\n", ""]], ["O01"]],
  ["M10", "O-2: explainModule's typed-v0.51 guard removed", "src/explain.js", [["  if (mod && mod.v051TypedAst) throw assuranceProfileUnsupported(\"explainModule\", \"typed-v0.51\");\n", ""]], ["O02"]],
  ["M11", "O-2: formatModule's typed-v0.51 guard removed", "src/format.js", [["  if (mod && mod.v051TypedAst) {\n    throw new AirError(\"air.source_profile.ast_mismatch: the AST was parsed as 'typed-v0.51' and cannot be processed as 'legacy-v0.50'\");\n  }\n", ""]], ["O03a", "O03b"]],
  ["M12", "G-2: the guard counts only option< (QA's mutant)", "src/typed_interface.js", [["    if (value[index] === \"<\" && ++nesting > limit) {", "    if (value[index] === \"<\" && value.endsWith(\"option\", index) && ++nesting > limit) {"]], ["T11"]],
  ["M13", "G-7: the full typed-v0.53 toolchain snapshot instead of the WABT check", "bin/airc.js", [[G7, SNAPSHOT]], ["C06", "C07"]],
  ["M14", "P2-3: the type matcher goes back to the backtracking expression", "src/parser.js", [["  if (!value.startsWith(name)) return null;\n",
    "  const found = value.match(new RegExp(\"^\" + name + \"\\\\s*<\\\\s*(.+)\\\\s*>$\"));\n  return found ? found[1].trim() : null;\n"]], ["B01", "B02", "B03"]],
  ["M15", "P2-3: splitComma goes back to 9e9a3783's body (a string grown one character at a time)", "src/parser.js",
    [[(text) => functionText(text, "splitComma"), () => `${splitComma.toString()}\n`]], ["B04", "B06", "B07"]],
  ["M16", "P2-3: the matcher admits a line terminator inside the core", "src/parser.js", [["  if (core) return /[\\n\\r\\u2028\\u2029]/.test(core) ? null : core;\n", "  if (core) return core;\n"]], ["F02"]],
  ["M17", "P2-3: splitComma counts a '<' at the start of a part", "src/parser.js", [["text[i + 1] !== \"=\" && i > start && ", "text[i + 1] !== \"=\" && i > 0 && "]], ["F01"]],
  ["M18", "P2-4: the legacy nesting guard removed", "src/types.js", [[LEGACY_CALL, ""]], ["L02", "L03", "L04", "L05"]],
  ["M19", "P2-4: the legacy guard one level lower (1023)", "src/types.js", [["const LEGACY_TYPE_NESTING_LIMIT = 1024;", "const LEGACY_TYPE_NESTING_LIMIT = 1023;"]], ["L01"]],
  ["M20", "P2-4: the legacy refusal without its location", "src/types.js", [["type nesting exceeds the supported flat-sum surface\", loc);", "type nesting exceeds the supported flat-sum surface\");"]], ["L02"]],
  ["M21", "P2-4: the legacy guard before the refinement check (changes the error order)", "src/types.js", [[`${REFINEMENT}${LEGACY_CALL}`, `${LEGACY_CALL}${REFINEMENT}`]], ["L07"]]
];

function scratchTree(name, file, edits) {
  const scratch = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), `air-sec53-06-${name}-`));
  for (const part of PARTS) fs.cpSync(path.join(ROOT, part), path.join(scratch, part), { recursive: true });
  const target = path.join(scratch, file);
  let text = fs.readFileSync(target, "utf8");
  let applied = true;
  for (const [fromSpec, toSpec] of edits) {
    const from = typeof fromSpec === "function" ? fromSpec(text) : fromSpec;
    const to = typeof toSpec === "function" ? toSpec() : toSpec;
    if (!from || typeof to !== "string" || from === to || text.split(from).length !== 2) { applied = false; break; }
    text = text.replace(from, () => to);
  }
  if (applied) fs.writeFileSync(target, text);
  return { applied, scratch };
}

// A child "ran" only when it finished and wrote its rows; a timeout or a crash is not a run, so it cannot catch.
function runChild(tree, ids) {
  const outDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "air-sec53-06-out-"));
  const outFile = path.join(outDir, "rows.json");
  let out;
  try {
    out = childProcess.spawnSync(process.execPath, [__filename, "--rows", tree, outFile, ...ids], {
      cwd: os.tmpdir(), encoding: "utf8", killSignal: "SIGKILL", maxBuffer: 64 * 1024 * 1024, timeout: CHILD_MS
    });
    if (!out.signal && out.status === 0 && fs.existsSync(outFile)) return { ran: true, results: JSON.parse(fs.readFileSync(outFile, "utf8")) };
  } finally {
    fs.rmSync(outDir, { force: true, recursive: true });
  }
  const reason = out.signal ? `killed by ${out.signal} (timeout)` : `exit ${out.status}: ${String(out.stderr).slice(0, 400)}`;
  return { ran: false, results: Object.fromEntries(ids.map((id) => [id, { ok: false, child: reason }])) };
}

function main() {
  const failures = [];
  const allRows = ROWS.map((item) => item.id);
  const real = runChild(ROOT, allRows);
  if (!real.ran) failures.push(`rows: the child did not finish: ${JSON.stringify(real.results[allRows[0]])}`);
  for (const item of ROWS) {
    const got = real.results[item.id];
    if (got && got.ok) console.log(`ok - ${item.id} ${item.what}`);
    else failures.push(`${item.id} (${item.what}): ${JSON.stringify(got).slice(0, 400)}`);
  }
  const mutantRows = allRows.filter((id) => !/^R0/.test(id));
  const mutants = {};
  for (const [name, description, file, edits, named] of MUTANTS) {
    const { applied, scratch } = scratchTree(name, file, edits);
    let ran = false;
    let failing = [];
    let set = { results: {} };
    try {
      if (applied) {
        set = runChild(scratch, mutantRows);
        ran = set.ran;
        failing = mutantRows.filter((id) => !(set.results[id] && set.results[id].ok));
      }
    } finally {
      fs.rmSync(scratch, { force: true, recursive: true });
    }
    const caughtBy = named.filter((id) => failing.includes(id));
    const caught = applied && ran && caughtBy.length > 0;
    const caughtDetail = Object.fromEntries(caughtBy.map((id) => [id, JSON.stringify(set.results[id]).slice(0, 300)]));
    mutants[name] = { applied, caught, caught_by: caughtBy, caught_detail: caughtDetail, description, failing_rows: failing, file, named_rows: named, ran };
    if (caught) console.log(`ok - mutant ${name} (${description}): applied, ran, caught by ${caughtBy.join(", ")}${failing.length > caughtBy.length ? `; also failing ${failing.filter((id) => !caughtBy.includes(id)).join(", ")}` : ""}`);
    else failures.push(`mutant ${name} (${description}): applied ${applied}, ran ${ran}, caught ${caught}, failing ${failing.join(", ") || "none"}`);
  }
  const list = Object.values(mutants);
  const totals = { applied: list.filter((item) => item.applied).length, caught: list.filter((item) => item.caught).length, mutants: list.length, ran: list.filter((item) => item.ran).length,
    rows: allRows.length, rowsPassing: allRows.filter((id) => real.results[id] && real.results[id].ok).length };
  if (process.env.AIR_SEC53_06_RESULTS_DIR) {
    fs.mkdirSync(process.env.AIR_SEC53_06_RESULTS_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.AIR_SEC53_06_RESULTS_DIR, "v053_resource_limits_od5.results.json"), `${JSON.stringify({ mutants, platform: process.platform, rows: real.results, totals }, null, 2)}\n`);
  }
  if (failures.length) {
    for (const failure of failures) console.error(`not ok - ${failure}`);
    console.error(`SEC53-06 resource limits and OD-5: ${failures.length} failed`);
    process.exitCode = 1;
    return;
  }
  assert.equal(totals.applied, totals.mutants);
  assert.equal(totals.ran, totals.mutants);
  assert.equal(totals.caught, totals.mutants);
  const r03 = real.results.R03.detail.setting;
  console.log(`SEC53-06 resource limits and OD-5: ${totals.rowsPassing} rows PASS (VECTORS.md: T01-T15, B01-B07, F01-F02, L01-L07, W00-W03, C01-C07, O01-O04, D01, R01-R03; R03 saw ${r03}); mutants applied ${totals.applied}, ran ${totals.ran}, caught ${totals.caught} of ${totals.mutants} (M1-M21) (${process.platform})`);
}

if (process.argv[2] === "--rows") {
  const outFile = process.argv[4];
  runRows(path.resolve(process.argv[3]), process.argv.slice(5)).then((out) => fs.writeFileSync(outFile, JSON.stringify(out)), (error) => {
    console.error(error && error.stack || error);
    process.exitCode = 1;
  });
} else {
  try {
    main();
  } catch (error) {
    console.error(error && error.stack || error);
    process.exitCode = 1;
  }
}
