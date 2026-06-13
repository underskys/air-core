#!/usr/bin/env node

const assert = require("assert");
const cp = require("child_process");
const fs = require("fs");
const path = require("path");
const { loadHostProfile, validateHostProfile } = require("../src/host_profiles");

const root = path.resolve(__dirname, "..");
const airc = path.join(root, "bin", "airc.js");
const tmpRoot = path.join(root, "build", "host-profile-tests");
const profileFixtures = path.join(__dirname, "fixtures", "profiles");
const packageFixture = path.join(__dirname, "fixtures", "package_minimal");

function run(args) {
  return cp.execFileSync(process.execPath, [airc, ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function assertFails(args, pattern) {
  assert.throws(() => run(args), (err) => pattern.test(`${err.message}\n${err.stdout || ""}\n${err.stderr || ""}`));
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

function copyDir(src, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
}

function fixtureSource(name, replacements = {}) {
  let source = fs.readFileSync(path.join(profileFixtures, name), "utf8");
  for (const [key, value] of Object.entries(replacements)) {
    source = source.replaceAll(`{{${key}}}`, value);
  }
  return source;
}

function writeAirFixture(dir, fixtureName, target = "module.air", replacements = {}) {
  fs.writeFileSync(path.join(dir, target), fixtureSource(fixtureName, replacements));
}

for (const id of ["browser-webgpu", "native-wgpu", "cli", "verifier-only", "mobile-gpu-draft"]) {
  const profile = loadHostProfile(id);
  assert.strictEqual(profile.id, id);
  assert.strictEqual(profile.hostAbi, "0.10");
  assert(profile.diagnostics);
  assert(["fail-with-diagnostic", "warn-with-fallback", "skip-with-reason"].includes(profile.diagnostics.unsupportedFeatureBehavior));
}

const mockOutputProfile = loadHostProfile("mock-output-v011");
assert.strictEqual(mockOutputProfile.hostAbi, "0.11");
assert.deepStrictEqual(mockOutputProfile.supports.capabilities, ["output"]);
assert.deepStrictEqual(mockOutputProfile.supports.hostImports, ["output.emit"]);

assert.throws(() => loadHostProfile("missing-host"), /unknown host profile: missing-host/);

assert.throws(() => validateHostProfile({
  id: "bad",
  name: "Bad",
  hostAbi: "0.10",
  surprise: true,
  supports: {
    capabilities: [],
    hostImports: [],
    assetKinds: [],
    manifestKinds: []
  },
  limits: {
    maxAssets: 0,
    maxTextureSize: 0,
    maxAudioFiles: 0
  }
}), /profile\.surprise is not allowed/);

assert.throws(() => validateHostProfile({
  id: "bad-import",
  name: "Bad Import",
  hostAbi: "0.10",
  supports: {
    capabilities: ["debug"],
    hostImports: ["audio.event"],
    assetKinds: [],
    manifestKinds: []
  },
  limits: {
    maxAssets: 0,
    maxTextureSize: 0,
    maxAudioFiles: 0
  }
}), /unknown supports\.hostImports value: audio\.event/);

assert.throws(() => validateHostProfile({
  id: "bad-diagnostics",
  name: "Bad Diagnostics",
  hostAbi: "0.10",
  supports: {
    capabilities: [],
    hostImports: [],
    assetKinds: [],
    manifestKinds: []
  },
  limits: {
    maxAssets: 0,
    maxTextureSize: 0,
    maxAudioFiles: 0
  },
  diagnostics: {
    ciSafe: "yes",
    manualOnly: false,
    requiredReports: ["package-check --profile"],
    unsupportedFeatureBehavior: "silently-ignore"
  }
}), /diagnostics\.ciSafe must be boolean|diagnostics\.unsupportedFeatureBehavior/);

fs.rmSync(tmpRoot, { recursive: true, force: true });
const built = path.join(tmpRoot, "built");
copyDir(packageFixture, built);
fs.writeFileSync(path.join(built, "module.wasm"), "placeholder wasm for host profile package-check\n");

const packageOut = run(["package-check", built, "--profile", "browser-webgpu"]);
assert.match(packageOut, /status: pass/);

const packageJsonOut = run(["package-check", built, "--profile", "browser-webgpu", "--json"]);
const packageJson = JSON.parse(packageJsonOut);
assert.strictEqual(packageJson.package, "minimal-package-fixture");
assert.strictEqual(packageJson.profile, "browser-webgpu");
assert.strictEqual(packageJson.status, "pass");
assert.strictEqual(packageJson.reportVersion, "0.15");
assert.deepStrictEqual(packageJson.capabilities.required, ["debug"]);
assert.deepStrictEqual(packageJson.capabilities.unsupported, []);
assert.deepStrictEqual(packageJson.hostImports.used, ["debug.metric"]);
assert.deepStrictEqual(packageJson.hostImports.unsupported, []);
assert(packageJson.checks.every((check) => ["pass", "fail", "warn", "skip"].includes(check.status)));
assert(packageJson.checks.some((check) => check.id === "capabilities" && check.status === "pass"));
assert.strictEqual(packageJson.profileSupport.diagnostics.unsupportedFeatureBehavior, "fail-with-diagnostic");
assert.deepStrictEqual(JSON.parse(run(["package-check", built, "--profile", "browser-webgpu", "--json"])), packageJson);

assertFails(["package-check", built, "--profile", "verifier-only"], /profile verifier-only does not support capability debug/);
const unknownProfile = JSON.parse(runFails(["package-check", built, "--profile", "unknown-host", "--json"]).stdout);
assert.strictEqual(unknownProfile.status, "fail");
assert(unknownProfile.repairHints.some((hint) => hint.includes("browser-webgpu") && hint.includes("native-wgpu") && hint.includes("cli") && hint.includes("verifier-only")));

const cliPackage = path.join(tmpRoot, "cli-debug");
copyDir(packageFixture, cliPackage);
const cliManifestPath = path.join(cliPackage, "air.package.json");
const cliManifest = JSON.parse(fs.readFileSync(cliManifestPath, "utf8"));
cliManifest.name = "cli-debug";
cliManifest.targetProfiles = ["cli"];
cliManifest.manifests = {};
fs.writeFileSync(cliManifestPath, JSON.stringify(cliManifest, null, 2));
fs.writeFileSync(path.join(cliPackage, "module.wasm"), "placeholder wasm for cli package-check\n");
const cliJson = JSON.parse(run(["package-check", cliPackage, "--profile", "cli", "--json"]));
assert.strictEqual(cliJson.status, "pass");
assert.deepStrictEqual(cliJson.capabilities.supported, ["debug"]);

const portableGfx = path.join(tmpRoot, "portable-gfx");
fs.mkdirSync(portableGfx, { recursive: true });
writeAirFixture(portableGfx, "portable_gfx.air");
fs.writeFileSync(path.join(portableGfx, "module.wasm"), "placeholder wasm for portable gfx package\n");
fs.writeFileSync(path.join(portableGfx, "air.package.json"), JSON.stringify({
  name: "portable-gfx",
  version: "0.1.0",
  airAbi: "0.10",
  hostAbi: "0.10",
  entry: "module.air",
  wasm: "module.wasm",
  capabilities: ["debug", "gfx"],
  targetProfiles: ["browser-webgpu", "native-wgpu"]
}, null, 2));
const portableBrowser = JSON.parse(run(["package-check", portableGfx, "--profile", "browser-webgpu", "--json"]));
const portableNative = JSON.parse(run(["package-check", portableGfx, "--profile", "native-wgpu", "--json"]));
assert.strictEqual(portableBrowser.status, "pass");
assert.strictEqual(portableNative.status, "pass");
assert.deepStrictEqual(portableBrowser.capabilities.unsupported, []);
assert.deepStrictEqual(portableNative.capabilities.unsupported, []);
assert.deepStrictEqual(portableBrowser.hostImports.unsupported, []);
assert.deepStrictEqual(portableNative.hostImports.unsupported, []);
assert.deepStrictEqual(JSON.parse(run(["package-check", portableGfx, "--profile", "browser-webgpu", "--json"])), portableBrowser);
assert.strictEqual(run(["package-check", portableGfx, "--profile", "native-wgpu"]), run(["package-check", portableGfx, "--profile", "native-wgpu"]));

const checkedInPortableBrowser = JSON.parse(run(["package-check", "examples/profile_portability", "--profile", "browser-webgpu", "--source-only", "--json"]));
const checkedInPortableNative = JSON.parse(run(["package-check", "examples/profile_portability", "--profile", "native-wgpu", "--source-only", "--json"]));
assert.strictEqual(checkedInPortableBrowser.status, "pass");
assert.strictEqual(checkedInPortableNative.status, "pass");
assert.deepStrictEqual(checkedInPortableBrowser.hostImports.unsupported, []);
assert.deepStrictEqual(checkedInPortableNative.hostImports.unsupported, []);

const pureVerifier = path.join(tmpRoot, "pure-verifier-only");
fs.mkdirSync(pureVerifier, { recursive: true });
writeAirFixture(pureVerifier, "pure_verifier_only.air");
fs.writeFileSync(path.join(pureVerifier, "module.wasm"), "placeholder wasm for pure verifier-only package\n");
fs.writeFileSync(path.join(pureVerifier, "air.package.json"), JSON.stringify({
  name: "pure-verifier-only",
  version: "0.1.0",
  airAbi: "0.10",
  hostAbi: "0.10",
  entry: "module.air",
  wasm: "module.wasm",
  capabilities: [],
  targetProfiles: ["verifier-only"]
}, null, 2));
const pureVerifierReport = JSON.parse(run(["package-check", pureVerifier, "--profile", "verifier-only", "--json"]));
assert.strictEqual(pureVerifierReport.status, "pass");
assert.strictEqual(pureVerifierReport.profileSupport.hostAbi, "0.10");
assert.strictEqual(pureVerifierReport.profileSupport.requiredHostAbi, "0.10");
assert.deepStrictEqual(pureVerifierReport.profileSupport.diagnostics.requiredReports, ["package-check --profile", "strict verifier report"]);

const gfxPackage = path.join(tmpRoot, "gfx");
fs.mkdirSync(gfxPackage, { recursive: true });
fs.copyFileSync(path.join(root, "examples", "gfx.air"), path.join(gfxPackage, "module.air"));
fs.writeFileSync(path.join(gfxPackage, "module.wasm"), "placeholder wasm for gfx package-check\n");
fs.writeFileSync(path.join(gfxPackage, "air.package.json"), JSON.stringify({
  name: "gfx-package",
  version: "0.1.0",
  airAbi: "0.10",
  hostAbi: "0.10",
  entry: "module.air",
  wasm: "module.wasm",
  capabilities: ["gfx"],
  targetProfiles: ["verifier-only"]
}, null, 2));
const gfxFail = JSON.parse(runFails(["package-check", gfxPackage, "--profile", "verifier-only", "--json"]).stdout);
assert.strictEqual(gfxFail.status, "fail");
assert.deepStrictEqual(gfxFail.capabilities.unsupported, ["gfx"]);
assert(gfxFail.checks.some((check) => check.id === "capability:gfx" && check.status === "fail" && /remove capability gfx/.test(check.repairHint)));

const hostImportPackage = path.join(tmpRoot, "unsupported-host-import");
fs.mkdirSync(hostImportPackage, { recursive: true });
writeAirFixture(hostImportPackage, "unsupported_host_import.air");
fs.writeFileSync(path.join(hostImportPackage, "module.wasm"), "placeholder wasm for unsupported host import package-check\n");
fs.writeFileSync(path.join(hostImportPackage, "air.package.json"), JSON.stringify({
  name: "unsupported-host-import",
  version: "0.1.0",
  airAbi: "0.10",
  hostAbi: "0.10",
  entry: "module.air",
  wasm: "module.wasm",
  capabilities: ["gfx"],
  targetProfiles: ["browser-webgpu"]
}, null, 2));
const hostImportFail = JSON.parse(runFails(["package-check", hostImportPackage, "--profile", "browser-webgpu", "--json"]).stdout);
assert.strictEqual(hostImportFail.status, "fail");
assert.deepStrictEqual(hostImportFail.capabilities.unsupported, []);
assert.deepStrictEqual(hostImportFail.hostImports.unsupported, ["gfx.camera_look_at"]);
assert(hostImportFail.checks.some((check) => check.id === "host-import:gfx.camera_look_at" && /requires native-wgpu/.test(check.repairHint)));

const badImportPackage = path.join(tmpRoot, "bad-import-package");
fs.mkdirSync(badImportPackage, { recursive: true });
writeAirFixture(badImportPackage, "bad_import.air");
fs.writeFileSync(path.join(badImportPackage, "module.wasm"), "placeholder wasm for bad import package-check\n");
fs.writeFileSync(path.join(badImportPackage, "air.package.json"), JSON.stringify({
  name: "bad-import-package",
  version: "0.1.0",
  airAbi: "0.10",
  hostAbi: "0.10",
  entry: "module.air",
  wasm: "module.wasm",
  capabilities: ["debug"],
  targetProfiles: ["cli"]
}, null, 2));
const badImport = JSON.parse(runFails(["package-check", badImportPackage, "--profile", "cli", "--json"]).stdout);
assert.strictEqual(badImport.status, "fail");
assert.deepStrictEqual(badImport.hostImports.unsupported, ["debug.fake"]);
assert.match(badImport.errors.join("\n"), /unsupported host extern 'debug\.fake'/);
assert(badImport.repairHints.some((hint) => /remove host import debug\.fake/.test(hint)));

const missingAudioCapability = path.join(tmpRoot, "missing-audio-capability");
fs.mkdirSync(missingAudioCapability, { recursive: true });
writeAirFixture(missingAudioCapability, "missing_audio_capability.air");
fs.writeFileSync(path.join(missingAudioCapability, "module.wasm"), "placeholder wasm for missing audio package capability\n");
fs.writeFileSync(path.join(missingAudioCapability, "air.package.json"), JSON.stringify({
  name: "missing-audio-capability",
  version: "0.1.0",
  airAbi: "0.10",
  hostAbi: "0.10",
  entry: "module.air",
  wasm: "module.wasm",
  capabilities: [],
  targetProfiles: ["browser-webgpu"]
}, null, 2));
const missingAudioCapabilityReport = JSON.parse(runFails(["package-check", missingAudioCapability, "--profile", "browser-webgpu", "--json"]).stdout);
assert.strictEqual(missingAudioCapabilityReport.status, "fail");
assert.deepStrictEqual(missingAudioCapabilityReport.declaredCapabilities, []);
assert.deepStrictEqual(missingAudioCapabilityReport.computedCapabilities, ["audio"]);
assert.deepStrictEqual(missingAudioCapabilityReport.capabilityOrigins, { audio: ["module.air"] });
assert(missingAudioCapabilityReport.checks.some((check) => check.id === "package-capability:audio" && check.status === "fail"));
assert(missingAudioCapabilityReport.hiddenAuthority.some((item) => item.capability === "audio" && /without declaring/.test(item.message)));

const missingAudioCapabilitySourceOnly = JSON.parse(runFails(["package-check", missingAudioCapability, "--profile", "browser-webgpu", "--source-only", "--json"]).stdout);
assert.strictEqual(missingAudioCapabilitySourceOnly.mode, "source");
assert.strictEqual(missingAudioCapabilitySourceOnly.status, "fail");
assert(missingAudioCapabilitySourceOnly.checks.some((check) => check.id === "wasm" && check.status === "pass"));
assert(missingAudioCapabilitySourceOnly.checks.some((check) => check.id === "package-capability:audio" && check.status === "fail"));

for (const item of [
  { capability: "gfx", profile: "browser-webgpu", extern: "gfx.draw_cube(x: i32, y: i32, z: i32, size: i32, rot: i32) -> void" },
  { capability: "input", profile: "browser-webgpu", extern: "input.axis(id: i32) -> f32" },
  { capability: "ui", profile: "browser-webgpu", extern: "ui.metric(id: i32, x: i32, y: i32, label: i32, value: i32, unit: i32, style: i32) -> void" },
  { capability: "fs", profile: "cli", extern: "fs.exists(path: i32, path_len: i32) -> bool" },
  { capability: "net", profile: "cli", extern: "net.http_get(url: i32, url_len: i32, out: ptr, out_len: i32) -> i32" }
]) {
  const dir = path.join(tmpRoot, `missing-${item.capability}-package-capability`);
  fs.mkdirSync(dir, { recursive: true });
  writeAirFixture(dir, "missing_package_capability.air", "module.air", item);
  fs.writeFileSync(path.join(dir, "module.wasm"), `placeholder wasm for missing ${item.capability} package capability\n`);
  fs.writeFileSync(path.join(dir, "air.package.json"), JSON.stringify({
    name: `missing-${item.capability}-package-capability`,
    version: "0.1.0",
    airAbi: "0.10",
    hostAbi: "0.10",
    entry: "module.air",
    wasm: "module.wasm",
    capabilities: [],
    targetProfiles: [item.profile]
  }, null, 2));
  const report = JSON.parse(runFails(["package-check", dir, "--profile", item.profile, "--json"]).stdout);
  assert.strictEqual(report.status, "fail");
  assert(report.checks.some((check) => check.id === `package-capability:${item.capability}` && check.status === "fail"), item.capability);
  assert(report.hiddenAuthority.some((entry) => entry.capability === item.capability), item.capability);
}

const audioAssetNoAuthority = path.join(tmpRoot, "audio-asset-no-authority");
fs.mkdirSync(path.join(audioAssetNoAuthority, "assets", "audio"), { recursive: true });
writeAirFixture(audioAssetNoAuthority, "audio_asset_no_authority.air");
fs.writeFileSync(path.join(audioAssetNoAuthority, "module.wasm"), "placeholder wasm for audio asset no authority package\n");
fs.writeFileSync(path.join(audioAssetNoAuthority, "assets", "audio", "click.wav"), "RIFF test wav bytes\n");
fs.writeFileSync(path.join(audioAssetNoAuthority, "assets", "manifest.json"), JSON.stringify({
  version: "0.12",
  assets: {
    audioSfx: {
      click: { path: "assets/audio/click.wav" }
    }
  },
  fallbacks: {}
}, null, 2));
fs.writeFileSync(path.join(audioAssetNoAuthority, "air.package.json"), JSON.stringify({
  name: "audio-asset-no-authority",
  version: "0.1.0",
  airAbi: "0.10",
  hostAbi: "0.10",
  entry: "module.air",
  wasm: "module.wasm",
  capabilities: ["debug"],
  targetProfiles: ["browser-webgpu"],
  manifests: {
    assets: "assets/manifest.json"
  }
}, null, 2));
run(["generate-handles", audioAssetNoAuthority]);
const audioAssetNoAuthorityReport = JSON.parse(run(["package-check", audioAssetNoAuthority, "--profile", "browser-webgpu", "--json"]));
assert.strictEqual(audioAssetNoAuthorityReport.status, "pass");
assert.deepStrictEqual(audioAssetNoAuthorityReport.computedCapabilities, ["debug"]);
assert.strictEqual(audioAssetNoAuthorityReport.assets.authority.audioGranted, false);
assert.deepStrictEqual(audioAssetNoAuthorityReport.hiddenAuthority, []);
assert.deepStrictEqual(audioAssetNoAuthorityReport.assetKinds.required, ["audioSfx"]);

const debugMetricAudioNoPackageCapability = path.join(tmpRoot, "debug-metric-audio-no-package-capability");
fs.mkdirSync(path.join(debugMetricAudioNoPackageCapability, "assets", "manifests"), { recursive: true });
writeAirFixture(debugMetricAudioNoPackageCapability, "debug_metric_audio.air", "module.air", {
  module: "debug_metric_audio_no_package_capability",
  body: ""
});
fs.writeFileSync(path.join(debugMetricAudioNoPackageCapability, "module.wasm"), "placeholder wasm for debug metric audio package\n");
fs.writeFileSync(path.join(debugMetricAudioNoPackageCapability, "assets", "manifests", "audio.json"), JSON.stringify({
  authority: {
    kind: "host-owned",
    source: "module-driven",
    triggers: ["debug.metric:status"]
  },
  sfx: { status: "status.wav" }
}, null, 2));
fs.writeFileSync(path.join(debugMetricAudioNoPackageCapability, "air.package.json"), JSON.stringify({
  name: "debug-metric-audio-no-package-capability",
  version: "0.1.0",
  airAbi: "0.10",
  hostAbi: "0.10",
  entry: "module.air",
  wasm: "module.wasm",
  capabilities: ["debug"],
  targetProfiles: ["browser-webgpu"],
  manifests: {
    audio: "assets/manifests/audio.json"
  }
}, null, 2));
const debugMetricAudioReport = JSON.parse(runFails(["package-check", debugMetricAudioNoPackageCapability, "--profile", "browser-webgpu", "--json"]).stdout);
assert.strictEqual(debugMetricAudioReport.status, "fail");
assert.deepStrictEqual(debugMetricAudioReport.declaredCapabilities, ["debug"]);
assert.deepStrictEqual(debugMetricAudioReport.computedCapabilities, ["audio", "debug"]);
assert.deepStrictEqual(debugMetricAudioReport.capabilityOrigins.audio, ["assets/manifests/audio.json"]);
assert(debugMetricAudioReport.audio.used);
assert.strictEqual(debugMetricAudioReport.audio.authority, "package manifest");
assert(debugMetricAudioReport.checks.some((check) => check.id === "package-capability:audio" && check.status === "fail"));
assert(debugMetricAudioReport.audio.errors.some((error) => /debug\.metric must not authorize audio/.test(error)));

const debugMetricAudioWithPackageAudio = path.join(tmpRoot, "debug-metric-audio-with-package-audio");
fs.mkdirSync(path.join(debugMetricAudioWithPackageAudio, "assets", "manifests"), { recursive: true });
writeAirFixture(debugMetricAudioWithPackageAudio, "debug_metric_audio.air", "module.air", {
  module: "debug_metric_audio_with_package_audio",
  body: "@debug.metric(1, 1)"
});
fs.writeFileSync(path.join(debugMetricAudioWithPackageAudio, "module.wasm"), "placeholder wasm for debug metric audio authority package\n");
fs.writeFileSync(path.join(debugMetricAudioWithPackageAudio, "assets", "manifests", "audio.json"), JSON.stringify({
  authority: {
    kind: "host-owned",
    source: "module-driven",
    triggers: ["debug.metric:status"]
  },
  sfx: { status: "status.wav" }
}, null, 2));
fs.writeFileSync(path.join(debugMetricAudioWithPackageAudio, "air.package.json"), JSON.stringify({
  name: "debug-metric-audio-with-package-audio",
  version: "0.1.0",
  airAbi: "0.10",
  hostAbi: "0.10",
  entry: "module.air",
  wasm: "module.wasm",
  capabilities: ["audio", "debug"],
  targetProfiles: ["browser-webgpu"],
  manifests: {
    audio: "assets/manifests/audio.json"
  }
}, null, 2));
const debugMetricAudioWithPackageAudioReport = JSON.parse(runFails(["package-check", debugMetricAudioWithPackageAudio, "--profile", "browser-webgpu", "--json"]).stdout);
assert.strictEqual(debugMetricAudioWithPackageAudioReport.status, "fail");
assert(debugMetricAudioWithPackageAudioReport.audio.errors.some((error) => /debug\.metric must not authorize audio/.test(error)));
assert(debugMetricAudioWithPackageAudioReport.checks.some((check) => check.id === "audio-authority" && check.status === "fail"));

const audioEventRejected = path.join(tmpRoot, "audio-event-rejected");
fs.mkdirSync(audioEventRejected, { recursive: true });
writeAirFixture(audioEventRejected, "audio_event_rejected.air");
fs.writeFileSync(path.join(audioEventRejected, "module.wasm"), "placeholder wasm for rejected audio event package\n");
fs.writeFileSync(path.join(audioEventRejected, "air.package.json"), JSON.stringify({
  name: "audio-event-rejected",
  version: "0.1.0",
  airAbi: "0.10",
  hostAbi: "0.10",
  entry: "module.air",
  wasm: "module.wasm",
  capabilities: ["audio"],
  targetProfiles: ["browser-webgpu"]
}, null, 2));
const audioEventRejectedReport = JSON.parse(runFails(["package-check", audioEventRejected, "--profile", "browser-webgpu", "--json"]).stdout);
assert.strictEqual(audioEventRejectedReport.status, "fail");
assert.match(audioEventRejectedReport.errors.join("\n"), /unsupported host extern 'audio\.event'|does not support host import audio\.event/);
assert(audioEventRejectedReport.repairHints.some((hint) => /remove host import audio\.event|spec, Host ABI registry/.test(hint)));

const missingManifestPackage = path.join(tmpRoot, "missing-manifest");
copyDir(packageFixture, missingManifestPackage);
fs.writeFileSync(path.join(missingManifestPackage, "module.wasm"), "placeholder wasm for missing manifest package-check\n");
fs.rmSync(path.join(missingManifestPackage, "assets", "manifest.json"));
const missingManifest = JSON.parse(runFails(["package-check", missingManifestPackage, "--profile", "browser-webgpu", "--json"]).stdout);
assert.strictEqual(missingManifest.status, "fail");
assert.strictEqual(missingManifest.manifests.assets.exists, false);
assert.match(missingManifest.errors.join("\n"), /missing assets manifest: assets\/manifest\.json/);
assert(missingManifest.repairHints.some((hint) => /declare manifests\.assets or remove the assets reference/.test(hint)));

const legacyPackage = path.join(tmpRoot, "legacy");
fs.mkdirSync(legacyPackage, { recursive: true });
fs.writeFileSync(path.join(legacyPackage, "legacy.wasm"), "placeholder wasm for legacy package-check\n");
fs.writeFileSync(path.join(legacyPackage, "air-package.json"), JSON.stringify({
  abi: "0.10",
  compiler: "air 0.12-test",
  module: "legacy",
  wasm: "legacy.wasm",
  manifest: null,
  manifestHash: null,
  capabilities: ["debug"],
  exports: [],
  imports: [{ name: "debug.metric", params: ["i32", "i32"], returnType: "void" }]
}, null, 2));
const legacyOut = run(["package-check", legacyPackage]);
assert.match(legacyOut, /^ok: /m);
const legacyJson = JSON.parse(legacyOut.trim().split("\n").at(-1));
assert.deepStrictEqual(Object.keys(legacyJson).sort(), ["abi", "capabilities", "format", "manifest", "module", "ok", "wasm"].sort());
assert.strictEqual(legacyJson.format, "air-package.json");

const reportOut = run(["report", "examples/gfx.air", "--profile", "native-wgpu"]);
const reportJson = JSON.parse(reportOut);
assert.strictEqual(reportJson.hostProfile.id, "native-wgpu");
assert.strictEqual(reportJson.hostProfile.status, "pass");

console.log("ok: host profile tests");
