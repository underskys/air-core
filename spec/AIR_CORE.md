# AIR Core v0.10

AIR is an AI-first plugin IR. It is optimized for deterministic generation, verification, audit, and lowering to portable sandboxed modules.

AIR is not a human-comfort language and not a replacement for Rust, Zig, C, Python, or TypeScript.

## Module Shape

```air
module plugin_metric
use utility.random
capabilities { debug }
effects { debug.metric <= 1 }
requires capability debug
ensures dynamic_allocations <= 0

extern debug.metric(id: i32, value: i32) -> void

export func run() -> void {
entry:
  %id:i32 = 1
  %seed:i32 = @random.u32()
  %value:i32 = add %seed, %id
  @debug.metric(%id, %value)
  return
}
```

## Core Rules

- Values use SSA syntax: `%name:type = op args`.
- Module-local immutable scalar constants use `const NAME:type = literal`. They are compile-time-only names for scalar literals and lower to existing SSA/Wasm constants when referenced.
- Function parameters become SSA values named `%param`.
- Mutable state is explicit through `global`, `global.get`, and `global.set`.
- Host interaction is only through declared `extern` functions.
- `use` bundles are part of `.air`; they expand to capabilities and canonical extern signatures before verifier/lowering.
- Capabilities, effect budgets, and simple contracts are part of the verifier boundary.
- Runnable modules must define `main(args: slice) -> i32` or at least one exported host entrypoint. Stdlib/reference modules are verified with `airc verify --library <file>`, which keeps normal body checks but skips the entrypoint requirement.
- Every block must end with exactly one terminator: `return`, `br`, or `br_if`.
- AIR supports forward tree-shaped branches plus a checked structured loop shape with a phi header. Arbitrary multi-entry CFG and irreducible control flow remain rejected.
- Local function call cycles are rejected, including self-recursion, mutual recursion, and cycles through bounded loop callback references. Extern calls are not local recursion edges.
- Bounded `loop.fold.*`, `loop.array.*`, and `loop.buffer.*` are the current AI-friendly iteration forms. Static counts are unrolled; dynamic counts lower to structured Wasm loops with runtime bounds checks. All bounded loop counts are capped at 4096. Legacy `loop.range.*` is accepted only as an input alias and formats to `loop.fold.*`.
- `alloc_region` creates a same-function lifetime obligation. Every return path must release each allocated region with `free_region`; double-free, use-after-free, and leaked regions at return are verifier errors. This is explicit bounded resource management, not GC or a dynamic heap/object model.
- The canonical formatter is part of the language contract.
- Repository examples must be stored in canonical formatted multiline AIR. Minified one-line AIR is allowed only as a generated intermediate or parser fixture.

## Layer Boundary

AIR is split into three layers:

- `AIR Core`: SSA, scalar types, explicit memory regions, calls, supported control flow, effects, contracts, and verifier rules.
- `AIR Stdlib / Bundles`: reusable domain helpers such as math3d, fixed-point math, physics helpers, async IO conventions, and GFX manifest blocks.
- `AIR Host ABIs`: capability-qualified imports such as `fs`, `net`, `io`, `input`, `gpu`, `audio`, `time`, `random`, `debug`, and `stdio`.

Domain helpers may be implemented by the current verifier/lowerer for performance and portability, but they are not allowed to redefine AIR Core semantics. Tooling can inspect this split through `airc registry`.

## Types

- `i32`, `i64`, `f32`, `f64`, `bool`
- `vec2`, `vec3`, `vec4`, `quat`, and `mat4` are local SSA vector/matrix types for math-heavy plugins. In v0.10 they are intentionally not allowed at exported function, extern, or host ABI boundaries.
- `struct Name { field: type, ... }` declares fixed internal records.
- `array<T,N>` declares fixed-size internal arrays.
- `buffer<T,N>` is a typed handle over an allocated region for host/GPU interop; `T` is a scalar load/store type.
- `ptr`, `slice` lower to raw Wasm `i32` handles. `slice.from_region` carries dynamic length metadata inside AIR locals, but ABI metadata still treats slices as handles.
- `void` is allowed only as a function return type.

## ABI Boundary Rule

Composite values are internal-only. If a generated module tries to export or import `vec3`, `mat4`, `struct`, `array<T,N>`, or `buffer<T,N>`, the verifier rejects it with a repair hint. Use scalar ABI fields such as `x:f32, y:f32, z:f32`, deterministic fixed-point fields such as `x_i32/y_i32/z_i32`, or pass an explicit output `ptr`/`slice`/buffer handle and keep the composite layout inside AIR.

## Core Operations

- constants: `const.i32`, `const.i64`, `const.f32`, `const.f64`, `const.bool`, `const.str`
- compact constants: `%x:i32 = 1`, `%y:f32 = 1.0`, `%ok:bool = true`, `%s:slice = "text"`
- module constants: `const COUNT:i32 = 3`, `const USE_DEBUG:bool = true`, `const GRAVITY:f32 = 9.8`; supported types are `i32`, `i64`, `f32`, `f64`, and `bool`. First-slice module constants do not support strings, arrays, imports, computed expressions, or runtime storage.
- static read-only scalar tables: `table xs:i32[3] = [10, 20, 30]` plus `table.get xs, %index`. The v0.13 first slice supports fixed compile-time lengths, scalar literal initializers, read-only access, and deterministic runtime bounds checks for dynamic indexes. It does not support strings, nested tables, mutable tables, dynamic sizes, maps, records, or host resource handles.
- compact calls: `%r:i32 = @random.u32()` and `@audio.beep(%id)`
- compact arithmetic aliases: `add`, `sub`, `mul`, plus f32 `div`, `min`, `max`, `clamp`, `lerp`; result type selects the canonical op.
- integer math: `i32.add`, `i32.sub`, `i32.mul`, `i32.div_s`, `i32.rem_s`, `i32.and`, `i32.or`, `i32.xor`, `i32.shl`, `i32.shr_u`
- float math: `f32.add`, `f32.sub`, `f32.mul`, `f32.div`, `f32.sqrt`, `f32.min`, `f32.max`, `f32.sin`, `f32.cos`, `f32.clamp`, `f32.lerp`, `f32.inverse_lerp`, `ease.smoothstep`, `ease.out_quad`, `f32.convert_i32_s`, `i32.trunc_f32_s`
- comparisons: `i32.eq`, `i32.ne`, `i32.lt_s`, `i32.gt_s`, `i32.le_s`, `i32.ge_s`
- booleans: `bool.and`, `bool.or`, `bool.not`
- selection: `select.i32`, `select.f32`
- structs: `struct.new`, `struct.get.<field>`, `struct.set.<field>`
- arrays: `array.new`, `array.get`, `array.set`
- static tables: `table.get`
- typed buffers: `buffer.from_ptr`, `buffer.load`, `buffer.store`
- bounded loops: `loop.fold.i32`, `loop.fold.f32`, `loop.array.i32`, `loop.array.f32`, `loop.buffer.f32`, `loop.poll`; legacy input alias: `loop.range.i32`, `loop.range.f32`
- calls: `call @module.function(...)` or `call @local_function(...)`
- stdio sugar: `print %slice` requires `capabilities { stdio }` and lowers through WASI `fd_write`
- memory: `alloc_region`, `free_region`, `load.i32`, `load.f32`, `store.i32`, `store.f32`, `slice.from_region`, `slice.sub`, `slice.len`, `slice.load.i32`, `slice.load.f32`, `slice.store.i32`, `slice.store.f32`
- control flow: `return`, `br`, `br_if`, `phi.i32`, `phi.f32`, `phi.bool`

`array.get/set` and `buffer.load/store` use element indexes, not byte offsets. For `buffer<f32,N>`, index `1` means the second `f32` element, i.e. byte offset `4` from the buffer base. Raw `load.*` / `store.*` on `ptr` use byte offsets.

## Stdlib Operations

These operations are stable AI-facing library contracts, not AIR Core semantics:
numeric helper admission and fixed-point rules are governed by
[AIR v0.12 Numeric And Constraints Policy](../docs/V0_12_NUMERIC_AND_CONSTRAINTS_POLICY.md).

- vector math: `vec2.*`, `vec3.*`, `vec4.*` for `new`, `add`, `sub`, `scale`, `dot`, `len_sq`, `normalize`, and component reads where valid; plus `vec3.move_relative`
- matrix/camera math: `mat4.identity`, `mat4.from_trs`, `mat4.mul`, `mat4.perspective`, `mat4.look_at`, `mat4.store_f32`
- quaternion/raycast helpers: `quat.identity`, `quat.from_axis_angle`, `quat.mul`, `quat.rotate_vec3`, `ray.plane_y`
- collision helpers: `collision.sphere_sphere`
- deterministic fixed-point helpers: `fixed.mul_i32`, `fixed.div_i32`, `fixed.clamp_i32`, `fixed.lerp_i32`, `physics.damp_i32`, `physics.grounded_i32`, `physics.snap_y_i32`, `physics.snap_vy_i32`
- deterministic noise helpers: `noise.hash2_1000` returns `0..999`; `noise.hash2` is a legacy alias for that exact range. Use a `_mod`-style helper in a project kit if a different modulus is needed.
- packet helpers: `packet.has_flag(value, mask)` is generic bitflag logic.
  Protocol-specific flag aliases such as TCP `syn`/`ack` helpers live in
  examples or reusable network kits, not public stdlib.

## Effects And Contracts

Effects are declared as static budgets:

```air
effects { debug.metric <= 1, memory.alloc <= 1, memory.free <= 1, memory.static_alloc_bytes <= 64, random.* >= 1 }
requires capability debug
requires no capability net
requires export run
ensures static_alloc_bytes <= 64
ensures dynamic_allocations <= 0
```

The verifier counts visible calls and memory operations, supports exact keys such as `debug.metric`, coarse wildcard prefixes such as `input.*`, and supports `<=`, `==`, and `>=` metric predicates. Contracts can require a capability, forbid a capability, require an exported function, or constrain a visible metric.

Wildcard budgets are coarse audit convenience. They are not recommended for mixed-unit families such as `memory.*`, where operation counts (`memory.load`) and byte counts (`memory.static_alloc_bytes`) share one prefix. Canonical examples should use exact memory keys.

Function-level effects and contracts live before the first basic block:

```air
func inc(value: i32) -> i32 {
  effects { cpu.instructions <= 3 }
  requires param value >= 0
  ensures return >= 1
entry:
  %one:i32 = const.i32 1
  %next:i32 = i32.add %value, %one
  return %next
}
```

The verifier checks function-local budgets against that function only. Statically visible call preconditions and return postconditions are checked when constants make them decidable. For the first scalar range slice, simple `i32` function contracts also seed verifier range analysis: `requires param x >= literal`, `requires param x <= literal`, and `requires param x == literal` narrow the parameter range inside the function body, and `ensures return >= literal`, `ensures return <= literal`, and `ensures return == literal` narrow a local call result at the call site. AIR does not perform cross-variable reasoning, arithmetic theorem proving, compound boolean proof, or symbolic widening beyond the existing verifier range model.

## Use Bundles

Bundles reduce AI-generated boilerplate without adding a second language:

```air
use utility.fs
use utility.net
use utility.random
use utility.audio
use math.fixed
```

`utility.*` bundles expand to capabilities and host externs. `math.fixed` enables deterministic fixed-point helpers. Manual externs remain supported for public host ABI functions, but unsupported public host names and conflicting manual signatures are rejected by the verifier.

Current resource budget keys include:

- `cpu.instructions`, `cpu.blocks`, `cpu.branches`, `cpu.loops`, `cpu.loop_iterations`, `cpu.dynamic_loops`, `cpu.phi`
- exact host calls such as `debug.metric`, `fs.read_file`, `net.http_get`, `input.axis`, or wildcard families such as `input.*`
- `memory.alloc`, `memory.free`, `memory.load`, `memory.store`, `memory.slice_sub`, `memory.static_alloc_bytes`, `memory.dynamic_allocations`
- `gpu.calls`, `gpu.draw_calls`, `gpu.instances`, `gpu.render_graph_calls`
- legacy aliases `static_alloc_bytes` and `dynamic_allocations`

## Bounded Loops

AIR v0.10 does not expose arbitrary back-edge CFG. Instead, small deterministic loops are written as bounded function iteration:

```air
%next:i32 = loop.fold.i32 @step, %seed, 5
```

The callee must be a local unary function of the same scalar type. Static counts are unrolled. Dynamic counts are allowed and lower to a structured Wasm loop with a runtime trap if the count is negative or exceeds the verifier bound.

`loop.fold.*` is an accumulator loop: every iteration receives the previous iteration result. Do not use it for request polling or any operation where the original handle must stay stable. `loop.range.*` is a legacy alias for this exact fold semantics; `fmt` rewrites it to `loop.fold.*`.

The local callback passed to `loop.fold.*`, `loop.array.*`, or `loop.buffer.*` participates in the module call graph. A callback that calls its caller, itself, or another local function that closes a cycle is rejected with `air.call.recursion_rejected`, even if the call appears behind a rare or statically false branch.

Array and typed buffer loops are also bounded:

```air
%next:array<i32,4> = loop.array.i32 @step, %items, %count
loop.buffer.f32 @step, %buffer, 4
```

`loop.array.i32` / `loop.array.f32` return a patched copy of the fixed array. `loop.buffer.f32` updates the buffer in place. Static `loop.buffer.f32` ranges require every element in the range to be initialized by `buffer.store` first. Dynamic counts are runtime-checked against the fixed array or buffer length and currently remain bounds-checked rather than fully initialization-proven. For effect budgets, dynamic bounded loops are charged at their verifier maximum, not at an optimistic unknown runtime value.

Canonical async request polling uses `io.poll_bounded`, which preserves the original request handle, polls up to a bounded count, and traps unless the final status is ready (`1`):

```air
%status:i32 = io.poll_bounded %request, 4
```

With a static count, `io.poll_bounded` contributes that exact number of `io.poll` calls to effect usage. With a dynamic count, the verifier charges the maximum supported count as the budget upper bound, audit reports `io.poll.dynamic` / `effects.dynamic`, and the runtime loop still traps above the verifier bound. Use `loop.poll @io.poll, %request, count` only for explicit status-handling control flow; by itself it does not prove the request is ready for `io.result_len`.

## Structured Phi Loops

AIR also accepts one checked loop shape for stateful algorithms that do not fit `loop.fold.*`:

```air
entry:
  %zero:i32 = const.i32 0
  br loop
loop:
  %i:i32 = phi.i32 entry:%zero, body:%next
  %limit:i32 = const.i32 5
  %done:bool = i32.ge_s %i, %limit
  br_if %done, exit, body
body:
  %one:i32 = const.i32 1
  %next:i32 = i32.add %i, %one
  br loop
exit:
  return %i
```

The verifier requires a single entry edge, a single backedge, a phi header, and a dedicated exit block. The lowerer maps phi values to mutable Wasm locals before each loop iteration and inserts a deterministic fuel cap of 4096 body iterations. A structured phi loop that does not reach its exit within the fuel cap traps under AIR's fail-fast semantics. General phi joins, unbounded CFG backedges, and irreducible CFG are still rejected.

## Interactive Input

Interactive modules declare `capabilities { input }` and use scalar host imports:

```air
extern input.axis(id: i32) -> f32
extern input.button(id: i32) -> bool
extern input.pointer_delta_x() -> f32
extern input.pointer_delta_y() -> f32
extern input.pointer_down() -> bool
```

The input names and bindings live in the `.airgfx.json` manifest. AIR sees only stable integer handles.

## Player-Relative Movement

AIR keeps player-relative movement as math, not as renderer behavior. A host can provide input values and camera/player basis vectors, while AIR computes the same movement on every backend:

```air
%pos:vec3 = vec3.new %px, %py, %pz
%forward:vec3 = vec3.new %fx, %fy, %fz
%right:vec3 = vec3.new %rx, %ry, %rz
%next:vec3 = vec3.move_relative %pos, %forward, %right, %forward_axis, %strafe_axis, %step
```

`vec3.move_relative` computes:

```text
position + forward * forward_axis * step + right * strafe_axis * step
```

That is enough for WASD/camera-relative motion without hard-wiring keyboard, mouse, browser, WebGPU, Metal, or game-engine concepts into AIR Core.

## Fixed-Point Physics Helpers

AIR includes a small deterministic physics module for AI-authored player controllers. It uses the current fixed-point convention `1000 == 1 world unit` and lowers directly to Wasm integer math:

```air
%vx:i32 = physics.damp_i32 %current_vx, %target_vx, 5, 3, 8
%grounded:bool = physics.grounded_i32 %player_y, %ground_y, %player_vy, 190
%snap_y:i32 = physics.snap_y_i32 %candidate_y, %ground_y, %candidate_vy, 220
%snap_vy:i32 = physics.snap_vy_i32 %candidate_y, %ground_y, %candidate_vy, 220
```

These are intentionally small building blocks rather than a hidden game engine. AIR code still owns level geometry, triggers, jump pads, teleport rules, collision proxy selection, and camera behavior.

## Success Criteria

AIR succeeds when small AI-generated plugins are easier to generate correctly, review, sandbox, and run across hosts than equivalent ad hoc TypeScript/Rust/Zig snippets.
