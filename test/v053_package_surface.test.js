#!/usr/bin/env node
"use strict";

// SCALAR F-1 (AIR_V053_SCALAR_F1_CORRECTION_SPEC_R4_2026_11_07 §5.3 item 4):
// the package's declared entry points, the candidate gate on the root
// lowerToWat, and the removal of the builder-defect seam from src/. Expected
// values are the specification's, never this implementation's output.
// Set AIR_F1_VECTOR_RESULTS_DIR=<dir> to write one result record per row.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const air = require("../src/index");
const sp = require("../src/source_profile");
const { lowerToWat } = require("../src/lower_wasm");
const { buildGfxPackage } = require("../src/gfx_manifest");
const { loadSeamedCopy } = require("./support/harness_seam");

const ROOT = path.resolve(__dirname, "..");
const GATED = Object.freeze({ allowCandidateProfile: true, sourceProfile: "typed-v0.53" });
const T2 = "module v53.vec\nexport func f(a: i32, b: i32) -> i32 {\n%o: i32 = i32.checked_add %a, %b\nreturn %o\n}\n";
const EXPORTS = { ".": "./src/index.js", "./package.json": "./package.json" };

const results = [];
const failures = [];
async function vector(id, action) {
  try {
    const value = await action();
    results.push({ id, status: "PASS", value });
  } catch (error) {
    failures.push(`${id}: ${error && error.stack || error}`);
    results.push({ id, status: "FAIL", value: { error: String(error && error.message || error) } });
  }
}
function codeOf(action) {
  try {
    action();
  } catch (error) {
    return error.code || error.name;
  }
  return "returned";
}
async function asyncCodeOf(action) {
  try {
    await action();
  } catch (error) {
    return error.code || error.name;
  }
  return "returned";
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "air-f1-surface-"));
  try {
    const gated = sp.parseSource(T2, "f1.air", GATED);

    await vector("F1-T01", () => {
      const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
      assert.deepEqual(manifest.exports, EXPORTS);
      return { exports: manifest.exports };
    });

    await vector("F1-T02", async () => {
      const lowered = codeOf(() => lowerToWat(gated));
      const outDir = path.join(tmp, "gfx-out");
      const gfx = await asyncCodeOf(() => buildGfxPackage(gated, {}, { outDir }));
      const written = fs.existsSync(outDir) ? fs.readdirSync(outDir) : null;
      assert.equal(lowered, "air.source_profile.candidate_disabled");
      assert.equal(gfx, "air.source_profile.candidate_disabled");
      assert.deepEqual(written, [], "buildGfxPackage creates outDir and writes no file in it");
      return { buildGfxPackage: gfx, lowerToWat: lowered, out_dir_entries: written };
    });

    await vector("F1-T03", () => {
      const code = codeOf(() => lowerToWat(structuredClone(gated)));
      assert.equal(code, "air.source_profile.candidate_disabled");
      return { lowerToWat_structuredClone: code };
    });

    await vector("F1-T04", () => {
      const wat = lowerToWat(gated, { allowCandidateProfile: true });
      assert.equal(typeof wat, "string");
      assert.match(wat, /^\(module/u);
      assert.match(wat, /\(func \$f \(export "f"\)/u);
      return { wat_bytes: Buffer.byteLength(wat, "utf8") };
    });

    await vector("F1-T05", () => {
      // A scratch copy with the kill switch on, as V53-PROF-N08 makes it; the committed tree keeps it off.
      const copy = path.join(tmp, "killswitch");
      fs.mkdirSync(copy);
      for (const folder of ["src", "stdlib", "data", "kits"]) {
        if (fs.existsSync(path.join(ROOT, folder))) fs.cpSync(path.join(ROOT, folder), path.join(copy, folder), { recursive: true });
      }
      fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(copy, "node_modules"), "dir");
      const profileFile = path.join(copy, "src", "source_profile.js");
      const text = fs.readFileSync(profileFile, "utf8");
      assert.equal(text.split("const disable_typed_v053_profile = false;").length, 2, "exactly one kill-switch constant, off");
      fs.writeFileSync(profileFile, text.replace("const disable_typed_v053_profile = false;", "const disable_typed_v053_profile = true;"));
      const switched = require(path.join(copy, "src", "lower_wasm.js"));
      const withOptIn = codeOf(() => switched.lowerToWat(gated, { allowCandidateProfile: true }));
      const without = codeOf(() => switched.lowerToWat(gated));
      assert.equal(withOptIn, "air.source_profile.unsupported");
      assert.equal(without, "air.source_profile.unsupported");
      return { with_opt_in: withOptIn, without_opt_in: without };
    });

    await vector("F1-T06", () => {
      const named = [];
      const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (/mintHarnessRecord|HARNESS_RECORDS/u.test(fs.readFileSync(full, "latin1"))) named.push(path.relative(ROOT, full));
        }
      };
      walk(path.join(ROOT, "src"));
      const members = Object.keys(require("../src/v052_verified_build").typedV053).sort();
      assert.deepEqual(named, []);
      assert(!members.includes("mintHarnessRecord"), "typedV053 has no mintHarnessRecord");
      return { src_files_naming_the_seam: named, typedV053: members };
    });

    await vector("F1-T07", () => {
      const seam = loadSeamedCopy();
      assert.equal(typeof seam.verifiedBuild.typedV053.mintHarnessRecord, "function", "the copy has the seam");
      assert(!("mintHarnessRecord" in air), "the root never has it");
      return seam.checks;
    });
  } finally {
    fs.rmSync(tmp, { force: true, recursive: true });
  }

  if (process.env.AIR_F1_VECTOR_RESULTS_DIR) {
    fs.mkdirSync(process.env.AIR_F1_VECTOR_RESULTS_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.AIR_F1_VECTOR_RESULTS_DIR, "v053_package_surface.results.json"), `${JSON.stringify(results, null, 2)}\n`);
  }
  const passed = results.filter((item) => item.status === "PASS").length;
  if (failures.length) {
    for (const failure of failures) console.error(failure);
    console.error(`SCALAR F-1 package surface: ${failures.length} failed, ${passed} passed`);
    process.exitCode = 1;
    return;
  }
  console.log(`SCALAR F-1 package surface: ${passed}/${results.length} PASS (F1-T01 to F1-T07)`);
})().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
