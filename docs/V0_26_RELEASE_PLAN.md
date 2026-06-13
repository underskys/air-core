# AIR v0.26 Release Plan

Status: active implementation milestone

Theme: Host ABI `0.11` Bounded Output Emit First Slice

v0.26 starts after v0.25 host interaction evidence. v0.25 proved that
Output Contracts, command buffers, the reference mock host, and
`air.hostInteractionEvidence` can represent bounded host intent across two
domains without real side effects.

v0.26 implements the first package/profile/check/runtime surface for a narrow
Host ABI `0.11` candidate:

```text
output.emit(output_id:i32, arg0:i32, arg1:i32, arg2:i32, arg3:i32) -> i32
```

This first slice recognizes Host ABI `0.11` in package/profile validation,
validates `output.emit` against Output Contracts, capabilities, effect budgets,
and host profiles, and lowers the exact scalar import when declared by a module.
It does not implement real host side effects, raw host authority, event streams,
string/object payloads, host object handles, or a runtime JSON/object model.

## P0 Scope

| Area | Gate | Acceptance |
| --- | --- | --- |
| Host ABI `0.11` package/profile recognition | Accept only the bounded first-slice surface. | Package manifests and host profiles may use Host ABI `0.11` for `output.emit` validation; Host ABI `0.10` remains supported. |
| Host ABI `0.11` import definition | Define one bounded output-intent import for validation. | [Host ABI 0.11 Output Emit RFC](rfcs/v0.26-host-abi-011-output-emit.md) defines `output.emit(output_id:i32, arg0:i32, arg1:i32, arg2:i32, arg3:i32) -> i32`. |
| Static output id first slice | Keep output identity verifier-visible. | `output_id` must be statically resolvable from a literal, constant, or generated output handle. Dynamic output ids fail package-check. |
| Scalar args only | Preserve bounded reviewable ABI. | Args are exactly four `i32` values. No strings, payloads, objects, maps, slices, pointers, raw URLs, logs, or private text. |
| Output Contract validation | Keep package metadata source of truth. | Static `output_id` is validated against package-local `outputContracts`; invalid static ids fail package-check. |
| Capability/effect gate | Keep host interaction declared and budgeted. | `output.emit` must be capability-allowed and effect-budgeted. Emit count is verifier/report visible. |
| Host profile support | Keep unsupported behavior deterministic. | Unsupported Host ABI `0.10` or non-output profiles fail package-check, and verification evidence reports required/supported Host ABI compatibility. |
| Mock host integration | Keep side-effect-free evidence path. | Reference mock host/policy executor understands runtime emit trace records and produces deterministic evidence with status codes. |
| Conformance matrix | Preserve replayable acceptance criteria. | Fixtures and tests cover accepted, denied, unsupported profile, invalid output id, budget misuse, and deterministic evidence. |
| LSP diagnostics | Improve AI repairability. | LSP-lite and diagnostics-only Full LSP expose stable `air.output_emit.*` diagnostics for unknown/dynamic output ids, missing capability/effect budget, unsupported Host ABI/profile, and scalar-only misuse. No code actions, hover, go-to-definition, or document symbols are added. |
| Host ABI decision | Make version change explicit. | Host ABI becomes `0.11` only when implementation is accepted. AIR ABI remains `0.10` unless executable AIR semantics change. |

## P1 / If Scope Allows

- generated output handles if not already present;
- richer output status codes;
- profile-specific output channels;
- `extension-basic` experimental adapter;
- code action / repair prompt planning.

P1 work must not expand authority or bypass the P0 scalar/output-contract
boundary.

## Deferred

- dynamic `output_id`;
- strings, payloads, object args, maps, slices, pointers, or runtime JSON;
- `output.event`;
- `audio.event`;
- `effect.event`;
- raw Chrome, DOM, DB, cloud, Kubernetes, Jira, fetch, or filesystem authority;
- host object handles;
- automatic host-side action guarantee;
- game-specific APIs.

## Return Status Plan

Suggested first-slice return status:

| Code | Meaning |
| ---: | --- |
| `0` | accepted |
| `1` | denied_by_policy |
| `2` | unsupported_profile |
| `3` | invalid_output_id |
| `4` | budget_exceeded |

Package-check and verifier should catch invalid static output ids before
runtime where possible. Runtime status codes are for host policy/runtime
outcomes that remain possible after validation.

## Compatibility And Rollback

Host ABI `0.10` packages remain valid and continue using Output Contracts,
command buffers, verification evidence, conformance replay, and mock-host
policy evidence.

Host ABI `0.11` is opt-in through explicit package/profile versioning and the
bounded `output.emit` capability/effect surface. Unsupported hosts fail
package-check. A downgrade path to command buffer intent should remain
available where practical.

## ABI Policy

AIR ABI remains `0.10` unless executable AIR calling conventions or module
semantics change.

Host ABI `0.11` is implemented for the bounded `output.emit`
package/profile/check/runtime first slice only. AIR ABI remains `0.10`.

## Representative Checks

```sh
node scripts/check_markdown_links.js
git diff --check
```
