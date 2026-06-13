# Host ABI 0.11 Stabilization Inventory v0.27

Status: audit inventory

Milestone: AIR v0.27

This document inventories the Host ABI `0.11` stabilization surfaces after the
v0.26 bounded `output.emit` first slice.

This is not an implementation plan for new host authority. AIR ABI remains
`0.10`. Host ABI remains `0.11` only for the accepted bounded `output.emit`
surface:

```text
output.emit(output_id:i32, arg0:i32, arg1:i32, arg2:i32, arg3:i32) -> i32
```

## Required Conclusions

- `output.emit` is the only accepted Host ABI `0.11` import.
- Host ABI `0.11` is not a general event API.
- `output.event`, `audio.event`, and `effect_event` remain deferred.
- Command buffers remain the preferred batch path for host-visible output
  intents.
- `output.emit` is a bounded scalar intent path for packages that explicitly
  opt into Host ABI `0.11`, Output Contracts, capability/effect gates, and
  host profile support.

## Current Surface Inventory

| Surface | Status | Owner layer | Evidence coverage | Conformance coverage | LSP coverage | Negative tests | Remaining risk | v0.27 action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Host ABI profiles | stable for `0.10`; experimental/stabilizing for `0.11` `output.emit` | host profile/package metadata | Package reports and verification evidence expose package `hostAbi`, selected profile `hostAbi`, required imports, and profile support. See [HOST_PROFILES](../spec/HOST_PROFILES.md) and [package manifest](../spec/AIR_PACKAGE_MANIFEST.md). | `test/host_profiles.test.js` covers `0.10` baseline and `mock-output-v011`. | Package-aware diagnostics surface profile mismatches through LSP-lite and diagnostics-only Full LSP. | `test/output_emit_validation.test.js`, `test/output_emit_runtime.test.js`, and profile tests reject Host ABI `0.10` packages using `output.emit`. | Profile vocabulary can drift if adapter docs add informal feature names. | Freeze allowed `0.11` profile semantics to bounded `output.emit`; keep unsupported profile diagnostics visible. |
| `output.emit` registry/signature | stable first slice | Host ABI registry / capabilities spec | [CAPABILITIES](../spec/CAPABILITIES.md) documents the exact import, capability, and effect requirement. [Host ABI 0.11 Output Emit RFC](rfcs/v0.26-host-abi-011-output-emit.md) records the accepted slice. | Runtime and validation tests cover exact scalar signature and import presence. | Stable `air.output_emit.*` diagnostics are emitted. | API gates reject `output.event`, `audio.event`, `effect_event`, pointer/slice/string/object/payload args, and raw authority. | Future docs may imply event semantics around `emit`. | Keep wording as bounded output intent, not event bus or side-effect guarantee. |
| `output.emit` lowering/runtime import | stabilizing | compiler lowering / runtime host import surface | WAT/runtime tests assert import appears only when used and absent when unused. Verification evidence reports usage and output ids. | `test/output_emit_runtime.test.js` covers accepted, denied, unsupported, invalid, and no-import cases. | Misuse is represented in diagnostics before runtime where statically visible. | Invalid static output id, dynamic output id, missing budget, missing capability, unsupported profile, and non-i32 args are tested. | Host adapters could treat accepted status as guaranteed real side effect. | Document adapter evidence as policy decision only; no automatic action guarantee. |
| Output Contracts | stable | package metadata / report | Output Contract fingerprints, output ids, channel/capability mapping, and diagnostics are report/evidence-visible. See [AIR Package Manifest](../spec/AIR_PACKAGE_MANIFEST.md). | `test/output_contract_schema.test.js`, package-check tests, command buffer tests, and output emit validation cover schema and id use. | `air.output_emit.output_id_invalid` is surfaced when emit ids do not match contracts. | Missing contracts and unknown ids fail. | Contracts may later need sensitivity metadata; current scalar args are visible when non-sensitive. | Keep Output Contracts as source of truth. If sensitivity is added later, evidence should prefer hash-only args. |
| Command buffers | stable preferred batch path | package metadata / conformance | Reports expose command buffer fingerprints, record counts, and output intent usage. | `test/command_buffer_schema.test.js`, conformance batch fixtures, AirOps, FlowDesk, and visual panel fixtures cover deterministic records. | Not the primary LSP path for v0.27, but schema diagnostics are package-check visible. | Unknown output ids, absolute paths, timestamps, and schema errors fail command buffer validation. | New contributors may assume `output.emit` replaces command buffers. | State explicitly that command buffers remain preferred for batch output intent and rollback compatibility. |
| Mock host policy executor | stable evidence tool | tooling / conformance evidence | `airc mock-host` produces deterministic `air.hostInteractionEvidence`; verification evidence can embed a compact summary. See [reference mock host RFC](rfcs/v0.25-reference-mock-host-policy-executor.md). | `test/mock_host_policy.test.js` and output emit runtime tests cover policy decisions and deterministic evidence. | Not an LSP surface directly. Package/profile issues produced by package-check are LSP-visible. | Strict policy schema rejects arbitrary payload containers, raw authority strings, nondeterministic fields, absolute paths, unknown outputs, and unsupported profiles. | Policy files could be mistaken for platform execution configs. | Keep docs clear: mock host is not a real host and performs no side effects. |
| `air.hostInteractionEvidence` | stable evidence artifact | report / conformance evidence | Evidence includes status, package hash, ABI hash, host profile, policy id, command records or observed emits, decisions, denied capabilities, diagnostics, and replay checksum. | AirOps, visual panel, and output emit fixtures cover allowed and denied evidence. | Summary diagnostics can appear through verification/package reports. | Tests assert deterministic output and reject timestamps/absolute paths/private payload shapes. | Evidence may grow too close to raw payload transport. | Keep evidence no-payload and scalar-only; add sensitivity/hash-only rules before any private args. |
| Verification evidence summary | stabilizing | verification/report | `verify package --host-evidence` embeds compact host interaction summary without raw command payloads. | `test/verification_evidence.test.js` and output emit runtime tests cover host summary and profile compatibility. | Package-check diagnostics feeding evidence are LSP-visible. | Failed/invalid host evidence is represented as diagnostics. | Required/supported Host ABI fields can regress if report shape drifts. | Keep profile compatibility evidence aligned with package-required and selected-profile Host ABI. |
| LSP-lite diagnostics | stable for first slice | diagnostics tooling | `airc check <file-or-package> --lsp-json` exposes stable `air.output_emit.*` codes. | `test/lsp_diagnostics.test.js` covers dynamic id, invalid id, bad args, missing capability, missing budget, unsupported Host ABI/profile, and missing contracts. | Direct LSP-lite coverage exists. | Tests cover no duplicate/stable ordered output emit diagnostics through fixtures. | Package-only context can be harder than file-only context. | Keep package-aware fixtures in LSP tests for profile and Output Contract checks. |
| Diagnostics-only Full LSP | stable diagnostics-only | LSP server tooling | Full LSP publishes output emit diagnostics through the existing diagnostics-only path. | `test/lsp_server.test.js` covers dynamic id, invalid id, missing capability, missing budget, and unsupported profile. | Direct Full LSP coverage exists. | No code actions, hover, go-to-definition, document symbols, or VS Code extension are added. | Future ergonomics pressure may try to add code actions in stabilization scope. | Keep v0.27 P0 diagnostics-only; defer code actions and hover. |
| API gates | stable guardrail | scripts / release gates | [API Gates v0.26](API_GATES_v0_26.md) and `scripts/check_api_gates_v0_26.js` allow only the accepted bounded first slice. | `npm run check:api-gates:v0.21`, `v0.22`, and `v0.26` remain part of RC checks. | Not an LSP surface. | Gates reject event imports, raw host authority, runtime JSON/object payloads, host object handles, and uncontrolled `output.emit` implementation. | v0.27 needs its own named gate if stabilization rules diverge. | Add v0.27 gate only if it can be low-noise and narrower than v0.26; otherwise keep v0.26 gate active. |
| Conformance fixtures | stable baseline plus stabilizing output emit fixture | conformance/test fixtures | AirOps and visual panel cover two-domain command buffer/mock-host evidence; output emit fixture covers Host ABI `0.11` observed emit evidence. | `test/fixtures/conformance_batch/airops/`, `test/fixtures/host_interaction/visual_panel/`, and `test/fixtures/host_interaction/output_emit/` provide replayable fixtures. | Diagnostics are indirectly covered by LSP tests, not fixture files themselves. | Fixtures cover allowed, denied, unknown/invalid, unsupported profile, and deterministic replay paths. | Interactive/visual-like evidence is synthetic, not a real adapter. | Keep fixtures synthetic and authority-free; collect adapter evidence without demo coupling. |
| v0.26 tests | stable regression baseline | tests | `test/output_emit_validation.test.js`, `test/output_emit_runtime.test.js`, `test/lsp_diagnostics.test.js`, `test/lsp_server.test.js`, `test/mock_host_policy.test.js`, `test/verification_evidence.test.js`, and `test/host_profiles.test.js` cover the first slice. | Direct conformance/replay and package-check tests cover both command buffer and runtime emit surfaces. | LSP-lite and Full LSP tests cover the expected output emit diagnostics. | Negative tests cover event imports, Host ABI mismatch, dynamic ids, invalid ids, bad args, missing capability, missing budget, unsupported profiles, raw authority, and payload-like policy fields. | Tests may validate implementation but not adapter documentation. | Use this test set as the v0.27 stabilization baseline; add adapter evidence tests only when adapter artifacts exist. |

## Stabilization Matrix By Question

| Question | Current answer | v0.27 stabilization target |
| --- | --- | --- |
| Is `output.emit` the only accepted Host ABI `0.11` import? | Yes. `output.emit(i32,i32,i32,i32,i32) -> i32` is the only accepted `0.11` import. | Keep API gates and docs aligned; reject every event-style import. |
| Is Host ABI `0.11` a general event API? | No. It is bounded scalar output intent only. | Preserve "intent, not event bus" wording in specs, reports, and examples. |
| Are command buffers still preferred? | Yes. Command buffers remain the preferred batch path and rollback compatibility surface. | Keep command buffer tests and docs active; do not migrate batch fixtures to runtime emit by default. |
| Does `output.emit` guarantee side effects? | No. Host policy decides accepted, denied, unsupported, invalid, or budget-exceeded outcomes. | Adapter evidence must report policy decisions, not claim platform action success. |
| Can `output.emit` carry raw payloads? | No. Args are scalar `i32` only, no string/object/pointer/slice/JSON payloads. | Keep negative gates/tests active and define hash-only future policy before any sensitive args. |
| Do Host ABI `0.10` packages remain valid? | Yes. They must not gain `output.emit` implicitly. | Keep no-import and `0.10` regression tests active. |

## v0.27 Audit Actions

1. Keep Host ABI `0.11` frozen to bounded `output.emit`.
2. Treat command buffers as the preferred batch output-intent path.
3. Require adapter evidence to be deterministic, no-payload, and side-effect-free
   unless a real host adapter is explicitly scoped later.
4. Keep LSP-lite and diagnostics-only Full LSP coverage for every
   `air.output_emit.*` diagnostic.
5. Keep API gates rejecting event imports, dynamic output ids, runtime JSON,
   host object handles, raw authority, and string/object/payload args.
6. Add generated output handles only as P1 package-visible derived artifacts if
   accepted by a separate implementation prompt.
