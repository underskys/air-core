# AIR v0.24 Feature Status

Status: active milestone with P0 generated state handle first slice

Version target: v0.24

v0.24 is the State Ergonomics & Generated Handles milestone. It builds on the
v0.23 Fixed Bounded State first executable slice with package-visible generated
state handle constants, metadata sidecars, freshness checks, report/evidence
mappings, and package-check/LSP diagnostics.

AIR ABI remains `0.10`. Host ABI remains `0.10`.

Related documents:

- [AIR v0.24 Release Plan](V0_24_RELEASE_PLAN.md)
- [Generated State Handles RFC](rfcs/v0.24-generated-state-handles.md)
- [AIR v0.23 Feature Status](FEATURE_STATUS_v0.23.md)
- [AIR v0.23 Release Plan](V0_23_RELEASE_PLAN.md)
- [Fixed Bounded State Implementation RFC](rfcs/v0.23-fixed-bounded-state-implementation.md)

## Status Values

- `stable/active`: inherited active behavior from earlier milestones.
- `implemented/P0`: implemented first slice in v0.24.
- `active/planned`: v0.24 planning target not yet implemented.
- `P1`: optional work if architecture review accepts it.
- `deferred`: future work outside v0.24 P0.
- `rejected`: not allowed in AIR Core, stdlib, Host ABI, package contracts, or
  host profiles.

## Stable / Active Baseline

| Feature | Layer | v0.24 status |
| --- | --- | --- |
| Fixed bounded state first slice | AIR Core | Active baseline from v0.23: `state name:i32[N] = fill K`, `state.len`, `state.get`, `state.set`. |
| State report/evidence metadata | tooling/report | Active baseline from v0.23. |
| Conformance final digest path | conformance/evidence | Active baseline from v0.23 through explicit package-authored scalar helpers. |
| AIR ABI `0.10` | ABI | Active. |
| Host ABI `0.10` | ABI | Active. |

## Active / Planned P0

| Feature | Layer | v0.24 status |
| --- | --- | --- |
| Generated state handle constants | tooling/package | Implemented/P0. `node bin/airc.js generate state-handles <package-dir>` writes `generated/state_handles.air`. |
| Generated state metadata sidecar | tooling/package | Implemented/P0. The generator writes `generated/state_handles.meta.json` with source and generated fingerprints. |
| Package-visible generated module model | package/tooling | Implemented/P0. Generated state handles are ordinary visible `.air` constants listed through `generatedModules`. |
| Freshness checking model | package-check/report/LSP | Implemented/P0 for missing/stale/mismatched generated state handles when `generated/state_handles.air` is package-declared. |
| Report/evidence mapping for state handles | report/evidence | Implemented/P0 through `stateHandleSets`; mapping is metadata only, not runtime ABI. |
| LSP diagnostics for generated state handles | LSP/diagnostics | Implemented/P0 through diagnostics-only LSP-lite and Full LSP package checks for missing, stale, mismatched, and invalid generated state handle metadata. |
| State accessor policy validation | package-check/report/evidence | Implemented/P0 for package-authored helpers in root `state_accessors.policy.json`. No accessor functions are generated. |
| LSP diagnostics for state accessor policies | LSP/diagnostics | Implemented/P0 through diagnostics-only LSP-lite and Full LSP package checks for invalid policies, missing helpers, export mismatch, unknown state, unsafe helpers, and invalid return/reference exposure. |
| ABI decision gate | ABI governance | Active P0 planning target. AIR ABI remains `0.10` unless generated handles become runtime/package ABI; Host ABI remains `0.10`. |

## P1

| Feature | Target | v0.24 rule |
| --- | --- | --- |
| Generated accessor implementation | tooling/package | P1 only after architecture review accepts a separate implementation slice. P0 validates authored helpers only. |
| Generated observation-only digest helpers | tooling/conformance | P1; helpers must be visible AIR code and observation-only. |
| Small synthetic state example cleanup | examples | P1; no demo migration or demo authority. |
| State-aware LSP hover/explain planning | LSP/explain | P1 planning only unless separately accepted; v0.24 LSP support is diagnostics-only. |
| Generated handle repair prompt planning | diagnostics/docs | P1 planning only; no automatic code action requirement. |

## Deferred

| Feature | v0.24 status |
| --- | --- |
| Compact state `u8`/`u16`/`i16` | Deferred. |
| Tablegroups | Deferred. |
| State snapshots as ABI | Deferred. |
| Hidden compiler exports | Rejected. |
| Host direct state access | Rejected. |
| `output.emit` / `output.event` / `audio.event` / `effect.event` | Deferred. |
| Host ABI `0.11` | Deferred. |
| Code actions / automatic repair | Deferred; v0.24 does not expose regenerate-handles code actions. |
| VS Code extension | Deferred. |
| Runtime JSON/object model | Rejected. |

## Version Semantics

- Project milestone: `v0.24`.
- AIR ABI version: remains `0.10`.
- Host ABI version: remains `0.10`.
- Package/tooling version remains separate from project milestone version.
