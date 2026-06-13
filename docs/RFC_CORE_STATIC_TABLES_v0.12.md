# RFC: AIR Core Static Read-Only Scalar Tables for v0.12

Status: superseded by v0.13 first implementation slice

Version target: v0.12

Target layer: AIR Core parser / formatter / verifier / lowering / audit

Superseded note: the fixed-length, scalar-only, read-only table slice described
here has been promoted into active v0.13 behavior. The authoritative current
status is [FEATURE_STATUS_v0.13.md](FEATURE_STATUS_v0.13.md), and the active
Core syntax is documented in [AIR Core](../spec/AIR_CORE.md). Broader table
ideas in this RFC remain design background only.

This RFC designs fixed-size read-only scalar tables for generated AIR modules.
For v0.12 it was a design document only. In v0.13, the narrow scalar table slice
is active; nested tables, mutable tables, dynamic sizes, maps, objects, strings,
and host resource handles remain out of scope.

Related design:

- [RFC_CORE_MODULE_CONSTANTS_v0.12.md](RFC_CORE_MODULE_CONSTANTS_v0.12.md)
- [RFC_CORE_GENERATED_DATA_v0.12.md](RFC_CORE_GENERATED_DATA_v0.12.md)
- [RFC_CORE_FIXED_DATA_STRUCTURES_v0.12.md](RFC_CORE_FIXED_DATA_STRUCTURES_v0.12.md)
- [AIR Core](../spec/AIR_CORE.md)

## Problem

Game, visual, and tooling demos need compact read-only data for:

- enemy spawn positions;
- pickup slots;
- level anchors;
- material handles;
- sprite frames;
- collision zones;
- voxel/chunk metadata.

Current generated AIR often repeats every value as a separate global or local
constant. That keeps semantics explicit, but large generated modules become hard
to review.

The goal is a small table feature for fixed compile-time data without turning
AIR into a dynamic data language.

## Proposed Syntax

```air
table enemy_base_x:i32[3] = [1050, 1260, 1480]
table enemy_base_y:i32[3] = [320, 320, 300]
table enemy_alive:bool[3] = [true, true, false]
```

Tables are module-level, read-only, fixed-length declarations. The first design
supports scalar element types only.

## Supported Element Types

First slice:

- `i32`
- `i64`
- `f32`
- `f64`
- `bool`

Deferred:

- strings / `slice`;
- structs;
- nested arrays;
- records/objects;
- maps/dictionaries;
- host/resource handles as special runtime objects.

Material, sprite, audio, asset, and debug metric IDs may be stored as scalar
values, but the table itself grants no host authority.

## Table Access

Question: is table access an instruction?

Recommendation: yes. Add explicit typed load instructions rather than treating
table names as pointer-like values:

```air
%slot:i32 = const.i32 1
%x:i32 = table.get.i32 enemy_base_x, %slot
%alive:bool = table.get.bool enemy_alive, %slot
```

Reasons:

- keeps bounds checks visible in verifier/lowering;
- avoids exposing raw pointers or table addresses;
- mirrors existing explicit AIR operations;
- lets audit count table reads;
- keeps host ABI and exported function ABI scalar-only.

No table mutation instruction is included in this RFC.

## Fixed Shape

The verifier must prove table shape at module verification time:

- declared length is a positive integer;
- initializer element count exactly matches declared length;
- every initializer is a literal of the declared scalar type;
- table name is unique in the module namespace;
- table element type is one of the supported scalar types.

Negative cases:

```air
table empty:i32[0] = []                       # rejected in first slice
table bad_len:i32[3] = [1, 2]                 # rejected
table mixed:i32[2] = [1, true]                # rejected
table nested:i32[2][2] = [[1, 2], [3, 4]]     # rejected
table dynamic:i32[2] = [1, @random.u32()]     # rejected
```

## Bounds Checking

Every `table.get.*` is bounds checked.

Verifier behavior:

- if index is statically visible and outside range, reject;
- if index is statically visible and inside range, allow;
- if index is dynamic, allow only with a lowering-time/runtime bounds check;
- report the table length and index evidence where practical.

Lowering behavior:

- dynamic out-of-bounds access traps deterministically;
- no unchecked memory reads;
- no host callbacks for bounds failures.

## Memory Representation

Question: is table lowered to memory/data segment?

Recommendation for first implementation:

- small tables may lower to synthesized constant selection or private immutable
  Wasm data, whichever is simpler and deterministic;
- implementation must not expose table addresses to AIR;
- implementation must not create mutable globals;
- package reports must show table byte counts either way.

Two acceptable lowering strategies:

1. **Inline/select lowering for very small tables**
   - `table.get.i32 t, %idx` lowers to a bounds check and a deterministic
     selection chain.
   - No memory data segment.
   - Useful for small generated handle/threshold tables.

2. **Private read-only data segment**
   - Lower table values into a private Wasm data segment.
   - `table.get.*` lowers to bounds check plus typed load.
   - The pointer/base is compiler-owned and not visible in AIR.

The first implementation should choose one strategy and document it. It should
not mix strategies in ways that make audit output nondeterministic.

## Export Rules

Question: can tables be exported?

Recommendation: no for the first slice.

Tables are module-local implementation details. AIR exports remain functions
with scalar ABI boundaries. Exporting tables would require read-only data
section ABI, memory layout stability, and host access policy that belongs in a
separate RFC.

Allowed:

```air
export func enemy_base_x(slot: i32) -> i32 {
entry:
  %x:i32 = table.get.i32 enemy_base_x, %slot
  return %x
}
```

Rejected:

```air
export table enemy_base_x
```

## Generated Handle Modules

Question: can generated handle modules use tables?

Recommendation: not in the first implementation slice.

Current generated manifest-backed handles can stay function-based:

```air
export func mat_basic_unlit() -> i32 {
entry:
  %id:i32 = const.i32 1
  return %id
}
```

A later generator could use tables for compact groups:

```air
table material_ids:i32[2] = [1, 2]

export func material_id(index: i32) -> i32 {
entry:
  %id:i32 = table.get.i32 material_ids, %index
  return %id
}
```

That should wait until table syntax, bounds diagnostics, and lowering are
implemented and audited.

## WASM Lowering Interaction

`table.get.*` must lower deterministically and preserve scalar semantics:

- `i32`, `i64`, `f32`, `f64`, and `bool` values lower to their Wasm scalar
  equivalents;
- `bool` tables may lower as `i32` values `0` or `1`;
- dynamic bounds checks trap consistently;
- static in-bounds accesses may be folded to constants;
- static out-of-bounds accesses are verifier errors;
- no exported memory or table address is required.

Lowering must preserve the current public ABI boundary: no table type crosses an
extern or exported function boundary.

## Formatter Impact

Formatter output must be deterministic:

- one table declaration per logical table;
- canonical type and length formatting: `table name:type[N] = [...]`;
- normalize spaces after commas;
- preserve numeric literal spelling according to existing formatter policy;
- keep table declarations near constants and before globals/functions.

Large table wrapping should be deterministic. The first implementation may keep
tables single-line and rely on a later formatting RFC for multi-line table
wrapping.

## Verifier Impact

Verifier responsibilities:

- validate table name uniqueness;
- validate element type and length;
- validate every literal;
- reject mutable writes;
- reject table export;
- reject table use as raw pointer, slice, struct, array, or host ABI argument;
- validate `table.get.*` result type matches table element type;
- perform static bounds rejection where possible;
- mark dynamic table reads for lowering-time runtime bounds checks.

## Audit And Package Reports

Audit/package report should include:

```json
{
  "tables": {
    "count": 2,
    "staticBytes": 24,
    "items": [
      { "name": "enemy_base_x", "type": "i32", "length": 3, "bytes": 12 },
      { "name": "enemy_base_y", "type": "i32", "length": 3, "bytes": 12 }
    ]
  }
}
```

Resource accounting:

- table bytes count as static read-only data, not dynamic allocation;
- no `memory.alloc`;
- no `memory.free`;
- no host capability;
- no Host ABI import.

If the implementation uses a private data segment, report that as read-only
static data. If it lowers by selection/folding, report the logical table bytes
for review consistency.

## First Implementation Slice

Promoted v0.13 slice:

1. parse `table name:type[N] = [...]`;
2. support scalar types only;
3. implement `table.get.<type> table_name, %index`;
4. reject table exports and table mutation;
5. lower with one deterministic strategy;
6. report table counts/sizes in audit/package reports;
7. add tests for static in-bounds, static out-of-bounds, dynamic bounds check,
   bad length, bad type, and no ABI crossing.

This implementation should be a separate task after RFC review.

## Non-Goals

- No mutable dynamic arrays.
- No records/objects.
- No nested arrays.
- No maps/dictionaries.
- No GC.
- No string tables in the first slice.
- No exported tables.
- No host authority from table values.
- No runtime reflection.
- No package registry or target bundling behavior.
