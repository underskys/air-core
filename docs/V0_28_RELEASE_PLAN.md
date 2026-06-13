# AIR v0.28 Release Plan

Status: active hardening milestone

Theme: Output Emit Ergonomics Hardening

v0.28 starts after the v0.26 bounded `output.emit` first slice and the v0.27
Host ABI `0.11` stabilization work. v0.28 does not expand Host ABI. Its purpose
is to remove magic-number authoring slop around `output.emit` while keeping
Output Contracts as the source of truth.

The generated output handle first slice is implemented. v0.28 hardens it into
the canonical authoring path for packages that opt into
`generated/output_handles.air`.

AIR ABI remains `0.10`.

Host ABI remains `0.11` only for bounded `output.emit` packages. Host ABI
`0.10` remains supported.

## Implemented P0 Scope

| Area | Gate | Acceptance |
| --- | --- | --- |
| Generated output handles | Promote the implemented first slice to the canonical authoring path. | Packages that opt into `generated/output_handles.air` use `OUTPUT_*` constants instead of raw numeric output ids. |
| Generated AIR shape | Freeze `generated/output_handles.air`. | Constants only. No functions, emit wrappers, hidden exports, dynamic dispatch, or host imports. |
| Generated metadata shape | Freeze `generated/output_handles.meta.json`. | Deterministic metadata records source Output Contract fingerprints, generated file fingerprints, outputs, arg counts, and handle names. |
| Freshness validation | Make generated handle freshness a hard gate for canonical packages. | Missing, stale, or mismatched generated handles fail package-check/report/LSP when `generated/output_handles.air` is declared in `generatedModules`. |
| Output Contract authority | Keep Output Contracts as source of truth. | Generated handles are derived artifacts and must not define new outputs, capabilities, or host authority. |
| Report/evidence stability | Keep `outputHandleSets` stable. | Package reports and verification evidence expose fresh/stale/missing/mismatch status without raw payloads or new ABI. |
| LSP diagnostics | Lock generated handle diagnostics. | LSP-lite and diagnostics-only Full LSP surface stable missing/stale/mismatch output handle diagnostics. |
| AI-facing authoring docs | Make the recommended spelling explicit. | Docs show `output.emit(OUTPUT_*, ...)` and reject raw magic-number authoring in canonical packages. |
| v0.28 API gates | Prevent wrapper/dynamic/payload creep. | Gates reject generated emit wrappers, dynamic output ids, string/object/JSON payloads, and raw numeric output ids in canonical generated-handle examples. |

## P1 / If Scope Allows

- small examples using generated output handles;
- repair hints for canonical handle policy diagnostics;
- generated helper stubs only as documentation/proposal, not implementation.

## Deferred

- generated emit wrapper functions;
- dynamic `output_id`;
- `output.event`;
- `audio.event`;
- `effect.event` / `effect_event`;
- string, object, map, JSON, payload, pointer, or slice output args;
- Host ABI expansion beyond bounded `output.emit`;
- LSP code actions;
- real platform adapters;
- package registry or native installers.

## Canonical Authoring Rule

Do:

```air
%status:i32 = @output.emit(OUTPUT_INCIDENT_RECOMMEND_ACTION, %arg0, %arg1, %arg2, %arg3)
```

Do not:

```air
%status:i32 = @output.emit(1001, %arg0, %arg1, %arg2, %arg3)
```

Low-level verifier/runtime tests, rejection fixtures, ABI conformance fixtures,
and docs explaining internals may still use raw numeric ids when explicitly
classified as such.

## ABI Policy

AIR ABI remains `0.10`.

Host ABI remains `0.11` only for the bounded `output.emit` first slice accepted
in v0.26. v0.28 does not add host imports, wrapper functions, dynamic output ids,
richer payloads, event streams, or automatic side-effect guarantees.

## Representative Checks

```sh
node scripts/check_markdown_links.js
git diff --check
```
