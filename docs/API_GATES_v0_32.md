# AIR v0.32 API Gates

Status: active first slice

v0.32 API gates protect the Executable Utility Slice while bounded structured
IO, AI authoring eval replay, and verifier safety fuzzing move from plan to
implemented first slices.

## Gate Intent

The v0.32 gates keep the new utility slice bounded and reviewable. They must
not let structured IO become runtime JSON, a dynamic object model, tablegroups,
declared pools, host object handles, or host authority.

## Required Rules

Bounded Structured IO first slice must remain:

- package metadata/tooling first;
- scalar-only;
- fixed-shape;
- bounded by declared `maxRows`;
- privacy-classified;
- source-of-truth driven by schemas/contracts/state declarations;
- generated-binding files as derived artifacts only.

AI eval and fuzz tooling must remain:

- deterministic;
- replay/seed driven;
- no live model calls;
- no API keys;
- no network;
- no wall-clock timestamps in reports;
- no absolute paths in JSON reports.

## Rejected in Active Core Implementation

- runtime JSON/object model;
- dynamic maps;
- host object handles;
- tablegroups syntax;
- declared mutable pools;
- nested arbitrary records;
- string/raw URL/private text/token/secret structured IO fields;
- generated bindings as semantic source of truth;
- Host ABI expansion;
- GFX-driven ABI;
- raw browser/cloud/network/filesystem authority.

## Allowed Mentions

The gate allows:

- docs-only rejected/future mentions;
- tests and hallucination fixtures that assert rejection;
- validator code that rejects forbidden fields;
- v0.26 bounded `output.emit` implementation and v0.23 fixed state
  implementation already accepted by earlier gates;
- v0.32 verifier-safety fuzz scaffold exercising accepted surfaces.

## ABI Status

- AIR ABI remains `0.10`.
- Host ABI latest remains `0.11`, limited to bounded `output.emit`.
- Host ABI `0.10` remains the default/baseline compatibility target.
- v0.32 gates do not add host imports or runtime semantics.
