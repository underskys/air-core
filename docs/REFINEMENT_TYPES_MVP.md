# Refinement Types MVP

## Status

This document specifies the bounded v0.49 refinement-type MVP. Canonical AIR
remains the semantic authority. Refinements add verifier facts and diagnostics;
they do not add runtime values, implicit checks, capabilities, effects, or
authority.

## Canonical Surface

The accepted forms are:

```air
i32<MIN..MAX>
slice<len<=N>
slice<len=MIN..MAX>
slice<nonempty>
```

Bounds are inclusive integer literals.

- `i32` bounds must fit `-2147483648..2147483647`.
- Slice-length bounds must fit `0..2147483647`.
- The lower bound must not exceed the upper bound.
- `slice<nonempty>` is accepted input syntax and formats canonically as
  `slice<len=1..2147483647>`.
- `slice<len=0..N>` formats canonically as `slice<len<=N>`.

Refinements are supported on local and exported function parameters, function
returns, and SSA result declarations. Module constants, globals, struct
fields, arrays, buffers, and heap objects are not expanded by this MVP.

## Verification

### Assignments

An SSA result with a refinement is a narrowing assertion:

```air
%score:i32<0..100> = const.i32 75
```

The verifier accepts it only when the operation's known range is contained by
the declared range. Assigning the same result to plain `i32` is widening and is
allowed.

For exact constant `i32` arithmetic, the verifier models existing 32-bit
wrapping behavior. If a non-constant range may overflow, it falls back to the
full signed `i32` range instead of making an optimistic refinement claim.

### Parameters And Calls

A parameter refinement seeds the function-local range environment. Every local
call must prove that the argument's complete known range is contained by the
parameter refinement. An unknown or partially overlapping range fails closed.

### Returns

Every return from a refined function must prove containment in the declared
return range. A refined call result carries that range to the caller.

### Contracts

Simple existing contracts remain available:

```air
requires param value >= 0
requires param value <= 100
ensures return >= 0
ensures return <= 100
```

Parameter contracts intersect with parameter refinements. An empty
intersection is rejected. Existing return postconditions continue to narrow
local call results, so a pair of proven lower and upper facts can satisfy a
refined assignment or call.

No cross-variable relation, arbitrary predicate, compound theorem, or solver
query is introduced.

### Slices

Slice facts use UTF-8 byte length for string literals and existing
`slice.from_region`, `slice.sub`, and `slice.len` metadata. Refined slice
parameters and returns propagate their bounded length range through local
calls. Unknown lengths do not satisfy a narrowing refinement.

Refined extern parameters and returns are rejected. The current Host ABI has
only base types, cannot prove a host-produced bound, and does not carry a
refinement contract across module resolution. Narrow values before an extern
call and validate host-produced values inside AIR with existing explicit
operations.

## Diagnostics

Stable MVP codes:

- `air.refinement.syntax_invalid`
- `air.refinement.bound_out_of_range`
- `air.refinement.range_invalid`
- `air.refinement.assignment_out_of_range`
- `air.refinement.call_argument_out_of_range`
- `air.refinement.return_out_of_range`
- `air.refinement.slice_length_out_of_range`
- `air.refinement.extern_parameter_unsupported`
- `air.refinement.extern_return_unsupported`

All failures include the known range when one is available and a repair hint
through the normal diagnostic normalization path.

## Erasure And Compatibility

The parser stores each refinement separately from its erased base type:

```text
i32<0..10>        -> i32
slice<len<=64>    -> slice
```

The verifier consumes the metadata. The formatter consumes the canonical
declaration. The lowerer, package surfaces, AIR ABI, and Host ABI continue to
receive only the existing base type. Refined and erased versions of the same
exported function produce byte-identical WAT.

Existing unrefined `i32` and `slice` modules retain their prior behavior and
format.

## Explicit Non-Goals

- dependent types;
- arbitrary predicates;
- cross-variable refinements;
- SMT or another theorem prover;
- generic-type expansion;
- heap or ownership model changes;
- new runtime checks or representations;
- lowering changes;
- AIR ABI or Host ABI changes;
- broad demo regeneration.

## Rollback

The MVP is isolated to parser/type/verifier/formatter diagnostics and its
owned tests, examples, specification, and documentation. Removing refinement
metadata handling restores the activation-base behavior without an ABI or
artifact migration.
