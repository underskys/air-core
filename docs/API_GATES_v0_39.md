# AIR API Gates v0.39

Status: implemented

v0.39 gates protect the Executable Package Composition / Authored Graph
Runtime first slice. The gate is implemented by
`scripts/check_api_gates_v0_39.js` and is wired as:

```sh
npm run check:api-gates:v0.39
```

The gate runs during `scripts/run_rc_checks.sh`.

## Accepted Surface

The v0.39 first slice may include:

- deterministic executable package graph output;
- `authoredGraph`, `executableGraph`, `authoredToExecutable`, and
  `ownershipMap` report/evidence fields;
- linked package sidecar ownership metadata;
- stable package graph diagnostics;
- deterministic linked package output using existing module graph, link-plan,
  linked package, package-check, and lowering surfaces.

The authored graph remains the source/review/ownership surface. The generated
executable graph is a deterministic derived artifact and must not become the
semantic source of truth.

## Gate Checks

The v0.39 gate verifies:

- v0.39 docs and status files exist and describe implemented P0 scope;
- `check:api-gates:v0.39` is present in `package.json`;
- `scripts/run_rc_checks.sh` runs the v0.39 gate;
- `link-plan` emits deterministic authored/executable graph metadata;
- linked package builds emit sidecar ownership metadata;
- negative fixtures produce stable `air.package_graph.*` diagnostics;
- linked metadata has no timestamps, absolute paths, raw URLs, secrets, or
  private tokens;
- AIR ABI remains `0.10`;
- Host ABI remains unchanged and latest remains `0.11`, limited to bounded
  `output.emit`.

## Rejected Active Implementation

The gate rejects active v0.39 implementation of:

- package registry;
- native installer;
- demo-specific bundlers;
- browser/Vite host bundling;
- AIRON-specific gameplay APIs;
- asset pipeline rewrite;
- host authority;
- host object handles;
- declared mutable pools;
- tablegroup expansion beyond the v0.37 readonly first slice;
- Host ABI expansion;
- AIR ABI change without a separate accepted ABI review;
- executable graph as semantic source of truth;
- generated artifacts as semantic source of truth;
- timestamps or absolute paths in linked output metadata.

Docs and RFCs may mention deferred/rejected items when they clearly remain
outside v0.39 implementation.

## ABI Decision

AIR ABI remains `0.10` for the v0.39 first slice because the implementation
reuses existing AIR module, linker, lowering, and scalar Wasm conventions.

Host ABI is unchanged. No new Host ABI imports are accepted by v0.39.
