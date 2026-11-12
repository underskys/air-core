#!/usr/bin/env node
"use strict";

// SCALAR F-1 installed-package gate (AIR_V053_SCALAR_F1_CORRECTION_SPEC_R4_2026_11_07
// §5.4, §6). It takes a consumer folder that holds an install of a packed
// tarball, runs the rows F1-P01 to F1-P07, F1-N01 to F1-N04 and records F1-R01,
// and exits non-zero on any failure.
//
// It loads the package only through createRequire in that folder and fails if
// any module was loaded from outside the folder's node_modules. The
// repository's own outputs, which F1-P01, F1-P03, F1-P04 and F1-P05 compare
// with, are computed in child processes from this script's checkout. With
// --baseline <folder holding an install of the I3 tarball>, F1-P05 also
// compares with that install's airc, as SPEC §6 states it.
//
// Usage: node scripts/v053_installed_surface_gate.js <consumer folder> [--out <result.json>] [--baseline <consumer folder>]
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createRequire } = require("node:module");

const PKG = "@underskys/air-core";
const REPO = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const consumerArg = args.find((arg, index) => !arg.startsWith("--") && !["--out", "--baseline"].includes(args[index - 1]));
const outIndex = args.indexOf("--out");
const OUT = outIndex >= 0 ? path.resolve(args[outIndex + 1]) : null;
const baselineIndex = args.indexOf("--baseline");
const BASELINE = baselineIndex >= 0 ? fs.realpathSync(path.resolve(args[baselineIndex + 1])) : null;
if (!consumerArg) {
  console.error("usage: node scripts/v053_installed_surface_gate.js <consumer folder> [--out <result.json>] [--baseline <consumer folder>]");
  process.exit(2);
}
const CONSUMER = fs.realpathSync(path.resolve(consumerArg));
const NODE_MODULES = path.join(CONSUMER, "node_modules");
const req = createRequire(path.join(CONSUMER, "package.json"));

const GATED = Object.freeze({ allowCandidateProfile: true, sourceProfile: "typed-v0.53" });
const NO_OPT_IN = Object.freeze({ sourceProfile: "typed-v0.53" });
const T2 = "module v53.vec\nexport func f(a: i32, b: i32) -> i32 {\n%o: i32 = i32.checked_add %a, %b\nreturn %o\n}\n";
const DESCRIPTOR = Object.freeze({
  air_abi_lane: "0.12",
  exports: [{ function: "f", name: "f", parameters: [{ name: "a", type: "i32" }, { name: "b", type: "i32" }], return_type: "i32" }],
  module_id: "v53.vec",
  schema: "air.typed-interface/0.12-candidate.1",
  types: []
});
const DISABLED = "air.source_profile.candidate_disabled";
const NOT_EXPORTED = "ERR_PACKAGE_PATH_NOT_EXPORTED";
const SEAM = /mintHarnessRecord|HARNESS_RECORDS/u;

const rows = [];
function row(id, check, pass, observed) {
  rows.push({ check, id, observed, status: pass ? "PASS" : "FAIL" });
}
function recorded(id, check, observed) {
  rows.push({ check, id, observed, status: "RECORDED" });
}
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
function codeOf(error) {
  return error && (error.code || (String(error.message).match(/(air\.[a-z0-9_.]+)/u) || [])[1] || error.name);
}
async function outcome(action) {
  try {
    return { ok: true, value: await action() };
  } catch (error) {
    return { code: codeOf(error), ok: false, reason: error && error.reason };
  }
}
function node(script, options = {}) {
  return childProcess.spawnSync(process.execPath, ["-e", script], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 120000, ...options });
}
function json(result, label) {
  if (result.status !== 0) throw new Error(`${label}: exit ${result.status}: ${result.stderr}`);
  return JSON.parse(result.stdout);
}
function cli(bin, cliArgs, cwd, input) {
  const result = childProcess.spawnSync(process.execPath, [bin, ...cliArgs], { cwd, encoding: "buffer", input: input || "", maxBuffer: 64 * 1024 * 1024, timeout: 120000 });
  return { code: (String(result.stderr).match(/(air\.[a-z0-9_.]+)/u) || [])[1] || "", signal: result.signal, status: result.status, stderr: result.stderr, stdout: result.stdout };
}
function walk(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full, base) : [path.relative(base, full)];
  }).sort();
}

(async () => {
  const pkgJson = req.resolve(`${PKG}/package.json`);
  const pkgRoot = path.dirname(pkgJson);
  const manifest = JSON.parse(fs.readFileSync(pkgJson, "utf8"));
  const installedBin = path.join(pkgRoot, "bin", "airc.js");
  const repoBin = path.join(REPO, "bin", "airc.js");
  const work = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "air-f1-gate-"));
  try {
    fs.writeFileSync(path.join(work, "t.air"), T2);

    // F1-P01: the root resolves inside the consumer and has the repository root's enumerable keys.
    const rootFile = req.resolve(PKG);
    const air = req(PKG);
    const keys = Object.keys(air).sort();
    const repoKeys = json(node(`process.stdout.write(JSON.stringify(Object.keys(require(${JSON.stringify(path.join(REPO, "src", "index.js"))})).sort()))`), "repository root keys");
    const leaked = keys.filter((key) => /typedV053|mintHarnessRecord/u.test(key));
    row("F1-P01", "the root resolves in the consumer's node_modules; its enumerable keys equal the repository root's; none names typedV053 or mintHarnessRecord",
      rootFile.startsWith(NODE_MODULES + path.sep) && JSON.stringify(keys) === JSON.stringify(repoKeys) && leaked.length === 0,
      { keys: keys.length, leaked, repository_keys: repoKeys.length, resolved: path.relative(CONSUMER, rootFile) });

    // F1-P02: ESM import of the root and of package.json.
    const esm = node(`Promise.all([import(${JSON.stringify(PKG)}), import(${JSON.stringify(`${PKG}/package.json`)}, { with: { type: "json" } })])
      .then(([root, pkg]) => process.stdout.write(JSON.stringify({ root: Object.keys(root).length, version: pkg.default.version })), (error) => process.stdout.write(JSON.stringify({ error: error.code || error.name })))`,
    { cwd: CONSUMER, input: "" });
    const esmOut = esm.status === 0 ? JSON.parse(esm.stdout) : { error: `exit ${esm.status}` };
    row("F1-P02", "ESM import() of the root and of package.json loads; version is the packed version",
      !esmOut.error && esmOut.version === manifest.version && esmOut.root > 0, { ...esmOut, packed_version: manifest.version });

    // F1-P03: typed-v0.53 with the opt-in, through the root; WAT and wasm equal the repository's.
    const ast = air.parseSource(T2, "t.air", GATED);
    const verified = await outcome(() => air.verifySource(ast, GATED));
    const formatted = await outcome(() => air.formatSource(ast, GATED));
    const built = await air.buildVerifiedTypedModule({ ...GATED, descriptor: DESCRIPTOR, source: T2 });
    const sum = await air.invokeVerifiedTypedExport(built, "f", [2, 3]);
    const overflow = await outcome(() => air.invokeVerifiedTypedExport(built, "f", [2147483647, 1]));
    const overflowSeen = overflow.ok ? overflow.value : { code: overflow.code, reason: overflow.reason };
    const wat = air.lowerToWat(ast, { allowCandidateProfile: true });
    const wasm = Buffer.from(air.inspectVerifiedTypedBuild(built).wasmBytes);
    const repo = json(node(`(async () => {
      const air = require(${JSON.stringify(path.join(REPO, "src", "index.js"))});
      const g = ${JSON.stringify(GATED)};
      const ast = air.parseSource(${JSON.stringify(T2)}, "t.air", g);
      const built = await air.buildVerifiedTypedModule({ ...g, descriptor: ${JSON.stringify(DESCRIPTOR)}, source: ${JSON.stringify(T2)} });
      const wasm = Buffer.from(air.inspectVerifiedTypedBuild(built).wasmBytes);
      const crypto = require("node:crypto");
      process.stdout.write(JSON.stringify({ format: air.formatSource(ast, g), wasm: crypto.createHash("sha256").update(wasm).digest("hex"), wat: air.lowerToWat(ast, { allowCandidateProfile: true }) }));
    })().catch((e) => { console.error(e && e.stack); process.exit(1); });`), "repository typed-v0.53 outputs");
    const overflowCode = overflowSeen && (overflowSeen.code || (overflowSeen.failure && overflowSeen.failure.code));
    const overflowReason = overflowSeen && (overflowSeen.reason || (overflowSeen.failure && overflowSeen.failure.reason));
    row("F1-P03", "with the opt-in: parseSource, verifySource, formatSource, build + invoke f(2, 3) = 5 and 2147483647 + 1 overflows, lowerToWat; WAT and wasm equal the repository's",
      verified.ok && formatted.ok && formatted.value === repo.format && sum.value === 5 && wat === repo.wat && sha256(wasm) === repo.wasm &&
        JSON.stringify(overflowSeen).includes("air.numeric.checked_failure") && JSON.stringify(overflowSeen).includes("overflow"),
      { f_2_3: sum.value, format_equal: formatted.value === repo.format, overflow: overflowSeen, overflow_code: overflowCode || null, overflow_reason: overflowReason || null, wasm_equal: sha256(wasm) === repo.wasm, wasm_sha256: sha256(wasm), wat_bytes: Buffer.byteLength(wat), wat_equal: wat === repo.wat });

    // F1-P04: the installed airc with the opt-in equals the repository's CLI, byte for byte.
    const p04 = {};
    let p04ok = true;
    const tp = ["--source-profile", "typed-v0.53", "--allow-candidate-profile"];
    for (const [label, cliArgs, output] of [
      ["verify", ["verify", "t.air", ...tp]],
      ["format", ["format", "t.air", ...tp]],
      ["build --emit wat", ["build", "t.air", ...tp, "--emit", "wat", "-o", "OUT.wat"], "OUT.wat"],
      ["build --emit wasm", ["build", "t.air", ...tp, "--emit", "wasm", "-o", "OUT.wasm"], "OUT.wasm"]]) {
      const take = (bin) => {
        const result = cli(bin, cliArgs.map((arg) => arg.replace("OUT", "out")), work);
        const file = output ? path.join(work, output.replace("OUT", "out")) : null;
        const bytes = file && fs.existsSync(file) ? fs.readFileSync(file) : Buffer.alloc(0);
        if (file) fs.rmSync(file, { force: true });
        return { file: sha256(bytes), status: result.status, stdout: sha256(result.stdout) };
      };
      const a = take(installedBin);
      const b = take(repoBin);
      const same = a.status === 0 && b.status === 0 && a.stdout === b.stdout && a.file === b.file;
      if (!same) p04ok = false;
      p04[label] = { equal: same, installed_exit: a.status, repository_exit: b.status };
    }
    row("F1-P04", "the installed airc with --allow-candidate-profile: verify, format, build --emit wat and --emit wasm exit 0 and equal the repository CLI's, byte for byte", p04ok, p04);

    // F1-P05: legacy-v0.50 and typed-v0.51 samples through verify and build equal the repository CLI's,
    // and the baseline install's when --baseline names one.
    const baselineBin = BASELINE ? path.join(BASELINE, "node_modules", ...PKG.split("/"), "bin", "airc.js") : null;
    const samples = [
      ["legacy-v0.50", path.join(REPO, "examples", "grep.air"), []],
      ["typed-v0.51", path.join(REPO, "fixtures", "v051", "first_vertical", "typed_decide.air"), ["--source-profile", "typed-v0.51"]]];
    const p05 = {};
    let p05ok = true;
    for (const [profile, file, profileArgs] of samples) {
      for (const [label, cliArgs, output] of [
        ["verify", ["verify", file, ...profileArgs]],
        ["build", ["build", file, ...profileArgs, "-o", "OUT"], "OUT"]]) {
        const take = (bin) => {
          const result = cli(bin, cliArgs.map((arg) => (arg === "OUT" ? "sample.out" : arg)), work);
          const target = output ? path.join(work, "sample.out") : null;
          const bytes = target && fs.existsSync(target) ? fs.readFileSync(target) : Buffer.alloc(0);
          if (target) fs.rmSync(target, { force: true });
          return { file: sha256(bytes), status: result.status, stdout: sha256(result.stdout) };
        };
        const a = take(installedBin);
        const b = take(repoBin);
        const c = baselineBin ? take(baselineBin) : null;
        const same = a.status === 0 && b.status === 0 && a.stdout === b.stdout && a.file === b.file &&
          (!c || (c.status === 0 && a.stdout === c.stdout && a.file === c.file));
        if (!same) p05ok = false;
        p05[`${profile} ${label}`] = { equal: same, installed_exit: a.status, repository_exit: b.status, ...(c ? { baseline_exit: c.status } : {}), file_sha256: a.file, stdout_sha256: a.stdout };
      }
    }
    row("F1-P05", `legacy-v0.50 and typed-v0.51 samples through verify and build equal the repository CLI's${BASELINE ? " and the baseline install's" : ""}, byte for byte`, p05ok,
      { ...p05, baseline: BASELINE });

    // F1-P06: AIR Studio's pattern: bin/airc.js by path, package.json read with fs.
    const byPath = cli(path.join(NODE_MODULES, ...PKG.split("/"), "bin", "airc.js"), ["version", "--json"], work);
    const pkgByFs = JSON.parse(fs.readFileSync(path.join(NODE_MODULES, ...PKG.split("/"), "package.json"), "utf8"));
    row("F1-P06", "node_modules/@underskys/air-core/bin/airc.js runs by path; its package.json reads with fs",
      byPath.status === 0 && pkgByFs.name === PKG, { bin_exit: byPath.status, package: `${pkgByFs.name}@${pkgByFs.version}` });

    // F1-P07: airc migrate of V53-MIG-P01's input gives the I3 output and record.
    const migDir = path.join(REPO, "fixtures", "v053", "migration");
    const p01 = fs.readdirSync(migDir).find((name) => name.startsWith("V53-MIG-P01_"));
    const input = path.join(migDir, p01, "input.air");
    const migrated = cli(installedBin, ["migrate", input, "-o", path.join(work, "migrated.air"), "--record", path.join(work, "migrated.record.json")], work);
    const outputEqual = migrated.status === 0 && fs.readFileSync(path.join(work, "migrated.air")).equals(fs.readFileSync(path.join(migDir, p01, "expected.air")));
    const recordEqual = migrated.status === 0 && fs.readFileSync(path.join(work, "migrated.record.json")).equals(fs.readFileSync(path.join(migDir, p01, "expected.record.json")));
    row("F1-P07", "airc migrate of V53-MIG-P01's input.air exits 0 with the I3 output and record (OD-F1-4 (a))", outputEqual && recordEqual,
      { exit: migrated.status, output_equal: outputEqual, record_equal: recordEqual });

    // F1-N01: every src/*.js and bin/airc.js by package name is refused.
    const specifiers = [...fs.readdirSync(path.join(pkgRoot, "src")).filter((file) => file.endsWith(".js")).map((file) => `src/${file}`), "bin/airc.js"]
      .flatMap((file) => [`${PKG}/${file}`, `${PKG}/${file.replace(/\.js$/u, "")}`]);
    const n01 = { esm: {}, require: {}, resolve: {} };
    for (const specifier of specifiers) {
      try { req.resolve(specifier); n01.resolve[specifier] = "resolves"; } catch (error) { n01.resolve[specifier] = error.code; }
      try { req(specifier); n01.require[specifier] = "loads"; } catch (error) { n01.require[specifier] = error.code; }
    }
    const esmRun = node(`Promise.all(${JSON.stringify(specifiers)}.map((s) => import(s).then(() => [s, "imports"], (e) => [s, e.code || e.name])))
      .then((pairs) => process.stdout.write(JSON.stringify(Object.fromEntries(pairs))))`, { cwd: CONSUMER, input: "" });
    n01.esm = esmRun.status === 0 ? JSON.parse(esmRun.stdout) : { error: `exit ${esmRun.status}` };
    const n01values = [...Object.values(n01.resolve), ...Object.values(n01.require), ...Object.values(n01.esm)];
    row("F1-N01", "every src/*.js and bin/airc.js by package name, with and without .js, through require.resolve, require and ESM import(): ERR_PACKAGE_PATH_NOT_EXPORTED",
      n01values.length === specifiers.length * 3 && n01values.every((value) => value === NOT_EXPORTED),
      { refused: n01values.filter((value) => value === NOT_EXPORTED).length, specifiers: specifiers.length, total: n01values.length, other: [...new Set(n01values.filter((value) => value !== NOT_EXPORTED))] });

    // F1-N02: no opt-in through the root: candidate_disabled, every one.
    const outDir = path.join(work, "gfx-out");
    const n02 = {
      parseSource: (await outcome(() => air.parseSource(T2, "t.air", NO_OPT_IN))).code,
      "verifySource(gated AST)": (await outcome(() => air.verifySource(ast, NO_OPT_IN))).code,
      "formatSource(gated AST)": (await outcome(() => air.formatSource(ast, NO_OPT_IN))).code,
      buildVerifiedTypedModule: (await outcome(() => air.buildVerifiedTypedModule({ ...NO_OPT_IN, descriptor: DESCRIPTOR, source: T2 }))).code,
      // The runtime is built with minimal valid options, as the repository's tests do; the row checks .build
      // (coordinator's reading note 3: createVerifiedTypedRuntime() with no argument refuses at the factory).
      "createVerifiedTypedRuntime({ admit }).build": (await outcome(() => air.createVerifiedTypedRuntime({ admit: async () => true }).build({ ...NO_OPT_IN, descriptor: DESCRIPTOR, source: T2 }))).code,
      "lowerToWat(gated AST)": (await outcome(() => air.lowerToWat(ast))).code,
      "lowerToWat(structuredClone(gated AST))": (await outcome(() => air.lowerToWat(structuredClone(ast)))).code,
      "buildGfxPackage(gated AST)": (await outcome(() => air.buildGfxPackage(ast, {}, { outDir }))).code
    };
    const outDirEntries = fs.existsSync(outDir) ? fs.readdirSync(outDir) : null;
    row("F1-N02", "no opt-in: parseSource, verifySource, formatSource, buildVerifiedTypedModule, createVerifiedTypedRuntime({ admit }).build, lowerToWat (also of a structuredClone) and buildGfxPackage give candidate_disabled; buildGfxPackage's outDir stays empty",
      Object.values(n02).every((code) => code === DISABLED) && Array.isArray(outDirEntries) && outDirEntries.length === 0, { ...n02, gfx_out_dir_entries: outDirEntries });

    // F1-N03: the installed airc without the opt-in.
    const tv = ["--source-profile", "typed-v0.53"];
    const n03 = {};
    for (const [label, cliArgs] of [
      ["verify", ["verify", "t.air", ...tv]], ["format", ["format", "t.air", ...tv]], ["fmt", ["fmt", "t.air", ...tv]],
      ["build", ["build", "t.air", ...tv]], ["explain", ["explain", "t.air", ...tv]], ["audit", ["audit", "t.air", ...tv]],
      ["report", ["report", "t.air", ...tv]], ["wit", ["wit", "t.air", ...tv]], ["app-check", ["app-check", "t.air", ...tv]],
      ["audio-check", ["audio-check", "t.air", ...tv]], ["gfx-build", ["gfx-build", "t.air", ...tv]], ["gfx-check", ["gfx-check", "t.air", ...tv]],
      ["gfx-wit", ["gfx-wit", "t.air", ...tv]], ["input-check", ["input-check", "t.air", ...tv]],
      ["check --lsp-json", ["check", "t.air", ...tv, "--lsp-json"]], ["lsp --stdio", ["lsp", "--stdio", ...tv]]]) {
      const result = cli(installedBin, cliArgs, work);
      n03[label] = `exit ${result.status}${result.signal ? ` ${result.signal}` : ""} ${result.code}`.trim();
    }
    row("F1-N03", "the installed airc without --allow-candidate-profile: 16 commands exit 1 with candidate_disabled",
      Object.values(n03).every((value) => value === `exit 1 ${DISABLED}`), n03);

    // F1-N04: no installed file names the seam; the installed typedV053 has no mintHarnessRecord.
    const named = walk(pkgRoot).filter((file) => SEAM.test(fs.readFileSync(path.join(pkgRoot, file), "latin1")));
    const members = Object.keys(req(path.join(pkgRoot, "src", "v052_verified_build.js")).typedV053).sort();
    row("F1-N04", "no installed file matches mintHarnessRecord|HARNESS_RECORDS; the installed typedV053 has no mintHarnessRecord",
      named.length === 0 && !members.includes("mintHarnessRecord"), { files_naming_the_seam: named, installed_files: walk(pkgRoot).length, typedV053: members });

    // F1-R01, recorded and never failing: residual L1, by file path.
    const byFile = await outcome(() => req(path.join(pkgRoot, "src", "parser.js")).typedV053.parse(T2, "t.air"));
    recorded("F1-R01", "require(<path>/src/parser.js).typedV053.parse by file path (residual L1, SPEC §9)", byFile.ok ? `returns an AST tagged ${byFile.value.sourceProfile}` : `refused ${byFile.code}`);

    // The package was loaded only from the consumer's node_modules.
    const outside = Object.keys(require.cache).filter((file) => file !== __filename && !file.startsWith(NODE_MODULES + path.sep));
    row("F1-LOAD", "every module the gate loaded came from the consumer's node_modules", outside.length === 0, { loaded: Object.keys(require.cache).length - 1, outside });
  } finally {
    fs.rmSync(work, { force: true, recursive: true });
  }

  const failed = rows.filter((item) => item.status === "FAIL");
  const result = { baseline: BASELINE, consumer: CONSUMER, failed: failed.length, node: process.version, package: `${manifest.name}@${manifest.version}`, rows };
  if (OUT) fs.writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`);
  for (const item of rows) console.log(`${item.status} ${item.id}: ${item.check}`);
  console.log(`SCALAR F-1 installed gate: ${rows.filter((item) => item.status === "PASS").length} PASS, ${failed.length} FAIL, ${rows.filter((item) => item.status === "RECORDED").length} RECORDED (${process.version})`);
  if (failed.length) {
    for (const item of failed) console.error(`FAIL ${item.id}: ${JSON.stringify(item.observed)}`);
    process.exitCode = 1;
  }
})().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
