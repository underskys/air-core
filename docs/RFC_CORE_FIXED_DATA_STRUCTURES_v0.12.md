# RFC: AIR Core Fixed Data Structures for v0.12

Status: draft
Version target: v0.12
Target layer: AIR Core parser / formatter / verifier / lowering / audit

This RFC designs safe Core-level data ergonomics for AI-generated modules that
need fixed entity slots, static tables, and readable generated data. It does not
implement compiler changes and does not add Host ABI functions.

Related design:

- [RFC_CORE_MODULE_CONSTANTS_v0.12.md](RFC_CORE_MODULE_CONSTANTS_v0.12.md)
- [RFC_CORE_STATIC_TABLES_v0.12.md](RFC_CORE_STATIC_TABLES_v0.12.md)
- [RFC_CORE_GENERATED_DATA_v0.12.md](RFC_CORE_GENERATED_DATA_v0.12.md)
- [RFC_CORE_MODULE_SPLIT_v0.12.md](RFC_CORE_MODULE_SPLIT_v0.12.md)
- `demo/contra-platformer/FD_LANGUAGE_REQUESTS.md` in the `demo/contra` branch

## Problem

Contra Platformer currently uses repeated slot-specific state such as:

```air
global enemy0_alive:i32 = const.i32 1
global enemy1_alive:i32 = const.i32 1
global enemy2_alive:i32 = const.i32 1

global enemy0_hp:i32 = const.i32 3
global enemy1_hp:i32 = const.i32 3
global enemy2_hp:i32 = const.i32 3

global enemy0_base_world_x:i32 = const.i32 1050
global enemy1_base_world_x:i32 = const.i32 1260
global enemy2_base_world_x:i32 = const.i32 1480
```

The same pattern repeats for reads, updates, drawing, collision, scoring, and
debug metrics. This is reviewable at small scale, but generated AIR becomes
verbose and error-prone as entity counts grow.

The core needs better ergonomics for:

- deterministic fixed entity slots;
- compact static data tables;
- readable constants and handles;
- records/structs where field names help review;
- iteration over known finite ranges.

The solution must not become dynamic object semantics, heap-managed game
objects, or host ABI workarounds.

## Current State

AIR already has internal fixed composite support:

- `struct Name { field: type, ... }`
- `array<T,N>`
- `buffer<T,N>`
- `loop.array.*`
- `loop.buffer.*`
- bounded `loop.fold.*`

Composite values are internal-only. They cannot cross public host ABI boundaries
or exported function boundaries as objects. This RFC preserves that rule.

The missing piece is AI-facing ergonomics for static constants/tables and fixed
slot iteration in generated modules.

## Candidate A: Module-Level Scalar Constants

Draft syntax:

```air
const enemy_count:i32 = 3
const enemy_hp_default:i32 = 3
const enemy0_base_x:i32 = 1050
const enemy1_base_x:i32 = 1260
const enemy2_base_x:i32 = 1480
```

Usage:

```air
%x:i32 = const.get enemy0_base_x
```

Parser impact:

- add immutable module-level `const name:type = literal`;
- scalar literal types only in first slice: `i32`, `i64`, `f32`, `f64`, `bool`;
- constants share namespace with globals, structs, functions, and externs.

Formatter impact:

- deterministic ordering near module header;
- preserve explicit type and literal;
- no expression folding beyond canonical literal formatting.

Verifier impact:

- reject duplicate names;
- reject mutable writes;
- reject non-scalar constants in minimal slice;
- verify literal fits declared type.

Memory model impact:

- no runtime memory allocation;
- lowered as immediates or immutable Wasm globals.

Audit/resource accounting:

- report constants count and scalar byte estimate;
- no host capability or resource authority.

Wasm lowering strategy:

- inline as immediate where safe;
- or emit immutable globals for debug/source mapping.

Compatibility with bounded loops:

- constants may be used as static loop counts if non-negative and within verifier
  bounds.

Negative cases:

```air
const enemies:array<i32,3> = [1, 1, 1] # not Candidate A
const dynamic:i32 = @random.u32()       # rejected: host call
const bad:i32 = enemy_hp_default + 1    # deferred expression syntax
global.set enemy_count, 4               # rejected: not a global
```

## Candidate B: Enum-Like Handles

Draft syntax:

```air
enum EnemyKind:i32 {
  walker = 0
  turret = 1
  flyer = 2
}
```

Usage:

```air
%kind:i32 = enum.get EnemyKind.walker
```

Parser impact:

- add named scalar groups;
- explicit underlying scalar type, initially `i32`.

Formatter impact:

- stable declaration formatting;
- one member per line.

Verifier impact:

- reject duplicate enum names and duplicate member names;
- optionally reject duplicate values unless explicitly allowed later;
- enum values remain scalars, not new runtime types.

Memory model impact:

- no allocation;
- same as scalar constants.

Audit/resource accounting:

- report enum count and value count.

Wasm lowering strategy:

- lower enum member references to constants.

Compatibility with bounded loops:

- enum values may be used as scalar handles, indices, or material/metric IDs.

Negative cases:

```air
enum EnemyKind {
  walker = "enemy"       # rejected: no strings
}
enum HostAudio {
  play = audio.beep      # rejected: no host authority
}
```

## Candidate C: Static Read-Only Tables

Draft syntax:

```air
table enemy_base_x:array<i32,3> = [1050, 1260, 1480]
table enemy_kind:array<i32,3> = [0, 1, 2]
```

Usage:

```air
%slot:i32 = 1
%base_x:i32 = table.get.i32 enemy_base_x, %slot
```

Parser impact:

- add module-level `table name:array<T,N> = [...]`;
- initial element types scalar-only;
- fixed length must match `N`.

Formatter impact:

- canonical list spacing;
- keep short tables single-line and long tables multi-line by deterministic
  rule.

Verifier impact:

- reject mismatched lengths;
- reject dynamic initializers;
- bounds-check `table.get.*`;
- statically reject known out-of-range indexes.

Memory model impact:

- read-only data segment or immutable lowered constants;
- no mutable aliasing.

Audit/resource accounting:

- count read-only bytes;
- expose `memory.static_readonly_bytes` or equivalent report field if adopted.

Wasm lowering strategy:

- small tables may lower to branch/select or immutable globals;
- larger tables lower to a read-only data segment and indexed load with bounds
  checks.

Compatibility with bounded loops:

- table length can be used as a static loop bound;
- loop bodies may read table entries deterministically.

Negative cases:

```air
table bad:array<i32,3> = [1, 2]             # length mismatch
table dynamic:array<i32,3> = [@random.u32()] # host call initializer
table strings:array<string,3> = ["a"]       # no string/object tables
table huge:array<i32,1000000000> = [...]    # rejected by size limits
```

## Candidate D: Fixed-Size Arrays

AIR already has `array<T,N>` as an internal composite. The v0.12 question is
whether to add friendlier initialization and slot helpers.

Candidate usage:

```air
%alive0:array<i32,3> = array.new.i32 1, 1, 1
%slot:i32 = 2
%alive:i32 = array.get %alive0, %slot
%alive1:array<i32,3> = array.set %alive0, %slot, 0
```

Parser impact:

- existing array syntax remains;
- optional new literal syntax would be a separate parser change.

Formatter impact:

- canonical array literal formatting if literals are adopted.

Verifier impact:

- fixed `N` known at verification time;
- element type checked;
- bounds checks for dynamic index;
- static out-of-range index rejected.

Memory model impact:

- value-like internal composite;
- no unbounded growth;
- no host-visible object identity.

Audit/resource accounting:

- track array byte footprint and loop effects;
- dynamic indexing remains bounds-checked.

Wasm lowering strategy:

- scalar locals for small arrays;
- linear memory or Wasm locals/data for larger arrays;
- preserve existing traps for runtime out-of-bounds.

Compatibility with bounded loops:

- integrates with `loop.array.*`;
- static counts unroll;
- dynamic counts trap if negative or above array length/verifier limit.

Negative cases:

```air
%items:array<i32,%n> = array.new.i32 0 # rejected: dynamic length
export func get_items() -> array<i32,3> # rejected: composite ABI boundary
extern host.use_items(items: array<i32,3>) -> void # rejected: composite import
```

## Candidate E: Records/Structs

AIR already has internal structs. For fixed entity slots, structs make review
easier:

```air
struct EnemySlot {
  alive: i32,
  hp: i32,
  base_x: i32,
  kind: i32
}
```

Candidate usage:

```air
%enemy0:EnemySlot = struct.new EnemySlot {
  alive: 1,
  hp: 3,
  base_x: 1050,
  kind: 0
}
%hp:i32 = struct.get.hp %enemy0
```

Parser impact:

- struct declarations exist;
- named struct literal syntax would be a new ergonomic feature.

Formatter impact:

- stable field ordering from declaration;
- reject unknown fields rather than reordering silently.

Verifier impact:

- field existence and type checks;
- no recursive structs in minimal slice;
- no host ABI boundary crossing.

Memory model impact:

- fixed-size internal record;
- no heap object identity;
- no dynamic properties.

Audit/resource accounting:

- count struct byte size where materialized;
- report composite use in audit.

Wasm lowering strategy:

- scalarize fields when possible;
- use linear memory layout only when required by existing composite lowering.

Compatibility with bounded loops:

- arrays of structs are high-risk and should be deferred unless existing
  composite lowering can support them cleanly.

Negative cases:

```air
struct Node { next: Node }            # rejected: recursive object graph
struct Any { payload: dynamic }       # rejected: dynamic object field
extern host.draw(enemy: EnemySlot) -> void # rejected: composite host ABI
```

## Candidate F: Deterministic For Loops Over Constant Ranges

Current AIR uses bounded loop forms such as `loop.fold.*`, `loop.array.*`, and
`loop.buffer.*`. A more readable generated form could be considered:

```air
for slot in 0..3 {
  # deterministic fixed count
}
```

Parser impact:

- new structured statement syntax;
- requires clear interaction with SSA names and phi values.

Formatter impact:

- canonical block formatting;
- explicit range bounds.

Verifier impact:

- range bounds must be constants or statically bounded;
- iteration count must fit verifier budget;
- no unbounded back-edges.

Memory model impact:

- no new memory model;
- loop body effects accounted per iteration.

Audit/resource accounting:

- charge static loops by exact count;
- charge dynamic bounded loops by verifier maximum.

Wasm lowering strategy:

- static ranges may unroll;
- bounded dynamic ranges lower like current checked loops.

Compatibility with bounded loops:

- should compile to existing bounded loop semantics rather than create a second
  loop model.

Negative cases:

```air
for slot in 0..enemy_count_from_input { } # rejected unless statically bounded
while true { }                            # non-goal
for item in dynamic_list { }              # no dynamic collections
```

## Safety Rules

- No unbounded arrays.
- No dynamic object allocation.
- No hidden host authority.
- Deterministic iteration only.
- Static sizes known at verification time where possible.
- Composite values stay internal-only.
- Host ABI boundaries remain scalar/pointer-handle based.
- Read-only data has clear byte accounting.
- Dynamic indexing remains bounds-checked.
- No demo-specific entity syntax.

## Contra Rewrite Examples

Current slot globals:

```air
global enemy0_base_world_x:i32 = const.i32 1050
global enemy1_base_world_x:i32 = const.i32 1260
global enemy2_base_world_x:i32 = const.i32 1480
```

Candidate static table:

```air
table enemy_base_world_x:array<i32,3> = [1050, 1260, 1480]
table enemy_kind:array<i32,3> = [0, 1, 2]
```

Candidate use:

```air
%slot:i32 = 1
%base_x:i32 = table.get.i32 enemy_base_world_x, %slot
%kind:i32 = table.get.i32 enemy_kind, %slot
```

Current repeated reads:

```air
%e0_hp0:i32 = global.get enemy0_hp
%e1_hp0:i32 = global.get enemy1_hp
%e2_hp0:i32 = global.get enemy2_hp
```

Candidate fixed array state:

```air
%hp0:array<i32,3> = array.new.i32 3, 3, 3
%slot:i32 = 2
%hp:i32 = array.get %hp0, %slot
%hp1:array<i32,3> = array.set %hp0, %slot, 2
```

This example is intentionally generic. It does not add `enemy` semantics to
stdlib or public ABI; it only illustrates fixed-slot data ergonomics.

## Minimal v0.12 Implementation Recommendation

Start with the smallest slice:

1. module-level scalar constants; and
2. static read-only scalar tables.

Rationale:

- high reviewability gain for generated AIR;
- no new host authority;
- no dynamic object semantics;
- simple parser/formatter surface;
- simple verifier and lowering model;
- directly addresses repeated handles, thresholds, and fixed slot base data.

Defer:

- enum-like handles until constants/tables prove stable;
- new struct literal syntax;
- array literal ergonomics beyond current support;
- general `for` syntax;
- arrays of structs;
- nested static tables.

## Non-goals

- No JS/Python-like objects.
- No heap-managed object system.
- No dynamic maps.
- No generics.
- No host ABI workaround.
- No demo-specific entity syntax.
- No package registry or remote data loading.
- No Core syntax patch in v0.11.

## Tests Required Before Implementation

Required tests:

- scalar constant verifies, formats, audits, lowers, and runs;
- static table verifies, formats, audits, lowers, and runs;
- table length mismatch rejected;
- table out-of-range static index rejected;
- dynamic table index bounds-checks at runtime;
- constants can be used as bounded loop counts;
- read-only bytes appear in audit/report;
- constants/tables cannot call host imports;
- composite values still cannot cross Host ABI or exports;
- generated Contra-like fixed-slot example lowers deterministically.
