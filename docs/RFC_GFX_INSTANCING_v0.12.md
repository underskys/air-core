# RFC: AIR v0.12 High-Level GFX Instancing

Status: deferred

Version target: v0.12 or later

Target layer: high-level GFX ABI / manifest schema / host implementation

This RFC defines the conditions under which a generic high-level
`gfx.draw_instanced` call could become public GFX ABI. It is not accepted for
v0.11, not implemented, and not part of the current stable high-level
`gfx.*` surface.

Source evidence:

- [voxel-demo.md](abi-requests/voxel-demo.md)
- [airdoom.md](abi-requests/airdoom.md)
- [contra-platformer.md](abi-requests/contra-platformer.md)
- [GFX_HIGH_LEVEL_ABI.md](../spec/GFX_HIGH_LEVEL_ABI.md)
- [GFX_ABI.md](../spec/GFX_ABI.md)
- [GFX_BUFFER_LAYOUTS.md](../spec/GFX_BUFFER_LAYOUTS.md)

## Current Status

- Decision: deferred.
- v0.11 status: not in scope.
- Implementation status: not implemented.
- Public ABI status: not registered.
- Host behavior: hosts may batch existing `gfx.draw_primitive` internally, but
  that does not create a public AIR import.

The stable v0.10/v0.11 high-level GFX imports remain the ones listed in
[GFX_HIGH_LEVEL_ABI.md](../spec/GFX_HIGH_LEVEL_ABI.md). This RFC must not be
read as permission to add `gfx.draw_instanced` during v0.11 stabilization.

## Problem

Some demos emit many repeated primitive draw commands with the same primitive
shape/material and different transforms. Voxel-style scenes are the clearest
pressure case: AIR can generate thousands of scalar `gfx.draw_primitive` calls
for blocks, leaves, props, and fallback geometry.

The generic question is whether AIR should have a high-level instancing command
that still preserves the `gfx.*` model:

- host-owned renderer state;
- scalar AIR command parameters;
- no shaders, GPU buffers, backend objects, or pointers crossing the AIR
  boundary;
- clear diagnostics when a manifest handle, layout, or count is unsupported.

## Candidate API

Draft only:

```air
extern gfx.draw_instanced(
  primitive: i32,
  transform_set: i32,
  count: i32,
  material: i32
) -> void
```

Meaning:

- `primitive`: stable high-level primitive ID from the public primitive
  registry.
- `transform_set`: host-owned manifest handle for a declared transform set.
- `count`: number of instances requested from that set.
- `material`: scalar material/style handle interpreted by the high-level host.

`transform_set` is not a raw pointer, not a `buffer<T,N>`, and not a WebGPU,
Metal, Vulkan, Direct3D, DOM, or native object handle. It must resolve through a
manifest/package declaration that the host can validate before drawing.

## Required Generic Evidence

This API must not be accepted from a single demo request.

Minimum evidence before promotion:

1. Voxel Demo and AirDoom agree on the same generic shape:
   - primitive ID;
   - transform set handle;
   - instance count;
   - material handle;
   - deterministic host/package diagnostics.
2. At least one browser or native host can prove scalar-vs-instanced
   equivalence without exposing backend objects to AIR.
3. Manifest/package checks can validate transform set existence, layout, count,
   and backend limits.
4. Existing `gfx.draw_primitive` examples remain compatible.

Optional evidence:

- Platformer/sprite use cases may provide pressure for batching, but sprite
  atlas/rig/skeletal cases must remain separate unless they truly fit the same
  primitive + transform set + material shape.
- Sprite-specific batching should route through sprite kits, manifests, or
  future sprite-specific RFCs rather than forcing sprite semantics into
  `gfx.draw_instanced`.

## Verifier Responsibility

If accepted later, the Core verifier would be responsible only for public Host
ABI facts:

- `gfx.draw_instanced` exists in the strict Host ABI registry.
- Signature exactly matches:
  - params: `i32, i32, i32, i32`;
  - return: `void`.
- The module declares `capabilities { gfx }`.
- Effect accounting counts the host call under `gfx.draw_instanced` and
  `gfx.*` wildcard budgets.
- Unknown or mismatched signatures are rejected like every other public
  `gfx.*` import.

The verifier must not validate WebGPU buffers, Metal buffers, transform set
resource layout, material resource files, or backend renderer state. Those are
manifest/package/host responsibilities.

## Manifest And Package Responsibility

Manifest/package checks must validate all data that makes instancing concrete:

- `transform_set` handle exists.
- Transform set has a declared layout.
- Layout version is supported.
- Layout byte size and stride are supported.
- Declared producer is valid:
  - generated package data;
  - scene compiler output;
  - host-owned static asset;
  - other explicitly accepted producer.
- `count` is non-negative and within declared transform set length.
- `count` is within profile/backend limits.
- `primitive` ID is supported by the selected high-level host.
- `material` handle exists or has a documented fallback.
- Missing layout, unsupported layout, missing transform set, or insufficient
  count fails deterministically with repair hints.

Draft manifest sketch, not accepted schema:

```json
{
  "handles": {
    "transformSets": {
      "visible_blocks": 12
    }
  },
  "transformSets": {
    "visible_blocks": {
      "layout": "mesh_instance_v0",
      "count": 256,
      "source": "scene-compiler",
      "path": "generated/visible_blocks.bin"
    }
  }
}
```

The `mesh_instance_v0` layout is documented in
[GFX_BUFFER_LAYOUTS.md](../spec/GFX_BUFFER_LAYOUTS.md), but that layout alone
does not approve `gfx.draw_instanced`. It is a possible package/manifest record
format for host-owned data.

## Host Responsibility

Hosts that claim support must:

- load or generate the transform set from package/manifest data;
- copy data into backend resources they own;
- clamp or reject unsupported counts consistently;
- report unsupported primitive/material/layout/fallback states;
- report instance counts in conformance output;
- preserve the high-level `gfx.*` frame contract;
- keep backend objects invisible to AIR.

Host-side batching of existing `gfx.draw_primitive` is allowed as an
implementation optimization and does not require this ABI. Public
`gfx.draw_instanced` is only needed if AIR source itself benefits from naming a
host-owned transform set.

## Relationship To Existing Paths

### Existing High-Level `gfx.*`

Current `gfx.draw_primitive` remains the canonical high-level primitive command
for simple generated scenes. It is scalar and does not require a manifest.

### Raw `gpu.*` / `.airgfx.json`

Packages that already need explicit render graphs, shaders, materials, meshes,
or buffer layouts should use `gpu.*` plus `.airgfx.json`.

Existing raw GPU imports such as `gpu.draw_instanced`,
`gpu.draw_mesh_instanced`, `gpu.draw_scene_node`, and
`gpu.draw_voxel_chunk` are separate from this RFC. They belong to the
manifest/package path and do not imply a high-level `gfx.draw_instanced` import.

### Sprite And Platformer Cases

Contra Platformer proves batching pressure for 2D draw streams, but its sprite
atlas, rig, animation, music, player/enemy, projectile, and score behavior are
project-local. A sprite-specific solution should not be forced into primitive
instancing unless it uses the same generic transform set model without sprite
semantics.

## Non-goals

- No v0.11 implementation.
- No public ABI change from this RFC draft.
- No backend objects crossing the AIR boundary.
- No WebGPU, Metal, Vulkan, Direct3D, DOM, JS, or native buffers visible to
  AIR.
- No raw pointer or AIR memory buffer as `transform_set`.
- No voxel-specific names.
- No terrain, biome, cave, road, river, animal, route, or palette semantics.
- No project material IDs.
- No sprite atlas or skeletal animation semantics in this API.
- No new Core syntax.
- No production renderer requirement.

## Tests Required Before Acceptance

Before this can move from deferred to accepted, tests must cover:

1. ABI registry:
   - verifier accepts canonical `gfx.draw_instanced`;
   - verifier rejects missing `gfx` capability;
   - verifier rejects mismatched signature.
2. Scalar vs instanced equivalence:
   - a known set of `gfx.draw_primitive` calls and one
     `gfx.draw_instanced` call produce equivalent primitive/material/count
     summaries.
3. Zero-count no-op:
   - `count == 0` produces no draw work and no error.
4. Missing transform set:
   - manifest/package check fails with a deterministic diagnostic.
5. Insufficient count/layout:
   - requested count beyond declared length fails;
   - unsupported layout version fails;
   - missing layout fails.
6. Browser/native agreement:
   - browser and native hosts report the same instance count for the same
     package.
7. Fallback reporting:
   - unsupported primitive or material fallback is reported, not silent.
8. Compatibility:
   - existing `gfx.draw_primitive` examples remain valid.

## Acceptance Conditions

This RFC can only be accepted if:

- Voxel Demo and AirDoom provide matching generic evidence.
- The API stays exactly high-level and host-owned.
- `transform_set` is manifest-backed and scalar.
- Manifest/package validation exists before runtime draw.
- Browser/native conformance reports expose instance counts.
- No demo-specific names or material IDs enter public ABI.
- Migration notes explain why existing `gfx.draw_primitive` remains valid.

Until those conditions are met, the correct v0.11/v0.12 path is:

- host batching behind existing `gfx.draw_primitive`;
- `.airgfx.json` scene/instance metadata;
- `gpu.*` package/render graph path;
- reusable kit conventions;
- request pipeline evidence collection.
