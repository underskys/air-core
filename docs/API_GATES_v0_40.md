# AIR API Gates v0.40

Status: implemented

v0.40 gates protect the Declared Fixed-Capacity Pools / Slot Groups RFC. v0.40
does not implement pools. The gate script enforces that v0.40 RFC/gate docs
remain present, preserves the docs/RFC/gates milestone boundary, and keeps
forbidden runtime/host/ABI surfaces rejected.

v0.41 owns the first-slice implementation gate. The v0.40 gate must not fail
merely because accepted v0.41 pool implementation files exist; v0.41 is the
authoritative implementation guard for pools.

## Accepted Surface

v0.40 may include:

- planning documents;
- RFC terminology;
- kill criteria;
- future diagnostic names;
- pressure evidence classification;
- docs/RFC mentions of deferred implementation.

## Rejected Active Implementation

v0.40 rejects active implementation of forbidden surfaces:

- dynamic capacity;
- heap/GC;
- runtime JSON/object model;
- dynamic maps/dictionaries;
- object identity;
- host object handles;
- tablegroup mutation;
- platformer/game-specific APIs;
- raw host authority;
- Host ABI expansion;
- AIR ABI change.

Docs and RFCs may mention these items only as deferred, rejected, pressure, or
future work.

## Implemented Gate Behavior

`npm run check:api-gates:v0.40` verifies:

- v0.40 RFC/gate/status docs remain present and truthful;
- v0.41 owns accepted pool implementation gating;
- no Host ABI imports are added;
- AIR ABI remains `0.10`;
- Host ABI remains unchanged;
- docs explicitly distinguish pools from fixed state and readonly tablegroups;
- docs reject runtime JSON, GC, dynamic maps, host object handles, and
  platformer-specific APIs.

## ABI Decision

AIR ABI remains `0.10`.

Host ABI latest remains `0.11`, limited to bounded `output.emit`. v0.40 adds no
Host ABI imports and no host authority.
