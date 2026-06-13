const { AIR_ABI_VERSION } = require("./version");

const AIR_STDLIB = {
  version: AIR_ABI_VERSION,
  purpose: "AI-facing reusable AIR contracts, operations, and deterministic helper modules. Stdlib modules are pure, backend-neutral, and resource-free; host-facing graphics/UI wrappers live in kits or demos.",
  modules: {
    bundles: {
      utility: ["utility.fs", "utility.net", "utility.io", "utility.time", "utility.random", "utility.audio"],
      math: ["math.fixed"],
      rule: "use bundles expand to capabilities and canonical extern signatures before verify/lower."
    },
    imports: {
      source: ["use std.physics", "use std.noise", "use std.transform", "use std.bounds", "use std.color", "use std.easing", "use std.grid", "use \"./module.air\" as local_name"],
      rule: "Source imports are compile-time flattened into one WASM module; no runtime dynamic linking is implied."
    },
    noise: {
      sourceModule: "stdlib/noise.air",
      deterministic: ["noise.abs_i32", "noise.hash2_1000", "noise.hash2", "noise.hash2_mod", "noise.value_noise2_1000", "noise.fbm2_1000", "noise.height_cell", "noise.ridge_cell"],
      rule: "Integer-only helpers provide portable procedural terrain seeds without host random state; noise.hash2 is a legacy alias for noise.hash2_1000 and returns 0..999."
    },
    transform: {
      sourceModule: "stdlib/transform.air",
      helpers: ["transform.deg1000_to_rad", "transform.yaw_forward", "transform.yaw_right", "transform.yaw_pitch_forward", "transform.compose_trs", "transform.transform_point", "transform.transform_vector", "transform.view_projection"],
      rule: "Generic camera basis and TRS helpers write no host state; hosts consume explicit scalar handles or memory layouts."
    },
    bounds: {
      sourceModule: "stdlib/bounds.air",
      helpers: ["bounds.min_i32", "bounds.max_i32", "bounds.abs_i32", "bounds.clamp_i32", "bounds.in_range_i32", "bounds.point_in_aabb_center_i32", "bounds.aabb_overlap_center_i32", "bounds.aabb_from_center_size", "bounds.aabb_merge", "bounds.sphere_radius_sq_from_aabb", "bounds.sphere_visible_plane", "bounds.point_in_rect", "bounds.point_in_circle_sq", "bounds.lod_band"],
      rule: "Bounds helpers are deterministic culling and hit-test math; they do not own scene graphs or renderer visibility state."
    },
    color: {
      sourceModule: "stdlib/color.air",
      helpers: ["color.rgb_pack", "color.rgb_r", "color.rgb_g", "color.rgb_b", "color.rgb_lerp_1000", "color.exposure_mul_1000", "color.bloom_gate", "color.hsv_to_rgb_approx"],
      rule: "Color helpers produce scalar packed colors and tone parameters. Shader color spaces remain host/shader responsibilities."
    },
    easing: {
      sourceModule: "stdlib/easing.air",
      helpers: ["easing.repeat_time", "easing.pingpong_time", "easing.in_quad_1000", "easing.out_quad_1000", "easing.in_out_quad_1000", "easing.in_cubic_1000", "easing.out_cubic_1000", "easing.damp_i32"],
      rule: "Easing helpers are fixed-point deterministic timing curves for animation, UI, and simulation."
    },
    grid: {
      sourceModule: "stdlib/grid.air",
      helpers: ["grid.cell_trunc_i32", "grid.cell_origin_i32", "grid.cell_center_i32", "grid.clamp_coord_i32", "grid.in_bounds_2d", "grid.index_2d", "grid.in_bounds_3d", "grid.index_3d"],
      rule: "Grid helpers provide deterministic coordinate, bounds, and indexing math. They must stay generic and avoid terrain, voxel, biome, route, gameplay, or art-direction semantics."
    },
    math3d: {
      types: ["vec2", "vec3", "vec4", "quat", "mat4"],
      scalar: ["f32.clamp", "f32.lerp", "f32.inverse_lerp", "ease.smoothstep", "ease.out_quad"],
      vectors: ["vec2.*", "vec3.*", "vec4.*", "vec3.move_relative"],
      matrices: ["mat4.identity", "mat4.from_trs", "mat4.mul", "mat4.perspective", "mat4.look_at", "mat4.store_f32"],
      quaternions: ["quat.identity", "quat.from_axis_angle", "quat.mul", "quat.rotate_vec3"],
      raycasts: ["ray.plane_y"],
      collisions: ["collision.sphere_sphere"]
    },
    physics: {
      fixedPoint: "1000 == 1 world unit",
      fixedOps: ["fixed.mul_i32", "fixed.div_i32", "fixed.clamp_i32", "fixed.lerp_i32"],
      sourceModule: "stdlib/physics.air",
      controller: ["physics.damp_i32", "physics.grounded_i32", "physics.snap_y_i32", "physics.snap_vy_i32"],
      helpers: ["physics.clamp_i32", "physics.damp_i32", "physics.grounded_i32", "physics.snap_y_i32", "physics.snap_vy_i32", "physics.inside_box", "physics.capsule_aabb_hit"],
      rule: "Reusable deterministic player-controller primitives stay in AIR lowering, not in a renderer host."
    },
    collision: {
      sourceModule: "stdlib/collision.air",
      helpers: ["collision.lift_y_from_ground", "collision.collision_hit_from_ground", "collision.point_aabb_hit", "collision.sphere_aabb_hit", "collision.ray_sphere_hit", "collision.ray_plane_y_t", "collision.swept_aabb_x_hit"],
      rule: "Generic collision helpers consume explicit ground/contact values. They do not compute terrain, camera routes, or scene-specific height fields."
    },
    packet: {
      sourceModule: "stdlib/packet.air",
      helpers: ["packet.has_flag"],
      rule: "packet.has_flag is generic bitflag logic. Protocol-specific flag aliases belong in examples or reusable network kits, not stdlib."
    },
    network: {
      specs: ["spec/NETWORK_ABI.md"],
      examples: ["network_ipv4_math.air", "network_scan_plan.air", "network_tool_capabilities.air", "network_dns_diagnose.air", "network_route_diagnose.air", "network_packet_record.air", "network_tcp_flags.air"],
      rule: "AIR owns deterministic network reasoning from scalar or packed facts; hosts own raw sockets, capture, DNS execution, scans, subprocesses, and privilege prompts."
    },
    gfxBasicKit: {
      sourceModules: ["kits/gfx-basic/air/gfx3d.air", "kits/gfx-basic/air/scene.air"],
      primitiveRegistry: { box: 1, cylinder: 2, cone: 3, wedge: 4, plane: 5 },
      primitives: ["box", "cylinder", "cone", "wedge", "plane"],
      helpers: ["gfx3d.primitive_flags", "gfx3d.skydome_world", "scene.camera_look_at"],
      imports: ["gfx.draw_primitive", "gfx.camera_look_at", "gfx.skybox_world"],
      rule: "Host-facing graphics helper wrappers are kit material, not stdlib. They may use gfx capability/imports but must not define AIR Core syntax or public ABI."
    },
    uiBasicKit: {
      sourceModules: ["kits/ui-basic/air/ui.air"],
      widgets: ["ui.panel", "ui.label", "ui.badge", "ui.button", "ui.input_i32", "ui.input_f32", "ui.table", "ui.metric", "ui.chart", "ui.status", "ui.warning", "ui.row", "ui.bar", "ui.sparkline"],
      rule: "UI command wrappers are kit material over existing ui.* host imports. They are not resource-free stdlib modules."
    },
    gpu: {
      kit: "kits/gfx-basic",
      manifestSections: ["assets", "shaders", "pipelines", "materials", "scene", "renderTargets", "renderGraphs", "qualityProfiles"],
      assetKinds: ["models", "textures", "sprites", "vectors", "skeletons", "animations"],
      passes: ["clear", "geometry", "voxel", "particles", "sprite", "vector", "ui", "post", "present"],
      shaderLanguage: "WGSL",
      templates: ["kits/gfx-basic/shaders/fullscreen_triangle.wgsl", "kits/gfx-basic/shaders/unlit_mesh.wgsl", "kits/gfx-basic/shaders/sprite_atlas.wgsl", "kits/gfx-basic/shaders/post_tonemap.wgsl"],
      assetFormats: ["gltf", "glb", "png", "jpg", "webp", "svg", "path2d", "msdf"]
    },
    resources: {
      handles: ["models", "textures", "sprites", "vectors", "skeletons", "animations", "pipelines", "renderGraphs", "cameras", "nodes", "voxels", "particles", "inputs"],
      bufferLayouts: ["spec/GFX_BUFFER_LAYOUTS.md", "mat4", "mesh_instance_v0", "sprite_instance_v0", "particle_instance_v0"],
      rules: [
        "AIR source carries behavior; manifest carries resources.",
        "Assets are addressed by stable keys and optional integer handles.",
        "Host-visible instance data uses explicit ptr/length memory layouts; raw GPU objects never cross AIR ABI.",
        "Binary asset embedding in AIR source is intentionally unsupported."
      ]
    },
    asyncIo: {
      capabilities: ["fs", "net", "io"],
      startCalls: ["fs.read_file_async", "fs.write_file_async", "net.http_get_async"],
      completionCalls: ["io.poll", "io.result_len", "io.cancel"],
      loop: "io.poll_bounded %request, count",
      statuses: { pending: 0, ready: 1, error: -1 },
      rule: "Async host calls return request handles; io.poll_bounded polls the original handle and traps unless the final status is ready. Use loop.poll only for explicit status-handling control flow."
    }
  }
};

function emitStdlib() {
  return `${JSON.stringify(AIR_STDLIB, null, 2)}\n`;
}

module.exports = { AIR_STDLIB, emitStdlib };
