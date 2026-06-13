# AIR API Gates v0.41

Status: implemented

v0.41 gates protect the Declared Fixed-Capacity Pools First Slice. v0.40
completed the RFC/gates milestone; v0.41 owns implementation gating for the
accepted first-slice pool surface.

The gate allows only the accepted first-slice implementation shape and rejects
drift into dynamic allocation, object models, host authority, or ABI expansion.

## Accepted First-Slice Surface

v0.41 may implement:

- `pool <name> capacity <positive-integer-literal> { ... }`;
- fields of type `i32` and `bool` only;
- required `active:bool` field;
- scalar literal field initializers;
- `pool.capacity`;
- `pool.get.i32`;
- `pool.get.bool`;
- `pool.set.i32`;
- `pool.set.bool`;
- parser, verifier, lowering, report, evidence, diff, reviewPolicy, and test
  changes required for that accepted first slice;
- docs/RFC mentions of deferred helpers and rejected features.

## Rejected Active Implementation

v0.41 rejects active implementation of:

- `pool.spawn`;
- `pool.free`;
- `pool.find_inactive`;
- `pool.clear`;
- `pool.iter`;
- dynamic capacity;
- heap/GC;
- dynamic maps/dictionaries;
- runtime JSON/object model;
- nested records;
- strings/raw URLs/private text fields;
- host object handles;
- pointer/slice/reference escape;
- tablegroup mutation;
- platformer/game-specific APIs;
- Host ABI expansion;
- AIR ABI expansion unless explicit ABI review exists;
- host-visible pool layout contract.

Docs and RFCs may mention these items only as deferred, rejected, pressure, or
future work.

## Implemented Gate Behavior

`npm run check:api-gates:v0.41` verifies:

- v0.41 docs and gate wiring are present;
- v0.40 gate remains present but no longer blocks accepted v0.41 pool
  implementation files merely for containing pool implementation markers;
- accepted first-slice operation names are the only pool operation names allowed
  in active implementation files;
- deferred pool helpers are not active;
- forbidden runtime JSON/object/map/GC/host-handle/game-specific surfaces are
  absent from active implementation;
- AIR ABI remains `0.10`;
- Host ABI remains unchanged.

## ABI Decision

AIR ABI remains `0.10` if the first slice uses private compiler-managed state
and existing call/runtime conventions.

Host ABI latest remains `0.11`, limited to bounded `output.emit`. v0.41 adds no
Host ABI imports and no host authority.

If implementation requires a new runtime/executable contract or host-visible
pool layout contract, implementation must stop and require ABI review.
