# AIR v0.36 Feature Status

Status: RC hardening milestone

Version target: v0.36

v0.36 implements the first Consumer Evidence Corpus & Demo Pressure Intake
tooling slice. It standardizes how downstream demos and consumer projects submit
small, sanitized, reviewable evidence without importing demo projects into Core
and without letting demo pressure directly define Core ABI.

AIR ABI latest remains `0.10`. Host ABI latest remains `0.11`, limited to the
bounded `output.emit` first slice. Host ABI `0.10` remains the default/baseline
compatibility target for packages that do not use `output.emit`.

Related documents:

- [AIR v0.36 Release Plan](V0_36_RELEASE_PLAN.md)
- [Consumer Evidence Corpus RFC](rfcs/v0.36-consumer-evidence-corpus.md)
- [Examples, Demos, and Snapshots](EXAMPLES_AND_DEMOS.md)
- [Architecture Gates](ARCHITECTURE_GATES.md)
- [Version and ABI Policy](VERSION_AND_ABI_POLICY.md)

## Status Values

- `stable/active`: inherited behavior from earlier milestones.
- `implemented/P0`: implemented v0.36 P0 scope.
- `planned/P0`: accepted v0.36 P0 scope not implemented yet.
- `planned/P1`: accepted lower-priority v0.36 planning scope.
- `deferred`: future work outside v0.36.
- `rejected`: not allowed without separate accepted scope.

## Stable / Active Baseline

| Feature | Layer | v0.36 status |
| --- | --- | --- |
| AIR ABI `0.10` | ABI | Stable/active. |
| Host ABI `0.10` | ABI | Stable/active and still supported. |
| Host ABI `0.11` bounded `output.emit` | Host ABI/package/runtime | Stable bounded first slice only. No expansion accepted for v0.36. |
| Read-only consumer proof | example/product evidence | Stable from v0.35. |
| Review bundle and agent finish workflow | tooling/process | Stable from v0.34. |

## v0.36 P0

| Feature | Layer | v0.36 status |
| --- | --- | --- |
| `consumer_evidence/` directory structure | docs/tooling | Implemented/P0. |
| `DEMO_REGISTRY.json` schema | docs/schema | Implemented/P0. |
| Proof card schema | docs/schema | Implemented/P0. |
| Demo manifest schema | docs/schema | Implemented/P0. |
| Replay/evidence summary schema | docs/schema | Implemented/P0. |
| `check:consumer-evidence` validator | tooling | Implemented/P0. |
| Separate consumer evidence bundle | review/bundle | Implemented/P0. Separate from Core review bundle. |
| Demo-side contribution rules | process/docs | Implemented/P0. |
| Pressure routing rules | architecture/process | Implemented/P0. Routes: Core, stdlib, kit, host adapter, demo-local, rejected. |
| Seed with safe existing examples | docs/evidence | Implemented/P0. Seeded summaries only; no external demos imported. |

## v0.36 P1

| Feature | Layer | v0.36 status |
| --- | --- | --- |
| Media hash support | evidence metadata | Planned/P1. |
| Screenshot/video link metadata | evidence metadata | Planned/P1. Links/hashes only; no large media in Core. |
| Demo-generated evidence import | tooling plan | Planned/P1. |
| Trend report across consumer evidence | reporting plan | Planned/P1. |
| GitLab artifact plan | CI/review plan | Planned/P1. |
| External demo evidence ingestion | external/process plan | Planned/P1. |

## Deferred / Rejected

| Feature | v0.36 status |
| --- | --- |
| Full demo bundles in Core | Deferred/rejected. |
| Large assets | Rejected for Core corpus. |
| Browser smoke artifacts | Deferred; may be external artifacts only. |
| `node_modules` | Rejected. |
| Production host adapters | Deferred. |
| Demo-specific Core APIs | Rejected unless separately accepted through generalized RFC/gates. |
| Automatic roadmap changes from demo pressure | Rejected. |
| Raw host authority | Rejected. |
| Game-specific APIs | Rejected for Core. |
| AIR ABI change | Rejected for v0.36. |
| Host ABI change | Rejected for v0.36. |

## Version Semantics

- Project milestone: `v0.36`.
- AIR ABI latest: remains `0.10`.
- Host ABI latest: remains `0.11`.
- Host ABI default/baseline: remains `0.10`.
- Host ABI `0.11` support remains limited to bounded `output.emit` packages.
- Host ABI expansion in v0.36: none.
- AIR ABI change in v0.36: none.
