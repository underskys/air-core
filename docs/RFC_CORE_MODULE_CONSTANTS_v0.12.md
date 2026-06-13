# RFC: AIR Core Module-Level Immutable Constants for v0.12

Status: draft

Version target: v0.12

Target layer: AIR Core parser / formatter / verifier / lowering / audit

This RFC designs module-level scalar constants for AIR. It is a design document
only. It does not implement parser, verifier, formatter, lowering, or audit
changes.

Related design:

- [RFC_CORE_STATIC_TABLES_v0.12.md](RFC_CORE_STATIC_TABLES_v0.12.md)
- [RFC_CORE_GENERATED_DATA_v0.12.md](RFC_CORE_GENERATED_DATA_v0.12.md)
- [RFC_CORE_FIXED_DATA_STRUCTURES_v0.12.md](RFC_CORE_FIXED_DATA_STRUCTURES_v0.12.md)
- [RFC_CORE_MODULE_SPLIT_v0.12.md](RFC_CORE_MODULE_SPLIT_v0.12.md)
- [AIR Core](../spec/AIR_CORE.md)

## Problem

Large generated AIR modules currently repeat scalar data through mutable globals
or local constants:

```air
global enemy0_alive:i32 = const.i32 1
global enemy1_alive:i32 = const.i32 1
global enemy2_alive:i32 = const.i32 1
```

That pattern is verbose and misleading. The values are often compile-time
handles, limits, counts, or thresholds, but `global` implies runtime storage and
mutability through `global.set`.

Generated modules need readable names for:

- material handles;
- sprite handles;
- audio handles;
- asset handles;
- debug metric IDs;
- fixed-point speeds and thresholds;
- small module-local counts.

The solution must improve readability without adding host authority, runtime
reflection, dynamic lookup, arrays, tables, or enum syntax in the first slice.

## Proposed Syntax

```air
const ENEMY_COUNT:i32 = 3
const PLAYER_SPEED:i32 = 560
const MAT_JUNGLE_PLATFORM:i32 = 12
const UI_VISIBLE:bool = true
```

Constants are declared at module scope. They are immutable, module-local, and
compile-time only.

## Supported Types

The first slice supports scalar literal constants only:

- `i32`
- `i64`
- `f32`
- `f64`
- `bool`

No `slice`, strings, structs, arrays, buffers, vectors, tables, or resource
handles as distinct runtime objects are included in this RFC.

## Usage

Constants can be used anywhere an equivalent literal or local SSA const value is
currently accepted:

```air
module movement
const PLAYER_SPEED:i32 = 560

export func step(input_x: i32) -> i32 {
entry:
  %delta:i32 = mul %input_x, PLAYER_SPEED
  return %delta
}
```

Equivalent current AIR:

```air
export func step(input_x: i32) -> i32 {
entry:
  %speed:i32 = const.i32 560
  %delta:i32 = mul %input_x, %speed
  return %delta
}
```

Constants are not SSA values. They are named compile-time literals that the
parser/resolver can substitute into instruction arguments before verifier and
lowering phases.

## Parser Impact

Add a top-level declaration:

```text
const <NAME>:<TYPE> = <LITERAL>
```

Rules:

- constants appear at module scope;
- constants may be declared after `module` and `use` lines;
- constants may appear before `capabilities`, `effects`, `extern`, `struct`,
  `global`, and `func` declarations;
- names are module-local;
- duplicate names are rejected across constants, globals, functions, externs,
  and structs;
- first-slice values are literal-only, not expressions.

Recommended name policy:

- allow normal AIR identifiers;
- examples should use uppercase for generated constants when that improves
  reviewability;
- formatter preserves the declared name rather than enforcing case.

## Formatter Impact

Formatter output must be deterministic:

1. emit `module`;
2. emit `use` declarations;
3. emit constants in stable declaration order or sorted canonical order;
4. emit `capabilities`, `effects`, contracts, structs, globals, externs, and
   functions using the existing ordering policy.

Recommended first implementation: preserve source order while rejecting
duplicates. If formatter later sorts module declarations globally, that should
be a separate formatting policy change.

Formatter examples:

```air
const ENEMY_COUNT:i32 = 3
const PLAYER_SPEED:i32 = 560
const INVULN_TIME:f32 = 0.25
const DEBUG_ENABLED:bool = true
```

## Verifier Impact

Verifier responsibilities:

- validate declared type is one of the supported scalar types;
- validate literal fits declared type and range;
- reject duplicate names;
- reject non-literal initializers;
- reject mutation attempts;
- type-check every constant use at the use site;
- treat constants as statically visible for contracts, budgets, loop counts,
  manifest handle diagnostics, and repair hints.

Range checks:

- `i32`: signed 32-bit integer range;
- `i64`: signed 64-bit integer range where parser representation permits;
- `f32`: finite numeric literal representable as f32;
- `f64`: finite numeric literal;
- `bool`: `true` or `false`.

Negative cases:

```air
const ENEMY_COUNT:i32 = random.u32()  # rejected: expression/host call
const LABEL:slice = "enemy"          # rejected: no string/slice constants
const SPEED:i32 = BASE + 1           # rejected in first slice
global.set ENEMY_COUNT, 4            # rejected: not a mutable global
```

## Lowering Model

Constants do not allocate storage by default. Lowering replaces each constant
reference with the same immediate operation AIR already emits for local const
instructions:

```air
const PLAYER_SPEED:i32 = 560
%delta:i32 = mul %input_x, PLAYER_SPEED
```

Conceptually lowers like:

```air
%PLAYER_SPEED_const:i32 = const.i32 560
%delta:i32 = mul %input_x, %PLAYER_SPEED_const
```

The implementation can choose either:

- inline immediate constants at every use; or
- synthesize local SSA const instructions during lowering/resolution.

It must not emit mutable globals or runtime memory unless a later RFC explicitly
adds debug metadata or read-only data sections.

## Audit And Reports

Audit output should list module constants as review metadata:

```json
{
  "constants": [
    { "name": "PLAYER_SPEED", "type": "i32", "value": 560 }
  ]
}
```

Resource accounting:

- no `memory.alloc`;
- no `memory.static_alloc_bytes`;
- no host capability;
- no Host ABI imports;
- no WIT ABI change.

If constants are used in effect budgets or contract checks, audit should show
the resolved literal when practical.

## Compatibility

This is additive syntax. Existing v0.10/v0.11 modules remain valid.

Module constants must not alter public Host ABI, package manifests, asset
manifests, generated handles, or target profile semantics.

Generated handle modules can later choose between generated functions and
module-level constants, but this RFC does not require changing the current
function-based handle generator.

## Risks

- Constants may be overused to hide project-specific data in Core-looking code.
  Review policy should still keep demo/gameplay/art names package-local.
- Large generated files may become constant dumps. Static tables should use a
  separate RFC rather than abusing scalar constants.
- Literal substitution must preserve precise type behavior, especially f32/f64.
- Formatter ordering must be deterministic without making diffs confusing.
- Source import/module split behavior must specify whether imported constants
  are visible across modules; this RFC keeps names module-local.

## Recommendation

Implement module-level scalar constants as the smallest v0.12 Core data
ergonomics slice:

1. support `i32`, `i64`, `f32`, `f64`, and `bool`;
2. support literal-only initializers;
3. keep constants module-local;
4. lower by substituting existing SSA const instructions;
5. report constants in audit metadata;
6. defer arrays, tables, strings, enums, dynamic lookup, and imports.

## Non-Goals

- No dynamic constants.
- No expressions beyond literals in the first slice.
- No string constants unless separately designed.
- No module imports or cross-module constant visibility in this RFC.
- No enums as a language feature yet.
- No arrays or static tables in this slice.
- No runtime reflection.
- No host authority.
- No package registry or target packaging behavior.
