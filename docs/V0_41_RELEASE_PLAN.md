# AIR v0.41 Release Plan

Status: active first-slice implementation milestone

Theme: Declared Fixed-Capacity Pools First Slice

v0.41 implements the first slice for declared fixed-capacity pools. It follows
v0.40, which completed the Declared Pools RFC and API gates. The implementation
adds the accepted source syntax, verifier checks, lowering to private
compiler-managed storage, report/evidence/diff metadata, and tests without
changing AIR ABI, Host ABI, or host authority.

AIR ABI latest remains `0.10` unless a future implementation discovers that a
new executable/runtime contract is required. If that happens, implementation
must stop and go through ABI review.

Host ABI latest remains `0.11`, limited to bounded `output.emit`. Host ABI
`0.10` remains the default/baseline target for packages that do not use
`output.emit`. v0.41 does not expand Host ABI.

## Purpose

v0.40 established the design boundary: declared pools are intentional bounded
mutable repeated state, not accidental scalar slot-family slop. v0.41 narrows
that design into a small implementation slice.

The first slice is intentionally conservative:

```text
pool declaration
-> fixed capacity literal
-> scalar i32/bool fields
-> required active flag
-> verifier-visible bounds
-> report/evidence ownership
```

The pool declaration is the source of truth. Generated pool handles or bindings
are derived artifacts only.

## P0 Candidate

| P0 item | Expected first-slice behavior |
| --- | --- |
| Pool source syntax | Implemented small declared pool syntax. |
| Fixed capacity literal | Capacity must be a positive fixed integer literal. |
| Scalar fields only | First slice accepts only `i32` and `bool` fields. |
| Required active flag | A pool must declare an active slot flag. |
| `pool.capacity` | Expose declared capacity as verifier-known package-local metadata/access. |
| `pool.get.i32` / `pool.get.bool` | Read scalar pool fields with verifier-visible index bounds. |
| `pool.set.i32` / `pool.set.bool` | Update scalar pool fields deterministically with verifier-visible index bounds. |
| Bounds checks | Verifier rejects static out-of-bounds and lowers dynamic checks deterministically. |
| No escape | Pool slots, fields, pointers, slices, and references must not escape as host or object handles. |
| Report/evidence/diff visibility | Expose pool name, owner, capacity, fields, active flag, diagnostics, and generated artifact status without raw private slot values by default. |
| reviewPolicy distinction | Declared pools suppress intentional slot-family warnings; undeclared slot families remain warnings/errors. |
| Negative tests | Reject dynamic capacity, GC/maps, runtime objects, host object handles, and platformer/game-specific APIs. |

## Deferred

- pool allocation/free helpers;
- spawn/find-inactive helpers;
- compact pool storage;
- nested records;
- dynamic capacity;
- tablegroup mutation;
- host object handles;
- real game APIs;
- Host ABI expansion;
- AIR ABI change unless separately reviewed.

## Hard Constraints

- fixed capacity only;
- deterministic update only;
- scalar fields only;
- no dynamic allocation;
- no GC;
- no runtime JSON;
- no object identity;
- no dynamic maps;
- no host authority;
- no platformer-specific API;
- generated pool handles/bindings are derived artifacts;
- pool declaration is source of truth.

## Implementation Boundary

The first slice is implemented only for:

- fixed positive literal capacity;
- scalar `i32`/`bool` fields;
- required `active:bool`;
- `pool.capacity`;
- `pool.get.i32` / `pool.get.bool`;
- `pool.set.i32` / `pool.set.bool`;
- private compiler-managed storage;
- verifier-visible static and dynamic bounds checks.

Deferred helpers and broader storage models remain outside v0.41.

## API Gates

v0.40 completed the RFC/gates milestone. The v0.40 gate remains active for
historical RFC/gate integrity and forbidden runtime/host/ABI surfaces, but it no
longer blocks accepted v0.41 pool implementation markers by itself.

v0.41 owns first-slice implementation gating. `npm run check:api-gates:v0.41`
allows only the accepted pool declaration/operation surface and rejects deferred
helpers, dynamic capacity, GC/maps, runtime JSON/object model, host object
handles, tablegroup mutation, game-specific APIs, Host ABI expansion, and AIR
ABI expansion without review.

## Acceptance Criteria

v0.41 is complete when:

- valid pools parse, verify, lower, and run;
- invalid capacity, missing active flag, invalid field type, unknown pool/field,
  and static out-of-bounds cases fail with stable diagnostics;
- dynamic index behavior is deterministic and bounded;
- package report/evidence/package diff expose pool metadata without raw slot
  values by default;
- forbidden surfaces remain rejected by v0.41 gates;
- AIR ABI remains `0.10`;
- Host ABI remains unchanged.

## Links

- [Feature Status v0.41](FEATURE_STATUS_v0.41.md)
- [Declared Pools First Slice RFC](rfcs/v0.41-declared-pools-first-slice.md)
- [Declared Fixed-Capacity Pools RFC v0.40](rfcs/v0.40-declared-fixed-capacity-pools.md)
- [API Gates v0.40](API_GATES_v0_40.md)
- [API Gates v0.41](API_GATES_v0_41.md)
- [Architecture Gates](ARCHITECTURE_GATES.md)
- [Version and ABI Policy](VERSION_AND_ABI_POLICY.md)
