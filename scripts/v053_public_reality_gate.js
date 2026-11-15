#!/usr/bin/env node
"use strict";
// P0-12: the installed-public-package gate (slice text R5 with errata 1-6, section 4; COVERAGE.md section 1). Evidence tooling only: it
// neither installs nor publishes. It reads the tarball CI packed, the consumer project that tarball was installed into, and the candidate
// commit's tree with its dependencies (npm ci), and runs every row of section 4 that needs the installed package:
//   P12-INV-01   the tarball: sha256, SRI, inventory (path, size, mode, mtime); modes 644 but bin/airc.js 755; one mtime; the names are
//                exactly the files list's expansion (npm pack --dry-run of the tree)
//   P12-REPRO-01 a second pack of the tree: the same sha256; a different sha256 with the same unpacked names, bytes and modes is RECORDED
//   P12-INV-02   no file outside that set, no fixtures/v053, no test seam in src/ (F1-N04), the CT-1 JSON present, the installed root loads (F7)
//   P12-ID-01    the installed `airc version --json`, package.json, the consumer lock and verification evidence's compilerVersion
//   P12-PIN-01   the consumer lock's wabt (version and integrity as the tree's lock); the installed implementationDigest equals the tree's
//   P12-A14-01   A14's page, llms.txt, skill and 41 examples installed, readable and byte-equal to the tree's
//   V53-PUB-02   the package docs, exactly the inventory section 4 lists (E5): the shipped RFC, the 12 typed docs, A14's page,
//                VERSIONING.md and the 0.53.0 release notes, each installed and byte-equal to the tree's, no other typed doc; and
//                docs/v0.52/, docs/v0.51/ and docs/VERSION_AND_ABI_POLICY.md not installed
//   P12-RFC-01   (E4) the installed docs/v0.53/RFC_TYPED_V053.md through rfcRow(): 1975 lines, the notice, the body digest, no
//                absolute local path (the in-tree test runs the same function on the tree's copy)
//   V53-PUB-05   VERSIONING.md documents the source-profile axis (RFC section 2.1) and the correction-record rule (section 2.5)
//   V53-ABI-54   the release notes state ABI proposal R2 section 10's statements 1-8 (OPEN-ABI-6 H2), never call the handshake
//                authentication, and call no legacy, old-host or downgrade case "protected"
//   P12-DOC-01   every shipped doc listed; check:public-claims' patterns pass over each; the release notes hold section 5's items
//   F1-GATE      F-1's scripts/v053_installed_surface_gate.js, run as it stands (F1-P01..P07, N01..N04, R01)
//   I1..I4       SEC53-02's installed rows, on the real install
//   QI1..QI5, QB1..QB4, QC1..QC2   the fixes' installed rows (OD-P12-10 (d)), from QA's own tools, run from the repository tree
//   P12-S9-01    SEC53-09 through the installed CLI: C-N2 after `airc build`, and B-N1 (OD-P12-10 (d), erratum 3)
//   V53-NEG-CORPUS-01  the typed hallucination corpus on the installed SDK and CLI: each rejected with a stable registered code
//   V53-PUB-03   every installed typed-v0.53 entrypoint applies M2's intake and emission limits (the V53-WB-H10 shape)
//   V53-PUB-01, P12-DIFF-01, V53-ASSUR-01..08, P12-A14-02   V53-PUB-01's set run in a scratch root that holds the installed src/, bin/,
//                stdlib/, data/ and package.json by hash, and is a git repository reading the repository's objects (gitRoot below), and in
//                the tree (OD-P12-12 (a)); one outcome per vector in each; the diff
//                must be empty but for the vectors COVERAGE.md section 1's exclusion rule leaves out, each printed with its reason
// Rows that need the repository's git history or a stubbed npm (P12-R03, P12-LIN-01) and P12-MB6-01 are in-tree tests.
// Usage: node scripts/v053_public_reality_gate.js --project DIR --repo DIR --tarball FILE --out DIR [--rows ID,ID,...] [--no-set]
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { createRequire } = require("node:module");

const PKG = "@underskys/air-core";
const RFC_TEXT = "docs/v0.53/RFC_TYPED_V053.md";
// V53-PUB-02's inventory (slice text R5 erratum 5, section 4), as file paths: exactly what A8 ships under OD-P12-4 (a).
const TYPED_DOCS = ["CT1_RD3_CLARIFICATION.md", "MIGRATION.md", "P0_02_WORKBOUND_FOUNDATION.md", "P0_03_REFINEMENTS.md", "P0_04_CALLS_CFG.md",
  "P0_05_LOOPS.md", "P0_06_AGGREGATES.md", "P0_07_STATE.md", "P0_09_IMPORTS.md", "P0_10_EFFECT_DEMAND.md", "SCALAR.md", "TYPED_MEMORY.md"];
const DOC_INVENTORY = [RFC_TEXT, ...TYPED_DOCS.map((name) => `docs/v0.53/${name}`), "docs/v0.53/AIR_FOR_MODELS.md", "VERSIONING.md", "docs/RELEASE_NOTES_0_53_0.md"];
const NOT_SHIPPED = ["docs/v0.52/", "docs/v0.51/", "docs/VERSION_AND_ABI_POLICY.md"];
const TYPED = ["--source-profile", "typed-v0.53", "--allow-candidate-profile"];
const GATED = Object.freeze({ allowCandidateProfile: true, sourceProfile: "typed-v0.53" });
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const flat = (text) => String(text).replace(/\s+/g, " ");

// ---------------------------------------------------------------------------------------------------------------------------------
// Small readers, exported for the in-tree test.

// A tar archive (ustar, with pax 'x'/'g' and GNU 'L' long-name records) as entries {path, size, mode, mtime, type, data}.
function readTar(buffer) {
  const entries = [];
  let at = 0; let pending = null;
  const field = (block, start, length) => block.subarray(start, start + length).toString("utf8").replace(/\0.*$/s, "");
  const octal = (block, start, length) => parseInt(field(block, start, length).trim() || "0", 8);
  while (at + 512 <= buffer.length) {
    const block = buffer.subarray(at, at + 512);
    if (block.every((byte) => byte === 0)) break;
    const size = octal(block, 124, 12);
    const type = String.fromCharCode(block[156] || 48);
    const data = buffer.subarray(at + 512, at + 512 + size);
    at += 512 + Math.ceil(size / 512) * 512;
    if (type === "x" || type === "g") {
      const text = data.toString("utf8"); const record = {};
      for (let i = 0; i < text.length;) {
        const space = text.indexOf(" ", i); const length = parseInt(text.slice(i, space), 10);
        const line = text.slice(space + 1, i + length - 1); const eq = line.indexOf("=");
        record[line.slice(0, eq)] = line.slice(eq + 1); i += length;
      }
      if (type === "x") pending = { ...(pending || {}), ...record };
      continue;
    }
    if (type === "L") { pending = { ...(pending || {}), path: data.toString("utf8").replace(/\0.*$/s, "") }; continue; }
    const prefix = field(block, 345, 155); const name = field(block, 0, 100);
    entries.push({
      path: (pending && pending.path) || (prefix ? `${prefix}/${name}` : name),
      size, mode: octal(block, 100, 8) & 0o7777, mtime: octal(block, 136, 12), type, data
    });
    pending = null;
  }
  return entries;
}

function tarballFacts(file) {
  const bytes = fs.readFileSync(file);
  const entries = readTar(zlib.gunzipSync(bytes)).filter((entry) => entry.type === "0" || entry.type === "\0");
  return {
    sha256: sha256(bytes),
    integrity: `sha512-${crypto.createHash("sha512").update(bytes).digest("base64")}`,
    bytes: bytes.length,
    entries: entries.map((entry) => ({ path: entry.path.replace(/^package\//, ""), size: entry.size, mode: entry.mode.toString(8), mtime: entry.mtime, sha256: sha256(entry.data) }))
  };
}

// Every .md and .txt path the patterns of scripts/check_public_claims.js read, and the patterns themselves, from that script's text.
function claimsPatterns(repo) {
  const text = fs.readFileSync(path.join(repo, "scripts", "check_public_claims.js"), "utf8");
  const start = text.indexOf("const banned = [");
  const end = text.indexOf("];", start);
  const body = text.slice(start + "const banned = ".length, end + 1);
  return Function(`"use strict"; return ${body};`)();
}

function claimHits(text, patterns) {
  const hits = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (line.includes("public-claims-allow")) return;
    for (const pattern of patterns) if (pattern.test(line)) hits.push(`${index + 1}: ${pattern}`);
  });
  return hits;
}

// ABI proposal R2 (AIR_V053_ABI_HOST_COMPAT_DECISION_PROPOSAL_R2_2026_10_20, PROPOSAL.md section 10), statements 1-8, with OPEN-ABI-6's H2
// branch and P0-08's values (lane 0.13; the contract import "air:contract" "typed-v0.53.v1"). The release notes carry them verbatim.
const ABI_STATEMENTS = [
  "`typed-v0.53` is a new opt-in canonical source profile. The default remains `legacy-v0.50`.",
  "typed-v0.53 artifacts with borrowed (memory-view) exports use a new AIR ABI lane `0.13` and require the AIR contract import `air:contract/typed-v0.53.v1`.",
  "Host ABI capability lanes 0.10/0.11 are unchanged; the host execution interface changed and is versioned by the host-adapter contract `typed-v0.53.v1`.",
  "AIR ABI 0.12 remains a candidate.",
  "Hosts older than 0.53 cannot instantiate these artifacts; the engine refuses (no AIR diagnostic is possible on shipped hosts), in every binding mode, copied mode included.",
  "Hosts that call exports directly must use the 0.53 admission helper with a trusted record (in-process) or a digest they pin from a channel they trust. The contract handshake is not authentication. The artifact rejects borrowed ranges that overlap its own memory on every host. Digest pinning, external mutation and reentrancy remain host duties.",
  "typed-v0.53 protection requires the typed admission API with a trusted record. The legacy API offers legacy guarantees for any bytes, including stripped or relabelled typed-v0.53 bytes.",
  "Legacy (0.50-0.52.1) artifacts behave as documented for 0.52.1, including the disclosed unpinned-range residual (OPEN-42 legacy cell).",
  "The 0.53 realtime session refuses typed-v0.53 packages with `air.assurance.profile_unsupported`; a typed realtime session is planned for 0.54.",
  "Migration: rebuild from typed-v0.53 source with the 0.53 compiler and run with the 0.53 adapter. Rollback: disable the profile; legacy artifacts are unaffected."
];

function abiStatementCheck(text) {
  const body = flat(text);
  const missing = ABI_STATEMENTS.filter((statement) => !body.includes(statement));
  const authentication = (body.match(/[^.]*\bauthenticat[a-z]*[^.]*\./gi) || []).filter((sentence) => sentence.trim() !== "The contract handshake is not authentication.");
  const lines = text.split(/\r?\n/).filter((line) => /\bprotected\b/i.test(line) && /\b(legacy|old(er)? host|downgrade)/i.test(line));
  return { missing, authentication, protectedLegacy: lines };
}

// RFC section 2.1 (the source-profile axis) and section 2.5 (correction records) as VERSIONING.md states them.
const VERSIONING_PHRASES = [
  "source profile id", "separate version axis", "the grammar", "the accepted and rejected program sets", "the canonical formatter output",
  "every stable diagnostic code and its meaning", "the observable runtime behaviour of accepted programs", "the WorkBound cost table version",
  "correction record", "FAIL_CLOSED_NARROWING", "IDENTITY_REFINEMENT", "NORMATIVE_DEFECT_REPAIR", "No class may make a previously rejected program accepted"
];

// SLICE.md section 5: the release notes' items, by a phrase each (the notes are written to hold them; the row checks they stay).
const RELEASE_NOTE_ITEMS = [
  ["never published", "0.52.0 and 0.52.1 were never published"],
  ["last published", "0.51.0 is the last published"],
  ["HD-5 M1 line", "M1 legacy certificate retained only where sound/defined; unsupported cases no longer produce VERIFIED and cannot authorize admission"],
  ["candidate status", "--allow-candidate-profile"],
  ["ABI unchanged", "AIR ABI and Host ABI do not move"],
  ["F-1 exports map", "exports"],
  ["SEC53-09 operator line", "check the diagnostics"],
  ["message-prefix codes", "air.benchmark.argument_invalid"],
  ["R-5 corrected", "SEC53-08"],
  ["F7", "ENOENT"],
  ["engines", ">=22"],
  ["SEC53-06B linear bound", "The linear bound holds for the 70 sites as they call the matcher, not for any pattern: under split or a global replace, a pattern whose earlier branch outlives its match (for example /a.*b|a/g) is quadratic."],
  ["invokeRaw", "The typed admission's `invokeRaw(entrypoint, lanes)` passes lanes as JavaScript converts them for Wasm (ToInt32 for an i32 lane); give each lane in the signed i32 range. Typed `invoke` refuses an out-of-range argument."],
  ["benchmark warning", "The runtime benchmark reports a refused argument as the warning `air.benchmark.runtime_unavailable` with status `pass`: read the diagnostics, not only the status."],
  ["linked exports", "A linked package's packageExports can name a module-private function, and a linked export can take a ptr or a plain slice parameter as one raw i32 lane."],
  ["scanner non-proofs", "N1-N10"],
  ["root names", "hostAuthority"],
  ["A14 files", "llms.txt"],
  ["tag and package", "@underskys/air-core@0.53.0"]
];

// The typed hallucination corpus (RFC VECTORS.md V53-NEG-CORPUS-01: loop.while, for, use std.gfx3d, host object handles, native_*
// externs, string print, remote file externs), each a typed-v0.53 module. The expectation is the vector's own: each is rejected
// with a stable registered code (a code the shipped typed docs name; the same at every entrypoint and in the dev tree).
const NEG_CORPUS = [
  ["loop.while", "module neg.loop_while\n\nexport func f(n: i32<0..10>) -> i32 {\n  %i: i32 = 0\n  loop.while %n {\n    %i: i32 = i32.checked_add %i, 1\n  }\n  return %i\n}\n"],
  ["for", "module neg.for_loop\n\nexport func f(n: i32<0..10>) -> i32 {\n  for %i in 0..%n {\n    return %i\n  }\n  return 0\n}\n"],
  ["use std.gfx3d", "module neg.gfx3d\n\nuse std.gfx3d\n\nexport func f() -> i32 {\n  return 0\n}\n"],
  ["host object handle", "module neg.handle\ncapabilities { output }\n\nextern window.open(title: i32) -> handle\n\nexport func f() -> i32 {\n  return 0\n}\n"],
  ["native_* extern", "module neg.native\ncapabilities { output }\n\nextern native_camera.capture(frame: i32) -> i32\n\nexport func f() -> i32 {\n  %r: i32 = call @native_camera.capture(1)\n  return %r\n}\n"],
  ["string print", "module neg.print\n\nexport func f() -> i32 {\n  print \"hello\"\n  return 0\n}\n"],
  ["remote file extern", "module neg.remote\ncapabilities { output }\n\nextern fs.read_url(url: i32) -> i32\n\nexport func f() -> i32 {\n  %r: i32 = call @fs.read_url(1)\n  return %r\n}\n"]
];

// The codes the shipped typed docs name (docs/v0.53/*.md and A14's page): the registry a corpus code must be in.
function registeredCodes(root) {
  const dir = path.join(root, "docs", "v0.53");
  const codes = new Set();
  if (!fs.existsSync(dir)) return codes;
  for (const name of fs.readdirSync(dir).filter((file) => file.endsWith(".md"))) {
    for (const code of fs.readFileSync(path.join(dir, name), "utf8").match(/\bair\.[a-z0-9_]+\.[a-z0-9_]+/g) || []) codes.add(code);
  }
  return codes;
}

// One corpus source through an SDK root (parse and verify at typed-v0.53) and through an airc (check, typed flags).
function negCorpusOutcomes(sdk, aircCommand, scratch) {
  const out = [];
  for (const [label, source] of NEG_CORPUS) {
    let sdkCode = null; let accepted = false;
    try { const ast = sdk.parseSource(source, "neg.air", GATED); sdk.verifySource(ast, GATED); accepted = true; } catch (error) { sdkCode = (error && error.code) || null; }
    const file = path.join(scratch, `neg_${out.length}.air`);
    fs.writeFileSync(file, source);
    const cli = childProcess.spawnSync(aircCommand[0], [...aircCommand.slice(1), "check", file, ...TYPED], { encoding: "utf8", cwd: scratch });
    const cliCode = ((cli.stderr || "") + (cli.stdout || "")).match(/\bair\.[a-z0-9_]+\.[a-z0-9_]+/)?.[0] || null;
    out.push({ label, accepted, sdkCode, cliExit: cli.status, cliCode });
  }
  return out;
}

// P12-RFC-01 (slice text R5 erratum 4, section 2): tools/e4_rfc_row.js of that text, its constants and rfcRow() as they stand.
const ACCEPTED_SHA256 = "8beba738f1f120329ec6520d078207afbb7ddaeedf8ce1b0291939a198a75d65";
const BODY_SHA256 = "b79b1f1971f216b9a0a41b84814bbc0e278aaf236403eeae99bbcdca6e29590f";
const NOTICE = `> Shipped copy: this file is the accepted RFC text (sha256 ${ACCEPTED_SHA256}) with exactly two changes: lines 13 to 15 name their evidence folders without the local path that preceded them, and this line is added.`;
const SLASH = "/";
const LOCAL_PATH = new RegExp(`(${SLASH}Users${SLASH}|${SLASH}home${SLASH}[^${SLASH}\\s]+${SLASH}|~${SLASH}|[A-Za-z]:\\\\Users\\\\)`);

function rfcRow(buf) {
  const problems = [];
  if (buf[buf.length - 1] !== 0x0a) problems.push("R1 the file does not end with a newline");
  const lines = buf.subarray(0, buf.length - 1).toString("latin1").split("\n");
  if (lines.length !== 1975) problems.push(`R1 ${lines.length} lines, not 1975`);
  const last = buf.subarray(0, buf.length - 1).lastIndexOf(0x0a);
  const notice = buf.subarray(last + 1, buf.length - 1).toString("latin1");
  if (notice !== NOTICE) problems.push("R2 the last line is not the notice");
  const body = buf.subarray(0, last + 1);
  const digest = crypto.createHash("sha256").update(body).digest("hex");
  if (digest !== BODY_SHA256) problems.push(`R3 lines 1-${lines.length - 1} hash to ${digest.slice(0, 16)}..., not the accepted text with the three paths cut`);
  lines.forEach((line, i) => { if (LOCAL_PATH.test(line)) problems.push(`R4 line ${i + 1} holds an absolute local path`); });
  return { pass: problems.length === 0, problems };
}

// Erratum 6 (COVERAGE.md section 1): the set's scratch root is a git repository that reads the repository's own objects, so a test that
// reads another commit's objects (cat-file, archive, show, ls-tree, rev-parse, grep on a commit) finds them there as it does in the tree.
// git init in the root; the root's objects/info/alternates names the object store `git rev-parse --git-common-dir` gives for the repository;
// HEAD is the repository's HEAD commit; `git read-tree HEAD` fills the root's index only. The working files are not touched. Every write
// goes to the root's own .git, and git's redirect variables are dropped so that none can point a write elsewhere. A shallow repository is
// refused: the set reads commits of its history, and with a shallow clone two of its files would report the missing history as
// ENVIRONMENT_UNAVAILABLE in both halves alike instead of failing.
const GIT_REDIRECTS = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_COMMON_DIR"];
function gitRoot(root, repo) {
  const env = { ...process.env }; for (const name of GIT_REDIRECTS) delete env[name];
  const git = (args, cwd) => childProcess.spawnSync("git", args, { cwd, env, encoding: "utf8" });
  const shallow = git(["rev-parse", "--is-shallow-repository"], repo);
  if (shallow.status !== 0) return { ok: false, reason: `the repository is not a git repository: ${(shallow.stderr || "").trim().slice(0, 200)}` };
  if (shallow.stdout.trim() !== "false") return { ok: false, reason: "the repository is a shallow clone: the set reads older commits through git and needs the full history (GIT_DEPTH 0)" };
  const common = git(["rev-parse", "--git-common-dir"], repo);
  const head = git(["rev-parse", "--verify", "HEAD^{commit}"], repo);
  if (common.status !== 0 || head.status !== 0) return { ok: false, reason: "the repository's object store or HEAD commit cannot be read" };
  const objects = path.join(path.resolve(repo, common.stdout.trim()), "objects");
  const commit = head.stdout.trim();
  if (git(["init", "-q", root], repo).status !== 0) return { ok: false, reason: "git init in the root failed" };
  fs.writeFileSync(path.join(root, ".git", "objects", "info", "alternates"), `${objects}\n`);
  for (const args of [["update-ref", "HEAD", commit], ["read-tree", "HEAD"], ["cat-file", "-e", `${commit}^{commit}`]]) {
    const out = git(args, root);
    if (out.status !== 0) return { ok: false, reason: `git ${args.join(" ")} in the root failed: ${(out.stderr || "").trim().slice(0, 200)}` };
  }
  return { ok: true, commit };
}

module.exports = { readTar, tarballFacts, claimsPatterns, claimHits, ABI_STATEMENTS, abiStatementCheck, VERSIONING_PHRASES, RELEASE_NOTE_ITEMS, NEG_CORPUS, registeredCodes, negCorpusOutcomes,
  rfcRow, ACCEPTED_SHA256, BODY_SHA256, NOTICE, RFC_TEXT, DOC_INVENTORY, NOT_SHIPPED, gitRoot };
if (require.main !== module) return;

// ---------------------------------------------------------------------------------------------------------------------------------
// The gate.

const FLAGS = ["project", "repo", "tarball", "out", "rows"];
const argv = process.argv.slice(2);
const opts = { set: true };
for (let i = 0; i < argv.length; i++) {
  const key = argv[i].replace(/^--/, "");
  if (key === "no-set") { opts.set = false; continue; }
  if (!FLAGS.includes(key) || typeof argv[i + 1] !== "string") { process.stderr.write(`usage: --project DIR --repo DIR --tarball FILE --out DIR [--rows ID,...] [--no-set]\n`); process.exit(2); }
  opts[key] = argv[++i];
}
for (const key of ["project", "repo", "tarball", "out"]) if (!opts[key]) { process.stderr.write(`missing --${key}\n`); process.exit(2); }
const PROJECT = fs.realpathSync(path.resolve(opts.project));
const REPO = fs.realpathSync(path.resolve(opts.repo));
const TARBALL = path.resolve(opts.tarball);
const OUT = path.resolve(opts.out);
fs.mkdirSync(OUT, { recursive: true });
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), "air-p012-gate-"));
const ONLY = opts.rows ? new Set(opts.rows.split(",")) : null;
const req = createRequire(path.join(PROJECT, "package.json"));
const INSTALLED = path.join(PROJECT, "node_modules", "@underskys", "air-core");
const AIRC = path.join(PROJECT, "node_modules", ".bin", "airc");
const repoPackage = JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8"));
const results = [];
const facts = {};

function record(id, status, detail) {
  results.push({ id, status, detail });
  process.stdout.write(`${status} ${id} ${JSON.stringify(detail).slice(0, status === "PASS" ? 400 : 3000)}\n`);
}
async function row(id, fn) {
  if (ONLY && !ONLY.has(id)) return;
  const started = Date.now();
  try {
    const out = await fn();
    const status = out.status || (out.pass ? "PASS" : "FAIL");
    record(id, status, { ...(out.detail || {}), ms: Date.now() - started });
  } catch (error) {
    record(id, "FAIL", { threw: `${error && error.name}: ${String(error && error.message).slice(0, 600)}`, ms: Date.now() - started });
  }
}
const run = (command, args, options = {}) => childProcess.spawnSync(command, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, ...options });
const installedAirc = (args, cwd = PROJECT) => run(AIRC, args, { cwd });
const repoAirc = (args, cwd = REPO) => run(process.execPath, [path.join(REPO, "bin", "airc.js"), ...args], { cwd });
const firstCode = (out) => ((out.stderr || "") + (out.stdout || "")).match(/\bair\.[a-z0-9_]+\.[a-z0-9_]+/)?.[0] || null;

function treeFiles(root, rel = "") {
  const out = [];
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) return out;
  if (fs.statSync(full).isFile()) return [rel];
  for (const name of fs.readdirSync(full).sort()) out.push(...treeFiles(root, rel ? `${rel}/${name}` : name));
  return out;
}
function treeHash(root, parts) {
  const hash = crypto.createHash("sha256");
  for (const part of parts) for (const rel of treeFiles(root, part)) hash.update(`${rel}\0${sha256(fs.readFileSync(path.join(root, rel)))}\n`);
  return hash.digest("hex");
}

(async () => {
  process.stdout.write(`# P0-12 public reality gate: ${PKG}@${repoPackage.version}; node ${process.version}; tarball ${path.basename(TARBALL)}\n`);
  const tar = tarballFacts(TARBALL);
  facts.tarball = { sha256: tar.sha256, integrity: tar.integrity, bytes: tar.bytes, entries: tar.entries.length };
  fs.writeFileSync(path.join(OUT, "tarball_inventory.json"), `${JSON.stringify({ ...facts.tarball, inventory: tar.entries.map(({ path: p, size, mode, mtime, sha256: s }) => ({ path: p, size, mode, mtime, sha256: s })) }, null, 1)}\n`);
  const dry = JSON.parse(run("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: REPO }).stdout)[0];
  const expectedNames = dry.files.map((file) => file.path.replace(/\\/g, "/")).sort();
  const names = tar.entries.map((entry) => entry.path).sort();

  await row("P12-INV-01", () => {
    const badModes = tar.entries.filter((entry) => entry.mode !== (entry.path === "bin/airc.js" ? "755" : "644")).map((entry) => `${entry.path} ${entry.mode}`);
    const mtimes = [...new Set(tar.entries.map((entry) => entry.mtime))];
    const extra = names.filter((name) => !expectedNames.includes(name));
    const missing = expectedNames.filter((name) => !names.includes(name));
    return { pass: badModes.length === 0 && mtimes.length === 1 && extra.length === 0 && missing.length === 0,
      detail: { sha256: tar.sha256, integrity: tar.integrity, bytes: tar.bytes, entries: tar.entries.length, badModes, mtimes, extra, missing, inventory: "tarball_inventory.json" } };
  });

  await row("P12-REPRO-01", () => {
    const dest = path.join(WORK, "repro");
    fs.mkdirSync(dest, { recursive: true });
    const packed = run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", dest], { cwd: REPO });
    const file = path.join(dest, JSON.parse(packed.stdout)[0].filename);
    const again = tarballFacts(file);
    if (again.sha256 === tar.sha256) return { pass: true, detail: { second: again.sha256, equal: true } };
    const key = (list) => JSON.stringify(list.map(({ path: p, size, mode, sha256: s }) => [p, size, mode, s]).sort());
    const sameContent = key(again.entries) === key(tar.entries);
    return { status: sameContent ? "RECORDED" : "FAIL", detail: { first: tar.sha256, second: again.sha256, sameNamesBytesModes: sameContent, npm: run("npm", ["--version"]).stdout.trim() } };
  });

  await row("P12-INV-02", () => {
    const problems = [];
    if (names.some((name) => name.startsWith("fixtures/v053/"))) problems.push("fixtures/v053 ships");
    const seam = tar.entries.filter((entry) => entry.path.startsWith("src/")).filter((entry) => {
      const bytes = fs.readFileSync(path.join(INSTALLED, entry.path)); return /mintHarnessRecord|HARNESS_RECORDS/.test(bytes.toString("latin1"));
    }).map((entry) => entry.path);
    if (seam.length) problems.push(`test seam in ${seam.join(", ")}`);
    if (!names.includes("src/workbound_cost_table_v1.json") || !fs.existsSync(path.join(INSTALLED, "src", "workbound_cost_table_v1.json"))) problems.push("src/workbound_cost_table_v1.json missing");
    const changed = tar.entries.filter((entry) => !fs.existsSync(path.join(INSTALLED, entry.path)) || sha256(fs.readFileSync(path.join(INSTALLED, entry.path))) !== entry.sha256).map((entry) => entry.path);
    if (changed.length) problems.push(`installed files differ from the tarball: ${changed.slice(0, 10).join(", ")}`);
    const load = run(process.execPath, ["-e", `const r=require("node:module").createRequire(${JSON.stringify(path.join(PROJECT, "package.json"))}); process.stdout.write(String(Object.keys(r(${JSON.stringify(PKG)})).length))`], { cwd: PROJECT });
    if (load.status !== 0) problems.push(`the installed root does not load: ${(load.stderr || "").slice(0, 300)}`);
    return { pass: problems.length === 0, detail: { problems, rootNames: Number(load.stdout) || null, installedFiles: tar.entries.length - changed.length } };
  });

  await row("P12-ID-01", () => {
    const problems = [];
    const version = installedAirc(["version", "--json"]);
    let reported = null; try { reported = JSON.parse(version.stdout); } catch (_) {}
    if (!reported || reported.version !== repoPackage.version || reported.abi !== "0.10" || Object.keys(reported).length !== 2) problems.push(`airc version --json: ${version.stdout.trim()}`);
    const installedPackage = JSON.parse(fs.readFileSync(path.join(INSTALLED, "package.json"), "utf8"));
    if (installedPackage.version !== repoPackage.version) problems.push(`installed package.json ${installedPackage.version}`);
    const lock = JSON.parse(fs.readFileSync(path.join(PROJECT, "package-lock.json"), "utf8"));
    const locked = lock.packages && lock.packages["node_modules/@underskys/air-core"];
    if (!locked || locked.version !== repoPackage.version) problems.push(`the consumer lock names ${locked && locked.version}`);
    const pkgDir = path.join(WORK, "evidence-package");
    fs.cpSync(path.join(REPO, "test", "fixtures", "conformance_state"), pkgDir, { recursive: true });
    installedAirc(["build", path.join(pkgDir, "module.air"), "--emit", "wasm", "-o", path.join(pkgDir, "module.wasm")], WORK);
    const evidence = installedAirc(["verify", "package", pkgDir, "--profile", "cli", "--json"], WORK);
    let compilerVersion = null; try { compilerVersion = JSON.parse(evidence.stdout).compilerVersion; } catch (_) {}
    if (compilerVersion !== repoPackage.version) problems.push(`verification evidence compilerVersion ${compilerVersion} (exit ${evidence.status}: ${(evidence.stderr || "").slice(0, 200)})`);
    return { pass: problems.length === 0, detail: { airc: reported, packageJson: installedPackage.version, lock: locked && locked.version, compilerVersion, problems } };
  });

  await row("P12-PIN-01", () => {
    const lock = JSON.parse(fs.readFileSync(path.join(PROJECT, "package-lock.json"), "utf8"));
    const repoLock = JSON.parse(fs.readFileSync(path.join(REPO, "package-lock.json"), "utf8"));
    const got = lock.packages["node_modules/wabt"] || {}; const want = repoLock.packages["node_modules/wabt"] || {};
    const pinned = repoPackage.dependencies && repoPackage.dependencies.wabt;
    const digestOf = (root) => {
      const script = `const r=require(${JSON.stringify(path.join(root, "src", "v052_verified_build.js"))}); const fs=require("fs");
        const src=fs.readFileSync(${JSON.stringify(path.join(root, "fixtures", "v051", "checked_numeric", "checked_numeric.air"))},"utf8");
        const descriptor={air_abi_lane:"0.12",module_id:"example.checked_numeric",schema:"air.typed-interface/0.12-candidate.1",types:[],exports:[{name:"checked_add",function:"checked_add",parameters:[{name:"left",type:"i64"},{name:"right",type:"i64"}],return_type:"i64"}]};
        Promise.resolve(r.buildVerifiedTypedModule({sourceProfile:"typed-v0.51",descriptor,source:src})).then((b)=>process.stdout.write(b.compiler.implementationDigest),(e)=>process.stdout.write("ERROR "+(e.code||e.message)));`;
      return run(process.execPath, ["-e", script], { cwd: root }).stdout.trim();
    };
    const installedDigest = digestOf(INSTALLED); const repoDigest = digestOf(REPO);
    const pass = pinned === "1.0.39" && got.version === "1.0.39" && got.integrity === want.integrity && /^sha256:[0-9a-f]{64}$/.test(installedDigest) && installedDigest === repoDigest;
    return { pass, detail: { pinned, installed: got.version, integrity: got.integrity, lockIntegrity: want.integrity, installedImplementationDigest: installedDigest, repoImplementationDigest: repoDigest } };
  });

  await row("P12-A14-01", () => {
    const files = ["docs/v0.53/AIR_FOR_MODELS.md", "llms.txt", "skills/air/SKILL.md", ...treeFiles(REPO, "docs/v0.53/for-models/examples").map((rel) => rel)];
    const differ = files.filter((rel) => !fs.existsSync(path.join(INSTALLED, rel)) || !fs.readFileSync(path.join(INSTALLED, rel)).equals(fs.readFileSync(path.join(REPO, rel))));
    const examples = files.length - 3;
    return { pass: differ.length === 0 && examples === 41, detail: { files: files.length, examples, differ } };
  });

  await row("V53-PUB-02", () => {
    const differ = DOC_INVENTORY.filter((rel) => !fs.existsSync(path.join(INSTALLED, rel)) || !fs.existsSync(path.join(REPO, rel)) || !fs.readFileSync(path.join(INSTALLED, rel)).equals(fs.readFileSync(path.join(REPO, rel))));
    const wantedTyped = DOC_INVENTORY.filter((rel) => rel.startsWith("docs/v0.53/"));
    const extraTyped = names.filter((name) => /^docs\/v0\.53\/[^/]+\.md$/.test(name) && !wantedTyped.includes(name));
    const shippedThoughNot = NOT_SHIPPED.filter((rel) => names.some((name) => name === rel || name.startsWith(rel)) || fs.existsSync(path.join(INSTALLED, rel)));
    return { pass: differ.length === 0 && extraTyped.length === 0 && shippedThoughNot.length === 0,
      detail: { inventory: DOC_INVENTORY.length, differ, extraTypedDocs: extraTyped, shippedThoughNot, notShipped: NOT_SHIPPED } };
  });

  await row("P12-RFC-01", () => {
    const file = path.join(INSTALLED, RFC_TEXT);
    if (!fs.existsSync(file)) return { pass: false, detail: { problems: [`${RFC_TEXT} is not installed`] } };
    const bytes = fs.readFileSync(file); const result = rfcRow(bytes);
    return { pass: result.pass, detail: { file: RFC_TEXT, sha256: sha256(bytes), problems: result.problems } };
  });

  await row("V53-PUB-05", () => {
    const text = flat(fs.readFileSync(path.join(INSTALLED, "VERSIONING.md"), "utf8"));
    const missing = VERSIONING_PHRASES.filter((phrase) => !text.includes(phrase));
    return { pass: missing.length === 0, detail: { phrases: VERSIONING_PHRASES.length, missing } };
  });

  await row("V53-ABI-54", () => {
    const notes = path.join(INSTALLED, "docs", "RELEASE_NOTES_0_53_0.md");
    const check = fs.existsSync(notes) ? abiStatementCheck(fs.readFileSync(notes, "utf8")) : { missing: ["docs/RELEASE_NOTES_0_53_0.md"], authentication: [], protectedLegacy: [] };
    const policy = path.join(REPO, "docs", "VERSION_AND_ABI_POLICY.md");
    const policyCheck = fs.existsSync(policy) ? abiStatementCheck(fs.readFileSync(policy, "utf8")) : { missing: ["docs/VERSION_AND_ABI_POLICY.md"], authentication: [], protectedLegacy: [] };
    const pass = [check, policyCheck].every((c) => c.missing.length === 0 && c.authentication.length === 0 && c.protectedLegacy.length === 0);
    return { pass, detail: { releaseNotes: check, versionAndAbiPolicy: policyCheck } };
  });

  await row("P12-DOC-01", () => {
    const docs = names.filter((name) => /\.(md|txt)$/.test(name));
    const patterns = claimsPatterns(REPO);
    const hits = [];
    for (const rel of docs) for (const hit of claimHits(fs.readFileSync(path.join(INSTALLED, rel), "utf8"), patterns)) hits.push(`${rel}:${hit}`);
    const notes = fs.existsSync(path.join(INSTALLED, "docs", "RELEASE_NOTES_0_53_0.md")) ? flat(fs.readFileSync(path.join(INSTALLED, "docs", "RELEASE_NOTES_0_53_0.md"), "utf8")) : "";
    const missingItems = RELEASE_NOTE_ITEMS.filter(([, phrase]) => !notes.includes(phrase)).map(([label]) => label);
    fs.writeFileSync(path.join(OUT, "shipped_docs.json"), `${JSON.stringify(docs, null, 1)}\n`);
    return { pass: hits.length === 0 && missingItems.length === 0 && docs.length > 0, detail: { shippedDocs: docs.length, list: "shipped_docs.json", claimHits: hits, missingReleaseNoteItems: missingItems } };
  });

  await row("F1-GATE", () => {
    const out = run(process.execPath, [path.join(REPO, "scripts", "v053_installed_surface_gate.js"), PROJECT], { cwd: REPO });
    fs.writeFileSync(path.join(OUT, "f1_gate.txt"), `${out.stdout}${out.stderr}`);
    const summary = (out.stdout.match(/^SCALAR F-1 installed gate: .*$/m) || [""])[0];
    return { pass: out.status === 0 && /12 PASS, 0 FAIL, 1 RECORDED/.test(summary), detail: { exit: out.status, summary } };
  });

  // SEC53-02's installed rows (test/v053_execution_boundary.test.js V1-I1..I4), on the real install.
  const RAW_NAMES = ["instantiateRawWasm", "invokeRawBorrowedMemory", "prepareRawBorrowedMemoryInvocation"];
  const ROOT_HAS = ["instantiateVerifiedAirModule", "invokeBorrowedMemory", "prepareBorrowedMemoryInvocation", "admitTypedV053Artifact", "run"];
  const ROOT_LACKS = ["instantiateAirModule", ...RAW_NAMES, "instantiateRegisteredWasm", "registerBorrowedMemoryInstanceIdentity"];
  const probe = (code, type = "cjs") => {
    const file = path.join(PROJECT, type === "esm" ? "p012-probe.mjs" : "p012-probe.cjs");
    fs.writeFileSync(file, code);
    try { const out = run(process.execPath, [file], { cwd: PROJECT }); return out.status === 0 ? JSON.parse(out.stdout) : { error: (out.stderr || "").split("\n").find((l) => /Error|ERR_/.test(l)) || out.stderr.slice(0, 200) }; }
    finally { fs.rmSync(file, { force: true }); }
  };
  await row("I1", () => { const keys = probe(`process.stdout.write(JSON.stringify(Object.keys(require(${JSON.stringify(PKG)}))))`);
    return { pass: Array.isArray(keys) && ROOT_HAS.every((k) => keys.includes(k)) && ROOT_LACKS.every((k) => !keys.includes(k)), detail: Array.isArray(keys) ? { names: keys.length, missing: ROOT_HAS.filter((k) => !keys.includes(k)), present: ROOT_LACKS.filter((k) => keys.includes(k)) } : keys }; });
  await row("I2", () => { const keys = probe(`process.stdout.write(JSON.stringify(Object.keys(require(${JSON.stringify(`${PKG}/raw`)})).sort()))`);
    return { pass: JSON.stringify(keys) === JSON.stringify(RAW_NAMES.slice().sort()), detail: { keys } }; });
  await row("I3", () => { const result = probe(`const out={}; for (const s of ${JSON.stringify([`${PKG}/src/raw.js`, `${PKG}/src/raw`, `${PKG}/src/sdk.js`, `${PKG}/src/borrowed_memory_binding.js`])}) { try { require.resolve(s); out[s]="resolved"; } catch (e) { out[s]=e.code; } } process.stdout.write(JSON.stringify(out));`);
    return { pass: Object.values(result).length === 4 && Object.values(result).every((v) => v === "ERR_PACKAGE_PATH_NOT_EXPORTED"), detail: result }; });
  await row("I4", () => { const kinds = probe(`const m = await import(${JSON.stringify(`${PKG}/raw`)}); process.stdout.write(JSON.stringify(${JSON.stringify(RAW_NAMES)}.map((k) => typeof m[k])));`, "esm");
    return { pass: JSON.stringify(kinds) === JSON.stringify(["function", "function", "function"]), detail: { kinds } }; });

  // The fixes' installed rows (OD-P12-10 (d)): QA's own rows, from its tools qa_s3_installed.js (QI1-QI5, SEC53-03), qa_s1r5_installed.js
  // (QB1-QB4, SEC53-01) and qa_s8_installed.js (QC1-QC2, SEC53-08), run from the repository tree with its dependencies.
  const air = req(PKG);
  const pkgRoot = path.resolve(path.dirname(req.resolve(PKG)), "..");
  const repoAir = require(path.join(REPO, "src"));
  const ARGS = [["facts", "amount"], ["effective", "amountLimit"], ["facts", "quotaUsed"], ["effective", "quotaLimit"], ["facts", "rateUsed"],
    ["effective", "rateLimit"], ["facts", "targetId"], ["effective", "allowedTargetId"], ["effective", "now"], ["effective", "expiresAt"],
    ["effective", "redactionFlag"]].map(([from, key]) => ({ from, key }));
  const tag = (t) => `sha256:${sha256(t)}`;
  const qi = {};
  await row("QI1", () => { const rootFile = req.resolve(PKG);
    return { pass: typeof air.hostAuthority === "function" && typeof air.runHostConstructed === "function" && air.runPackage === air.run && rootFile.startsWith(path.join(PROJECT, "node_modules") + path.sep), detail: { names: Object.keys(air).length, resolved: path.relative(PROJECT, rootFile) } }; });
  await row("QI2", async () => {
    const ex = require(path.join(pkgRoot, "examples", "tool_gate", "request.js"));
    const allowed = await air.run(ex.createToolGateRequest());
    const repoEx = require(path.join(REPO, "examples", "tool_gate", "request.js"));
    const repoAllowed = await repoAir.run(repoEx.createToolGateRequest());
    qi.ta = JSON.stringify(allowed); const tr = JSON.stringify(repoAllowed);
    return { pass: allowed.decision.status === "allow" && allowed.outputs.length === 1 && qi.ta === tr, detail: { installed: tag(qi.ta), repository: tag(tr) } }; });
  const legacyRequest = () => ({ package: { directory: path.join(pkgRoot, "examples", "tool_gate"), profile: "mock-output-v011", entrypoint: "decide", requiredGrant: "agent.tool.invoke", arguments: ARGS },
    facts: { amount: 25, targetId: 7, quotaUsed: 1, rateUsed: 1, requiresRedaction: true },
    grants: [{ id: "agent.tool.invoke", decision: "allow", capability: "output", effects: ["output.emit"], targetId: 7, maxAmount: 100, quotaLimit: 3, rateLimit: 4, expiresAt: 2000, redaction: "required" }],
    limits: { maxAmount: 80, quotaLimit: 2, rateLimit: 3, now: 1000, maxOutputs: 1, maxHostCalls: 1 }, adapters: { "output.emit": "capture" } });
  await row("QI3", async () => {
    const refused = await air.run(JSON.parse(JSON.stringify(legacyRequest())));
    const named = JSON.stringify(await air.runHostConstructed(JSON.parse(JSON.stringify(legacyRequest()))));
    return { pass: refused.decision.reasonCode === "authority_unbranded" && refused.evidence.execution.status === "not_run" && refused.outputs.length === 0
      && refused.diagnostics.some((d) => d.code === "air.run.authority_unbranded") && named === qi.ta, detail: { reason: refused.decision.reasonCode, execution: refused.evidence.execution.status, namedEqualsQI2: named === qi.ta } }; });
  await row("QI4", async () => {
    const legacy = legacyRequest();
    const token = air.hostAuthority({ package: legacy.package, grants: legacy.grants, limits: legacy.limits, adapters: legacy.adapters, hostFacts: { quotaUsed: 1, rateUsed: 1, requiresRedaction: true } });
    const cross = await repoAir.run({ authority: token, facts: { amount: 25, targetId: 7 } });
    const own = JSON.stringify(await air.run({ authority: token, facts: { amount: 25, targetId: 7 } }));
    return { pass: cross.decision.reasonCode === "authority_unbranded" && cross.outputs.length === 0 && own === qi.ta, detail: { crossReason: cross.decision.reasonCode, ownEqualsQI2: own === qi.ta } }; });
  await row("QI5", () => { const deep = {};
    for (const s of [`${PKG}/src/run_package.js`, `${PKG}/src/run_package`, `${PKG}/examples/tool_gate/request.js`, `${PKG}/examples/tool_gate/request`]) { try { req.resolve(s); deep[s] = "resolved"; } catch (e) { deep[s] = e.code; } }
    return { pass: Object.values(deep).every((v) => v === "ERR_PACKAGE_PATH_NOT_EXPORTED"), detail: deep }; });

  await row("QB1", () => {
    const ppFile = path.join(pkgRoot, "src", "package_paths.js");
    const internal = fs.existsSync(ppFile) ? Object.keys(require(ppFile)) : null;
    const diag = fs.readFileSync(path.join(pkgRoot, "src", "diagnostics.js"), "utf8");
    const codes = ["air.package.path_uncontained", "air.package.file_invalid", "air.package.file_changed"];
    return { pass: Object.keys(air).length === 238 && Array.isArray(internal) && internal.every((k) => !(k in air)) && codes.every((c) => diag.includes(`"${c}":`)),
      detail: { names: Object.keys(air).length, onRoot: internal ? internal.filter((k) => k in air) : null, hints: codes.map((c) => diag.includes(`"${c}":`)) } }; });
  await row("QB2", () => { const deep = {};
    for (const s of [`${PKG}/src/package_paths.js`, `${PKG}/src/package_paths`]) { try { req.resolve(s); deep[s] = "resolved"; } catch (e) { deep[s] = e.code; } }
    return { pass: fs.existsSync(path.join(pkgRoot, "src", "package_paths.js")) && Object.values(deep).every((v) => v === "ERR_PACKAGE_PATH_NOT_EXPORTED"), detail: deep }; });
  const MARKER = "P012_OUTSIDE_MARKER_INSTALLED";
  const qbWork = fs.mkdtempSync(path.join(WORK, "qb-"));
  const outside = path.join(qbWork, "outside"); fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, "evil.air"), `module outside_mod\n// ${MARKER}\nfn decide() -> i32 { return 0 }\n`);
  const copyExample = (name) => { const d = path.join(qbWork, name); fs.cpSync(path.join(pkgRoot, "examples", "tool_gate"), d, { recursive: true }); return d; };
  await row("QB3", () => {
    const plain = copyExample("plain");
    let okPlain; try { const r = air.validatePackageManifest(plain); okPlain = r && r.ok !== false; } catch (e) { okPlain = false; }
    const linked = copyExample("linked");
    const entryName = JSON.parse(fs.readFileSync(path.join(linked, "air.package.json"), "utf8")).entry;
    fs.rmSync(path.join(linked, entryName)); fs.symlinkSync(path.join(outside, "evil.air"), path.join(linked, entryName));
    let refusal; try { refusal = { returned: JSON.stringify(air.validatePackageManifest(linked)) }; } catch (e) { refusal = { thrown: String(e.message), code: e.code || null }; }
    const text = JSON.stringify(refusal);
    return { pass: okPlain && !!refusal.thrown && /air\.package\.path_uncontained/.test(text) && !text.includes(MARKER), detail: { plain: okPlain, linked: refusal } }; });
  await row("QB4", () => {
    const fifo = copyExample("fifo");
    const entryName = JSON.parse(fs.readFileSync(path.join(fifo, "air.package.json"), "utf8")).entry;
    fs.rmSync(path.join(fifo, entryName)); childProcess.execFileSync("mkfifo", [path.join(fifo, entryName)]);
    const script = `const {createRequire}=require("node:module");const r=createRequire(${JSON.stringify(path.join(PROJECT, "package.json"))});` +
      `const air=r(${JSON.stringify(PKG)});Promise.resolve(air.checkPackageDir(${JSON.stringify(fifo)})).then((x)=>{const t=JSON.stringify(x);process.stdout.write(JSON.stringify({status:x.status,codes:["air.package.path_uncontained","air.package.file_invalid","air.package.file_changed"].filter(c=>t.includes(c))}))},(e)=>process.stdout.write(JSON.stringify({thrown:String(e.message)})));`;
    const child = run(process.execPath, ["-e", script], { timeout: 10000, killSignal: "SIGKILL", cwd: os.tmpdir() });
    let parsed = null; try { parsed = JSON.parse(child.stdout); } catch (_) {}
    return { pass: !child.signal && child.status === 0 && parsed && parsed.status === "fail" && (parsed.codes || []).includes("air.package.file_invalid"), detail: { signal: child.signal, status: child.status, result: parsed } }; });

  const HOST = { quotaUsed: 1, rateUsed: 1, requiresRedaction: true };
  const MSG = "air.run.argument_invalid: embedding argument 2 must be a signed i32";
  const cfg = (dir) => ({ package: { directory: dir, profile: "mock-output-v011", entrypoint: "decide", requiredGrant: "agent.tool.invoke",
    arguments: ARGS.map((a, i) => (i === 2 ? { from: "facts", key: "units" } : { ...a })) },
    grants: [{ id: "agent.tool.invoke", decision: "allow", capability: "output", effects: ["output.emit"], targetId: 7, maxAmount: 100, quotaLimit: 3, rateLimit: 4, expiresAt: 2000, redaction: "required" }],
    limits: { maxAmount: 80, quotaLimit: 2, rateLimit: 3, now: 1000, maxOutputs: 1, maxHostCalls: 1 }, adapters: { "output.emit": "capture" }, hostFacts: { ...HOST } });
  const refusedRun = (r) => r.decision.status === "deny" && r.decision.reasonCode === "execution_failed" && r.evidence.execution.status === "failed"
    && !r.evidence.execution.argumentDigest && r.outputs.length === 0 && JSON.stringify(r.diagnostics || []).includes(MSG);
  await row("QC1", async () => {
    const c = cfg(path.join(pkgRoot, "examples", "tool_gate"));
    const r1 = await air.run({ authority: air.hostAuthority(c), facts: { amount: 25, targetId: 7, units: 2 ** 31 } });
    const r2 = await air.run({ authority: air.hostAuthority(c), facts: { amount: 25, targetId: 7, units: 2 ** 32 + 1 } });
    const r3 = await air.runHostConstructed({ package: c.package, facts: { amount: 25, targetId: 7, ...HOST, units: 2 ** 32 + 1 }, grants: c.grants, limits: c.limits, adapters: c.adapters });
    return { pass: [r1, r2, r3].every(refusedRun), detail: { refused: [r1, r2, r3].map(refusedRun) } }; });
  await row("QC2", async () => {
    const dirI = path.join(pkgRoot, "examples", "tool_gate"); const dirR = path.join(REPO, "examples", "tool_gate");
    const p1i = JSON.stringify(await air.run(require(path.join(dirI, "request.js")).createToolGateRequest()));
    const p1r = JSON.stringify(await repoAir.run(require(path.join(dirR, "request.js")).createToolGateRequest()));
    const p4iRes = await air.run({ authority: air.hostAuthority(cfg(dirI)), facts: { amount: 25, targetId: 7, units: -(2 ** 31) } });
    const p4rRes = await repoAir.run({ authority: repoAir.hostAuthority(cfg(dirR)), facts: { amount: 25, targetId: 7, units: -(2 ** 31) } });
    const p4i = JSON.stringify(p4iRes); const p4r = JSON.stringify(p4rRes);
    const received = p4iRes.outputs[0] && Array.isArray(p4iRes.outputs[0].scalarArgs) ? p4iRes.outputs[0].scalarArgs[3] : null;
    return { pass: p1i === p1r && p4i === p4r && p4iRes.decision.status === "allow" && received === -2147483648, detail: { P1: { installed: tag(p1i), repository: tag(p1r) }, P4: { installed: tag(p4i), repository: tag(p4r), received } } }; });

  // P12-S9-01 (OD-P12-10 (d), erratum 3): SEC53-09 through the installed CLI, with the repository's fixture and config, as SEC53-09's VECTORS.md
  // R3 :32 and :37 state them: C-N2 after the installed `airc build` refused with air.conformance.wrong_args; B-N1 reported as the warning
  // air.benchmark.runtime_unavailable whose message is air.benchmark.argument_invalid; each with its in-range control.
  await row("P12-S9-01", () => {
    const base = path.join(WORK, "s9");
    fs.mkdirSync(base, { recursive: true });
    const fixture = (name, value, ret) => {
      const dir = path.join(base, name);
      fs.cpSync(path.join(REPO, "test", "fixtures", "conformance_state"), dir, { recursive: true });
      const trace = JSON.parse(fs.readFileSync(path.join(dir, "traces", "pass.json"), "utf8"));
      trace.steps = [{ id: "row", call: { export: "write_cell", args: [2, value] }, expect: { return: ret } }];
      delete trace.stateDigest;
      fs.writeFileSync(path.join(dir, "traces", "row.json"), JSON.stringify(trace));
      return dir;
    };
    const parts = {};
    for (const [name, value, ret] of [["cn2", 2 ** 32 + 1, 1], ["control", 7, 7]]) {
      const dir = fixture(name, value, ret);
      const build = installedAirc(["build", path.join(dir, "module.air"), "--emit", "wasm", "-o", path.join(dir, "module.wasm")], base);
      const conf = installedAirc(["conformance", dir, "--trace", path.join(dir, "traces", "row.json"), "--profile", "cli", "--json"], base);
      let report = null; try { report = JSON.parse(conf.stdout); } catch (_) {}
      const mismatches = report ? report.mismatches.map((m) => `${m.code || m.kind}: ${m.message}`) : null;
      parts[name] = name === "cn2"
        ? build.status === 0 && conf.status === 1 && report && report.status === "fail" && mismatches.includes("air.conformance.wrong_args: trace step row argument 1 must be a signed i32")
        : build.status === 0 && conf.status === 0 && report && report.status === "pass" && JSON.stringify(report.steps.map((s) => s.observed)) === JSON.stringify([{ return: 7 }]);
      parts[`${name}_detail`] = { build: build.status, conformance: conf.status, status: report && report.status, mismatches };
    }
    for (const [name, value] of [["bn1", 2 ** 31], ["bench_control", 7]]) {
      const pkg = fixture(`pkg_${name}`, 7, 7);
      const bench = path.join(base, `bench_${name}`); fs.mkdirSync(bench, { recursive: true });
      const config = JSON.parse(fs.readFileSync(path.join(REPO, "benchmarks", "fixed_state_basic", "benchmark.json"), "utf8"));
      config.packageDir = pkg; config.trace = path.join(pkg, "traces", "pass.json"); config.runtime.args = [1, value];
      fs.writeFileSync(path.join(bench, "benchmark.json"), JSON.stringify(config));
      const out = installedAirc(["benchmark", bench, "--json"], base);
      let report = null; try { report = JSON.parse(out.stdout); } catch (_) {}
      const diagnostics = report ? (report.diagnostics || []).map((d) => `${d.severity}: ${d.code}: ${d.message}`) : null;
      parts[name] = name === "bn1"
        ? out.status === 0 && report && report.status === "pass" && diagnostics.includes("warn: air.benchmark.runtime_unavailable: air.benchmark.argument_invalid: runtime.args[1] must be a signed i32")
        : out.status === 0 && report && report.status === "pass" && diagnostics.length === 0;
      parts[`${name}_detail`] = { exit: out.status, status: report && report.status, diagnostics };
    }
    return { pass: parts.cn2 && parts.control && parts.bn1 && parts.bench_control, detail: parts };
  });

  await row("V53-NEG-CORPUS-01", () => {
    const scratch = fs.mkdtempSync(path.join(WORK, "neg-"));
    const installedOut = negCorpusOutcomes(air, [AIRC], scratch);
    const devOut = negCorpusOutcomes(repoAir, [process.execPath, path.join(REPO, "bin", "airc.js")], scratch);
    const registry = registeredCodes(INSTALLED);
    const problems = [];
    installedOut.forEach((o, i) => {
      const d = devOut[i];
      if (o.accepted || !o.sdkCode) problems.push(`${o.label}: not rejected with a code by the installed SDK`);
      if (o.cliExit === 0 || o.cliCode !== o.sdkCode) problems.push(`${o.label}: the installed CLI gives ${o.cliCode} (exit ${o.cliExit}), the SDK ${o.sdkCode}`);
      if (o.sdkCode && !registry.has(o.sdkCode)) problems.push(`${o.label}: ${o.sdkCode} is named in no shipped typed doc`);
      if (JSON.stringify(o) !== JSON.stringify(d)) problems.push(`${o.label}: installed ${JSON.stringify(o)} differs from the dev tree ${JSON.stringify(d)}`);
    });
    return { pass: problems.length === 0, detail: { corpus: installedOut.map((o) => `${o.label}: ${o.sdkCode}`), registry: registry.size, problems } };
  });

  // V53-PUB-03: the V53-WB-H10 emission source (test/v053_workbound_foundation.test.js, frozen generator text and sha256) and a source one
  // byte over the typed intake limit (maxSourceBytes, 256 KiB), through every installed typed-v0.53 entrypoint and the dev tree's.
  await row("V53-PUB-03", async () => {
    const cases = Array.from({ length: 1000 }, (_, i) => `case${i} = ${i},`).join("\n");
    const params = Array.from({ length: 1000 }, (_, i) => `p${i}: E`).join(", ");
    const H10 = `module work.pressure\nenum E {\n${cases}\n}\nfunc hidden(${params}) -> i32 {\nreturn 0\n}\nexport func run() -> i32 {\nreturn 1\n}\n`;
    const h10Ok = `sha256:${sha256(H10)}` === "sha256:12398f6081bf05b705bab552e4346e120b03df2bfd2b9ea7201a704ebdc8dc55";
    const big = `module work.intake\n\nexport func f() -> i32 {\n  return 0\n}\n${"// intake padding\n".repeat(Math.ceil((256 * 1024) / 18))}`;
    const dir = fs.mkdtempSync(path.join(WORK, "pub03-"));
    fs.writeFileSync(path.join(dir, "h10.air"), H10); fs.writeFileSync(path.join(dir, "big.air"), big);
    const descriptor = { air_abi_lane: "0.12", module_id: "work.pressure", schema: "air.typed-interface/0.12-candidate.1", types: [], exports: [{ function: "run", name: "run", parameters: [], return_type: "i32" }] };
    const sdkOutcome = async (action) => { try { const v = await action(); return v && typeof v === "string" ? (v.length <= 4194304 ? "ok" : "over 4 MiB") : "ok"; } catch (e) { return (e && e.code) || `uncoded ${e && e.name}`; } };
    const through = async (sdk, aircRun) => {
      const out = {};
      for (const [label, file] of [["h10", "h10.air"], ["intake", "big.air"]]) {
        const source = fs.readFileSync(path.join(dir, file), "utf8");
        out[`${label} sdk parse+verify`] = await sdkOutcome(() => { const ast = sdk.parseSource(source, file, GATED); sdk.verifySource(ast, GATED); return null; });
        out[`${label} sdk format`] = await sdkOutcome(() => { const ast = sdk.parseSource(source, file, GATED); return void sdk.formatSource(ast, GATED); });
        out[`${label} sdk lowerToWat`] = await sdkOutcome(() => sdk.lowerToWat(sdk.parseSource(source, file, GATED), { allowCandidateProfile: true, maxWatBytes: 4194304 }));
        out[`${label} builder`] = await sdkOutcome(() => sdk.buildVerifiedTypedModule({ ...GATED, descriptor, source }));
        out[`${label} runtime`] = await sdkOutcome(() => sdk.createVerifiedTypedRuntime({ admit: async () => true }).build({ ...GATED, descriptor, source }));
        for (const command of [["verify"], ["check"], ["fmt"], ["build", "--emit", "wat", "-o", `${label}.wat`], ["build", "--emit", "wasm", "-o", `${label}.wasm`]]) {
          const cli = aircRun([command[0], file, ...TYPED, ...command.slice(1)], dir);
          const raw = /\n\s+at /.test(cli.stderr || "");
          out[`${label} cli ${command.join(" ").replace(/ -o .*/, "")}`] = cli.status === 0 ? "ok" : `${firstCode(cli) || "uncoded"}${raw ? " (raw stack)" : ""}`;
        }
      }
      return out;
    };
    const installedOut = await through(air, installedAirc);
    const devOut = await through(repoAir, repoAirc);
    const problems = [];
    if (!h10Ok) problems.push("the H10 source is not the frozen bytes");
    const intakeCodes = new Set(["air.v052.work_limit_source_bytes", "air.cli.file_too_large"]);
    for (const [key, value] of Object.entries(installedOut)) {
      if (key.startsWith("h10") && !(value === "ok" || value === "air.v052.work_limit_wat_bytes")) problems.push(`${key}: ${value}`);
      if (key.startsWith("intake") && !intakeCodes.has(value)) problems.push(`${key}: ${value}`);
      if (devOut[key] !== value) problems.push(`${key}: installed ${value}, dev ${devOut[key]}`);
    }
    return { pass: problems.length === 0, detail: { installed: installedOut, problems } };
  });

  if (opts.set) await setRun();
  const counts = { PASS: 0, FAIL: 0, RECORDED: 0 };
  for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1;
  fs.writeFileSync(path.join(OUT, "report.json"), `${JSON.stringify({ kind: "air.p012PublicRealityGate", package: `${PKG}@${repoPackage.version}`, node: process.version, platform: process.platform, tarball: facts.tarball, counts, rows: results }, null, 1)}\n`);
  process.stdout.write(`P0-12 public reality gate: ${counts.PASS} PASS, ${counts.FAIL} FAIL, ${counts.RECORDED} RECORDED\n`);
  fs.rmSync(WORK, { recursive: true, force: true });
  process.exitCode = counts.FAIL === 0 ? 0 : 1;
})().catch((error) => { process.stderr.write(`gate error: ${error && error.stack || error}\n`); process.exitCode = 2; });

// ---------------------------------------------------------------------------------------------------------------------------------
// V53-PUB-01's set (COVERAGE.md section 1): the 15 test/v053_* files, the two v051 suites and A14's test, run in a scratch root that holds
// the installed package's src/, bin/, stdlib/, data/ and package.json (byte copies; their tree hash must equal the installed package's)
// and the commit's other folders, and in the tree (OD-P12-12 (a)). One outcome per vector in each: the per-vector records the files write
// through their results variables, or, for files that write none, their PASS/FAIL row lines or their exit and summary line.
const SET = ["v053_analysis_capacity", "v053_assurance_floor", "v053_calls_cfg", "v053_constants_state", "v053_effects", "v053_host_binding",
  "v053_imports", "v053_loops", "v053_memory", "v053_migration", "v053_refinement", "v053_scalar", "v053_scalar_pipeline", "v053_tables_aggregates",
  "v053_workbound_foundation", "v051_frozen_conformance_matrix", "v051_checked_numeric_runtime", "air_for_models"];
const FIVE = ["src", "bin", "stdlib", "data", "package.json"];
// COVERAGE.md section 1's exclusion rule (erratum 6): a vector whose own text, from its id to the next vector's id, names a browser or F-1's
// seamed copy (the seam's pattern counts its use as well as its loading). A vector that reads another commit's git objects runs in both
// halves: the root reads them (gitRoot).
const EXCLUDE = [["a browser", /\bplaywright\b/i], ["F-1's seamed test copy", /harness_seam|loadSeamedCopy|\bseam\./]];
const RESULT_VARIABLES = (out) => {
  const env = {};
  for (const name of ["AIR_F1_VECTOR_RESULTS_DIR", "AIR_SCALAR_VECTOR_RESULTS_DIR", "AIR_P003_VECTOR_RESULTS_DIR", "AIR_P004_VECTOR_RESULTS_DIR", "AIR_P005_VECTOR_RESULTS_DIR",
    "AIR_P006_VECTOR_RESULTS_DIR", "AIR_P007_VECTOR_RESULTS_DIR", "AIR_P008_VECTOR_RESULTS_DIR", "AIR_P009_VECTOR_RESULTS_DIR", "AIR_P010_VECTOR_RESULTS_DIR", "AIR_P011_VECTOR_RESULTS_DIR"]) env[name] = out;
  Object.assign(env, { AIR_P0_02_VECTOR_RESULTS: path.join(out, "p0_02_vector_results.json"), AIR_P006_CHECK_O1_FILE: path.join(out, "p006_check_o1.json"),
    AIR_P007_CHECK_STATE_FILE: path.join(out, "p007_check_state.json"), AIR_P008_ABI_MATRIX_FILE: path.join(out, "p008_abi_matrix.json"),
    AIR_P008_CHECK_MEM_FILE: path.join(out, "p008_check_mem.json"), AIR_P009_COUNTERS_FILE: path.join(out, "p009_counters.json"), AIR_P011_MIGRATION_RECORDS_DIR: path.join(out, "migration_records") });
  return env;
};

function outcomesOf(file, out, stdout, exit, roots) {
  const mask = (text) => {
    let s = String(text);
    for (const [root, label] of roots) s = s.split(root).join(label);
    return s.replace(/(air|p012|v053|tmp)[A-Za-z0-9_.-]*-[A-Za-z0-9]{6}/g, "$1-XXXXXX").replace(/"(ms|seconds|elapsed[A-Za-z]*|duration[A-Za-z]*|[a-z]+Ms)":\s*[0-9.]+/g, "\"$1\":N")
      .replace(/SIGKILL after \d+ ms/g, "SIGKILL after N ms").replace(/\b\d+(\.\d+)? ?ms\b/g, "N ms");
  };
  const vectors = new Map();
  const add = (id, value) => vectors.set(id, mask(value));
  const resultFile = path.join(out, `${file}.results.json`);
  if (fs.existsSync(resultFile)) {
    const records = JSON.parse(fs.readFileSync(resultFile, "utf8"));
    for (const r of Array.isArray(records) ? records : []) if (r && r.vector) add(r.vector, JSON.stringify({ status: r.status, value_or_failure: r.value_or_failure }));
  }
  if (file === "v053_workbound_foundation" && fs.existsSync(path.join(out, "p0_02_vector_results.json"))) {
    const p = JSON.parse(fs.readFileSync(path.join(out, "p0_02_vector_results.json"), "utf8"));
    for (const r of [...(p.results || []), ...(p.correction_results || [])]) add(r.VECTOR_ID || r.vector || r.id, JSON.stringify({ PASS: r.PASS, status: r.status, ACTUAL: r.ACTUAL, value_or_failure: r.value_or_failure }));
  }
  if (vectors.size === 0) {
    for (const line of stdout.split("\n")) {
      const m = line.match(/^(PASS|FAIL) ([A-Z][A-Za-z0-9-]*) /) || line.match(/^(ok|not ok) - ([A-Z][A-Za-z0-9./-]+)/);
      if (m) add(m[2], m[1].replace("ok", "PASS").replace("not PASS", "FAIL"));
    }
  }
  if (vectors.size === 0) add(file, JSON.stringify({ exit: exit, summary: stdout.trim().split("\n").pop() }));
  return vectors;
}

function excludedVectors(file, ids) {
  const text = fs.readFileSync(path.join(REPO, "test", `${file}.test.js`), "utf8");
  const positions = ids.map((id) => [id, text.indexOf(`"${id}"`)]).filter(([, at]) => at >= 0).sort((a, b) => a[1] - b[1]);
  const excluded = new Map();
  positions.forEach(([id, at], i) => {
    const region = text.slice(at, i + 1 < positions.length ? positions[i + 1][1] : text.length);
    const hit = EXCLUDE.find(([, pattern]) => pattern.test(region));
    if (hit) excluded.set(id, hit[0]);
  });
  return excluded;
}

async function setRun() {
  const setStarted = Date.now();
  const root = path.join(WORK, "root");
  fs.mkdirSync(root, { recursive: true });
  for (const name of fs.readdirSync(REPO)) {
    if ([".git", "node_modules", "build", ...FIVE].includes(name) || name.startsWith("v053-public-reality-gate")) continue;
    fs.cpSync(path.join(REPO, name), path.join(root, name), { recursive: true, verbatimSymlinks: true });
  }
  for (const part of FIVE) fs.cpSync(path.join(INSTALLED, part), path.join(root, part), { recursive: true });
  fs.symlinkSync(path.join(PROJECT, "node_modules"), path.join(root, "node_modules"));
  const git = gitRoot(root, REPO);
  if (!git.ok) {
    for (const id of ["V53-PUB-01", "P12-DIFF-01", "V53-ASSUR-01..08", "P12-A14-02"]) record(id, "FAIL", { refused: git.reason });
    return;
  }
  process.stdout.write(`   set root: a git repository at ${git.commit}, reading the repository's objects through alternates\n`);
  const installedHash = treeHash(INSTALLED, FIVE);
  const set = { files: {}, excluded: [], diffs: [], drift: [] };
  for (const file of SET) {
    const half = {};
    for (const [label, tree] of [["installed", root], ["dev", REPO]]) {
      const out = path.join(OUT, "set", label, file);
      fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(path.join(out, "migration_records"), { recursive: true });
      const tmp = fs.mkdtempSync(path.join(WORK, `tmp-${label}-`));
      const started = Date.now();
      const child = run(process.execPath, [path.join("test", `${file}.test.js`)], { cwd: tree, timeout: 1800000, killSignal: "SIGKILL", env: { ...process.env, ...RESULT_VARIABLES(out), TMPDIR: tmp, AIR_REVIEW_BUNDLE: "" } });
      fs.writeFileSync(path.join(out, "stdout.txt"), `${child.stdout}\n--- stderr ---\n${child.stderr}`);
      half[label] = { exit: child.status, signal: child.signal, seconds: Math.round((Date.now() - started) / 1000), vectors: outcomesOf(file, out, child.stdout || "", child.status, [[root, "<tree>"], [REPO, "<tree>"], [tmp, "<tmp>"], [fs.realpathSync(tmp), "<tmp>"], [os.tmpdir(), "<tmpdir>"]]) };
      fs.rmSync(tmp, { recursive: true, force: true });
      if (label === "installed" && (treeHash(INSTALLED, FIVE) !== installedHash || treeHash(root, FIVE) !== installedHash)) set.drift.push(file);
    }
    const ids = [...new Set([...half.installed.vectors.keys(), ...half.dev.vectors.keys()])].sort();
    const excluded = excludedVectors(file, ids);
    for (const [id, reason] of excluded) set.excluded.push({ file, id, reason });
    const differing = ids.filter((id) => !excluded.has(id) && half.installed.vectors.get(id) !== half.dev.vectors.get(id));
    for (const id of differing) set.diffs.push({ file, id, installed: (half.installed.vectors.get(id) || "absent").slice(0, 600), dev: (half.dev.vectors.get(id) || "absent").slice(0, 600) });
    set.files[file] = { vectors: ids.length, excluded: excluded.size, differing: differing.length, installed: { exit: half.installed.exit, seconds: half.installed.seconds }, dev: { exit: half.dev.exit, seconds: half.dev.seconds } };
    process.stdout.write(`   set ${file}: ${ids.length} vectors, ${excluded.size} excluded, ${differing.length} differing; installed exit ${half.installed.exit} (${half.installed.seconds} s), dev exit ${half.dev.exit} (${half.dev.seconds} s)\n`);
    set[`${file}_outcomes`] = { installed: Object.fromEntries(half.installed.vectors), dev: Object.fromEntries(half.dev.vectors) };
  }
  fs.writeFileSync(path.join(OUT, "set_outcomes.json"), `${JSON.stringify(set, null, 1)}\n`);
  for (const e of set.excluded) process.stdout.write(`   EXCLUDED ${e.file} ${e.id}: ${e.reason}\n`);
  const devFailures = Object.entries(set.files).filter(([, f]) => f.dev.exit !== 0).map(([file]) => file);
  const seconds = { installed: Object.values(set.files).reduce((a, f) => a + f.installed.seconds, 0), dev: Object.values(set.files).reduce((a, f) => a + f.dev.seconds, 0), setWall: Math.round((Date.now() - setStarted) / 1000) };
  record("V53-PUB-01", set.diffs.length === 0 && set.drift.length === 0 && devFailures.length === 0 ? "PASS" : "FAIL",
    { files: SET.length, vectors: Object.values(set.files).reduce((a, f) => a + f.vectors, 0), excluded: set.excluded.length, devFailures, drift: set.drift, seconds, outcomes: "set_outcomes.json" });
  record("P12-DIFF-01", set.diffs.length === 0 ? "PASS" : "FAIL", { differing: set.diffs.length, diffs: set.diffs.slice(0, 20) });
  const assurance = set.v053_assurance_floor_outcomes ? set.v053_assurance_floor_outcomes.installed : {};
  const assur = Array.from({ length: 8 }, (_, i) => `V53-ASSUR-0${i + 1}`);
  const assurBad = assur.filter((id) => !assurance[id] || !/"status":"PASS"/.test(assurance[id]));
  record("V53-ASSUR-01..08", assurBad.length === 0 ? "PASS" : "FAIL", { vectors: assur.length, notPassingInstalled: assurBad });
  const a14 = set.air_for_models_outcomes || { installed: {}, dev: {} };
  const a14Rows = ["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8", "G9", "G10", "G11", "G12", "P1", "P2", "P3", "P4", "P5"];
  const a14Bad = a14Rows.filter((id) => a14.installed[id] !== "PASS" || a14.dev[id] !== "PASS");
  record("P12-A14-02", a14Bad.length === 0 ? "PASS" : "FAIL", { rows: a14Rows.length, notPassing: a14Bad });
}
