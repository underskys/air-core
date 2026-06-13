# AIR v0.41 Feature Status

Status: active first-slice implementation milestone

Version target: v0.41

v0.41 implements the Declared Fixed-Capacity Pools First Slice. v0.40 completed
the Declared Pools RFC and gates; v0.41 adds the accepted parser, verifier,
lowering, report/evidence, package diff, and gate coverage for the first slice.

AIR ABI latest remains `0.10`. Host ABI latest remains `0.11`, limited to
bounded `output.emit`; Host ABI `0.10` remains the default/baseline target for
packages that do not use `output.emit`.

Related documents:

- [AIR v0.41 Release Plan](V0_41_RELEASE_PLAN.md)
- [Declared Pools First Slice RFC](rfcs/v0.41-declared-pools-first-slice.md)
- [Declared Fixed-Capacity Pools RFC v0.40](rfcs/v0.40-declared-fixed-capacity-pools.md)
- [API Gates v0.40](API_GATES_v0_40.md)
- [API Gates v0.41](API_GATES_v0_41.md)
- [Architecture Gates](ARCHITECTURE_GATES.md)
- [Version and ABI Policy](VERSION_AND_ABI_POLICY.md)

## Status Values

- `stable/active`: inherited behavior from earlier milestones.
- `implemented/P0`: completed v0.41 first-slice implementation scope.
- `planned/P0`: accepted v0.41 first-slice work not yet implemented.
- `planned/P1`: accepted lower-priority planning scope.
- `deferred`: future work outside v0.41.
- `rejected`: not allowed without separate accepted scope.

## Stable / Active Baseline

| Feature | Layer | v0.41 status |
| --- | --- | --- |
| AIR ABI `0.10` | ABI | Stable/active. |
| Host ABI `0.10` | ABI | Stable/active and still supported. |
| Host ABI `0.11` bounded `output.emit` | Host ABI/package/runtime | Stable bounded first slice only. No expansion accepted for v0.41. |
| Fixed bounded state | AIR source/verifier/lowering | Stable baseline for declared pool comparison. |
| Bounded Structured IO first slice | package metadata/tooling | Stable from v0.32. |
| Readonly tablegroups first slice | AIR source/verifier/lowering | Stable from v0.37. No mutation expansion accepted for v0.41. |
| Executable Package Composition first slice | package/linking/evidence | Stable from v0.39. |
| Declared Pools RFC and gates | docs/API gates | Completed in v0.40. v0.41 owns first-slice implementation gates. |

## v0.41 P0 Candidate

| Feature | Layer | v0.41 status |
| --- | --- | --- |
| Pool source syntax first slice | parser/verifier/lowering | Implemented/P0. |
| Fixed capacity literal | verifier | Implemented/P0. |
| Scalar fields `i32` and `bool` only | verifier/lowering | Implemented/P0. |
| Required active flag | verifier/reporting | Implemented/P0. |
| `pool.capacity` | AIR source/verifier/lowering | Implemented/P0. |
| `pool.get.i32` / `pool.get.bool` | AIR source/verifier/lowering | Implemented/P0. |
| `pool.set.i32` / `pool.set.bool` | AIR source/verifier/lowering | Implemented/P0. |
| Verifier bounds checks | verifier | Implemented/P0: static reject, dynamic deterministic check. |
| No pointer/slice/reference escape | verifier | Implemented/P0. |
| Report/evidence/diff visibility | reporting/evidence/package diff | Implemented/P0. |
| reviewPolicy pool/slop distinction | reviewPolicy | Implemented/P0 through declared pool syntax, report metadata, and gates; helper suggestions remain advisory. |
| Negative forbidden-surface tests | tests/API gates | Implemented/P0: dynamic capacity, GC/maps, object model, host handles, game APIs. |
| v0.41 API gates | scripts/docs | Implemented/P0: allows only accepted first-slice pool implementation and rejects deferred helpers or forbidden runtime/host surfaces. |

## Deferred / Rejected

| Feature | v0.41 status |
| --- | --- |
| Pool allocation/free helpers | Deferred. |
| Spawn/find-inactive helpers | Deferred. |
| Compact pool storage | Deferred. |
| Nested records | Deferred. |
| Dynamic capacity | Rejected for first slice. |
| Tablegroup mutation | Rejected. |
| Host object handles | Rejected. |
| Runtime JSON/object model | Rejected. |
| Dynamic maps | Rejected. |
| GC | Rejected. |
| Real game APIs | Rejected for Core. |
| Platformer-specific APIs | Rejected for Core. |
| Host ABI expansion | Rejected for v0.41. |
| AIR ABI change | Rejected unless separate ABI review accepts a required executable contract change. |
| External demo source changes | Rejected for v0.41. |

## Version Semantics

- Project milestone: `v0.41`.
- AIR ABI latest: remains `0.10`.
- Host ABI latest: remains `0.11`.
- Host ABI default/baseline: remains `0.10`.
- Host ABI `0.11` support remains limited to bounded `output.emit` packages.
- Host ABI expansion in v0.41: none.
- AIR ABI change in v0.41: none unless separately reviewed.
