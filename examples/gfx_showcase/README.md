# AIR GFX Showcase

This package is the first polished AIR GFX showcase. It demonstrates the intended split:

- AIR owns verified behavior and scalar commands.
- The manifest owns assets, materials, render graph, input bindings, collision metadata, and quality profiles.
- The host owns WebGPU/wgpu/Metal/Vulkan/D3D execution, shader compilation, real asset loading, and actual rendering.

It is not a Unity replacement. AIR is the small portable module layer that an AI can generate and a verifier can audit. Editors, real GPU resources, platform APIs, asset importers, and renderer internals stay in hosts and build tools.

## Build-Time Flow

```sh
node tools/scene-compiler.js \
  --layout examples/gfx_showcase/showcase.layout.json \
  --manifest examples/gfx_showcase/showcase.airgfx.json \
  --out examples/gfx_showcase/showcase.generated.airgfx.json \
  --debug true

node bin/airc.js verify examples/gfx_showcase/showcase.air
node bin/airc.js gfx-check examples/gfx_showcase/showcase.air \
  --manifest examples/gfx_showcase/showcase.generated.airgfx.json
```

The scene compiler is build-time tooling. It expands layout groups into deterministic scene instances, assigns handles, preserves collision/interactions metadata, and emits `.airgfx.json`. It does not add AIR Core syntax.

## Package Build

```sh
node bin/airc.js gfx-build examples/gfx_showcase/showcase.air \
  --manifest examples/gfx_showcase/showcase.generated.airgfx.json \
  --out build/gfx_showcase

node bin/airc.js package-check build/gfx_showcase
```

To try it in the browser WebGPU host:

```sh
npm ci
cd hosts/webgpu
npm ci
npm run dev
```

The current browser host renders a deterministic placeholder scene for unsupported renderer features and reports them in its conformance report as `unsupported feature: ...`. That is intentional: missing backend support must be visible, not silently ignored.

For a static public proof-of-concept:

```sh
cd hosts/webgpu
npm ci
npm run build
```

Publish `hosts/webgpu/dist/` to GitLab Pages, GitHub Pages, or any static host.
The built page includes a canvas, visible output, package diagnostics,
capabilities, loaded assets, unsupported feature reporting, and draw-call
counts.

This showcase is project/example content. It may reuse generic AIR helpers from
`stdlib/` and starter resources from `kits/gfx-basic/`, but its art direction,
asset keys, layout, and materials stay under `examples/gfx_showcase/`.

## Demonstrated Surface

- skybox/environment pass;
- glTF placeholder model references;
- instanced scene geometry generated from layout JSON;
- PBR-lite material records with albedo, normal, ORM, and emissive slots;
- depth target plus scene/post/present render graph;
- bloom and tone-map reference post effects;
- camera matrix handoff through `gpu.set_camera_matrix`;
- keyboard/mouse input bindings;
- collision layers, colliders, triggers, and interaction metadata;
- debug metadata emitted by the scene compiler.
