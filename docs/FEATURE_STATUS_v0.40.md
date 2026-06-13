# AIR v0.40 Feature Status

Status: active planning/RFC/gates milestone

Version target: v0.40

v0.40 defines the Declared Fixed-Capacity Pools / Slot Groups RFC and gates.
It is planning/docs only. No pool implementation is accepted in v0.40.

AIR ABI latest remains `0.10`. Host ABI latest remains `0.11`, limited to the
bounded `output.emit` first slice. Host ABI `0.10` remains the default/baseline
compatibility target for packages that do not use `output.emit`.

Related documents:

- [AIR v0.40 Release Plan](V0_40_RELEASE_PLAN.md)
- [Declared Fixed-Capacity Pools RFC](rfcs/v0.40-declared-fixed-capacity-pools.md)
- [API Gates v0.40](API_GATES_v0_40.md)
- [Architecture Gates](ARCHITECTURE_GATES.md)
- [Version and ABI Policy](VERSION_AND_ABI_POLICY.md)

## Status Values

- `stable/active`: inherited behavior from earlier milestones.
- `planned/P0`: accepted v0.40 planning scope.
- `planned/P1`: accepted lower-priority v0.40 planning scope.
- `deferred`: future work outside v0.40.
- `rejected`: not allowed without separate accepted scope.

## Stable / Active Baseline

| Feature | Layer | v0.40 status |
| --- | --- | --- |
| AIR ABI `0.10` | ABI | Stable/active. |
| Host ABI `0.10` | ABI | Stable/active and still supported. |
| Host ABI `0.11` bounded `output.emit` | Host ABI/package/runtime | Stable bounded first slice only. No expansion accepted for v0.40. |
| Fixed bounded state | AIR source/verifier/lowering | Stable baseline for declared pool comparison. |
| Bounded Structured IO first slice | package metadata/tooling | Stable from v0.32. |
| Readonly tablegroups first slice | AIR source/verifier/lowering | Stable from v0.37. No mutation expansion accepted for v0.40. |
| Executable Package Composition first slice | package/linking/evidence | Stable from v0.39. |

## v0.40 P0

| Feature | Layer | v0.40 status |
| --- | --- | --- |
| Declared pool model | RFC | Planned/P0. |
| Relation to fixed state | RFC | Planned/P0: pool is bounded mutable state with declared capacity, not a dynamic array or object model. |
| Relation to readonly tablegroups | RFC | Planned/P0: tablegroups are readonly static data; pools are mutable runtime state. |
| First-slice constraints | RFC/gates | Planned/P0: fixed capacity literal, scalar fields, active flag, deterministic update, verifier-visible bounds. |
| Source of truth | RFC | Planned/P0: pool declaration is source of truth; generated handles/bindings are derived. |
| Verifier obligations | RFC | Planned/P0: capacity, field access, active flag, no escapes, loop budget accounting. |
| Report/evidence/diff/replay visibility | RFC | Planned/P0. |
| reviewPolicy pool/slop distinction | RFC | Planned/P0. |
| Diagnostics | RFC | Planned/P0. |
| ABI impact decision | RFC/gates | Planned/P0: AIR ABI remains `0.10`; Host ABI unchanged unless future implementation triggers separate review. |
| Kill criteria | RFC/gates | Planned/P0. |

## v0.40 P1

| Feature | Layer | v0.40 status |
| --- | --- | --- |
| Generated pool handles | generator/tooling | Planned/P1. |
| Pool snapshot helper proposal | evidence/tooling | Planned/P1. |
| AIRON-style projectile pool sketch | pressure evidence | Planned/P1. |
| LSP diagnostics | LSP/tooling | Planned/P1. |
| Repair hints | diagnostics | Planned/P1. |
| Pool benchmark plan | benchmarks | Planned/P1. |

## Deferred / Rejected

| Feature | v0.40 status |
| --- | --- |
| Pool implementation | Deferred. |
| Dynamic capacity | Deferred/rejected for first slice. |
| Heap/GC | Rejected. |
| Maps/dicts | Rejected. |
| Runtime JSON/object model | Rejected. |
| Object identity | Rejected. |
| Nested records | Deferred. |
| Host object handles | Rejected. |
| Tablegroup mutation | Rejected. |
| Real game APIs | Rejected for Core. |
| Platformer-specific APIs | Rejected for Core. |
| Host ABI expansion | Rejected for v0.40. |
| AIR ABI change | Rejected unless separate ABI review accepts a required executable contract change. |
| External demo source changes | Rejected for v0.40. |

## Version Semantics

- Project milestone: `v0.40`.
- AIR ABI latest: remains `0.10`.
- Host ABI latest: remains `0.11`.
- Host ABI default/baseline: remains `0.10`.
- Host ABI `0.11` support remains limited to bounded `output.emit` packages.
- Host ABI expansion in v0.40: none.
- AIR ABI change in v0.40: none.
