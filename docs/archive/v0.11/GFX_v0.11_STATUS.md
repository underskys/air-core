# AIRLang GFX v0.11 Status

This status report audits the current GFX foundation against
[GFX_v0.11_PLAN.md](GFX_v0.11_PLAN.md). It is a foundation/host/manifest/kits
review, not a public `gfx.*` ABI expansion.

## Summary

| Area | Status | Evidence | Required next action |
|---|---|---|---|
| GLB/glTF loading path | done | WebGPU host asset loader owns parsing and GPU buffer upload. | Keep parsing out of AIR Core and verifier semantics. |
| Missing asset/model/shader diagnostics | done | Manifest and host checks name missing paths, shaders, materials, render graph passes, and host loader failures. | Keep diagnostics explicit in CLI and browser reports. |
| Generated fixtures | done for v0.11 minimum | Deterministic `cube.glb` generator and committed cube fixtures exist; other fixture types are deferred. | Keep `uv_test`, `primitive_set`, and `material_test` as v0.12/post-v0.11 loader coverage. |
| Shader/material binding | done | Shaders and materials are referenced from manifests, examples, and `kits/gfx-basic`. | Keep WGSL/material presets out of `stdlib/` and AIR Core. |
| Render graph diagnostics | done | Manifest validation rejects missing/unsupported pass resources and mixed lifecycle use. | Continue naming exact manifest paths in diagnostics. |
| `gfx.*` stream vs `gpu`/`.airgfx` paths | done | High-level `gfx.*` remains separate from raw GPU/render graph package path. | Do not silently bridge the paths without host documentation and tests. |
| Public `gfx.*` ABI growth | stable | The v0.10 high-level ABI registry remains the fixed surface. | New public `gfx.*` requires separate spec/RFC/migration work. |

## Layer Boundary

Current implementation respects the v0.11 GFX boundary:

- AIR Core does not parse GLB, glTF, textures, shaders, materials, or render
  graph resources.
- AIR modules reference scalar handles and verified host imports.
- `.airgfx.json` manifests own assets, shaders, materials, render targets,
  render graphs, handles, inputs, and resource metadata.
- `hosts/webgpu` owns GLB/glTF loading, WebGPU buffers, shader modules,
  pipelines, input state, runtime diagnostics, and fallback reporting.
- `kits/gfx-basic` owns reusable starter shaders and material fragments.
- `examples/` own public teaching assets and manifests.
- `demo/` and external project kits own project-specific art direction.

Non-goals still enforced for v0.11:

- no new public `gfx.*` functions;
- no GLB/glTF parser in AIR Core;
- no shaders/assets/materials in `stdlib/`;
- no target packaging implementation;
- no production renderer claim.

## Host-Owned GLB/glTF Loading

Status: done.

Evidence:

- [hosts/webgpu/src/assetLoader.ts](../../../hosts/webgpu/src/assetLoader.ts) loads
  GLB/glTF assets host-side, reads positions/normals/UVs/indices where present,
  creates WebGPU buffers, and reports unsupported glTF features.
- The loader reports missing assets, unsupported model formats, missing
  accessors/buffers, invalid GLB headers, animations, skinning, morph targets,
  compressed texture extensions, unsupported primitive modes, and material
  fallback use.
- [hosts/webgpu/src/main.ts](../../../hosts/webgpu/src/main.ts) publishes these
  fields in the browser conformance report: `loadedAssets`,
  `loadedModelAssets`, `missingAssets`, `unsupportedGltfFeatures`,
  `materialFallbacks`, `supportedFeatures`, and `unsupportedFeatures`.
- [hosts/webgpu/scripts/smoke.mjs](../../../hosts/webgpu/scripts/smoke.mjs) requires
  the browser report to include GLB/glTF loading support and parsed/uploaded
  `cube.glb` evidence.

Boundary decision:

- AIR source does not read GLB bytes and does not describe mesh decoding.
- Host/package failures should be reported as diagnostics, not silently
  dropped models or blank screens.

## Diagnostics

Status: done.

CLI and manifest validation evidence:

- [src/gfx_manifest.js](../../../src/gfx_manifest.js) validates package-relative asset
  paths, model formats, shader paths, shader entry points, pipelines, materials,
  render targets, render graph passes, handles, GPU extern compatibility, input
  extern compatibility, lifecycle, and GFX budgets.
- [test/run.js](../../../test/run.js) covers missing shader resources, unknown
  pipeline shaders, unknown materials, unproduced render graph inputs, unknown
  meshes, unknown camera handles, unsupported render graph pass kinds, lifecycle
  order, and mixed manual/render graph GPU flow.
- [tools/scene-compiler.js](../../../tools/scene-compiler.js) rejects invalid scene
  layout references and names exact layout/manifest keys in diagnostics.

Browser host evidence:

- [hosts/webgpu/src/main.ts](../../../hosts/webgpu/src/main.ts) reports WebGPU
  unsupported, adapter unavailable, context unavailable, missing package assets,
  missing shaders, shader compile failures, missing materials, unsupported
  render graph pass kinds, unsupported host features, material fallback use,
  and draw-call state.
- [hosts/webgpu/scripts/smoke.mjs](../../../hosts/webgpu/scripts/smoke.mjs) fails on
  missing conformance report, missing GLB support diagnostics, missing loaded
  asset evidence, unexpected missing assets, blank canvas, missing draw calls,
  missing unsupported host/model/fallback diagnostics, or missing input
  conformance.

## Generated Fixtures

Status: done for the v0.11 minimum.

Decision:

- v0.11 minimum generated fixture set: `cube.glb` only.
- `uv_test.glb`, `primitive_set.glb`, and `material_test.glb` are deferred to
  v0.12/post-v0.11.

Rationale:

- `cube.glb` already proves the release-critical path: deterministic fixture
  generation, manifest/package asset reference, WebGPU host GLB parse, GPU
  buffer upload, browser smoke rendering, loaded asset diagnostics, and
  unsupported/fallback diagnostics.
- Broader UV, primitive topology, and material binding fixtures are useful
  loader coverage, but they are not required to prove the v0.11
  Product/Demo Loop or GFX foundation baseline.
- Deferring them avoids turning v0.11 into renderer/loader expansion work.

Evidence:

- [tools/generate-gfx-fixtures.js](../../../tools/generate-gfx-fixtures.js) is the
  tooling-owned fixture generator. It implements `cube` and explicitly lists
  `uv_test`, `primitive_set`, and `material_test` as planned/deferred.
- [examples/gfx_fixtures/assets/cube.glb](../../../examples/gfx_fixtures/assets/cube.glb)
  and [examples/gfx_showcase/assets/cube.glb](../../../examples/gfx_showcase/assets/cube.glb)
  are generated cube fixtures.
- [hosts/webgpu/scripts/smoke.mjs](../../../hosts/webgpu/scripts/smoke.mjs) requires
  `cube.glb` to appear in loaded asset diagnostics and parsed/uploaded model
  diagnostics.
- Determinism check:

```sh
node tools/generate-gfx-fixtures.js --out build/gfx-fixture-check-a
node tools/generate-gfx-fixtures.js --out build/gfx-fixture-check-b
shasum -a 256 build/gfx-fixture-check-a/cube.glb build/gfx-fixture-check-b/cube.glb
```

Current result: both generated files hash to
`472042ac0caf90d1fd8c983e9ad6d07c0c0dc8684c3ee4811908bca4544ee2e5`.

Deferred fixture criteria:

- `uv_test.glb` should land only when texture-coordinate validation or shader
  sampling tests need it.
- `primitive_set.glb` should land only when host support for additional glTF
  primitive modes is accepted and diagnostic behavior is specified.
- `material_test.glb` should land only when material metadata binding has a
  low-risk host/package test path.

## Shaders And Materials

Status: done.

Evidence:

- [kits/gfx-basic/README.md](../../../kits/gfx-basic/README.md) documents reusable
  starter WGSL and material fragments.
- [examples/gfx_showcase/showcase.airgfx.json](../../../examples/gfx_showcase/showcase.airgfx.json)
  and [examples/gpu_arena.airgfx.json](../../../examples/gpu_arena.airgfx.json)
  reference shaders, materials, textures, models, and render graph resources
  through manifests.
- Review bundle allowlists keep required example/kits shader and asset files
  available for local review/smoke checks.
- Layer guard prevents shader paths, resource packs, and demo/project content
  from entering `stdlib/`.

Boundary decision:

- Shader compilation, pipeline creation, texture upload, material fallback, and
  rendering behavior remain host/kits/examples work.
- `stdlib/` remains deterministic, backend-neutral AIR helpers only.

## Render Graph And Path Separation

Status: done.

Evidence:

- [spec/GFX_HIGH_LEVEL_ABI.md](../../../spec/GFX_HIGH_LEVEL_ABI.md) documents the
  optional high-level `gfx.*` stream separately from raw GPU/render graph
  packages.
- [spec/GFX_ABI.md](../../../spec/GFX_ABI.md) documents `gpu.*` and `.airgfx.json`
  manifest ownership.
- [test/run.js](../../../test/run.js) verifies high-level `gfx.air` separately from
  `gpu_arena.air`/`.airgfx.json`, rejects mixed render graph/manual GPU
  lifecycle, and asserts the stable high-level `gfx.*` registry.

Boundary decision:

- `examples/gfx.air` remains the simple high-level stream smoke example.
- `examples/gpu_arena.air`, `examples/gfx_showcase`, and `examples/ui_tool.air`
  remain the canonical raw GPU/render graph/package examples.
- Mixing `gfx.*` and `gpu.*` requires explicit host bridge documentation and
  tests; it is not silent behavior.

## Public ABI Status

Status: stable.

The registered public high-level `gfx.*` functions remain:

- `gfx.begin_frame`
- `gfx.camera_look_at`
- `gfx.draw_cube`
- `gfx.draw_primitive`
- `gfx.skybox_world`
- `gfx.end_frame`

No v0.11 GFX foundation work should add public high-level `gfx.*` functions.
Advanced graphics pressure should route through `.airgfx.json`, render graphs,
`gpu.*`, host implementation, reusable kits, examples, or ABI request RFCs.

`gpu.draw_voxel_chunk` is already part of the raw GPU/package ABI documented in
[GFX_ABI.md](../../../spec/GFX_ABI.md). It is a manifest/package/render graph route,
not a high-level `gfx.*` stream function and not approval for
`gfx.draw_voxel_chunk`. The package-path decision is tracked in
[RFC_GFX_VOXEL_CHUNK_PATH.md](../../RFC_GFX_VOXEL_CHUNK_PATH.md).

Buffer layouts used by `gpu.*` packages are documented in
[GFX_BUFFER_LAYOUTS.md](../../../spec/GFX_BUFFER_LAYOUTS.md). They are AIR memory
records copied by hosts into renderer resources; AIR never receives backend
object handles such as WebGPU buffers, Metal buffers, Vulkan objects, textures,
shader modules, or pipelines.

## Request Routing Snapshot

| Request | Layer | v0.11 action | v0.12/post-v1 status |
|---|---|---|---|
| Native Gfx Stream Probe And Window Renderer | host implementation | Implemented behind existing `gfx.*`, `debug`, and `input` imports; keep `gfx-stream` headless and `gfx-window` manual. | Continue host polish only if it stays behind existing imports. |
| Instanced Primitive Draw | host implementation / reusable kit / docs | Deferred for public high-level `gfx.*`; use host batching, manifest instances, `gpu.*`, kits, or examples. | Separate RFC required after multiple demos prove a generic `transform_set` model. |
| Voxel Chunk Render Path | manifest schema / host implementation | Use existing `gpu.draw_voxel_chunk`, `.airgfx.json`, buffer layouts, host conformance, and diagnostics; do not add `gfx.draw_voxel_chunk`. | Expand package examples/host support if generic chunk resources are accepted. |
| Generic Grid And Fixed-Point Math Helpers | stdlib | Keep only deterministic, backend-neutral, resource-free helpers with generic names. | Additive stdlib polish only; no demo vocabulary. |
| Generated AIR Data Ergonomics | core | RFC only; no quick v0.11 syntax patch. | Core RFC with parser/formatter/verifier/lowering/audit migration plan. |
| PBR Lighting And Post-Processing Package Path | manifest schema / reusable kit / host implementation | Route through `.airgfx.json`, render graphs, materials, pipelines, kits, and host diagnostics; no new `gfx.*`. | Future kit/host expansion without Core or high-level ABI drift. |

## Smoke Commands

Baseline checks:

```sh
node bin/airc.js gfx-check examples/gpu_arena.air --manifest examples/gpu_arena.airgfx.json
node bin/airc.js gfx-check examples/gfx_showcase/showcase.air --manifest examples/gfx_showcase/showcase.generated.airgfx.json
node tools/generate-gfx-fixtures.js --list
node scripts/check_markdown_links.js
node test/layer_guard.test.js
npm test
```

Optional browser host smoke when WebGPU/browser dependencies are available:

```sh
npm --prefix hosts/webgpu test
```
