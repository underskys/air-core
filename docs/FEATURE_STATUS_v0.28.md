# AIR v0.28 Feature Status

Status: active hardening milestone

Version target: v0.28

v0.28 is the Output Emit Ergonomics Hardening milestone. It promotes generated
output handles to the stable canonical authoring path for bounded `output.emit`
without expanding Host ABI beyond the v0.26 first slice:

```text
output.emit(output_id:i32, arg0:i32, arg1:i32, arg2:i32, arg3:i32) -> i32
```

AIR ABI remains `0.10`.

Host ABI `0.10` remains supported. Host ABI `0.11` remains limited to bounded
`output.emit` packages.

Related documents:

- [AIR v0.28 Release Plan](V0_28_RELEASE_PLAN.md)
- [Output Emit Ergonomics Hardening RFC](rfcs/v0.28-output-emit-ergonomics-hardening.md)
- [Output Emit Authoring](OUTPUT_EMIT_AUTHORING.md)
- [API Gates v0.28](API_GATES_v0_28.md)
- [Output Handles Ergonomics RFC](rfcs/v0.27-output-handles-ergonomics.md)
- [Host ABI 0.11 Stabilization RFC](rfcs/v0.27-host-abi-011-stabilization.md)
- [Host ABI 0.11 Bounded Output Emit RFC](rfcs/v0.26-host-abi-011-output-emit.md)

## Status Values

- `stable/active`: inherited behavior from earlier milestones.
- `implemented/baseline`: already implemented and active.
- `implemented/P0`: implemented v0.28 hardening target.
- `P1`: optional future work if scope allows.
- `deferred`: future work outside v0.28.
- `rejected`: not allowed in AIR Core, Host ABI, package contracts, host
  profiles, or canonical examples.

## Stable / Active Baseline

| Feature | Layer | v0.28 status |
| --- | --- | --- |
| AIR ABI `0.10` | ABI | Stable/active. |
| Host ABI `0.10` | ABI | Stable/active and still supported. |
| Host ABI `0.11` bounded `output.emit` | Host ABI/package/runtime | Implemented baseline from v0.26. No expansion in v0.28. |
| Host ABI `0.11` stabilization evidence | docs/report/evidence/gates | Implemented baseline from v0.27. |
| Output Contracts | package/check/report | Implemented baseline. Source of truth for output ids and scalar arg contracts. |
| Generated output handles | tooling/package | Implemented baseline from v0.27; v0.28 hardens canonical authoring policy. |
| `outputHandleSets` | report/evidence | Implemented baseline. Stable report/evidence status for generated output handles. |
| LSP-lite diagnostics | tooling | Implemented baseline. Generated output handle diagnostics remain package-check sourced. |
| Diagnostics-only Full LSP | tooling | Implemented baseline. Diagnostics only; no code actions in v0.28. |

## Implemented P0

| Feature | Layer | v0.28 status |
| --- | --- | --- |
| Canonical generated handle authoring | docs/package-check/gates | Implemented/P0. Canonical packages use `OUTPUT_*` handles instead of raw numeric output ids when generated handles are declared. |
| `generated/output_handles.air` shape freeze | generated artifacts | Implemented/P0. Constants only; no emit wrappers, hidden exports, host imports, or dynamic dispatch. |
| `generated/output_handles.meta.json` shape freeze | generated artifacts | Implemented/P0. Deterministic metadata derived from Output Contracts. |
| Freshness hard gate | package-check/report/LSP | Implemented/P0. Missing/stale/mismatch remains failure when generated handles are package-declared. |
| Authoring documentation | docs | Implemented/P0. `OUTPUT_*` use and low-level raw-id exceptions are documented. |
| v0.28 API gates | scripts/release | Implemented/P0. Gates reject wrapper/dynamic/payload creep and canonical raw-id magic numbers. |

## P1

| Feature | v0.28 rule |
| --- | --- |
| Small output-handle examples | P1 only. Must use existing APIs and no demos. |
| Repair hints | P1 if low-risk; must reuse existing diagnostics. |
| Generated helper stubs | Docs/proposal only. No implementation in v0.28. |

## Deferred / Rejected

| Feature | v0.28 status |
| --- | --- |
| Generated emit wrapper functions | Deferred. |
| Dynamic `output_id` | Deferred/rejected for canonical bounded emit. |
| Strings/payloads/object/JSON args | Deferred/rejected. |
| Runtime JSON/object model | Rejected. |
| Host object handles | Rejected. |
| `output.event` / `audio.event` / `effect.event` / `effect_event` | Deferred/rejected. |
| Raw Chrome/DOM/DB/cloud/Kubernetes/Jira/fetch authority | Rejected. |
| Automatic host-side action guarantee | Rejected. Host policy owns execution. |
| LSP code actions | Deferred. |
| Real production platform adapters | Deferred. |
| Package registry/native installers | Deferred. |

## Version Semantics

- Project milestone: `v0.28`.
- AIR ABI version: remains `0.10`.
- Host ABI version: `0.10` remains supported; `0.11` remains limited to the
  bounded `output.emit` first slice.
- v0.28 is an ergonomics hardening milestone, not an ABI expansion milestone.
