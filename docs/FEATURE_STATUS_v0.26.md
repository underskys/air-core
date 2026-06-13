# AIR v0.26 Feature Status

Status: active implementation milestone

Version target: v0.26

v0.26 is the Host ABI `0.11` Bounded Output Emit First Slice milestone. The
runtime/lowering first slice recognizes Host ABI `0.11` in package/profile
validation, validates the bounded `output.emit` surface, and lowers/executes the
exact scalar import when a package declares it.

AIR ABI remains `0.10`.

Host ABI `0.10` remains supported. Host ABI `0.11` is recognized for the
bounded `output.emit` package/profile/check/runtime first slice.

Related documents:

- [AIR v0.26 Release Plan](V0_26_RELEASE_PLAN.md)
- [Host ABI 0.11 Bounded Output Emit RFC](rfcs/v0.26-host-abi-011-output-emit.md)
- [v0.25 Host ABI 0.11 Decision Record](rfcs/v0.25-host-abi-011-decision-record.md)
- [v0.25 Host ABI Promotion Evidence RFC](rfcs/v0.25-host-abi-011-promotion-evidence.md)
- [AIR Strategy](AIR_STRATEGY.md)
- [Architecture Gates](ARCHITECTURE_GATES.md)

## Status Values

- `stable/active`: inherited behavior from earlier milestones.
- `implemented/baseline`: implemented in a previous milestone and active.
- `implemented/P0`: implemented in the v0.26 package/profile/check slice.
- `planned/P0`: v0.26 implementation target not yet active.
- `P1`: optional future work if architecture review accepts it.
- `deferred`: future work outside v0.26 P0.
- `rejected`: not allowed in AIR Core, Host ABI, package contracts, host
  profiles, or public examples.

## Stable / Active Baseline

| Feature | Layer | v0.26 status |
| --- | --- | --- |
| AIR ABI `0.10` | ABI | Stable/active. |
| Host ABI `0.10` | ABI | Stable/active and still supported. |
| Output Contracts | package/check/report | Implemented baseline. Tooling/package metadata source of truth for output ids and scalar arg contracts. |
| Command buffer output intents | package/check/report/conformance | Implemented baseline. Bounded scalar intent records tied to Output Contracts; no automatic host-side execution. |
| Reference mock host / policy executor | tooling/evidence | Implemented baseline from v0.25. Produces deterministic `air.hostInteractionEvidence` without side effects. |
| Verification evidence host interaction summary | report/evidence | Implemented baseline from v0.25. Embeds compact summary only, not raw private payloads. |
| Two-domain promotion evidence fixtures | conformance/evidence | Implemented baseline from v0.25. Covers AirOps-style policy/ops and synthetic visual/panel command intent. |

## Planned P0

| Feature | Layer | v0.26 status |
| --- | --- | --- |
| Host ABI `0.11` recognition | package/profile/runtime | Implemented/P0 for bounded `output.emit`. |
| `output.emit` Host ABI definition | Host ABI/RFC/package-check/lowering | Implemented/P0. Signature: `output.emit(output_id:i32, arg0:i32, arg1:i32, arg2:i32, arg3:i32) -> i32`. |
| Static output id requirement | verifier/package-check | Implemented/P0. First slice accepts only literal, constant, or generated-handle output ids. Dynamic output ids are rejected/deferred. |
| Scalar i32 args only | verifier/package-check/runtime | Implemented/P0. Exactly four `i32` args; no strings, payloads, maps, pointers, slices, runtime JSON, raw URLs, logs, or private text. |
| Output Contract validation | package-check/verifier | Implemented/P0. Static output ids must resolve to package-local Output Contracts. |
| Capability/effect budget gate | verifier/report | Implemented/P0. Emit authority must be declared and emit count must be budgeted. |
| Host profile support | package-check/profile/evidence | Implemented/P0. Unsupported profiles fail package-check, and verification evidence records required Host ABI `0.11` plus selected profile Host ABI support for `output.emit` packages. |
| Mock host support | tooling/evidence | Implemented/P0. Mock host/policy executor consumes runtime emit trace evidence without real side effects. |
| Conformance fixtures | conformance/evidence | Implemented/P0. Covers accepted/denied runtime emit trace, unsupported profile, invalid output id, and budget misuse through package/runtime tests. |
| LSP diagnostics | diagnostics | Implemented/P0. LSP-lite and diagnostics-only Full LSP publish stable `air.output_emit.*` diagnostics for output ids, budget/capability, Host ABI/profile support, and scalar-only constraints. |
| Host ABI `0.11` | ABI | Implemented/P0 for bounded `output.emit` only. |

## P1

| Feature | v0.26 rule |
| --- | --- |
| Generated output handles | P1 if not already available; package-visible generated artifacts only. |
| Richer output status codes | P1 after first-slice semantics stabilize. |
| Profile-specific output channels | P1; must not introduce raw host authority. |
| `extension-basic` experimental adapter | P1/experimental kit only; no raw browser authority in AIR. |
| Code action / repair prompt planning | P1 diagnostics ergonomics only. |

## Deferred / Rejected

| Feature | v0.26 status |
| --- | --- |
| Dynamic `output_id` | Deferred. |
| Strings/payloads/object args | Deferred/rejected for first slice. |
| Runtime JSON/object model | Rejected. |
| Host object handles | Rejected. |
| `output.event` / `audio.event` / `effect.event` | Deferred. |
| Raw Chrome/DOM/DB/cloud/Kubernetes/Jira/fetch authority | Rejected. |
| Automatic host-side action guarantee | Rejected. Host policy owns execution. |
| Game-specific APIs | Rejected from public Host ABI. |

## Version Semantics

- Project milestone: `v0.26`.
- AIR ABI version: remains `0.10`.
- Host ABI version: `0.10` remains supported; `0.11` is implemented for the
  bounded `output.emit` package/profile/check/runtime first slice.
- AIR ABI remains `0.10`.
- No raw host authority, string/object payload, event stream, or automatic
  host-side side-effect guarantee is included.
