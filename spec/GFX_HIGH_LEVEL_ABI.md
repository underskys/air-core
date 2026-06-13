# AIR High-Level GFX ABI v0.10

This document defines the optional high-level `gfx.*` host ABI. It is separate from the raw GPU / Render Graph ABI in `GFX_ABI.md`.

Use `gfx.*` when an AIR module wants simple host-owned drawing commands. Use `gpu.*` plus an `.airgfx.json` manifest when the module needs explicit WebGPU-style resources, render graph passes, shaders, materials, meshes, sprites, voxels, or post-processing.

## Capability

```air
capabilities { gfx }
```

Every `extern gfx.*` import requires `capabilities { gfx }`.

`gfx.*` hosts own the renderer state and decide how commands map to WebGPU, WebGL, Metal, Vulkan, Direct3D, or a software backend. AIR only emits scalar command parameters.

## Supported Imports

The stable v0.10 high-level imports are:

- `gfx.begin_frame(t) -> void`
- `gfx.camera_look_at(x, y, z, target_x, target_y, target_z, fov) -> void`
- `gfx.draw_cube(x, y, z, size, rot) -> void`
- `gfx.end_frame() -> void`
- `gfx.draw_primitive(primitive, material, x, y, z, sx, sy, sz, yaw, pitch, roll, color, emissive, flags) -> void`
- `gfx.skybox_world(asset, tint, intensity, yaw, pitch, roll) -> void`

All parameters are `i32`.

For `gfx.camera_look_at`, `fov` is fixed-point degrees where `1000 == 1 degree`.
Example: `79000` means `79 degrees`. The recommended range is
`10000..120000`. Hosts may clamp unsupported FOV values, but they must document
their clamp behavior.

## Primitive Registry

`gfx.draw_primitive` uses this stable primitive registry:

- `1`: box/block
- `2`: cylinder
- `3`: cone
- `4`: wedge
- `5`: plane/quad

Hosts may report unsupported primitive IDs through diagnostics or conformance
output, but they must not give the same primitive ID two different semantic
names. If a host temporarily falls back to drawing an unsupported primitive as
a box, that fallback must be documented as a host limitation rather than a
different ABI meaning.

## Contract

`gfx.*` is intentionally host-level and coarse:

- no `.airgfx.json` manifest is required;
- no shader, pipeline, render target, or render graph resources are visible to AIR;
- the host may ignore unsupported primitive/material IDs, but should report that through diagnostics or conformance output;
- `gfx.begin_frame` / `gfx.end_frame` delimit one high-level frame;
- `gfx.camera_look_at` applies host camera state from scalar fixed-point world coordinates and fixed-point-degree FOV;
- `gfx.draw_cube` is a compatibility convenience for simple smoke tests;
- `gfx.draw_primitive` is the preferred high-level primitive call for AI-generated simple scenes;
- `gfx.skybox_world` sets world environment state, not a scene node. It must ignore camera translation and must sample the environment by world-space view direction. The environment may be backed by a cubemap, a 3x2 cubemap atlas, or a spherical/equirectangular skydome texture. It may have its own environment `yaw` / `pitch` / `roll`, but it must not inherit player or camera transform.

Skybox/skydome hosts must implement one of these equivalent models:

```text
world objects:
  clip = projection * view(camera_position + camera_rotation) * model * vertex

skybox:
  viewNoTranslation = mat4(mat3(view))
  clip = projection * viewNoTranslation(camera_rotation_only) * skybox_vertex
```

or shader-based sampling:

```text
screen pixel -> view ray -> world ray using inverse projection + inverse view rotation
sample cubemap(world ray)

skydome:
  screen pixel -> view ray -> world ray using inverse projection + inverse view rotation
  sample equirectangular panorama from world ray:
    u = atan2(world_ray.z, world_ray.x) / tau + 0.5
    v = acos(clamp(world_ray.y, -1, 1)) / pi
```

Both forms mean the environment is infinite for camera translation. Moving the player must not move the skybox; rotating the camera only changes the sampled world-space direction.

`kits/gfx-basic/air/scene.air` and `kits/gfx-basic/air/gfx3d.air` expose
`skydome_world(...)` as AIR kit helpers that map to the same host import. This
does not add a new AIR Core type, stdlib module, or host call.

## Relationship To Raw GPU ABI

Do not mix `gfx.*` and `gpu.*` in the same example unless a host explicitly documents a bridge between the two.

For production graphics packages, prefer:

```air
capabilities { gpu }
extern gpu.execute_render_graph(graph: i32) -> void
```

with an `.airgfx.json` manifest. That path gives validators enough metadata to check handles, render graph references, resources, post effects, and package conformance.

`examples/gfx.air` remains a small high-level smoke example. `examples/gpu_arena.air` and `examples/ui_tool.air` are the canonical raw GPU / render graph examples.
