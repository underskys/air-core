const { AIR_ABI_VERSION } = require("./version");

const GFX_STDLIB = {
  version: AIR_ABI_VERSION,
  math: {
    vectors: [
      "vec2.new",
      "vec2.add",
      "vec2.dot",
      "vec3.new",
      "vec3.add",
      "vec3.sub",
      "vec3.scale",
      "vec3.dot",
      "vec3.normalize",
      "vec3.move_relative",
      "vec4.new",
      "vec4.dot"
    ],
    transforms: [
      "position",
      "rotation_euler",
      "rotation_quat",
      "scale",
      "camera_basis",
      "look_at",
      "mat4.identity",
      "mat4.from_trs",
      "mat4.perspective",
      "mat4.look_at",
      "transform.compose_trs",
      "transform.yaw_forward",
      "transform.yaw_pitch_forward",
      "quat.identity",
      "quat.from_axis_angle",
      "quat.mul",
      "quat.rotate_vec3"
    ],
    helpers: ["bounds.sphere_visible_plane", "bounds.point_in_rect", "color.rgb_pack", "color.rgb_lerp_1000", "easing.in_out_quad_1000", "ray.plane_y", "collision.sphere_sphere", "collision.sphere_aabb_hit", "f32.clamp", "f32.lerp", "f32.inverse_lerp", "ease.smoothstep", "ease.out_quad"]
  },
  primitives: {
    fullscreen_triangle: { vertices: 3, use: "post-processing and screen effects" },
    sprite_batch: { import: "gpu.draw_sprite_batch", use: "2D quads and atlases" },
    mesh_instance: { import: "gpu.draw_mesh_instanced", use: "glTF/GLB mesh instances" },
    scene_node: { import: "gpu.draw_scene_node", use: "manifest scene graph node" },
    voxel_chunk: { import: "gpu.draw_voxel_chunk", use: "instanced voxel chunks or sparse voxel adapters" },
    particle_batch: { import: "gpu.draw_particles", use: "bounded particle batches owned by the host" }
  },
  assets: {
    static_mesh: {
      formats: ["glb", "gltf"],
      attributes: ["POSITION", "NORMAL", "TEXCOORD_0", "TANGENT"],
      owner: "host loads mesh buffers; AIR references model handles"
    },
    skinned_mesh: {
      formats: ["glb", "gltf"],
      attributes: ["POSITION", "NORMAL", "TEXCOORD_0", "JOINTS_0", "WEIGHTS_0"],
      owner: "host owns skinning and animation mixer; AIR/manifest select handles and playback state"
    },
    animation_clip: {
      channels: ["translation", "rotation", "scale", "weights"],
      playback: ["once", "loop", "pingpong"]
    },
    vector_graphic: {
      formats: ["svg", "path2d", "msdf"],
      uses: ["ui", "decal", "icon", "label"],
      owner: "host rasterizes or tessellates vector assets"
    }
  },
  materials: {
    pbr_lit: {
      model: "pbr",
      required: ["baseColor", "metallic", "roughness"],
      textures: ["base", "normal", "metallicRoughness", "occlusion", "emissive"],
      example: {
        pipeline: "stdlib_unlit_mesh",
        model: "pbr",
        baseColor: [0.8, 0.82, 0.86, 1],
        metallic: 0,
        roughness: 0.72,
        textures: { normal: "normal_map", metallicRoughness: "orm_map" }
      }
    },
    emissive_pbr: {
      model: "pbr",
      required: ["baseColor", "emissive"],
      example: {
        pipeline: "stdlib_unlit_mesh",
        model: "pbr",
        baseColor: [0.05, 0.1, 0.18, 1],
        metallic: 0.2,
        roughness: 0.35,
        emissive: [0.1, 0.55, 1]
      }
    },
    unlit_sprite: { model: "sprite-unlit", required: ["baseColor"], textures: ["base"] },
    voxel_emissive: { model: "voxel-unlit", required: ["baseColor", "emissive"] }
  },
  postEffects: {
    tone_map: { kind: "tone-map", params: ["operator", "exposure"] },
    bloom: { kind: "bloom", params: ["threshold", "radius", "intensity"] },
    screen_flash: { kind: "screen-flash", params: ["color", "intensity", "decay"] },
    simple_blur: { kind: "blur", params: ["radius", "iterations"] },
    lightning_flash: { kind: "lightning-flash", params: ["seed", "branches", "intensity"] },
    depth_of_field: { kind: "depth-of-field", params: ["focusDistance", "aperture"] },
    motion_blur: { kind: "motion-blur", params: ["shutter", "samples"] },
    color_grade: { kind: "color-grade", params: ["exposure", "contrast", "saturation"] }
  },
  lights: {
    directional_key: { kind: "directional", direction: [-0.35, -0.8, -0.2], color: [0.85, 0.9, 1], intensity: 2.5 },
    point_emissive: { kind: "point", position: [0, 1.5, 0], color: [0.1, 0.55, 1], intensity: 6 }
  },
  scenes: {
    environment_skybox: {
      import: "gfx.skybox_world",
      transform: "environment state sampled by world-space view direction; camera translation is ignored; player/camera transform is not inherited",
      use: "cubemap, 3x2 atlas, or spherical/equirectangular skydome environment backgrounds and future IBL/reflection probes"
    },
    orbit_pbr_asset: {
      cameras: { main: { kind: "perspective", fovY: 65, near: 0.05, far: 500, position: [0, 2, 6], target: [0, 0, 0] } },
      lights: ["directional_key", "point_emissive"],
      renderGraph: ["clear", "geometry", "bloom", "tonemap", "present"]
    }
  },
  importers: {
    runtimeReady: ["gltf", "glb"],
    sourceFormats: ["obj", "fbx", "usd", "usda", "usdc"],
    textureFormats: ["png", "jpg", "jpeg", "webp", "svg", "ktx2"],
    vectorFormats: ["svg", "path2d", "msdf"],
    cli: "airc gfx-import path/to/model.obj --name asset_key -o asset.fragment.json"
  },
  input: {
    axes: ["move_x", "move_y", "orbit_x", "orbit_y", "zoom"],
    buttons: ["primary", "secondary", "select", "reset"]
  },
  ui: {
    panels: ["dock", "overlay", "inspector"],
    primitives: ["text_label", "image_quad", "gizmo_handle"]
  },
  bufferLayouts: {
    spec: "spec/GFX_BUFFER_LAYOUTS.md",
    mat4: { bytes: 64, order: "column-major f32[16]", writer: "mat4.store_f32" },
    mesh_instance_v0: { bytes: 80, fields: ["mat4 model", "i32 material", "i32 color", "i32 flags", "i32 user"] },
    sprite_instance_v0: { bytes: 48, fields: ["i32 x/y/w/h", "i32 u0/v0/u1/v1", "i32 color", "i32 depth", "i32 flags", "i32 user"] },
    particle_instance_v0: { bytes: 64, fields: ["f32 position", "f32 velocity", "i32 color", "f32 radius", "f32 lifetime", "i32 flags"] }
  },
  shaders: {
    language: "WGSL",
    templates: [
      "kits/gfx-basic/shaders/fullscreen_triangle.wgsl",
      "kits/gfx-basic/shaders/unlit_mesh.wgsl",
      "kits/gfx-basic/shaders/sprite_atlas.wgsl",
      "kits/gfx-basic/shaders/post_tonemap.wgsl"
    ],
    manifestFragment: "kits/gfx-basic/manifest.fragment.json"
  },
  renderGraphPasses: ["clear", "geometry", "voxel", "particles", "sprite", "vector", "ui", "post", "present"]
};

function emitGfxStdlib() {
  return `${JSON.stringify(GFX_STDLIB, null, 2)}\n`;
}

module.exports = { GFX_STDLIB, emitGfxStdlib };
