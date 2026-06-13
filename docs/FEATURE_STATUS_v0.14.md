# AIR v0.14 Feature Status

Status: authoritative active feature status

Version target: v0.14

v0.14 is the Executable Package Composition & AIR-authored Data release. This
file is the active status source for v0.14 Core work. The milestone keeps AIR
focused on authored package graphs, deterministic data, generated artifact
hygiene, reviewPolicy budgets, and resource/manifest consistency without
expanding Host ABI or stdlib for demos.

Status values:

- `stable/active`: accepted v0.14 behavior with implementation and tests.
- `minimal/partial`: implemented only for the current narrow schema or report
  slice; do not assume a complete contract.
- `RFC/deferred`: design or future work, not v0.14 P0 implementation.
- `rejected`: not allowed in AIR Core, stdlib, public Host ABI, or package
  contracts for v0.14.

Related documents:

- [AIR v0.14 Release Plan](V0_14_RELEASE_PLAN.md)
- [AIR v0.14 Architecture Request](V0_14_ARCHITECTURE_REQUEST.md)
- [Version and ABI Policy](VERSION_AND_ABI_POLICY.md)
- [Project Boundaries](PROJECT_BOUNDARIES.md)
- [Target Product Model](TARGET_PRODUCT_MODEL.md)

## Stable / Active

| Feature | Layer | v0.14 status |
| --- | --- | --- |
| Package-level verify/report/check over authored graph | package/tooling | Active. `verify package`, `report package`, and `package-check` operate on the authored package module graph. |
| Package-local module graph validation | package/tooling | Active. Relative package-local imports, package-root safety, duplicate alias rejection, cycle rejection, and exported/private boundaries are checked. |
| Package/report ownership metadata | report/tooling | Active. Reports include modules, graph edges, functions, exports/private functions, globals, static tables, capabilities, host imports, and generated artifact status where available. |
| Constants | AIR Core | Active scalar compile-time constants. No runtime storage is introduced. |
| Static readonly scalar tables | AIR Core | Active first slice: scalar, fixed-length, literal data with deterministic `table.get`; no mutation, dynamic arrays, maps, records, or GC. |
| Generated handle/module freshness checks | package/tooling | Active. Generated handle modules and declared generated modules are deterministic derived artifacts and can be reported as missing/stale. |
| reviewPolicy minimal gates | package/report | Active. Packages can configure selected AI-review warnings as warnings or failures without hardcoded global thresholds. |
| Non-game package example | examples | Active. `examples/policy_audit_package` demonstrates package modules, static data, package-check/report, and reviewPolicy without host rendering or game concepts. |
| ABI/version policy | docs/release | Active. v0.14 does not automatically bump AIR ABI, Host ABI, package schema, report schema, or manifest schema versions. |

## Minimal / Partial

| Feature | Layer | v0.14 status |
| --- | --- | --- |
| Manifest/resource consistency | package-check/assets | Minimal. Runtime resource paths, forbidden candidate/quarantine/tmp references, and schema-known manifest references are checked where current schemas allow. |
| AIR semantic ID to manifest ID consistency | package-check/assets | Partial. Generated handles and manifest references are checked where existing schemas expose IDs. A full semantic ID contract remains deferred. |
| Package-level report polish | report/tooling | Partial. Deterministic JSON exists, but output shape may still be refined before a stable report schema version. |
| Linked Wasm status reporting | report/tooling | Minimal. Reports expose `linkedWasm: false` and warnings for multi-module source graphs; linked output is not implemented. |

## RFC / Deferred

| Feature | Target | v0.14 rule |
| --- | --- | --- |
| Linked executable package build | v0.15+ candidate | Deferred. v0.14 validates/reports authored graphs but does not implement stable linked multi-module Wasm. |
| Event/output ABI | RFC / possible Host ABI 0.11 | Deferred. No `audio.event`, `effect.event`, or generic output event Host ABI is promoted in v0.14. |
| Fixed pools / bounded mutable state | RFC | Deferred. Explore bounded patterns without dynamic allocation, ECS, maps, or GC. |
| Target product bundle | v0.15+ candidate | Deferred. v0.14 documents the product model; product bundling is not implemented. |
| Full LSP | future tooling | Deferred. Machine-readable diagnostics help later editor support, but full LSP is not a v0.14 gate. |
| Unity/Godot adapters | future host work | Deferred. Not Core and not part of v0.14 release gates. |
| Package registry | future package work | Deferred. No registry imports or dependency resolution in v0.14. |

## Rejected In v0.14

| Feature | Layer | v0.14 rule |
| --- | --- | --- |
| Game-specific Core APIs | AIR Core / Host ABI | Rejected. Do not add `draw_actor`, `draw_contra_enemy`, platformer water APIs, or demo vocabulary. |
| Demo-specific stdlib helpers | stdlib | Rejected. Stdlib stays pure, deterministic, domain-neutral, and host-authority-free. |
| `debug.metric` as event bus | Host ABI / reports | Rejected. `debug.metric` is diagnostic only. |
| Dynamic maps | AIR Core | Rejected. |
| GC | AIR Core/runtime | Rejected. |
| Reflection | AIR Core/runtime | Rejected. |
| Runtime imports / dynamic imports | AIR Core/package | Rejected. |
| Remote imports | package/tooling | Rejected. |
| Host object handles | AIR Core / Host ABI | Rejected. AIR must not expose DOM, Canvas, WebAudio, WebGPU, Metal, Vulkan, sockets, files, processes, or renderer objects. |
| `std.gfx3d`, `std.scene`, `std.voxel` | stdlib | Rejected as stdlib. Use kits or project-local files when appropriate. |
| `audio.event`, `effect.event`, `gfx.draw_sprite_transform` | Host ABI / GFX ABI | Rejected as usable public imports in v0.14; future promotion requires RFC/spec/profile/tests. |

## Version Semantics

- Project milestone: `v0.14`.
- Compiler/package version: remains governed by package release policy.
- AIR ABI version: remains `0.10` unless runtime/executable contract changes.
- Host ABI version: remains `0.10` unless accepted host imports or host import
  semantics change.

v0.14 changes package/report/check behavior and Core data/report hygiene. It
does not promote a new public Host ABI surface or linked executable package
runtime contract.
