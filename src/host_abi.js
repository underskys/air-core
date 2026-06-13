const HOST_SIGNATURES = new Map([
  ["debug.metric", { params: ["i32", "i32"], returnType: "void" }],
  ["fs.exists", { params: ["i32", "i32"], returnType: "bool" }],
  ["fs.read_file", { params: ["i32", "i32", "ptr", "i32"], returnType: "i32" }],
  ["fs.write_file", { params: ["i32", "i32", "ptr", "i32"], returnType: "i32" }],
  ["net.http_get", { params: ["i32", "i32", "ptr", "i32"], returnType: "i32" }],
  ["fs.read_file_async", { params: ["i32", "i32", "ptr", "i32"], returnType: "i32" }],
  ["fs.write_file_async", { params: ["i32", "i32", "ptr", "i32"], returnType: "i32" }],
  ["net.http_get_async", { params: ["i32", "i32", "ptr", "i32"], returnType: "i32" }],
  ["io.poll", { params: ["i32"], returnType: "i32" }],
  ["io.cancel", { params: ["i32"], returnType: "void" }],
  ["io.result_len", { params: ["i32"], returnType: "i32" }],
  ["time.now_ms", { params: [], returnType: "i64" }],
  ["time.monotonic_ms", { params: [], returnType: "i64" }],
  ["random.u32", { params: [], returnType: "i32" }],
  ["random.f32", { params: [], returnType: "f32" }],
  ["audio.beep", { params: ["i32"], returnType: "void" }],
  ["audio.play_tone", { params: ["f32", "i32"], returnType: "void" }],
  ["audio.set_gain", { params: ["f32"], returnType: "void" }],
  ["gfx.begin_frame", { params: ["i32"], returnType: "void" }],
  ["gfx.camera_look_at", { params: ["i32", "i32", "i32", "i32", "i32", "i32", "i32"], returnType: "void" }],
  ["gfx.draw_cube", { params: ["i32", "i32", "i32", "i32", "i32"], returnType: "void" }],
  ["gfx.draw_primitive", { params: ["i32", "i32", "i32", "i32", "i32", "i32", "i32", "i32", "i32", "i32", "i32", "i32", "i32", "i32"], returnType: "void" }],
  ["gfx.skybox_world", { params: ["i32", "i32", "i32", "i32", "i32", "i32"], returnType: "void" }],
  ["gfx.end_frame", { params: [], returnType: "void" }],
  ["ui.begin_frame", { params: ["i32", "i32", "i32"], returnType: "void" }],
  ["ui.panel", { params: ["i32", "i32", "i32", "i32", "i32", "i32"], returnType: "void" }],
  ["ui.label", { params: ["i32", "i32", "i32", "i32", "i32"], returnType: "void" }],
  ["ui.badge", { params: ["i32", "i32", "i32", "i32", "i32"], returnType: "void" }],
  ["ui.button", { params: ["i32", "i32", "i32", "i32", "i32", "i32", "i32"], returnType: "bool" }],
  ["ui.input_i32", { params: ["i32", "i32", "i32", "i32", "i32", "i32", "i32"], returnType: "i32" }],
  ["ui.input_f32", { params: ["i32", "i32", "i32", "i32", "i32", "f32", "i32"], returnType: "f32" }],
  ["ui.bar", { params: ["i32", "i32", "i32", "i32", "i32", "i32", "i32"], returnType: "void" }],
  ["ui.row", { params: ["i32", "i32", "i32", "i32", "i32", "i32", "i32"], returnType: "void" }],
  ["ui.table", { params: ["i32", "i32", "i32", "i32", "i32", "i32", "i32", "i32", "i32"], returnType: "void" }],
  ["ui.metric", { params: ["i32", "i32", "i32", "i32", "i32", "i32", "i32"], returnType: "void" }],
  ["ui.chart", { params: ["i32", "i32", "i32", "i32", "i32", "i32", "i32"], returnType: "void" }],
  ["ui.status", { params: ["i32", "i32", "i32", "i32", "i32", "i32"], returnType: "void" }],
  ["ui.warning", { params: ["i32", "i32", "i32", "i32", "i32", "i32"], returnType: "void" }],
  ["ui.sparkline", { params: ["i32", "i32", "i32", "i32", "i32", "i32", "i32"], returnType: "void" }],
  ["ui.end_frame", { params: [], returnType: "void" }],
  ["gpu.begin_frame", { params: ["i32", "i32", "i32", "i32"], returnType: "void" }],
  ["gpu.begin_pass", { params: [], returnType: "void" }],
  ["gpu.set_scene_time", { params: ["i32"], returnType: "void" }],
  ["gpu.set_camera", { params: ["i32"], returnType: "void", handleArg: { index: 0, kind: "camera" } }],
  ["gpu.set_camera_matrix", { params: ["i32", "ptr", "i32"], returnType: "void", handleArg: { index: 0, kind: "camera" } }],
  ["gpu.set_pipeline", { params: ["i32"], returnType: "void", handleArg: { index: 0, kind: "pipeline" } }],
  ["gpu.set_bind_group", { params: ["i32"], returnType: "void", handleArg: { index: 0, kind: "bindGroup" } }],
  ["gpu.set_vertex_buffer", { params: ["i32"], returnType: "void", handleArg: { index: 0, kind: "buffer" } }],
  ["gpu.set_index_buffer", { params: ["i32"], returnType: "void", handleArg: { index: 0, kind: "buffer" } }],
  ["gpu.draw", { params: ["i32", "i32"], returnType: "void" }],
  ["gpu.draw_indexed", { params: ["i32", "i32"], returnType: "void" }],
  ["gpu.draw_instanced", { params: ["i32", "i32"], returnType: "void" }],
  ["gpu.draw_mesh_instanced", { params: ["i32", "i32"], returnType: "void", handleArg: { index: 0, kind: "mesh" } }],
  ["gpu.draw_sprite_batch", { params: ["i32", "i32"], returnType: "void", handleArg: { index: 0, kind: "sprite" } }],
  ["gpu.draw_scene_node", { params: ["i32", "i32"], returnType: "void", handleArg: { index: 0, kind: "node" } }],
  ["gpu.draw_voxel_chunk", { params: ["i32", "i32"], returnType: "void", handleArg: { index: 0, kind: "voxel" } }],
  ["gpu.draw_particles", { params: ["i32", "i32"], returnType: "void", handleArg: { index: 0, kind: "particle" } }],
  ["gpu.execute_render_graph", { params: ["i32"], returnType: "void", handleArg: { index: 0, kind: "renderGraph" } }],
  ["gpu.end_pass", { params: [], returnType: "void" }],
  ["gpu.submit", { params: [], returnType: "void" }],
  ["gpu.destroy", { params: ["i32"], returnType: "void" }],
  ["input.axis", { params: ["i32"], returnType: "f32", handleArg: { index: 0, kind: "input" } }],
  ["input.button", { params: ["i32"], returnType: "bool", handleArg: { index: 0, kind: "input" } }],
  ["input.pointer_delta_x", { params: [], returnType: "f32" }],
  ["input.pointer_delta_y", { params: [], returnType: "f32" }],
  ["input.pointer_down", { params: [], returnType: "bool" }],
  ["input.touch_axis", { params: ["i32"], returnType: "f32", handleArg: { index: 0, kind: "input" } }],
  ["output.emit", { params: ["i32", "i32", "i32", "i32", "i32"], returnType: "i32" }]
]);

const STRICT_HOST_MODULES = new Set(["debug", "device", "fs", "net", "time", "random", "audio", "io", "gfx", "ui", "gpu", "input", "output", "stdio"]);

const GPU_SIGNATURES = signaturesForCapability("gpu");
const INPUT_SIGNATURES = signaturesForCapability("input");

function hostSignature(name) {
  return HOST_SIGNATURES.get(name);
}

function isStrictHostModule(name) {
  const idx = name.indexOf(".");
  return idx > 0 && STRICT_HOST_MODULES.has(name.slice(0, idx));
}

function hostSignaturesForCapability(capability) {
  return signaturesForCapability(capability);
}

function hostFunctionNamesForCapability(capability) {
  return Array.from(hostSignaturesForCapability(capability).keys()).map((name) => name.slice(capability.length + 1)).sort();
}

function signaturesForCapability(capability) {
  const prefix = `${capability}.`;
  return new Map(Array.from(HOST_SIGNATURES.entries()).filter(([name]) => name.startsWith(prefix)));
}

module.exports = {
  HOST_SIGNATURES,
  STRICT_HOST_MODULES,
  GPU_SIGNATURES,
  INPUT_SIGNATURES,
  hostSignature,
  hostSignaturesForCapability,
  hostFunctionNamesForCapability,
  isStrictHostModule
};
