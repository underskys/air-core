# AIRLang GFX v0.11 Plan

AIRLang v0.11 GFX work is foundation work for serious graphics demos, not a
public high-level `gfx.*` expansion.

Current implementation status is tracked in
[GFX_v0.11_STATUS.md](GFX_v0.11_STATUS.md).

Advanced graphics should use `.airgfx.json` manifests, render graphs, `gpu.*`,
host implementation, generated fixtures, conformance diagnostics, and reusable
kits such as `kits/gfx-basic`. Project-specific visuals stay in examples,
demo project kits, or external product repositories.

Related contracts:

- [GFX_HIGH_LEVEL_ABI.md](../../../spec/GFX_HIGH_LEVEL_ABI.md): optional high-level
  `gfx.*` stream for simple host-owned drawing commands.
- [GFX_ABI.md](../../../spec/GFX_ABI.md): raw `gpu.*` package/render graph ABI.
- [GFX_BUFFER_LAYOUTS.md](../../../spec/GFX_BUFFER_LAYOUTS.md): AIR memory record
  layouts that hosts copy into renderer/GPU resources.
- [voxel-demo ABI requests](../../abi-requests/voxel-demo.md): request evidence and
  routing decisions, not automatic public ABI approval.

## Boundary

- AIR Core does not parse GLB, glTF, textures, shaders, or renderer resources.
- AIR modules reference stable scalar handles, manifest keys, and package data.
- `.airgfx.json` manifests describe models, shaders, materials, render graphs,
  targets, quality profiles, and conformance expectations.
- Hosts load GLB/glTF, create GPU buffers/textures/pipelines, bind materials,
  compile shaders, and report supported or unsupported features.
- Host-owned GPU buffers, WebGPU/Metal/Vulkan objects, textures, shaders, and
  pipelines never cross the AIR boundary as object handles.
- `kits/gfx-basic` provides reusable starter shaders, material presets,
  manifest fragments, and small examples. It is not AIR Core or stdlib.
- Demo art direction, project palettes, named objects, themed materials, and
  gameplay render decisions stay in `examples/`, `demo/`, or project kits.

## Foundation Work

### GLB/glTF Loading Path

- Treat GLB/glTF as package assets referenced from `.airgfx.json`.
- Keep parsing and runtime conversion in the WebGPU host or host-side asset
  loader, not in AIR Core or verifier semantics.
- Validate package-relative paths, declared formats, handles, and required
  attributes before host execution.
- Report missing files, unsupported formats, missing attributes, and host
  loader failures as diagnostics instead of silently dropping models.

### Generated Test Model Fixtures

Decision: the v0.11 minimum generated fixture set is `cube.glb` only.

- Use deterministic generated assets for repeatable host/package tests.
- Fixture generation belongs in tooling, not in package commands or public ABI.
- v0.11 release fixture:
  - `cube.glb`: minimal indexed cube for asset preflight, GLB parsing, GPU
    buffer upload, visible browser smoke, and conformance diagnostics.
- Deferred fixtures:
  - `uv_test.glb`: v0.12/post-v0.11 UV-coordinate fixture.
  - `primitive_set.glb`: v0.12/post-v0.11 primitive topology fixture.
  - `material_test.glb`: v0.12/post-v0.11 material binding fixture.
- Generated fixtures should be small, stable, and safe to commit when needed.

Cube-only is enough for v0.11 because the release goal is to prove a host-owned
GLB/glTF asset path with deterministic diagnostics, not broad loader coverage or
production renderer behavior.

### Shader And Material Binding

- Bind shaders and materials through manifest keys and pipeline definitions.
- Keep WGSL and material presets in kits, examples, or project kits.
- Hosts own shader compilation, pipeline creation, texture upload, and material
  binding. AIR source should only emit verified commands and handles.
- Diagnostics should name the missing or unsupported shader, pipeline, texture,
  material, or render graph pass.

### Render Graph Diagnostics

- Validate that render graph passes reference existing targets, pipelines,
  materials, cameras, models, and effects.
- Report unsupported pass kinds, target formats, quality profile mismatches,
  and missing host features through conformance output.
- Keep render graph behavior manifest/host-owned; do not turn it into AIR Core
  semantics.

### Path Separation

- `gfx.*` stream modules remain the simple high-level command path documented
  in [GFX_HIGH_LEVEL_ABI.md](../../../spec/GFX_HIGH_LEVEL_ABI.md).
- `gpu.*` modules with `.airgfx.json` manifests remain the package/render graph
  path documented in [GFX_ABI.md](../../../spec/GFX_ABI.md).
- `gpu.draw_voxel_chunk` already belongs to the raw GPU ABI package path. It is
  not approval for `gfx.draw_voxel_chunk`; the package-path decision is tracked
  in [RFC_GFX_VOXEL_CHUNK_PATH.md](../../RFC_GFX_VOXEL_CHUNK_PATH.md).
- `gfx.draw_instanced`, `gfx.draw_primitive_instanced`, and
  `gfx.draw_voxel_chunk` are not v0.11 public high-level ABI additions.

### Conformance Reporting

- Surface supported and unsupported graphics features in package and host
  reports.
- Include model format support, shader language support, render graph pass
  support, texture limits, instance limits, post-processing support, and
  fallback behavior.
- Treat unsupported WebGPU or GLB/glTF loading as explicit diagnostics, not
  blank output.

## Non-Goals

v0.11 GFX foundation must not:

- add new public `gfx.*` functions;
- move GLB/glTF parsing into AIR Core;
- make stdlib depend on shaders, assets, renderers, or manifests;
- turn `kits/gfx-basic` into a production renderer;
- put demo-specific visuals, palettes, materials, routes, or named objects in
  public ABI or stdlib;
- implement target packaging or deployable artifact bundling.

## Implementation Path

- Add or update generated fixtures with `tools/generate-gfx-fixtures.js`.
- Use fixtures in examples or host tests only when they validate manifest,
  package, loader, render graph, or conformance behavior.
- Prefer `gpu.*`, `.airgfx.json`, render graphs, host implementation, and kits
  for advanced visuals.
- Promote public API only through `AGENTS.md`, `spec/AIR_LAYER_MANIFEST.md`,
  Public API Hygiene, relevant ABI specs, tests, and migration notes.
