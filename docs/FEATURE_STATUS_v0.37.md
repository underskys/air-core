# AIR v0.37 Feature Status

Status: active implementation milestone

Version target: v0.37

v0.37 implements the Readonly Tablegroups First Slice. Parser, verifier,
lowering, reports, and verification evidence gained narrow readonly tablegroup
support. AIR ABI, Host ABI, mutable pools, runtime JSON/object models, and host
object handles remain unchanged.

AIR ABI latest remains `0.10`. Host ABI latest remains `0.11`, limited to the
bounded `output.emit` first slice. Host ABI `0.10` remains the default/baseline
compatibility target for packages that do not use `output.emit`.

Related documents:

- [AIR v0.37 Release Plan](V0_37_RELEASE_PLAN.md)
- [Readonly Tablegroups RFC](rfcs/v0.37-readonly-tablegroups.md)
- [API Gates v0.37](API_GATES_v0_37.md)
- [Architecture Gates](ARCHITECTURE_GATES.md)
- [Version and ABI Policy](VERSION_AND_ABI_POLICY.md)

## Status Values

- `stable/active`: inherited behavior from earlier milestones.
- `implemented/P0`: implemented v0.37 P0 scope.
- `planned/P0`: accepted v0.37 P0 scope not implemented yet.
- `planned/P1`: accepted lower-priority v0.37 planning scope.
- `deferred`: future work outside v0.37.
- `rejected`: not allowed without separate accepted scope.

## Stable / Active Baseline

| Feature | Layer | v0.37 status |
| --- | --- | --- |
| AIR ABI `0.10` | ABI | Stable/active. |
| Host ABI `0.10` | ABI | Stable/active and still supported. |
| Host ABI `0.11` bounded `output.emit` | Host ABI/package/runtime | Stable bounded first slice only. No expansion accepted for v0.37. |
| Bounded Structured IO first slice | package metadata/tooling | Stable from v0.32. |
| Consumer Evidence Corpus | evidence/process | Stable from v0.36. |

## v0.37 P0

| Feature | Layer | v0.37 status |
| --- | --- | --- |
| Readonly tablegroup model | AIR source/verifier | Implemented/P0. |
| Allowed first-slice field/storage types | parser/verifier | Implemented/P0. `i32` and `bool`; compact integer storage deferred. |
| Tablegroup declaration syntax | parser/formatter | Implemented/P0. |
| Tablegroup access operation | parser/verifier/lowering | Implemented/P0. |
| Equal-length validation | parser/verifier | Implemented/P0. |
| Bounds validation | verifier/lowering | Implemented/P0. |
| Package-check/report/evidence visibility | reporting/evidence | Implemented/P0. |
| Lowering to existing static table machinery | lowering | Implemented/P0. |
| LSP diagnostics | diagnostics/LSP | Implemented/P0 through stable diagnostic mapping. |
| reviewPolicy anti-slop integration | review/policy | Implemented/P0. Select-chain table warnings point to readonly tablegroups; mutable slot-family warnings route to future declared pools instead. |
| AIRON level-data fixture plan | consumer pressure/test | Implemented/P0 as synthetic AIRON-style readonly level-data test. No demo import. |
| ABI decision | ABI policy | Implemented/P0. AIR ABI remains `0.10`; Host ABI unchanged. |

## v0.37 P1

| Feature | Layer | v0.37 status |
| --- | --- | --- |
| Generated tablegroup handles | generated artifacts | Planned/P1. |
| Editor roundtrip | tooling/editor | Planned/P1. |
| Richer compact storage | storage design | Planned/P1. |
| Tablegroup diff visualization | evidence/diff tooling | Planned/P1. |
| Package-local completion metadata | LSP/tooling | Planned/P1. |

## Deferred / Rejected

| Feature | v0.37 status |
| --- | --- |
| Mutable tablegroup implementation | Deferred beyond v0.37. |
| Additional tablegroup syntax variants | Deferred beyond v0.37. |
| Mutable tablegroups | Deferred/rejected for first slice. |
| Dynamic row counts | Rejected for first slice. |
| Nested records | Rejected for first slice. |
| Runtime JSON | Rejected. |
| Objects/maps | Rejected. |
| Tablegroup methods | Rejected. |
| Declared mutable pools | Deferred and PRO-gated. |
| Host object handles | Rejected. |
| Demo-specific platformer APIs | Rejected for Core. |
| AIR ABI change | Rejected for v0.37. |
| Host ABI change | Rejected for v0.37. |

## Version Semantics

- Project milestone: `v0.37`.
- AIR ABI latest: remains `0.10`.
- Host ABI latest: remains `0.11`.
- Host ABI default/baseline: remains `0.10`.
- Host ABI `0.11` support remains limited to bounded `output.emit` packages.
- Host ABI expansion in v0.37: none.
- AIR ABI change in v0.37: none.
