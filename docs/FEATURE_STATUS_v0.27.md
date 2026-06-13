# AIR v0.27 Feature Status

Status: active stabilization/evidence milestone

Version target: v0.27

v0.27 is the Host ABI `0.11` Stabilization & Adapter Evidence milestone. It
does not expand Host ABI beyond the v0.26 bounded `output.emit` first slice:

```text
output.emit(output_id:i32, arg0:i32, arg1:i32, arg2:i32, arg3:i32) -> i32
```

AIR ABI remains `0.10`.

Host ABI `0.10` remains supported. Host ABI `0.11` remains limited to bounded
`output.emit` packages.

Related documents:

- [AIR v0.27 Release Plan](V0_27_RELEASE_PLAN.md)
- [Host ABI 0.11 Stabilization RFC](rfcs/v0.27-host-abi-011-stabilization.md)
- [Output Emit Adapter Evidence RFC](rfcs/v0.27-output-emit-adapter-evidence.md)
- [Output Handles Ergonomics RFC](rfcs/v0.27-output-handles-ergonomics.md)
- [Host ABI 0.11 Bounded Output Emit RFC](rfcs/v0.26-host-abi-011-output-emit.md)
- [AIR Strategy](AIR_STRATEGY.md)
- [Architecture Gates](ARCHITECTURE_GATES.md)

## Status Values

- `stable/active`: inherited behavior from earlier milestones.
- `implemented/baseline`: implemented in a previous milestone and active.
- `planned/P0`: v0.27 stabilization target.
- `implemented/P1`: optional v0.27 ergonomics work accepted after P0.
- `P1`: optional future work if architecture review accepts it.
- `deferred`: future work outside v0.27.
- `rejected`: not allowed in AIR Core, Host ABI, package contracts, host
  profiles, or public examples.

## Stable / Active Baseline

| Feature | Layer | v0.27 status |
| --- | --- | --- |
| AIR ABI `0.10` | ABI | Stable/active. |
| Host ABI `0.10` | ABI | Stable/active and still supported. |
| Host ABI `0.11` bounded `output.emit` | Host ABI/package/runtime | Implemented baseline from v0.26. No expansion in v0.27. |
| Output Contracts | package/check/report | Implemented baseline. Source of truth for output ids and scalar arg contracts. |
| Command buffer output intents | package/check/report/conformance | Implemented baseline. Rollback and compatibility path for output intent evidence. |
| Reference mock host / policy executor | tooling/evidence | Implemented baseline. Produces deterministic `air.hostInteractionEvidence` without side effects. |
| LSP-lite diagnostics | tooling | Implemented baseline. Must keep stable `air.output_emit.*` diagnostics visible. |
| Diagnostics-only Full LSP | tooling | Implemented baseline. No code actions, hover, go-to-definition, document symbols, or VS Code extension in v0.27 P0. |

## Planned P0

| Feature | Layer | v0.27 status |
| --- | --- | --- |
| Host ABI `0.11` stability matrix | docs/tests/report | Planned/P0. Freeze accepted first-slice behavior across package-check, verifier, lowering, SDK, mock host, evidence, LSP, and rollback. |
| `output.emit` adapter evidence | host/profile/evidence | Planned/P0. Collect deterministic adapter evidence without real side effects or new authority. |
| Host profile compatibility hardening | package/report/evidence | Planned/P0. Required/supported Host ABI and profile support must stay visible and deterministic. |
| Reference/mock host consistency | tooling/evidence | Planned/P0. Mock-host evidence and runtime status semantics must remain aligned. |
| Two-domain conformance fixtures | conformance/evidence | Planned/P0. Keep non-game policy/ops and interactive/visual-like evidence coverage. |
| Verification/report/evidence hardening | report/evidence | Planned/P0. Emit usage, ids, contract mapping, decisions, status codes, and diagnostics without raw payloads. |
| API gates v0.27 | scripts/tests | Planned/P0. Reject scope creep beyond bounded scalar `output.emit`. |
| Negative scope-creep tests | tests | Planned/P0. Keep event imports, raw authority, host handles, runtime JSON, dynamic ids, and string/object payloads rejected. |

## P1

| Feature | v0.27 rule |
| --- | --- |
| Generated output handle constants | Implemented/P1 first slice. Package-visible constants only; Output Contracts remain source of truth. |
| Output handle metadata sidecar | Implemented/P1 first slice. Deterministic freshness metadata, no runtime ABI. |
| Freshness validation | Implemented/P1 first slice through package-check when `generated/output_handles.air` is listed in `generatedModules`. |
| LSP diagnostics for output handles | Implemented/P1 first slice. Missing/stale/mismatched handle diagnostics only; no code actions. |
| Report/evidence mapping for output handles | Implemented/P1 first slice as `outputHandleSets`. Metadata only, no raw payloads. |
| output.emit ergonomics docs | P1 docs only. |

## Deferred / Rejected

| Feature | v0.27 status |
| --- | --- |
| Generated emit wrapper functions | Deferred unless separately approved. |
| Dynamic `output_id` | Deferred. |
| Strings/payloads/object args | Deferred/rejected. |
| Runtime JSON/object model | Rejected. |
| Host object handles | Rejected. |
| `output.event` / `audio.event` / `effect.event` | Deferred/rejected. |
| Raw Chrome/DOM/DB/cloud/Kubernetes/Jira/fetch authority | Rejected. |
| Automatic host-side action guarantee | Rejected. Host policy owns execution. |
| Real production platform adapters | Deferred. v0.27 evidence may describe adapters but must not ship production authority. |
| Package registry/native installers | Deferred. |

## Version Semantics

- Project milestone: `v0.27`.
- AIR ABI version: remains `0.10`.
- Host ABI version: `0.10` remains supported; `0.11` remains limited to the
  bounded `output.emit` first slice.
- v0.27 is a stabilization/evidence milestone, not an ABI expansion milestone.
