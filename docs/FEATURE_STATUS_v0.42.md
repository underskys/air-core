# AIR v0.42 Feature Status

Status: active planning/docs milestone

Version target: v0.42

v0.42 plans Resource Validators & ReviewPolicy Hard Gates. v0.41 completed the
Declared Fixed-Capacity Pools First Slice; v0.42 defines generic
package-check/report/reviewPolicy validation surfaces without changing AIR
language semantics, AIR ABI, Host ABI, or host authority.

AIR ABI latest remains `0.10`. Host ABI latest remains `0.11`, limited to
bounded `output.emit`; Host ABI `0.10` remains the default/baseline target for
packages that do not use `output.emit`.

Related documents:

- [AIR v0.42 Release Plan](V0_42_RELEASE_PLAN.md)
- [Resource Validators RFC](rfcs/v0.42-resource-validators.md)
- [ReviewPolicy Hard Gates RFC](rfcs/v0.42-reviewpolicy-hard-gates.md)
- [API Gates v0.42](API_GATES_v0_42.md)
- [Architecture Gates](ARCHITECTURE_GATES.md)
- [Version and ABI Policy](VERSION_AND_ABI_POLICY.md)

## Status Values

- `stable/active`: inherited behavior from earlier milestones.
- `planned/P0`: accepted v0.42 planning scope.
- `planned/P1`: accepted lower-priority planning scope.
- `deferred`: future work outside v0.42.
- `rejected`: not allowed without separate accepted scope.

## Stable / Active Baseline

| Feature | Layer | v0.42 status |
| --- | --- | --- |
| AIR ABI `0.10` | ABI | Stable/active. |
| Host ABI `0.10` | ABI | Stable/active and still supported. |
| Host ABI `0.11` bounded `output.emit` | Host ABI/package/runtime | Stable bounded first slice only. No expansion accepted for v0.42. |
| Bounded Structured IO first slice | package metadata/tooling | Stable from v0.32. |
| Readonly tablegroups first slice | AIR source/verifier/lowering | Stable from v0.37. |
| Executable Package Composition first slice | package/linking/evidence | Stable from v0.39. |
| Declared fixed-capacity pools first slice | AIR source/verifier/lowering | Stable from v0.41. |
| Consumer Evidence Corpus | evidence/tooling | Stable from v0.36. |

## v0.42 P0

| Feature | Layer | v0.42 status |
| --- | --- | --- |
| Resource validator registry design | package-check/report | Planned/P0. |
| Package-check validator hooks | package-check | Planned/P0. |
| Runtime root allowlist / forbidden root checks | package resource validation | Planned/P0. |
| Manifest reference freshness checks | manifest/package-check | Planned/P0. |
| Generated handle freshness integration | generated artifacts/package-check | Planned/P0. |
| ReviewPolicy hard gate model | reviewPolicy | Planned/P0. |
| Select-chain-as-table regression gate | reviewPolicy | Planned/P0. |
| Undeclared slot-family regression gate | reviewPolicy | Planned/P0. |
| `debug.metric` diagnostics-only guard | reviewPolicy | Planned/P0. |
| Declared-pool exceptions | reviewPolicy | Planned/P0. |
| Tablegroup/static-data exceptions | reviewPolicy | Planned/P0. |
| Trend compare baseline debt model | reviewPolicy/report | Planned/P0. |
| Report/evidence visibility | report/evidence | Planned/P0. |
| v0.42 API gates | docs/API gates | Planned/P0. |
| No language/ABI changes | release boundary | Planned/P0. |

## P1

| Feature | v0.42 status |
| --- | --- |
| PNG alpha / image quality validator | Planned/P1 if deterministic and low-risk. |
| Audio non-silence/stub validator | Planned/P1 if deterministic and low-risk. |
| Consumer evidence integration | Planned/P1. |
| LSP diagnostics | Planned/P1. |
| Repair hints | Planned/P1. |

## Deferred / Rejected

| Feature | v0.42 status |
| --- | --- |
| Demo-specific validators | Deferred. |
| Browser/Vite bundling | Deferred. |
| Asset pipeline rewrite | Deferred. |
| Full media analysis | Deferred. |
| External demo source changes | Rejected for v0.42. |
| Host ABI changes | Rejected for v0.42. |
| AIR ABI changes | Rejected for v0.42. |
| Package registry | Deferred. |
| Native installers | Deferred. |
| New language features | Rejected for v0.42. |
| Host authority | Rejected. |
| Game-specific Core APIs | Rejected. |

## Version Semantics

- Project milestone: `v0.42`.
- AIR ABI latest: remains `0.10`.
- Host ABI latest: remains `0.11`.
- Host ABI default/baseline: remains `0.10`.
- Host ABI `0.11` support remains limited to bounded `output.emit` packages.
- Host ABI expansion in v0.42: none.
- AIR ABI change in v0.42: none.
