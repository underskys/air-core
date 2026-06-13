# AIR v0.16 Feature Status

Status: authoritative active feature status

Version target: v0.16

v0.16 is the Package Artifacts & Host Conformance first-slice release. The
milestone starts from v0.15 diagnostics/LSP-lite and implements narrow
metadata-only package artifact, deterministic package link/build, and
deterministic conformance/replay slices while keeping target bundles and
event/output Host ABI work deferred.

Status values:

- `stable/active`: inherited active behavior from earlier milestones.
- `first-slice/P0`: v0.16 implementation slice or required release gate.
- `RFC/deferred`: recognized future work, not active implementation.
- `rejected`: not allowed in AIR Core, stdlib, Host ABI, or package contracts.

Related documents:

- [AIR v0.16 Release Plan](V0_16_RELEASE_PLAN.md)
- [airpkg Artifact RFC](rfcs/v0.16-airpkg-artifact.md)
- [Linked Executable Package Build RFC](rfcs/v0.16-linked-executable-package-build.md)
- [Target Bundles RFC](rfcs/v0.16-target-bundles.md)
- [Host Conformance Replay RFC](rfcs/v0.16-host-conformance-replay.md)
- [Event/Output Contract RFC](rfcs/v0.16-event-output-contract.md)
- [Version and ABI Policy](VERSION_AND_ABI_POLICY.md)
- [Build-Time vs Runtime Boundary](BUILD_RUNTIME_BOUNDARY.md)
- [Target Product Model](TARGET_PRODUCT_MODEL.md)
- [Project Boundaries](PROJECT_BOUNDARIES.md)

## Stable / Active Baseline

| Feature | Layer | v0.16 status |
| --- | --- | --- |
| Package-level verify/report/check | package/tooling | Inherited from v0.14/v0.15; authored module graphs remain the review source. |
| Diagnostic normalization | tooling/report | Active from v0.15. |
| LSP-lite JSON diagnostics | CLI/tooling | Active first slice from v0.15; full JSON-RPC LSP remains deferred. |
| reviewPolicy and trend baselines | package/report | Active first slice from v0.15. |
| Core/demo separation | repo policy | Active. Core tracks no active demo implementations. |

## First-Slice / P0

| Feature | Layer | v0.16 status |
| --- | --- | --- |
| `airpkg` artifact contract | package/artifact | Active first slice: deterministic metadata-only JSON artifact with link-plan metadata and optional linked output fingerprint. Compressed archives, embedded resources, target bundles, native apps, web deploys, and Steam-ready packages are deferred. |
| `airpkg` inspect/check path | package/artifact | Active first slice: `airc package` writes metadata and `airc inspect-airpkg` reads it, including linked output status. |
| Link plan | package/linking | Active first slice: `airc link-plan` emits deterministic metadata for linked package builds. |
| Linked WAT/Wasm for simple packages | package/linking | Active first slice: `airc build package <dir> --linked-wasm -o <output.wasm>` emits deterministic linked WAT/Wasm for simple scalar package-local module graphs plus sidecar report. |
| Build-time vs runtime boundary | package/product | Active policy plus first-slice `airpkg` metadata. Runtime tool requirements remain empty unless explicitly declared by a future contract. |
| Host conformance / replay | host/profile | Active first slice: deterministic JSON trace replay for exported scalar function results; browser/GPU and visual comparison remain deferred. |
| Event/output contract | Host ABI planning | RFC continuation only; no Host ABI implementation. |
| ABI decision gates | release policy | P0. AIR ABI/Host ABI stay `0.10` unless an accepted contract change lands. |

## RFC / Deferred

| Feature | Target | v0.16 rule |
| --- | --- | --- |
| Target bundle model / web/native-dev folder bundles | P1/prototype | May be explored only after target bundle RFC. |
| `airpkg` package-check integration | P1/tooling | First slice reuses package-check/report summaries; richer artifact-specific checks remain candidate work. |
| Rich linked executable package contract | P1/linking | Deferred. First slice emits simple linked WAT/Wasm but does not define a new stable runtime package contract or ABI. |
| Event/output Host ABI | future Host ABI candidate | Deferred until accepted RFC/spec/profile/tests. |
| Full native installers / Steam packaging | future product work | Deferred. |
| Package registry | future package work | Deferred. |
| Unity/Godot adapters | future host work | Deferred. |
| Full JSON-RPC LSP server | future tooling | Deferred. |

## Rejected In v0.16

| Feature | Layer | v0.16 rule |
| --- | --- | --- |
| Game-specific Core APIs | AIR Core / Host ABI | Rejected. |
| Demo-specific stdlib helpers | stdlib | Rejected. |
| Active demo implementations in Core | repository | Rejected. Demos live in downstream repos/branches. |
| Host ABI creep for demos | Host ABI | Rejected without RFC/spec/profile/tests. |
| Dynamic maps, GC, reflection | AIR Core/runtime | Rejected. |
| Runtime imports / remote imports | package/runtime | Rejected. |
| Host object handles | AIR Core / Host ABI | Rejected. |

## Version Semantics

- Project milestone: `v0.16`.
- Compiler/package version: governed by package release policy.
- AIR ABI version: remains `0.10` unless runtime/executable contract changes.
- Host ABI version: remains `0.10` unless accepted host imports or host import
  semantics change.
