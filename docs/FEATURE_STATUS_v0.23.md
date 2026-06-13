# AIR v0.23 Feature Status

Status: active implementation milestone

Version target: v0.23

v0.23 is the Fixed Bounded State Segment First Slice milestone. Parser,
formatter, verifier diagnostics, package report, verification evidence
metadata, and Wasm lowering are active first slices.

AIR ABI remains `0.10`. Host ABI remains `0.10`.

Related documents:

- [AIR v0.23 Release Plan](V0_23_RELEASE_PLAN.md)
- [Fixed Bounded State Implementation RFC](rfcs/v0.23-fixed-bounded-state-implementation.md)
- [Fixed State ABI Decision](rfcs/v0.23-fixed-state-abi-decision.md)
- [AIR v0.22 Fixed Bounded State Segment RFC](rfcs/v0.22-fixed-bounded-state-segment.md)
- [AIR v0.22 ABI 0.11 Pressure Audit](rfcs/v0.22-abi-011-pressure-audit.md)
- [AIR v0.22 API Gates](API_GATES_v0_22.md)

## Status Values

- `stable/active`: inherited active behavior from earlier milestones.
- `active/planned`: v0.23 implementation-planning or phase-gated target.
- `phase-gated`: may land only in the listed phase and only after checks pass.
- `deferred`: future work outside v0.23 P0.
- `rejected`: not allowed in AIR Core, stdlib, Host ABI, package contracts, or
  host profiles.

## Stable / Active Baseline

| Feature | Layer | v0.23 status |
| --- | --- | --- |
| v0.22 fixed-state RFC/gates | docs/release | Active baseline for v0.23 implementation planning. |
| v0.22 ABI 0.11 pressure audit | ABI governance | Active baseline; keep AIR ABI and Host ABI at `0.10` unless runtime/host contracts change. |
| v0.22 API gates | release/review | Active conservative gates; no state implementation implied by the gates. |
| v0.21 API rebaseline | docs/release | Previous implementation/gates baseline. |
| Verification evidence JSON | package/evidence | Active from v0.20. |
| Bounded rowset schema metadata | package/check/report/evidence | Active from v0.20. |
| Command buffer output intents | package/check/report/conformance | Active metadata/conformance surface from v0.20; host policy owns execution. |
| Diagnostics-only Full LSP MVP | tooling | Active from v0.19; diagnostics only. |
| Compact static tables | storage/layout | Active from v0.19; no compact state or compact scalar arithmetic. |

## Active / Planned P0

| Feature | Layer | v0.23 status |
| --- | --- | --- |
| Fixed Bounded State Segment parser/AST first slice | Core syntax/tooling | Active first slice. No lowering/runtime ABI yet. |
| `i32` state cells only | Core semantics | Active first slice. No compact or non-scalar cells. |
| Fixed length | verifier/Core | Active first slice. Compile-time literal length only. |
| Zero/fill-literal initialization | verifier/Core | Active first slice. Deterministic `fill <i32 literal>` only. |
| `state.len` / `state.get` / `state.set` | Core operations | Active parser/verifier/lowering first slice. |
| Verifier obligations | verifier | Active first slice: fixed length, deterministic init, no uninitialized cells, no escape, static OOB rejection, deterministic dynamic bounds trap in lowering, read/write budgets, loop-bound accounting. |
| Report `stateSegments` metadata | report/evidence | Active first slice. Visibility is metadata, not proof beyond verifier-enforced properties. Module observed read/write counters are aggregate counters, not per-state facts. |
| Conformance final-state digest | conformance/evidence | Active first slice through explicit package-authored scalar snapshot helper exports. No hidden state export or host direct state readback. |
| Per-execution-instance semantics | Core semantics | Active P0 through per-Wasm-instance private state. No shared package-global mutable state. |
| Backend-neutral semantics with Wasm lowering | Core/backend | Active P0. Wasm lowering is backend model only. |
| Wasm lowering for fixed state | backend | Active first slice. State cells lower to private mutable Wasm globals, not exported linear memory. Dynamic OOB traps deterministically. |

## P1

| Feature | Target | v0.23 rule |
| --- | --- | --- |
| Runtime `state.fill` | Core op | P1 if not included in P0. |
| `state.swap` | Core op | P1. |
| `bool` state cells | Core semantics | P1 after `i32` cells are stable. |
| Generated state handles | tooling | P1. |
| Grid index helper | stdlib/kit | P1 only if generic and project-neutral. |
| Airtris/Minesweeper-style fixtures | conformance/examples | P1 synthetic fixtures only; no demo authority. |

## Deferred

| Feature | v0.23 status |
| --- | --- |
| Compact `u8`/`u16`/`i16` state | Deferred. |
| Tablegroups implementation | Deferred. |
| State snapshots as ABI | Deferred. |
| State pointer/slice export | Rejected/deferred. |
| Host direct state access | Rejected. |
| Shared mutable state / atomics / shared memory | Rejected for first slice. |
| `output.emit` / `output.event` / `audio.event` / `effect.event` | Deferred. |
| Host ABI `0.11` | Deferred behind promotion gate. |
| AIR ABI `0.11` | Deferred unless runtime/package contract changes are accepted. |
| Canvas/ImageData/pixel-buffer authority | Rejected from Core. |
| Runtime JSON object model | Rejected. |
| Dynamic maps | Rejected. |
| GC / reflection | Rejected. |
| Host object handles | Rejected. |
| Promises / callbacks / async-await | Rejected. |

## Rejected / Direct No

| Feature | Layer | v0.23 rule |
| --- | --- | --- |
| Host-visible state memory | Core / Host ABI | Rejected. State is accessed through exported functions only. |
| Pointer/slice/reference escape | Core | Rejected. |
| State-conditional Output Contract declarations | package/Host ABI | Rejected. |
| Game-specific Core APIs | Core / stdlib | Rejected. |
| Report visibility as proof | report/verifier | Rejected. Reports must not imply proof that verifier cannot enforce. |
| Per-state observed read/write counters | report/verifier | Deferred. Current `moduleObservedReads` / `moduleObservedWrites` are module-level aggregates. |

## Version Semantics

- Project milestone: `v0.23`.
- AIR ABI version: remains `0.10`.
- Host ABI version: remains `0.10`.
- Package/tooling version remains separate from project milestone version.
