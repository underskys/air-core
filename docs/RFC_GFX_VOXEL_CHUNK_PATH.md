# RFC: AIR GFX Voxel Chunk Package Path

Status: draft

Version target: v0.12 package/host work, with v0.11 docs-only alignment

Target layer: raw GPU/package path, manifest schema, host implementation

This RFC clarifies that dense voxel/chunk rendering belongs to the `gpu.*`
package/render graph path, not the high-level public `gfx.*` stream ABI. It
does not implement new behavior, add public `gfx.*` functions, or change AIR
Core syntax.

Source evidence:

- [voxel-demo.md](abi-requests/voxel-demo.md)
- [GFX_ABI.md](../spec/GFX_ABI.md)
- [GFX_BUFFER_LAYOUTS.md](../spec/GFX_BUFFER_LAYOUTS.md)
- [GFX_v0.11_PLAN.md](archive/v0.11/GFX_v0.11_PLAN.md)
- [GFX_v0.11_STATUS.md](archive/v0.11/GFX_v0.11_STATUS.md)

## Decision

`gfx.draw_voxel_chunk` is rejected as public high-level GFX ABI.

Dense voxel/chunk rendering should use:

- existing or future `gpu.draw_voxel_chunk` in the raw GPU/package ABI;
- `.airgfx.json` manifests;
- render graph `voxel` passes;
- manifest-declared chunk handles, materials, layouts, and budgets;
- browser/native host implementations behind the package contract;
- conformance diagnostics for unsupported layouts, limits, materials, or host
  features.

High-level `gfx.*` remains for simple scalar command streams such as
`gfx.draw_primitive`. It should not grow a new function for every demo rendering
shape.

## Current Public Surface

The raw GPU ABI already documents:

```air
extern gpu.draw_voxel_chunk(chunk: i32, instances: i32) -> void
```

That import belongs to the `gpu` capability and the `.airgfx.json`
package/render graph path. It is not a high-level `gfx.*` command.

The stable high-level `gfx.*` surface remains documented in
[GFX_HIGH_LEVEL_ABI.md](../spec/GFX_HIGH_LEVEL_ABI.md). This RFC does not add
`gfx.draw_voxel_chunk` to that list.

## Package And Manifest Responsibilities

Chunk rendering needs host-visible package metadata. The package/manifest layer
must own:

- chunk handle declarations;
- chunk resource references;
- chunk layout version;
- chunk dimensions and bounds;
- material references;
- lighting/render graph bindings;
- render target and pass usage;
- backend/profile limits;
- diagnostics for unsupported or missing features.

Draft manifest direction, not final schema:

```json
{
  "handles": {
    "voxels": {
      "terrain_chunk_0": 1
    }
  },
  "scene": {
    "voxels": {
      "terrain_chunk_0": {
        "material": "voxel_surface",
        "chunkSize": 16,
        "budget": 4096,
        "layout": "voxel_chunk_v0",
        "source": "generated/terrain_chunk_0.bin"
      }
    }
  },
  "renderGraphs": {
    "main": {
      "passes": [
        { "key": "voxels", "kind": "voxel", "material": "voxel_surface", "output": "scene_color" }
      ]
    }
  }
}
```

The manifest can name a generic chunk resource. It must not encode demo-specific
terrain formulas, biome rules, animal placement, road/river routing, cave
styling, or project material ID semantics as public ABI.

## Buffer Layout Responsibilities

Buffer layouts must be documented in
[GFX_BUFFER_LAYOUTS.md](../spec/GFX_BUFFER_LAYOUTS.md) before package examples
depend on them.

The buffer layout spec should eventually cover any accepted chunk record such
as:

- chunk header layout;
- cell/voxel payload layout;
- palette or material index layout if generic;
- instance/chunk placement records;
- alignment and endian rules;
- maximum count and stride rules;
- host copy/lifetime rules.

AIR may write bytes into explicit memory regions where the raw GPU ABI permits
that pattern, but hosts own GPU buffers and renderer resources. AIR never
receives WebGPU, Metal, Vulkan, Direct3D, texture, shader, pipeline, or native
resource handles.

## Host Responsibilities

Browser WebGPU and native wgpu should eventually share the same package
contract:

- same `.airgfx.json` chunk handle model;
- same documented buffer layout names;
- same material and render graph references;
- same capability/import expectations;
- same deterministic package-check failures;
- comparable conformance report fields for loaded chunks, unsupported features,
  fallback behavior, and instance/chunk counts.

Hosts may implement different renderer internals. The shared contract is the AIR
module imports, package manifest, buffer layout, and diagnostics, not backend
object identity.

## AIR Core Boundary

AIR Core must not parse:

- voxel chunks;
- textures;
- PBR materials;
- shaders;
- render graph resources;
- model files;
- backend renderer objects.

AIR Core validates portable AIR syntax, types, memory operations, capabilities,
effects, contracts, and public Host ABI signatures. Chunk resources are
package/manifest/host data.

## Relationship To Demos

Voxel Demo may continue using high-level `gfx.draw_primitive` streams for
compatibility, teaching, and host smoke tests. That path is useful but not the
dense chunk rendering contract.

If the demo proves generic chunk requirements, promote only the reusable
package/manifest/host pieces:

- chunk handles;
- chunk layout;
- material binding rules;
- render graph pass wiring;
- unsupported-feature diagnostics.

Keep project-local:

- terrain generation formulas;
- biome names;
- cave, road, river, route, animal, sky, water, lava, palette, and art
  direction;
- project-specific material IDs;
- gameplay rules.

## Required Diagnostics

Package/host checks should report deterministic diagnostics for:

- missing chunk handle;
- missing chunk resource;
- unsupported chunk layout;
- unsupported chunk dimensions;
- count or budget above host/profile limit;
- missing material;
- unsupported material model;
- missing shader or shader compile failure;
- unsupported render graph pass or binding;
- fallback material/texture/chunk renderer behavior;
- host profile lacking voxel chunk support.

Diagnostics should be visible from CLI package checks and browser/native host
reports where applicable.

## Non-goals

- No implementation in v0.11.
- No new public `gfx.*`.
- No `gfx.draw_voxel_chunk`.
- No project-specific voxel, terrain, biome, cave, road, river, animal, route,
  palette, water, sky, or material names in Core or stdlib.
- No target packaging implementation.
- No package registry.
- No AIR Core parsing of voxel chunks or renderer resources.
- No backend objects exposed to AIR.

## Acceptance Conditions For Future Implementation

Future implementation should require:

1. Buffer layout documented in [GFX_BUFFER_LAYOUTS.md](../spec/GFX_BUFFER_LAYOUTS.md).
2. Manifest fields or examples documenting chunk handles and resources.
3. `gfx-check` / `app-check` diagnostics for missing or unsupported chunk
   references.
4. Browser WebGPU and native wgpu host reports using the same package
   contract, even if one host only reports unsupported features initially.
5. Tests that keep `gfx.draw_voxel_chunk` rejected as high-level ABI.
6. Tests that existing `gfx.draw_primitive` streams remain valid.
