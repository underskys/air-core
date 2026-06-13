# AIR v0.21 Feature Status

Status: active planning milestone

Version target: v0.21

v0.21 is the API Rebaseline & Host Interaction Contract milestone. It builds on
v0.20 verification evidence, bounded rowset schema metadata, command buffer
output intents, and batch conformance fixtures.

v0.21 must not add Host ABI `0.11`, AIR ABI `0.11`,
`output.emit`/`output.event`/`audio.event`/`effect.event`, raw `chrome.*`,
DOM/React/IndexedDB/Jira/fetch authority, secrets/tokens/private text/raw URL
authority, arbitrary JSON runtime values inside AIR, dynamic maps, GC,
reflection, host object handles, promises, callbacks, async/await, runtime
imports, package registry behavior, native installers, tablegroups
implementation, broad demo rewrite, game-specific Core APIs, full `u8`/`u16`
SSA arithmetic, or silent truncation.

Status values:

- `stable/active`: inherited active behavior from earlier milestones.
- `active/planned`: v0.21 P0 planning target.
- `P1`: optional work if scope allows and RFC gates pass.
- `deferred`: future work outside v0.21 P0.
- `rejected`: not allowed in AIR Core, stdlib, Host ABI, package contracts, or
  host profiles.

Related documents:

- [AIR v0.21 Release Plan](V0_21_RELEASE_PLAN.md)
- [API Surface v0.21](API_SURFACE_v0_21.md)
- [API Gates v0.21](API_GATES_v0_21.md)
- [Roadmap Truth v0.21](ROADMAP_TRUTH_v0_21.md)
- [AIR v0.20 Feature Status](FEATURE_STATUS_v0.20.md)
- [AIR v0.20 Release Plan](V0_20_RELEASE_PLAN.md)
- [Bounded Rowsets RFC](rfcs/v0.20-bounded-rowsets.md)
- [Batch Conformance Fixtures RFC](rfcs/v0.20-batch-conformance-fixtures.md)
- [Command Buffer Output Intents RFC](rfcs/v0.20-command-buffer-output-intents.md)
- [Output Contract Manifest Tooling RFC](rfcs/v0.18-output-events-manifest.md)
- [Version and ABI Policy](VERSION_AND_ABI_POLICY.md)

## Stable / Active Baseline

| Feature | Layer | v0.21 status |
| --- | --- | --- |
| Diagnostic normalization and LSP-lite JSON | tooling/report | Active from v0.15 through `airc check <file-or-package> --lsp-json`. |
| Diagnostics-only Full LSP MVP | tooling | Inherited active first slice from v0.19 through `airc lsp --stdio`; no IDE feature expansion in this planning task. |
| `airpkg` metadata artifact | package/artifact | Inherited active first slice from v0.16. |
| Link plan and linked WAT/Wasm first slice | package/linking | Inherited active first slice from v0.16 for simple scalar package-local graphs. |
| Host conformance/replay first slice | host/profile | Inherited active first slice from v0.16 for deterministic scalar traces. |
| `check-airpkg` | package/artifact | Inherited active first slice from v0.17. |
| `bundle` and `check-bundle` | product/tooling | Inherited active first slice from v0.17 for `web-dev` and `native-dev` folder bundles. |
| Bounded facts schema validator | package/check/report | Inherited active first slice from v0.18 through package-local `factSchemas`. |
| Output Contract manifest validator | package/check/report | Inherited active first slice from v0.18 through package-local `outputContracts`; tooling-only, no runtime emit. |
| Compact storage first slice | storage/layout | Implemented in v0.19 as packed static tables only. Static tables may use `u8`, `u16`, and `i16`; compact table reads return `i32`. No compact scalar arithmetic, load/store ops, buffers, or tablegroups. |
| Verification evidence JSON | release/package evidence | Inherited active first slice from v0.20 through `airc verify package <dir> --json`. |
| Bounded rowset schema metadata | package/check/report/evidence | Inherited active first slice from v0.20 through `factSchemas` with `kind: "air.boundedRowsetSchema"`. |
| Command/result buffer output intents | package/check/report/conformance | Inherited active first slice from v0.20 through package-local `commandBuffers`; no runtime `output.emit`. |
| Batch conformance pressure fixtures | conformance/fixtures | Inherited active first slice from v0.20 for FlowDesk-style and AirOps-style pressure. |
| Core/demo separation | repo policy | Active. Core tracks no active demo implementations. |

## Active / Planned P0

| Feature | Layer | v0.21 status |
| --- | --- | --- |
| API surface inventory | docs/release | Active P0 through [API Surface v0.21](API_SURFACE_v0_21.md). |
| Anti-slop/API gates first slice | reviewPolicy/release gates | Active P0 first slice. `check:api-gates:v0.21` runs as part of Core RC/review checks and performs a conservative low-noise scan for strong forbidden patterns while preserving legacy compatibility. |
| Deprecation and migration plan | docs/tooling | Active planning target. Expose API debt without deleting legacy surfaces immediately. |
| Canonical v0.21 API contract | package/check/report/conformance | Active planning target. Canonical path is bounded facts/rowsets, Output Contracts, command buffers, verification evidence, deterministic conformance, diagnostics, and LSP. |
| Compatibility strategy | release policy | Active planning target. Stable and legacy surfaces remain supported until specific migration gates and tests exist. |
| Release gate updates for canonical vs legacy examples | CI/review | Active planning target. Plan gates that distinguish canonical examples from legacy examples without rewriting demos in this task. |

## P1

| Feature | Target | v0.21 rule |
| --- | --- | --- |
| AirOps-style incident diagnostic canonical example | examples/package fixtures | Active P1 first promoted example at `examples/airops_incident_package`; synthetic, scalar-only, command-buffer based, and authority-free. |
| FlowDesk-style policy/recommendation canonical example | examples/package fixtures | P1 migration target only. |
| Benchmark suite | performance/release evidence | P1/future. Required before performance acceleration claims can be advertised as measured release facts. |
| LSP diagnostics for deprecated API usage | tooling | P1 after deprecation categories are stable. |
| Generated rowset handles | tooling/package | P1 only after API inventory and migration plan. |
| Generated output contract handles | tooling/package | P1 only after API inventory and migration plan. |
| `extension-basic` experimental kit | host profile / kit | P1 only; host-owned Chrome Extension pressure without raw `chrome.*` authority in AIR. |
| AirOps/FlowDesk non-game examples | package evidence | P1 proof packages only; no demos or host authority. |
| Fixed Bounded State Segment pressure request | architecture intake | Future v0.22+ pressure evidence only. No parser, verifier, lowering, AIR ABI, Host ABI, compact state, tablegroup, or host authority change in v0.21. |

## Deferred

| Feature | v0.21 status |
| --- | --- |
| Host ABI `0.11` | Deferred. |
| AIR ABI `0.11` | Deferred. |
| `output.emit` / `output.event` / `audio.event` / `effect.event` | Candidate/deferred behind the event/output promotion gate. No Host ABI import in v0.21. |
| Raw `chrome.*` | Rejected/deferred from Core surface. |
| DOM / React / IndexedDB / Jira / fetch authority in AIR | Rejected. |
| Secrets, tokens, private text, or raw URL authority in AIR | Rejected. |
| Host object handles | Rejected. |
| Arbitrary JSON runtime values inside AIR | Rejected. |
| Dynamic maps | Rejected. |
| GC | Rejected. |
| Reflection | Rejected. |
| Promises / callbacks / async-await in AIR | Rejected. |
| Runtime imports | Rejected. |
| Package registry | Deferred. |
| Native installers | Deferred. |
| Tablegroups implementation | RFC/deferred. No v0.21 implementation. |
| Compiler optimizer passes | Deferred. Current release has foundations and diagnostics, not optimizer passes or measured acceleration claims. |
| Broad demo rewrite | Deferred. |
| Game-specific Core APIs | Rejected. |
| Full `u8`/`u16` SSA arithmetic | Deferred. |
| Silent truncation | Rejected. |

## Rejected / Direct No

| Feature | Layer | v0.21 rule |
| --- | --- | --- |
| More AIR authority as a shortcut for host facts | AIR Core / Host ABI | Rejected. Hosts own raw state and authority; AIR receives minimized bounded facts. |
| Dynamic object model for rowsets | AIR Core | Rejected. Rowsets are bounded metadata and scalar contracts, not runtime objects. |
| Automatic host-side action execution from command intents | Host ABI | Rejected in P0. Output intents remain reviewable metadata/conformance surface until a separate Host ABI promotion is accepted. |
| Browser-specific Core semantics | AIR Core | Rejected. Chrome Extension pressure belongs in host profile/kit design, not Core semantics. |
| Demo-local APIs as Core APIs | AIR Core / stdlib / Host ABI | Rejected. Demo-specific surfaces must remain outside Core. |

## Version Semantics

- Project milestone: `v0.21`.
- AIR ABI version: remains `0.10` unless runtime/executable contract changes.
- Host ABI version: remains `0.10` unless accepted host imports or host import
  semantics change.
- Package/tooling version remains separate from project milestone version.
