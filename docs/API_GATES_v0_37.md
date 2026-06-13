# AIR API Gates v0.37

Status: active milestone gate

Scope: Readonly tablegroups first slice and anti-slop boundaries

v0.37 implements readonly tablegroups. The gate exists to keep the first slice
from expanding into runtime JSON, mutable pools, host object handles,
game-specific APIs, or ABI expansion.

## Command

Run:

```sh
npm run check:api-gates:v0.37
```

The v0.37 gate inherits the stable historical gates and adds readonly
tablegroup boundary checks.

## Rejected Active Implementation

The v0.37 gate must reject active implementation of:

- tablegroups parser syntax outside accepted readonly first-slice scope;
- mutable tablegroups;
- dynamic row counts;
- nested records;
- runtime JSON or `any` payloads;
- dynamic maps;
- object identity or object methods;
- host object handles;
- declared mutable pools;
- tablegroup mutation;
- tablegroup methods;
- game-specific platformer APIs such as `draw_actor` or collision/water helpers;
- raw host authority;
- AIR ABI expansion;
- Host ABI expansion.

Docs and RFCs may discuss these surfaces only when clearly marked as deferred,
rejected, pressure, or non-goals.

## Positive Checks

The implemented gate verifies:

- v0.37 docs describe tablegroups as readonly, fixed-length, and scalar-only;
- tablegroup implementation remains readonly, fixed-length, scalar-only;
- parser/verifier/lowering changes are limited to readonly tablegroups;
- API gates still reject runtime JSON/object-model drift;
- API gates still reject host object handles and raw host authority;
- AIRON references remain pressure evidence, not Core game APIs;
- AIR ABI remains `0.10`;
- Host ABI remains unchanged.

## Non-goals

This gate does not:

- implement mutable tablegroups;
- define additional tablegroup syntax beyond the accepted readonly first slice;
- approve mutable pools;
- approve compact storage beyond existing static table support;
- add generated tablegroup handles;
- add Host ABI imports.

## ABI Status

AIR ABI remains `0.10`.

Host ABI latest remains `0.11`, limited to bounded `output.emit`; Host ABI
`0.10` remains the default/baseline for packages that do not use `output.emit`.
