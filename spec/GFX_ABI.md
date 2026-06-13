# AIR Raw GPU / Render Graph ABI v0.10

AIR Raw GPU is a plugin ABI for AI-generated AIR modules. AIR does not become a game engine; AIR emits compact GPU commands through `gpu.*` imports, while the host owns real WebGPU, WebGL, Metal, Vulkan, or Direct3D objects.

This spec covers only `gpu.*`. The optional high-level drawing ABI `gfx.*` is documented separately in `GFX_HIGH_LEVEL_ABI.md`.

Game/simulation package manifests are layered on top of this ABI:

- `GFX_SCENE_LAYOUT.md`: high-level arena/module layout JSON.
- `GFX_COLLISION.md`: collision and trigger metadata separate from art meshes.
- `GFX_MATERIALS.md`: PBR-style material and texture metadata.
- `GFX_ASSETS.md`: mesh, skeleton animation, and vector graphics metadata.

These files are tooling/package layers. They do not add AIR Core semantics.

v0.3 introduced raw GPU commands. v0.4 added Scene + Render Graph declarations. v0.5 added package metadata, render target/depth declarations, and browser/native conformance reporting. v0.6 added an AI-facing GFX standard block catalog. v0.7 added input bindings, UI resources, interactive app validation, and shared browser/native conformance metadata. v0.9 aligned the raw GFX ABI with AIR v0.9, added explicit matrix handoff semantics, and standardized skybox/environment render graph passes. v0.10 adds portable host-visible buffer layout contracts for matrices, mesh instances, sprites, and particles.
The current GFX layer also validates richer PBR material fields, light/camera parameters, and post-effect parameter ranges, and includes manifest-fragment scaffolding for source asset imports.

The first backend is Browser WebGPU with WGSL shaders. Native Metal/Vulkan/D3D should be reached through a WebGPU-compatible native backend such as `wgpu` or Dawn, not by changing AIR Core.

## Capability

```air
capabilities { gpu }
```

Every `extern gpu.*` import requires `capabilities { gpu }`.
The verifier checks `gpu.*` names and scalar signatures against the shared host
ABI registry. `gfx-check` then validates manifest-visible resource references,
handles, render graph lifecycle, and target compatibility.

## Manifest

GPU modules use a JSON manifest next to the `.air` file:

```json
{
  "version": "0.10",
  "module": "ui_tool",
  "package": { "abi": "0.10", "kind": "air-gfx-package" },
  "targets": {
    "browser": { "backend": "webgpu" },
    "native": { "backend": "wgpu" }
  },
  "inputs": {
    "orbit_x": { "kind": "axis", "handle": 1, "bindings": { "browser": "mouse.dx|ArrowLeft|ArrowRight", "native": "mouse.dx" } },
    "select": { "kind": "button", "handle": 4, "bindings": { "browser": "MouseLeft|Space", "native": "MouseLeft" } }
  },
  "assets": {
    "models": {
      "arena_platform": { "path": "gpu_arena/assets/arena_platform.gltf", "handle": 1 }
    },
    "textures": {
      "rune_atlas": { "path": "gpu_arena/assets/rune_atlas.svg", "handle": 1 }
    },
    "vectors": {
      "rune_mark": { "path": "gpu_arena/assets/rune_atlas.svg", "format": "svg", "usage": "decal", "handle": 1 }
    },
    "sprites": {
      "blue_rune": { "texture": "rune_atlas", "handle": 1 }
    }
  },
  "shaders": {
    "arena_wgsl": { "path": "gpu_arena/shaders/arena.wgsl", "vertex": "vs_main", "fragment": "fs_main" }
  },
  "pipelines": {
    "arena_pipeline": { "shader": "arena_wgsl" }
  },
  "renderTargets": {
    "scene_color": { "format": "bgra8unorm", "size": "canvas", "usage": ["render", "sample"] },
    "bloom_color": { "format": "bgra8unorm", "scale": 0.5, "usage": ["render", "sample"] },
    "backbuffer": { "format": "surface", "size": "canvas", "usage": ["present"] }
  },
  "depth": {
    "target": "scene_depth",
    "format": "depth24plus",
    "size": "canvas",
    "enabled": true
  },
  "materials": {
    "heated_panel": {
      "pipeline": "arena_pipeline",
      "model": "pbr",
      "baseColor": [0.15, 0.38, 0.95, 1],
      "metallic": 0.8,
      "roughness": 0.35,
      "textures": {
        "normal": "panel_normal",
        "metallicRoughness": "panel_orm",
        "emissive": "rune_atlas"
      }
    }
  },
  "scene": {
    "cameras": {
      "main": { "kind": "perspective", "fovY": 65 }
    },
    "nodes": {
      "platform": { "mesh": "arena_platform", "material": "heated_panel" }
    },
    "voxels": {
      "energy_columns": { "material": "heated_panel", "chunkSize": 16, "budget": 512 }
    }
  },
  "ui": {
    "panels": {
      "inspector": { "rect": [16, 16, 280, 180], "style": "dock" }
    },
    "textLabels": {
      "title": { "text": "AIR v0.10 UI Tool", "panel": "inspector" }
    },
    "imageQuads": {
      "select_icon": { "sprite": "blue_rune", "panel": "inspector" }
    },
    "gizmos": {
      "object_handle": { "node": "platform", "kind": "translate" }
    }
  },
  "post": {
    "bloom": { "kind": "bloom", "threshold": 0.82, "intensity": 0.65 },
    "depth_of_field": { "kind": "depth-of-field", "focusDistance": 6, "aperture": 0.08 },
    "tonemap": { "kind": "tone-map", "operator": "aces" }
  },
  "renderGraphs": {
    "main_graph": {
      "passes": [
        { "key": "clear", "kind": "clear", "output": "scene_color" },
        { "key": "sky", "kind": "skybox", "camera": "main", "environment": "storm_sky", "pipeline": "arena_pipeline", "output": "scene_color" },
        { "key": "geometry", "kind": "geometry", "camera": "main", "pipeline": "arena_pipeline", "inputs": ["scene_color"], "output": "scene_color" },
        { "key": "bloom", "kind": "post", "effect": "bloom", "inputs": ["scene_color"], "output": "bloom_color" },
        { "key": "present", "kind": "present", "inputs": ["bloom_color"] }
      ]
    }
  },
  "handles": {
    "pipelines": { "arena_pipeline": 1 },
    "renderGraphs": { "main_graph": 1 },
    "cameras": { "main": 1 },
    "nodes": { "platform": 1 },
    "voxels": { "energy_columns": 1 },
    "models": { "arena_platform": 1 },
    "sprites": { "blue_rune": 1 }
  }
}
```

The manifest is deliberately JSON in v0.3 so it is easy for AI to generate and easy for humans to diff.

## Supported Imports

- `gpu.begin_frame(r, g, b, a) -> void`
- `gpu.begin_pass() -> void`
- `gpu.set_scene_time(time_ms) -> void`
- `gpu.set_camera(camera) -> void`
- `gpu.set_camera_matrix(camera, ptr, len) -> void`
- `gpu.set_pipeline(pipeline) -> void`
- `gpu.set_bind_group(bind_group) -> void`
- `gpu.set_vertex_buffer(buffer) -> void`
- `gpu.set_index_buffer(buffer) -> void`
- `gpu.draw(vertex_count, instance_count) -> void`
- `gpu.draw_indexed(index_count, instance_count) -> void`
- `gpu.draw_instanced(vertex_count, instance_count) -> void`
- `gpu.draw_mesh_instanced(mesh, instances) -> void`
- `gpu.draw_sprite_batch(sprite, count) -> void`
- `gpu.draw_scene_node(node, instances) -> void`
- `gpu.draw_voxel_chunk(chunk, instances) -> void`
- `gpu.draw_particles(particle, count) -> void`
- `gpu.execute_render_graph(graph) -> void`
- `gpu.end_pass() -> void`
- `gpu.submit() -> void`
- `gpu.destroy(handle) -> void`

All handles are `i32` in AIR/Wasm. The manifest provides pseudo-type metadata for validators and hosts.

`gpu.set_camera_matrix(camera, ptr, len)` expects `len == 64` for a contiguous 16-float `mat4` written by `mat4.store_f32`. Portable hosts must copy the 64 bytes before returning from the import. If a host intentionally defers the copy, it must document that stronger lifetime requirement and keep conformance examples alive until `gpu.execute_render_graph` / `gpu.submit`.

Reusable matrix, mesh instance, sprite instance, and particle instance records are specified in [GFX_BUFFER_LAYOUTS.md](GFX_BUFFER_LAYOUTS.md). AIR writes bytes through explicit memory operations; hosts copy those bytes into renderer/GPU resources.

## Render Graph Contract

Render graph passes are declarative host work, not AIR syntax:

- `clear`: creates or clears a target.
- `geometry`: draws mesh-backed scene nodes through a pipeline/material.
- `voxel`: draws voxel chunks or sparse voxel data through a material.
- `sprite`: draws sprite batches/atlases.
- `vector`: draws host-rasterized/tessellated vector decals, icons, labels, or overlays.
- `ui`: draws declarative panels, labels, image quads, and gizmo handles.
- `post`: applies effects such as bloom, depth of field, tone mapping, motion blur, or color grading.
- `skybox` / `environment`: draws infinite environment state from a cubemap, 3x2 cubemap atlas, or spherical/equirectangular skydome asset. It must ignore camera translation and must not be a normal scene node or mesh instance.
- `present`: declares the final backbuffer output.

Skybox/environment passes should render first with depth disabled, or render last with `depthCompare = less-equal` and `depthWrite = false`. A fullscreen triangle/quad, inside-out cube, or equivalent host primitive may be used, but sampling must be by world-space view direction.

Equivalent implementations:

```text
world objects:
  clip = projection * view(camera_position + camera_rotation) * model * vertex

skybox cube:
  viewNoTranslation = mat4(mat3(view))
  clip = projection * viewNoTranslation(camera_rotation_only) * skybox_vertex

shader skybox:
  screen pixel -> view ray -> world ray using inverse projection + inverse view rotation
  sample cubemap(world ray)

shader skydome:
  screen pixel -> view ray -> world ray using inverse projection + inverse view rotation
  sample equirectangular panorama from world ray:
    u = atan2(world_ray.z, world_ray.x) / tau + 0.5
    v = acos(clamp(world_ray.y, -1, 1)) / pi
```

The skybox may have its own environment rotation, but must not inherit the player or camera transform as a scene object. Camera translation is always ignored.

`gfx-check` rejects skybox/environment passes that carry ordinary scene-node fields such as `node`, `mesh`, `meshInstance`, or `transform`, rejects unknown environment assets, and rejects depth-writing skybox pipelines. Skyboxes and skydomes are environment passes, not `scene.meshInstances`.

`gfx-check` validates statically visible references:

- material -> pipeline/texture references;
- standard material texture slots such as `base`, `normal`, `metallicRoughness`, `occlusion`, and `emissive`;
- PBR numeric ranges for `metallic`, `roughness`, `baseColor`, and `emissive`;
- light/camera parameter shapes and ranges;
- post-effect parameter ranges for tone map, bloom, blur, motion blur, depth of field, outline, flash, and color grade;
- node -> mesh/material references;
- skinned model -> skeleton/animation references;
- scene animator -> node/skeleton/clip references;
- vector decal -> vector/material references;
- render pass -> camera/material/pipeline/effect references;
- render pass inputs must be produced by earlier passes or be `surface`;
- graph handles, camera handles, node handles, voxel handles, pipeline handles.
- GPU resource budgets declared in AIR `effects`, when the key maps to manifest-visible work.

The browser host executes geometry/sprite/voxel work into an offscreen render target with optional depth, then runs a post/present pass to the surface. The ABI is intentionally broader than this first host so native `wgpu`/Dawn/Metal adapters can implement richer effects later without changing AIR source.

Manifest-visible GPU budget keys:

- `gpu.render_passes`
- `gpu.post_passes`
- `gpu.draw_passes`
- `gpu.post_effects`
- `gpu.scene_draw_units`
- `gpu.lights`
- `gpu.materials`
- `gpu.textures`
- `gpu.vectors`
- `gpu.animators`

Example:

```air
effects { gpu.render_passes <= 8, gpu.scene_draw_units <= 512 }
```

These budgets are checked by `gfx-check` / `app-check` against the `.airgfx.json` manifest. Runtime GPU time, VRAM residency, and hardware-specific shader cost are host report fields, not portable compile-time facts in v0.10.

## CLI

```sh
node bin/airc.js gfx-check examples/gpu_arena.air --manifest examples/gpu_arena.airgfx.json
node bin/airc.js app-check examples/ui_tool.air --manifest examples/ui_tool.airgfx.json
node bin/airc.js gfx-wit examples/ui_tool.air --manifest examples/ui_tool.airgfx.json
node bin/airc.js gfx-build examples/ui_tool.air --manifest examples/ui_tool.airgfx.json --out public
node bin/airc.js gfx-import assets/source.obj --name source_asset -o source.fragment.json
node bin/airc.js package-check public
node bin/airc.js gfx-stdlib
node bin/airc.js conformance-fixture ui-tool --out build/conformance/ui-tool
```

## GFX Standard Blocks

`gfx-stdlib` emits a stable JSON catalog for AI generators. It does not create a renderer by itself; it names reusable concepts that AIR modules and manifests should converge on:

- vector math such as `vec3.move_relative`;
- transform and camera data blocks;
- primitives such as fullscreen triangles, sprite batches, mesh instances, scene nodes, and voxel chunks;
- asset blocks such as static GLB meshes, skinned GLB meshes, animation clips, and vector decals;
- material presets such as PBR, unlit sprites, and emissive voxels;
- post effects such as tone map, bloom, screen flash, blur, lightning flash, and depth of field.
- WGSL shader template paths and a reusable manifest fragment from
  `kits/gfx-basic`. These are kit resources, not AIR stdlib files.
- source asset import conventions for OBJ, FBX, USD, GLB/glTF, SVG/vector, and texture files.

`kits/gfx-basic` is the reusable starter package for basic AIR GFX resources:
WGSL shaders, a manifest fragment, material presets, and tiny examples.
Projects may copy or replace it. AIR Core and `stdlib/*.air` must not contain
WGSL files, `.airgfx.json` resource manifests, backend resource packs, or
project art direction.

During repository development, manifests may reference reusable kit files with
repo-root paths such as `kits/gfx-basic/shaders/unlit_mesh.wgsl`. `gfx-build`
copies those resources into the package under the same relative path so hosts
still consume a self-contained package.

## Asset Import Fragments

`gfx-import` does not run Blender or an external converter. It creates a manifest fragment that tells the AI/host what the asset is and whether conversion is required:

```sh
node bin/airc.js gfx-import art/mech.fbx --name mech -o mech.fragment.json
```

Runtime-ready mesh formats are `glb` and `gltf`. Source formats such as `obj`, `fbx`, `usd`, `usda`, and `usdc` are marked with:

```json
{
  "runtimeReady": false,
  "conversion": {
    "required": true,
    "targetFormat": "glb"
  }
}
```

SVG may be imported as a texture or as a vector asset. Vector assets stay in
manifests as package resources; hosts rasterize, tessellate, cache, or batch
them.

This keeps AIR GFX honest: manifests can mention common source formats, but
browser/native hosts should load GLB/glTF, SVG/vector resources, or
host-specific converted assets at runtime.
