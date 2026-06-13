# AIR v0.15 Feature Status

Status: authoritative active feature status

Version target: v0.15

v0.15 is the Diagnostics, Anti-Slop, and LSP-lite release. The milestone keeps
AIR focused on machine-readable diagnostics, package review gates, request
intake discipline, and editor/AI repair loops without changing AIR ABI, Host
ABI, stdlib authority, or Core language semantics for demos.

Status values:

- `stable/active`: accepted v0.15 behavior with implementation and tests.
- `minimal/partial`: implemented as a narrow first slice; do not assume a full
  product or editor contract.
- `RFC/deferred`: design or future work, not v0.15 P0 implementation.
- `rejected`: not allowed in AIR Core, stdlib, public Host ABI, or package
  contracts for v0.15.

Related documents:

- [AIR v0.15 Release Plan](V0_15_RELEASE_PLAN.md)
- [Diagnostic Code Registry RFC](rfcs/v0.15-diagnostic-code-registry.md)
- [LSP-lite Diagnostics RFC](rfcs/v0.15-lsp-lite-diagnostics.md)
- [Review Trend Baselines RFC](rfcs/v0.15-review-trend-baseline.md)
- [Review Policy Profiles](review-policy-profiles.md)
- [Version and ABI Policy](VERSION_AND_ABI_POLICY.md)
- [Project Boundaries](PROJECT_BOUNDARIES.md)

## Stable / Active

| Feature | Layer | v0.15 status |
| --- | --- | --- |
| Diagnostic normalization | tooling/report | Active. Diagnostics can use stable `air.<domain>.<name>` codes while preserving legacy identifiers where needed. |
| LSP-lite JSON diagnostics | CLI/tooling | Active first slice. `airc check <file-or-package> --lsp-json` emits deterministic parser, verifier, package, generated, manifest, and review diagnostics. |
| Package-level AI review | package/report | Active. Package reports aggregate review diagnostics across authored module graphs, including non-entry modules. |
| reviewPolicy schema maturity | package/report | Active. Policies support schema versioning, code-based gates, legacy gate aliases, path-class precedence, and review-only waivers. |
| Review trend baselines | report/tooling | Active first slice. Package reports can emit deterministic baselines and compare local metrics without remote telemetry. |
| Review policy profiles | docs/tooling | Active as recommended presets. Profiles are guidance, not global defaults. |
| Request intake governance | process/docs | Active. `/requests` keeps a minimal Core skeleton and the `core/requests` branch can carry detailed triage without making inbox items release scope. |

## Minimal / Partial

| Feature | Layer | v0.15 status |
| --- | --- | --- |
| Editor integration | tooling | Minimal. LSP-lite JSON supports editor adapters, but no full JSON-RPC LSP server is implemented. |
| Trend gates | report/tooling | Minimal. Deterministic comparison exists for first metrics; richer history and policy profiles remain incremental. |
| Diagnostic range coverage | parser/verifier/report | Partial. File/range data is present where available; package-level diagnostics may omit source ranges. |
| Request checker | process/tooling | Optional. Request intake may be validated by a lightweight checker, but requests remain governance documents, not Core semantics. |

## RFC / Deferred

| Feature | Target | v0.15 rule |
| --- | --- | --- |
| Linked executable package build | future runtime/package work | Deferred. v0.15 keeps `linkedWasm: false` for graph/source checks. |
| Event/output ABI | possible Host ABI 0.11 | Deferred. No `audio.event`, `effect.event`, or generic output event Host ABI is promoted in v0.15. |
| Fixed pools / bounded mutable state | RFC | Deferred. Explore bounded patterns without ECS, dynamic allocation, maps, or GC. |
| Target product bundles | future product tooling | Deferred. No `airpkg` product bundler is implemented in v0.15. |
| Full LSP server | future tooling | Deferred. v0.15 provides deterministic CLI JSON only. |
| Unity/Godot/native adapters | future host work | Deferred. Not Core and not v0.15 release scope. |
| Package registry | future package work | Deferred. No registry imports or dependency resolution. |

## Rejected In v0.15

| Feature | Layer | v0.15 rule |
| --- | --- | --- |
| Game-specific Core APIs | AIR Core / Host ABI | Rejected. Do not add `draw_actor`, `draw_contra_enemy`, platformer water APIs, Doom helpers, or demo vocabulary. |
| Demo-specific stdlib helpers | stdlib | Rejected. Stdlib remains pure, deterministic, domain-neutral, and host-authority-free. |
| Host ABI creep for demos | Host ABI | Rejected. Demo pressure must become RFC/spec/profile/tests before any Host ABI change. |
| `debug.metric` as event bus | Host ABI / reports | Rejected. It remains diagnostics-only. |
| Dynamic maps, GC, reflection | AIR Core/runtime | Rejected. |
| Runtime imports / remote imports | package/runtime | Rejected. |
| Host object handles | AIR Core / Host ABI | Rejected. AIR must not expose platform objects. |
| `std.gfx3d`, `std.scene`, `std.voxel` | stdlib | Rejected as stdlib. Use kits or project-local files when appropriate. |
| `audio.event`, `effect.event`, `gfx.draw_sprite_transform` | Host ABI / GFX ABI | Rejected as usable public imports in v0.15; future promotion requires RFC/spec/profile/tests. |

## Version Semantics

- Project milestone: `v0.15`.
- Compiler/package version: governed by package release policy.
- AIR ABI version: remains `0.10` unless runtime/executable contract changes.
- Host ABI version: remains `0.10` unless accepted host imports or host import
  semantics change.

v0.15 changes diagnostics, reporting, review policy, and request governance. It
does not promote a new public Host ABI surface or linked executable package
runtime contract.
