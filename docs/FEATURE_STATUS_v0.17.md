# AIR v0.17 Feature Status

Status: active first-slice feature status

Version target: v0.17

v0.17 is the Artifact Validation & Target Bundles first-slice milestone. It
starts from v0.16 package artifacts, linked package first slice, and host
conformance first slice, then validates artifacts and emits minimal target
bundle folder outputs. It does not add Host ABI `0.11`, AIR ABI `0.11`, package
registry behavior, native installers, or game-specific APIs.

References to v0.18+ in pressure requests are candidate pressure only. They do
not define active v0.17 scope and do not imply AIR ABI or Host ABI changes.

Status values:

- `stable/active`: inherited active behavior from earlier milestones.
- `active/planned`: v0.17 P0 work, first-slice implementation, or release gate.
- `P1`: recognized optional work if scope allows.
- `deferred`: future work outside v0.17 P0.
- `rejected`: not allowed in AIR Core, stdlib, Host ABI, or package contracts.

Related documents:

- [AIR v0.17 Release Plan](V0_17_RELEASE_PLAN.md)
- [airpkg Artifact Validation RFC](rfcs/v0.17-airpkg-artifact-validation.md)
- [Target Bundle First Slice RFC](rfcs/v0.17-target-bundle-first-slice.md)
- [Event/Output Promotion Package RFC](rfcs/v0.17-event-output-promotion-package.md)
- [AIR v0.16 Feature Status](FEATURE_STATUS_v0.16.md)
- [Version and ABI Policy](VERSION_AND_ABI_POLICY.md)
- [Build-Time vs Runtime Boundary](BUILD_RUNTIME_BOUNDARY.md)
- [Target Product Model](TARGET_PRODUCT_MODEL.md)
- [Project Boundaries](PROJECT_BOUNDARIES.md)

## Stable / Active Baseline

| Feature | Layer | v0.17 status |
| --- | --- | --- |
| Package-level verify/report/check | package/tooling | Inherited. Authored package graphs remain the review source. |
| Diagnostic normalization and LSP-lite JSON | tooling/report | Inherited from v0.15. Full JSON-RPC LSP remains deferred. |
| reviewPolicy and trend baselines | package/report | Inherited from v0.15. |
| `airpkg` metadata artifact | package/artifact | Inherited active first slice from v0.16. |
| Link plan and linked WAT/Wasm first slice | package/linking | Inherited active first slice from v0.16 for simple scalar package-local graphs. |
| Host conformance/replay first slice | host/profile | Inherited active first slice from v0.16 for deterministic scalar traces. |
| Core/demo separation | repo policy | Active. Core tracks no active demo implementations. |

## Active / Planned P0

| Feature | Layer | v0.17 status |
| --- | --- | --- |
| `airpkg` artifact validation | package/artifact | Active first slice: `airc check-airpkg <file-or-dir> --json` validates schema, ABI/profile requirements, no timestamps, no absolute paths, linked output hashes, and runtime build-tool requirements. |
| package-check / check-airpkg over artifacts | package/tooling | Active first slice via `check-airpkg`. It provides deterministic artifact diagnostics without active source package traversal. |
| Target bundle first slice | product/tooling | Active first slice: `airc bundle <airpkg> --target web-dev|native-dev -o <dir>` emits folder bundles only; no native installer or production deploy semantics. |
| Bundle validation | product/tooling | Active first slice: `airc check-bundle <dir> --json` validates bundle metadata, runtime files, hashes, and build-time/runtime boundary rules. |
| Build-time/runtime boundary enforcement | package/product | Active first slice in `check-airpkg` and `check-bundle`. |
| Non-game package bundle proof | examples/release gate | Active first slice through `examples/policy_audit_package` bundle tests. |
| ABI decision gates | release policy | Planned P0. AIR ABI and Host ABI stay `0.10` unless explicit gates pass. |

## P1

| Feature | Target | v0.17 rule |
| --- | --- | --- |
| Event/output promotion package | Host ABI planning | RFC evidence plan only; no Host ABI implementation by default. |
| Output-events manifest tooling draft | manifest/tooling | Tooling draft only unless separately accepted. |
| Conformance output stream fixture | conformance/future output | Fixture planning for future output contract; no `output.emit` import. |
| Public demo/adoption planning | downstream adoption | Planning only; demos consume Core and do not define it. |
| Linked output integration improvements | package/artifact | Improve metadata/check integration without expanding runtime scope. |

## Deferred

| Feature | v0.17 status |
| --- | --- |
| Host ABI `0.11` implementation | Deferred. |
| `audio.event`, `effect.event`, or `output.emit` implementation | Deferred. |
| Full native installers / Steam packaging | Deferred. |
| Package registry | Deferred. |
| Unity/Godot adapters | Deferred. |
| Full JSON-RPC LSP server | Deferred. |
| Dynamic maps, GC, reflection, runtime imports, host object handles | Deferred/rejected from Core surface. |

## Rejected / Direct No

| Feature | Layer | v0.17 rule |
| --- | --- | --- |
| Game-specific Core APIs | AIR Core / Host ABI | Rejected. |
| Demo-specific stdlib helpers | stdlib | Rejected. |
| Active demo implementations in Core | repository | Rejected. |
| Host ABI creep for demos | Host ABI | Rejected without RFC/spec/profile/tests. |
| Runtime dependency on build tools | product/runtime | Rejected for runtime artifacts and bundles. |

## Version Semantics

- Project milestone: `v0.17`.
- AIR ABI version: remains `0.10` unless runtime/executable contract changes.
- Host ABI version: remains `0.10` unless accepted host imports or host import
  semantics change.
