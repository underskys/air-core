#!/usr/bin/env node
"use strict";

// typed-v0.53 P0-09 (AIR-0053-P0-09-0001): source imports and package
// composition. The typed import closure (P9-R1..P9-R10), imported calls and
// the types that cross a module boundary (P9-R11..P9-R14), module identity
// (P9-R15..P9-R17), the static single-module link (P9-R18..P9-R21), the
// formatter (P9-R25) and the host paths (P9-R26, P9-R26a, P9-R26b). Every
// expected value below is copied from R3.1 (VECTORS.md), the admitted P0-09
// slice text R2.5 (P0_09_SLICE_RFC.md, VECTORS_ADDITIONS.md; folder
// SHA256SUMS 07a356c9...) or the admission record (36f65655...: AD-P9-1 ...
// AD-P9-16, each (a)), never from the output of the implementation under
// test. Fixture packages come from the slice text's generator
// (tools/derive_p009.py), ported below; the port prints the generator's
// whole output, whose sha256 is pinned to tool_outputs/derive_p009.out.txt,
// so every file's bytes, every named line, every module identity and every
// measure is the generator's. Each expectation runs on every entrypoint of
// P9-R26 that can carry its package: the SDK and the CLI with the files on
// disk, the builder and the runtime with `modules`. P0-09-SEP-WB,
// P0-09-CHECK-CLOSURE and P0-09-CHECK-LINK are the slice checks (P9-R27).
// Set AIR_P009_VECTOR_RESULTS_DIR=<dir> to write one canonical result record
// per vector, and AIR_P009_COUNTERS_FILE=<file> for the per-module counters
// (card exact_evidence).

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const sp = require("../src/source_profile");
const parser = require("../src/parser");
const wb = require("../src/workbound");
const typedClosure = require("../src/typed_closure");
const borrowedSlices = require("../src/borrowed_slices");
const { AirLspSession } = require("../src/lsp_server");
const { admitTypedV053Artifact } = require("../src/sdk");
const { buildVerifiedTypedModule, createVerifiedTypedRuntime, invokeVerifiedTypedExport } = require("../src/v052_verified_build");
const { lowerToWat, watToWasm } = require("../src/lower_wasm");

const ROOT = path.resolve(__dirname, "..");
const V053 = "typed-v0.53";
const GATED = Object.freeze({ allowCandidateProfile: true, sourceProfile: V053 });
const MAX_WAT = 4194304;
const WORD = 1095324209;
// The slice text's generator output (VECTORS_ADDITIONS.md, AUTHORITY).
const DERIVE_OUT_SHA256 = "a566e3850cee592fb11d225109177c70918f49a7631af0c4438dba2c70bed86b";
const DERIVE_TEXTS_SHA256 = "f311d3df854362865d97083290bac44891e5cf18db11441a23776e4596f8564e";
// P9-R24 (AD-P9-7 (a)): the nine PROPOSED codes, each with a typed-v0.53 hint.
const P0_09_CODE_REGISTRY = Object.freeze([
  "air.import.bundle_unsupported", "air.import.cycle", "air.import.duplicate_module", "air.import.not_found",
  "air.import.path_uncontained", "air.import.profile_mismatch", "air.import.signature_type_unsupported", "air.import.stdlib_unsupported",
  "air.v052.work_limit_modules"
]);
// The EXISTING codes P0-09's vectors reach (P9-R24).
const P0_09_EXISTING_CODES = Object.freeze([
  "air.abi.borrowed_lane_plain_export", "air.analysis.capacity_exceeded", "air.call.unknown_function", "air.decision.enum_unknown",
  "air.v051.typed_syntax_invalid", "air.v052.runtime_input_invalid", "air.v052.runtime_limits_invalid",
  "air.v052.verified_build_input_invalid", "air.v052.work_limit_ast_nodes", "air.v052.work_limit_source_bytes"
]);
// P0-09-SEP-WB (P9-R27): the stub perturbation and the largest real values
// among the verifying closures (V53-IMP-N10 (iii) 24621 steps; V53-IMP-P04 63
// calls; no iterations).
const P09_MAXIMA = Object.freeze({ calls: "63", iterations: "0", steps: "24621" });
const PHASE_CODES = Object.freeze(["air.call.recursion_rejected", "air.workbound.overflow", "air.workbound.unknown_bound",
  "air.workbound.invalid_bound", "air.workbound.assertion_exceeded"]);

const results = [];
const failures = [];
const observed = [];
let tmp;

function sha256(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}
const hexOf = (text) => crypto.createHash("sha256").update(Buffer.isBuffer(text) ? text : Buffer.from(text, "utf8")).digest("hex");

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function plain(value) {
  if (typeof value === "bigint") return value.toString();
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return { bytes: value.length, sha256: sha256(value) };
  if (value instanceof Map) return plain(Object.fromEntries(value));
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value)) if (value[key] !== undefined) out[key] = plain(value[key]);
    return out;
  }
  return value === undefined ? null : value;
}

function resultRecord(vectorId, status, value, extra = {}) {
  const valueOrFailure = plain(value === undefined ? null : value);
  return {
    evidence_digest: sha256(canonicalJson({ status, value_or_failure: valueOrFailure, vector: vectorId })),
    interface_digest: extra.interfaceDigest || null,
    source_digest: extra.sourceDigest || null,
    status,
    value_or_failure: valueOrFailure,
    vector: vectorId
  };
}

async function vector(id, action) {
  try {
    const outcome = (await action()) || {};
    results.push(resultRecord(id, outcome.status || "PASS", outcome.value, outcome));
  } catch (error) {
    failures.push(`${id}: ${error && error.stack || error}`);
    results.push(resultRecord(id, "FAIL", { error: String(error && error.message || error) }));
  }
}

// ---------------------------------------------------------------------------
// The slice text's generator (tools/derive_p009.py), ported line for line.
// `show` prints the generator's block for a package; the whole output's
// sha256 is the pinned DERIVE_OUT_SHA256.

const DOMAIN = "AIR_TYPED_MODULE_IDENTITY_V1";
function mod(name, ...items) {
  const lines = [`module ${name}`];
  for (const item of items) lines.push("", ...item);
  return `${lines.join("\n")}\n`;
}
const func = (header, body) => [`${header} {`, ...body.map((line) => `  ${line}`), "}"];
const uses = (...pairs) => pairs.map(([target, alias]) => `use "${target}" as ${alias}`);
const bytesOf = (text) => Buffer.byteLength(text, "utf8");

function mid(bodyDigest, deps) {
  const record = JSON.stringify({ body_digest: bodyDigest, dependencies: [...new Set(deps)].sort(), profile: "typed-v0.53" });
  return `mid-${crypto.createHash("sha256").update(Buffer.concat([Buffer.from(DOMAIN), Buffer.from([0]), Buffer.from(record, "utf8")])).digest("hex")}`;
}

function lineOf(text, needle) {
  const hits = text.split("\n").map((line, index) => (line.includes(needle) ? index + 1 : 0)).filter(Boolean);
  assert.equal(hits.length, 1, `${needle}: one line`);
  return hits[0];
}

function importsOf(text) {
  return [...text.matchAll(/^use "([^"]+)" as ([a-z_][a-z0-9_]*)$/gmu)].map((match) => [match[1], match[2]]);
}

function resolvePath(importer, target) {
  const dir = path.posix.dirname(importer);
  const parts = dir === "." ? [] : dir.split("/");
  for (const segment of target.split("/")) {
    if (segment === ".") continue;
    if (segment === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else {
      parts.push(segment);
    }
  }
  return parts.join("/");
}

function identities(files, root) {
  const memo = new Map();
  const order = [];
  const stack = [[root, false]];
  while (stack.length) {
    const [rel, done] = stack.pop();
    if (memo.has(rel)) continue;
    const deps = [...new Set(importsOf(files[rel]).map(([target]) => resolvePath(rel, target)))].sort();
    if (done) {
      memo.set(rel, mid(`sha256:${hexOf(files[rel])}`, deps.map((dep) => memo.get(dep))));
      order.push(rel);
    } else {
      stack.push([rel, true]);
      for (const dep of deps.slice().reverse()) if (!memo.has(dep)) stack.push([dep, false]);
    }
  }
  return { ids: memo, order };
}

function measures(files, closure) {
  let units = 0; let calls = 0; let folds = 0; let edges = 0; let depthMax = 0;
  for (const rel of closure) {
    let decls = 0; let stmts = 0; let depth = 0; let inFn = false;
    for (const line of files[rel].split("\n")) {
      const s = line.trim();
      if (!s || s.startsWith("module ")) continue;
      if (!inFn) {
        if (s.startsWith("func ") || s.startsWith("export func ")) { decls += 1; inFn = true; depth = 1; depthMax = Math.max(depthMax, 1); }
        else if (s.startsWith("use ")) { decls += 1; edges += 1; }
        else if (["struct ", "enum ", "error enum ", "table ", "const ", "state ", "work ", "capabilities "].some((prefix) => s.startsWith(prefix))) decls += 1;
        continue;
      }
      if (s === "}") {
        depth -= 1;
        if (depth === 0) inFn = false;
        continue;
      }
      if (s === "} else {") continue;
      stmts += 1;
      calls += (s.match(/\bcall @/gu) || []).length;
      folds += (s.match(/\bloop\.fold @/gu) || []).length;
      if (s.endsWith("{")) { depth += 1; depthMax = Math.max(depthMax, depth); }
    }
    units += 1 + decls + stmts;
  }
  return { analysis_units: units + calls + folds + edges, call_sites: calls, callback_refs: folds, import_edges: edges, nesting_depth: depthMax };
}

const OUT = [];
const TEXTS = [];
const section = (title) => { OUT.push(title); TEXTS.push(title); };
const CORPUS = new Map();
const PACKAGES = new Map();
function show(label, files, root, options = {}) {
  const { needle = null, needleFile = null, accept = false, note = "" } = options;
  const out = [`${label} (root ${root})`];
  for (const rel of Object.keys(files).sort()) {
    const digest = hexOf(files[rel]);
    if (!CORPUS.has(digest)) CORPUS.set(digest, [`${label} :: ${rel}`, bytesOf(files[rel])]);
    out.push(`  ${rel}: ${bytesOf(files[rel])} bytes, sha256 ${digest}`);
    TEXTS.push(files[rel].length > 4096 ? `${label} :: ${rel}: <generated, ${bytesOf(files[rel])} bytes; see the generator>` : `${label} :: ${rel}: ${files[rel].replace(/\n$/u, "").split("\n").join(" ⏎ ")}`);
  }
  const pkg = { accept, files, label, root };
  if (needle) {
    pkg.line = lineOf(files[needleFile || root], needle);
    pkg.lineFile = needleFile || root;
    out.push(`  named line: ${needleFile || root}:${pkg.line} ('${needle}')`);
  }
  if (accept) {
    const { ids, order } = identities(files, root);
    pkg.identities = ids;
    pkg.measures = measures(files, order);
    out.push(`  closure (post-order): ${order.join(", ")}`);
    for (const rel of order) out.push(`  identity ${rel}: ${ids.get(rel)}`);
    out.push(`  measures ${Object.entries(pkg.measures).map(([key, value]) => `${key}=${value}`).join(", ")}`);
  }
  if (note) out.push(`  ${note}`);
  OUT.push(out.join("\n"));
  PACKAGES.set(label, pkg);
  return pkg;
}

const R = "export func run(x: i32) -> i32";
const LEAF = (name, k) => mod(name, func("export func add_one(x: i32) -> i32", [`%o: i32 = i32.wrapping_add %x, ${k}`, "return %o"]));
const MAIN3 = mod("v53.imp.main", uses(["./math.air", "math"]), func(R, ["%a: i32 = call @math.add_one(%x)", "%b: i32 = call @math.add_one(%a)",
  "%c: i32 = call @math.add_one(%b)", "return %c"]));

section("== the generated P0-09 set (R3.1; run here)");
for (const [tag, target] of [["(i)", "../x.air"], ["(ii)", "/abs/x.air"]]) {
  show(`V53-IMP-N02 ${tag} ${target}`, { "main.air": mod("v53.imp.main", uses([target, "x"]), func(R, ["return %x"])) }, "main.air", { needle: "use " });
}
show("V53-IMP-N03 a imports b, b imports a", {
  "a.air": mod("v53.imp.a", uses(["./b.air", "b"]), func(R, ["%o: i32 = call @b.run(%x)", "return %o"])),
  "b.air": mod("v53.imp.b", uses(["./a.air", "a"]), func(R, ["%o: i32 = call @a.run(%x)", "return %o"])) }, "a.air", { needle: "use " });
show("V53-IMP-N03 (ii) a imports b, b imports c, c imports b (the first-sorting module a is outside the cycle)", {
  "a.air": mod("v53.imp.a", uses(["./b.air", "b"]), func(R, ["%o: i32 = call @b.run(%x)", "return %o"])),
  "b.air": mod("v53.imp.b", uses(["./c.air", "c"]), func(R, ["%o: i32 = call @c.run(%x)", "return %o"])),
  "c.air": mod("v53.imp.c", uses(["./b.air", "b"]), func(R, ["%o: i32 = call @b.run(%x)", "return %o"])) }, "a.air", { needle: "use ", needleFile: "b.air" });
show("V53-IMP-N03 (iii) as (ii), and b also imports a leaf 0.air that sorts first (an off-cycle descendant)", {
  "0.air": mod("v53.imp.z", func(R, ["%o: i32 = i32.wrapping_add %x, 1", "return %o"])),
  "a.air": mod("v53.imp.a", uses(["./b.air", "b"]), func(R, ["%o: i32 = call @b.run(%x)", "return %o"])),
  "b.air": mod("v53.imp.b", uses(["./0.air", "z"], ["./c.air", "c"]), func(R, ["%p: i32 = call @z.run(%x)", "%o: i32 = call @c.run(%p)", "return %o"])),
  "c.air": mod("v53.imp.c", uses(["./b.air", "b"]), func(R, ["%o: i32 = call @b.run(%x)", "return %o"])) }, "a.air", { needle: 'use "./c.air"', needleFile: "b.air" });
show("V53-IMP-N04 use utility.fs", { "main.air": mod("v53.imp.main", ["use utility.fs"], func(R, ["return %x"])) }, "main.air", { needle: "use " });
show("V53-IMP-N06 use std.bounds", { "main.air": mod("v53.imp.main", ["use std.bounds"], func(R, ["return %x"])) }, "main.air", { needle: "use " });
const LEGACY = "module legacy_mod\ncapabilities { }\nexport func f(x:i32) -> i32 {\nentry:\n  return %x\n}\n";
show("V53-IMP-N07 a typed-v0.53 root importing a legacy-v0.50 module", {
  "main.air": mod("v53.imp.main", uses(["./legacy.air", "legacy"]), func(R, ["return %x"])), "legacy.air": LEGACY }, "main.air", { needle: "use " });
const DIAMOND = {
  "a.air": mod("v53.imp.a", uses(["./b.air", "b"], ["./c.air", "c"]), func(R, ["%p: i32 = call @b.fb(%x)", "%q: i32 = call @c.fc(%p)", "return %q"])),
  "b.air": mod("v53.imp.b", uses(["./d.air", "d"]), func("export func fb(x: i32) -> i32", ["%o: i32 = call @d.base(%x)", "return %o"])),
  "c.air": mod("v53.imp.c", uses(["./d.air", "d"]), func("export func fc(x: i32) -> i32", ["%o: i32 = call @d.base(%x)", "return %o"])),
  "d.air": mod("v53.imp.d", func("export func base(x: i32) -> i32", ["%o: i32 = i32.wrapping_add %x, 1", "return %o"])) };
const diamondBytes = ["a.air", "b.air", "c.air", "d.air"].map((key) => bytesOf(DIAMOND[key]));
const diamondTotal = diamondBytes.reduce((sum, value) => sum + value, 0);
show("V53-PIPE-04 the diamond a -> b, a -> c, b -> d, c -> d", DIAMOND, "a.air", { accept: true,
  note: `run(0) = 2; E(run) = S{steps:11, calls:4}; B(fb) = B(fc) = S{steps:4, calls:1}; B(base) = S{steps:2}; unique bytes ${diamondBytes.join(" + ")} = ${diamondTotal}; with d counted twice ${diamondTotal + bytesOf(DIAMOND["d.air"])}` });

section("\n== reviewed additions");
show("V53-IMP-P02 an extern-free cross-module call (the planning note's fixture)", { "main.air": MAIN3, "math.air": LEAF("v53.imp.math", 1) }, "main.air",
  { accept: true, needle: "use ", note: "run(0) = 3; E(run) = S{steps:10, calls:3}; B(add_one) = S{steps:2}" });
show("V53-IMP-ID-02 (i) a body-only edit of math (add 2)", { "main.air": MAIN3, "math.air": LEAF("v53.imp.math", 2) }, "main.air", { accept: true, note: "run(0) = 6; E(run) = S{steps:10, calls:3}" });
show("V53-IMP-ID-02 (ii) a bytes-only edit of math (the local %o renamed %p)", { "main.air": MAIN3, "math.air": LEAF("v53.imp.math", 1).split("%o").join("%p") }, "main.air",
  { accept: true, note: "run(0) = 3; E(run) = S{steps:10, calls:3}" });
show("V53-IMP-P03 nested directories, a contained parent reference", {
  "main.air": mod("v53.imp.main", uses(["./lib/x.air", "x"]), func(R, ["%o: i32 = call @x.twice(%x)", "return %o"])),
  "lib/x.air": mod("v53.imp.x", uses(["../util.air", "u"]), func("export func twice(x: i32) -> i32", ["%a: i32 = call @u.add_one(%x)", "%b: i32 = call @u.add_one(%a)", "return %b"])),
  "util.air": LEAF("v53.imp.util", 1) }, "main.air", { accept: true, note: "run(0) = 2; E(run) = S{steps:9, calls:3}; B(twice) = S{steps:7, calls:2}" });
const P05_IN = "module v53.imp.main\n\nuse  \"./math.air\"   as math\n\nexport func run(x: i32) -> i32 {\n  %a: i32 = call @math.add_one(%x)\n  return %a\n}\n\nuse \"./aux.air\" as aux\n";
show("V53-IMP-P05 formatter input (non-canonical: spacing, a use after a function)", { "main.air": P05_IN, "math.air": LEAF("v53.imp.math", 1), "aux.air": LEAF("v53.imp.aux", 1) }, "main.air");
show("V53-IMP-P05 canonical output", { "main.air": mod("v53.imp.main", uses(["./aux.air", "aux"], ["./math.air", "math"]), func(R, ["%a: i32 = call @math.add_one(%x)", "return %a"])),
  "math.air": LEAF("v53.imp.math", 1), "aux.air": LEAF("v53.imp.aux", 1) }, "main.air", { accept: true, note: "run(0) = 1; E(run) = S{steps:4, calls:1}" });
for (const [tag, target] of [["(i) a path without ./", "x.air"], ["(ii) a path without .air", "./x"], ["(iii) a backslash", ".\\\\x.air"],
  ["(iv) an empty segment", ".//x.air"], ["(v) a missing module", "./missing.air"], ["(vii) a missing module outside the root", "../nope.air"]]) {
  show(`V53-IMP-N08 ${tag}`, { "main.air": mod("v53.imp.main", uses([target, "x"]), func(R, ["return %x"])), "x.air": LEAF("v53.imp.x", 1) }, "main.air", { needle: "use " });
}
show("V53-IMP-N08 (viii) a literal that differs from the file's name only in case", {
  "main.air": mod("v53.imp.main", uses(["./Math.air", "m"]), func(R, ["%a: i32 = call @m.add_one(%x)", "return %a"])), "math.air": LEAF("v53.imp.math", 1) }, "main.air", { needle: "use " });
const MATH_H = mod("v53.imp.math", func("export func add_one(x: i32) -> i32", ["%o: i32 = call @helper(%x)", "return %o"]),
  func("func helper(x: i32) -> i32", ["%o: i32 = i32.wrapping_add %x, 1", "return %o"]));
for (const [tag, text, needle, extra] of [
  ["(i) no alias", mod("v53.imp.main", ['use "./math.air"'], func(R, ["return %x"])), "use ", {}],
  ["(i) control: the same line with as math", mod("v53.imp.main", uses(["./math.air", "math"]), func(R, ["return %x"])), null, {}],
  ["(ii) a duplicate alias", mod("v53.imp.main", uses(["./math.air", "m"], ["./aux.air", "m"]), func(R, ["return %x"])), 'use "./aux.air"', { "aux.air": LEAF("v53.imp.aux", 1) }],
  ["(iii) a duplicate path", mod("v53.imp.main", uses(["./math.air", "m"], ["./math.air", "n"]), func(R, ["return %x"])), "as n", {}],
  ["(v) a call to a function the module does not export", mod("v53.imp.main", uses(["./math.air", "math"]), func(R, ["%a: i32 = call @math.helper(%x)", "return %a"])), "@math.helper", {}],
  ["(vi) a call through an unknown alias", mod("v53.imp.main", uses(["./math.air", "math"]), func(R, ["%a: i32 = call @nomod.add_one(%x)", "return %a"])), "@nomod", {}],
  ["(vii) two spellings of one module", mod("v53.imp.main", uses(["./math.air", "m"], ["./sub/../math.air", "n"]), func(R, ["return %x"])), "as n", {}]
]) {
  show(`V53-IMP-N09 ${tag}`, { "main.air": text, "math.air": MATH_H, ...extra }, "main.air", { accept: needle === null, needle, note: needle === null ? "ACCEPT: run(5) = 5; E(run) = S{steps:1}" : "" });
}
show("V53-IMP-P06 byte-identical modules at two keys (one identity, two modules)", {
  "main.air": mod("v53.imp.main", uses(["./copy.air", "n"], ["./math.air", "m"]), func(R, ["%a: i32 = call @n.add_one(%x)", "%b: i32 = call @m.add_one(%a)", "return %b"])),
  "math.air": LEAF("v53.imp.math", 1), "copy.air": LEAF("v53.imp.math", 1) }, "main.air",
  { accept: true, note: "run(0) = 2; E(run) = S{steps:7, calls:2}; 3 modules; main's key dependencies: one entry (the two identities are equal)" });
const SIGN = ["enum Sign {", "  neg = 0,", "  pos = 1,", "}"];
const GEO = mod("v53.imp.geo", SIGN, func("export func norm(x: i32) -> i32", ["return %x"]), func("export func pick(s: v53.imp.geo::Sign) -> i32", ["%o: i32 = 0", "return %o"]));
show("V53-IMP-N11 control: an exporter with an enum signature, called only through a scalar one (OD-P9-2 (a))", {
  "main.air": mod("v53.imp.main", uses(["./geo.air", "geo"]), func(R, ["%v: i32 = call @geo.norm(%x)", "return %v"])), "geo.air": GEO }, "main.air",
  { accept: true, note: "run(5) = 5; E(run) = S{steps:3, calls:1}" });
show("V53-IMP-N11 (i) a call whose parameter type is the exporter's enum", {
  "main.air": mod("v53.imp.main", uses(["./geo.air", "geo"]), SIGN, func("export func run(s: v53.imp.main::Sign) -> i32", ["%v: i32 = call @geo.pick(%s)", "return %v"])),
  "geo.air": GEO }, "main.air", { needle: "@geo.pick" });
show("V53-IMP-N11 (ii) the importer spells the exporter's qualified enum type", {
  "main.air": mod("v53.imp.main", uses(["./geo.air", "geo"]), func("export func run(s: v53.imp.geo::Sign) -> i32", ["%v: i32 = call @geo.pick(%s)", "return %v"])),
  "geo.air": GEO }, "main.air", { needle: "export func run" });
const RD16 = func("export func rd(b: borrowed_slice<readonly,len=16..16,align=4>, o: i32) -> i32", ["%v: i32 = slice.load.i32 %b, %o", "return %v"]);
show("V53-IMP-N11 (iii) an imported module with a borrowed export and a plain export (OD-P8-6 F-1 at a module boundary)", {
  "main.air": mod("v53.imp.main", uses(["./lib.air", "lib"]), func(R, ["%a: i32 = call @lib.q(%x)", "return %a"])),
  "lib.air": mod("v53.imp.lib", func("export func q(o: i32) -> i32", ["return %o"]), RD16) }, "main.air", { needle: "export func q", needleFile: "lib.air" });
show("V53-IMP-N11 (iv) a literal view passed to an imported callee's borrowed_slice parameter", {
  "main.air": mod("v53.imp.main", uses(["./lib.air", "lib"]), func("export func run() -> i32", ['%s: slice = "abcdefghijklmnop"', "%r: i32 = call @lib.rd(%s, 0)", "return %r"])),
  "lib.air": mod("v53.imp.lib", RD16) }, "main.air", { needle: "@lib.rd" });

function chain(n) {
  const files = {};
  for (let k = 0; k < n; k += 1) {
    files[`m${k}.air`] = k === n - 1
      ? mod(`v53.imp.m${k}`, func(R, ["%o: i32 = i32.wrapping_add %x, 1", "return %o"]))
      : mod(`v53.imp.m${k}`, uses([`./m${k + 1}.air`, "n"]), func(R, ["%a: i32 = call @n.run(%x)", "%o: i32 = i32.wrapping_add %a, 1", "return %o"]));
  }
  return files;
}
section("\n== closure intake (D-VAL-24, OPEN-36; generated packages)");
show("V53-IMP-P04 a 64-module chain (at maxClosureModules)", chain(64), "m0.air", { accept: true, note: "run(0) = 64; E(run) = S{steps:191, calls:63}" });
show("V53-IMP-N10 (i) a 65-module chain (one over maxClosureModules)", chain(65), "m0.air", { note: "INTAKE_REFUSED when the 65th unique module is discovered" });

function big(name, statements) {
  const body = ["%v0: i32 = i32.wrapping_add %x, 1"];
  for (let i = 1; i < statements; i += 1) body.push(`%v${i}: i32 = i32.wrapping_add %v${i - 1}, 1`);
  return mod(name, func(R, [...body, `return %v${statements - 1}`]));
}
function padded(name, target) {
  const head = bytesOf(`module ${name}\n\n${R} {\n`);
  const line = (i) => (i ? `  %v${i}: i32 = i32.wrapping_add %v${i - 1}, 1\n` : "  %v0: i32 = i32.wrapping_add %x, 1\n");
  let size = head;
  let n = 0;
  while (size + bytesOf(line(n)) + bytesOf(`  return %v${n}\n}\n`) <= target) { size += bytesOf(line(n)); n += 1; }
  const lines = Array.from({ length: n }, (_, i) => line(i));
  let gap = target - (size + bytesOf(`  return %v${n - 1}\n}\n`));
  assert(gap >= 0 && gap <= 8 * n, String(gap));
  const values = new Array(n).fill(1);
  let k = n - 1;
  while (gap > 0) {
    const d = Math.min(8, gap);
    lines[k] = `${lines[k].slice(0, -2)}1${"0".repeat(d)}\n`;
    values[k] = 10 ** d;
    gap -= d; k -= 1;
  }
  const out = `module ${name}\n\n${R} {\n${lines.join("")}  return %v${n - 1}\n}\n`;
  assert.equal(bytesOf(out), target);
  return [out, n, values.reduce((sum, value) => sum + value, 0)];
}
const ROOT5 = mod("v53.imp.r", uses(...[0, 1, 2, 3, 4].map((k) => [`./b${k}.air`, `b${k}`])), func(R, [...[0, 1, 2, 3, 4].map((k) => `%a${k}: i32 = call @b${k}.run(%x)`), "return %a4"]));
const BIG6000 = [0, 1, 2, 3, 4].map((k) => big(`v53.imp.b${k}`, 6000));
const BIG = { "r.air": ROOT5, "b0.air": BIG6000[0], "b1.air": BIG6000[1], "b2.air": BIG6000[2], "b3.air": BIG6000[3], "b4.air": BIG6000[4] };
for (const [tag, total] of [["(iii) a closure of exactly maxClosureSourceBytes", 1048576], ["(iv) one byte over maxClosureSourceBytes", 1048577]]) {
  const files = { "r.air": ROOT5, "b0.air": BIG6000[0], "b1.air": BIG6000[1], "b2.air": BIG6000[2], "b3.air": BIG6000[3] };
  const rest = total - Object.values(files).reduce((sum, text) => sum + bytesOf(text), 0);
  const [b4, n4, run4] = padded("v53.imp.b4", rest);
  files["b4.air"] = b4;
  const sum = Object.values(files).reduce((acc, text) => acc + bytesOf(text), 0);
  const iii = tag.startsWith("(iii)");
  show(`V53-IMP-N10 ${tag}`, files, "r.air", { accept: iii,
    note: `total ${sum} bytes; b4.air ${rest} bytes (${n4} statements); run(0) = ${run4}` + (iii ? `; E(run) = S{steps:${5 + 4 * 6001 + (n4 + 1) + 1}, calls:5} (five calls of 1 + B(b_k.run); B = 6001 steps for b0..b3, ${n4 + 1} for b4; return 1)` : "") });
}
{
  const files = { "r.air": mod("v53.imp.r", uses(["./huge.air", "h"]), func(R, ["%a: i32 = call @h.run(%x)", "return %a"])) };
  [files["huge.air"]] = padded("v53.imp.huge", 262145);
  show("V53-IMP-N10 (v) an imported module one byte over maxSourceBytes", files, "r.air", { note: `huge.air ${bytesOf(files["huge.air"])} bytes; refused per module before the closure total` });
}
show("V53-IMP-N10 (ii) six modules each under maxSourceBytes, over maxClosureSourceBytes together", BIG, "r.air",
  { note: `bytes: ${Object.keys(BIG).sort().map((rel) => `${rel} ${bytesOf(BIG[rel])}`).join(", ")}; total ${Object.values(BIG).reduce((sum, text) => sum + bytesOf(text), 0)}` });

section("\n== the ABI candidate row V53-ABI-52 (amended by OD-P9-3 (a); pinned at R2.3 on the accepted P0-08 base)");
const ABI52 = {
  "main.air": mod("v53.imp.main", uses(["./lib.air", "lib"]), func("export func rd(b: borrowed_slice<readonly,len=16..16,align=4>, o: i32) -> i32", ["%v: i32 = slice.load.i32 %b, %o", "return %v"])),
  "lib.air": mod("v53.imp.lib", func("export func peek(b: borrowed_slice<readonly,len=8..8,align=4>) -> i32", ["%v: i32 = slice.load.i32 %b, 0", "return %v"])) };
show("V53-ABI-52 a linked closure of two typed-v0.53 modules, each with a borrowed export", ABI52, "main.air",
  { accept: true, note: "E(rd) = S{steps:3} (ingress.borrowed_slice 1, memory.access 1, return 1; i32 ingress 0); E(peek) = S{steps:3}; nothing calls peek" });

section("\n== P0-09-SEP-WB's C7 carrier (R2.3): a closure whose imported module has a memory statement and E > 7");
show("P0-09-SEP-WB C7 carrier: an imported module with a region", {
  "main.air": mod("v53.imp.main", uses(["./buf.air", "buf"]), func(R, ["%a: i32 = call @buf.keep(%x)", "return %a"])),
  "buf.air": mod("v53.imp.buf", func("export func keep(x: i32) -> i32", ["%p: ptr = alloc_region 16", "store.i32 %p, 0, %x", "%v: i32 = load.i32 %p, 0",
    "%o: i32 = i32.wrapping_add %v, 1", "free_region %p", "return %o"])) }, "main.air",
{ accept: true, note: "run(0) = 1, run(41) = 42; B(keep) = S{steps:8, region_bytes:16} (memory.alloc 1 + ceil(16/8) = 3, memory.access 2, scalar 1, memory.view (free_region) 1, return 1); E(run) = S{steps:10, calls:1, region_bytes:16}" });

section("\n== AD-P9-17's fixtures, settled by OD-P8-7 (A) (R2.5): V53-IMP-P08 and the B-1 regression package");
show("P0-09-SEP-WB B-1 regression: one module, a plain export and an internal function taking a borrowed_slice (P0-08's vector P0-08-OD-P8-7-B1)", {
  "main.air": mod("v53.imp.b1", func("func peek(b: borrowed_slice<readonly,len=8..8,align=4>) -> i32", ["%v: i32 = slice.load.i32 %b, 0", "return %v"]), func(R, ["return %x"])) }, "main.air",
{ accept: true, note: "ACCEPT at the base since OD-P8-7 (A): run(5) = 5, E(run) = S{steps:1}; the artifact defines $__air_borrow_failure as an internal function" });
show("V53-IMP-P08 a plain root importing a module whose exports take a borrowed_slice (P2-1; OD-P8-7 (A))", {
  "main.air": mod("v53.imp.main", uses(["./lib.air", "lib"]), func(R, ["return %x"])), "lib.air": ABI52["lib.air"] }, "main.air",
{ accept: true, note: "run(5) = 5; E(run) = S{steps:1}; lib.air's peek and $__air_borrow_failure are internal; no import or start" });

OUT.push("\n== the P0-09 corpus: every distinct file text above, by sha256");
for (const digest of [...CORPUS.keys()].sort()) {
  const [label, size] = CORPUS.get(digest);
  OUT.push(`${digest}  ${String(size).padStart(7)} bytes  ${label}`);
}
OUT.push(`corpus: ${CORPUS.size} distinct file texts`);
const DERIVED = `${OUT.join("\n")}\n`;

const P = (label) => {
  const pkg = PACKAGES.get(label);
  assert(pkg, `package '${label}'`);
  return pkg;
};
const byPrefix = (prefix) => {
  const found = [...PACKAGES.keys()].filter((label) => label.startsWith(prefix));
  assert.equal(found.length, 1, `one package starts with '${prefix}': ${found.join(" | ")}`);
  return PACKAGES.get(found[0]);
};

// ---------------------------------------------------------------------------
// Entrypoints (P9-R26).

let packageCounter = 0;
function onDisk(pkg) {
  if (pkg.dir) return pkg;
  const dir = path.join(tmp, `pkg${packageCounter += 1}`);
  for (const [rel, text] of Object.entries(pkg.files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  pkg.dir = dir;
  pkg.rootPath = path.join(dir, pkg.root);
  return pkg;
}
const others = (pkg) => {
  const out = Object.fromEntries(Object.entries(pkg.files).filter(([rel]) => rel !== pkg.root));
  return Object.keys(out).length ? out : undefined;
};

function runCli(args, timeoutMs = 120000) {
  const out = childProcess.spawnSync(process.execPath, [path.join(ROOT, "bin", "airc.js"), ...args], {
    cwd: ROOT, encoding: "utf8", killSignal: "SIGKILL", maxBuffer: 256 * 1024 * 1024, timeout: timeoutMs
  });
  assert(!out.error && out.signal === null, `airc ${args[0]} did not finish within ${timeoutMs} ms`);
  return out;
}
function assertNoRawError(text, label) {
  assert.doesNotMatch(String(text), /RangeError|Maximum call stack|TypeError|\n\s+at /u, `${label}: no raw error`);
}

// The descriptor of the root's export signature (as the earlier typed tests
// write it): a refined type has the image `i32`; each enum the signature
// names is declared in `types`, from whichever file of the package declares
// it; a borrowed-lane root takes the v2 descriptor.
function descriptorOf(source, files = {}) {
  const ast = parser.typedV053.parse(source, "descriptor.air");
  if (borrowedSlices.typedV053.moduleUsesBorrowedSlices(ast)) return borrowedSlices.typedV053.interfaceDescriptor(ast);
  const image = (type) => (/^i32</u.test(type) ? "i32" : type);
  const enums = new Map();
  for (const text of [source, ...Object.values(files)]) {
    let parsed = null;
    try { parsed = parser.typedV053.parse(text, "types.air"); } catch (_) { parsed = null; }
    for (const item of (parsed && parsed.enums) || []) if (!enums.has(item.type_id)) enums.set(item.type_id, item);
  }
  const named = new Set(ast.functions.filter((item) => item.exported).flatMap((item) => [...item.params.map((parameter) => parameter.type), item.returnType]).filter((type) => enums.has(type)));
  // A descriptor's types are qualified in its own module (the runtime checks
  // this in phase A): a signature that names only another module's enum
  // (V53-IMP-N11 (ii)) has a consistent descriptor only under that module.
  const owners = [...new Set([...named].map((typeId) => typeId.slice(0, typeId.lastIndexOf("::"))))];
  return {
    air_abi_lane: "0.12", module_id: owners.length === 1 ? owners[0] : ast.name, schema: "air.typed-interface/0.12-candidate.1",
    types: [...named].sort().map((typeId) => ({ cases: enums.get(typeId).cases.map((entry) => ({ discriminant: entry.discriminant, name: entry.name })), kind: enums.get(typeId).kind, type_id: typeId })),
    exports: ast.functions.filter((item) => item.exported).map((item) => ({
      function: item.name, name: item.name, parameters: item.params.map((parameter) => ({ name: parameter.name, type: image(parameter.type) })), return_type: image(item.returnType)
    }))
  };
}
const borrowedRoot = (pkg) => borrowedSlices.typedV053.moduleUsesBorrowedSlices(parser.typedV053.parse(pkg.files[pkg.root], "root.air"));
const buildInput = (pkg, extra = {}) => ({ ...GATED, descriptor: descriptorOf(pkg.files[pkg.root], pkg.files), source: pkg.files[pkg.root], sourceName: pkg.root,
  ...(others(pkg) ? { modules: others(pkg) } : {}), ...extra });

function failureOf(error, dir) {
  assert(error && typeof error.code === "string" && error.code.startsWith("air."), `coded failure: ${error && error.stack}`);
  assertNoRawError(error.message, error.code);
  const out = { code: error.code };
  if (error.loc && Number.isInteger(error.loc.line)) {
    out.line = error.loc.line;
    out.file = dir && path.isAbsolute(error.loc.file) ? path.relative(dir, error.loc.file) : error.loc.file;
  }
  if (error.disposition) out.disposition = error.disposition;
  if (error.fields) out.fields = { ...error.fields };
  observed.push(out.code);
  return out;
}
function sdkOutcome(pkg, options = GATED, rootPath = pkg.rootPath) {
  try {
    const ast = sp.parseSource(pkg.files[pkg.root], rootPath, options);
    sp.verifySource(ast, options);
    return { ast, verdict: "VERIFIED" };
  } catch (error) {
    return failureOf(error, pkg.dir);
  }
}
function cliOutcome(pkg, command = "verify") {
  const out = runCli([command, pkg.rootPath, "--source-profile", V053, "--allow-candidate-profile", ...(command === "check" ? ["--lsp-json"] : [])]);
  assertNoRawError(out.stderr, `CLI ${command}`);
  if (command === "check") {
    const report = JSON.parse(out.stdout);
    if (!report.diagnostics.length) return { verdict: "VERIFIED" };
    return { code: report.diagnostics[0].code, line: report.diagnostics[0].line };
  }
  if (out.status === 0) return { verdict: "VERIFIED" };
  const first = out.stderr.trim().split("\n")[0];
  const match = /^(.*?):(\d+): (air\.[a-z0-9_.]+):/u.exec(first);
  if (match) return { code: match[3], file: path.isAbsolute(match[1]) ? path.relative(pkg.dir, match[1]) : match[1], line: Number(match[2]) };
  const coded = /(air\.[a-z0-9_.]+):/u.exec(first);
  assert(coded, `CLI ${command} output: ${first}`);
  return { code: coded[1] };
}
async function builderOutcome(pkg, extra = {}) {
  try {
    return { built: await buildVerifiedTypedModule(buildInput(pkg, extra)), verdict: "VERIFIED" };
  } catch (error) {
    return failureOf(error);
  }
}
async function runtimeOutcome(pkg, options = {}, invocations = []) {
  const runtime = createVerifiedTypedRuntime({ admit: async () => true, ...options });
  try {
    const handle = await runtime.build(buildInput(pkg));
    const values = [];
    for (const [name, args] of invocations) values.push((await runtime.invoke(handle, name, args)).value);
    return { runtime, values, verdict: "VERIFIED" };
  } catch (error) {
    return failureOf(error);
  }
}

// STATIC_REJECT at every entrypoint that carries the package: SDK, CLI
// verify, CLI check --lsp-json, builder, runtime; the same code and line (and
// the file, the module key, for a failure inside an imported module).
async function staticReject(pkg, code, line, file) {
  onDisk(pkg);
  const outcomes = {
    builder: await builderOutcome(pkg),
    cli_check: cliOutcome(pkg, "check"),
    cli_verify: cliOutcome(pkg),
    runtime: await runtimeOutcome(pkg),
    sdk: sdkOutcome(pkg)
  };
  for (const [entrypoint, outcome] of Object.entries(outcomes)) {
    assert.equal(outcome.code, code, `${pkg.label} ${entrypoint}: ${JSON.stringify(outcome)}`);
    assert.equal(outcome.line, line, `${pkg.label} ${entrypoint}: line`);
    if (file !== pkg.root && outcome.file !== undefined) assert.equal(outcome.file, file, `${pkg.label} ${entrypoint}: file`);
  }
  return { code, entrypoints: Object.keys(outcomes), file, line };
}

// ACCEPT at every entrypoint: SDK verify, lowerToWat, CLI verify, the
// verified builder and the runtime; each invocation gives its value through
// the builder and the runtime. Returns the SDK closure and the build.
async function accept(pkg, invocations) {
  onDisk(pkg);
  const sdk = sdkOutcome(pkg);
  assert.equal(sdk.verdict, "VERIFIED", `${pkg.label} SDK: ${JSON.stringify(sdk)}`);
  const wat = lowerToWat(sdk.ast, { maxWatBytes: MAX_WAT });
  assert.equal(cliOutcome(pkg).verdict, "VERIFIED", `${pkg.label} CLI verify`);
  const builder = await builderOutcome(pkg);
  assert.equal(builder.verdict, "VERIFIED", `${pkg.label} builder: ${JSON.stringify(builder)}`);
  const values = {};
  // A borrowed-lane root is invoked only through the typed admission (P8-R24).
  if (!borrowedRoot(pkg)) {
    const runtime = await runtimeOutcome(pkg, {}, invocations.map(([name, args]) => [name, args]));
    assert.equal(runtime.verdict, "VERIFIED", `${pkg.label} runtime: ${JSON.stringify(runtime)}`);
    for (const [index, [name, args, expected]] of invocations.entries()) {
      const viaBuilder = (await invokeVerifiedTypedExport(builder.built, name, args)).value;
      assert.equal(viaBuilder, expected, `${pkg.label} builder ${name}(${args})`);
      assert.equal(runtime.values[index], expected, `${pkg.label} runtime ${name}(${args})`);
      values[`${name}(${args.join(", ")})`] = expected;
    }
  }
  return { ast: sdk.ast, built: builder.built, closure: typedClosure.closureOf(sdk.ast), values, wat };
}

const S = (steps, calls = 0, iterations = 0, regionBytes = 0) => wb.canonicalSummary(wb.summary({ calls: BigInt(calls), iterations: BigInt(iterations), region_bytes: BigInt(regionBytes), steps: BigInt(steps) }));
function expectE(built, name, ...args) {
  const actual = wb.inspectBoundWorkBound(built).record.entries[name];
  assert.deepEqual(actual, S(...args), `E(${name})`);
  return actual;
}
// The package's identities and measures are the generator's (P9-R15, P9-R9).
function expectClosure(pkg, closure) {
  assert.deepEqual(Object.fromEntries([...closure.identities].sort()), Object.fromEntries([...pkg.identities].sort()), `${pkg.label}: identities`);
  assert.deepEqual({ ...closure.measures }, pkg.measures, `${pkg.label}: measures`);
  return { identities: Object.fromEntries([...closure.identities].sort()), measures: closure.measures };
}
// The independent AST-node count of P9-R8: every enumerable object reachable
// from the module the parser gives for the file parsed alone.
function independentNodes(text) {
  let count = 0;
  const stack = [parser.typedV053.parse(text, "alone.air")];
  while (stack.length) {
    const value = stack.pop();
    if (!value || typeof value !== "object") continue;
    count += 1;
    for (const item of Array.isArray(value) ? value : Object.values(value)) stack.push(item);
  }
  return count;
}
function exportsOf(wasmBytes) {
  const artifact = new WebAssembly.Module(wasmBytes);
  return { exports: WebAssembly.Module.exports(artifact).map((item) => `${item.kind}:${item.name}`).sort(), imports: WebAssembly.Module.imports(artifact).map((item) => `${item.module}.${item.name}`) };
}
const intake = (code, scope, moduleKey, required, limit) => ({ code, disposition: "INTAKE_REFUSED", fields: { limit, module: moduleKey, required, scope } });
function expectIntake(outcome, expected, label) {
  assert.equal(outcome.code, expected.code, `${label}: ${JSON.stringify(outcome)}`);
  if (outcome.fields) {
    assert.equal(outcome.disposition, "INTAKE_REFUSED", `${label}: disposition`);
    for (const key of ["limit", "module", "required", "scope"]) assert.equal(outcome.fields[key], expected.fields[key], `${label}: ${key}`);
  }
}
async function intakeEverywhere(pkg, expected) {
  onDisk(pkg);
  const outcomes = { builder: await builderOutcome(pkg), cli_verify: cliOutcome(pkg), runtime: await runtimeOutcome(pkg), sdk: sdkOutcome(pkg) };
  for (const [entrypoint, outcome] of Object.entries(outcomes)) {
    expectIntake(outcome, expected, `${pkg.label} ${entrypoint}`);
    if (entrypoint !== "cli_verify") assert(outcome.fields, `${pkg.label} ${entrypoint}: fields`);
  }
  return { ...expected, entrypoints: Object.keys(outcomes) };
}

// ---------------------------------------------------------------------------
// The generated set (R3.1) and the reviewed additions.

async function sectionGenerated() {
  await vector("P0-09-GENERATOR", () => {
    assert.equal(hexOf(DERIVED), DERIVE_OUT_SHA256, "the port prints tools/derive_p009.py's output byte for byte");
    assert.equal(hexOf(`${TEXTS.join("\n")}\n`), DERIVE_TEXTS_SHA256, "the port prints the generator's --texts output byte for byte");
    assert.equal(CORPUS.size, 133, "133 distinct file texts");
    return { value: { corpus: CORPUS.size, derive_out_sha256: DERIVE_OUT_SHA256, derive_texts_sha256: DERIVE_TEXTS_SHA256, packages: PACKAGES.size } };
  });
  await vector("V53-IMP-N02", async () => ({
    value: {
      "(i)": await staticReject(byPrefix("V53-IMP-N02 (i)"), "air.import.path_uncontained", 3, "main.air"),
      "(ii)": await staticReject(byPrefix("V53-IMP-N02 (ii)"), "air.import.path_uncontained", 3, "main.air")
    }
  }));
  await vector("V53-IMP-N03", async () => ({
    value: {
      "(i)": await staticReject(P("V53-IMP-N03 a imports b, b imports a"), "air.import.cycle", 3, "a.air"),
      "(ii)": await staticReject(byPrefix("V53-IMP-N03 (ii)"), "air.import.cycle", 3, "b.air"),
      "(iii)": await staticReject(byPrefix("V53-IMP-N03 (iii)"), "air.import.cycle", 4, "b.air")
    }
  }));
  await vector("V53-IMP-N04", async () => ({ value: await staticReject(byPrefix("V53-IMP-N04"), "air.import.bundle_unsupported", 3, "main.air") }));
  await vector("V53-IMP-N06", async () => ({ value: await staticReject(byPrefix("V53-IMP-N06"), "air.import.stdlib_unsupported", 3, "main.air") }));
  await vector("V53-IMP-N07", async () => ({ value: await staticReject(byPrefix("V53-IMP-N07"), "air.import.profile_mismatch", 3, "main.air") }));
  await vector("V53-PIPE-04", async () => {
    const pkg = byPrefix("V53-PIPE-04");
    const run = await accept(pkg, [["run", [0], 2]]);
    const counters = typedClosure.closureCounters(run.ast);
    for (const key of ["a.air", "b.air", "c.air", "d.air"]) {
      assert.deepEqual(counters[key], { measure: 1, parse: 1, read: 1, summarize: 1, verify: 1 }, `${key}: each pass once (P9-R10)`);
    }
    const closure = expectClosure(pkg, run.closure);
    expectE(run.built, "run", 11, 4);
    const ids = pkg.identities;
    const deps = wb.inspectBoundWorkBound(run.built).record.key.dependencies;
    assert.deepEqual(deps.map((item) => item.module), [ids.get("b.air"), ids.get("c.air")].sort(), "a's key dependencies: b and c, by identity");
    assert.deepEqual(deps.map((item) => item.body_digest), [ids.get("b.air"), ids.get("c.air")].sort().map((identity) => (identity === ids.get("b.air") ? `sha256:${hexOf(DIAMOND["b.air"])}` : `sha256:${hexOf(DIAMOND["c.air"])}`)));
    // Each entry's summary_digest is the digest of that import's own summary
    // record (P9-R16): b (and c) built on their own, with d, give it.
    for (const key of ["b.air", "c.air"]) {
      const own = await buildVerifiedTypedModule({ ...GATED, descriptor: descriptorOf(DIAMOND[key]), modules: { "d.air": DIAMOND["d.air"] }, source: DIAMOND[key], sourceName: key });
      assert.equal(deps.find((item) => item.module === ids.get(key)).summary_digest, wb.inspectBoundWorkBound(own).recordDigest, `${key}: summary_digest is its record's digest`);
    }
    const nodes = Object.fromEntries(Object.keys(DIAMOND).sort().map((key) => [key, independentNodes(DIAMOND[key])]));
    assert.equal(nodes["d.air"], 15, "d.air: 15 AST nodes (base fact)");
    const N = Object.values(nodes).reduce((sum, value) => sum + value, 0);
    assert.equal(run.closure.totals.astNodes, N, "the closure AST-node total is the independent sum over the unique modules");
    assert.equal(run.closure.totals.sourceBytes, diamondTotal, "the closure byte total counts d once (485)");
    const lowered = await runtimeOutcome(pkg, { closureLimits: { maxClosureAstNodes: N - 1 } });
    expectIntake(lowered, intake("air.v052.work_limit_ast_nodes", "closure", "d.air", N, N - 1), "PIPE-04 (ii)");
    const atLimit = await runtimeOutcome(pkg, { closureLimits: { maxClosureAstNodes: N } }, [["run", [0]]]);
    assert.deepEqual(atLimit.values, [2], "PIPE-04 (iii) admitted");
    return { value: { "(i)": { E_run: S(11, 4), closure, counters, dependencies: deps, independent_nodes: nodes, N, values: run.values }, "(ii)": lowered, "(iii)": { values: atLimit.values } } };
  });
  for (const id of ["V53-IMP-P01", "V53-IMP-N01", "V53-IMP-N05", "V53-IMP-ID-01", "V53-WB-H03"]) {
    await vector(id, () => ({ status: "DEFERRED", value: { first_executable: "P0-10", reason: "needs a typed extern (PF-1; R3.1 VECTORS.md:514-518)" } }));
  }
}

async function sectionAdditions() {
  await vector("V53-IMP-P02", async () => {
    const pkg = byPrefix("V53-IMP-P02");
    const run = await accept(pkg, [["run", [0], 3], ["run", [5], 8]]);
    const closure = expectClosure(pkg, run.closure);
    expectE(run.built, "run", 10, 3);
    const artifact = exportsOf(run.built.wasmBytes);
    assert.deepEqual(artifact, { exports: ["function:run", "global:__air_failure_reason"], imports: [] });
    // The CLI's other file entrypoints (P9-R26): format prints the root's
    // canonical text; build writes the linked WAT next to the root.
    const formatted = runCli(["format", pkg.rootPath, "--source-profile", V053, "--allow-candidate-profile"]);
    assert.equal(formatted.status, 0, formatted.stderr);
    assert.equal(formatted.stdout, pkg.files["main.air"], "CLI format");
    const cliBuild = runCli(["build", pkg.rootPath, "--source-profile", V053, "--allow-candidate-profile"]);
    assert.equal(cliBuild.status, 0, cliBuild.stderr);
    const cliWat = fs.readFileSync(path.join(pkg.dir, "main.wat"), "utf8");
    assert(cliWat.includes("(func $1.run (export \"run\")") && cliWat.includes("call $0.add_one"), "CLI build: the linked WAT");
    fs.rmSync(path.join(pkg.dir, "main.wat"));
    const deps = wb.inspectBoundWorkBound(run.built).record.key.dependencies;
    assert.equal(deps.length, 1);
    assert.deepEqual([deps[0].module, deps[0].body_digest], [pkg.identities.get("math.air"), `sha256:${hexOf(pkg.files["math.air"])}`]);
    return { value: { artifact, closure, dependencies: deps, E_run: S(10, 3), values: run.values } };
  });
  await vector("V53-IMP-ID-02", async () => {
    const p02 = byPrefix("V53-IMP-P02");
    const out = {};
    for (const [tag, run0] of [["(i)", 6], ["(ii)", 3]]) {
      const pkg = byPrefix(`V53-IMP-ID-02 ${tag}`);
      const run = await accept(pkg, [["run", [0], run0]]);
      expectClosure(pkg, run.closure);
      expectE(run.built, "run", 10, 3);
      assert.notEqual(pkg.identities.get("math.air"), p02.identities.get("math.air"), `${tag}: mid(math) differs from P02's`);
      assert.notEqual(pkg.identities.get("main.air"), p02.identities.get("main.air"), `${tag}: mid(main) differs from P02's`);
      const dep = wb.inspectBoundWorkBound(run.built).record.key.dependencies[0];
      assert.equal(dep.module, pkg.identities.get("math.air"));
      out[tag] = { dependency: dep, identities: Object.fromEntries(pkg.identities), values: run.values };
    }
    assert.equal(bytesOf(byPrefix("V53-IMP-ID-02 (ii)").files["math.air"]), 107, "(ii) keeps 107 bytes");
    return { value: out };
  });
  await vector("V53-IMP-P03", async () => {
    const pkg = byPrefix("V53-IMP-P03");
    const run = await accept(pkg, [["run", [0], 2]]);
    expectE(run.built, "run", 9, 3);
    return { value: { closure: expectClosure(pkg, run.closure), order: run.closure.order, values: run.values } };
  });
  await vector("V53-IMP-P04", async () => {
    const pkg = byPrefix("V53-IMP-P04");
    const run = await accept(pkg, [["run", [0], 64]]);
    expectE(run.built, "run", 191, 63);
    const counters = typedClosure.closureCounters(run.ast);
    assert.equal(Object.keys(counters).length, 64, "64 modules");
    for (const [key, value] of Object.entries(counters)) assert.deepEqual(value, { measure: 1, parse: 1, read: 1, summarize: 1, verify: 1 }, key);
    return { value: { closure: expectClosure(pkg, run.closure), modules: 64, values: run.values } };
  });
  await vector("V53-IMP-P05", async () => {
    const input = onDisk(P("V53-IMP-P05 formatter input (non-canonical: spacing, a use after a function)"));
    const output = P("V53-IMP-P05 canonical output");
    const formatted = sp.formatSource(sp.parseSource(input.files["main.air"], input.rootPath, GATED), GATED);
    assert.equal(formatted, output.files["main.air"], "the formatter output, byte for byte");
    assert.equal(hexOf(formatted), "03911c0eb0ca6f3df1ef1fb9f56e1ce3f93fd2e02defb3968ee973ba8dae0da6");
    assert.equal(sp.formatSource(sp.parseSource(formatted, input.rootPath, GATED), GATED), formatted, "idempotent");
    const run = await accept(output, [["run", [0], 1]]);
    expectE(run.built, "run", 4, 1);
    return { value: { closure: expectClosure(output, run.closure), formatted_sha256: hexOf(formatted), values: run.values } };
  });
  await vector("V53-IMP-P06", async () => {
    const pkg = byPrefix("V53-IMP-P06");
    const run = await accept(pkg, [["run", [0], 2]]);
    expectE(run.built, "run", 7, 2);
    assert.equal(pkg.identities.get("copy.air"), pkg.identities.get("math.air"), "one identity");
    const counters = typedClosure.closureCounters(run.ast);
    assert.deepEqual(Object.keys(counters), ["copy.air", "main.air", "math.air"], "three modules (a module is its key)");
    for (const value of Object.values(counters)) assert.deepEqual(value, { measure: 1, parse: 1, read: 1, summarize: 1, verify: 1 });
    const deps = wb.inspectBoundWorkBound(run.built).record.key.dependencies;
    assert.deepEqual(deps.map((item) => [item.module, item.body_digest]), [[pkg.identities.get("math.air"), "sha256:7ce07386433af1147d00e9051b235f946e0a600c7b161c62111eef310a366bb0"]], "one dependency entry");
    const definitions = run.wat.match(/^ {2}\(func \$[0-9]+\.add_one\b/gmu) || [];
    assert.equal(definitions.length, 2, "each module's add_one once, under its own index");
    return { value: { add_one_definitions: definitions.length, closure: expectClosure(pkg, run.closure), counters, dependencies: deps, values: run.values } };
  });
  await vector("V53-IMP-P07", async () => {
    const runtime = createVerifiedTypedRuntime({ admit: async () => true });
    const values = [];
    for (const label of ["V53-IMP-P02", "V53-IMP-ID-02 (i)", "V53-IMP-ID-02 (ii)", "V53-IMP-P02"]) {
      const pkg = byPrefix(label);
      const handle = await runtime.build({ ...GATED, descriptor: descriptorOf(pkg.files["main.air"]), modules: { "math.air": pkg.files["math.air"] }, source: pkg.files["main.air"], sourceName: "main.air" });
      values.push((await runtime.invoke(handle, "run", [0])).value);
    }
    assert.deepEqual(values, [3, 6, 3, 3]);
    const { cacheHits, cacheMisses, compilations } = runtime.inspect().counters;
    assert.deepEqual({ cacheHits, cacheMisses, compilations }, { cacheHits: 1, cacheMisses: 3, compilations: 3 });
    return { value: { counters: { cacheHits, cacheMisses, compilations }, values } };
  });
  await vector("V53-IMP-P08", async () => {
    const pkg = byPrefix("V53-IMP-P08");
    const run = await accept(pkg, [["run", [5], 5]]);
    expectE(run.built, "run", 1);
    const artifact = exportsOf(run.built.wasmBytes);
    assert.deepEqual(artifact, { exports: ["function:run", "global:__air_failure_reason"], imports: [] });
    assert(!run.wat.includes("(start ") && !run.wat.includes("(memory (export"), "no start function and no memory export");
    assert.equal(run.wat.split("(func $__air_borrow_failure (param $code i32) unreachable)").length - 1, 1, "the helper is defined once, internal");
    return { value: { artifact, closure: expectClosure(pkg, run.closure), values: run.values } };
  });
  await vector("V53-IMP-N08", async () => {
    const out = {};
    for (const tag of ["(i)", "(ii)", "(iii)", "(iv)", "(vii)"]) out[tag] = await staticReject(byPrefix(`V53-IMP-N08 ${tag}`), "air.import.path_uncontained", 3, "main.air");
    for (const tag of ["(v)", "(viii)"]) out[tag] = await staticReject(byPrefix(`V53-IMP-N08 ${tag}`), "air.import.not_found", 3, "main.air");
    out["(vi)"] = fileHarness();
    return { value: out };
  });
  await vector("V53-IMP-N09", async () => {
    const out = {};
    out["(i)"] = await staticReject(byPrefix("V53-IMP-N09 (i) no alias"), "air.v051.typed_syntax_invalid", 3, "main.air");
    const control = byPrefix("V53-IMP-N09 (i) control");
    const run = await accept(control, [["run", [5], 5]]);
    expectE(run.built, "run", 1);
    out["(i) control"] = { closure: expectClosure(control, run.closure), values: run.values };
    out["(ii)"] = await staticReject(byPrefix("V53-IMP-N09 (ii)"), "air.v051.typed_syntax_invalid", 4, "main.air");
    out["(iii)"] = await staticReject(byPrefix("V53-IMP-N09 (iii)"), "air.import.duplicate_module", 4, "main.air");
    out["(v)"] = await staticReject(byPrefix("V53-IMP-N09 (v)"), "air.call.unknown_function", 6, "main.air");
    out["(vi)"] = await staticReject(byPrefix("V53-IMP-N09 (vi)"), "air.call.unknown_function", 6, "main.air");
    out["(vii)"] = await staticReject(byPrefix("V53-IMP-N09 (vii)"), "air.import.duplicate_module", 4, "main.air");
    return { value: out };
  });
  await vector("V53-IMP-N10", async () => {
    const out = {};
    out["(i)"] = await intakeEverywhere(byPrefix("V53-IMP-N10 (i)"), intake("air.v052.work_limit_modules", "closure", "m64.air", 65, 64));
    out["(ii)"] = await intakeEverywhere(byPrefix("V53-IMP-N10 (ii)"), intake("air.v052.work_limit_source_bytes", "closure", "b4.air", 1279552, 1048576));
    const iii = byPrefix("V53-IMP-N10 (iii)");
    assert.equal(Object.values(iii.files).reduce((sum, text) => sum + bytesOf(text), 0), 1048576);
    const run = await accept(iii, [["run", [0], 101000608]]);
    expectE(run.built, "run", 24621, 5);
    out["(iii)"] = { closure: expectClosure(iii, run.closure), values: run.values };
    out["(iv)"] = await intakeEverywhere(byPrefix("V53-IMP-N10 (iv)"), intake("air.v052.work_limit_source_bytes", "closure", "b4.air", 1048577, 1048576));
    out["(v)"] = await intakeEverywhere(byPrefix("V53-IMP-N10 (v)"), intake("air.v052.work_limit_source_bytes", "module", "huge.air", 262145, 262144));
    const diamond = byPrefix("V53-PIPE-04");
    const vi = await runtimeOutcome(diamond, { closureLimits: { maxClosureSourceBytes: 484 } });
    expectIntake(vi, intake("air.v052.work_limit_source_bytes", "closure", "d.air", 485, 484), "N10 (vi)");
    out["(vi)"] = vi;
    const vii = await runtimeOutcome(diamond, { closureLimits: { maxClosureSourceBytes: 485 } }, [["run", [0]]]);
    assert.deepEqual(vii.values, [2], "N10 (vii) admitted");
    out["(vii)"] = { values: vii.values };
    return { value: out };
  });
  await vector("V53-IMP-N11", async () => {
    const out = {};
    const control = byPrefix("V53-IMP-N11 control");
    const run = await accept(control, [["run", [5], 5]]);
    expectE(run.built, "run", 3, 1);
    out.control = { closure: expectClosure(control, run.closure), values: run.values };
    out["(i)"] = await staticReject(byPrefix("V53-IMP-N11 (i)"), "air.import.signature_type_unsupported", 11, "main.air");
    out["(ii)"] = await staticReject(byPrefix("V53-IMP-N11 (ii)"), "air.decision.enum_unknown", 5, "main.air");
    out["(iii)"] = await staticReject(byPrefix("V53-IMP-N11 (iii)"), "air.abi.borrowed_lane_plain_export", 3, "lib.air");
    out["(iv)"] = await staticReject(byPrefix("V53-IMP-N11 (iv)"), "air.import.signature_type_unsupported", 7, "main.air");
    return { value: out };
  });
  await vector("V53-IMP-N12", async () => {
    const pkg = onDisk(byPrefix("V53-IMP-P02"));
    const refused = { capacity: 14, measure: "analysis_units", required: 15 };
    const out = {};
    for (const units of [14, 15]) {
      const analysisCapacity = { maxAnalysisUnits: units };
      const options = { ...GATED, analysisCapacity };
      const parsedDefault = sp.parseSource(pkg.files["main.air"], pkg.rootPath, GATED);
      const calls = {
        builder: async () => buildVerifiedTypedModule(buildInput(pkg, { analysisCapacity })),
        cli_equivalent: async () => sp.parseSource(pkg.files["main.air"], pkg.rootPath, { sourceProfile: V053, allowCandidateProfile: true, analysisCapacity }),
        format_source: async () => sp.formatSource(parsedDefault, options),
        parse_source: async () => sp.parseSource(pkg.files["main.air"], pkg.rootPath, options),
        runtime: async () => {
          const runtime = createVerifiedTypedRuntime({ admit: async () => true, analysisCapacity });
          return runtime.invoke(await runtime.build(buildInput(pkg)), "run", [0]);
        },
        verify_source: async () => sp.verifySource(parsedDefault, options)
      };
      const row = {};
      for (const [name, call] of Object.entries(calls)) {
        let error = null;
        let result;
        try { result = await call(); } catch (caught) { error = caught; }
        if (units === 14) {
          assert(error && error.code === "air.analysis.capacity_exceeded" && error.disposition === "ANALYSIS_REFUSED", `${name}: ${error && error.message}`);
          assert.deepEqual({ ...error.fields }, refused, `${name}: fields`);
          observed.push(error.code);
          row[name] = { code: error.code, fields: { ...error.fields } };
        } else {
          assert.equal(error, null, `${name} admits under 15: ${error && error.message}`);
          if (name === "runtime") assert.equal(result.value, 3);
          if (name === "builder") assert.equal((await invokeVerifiedTypedExport(result, "run", [0])).value, 3);
          row[name] = "ADMITTED";
        }
      }
      out[units] = row;
    }
    return { value: out };
  });
  await vector("P0-09-HOST-INPUTS", async () => {
    // P9-R26 (OD-P9-6 (a); AD-P9-4 (a)): the input key `modules`, the runtime
    // option `closureLimits`, their refusal codes; the earlier key sets and
    // `limits` unchanged; a `<...>` label is an empty package (P9-R5, AD-P9-10).
    const pkg = byPrefix("V53-IMP-P02");
    const base = buildInput(pkg);
    const codeOf = async (action) => { try { await action(); return "ADMITTED"; } catch (error) { observed.push(error.code); return error.code; } };
    const runtime = createVerifiedTypedRuntime({ admit: async () => true });
    const bad = {
      "not an object": { modules: "math.air" },
      "an array": { modules: [] },
      "empty": { modules: {} },
      "65 entries": { modules: Object.fromEntries(Array.from({ length: 65 }, (_, k) => [`m${k}.air`, pkg.files["math.air"]])) },
      "a key with ..": { modules: { "../math.air": pkg.files["math.air"] } },
      "a key with an empty segment": { modules: { "a//math.air": pkg.files["math.air"] } },
      "a key without .air": { modules: { "math.txt": pkg.files["math.air"] } },
      "an empty value": { modules: { "math.air": "" } },
      "a non-ASCII value": { modules: { "math.air": `${pkg.files["math.air"]}é` } },
      "no sourceName": { sourceName: undefined },
      "sourceName is a map key": { sourceName: "math.air" }
    };
    const refusals = {};
    for (const [name, change] of Object.entries(bad)) {
      const input = { ...base, ...change };
      if (input.sourceName === undefined) delete input.sourceName;
      refusals[name] = { builder: await codeOf(() => buildVerifiedTypedModule(input)), runtime: await codeOf(() => runtime.build(input)) };
      assert.deepEqual(refusals[name], { builder: "air.v052.verified_build_input_invalid", runtime: "air.v052.runtime_input_invalid" }, name);
    }
    const limitRefusals = {};
    for (const [name, closureLimits] of Object.entries({ "unknown key": { maxClosureDepth: 3 }, "zero": { maxClosureModules: 0 }, "above the default": { maxClosureModules: 65 },
      "not an integer": { maxClosureSourceBytes: 1.5 }, "null": null, "an array": [] })) {
      limitRefusals[name] = await codeOf(async () => createVerifiedTypedRuntime({ admit: async () => true, closureLimits }));
      assert.equal(limitRefusals[name], "air.v052.runtime_limits_invalid", `closureLimits ${name}`);
    }
    limitRefusals["limits: {maxClosureModules: 3}"] = await codeOf(async () => createVerifiedTypedRuntime({ admit: async () => true, limits: { maxClosureModules: 3 } }));
    assert.equal(limitRefusals["limits: {maxClosureModules: 3}"], "air.v052.runtime_limits_invalid", "limits keeps its ten keys");
    const v051 = { buildOptions: {}, descriptor: base.descriptor, source: "module v51.m\n\nexport func run(x: i32) -> i32 {\n  return %x\n}\n", sourceName: "main.air", sourceProfile: "typed-v0.51" };
    const v051Runtime = await codeOf(() => runtime.build({ ...v051, modules: { "math.air": pkg.files["math.air"] } }));
    assert.equal(v051Runtime, "air.v052.runtime_input_invalid", "typed-v0.51 runtime key set unchanged");
    const label = (() => { try { sp.parseSource(pkg.files["main.air"], "<input>", GATED); return "ADMITTED"; } catch (error) { observed.push(error.code); return { code: error.code, line: error.loc && error.loc.line }; } })();
    assert.deepEqual(label, { code: "air.import.not_found", line: 3 }, "a <...> label is an empty package");
    const accepted = await codeOf(async () => runtime.build({ ...base, sourceName: "main.air" }));
    assert.equal(accepted, "ADMITTED");
    return { value: { label, limits: limitRefusals, modules: refusals, typed_v051_runtime_modules: v051Runtime } };
  });
  await vector("V53-ABI-52", async () => {
    const pkg = onDisk(byPrefix("V53-ABI-52"));
    const run = await accept(pkg, []);
    const closure = expectClosure(pkg, run.closure);
    expectE(run.built, "rd", 3);
    const artifact = exportsOf(run.built.wasmBytes);
    assert.deepEqual(artifact.exports, ["function:rd", "global:__air_abi_feature_typed_memory_v1", "global:__air_failure_reason", "global:__air_owned_memory_base",
      "global:__air_owned_memory_end", "memory:memory"].sort());
    assert.deepEqual(artifact.imports, ["air:contract.typed-v0.53.v1"]);
    assert.equal(run.wat.split("(start ").length - 1, 1, "one start function");
    assert(run.wat.includes(`i32.const ${WORD} i32.ne`), "the handshake on the word 1095324209");
    assert.equal((run.wat.match(/^ {2}\(memory /gmu) || []).length, 1, "one memory");
    assert(/\(global \(export "__air_owned_memory_base"\) i32 \(i32\.const 16\)\)/u.test(run.wat), "BASE 16");
    // The borrowed parameter's entry checks (ingress.borrowed_slice) are at
    // the root entry rd only; lib.air's peek is internal: no ingress, no guard.
    const bodyOf = (name) => run.wat.split("\n  (func ").find((item) => item.startsWith(`${name} `)) || "";
    assert(bodyOf("$1.rd").includes("memory.size") && bodyOf("$1.rd").includes("i32.const 3\n    i32.and"), "rd: the entry checks of b");
    assert(bodyOf("$0.peek") && !bodyOf("$0.peek").includes("memory.size"), "peek: no entry check");
    const host = new Uint8Array(16);
    host.set([42, 0, 0, 0], 12);
    const handle = await admitTypedV053Artifact({ record: run.built, wasmBytes: run.built.wasmBytes });
    const result = await handle.invoke({ arguments: { o: 12 }, bindings: { b: { access: "readonly", aliasGroup: null, alignment: 4, buffer: host, maxLength: 16, memoryDomain: "wasm-linear", transferMode: "copied_into_wasm" } }, entrypoint: "rd" });
    assert.equal(result.result, 42, "the typed admission of rd returns 42");
    return { value: { admission: result.result, artifact, closure, E_rd: S(3) } };
  });
}

// N08 (vi): file-entrypoint harness cases (symbolic links and the root
// argument exist only there), each main.air with one `use` at line 3.
function fileHarness() {
  const outside = path.join(tmp, "outside");
  fs.mkdirSync(path.join(outside, "dir"), { recursive: true });
  fs.writeFileSync(path.join(outside, "x.air"), LEAF("v53.imp.out", 1));
  const main = (target) => mod("v53.imp.main", uses([target, "l"]), func(R, ["return %x"]));
  const cases = [
    ["(vi-a) a link to an existing file outside", "./link_out.air", (dir) => fs.symlinkSync(path.join(outside, "x.air"), path.join(dir, "link_out.air")), "air.import.path_uncontained"],
    ["(vi-b) a dangling link outside", "./link_out.air", (dir) => fs.symlinkSync("../outside/missing.air", path.join(dir, "link_out.air")), "air.import.path_uncontained"],
    ["(vi-c) a dangling link inside", "./link_in.air", (dir) => fs.symlinkSync("./nope.air", path.join(dir, "link_in.air")), "air.import.not_found"],
    ["(vi-d) a case variant of a link to outside", "./Link.air", (dir) => fs.symlinkSync(path.join(outside, "x.air"), path.join(dir, "link.air")), "air.import.not_found"],
    ["(vi-e) a directory link to outside", "./dout/nope.air", (dir) => fs.symlinkSync(path.join(outside, "dir"), path.join(dir, "dout")), "air.import.path_uncontained"],
    ["(vi-f) a chain of links to outside", "./chain1.air", (dir) => { fs.symlinkSync("./chain2.air", path.join(dir, "chain1.air")); fs.symlinkSync(path.join(outside, "x.air"), path.join(dir, "chain2.air")); }, "air.import.path_uncontained"]
  ];
  const out = {};
  for (const [tag, target, setup, code] of cases) {
    const dir = path.join(tmp, `harness${packageCounter += 1}`);
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "main.air"), main(target));
    setup(dir);
    const pkg = { dir, files: { "main.air": main(target) }, label: tag, root: "main.air", rootPath: path.join(dir, "main.air") };
    const sdk = sdkOutcome(pkg);
    const cli = cliOutcome(pkg);
    for (const outcome of [sdk, cli]) assert.deepEqual([outcome.code, outcome.line], [code, 3], `${tag}: ${JSON.stringify(outcome)}`);
    out[tag] = { cli, code, sdk: { code: sdk.code, line: sdk.line } };
  }
  // (vi-g) the SDK parse of a root text with a `use` under a mis-cased root argument.
  const dir = path.join(tmp, `harness${packageCounter += 1}`);
  fs.mkdirSync(dir);
  const text = mod("v53.imp.main", uses(["./x.air", "x"]), func(R, ["return %x"]));
  fs.writeFileSync(path.join(dir, "main.air"), text);
  fs.writeFileSync(path.join(dir, "x.air"), LEAF("v53.imp.x", 1));
  const g = sdkOutcome({ dir, files: { "main.air": text }, root: "main.air" }, GATED, path.join(dir, "Main.air"));
  assert.deepEqual([g.code, g.line], ["air.import.not_found", 3], `(vi-g): ${JSON.stringify(g)}`);
  out["(vi-g) a mis-cased root argument (SDK)"] = { code: g.code, line: g.line };
  return out;
}

// ---------------------------------------------------------------------------
// Slice checks (P9-R27).

const acceptedPackages = () => [...PACKAGES.values()].filter((pkg) => pkg.accept);

// P0-09-SEP-WB (the P0-05 P5-R13b method, as P0-06..P0-08 apply it). Each
// accepted closure is verified with the real WorkBound phase, with the phase
// disabled and with an outcome-preserving stub, and the WAT of each mode must
// be byte-identical.
const SEP_COMPARE = `"use strict";
const fs = require("fs");
const path = require("path");
const [srcDir, corpusFile] = process.argv.slice(2);
const r = (m) => require(path.join(srcDir, m));
const sp = r("source_profile.js");
const verifier = r("verifier.js");
const wb = r("workbound.js");
const { lowerToWat } = r("lower_wasm.js");
const PHASE = new Set(${JSON.stringify(PHASE_CODES)});
const PERTURB = { calls: 13n, iterations: 17n, steps: 7919n };
const real = wb.analyzeVerifiedTypedModule;
const perturb = (values) => new Map([...values].map(([name, value]) => [name, value && value.ok ? { ok: true, value: wb.summary({
  calls: value.value.calls + PERTURB.calls,
  effects: value.value.effects,
  iterations: value.value.iterations + PERTURB.iterations,
  ...(value.value.region_bytes !== undefined ? { region_bytes: value.value.region_bytes } : {}),
  steps: value.value.steps + PERTURB.steps
}) } : value]));
const modes = {
  real,
  disabled: () => ({ cycles: [], entries: new Map(), functions: new Map(), primary: null, roots: [], stats: {}, status: "ok" }),
  stubbed: (mod) => {
    const analysis = real(mod);
    return { ...analysis, entries: perturb(analysis.entries), functions: perturb(analysis.functions) };
  }
};
function outcome(entry, mode) {
  wb.analyzeVerifiedTypedModule = modes[mode];
  try {
    const mod = sp.parseSource(fs.readFileSync(entry.root, "utf8"), entry.root, entry.options);
    sp.verifySource(mod, entry.options);
    let wat;
    try { wat = lowerToWat(mod, { maxWatBytes: 4194304 }); } catch (error) { wat = "LOWERING FAILED: " + String(error.code || error.message); }
    return { result: { verdict: "VERIFIED" }, wat };
  } catch (error) {
    return { result: { code: error.code || null, disposition: error.disposition || null, file: error.loc ? path.basename(error.loc.file) : null, line: error.loc && error.loc.line || null, verdict: "REJECTED" }, wat: null };
  } finally {
    wb.analyzeVerifiedTypedModule = real;
  }
}
const differences = [];
const watDifferences = [];
const counts = { loweredInEveryMode: 0, phaseRejections: 0, rejected: 0, closures: 0, verified: 0 };
for (const line of fs.readFileSync(corpusFile, "utf8").split("\\n").filter(Boolean)) {
  const entry = JSON.parse(line);
  counts.closures += 1;
  const runs = { disabled: outcome(entry, "disabled"), real: outcome(entry, "real"), stubbed: outcome(entry, "stubbed") };
  const got = { disabled: runs.disabled.result, real: runs.real.result, stubbed: runs.stubbed.result };
  const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  const phase = got.real.verdict === "REJECTED" && PHASE.has(got.real.code);
  counts[got.real.verdict === "VERIFIED" ? "verified" : "rejected"] += 1;
  if (phase) counts.phaseRejections += 1;
  if (!same(got.stubbed, got.real)) differences.push({ got, label: entry.label, mode: "stubbed" });
  if (phase ? got.disabled.verdict !== "VERIFIED" : !same(got.disabled, got.real)) differences.push({ got, label: entry.label, mode: "disabled" });
  if (got.real.verdict === "VERIFIED") {
    for (const mode of ["disabled", "stubbed"]) if (runs[mode].wat !== runs.real.wat) watDifferences.push({ label: entry.label, mode });
    if (!runs.real.wat.startsWith("LOWERING FAILED")) counts.loweredInEveryMode += 1;
  }
}
const exportNames = [...Object.keys(verifier), ...Object.keys(verifier.typedV053 || {})];
process.stdout.write(JSON.stringify({ budgetOrGrantExports: exportNames.filter((name) => /budget|grant|admi/iu.test(name)), counts, differenceCount: differences.length, differences: differences.slice(0, 40), watDifferenceCount: watDifferences.length, watDifferences }));
`;
// The P0-08 controls, at their anchors, applied to a scratch copy of src/.
const PHASE_OK_ANCHOR = "  if (analysis.status === \"ok\") {\n    verifyV053WorkAssertion(mod, analysis);\n    return;\n  }";
function thresholdMutant(dimension) {
  return PHASE_OK_ANCHOR.replace("    return;", [
    "    if (!mod.work) for (const fn of mod.functions || []) {",
    "      const entry = fn.exported && analysis.entries instanceof Map ? analysis.entries.get(fn.name) : null;",
    `      if (entry && entry.ok && entry.value.${dimension} > ${P09_MAXIMA[dimension]}n) throw new VerificationError("air.workbound.assertion_exceeded: mutant threshold on ${dimension}", fn.loc);`,
    "    }",
    "    return;"
  ].join("\n"));
}
const C7_REPLACEMENT = PHASE_OK_ANCHOR.replace("    verifyV053WorkAssertion(mod, analysis);", [
  "    const __mem = (list) => (list || []).some((s) => s && (s.kind === \"memory\" || (s.value && s.value.kind === \"memory_operation\") || (Array.isArray(s.blocks) && s.blocks.some((b) => __mem(b.statements)))));",
  "    if ((mod.functions || []).some((fn) => __mem(fn.statements))) for (const fn of mod.functions || []) {",
  "      const entry = fn.exported && analysis.entries instanceof Map ? analysis.entries.get(fn.name) : null;",
  "      if (entry && entry.ok && entry.value.steps > 7n) throw new VerificationError(\"air.memory.region_bounds_static: mutant reads E(e).steps\", fn.loc);",
  "    }",
  "    verifyV053WorkAssertion(mod, analysis);"
].join("\n"));
const C8_FEATURES_ANCHOR = "    const features = v053ModuleFeatures(mod);\n    const header = v053ModuleHeaderLines(features);";
const C8_BODY_ANCHOR = "  for (const record of records) emitV053TypedRuntimeValidation(state, record);";
const SEP_MUTANTS = Object.freeze({
  C2: { description: `reject a module without work when E(e).steps > ${P09_MAXIMA.steps}`, edits: [["verifier.js", PHASE_OK_ANCHOR, thresholdMutant("steps")]] },
  C3: { description: `reject a module without work when E(e).calls > ${P09_MAXIMA.calls}`, edits: [["verifier.js", PHASE_OK_ANCHOR, thresholdMutant("calls")]] },
  C4: { description: `reject a module without work when E(e).iterations > ${P09_MAXIMA.iterations}`, edits: [["verifier.js", PHASE_OK_ANCHOR, thresholdMutant("iterations")]] },
  C7: { description: "the static memory-domain check reads the WorkBound summary (reject a module with a memory statement when E(e).steps > 7)", edits: [["verifier.js", PHASE_OK_ANCHOR, C7_REPLACEMENT]] },
  C8: {
    description: "the lowering reads the WorkBound summary (one nop in each function whose E(e).steps > 7)",
    edits: [
      ["lower_wasm.js", C8_FEATURES_ANCHOR, C8_FEATURES_ANCHOR.replace("\n    const header", "\n    features.__wbEntries = require(\"./workbound\").analyzeVerifiedTypedModule(mod).entries;\n    const header")],
      ["lower_wasm.js", C8_BODY_ANCHOR, `${C8_BODY_ANCHOR}\n  const __wbEntry = features.__wbEntries && features.__wbEntries.get(fn.name);\n  if (__wbEntry && __wbEntry.ok && __wbEntry.value.steps > 7n) state.body.push("nop");`]
    ]
  }
});
function scratchSource(name, edits) {
  const scratch = path.join(tmp, `src-${name}`);
  fs.cpSync(path.join(ROOT, "src"), scratch, { recursive: true });
  for (const [file, anchor, replacement] of edits) {
    const text = fs.readFileSync(path.join(scratch, file), "utf8");
    assert.equal(text.split(anchor).length, 2, `${name}: the anchor occurs exactly once in ${file}`);
    fs.writeFileSync(path.join(scratch, file), text.replace(anchor, replacement));
  }
  return scratch;
}
function spawnJson(script, args) {
  const out = childProcess.spawnSync(process.execPath, [script, ...args], {
    cwd: tmp, encoding: "utf8", env: { ...process.env, NODE_PATH: path.join(ROOT, "node_modules") }, killSignal: "SIGKILL", maxBuffer: 256 * 1024 * 1024, timeout: 900000
  });
  assert(!out.error && out.signal === null && out.status === 0, `${path.basename(script)}: ${out.stderr || out.error}`);
  return JSON.parse(out.stdout);
}

// P0-09-CHECK-CLOSURE's counters, in a child process on a given src/.
const CLOSURE_PROBE = `"use strict";
const path = require("path");
const fs = require("fs");
const [srcDir, rootPath] = process.argv.slice(2);
const sp = require(path.join(srcDir, "source_profile.js"));
const tc = require(path.join(srcDir, "typed_closure.js"));
const options = { allowCandidateProfile: true, sourceProfile: "typed-v0.53" };
const mod = sp.parseSource(fs.readFileSync(rootPath, "utf8"), rootPath, options);
sp.verifySource(mod, options);
const closure = tc.closureOf(mod);
process.stdout.write(JSON.stringify({ counters: tc.closureCounters(mod), totals: closure.totals }));
`;
// Memoization disabled: the loader forgets the key d.air (it rediscovers and
// rereads it at the second importer). Per-edge totals: a shared module's
// measure is added once per import edge.
const MEMO_MUTANT = [
  ["typed_closure.js", "      if (!records.has(target)) {\n        const resolution = pkg.resolve(target);", "      if (!records.has(target) || target === \"d.air\") {\n        const resolution = pkg.resolve(target);"],
  ["typed_closure.js", "      if (records.has(target)) continue;\n      discover(target);\n      counters.set(target, newCounters());", "      if (records.has(target) && target !== \"d.air\") continue;\n      discover(target);\n      if (!counters.has(target)) counters.set(target, newCounters());"],
  ["typed_closure.js", "    if (!record.ast) {", "    if (!record.ast || key === \"d.air\") {"]
];
const PER_EDGE_MUTANT = [
  ["typed_closure.js", "    totals: Object.freeze({ ...totals }),", "    totals: Object.freeze({ ...totals, astNodes: totals.astNodes + edges.filter((edge) => edges.some((other) => other !== edge && other.to === edge.to && other.from !== edge.from) && edges.findIndex((other) => other.to === edge.to) !== edges.indexOf(edge)).reduce((sum, edge) => sum + nodeCount(records.get(edge.to).ast), 0), sourceBytes: totals.sourceBytes + edges.filter((edge) => edges.findIndex((other) => other.to === edge.to) !== edges.indexOf(edge)).reduce((sum, edge) => sum + records.get(edge.to).bytes, 0) }),"]
];

async function sectionChecks(counterEvidence) {
  await vector("P0-09-SEP-WB-PACKAGES", async () => {
    // VECTORS_ADDITIONS.md §3a: the C7 carrier and the B-1 regression package
    // (no catalogue ID), each ACCEPT as pinned.
    const carrier = byPrefix("P0-09-SEP-WB C7 carrier");
    const run = await accept(carrier, [["run", [0], 1], ["run", [41], 42]]);
    expectE(run.built, "run", 10, 1, 0, 16);
    const buf = run.closure.records.get("buf.air").ast;
    const keep = wb.canonicalSummary(wb.analyzeVerifiedTypedModule(buf).functions.get("keep").value);
    assert.deepEqual(keep, S(8, 0, 0, 16), "B(keep) = S{steps:8, region_bytes:16}");
    const b1 = byPrefix("P0-09-SEP-WB B-1 regression");
    assert.equal(hexOf(b1.files["main.air"]), "13b32afce2cafb49556501e000fd98aa0e1dfc16f2d5987eb50ae5148239c4fa", "R2.4's fixture (a), unchanged");
    const single = await accept(b1, [["run", [5], 5]]);
    expectE(single.built, "run", 1);
    assert.deepEqual(exportsOf(single.built.wasmBytes), { exports: ["function:run", "global:__air_failure_reason"], imports: [] });
    assert(!single.wat.includes("(start "), "no start function");
    assert.equal(single.wat.split("(func $__air_borrow_failure (param $code i32) unreachable)").length - 1, 1, "the helper once, internal");
    return { value: { b1: { E_run: S(1), values: single.values }, c7_carrier: { B_keep: keep, closure: expectClosure(carrier, run.closure), E_run: S(10, 1, 0, 16), values: run.values } } };
  });
  await vector("P0-09-SEP-WB", () => {
    const packages = acceptedPackages();
    const texts = new Set();
    const lines = [];
    for (const pkg of packages) {
      onDisk(pkg);
      for (const text of Object.values(pkg.files)) texts.add(hexOf(text));
      lines.push(JSON.stringify({ label: pkg.label, options: GATED, root: pkg.rootPath }));
    }
    const corpusFile = path.join(tmp, "sep-corpus.jsonl");
    fs.writeFileSync(corpusFile, `${lines.join("\n")}\n`);
    const compareScript = path.join(tmp, "sep-compare.js");
    fs.writeFileSync(compareScript, SEP_COMPARE);
    const behaviour = spawnJson(compareScript, [path.join(ROOT, "src"), corpusFile]);
    assert.deepEqual(behaviour.budgetOrGrantExports, [], "no verifier export accepts or returns a Budget or grant");
    assert.equal(behaviour.counts.closures, packages.length);
    assert.equal(behaviour.counts.verified, packages.length, "every accepted closure verifies in real mode");
    assert.equal(behaviour.differenceCount, 0, `WorkBound changed a verdict: ${JSON.stringify(behaviour.differences).slice(0, 3000)}`);
    assert.equal(behaviour.watDifferenceCount, 0, `WorkBound changed lowered code: ${JSON.stringify(behaviour.watDifferences)}`);
    assert.equal(behaviour.counts.loweredInEveryMode, packages.length, "every accepted closure lowers");
    const controls = {};
    for (const [name, mutant] of Object.entries(SEP_MUTANTS)) {
      const scratch = scratchSource(name, mutant.edits);
      const mutated = spawnJson(compareScript, [scratch, corpusFile]);
      fs.rmSync(scratch, { force: true, recursive: true });
      controls[name] = {
        description: mutant.description,
        differences: mutated.differenceCount,
        sources: [...new Set(mutated.differences.map((item) => `${item.label} (${item.mode})`))].sort(),
        wat_differences: mutated.watDifferenceCount,
        wat_sources: [...new Set(mutated.watDifferences.map((item) => `${item.label} (${item.mode})`))].sort()
      };
    }
    for (const name of ["C2", "C3", "C4", "C7"]) assert(controls[name].differences > 0, `${name} (${SEP_MUTANTS[name].description}) must make P0-09-SEP-WB fail`);
    assert(controls.C7.sources.some((source) => source.startsWith("P0-09-SEP-WB C7 carrier")), "C7 bites on the C7 carrier");
    assert.equal(controls.C8.differences, 0, "C8 changes no verdict");
    assert(controls.C8.wat_sources.some((source) => source.startsWith("V53-IMP-P02 ")), "C8 is caught by the WAT comparison on V53-IMP-P02");
    return {
      value: {
        controls,
        corpus: { closures: packages.map((pkg) => pkg.label), distinct_file_texts: texts.size },
        coverage: behaviour.counts,
        differences: 0,
        modes: { disabled: "empty status ok analysis", real: "analyzeVerifiedTypedModule", stubbed: "+7919 steps, +13 calls, +17 iterations on every ok summary; region_bytes not perturbed" },
        thresholds: P09_MAXIMA,
        wat_differences: 0
      }
    };
  });
  await vector("P0-09-CHECK-CLOSURE", () => {
    const probe = path.join(tmp, "closure-probe.js");
    fs.writeFileSync(probe, CLOSURE_PROBE);
    const diamond = onDisk(byPrefix("V53-PIPE-04"));
    const N = Object.values(DIAMOND).reduce((sum, text) => sum + independentNodes(text), 0);
    const check = (observedRun) => {
      const problems = [];
      for (const [key, value] of Object.entries(observedRun.counters)) {
        for (const pass of ["read", "parse", "measure", "verify", "summarize"]) if (value[pass] !== 1) problems.push(`${key}.${pass} = ${value[pass]}`);
      }
      if (observedRun.totals.astNodes !== N) problems.push(`astNodes ${observedRun.totals.astNodes} != ${N}`);
      if (observedRun.totals.sourceBytes !== diamondTotal) problems.push(`sourceBytes ${observedRun.totals.sourceBytes} != ${diamondTotal}`);
      return problems;
    };
    const real = spawnJson(probe, [path.join(ROOT, "src"), diamond.rootPath]);
    assert.deepEqual(check(real), [], "the counters and totals of V53-PIPE-04 (i)");
    const out = { "V53-PIPE-04 (i)": real };
    for (const label of ["V53-IMP-P04", "V53-IMP-P06"]) {
      const pkg = onDisk(byPrefix(label));
      const run = spawnJson(probe, [path.join(ROOT, "src"), pkg.rootPath]);
      for (const [key, value] of Object.entries(run.counters)) assert.deepEqual(value, { measure: 1, parse: 1, read: 1, summarize: 1, verify: 1 }, `${label} ${key}`);
      out[label] = { counters: run.counters };
    }
    const mutants = {};
    for (const [name, edits] of [["memoization_disabled", MEMO_MUTANT], ["per_edge_totals", PER_EDGE_MUTANT]]) {
      const scratch = scratchSource(name, edits);
      const mutated = spawnJson(probe, [scratch, diamond.rootPath]);
      fs.rmSync(scratch, { force: true, recursive: true });
      const problems = check(mutated);
      assert(problems.length > 0, `${name}: the check must detect the mutant`);
      mutants[name] = { counters_d: mutated.counters["d.air"], detected: problems, totals: mutated.totals };
    }
    assert.equal(mutants.memoization_disabled.counters_d.read, 2, "memoization disabled: d is read twice");
    assert.equal(mutants.memoization_disabled.counters_d.parse, 2, "memoization disabled: d is parsed twice");
    counterEvidence.push(...Object.entries(out).map(([label, value]) => ({ counters: value.counters, label })));
    return { value: { checked: out, mutants, N, unique_bytes: diamondTotal } };
  });
  await vector("P0-09-CHECK-LINK", async () => {
    const out = {};
    for (const pkg of acceptedPackages()) {
      onDisk(pkg);
      const ast = sp.parseSource(pkg.files[pkg.root], pkg.rootPath, GATED);
      sp.verifySource(ast, GATED);
      const wat = lowerToWat(ast, { maxWatBytes: MAX_WAT });
      const built = await buildVerifiedTypedModule(buildInput(pkg));
      const artifact = exportsOf(built.wasmBytes);
      const rootExports = parser.typedV053.parse(pkg.files[pkg.root], "root.air").functions.filter((fn) => fn.exported).map((fn) => `function:${fn.name}`);
      const borrowed = borrowedRoot(pkg);
      const expectedExports = [...rootExports, "global:__air_failure_reason",
        ...(borrowed ? ["global:__air_abi_feature_typed_memory_v1", "global:__air_owned_memory_base", "global:__air_owned_memory_end", "memory:memory"] : [])].sort();
      assert.deepEqual(artifact.exports, expectedExports, `${pkg.label}: the root's exports only`);
      assert.deepEqual(artifact.imports, borrowed ? ["air:contract.typed-v0.53.v1"] : [], `${pkg.label}: imports`);
      assert.equal(wat.split("(start ").length - 1, borrowed ? 1 : 0, `${pkg.label}: start`);
      assert((wat.match(/^ {2}\(memory /gmu) || []).length <= 1, `${pkg.label}: at most one memory`);
      const closure = typedClosure.closureOf(ast);
      const definitions = {};
      if (closure) {
        closure.order.forEach((key, k) => {
          for (const fn of closure.records.get(key).ast.functions) {
            const count = wat.split(`  (func $${k}.${fn.name.replace(/[^A-Za-z0-9_]/gu, "_")} `).length - 1 + wat.split(`  (func $${k}.${fn.name.replace(/[^A-Za-z0-9_]/gu, "_")}\n`).length - 1;
            assert.equal(count, 1, `${pkg.label}: ${key} ${fn.name} lowered once`);
            definitions[`${key}:${fn.name}`] = `$${k}.${fn.name}`;
          }
        });
      } else {
        for (const fn of ast.functions) assert.equal(wat.split(`  (func $${fn.name} `).length - 1, 1, `${pkg.label}: ${fn.name} once`);
      }
      const helper = wat.split("(func $__air_borrow_failure (param $code i32) unreachable)").length - 1;
      const holdsBorrowedFunction = Object.values(pkg.files).some((text) => /^(?:export )?func [^\n]*borrowed_slice</mu.test(text));
      assert.equal(helper, holdsBorrowedFunction ? 1 : 0, `${pkg.label}: $__air_borrow_failure defined iff a function takes a borrowed_slice`);
      out[pkg.label] = { artifact, definitions: Object.keys(definitions).length || ast.functions.length, helper, start: borrowed };
    }
    return { value: out };
  });
  await vector("V53-FMT-01@P0-09", () => {
    // Every file of every ACCEPT package is canonical (R-FMT-1; P9-R27) and
    // formats idempotently: 100 files.
    // An imported module is formatted from its root's closure intake (P9-R25:
    // formatting a module of a closure formats that module only).
    let files = 0;
    for (const pkg of acceptedPackages()) {
      onDisk(pkg);
      const root = sp.parseSource(pkg.files[pkg.root], pkg.rootPath, GATED);
      const closure = typedClosure.closureOf(root);
      for (const [rel, text] of Object.entries(pkg.files)) {
        const ast = rel === pkg.root ? root : closure.records.get(rel).ast;
        const once = sp.formatSource(ast, GATED);
        assert.equal(once, text, `${pkg.label} ${rel}: canonical`);
        assert.equal(sp.formatSource(parser.typedV053.parse(once, rel), GATED), once, `${pkg.label} ${rel}: idempotent`);
        files += 1;
      }
    }
    assert.equal(files, 100, "100 files");
    return { value: { canonical_files: files } };
  });
}

async function sectionEachSlice() {
  await vector("V53-LSP-01@P0-09", () => {
    const pkg = onDisk(P("V53-IMP-N03 a imports b, b imports a"));
    const report = JSON.parse(runCli(["check", pkg.rootPath, "--source-profile", V053, "--allow-candidate-profile", "--lsp-json"]).stdout);
    assert.deepEqual([report.diagnostics[0].code, report.diagnostics[0].line], ["air.import.cycle", 3]);
    return { value: { code: report.diagnostics[0].code, line: report.diagnostics[0].line, status: report.status } };
  });
  const lsp = (pkg) => {
    const session = new AirLspSession({ allowCandidateProfile: true, sourceProfile: V053 });
    const [published] = session.handleMessage({ jsonrpc: "2.0", method: "textDocument/didOpen", params: { textDocument: { text: pkg.files[pkg.root], uri: `file://${pkg.rootPath}`, version: 1 } } });
    return published.params.diagnostics;
  };
  await vector("V53-LSP-02@P0-09", () => {
    const diagnostics = lsp(onDisk(byPrefix("V53-IMP-P02")));
    assert.deepEqual(diagnostics, [], "an accepted closure publishes no diagnostic");
    return { value: { diagnostics: 0 } };
  });
  await vector("V53-LSP-03@P0-09", () => {
    const diagnostics = lsp(onDisk(byPrefix("V53-IMP-N09 (iii)")));
    assert.equal(diagnostics[0].code, "air.import.duplicate_module");
    assert.equal(diagnostics[0].range.start.line + 1, 4);
    return { value: { code: diagnostics[0].code, line: diagnostics[0].range.start.line + 1 } };
  });
  await vector("V53-DIAG-01@P0-09", () => {
    // Every P0-09 code has a typed-v0.53 hint and a row in the note; every code
    // P0-09's vectors reached is one of the registry's or an EXISTING code;
    // every P0-09 code is exercised.
    // The note is dev-side (the public projection mirrors src/ and the tests).
    const hints = fs.readFileSync(path.join(ROOT, "src", "diagnostics.js"), "utf8");
    const notePath = path.join(ROOT, "docs", "v0.53", "P0_09_IMPORTS.md");
    if (fs.existsSync(notePath)) {
      const rows = [...fs.readFileSync(notePath, "utf8").matchAll(/^\| `(air\.[a-z0-9_.]+)` \| PROPOSED/gmu)].map((match) => match[1]).sort();
      assert.deepEqual(rows, [...P0_09_CODE_REGISTRY].sort(), "the note's table lists exactly the nine PROPOSED codes");
    }
    for (const code of P0_09_CODE_REGISTRY) assert(hints.includes(`"${code}"`), `${code} has a hint`);
    const seen = new Set(observed);
    for (const code of seen) assert(P0_09_CODE_REGISTRY.includes(code) || P0_09_EXISTING_CODES.includes(code), `${code} is registered`);
    for (const code of P0_09_CODE_REGISTRY) assert(seen.has(code), `${code} is exercised`);
    return { value: { exercised: [...seen].sort(), failures_checked: observed.length, p0_09_codes: P0_09_CODE_REGISTRY.length } };
  });
  await vector("V53-DIAG-02@P0-09", async () => {
    // Deterministic fuzz of the P0-09 roots on disk: no raw TypeError, JS
    // stack, WABT or engine error; a verified closure always builds (R-COMP-3).
    let seed = 0x0f0909;
    const next = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed; };
    const ops = ['use "./math.air" as q', 'use "../x.air" as q', 'use "./nope.air" as q', "use std.bounds", "use a.b", "use", "as", "@math.add_one", "@q.run", "%x", "->", "i32", "\"./a.air\"", "call @math.helper(%x)", "export"];
    const roots = acceptedPackages().filter((pkg) => Object.keys(pkg.files).length > 1 && Object.keys(pkg.files).length < 10).map(onDisk);
    let cases = 0; let verified = 0; let assembled = 0;
    for (let round = 0; round < 240; round += 1) {
      const pkg = roots[next() % roots.length];
      const lines = pkg.files[pkg.root].split("\n");
      const mode = next() % 4;
      const at = next() % lines.length;
      if (mode === 0) lines.splice(at, 1);
      else if (mode === 1) lines.splice(at, 0, ops[next() % ops.length]);
      else if (mode === 2) lines[at] = `${lines[at]} ${ops[next() % ops.length]}`;
      else lines[at] = lines[at].replace(/[a-z0-9_.@%<>"/]+/u, ops[next() % ops.length]);
      const source = lines.join("\n");
      cases += 1;
      let ast;
      try {
        ast = sp.parseSource(source, pkg.rootPath, GATED);
        sp.verifySource(ast, GATED);
        verified += 1;
      } catch (error) {
        assert(!(error instanceof TypeError) && !(error instanceof RangeError) && !(error instanceof SyntaxError), `${error && error.stack}\n${source}`);
        assert(typeof error.code === "string" && error.code.startsWith("air."), `uncoded: ${error && error.message}\n${source}`);
        assert(!/wabt|\n\s+at /iu.test(String(error.message)));
        continue;
      }
      const wat = lowerToWat(ast, { maxWatBytes: MAX_WAT });
      new WebAssembly.Module(await watToWasm(wat, "fuzz.air"));
      assembled += 1;
    }
    assert.equal(assembled, verified, "every verified fuzz closure builds");
    return { value: { assembled, cases, verified } };
  });
}

// ---------------------------------------------------------------------------
async function main() {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "air-v053-p009-"));
  const counterEvidence = [];
  try {
    await sectionGenerated();
    await sectionAdditions();
    await sectionChecks(counterEvidence);
    await sectionEachSlice();
  } finally {
    fs.rmSync(tmp, { force: true, recursive: true });
  }
  const outDir = process.env.AIR_P009_VECTOR_RESULTS_DIR;
  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "v053_imports.results.json"), `${JSON.stringify(results, null, 2)}\n`);
  }
  if (process.env.AIR_P009_COUNTERS_FILE) fs.writeFileSync(process.env.AIR_P009_COUNTERS_FILE, `${JSON.stringify(plain(counterEvidence), null, 2)}\n`);
  const passed = results.filter((item) => item.status === "PASS").length;
  const other = results.filter((item) => !["PASS", "FAIL"].includes(item.status)).map((item) => `${item.vector} ${item.status}`);
  for (const result of results) {
    if (result.status === "FAIL") console.log(`not ok - ${result.vector}`);
    else console.log(`ok - ${result.vector} ${result.status}`);
  }
  if (failures.length) {
    for (const failure of failures) console.error(`not ok - ${failure}`);
    console.error(`typed-v0.53 P0-09 vectors: ${failures.length} FAIL, ${passed} PASS`);
    process.exit(1);
  }
  console.log(`typed-v0.53 P0-09 vectors: ${passed} PASS, ${other.length} other (${other.join(", ")})`);
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
