#!/usr/bin/env node

const assert = require("assert");
const cp = require("child_process");
const fs = require("fs");
const path = require("path");
const { checkGeneratedArtifacts, generateHandleModules, verifyGeneratedHandleModules } = require("../src/handle_generator");

const root = path.resolve(__dirname, "..");
const airc = path.join(root, "bin", "airc.js");
const tmpRoot = path.join(root, "build", "handle-generator-tests");
const packageFixture = path.join(root, "test", "fixtures", "package_minimal");

function run(args) {
  return cp.execFileSync(process.execPath, [airc, ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function runFails(args) {
  try {
    run(args);
  } catch (err) {
    return {
      stdout: err.stdout || "",
      stderr: err.stderr || "",
      message: err.message
    };
  }
  throw new Error(`expected command to fail: ${args.join(" ")}`);
}

function copyPackage(dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(packageFixture, dest, { recursive: true });
  fs.writeFileSync(path.join(dest, "module.wasm"), "placeholder wasm for handle generator test\n");
}

fs.rmSync(tmpRoot, { recursive: true, force: true });
fs.mkdirSync(tmpRoot, { recursive: true });

const expected = generateHandleModules(packageFixture);
assert.match(expected["generated/material_handles.air"], /Generated file\. Do not edit manually\./);
assert.match(expected["generated/material_handles.air"], /Generator: repo:bin\/airc\.js/);
assert.match(expected["generated/material_handles.air"], /Source: air\.package\.json/);
assert.match(expected["generated/material_handles.air"], /Source: assets\/manifest\.json/);
assert.match(expected["generated/material_handles.air"], /Manifest fingerprint: [a-f0-9]{16}/);
assert.match(expected["generated/material_handles.air"], /export func mat_package_basic\(\) -> i32/);
assert.match(expected["generated/asset_handles.air"], /export func shader_package_unlit\(\) -> i32/);
assert.match(expected["generated/asset_handles.air"], /export func texture_package_checker\(\) -> i32/);
assert.match(expected["generated/audio_handles.air"], /export func sfx_package_click\(\) -> i32/);
assert.match(expected["generated/audio_handles.air"], /capabilities \{ \}/);
assert.doesNotMatch(expected["generated/audio_handles.air"], /capabilities \{ audio \}/);
assert.match(expected["generated/assets.air"], /Manifest fingerprint: [a-f0-9]{16}/);
assert.match(expected["generated/assets.air"], /const ASSET_COUNT:i32 = [0-9]+/);
assert.match(expected["generated/assets.air"], /table asset_ids:i32\[[0-9]+\] = \[/);
assert.match(expected["generated/assets.air"], /return ASSET_COUNT/);
assert.match(expected["generated/assets.air"], /export func asset_id\(index: i32\) -> i32/);
verifyGeneratedHandleModules(packageFixture);

const generatedExample = run(["verify", "examples/package_manifest/use_generated_handles.air"]);
assert.match(generatedExample, /ok:/);

const pkg = path.join(tmpRoot, "pkg");
copyPackage(pkg);
fs.rmSync(path.join(pkg, "generated"), { recursive: true, force: true });
run(["generate-handles", pkg]);
const once = fs.readFileSync(path.join(pkg, "generated", "material_handles.air"), "utf8");
const onceAssets = fs.readFileSync(path.join(pkg, "generated", "assets.air"), "utf8");
run(["generate-handles", pkg]);
const twice = fs.readFileSync(path.join(pkg, "generated", "material_handles.air"), "utf8");
const twiceAssets = fs.readFileSync(path.join(pkg, "generated", "assets.air"), "utf8");
assert.strictEqual(once, twice);
assert.strictEqual(onceAssets, twiceAssets);

const okReport = JSON.parse(run(["package-check", pkg, "--profile", "browser-webgpu", "--json"]));
assert.notStrictEqual(okReport.status, "fail");
assert.strictEqual(okReport.generatedHandles.ok, true);
assert.match(okReport.generatedHandles.files[0].fingerprint, /^[a-f0-9]{16}$/);
assert.match(okReport.generatedHandles.files[0].expectedFingerprint, /^[a-f0-9]{16}$/);
assert.match(okReport.generatedHandles.files[0].manifestFingerprint, /^[a-f0-9]{16}$/);
assert.strictEqual(okReport.generatedHandles.files[0].manifestFingerprint, okReport.generatedHandles.files[0].expectedManifestFingerprint);
assert(okReport.generatedHandles.files.every((file) => file.sources.some((source) => source.ref === "air.package.json" && source.exists)));
assert(okReport.generatedHandles.files.every((file) => file.sources.some((source) => source.ref === "assets/manifest.json" && source.exists)));
assert(okReport.generatedHandles.files.every((file) => file.generators.some((generator) => generator.ref === "repo:bin/airc.js" && generator.exists)));

const packageGraphGeneratedReport = JSON.parse(run(["report", "package", pkg, "--json"]));
assert.strictEqual(packageGraphGeneratedReport.linkedWasm, false);
assert.strictEqual(packageGraphGeneratedReport.generatedArtifacts.ok, true);
assert.strictEqual(packageGraphGeneratedReport.generatedHandles.ok, true);
assert.deepStrictEqual(packageGraphGeneratedReport.generatedArtifacts.files.map((file) => file.path), [
  "generated/asset_handles.air",
  "generated/assets.air",
  "generated/audio_handles.air",
  "generated/material_handles.air",
  "generated/sprite_handles.air"
]);
assert(packageGraphGeneratedReport.generatedHandles.files.every((file) => file.status === "current"));
assert.deepStrictEqual(JSON.parse(run(["report", "package", pkg, "--json"])), packageGraphGeneratedReport);

const assetsReport = JSON.parse(run(["report", path.join(pkg, "generated", "assets.air")]));
assert.deepStrictEqual(assetsReport.staticTables, [
  {
    name: "asset_ids",
    type: "i32",
    elementType: "i32",
    storageType: "i32",
    length: assetsReport.staticTables[0].length,
    byteWidth: 4,
    byteSize: assetsReport.staticTables[0].length * 4,
    equivalentI32Bytes: assetsReport.staticTables[0].length * 4,
    estimatedI32SavingsBytes: 0,
    staticBytes: assetsReport.staticTables[0].length * 4,
    approximateStorageBytes: assetsReport.staticTables[0].length * 4,
    module: "assets",
    source: path.join(pkg, "generated", "assets.air"),
    origin: "generated"
  }
]);
assert.strictEqual(assetsReport.staticTableSummary.count, 1);

fs.appendFileSync(path.join(pkg, "generated", "assets.air"), "\n// stale generated data edit\n");
const staleGeneratedData = JSON.parse(runFails(["package-check", pkg, "--profile", "browser-webgpu", "--json"]).stdout);
assert.strictEqual(staleGeneratedData.status, "fail");
assert.match(staleGeneratedData.errors.join("\n"), /generated handle file stale: generated\/assets\.air/);
run(["generate-handles", pkg]);

fs.appendFileSync(path.join(pkg, "generated", "material_handles.air"), "\n// stale edit\n");
const stale = JSON.parse(runFails(["package-check", pkg, "--profile", "browser-webgpu", "--json"]).stdout);
assert.strictEqual(stale.status, "fail");
assert.match(stale.errors.join("\n"), /generated handle file stale: generated\/material_handles\.air/);

const missing = path.join(tmpRoot, "missing");
copyPackage(missing);
fs.rmSync(path.join(missing, "generated", "audio_handles.air"));
const missingReport = JSON.parse(runFails(["package-check", missing, "--profile", "browser-webgpu", "--json"]).stdout);
assert.strictEqual(missingReport.status, "fail");
assert.match(missingReport.errors.join("\n"), /generated handle file missing: generated\/audio_handles\.air/);

const missingGeneratedData = path.join(tmpRoot, "missing-assets-data");
copyPackage(missingGeneratedData);
fs.rmSync(path.join(missingGeneratedData, "generated", "assets.air"));
const missingGeneratedDataReport = JSON.parse(runFails(["package-check", missingGeneratedData, "--profile", "browser-webgpu", "--json"]).stdout);
assert.strictEqual(missingGeneratedDataReport.status, "fail");
assert.match(missingGeneratedDataReport.errors.join("\n"), /generated handle file missing: generated\/assets\.air/);

const badManifest = path.join(tmpRoot, "bad-manifest");
copyPackage(badManifest);
const manifestFile = path.join(badManifest, "assets", "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
manifest.assets.shaders.package_unlit.path = "assets/shaders/missing.wgsl";
fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
const badGenerate = runFails(["generate-handles", badManifest]);
assert.match(`${badGenerate.stdout}\n${badGenerate.stderr}`, /asset manifest invalid; cannot generate handles/);
assert.match(`${badGenerate.stdout}\n${badGenerate.stderr}`, /assets\.shaders\.package_unlit missing file/);

const declaredGenerated = path.join(tmpRoot, "declared-generated");
copyPackage(declaredGenerated);
const declaredManifestPath = path.join(declaredGenerated, "air.package.json");
const declaredManifest = JSON.parse(fs.readFileSync(declaredManifestPath, "utf8"));
declaredManifest.generatedModules = ["generated/custom.air"];
fs.writeFileSync(declaredManifestPath, JSON.stringify(declaredManifest, null, 2));
const declaredMissing = JSON.parse(runFails(["package-check", declaredGenerated, "--profile", "browser-webgpu", "--json"]).stdout);
assert.strictEqual(declaredMissing.status, "fail");
assert.match(declaredMissing.errors.join("\n"), /generated module missing: generated\/custom\.air/);

fs.writeFileSync(path.join(declaredGenerated, "generated", "custom.air"), [
  "# Generated file. Do not edit manually.",
  "# Generator: tools/missing_generator.js",
  "# Source: air.package.json",
  "module custom",
  "capabilities { }",
  ""
].join("\n"));
const omittedGenerator = JSON.parse(runFails(["package-check", declaredGenerated, "--profile", "browser-webgpu", "--json"]).stdout);
assert.strictEqual(omittedGenerator.status, "fail");
assert.match(omittedGenerator.errors.join("\n"), /generated module generated\/custom\.air references missing generator: tools\/missing_generator\.js/);

fs.mkdirSync(path.join(declaredGenerated, "tools"), { recursive: true });
fs.writeFileSync(path.join(declaredGenerated, "tools", "missing_generator.js"), "#!/usr/bin/env node\n");
const declaredOk = JSON.parse(run(["package-check", declaredGenerated, "--profile", "browser-webgpu", "--json"]));
assert.notStrictEqual(declaredOk.status, "fail");
assert.strictEqual(declaredOk.generatedArtifacts.ok, true);
assert.deepStrictEqual(declaredOk.generatedArtifacts.files.map((file) => file.path), ["generated/custom.air"]);
assert.match(declaredOk.generatedArtifacts.files[0].fingerprint, /^[a-f0-9]{16}$/);
assert.deepStrictEqual(declaredOk.generatedArtifacts.files[0].sources, [
  { ref: "air.package.json", path: "air.package.json", exists: true }
]);
assert.deepStrictEqual(checkGeneratedArtifacts(declaredGenerated, ["generated/custom.air"]).errors, []);

const untracedGenerated = path.join(tmpRoot, "untraced-generated");
copyPackage(untracedGenerated);
const untracedManifestPath = path.join(untracedGenerated, "air.package.json");
const untracedManifest = JSON.parse(fs.readFileSync(untracedManifestPath, "utf8"));
untracedManifest.generatedModules = ["generated/untraced.air"];
fs.writeFileSync(untracedManifestPath, JSON.stringify(untracedManifest, null, 2));
fs.writeFileSync(path.join(untracedGenerated, "generated", "untraced.air"), [
  "# Generated file. Do not edit manually.",
  "# Generator: repo:bin/airc.js",
  "module untraced",
  "capabilities { }",
  ""
].join("\n"));
const untracedReport = JSON.parse(run(["package-check", untracedGenerated, "--profile", "browser-webgpu", "--json"]));
assert.strictEqual(untracedReport.status, "warn");
assert.match(untracedReport.warnings.join("\n"), /generated module generated\/untraced\.air has no source manifest trace/);

console.log("ok: handle generator tests");
