#!/usr/bin/env node
"use strict";

// SEC53-01 (AIR_V053_SEC53_01_PATH_CONTAINMENT_SPEC_R3_2026_11_09): package
// path containment and symlink races. VECTORS.md §1's rows and §6's mutants
// M1-M19 (M12 once per §4.3 read site). Every row builds its own package in a
// fresh folder outside every tree. The rows run in child processes on a given
// src/ (this file with --rows), so a mutant runs on a scratch copy of src/;
// a FIFO or socket row runs alone under a 10 s kill timeout, because a blocked
// open stops a thread. Set AIR_SEC53_01_RESULTS_DIR=<dir> to write the results.
//
// SEC53-01 R4 and R5 (AIR_V053_SEC53_01_PATH_CONTAINMENT_SPEC_R5_2026_11_12): rows N21, G1, G2, G3, Q3el, Q3ef, G4a,
// G4b, I4, S1, A4 and L6 (VECTORS.md section 1b), W rows for the read sites R4 adds to section 4.3, mutants M20-M27,
// M18 at SEC53-02's binding parse and M12 at each new site. The rows that must read no outside byte run under an fs
// tracer, as QA's own cases do. Each child's work folder is made and removed by the parent (R5).

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const UNCONTAINED = "air.package.path_uncontained";
const INVALID = "air.package.file_invalid";
const CHANGED = "air.package.file_changed";
const HANG_ROWS = new Set(["N6", "N8", "N11", "A1", "L4c", "Q3ef", "G4b"]);
const KILL_MS = 10000;

// ---------------------------------------------------------------------------
// The rows (child side).

const MOD = (name, uses = "") => `module ${name}\n${uses}capabilities { }\n\nexport func run() -> i32 {\nentry:\n  return 1\n}\n`;
const LIB = (name) => `module ${name}\ncapabilities { }\n\nfunc f() -> i32 {\nentry:\n  return 2\n}\n`;
const MANIFEST = (extra = {}) => JSON.stringify({ name: "p", version: "0.1.0", airAbi: "0.10", hostAbi: "0.10", entry: "module.air", capabilities: [],
  targetProfiles: ["cli", "verifier-only"], ...extra }, null, 2);
const nameOf = (text) => (/^module ([A-Za-z0-9_.]+)/.exec(String(text)) || [])[1] || null;
const firstLine = (error) => String(error && error.message || error).split("\n")[0];

function rowContext(srcRoot) {
  const S = (rel) => require(path.join(srcRoot, rel));
  // SEC53-01 R5 (QA's QA-1): a child gets its work folder from the parent, which removes it even when the child is killed.
  const work = process.env.AIR_SEC53_01_WORK ? fs.realpathSync(process.env.AIR_SEC53_01_WORK) : fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "air-sec53-01-"));
  if (!path.basename(work).startsWith("air-sec53-01-")) throw new Error(`AIR_SEC53_01_WORK must name an air-sec53-01-* folder; refused: ${work}`);
  const outside = path.join(work, "outside");
  fs.mkdirSync(path.join(outside, "dir"), { recursive: true });
  fs.writeFileSync(path.join(outside, "evil.air"), MOD("outside_mod"));
  fs.writeFileSync(path.join(outside, "dir", "module.air"), MOD("outside_dir_mod"));
  fs.writeFileSync(path.join(outside, "lib.air"), LIB("outside_lib"));
  fs.writeFileSync(path.join(outside, "outside.air"), LIB("outside_rel"));
  fs.writeFileSync(path.join(outside, "air.package.json"), MANIFEST({ name: "outside-manifest" }));
  fs.writeFileSync(path.join(outside, "x.wasm"), Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]));
  fs.writeFileSync(path.join(outside, "a.json"), "OUTSIDE_AUDIO_MARKER");
  fs.writeFileSync(path.join(outside, "m.json"), "{\"outside\": true}");
  let n = 0;
  const pkg = (setup = () => {}, manifest = MANIFEST()) => {
    const base = path.join(work, `p${(n += 1)}`);
    fs.mkdirSync(base);
    fs.writeFileSync(path.join(base, "air.package.json"), manifest);
    fs.writeFileSync(path.join(base, "module.air"), MOD("root_mod"));
    setup(base);
    return base;
  };
  const folder = (name) => {
    const dir = path.join(work, `${name}${(n += 1)}`);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  };
  const copy = (from, name) => {
    const dir = path.join(work, `${name}${(n += 1)}`);
    fs.cpSync(from, dir, { recursive: true });
    return dir;
  };
  const inCwd = async (dir, action) => {
    const was = process.cwd();
    process.chdir(dir);
    try {
      return await action();
    } finally {
      process.chdir(was);
    }
  };
  return { S, copy, folder, inCwd, n: () => n, outside, pkg, srcRoot, work };
}

function startsWithCode(error, code) {
  return Boolean(error) && String(error.message || "").startsWith(`${code}:`);
}
function refused(action, code) {
  try {
    action();
  } catch (error) {
    return { ok: startsWithCode(error, code), refused: firstLine(error) };
  }
  return { ok: false, refused: null };
}
async function refusedAsync(action, code) {
  try {
    await action();
  } catch (error) {
    return { ok: startsWithCode(error, code), refused: firstLine(error) };
  }
  return { ok: false, refused: null };
}
function admitted(action) {
  try {
    const value = action();
    return { ok: true, value: value && typeof value === "object" ? "admitted" : value };
  } catch (error) {
    return { ok: false, refused: firstLine(error) };
  }
}
const all = (parts) => ({ ok: Object.values(parts).every((part) => part && part.ok), parts });

// A legacy air-package.json package.
function legacy(ctx, metadata, setup = () => {}) {
  const base = ctx.folder("legacy");
  fs.writeFileSync(path.join(base, "air-package.json"), JSON.stringify({ abi: "0.10", capabilities: [], exports: [], imports: [], module: "x", ...metadata }, null, 2));
  setup(base);
  return base;
}
// The examples/realtime_safe package, built, with an optional change to its entry before the wasm is built or after.
async function realtimePackage(ctx, { after = null } = {}) {
  const base = ctx.copy(path.join(ROOT, "examples", "realtime_safe"), "realtime");
  const { parseAir } = ctx.S("src/parser.js");
  const { verifyModule } = ctx.S("src/verifier.js");
  const { lowerToWat, watToWasm } = ctx.S("src/lower_wasm.js");
  const mod = parseAir(fs.readFileSync(path.join(base, "module.air"), "utf8"), path.join(base, "module.air"));
  verifyModule(mod);
  fs.writeFileSync(path.join(base, "module.wasm"), Buffer.from(await watToWasm(lowerToWat(mod), path.join(base, "module.air"))));
  if (after) after(base);
  return base;
}
function withImport(base, line) {
  const file = path.join(base, "module.air");
  const text = fs.readFileSync(file, "utf8").split("\n");
  text.splice(1, 0, line);
  fs.writeFileSync(file, text.join("\n"));
}
const sessionOptions = (dir, certificate) => ({
  arguments: { delta: 1 },
  entrypoint: "step",
  memoryPlan: {
    input: { access: "readonly", actualLength: 4, aliasGroup: null, alignment: 4, byteOffset: 0, maxLength: 4, memoryDomain: "wasm-linear", transferMode: "wasm_memory_view" },
    output: { access: "writeonly", actualLength: 4, aliasGroup: null, alignment: 4, byteOffset: 16, maxLength: 4, memoryDomain: "wasm-linear", transferMode: "wasm_memory_view" },
    state: { access: "readwrite", actualLength: 4, aliasGroup: null, alignment: 4, byteOffset: 32, maxLength: 4, memoryDomain: "wasm-linear", transferMode: "wasm_memory_view" }
  },
  packageDir: dir,
  resourceCertificate: certificate
});
// The read rows: admit with the primitive, change the package, read.
function readStep(ctx, relative, change, code, field = "entry") {
  const pp = ctx.S("src/package_paths.js");
  return (base) => {
    const ref = pp.admitPackagePath(pp.packageRealRoot(base), relative, field);
    change(base);
    return refused(() => pp.readAdmittedPackageFile(ref, { encoding: "utf8" }), code);
  };
}
function sparse(file, size) {
  const fd = fs.openSync(file, "w");
  fs.ftruncateSync(fd, size);
  fs.closeSync(fd);
}
function assetsPackage(ctx, setupAsset) {
  return ctx.pkg((d) => {
    fs.writeFileSync(path.join(d, "assets.json"), JSON.stringify({ version: "0.12", assets: { textures: { x: { path: "data/x.png" } } }, fallbacks: {} }));
    fs.mkdirSync(path.join(d, "data"));
    setupAsset(d);
  }, MANIFEST({ manifests: { assets: "assets.json" } }));
}
const assetEntry = (report) => report && report.assets && report.assets.assets && report.assets.assets.textures && report.assets.assets.textures.x;
// The AIR ABI 0.12 candidate package of test/v051_reference_substrate.test.js.
const TYPED_SOURCE = "module example.policy\n\nenum Admission {\n  allow = 1,\n  deny = 0,\n}\n\nexport func decide(value: i32) -> Admission {\n  return Admission.allow\n}\n";
function typedPackage(ctx, setup = () => {}) {
  const ti = ctx.S("src/typed_interface.js");
  const descriptor = {
    air_abi_lane: "0.12",
    exports: [{ function: "decide", name: "decide", parameters: [{ name: "value", type: "i32" }], return_type: "example.policy::Admission" }],
    module_id: "example.policy",
    schema: "air.typed-interface/0.12-candidate.1",
    types: [{ cases: [{ discriminant: 0, name: "deny" }, { discriminant: 1, name: "allow" }], kind: "enum", type_id: "example.policy::Admission" }]
  };
  const base = ctx.folder("typed");
  fs.writeFileSync(path.join(base, "policy.air"), TYPED_SOURCE);
  fs.writeFileSync(path.join(base, "air.interface.json"), `${JSON.stringify(descriptor)}\n`);
  fs.writeFileSync(path.join(base, "air.package.json"), JSON.stringify({
    airAbi: "0.12", capabilities: [], entry: "policy.air", hostAbi: "0.10", name: "example.policy",
    packageExports: [{ function: "decide", module: "policy.air", name: "decide" }], targetProfiles: [],
    typedInterface: { descriptor: "air.interface.json", descriptorDigest: ti.descriptorDigest(descriptor), entryExport: "decide", hostContractVersion: "air.host-contract/1.0.0-candidate.1" },
    version: "0.51.0"
  }));
  setup(base);
  return base;
}

// SEC53-01 R4: helpers of the R4 rows.
const OUTSIDE_NAME = /outside_[a-z0-9]+/;
// The first frame under the tree's src/ (outside package_paths.js) of a stack, as [file, function]: installSpy's rule.
function siteOf(stack, srcRoot) {
  const srcDir = path.join(srcRoot, "src") + path.sep;
  for (const line of String(stack).split("\n").slice(1)) {
    const match = /at (?:async )?(?:Object\.)?([^ (]+)? ?\(?([^():]+):\d+:\d+\)?$/.exec(line.trim());
    if (!match || !match[2].startsWith(srcDir) || match[2].endsWith(`${path.sep}package_paths.js`)) continue;
    return [path.basename(match[2]), match[1] || "<anonymous>"];
  }
  return null;
}
// An fs tracer, as QA's own cases have: while `action` runs, every successful fs.openSync and fs.readFileSync is
// matched by dev and ino against the files under `places` (files or folders), and a byte read from one is recorded.
async function outsideReads(places, action) {
  const inodes = new Map();
  const walk = (place) => {
    let stat;
    try {
      stat = fs.lstatSync(place);
    } catch (_) {
      return;
    }
    if (stat.isSymbolicLink()) return;
    if (!stat.isDirectory()) {
      inodes.set(`${stat.dev}:${stat.ino}`, place);
      return;
    }
    for (const name of fs.readdirSync(place)) walk(path.join(place, name));
  };
  for (const place of places) walk(place);
  const original = { closeSync: fs.closeSync, openSync: fs.openSync, readFileSync: fs.readFileSync, readSync: fs.readSync };
  const outsideOf = (stat) => inodes.get(`${stat.dev}:${stat.ino}`) || null;
  const fds = new Map();
  const reads = new Set();
  fs.openSync = function tracedOpen(file, ...rest) {
    const fd = original.openSync.call(fs, file, ...rest);
    try {
      const hit = outsideOf(fs.fstatSync(fd));
      if (hit) fds.set(fd, hit);
    } catch (_) {}
    return fd;
  };
  fs.readSync = function tracedReadSync(fd, ...rest) {
    const count = original.readSync.call(fs, fd, ...rest);
    if (count > 0 && fds.has(fd)) reads.add(fds.get(fd));
    return count;
  };
  fs.closeSync = function tracedClose(fd) {
    fds.delete(fd);
    return original.closeSync.call(fs, fd);
  };
  fs.readFileSync = function tracedReadFile(file, ...rest) {
    const value = original.readFileSync.call(fs, file, ...rest);
    try {
      const hit = outsideOf(typeof file === "number" ? fs.fstatSync(file) : fs.statSync(file));
      if (hit) reads.add(hit);
    } catch (_) {}
    return value;
  };
  try {
    const value = await action();
    return { reads: [...reads], value };
  } finally {
    Object.assign(fs, original);
  }
}
function textOf(call) {
  try {
    return JSON.stringify(call()) || "";
  } catch (error) {
    return `thrown ${String(error && error.message || error)} ${JSON.stringify(error && error.errors || [])}`;
  }
}
// QA's graph cases: checkPackageDir, validatePackageDir and reportPackageDir, each under the tracer. None may read a
// byte of `outsideFiles` or name an outside module; those named in `coded` must carry the code (thrown or reported).
async function graphRow(ctx, b, outsideFiles, coded) {
  const sdk = ctx.S("src/sdk.js");
  const calls = {
    checkPackageDir: () => sdk.checkPackageDir(b, { built: false }),
    validatePackageDir: () => sdk.validatePackageDir(b, { built: false }),
    reportPackageDir: () => sdk.reportPackageDir(b)
  };
  const parts = {};
  for (const [name, call] of Object.entries(calls)) {
    const traced = await outsideReads(outsideFiles, async () => textOf(call));
    const hasCode = traced.value.includes(UNCONTAINED);
    parts[name] = { ok: traced.reads.length === 0 && !OUTSIDE_NAME.test(traced.value) && (!coded.includes(name) || hasCode), coded: hasCode, outsideReads: traced.reads.length };
  }
  return all(parts);
}
// QA's Q3el and Q3ef (F4, OD-S1-7): in one call, after the first admitted read of the entry, the entry is replaced by an
// outside link ("l") or a FIFO ("f"). The call's later reads must refuse with a code, read no outside byte, not block.
async function swapAfterFirstRead(ctx, how) {
  const pp = ctx.S("src/package_paths.js");
  const sdk = ctx.S("src/sdk.js");
  const parts = {};
  for (const [name, call] of [["checkPackageDir", (b) => sdk.checkPackageDir(b, { built: false })], ["reportPackageDir", (b) => sdk.reportPackageDir(b)]]) {
    const b = ctx.pkg();
    const target = path.join(pp.packageRealRoot(b), "module.air");
    const wrapped = pp.readAdmittedPackageFile;
    let reads = 0;
    pp.readAdmittedPackageFile = function swapAfterFirst(ref, options) {
      const value = wrapped.call(this, ref, options);
      if (ref && ref.absolute === target && (reads += 1) === 1) {
        fs.rmSync(target);
        if (how === "l") fs.symlinkSync(path.join(ctx.outside, "evil.air"), target);
        else childProcess.execFileSync("mkfifo", [target]);
      }
      return value;
    };
    try {
      const traced = await outsideReads([ctx.outside], async () => textOf(() => call(b)));
      const coded = [UNCONTAINED, INVALID, CHANGED].some((code) => traced.value.includes(code));
      parts[name] = { ok: reads >= 1 && traced.reads.length === 0 && coded && !OUTSIDE_NAME.test(traced.value), coded, outsideReads: traced.reads.length };
    } finally {
      pp.readAdmittedPackageFile = wrapped;
    }
  }
  return all(parts);
}
// The wasm of a package's entry, lowered with its imports in package mode, as SEC53-02's binding lowers it.
async function buildEntryWasm(ctx, b) {
  const { parseAir } = ctx.S("src/parser.js");
  const { lowerToWat, watToWasm } = ctx.S("src/lower_wasm.js");
  const entry = path.join(b, "module.air");
  fs.writeFileSync(path.join(b, "module.wasm"), Buffer.from(await watToWasm(lowerToWat(parseAir(fs.readFileSync(entry, "utf8"), entry, { packageRoot: b })), entry)));
}
async function replayFixture(ctx, fixture, trace) {
  const b = ctx.copy(path.join(ROOT, "test", "fixtures", fixture), "replay");
  await buildEntryWasm(ctx, b);
  return ctx.S("src/conformance_replay.js").createConformanceReplayReport(b, { profile: "cli", trace: path.join(b, "traces", trace) });
}
// QA's G4a and G4b (F5, OD-S1-8): conformance replay, with the entry replaced when the wasm is instantiated (after the
// binding's read and parse, before the digest helper's): by an outside link ("a") or a FIFO ("b").
async function digestSwap(ctx, how) {
  const b = ctx.copy(path.join(ROOT, "test", "fixtures", "conformance_state"), "replay");
  await buildEntryWasm(ctx, b);
  const entry = path.join(b, "module.air");
  const original = WebAssembly.instantiate;
  let swapped = false;
  WebAssembly.instantiate = function swapThenInstantiate(...args) {
    if (!swapped) {
      swapped = true;
      fs.rmSync(entry);
      if (how === "a") fs.symlinkSync(path.join(ctx.outside, "evil.air"), entry);
      else childProcess.execFileSync("mkfifo", [entry]);
    }
    return original.apply(this, args);
  };
  try {
    const traced = await outsideReads([ctx.outside], async () => JSON.stringify(await ctx.S("src/conformance_replay.js").createConformanceReplayReport(b, { profile: "cli", trace: path.join(b, "traces", "pass.json") })));
    const coded = [UNCONTAINED, INVALID, CHANGED].some((code) => traced.value.includes(code));
    return { ok: swapped && traced.reads.length === 0 && coded && !OUTSIDE_NAME.test(traced.value), coded, outsideReads: traced.reads.length };
  } finally {
    WebAssembly.instantiate = original;
  }
}

const ROWS = {
  P1: async (ctx) => {
    const b = ctx.pkg();
    const pm = ctx.S("src/package_manifest.js");
    const pp = ctx.S("src/package_paths.js");
    let manifest;
    try {
      manifest = pm.validatePackageManifest(b, { built: false });
    } catch (error) {
      return { ok: false, refused: firstLine(error) };
    }
    const read = nameOf(pp.readAdmittedPackageFile(pp.admittedRefsOf(manifest).entry, { encoding: "utf8" }));
    const check = ctx.S("src/sdk.js").checkPackageDir(b, { built: false }).status;
    return { ok: read === "root_mod" && check !== "fail", detail: { checkPackageDir: check, entryRead: read } };
  },
  P2: async (ctx) => {
    const b = ctx.pkg((d) => { fs.mkdirSync(path.join(d, "src")); fs.renameSync(path.join(d, "module.air"), path.join(d, "src", "module.air")); }, MANIFEST({ entry: "src/module.air" }));
    const m = admitted(() => ctx.S("src/package_manifest.js").validatePackageManifest(b, { built: false }));
    const check = ctx.S("src/sdk.js").checkPackageDir(b, { built: false }).status;
    return { ok: m.ok && check !== "fail", detail: { checkPackageDir: check, manifest: m.refused || "admitted" } };
  },
  P3: async (ctx) => {
    const b = ctx.pkg((d) => { fs.writeFileSync(path.join(d, "module.air"), MOD("root_mod", "use \"./lib.air\" as lib\n")); fs.writeFileSync(path.join(d, "lib.air"), LIB("inside_lib")); });
    const elsewhere = ctx.folder("cwd");
    return ctx.inCwd(elsewhere, () => admitted(() => ctx.S("src/sdk.js").validatePackageDir(b, { built: false })));
  },
  P4: async (ctx) => {
    const b = ctx.pkg((d) => fs.writeFileSync(path.join(d, "module.wasm"), Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0])), MANIFEST({ wasm: "module.wasm" }));
    return admitted(() => ctx.S("src/package_manifest.js").validatePackageManifest(b, { built: true }).wasm);
  },
  P5: async (ctx) => {
    const b = ctx.pkg();
    const link = path.join(ctx.work, `rootlink${ctx.n()}`);
    fs.symlinkSync(b, link);
    return admitted(() => ctx.S("src/package_manifest.js").validatePackageManifest(link, { built: false }).name);
  },
  P5b: async (ctx) => {
    const b = ctx.pkg();
    const copyDir = ctx.pkg((d) => fs.writeFileSync(path.join(d, "module.air"), MOD("copy_mod")));
    const link = path.join(ctx.work, `rootlink${ctx.n()}`);
    fs.symlinkSync(b, link);
    const pp = ctx.S("src/package_paths.js");
    let ref;
    try {
      ref = pp.admitPackagePath(pp.packageRealRoot(link), "module.air", "entry");
    } catch (error) {
      return { ok: false, detail: { admission: firstLine(error) } };
    }
    fs.unlinkSync(link);
    fs.symlinkSync(copyDir, link);
    const read = admitted(() => nameOf(pp.readAdmittedPackageFile(ref, { encoding: "utf8" })));
    return { ok: read.ok && read.value === "root_mod", detail: read };
  },
  P6: async (ctx) => {
    const b = ctx.pkg((d) => fs.writeFileSync(path.join(d, "module.air"), MOD("root_mod", "use std.bounds\n")));
    return admitted(() => ctx.S("src/sdk.js").validatePackageDir(b, { built: false }).ok);
  },
  N1: async (ctx) => refused(() => ctx.S("src/package_manifest.js").validatePackageManifest(ctx.pkg((d) => { fs.rmSync(path.join(d, "module.air")); fs.symlinkSync(path.join(ctx.outside, "evil.air"), path.join(d, "module.air")); })), UNCONTAINED),
  N2: async (ctx) => refused(() => ctx.S("src/package_manifest.js").validatePackageManifest(ctx.pkg((d) => { fs.renameSync(path.join(d, "module.air"), path.join(d, "real.air")); fs.symlinkSync("real.air", path.join(d, "module.air")); })), UNCONTAINED),
  N3: async (ctx) => refused(() => ctx.S("src/package_manifest.js").validatePackageManifest(ctx.pkg((d) => fs.symlinkSync(path.join(ctx.outside, "dir"), path.join(d, "src")), MANIFEST({ entry: "src/module.air" }))), UNCONTAINED),
  N4: async (ctx) => refused(() => ctx.S("src/package_manifest.js").validatePackageManifest(ctx.pkg((d) => fs.symlinkSync(path.join(ctx.outside, "x.wasm"), path.join(d, "module.wasm")), MANIFEST({ wasm: "module.wasm" })), { built: true }), UNCONTAINED),
  N5: async (ctx) => refused(() => ctx.S("src/package_manifest.js").validatePackageManifest(ctx.pkg((d) => { fs.rmSync(path.join(d, "air.package.json")); fs.symlinkSync(path.join(ctx.outside, "air.package.json"), path.join(d, "air.package.json")); })), UNCONTAINED),
  N6: async (ctx) => refused(() => ctx.S("src/package_manifest.js").validatePackageManifest(ctx.pkg((d) => { fs.rmSync(path.join(d, "module.air")); childProcess.execFileSync("mkfifo", [path.join(d, "module.air")]); })), INVALID),
  N7: async (ctx) => refused(() => ctx.S("src/package_manifest.js").validatePackageManifest(ctx.pkg((d) => { fs.rmSync(path.join(d, "module.air")); fs.mkdirSync(path.join(d, "module.air")); })), INVALID),
  N8: async (ctx) => {
    const b = ctx.pkg((d) => fs.rmSync(path.join(d, "module.air")));
    const server = require("node:net").createServer();
    // macOS caps socket paths at 104 bytes, so the socket is made from its folder with a relative name.
    await ctx.inCwd(b, () => new Promise((resolve, reject) => { server.once("error", reject); server.listen("module.air", resolve); }));
    try {
      return refused(() => ctx.S("src/package_manifest.js").validatePackageManifest(b), INVALID);
    } finally {
      server.close();
    }
  },
  N9: async (ctx) => {
    const b = ctx.pkg((d) => sparse(path.join(d, "module.air"), 4 * 1024 * 1024 + 1));
    const pp = ctx.S("src/package_paths.js");
    let manifest;
    try {
      manifest = ctx.S("src/package_manifest.js").validatePackageManifest(b);
    } catch (error) {
      return { ok: false, detail: { admission: firstLine(error) } };
    }
    const entryRef = pp.admittedRefsOf(manifest).entry;
    if (!entryRef || !entryRef.identity) return { ok: false, detail: { admission: "no admitted entry ref" } };
    return refused(() => pp.readAdmittedPackageFile(entryRef, { encoding: "utf8" }), INVALID);
  },
  N10: async (ctx) => readStep(ctx, "module.air", (b) => { fs.rmSync(path.join(b, "module.air")); fs.symlinkSync(path.join(ctx.outside, "evil.air"), path.join(b, "module.air")); }, CHANGED)(ctx.pkg()),
  N11: async (ctx) => readStep(ctx, "module.air", (b) => { fs.rmSync(path.join(b, "module.air")); childProcess.execFileSync("mkfifo", [path.join(b, "module.air")]); }, INVALID)(ctx.pkg()),
  N12: async (ctx) => {
    const outsideSrc = ctx.folder("outsidesrc");
    fs.writeFileSync(path.join(outsideSrc, "module.air"), MOD("outside_swap"));
    const b = ctx.pkg((d) => { fs.mkdirSync(path.join(d, "src")); fs.renameSync(path.join(d, "module.air"), path.join(d, "src", "module.air")); }, MANIFEST({ entry: "src/module.air" }));
    return readStep(ctx, "src/module.air", (d) => { fs.renameSync(path.join(d, "src"), path.join(d, "src_old")); fs.symlinkSync(outsideSrc, path.join(d, "src")); }, CHANGED)(b);
  },
  N13: async (ctx) => readStep(ctx, "module.air", (b) => { fs.renameSync(path.join(b, "module.air"), path.join(b, "renamed.air")); fs.symlinkSync("renamed.air", path.join(b, "module.air")); }, CHANGED)(ctx.pkg()),
  N14: async (ctx) => readStep(ctx, "module.air", (b) => { fs.writeFileSync(path.join(b, "other.air"), MOD("other_mod")); fs.renameSync(path.join(b, "other.air"), path.join(b, "module.air")); }, CHANGED)(ctx.pkg()),
  N15: async (ctx) => importRow(ctx, (d) => { withImport(d, "use \"./lib.air\" as lib"); fs.symlinkSync(path.join(ctx.outside, "lib.air"), path.join(d, "lib.air")); }),
  N16: async (ctx) => importRow(ctx, (d) => withImport(d, "use \"../outside/outside.air\" as o")),
  N17: async (ctx) => {
    const b = ctx.pkg((d) => fs.writeFileSync(path.join(d, "module.air"), MOD("root_mod", "use \"./lib.air\" as lib\n")));
    const cwd = ctx.folder("cwdlib");
    fs.writeFileSync(path.join(cwd, "lib.air"), LIB("cwd_lib"));
    return ctx.inCwd(cwd, () => {
      try {
        ctx.S("src/sdk.js").validatePackageDir(b, { built: false });
      } catch (error) {
        const message = firstLine(error);
        return { ok: message.includes("not found at") && message.includes(path.join(b, "lib.air")) && !message.includes(cwd), refused: message };
      }
      return { ok: false, refused: null };
    });
  },
  N18: async (ctx) => {
    const b = ctx.pkg((d) => { fs.mkdirSync(path.join(d, "src")); fs.renameSync(path.join(d, "module.air"), path.join(d, "src", "module.air")); }, MANIFEST({ entry: "src/module.air" }));
    const outsideSrc = ctx.folder("hardlinked");
    return readStep(ctx, "src/module.air", (d) => {
      fs.linkSync(path.join(d, "src", "module.air"), path.join(outsideSrc, "module.air"));
      fs.renameSync(path.join(d, "src"), path.join(d, "src_old"));
      fs.symlinkSync(outsideSrc, path.join(d, "src"));
    }, CHANGED)(b);
  },
  N19: async (ctx) => {
    const b = ctx.pkg((d) => { fs.mkdirSync(path.join(d, "src")); fs.renameSync(path.join(d, "module.air"), path.join(d, "src", "module.air")); }, MANIFEST({ entry: "src/module.air" }));
    return readStep(ctx, "src/module.air", (d) => { fs.renameSync(path.join(d, "src"), path.join(d, "src_old")); fs.writeFileSync(path.join(d, "src"), "not a folder"); }, CHANGED)(b);
  },
  N20: async (ctx) => {
    const b = ctx.pkg((d) => { fs.mkdirSync(path.join(d, "src")); fs.renameSync(path.join(d, "module.air"), path.join(d, "src", "module.air")); }, MANIFEST({ entry: "src/module.air" }));
    const outsideSrc = ctx.folder("walkswap");
    fs.writeFileSync(path.join(outsideSrc, "module.air"), MOD("outside_walk"));
    const pp = ctx.S("src/package_paths.js");
    const realRoot = pp.packageRealRoot(b);
    const final = path.join(realRoot, "src", "module.air");
    const original = fs.lstatSync;
    let swapped = false;
    fs.lstatSync = function wrappedLstat(file, ...rest) {
      if (!swapped && String(file) === final) {
        swapped = true;
        fs.renameSync(path.join(realRoot, "src"), path.join(realRoot, "src_old"));
        fs.symlinkSync(outsideSrc, path.join(realRoot, "src"));
      }
      return original.call(this, file, ...rest);
    };
    try {
      const outcome = refused(() => pp.admitPackagePath(realRoot, "src/module.air", "entry"), CHANGED);
      return { ...outcome, swapped };
    } finally {
      fs.lstatSync = original;
    }
  },
  L1: async (ctx) => {
    const b = legacy(ctx, { wasm: "../outside/x.wasm", manifest: "../outside/m.json" });
    const want = ["wasm must not contain parent traversal", "manifest must not contain parent traversal"];
    const errorsOf = (action) => { try { action(); } catch (error) { return error.name === "PackageManifestError" ? error.errors : [`${error.name}: ${firstLine(error)}`]; } return null; };
    const sdk = ctx.S("src/sdk.js");
    const load = errorsOf(() => sdk.loadPackage(b));
    const validate = errorsOf(() => sdk.validatePackageDir(b));
    const report = sdk.checkPackageDir(b, { built: true });
    const failing = report.checks.filter((item) => item.status === "fail").map((item) => [item.id, item.message]);
    const checkOk = report.status === "fail" && failing.some(([id, message]) => id === "package-manifest" && message === want[0]) && failing.some(([id, message]) => id === "manifest" && message === want[1]);
    return { ok: JSON.stringify(load) === JSON.stringify(want) && JSON.stringify(validate) === JSON.stringify(want) && checkOk, detail: { checkPackageDir: failing, loadPackage: load, validatePackageDir: validate } };
  },
  L2: async (ctx) => {
    const b = legacy(ctx, { module: "../outside/x" });
    try {
      ctx.S("src/sdk.js").loadPackage(b);
    } catch (error) {
      return { ok: error.name === "PackageManifestError" && JSON.stringify(error.errors) === JSON.stringify(["module must not contain parent traversal"]), detail: error.errors || firstLine(error) };
    }
    return { ok: false, detail: "loaded" };
  },
  L3: async (ctx) => refused(() => ctx.S("src/sdk.js").loadPackage(legacy(ctx, { wasm: "x.wasm" }, (d) => fs.symlinkSync(path.join(ctx.outside, "x.wasm"), path.join(d, "x.wasm")))), UNCONTAINED),
  L4: async (ctx) => {
    const b = legacy(ctx, { audioManifest: "../outside/a.json", wasm: "x.wasm" }, (d) => fs.writeFileSync(path.join(d, "x.wasm"), Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0])));
    const sdk = ctx.S("src/sdk.js");
    let validate = null;
    try { sdk.validatePackageDir(b); } catch (error) { validate = error.name === "PackageManifestError" ? error.errors : [firstLine(error)]; }
    const report = sdk.checkPackageDir(b, { built: true });
    const failing = report.checks.filter((item) => item.status === "fail").map((item) => [item.id, item.message]);
    const want = ["audioManifest must not contain parent traversal"];
    return { ok: JSON.stringify(validate) === JSON.stringify(want) && report.status === "fail" && failing.some(([id, message]) => id === "package-manifest" && message === want[0]) && !JSON.stringify(report).includes("OUTSIDE_AU"), detail: { checkPackageDir: failing, validatePackageDir: validate } };
  },
  L4b: async (ctx) => {
    const b = legacy(ctx, { audioManifest: "a.json", wasm: "x.wasm" }, (d) => { fs.writeFileSync(path.join(d, "x.wasm"), Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0])); fs.symlinkSync(path.join(ctx.outside, "a.json"), path.join(d, "a.json")); });
    const sdk = ctx.S("src/sdk.js");
    const validate = refused(() => sdk.validatePackageDir(b), UNCONTAINED);
    const report = sdk.checkPackageDir(b, { built: true });
    const check = report.checks.some((item) => item.status === "fail" && String(item.message).startsWith(`${UNCONTAINED}:`)) && !JSON.stringify(report).includes("OUTSIDE_AU");
    return all({ checkPackageDir: { ok: check }, validatePackageDir: validate });
  },
  L4c: async (ctx) => refused(() => ctx.S("src/sdk.js").validatePackageDir(legacy(ctx, { audio: { manifest: "a.json" }, wasm: "x.wasm" }, (d) => { fs.writeFileSync(path.join(d, "x.wasm"), Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0])); childProcess.execFileSync("mkfifo", [path.join(d, "a.json")]); })), INVALID),
  L5: async (ctx) => {
    const wasm = (d) => fs.writeFileSync(path.join(d, "x.wasm"), Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]));
    const sdk = ctx.S("src/sdk.js");
    const dotdot = sdk.checkPackageDir(legacy(ctx, { manifests: { audio: { path: "../outside/a.json" } }, wasm: "x.wasm" }, wasm), { built: true });
    const linked = sdk.checkPackageDir(legacy(ctx, { manifests: { audio: { path: "a.json" } }, wasm: "x.wasm" }, (d) => { wasm(d); fs.symlinkSync(path.join(ctx.outside, "a.json"), path.join(d, "a.json")); }), { built: true });
    const failing = (report) => report.checks.filter((item) => item.status === "fail").map((item) => [item.id, item.message]);
    const dotdotOk = dotdot.status === "fail" && failing(dotdot).some(([id, message]) => id === "manifest" && message === "manifests.audio must not contain parent traversal") && !(dotdot.manifests && dotdot.manifests.audio);
    const linkedOk = linked.status === "fail" && failing(linked).some(([, message]) => String(message).startsWith(`${UNCONTAINED}:`)) && !(linked.manifests && linked.manifests.audio);
    return { ok: dotdotOk && linkedOk, detail: { dotdot: failing(dotdot), linked: failing(linked) } };
  },
  A1: async (ctx) => {
    const b = assetsPackage(ctx, (d) => childProcess.execFileSync("mkfifo", [path.join(d, "data", "x.png")]));
    const report = ctx.S("src/sdk.js").checkPackageDir(b, { built: false });
    const entry = assetEntry(report);
    return { ok: Boolean(entry) && entry.status === "invalid" && String((entry.errors || [])[0]).startsWith(`${INVALID}:`), detail: entry || null };
  },
  A2: async (ctx) => {
    fs.writeFileSync(path.join(ctx.outside, "x.png"), "placeholder");
    const b = assetsPackage(ctx, (d) => fs.symlinkSync(path.join(ctx.outside, "x.png"), path.join(d, "data", "x.png")));
    const report = ctx.S("src/sdk.js").checkPackageDir(b, { built: false });
    const entry = assetEntry(report);
    return { ok: Boolean(entry) && entry.status === "invalid" && String((entry.errors || [])[0]).startsWith(`${UNCONTAINED}:`) && !entry.placeholder && !(report.assets.placeholders || []).length, detail: entry || null };
  },
  A3: async (ctx, spy) => {
    const b = assetsPackage(ctx, (d) => sparse(path.join(d, "data", "x.png"), 5 * 1024 * 1024));
    spy.calls.length = 0;
    const report = ctx.S("src/sdk.js").checkPackageDir(b, { built: false });
    const entry = assetEntry(report);
    const assetReads = spy.calls.filter((call) => call.field === "asset");
    // Only the asset's first 512 bytes are read, at every read of it (checkPackageDir reads it more than once).
    return { ok: Boolean(entry) && entry.exists === true && entry.status !== "invalid" && assetReads.length > 0 && assetReads.every((call) => call.prefixBytes === 512), detail: { assetReads, status: entry && entry.status } };
  },
  D1: async (ctx) => refused(() => ctx.S("src/package_manifest.js").validatePackageManifest(typedPackage(ctx, (d) => { fs.renameSync(path.join(d, "air.interface.json"), path.join(d, "real.interface.json")); fs.symlinkSync("real.interface.json", path.join(d, "air.interface.json")); }), { allowCandidateAbi012: true, built: false }), UNCONTAINED),
  I1: async (ctx) => {
    const example = path.join(ROOT, "examples", "lan_observer_readonly_package");
    const run = (setup) => {
      const b = ctx.copy(example, "e2e");
      setup(b);
      return ctx.S("src/e2e_proof.js").createE2eProofReport(b, { fixture: path.join(b, "traces", "pass.json"), policy: path.join(b, "host_policies", "lan_observer_readonly.policy.json"), profile: "cli" });
    };
    const linked = await run((d) => { withImport(d, "use \"./lib.air\" as lib"); fs.symlinkSync(path.join(ctx.outside, "lib.air"), path.join(d, "lib.air")); });
    const cwd = ctx.folder("e2ecwd");
    fs.writeFileSync(path.join(cwd, "lib.air"), "CWD_LIB_MARKER is not AIR\n");
    const anchored = await ctx.inCwd(cwd, () => run((d) => { withImport(d, "use \"./lib.air\" as lib"); fs.writeFileSync(path.join(d, "lib.air"), LIB("inside_lib")); }));
    const linkedText = JSON.stringify(linked);
    const anchoredText = JSON.stringify(anchored);
    return { ok: linkedText.includes(UNCONTAINED) && !linkedText.includes("outside_lib") && !anchoredText.includes("CWD_LIB_MARKER") && !anchoredText.includes("not found at"), detail: { anchored: anchored.status, linkedRefused: linkedText.includes(UNCONTAINED) } };
  },
  I2: async (ctx) => {
    const run = async (setup) => {
      const b = ctx.pkg(setup);
      const bench = ctx.folder("bench");
      fs.writeFileSync(path.join(bench, "benchmark.json"), JSON.stringify({ schemaVersion: "0.29", kind: "air.benchmark", benchmarkName: "sec53-01", benchmarkId: "sec53_01", packageDir: b, profile: "cli", buildWasm: true }));
      const report = await ctx.S("src/benchmark_report.js").createBenchmarkReport(bench, { cwd: process.cwd() });
      return (report.diagnostics || []).filter((item) => item.code === "air.benchmark.wasm_build_failed").map((item) => item.message);
    };
    const linked = await run((d) => { fs.writeFileSync(path.join(d, "module.air"), MOD("root_mod", "use \"./lib.air\" as lib\n")); fs.symlinkSync(path.join(ctx.outside, "lib.air"), path.join(d, "lib.air")); });
    const cwd = ctx.folder("benchcwd");
    fs.writeFileSync(path.join(cwd, "lib.air"), "CWD_LIB_MARKER is not AIR\n");
    const anchored = await ctx.inCwd(cwd, () => run((d) => { fs.writeFileSync(path.join(d, "module.air"), MOD("root_mod", "use \"./lib.air\" as lib\n")); fs.writeFileSync(path.join(d, "lib.air"), LIB("inside_lib")); }));
    return { ok: linked.some((message) => String(message).startsWith(`${UNCONTAINED}:`)) && anchored.length === 0, detail: { anchored, linked } };
  },
  I3: async (ctx) => {
    // conformance_replay parses the entry for the digest helper only after checkPackageDir, whose module graph already
    // refuses a static outside link. So the row swaps lib.air for an outside link when the replay instantiates the wasm,
    // and that parse must refuse it with the code. The static link is recorded.
    // SEC53-01 R4: SEC53-02's binding lowers the entry with its imports before WebAssembly.instantiate, so the wasm is
    // built from the entry with its import. The swap point is after the package check and the binding's parse, and
    // before the digest helper's parse.
    const replay = async (swap) => {
      const b = ctx.copy(path.join(ROOT, "test", "fixtures", "conformance_state"), "replay");
      withImport(b, "use \"./lib.air\" as lib");
      fs.writeFileSync(path.join(b, "lib.air"), LIB("inside_lib"));
      await buildEntryWasm(ctx, b);
      if (!swap) {
        fs.rmSync(path.join(b, "lib.air"));
        fs.symlinkSync(path.join(ctx.outside, "lib.air"), path.join(b, "lib.air"));
      }
      const original = WebAssembly.instantiate;
      let swapped = false;
      if (swap) {
        WebAssembly.instantiate = function swapThenInstantiate(...args) {
          if (!swapped) {
            swapped = true;
            fs.rmSync(path.join(b, "lib.air"));
            fs.symlinkSync(path.join(ctx.outside, "lib.air"), path.join(b, "lib.air"));
          }
          return original.apply(this, args);
        };
      }
      try {
        const report = await ctx.S("src/conformance_replay.js").createConformanceReplayReport(b, { profile: "cli", trace: path.join(b, "traces", "pass.json") });
        return { swapped, text: JSON.stringify(report), mismatches: (report.mismatches || []).map((item) => item.message).slice(0, 3) };
      } finally {
        WebAssembly.instantiate = original;
      }
    };
    const swapped = await replay(true);
    const staticLink = await replay(false);
    return {
      ok: swapped.swapped && swapped.text.includes(UNCONTAINED) && !swapped.text.includes("outside_lib") && staticLink.mismatches.length > 0 && !staticLink.text.includes("outside_lib"),
      detail: { staticLink: staticLink.mismatches, swapped: swapped.mismatches }
    };
  },
  // SEC53-01 R4 rows (VECTORS.md section 1b).
  N21: async (ctx) => {
    // QA's F1 at the primitive: admitPackagePath refuses what only a caller that skipped the lexical checks can pass.
    const pp = ctx.S("src/package_paths.js");
    const realRoot = pp.packageRealRoot(ctx.pkg((d) => fs.mkdirSync(path.join(d, "src"))));
    const parts = {};
    for (const input of ["src/../module.air", "./../module.air", "..", "src\\module.air", "/module.air", "", "module.air\0"]) {
      parts[JSON.stringify(input)] = refused(() => pp.admitPackagePath(realRoot, input, "entry"), UNCONTAINED);
    }
    parts["\"./module.air\""] = admitted(() => pp.admitPackagePath(realRoot, "./module.air", "entry"));
    return all(parts);
  },
  G1: async (ctx) => {
    // QA's F1: a backslash import name whose "/" form climbs out of the root through a real folder.
    const top = ctx.folder("g1");
    const b = path.join(top, "p");
    fs.mkdirSync(b);
    fs.writeFileSync(path.join(b, "air.package.json"), MANIFEST());
    fs.writeFileSync(path.join(b, "module.air"), MOD("root_mod", "use \"./.\\..\\g1.air\" as g\n"));
    fs.writeFileSync(path.join(top, "g1.air"), LIB("outside_g1"));
    return graphRow(ctx, b, [path.join(top, "g1.air")], ["checkPackageDir", "validatePackageDir", "reportPackageDir"]);
  },
  G2: async (ctx) => {
    // QA's F2: a backslash import name with "." and no alias. modulePublicName must not take a root above the package.
    const top = ctx.folder("g2");
    const b = path.join(top, "a", "p");
    fs.mkdirSync(path.join(b, "q"), { recursive: true });
    fs.writeFileSync(path.join(b, "air.package.json"), MANIFEST());
    fs.writeFileSync(path.join(b, "module.air"), MOD("root_mod", "use \"./q\\.\\g2.air\"\n"));
    fs.writeFileSync(path.join(b, "q\\.\\g2.air"), LIB("inside_literal_g2"));
    fs.writeFileSync(path.join(b, "q", "g2.air"), LIB("inside_q_g2"));
    fs.mkdirSync(path.join(top, "q"));
    fs.writeFileSync(path.join(top, "q", "g2.air"), LIB("outside_g2"));
    return graphRow(ctx, b, [path.join(top, "q", "g2.air")], ["validatePackageDir"]);
  },
  G3: async (ctx) => {
    // QA's F3 (OD-S1-6): a "std." name that is a path from stdlib/ to an outside file.
    const rel = path.relative(path.join(ctx.srcRoot, "stdlib"), path.join(ctx.outside, "g3"));
    fs.writeFileSync(path.join(ctx.outside, "g3.air"), LIB("outside_g3"));
    const b = ctx.pkg((d) => fs.writeFileSync(path.join(d, "module.air"), MOD("root_mod", `use "std.${rel}" as s\n`)));
    return graphRow(ctx, b, [path.join(ctx.outside, "g3.air")], ["checkPackageDir", "validatePackageDir", "reportPackageDir"]);
  },
  Q3el: async (ctx) => swapAfterFirstRead(ctx, "l"),
  Q3ef: async (ctx) => swapAfterFirstRead(ctx, "f"),
  G4a: async (ctx) => digestSwap(ctx, "a"),
  G4b: async (ctx) => digestSwap(ctx, "b"),
  I4: async (ctx) => {
    // SEC53-02's binding parses the entry with its imports after the package check. lib.air is replaced by an outside
    // link at the binding's wasm read, just before that parse, which must refuse it with the code and read nothing.
    const b = ctx.copy(path.join(ROOT, "test", "fixtures", "conformance_state"), "replay");
    withImport(b, "use \"./lib.air\" as lib");
    fs.writeFileSync(path.join(b, "lib.air"), LIB("inside_lib"));
    await buildEntryWasm(ctx, b);
    const pp = ctx.S("src/package_paths.js");
    const wrapped = pp.readAdmittedPackageFile;
    let swapped = false;
    pp.readAdmittedPackageFile = function swapAtBindingWasmRead(ref, options) {
      const site = siteOf(new Error().stack, ctx.srcRoot);
      const value = wrapped.call(this, ref, options);
      if (!swapped && ref && ref.field === "wasm" && site && site[0] === "conformance_replay.js") {
        swapped = true;
        fs.rmSync(path.join(b, "lib.air"));
        fs.symlinkSync(path.join(ctx.outside, "lib.air"), path.join(b, "lib.air"));
      }
      return value;
    };
    try {
      const traced = await outsideReads([ctx.outside], async () => JSON.stringify(await ctx.S("src/conformance_replay.js").createConformanceReplayReport(b, { profile: "cli", trace: path.join(b, "traces", "pass.json") })));
      const coded = traced.value.includes(UNCONTAINED);
      return { ok: swapped && traced.reads.length === 0 && coded && !OUTSIDE_NAME.test(traced.value), coded, outsideReads: traced.reads.length };
    } finally {
      pp.readAdmittedPackageFile = wrapped;
    }
  },
  S1: async (ctx) => {
    // QA's F7 (OD-S1-9): the module graph's two containment refusals carry the code: a static outside link, and an
    // import that climbs out of the root.
    const check = (setup, want) => {
      const text = JSON.stringify(ctx.S("src/sdk.js").checkPackageDir(ctx.pkg(setup), { built: false }));
      const coded = text.includes(`${UNCONTAINED}: ${want}`);
      return { ok: coded && !OUTSIDE_NAME.test(text), coded };
    };
    return all({
      escape: check((d) => fs.writeFileSync(path.join(d, "module.air"), MOD("root_mod", "use \"../outside/outside.air\" as o\n")), "AIR import '../outside/outside.air' escapes package root"),
      link: check((d) => { fs.writeFileSync(path.join(d, "module.air"), MOD("root_mod", "use \"./lib.air\" as lib\n")); fs.symlinkSync(path.join(ctx.outside, "lib.air"), path.join(d, "lib.air")); }, "AIR import './lib.air' resolves outside package root")
    });
  },
  A4: async (ctx) => {
    // QA's M1 (F6): a prefix read takes exactly prefixBytes bytes from the descriptor.
    const pp = ctx.S("src/package_paths.js");
    const b = ctx.pkg((d) => sparse(path.join(d, "big.bin"), 5 * 1024 * 1024));
    const ref = pp.admitPackagePath(pp.packageRealRoot(b), "big.bin", "asset");
    const original = fs.readSync;
    let bytesRead = 0;
    fs.readSync = function countingRead(...args) {
      const count = original.apply(this, args);
      bytesRead += count;
      return count;
    };
    let value;
    try {
      value = pp.readAdmittedPackageFile(ref, { prefixBytes: 512 });
    } finally {
      fs.readSync = original;
    }
    return { ok: bytesRead === 512 && value.length === 512, bytesRead, returned: value.length };
  },
  L6: async (ctx) => {
    // SEC53-02's R-6 (OD-S1-10): the link plan reads each importing module again after the module graph. The entry
    // (it imports lib.air) is replaced by an outside link right after its last read by any other site, so the link
    // plan's read is the next: it must refuse with a code and read nothing outside. A first run on a twin package counts
    // those other reads.
    const pp = ctx.S("src/package_paths.js");
    const make = () => ctx.pkg((d) => { fs.writeFileSync(path.join(d, "module.air"), MOD("root_mod", "use \"./lib.air\" as lib\n")); fs.writeFileSync(path.join(d, "lib.air"), LIB("inside_lib")); });
    const plan = (b) => ctx.S("src/link_plan.js").createPackageLinkPlan(b, { profile: "cli" });
    const wrapped = pp.readAdmittedPackageFile;
    const otherRead = (b, ref) => ref && ref.absolute === path.join(pp.packageRealRoot(b), "module.air") && !((siteOf(new Error().stack, ctx.srcRoot) || [])[0] === "link_plan.js");
    const twin = make();
    let others = 0;
    pp.readAdmittedPackageFile = function countOtherReads(ref, options) {
      if (otherRead(twin, ref)) others += 1;
      return wrapped.call(this, ref, options);
    };
    try {
      plan(twin);
    } finally {
      pp.readAdmittedPackageFile = wrapped;
    }
    const b = make();
    let seen = 0;
    pp.readAdmittedPackageFile = function swapAfterOtherReads(ref, options) {
      const other = otherRead(b, ref);
      const value = wrapped.call(this, ref, options);
      if (other && (seen += 1) === others) {
        fs.rmSync(path.join(b, "module.air"));
        fs.symlinkSync(path.join(ctx.outside, "evil.air"), path.join(b, "module.air"));
      }
      return value;
    };
    try {
      const traced = await outsideReads([ctx.outside], async () => textOf(() => plan(b)));
      const coded = [UNCONTAINED, CHANGED].some((code) => traced.value.includes(code));
      return { ok: others > 0 && seen >= others && traced.reads.length === 0 && coded && !OUTSIDE_NAME.test(traced.value), coded, others, outsideReads: traced.reads.length };
    } finally {
      pp.readAdmittedPackageFile = wrapped;
    }
  },
  R1: async (ctx) => {
    const b = ctx.pkg((d) => { fs.rmSync(path.join(d, "module.air")); fs.linkSync(path.join(ctx.outside, "evil.air"), path.join(d, "module.air")); });
    const m = admitted(() => ctx.S("src/package_manifest.js").validatePackageManifest(b));
    return { ...m, residual: "OD-S1-3 (a): a hard link is an ordinary entry of the folder" };
  }
};
// N15 and N16: validatePackageDir, reportPackageDir and createVerifiedExecutionSession, where each reaches the parse.
async function importRow(ctx, change) {
  const b = await realtimePackage(ctx, { after: change });
  const sdk = ctx.S("src/sdk.js");
  const validate = refused(() => sdk.validatePackageDir(b, { built: false }), UNCONTAINED);
  const report = sdk.reportPackageDir(b);
  const reportOk = (report.errors || []).some((message) => String(message).startsWith(`${UNCONTAINED}:`));
  let session;
  try {
    await ctx.S("src/verified_execution_session.js").createVerifiedExecutionSession(sessionOptions(b, {}));
    session = { ok: false, refused: null };
  } catch (error) {
    session = { ok: true, refused: firstLine(error) };
  }
  const outsideRead = JSON.stringify(report).includes("outside_lib") || JSON.stringify(report).includes("outside_rel");
  return all({ createVerifiedExecutionSession: session, noOutsideModule: { ok: !outsideRead }, reportPackageDir: { ok: reportOk, errors: (report.errors || []).slice(0, 3) }, validatePackageDir: validate });
}

// W rows: one per §4.3 site. A spy on packagePaths.readAdmittedPackageFile
// records each read with the function that made it (from the stack).
const W_ROWS = {
  "W-package_manifest:52": { expect: [["package_manifest.js", "readJson", "air.package.json"]], run: (ctx) => ctx.S("src/package_manifest.js").validatePackageManifest(ctx.pkg(), { built: false }) },
  "W-sdk:444": { expect: [["sdk.js", "checkPackageDir", "entry"]], run: (ctx) => ctx.S("src/sdk.js").checkPackageDir(ctx.pkg(), { built: false }) },
  "W-sdk:791": { expect: [["sdk.js", "reportPackageDir", "entry"]], run: async (ctx) => ctx.S("src/sdk.js").reportPackageDir(await realtimePackage(ctx)) },
  "W-sdk:1925": { expect: [["sdk.js", "attachPackageAiReview", "module"]], run: (ctx) => ctx.S("src/sdk.js").checkPackageDir(ctx.pkg(), { built: false }) },
  "W-sdk:2553": { expect: [["sdk.js", "hostImportsFromEntry", "entry"]], run: (ctx) => ctx.S("src/sdk.js").validatePackageDir(ctx.pkg(), { built: false }) },
  "W-sdk:2612": { expect: [["sdk.js", "attachResourceCertificate", "air.package.json"]], run: (ctx) => ctx.S("src/sdk.js").checkPackageDir(ctx.pkg(), { built: false }) },
  "W-module_graph": {
    expect: [["module_graph.js", "visit", "AIR import module.air"], ["module_graph.js", "modulePublicName", "AIR import lib.air"]],
    run: (ctx) => ctx.S("src/sdk.js").checkPackageDir(ctx.pkg((d) => { fs.writeFileSync(path.join(d, "module.air"), MOD("root_mod", "use \"./lib.air\"\n")); fs.writeFileSync(path.join(d, "lib.air"), LIB("inside_lib")); }), { built: false })
  },
  "W-run_package:551": {
    expect: [["run_package.js", "loadExecutableModule", "entry"]],
    run: (ctx) => ctx.S("src/run_package.js").runHostConstructed(toolGateRequest(ctx.copy(path.join(ROOT, "examples", "tool_gate"), "toolgate")))
  },
  "W-verified_execution_session": {
    expect: [["verified_execution_session.js", "refuseTypedContractPackage", "wasm"], ["verified_execution_session.js", "createVerifiedExecutionSession", "entry"], ["verified_execution_session.js", "createVerifiedExecutionSession", "wasm"]],
    run: async (ctx) => {
      const b = await realtimePackage(ctx);
      const certificate = ctx.S("src/sdk.js").createPackageResourceCertificate(b, { certificateRequired: true });
      return ctx.S("src/verified_execution_session.js").createVerifiedExecutionSession(sessionOptions(b, certificate));
    }
  },
  "W-conformance_replay:83": {
    expect: [["conformance_replay.js", "createConformanceReplayReport", "wasm"]],
    run: async (ctx) => {
      const b = ctx.copy(path.join(ROOT, "test", "fixtures", "conformance_policy"), "policy");
      const { parseAir } = ctx.S("src/parser.js");
      const { lowerToWat, watToWasm } = ctx.S("src/lower_wasm.js");
      const entry = path.join(b, "module.air");
      fs.writeFileSync(path.join(b, "module.wasm"), Buffer.from(await watToWasm(lowerToWat(parseAir(fs.readFileSync(entry, "utf8"), entry)), entry)));
      return ctx.S("src/conformance_replay.js").createConformanceReplayReport(b, { profile: "cli", trace: path.join(b, "traces", "basic.json") });
    }
  },
  // SEC53-01 R4: the read sites R4 adds to section 4.3.
  "W-conformance_replay-entry": { expect: [["conformance_replay.js", "bindingEntryModule", "entry"]], run: (ctx) => replayFixture(ctx, "conformance_policy", "basic.json") },
  "W-conformance_replay-digest": { expect: [["conformance_replay.js", "loadDigestHelperSafety", "entry"]], run: (ctx) => replayFixture(ctx, "conformance_state", "pass.json") },
  "W-sdk-output_emit": { expect: [["sdk.js", "readPackageModulesForOutputEmit", "module"]], run: (ctx) => ctx.S("src/sdk.js").checkPackageDir(ctx.pkg(), { built: false }) },
  "W-sdk-resource_modules": { expect: [["sdk.js", "attachResourceCertificate", "module"]], run: (ctx) => ctx.S("src/sdk.js").checkPackageDir(ctx.pkg(), { built: false }) },
  "W-link_plan-module": {
    expect: [["link_plan.js", "collectCrossModuleCalls", "module"]],
    run: (ctx) => ctx.S("src/link_plan.js").createPackageLinkPlan(ctx.pkg((d) => { fs.writeFileSync(path.join(d, "module.air"), MOD("root_mod", "use \"./lib.air\" as lib\n")); fs.writeFileSync(path.join(d, "lib.air"), LIB("inside_lib")); }), { profile: "cli" })
  },
  "W-link_plan-manifest": { expect: [["link_plan.js", "fileFingerprint", "air.package.json"]], run: (ctx) => ctx.S("src/link_plan.js").createPackageLinkPlan(ctx.pkg(), { profile: "cli" }) },
  "W-sdk:loadPackage": {
    expect: [["sdk.js", "loadPackage", "air-package.json"], ["sdk.js", "loadPackage", "manifest"], ["sdk.js", "loadPackage", "wasm"]],
    run: (ctx) => ctx.S("src/sdk.js").loadPackage(legacy(ctx, { manifest: "m.json", wasm: "x.wasm" }, (d) => { fs.writeFileSync(path.join(d, "x.wasm"), Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0])); fs.writeFileSync(path.join(d, "m.json"), "{}"); }))
  },
  "W-sdk:239": {
    expect: [["sdk.js", "validatePackageDir", "audioManifest"]],
    run: (ctx) => ctx.S("src/sdk.js").validatePackageDir(legacy(ctx, { audioManifest: "a.json", wasm: "x.wasm" }, (d) => { fs.writeFileSync(path.join(d, "x.wasm"), Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0])); fs.writeFileSync(path.join(d, "a.json"), "{}"); }))
  },
  "W-asset_manifest": {
    expect: [["asset_manifest.js", "validateAssetManifest", "asset manifest"], ["asset_manifest.js", "isPlaceholderFile", "BUNDLE_PLACEHOLDER_FILES.jsonl"], ["asset_manifest.js", "isPlaceholderFile", "asset"]],
    run: (ctx) => {
      const b = assetsPackage(ctx, (d) => { fs.writeFileSync(path.join(d, "data", "x.png"), "PNG"); fs.writeFileSync(path.join(d, "BUNDLE_PLACEHOLDER_FILES.jsonl"), "{\"path\": \"other.png\"}\n"); });
      return ctx.S("src/asset_manifest.js").validateAssetManifest(b, "assets.json");
    }
  },
  "W-typed_interface": {
    expect: [["typed_interface.js", "validateTypedPackageBinding", "typedInterface.descriptor"], ["typed_interface.js", "validateTypedPackageBinding", "entry"]],
    run: (ctx) => ctx.S("src/package_manifest.js").validatePackageManifest(typedPackage(ctx), { allowCandidateAbi012: true, built: false })
  }
};
function toolGateRequest(directory) {
  const grant = { id: "agent.tool.invoke", decision: "allow", capability: "output", effects: ["output.emit"], targetId: 7, maxAmount: 100, quotaLimit: 3, rateLimit: 4, expiresAt: 2000, redaction: "required" };
  return {
    package: {
      directory, profile: "mock-output-v011", entrypoint: "decide", requiredGrant: "agent.tool.invoke",
      arguments: [
        { from: "facts", key: "amount" }, { from: "effective", key: "amountLimit" }, { from: "facts", key: "quotaUsed" }, { from: "effective", key: "quotaLimit" },
        { from: "facts", key: "rateUsed" }, { from: "effective", key: "rateLimit" }, { from: "facts", key: "targetId" }, { from: "effective", key: "allowedTargetId" },
        { from: "effective", key: "now" }, { from: "effective", key: "expiresAt" }, { from: "effective", key: "redactionFlag" }
      ]
    },
    facts: { amount: 25, quotaUsed: 1, rateUsed: 1, targetId: 7, requiresRedaction: true },
    grants: [grant],
    limits: { maxAmount: 80, quotaLimit: 2, rateLimit: 3, now: 1000, maxOutputs: 1, maxHostCalls: 1 },
    adapters: { "output.emit": "capture" }
  };
}

function installSpy(ctx, srcRoot) {
  const pp = ctx.S("src/package_paths.js");
  const original = pp.readAdmittedPackageFile;
  const srcDir = path.join(srcRoot, "src") + path.sep;
  const spy = { calls: [] };
  pp.readAdmittedPackageFile = function spiedRead(ref, options) {
    let site = null;
    for (const line of String(new Error().stack).split("\n").slice(2)) {
      const match = /at (?:async )?(?:Object\.)?([^ (]+)? ?\(?([^():]+):\d+:\d+\)?$/.exec(line.trim());
      if (!match || !match[2].startsWith(srcDir) || match[2].endsWith(`${path.sep}package_paths.js`)) continue;
      site = [path.basename(match[2]), match[1] || "<anonymous>"];
      break;
    }
    spy.calls.push({ field: ref && ref.field, fn: site && site[1], file: site && site[0], prefixBytes: options && options.prefixBytes });
    return original.call(this, ref, options);
  };
  return spy;
}

async function runRows(srcRoot, ids) {
  const ctx = rowContext(srcRoot);
  const spy = installSpy(ctx, srcRoot);
  const out = {};
  try {
    for (const id of ids) {
      try {
        if (ROWS[id]) {
          out[id] = await ROWS[id](ctx, spy);
        } else if (W_ROWS[id]) {
          spy.calls.length = 0;
          let thrown = null;
          try { await W_ROWS[id].run(ctx); } catch (error) { thrown = firstLine(error); }
          const seen = spy.calls.map((call) => [call.file, call.fn, call.field]);
          const missing = W_ROWS[id].expect.filter((want) => !seen.some((got) => JSON.stringify(got) === JSON.stringify(want)));
          out[id] = { ok: missing.length === 0, missing, reads: seen, thrown };
        } else {
          out[id] = { ok: false, unknown: true };
        }
      } catch (error) {
        out[id] = { ok: false, thrown: `${error && error.name}: ${firstLine(error)}` };
      }
    }
  } finally {
    fs.rmSync(ctx.work, { force: true, recursive: true });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The mutants (parent side), SEC53-01 spec R3 §6. Each edit names its file and
// an anchor that must occur exactly once in the scratch copy.

const READ = "require(\"./package_paths\").readAdmittedPackageFile";
const MUTANTS = {
  M1: { rows: ["N1", "N2", "N3", "N4", "N5", "N15"], description: "the link test removed from the walk",
    edits: [["package_paths.js", "    if (stat.isSymbolicLink()) throw new PackagePathError(PATH_UNCONTAINED, `${field} ${shown} is or passes through a symbolic link`);\n", ""]] },
  M2: { rows: ["N3"], description: "only the final name tested for a link",
    edits: [["package_paths.js", "    if (stat.isSymbolicLink()) throw new PackagePathError(", "    if (index === segments.length - 1 && stat.isSymbolicLink()) throw new PackagePathError("]] },
  M3: { rows: ["N13"], description: "O_NOFOLLOW dropped", edits: [["package_paths.js", " | (fs.constants.O_NOFOLLOW || 0)", ""]] },
  M4: { rows: ["N12", "N14"], description: "the identity comparison removed",
    edits: [["package_paths.js", "    if (stat.dev !== ref.identity.dev || stat.ino !== ref.identity.ino) throw new PackagePathError(FILE_CHANGED, `${label} is not the file admitted`);\n", ""]] },
  M5: { rows: ["N11"], description: "O_NONBLOCK dropped", edits: [["package_paths.js", "fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | ", "fs.constants.O_RDONLY | "]] },
  M6: { rows: ["N11"], description: "the read-time type test removed",
    edits: [["package_paths.js", "    if (!stat.isFile()) throw new PackagePathError(FILE_INVALID, `${label} is not a regular file`);\n", ""]] },
  M7: { rows: ["N9"], description: "the 4 MiB bound removed",
    edits: [["package_paths.js", "  const maxBytes = options.maxBytes === undefined ? BOUNDED_FILE_MAX_BYTES : options.maxBytes;\n", "  const maxBytes = Number.MAX_SAFE_INTEGER;\n"]] },
  M8: { rows: ["P3", "N17"], description: "packageRoot not passed at hostImportsFromEntry",
    edits: [["sdk.js", "  const mod = parseAir(source, entry, { packageRoot: base });\n", "  const mod = parseAir(source, entry);\n"]] },
  M9: { rows: ["N15", "N16"], description: "src/imports.js ignores packageRoot",
    edits: [["imports.js", "    const inPackage = Boolean(options.packageRoot) && !use.name.startsWith(\"std.\");\n", "    const inPackage = false;\n"]] },
  M10: { rows: ["P6"], description: "std.* not exempted",
    edits: [["imports.js", "    const inPackage = Boolean(options.packageRoot) && !use.name.startsWith(\"std.\");\n", "    const inPackage = Boolean(options.packageRoot);\n"]] },
  M11: { rows: ["P5", "P5b"], description: "the root not resolved with realpath",
    edits: [["package_paths.js", "  return fs.realpathSync.native(path.resolve(base));\n", "  return path.resolve(base);\n"]] },
  M13: { rows: ["N18"], description: "the folder re-check after the open removed",
    edits: [["package_paths.js", "    if (folderChanged(ref.folders)) throw new PackagePathError(FILE_CHANGED, `${label}: a folder on its path changed after admission`);\n", ""]] },
  M14: { rows: ["N19"], description: "ENOTDIR at open mapped to file_invalid", edits: [["package_paths.js", "[\"ELOOP\", \"ENOENT\", \"ENOTDIR\"]", "[\"ELOOP\", \"ENOENT\"]"]] },
  "M15-loadPackage": { rows: ["L1", "L2", "L3"], description: "loadPackage's paths not admitted (today's by-path reads)", edits: [["sdk.js", null, "loadPackage"]] },
  "M15-audio": { rows: ["L4", "L4b", "L4c"], description: "the legacy audio manifest not admitted (read by path)", edits: [["sdk.js", null, "audio"]] },
  "M15-probe": { rows: ["L5"], description: "the manifests.* probe not admitted (existsSync)", edits: [["sdk.js", null, "probe"]] },
  M16: { rows: ["A1", "A2"], description: "the asset validator not routed to admitPackagePath",
    edits: [["asset_manifest.js", "    ref = packagePaths.admitPackagePath(packagePaths.packageRealRoot(base), normalized, field, { optional: true });\n", "    ref = null;\n"]] },
  M17: { rows: ["A3"], description: "the asset prefix read in full with the bound", edits: [["asset_manifest.js", "{ prefixBytes: 512 }", "{}"]] },
  "M18-e2e_proof": { rows: ["I1"], description: "packageRoot not passed at e2e_proof's parse", edits: [["e2e_proof.js", "    const mod = parseAir(source, metadata.entry, { packageRoot: base });\n", "    const mod = parseAir(source, metadata.entry);\n"]] },
  "M18-benchmark_report": { rows: ["I2"], description: "packageRoot not passed at benchmark_report's parse", edits: [["benchmark_report.js", "  const mod = parseAir(source, metadata.entry, { packageRoot: packageDir });\n", "  const mod = parseAir(source, metadata.entry);\n"]] },
  "M18-conformance_replay": { rows: ["I3"], description: "packageRoot not passed at conformance_replay's parse", edits: [["conformance_replay.js", "    const mod = parseAir(packagePaths.readAdmittedPackageFile(packagePaths.admittedRefsOf(manifest).entry, { encoding: \"utf8\" }), entry, { packageRoot: base });\n", "    const mod = parseAir(packagePaths.readAdmittedPackageFile(packagePaths.admittedRefsOf(manifest).entry, { encoding: \"utf8\" }), entry);\n"]] },
  M19: { rows: ["N20"], description: "the end-of-walk folder re-check removed",
    edits: [["package_paths.js", "  if (folderChanged(folders)) throw new PackagePathError(FILE_CHANGED, `${field} ${shown}: a folder on its path changed during admission`);\n", ""]] },
  // SEC53-01 R4 (spec R4 section 6).
  M20: { rows: ["N21", "G1"], description: "admitPackagePath's R4 guard removed (\"..\" walked, a backslash taken)",
    edits: [["package_paths.js", "    throw new PackagePathError(PATH_UNCONTAINED, `${field} ${shown} is not a package-local path`);\n", ""]] },
  M21: { rows: ["G2"], description: "modulePublicName derives the root from ref.relative again",
    edits: [["module_graph.js", "    if (!String(ref.absolute).endsWith(suffix)) return null;\n    const root = String(ref.absolute).slice(0, -suffix.length);\n", "    const root = path.resolve(ref.absolute, ...String(ref.relative).split(\"/\").map(() => \"..\"));\n"]] },
  M22: { rows: ["A4"], description: "a prefix read takes one byte more", edits: [["package_paths.js", "    const want = options.prefixBytes === undefined ? limit + 1 : limit;\n", "    const want = limit + 1;\n"]] },
  M23: { rows: ["G3"], description: "src/imports.js exempts every std. name again", edits: [["imports.js", "    if (options.packageRoot && use.name.startsWith(\"std.\") && !", "    if (false && options.packageRoot && use.name.startsWith(\"std.\") && !"]] },
  M24: { rows: ["G3"], description: "the module graph looks up every std. name in stdlib/ again", edits: [["module_graph.js", "    if (!/^std\\.[A-Za-z_][A-Za-z0-9_]*(\\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(use.name)) {\n", "    if (false) {\n"]] },
  "M25-output_emit": { rows: ["Q3el", "Q3ef"], description: "the output-emit module reads by path again, unadmitted (the base's text)",
    edits: [["sdk.js", "    let source;\n    try {\n      const packagePaths = require(\"./package_paths\");\n      const admittedModule = packagePaths.admitPackagePath(packagePaths.packageRealRoot(base), String(rel).replace(/\\\\/g, \"/\"), \"module\", { optional: true });\n      if (!admittedModule.exists) continue;\n      source = packagePaths.readAdmittedPackageFile(admittedModule, { encoding: \"utf8\" });\n    } catch (err) {\n      if (err && /^air\\.package\\./.test(String(err.code || \"\"))) addCheck(report, \"output-emit\", \"fail\", errorMessage(err));\n      continue;\n    }\n",
      "    const absolute = path.join(base, rel);\n    if (!fs.existsSync(absolute)) continue;\n    let source;\n    try {\n      source = fs.readFileSync(absolute, \"utf8\");\n    } catch (_err) {\n      continue;\n    }\n"]] },
  "M25-resource": { rows: ["Q3el", "Q3ef"], description: "the resource certificate's module reads by path again, unadmitted (the base's text)",
    edits: [["sdk.js", "      const packagePaths = require(\"./package_paths\");\n      const source = packagePaths.readAdmittedPackageFile(packagePaths.admitPackagePath(packagePaths.packageRealRoot(base), relative, \"module\"), { encoding: \"utf8\" });\n",
      "      const absolute = path.join(base, relative);\n      const source = fs.readFileSync(absolute, \"utf8\");\n"]] },
  M26: { rows: ["S1"], description: "the module graph's two containment refusals uncoded again",
    edits: [["module_graph.js", "errors.push(`air.package.path_uncontained: AIR import '${value}' escapes package root`);", "errors.push(`AIR import '${value}' escapes package root`);"], ["module_graph.js", "errors.push(`air.package.path_uncontained: AIR import '${value}' resolves outside package root`);", "errors.push(`AIR import '${value}' resolves outside package root`);"]] },
  // SEC53-01 R5: the binding's containment refusal, raised after SEC53-02's catch.
  M27: { rows: ["I4"], description: "the binding's containment refusal not raised (swallowed by SEC53-02's catch)", edits: [["conformance_replay.js", "    if (refusal) throw refusal;\n", ""]] },
  "M18-conformance_replay_binding": { rows: ["I4"], description: "packageRoot not passed at SEC53-02's binding parse", edits: [["conformance_replay.js", ".entry, { encoding: \"utf8\" }), sourcePath, { packageRoot: base });\n", ".entry, { encoding: \"utf8\" }), sourcePath);\n"]] }
};
// M12, one per §4.3 site: that site reads by path again.
const M12 = {
  "W-package_manifest:52": [["package_manifest.js", ": packagePaths.readAdmittedPackageFile(file, { encoding: \"utf8\" }));\n", ": fs.readFileSync(file.absolute, \"utf8\"));\n"]],
  "W-sdk:444": [["sdk.js", `    source = ${READ}(require("./package_paths").admittedRefsOf(packageManifest).entry, { encoding: "utf8" });\n`, "    source = fs.readFileSync(path.join(base, metadata.entry), \"utf8\");\n"]],
  "W-sdk:791": [["sdk.js", `      const source = ${READ}(require("./package_paths").admittedRefsOf(packageManifest).entry, { encoding: "utf8" });\n      const mod = parseAir(source, metadata.entry, { packageRoot: base });\n`, "      const source = fs.readFileSync(path.join(base, metadata.entry), \"utf8\");\n      const mod = parseAir(source, metadata.entry, { packageRoot: base });\n"]],
  "W-sdk:1925": [["sdk.js", "      const source = packagePaths.readAdmittedPackageFile(packagePaths.admitPackagePath(packagePaths.packageRealRoot(base), String(modulePath).replace(/\\\\/g, \"/\"), \"module\"), { encoding: \"utf8\" });\n", "      const source = fs.readFileSync(path.join(base, modulePath), \"utf8\");\n"]],
  "W-sdk:2553": [["sdk.js", "  const source = packagePaths.readAdmittedPackageFile(packagePaths.admitPackagePath(packagePaths.packageRealRoot(base), entry, \"entry\"), { encoding: \"utf8\" });\n", "  const source = fs.readFileSync(path.join(base, entry), \"utf8\");\n"]],
  "W-sdk:2612": [["sdk.js", `    const manifestBytes = ${READ}(require("./package_paths").admittedRefsOf(packageManifest).manifest);\n`, "    const manifestBytes = fs.readFileSync(path.join(base, PACKAGE_MANIFEST_FILE));\n"]],
  "W-module_graph": [
    ["module_graph.js", "      source = packagePaths.readAdmittedPackageFile(admitted, { encoding: \"utf8\" });\n", "      source = fs.readFileSync(admitted.absolute, \"utf8\");\n"],
    ["module_graph.js", "    const mod = parseAir(packagePaths.readAdmittedPackageFile(admitted, { encoding: \"utf8\" }), ref.absolute, { resolveSourceImports: false });\n", "    const mod = parseAir(fs.readFileSync(admitted.absolute, \"utf8\"), ref.absolute, { resolveSourceImports: false });\n"]
  ],
  "W-run_package:551": [["run_package.js", `  const source = ${READ}(require("./package_paths").admittedRefsOf(manifest).entry, { encoding: "utf8" });\n`, "  const source = fs.readFileSync(entryPath, \"utf8\");\n"]],
  "W-verified_execution_session": [
    ["verified_execution_session.js", "    imports = WebAssembly.Module.imports(new WebAssembly.Module(packagePaths.readAdmittedPackageFile(packagePaths.admitPackagePath(packagePaths.packageRealRoot(base), metadata.wasm, \"wasm\"))));\n", "    imports = WebAssembly.Module.imports(new WebAssembly.Module(fs.readFileSync(path.join(base, metadata.wasm))));\n"],
    ["verified_execution_session.js", `  const source = ${READ}(require("./package_paths").admittedRefsOf(packageManifest).entry, { encoding: "utf8" });\n`, "  const source = fs.readFileSync(sourcePath, \"utf8\");\n"],
    ["verified_execution_session.js", `  const wasm = ${READ}(require("./package_paths").admittedRefsOf(packageManifest).wasm);\n`, "  const wasm = fs.readFileSync(path.join(base, metadata.wasm));\n"]
  ],
  "W-conformance_replay:83": [["conformance_replay.js", `    const wasm = ${READ}(require("./package_paths").admittedRefsOf(manifest).wasm);\n`, "    const wasm = fs.readFileSync(path.join(base, metadata.wasm));\n"]],
  "W-sdk:loadPackage": [
    ["sdk.js", "  const metadata = JSON.parse(packagePaths.readAdmittedPackageFile(metadataRef, { encoding: \"utf8\" }));\n", "  const metadata = JSON.parse(fs.readFileSync(metadataRef.absolute, \"utf8\"));\n"],
    ["sdk.js", "    const manifestBytes = packagePaths.readAdmittedPackageFile(manifestRef);\n", "    const manifestBytes = fs.readFileSync(manifestRef.absolute);\n"],
    ["sdk.js", "    wasmBytes: packagePaths.readAdmittedPackageFile(wasmRef),\n", "    wasmBytes: fs.readFileSync(wasmRef.absolute),\n"]
  ],
  "W-sdk:239": [["sdk.js", "    const audioManifest = loadAudioManifest(audioRef.absolute, { text: packagePaths.readAdmittedPackageFile(audioRef, { encoding: \"utf8\" }) });\n", "    const audioManifest = loadAudioManifest(audioRef.absolute);\n"]],
  "W-asset_manifest": [
    ["asset_manifest.js", `    manifest = JSON.parse(${READ}(manifestRef.ref, { encoding: "utf8" }));\n`, "    manifest = JSON.parse(fs.readFileSync(manifestAbs, \"utf8\"));\n"],
    ["asset_manifest.js", "    const lines = packagePaths.readAdmittedPackageFile(bundleReport, { encoding: \"utf8\" }).split(/\\r?\\n/).filter(Boolean);\n", "    const lines = fs.readFileSync(bundleReport.absolute, \"utf8\").split(/\\r?\\n/).filter(Boolean);\n"],
    ["asset_manifest.js", "  const sample = packagePaths.readAdmittedPackageFile(packagePaths.admitPackagePath(realRoot, rel, \"asset\"), { prefixBytes: 512 }).toString(\"utf8\");\n", "  const sample = fs.readFileSync(file).subarray(0, 512).toString(\"utf8\");\n"]
  ],
  "W-typed_interface": [
    ["typed_interface.js", "  const descriptorText = packagePaths.readAdmittedPackageFile(descriptorRef, { encoding: \"utf8\" });\n", "  const descriptorText = fs.readFileSync(descriptorRef.absolute, \"utf8\");\n"],
    ["typed_interface.js", "    sourceModule = parseV051Air(packagePaths.readAdmittedPackageFile(entryRef, { encoding: \"utf8\" }), entryPath);\n", "    sourceModule = parseV051Air(fs.readFileSync(entryRef.absolute, \"utf8\"), entryPath);\n"]
  ],
  // SEC53-01 R4: the sites R4 adds to section 4.3.
  "W-conformance_replay-entry": [["conformance_replay.js", "    return parseAir(packagePaths.readAdmittedPackageFile(packagePaths.admittedRefsOf(manifest).entry, { encoding: \"utf8\" }), sourcePath, { packageRoot: base });\n", "    return parseAir(fs.readFileSync(sourcePath, \"utf8\"), sourcePath, { packageRoot: base });\n"]],
  "W-conformance_replay-digest": [["conformance_replay.js", "    const mod = parseAir(packagePaths.readAdmittedPackageFile(packagePaths.admittedRefsOf(manifest).entry, { encoding: \"utf8\" }), entry, { packageRoot: base });\n", "    const mod = parseAir(fs.readFileSync(entry, \"utf8\"), entry, { packageRoot: base });\n"]],
  "W-sdk-output_emit": [["sdk.js", "      source = packagePaths.readAdmittedPackageFile(admittedModule, { encoding: \"utf8\" });\n", "      source = fs.readFileSync(admittedModule.absolute, \"utf8\");\n"]],
  "W-sdk-resource_modules": [["sdk.js", "      const source = packagePaths.readAdmittedPackageFile(packagePaths.admitPackagePath(packagePaths.packageRealRoot(base), relative, \"module\"), { encoding: \"utf8\" });\n", "      const source = fs.readFileSync(path.join(base, relative), \"utf8\");\n"]],
  "W-link_plan-module": [["link_plan.js", "    const mod = parseAir(packagePaths.readAdmittedPackageFile(packagePaths.admitPackagePath(packagePaths.packageRealRoot(base), String(modInfo.path).replace(/\\\\/g, \"/\"), \"module\"), { encoding: \"utf8\" }), modInfo.path, { resolveSourceImports: false });\n", "    const mod = parseAir(fs.readFileSync(path.join(base, modInfo.path), \"utf8\"), modInfo.path, { resolveSourceImports: false });\n"]],
  "W-link_plan-manifest": [["link_plan.js", "update(require(\"./package_paths\").readAdmittedPackageFile(ref))", "update(fs.readFileSync(ref.absolute))"]]
};
// SEC53-01 R4: rows beyond its W row that also catch an M12.
const M12_ROWS = { "W-conformance_replay-digest": ["G4a", "G4b"], "W-link_plan-module": ["L6"] };
for (const [site, edits] of Object.entries(M12)) MUTANTS[`M12 ${site}`] = { description: `${site} reads by path again`, edits, rows: [site, ...(M12_ROWS[site] || [])] };

// M15's three parts restore the base's text of that part (no lexical checks, no admission, reads by path).
const M15_BASE = {
  audio: [
    "    // SEC53-01 (§4.2, OD-S1-5 (a)): the audio manifest gets the lexical checks\n",
    "    const audioManifest = loadAudioManifest(audioRef.absolute, { text: packagePaths.readAdmittedPackageFile(audioRef, { encoding: \"utf8\" }) });\n",
    "    const audioManifest = loadAudioManifest(path.join(pkg.base, audioManifestName));\n"],
  loadPackage: [
    "  // SEC53-01 (§4.2, OD-S1-5 (a)): the legacy air-package.json format gets the\n",
    "    manifestPath,\n    manifest\n  };\n}\n",
    "  const metadataPath = path.join(base, \"air-package.json\");\n  if (!fs.existsSync(metadataPath)) throw new Error(`missing air-package.json in ${base}`);\n" +
    "  const metadata = JSON.parse(fs.readFileSync(metadataPath, \"utf8\"));\n  const wasmPath = path.join(base, metadata.wasm || `${metadata.module}.wasm`);\n" +
    "  if (!fs.existsSync(wasmPath)) throw new Error(`missing wasm: ${metadata.wasm}`);\n  let manifest = null;\n  let manifestPath = null;\n  if (metadata.manifest) {\n" +
    "    manifestPath = path.join(base, metadata.manifest);\n    if (!fs.existsSync(manifestPath)) throw new Error(`missing manifest: ${metadata.manifest}`);\n" +
    "    const manifestBytes = fs.readFileSync(manifestPath);\n    if (metadata.manifestHash && sha256(manifestBytes) !== metadata.manifestHash) {\n" +
    "      throw new Error(`manifest hash mismatch for ${metadata.manifest}`);\n    }\n    manifest = JSON.parse(manifestBytes.toString(\"utf8\"));\n  }\n" +
    "  return {\n    base,\n    metadata,\n    wasmPath,\n    wasmBytes: fs.readFileSync(wasmPath),\n    manifestPath,\n    manifest\n  };\n}\n"],
  probe: [
    "      // SEC53-01 (§4.2, OD-S1-5 (a)): the probe is the lexical checks under\n",
    "        exists = packagePaths.admitPackagePath(packagePaths.packageRealRoot(base), local.relative, `manifests.${kind}`, { optional: true }).exists;\n      }\n",
    "      const exists = Boolean(manifestPath && fs.existsSync(path.join(base, manifestPath)));\n"]
};
function applyEdits(text, edits) {
  for (const [, anchor, replacement] of edits) {
    if (anchor === null) {
      // An M15 part: from its comment to its last line, replaced by the base's text.
      const [from, to, base] = M15_BASE[replacement];
      const start = text.indexOf(from);
      const end = start < 0 ? -1 : text.indexOf(to, start);
      if (start < 0 || end < 0 || text.split(from).length !== 2) return null;
      text = text.slice(0, start) + base + text.slice(end + to.length);
      continue;
    }
    if (text.split(anchor).length !== 2) return null;
    text = text.replace(anchor, () => replacement);
  }
  return text;
}
function scratchTree(name, mutant) {
  const scratch = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), `air-sec53-01-${name.replace(/[^A-Za-z0-9_-]+/g, "_")}-`));
  for (const folder of ["src", "stdlib", "data", "kits"]) {
    if (fs.existsSync(path.join(ROOT, folder))) fs.cpSync(path.join(ROOT, folder), path.join(scratch, folder), { recursive: true });
  }
  fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(scratch, "node_modules"), "dir");
  let applied = true;
  const byFile = new Map();
  for (const edit of mutant.edits) byFile.set(edit[0], [...(byFile.get(edit[0]) || []), edit]);
  for (const [file, edits] of byFile) {
    const target = path.join(scratch, "src", file);
    const next = applyEdits(fs.readFileSync(target, "utf8"), edits);
    if (next === null) applied = false;
    else fs.writeFileSync(target, next);
  }
  return { applied, scratch };
}

// One child per hang-prone row (kill timeout), one for the rest.
function runChild(srcRoot, ids) {
  // SEC53-01 R5 (QA's QA-1): the child's work folder is made here and removed here, after the child ends, killed or not.
  const work = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "air-sec53-01-"));
  let out;
  try {
    out = childProcess.spawnSync(process.execPath, [__filename, "--rows", srcRoot, ...ids], {
      cwd: os.tmpdir(), encoding: "utf8", env: { ...process.env, AIR_SEC53_01_WORK: work }, killSignal: "SIGKILL", maxBuffer: 64 * 1024 * 1024,
      timeout: HANG_ROWS.has(ids[0]) && ids.length === 1 ? KILL_MS : 600000
    });
  } finally {
    fs.rmSync(work, { force: true, recursive: true });
  }
  if (out.error || out.signal || out.status !== 0) {
    const reason = out.signal ? `killed by ${out.signal} (timeout)` : `exit ${out.status}: ${String(out.stderr).slice(0, 400)}`;
    return { killed: Boolean(out.signal), results: Object.fromEntries(ids.map((id) => [id, { ok: false, child: reason }])), status: out.status };
  }
  return { killed: false, results: JSON.parse(out.stdout), status: 0 };
}
function runRowSet(srcRoot, ids) {
  const results = {};
  const normal = ids.filter((id) => !HANG_ROWS.has(id));
  let ran = true;
  if (normal.length) {
    const child = runChild(srcRoot, normal);
    if (child.status !== 0 && !child.killed) ran = false;
    Object.assign(results, child.results);
  }
  for (const id of ids.filter((item) => HANG_ROWS.has(item))) {
    const child = runChild(srcRoot, [id]);
    if (child.status !== 0 && !child.killed) ran = false;
    Object.assign(results, child.results);
  }
  return { ran, results };
}

async function main() {
  const failures = [];
  const allRows = [...Object.keys(ROWS), ...Object.keys(W_ROWS)];
  const real = runRowSet(ROOT, allRows);
  for (const id of allRows) {
    const row = real.results[id];
    if (row && row.ok) console.log(`ok - ${id}`);
    else failures.push(`${id}: ${JSON.stringify(row)}`);
  }
  const mutants = {};
  for (const [name, mutant] of Object.entries(MUTANTS)) {
    const { applied, scratch } = scratchTree(name, mutant);
    let ran = false;
    let failing = [];
    if (applied) {
      const set = runRowSet(scratch, mutant.rows);
      ran = set.ran;
      failing = mutant.rows.filter((id) => !(set.results[id] && set.results[id].ok));
    }
    fs.rmSync(scratch, { force: true, recursive: true });
    const caught = applied && ran && failing.length > 0;
    mutants[name] = { applied, caught, description: mutant.description, failing_rows: failing, named_rows: mutant.rows, ran };
    if (caught) console.log(`ok - mutant ${name} (${mutant.description}): applied, ran, caught by ${failing.join(", ")}`);
    else failures.push(`mutant ${name} (${mutant.description}): applied ${applied}, ran ${ran}, caught ${caught}`);
  }
  const list = Object.values(mutants);
  const totals = { applied: list.filter((item) => item.applied).length, caught: list.filter((item) => item.caught).length, mutants: list.length, ran: list.filter((item) => item.ran).length };
  if (process.env.AIR_SEC53_01_RESULTS_DIR) {
    fs.mkdirSync(process.env.AIR_SEC53_01_RESULTS_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.AIR_SEC53_01_RESULTS_DIR, "v053_package_paths.results.json"), `${JSON.stringify({ mutants, platform: process.platform, rows: real.results, totals }, null, 2)}\n`);
  }
  if (failures.length) {
    for (const failure of failures) console.error(`not ok - ${failure}`);
    console.error(`SEC53-01 package paths: ${failures.length} failed`);
    process.exitCode = 1;
    return;
  }
  assert.equal(totals.applied, totals.mutants);
  console.log(`SEC53-01 package paths: ${allRows.length} rows PASS (${Object.keys(ROWS).length} VECTORS.md rows, ${Object.keys(W_ROWS).length} W rows); mutants applied ${totals.applied}, ran ${totals.ran}, caught ${totals.caught} of ${totals.mutants} (${process.platform})`);
}

if (process.argv[2] === "--rows") {
  runRows(path.resolve(process.argv[3]), process.argv.slice(4)).then((out) => process.stdout.write(JSON.stringify(out)), (error) => {
    console.error(error && error.stack || error);
    process.exitCode = 1;
  });
} else {
  main().catch((error) => {
    console.error(error && error.stack || error);
    process.exitCode = 1;
  });
}
