# AIR Target Product Model

Status: planning

AIR does not compile complete applications directly into native binaries. AIR
compiles verified packages/modules. Native and web products are AIR packages
bundled with target hosts.

## Pipeline

```text
AIR source
-> verified AIR package
-> WASM / linked module / package artifact
-> target host bundle
-> shipped product
```

AIR Core owns verification, package metadata, capability boundaries, Host ABI
requirements, deterministic reports, and package artifacts. Target hosts own
platform execution, windows, files, GPU/audio/device policy, distribution
format, and OS integration.

## Build-time Tooling

Build-time workflows may use:

- Node;
- Python;
- npm;
- CI;
- Codex;
- asset generation;
- review bundle tooling;
- transitional generators.

These tools are allowed at build time when they are deterministic, documented,
and included where required by review/release policy.

## Runtime Product Boundary

A shipped runtime product must not require:

- Node;
- `npm install`;
- Python;
- source AIR repository;
- Codex;
- build scripts.

Runtime products consume packaged artifacts and target hosts. They do not rely
on the development checkout.

## Target Shapes

Initial and future target shapes:

| Target | Shape | Notes |
| --- | --- | --- |
| macOS | `.app` | Host executable plus embedded or sidecar AIR package/assets. |
| Linux | folder, tar, AppImage later | Host executable plus AIR package/assets. |
| Windows | folder, `.exe` | Host executable plus AIR package/assets. |
| Web | `dist/` | Static host app, WASM/package artifact, manifests, assets. |
| Steam-like distribution | depot/folder layout | Target host bundle packaged for store/distribution tooling. |

The exact bundle format is target-specific. AIR does not promise one universal
binary that runs everywhere.

## Version Planning

v0.14 documents and prepares this model:

- executable package composition;
- authored module graph as source of truth;
- generated artifact freshness;
- package/report/check boundaries;
- build-time vs runtime boundary.

v0.15 may begin implementation/prototype work:

- `airpkg` package artifact shape;
- `airc package`;
- `airc bundle --target <target>`;
- host-specific bundle prototypes;
- target product smoke checks.

The v0.15 implementation should not change AIR Core semantics unless a runtime
package contract change is explicitly accepted through the version and ABI
policy.

## Non-goals

- No package registry.
- No remote dependency resolver.
- No promise that one binary runs everywhere.
- No platform objects exposed to AIR.
- No target bundling as a v0.14 release requirement.
- No demo-specific target pipeline in AIR Core.
