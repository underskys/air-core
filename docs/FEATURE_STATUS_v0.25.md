# AIR v0.25 Feature Status

Status: active evidence/tooling milestone

Version target: v0.25

v0.25 is the Host ABI Promotion Evidence & Reference Host Contract milestone.
It does not implement Host ABI `0.11`; it defines the inventory, evidence,
reference mock host policy executor, promotion gates, and negative-test plan
required before a future runtime import such as `output.emit` can be
considered.

AIR ABI remains `0.10`. Host ABI remains `0.10`.

Related documents:

- [AIR v0.25 Release Plan](V0_25_RELEASE_PLAN.md)
- [Host Interaction Inventory v0.25](HOST_INTERACTION_INVENTORY_v0_25.md)
- [Host Interaction Contract RFC](rfcs/v0.25-host-interaction-contract.md)
- [Reference Mock Host Policy Executor RFC](rfcs/v0.25-reference-mock-host-policy-executor.md)
- [Host ABI 0.11 Promotion Evidence RFC](rfcs/v0.25-host-abi-011-promotion-evidence.md)
- [Host ABI 0.11 Decision Record](rfcs/v0.25-host-abi-011-decision-record.md)
- [AIR Strategy](AIR_STRATEGY.md)
- [Architecture Gates](ARCHITECTURE_GATES.md)

## Status Values

- `stable/active`: inherited active behavior from earlier milestones.
- `implemented/baseline`: implemented in a previous milestone and active.
- `implemented/P0`: implemented v0.25 tooling/evidence target.
- `planned/P0`: v0.25 documentation/evidence target.
- `P1`: optional future work if architecture review accepts it.
- `deferred`: future work outside v0.25 P0.
- `rejected`: not allowed in AIR Core, Host ABI, package contracts, host
  profiles, or public examples.

## Stable / Active Baseline

| Feature | Layer | v0.25 status |
| --- | --- | --- |
| AIR ABI `0.10` | ABI | Stable/active. |
| Host ABI `0.10` | ABI | Stable/active. |
| Output Contracts | package/check/report | Implemented baseline from v0.18+. Tooling/package metadata only; no runtime emit. |
| Command buffer output intents | package/check/report/conformance | Implemented baseline from v0.20. Bounded scalar intent records tied to Output Contracts; no automatic host-side execution. |
| Verification evidence JSON | report/release evidence | Implemented baseline from v0.20. Deterministic package evidence without timestamps or absolute paths. |
| Batch conformance fixtures | conformance/evidence | Implemented baseline from v0.20. FlowDesk/AirOps pressure remains host-owned and fixture-driven. |
| AirOps incident canonical example | example/conformance | Implemented baseline from v0.21. Synthetic, authority-free, command-buffer driven. |
| API gates | release governance | Implemented baseline from v0.21/v0.22. Raw authority and unsupported API surfaces stay gated. |
| Generated state handles/accessor policies | package/check/LSP | Implemented baseline from v0.24. Not part of Host ABI promotion. |

## Planned P0

| Feature | Layer | v0.25 status |
| --- | --- | --- |
| Host interaction contract inventory | docs/audit | Planned/P0. Inventory exists and classifies current surfaces, ABI impact, evidence visibility, conformance coverage, gaps, and v0.25 action. |
| Reference mock host / policy executor first slice | tooling/evidence | Implemented/P0. `airc mock-host <package-dir> --policy <policy.json> --profile <id> --json` consumes Output Contracts and command buffers, applies deterministic allow/deny policy, and emits `air.hostInteractionEvidence` without side effects. |
| Host interaction contract RFC | docs/RFC | Planned/P0. Defines AIR intent, host policy, metadata, reports, and host-owned execution boundaries. |
| Command buffer host contract conformance plan | docs/RFC | Planned/P0. Defines allow/deny decisions, output id resolution, deterministic checksums, and negative cases. |
| Verification evidence for host interaction | tooling/evidence | Implemented/P0. `verify package --host-evidence <json> --json` includes a compact host interaction summary without raw command payloads, timestamps, absolute paths, Host ABI changes, or runtime imports. |
| Two-domain promotion evidence fixtures | conformance/evidence | Implemented/P0 first slice. `test/fixtures/conformance_batch/airops/` covers non-game policy/ops command intent, and `test/fixtures/host_interaction/visual_panel/` covers synthetic interactive/visual-like command intent. Both include Output Contracts, command buffers, mock host policies, expected `air.hostInteractionEvidence`, deterministic checksums, and denied/negative coverage without Host ABI `0.11`. |
| Host ABI `0.11` decision gate | docs/RFC | Implemented/P0 decision record. Host ABI `0.11` is not accepted in v0.25; AIR ABI remains `0.10`, Host ABI remains `0.10`, and `output.emit` remains deferred. |
| Negative tests plan for raw host authority | docs/RFC | Planned/P0. Covers raw browser/cloud/DB APIs, runtime JSON, host handles, and automatic execution. |

## P1

| Feature | Target | v0.25 rule |
| --- | --- | --- |
| `output.emit` Host ABI candidate RFC | Host ABI design | P1 only; no runtime import implementation in v0.25 P0. |
| `extension-basic` experimental kit | host profile / kit | P1; browser authority remains host-owned and must not enter Core. |
| Generated output handles | tooling/package | P1; visible generated artifacts only, no hidden runtime ABI. |
| LSP diagnostics for host contract/profile mismatch | LSP/diagnostics | P1; diagnostics only unless separately accepted. |
| FlowDesk/AirOps pressure mapping | docs/conformance | P1; pressure evidence only, not public Host ABI. |

## Deferred / Rejected

| Feature | v0.25 status |
| --- | --- |
| Actual Host ABI `0.11` implementation | Deferred. |
| `output.emit` / `output.event` / `audio.event` / `effect.event` | Deferred. |
| Raw `chrome.*` | Rejected. |
| DOM/React/IndexedDB/Jira/fetch authority | Rejected. |
| DB/cloud SDK imports | Rejected. |
| Host object handles | Rejected. |
| Runtime JSON/object model | Rejected. |
| Automatic host-side side effects | Rejected. |
| Package registry | Deferred. |
| Native installers | Deferred. |

## Version Semantics

- Project milestone: `v0.25`.
- AIR ABI version: remains `0.10`.
- Host ABI version: remains `0.10`.
- Package/tooling version remains separate from project milestone version.
