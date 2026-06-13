const { AIR_ABI_VERSION } = require("./version");

const AIR_REGISTRY = {
  version: AIR_ABI_VERSION,
  layers: {
    core: {
      purpose: "Minimal AIR language semantics: SSA, scalar types, control flow, memory regions, calls, effects, and contracts.",
      types: ["i32", "i64", "f32", "f64", "bool", "ptr", "slice", "void"],
      ops: [
        "const.i32", "const.i64", "const.f32", "const.f64", "const.bool", "const.str",
        "i32.add", "i32.sub", "i32.mul", "i32.div_s", "i32.rem_s", "i32.and", "i32.or", "i32.xor", "i32.shl", "i32.shr_u",
        "f32.add", "f32.sub", "f32.mul", "f32.div", "f32.sqrt", "f32.min", "f32.max",
        "i32.eq", "i32.ne", "i32.lt_s", "i32.gt_s", "i32.le_s", "i32.ge_s",
        "bool.and", "bool.or", "bool.not",
        "select.i32", "select.f32",
        "call", "return", "br", "br_if", "phi.i32", "phi.f32", "phi.bool",
        "alloc_region", "free_region", "load.i32", "load.f32", "store.i32", "store.f32",
        "slice.from_region", "slice.sub", "slice.len", "slice.load.i32", "slice.load.f32", "slice.store.i32", "slice.store.f32",
        "loop.fold.i32", "loop.fold.f32", "loop.array.i32", "loop.array.f32", "loop.buffer.f32", "loop.poll",
        "array.new", "array.get", "array.set", "buffer.from_ptr", "buffer.load", "buffer.store",
        "struct.new", "struct.get.*", "struct.set.*",
        "mat4.from_trs", "mat4.store_f32",
        "global.get", "global.set", "print"
      ]
    },
    stdlib: {
      purpose: "Domain helpers that are verified/lowered today but are not AIR Core semantics.",
      types: ["vec2", "vec3", "vec4", "quat", "mat4", "array<T,N>", "buffer<T,N>", "struct"],
      modules: {
        math3d: ["vec2.*", "vec3.*", "vec4.*", "mat4.*", "mat4.from_trs", "mat4.store_f32", "quat.*", "ray.plane_y", "collision.sphere_sphere"],
        transform: ["transform.yaw_forward", "transform.yaw_pitch_forward", "transform.compose_trs", "transform.transform_point", "transform.view_projection"],
        bounds: ["bounds.aabb_from_center_size", "bounds.aabb_merge", "bounds.sphere_visible_plane", "bounds.point_in_rect", "bounds.point_in_circle_sq", "bounds.lod_band"],
        color: ["color.rgb_pack", "color.rgb_lerp_1000", "color.hsv_to_rgb_approx", "color.exposure_mul_1000"],
        easing: ["easing.repeat_time", "easing.pingpong_time", "easing.in_quad_1000", "easing.out_quad_1000", "easing.in_out_quad_1000"],
        fixed: ["fixed.mul_i32", "fixed.div_i32", "fixed.clamp_i32", "fixed.lerp_i32"],
        physics: ["physics.damp_i32", "physics.grounded_i32", "physics.snap_y_i32", "physics.snap_vy_i32"],
        collision: ["collision.lift_y_from_ground", "collision.collision_hit_from_ground"],
        packet: ["generic bitflags: packet.has_flag"],
        network: ["IPv4/CIDR math", "scan planning", "DNS verdicts", "route verdicts", "packet fact scoring"],
        gfx: ["high-level gfx3d primitives", "GFX kit shader references", "render graph manifest blocks"],
        asyncIo: ["utility.fs", "utility.net", "utility.io", "io.poll_bounded", "loop.poll conventions"]
      }
    },
    hostAbi: {
      purpose: "Capability-qualified imports implemented by hosts, not by AIR Core.",
      capabilities: ["fs", "net", "io", "input", "gpu", "gfx", "ui", "audio", "time", "random", "debug", "stdio"],
      graphics: {
        gpu: "raw GPU and render graph ABI validated against .airgfx.json manifests",
        gfx: "optional high-level host-owned drawing ABI for simple commands and stdlib primitives",
        ui: "optional host-owned dashboard/web-utility UI ABI using numeric label/data IDs and layout commands"
      }
    }
  }
};

function emitRegistry() {
  return `${JSON.stringify(AIR_REGISTRY, null, 2)}\n`;
}

module.exports = { AIR_REGISTRY, emitRegistry };
