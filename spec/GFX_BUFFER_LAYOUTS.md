# AIR GFX Buffer Layouts v0.10

AIR modules may write host-visible records into explicit linear-memory regions.
The host owns GPU buffers and copies from AIR memory through documented ABI
calls. Raw WebGPU, Metal, Vulkan, Direct3D, file, DOM, or JS objects never cross
the AIR boundary.

These layouts are for the raw `gpu.*` package/render graph path documented in
[GFX_ABI.md](GFX_ABI.md). They do not extend the optional high-level `gfx.*`
stream documented in [GFX_HIGH_LEVEL_ABI.md](GFX_HIGH_LEVEL_ABI.md).

AIR sees pointers, lengths, scalar handles, and bytes in Wasm memory. Hosts own
the actual GPU buffers, textures, shader modules, pipelines, render passes,
WebGPU/Metal/Vulkan objects, and upload/copy timing.

All offsets below are byte offsets. All scalar fields are little-endian Wasm
memory values. Records are intentionally simple so AI generators can emit exact
`store.*` instructions and reviewers can audit byte sizes.

## Matrix Layout

`mat4` is 64 bytes: 16 contiguous `f32` values in column-major order.

Canonical write:

```air
%bytes:i32 = 64
%ptr:ptr = alloc_region %bytes
%off:i32 = 0
mat4.store_f32 %matrix, %ptr, %off
```

`mat4.store_f32` is the canonical matrix writer. It counts as 16
`memory.store` operations in audit/effect accounting.

## Mesh Instance Record

`mesh_instance_v0` is 80 bytes.

| Offset | Type | Field |
| ---: | --- | --- |
| 0 | `mat4` | model matrix, 16 `f32` values |
| 64 | `i32` | material handle |
| 68 | `i32` | packed RGB/RGBA color or palette handle |
| 72 | `i32` | flags |
| 76 | `i32` | user data |

The model matrix uses the matrix layout above. The host may copy this record into
a native instance buffer, but AIR only sees the memory region.

This record may be referenced by manifest/package work such as mesh instance or
chunk instance data. It is not a backend object handle and it does not approve a
new high-level `gfx.draw_instanced` import.

## Sprite Instance Record

`sprite_instance_v0` is 48 bytes.

| Offset | Type | Field |
| ---: | --- | --- |
| 0 | `i32` | x, fixed-point pixels/world units |
| 4 | `i32` | y, fixed-point pixels/world units |
| 8 | `i32` | width |
| 12 | `i32` | height |
| 16 | `i32` | u0, atlas fixed-point coordinate |
| 20 | `i32` | v0, atlas fixed-point coordinate |
| 24 | `i32` | u1, atlas fixed-point coordinate |
| 28 | `i32` | v1, atlas fixed-point coordinate |
| 32 | `i32` | packed color |
| 36 | `i32` | depth or layer |
| 40 | `i32` | flags |
| 44 | `i32` | user data |

Sprite coordinates are layout values, not AIR Core UI semantics. The host decides
whether the target space is screen, world, or UI according to the manifest pass.

## Particle Instance Record

`particle_instance_v0` is 64 bytes.

| Offset | Type | Field |
| ---: | --- | --- |
| 0 | `f32` | position.x |
| 4 | `f32` | position.y |
| 8 | `f32` | position.z |
| 12 | `f32` | velocity.x |
| 16 | `f32` | velocity.y |
| 20 | `f32` | velocity.z |
| 24 | `i32` | packed color |
| 28 | `f32` | radius |
| 32 | `f32` | lifetime |
| 36 | `i32` | flags |
| 40 | `i32` | user data |
| 44 | `i32` | reserved |
| 48 | `i32` | reserved |
| 52 | `i32` | reserved |
| 56 | `i32` | reserved |
| 60 | `i32` | reserved |

## Lifetime Rule

If a host import reads a pointer/length pair, the host must copy the requested
bytes before returning unless that import explicitly documents a longer
lifetime. AIR examples should free regions only after the final import that
needs the data has returned.

## Static Validation

When byte offsets and allocation sizes are statically visible, the verifier must
reject out-of-region loads/stores. Dynamic offsets remain checked by runtime
bounds traps or host validation. Examples intended for AI generation should use
explicit constants for sizes and offsets.
