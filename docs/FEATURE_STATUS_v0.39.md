# AIR v0.39 Feature Status

Status: active implementation/hardening milestone

Version target: v0.39

v0.39 implements the Executable Package Composition / Authored Graph Runtime
first slice. Authored AIR package modules can produce deterministic linked
package output while reports, link plans, linked build sidecars, and evidence
preserve authored ownership. The slice reuses existing module graph, link-plan,
linked package, package-check, and lowering surfaces.

AIR ABI latest remains `0.10`. Host ABI latest remains `0.11`, limited to the
bounded `output.emit` first slice. Host ABI `0.10` remains the default/baseline
compatibility target for packages that do not use `output.emit`.

Related documents:

- [AIR v0.39 Release Plan](V0_39_RELEASE_PLAN.md)
- [Executable Package Composition RFC](rfcs/v0.39-executable-package-composition.md)
- [API Gates v0.39](API_GATES_v0_39.md)
- [Architecture Gates](ARCHITECTURE_GATES.md)
- [Version and ABI Policy](VERSION_AND_ABI_POLICY.md)

## Status Values

- `stable/active`: inherited behavior from earlier milestones.
- `implemented/P0`: implemented v0.39 P0 scope.
- `planned/P0`: accepted v0.39 P0 scope not yet implemented.
- `planned/P1`: accepted lower-priority v0.39 planning scope.
- `deferred`: future work outside v0.39.
- `rejected`: not allowed without separate accepted scope.

## Stable / Active Baseline

| Feature | Layer | v0.39 status |
| --- | --- | --- |
| AIR ABI `0.10` | ABI | Stable/active. |
| Host ABI `0.10` | ABI | Stable/active and still supported. |
| Host ABI `0.11` bounded `output.emit` | Host ABI/package/runtime | Stable bounded first slice only. No expansion accepted for v0.39. |
| Bounded Structured IO first slice | package metadata/tooling | Stable from v0.32. |
| AI authoring eval replay/import tooling | eval/tooling | Stable from v0.33/v0.38. |
| Consumer Evidence Corpus | evidence/process | Stable from v0.36. |
| Readonly tablegroups first slice | AIR source/verifier/lowering | Stable from v0.37. No expansion accepted for v0.39. |
| E2E execution proof first slice | execution/evidence | Stable from v0.38. |

## v0.39 P0

| Feature | Layer | v0.39 status |
| --- | --- | --- |
| Authored graph vs executable graph | package model | Implemented/P0: link plans, linked build sidecars, package reports, and verification evidence expose `authoredGraph`, `executableGraph`, `authoredToExecutable`, and `ownershipMap`. |
| Linked executable package output | package/linking | Implemented/P0: `airc build package <dir> --linked-wasm` emits deterministic linked WAT/Wasm plus sidecar metadata. |
| Preserve module ownership in reports/evidence | reports/evidence | Implemented/P0: reports and verification evidence preserve authored module ownership for symbols, imports, capabilities, effects, tablegroups, structured IO, and diagnostics. |
| Package-check authored and executable graph consistency | package-check | Implemented/P0: package graph diagnostics cover unresolved modules, unresolved symbols, private symbol imports, duplicate public export ownership, stale executable inputs, and capability drift metadata. |
| Deterministic linked output | linking/review bundle | Implemented/P0: link-plan and linked package tests verify deterministic output and no timestamps/absolute paths. |
| Multi-module conformance fixture | conformance/tests | Implemented/P0: `test/fixtures/package_composition/conformance_multi_module/` proves linked multi-module execution through conformance replay. |
| Negative tests for unresolved/private imports | diagnostics/tests | Implemented/P0: package composition fixtures cover unresolved module, unresolved symbol, and private import diagnostics. |
| No demo-local flattening required in generic fixture | examples/conformance | Implemented/P0: the canonical fixture uses authored modules directly and does not depend on AIRON/demo flattening. |
| v0.39 API/milestone gate | release gates | Implemented/P0: `npm run check:api-gates:v0.39` protects package composition boundaries and runs during RC checks. |

## v0.39 P1

| Feature | Layer | v0.39 status |
| --- | --- | --- |
| AIRON pressure fixture using authored modules | consumer pressure | Planned/P1. |
| Source map from executable output to authored module | reporting/tooling | Planned/P1. |
| LSP package graph ownership view | LSP/tooling | Planned/P1. |
| Package diff authored/executable graph deltas | diff/evidence | Planned/P1. |

## Deferred / Rejected

| Feature | v0.39 status |
| --- | --- |
| Package registry | Deferred. |
| Native installer | Deferred. |
| Demo-specific bundlers | Deferred/rejected for Core. |
| Browser/Vite host bundling | Deferred/rejected for Core. |
| Asset pipeline rewrite | Deferred. |
| Host ABI change | Rejected for v0.39. |
| AIR ABI change | Rejected unless separate ABI review accepts a required executable contract change. |
| Declared mutable pools | Deferred and PRO-gated. |
| Tablegroup expansion | Deferred. |
| Game-specific APIs | Rejected for Core. |
| Host authority | Rejected. |
| External demo source changes | Rejected for v0.39. |

## Version Semantics

- Project milestone: `v0.39`.
- AIR ABI latest: remains `0.10`.
- Host ABI latest: remains `0.11`.
- Host ABI default/baseline: remains `0.10`.
- Host ABI `0.11` support remains limited to bounded `output.emit` packages.
- Host ABI expansion in v0.39: none.
- AIR ABI change in v0.39: none.
