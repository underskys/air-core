"use strict";
// The scanner fix (SEC53-07): T1 and T1b of the fail-closed bundle secret scan's specification.
//
// T1 runs scripts/bundle_secret_scan.sh in temporary folders through bash -c, in every row of the specification's attack matrix
// (probes/matrix.sh, 70 rows), with the outcome given there. Every row also checks that its own TMPDIR is empty afterwards. It runs
// under the bash found on PATH, and under /bin/bash too where that is a different bash. Each row runs in its own process group, under a
// 20 s timeout that kills the whole group (a blocked grep outlives its shell). As root, the two unreadable rows cannot fail, so they are
// skipped, and the test says so.
//
// The helper's mutants (the specification's probes/mutants.py, M01-M26) are applied to a scratch copy of the helper, one at a time, and
// run in each shell against the rows that the specification's own run names as catching them (the first three where it names more).
// Each must be caught by one of its rows; a row that times out counts as caught. M16 and M18 are the two the specification shows
// equivalent: each is run against the rows where its line would matter, and they must keep their outcome. M03 (env keeps the caller's
// environment) is equivalent for its GREP_OPTIONS rows where grep no longer reads GREP_OPTIONS (GNU grep 3.6 and later), and must be
// caught where grep reads them, as macOS's does (SPEC section 5). So the grep on PATH, the one the helper runs, is asked once: where it
// reads GREP_OPTIONS, M03 must be caught; where it does not, M03 runs as an equivalent and the summary line says so.
//
// T1b reads the bundle scripts: each sources the helper once, before its first cd, and calls it the expected number of times; each
// call's captured status is tested (-ne 0) in an if whose branch stops the script (exit), before the next scan call and before the
// archive is made (the owner's decision of 14.11, AIR_V053_OWNER_DECISION_SCANNER_F2_STATUS_CHECK_TEST_2026_11_14); no scan
// keeps -I, "|| true" or a 2>/dev/null after grep; no scan line assigns LC_ALL, LANG or LC_*; each canary array has one entry per
// top-level branch of its pattern, and each entry matches that branch.
//
// No token, label or local path is written here as one: each is built at run time, since the review and language bundles include this
// file and scan it.
const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const HELPER = path.join(ROOT, "scripts", "bundle_secret_scan.sh");
const ROW_TIMEOUT_MS = 20000;
const RESULTS_DIR = process.env.AIR_BUNDLE_SCAN_RESULTS_DIR || "";

// The danger pattern and its canaries, as probes/matrix.sh gives them; each token and canary is joined from two parts.
const DANGEROUS = "-----BEGIN ((RSA|OPENSSH|EC|DSA) )?PRIVATE KEY-----|glpat-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9_]{20,}|gho_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{30,}|xox[baprs]-[A-Za-z0-9-]{20,}|AKIA[0-9A-Z]{16}";
const TOK_AKIA = "AKIA" + "ABCDEFGHIJKLMNOP";
const TOKS = [
  "-----BEGIN " + "RSA PRIVATE KEY-----",
  "glpat-" + "a".repeat(24),
  "ghp_" + "b".repeat(26),
  "gho_" + "c".repeat(24),
  "sk-" + "d".repeat(34),
  "xoxb-" + "1111111111-2222222222-eeee",
  TOK_AKIA,
];
const CHILD = [
  "set -euo pipefail",
  'export TMPDIR="$5"',
  '. "$1"',
  'CAN=( "-----BEGIN ""PRIVATE KEY-----" "glpat-""CANARYcanaryCANARYcanary" "ghp_""CANARYcanaryCANARYcanary" "gho_""CANARYcanaryCANARYcanary" "sk-""CANARYcanaryCANARYcanaryCANARYcanary" "xoxb-""CANARY-canary-CANARY-canary" "AKIA""CANARYCANARY0000" )',
  'eval "$4"',
  "st=0",
  'if [ -n "${DIRECT:-}" ]; then',
  '  bundle_scan_tree "$2" "$3" "${CAN[@]}" >/dev/null 2>&1 || st=$?',
  '  case "$-" in *f*) printf "%s|noglob=on" "$st" ;; *) printf "%s|noglob=off" "$st" ;; esac',
  "  exit 0",
  "fi",
  'if [ -n "${NOCAN:-}" ]; then out="$(bundle_scan_tree "$2" "$3" 2>/dev/null)" || st=$?; else out="$(bundle_scan_tree "$2" "$3" "${CAN[@]}" 2>/dev/null)" || st=$?; fi',
  'printf "%s|%s" "$st" "$(printf "%s" "$out" | tr "\\n" ";")"',
].join("\n");

const sq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
const IS_ROOT = typeof process.getuid === "function" && process.getuid() === 0;

// The children's environment: the caller's, without what a row sets for itself or what could change a shell under it.
const CHILD_ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(LANG|LC_[A-Z_]+|GREP_OPTIONS|GREP_COLOR|GREP_COLORS|POSIXLY_CORRECT|BASH_ENV|ENV|CDPATH|SHELLOPTS|BASHOPTS|BASH_FUNC_.*)$/.test(k)));

function sh(cmd) {
  const r = spawnSync("/bin/sh", ["-c", cmd], { encoding: "utf8", env: CHILD_ENV });
  return r.status === 0 ? r.stdout.trim() : "";
}
const REAL_GREP = sh("command -v grep");

// Does the grep on PATH read GREP_OPTIONS? With GREP_OPTIONS=-v, its count of the lines holding "x" in a one-line "x" file is 0 when it
// does and 1 when it does not (GNU grep 3.6 and later). Anything else is reported, and M03 then stays a mutant that must be caught.
function grepReadsOptions(base) {
  const dir = fs.mkdtempSync(path.join(base, "grep-options-"));
  const file = path.join(dir, "x.txt");
  fs.writeFileSync(file, "x\n");
  const r = spawnSync(REAL_GREP, ["-c", "x", file], { encoding: "utf8", env: { ...CHILD_ENV, GREP_OPTIONS: "-v" } });
  removeTree(dir);
  const count = String(r.stdout || "").trim();
  return { reads: count === "0" ? true : count === "1" ? false : null, count, status: r.status, stderr: String(r.stderr || "").trim().slice(0, 200) };
}

function chmodTree(p) {
  let st;
  try { st = fs.lstatSync(p); } catch { return; }
  if (st.isSymbolicLink()) return;
  try { fs.chmodSync(p, st.mode | (st.isDirectory() ? 0o700 : 0o600)); } catch { /* left as is */ }
  if (st.isDirectory()) for (const n of fs.readdirSync(p)) chmodTree(path.join(p, n));
}
function removeTree(p) { chmodTree(p); fs.rmSync(p, { recursive: true, force: true }); }

// One row's scratch: a folder of its own for the trees, shims, PATH folders and the row's TMPDIR.
function scratch(base) {
  const W = fs.mkdtempSync(path.join(base, "r-"));
  const ctx = {
    W,
    tree(name) { const d = path.join(W, `t_${name}`); fs.mkdirSync(path.join(d, "sub"), { recursive: true }); fs.writeFileSync(path.join(d, "sub", "a.txt"), "clean text\n"); return d; },
    shim(tool, tag, body) { const d = path.join(W, `shim_${tool}_${tag}`); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, tool), `#!/bin/sh\n${body}\n`, { mode: 0o755 }); return d; },
    pathWithout(miss) {
      const d = path.join(W, `path_without_${miss}`); fs.mkdirSync(d, { recursive: true });
      for (const dir of ["/usr/bin", "/bin", "/usr/sbin", "/sbin"]) {
        let names = [];
        try { names = fs.readdirSync(dir); } catch { continue; }
        for (const n of names) {
          const f = path.join(dir, n);
          let st;
          try { st = fs.statSync(f); } catch { continue; }
          if (st.isDirectory() || (st.mode & 0o111) === 0 || n === miss || fs.existsSync(path.join(d, n))) continue;
          try { fs.symlinkSync(f, path.join(d, n)); } catch { /* a name seen twice */ }
        }
      }
      return d;
    },
    write(p, data) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); },
    pathFirst(dir) { return `export PATH=${sq(dir)}:"$PATH"`; },
  };
  return ctx;
}

// The 70 rows of probes/matrix.sh, in its order. Each returns the ROOT to scan and, where the row has them, the commands to run in the
// child before the call (pre), a check afterwards (post) and the exact list of reported files (out), or the caller's set -f state.
const tok = (c, file) => c.write(file, `${TOK_AKIA}\n`);
const ROWS = [
  ["A01_clean", "0", (c) => ({ root: c.tree("clean") })],
  ...TOKS.map((t, i) => [`A02_family_${i + 1}`, "1", (c) => { const T = c.tree(`fam${i + 1}`); c.write(path.join(T, "sub", "f.txt"), `x ${t} y\n`); return { root: T }; }]),
  ["A03_nul_at_byte_0", "1", (c) => { const T = c.tree("nul0"); c.write(path.join(T, "sub", "b.bin"), `\0${TOK_AKIA}\n`); return { root: T }; }],
  ["A04_nul_70000_bytes_then_token", "1", (c) => { const T = c.tree("nulfar"); c.write(path.join(T, "sub", "b.bin"), Buffer.concat([Buffer.alloc(70000), Buffer.from(`\n${TOK_AKIA}\n`)])); return { root: T }; }],
  ["A05_token_after_nul_same_line", "1", (c) => { const T = c.tree("nulline"); c.write(path.join(T, "sub", "b.bin"), `x\0y ${TOK_AKIA}\n`); return { root: T }; }],
  ["A06_invalid_utf8_around", "1", (c) => { const T = c.tree("badutf"); c.write(path.join(T, "sub", "b.txt"), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(TOK_AKIA), Buffer.from([0x80, 0x0a])])); return { root: T }; }],
  ["A07_crlf_and_no_final_newline", "1", (c) => { const T = c.tree("crlf"); c.write(path.join(T, "sub", "c.txt"), `${TOK_AKIA}\r\n`); c.write(path.join(T, "sub", "n.txt"), TOK_AKIA); return { root: T }; }],
  ["A08_odd_names_6", "1", (c) => { const T = c.tree("names"); for (const n of ["a b.txt", "q'\"x.txt", "$(id).txt", "-lead.txt", "\u00fc\u00f1\u00ed.txt", "back\\slash.txt"]) tok(c, path.join(T, "sub", n)); return { root: T }; }],
  ["A09_newline_in_matching_name", "N", (c) => { const T = c.tree("nlname"); tok(c, path.join(T, "sub", "x\ny.txt")); return { root: T }; }],
  ["A10_GREP_OPTIONS_exclude_all", "1", (c) => { const T = c.tree("go1"); tok(c, path.join(T, "sub", "f.txt")); return { root: T, pre: 'export GREP_OPTIONS="--exclude=*"' }; }],
  ["A11a_GREP_OPTIONS_v_clean", "0", (c) => ({ root: c.tree("go2"), pre: "export GREP_OPTIONS=-v" })],
  ["A11b_GREP_OPTIONS_v_token", "1", (c) => { const T = c.tree("go3"); tok(c, path.join(T, "sub", "f.txt")); return { root: T, pre: "export GREP_OPTIONS=-v" }; }],
  ["A12_GREP_OPTIONS_binary_without_match", "1", (c) => { const T = c.tree("go4"); c.write(path.join(T, "sub", "b.bin"), `\0${TOK_AKIA}\n`); return { root: T, pre: "export GREP_OPTIONS=--binary-files=without-match" }; }],
  ["A13_env_not_on_PATH", "2", (c) => { const T = c.tree("e1"); tok(c, path.join(T, "sub", "f.txt")); return { root: T, pre: `export PATH=${sq(c.pathWithout("env"))}` }; }],
  ["A14_env_exits_1_silent", "2", (c) => { const S = c.shim("env", "exit1", "exit 1"); const T = c.tree("e2"); tok(c, path.join(T, "sub", "f.txt")); return { root: T, pre: c.pathFirst(S) }; }],
  ["A15_env_exits_0_silent", "2", (c) => ({ root: c.tree("e3"), pre: c.pathFirst(c.shim("env", "exit0", "exit 0")) })],
  ["A16_env_exits_127", "2", (c) => ({ root: c.tree("e4"), pre: c.pathFirst(c.shim("env", "exit127", "exit 127")) })],
  ["A17_env_dies_SIGSEGV", "2", (c) => ({ root: c.tree("e5"), pre: c.pathFirst(c.shim("env", "segv", "kill -SEGV $$")) })],
  ["A18_grep_not_on_PATH", "2", (c) => { const T = c.tree("g1"); tok(c, path.join(T, "sub", "f.txt")); return { root: T, pre: `export PATH=${sq(c.pathWithout("grep"))}` }; }],
  ["A19_grep_exits_1_silent", "2", (c) => { const S = c.shim("grep", "exit1", "exit 1"); const T = c.tree("g2"); tok(c, path.join(T, "sub", "f.txt")); return { root: T, pre: c.pathFirst(S) }; }],
  ["A20_grep_exits_0_silent", "2", (c) => ({ root: c.tree("g3"), pre: c.pathFirst(c.shim("grep", "exit0", "exit 0")) })],
  ["A21_grep_exits_2", "2", (c) => ({ root: c.tree("g4"), pre: c.pathFirst(c.shim("grep", "exit2", "exit 2")) })],
  ["A22_grep_skips_binary_files", "2", (c) => ({ root: c.tree("g5"), pre: c.pathFirst(c.shim("grep", "skipbin", `n=$#; for a do [ "$a" = -a ] && a=-I; set -- "$@" "$a"; done; shift $n; exec ${sq(REAL_GREP)} "$@"`)) })],
  ["A24a_function_env_returns_1", "1", (c) => { const T = c.tree("fn1"); tok(c, path.join(T, "sub", "f.txt")); return { root: T, pre: "env() { return 1; }; export -f env" }; }],
  ["A24b_function_grep_returns_1", "1", (c) => { const T = c.tree("fn2"); tok(c, path.join(T, "sub", "f.txt")); return { root: T, pre: "grep() { return 1; }; export -f grep" }; }],
  ["A25_unreadable_file", "2", (c) => { const T = c.tree("unread"); c.write(path.join(T, "sub", "u.txt"), "x\n"); fs.chmodSync(path.join(T, "sub", "u.txt"), 0o000); return { root: T, unreadable: true }; }],
  ["A26_unreadable_folder", "2", (c) => { const T = c.tree("unreaddir"); c.write(path.join(T, "sub", "d", "u.txt"), "x\n"); fs.chmodSync(path.join(T, "sub", "d"), 0o000); return { root: T, unreadable: true }; }],
  ["A27_symlink_in_tree", "2", (c) => { const T = c.tree("link"); tok(c, path.join(c.W, "outside.txt")); fs.symlinkSync(path.join(c.W, "outside.txt"), path.join(T, "sub", "l.txt")); return { root: T }; }],
  ["A28_fifo_in_tree", "2", (c) => { const T = c.tree("fifo"); const r = spawnSync("mkfifo", [path.join(T, "sub", "p")]); assert.strictEqual(r.status, 0, "mkfifo"); return { root: T }; }],
  ["A29_missing_root", "2", (c) => ({ root: path.join(c.W, "does_not_exist") })],
  ["A30_root_is_a_symlink", "2", (c) => { const T = c.tree("rootlink"); fs.symlinkSync(T, path.join(c.W, "rootlink")); return { root: path.join(c.W, "rootlink") }; }],
  ["A31_root_with_trailing_slashes", "1", (c) => { const T = c.tree("slash"); tok(c, path.join(T, "sub", "f.txt")); return { root: `${T}//` }; }],
  ["A32_empty_tree", "0", (c) => { const T = path.join(c.W, "t_empty"); fs.mkdirSync(T); return { root: T }; }],
  ["A33_no_canaries", "2", (c) => ({ root: c.tree("nocan"), pre: "NOCAN=1" })],
  ["A34_canary_the_pattern_misses", "2", (c) => ({ root: c.tree("badcan"), pre: 'CAN+=( "AKIA""CANARY" )' })],
  ["A35_pattern_branch_broken", "2", (c) => { const T = c.tree("mutpat"); tok(c, path.join(T, "sub", "f.txt")); return { root: T, pre: 'set -- "$1" "$2" "${3/AKIA\\[0-9A-Z\\]\\{16\\}/AKIA[0-9A-Z]{61}}"' }; }],
  ["A36a_mktemp_fails", "2", (c) => ({ root: c.tree("tmpd1"), pre: c.pathFirst(c.shim("mktemp", "fail", "exit 1")) })],
  ["A36b_mktemp_prints_nothing", "2", (c) => ({ root: c.tree("tmpd2"), pre: c.pathFirst(c.shim("mktemp", "silent", "exit 0")) })],
  ["A36c_mktemp_prints_a_missing_folder", "2", (c) => ({ root: c.tree("tmpd3"), pre: c.pathFirst(c.shim("mktemp", "ghost", "echo /no/such/dir")) })],
  ["A41_find_not_on_PATH", "2", (c) => ({ root: c.tree("f1"), pre: `export PATH=${sq(c.pathWithout("find"))}` })],
  ["A42_find_exits_0_silent_with_a_link", "2", (c) => { const S = c.shim("find", "exit0", "exit 0"); const T = c.tree("f2"); tok(c, path.join(c.W, "outside.txt")); fs.symlinkSync(path.join(c.W, "outside.txt"), path.join(T, "sub", "l2.txt")); return { root: T, pre: c.pathFirst(S) }; }],
  ["A43_find_exits_1", "2", (c) => ({ root: c.tree("f3"), pre: c.pathFirst(c.shim("find", "exit1", "exit 1")) })],
  ["A44_ln_not_on_PATH", "2", (c) => ({ root: c.tree("l1"), pre: `export PATH=${sq(c.pathWithout("ln"))}` })],
  ["A45_grep_reports_then_exits_1", "2", (c) => ({ root: c.tree("g6"), pre: c.pathFirst(c.shim("grep", "thenexit1", `${sq(REAL_GREP)} "$@"; exit 1`)) })],
  ["A46_grep_prints_a_stray_line", "2", (c) => ({ root: c.tree("g7"), pre: c.pathFirst(c.shim("grep", "strayline", `${sq(REAL_GREP)} "$@"; st=$?; echo /elsewhere/stray.txt; exit $st`)) })],
  ["A47_mktemp_prints_an_existing_folder", "2", (c) => {
    const V = path.join(c.W, "decoy"); c.write(path.join(V, "precious.txt"), "keep\n"); c.write(path.join(V, "inner", "x"), "keep\n");
    return { root: c.tree("mk1"), pre: c.pathFirst(c.shim("mktemp", "decoy", `echo ${sq(V)}`)), post: () => fs.existsSync(path.join(V, "precious.txt")) && fs.existsSync(path.join(V, "inner", "x")) && !fs.existsSync(path.join(V, "text1")) };
  }],
  ["A48_mkdir_not_on_PATH", "2", (c) => ({ root: c.tree("mk2"), pre: `export PATH=${sq(c.pathWithout("mkdir"))}` })],
  ["A49_mkdir_exits_0_making_nothing", "2", (c) => ({ root: c.tree("mk3"), pre: c.pathFirst(c.shim("mkdir", "silent", "exit 0")) })],
  ["A50_relative_ROOT_named_-d_holding_a_link", "2", (c) => {
    const D2 = path.join(c.W, "dashroot"); fs.mkdirSync(path.join(D2, "-d"), { recursive: true }); tok(c, path.join(c.W, "outside_dash.txt"));
    fs.symlinkSync(path.join(c.W, "outside_dash.txt"), path.join(D2, "-d", "l.txt"));
    return { root: "-d", pre: `cd ${sq(D2)}` };
  }],
  ["A51_relative_ROOT", "2", (c) => { const D3 = path.join(c.W, "relroot"); c.write(path.join(D3, "sub", "a.txt"), "clean\n"); return { root: "sub", pre: `cd ${sq(D3)}` }; }],
  ["A52_hidden_skipping_grep_token_in_.env", "2", (c) => { const S = c.shim("grep", "skiphidden", `exec ${sq(REAL_GREP)} --exclude='.*' --exclude-dir='.*' "$@"`); const T = c.tree("hid1"); tok(c, path.join(T, "sub", ".env")); return { root: T, pre: c.pathFirst(S) }; }],
  ["A53_token_in_a_hidden_folder", "1", (c) => { const T = c.tree("hid2"); tok(c, path.join(T, ".cfg", "k")); return { root: T }; }],
  ["A54_mktemp_prints_a_relative_name", "2", (c) => {
    const D4 = path.join(c.W, "relname"); fs.mkdirSync(D4); const S = c.shim("mktemp", "relname", "echo relcanary");
    return { root: c.tree("mk4"), pre: `cd ${sq(D4)}; ${c.pathFirst(S)}`, post: () => fs.readdirSync(D4).length === 0 };
  }],
  ["A55_TMPDIR_relative", "2", (c) => ({ root: c.tree("mk5"), pre: "export TMPDIR=reltmp" })],
  ["A56_canary_folder_removed_when_grep_fails_late", "2", (c) => ({ root: c.tree("mk6"), pre: c.pathFirst(c.shim("grep", "exit2late", `${sq(REAL_GREP)} "$@"; exit 2`)) })],
  ["A57_clean_file_with_a_newline_in_its_name", "0", (c) => { const T = c.tree("nlclean"); c.write(path.join(T, "sub", "x\ny.txt"), "clean\n"); return { root: T }; }],
  ["A58_glob_characters_in_matching_names_beside_siblings", "1", (c) => {
    const T = c.tree("glob1"); for (const n of ["a[b]", "q?", "s*"]) tok(c, path.join(T, "sub", n)); for (const n of ["ab", "qz", "sz"]) c.write(path.join(T, "sub", n), "clean\n");
    return { root: T, out: ["a[b]", "q?", "s*"].map((n) => path.join(T, "sub", n)) };
  }],
  ["A59_glob_name_and_the_caller_under_nullglob", "1", (c) => { const T = c.tree("glob2"); tok(c, path.join(T, "sub", "a[b]")); return { root: T, pre: "shopt -s nullglob", out: [path.join(T, "sub", "a[b]")] }; }],
  ["A60_direct_call_the_caller_keeps_globbing", "0", (c) => ({ root: c.tree("direct1"), pre: "DIRECT=1", noglob: "noglob=off" })],
  ["A61_direct_call_the_caller_keeps_set_-f", "0", (c) => ({ root: c.tree("direct2"), pre: "DIRECT=1; set -f", noglob: "noglob=on" })],
  ["A37_caller_locale_tr_TR", "1", (c) => { const T = c.tree("loc"); tok(c, path.join(T, "sub", "f.txt")); return { root: T, pre: "export LC_ALL=tr_TR.UTF-8 LANG=tr_TR.UTF-8" }; }],
  ["A38_POSIXLY_CORRECT", "1", (c) => { const T = c.tree("posix"); tok(c, path.join(T, "sub", "f.txt")); return { root: T, pre: "export POSIXLY_CORRECT=1" }; }],
  ["A39_20MB_random_then_token", "1", (c) => {
    const T = c.tree("big"); const r = crypto.randomBytes(20000000); const keep = Buffer.alloc(r.length); let n = 0;
    for (const b of r) if (!((b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a) || (b >= 0x30 && b <= 0x39) || b === 0x5f || b === 0x2d)) keep[n++] = b;
    c.write(path.join(T, "sub", "big.bin"), Buffer.concat([keep.subarray(0, n), Buffer.from(`\n${TOK_AKIA}\n`)])); return { root: T };
  }],
  ["A40_20MB_random_no_token", "0", (c) => { const T = c.tree("rnd"); c.write(path.join(T, "sub", "rand.bin"), crypto.randomBytes(20000000)); return { root: T }; }],
];
assert.strictEqual(ROWS.length, 70, "probes/matrix.sh has 70 rows");

// One row, in one shell, against one helper. The verdict follows probes/matrix.sh: the expected status (N = anything but 0), nothing
// left in the row's TMPDIR, its post check and its exact list of reported files where it has them.
function runRow(base, shell, helper, [id, expect, setup]) {
  const c = scratch(base);
  const td = path.join(c.W, "tmpd"); fs.mkdirSync(td);
  const cwd = path.join(c.W, "cwd"); fs.mkdirSync(cwd);
  const row = setup(c);
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(shell, ["-c", CHILD, "_", helper, row.root, DANGEROUS, row.pre || "", td], { cwd, env: CHILD_ENV, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let out = ""; let err = ""; let timedOut = false;
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    const kill = () => { try { process.kill(-child.pid, "SIGKILL"); } catch { /* the group is gone */ } };
    const timer = setTimeout(() => { timedOut = true; kill(); }, ROW_TIMEOUT_MS);
    child.on("close", () => {
      clearTimeout(timer); kill();
      const ms = Date.now() - started;
      let st = "timeout-or-died"; let reported = "";
      if (!timedOut && out.includes("|")) { st = out.slice(0, out.indexOf("|")); reported = out.slice(out.indexOf("|") + 1); }
      let ok = false;
      if (expect === "N") ok = st !== "0"; else ok = st === expect;
      chmodTree(td);
      const left = fs.readdirSync(td);
      if (left.length) ok = false;
      let post = "";
      if (row.post) { post = row.post() ? "POST=ok" : "POST=bad"; if (post !== "POST=ok") ok = false; }
      if (row.out) {
        const got = reported.split(";").filter((s) => s !== "").sort();
        if (JSON.stringify(got) !== JSON.stringify([...row.out].sort())) ok = false;
      }
      if (row.noglob && reported !== row.noglob) ok = false;
      removeTree(c.W);
      resolve({ id, expect, st, ok, ms, timedOut, left, post, reported: reported.slice(0, 300), stderr: err.slice(0, 200) });
    });
  });
}

// The helper's mutants, as probes/mutants.py gives them.
const G = 'out="$(command env -i PATH="$PATH" LC_ALL=C grep -R -a -l -E -e "$pattern" -- "$dir" "$root")" || status=$?';
const MUTANTS = [
  ["M01", "grep status ignored (|| true)", G, G.replace("|| status=$?", "|| true"), ["A25_unreadable_file", "A45_grep_reports_then_exits_1", "A56_canary_folder_removed_when_grep_fails_late"]],
  ["M02", "-a becomes -I", G, G.replace(" -a ", " -I "), ["A01_clean", "A02_family_1", "A03_nul_at_byte_0"]],
  ["M03", "env keeps the caller environment", G, G.replace('env -i PATH="$PATH" ', "env "), ["A10_GREP_OPTIONS_exclude_all", "A11a_GREP_OPTIONS_v_clean", "A11b_GREP_OPTIONS_v_token"]],
  ["M04", "plain env, functions not bypassed", G, G.replace("command env", "env"), ["A24a_function_env_returns_1"]],
  ["M05", "a missing canary is accepted", '        echo "bundle_scan_tree: canary not reported: $canary" >&2\n        return 2', '        echo "bundle_scan_tree: canary not reported: $canary" >&2\n        :', ["A15_env_exits_0_silent", "A20_grep_exits_0_silent", "A22_grep_skips_binary_files", "A34_canary_the_pattern_misses", "A35_pattern_branch_broken", "A52_hidden_skipping_grep_token_in_.env"]],
  ["M06", "grep status 1 accepted", '  if [ "$status" -ne 0 ]; then\n    echo "bundle_scan_tree: grep did not', '  if [ "$status" -gt 1 ]; then\n    echo "bundle_scan_tree: grep did not', ["A45_grep_reports_then_exits_1"]],
  ["M07", "folder check removed", '  if [ "$status" -ne 0 ] || [ "$odd" != "$dir/link" ]; then', "  if false; then", ["A27_symlink_in_tree", "A28_fifo_in_tree", "A41_find_not_on_PATH", "A42_find_exits_0_silent_with_a_link", "A43_find_exits_1"]],
  ["M08", "folder check accepts silence", '  if [ "$status" -ne 0 ] || [ "$odd" != "$dir/link" ]; then', '  if [ "$status" -ne 0 ] || { [ -n "$odd" ] && [ "$odd" != "$dir/link" ]; }; then', ["A42_find_exits_0_silent_with_a_link"]],
  ["M09", "unexpected grep output accepted", '        echo "bundle_scan_tree: unexpected grep output" >&2\n        return 2', "        :", ["A46_grep_prints_a_stray_line"]],
  ["M10", "no NUL canary", '    expect+=("$dir/text$i" "$dir/nul$i")', '    expect+=("$dir/text$i")', ["A22_grep_skips_binary_files"]],
  ["M11", "findings dropped", '        found+=("$line")\n        nfound=$((nfound + 1))', "        :", ["A02_family_1", "A03_nul_at_byte_0", "A04_nul_70000_bytes_then_token"]],
  ["M12", "findings return 0", "    printf '%s\\n' \"${found[@]}\"\n    return 1", "    printf '%s\\n' \"${found[@]}\"\n    return 0", ["A02_family_1", "A03_nul_at_byte_0", "A04_nul_70000_bytes_then_token"]],
  ["M13", "-R dropped", G, G.replace(" -R ", " "), ["A01_clean", "A02_family_1", "A03_nul_at_byte_0"]],
  ["M14", "-l dropped", G, G.replace(" -l ", " "), ["A01_clean", "A02_family_1", "A03_nul_at_byte_0"]],
  ["M15", "trailing slashes kept", '  while [ "${#root}" -gt 1 ] && [ "${root%/}" != "$root" ]; do\n    root="${root%/}"\n  done', "", ["A31_root_with_trailing_slashes"]],
  ["M16", "root link check dropped", '  if [ ! -d "$root" ] || [ -L "$root" ]; then', '  if [ ! -d "$root" ]; then', null, ["A29_missing_root", "A30_root_is_a_symlink"]],
  ["M17", "canary dir dropped from grep", G, G.replace('-- "$dir" "$root"', '-- "$root"'), ["A01_clean", "A02_family_1", "A03_nul_at_byte_0"]],
  ["M18", "LC_ALL=C dropped", G, G.replace("LC_ALL=C ", ""), null, ["A10_GREP_OPTIONS_exclude_all", "A11a_GREP_OPTIONS_v_clean", "A11b_GREP_OPTIONS_v_token", "A12_GREP_OPTIONS_binary_without_match", "A37_caller_locale_tr_TR", "A38_POSIXLY_CORRECT"]],
  ["M19", "argument count check dropped", '  if [ "$#" -lt 3 ] || [ -z "$root" ] || [ -z "$pattern" ]; then', '  if [ -z "$root" ] || [ -z "$pattern" ]; then', ["A33_no_canaries"]],
  ["M20", "the canary folder's mkdir not checked", '  if ! mkdir -m 700 -- "$dir" || [ ! -d "$dir" ] || [ -L "$dir" ]; then', '  mkdir -m 700 -- "$dir" || :\n  if false; then', ["A47_mktemp_prints_an_existing_folder"]],
  ["M21", "a relative ROOT accepted", '  case "$root" in\n    /*) ;;', '  case "$root" in\n    *) ;;', ["A50_relative_ROOT_named_-d_holding_a_link", "A51_relative_ROOT"]],
  ["M22", "no hidden canary", '  expect+=("$dir/.hidden/.text")', "", ["A52_hidden_skipping_grep_token_in_.env"]],
  ["M23", "the canary folder not removed after grep", '  rm -rf "$dir"\n  if [ "$status" -ne 0 ]; then\n    echo "bundle_scan_tree: grep did not', '  if [ "$status" -ne 0 ]; then\n    echo "bundle_scan_tree: grep did not', ["A01_clean", "A02_family_1", "A03_nul_at_byte_0"]],
  ["M24", "the canary folder's name not checked", '  case "$dir" in\n    /?*) ;;', '  case "$dir" in\n    *) ;;', ["A54_mktemp_prints_a_relative_name"]],
  ["M25", "the split's set -f dropped", "  set -f\n  IFS=$'\\n'", "  IFS=$'\\n'", ["A58_glob_characters_in_matching_names_beside_siblings", "A59_glob_name_and_the_caller_under_nullglob"]],
  ["M26", "the caller's globbing not restored", '  [ "$noglob" = 1 ] || set +f\n', "", ["A60_direct_call_the_caller_keeps_globbing"]],
];
assert.strictEqual(MUTANTS.length, 26, "probes/mutants.py has 26 mutants");

// The shells: the bash found on PATH, and /bin/bash where that is a different bash.
function shells() {
  const list = [];
  const onPath = sh("command -v bash");
  assert.ok(onPath, "bash is on PATH");
  const seen = new Set();
  for (const s of [onPath, "/bin/bash"]) {
    if (!fs.existsSync(s)) continue;
    const real = fs.realpathSync(s);
    if (seen.has(real)) continue;
    seen.add(real);
    const v = spawnSync(s, ["-c", 'printf %s "$BASH_VERSION"'], { encoding: "utf8", env: CHILD_ENV }).stdout;
    list.push({ path: s, label: `${s === onPath ? "bash on PATH" : "/bin/bash"} ${v}` });
  }
  return list;
}

// T1b: the bundle scripts, read as text. Pattern values and canary arrays are read by bash itself from their assignment lines.
const SCRIPTS = [
  ["scripts/make_review_bundle.sh", 3],
  ["scripts/make_demo_review_bundle.sh", 2],
  ["scripts/make_consumer_evidence_bundle.sh", 1],
  ["scripts/make_language_bundle.sh", 2],
];
const SOURCE_LINE = '. "$(CDPATH= cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/bundle_secret_scan.sh"';
const LANGUAGE_DIR_LINE = 'SCRIPT_DIR="$(CDPATH= cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"';
const PATTERN_NAMES = ["DANGEROUS", "SUSPICIOUS", "LOCAL_PATH_PATTERN", "LANGUAGE_SECRET_PATTERN", "EXPECTED_SECRET_LABEL_FILES"];
const LOCALE_ASSIGNMENT = /(^|[\s;|&(])(LC_[A-Z]+|LANG)=/;

function topLevelBranches(pattern) {
  let p = pattern;
  // A pattern wrapped whole in one group: its branches are that group's.
  const closes = (s) => { let depth = 0; for (let i = 0; i < s.length; i += 1) { const ch = s[i]; if (ch === "\\") { i += 1; continue; } if (ch === "[") { i = s.indexOf("]", i + 2); continue; } if (ch === "(") depth += 1; if (ch === ")") { depth -= 1; if (depth === 0) return i; } } return -1; };
  if (p.startsWith("(") && closes(p) === p.length - 1) p = p.slice(1, -1);
  const out = []; let depth = 0; let start = 0;
  for (let i = 0; i < p.length; i += 1) {
    const ch = p[i];
    if (ch === "\\") { i += 1; continue; }
    if (ch === "[") { i = p.indexOf("]", i + 2); continue; }
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "|" && depth === 0) { out.push(p.slice(start, i)); start = i + 1; }
  }
  out.push(p.slice(start));
  return out;
}

function readAssignments(shell, text, arrays, scalars) {
  const lines = text.split("\n");
  const picked = [];
  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i];
    if (/^SLASH="\/"$/.test(l)) picked.push(l);
    for (const n of scalars) if (l.startsWith(`${n}=`)) picked.push(l);
    for (const n of arrays) if (l === `${n}=(`) { let j = i; while (j < lines.length && lines[j] !== ")") j += 1; picked.push(...lines.slice(i, j + 1)); }
  }
  const prog = ['eval "$1"', ...scalars.map((n) => `printf '%s\\0' "\${${n}-<unset>}"`), ...arrays.map((n) => `printf '%s\\0' "\${#${n}[@]}"; printf '%s\\0' "\${${n}[@]}"`)].join("\n");
  const r = spawnSync(shell, ["-c", prog, "_", picked.join("\n")], { encoding: "utf8", env: CHILD_ENV });
  assert.strictEqual(r.status, 0, `bash read the assignments: ${r.stderr}`);
  const parts = r.stdout.split("\0"); parts.pop();
  const values = {};
  let k = 0;
  for (const n of scalars) values[n] = parts[k++];
  for (const n of arrays) { const count = Number(parts[k++]); values[n] = parts.slice(k, k + count); k += count; }
  return values;
}

function t1b(shell) {
  const checks = [];
  const check = (name, fn) => { try { fn(); checks.push({ name, ok: true }); } catch (e) { checks.push({ name, ok: false, detail: String(e && e.message).slice(0, 300) }); } };
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const helper = fs.readFileSync(HELPER, "utf8");
  check("helper: one grep call, under env -i with LC_ALL=C as env's argument, reading every byte (-a), with no -I, no || true and no 2>/dev/null", () => {
    const code = helper.split("\n").filter((l) => !/^\s*#/.test(l));
    const greps = code.filter((l) => /\bgrep -/.test(l));
    assert.strictEqual(greps.length, 1, `grep calls: ${greps.length}`);
    const g = greps[0];
    assert.ok(g.includes('command env -i PATH="$PATH" LC_ALL=C grep -R -a -l -E -e "$pattern" -- "$dir" "$root"'), g);
    for (const bad of [" -I", "|| true", "2>/dev/null", "--binary-files", "--exclude"]) assert.ok(!g.includes(bad), `${bad} in ${g}`);
    for (const l of code) if (LOCALE_ASSIGNMENT.test(l)) assert.ok(l === g && /env -i PATH="\$PATH" LC_ALL=C grep /.test(l), `a locale assignment in the shell: ${l.trim()}`);
  });
  for (const [rel, calls] of SCRIPTS) {
    const file = path.join(ROOT, rel);
    if (!fs.existsSync(file)) {
      check(`${rel}: absent, as in the public projection only`, () => assert.strictEqual(pkg.name, "@underskys/air-core", `${rel} is missing in ${pkg.name}`));
      continue;
    }
    const text = fs.readFileSync(file, "utf8");
    const lines = text.split("\n");
    const code = lines.filter((l) => !/^\s*#/.test(l));
    check(`${rel}: sources the helper once, from its own folder, before its first cd`, () => {
      const src = lines.map((l, i) => [l, i]).filter(([l]) => /^\.\s.*bundle_secret_scan\.sh"$/.test(l));
      assert.strictEqual(src.length, 1, `source lines: ${src.length}`);
      const firstCd = lines.findIndex((l) => /^cd\s/.test(l));
      assert.ok(firstCd === -1 || src[0][1] < firstCd, "the helper is sourced after the first cd");
      if (rel.endsWith("make_language_bundle.sh")) {
        assert.strictEqual(src[0][0], '. "$SCRIPT_DIR/bundle_secret_scan.sh"');
        const dirLine = lines.findIndex((l) => l.startsWith("SCRIPT_DIR="));
        assert.strictEqual(lines[dirLine], LANGUAGE_DIR_LINE);
        assert.ok(dirLine < src[0][1], "SCRIPT_DIR is set before the source line");
      } else assert.strictEqual(src[0][0], SOURCE_LINE);
    });
    const callLines = code.map((l, i) => [l, i]).filter(([l]) => /\bbundle_scan_tree "/.test(l));
    check(`${rel}: calls bundle_scan_tree ${calls} times, each status kept`, () => {
      assert.strictEqual(callLines.length, calls, `calls: ${callLines.length}`);
      for (const [l, i] of callLines) {
        const next = code[i + 1] || "";
        assert.ok(/^\)" \|\| [a-z_]+_status=\$\?$/.test(next), `the status after ${l.trim()}: ${next.trim()}`);
        for (const bad of ["|| true", "2>/dev/null", " -I"]) assert.ok(!l.includes(bad) && !next.includes(bad), `${bad} at ${l.trim()}`);
      }
    });
    check(`${rel}: each scan's captured status is tested (-ne 0) in an if that stops the script, before the script goes on`, () => {
      // Before the script goes on: before the next scan call, and before the line that makes the archive (zip or tar), whichever is first.
      const archive = /(^|[\s(|&;])(zip|tar) -/;
      assert.ok(callLines.length > 0, "no scan call");
      callLines.forEach(([l, i], k) => {
        const m = /^\)" \|\| ([a-z_]+_status)=\$\?$/.exec(code[i + 1] || "");
        assert.ok(m, `no status captured after ${l.trim()}`);
        const v = m[1];
        let end = k + 1 < callLines.length ? callLines[k + 1][1] : code.length;
        for (let j = i + 2; j < end; j += 1) if (archive.test(code[j])) { end = j; break; }
        const test = new RegExp(`^(\\s*)if \\[ "\\$${v}" -ne 0 \\]( (&&|\\|\\|) \\[ [^\\]]+ \\])?; then$`);
        let at = -1; let indent = "";
        for (let j = i + 2; j < end; j += 1) { const t = test.exec(code[j]); if (t) { at = j; indent = t[1]; break; } }
        assert.ok(at >= 0, `$${v} is not tested (-ne 0) before the script goes on, after ${l.trim()}`);
        let fi = -1;
        for (let j = at + 1; j < code.length; j += 1) if (code[j] === `${indent}fi`) { fi = j; break; }
        assert.ok(fi > at, `no fi closes the test of $${v}`);
        assert.ok(code.slice(at + 1, fi).some((x) => /^\s*exit [1-9][0-9]*\s*$/.test(x)), `the test of $${v} does not stop the script (no exit in its branch)`);
      });
    });
    check(`${rel}: no scan keeps grep (with -I, || true or 2>/dev/null) on a pattern`, () => {
      for (const l of code) {
        if (!/\bgrep\b/.test(l)) continue;
        const onPattern = PATTERN_NAMES.some((n) => l.includes(`$${n}`) || l.includes(`\${${n}}`)) || l.includes("PRIVATE KEY");
        assert.ok(!onPattern, `a grep scan line: ${l.trim()}`);
      }
    });
    check(`${rel}: no scan line assigns LC_ALL, LANG or LC_* in the shell`, () => {
      let inArray = false;
      for (const l of code) {
        if (/^[A-Z_]+_CANARIES=\($/.test(l)) inArray = true;
        const scanLine = inArray || /bundle_scan_tree|_CANARIES|_status|rel_label_file|label_file|danger_files|final_files|path_files|secret_files/.test(l) || PATTERN_NAMES.some((n) => l.includes(n));
        if (scanLine) assert.ok(!LOCALE_ASSIGNMENT.test(l), `a locale assignment on a scan line: ${l.trim()}`);
        if (inArray && l === ")") inArray = false;
      }
    });
    check(`${rel}: each canary array has one entry per top-level branch of its pattern, each matching that branch`, () => {
      const pairs = callLines.map(([l]) => { const m = /bundle_scan_tree "\$[A-Z_]+" "\$([A-Z_]+)" "\$\{([A-Z_]+)\[@\]\}"$/.exec(l.trim()); assert.ok(m, `call form: ${l.trim()}`); return [m[1], m[2]]; });
      const scalars = [...new Set(pairs.map((p) => p[0]))]; const arrays = [...new Set(pairs.map((p) => p[1]))];
      const v = readAssignments(shell, text, arrays, scalars);
      for (const [pat, arr] of pairs) {
        assert.ok(v[pat] && v[pat] !== "<unset>", `${pat} is set`);
        const branches = topLevelBranches(v[pat]); const can = v[arr];
        assert.strictEqual(can.length, branches.length, `${arr}: ${can.length} entries, ${pat}: ${branches.length} branches`);
        branches.forEach((b, i) => assert.ok(new RegExp(b).test(can[i]), `${arr}[${i}] does not match branch ${i + 1} of ${pat}`));
      }
    });
  }
  return checks;
}

async function main() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "air-bundle-scan-"));
  const results = { platform: process.platform, arch: process.arch, node: process.version, root: IS_ROOT, shells: [], rows: {}, mutants: {}, t1b: [] };
  let failed = 0;
  const helperText = fs.readFileSync(HELPER, "utf8");
  try {
    assert.ok(REAL_GREP, "grep is on PATH");
    const SH = shells();
    results.shells = SH.map((s) => s.label);
    for (const s of SH) {
      const rows = [];
      for (const r of ROWS) {
        if (IS_ROOT && (r[0] === "A25_unreadable_file" || r[0] === "A26_unreadable_folder")) {
          console.log(`ok - ${r[0]} (${s.label}): skipped, run as root, where an unreadable file or folder cannot fail`);
          rows.push({ id: r[0], skipped: "root" });
          continue;
        }
        const res = await runRow(base, s.path, HELPER, r);
        rows.push(res);
        if (res.ok) console.log(`ok - ${res.id} (${s.label}): expected ${res.expect}, got ${res.st}, TMPDIR empty${res.post ? `, ${res.post}` : ""}`);
        else { failed += 1; console.log(`not ok - ${res.id} (${s.label}): expected ${res.expect}, got ${res.st}${res.timedOut ? " (timed out)" : ""}, left [${res.left.join(" ")}] ${res.post} ${JSON.stringify(res.reported).slice(0, 160)} ${JSON.stringify(res.stderr).slice(0, 120)}`); }
      }
      results.rows[s.label] = rows;
    }
    const checks = t1b(SH[0].path);
    results.t1b = checks;
    for (const k of checks) {
      if (k.ok) console.log(`ok - T1b ${k.name}`);
      else { failed += 1; console.log(`not ok - T1b ${k.name}: ${k.detail}`); }
    }
    const byId = Object.fromEntries(ROWS.map((r) => [r[0], r]));
    const gopt = grepReadsOptions(base);
    results.grepOptions = gopt;
    if (gopt.reads === null) { failed += 1; console.log(`not ok - the grep on PATH (${REAL_GREP}) with GREP_OPTIONS=-v counted ${JSON.stringify(gopt.count)} lines of a one-line file, neither 0 nor 1 (status ${gopt.status}; ${JSON.stringify(gopt.stderr)}); M03 stays a mutant that must be caught`); }
    else console.log(`ok - the grep on PATH ${gopt.reads ? "reads" : "ignores"} GREP_OPTIONS (${REAL_GREP}, with GREP_OPTIONS=-v, counts ${gopt.count} of a one-line file): ${gopt.reads ? "M03 must be caught" : "M03 runs as an equivalent, as SPEC section 5 says of GNU grep 3.6 and later"}`);
    const m03Equivalent = gopt.reads === false;
    const plan = MUTANTS.map(([id, name, from, to, named, eqRows]) => (id === "M03" && m03Equivalent ? [id, name, from, to, null, named] : [id, name, from, to, named, eqRows]));
    let applied = 0; let ran = 0; let caught = 0; let equivalent = 0; const needCaught = plan.filter((m) => m[4]).length;
    for (const [id, name, from, to, named, eqRows] of plan) {
      const hits = helperText.split(from).length - 1;
      const entry = { name, hits, shells: {} };
      results.mutants[id] = entry;
      if (hits !== 1) { failed += 1; console.log(`not ok - mutant ${id} (${name}): not applied, its text occurs ${hits} times in the helper`); continue; }
      applied += 1;
      const mdir = fs.mkdtempSync(path.join(base, `m-${id}-`));
      const mfile = path.join(mdir, "helper.sh");
      fs.writeFileSync(mfile, helperText.replace(from, to));
      let allRan = true; let caughtEverywhere = true; let equivalentEverywhere = true;
      for (const s of SH) {
        const rowIds = (named || eqRows).filter((r) => !(IS_ROOT && (r === "A25_unreadable_file" || r === "A26_unreadable_folder")));
        const res = [];
        for (const r of rowIds) res.push(await runRow(base, s.path, mfile, byId[r]));
        const failing = res.filter((x) => !x.ok).map((x) => x.id);
        entry.shells[s.label] = { rows: rowIds, failing, timedOut: res.filter((x) => x.timedOut).map((x) => x.id) };
        if (!rowIds.length) allRan = false;
        if (named) { if (!failing.length) caughtEverywhere = false; } else if (failing.length) equivalentEverywhere = false;
      }
      removeTree(mdir);
      if (allRan) ran += 1;
      if (named) {
        if (caughtEverywhere && allRan) { caught += 1; console.log(`ok - mutant ${id} (${name}): applied, ran, caught in each shell by ${SH.map((s) => entry.shells[s.label].failing.join(",")).join(" | ")}`); }
        else { failed += 1; console.log(`not ok - mutant ${id} (${name}): not caught in every shell (${JSON.stringify(entry.shells).slice(0, 300)})`); }
      } else if (equivalentEverywhere && allRan) { equivalent += 1; console.log(`ok - mutant ${id} (${name}): applied, ran; equivalent ${id === "M03" ? "here, where the grep on PATH ignores GREP_OPTIONS (SPEC section 5)" : "as the specification shows"}, its rows ${eqRows.join(",")} keep their outcome in each shell`); }
      else { failed += 1; console.log(`not ok - mutant ${id} (${name}): shown equivalent by the specification, but its rows changed (${JSON.stringify(entry.shells).slice(0, 300)})`); }
    }
    results.totals = { rows: ROWS.length, shells: SH.length, failed, applied, ran, caught, needCaught, equivalent, m03Equivalent };
    const rowCount = (s) => results.rows[s.label].filter((x) => x.ok).length;
    const skipped = IS_ROOT ? "; A25 and A26 skipped as root" : "";
    const ranges = (ids) => {
      const n = ids.map((x) => Number(x.slice(1))); const out = [];
      for (let i = 0; i < n.length;) { let j = i; while (j + 1 < n.length && n[j + 1] === n[j] + 1) j += 1; const a = `M${String(n[i]).padStart(2, "0")}`; const b = `M${String(n[j]).padStart(2, "0")}`; out.push(j - i >= 2 ? `${a}-${b}` : j > i ? `${a}, ${b}` : a); i = j + 1; }
      return out.join(", ");
    };
    const caughtIds = plan.filter((m) => m[4]).map((m) => m[0]); const eqIds = plan.filter((m) => !m[4]).map((m) => m[0]);
    const m03Note = m03Equivalent ? "; M03 equivalent here: the grep on PATH ignores GREP_OPTIONS" : "";
    console.log(`SEC53-07 bundle secret scan (T1, T1b): matrix rows ${SH.map((s) => `${rowCount(s)} of ${ROWS.length} under ${s.label}`).join(", ")}${skipped}; T1b ${checks.filter((k) => k.ok).length} of ${checks.length} checks; helper mutants applied ${applied}, ran ${ran}, caught ${caught} of ${needCaught} (${ranges(caughtIds)}), equivalent ${equivalent} of ${eqIds.length} (${ranges(eqIds)})${m03Note} (${process.platform})`);
  } finally {
    if (RESULTS_DIR) { fs.mkdirSync(RESULTS_DIR, { recursive: true }); fs.writeFileSync(path.join(RESULTS_DIR, "bundle_secret_scan.results.json"), `${JSON.stringify(results, null, 1)}\n`); }
    removeTree(base);
  }
  if (failed) { console.log(`bundle secret scan test: ${failed} not ok`); process.exit(1); }
}

main().catch((e) => { console.log(`not ok - bundle secret scan test stopped: ${e && e.stack}`); process.exit(1); });
