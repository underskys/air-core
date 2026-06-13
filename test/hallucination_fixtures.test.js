#!/usr/bin/env node

const assert = require("assert");
const cp = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const airc = path.join(root, "bin", "airc.js");
const fixtures = path.join(__dirname, "fixtures", "hallucinations");
const tmpRoot = path.join(root, "build", "hallucination-fixture-tests");

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

function writePackage(name, fixture, manifest = {}) {
  const dir = path.join(tmpRoot, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(fixtures, fixture), path.join(dir, "module.air"));
  fs.writeFileSync(path.join(dir, "module.wasm"), "placeholder wasm for hallucination fixture\n");
  fs.writeFileSync(path.join(dir, "air.package.json"), JSON.stringify({
    name,
    version: "0.1.0",
    airAbi: "0.10",
    hostAbi: "0.10",
    entry: "module.air",
    wasm: "module.wasm",
    capabilities: [],
    targetProfiles: ["cli"],
    ...manifest
  }, null, 2));
  return dir;
}

function packageCheckFails(name, fixture, manifest = {}, profile = "cli") {
  const dir = writePackage(name, fixture, manifest);
  return JSON.parse(runFails(["package-check", dir, "--profile", profile, "--json"]).stdout);
}

fs.rmSync(tmpRoot, { recursive: true, force: true });
fs.mkdirSync(tmpRoot, { recursive: true });

const audioEvent = packageCheckFails("audio-event-rejected", "audio_event.air", {
  capabilities: ["audio"],
  targetProfiles: ["browser-webgpu"]
}, "browser-webgpu");
assert.strictEqual(audioEvent.status, "fail");
assert(audioEvent.checks.some((check) => check.id === "rejected-host-import:audio.event"));
assert(audioEvent.repairHints.some((hint) => /audio\.event is RFC\/deferred.*audio\.beep/.test(hint)));

const effectEvent = packageCheckFails("effect-event-rejected", "effect_event.air", {
  capabilities: ["debug"],
  targetProfiles: ["cli"]
});
assert.strictEqual(effectEvent.status, "fail");
assert(effectEvent.checks.some((check) => check.id === "host-import:effect.event" || check.id === "rejected-host-import:effect.event"));
assert(effectEvent.repairHints.some((hint) => /no stable effect event ABI exists/.test(hint)));

const spriteTransform = packageCheckFails("sprite-transform-rejected", "gfx_draw_sprite_transform.air", {
  capabilities: ["gfx"],
  targetProfiles: ["browser-webgpu"]
}, "browser-webgpu");
assert.strictEqual(spriteTransform.status, "fail");
assert(spriteTransform.checks.some((check) => check.id === "host-import:gfx.draw_sprite_transform" || check.id === "rejected-host-import:gfx.draw_sprite_transform"));
assert(spriteTransform.repairHints.some((hint) => /manifest\/kit path|gfx\.draw_primitive/.test(hint)));

for (const [name, fixture, expectedHint] of [
  ["std-gfx3d-rejected", "std_gfx3d.air", /kits\/gfx-basic|generated\/kits/],
  ["std-scene-rejected", "std_scene.air", /kits\/gfx-basic|project-local/],
  ["std-voxel-rejected", "std_voxel.air", /kits\/voxel-basic/]
]) {
  const report = packageCheckFails(name, fixture, { targetProfiles: ["cli"] });
  assert.strictEqual(report.status, "fail");
  assert(report.checks.some((check) => check.id === "stdlib-import" && expectedHint.test(check.repairHint)));
  assert(report.importClassifications.some((item) => item.class === "rejected-stdlib" && item.status === "rejected"));
}

for (const [name, fixture, protocol] of [
  ["remote-http-rejected", "remote_http.air", "http://"],
  ["remote-https-rejected", "remote_https.air", "https://"],
  ["remote-file-rejected", "remote_file.air", "file://"]
]) {
  const report = packageCheckFails(name, fixture, { targetProfiles: ["cli"] });
  assert.strictEqual(report.status, "fail");
  assert.match(report.errors.join("\n"), new RegExp(protocol.replace(/[/.]/g, "\\$&")));
  assert(report.errors.some((error) => /uses a URL scheme/.test(error)));
}

const hostObjectHandle = packageCheckFails("host-object-handle-rejected", "host_object_handle.air", {
  capabilities: ["gfx"],
  targetProfiles: ["browser-webgpu"]
}, "browser-webgpu");
assert.strictEqual(hostObjectHandle.status, "fail");
assert(hostObjectHandle.checks.some((check) => check.id === "host-object-handle"));
assert(hostObjectHandle.repairHints.some((hint) => /scalar manifest\/package handles/.test(hint)));

const nativeCamera = packageCheckFails("native-camera-rejected-by-browser", "native_camera.air", {
  capabilities: ["gfx"],
  targetProfiles: ["browser-webgpu"]
}, "browser-webgpu");
assert.strictEqual(nativeCamera.status, "fail");
assert.deepStrictEqual(nativeCamera.hostImports.unsupported, ["gfx.camera_look_at"]);
assert(nativeCamera.checks.some((check) => check.id === "host-import:gfx.camera_look_at" && /native-wgpu/.test(check.repairHint)));

const nativeSkybox = packageCheckFails("native-skybox-rejected-by-browser", "native_skybox.air", {
  capabilities: ["gfx"],
  targetProfiles: ["browser-webgpu"]
}, "browser-webgpu");
assert.strictEqual(nativeSkybox.status, "fail");
assert.deepStrictEqual(nativeSkybox.hostImports.unsupported, ["gfx.skybox_world"]);
assert(nativeSkybox.checks.some((check) => check.id === "host-import:gfx.skybox_world" && /native-wgpu/.test(check.repairHint)));

const debugPulseFile = path.join(fixtures, "debug_metric_pulse.air");
const debugPulse = JSON.parse(run(["report", debugPulseFile, "--ai-review"]));
assert.strictEqual(debugPulse.status, "pass");
assert.strictEqual(debugPulse.aiReview.status, "warn");
assert(debugPulse.aiReview.warnings.some((warning) => warning.id === "debug-metric-event-bus"));
assert(debugPulse.aiReview.repairHints.some((hint) => /debug\.metric diagnostic only/.test(hint)));

const surface = JSON.parse(run(["surface", "--profile", "browser-webgpu", "--json"]));
const rejected = new Set(surface.rejectedOrDeferredFeatures.map((item) => item.name));
for (const name of ["audio.event", "effect.event", "gfx.draw_sprite_transform", "std.gfx3d", "std.scene", "std.voxel", "remote imports", "host object handles"]) {
  assert(rejected.has(name), `surface report must reject ${name}`);
}

console.log("ok: hallucination fixture tests");
