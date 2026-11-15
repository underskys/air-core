"use strict";

// P0-12 (slice text R5 with errata 1-5): the in-tree tests of the installed-package gate, scripts/v053_public_reality_gate.js. The gate
// itself runs on an installed tarball in CI's pack:smoke; this file checks, in the repository tree, the rows that need no install, and
// the gate's own readers:
//   GATE-TAR       the gate's tar reader on a tarball made here (names, sizes, modes)
//   V53-PUB-04     this projection's npm test includes test/v051_frozen_conformance_matrix.test.js
//   V53-PUB-05     VERSIONING.md documents the source-profile axis (RFC section 2.1) and the correction-record rule (section 2.5)
//   V53-ABI-54     the release notes (public) and docs/VERSION_AND_ABI_POLICY.md state ABI proposal R2 section 10's statements 1-8
//                  (OPEN-ABI-6 H2), never call the handshake authentication, and call no legacy, old-host or downgrade case "protected"
//   P12-DOC-01     check:public-claims' patterns pass over every doc this projection packs (public) or its typed docs (dev); the
//                  release notes hold section 5's items (public)
//   V53-NEG-CORPUS-01  the typed hallucination corpus in this tree: each rejected with a stable registered code (the gate runs it installed)
//   P12-LIN-01     the unmodified scripts/ci_npm_publish.sh with A3's check, on a scratch copy of the tree, with a stub npm (public only:
//                  dev has no publish script); the cases and mutants of tools/p012_lineage_harness.sh, with its generator in JavaScript
//   P12-RFC-01     (E4) this tree's docs/v0.53/RFC_TYPED_V053.md through the gate's rfcRow() (erratum 4's tools/e4_rfc_row.js as it
//                  stands): 1975 lines, the notice naming the accepted text's sha256, the body digest, no absolute local path
//   P12-R03        V53-PROF-R03 in the repository with git history: the typed-v0.51 corpus (every tracked .air file typed-v0.51 accepts at
//                  src tree 0b56c1fa) through parse, verify, format and lower at 0b56c1fa, at H52_BASELINE and at this tree
// Usage: node test/v053_public_reality_gate.test.js [--rows ID,ID,...]
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const gate = require("../scripts/v053_public_reality_gate.js");

const ROOT = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const DEV = manifest.private === true && manifest.name === "airlang-dev-workspace";
const args = process.argv.slice(2);
const ONLY = args.includes("--rows") ? new Set(args[args.indexOf("--rows") + 1].split(",")) : null;
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const run = (command, argv, options = {}) => childProcess.spawnSync(command, argv, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, ...options });
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "air-p012-gate-test-"));
const rows = [];

async function row(id, fn) {
  if (ONLY && !ONLY.has(id)) return;
  let out;
  try { out = await fn(); } catch (error) { out = { pass: false, detail: { threw: `${error && error.name}: ${String(error && error.message).slice(0, 400)}` } }; }
  rows.push({ id, status: out.skip ? "SKIP" : out.pass ? "PASS" : "FAIL", detail: out.detail });
}

(async () => {
  await row("GATE-TAR", () => {
    const dir = path.join(scratch, "tar"); fs.mkdirSync(path.join(dir, "package", "bin"), { recursive: true });
    fs.writeFileSync(path.join(dir, "package", "a.txt"), "alpha\n"); fs.chmodSync(path.join(dir, "package", "a.txt"), 0o644);
    fs.writeFileSync(path.join(dir, "package", "bin", "x.js"), "#!/usr/bin/env node\n"); fs.chmodSync(path.join(dir, "package", "bin", "x.js"), 0o755);
    const tgz = path.join(scratch, "t.tgz");
    const made = run("tar", ["-czf", tgz, "-C", dir, "package"], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
    const facts = gate.tarballFacts(tgz);
    const byPath = Object.fromEntries(facts.entries.map((e) => [e.path, e]));
    const pass = made.status === 0 && byPath["a.txt"] && byPath["a.txt"].size === 6 && byPath["a.txt"].mode === "644" && byPath["a.txt"].sha256 === sha256("alpha\n")
      && byPath["bin/x.js"] && byPath["bin/x.js"].mode === "755" && facts.sha256 === sha256(fs.readFileSync(tgz)) && facts.integrity.startsWith("sha512-");
    return { pass, detail: { entries: facts.entries.map((e) => `${e.path} ${e.size} ${e.mode}`) } };
  });

  await row("V53-PUB-04", () => {
    const commands = manifest.scripts.test.split(" && ");
    return { pass: commands.includes("node test/v051_frozen_conformance_matrix.test.js"), detail: { commands: commands.length, projection: DEV ? "dev" : "public" } };
  });

  await row("V53-PUB-05", () => {
    const text = fs.readFileSync(path.join(ROOT, "VERSIONING.md"), "utf8").replace(/\s+/g, " ");
    const missing = gate.VERSIONING_PHRASES.filter((phrase) => !text.includes(phrase));
    return { pass: missing.length === 0, detail: { phrases: gate.VERSIONING_PHRASES.length, missing } };
  });

  await row("V53-ABI-54", () => {
    const checks = {};
    const docs = ["docs/VERSION_AND_ABI_POLICY.md", ...(DEV ? [] : ["docs/RELEASE_NOTES_0_53_0.md"])];
    for (const rel of docs) checks[rel] = fs.existsSync(path.join(ROOT, rel)) ? gate.abiStatementCheck(fs.readFileSync(path.join(ROOT, rel), "utf8")) : { missing: ["the file"], authentication: [], protectedLegacy: [] };
    const pass = Object.values(checks).every((c) => c.missing.length === 0 && c.authentication.length === 0 && c.protectedLegacy.length === 0);
    return { pass, detail: checks };
  });

  await row("P12-DOC-01", () => {
    let docs;
    if (DEV) {
      docs = ["README.md", "CHANGELOG.md", "VERSIONING.md", "ROADMAP.md", ...fs.readdirSync(path.join(ROOT, "docs", "v0.53")).filter((f) => f.endsWith(".md")).map((f) => `docs/v0.53/${f}`), "llms.txt", "skills/air/SKILL.md"];
    } else {
      const dry = JSON.parse(run("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: ROOT }).stdout)[0];
      docs = dry.files.map((f) => f.path.replace(/\\/g, "/")).filter((p) => /\.(md|txt)$/.test(p));
    }
    const patterns = gate.claimsPatterns(ROOT);
    const hits = [];
    for (const rel of docs) for (const hit of gate.claimHits(fs.readFileSync(path.join(ROOT, rel), "utf8"), patterns)) hits.push(`${rel}:${hit}`);
    const notes = DEV ? null : fs.readFileSync(path.join(ROOT, "docs", "RELEASE_NOTES_0_53_0.md"), "utf8").replace(/\s+/g, " ");
    const missingItems = DEV ? [] : gate.RELEASE_NOTE_ITEMS.filter(([, phrase]) => !notes.includes(phrase)).map(([label]) => label);
    return { pass: hits.length === 0 && missingItems.length === 0, detail: { docs: docs.length, claimHits: hits, missingReleaseNoteItems: missingItems } };
  });

  await row("V53-NEG-CORPUS-01", () => {
    const sdk = require("../src/index.js");
    const dir = fs.mkdtempSync(path.join(scratch, "neg-"));
    const outcomes = gate.negCorpusOutcomes(sdk, [process.execPath, path.join(ROOT, "bin", "airc.js")], dir);
    const registry = gate.registeredCodes(ROOT);
    const problems = outcomes.filter((o) => o.accepted || !o.sdkCode || o.cliExit === 0 || o.cliCode !== o.sdkCode || !registry.has(o.sdkCode)).map((o) => JSON.stringify(o));
    return { pass: problems.length === 0 && outcomes.length === gate.NEG_CORPUS.length, detail: { corpus: outcomes.map((o) => `${o.label}: ${o.sdkCode}`), problems } };
  });

  await row("P12-LIN-01", () => {
    if (DEV) return { skip: true, detail: { skipped: "the dev projection has no scripts/ci_npm_publish.sh (it is not an npm publish source)" } };
    return lineage();
  });

  await row("P12-RFC-01", () => {
    const file = path.join(ROOT, gate.RFC_TEXT);
    if (!fs.existsSync(file)) return { pass: false, detail: { problems: [`${gate.RFC_TEXT} is missing`] } };
    const bytes = fs.readFileSync(file); const result = gate.rfcRow(bytes);
    return { pass: result.pass, detail: { projection: DEV ? "dev" : "public", sha256: sha256(bytes), problems: result.problems } };
  });

  await row("P12-R03", () => r03());

  for (const r of rows) process.stdout.write(`${r.status} ${r.id} ${JSON.stringify(r.detail).slice(0, r.status === "FAIL" ? 3000 : 300)}\n`);
  const failed = rows.filter((r) => r.status === "FAIL").length;
  process.stdout.write(`P0-12 public reality gate (in-tree): ${rows.filter((r) => r.status === "PASS").length} PASS, ${failed} FAIL, ${rows.filter((r) => r.status === "SKIP").length} SKIP\n`);
  fs.rmSync(scratch, { recursive: true, force: true });
  process.exitCode = failed === 0 ? 0 : 1;
})().catch((error) => { process.stdout.write(`FAIL threw ${error && error.stack || error}\n`); process.exitCode = 1; });

// P12-LIN-01: tools/p012_lineage_harness.sh of the slice text, run on a scratch copy of the tree (it writes the tarball, the pack JSON
// and the mutant scripts into the tree it runs on). A stub npm, first on PATH, records every call, fakes whoami, view and run check:*,
// runs pack for real (appending a byte to every pack after the first) and records publish without publishing. Offline, a dummy NPM_TOKEN,
// CI_COMMIT_TAG the expected tag. The four cases (unset, malformed, mismatch, equal) on the unchanged script, then L0 (an unchanged copy)
// and L1-L4 (the check removed, after npm publish, on a second pack, a re-pack after the check), each scored by all four.
function lineage() {
  const W = fs.mkdtempSync(path.join(scratch, "lin-"));
  const T = path.join(W, "tree");
  fs.mkdirSync(T);
  for (const name of fs.readdirSync(ROOT)) {
    if ([".git", "node_modules", "build"].includes(name) || /\.tgz$/.test(name) || name.startsWith("npm-publish")) continue;
    fs.cpSync(path.join(ROOT, name), path.join(T, name), { recursive: true, verbatimSymlinks: true });
  }
  const realNpm = run("sh", ["-c", "command -v npm"]).stdout.trim();
  const stubDir = path.join(W, "stub"); fs.mkdirSync(stubDir);
  fs.writeFileSync(path.join(stubDir, "npm"), [
    "#!/bin/bash",
    "echo \"npm $*\" >> \"$NPM_STUB_LOG\"",
    "case \"$1\" in",
    "  whoami) echo stub-user; exit 0 ;;",
    "  view) exit 1 ;;",
    "  run) exit 0 ;;",
    "  pack)",
    "    out=\"$(\"$REAL_NPM\" \"$@\")\"; rc=$?; printf '%s\\n' \"$out\"",
    "    if [ \"$rc\" -eq 0 ] && [[ \" $* \" != *\" --dry-run \"* ]]; then",
    "      n=$(( $(cat \"$NPM_STUB_LOG.packs\" 2>/dev/null || echo 0) + 1 )); echo \"$n\" > \"$NPM_STUB_LOG.packs\"",
    "      if [ \"$n\" -gt 1 ]; then",
    "        f=\"$(printf '%s' \"$out\" | node -e 'let s=\"\";process.stdin.on(\"data\",(d)=>s+=d).on(\"end\",()=>process.stdout.write(JSON.parse(s)[0].filename))')\"",
    "        printf 'x' >> \"$f\"; echo \"TAMPERED $f\" >> \"$NPM_STUB_LOG\"",
    "      fi",
    "    fi",
    "    exit \"$rc\" ;;",
    "  publish)",
    "    echo \"PUBLISH $2 $(node -e 'process.stdout.write(require(\"crypto\").createHash(\"sha256\").update(require(\"fs\").readFileSync(process.argv[1])).digest(\"hex\"))' \"$2\")\" >> \"$NPM_STUB_LOG\"",
    "    exit 0 ;;",
    "  *) exit 0 ;;",
    "esac", ""].join("\n"));
  fs.chmodSync(path.join(stubDir, "npm"), 0o755);
  const version = JSON.parse(fs.readFileSync(path.join(T, "package.json"), "utf8")).version;
  const zeros = "0".repeat(64);
  let counter = 0;
  const runcase = (script, expected) => {
    const log = path.join(W, `log.${counter++}`); fs.writeFileSync(log, "");
    const env = { ...process.env, NPM_TOKEN: "dummy-token", AIR_NPM_DIST_TAG: "latest", CI_COMMIT_TAG: `v${version}`, AIR_NPM_EXPECTED_VERSION: version,
      AIR_NPM_EXPECTED_TAG: `v${version}`, NPM_STUB_LOG: log, REAL_NPM: realNpm, PATH: `${stubDir}${path.delimiter}${process.env.PATH}` };
    delete env.AIR_NPM_EXPECTED_TARBALL_SHA256;
    if (expected !== "UNSET") env.AIR_NPM_EXPECTED_TARBALL_SHA256 = expected;
    const out = run("bash", [path.join(T, "scripts", script)], { cwd: T, env });
    const lines = fs.readFileSync(log, "utf8").split("\n");
    const pubs = lines.filter((l) => l.startsWith("PUBLISH "));
    return { rc: out.status, calls: lines.filter((l) => l.startsWith("npm ")).length, pubs: pubs.length, pubsha: pubs[0] ? pubs[0].split(" ")[2] : null, err: (out.stderr || "").trim().split("\n").pop().slice(0, 200) };
  };
  let actual = null;
  const holds = (c, r) => (c === "equal" ? r.rc === 0 && r.pubs === 1 && r.pubsha === actual : r.rc !== 0 && r.pubs === 0);
  const results = {};
  results.unset = runcase("ci_npm_publish.sh", "UNSET");
  results.malformed = runcase("ci_npm_publish.sh", `sha256:${zeros}`);
  results.mismatch = runcase("ci_npm_publish.sh", zeros);
  actual = (results.mismatch.err.match(/has sha256 ([0-9a-f]{64})/) || [])[1] || null;
  results.equal = actual ? runcase("ci_npm_publish.sh", actual) : null;
  const cases = Object.fromEntries(["unset", "malformed", "mismatch", "equal"].map((c) => [c, Boolean(results[c]) && holds(c, results[c])]));
  // The generator (the harness's, in JavaScript): L0 unchanged, L1 the check removed, L2 the check after npm publish, L3 the check on a
  // second pack, L4 a re-pack after the check.
  const src = fs.readFileSync(path.join(T, "scripts", "ci_npm_publish.sh"), "utf8");
  const start = src.indexOf("# P0-12 lineage (addendum 1 item 3)"); const end = src.indexOf("npm publish \"$TARBALL\"");
  const generated = start >= 0 && end > start;
  if (generated) {
    const block = src.slice(start, end); const publishLine = src.slice(end, src.indexOf("\n", end) + 1);
    const second = "npm pack --json > npm-publish-pack2.json\nSECOND=\"$(node -e 'process.stdout.write(JSON.parse(require(\"fs\").readFileSync(\"npm-publish-pack2.json\",\"utf8\"))[0].filename)')\"\n";
    const l3 = src.replace("ACTUAL_TARBALL_SHA256=\"$(node", `${second}ACTUAL_TARBALL_SHA256="$(node`).replace(".digest(\"hex\"))' \"$TARBALL\")\"", ".digest(\"hex\"))' \"$SECOND\")\"");
    const variants = { L0: src, L1: src.slice(0, start) + src.slice(end), L2: src.slice(0, start) + publishLine + block + src.slice(end + publishLine.length), L3: l3, L4: `${src.slice(0, end)}npm pack --json > npm-publish-pack2.json\n${src.slice(end)}` };
    for (const [m, text] of Object.entries(variants)) fs.writeFileSync(path.join(T, "scripts", `ci_npm_publish.${m}.sh`), text);
  }
  const mutants = {};
  for (const m of ["L0", "L1", "L2", "L3", "L4"]) {
    const file = path.join(T, "scripts", `ci_npm_publish.${m}.sh`);
    const same = fs.existsSync(file) && fs.readFileSync(file, "utf8") === src;
    const applied = fs.existsSync(file) && (m === "L0" ? same : !same);
    let ran = applied; const failed = [];
    if (applied) {
      for (const [c, e] of [["unset", "UNSET"], ["malformed", `sha256:${zeros}`], ["mismatch", zeros], ["equal", actual]]) {
        const r = runcase(`ci_npm_publish.${m}.sh`, e);
        if (r.calls === 0) ran = false;
        if (!holds(c, r)) failed.push(c);
      }
    }
    mutants[m] = !applied || !ran ? "NOT-SCORED" : m === "L0" ? (failed.length ? `NOT-CLEAN ${failed}` : "clean") : (failed.length ? `caught by ${failed.join(" ")}` : "NOT-CAUGHT");
  }
  const pass = generated && actual && Object.values(cases).every(Boolean) && mutants.L0 === "clean" && ["L1", "L2", "L3", "L4"].every((m) => mutants[m].startsWith("caught"));
  return { pass, detail: { cases, actual, mutants, errors: Object.fromEntries(Object.entries(results).map(([k, r]) => [k, r && r.err])) } };
}

// P12-R03 (V53-PROF-R03; COVERAGE.md section 1): the typed-v0.51 corpus of V53-PROF-R02 (every tracked .air file that typed-v0.51 accepts
// at src tree 0b56c1fa) at three src trees: 0b56c1fa, H52_BASELINE (dev 94001cd1 / public 9c2b1788) and this tree. Each file through
// parse, verify, format (the bytes) and lower (the WAT's sha256), in a child per tree. The results must be identical, except the classes
// R3.1 permits (X-BND-01, X-SND-04) and SEC53-06's correction record CR-S6; any difference is listed with its file.
const SRC_0B56 = "0b56c1fa95260ea4c49df1471df443e60703dd17";
const H52_BASELINE = ["94001cd1c822ccd914874c85543aa99e91d6ae4e", "9c2b1788a42f747bf6d61f2517c8348a7d519159"];
const PROBE = `"use strict";
const fs = require("fs"); const path = require("path"); const crypto = require("crypto");
const [src, listFile, out] = process.argv.slice(2);
const r = (m) => require(path.join(src, m));
const parser = r("parser.js"), verifier = r("verifier.js"), format = r("format.js"), lower = r("lower_wasm.js");
const code = (e) => (e && e.code) || String(e && e.message || e).match(/\\bair\\.[a-z0-9_]+\\.[a-z0-9_]+/)?.[0] || ("uncoded " + (e && e.name));
const sha = (t) => crypto.createHash("sha256").update(t).digest("hex").slice(0, 16);
const result = {};
for (const file of fs.readFileSync(listFile, "utf8").split("\\n").filter(Boolean)) {
  const source = fs.readFileSync(file, "utf8"); const o = {};
  let mod = null;
  try { mod = parser.parseV051TypedAir(source, path.basename(file)); o.parse = "ok"; } catch (e) { o.parse = code(e); }
  if (mod) {
    try { verifier.verifyV051Air(mod); o.verify = "ok"; } catch (e) { o.verify = code(e); }
    try { o.format = sha(format.formatV051Air(mod)); } catch (e) { o.format = code(e); }
    if (o.verify === "ok") { try { o.lower = sha(lower.lowerV051TypedToWat(mod)); } catch (e) { o.lower = code(e); } }
  }
  result[file] = o;
}
fs.writeFileSync(out, JSON.stringify(result));`;

function r03() {
  const dir = fs.mkdtempSync(path.join(scratch, "r03-"));
  const have = (object) => run("git", ["cat-file", "-e", object], { cwd: ROOT }).status === 0;
  const baseline = H52_BASELINE.find((c) => have(`${c}^{commit}`));
  if (!have(`${SRC_0B56}^{tree}`) || !baseline) return { pass: false, detail: { environment: "ENVIRONMENT_UNAVAILABLE: the git objects of 0b56c1fa or H52_BASELINE are not in this repository", src0b56: have(`${SRC_0B56}^{tree}`), baseline: baseline || null } };
  const trees = { "0b56c1fa": path.join(dir, "a"), H52_BASELINE: path.join(dir, "b"), candidate: path.join(ROOT, "src") };
  fs.mkdirSync(trees["0b56c1fa"]); fs.mkdirSync(path.join(dir, "bb"));
  run("sh", ["-c", `git archive ${SRC_0B56} | tar -x -C "${trees["0b56c1fa"]}"`], { cwd: ROOT });
  run("sh", ["-c", `git archive ${baseline} src | tar -x -C "${path.join(dir, "bb")}"`], { cwd: ROOT });
  fs.renameSync(path.join(dir, "bb", "src"), trees.H52_BASELINE);
  const files = run("git", ["ls-files", "*.air"], { cwd: ROOT }).stdout.split("\n").filter(Boolean).map((f) => path.join(ROOT, f));
  const listFile = path.join(dir, "all.txt"); fs.writeFileSync(listFile, files.join("\n"));
  const probeFile = path.join(dir, "probe.js"); fs.writeFileSync(probeFile, PROBE);
  const outcome = (label, list) => {
    const out = path.join(dir, `${label}.json`);
    const child = run(process.execPath, ["--stack-size=4000", probeFile, trees[label], list, out], { cwd: ROOT, timeout: 1200000 });
    if (child.status !== 0) throw new Error(`${label}: probe exit ${child.status}: ${(child.stderr || "").slice(0, 300)}`);
    return JSON.parse(fs.readFileSync(out, "utf8"));
  };
  const first = outcome("0b56c1fa", listFile);
  const corpus = Object.keys(first).filter((f) => first[f].parse === "ok" && first[f].verify === "ok");
  const corpusFile = path.join(dir, "corpus.txt"); fs.writeFileSync(corpusFile, corpus.join("\n"));
  const at = { "0b56c1fa": Object.fromEntries(corpus.map((f) => [f, first[f]])), H52_BASELINE: outcome("H52_BASELINE", corpusFile), candidate: outcome("candidate", corpusFile) };
  const differences = [];
  for (const f of corpus) {
    const a = JSON.stringify(at["0b56c1fa"][f]); const b = JSON.stringify(at.H52_BASELINE[f]); const c = JSON.stringify(at.candidate[f]);
    if (a !== b || a !== c) differences.push({ file: path.relative(ROOT, f), at0b56: at["0b56c1fa"][f], h52: at.H52_BASELINE[f], candidate: at.candidate[f] });
  }
  return { pass: corpus.length > 0 && differences.length === 0, detail: { tracked: files.length, corpus: corpus.length, baseline, differences } };
}
