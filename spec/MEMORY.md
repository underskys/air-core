# Memory Model v0.10

AIR uses explicit regions over Wasm linear memory.

```air
%bytes:i32 = const.i32 16
%ptr:ptr = alloc_region %bytes
%off:i32 = const.i32 4
store.i32 %ptr, %off, %value
%loaded:i32 = load.i32 %ptr, %off
free_region %ptr
```

Canonical AIR should use explicit offsets for raw pointer memory operations. The parser/verifier still accept legacy shorthand `store.i32 %ptr, %value` and `load.i32 %ptr` as offset `0`, but examples and formatter-facing guidance should prefer `%off:i32 = 0` plus the three-/two-argument forms.

## Rules

- `alloc_region size` produces a `ptr`. Each allocation site owns a disjoint
  linear-memory slot that covers the verified maximum size (at least 4096
  bytes; at most 16 MiB). A size that is not a compile-time constant is checked
  at runtime against the slot and traps above it (AIR 0.52.1).
- `free_region ptr` marks the region dead.
- `load.i32` and `store.i32` require a live region pointer. Canonical form is `load.i32 ptr, offset` and `store.i32 ptr, offset, value`.
- Use-after-free is rejected by the verifier.
- If region size and offset are statically known, out-of-region access is rejected.
- Dynamic offsets lower with runtime bounds checks when the access goes through `buffer<T,N>` or `slice`.
- Raw `load.*` / `store.*` on `ptr` still rely on verifier-visible region checks when offsets are static.
- `buffer.from_ptr`, `slice.from_region` and host imports that take a
  `(ptr, capacity)` pair require a live region pointer. The view size, slice
  length or capacity must fit inside the region: statically when provable,
  otherwise by a runtime check that traps before the view or host call
  (AIR 0.52.1). A buffer or slice view may not be used after its region is
  freed, including as an argument of a call.
- The checked sum of one module's region slots must not exceed 256 MiB; above
  it the verifier and the lowerer reject the module with
  `air.memory.region_backing_unsupported` (AIR 0.52.1). Linked package output
  uses the same verified slots and the same ceiling as a single module.

## Slices

`slice.from_region ptr, len` creates a pointer/length view over a live region. Slice views can be narrowed and accessed with checked operations:

```air
%slice:slice = slice.from_region %ptr, %bytes
%view:slice = slice.sub %slice, %offset, %len
%value:i32 = slice.load.i32 %view, 0
slice.store.i32 %view, 0, %value
```

The verifier rejects statically visible out-of-bounds subviews and accesses. The lowerer emits runtime traps for dynamic offset/length checks. Slice values stay internal AIR metadata; ABI boundaries still pass raw pointer/length pairs explicitly.

## Typed Buffers

`buffer<T,N>` is a typed view over a live memory region. Its access index is an element index, not a byte offset:

```air
%buf:buffer<f32,4> = buffer.from_ptr %ptr
%idx:i32 = const.i32 1
buffer.store %buf, %idx, %value
%loaded:f32 = buffer.load %buf, %idx
```

For `buffer<f32,4>`, `%idx == 1` addresses the second `f32`, so the lowered byte offset is `4`. Raw pointer `load.*` / `store.*` are different: their offset argument is already a byte offset.

The verifier rejects statically visible out-of-bounds buffer indexes and statically visible reads before `buffer.store` initialization. The lowerer emits runtime traps for dynamic buffer indexes outside `0 <= index < N`.

## Matrix Storage

`mat4` values are internal SSA composites. To pass a matrix through a scalar host ABI, write it into an explicit memory region:

```air
%bytes:i32 = 64
%ptr:ptr = alloc_region %bytes
%off:i32 = 0
mat4.store_f32 %matrix, %ptr, %off
```

`mat4.store_f32` writes 16 contiguous `f32` values, so it requires 64 bytes from `off`. Host-visible matrix and instance layouts are specified in [GFX_BUFFER_LAYOUTS.md](GFX_BUFFER_LAYOUTS.md).

## Current Limits

- Regions are simple linear-memory allocations.
- No reusable allocator or stack/heap separation yet.
- Raw pointer operations are intentionally lower-level than slice/buffer operations.
- Borrow semantics are lexical and conservative: slice operations preserve pointer/length metadata, but there is not yet an affine ownership system with explicit borrow lifetimes.

## Direction

AIR v0.10 has internal `struct`, `array<T,N>`, `buffer<T,N>`, checked slice subviews, and bounded loops. The next memory step is a clearer stack/heap split and explicit borrow lifetime annotations.
