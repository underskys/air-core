# AIR v0.39 Release Plan

Status: active implementation/hardening milestone

Theme: Executable Package Composition / Authored Graph Runtime

v0.39 implements the first executable package composition slice for authored
AIR package modules while preserving authored module ownership in reports,
evidence, link plans, and linked build sidecars. The milestone is about the
package graph and deterministic linked output, not game-specific APIs, host
authority, mutable pools, or ABI expansion.

AIR ABI latest remains `0.10`.

Host ABI latest remains `0.11`, limited to bounded `output.emit`; Host ABI
`0.10` remains the default/baseline compatibility target for packages that do
not use `output.emit`.

v0.39 reuses existing module graph, link-plan, linked package, package-check,
and lowering surfaces. It must not add Host ABI imports, AIR ABI changes, Host
ABI changes, declared pools, tablegroup expansion, host authority, or external
demo source changes.

## Purpose

AIR packages can already contain authored modules and linked outputs in narrow
forms, but pressure from larger authored packages shows the need for a clearer
first-class split:

```text
authored package graph
-> package-check ownership and import validation
-> deterministic executable graph
-> report/evidence preserving authored ownership
```

The goal is to remove demo-local flattening from canonical workflows. The
executable graph may be generated, but the authored graph must remain visible
as the review surface and semantic ownership record.

## Pressure

| Source | Pressure |
| --- | --- |
| AIRON | Authored modules are currently flattened into generated `game/platformer.air`, hiding ownership and keeping the frame monolithic. |
| Consumer Evidence Corpus | Consumer proof bundles need to distinguish authored intent from generated/review artifacts. |
| Evidence reports | Human review should show which authored module owns a decision, output, tablegroup, command buffer, or structured IO surface. |
| Package diff | Reviewers need to see authored graph deltas separately from generated executable graph deltas. |

AIRON is pressure evidence only. This is generic Core/package/runtime pressure,
not a platformer API request.

## P0 Scope

| P0 item | Expected output |
| --- | --- |
| Authored graph vs executable graph | Implemented ownership metadata for authored and executable graph surfaces. |
| Linked executable package output | Implemented deterministic linked WAT/Wasm output using existing linked package path. |
| Preserve module ownership in reports/evidence | Implemented `authoredGraph`, `executableGraph`, `authoredToExecutable`, `ownershipMap`, and `linkDiagnostics` fields. |
| Package-check authored and executable graph consistency | Implemented stable package graph diagnostics for unresolved/private imports, duplicate ownership, stale executable inputs, and capability drift metadata. |
| Deterministic linked output | Tests verify stable link-plan/build output and no timestamps/absolute paths. |
| Multi-module conformance fixture | Added generic `test/fixtures/package_composition/conformance_multi_module/` fixture and replay coverage. |
| Negative tests for unresolved/private imports | Added unresolved module, unresolved symbol, and private import fixtures/tests. |
| No demo-local flattening required in generic fixture | Implemented canonical generic authored-module fixture; AIRON remains pressure evidence only. |
| API/milestone gate | Implemented `npm run check:api-gates:v0.39` to protect v0.39 boundaries during RC checks. |

## P1 Scope

- AIRON pressure fixture using authored modules;
- source map from executable output to authored module;
- LSP package graph ownership view;
- package diff authored/executable graph deltas.

## Deferred

- package registry;
- native installer;
- demo-specific bundlers;
- browser/Vite host bundling;
- asset pipeline rewrite;
- Host ABI changes;
- AIR ABI changes unless executable contract requires it;
- declared pools;
- tablegroup expansion;
- mutable package runtime;
- real host adapters.

## Hard Constraints

- not game-specific;
- no host authority;
- no new Host ABI imports;
- no AIR ABI change unless a separate ABI review accepts a new executable
  contract;
- generated executable graph must be deterministic;
- reports and evidence must keep authored ownership visible;
- no silent flattening in the canonical package path;
- generated artifacts remain derived and cannot become semantic source of
  truth;
- external demo source code is not imported into Core.

## Acceptance Criteria

v0.39 implementation/hardening can close when:

- authored graph and executable graph terminology is documented and emitted;
- linked executable package output is deterministic;
- report/evidence ownership obligations are implemented;
- package-check consistency obligations have stable diagnostics;
- deterministic linked output constraints are tested;
- multi-module fixture proves authored modules can produce executable output;
- negative unresolved/private import cases are tested;
- ABI impact is explicitly unchanged for the implemented first slice.

## Links

- [Feature Status v0.39](FEATURE_STATUS_v0.39.md)
- [Executable Package Composition RFC](rfcs/v0.39-executable-package-composition.md)
- [API Gates v0.39](API_GATES_v0_39.md)
- [Consumer Evidence Corpus](../consumer_evidence/README.md)
- [Architecture Gates](ARCHITECTURE_GATES.md)
- [Version and ABI Policy](VERSION_AND_ABI_POLICY.md)
