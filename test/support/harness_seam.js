"use strict";

// SCALAR F-1 (OD-F1-3 (a)): the builder-defect seam is not in src/. This file
// loads a copy of src/ with the seam put back, for the vectors that need a T1
// record a defective builder could have produced. It is not shipped: package.json
// "files" lists no test/support/.
//
// The copy holds src/ and every folder src/ reads by relative path (stdlib/,
// data/, kits/), in a fresh temporary folder outside the trees; node_modules is
// linked so `require("wabt")` resolves. Only the copy's
// src/v052_verified_build.js differs from the shipped file, by exactly the seam
// (the inverse of edits S1-S4). loadSeamedCopy() checks both before it loads.

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const COPIED = ["src", "stdlib", "data", "kits"];
const BUILD = path.join("src", "v052_verified_build.js");

const SEAM_FALLBACK = ["  return null;\n}\n", "  return HARNESS_RECORDS.get(candidate) || null;\n}\n"];
const SEAM_BLOCK = [
  "// Test-only builder-defect seam (docs/v0.53/TYPED_MEMORY.md; V53-MEM-N23,\n",
  "// N38, V53-ABI-42, -58, -64 (c)): mints a T1 record that a defective builder\n",
  "// could have produced, from a real borrowed-lane build, with the artifact\n",
  "// bytes and/or the owned range replaced. Non-enumerable, never in index.js.\n",
  "const HARNESS_RECORDS = new WeakMap();\n",
  "\n",
  "function mintHarnessRecord(options = {}) {\n",
  "  const base = readBorrowedLaneRecord(options.from);\n",
  "  if (!base || !BUILDS.has(options.from)) fail(\"air.v052.runtime_input_invalid\", \"harness record requires a borrowed-lane build\");\n",
  "  const wasmBytes = options.wasmBytes === undefined ? base.wasmBytes : Buffer.from(options.wasmBytes);\n",
  "  const range = options.ownedRange === undefined ? base.ownedRange : options.ownedRange;\n",
  "  if (!range || !Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end)) {\n",
  "    fail(\"air.v052.runtime_input_invalid\", \"harness ownedRange must have integer start and end\");\n",
  "  }\n",
  "  const token = Object.freeze({ kind: \"air.v053.harnessRecord\" });\n",
  "  HARNESS_RECORDS.set(token, Object.freeze({\n",
  "    ...base,\n",
  "    ownedRange: Object.freeze({ end: range.end, start: range.start }),\n",
  "    wasmBytes: Buffer.from(wasmBytes),\n",
  "    wasmDigest: digestBytes(wasmBytes)\n",
  "  }));\n",
  "  return token;\n",
  "}\n",
  "\n"
].join("");
const SEAM_BLOCK_BEFORE = "\nfunction inspectVerifiedTypedBuild(build) {\n";
const SEAM_COMMENT = ["// P0-08 typed borrowed lane (T1 reader, backing limit); not part\n", "// P0-08 typed borrowed lane (T1 reader, test seam, backing limit); not part\n"];
const SEAM_EXPORT = ["    hostWindowOut: typedHostWindowOut,\n", "    hostWindowOut: typedHostWindowOut,\n    mintHarnessRecord,\n"];

function once(text, from, to, label) {
  const count = text.split(from).length - 1;
  assert.equal(count, 1, `harness seam: the ${label} anchor occurs ${count} times, not once`);
  return text.replace(from, () => to);
}

// The exact inverse of edits S1-S4: shipped text -> seamed text.
function injectSeam(shipped) {
  assert(!/mintHarnessRecord|HARNESS_RECORDS/.test(shipped), "harness seam: the shipped file already names the seam");
  let text = once(shipped, SEAM_FALLBACK[0], SEAM_FALLBACK[1], "S1 fallback");
  text = once(text, SEAM_BLOCK_BEFORE, `\n${SEAM_BLOCK}function inspectVerifiedTypedBuild(build) {\n`, "S2 block");
  text = once(text, SEAM_COMMENT[0], SEAM_COMMENT[1], "S3 comment");
  return once(text, SEAM_EXPORT[0], SEAM_EXPORT[1], "S4 export");
}

// Edits S1-S4 themselves: seamed text -> shipped text.
function removeSeam(seamed) {
  let text = once(seamed, SEAM_FALLBACK[1], SEAM_FALLBACK[0], "S1 fallback");
  text = once(text, `\n${SEAM_BLOCK}function inspectVerifiedTypedBuild(build) {\n`, SEAM_BLOCK_BEFORE, "S2 block");
  text = once(text, SEAM_COMMENT[1], SEAM_COMMENT[0], "S3 comment");
  return once(text, SEAM_EXPORT[1], SEAM_EXPORT[0], "S4 export");
}

const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

function listFiles(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full, base) : [path.relative(base, full)];
  }).sort();
}

// Every check the copy must pass, as data: run by loadSeamedCopy() and by F1-T07.
function checkCopy(copyRoot) {
  const shippedText = fs.readFileSync(path.join(ROOT, BUILD), "utf8");
  const seamedText = fs.readFileSync(path.join(copyRoot, BUILD), "utf8");
  const roundTrip = removeSeam(seamedText);
  assert.equal(roundTrip, shippedText, "harness seam: the copy without the injected seam is not the shipped file, byte for byte");
  const compared = [];
  for (const folder of COPIED) {
    if (!fs.existsSync(path.join(ROOT, folder))) continue;
    const shipped = listFiles(path.join(ROOT, folder)).map((file) => path.join(folder, file));
    const copied = listFiles(path.join(copyRoot, folder)).map((file) => path.join(folder, file));
    assert.deepEqual(copied, shipped, `harness seam: ${folder}/ holds other files than the tree`);
    for (const file of shipped) {
      if (file === BUILD) continue;
      assert.equal(sha256(fs.readFileSync(path.join(copyRoot, file))), sha256(fs.readFileSync(path.join(ROOT, file))), `harness seam: ${file} differs from the tree`);
      compared.push(file);
    }
  }
  return {
    copied_folders: COPIED.filter((folder) => fs.existsSync(path.join(ROOT, folder))),
    identical_files: compared.length,
    round_trip: "the copy's src/v052_verified_build.js without the injected seam equals the shipped file",
    seamed_file_sha256: sha256(Buffer.from(seamedText)),
    shipped_file_sha256: sha256(Buffer.from(shippedText))
  };
}

let loaded = null;

function loadSeamedCopy() {
  if (loaded) return loaded;
  const copyRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "air-f1-seam-"));
  for (const folder of COPIED) {
    if (fs.existsSync(path.join(ROOT, folder))) fs.cpSync(path.join(ROOT, folder), path.join(copyRoot, folder), { recursive: true });
  }
  fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(copyRoot, "node_modules"), "dir");
  fs.writeFileSync(path.join(copyRoot, BUILD), injectSeam(fs.readFileSync(path.join(ROOT, BUILD), "utf8")));
  const checks = checkCopy(copyRoot);
  const load = (file) => require(path.join(copyRoot, "src", file));
  loaded = Object.freeze({
    checks,
    copyRoot,
    index: load("index.js"),
    sdk: load("sdk.js"),
    verifiedBuild: load("v052_verified_build.js")
  });
  process.on("exit", () => fs.rmSync(copyRoot, { force: true, recursive: true }));
  return loaded;
}

module.exports = { checkCopy, injectSeam, loadSeamedCopy, removeSeam };
