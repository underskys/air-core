"use strict";

// SEC53-06B (OD-S6-6 (a) with (i), owner 2026-11-10): the expressions of QA's super-linear inventory run through
// src/linear_regex.js. Driven from test/fixtures/v053_regex_bounds/: QA's inventory (pinned by sha256), and the
// sites and seeds tables generated from it. No site is listed here by hand.
// Rows, per in-scope expression:
//   X-S  its site wraps the literal in linearRegex.wrap(...)            (a restored expression fails this)
//   X-D  the wrapped form gives the native expression's results: exec, test, replace and split, on QA's seeds and seeded strings
//   X-T  QA's worst input at 64,000 units, through the wrapped form, in a child under 2 s
//   X-E  the same input as a source line through parseSource (Groups 1, 2 and 5) or parseV051Air (Group 3's probes), in a child under 2 s
// and once: X-R, the helper adds no name to the package root; X-G, an engine copy whose visited-state counter starts
// near 2^31 still holds X-T's 2 s; X-U, the engine's own cases (a leading "^.", the calls after one that throws partway,
// and the call shapes it refuses); X-B, every escape the pattern grammar can spell, in the body and in a class, with and
// without the u flag: the engine refuses it or gives V8's results.
// Usage: node test/v053_regex_bounds.test.js [--only <site>] [--rows S,D,T,E,R,G,U,B] [--json <out>]
const assert = require("node:assert");
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const FIX = path.join(__dirname, "fixtures", "v053_regex_bounds");
const INVENTORY_SHA256 = "cc655413315e92ec747e115f0aac7cf2dc33afa829ad788a2b8d91922ea362cd";
const N = 64000;
const LIMIT_MS = 2000;

const args = process.argv.slice(2);
const arg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const ONLY = arg("--only");
const ROWS = new Set((arg("--rows") || "S,D,T,E,R,G,U,B").split(","));
const JSON_OUT = arg("--json");

const inventoryBytes = fs.readFileSync(path.join(FIX, "inventory.json"));
assert.equal(crypto.createHash("sha256").update(inventoryBytes).digest("hex"), INVENTORY_SHA256, "the inventory is QA's pinned file");
const inventory = new Map(JSON.parse(inventoryBytes).expressions.map((e) => [e.id, e]));
const { sites, inventorySha256 } = JSON.parse(fs.readFileSync(path.join(FIX, "sites.json"), "utf8"));
assert.equal(inventorySha256, INVENTORY_SHA256, "sites.json was generated from the pinned inventory");
const { seeds } = JSON.parse(fs.readFileSync(path.join(FIX, "seeds.json"), "utf8"));
const linear = require(path.join(ROOT, "src", "linear_regex.js"));

const rows = [];
function row(id, fn) {
  let out;
  try { out = fn(); } catch (error) { out = { pass: false, detail: `threw ${error && error.name}: ${String(error && error.message).slice(0, 160)}` }; }
  rows.push({ id, pass: Boolean(out.pass), detail: out.detail });
}

// QA's worst input for an expression, with its pump at n units. The latest screen's shape is used: either
// "`prefix` + N × `unit` + `suffix`", or an example whose pump is shown as six units before "x".
function unescapeJs(text) {
  return text.replace(/\\u([0-9a-fA-F]{4})|\\(.)/g, (m, hex, c) => (hex ? String.fromCharCode(parseInt(hex, 16)) : ({ n: "\n", r: "\r", t: "\t", 0: "\0" }[c] ?? c)));
}
function worstInput(e, n) {
  const ws = e.worstShapes[e.worstShapes.length - 1];
  if (ws.shape) {
    const m = /^`([\s\S]*)` \+ N × `([\s\S]*)` \+ `([\s\S]*)`$/.exec(ws.shape);
    if (!m) throw new Error(`${e.site}: unreadable shape`);
    return unescapeJs(m[1]) + unescapeJs(m[2]).repeat(n) + unescapeJs(m[3]);
  }
  const example = unescapeJs(ws.example.replace(/^"([\s\S]*)"$/, "$1"));
  const m = /([^x])\1{5}(?=x)/.exec(example);
  if (!m) throw new Error(`${e.site}: no six-unit pump in the example`);
  return example.slice(0, m.index) + m[1].repeat(n) + example.slice(m.index + 6);
}
const nonGlobal = (re) => new RegExp(re.source, re.flags.replace("g", ""));

// X-D's strings: the seeds, the worst shape at small n, and seeded strings built from the seeds, the pattern's own words and edge characters.
function xdStrings(site, e) {
  const re = new RegExp(site.pattern, site.flags);
  const out = new Set(seeds[site.id]);
  for (const n of [0, 1, 2, 3, 7, 16]) out.add(worstInput(e, n));
  const words = (site.pattern.match(/[A-Za-z_]{2,}|->|=>|::/g) || []).filter((w) => !/^[sSdDwWbB]$/.test(w));
  const edges = [" ", "  ", "\t", "\r", "\n", "\u2028", "\u2029", " ", "　", "﻿", "x", "_", "__", "-", ".", ",", ":", "=", "<", ">", "(", ")", "[", "]", "{", "}", "%", "@", "\"", "'", "/", "0", "12", "A", "a", ";", "!", "#", "\\"];
  const pieces = [...words, ...edges, ...[...out].flatMap((s) => s.split(/(?<=[^A-Za-z0-9_])|(?=[^A-Za-z0-9_])/).slice(0, 40))];
  let seed = crypto.createHash("sha256").update(site.id).digest().readUInt32LE(0);
  const rand = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const base = [...out];
  const pick = (list) => list[Math.floor(rand() * list.length)];
  for (let k = 0; k < 500; k += 1) {
    let s = "";
    const len = 1 + Math.floor(rand() * 12);
    for (let j = 0; j < len; j += 1) s += pick(pieces);
    out.add(s);
  }
  // Near misses: a seed with one to three edits (insert a piece, delete a span, or replace a character).
  for (let k = 0; k < 2000; k += 1) {
    let s = pick(base);
    if (s.length > 400) continue;
    const edits = 1 + Math.floor(rand() * 3);
    for (let j = 0; j < edits; j += 1) {
      const at = Math.floor(rand() * (s.length + 1));
      const kind = rand();
      if (kind < 0.5) s = s.slice(0, at) + pick(edges.concat(words)) + s.slice(at);
      else if (kind < 0.75) s = s.slice(0, at) + s.slice(at + 1 + Math.floor(rand() * 3));
      else s = s.slice(0, at) + pick(edges) + s.slice(at + 1);
    }
    out.add(s);
  }
  return { re, strings: [...out] };
}
const shape = (v) => (v === null ? null : Array.isArray(v) ? { items: [...v], index: v.index, groups: v.groups } : v);

// A child with a hard limit; it reports its own elapsed time.
function child(script, limitMs) {
  const r = childProcess.spawnSync(process.execPath, ["-e", script], { encoding: "utf8", timeout: limitMs, killSignal: "SIGKILL", maxBuffer: 1 << 20, cwd: ROOT });
  if (r.signal) return { killed: true };
  try { return JSON.parse(r.stdout); } catch { return { crashed: `exit ${r.status}: ${String(r.stderr).split("\n").find((l) => /Error/.test(l)) || ""}` }; }
}

// X-E's modules, one per profile and placement (Groups 1, 2 and 5).
const SKELETONS = {
  legacy: (top, body) => [{}, `module p_q\ncapabilities { }\n\n${top}\n\nexport func run() -> i32 {\nentry:\n${body ? `  ${body}\n` : ""}  %one:i32 = 1\n  return %one\n}\n`],
  "typed-v0.51": (top, body) => [{ sourceProfile: "typed-v0.51" }, `module p.q\n\n${top}\n\nexport func f(value: i32) -> i32 {\n${body ? `  ${body}\n` : ""}  %out: i32 = 1\n  return %out\n}\n`],
  "typed-v0.53": (top, body) => [{ sourceProfile: "typed-v0.53", allowCandidateProfile: true }, `module v53.t\n\n${top}\n\nexport func f(value: i32) -> i32 {\n${body ? `  ${body}\n` : ""}  return 1\n}\n`]
};
function entryCases(e) {
  const r = e.reach;
  if (Number(e.group) === 3 && e.site.startsWith("src/parser.js:")) return [{ name: "parseV051Air", kind: "v051air" }];
  if (![1, 2, 5].includes(Number(e.group))) return [];
  const viaEntry = /parseSource \(([^)]+)\)/.exec(r.entry || "");
  const profiles = String(r.profile || r.profiles || (viaEntry ? viaEntry[1] : "")).split(/,\s*/).filter((p) => SKELETONS[p]);
  const placements = r.placement === "top" ? ["top"] : r.placement === "body" ? ["body"] : ["top", "body"];
  return profiles.flatMap((p) => placements.map((pl) => ({ name: `${p}/${pl}`, kind: "parse", profile: p, placement: pl })));
}

const selected = sites.filter((s) => !ONLY || s.site === ONLY || s.id === ONLY);
for (const site of selected) {
  const e = inventory.get(site.id);
  const literal = `/${site.pattern}/${site.flags}`;
  if (ROWS.has("S")) row(`X-S ${site.site}`, () => {
    const text = fs.readFileSync(path.join(ROOT, site.file), "utf8");
    let at = -1;
    for (let k = 0; k <= site.ordinal; k += 1) { at = text.indexOf(literal, at + 1); if (at === -1) return { pass: false, detail: "literal not found" }; }
    const wrapped = text.slice(Math.max(0, at - 17), at) === "linearRegex.wrap(" && text.slice(at + literal.length, at + literal.length + 1) === ")";
    const required = text.includes('const linearRegex = require("./linear_regex");');
    return { pass: wrapped && required, detail: { wrapped, required } };
  });
  if (ROWS.has("D")) row(`X-D ${site.site}`, () => {
    const { re, strings } = xdStrings(site, e);
    const w = linear.wrap(re);
    const plain = nonGlobal(re);
    const wPlain = linear.wrap(plain);
    let compared = 0;
    for (const s of strings) {
      const pairs = [
        ["exec", () => shape(plain.exec(s)), () => shape(wPlain.exec(s))],
        ["test", () => plain.test(s), () => wPlain.test(s)],
        ["replace", () => s.replace(re, ""), () => s.replace(w, "")],
        ["split", () => s.split(plain), () => s.split(wPlain)]
      ];
      for (const [name, native, mine] of pairs) {
        if (s.length > 200 && name !== "exec") continue;
        const a = JSON.stringify(native());
        const b = JSON.stringify(mine());
        compared += 1;
        if (a !== b) return { pass: false, detail: { method: name, input: JSON.stringify(s).slice(0, 120), native: a.slice(0, 120), linear: b.slice(0, 120) } };
      }
    }
    return { pass: true, detail: { strings: strings.length, compared } };
  });
  if (ROWS.has("T")) row(`X-T ${site.site}`, () => {
    const input = worstInput(e, N);
    const script = `const L=require(${JSON.stringify(path.join(ROOT, "src", "linear_regex.js"))});const re=new RegExp(${JSON.stringify(site.pattern)},${JSON.stringify(site.flags)});const p=new RegExp(re.source,re.flags.replace("g",""));const s=${JSON.stringify(input)};const t=process.hrtime.bigint();s.match(L.wrap(p));L.wrap(p).test(s);s.replace(L.wrap(re),"");s.split(L.wrap(p));process.stdout.write(JSON.stringify({ms:Number((process.hrtime.bigint()-t)/1000000n)}));`;
    const r = child(script, LIMIT_MS);
    return { pass: !r.killed && !r.crashed && r.ms < LIMIT_MS, detail: r };
  });
  if (ROWS.has("E")) for (const c of entryCases(e)) row(`X-E ${site.site} ${c.name}`, () => {
    const line = worstInput(e, N);
    let script;
    if (c.kind === "v051air") {
      script = `const air=require(${JSON.stringify(path.join(ROOT, "src"))});const s=${JSON.stringify(line)};const t=process.hrtime.bigint();let o;try{air.parseV051Air(s,"n.air");o="ok";}catch(e){o=e.name;}process.stdout.write(JSON.stringify({ms:Number((process.hrtime.bigint()-t)/1000000n),outcome:o}));`;
    } else {
      const [opts, source] = SKELETONS[c.profile](c.placement === "top" ? line : "", c.placement === "body" ? line : "");
      script = `const air=require(${JSON.stringify(path.join(ROOT, "src"))});const s=${JSON.stringify(source)};const t=process.hrtime.bigint();let o;try{air.parseSource(s,"n.air",${JSON.stringify(opts)});o="ok";}catch(e){o=e instanceof RangeError?"RangeError":e.name;}process.stdout.write(JSON.stringify({ms:Number((process.hrtime.bigint()-t)/1000000n),outcome:o}));`;
    }
    const r = child(script, LIMIT_MS);
    return { pass: !r.killed && !r.crashed && r.ms < LIMIT_MS && r.outcome !== "RangeError", detail: r };
  });
}
if (ROWS.has("R") && !ONLY) row("X-R the helper adds no name to the package root", () => {
  const rootNames = Object.keys(require(path.join(ROOT, "src")));
  const index = fs.readFileSync(path.join(ROOT, "src", "index.js"), "utf8");
  const pass = !rootNames.some((k) => /linear|wrap/i.test(k)) && !index.includes("linear_regex");
  return { pass, detail: { rootNames: rootNames.length } };
});

if (ROWS.has("G") && !ONLY) row("X-G a visited-state counter started at 2^31 - 600 keeps X-T's 2 s at 64,000", () => {
  // As QA's review did: a copy of the engine whose program counter starts after about 2.1 billion positions.
  const src = fs.readFileSync(path.join(ROOT, "src", "linear_regex.js"), "utf8");
  if (src.split("gen: 0 };").length !== 2) return { pass: false, detail: "the counter's start is not found once" };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "s6b-counter-"));
  try {
    const copy = path.join(dir, "linear_regex.js");
    fs.writeFileSync(copy, src.replace("gen: 0 };", "gen: 2147483048 };"));
    const site = sites[0];
    const input = worstInput(inventory.get(site.id), N);
    const script = `const L=require(${JSON.stringify(copy)});const re=new RegExp(${JSON.stringify(site.pattern)},${JSON.stringify(site.flags.replace("g", ""))});L.wrap(re).exec("x");const s=${JSON.stringify(input)};const t=process.hrtime.bigint();s.match(L.wrap(re));L.wrap(re).test(s);process.stdout.write(JSON.stringify({site:${JSON.stringify(site.site)},ms:Number((process.hrtime.bigint()-t)/1000000n)}));`;
    const r = child(script, LIMIT_MS);
    return { pass: !r.killed && !r.crashed && r.ms < LIMIT_MS, detail: r };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
if (ROWS.has("U") && !ONLY) row("X-U the engine's own cases: a leading '^.' is exact, the calls after one that throws partway are exact, and search, matchAll, a non-string replacement and new RegExp are refused", () => {
  const cases = [[/^.a/, ["ba", "aa", ".a", "a", ""]], [/^./, ["x", "", "\n"]], [/^.x+$/, ["ax", "\rx", "axx"]]];
  for (const [re, inputs] of cases) for (const s of inputs) {
    const a = JSON.stringify([shape(re.exec(s)), re.test(s), s.replace(re, ""), s.split(re)]);
    const w = linear.wrap(re);
    const b = JSON.stringify([shape(w.exec(s)), w.test(s), s.replace(w, ""), s.split(w)]);
    if (a !== b) return { pass: false, detail: { re: String(re), input: s, native: a, linear: b } };
  }
  // A call that throws partway, as a stack overflow inside the engine would. As QA's review did: a copy of the engine whose
  // add() throws once on its 40th entry, one call that aborts, then 300 calls compared with V8.
  const afterThrow = (() => {
    const src = fs.readFileSync(path.join(ROOT, "src", "linear_regex.js"), "utf8");
    const hook = "  function add(list, pc, caps, i) {\n";
    if (src.split(hook).length !== 2) return { pass: false, detail: "add() is not found once" };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "s6b-throw-"));
    try {
      const copy = path.join(dir, "linear_regex.js");
      fs.writeFileSync(copy, src.replace(hook, `${hook}    if (globalThis.throwAt !== undefined && --globalThis.throwAt === 0) throw new RangeError("injected");\n`));
      const re = /^%([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+?)\s*=\s*(.+)$/;
      const inputs = ["%a: i32 = 1", "%b: option<i32> = option.none<i32>", "%cc: T = x = y", "%x : i64 = 2", "nope", "%v: i32 = 3"];
      const script = `const L=require(${JSON.stringify(copy)});const re=new RegExp(${JSON.stringify(re.source)});const w=L.wrap(re);w.exec("%warm: i32 = 0");globalThis.throwAt=40;let threw=false;try{w.exec("%a: "+"x ".repeat(3000)+"= y");}catch(e){threw=e.message==="injected";}globalThis.throwAt=undefined;const show=(r)=>JSON.stringify(r&&[r.index,...r]);let compared=0,diffs=0,first=null;for(let k=0;k<50;k+=1)for(const s of ${JSON.stringify(inputs)}){const a=show(re.exec(s));const b=show(w.exec(s));compared+=1;if(a!==b){diffs+=1;if(!first)first={input:s,native:a,linear:b};}}process.stdout.write(JSON.stringify({threw,compared,diffs,first}));`;
      const r = child(script, LIMIT_MS);
      return { pass: r.threw === true && r.diffs === 0, detail: r };
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  })();
  const refused = (fn) => { try { fn(); return false; } catch { return true; } };
  const w = linear.wrap(/a/);
  const checks = {
    nextCallAfterThrow: afterThrow.pass,
    replaceFunction: refused(() => "a".replace(w, () => "Z")),
    search: refused(() => "xa".search(w)),
    matchAll: refused(() => [..."a".matchAll(linear.wrap(/a/g))]),
    newRegExp: refused(() => new RegExp(w))
  };
  return { pass: Object.values(checks).every(Boolean), detail: { ...checks, afterThrow: afterThrow.detail } };
});

if (ROWS.has("B") && !ONLY) row("X-B every escape the pattern grammar can spell, in the body and in a class, with and without u: refused, or V8's results", () => {
  // A backslash before each code unit 0x00-0x7F, then the multi-character forms: \cX, \0d, \xHH, \uHHHH, \u{...}, \k<...>,
  // \p{...} and decimal back-references, each with the near misses that Annex B reads otherwise.
  const ch = (c) => String.fromCharCode(c);
  const escapes = [];
  for (let c = 0; c < 128; c += 1) escapes.push(`\\${ch(c)}`, `\\c${ch(c)}`);
  for (let d = 0; d < 10; d += 1) escapes.push(`\\0${d}`);
  escapes.push("\\012", "\\x00", "\\x41", "\\x7f", "\\xAb", "\\xff", "\\x411", "\\x4", "\\x4g", "\\x4_", "\\xg1", "\\x{41}",
    "\\u0041", "\\u00e9", "\\uFFFF", "\\uD83D", "\\u2028", "\\u00411", "\\u004", "\\u004g", "\\u0g41", "\\u{41}", "\\u{1F600}", "\\u{}",
    "\\k<a>", "\\k<a", "\\p{L}", "\\P{L}", "\\p{Script=Greek}", "\\p{2}", "\\1", "\\2", "\\9", "\\10", "\\12", "(a)\\1");
  // The probes: every code unit 0x00-0xFF and a few beyond, all of 0x00-0x7F in one string, and what Annex B could read
  // the escape as: its own text, its text without the backslash with any {n} expanded, and the units its hex digits name.
  const singles = [];
  for (let c = 0; c < 256; c += 1) singles.push(ch(c));
  singles.push("\u2028", "\u2029", "\uD83D", "￿", "Ā", singles.slice(0, 128).join(""));
  const probesFor = (e) => {
    const own = [e, e.slice(1), e.slice(1).replace(/(.)\{(\d+)(?:,\d*)?\}/g, (m, c, n) => c.repeat(Number(n)))];
    for (const m of e.matchAll(/\\(?:x([0-9A-Fa-f]{2})|u([0-9A-Fa-f]{4}))/g)) own.push(ch(parseInt(m[1] || m[2], 16)));
    return [...singles, ...own, ...own.map((s) => s + s), ...own.map((s) => `<${s}>`)];
  };
  const counts = { patterns: 0, invalidInV8: 0, refused: 0, accepted: 0, compared: 0 };
  const wrong = [];
  for (const e of escapes) {
    const probes = probesFor(e);
    for (const source of [e, `${e}+`, `[${e}]`]) for (const flags of ["", "u"]) {
      counts.patterns += 1;
      let re;
      try { re = new RegExp(source, flags); } catch { counts.invalidInV8 += 1; continue; }
      let w;
      let wg;
      try { w = linear.wrap(re); wg = linear.wrap(new RegExp(source, `${flags}g`)); } catch { counts.refused += 1; continue; }
      counts.accepted += 1;
      const reG = new RegExp(source, `${flags}g`);
      for (const s of probes) {
        const run = (f) => { try { return JSON.stringify(f()); } catch (error) { return `threw ${error && error.message}`; } };
        const a = run(() => [shape(re.exec(s)), re.test(s), s.replace(reG, ""), s.split(re)]);
        const b = run(() => [shape(w.exec(s)), w.test(s), s.replace(wg, ""), s.split(w)]);
        counts.compared += 1;
        if (a !== b) { wrong.push({ pattern: `/${source}/${flags}`, input: JSON.stringify(s).slice(0, 80), native: a.slice(0, 120), linear: b.slice(0, 120) }); break; }
      }
    }
  }
  // Every accepted pattern that differs is listed, so a run on an older engine shows the whole class.
  return { pass: wrong.length === 0 && counts.accepted > 0 && counts.refused > 0, detail: { ...counts, wrong: wrong.length, wrongPatterns: wrong.map((x) => x.pattern), first: wrong[0] } };
});

for (const r of rows) process.stdout.write(`${r.pass ? "PASS" : "FAIL"} ${r.id}${r.pass ? "" : ` :: ${JSON.stringify(r.detail).slice(0, 220)}`}\n`);
const failed = rows.filter((r) => !r.pass).length;
process.stdout.write(`SEC53-06B regex bounds: ${rows.length - failed}/${rows.length} PASS\n`);
if (JSON_OUT) fs.writeFileSync(JSON_OUT, `${JSON.stringify({ node: process.version, platform: process.platform, rows }, null, 1)}\n`);
process.exitCode = failed === 0 ? 0 : 1;
