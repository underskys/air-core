"use strict";

// AIR for models (docs/v0.53/AIR_FOR_MODELS.md): the page, its examples, the root llms.txt and skills/air must not
// drift from the code. Rows:
//   G1 every air.* code on the page occurs in src/ or bin/ outside the repair-hint table (a refinementFail /
//      borrowedFail suffix counts)
//   G2 every code of the typed-v0.53 compile path (selected by function, SWEEP below) is on the page
//   G3 every row of examples/EXPECTED.tsv: one airc command, its exit code, first code and line as stated
//   G4 every section-4 block equals its file (or, marked shortened, is part of it); mistake rows match files and EXPECTED.tsv
//   G5 the run-time failure table equals TYPED_V053_FAILURE_REASONS
//   G6 the limits the page quotes equal the constants
//   G7 the operation list of section 3 equals the parser's typed-v0.53 operations
//   G8 page, examples, llms.txt and the skill are ASCII
//   P1 llms.txt names the page inside the package and the repository before the site copy; the skill names the page and
//      the check command of section 2; section 8 names the skill folder
//   P2 package.json files and the public surface allowlist cover the page, the examples, llms.txt and skills/air
//   G10, G11, G12, P3, P4 (R5 erratum 2): both forms verify; memory types at an export; section 2's command lines; no fetch or install;
//      (P3 since R5 erratum 3: no install, fetch or package-runner command at all, and those verbs only in four fixed frames)
//      the skill's safety steps, and the installed-airc rule in the skill, section 2 and llms.txt
//   G9, P5 (P0-12's builder): every "AIR X.Y" on the page equals package.json's major.minor (A1); the compiler's own messages
//      name typed-v0.53 as SLICE.md section 3 gives them (A15: the help, the default-profile suffix, two repair hints, the
//      unsupported-profile message)
// G3 runs one child process per row, one at a time, from a temporary copy of the examples.
// Usage: node test/air_for_models.test.js [--rows G1,G2,G3,G4,G5,G6,G7,G8,G9,G10,G11,G12,P1,P2,P3,P4,P5]
const assert = require("node:assert");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const PAGE_PATH = path.join(ROOT, "docs", "v0.53", "AIR_FOR_MODELS.md");
const EXAMPLES = path.join(ROOT, "docs", "v0.53", "for-models", "examples");
const LLMS = path.join(ROOT, "llms.txt");
const SKILL = path.join(ROOT, "skills", "air", "SKILL.md");
const AIRC = path.join(ROOT, "bin", "airc.js");
const PROFILE = ["--source-profile", "typed-v0.53", "--allow-candidate-profile"];
const CODE = /\bair\.[a-z0-9_]+\.[a-z0-9_]+/g;

const args = process.argv.slice(2);
const ROWS = new Set((args.includes("--rows") ? args[args.indexOf("--rows") + 1] : "G1,G2,G3,G4,G5,G6,G7,G8,G9,G10,G11,G12,P1,P2,P3,P4,P5").split(","));

const read = (file) => fs.readFileSync(file, "utf8");
const page = read(PAGE_PATH);

const rows = [];
function row(id, fn) {
  if (!ROWS.has(id)) return;
  let out;
  try { out = fn(); } catch (error) { out = { pass: false, detail: `threw ${error && error.name}: ${String(error && error.message).slice(0, 300)}` }; }
  rows.push({ id, pass: Boolean(out.pass), detail: out.detail });
}

// The codes a text names: every `air.x.y` in backticks, and in a table row the shorthand `.z` after a full code,
// which means air.x.z for the family of the first full code in that row.
function namedCodes(text) {
  const codes = new Set();
  for (const line of text.split("\n")) {
    for (const match of line.matchAll(/`(air\.[a-z0-9_]+\.[a-z0-9_]+)`/g)) codes.add(match[1]);
    if (!line.startsWith("|")) continue;
    const family = line.match(/`(air\.[a-z0-9_]+)\.[a-z0-9_]+`/);
    if (!family) continue;
    for (const match of line.matchAll(/`\.([a-z0-9_]+)`/g)) codes.add(`${family[1]}.${match[1]}`);
  }
  return codes;
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out.sort();
}

// The code of src/ and bin/, without the repair-hint table: a hint keyed by a code is not a site that raises it.
function withoutRepairHints(file) {
  const text = read(file);
  if (path.basename(file) !== "diagnostics.js") return text;
  const hints = topLevelItems(text).find((item) => item.name === "REPAIR_HINTS_BY_CODE");
  assert(hints, "src/diagnostics.js: REPAIR_HINTS_BY_CODE not found");
  return text.replace(hints.text, "");
}
const sourceText = () => [AIRC, ...walk(path.join(ROOT, "src")).filter((file) => file.endsWith(".js"))].map(withoutRepairHints).join("\n");

// A section of the page: from its "## N." heading to the next "## ".
function section(number) {
  const start = page.indexOf(`\n## ${number}. `);
  assert(start >= 0, `section ${number} exists`);
  const end = page.indexOf("\n## ", start + 1);
  return page.slice(start, end < 0 ? page.length : end);
}

row("G1", () => {
  const source = sourceText();
  const types = read(path.join(ROOT, "src", "types.js"));
  const borrowed = read(path.join(ROOT, "src", "borrowed_slices.js"));
  const unknown = [...namedCodes(page)].filter((code) => {
    if (source.includes(code)) return false;
    const [, family, name] = code.match(/^(air\.[a-z0-9_]+)\.([a-z0-9_]+)$/);
    if (family === "air.refinement" && new RegExp(`refinementFail\\(\\s*"${name}"`).test(types)) return false;
    if (family === "air.borrow" && new RegExp(`borrowedFail\\(\\s*"${name}"`).test(borrowed)) return false;
    return true;
  });
  return { pass: unknown.length === 0 && namedCodes(page).size > 100, detail: { listed: namedCodes(page).size, unknown } };
});

// The typed-v0.53 compile path (airc verify|build|fmt|format|check with the typed-v0.53 profile, and migrate), by
// top-level item: whole files, items whose name matches `names`, and the named shared helpers in `items`.
const SWEEP = [
  { file: "bin/airc.js", all: true },
  { file: "src/source_profile.js", all: true },
  { file: "src/typed_closure.js", all: true },
  { file: "src/bounded_file.js", all: true },
  { file: "src/v052_toolchain_identity.js", all: true },
  { file: "src/parser.js", names: /V053|v053/, items: ["parseV051TypedType", "canonicalizeV051SourceType", "canonicalizeV051SourceTypeChecked", "matchV051TypeConstructor"] },
  { file: "src/verifier.js", names: /V053|v053/, items: ["verifyV051TypedType", "parseV051TypedMatchPattern", "verifyV051TypedAtom"] },
  { file: "src/types.js", items: ["parseRefinementType", "parseBound", "assertOrderedRange"], suffixes: { call: "refinementFail", family: "air.refinement" } },
  { file: "src/typed_interface.js", items: ["parseTypeReference", "assertTypeNesting"] },
  { file: "src/borrowed_slices.js", items: ["parseBorrowedSliceType"], suffixes: { call: "borrowedFail", family: "air.borrow" } },
  { file: "src/workbound.js", items: ["FAILURE_CODES", "IDENTITY_MISMATCH_CODE", "COST_UNDEFINED_CODE"] },
  { file: "src/analysis_capacity.js", items: ["ANALYSIS_CAPACITY_CODE"] },
  { file: "src/v052_verified_build.js", items: ["TYPED_CLI_BUILD_LIMIT_CHECKS"] },
  { file: "src/lower_wasm.js", items: ["V053EngineLimitError", "checkV053EngineLimits"] },
  { file: "src/v052_numeric_diagnostic.js", items: ["TYPED_V053_FAILURE_REASONS", "typedV053FailureIdentity"] },
  { file: "src/migrate_v053.js", items: ["CODE"] }
];
// Strings the code pattern matches that are not codes.
const NOT_CODES = new Map([
  ["air.package.json", "a file name (bin/airc.js)"],
  ["air.review.baseline", "from the file name air.review.baseline.json (bin/airc.js)"],
  ["air.v052.toolchain", "from the schema id air.v052.toolchainManifest/1 (src/v052_toolchain_identity.js)"]
]);

// Top-level items of a CommonJS file: a column-0 `function`, `async function`, `class`, `const` or `let`. A one-line
// statement is its own extent; any other item runs to its first column-0 line that starts with `}` or `]`.
function topLevelItems(text) {
  const lines = text.split("\n");
  const items = [];
  for (let index = 0; index < lines.length; index += 1) {
    const head = lines[index].match(/^(?:async\s+)?(?:function\s+([A-Za-z0-9_$]+)|class\s+([A-Za-z0-9_$]+)|(?:const|let)\s+([A-Za-z0-9_$]+)\s*=)/);
    if (!head) continue;
    let end = index;
    if (!/;\s*$/.test(lines[index])) {
      end = lines.length - 1;
      for (let next = index + 1; next < lines.length; next += 1) {
        if (/^[}\]]/.test(lines[next])) { end = next; break; }
      }
    }
    items.push({ name: head[1] || head[2] || head[3], text: lines.slice(index, end + 1).join("\n") });
  }
  return items;
}

function sweepCodes() {
  const codes = new Map();
  const add = (code, where) => { if (!codes.has(code)) codes.set(code, where); };
  for (const spec of SWEEP) {
    const text = read(path.join(ROOT, spec.file));
    const parts = spec.all ? [{ name: "(file)", text }]
      : topLevelItems(text).filter((item) => (spec.names && spec.names.test(item.name)) || (spec.items || []).includes(item.name));
    for (const name of spec.items || []) assert(parts.some((item) => item.name === name), `${spec.file}: item ${name} not found`);
    for (const part of parts) {
      for (const match of part.text.matchAll(CODE)) add(match[0], `${spec.file} ${part.name}`);
      if (spec.suffixes) {
        for (const match of part.text.matchAll(new RegExp(`${spec.suffixes.call}\\(\\s*"([a-z0-9_]+)"`, "g"))) add(`${spec.suffixes.family}.${match[1]}`, `${spec.file} ${part.name}`);
      }
    }
  }
  return codes;
}

row("G2", () => {
  const listed = namedCodes(page);
  const swept = sweepCodes();
  const missing = [...swept].filter(([code]) => !NOT_CODES.has(code) && !listed.has(code)).map(([code, where]) => `${code} (${where})`);
  return { pass: missing.length === 0 && swept.size > 100, detail: { swept: swept.size, missing } };
});

function readExpected() {
  return read(path.join(EXAMPLES, "EXPECTED.tsv")).split("\n").filter((line) => line.trim() && !line.startsWith("#"))
    .map((line) => {
      const [id, file, mode, exit, code, lineNumber] = line.split("\t");
      return { id, file, mode, exit: Number(exit), code, line: lineNumber };
    });
}

function commandFor(entry, outDir) {
  const base = [AIRC];
  switch (entry.mode) {
    case "build": return [...base, "build", entry.file, ...PROFILE, "--emit", "wasm", "-o", path.join(outDir, `${entry.id}.wasm`)];
    case "verify": return [...base, "verify", entry.file, ...PROFILE];
    case "cli-no-candidate-flag": return [...base, "verify", entry.file, "--source-profile", "typed-v0.53"];
    case "cli-equals-form": return [...base, "verify", entry.file, "--source-profile=typed-v0.53", "--allow-candidate-profile"];
    case "cli-explain": return [...base, "explain", entry.file, ...PROFILE];
    case "cli-check-lsp-json": return [...base, "check", entry.file, ...PROFILE, "--lsp-json"];
    case "cli-fmt": return [...base, "fmt", entry.file, ...PROFILE];
    default: throw new Error(`unknown mode ${entry.mode}`);
  }
}

function observed(entry, stdout, stderr) {
  if (entry.mode === "cli-check-lsp-json") {
    const first = (JSON.parse(stdout).diagnostics || [])[0];
    return first ? { code: first.code, line: first.line === null || first.line === undefined ? null : String(first.line) } : { code: null, line: null };
  }
  const text = `${stdout}${stderr}`;
  const code = text.match(/\bair\.[a-z0-9_]+\.[a-z0-9_]+/);
  const line = text.match(/^[^\n:]+\.air:([0-9]+): air\./m);
  return { code: code ? code[0] : null, line: line ? line[1] : null };
}

row("G3", () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "air-for-models-"));
  const failures = [];
  let count = 0;
  try {
    const copy = path.join(work, "examples");
    fs.cpSync(EXAMPLES, copy, { recursive: true });
    const outDir = path.join(work, "out");
    fs.mkdirSync(outDir);
    for (const entry of readExpected()) {
      count += 1;
      const run = childProcess.spawnSync(process.execPath, commandFor(entry, outDir), { cwd: copy, encoding: "utf8", timeout: 60000 });
      const seen = observed(entry, run.stdout || "", run.stderr || "");
      const ok = run.status === entry.exit && (entry.code === "-" ? seen.code === null : seen.code === entry.code) && (entry.line === "-" || seen.line === entry.line);
      if (ok && entry.mode === "build") assert(fs.statSync(path.join(outDir, `${entry.id}.wasm`)).size > 8, `${entry.id}: Wasm written`);
      if (!ok) failures.push({ id: entry.id, expected: [entry.exit, entry.code, entry.line], observed: [run.status, seen.code, seen.line] });
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  return { pass: failures.length === 0 && count > 40, detail: { rows: count, failures } };
});

row("G4", () => {
  const problems = [];
  let blocks = 0;
  for (const match of page.matchAll(/\*\*4\.\d+ [^*]+\*\* \(`([^`]+\.air)`([^)]*)\)/g)) {
    const fence = page.indexOf("```air\n", match.index);
    const body = page.slice(fence + "```air\n".length, page.indexOf("```", fence + 7));
    const file = read(path.join(EXAMPLES, match[1]));
    blocks += 1;
    if (body !== file && !(/shortened/.test(match[2]) && file.includes(body))) problems.push(`section 4 block of ${match[1]} differs from the file`);
  }
  const expected = new Map(readExpected().map((entry) => [entry.id, entry]));
  const mistakes = fs.readdirSync(path.join(EXAMPLES, "mistakes"));
  const pageRows = new Set();
  for (const line of section(5).split("\n")) {
    const id = line.match(/\((m\d\d)\)/);
    if (!id) continue;
    pageRows.add(id[1]);
    const files = mistakes.filter((name) => name.startsWith(`${id[1]}_`));
    if (files.length !== 1) problems.push(`${id[1]}: ${files.length} files`);
    const cell = line.split("|")[2] || "";
    const code = cell.match(/`(air\.[a-z0-9_.]+)`/);
    const entry = expected.get(id[1]);
    if (!entry || !code || code[1] !== entry.code || entry.file !== `mistakes/${files[0]}`) problems.push(`${id[1]}: page code ${code && code[1]} vs EXPECTED ${entry && entry.code}`);
  }
  for (const id of expected.keys()) if (/^m\d\d$/.test(id) && !pageRows.has(id)) problems.push(`${id}: no row in section 5`);
  return { pass: problems.length === 0 && blocks === 10 && pageRows.size === mistakes.length, detail: { blocks, mistakeRows: pageRows.size, problems } };
});

row("G5", () => {
  const { TYPED_V053_FAILURE_REASONS } = require(path.join(ROOT, "src", "v052_numeric_diagnostic.js"));
  const start = page.indexOf("Run-time failures.");
  const table = page.slice(start, page.indexOf("\n\n", page.indexOf("| Value |", start)));
  const fromPage = new Map();
  const problems = [];
  for (const line of table.split("\n").filter((text) => /^\| [0-9]/.test(text))) {
    const cells = line.split("|").map((cell) => cell.trim());
    const values = cells[1].split(" / ");
    if (values.includes("other")) continue;
    const codes = [...namedCodesInCell(cells[2])];
    if (codes.length !== 1 && codes.length !== values.length) { problems.push(`row '${cells[1]}': ${codes.length} codes for ${values.length} values`); continue; }
    values.forEach((value, index) => fromPage.set(Number(value), codes.length === 1 ? codes[0] : codes[index]));
  }
  const fromCode = new Map(Object.entries(TYPED_V053_FAILURE_REASONS).map(([value, entry]) => [Number(value), entry.code]));
  for (const [value, code] of fromCode) if (fromPage.get(value) !== code) problems.push(`${value}: page ${fromPage.get(value)}, registry ${code}`);
  for (const value of fromPage.keys()) if (!fromCode.has(value)) problems.push(`${value}: on the page, not in the registry`);
  const fallback = read(path.join(ROOT, "src", "v052_numeric_diagnostic.js"));
  for (const code of ["air.runtime.trap_unclassified", "air.runtime.failure_reason_unknown"]) {
    if (!table.includes(code) || !fallback.includes(code)) problems.push(`${code}: fall-back missing`);
  }
  return { pass: problems.length === 0 && fromPage.size === fromCode.size, detail: { values: fromPage.size, problems } };
});

// Codes in one table cell, in order, with the `.z` shorthand.
function namedCodesInCell(cell) {
  const out = [];
  let family = null;
  for (const match of cell.matchAll(/`(air\.[a-z0-9_]+\.[a-z0-9_]+|\.[a-z0-9_]+)`/g)) {
    if (match[1].startsWith(".")) { if (family) out.push(`${family}${match[1]}`); continue; }
    family = match[1].slice(0, match[1].lastIndexOf("."));
    out.push(match[1]);
  }
  return out;
}

row("G6", () => {
  const { VERIFIED_TYPED_RUNTIME_LIMITS: L } = require(path.join(ROOT, "src", "v052_verified_build.js"));
  const { TYPED_CLOSURE_LIMITS: C } = require(path.join(ROOT, "src", "typed_closure.js"));
  const { DEFAULT_ANALYSIS_CAPACITY: A } = require(path.join(ROOT, "src", "analysis_capacity.js"));
  const { BOUNDED_FILE_MAX_BYTES } = require(path.join(ROOT, "src", "bounded_file.js"));
  const { typedV053 } = require(path.join(ROOT, "src", "parser.js"));
  const constant = (file, pattern) => {
    const match = read(path.join(ROOT, file)).match(pattern);
    assert(match, `${file}: ${pattern} still matches`);
    return BigInt(match[1]);
  };
  const nesting = constant("src/parser.js", /const V053_TYPE_NESTING_LIMIT = ([0-9]+);/);
  const regionMax = constant("src/verifier.js", /const V053_REGION_MAX = ([0-9]+)n;/);
  const wbMax = constant("src/workbound.js", /const WB_MAX = ([0-9]+)n;/);
  const demandMax = constant("src/parser.js", /const V053_WB_MAX = ([0-9]+)n;/);
  const discriminantMax = constant("src/parser.js", /discriminant > ([0-9]+)\) \{/);
  const n = (value) => Number(value).toLocaleString("en-US");
  const kib = (bytes) => `${bytes / 1024} KiB`;
  const mib = (bytes) => `${Number(bytes) / 1048576} MiB`;
  const s7 = section(7).replace(/\s+/g, " ");
  const s6 = section(6).replace(/\s+/g, " ");
  const phrases = [
    [s7, `Source ${kib(L.maxSourceBytes)} per module`],
    [s7, `${n(L.maxAstNodes)} AST nodes`],
    [s7, `type nesting ${nesting}`],
    [s7, `at most ${n(typedV053.AGGREGATE_MAX)} elements`],
    [s7, `0..${discriminantMax}`],
    [s7, wbMax === (1n << 63n) - 1n && demandMax === wbMax ? "work and demand bounds at most 2^63-1" : `(work bound ${wbMax}, demand bound ${demandMax})`],
    [s7, `a region at most ${mib(regionMax)}`],
    [s7, L.maxWatBytes === L.maxWasmBytes ? `WAT and Wasm at most ${mib(L.maxWatBytes)} each` : "(WAT and Wasm limits differ)"],
    [s7, `a closure at most ${C.maxClosureModules} modules, ${mib(C.maxClosureSourceBytes)} and ${n(C.maxClosureAstNodes)} nodes`],
    [s6, `over ${kib(L.maxSourceBytes)} per module or ${mib(C.maxClosureSourceBytes)} per closure`],
    [s6, `over ${n(L.maxAstNodes)} nodes per module or ${n(C.maxClosureAstNodes)} per closure`],
    [s6, `over ${C.maxClosureModules} modules in the closure`],
    [s6, `output over ${mib(L.maxWatBytes)}`],
    [s6, `analysis units over ${n(A.maxAnalysisUnits)} or nesting over ${A.maxSyntaxNestingDepth}`],
    [s6, `over ${mib(BOUNDED_FILE_MAX_BYTES)}`],
    [s6, `size over ${mib(regionMax)}`]
  ];
  const missing = phrases.filter(([text, phrase]) => !text.includes(phrase)).map(([, phrase]) => phrase);
  return { pass: missing.length === 0, detail: { checked: phrases.length, missing } };
});

row("G7", () => {
  const { typedV053 } = require(path.join(ROOT, "src", "parser.js"));
  const listed = new Set();
  for (const line of section(3).split("\n")) {
    const family = line.match(/^- (i32|i64|f32): /);
    if (family) {
      for (const group of line.matchAll(/`([^`]+)`/g)) {
        const tokens = group[1].split(/\s+/);
        const prefix = (tokens[0].match(/^(checked_|wrapping_)/) || [""])[0];
        tokens.forEach((token, index) => listed.add(`${family[1]}.${index === 0 || !prefix ? token : prefix + token}`));
      }
    } else if (line.startsWith("- conversions: ")) {
      for (const group of line.matchAll(/`([^`]+)`/g)) listed.add(group[1]);
    } else if (line.startsWith("- `bool.")) {
      for (const token of line.match(/`([^`]+)`/)[1].split(/\s+/)) listed.add(token);
      for (const type of line.match(/\(T: ([a-z0-9 ]+)\)/)[1].split(" ")) listed.add(`select.${type}`);
    }
  }
  const operations = new Set(Object.keys(typedV053.OPERATIONS));
  const extra = [...listed].filter((op) => !operations.has(op));
  const missing = [...operations].filter((op) => !listed.has(op));
  const modeBlock = read(path.join(ROOT, "src", "verifier.js")).match(/const V053_MODE_REQUIRED = Object\.freeze\(\{([\s\S]*?)\}\);/);
  const modeless = ["i32.add", "i32.sub", "i32.mul", "i32.div_s", "i32.rem_s"].filter((op) => !modeBlock || !modeBlock[1].includes(`"${op}"`));
  return { pass: extra.length === 0 && missing.length === 0 && modeless.length === 0, detail: { listed: listed.size, operations: operations.size, extra, missing, modeless } };
});

row("G8", () => {
  const files = [PAGE_PATH, LLMS, SKILL, ...walk(EXAMPLES)];
  const offenders = files.filter((file) => [...fs.readFileSync(file)].some((byte) => byte > 127)).map((file) => path.relative(ROOT, file));
  return { pass: offenders.length === 0, detail: { files: files.length, offenders } };
});

// G9 (P0-12's builder, with A1): the page's version line. Every "AIR X.Y" on the page is package.json's major.minor.
row("G9", () => {
  const version = JSON.parse(read(path.join(ROOT, "package.json"))).version;
  const majorMinor = String(version).split(".").slice(0, 2).join(".");
  const named = [...page.matchAll(/\bAIR (\d+\.\d+)\b/g)].map((m) => m[1]);
  const other = named.filter((v) => v !== majorMinor);
  return { pass: named.length > 0 && other.length === 0, detail: { version, named: named.length, other } };
});

row("P1", () => {
  const problems = [];
  const llms = read(LLMS);
  const pagePath = "docs/v0.53/AIR_FOR_MODELS.md";
  const inPackage = llms.indexOf(`node_modules/@underskys/air-core/${pagePath}`);
  const site = llms.indexOf("https://air-core.dev/for-models/");
  if (inPackage < 0 || site < 0 || inPackage > site) problems.push("llms.txt: the package path must come before the site copy");
  if (!llms.includes("skills/air")) problems.push("llms.txt: no skills/air");
  const skill = read(SKILL);
  const front = skill.match(/^---\nname: ([a-z0-9-]+)\ndescription: (.+)\n---\n/);
  if (!front || front[1] !== "air" || front[2].length < 40) problems.push("SKILL.md: frontmatter name air and a description");
  if (!skill.includes(pagePath)) problems.push("SKILL.md: does not name the page");
  const check = section(2).match(/^airc check +FILE (.+)$/m);
  if (!check || !skill.includes(`airc check FILE ${check[1].trim()}`)) problems.push("SKILL.md: check command differs from section 2");
  if (!section(8).includes("node_modules/@underskys/air-core/skills/air")) problems.push("section 8: no copy command for skills/air");
  for (const file of [pagePath, "skills/air/SKILL.md", "docs/v0.53/for-models/examples/EXPECTED.tsv"]) {
    if (!fs.existsSync(path.join(ROOT, file))) problems.push(`${file}: missing`);
  }
  return { pass: problems.length === 0, detail: { problems } };
});

row("P2", () => {
  const manifest = JSON.parse(read(path.join(ROOT, "package.json")));
  const shipped = [PAGE_PATH, LLMS, SKILL, ...walk(EXAMPLES)].map((file) => path.relative(ROOT, file).split(path.sep).join("/"));
  const covered = (entry, file) => entry === file || (entry.endsWith("/") && file.startsWith(entry));
  // The private dev workspace has no files list and is not an npm publish source; check_public_package_surface.js skips it too.
  if (manifest.private === true && manifest.name === "airlang-dev-workspace") return { pass: true, detail: { skipped: "private dev workspace (no files list; the surface check skips it)", shipped: shipped.length } };
  const notInFiles = shipped.filter((file) => !manifest.files.some((entry) => covered(entry, file)));
  const surface = read(path.join(ROOT, "scripts", "check_public_package_surface.js"));
  const allowlist = ["\"docs/v0.53/AIR_FOR_MODELS.md\"", "\"llms.txt\"", "\"docs/v0.53/for-models/\"", "\"skills/air/\""].filter((entry) => !surface.includes(entry));
  return { pass: notInFiles.length === 0 && allowlist.length === 0, detail: { shipped: shipped.length, notInFiles, missingFromSurfaceAllowlist: allowlist } };
});

// R5 erratum 2 rows. G10: both forms verify (the canonical form `airc fmt` prints for each idiom file verifies too), and section 2 says so.
// G11: the memory types at an export behave as sections 3 and 6 say. G12: section 2's command lines run as written, and a typed file
// without the flags meets the legacy default. P3: the page, llms.txt and the skill never tell an agent to fetch or install a package.
// P4: the skill keeps its safety steps.
const airc = (cwd, args) => childProcess.spawnSync(process.execPath, [AIRC, ...args], { cwd, encoding: "utf8" });
const firstCode = (out) => ((out.stderr || "") + (out.stdout || "")).match(/\bair\.[a-z0-9_]+\.[a-z0-9_]+/)?.[0] || null;
const scratch = (fn) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "air-for-models-")); try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); } };
const flat = (text) => text.replace(/\s+/g, " ");

row("G10", () => scratch((dir) => {
  const problems = [];
  const idioms = fs.readdirSync(EXAMPLES).filter((name) => name.endsWith(".air")).sort();
  for (const name of idioms) {
    const out = airc(EXAMPLES, ["fmt", name, ...PROFILE]);
    if (out.status !== 0) problems.push(`${name}: fmt exit ${out.status}`);
    else fs.writeFileSync(path.join(dir, name), out.stdout);
  }
  for (const name of idioms.filter((file) => fs.existsSync(path.join(dir, file)))) {
    const out = airc(dir, ["verify", name, ...PROFILE]);
    if (out.status !== 0) problems.push(`${name}: its canonical form does not verify (${firstCode(out)})`);
  }
  if (!flat(section(2)).includes("Both forms verify.")) problems.push("section 2: the sentence on the canonical form is missing");
  return { pass: problems.length === 0, detail: { files: idioms.length, problems } };
}));

row("G11", () => scratch((dir) => {
  const problems = [];
  const cases = [
    ["ptr", "air.abi.export_type_unsupported", "air.abi.export_type_unsupported"],
    ["slice", "air.abi.export_type_unsupported", "air.abi.slice_return_unsupported"],
    ["buffer<i32,4>", "air.abi.export_type_unsupported", "air.abi.export_type_unsupported"],
    ["borrowed_slice<readonly,len<=16,align=4>", null, "air.borrow.escape_return"]
  ];
  cases.forEach(([type, asParameter, asResult], i) => {
    fs.writeFileSync(path.join(dir, `p${i}.air`), `module demo.mem\n\nexport func f(p: ${type}, x: i32) -> i32 {\n  return %x\n}\n`);
    fs.writeFileSync(path.join(dir, `r${i}.air`), `module demo.mem\n\nexport func f(x: i32) -> ${type} {\n  return %x\n}\n`);
    for (const [file, want] of [[`p${i}.air`, asParameter], [`r${i}.air`, asResult]]) {
      const out = airc(dir, ["verify", file, ...PROFILE]);
      const got = out.status === 0 ? null : firstCode(out);
      if (got !== want) problems.push(`${type} (${file[0] === "p" ? "parameter" : "result"}): ${got} where the page says ${want}`);
    }
  });
  if (!flat(section(3)).includes("an export takes only `borrowed_slice<...>` among them (the borrowed lane) and returns none")) problems.push("section 3: the export rule for memory types is missing");
  if (!flat(section(6)).includes("takes a `ptr`, `slice` or `buffer`; returns a `ptr` or `buffer`")) problems.push("section 6: the export_type_unsupported row does not name ptr, slice and buffer");
  return { pass: problems.length === 0, detail: { cases: cases.length * 2, problems } };
}));

const LEGACY = "module mig_lit\ncapabilities { }\n\nexport func f() -> i64 {\nentry:\n  %x:i64 = const.i64 9007199254740994\n  return %x\n}\n";
row("G12", () => scratch((dir) => {
  const problems = [];
  fs.copyFileSync(path.join(EXAMPLES, "04_refinement.air"), path.join(dir, "f.air"));
  fs.writeFileSync(path.join(dir, "legacy.air"), LEGACY);
  const block = section(2).match(/```sh\n([\s\S]*?)```/);
  const lines = block ? block[1].trim().split("\n") : [];
  if (lines.length < 7) problems.push(`section 2: ${lines.length} command lines`);
  const values = { FILE: "f.air", LEGACY_FILE: "legacy.air", "OUT.air": "out.air", "RECORD.json": "record.json", ID: "demo.migrated" };
  for (const line of lines) {
    const words = line.trim().split(/\s+/);
    if (words[0] !== "airc") { problems.push(`not an airc line: ${line}`); continue; }
    const bare = words.slice(1).filter((word) => !/^\[|\]$/.test(word));
    const full = words.slice(1).map((word) => word.replace(/^\[|\]$/g, ""));
    for (const args of bare.length === full.length ? [bare] : [bare, full]) {
      const out = airc(dir, args.map((word) => values[word] || word));
      if (out.status !== 0) problems.push(`'${args.join(" ")}' exit ${out.status} (${firstCode(out)})`);
    }
  }
  const plain = airc(dir, ["verify", "f.air"]);
  if (plain.status === 0 || !(plain.stderr + plain.stdout).includes("default profile: legacy-v0.50")) problems.push("a typed file without the flags did not meet the legacy-v0.50 default");
  if (!flat(section(1)).includes("legacy-v0.50 is still the CLI default")) problems.push("section 1: the default-profile sentence is missing");
  return { pass: problems.length === 0, detail: { lines: lines.length, problems } };
}));

row("P3", () => {
  // R5 erratum 3: no install, fetch or package-runner command appears in the page, llms.txt or the skill, not even as the user's to run; the
  // user's step is named in words ("ask the user to install ..."). npm appears only as a noun ("npm package", "npm registry") or in
  // `npm root -g`, which finds the global folder. The verbs install, fetch, clone and download appear only in the four frames below.
  const RUNNER = /\bnpm\s+(?!(?:root|package|registry)\b)[a-z]|\b(?:npx|pnpx|bunx|pnpm|yarn|bun|brew|pip3?|pipx|curl|wget|apt-get|apt|cargo|gem)\b|\bgo\s+(?:get|install)\b|\bgit\s+[a-z]|@(?:latest|next|canary)\b/gi;
  const VERB = /\b(?:re)?install(?:s|ing)?\b|\bfetch(?:es|ing)?\b|\bclon(?:e|es|ing)\b|\bdownload(?:s|ing|ed)?\b/gi;
  const FRAMES = [/\b(?:project|global) install\b/gi, /\bask (?:the user|them) to (?:re)?install\b/gi, /\bnever fetch or run a tool by a package name\b/gi, /\bit can install and run a different package\b/gi];
  const hits = [];
  for (const file of [PAGE_PATH, LLMS, SKILL]) {
    const text = flat(read(file));
    const name = path.relative(ROOT, file);
    const near = (i) => text.slice(Math.max(0, i - 40), i + 50);
    for (const m of text.matchAll(RUNNER)) hits.push(`${name}: a command: ${near(m.index)}`);
    const frames = FRAMES.flatMap((f) => [...text.matchAll(f)].map((m) => [m.index, m.index + m[0].length]));
    for (const m of text.matchAll(VERB)) if (!frames.some(([a, b]) => m.index >= a && m.index < b)) hits.push(`${name}: "${m[0]}" outside the allowed frames: ${near(m.index)}`);
  }
  return { pass: hits.length === 0, detail: { hits } };
});

row("P4", () => {
  const skill = flat(read(SKILL)).toLowerCase();
  const steps = ["never fetch or run a tool by a package name", "stop: tell the user the code is unchecked", "never invent a host import", "it is not permission to run anything", "after three failed rounds, stop"];
  const missing = steps.filter((step) => !skill.includes(step));
  const rule = "never fetch or run a tool by a package name";
  if (!flat(section(2)).toLowerCase().includes(rule)) missing.push(`page section 2: ${rule}`);
  if (!flat(read(LLMS)).toLowerCase().includes(rule)) missing.push(`llms.txt: ${rule}`);
  return { pass: missing.length === 0, detail: { steps: steps.length + 2, missing } };
});

// P5 (P0-12's builder, A15 under OD-P12-11 (c)): the compiler's own messages, as SLICE.md section 3 gives them. M1 the help names
// typed-v0.53 and --allow-candidate-profile; M2 the default-profile suffix names typed-v0.53; M3 and M4 neither repair hint says
// "later slices", the recursion hint offers typed-v0.53 loop.fold alone, and the unknown-function hint offers the extern only in a call
// (not a loop.fold callback); M5 the unsupported-profile message names typed-v0.53 (the kill switch is off in every committed state).
row("P5", () => scratch((dir) => {
  const problems = [];
  const help = airc(dir, ["--help"]);
  const helpText = flat(`${help.stdout}${help.stderr}`);
  if (!helpText.includes("--source-profile legacy-v0.50|typed-v0.51|typed-v0.53")) problems.push("M1: the help does not list typed-v0.53");
  if (!helpText.includes("typed-v0.53 is a candidate profile and also needs --allow-candidate-profile")) problems.push("M1: the help does not name --allow-candidate-profile");
  fs.copyFileSync(path.join(EXAMPLES, "04_refinement.air"), path.join(dir, "f.air"));
  const plain = airc(dir, ["verify", "f.air"]);
  if (plain.status === 0 || !flat(`${plain.stderr}${plain.stdout}`).includes("typed sources require --source-profile typed-v0.51, or --source-profile typed-v0.53 with --allow-candidate-profile")) problems.push("M2: the default-profile suffix does not name typed-v0.53");
  const { repairHintForDiagnosticCode } = require(path.join(ROOT, "src", "diagnostics.js"));
  const recursion = String(repairHintForDiagnosticCode("air.call.recursion_rejected"));
  const unknown = String(repairHintForDiagnosticCode("air.call.unknown_function"));
  for (const [id, hint] of [["M3", recursion], ["M4", unknown]]) if (/later slices/.test(hint)) problems.push(`${id}: the hint says "later slices"`);
  const typedLoops = (recursion.match(/typed-v0\.53: ([^;)]*)/) || [])[1];
  if (typedLoops !== "loop.fold") problems.push(`M3: the recursion hint offers typed-v0.53 ${JSON.stringify(typedLoops)}`);
  if (!unknown.includes("in typed-v0.53 also an imported export (call @alias.name)")) problems.push("M4: the hint does not offer an imported export");
  if (!unknown.includes("in a call (not a loop.fold callback) a declared extern (call @family.name)")) problems.push("M4: the hint offers the extern beyond a call");
  const { normalizeSourceProfile } = require(path.join(ROOT, "src", "source_profile.js"));
  let message = "";
  try { normalizeSourceProfile("typed-v0.52"); } catch (error) { message = String(error && error.message); }
  if (!message.includes("expected legacy-v0.50 or typed-v0.51, or typed-v0.53 with allowCandidateProfile: true (CLI --allow-candidate-profile)")) problems.push("M5: the unsupported-profile message does not name typed-v0.53");
  return { pass: problems.length === 0, detail: { problems } };
}));

for (const r of rows) process.stdout.write(`${r.pass ? "PASS" : "FAIL"} ${r.id} ${JSON.stringify(r.detail).slice(0, r.pass ? 160 : 1200)}\n`);
const failed = rows.filter((r) => !r.pass).length;
process.stdout.write(`AIR for models: ${rows.length - failed}/${rows.length} PASS\n`);
process.exitCode = failed === 0 ? 0 : 1;
