# AIR v0.22 Feature Status

Status: active planning milestone

Version target: v0.22

v0.22 is the Fixed Bounded State RFC & ABI Decision Gates milestone. It is
RFC/gates/design first and does not implement Fixed Bounded State Segment in P0.

AIR ABI remains `0.10`. Host ABI remains `0.10`.

Related documents:

- [AIR v0.22 Release Plan](V0_22_RELEASE_PLAN.md)
- [Fixed Bounded State Segment RFC](rfcs/v0.22-fixed-bounded-state-segment.md)
- [ABI 0.11 Pressure Audit](rfcs/v0.22-abi-011-pressure-audit.md)
- [AIR v0.22 API Gates](API_GATES_v0_22.md)
- [Fixed Bounded State Segment Pressure Request](abi-requests/fixed-bounded-state-segment.md)
- [AIR v0.21 Feature Status](FEATURE_STATUS_v0.21.md)
- [AIR v0.21 Release Plan](V0_21_RELEASE_PLAN.md)

## Stable / Active Baseline

| Feature | Layer | v0.22 status |
| --- | --- | --- |
| API gates / anti-slop checks | release/review | Inherited active first slice from v0.21. |
| v0.22 fixed-state API gates | release/review | Active conservative first slice through `npm run check:api-gates:v0.22`; no implementation implied. |
| API surface inventory and migration docs | docs/release | Inherited from v0.21. |
| AirOps-style canonical example | examples/package evidence | Inherited v0.21 first slice; synthetic and authority-free. |
| Verification evidence JSON | package/evidence | Active from v0.20 through `airc verify package <dir> --json`. |
| Bounded rowset schema metadata | package/check/report/evidence | Active from v0.20 through `factSchemas` with `kind: "air.boundedRowsetSchema"`. |
| Output Contract manifests | package/check/report | Active tooling surface from v0.18; no runtime emit. |
| Command buffer output intents | package/check/report/conformance | Active metadata/conformance surface from v0.20; host policy owns execution. |
| Batch conformance fixtures | conformance | Active first slices from v0.20. |
| Diagnostics-only Full LSP MVP | tooling | Active from v0.19; diagnostics only. |
| Compact static tables | storage/layout | Active from v0.19; no compact state or compact scalar arithmetic. |

## Active / Planned P0

| Feature | Layer | v0.22 status |
| --- | --- | --- |
| Fixed Bounded State Segment RFC | Core RFC | Active/planned. RFC only; no parser, verifier, lowering, or runtime implementation. |
| Backend-neutral AIR semantic storage framing | Core RFC | Active/planned. AIR state is not defined as Wasm memory, even though Wasm is the current primary lowering backend. |
| AIR ABI / Host ABI impact decision | ABI governance | Active/planned through ABI `0.11` pressure audit. |
| Verifier model | Core RFC | Active/planned. Proof/enforcement obligations must be specified before implementation. |
| Lowering model | backend design | Active/planned. Candidate Wasm lowering models may be documented only. |
| Conformance/evidence model | conformance/report | Active/planned. Final-state digest and mismatch diagnostics are design topics only. |
| Migration story from globals/arrays/buffers | docs/RFC | Active/planned. Clarify why existing surfaces are insufficient without creating dynamic collections. |
| Demo pressure triage | docs/RFC | Active/planned for Airtris, Minesweeper, and PhotoLoop pressure only. |
| API gates update plan | release/review | Active. State-specific checks are conservative RC/review gates and must not delete legacy APIs or imply fixed-state implementation. |
| Kill criteria | architecture governance | Active/planned. Stop conditions must remain explicit. |

## P1

| Feature | Target | v0.22 rule |
| --- | --- | --- |
| Parser syntax fixtures | tests/docs | P1 only if useful for RFC clarity; no parser implementation. |
| Example plans | docs | P1 planning only; no example migration or demo work. |
| API gate tests | review tooling | P1 if low-noise and docs-backed. |
| State diagnostic taxonomy | diagnostics docs | P1 planning only. |
| Report/evidence field naming | report docs | P1 planning only. |

## Deferred

| Feature | v0.22 status |
| --- | --- |
| Fixed state implementation | Deferred. |
| Compact state | Deferred. |
| Tablegroups | Deferred. |
| `output.emit` / `output.event` / `audio.event` / `effect.event` | Deferred. |
| Host ABI `0.11` | Deferred behind separate Host ABI promotion gate. |
| AIR ABI `0.11` | Deferred until runtime/executable contract changes are accepted. |
| State snapshots as ABI | Deferred. |
| Host direct state access | Rejected/deferred. |
| Pixel kernels | Deferred; PhotoLoop pressure remains example/kit first. |
| Game-specific helpers | Rejected from Core. |
| Shared mutable state / atomics / cross-instance state | Rejected for first-slice planning. |
| Runtime JSON object model | Rejected. |
| Dynamic maps | Rejected. |
| GC / reflection | Rejected. |
| Host object handles | Rejected. |
| Promises / callbacks / async-await | Rejected. |
| Package registry | Deferred. |
| Native installers | Deferred. |

## Rejected / Direct No

| Feature | Layer | v0.22 rule |
| --- | --- | --- |
| Raw host authority in AIR | Core / Host ABI | Rejected. Browser, renderer, GPU, Canvas, filesystem, network, Chrome, secrets, and credentials stay host-owned. |
| State-conditional Output Contract declarations | package/Host ABI | Rejected. Output Contract manifests remain state-independent declarations. |
| Report visibility as proof | report/verifier | Rejected. Reports must not imply proof that the verifier cannot enforce. |
| Shared package-global mutable state | Core runtime | Rejected unless a future explicit shared-state RFC is accepted. |
| Demo-specific Core APIs | Core / stdlib / Host ABI | Rejected. Demo pressure is evidence, not authority. |

## Version Semantics

- Project milestone: `v0.22`.
- AIR ABI version: remains `0.10`.
- Host ABI version: remains `0.10`.
- Package/tooling version remains separate from project milestone version.
