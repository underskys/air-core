# AIR v0.18 Feature Status

Status: first-slice implementation

Version target: v0.18

v0.18 is the Bounded Facts & Output Contract Readiness milestone. It builds on
v0.17 artifact validation and target bundles. The current active first slice is
bounded facts schema validation through package metadata, package-check, and
report output. It does not implement tablegroups, event/output Host ABI, Host
ABI `0.11`, AIR ABI `0.11`, raw browser authority, package registry behavior,
native installers, or game-specific APIs.

Status values:

- `stable/active`: inherited active behavior from earlier milestones.
- `active/planned`: v0.18 P0 planning, RFC, audit, or release gate.
- `P1`: optional work if scope allows and RFC gates pass.
- `deferred`: future work outside v0.18 P0.
- `rejected`: not allowed in AIR Core, stdlib, Host ABI, package contracts, or
  host profiles.

Related documents:

- [AIR v0.18 Release Plan](V0_18_RELEASE_PLAN.md)
- [Bounded Structured Facts RFC](rfcs/v0.18-bounded-structured-facts.md)
- [Compact Storage Types RFC](rfcs/v0.18-compact-storage-types.md)
- [Output Contract Manifest Tooling RFC](rfcs/v0.18-output-events-manifest.md)
- [Chrome Extension Host Profile Pressure RFC](rfcs/v0.18-chrome-extension-host-profile.md)
- [FlowDesk Air Pressure Request](abi-requests/flowdesk-air.md)
- [AIR v0.17 Feature Status](FEATURE_STATUS_v0.17.md)
- [AIR v0.17 Release Plan](V0_17_RELEASE_PLAN.md)
- [Event/Output Promotion Package RFC](rfcs/v0.17-event-output-promotion-package.md)
- [Version and ABI Policy](VERSION_AND_ABI_POLICY.md)
- [Build-Time vs Runtime Boundary](BUILD_RUNTIME_BOUNDARY.md)
- [Project Boundaries](PROJECT_BOUNDARIES.md)

## Stable / Active Baseline

| Feature | Layer | v0.18 status |
| --- | --- | --- |
| Diagnostic normalization and LSP-lite JSON | tooling/report | Active from v0.15 through `airc check <file-or-package> --lsp-json`; v0.18 bounded facts and Output Contract diagnostics must remain compatible with this envelope. |
| reviewPolicy and trend baselines | package/report | Inherited from v0.15. |
| `airpkg` metadata artifact | package/artifact | Inherited active first slice from v0.16. |
| Link plan and linked WAT/Wasm first slice | package/linking | Inherited active first slice from v0.16 for simple scalar package-local graphs. |
| Host conformance/replay first slice | host/profile | Inherited active first slice from v0.16 for deterministic scalar traces. |
| `check-airpkg` | package/artifact | Inherited active first slice from v0.17. |
| `bundle` and `check-bundle` | product/tooling | Inherited active first slice from v0.17 for `web-dev` and `native-dev` folder bundles. |
| Core/demo separation | repo policy | Active. Core tracks no active demo implementations. |

## Active / Planned P0

| Feature | Layer | v0.18 status |
| --- | --- | --- |
| Request and ABI pressure triage | planning/governance | Planned P0. Triage `docs/abi-requests/` and `requests/` before accepting new scope. |
| Bounded facts schema validator | package/check/report | Active first slice. `air.package.json` may reference package-local `factSchemas`; package-check validates fixed-size scalar schemas and reports schema metadata/fingerprints. |
| Bounded facts privacy boundary | package/check/report/host policy | Active P0 boundary. Schemas carry privacy metadata; reports surface classifications, not raw task text, URLs, tokens, secrets, notes, or browser state. |
| Bounded structured facts RFC | Core/package design | Active RFC. Static schemas, bounded fact snapshots, fixed-size scalar tables, generated handles, package-checked data contracts, report visibility, privacy boundaries, and conformance compatibility. |
| Output Contract manifest validator | package/check/report | Active first slice. `air.package.json` may reference package-local `outputContracts`; package-check validates tooling-only output intents and reports fingerprints, channels, capabilities, and diagnostics. No runtime emit. |
| Output Contract manifest tooling RFC | manifest/tooling | Active RFC. Manifest-backed IDs, channels, capabilities, scalar arg schemas, missing/unused ID checks when usage data exists, and profile compatibility planning. Generated handles remain P1. |
| Event/output Host ABI promotion package | Host ABI readiness | Planned P0 evidence package only. Host ABI `0.11` remains deferred unless separately accepted. |
| `debug.metric` boundary coverage audit | reviewPolicy/report | Planned P0. `debug.metric` remains diagnostics-only; event-like usage remains an anti-slop diagnostic. |
| ABI decision gates | release policy | Planned P0. AIR ABI and Host ABI stay `0.10` unless explicit gates pass. |
| FlowDesk / Chrome Extension pressure classification | pressure/RFC | Planned P0. RFC candidate only, not implementation and not Core authority. |

## P1

| Feature | Target | v0.18 rule |
| --- | --- | --- |
| Tablegroups first slice | bounded facts | RFC/P1 only. Not implemented in the bounded facts schema validator first slice. |
| Compact storage types and packed tables | storage/layout | RFC/P1 only. Future performance path for `u8`/`u16` storage and packed tables without adding full `u8`/`u16` SSA value types. No implementation or ABI change in v0.18. |
| Generated output handles tooling | Output Contract manifests | P1 tooling only; no runtime `output.emit`. |
| Chrome Extension host profile RFC | host profile pressure | P1/RFC pressure only; browser authority remains host-owned. No Chrome APIs are implemented in Core. |
| Conformance output stream planning | future event/output contract | Planning/fixtures only; no Host ABI import. |
| Two-domain event/output examples | promotion evidence | Interactive/game-like plus DevOps/SRE/FlowDesk/policy/dashboard evidence. |

## Deferred

| Feature | v0.18 status |
| --- | --- |
| `output.emit` implementation | Deferred. |
| `audio.event` / `effect.event` implementation | Deferred. |
| Host ABI `0.11` | Deferred. |
| AIR ABI `0.11` | Deferred. |
| Tablegroups runtime/syntax support | Deferred unless a separate RFC is accepted. |
| Compact load/store, `table<u8>`, typed buffers, and range analysis | Deferred implementation. RFC only in v0.18. |
| raw `chrome.*` access | Rejected/deferred from Core surface. |
| DOM/React, IndexedDB/Dexie, arbitrary fetch/Jira authority in AIR | Rejected. |
| Dynamic maps, GC, reflection, host object handles | Rejected. |
| JS promises / async-await in AIR | Rejected. |
| Runtime imports | Rejected. |
| Package registry | Deferred. |
| Native installers | Deferred. |
| Full JSON-RPC LSP server | Deferred; v0.19+ tooling candidate after diagnostics/package graph/fact schema/output contract output stabilizes. First MVP should be diagnostics-only. |
| VS Code extension | Deferred until after a diagnostics-only JSON-RPC LSP server exists. |

## Rejected / Direct No

| Feature | Layer | v0.18 rule |
| --- | --- | --- |
| Raw browser or Chrome Extension APIs in AIR | Host/profile/Core | Rejected. Hosts own browser APIs and permissions. |
| Arbitrary JSON object model inside AIR | AIR Core | Rejected. Use bounded static schemas and scalar facts instead. |
| FlowDesk-specific Core semantics | AIR Core | Rejected. FlowDesk is pressure evidence only. |
| Game-specific Core APIs | AIR Core / Host ABI | Rejected. |
| `debug.metric` as event bus | diagnostics/reviewPolicy | Rejected. |

## Version Semantics

- Project milestone: `v0.18`.
- AIR ABI version: remains `0.10` unless runtime/executable contract changes.
- Host ABI version: remains `0.10` unless accepted host imports or host import
  semantics change.
