# AIR v0.28 API Gates

Status: active first slice

v0.28 promotes generated output handles to the canonical authoring path for
packages that use bounded `output.emit`.

## Gate Intent

The v0.28 gates preserve the v0.27 Host ABI `0.11` stabilization boundary and
add authoring hygiene around generated output handles. They do not add Host ABI
features, emit wrappers, dynamic output IDs, or payload support.

## Required Rules

Canonical packages that use `output.emit` and declare
`generated/output_handles.air` in `generatedModules` must:

- generate `generated/output_handles.air`;
- generate `generated/output_handles.meta.json`;
- keep Output Contracts as the source of truth;
- call `output.emit` with `OUTPUT_*` handle constants;
- keep generated output handles fresh.

The gates reject in canonical examples:

- raw numeric `output_id` in `output.emit` when an `OUTPUT_*` handle exists;
- generated emit wrapper functions;
- dynamic `output_id`;
- string/object/JSON/payload output args;
- hidden host imports or hidden compiler exports in generated handle files.

## Allowed Compatibility Uses

Raw numeric output IDs may remain in:

- low-level verifier/runtime tests;
- rejection fixtures;
- ABI conformance fixtures;
- docs that explain the underlying bounded `output.emit` Host ABI.

## ABI Status

- AIR ABI remains `0.10`.
- Host ABI remains `0.11` only for the bounded `output.emit` first slice.
- Generated output handles do not expand Host ABI and do not add new host
  imports.
