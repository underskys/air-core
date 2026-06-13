# AIR v0.24 Release Plan

Status: active milestone with P0 generated state handle first slice

Theme: State Ergonomics & Generated Handles

v0.24 starts after the v0.23 Fixed Bounded State first executable slice. The
milestone improves ergonomics, reportability, and AI repairability around state
without adding hidden runtime ABI or host authority.

The first implementation slice is generated state handle constants plus
freshness metadata. It does not generate accessor functions, change parser,
verifier, lowering, AIR ABI, or Host ABI.

## P0 Scope

| Area | Gate | Acceptance |
| --- | --- | --- |
| Generated state handles/accessors RFC | Define the architecture for generated package-visible AIR modules that name state slots and observation helpers. | [Generated State Handles RFC](rfcs/v0.24-generated-state-handles.md) exists and rejects hidden compiler exports, host state access, pointer/slice/reference escape, and runtime ABI changes. |
| Package-visible generated module model | Keep generated handles explicit and reviewable. | Implemented first slice: `node bin/airc.js generate state-handles <package-dir>` writes ordinary package-visible `generated/state_handles.air` constants plus `generated/state_handles.meta.json`. |
| Freshness checking model | Prevent examples from depending on stale generated handles. | Implemented first slice: packages that declare `generated/state_handles.air` in `generatedModules` get package-check diagnostics for missing, stale, mismatched, or invalid metadata. |
| Report/evidence mapping | Make handle-to-state relationships reviewable. | Implemented first slice: package reports and verification evidence include `stateHandleSets` metadata without exposing raw state values, backend addresses, or state ABI. |
| LSP diagnostics plan | Improve AI repair loops. | Implemented first slice through diagnostics-only LSP-lite and Full LSP package checks for generated state handles and state accessor policies. No code actions, hover, go-to-definition, document symbols, or editor extension scope is included. |
| State accessor policy validation | Validate package-authored observation helpers without generating helpers. | Implemented first slice: package root `state_accessors.policy.json` is auto-detected and reported through `stateAccessorPolicies`; helpers must be scalar-returning and observation-only. |
| ABI decision gate | Preserve current executable contracts. | AIR ABI remains `0.10` unless generated handles become runtime/package ABI. Host ABI remains `0.10`. |

## P1 / If Scope Allows

- generated accessor implementation if architecture review accepts it;
- generated observation-only digest helpers;
- small synthetic state example cleanup;
- state-aware LSP hover/explain planning;
- generated handle repair prompt planning.

## Deferred

- compact state `u8`/`u16`/`i16`;
- tablegroups;
- state snapshots as ABI;
- hidden compiler exports;
- host direct state access;
- `output.emit`;
- `output.event`;
- `audio.event`;
- `effect.event`;
- Host ABI `0.11`;
- code actions / automatic repair;
- VS Code extension;
- runtime JSON/object model;
- parser, verifier, lowering, or runtime changes.

v0.24 LSP support is diagnostics-only. Regenerate-handles code actions,
hover, go-to-definition, document symbols, and a VS Code extension remain
deferred.

## ABI Policy

AIR ABI remains `0.10` while generated state handles are package-visible source
helpers, not runtime/package ABI. AIR ABI `0.11` becomes a candidate only if
generated handles become required executable package metadata, hidden runtime
entrypoints, state snapshot ABI, or calling-convention changes.

Host ABI remains `0.10` because generated handles add no host imports, no host
state access, no host-managed snapshots, and no direct pointer/slice/reference
handoff to hosts.

## Non-Goals

v0.24 must not:

- generate public accessor functions;
- hide generated `__air_state_*` exports;
- expose state pointers, slices, references, handles, or backend addresses;
- add host direct state access;
- add compact state or tablegroups;
- add runtime JSON/object model;
- add output/audio/effect events;
- add Host ABI `0.11`;
- touch demos.

## Representative Checks

```sh
node scripts/check_markdown_links.js
git diff --check
```
