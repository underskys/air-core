#!/usr/bin/env node

const assert = require("assert");
const cp = require("child_process");
const path = require("path");

const root = path.resolve(__dirname, "..");
const airc = path.join(root, "bin", "airc.js");

function run(args) {
  return cp.execFileSync(process.execPath, [airc, ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

const first = JSON.parse(run(["surface", "--profile", "browser-webgpu", "--json"]));
const second = JSON.parse(run(["surface", "--profile", "browser-webgpu", "--json"]));
assert.deepStrictEqual(first, second);

assert.strictEqual(first.reportVersion, "0.15");
assert.strictEqual(first.kind, "surface");
assert.strictEqual(first.profile, "browser-webgpu");
assert(first.activeCoreFeatures.includes("moduleGraph"));
assert(first.activeCoreFeatures.includes("staticScalarTables"));
assert(first.activeCoreFeatures.includes("packageCheckSourceOnly"));

const rejectedNames = first.rejectedOrDeferredFeatures.map((item) => item.name);
assert(rejectedNames.includes("audio.event"));
assert(rejectedNames.includes("effect.event"));
assert(rejectedNames.includes("gfx.draw_sprite_transform"));
assert(rejectedNames.includes("std.gfx3d"));
assert(rejectedNames.includes("std.voxel"));
assert(rejectedNames.includes("host object handles"));

const grid = first.stdlib.modules.find((item) => item.name === "grid");
assert(grid);
assert.strictEqual(grid.hostAuthorityFree, true);
assert(grid.exportedHelpers.includes("grid.index_2d"));
assert(!first.stdlib.modules.some((item) => item.name === "voxel"));

assert(first.kits.some((item) => item.name === "kits/gfx-basic"));
assert(first.kits.some((item) => item.name === "kits/voxel-basic" && item.status === "experimental kit"));
assert(first.kits.every((item) => /not importable as std\.\*/.test(item.importRule)));

assert(first.hostProfiles.selected.supportedCapabilities.includes("gfx"));
assert(first.hostProfiles.selected.supportedHostImports.includes("gfx.draw_primitive"));
assert(first.hostProfiles.selected.supportedManifestKinds.includes("gfx"));

const cameraUnsupported = first.hostProfiles.unsupportedHostImports.find((item) => item.name === "gfx.camera_look_at");
assert(cameraUnsupported);
assert(cameraUnsupported.alternatives.includes("native-wgpu"));

assert.match(first.repairHints["std.gfx3d"], /not stdlib/);
assert.match(first.repairHints["std.voxel"], /kits\/voxel-basic/);
assert.match(first.repairHints["audio.event"], /audio\.beep/);
assert.match(first.repairHints["gfx.draw_sprite_transform"], /RFC\/deferred/);

console.log("ok: surface report tests");
