# Output Emit Authoring

Status: canonical v0.28 authoring guidance

This document defines the preferred authoring path for packages that use the
accepted bounded Host ABI `0.11` `output.emit` first slice.

## Canonical Pattern

Do:

```air
%status:i32 = @output.emit(OUTPUT_INCIDENT_RECOMMEND_ACTION, %arg0, %arg1, %arg2, %arg3)
```

Do not:

```air
%status:i32 = @output.emit(1001, %arg0, %arg1, %arg2, %arg3)
```

Canonical packages that opt into generated output handles by listing
`generated/output_handles.air` in `generatedModules` must use generated
`OUTPUT_*` handle constants for `output.emit` output IDs. Raw numeric IDs may
remain in low-level verifier/runtime tests, rejection fixtures, ABI conformance
fixtures, and docs that explain the underlying Host ABI.

## Source of Truth

Output Contracts remain the source of truth for:

- output IDs;
- output names;
- channels;
- capabilities;
- scalar arg schemas.

Generated output handles are derived artifacts. They reduce authoring drift but
do not define new outputs and do not grant host authority.

Generate handles with:

```sh
node bin/airc.js generate output-handles <package-dir>
```

The generator writes:

```text
generated/output_handles.air
generated/output_handles.meta.json
```

`generated/output_handles.air` contains constants only. The metadata sidecar is
deterministic and records Output Contract fingerprints so package-check, report,
verification evidence, and LSP diagnostics can detect missing, stale, or
mismatched generated artifacts.

## No Emit Wrappers

v0.28 does not generate emit wrapper functions.

Generated output handles must not contain:

- functions;
- hidden compiler exports;
- `output.emit` calls;
- host imports;
- dynamic dispatch;
- string, object, JSON, or payload arguments.

The only canonical generated AIR surface is stable `i32` constants such as:

```air
const OUTPUT_INCIDENT_RECOMMEND_ACTION:i32 = 1001
const OUTPUT_INCIDENT_RECOMMEND_ACTION_ID:i32 = 1001
const OUTPUT_INCIDENT_RECOMMEND_ACTION_ARG_COUNT:i32 = 4
```

## No Dynamic Output IDs

`output.emit` output IDs must stay statically resolvable. Generated handles may
be used only where `output.emit` already accepts a static module-level `i32`
constant. Dynamic `output_id` values remain rejected.

## ABI Status

Generated output handles do not change AIR ABI or Host ABI.

- AIR ABI remains `0.10`.
- Host ABI remains `0.11` only for the bounded `output.emit` first slice.
- Generated handles do not add new host imports or expand `output.emit`.

## Reports And Evidence

Package reports and verification evidence expose generated output handle status
as `outputHandleSets` when `generated/output_handles.air` is declared in
`generatedModules`.

Expected statuses include:

- `fresh`;
- `missing`;
- `stale`;
- `mismatch`.

LSP-lite and the diagnostics-only LSP server surface the same stable
diagnostic codes used by package-check.
