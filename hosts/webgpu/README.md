# AIRGFX WebGPU Host

This package is the Browser WebGPU reference host and browser SDK for AIR GFX
v0.10 packages. It preserves compatibility with v0.9 GFX manifests, but all new
packages should emit v0.10 metadata.

AIR controls raw GPU-style commands, Render Graph handles, and interactive input through `gpu.*` and `input.*` imports. The host owns actual `GPUDevice`, `GPUShaderModule`, `GPURenderPipeline`, scene resources, input event state, render passes, and canvas resources.

The host loads `air-package.json` first. There is no demo fallback: a package
must provide metadata, a wasm module, a manifest, capabilities, and required
imports. Missing host features are reported in the browser conformance JSON as
`unsupported feature: ...` entries instead of being silently treated as fully
implemented.

## Public Proof-of-Concept

The default page is the first public AIR browser proof. It loads the
`examples/gfx_showcase` AIR package, renders visible WebGPU output into a
canvas, and shows a diagnostics panel with:

- package/module loaded;
- manifest / ABI version;
- enabled capabilities;
- backend name;
- loaded assets;
- unsupported host features;
- draw call count.

If WebGPU is unavailable, the page reports the unsupported reason in the same
panel instead of leaving a blank canvas.

AIR GFX packages may compose deterministic `.air` helpers from `stdlib/`,
optional starter resources from `kits/gfx-basic/`, and project-specific assets
from `examples/` or `demo/`. The host treats all of those as package resources
after `gfx-build`; it does not assume reusable shaders live under `stdlib/`.
For example, a development manifest path such as
`kits/gfx-basic/shaders/unlit_mesh.wgsl` is copied into the built package by
`gfx-build` before the browser host loads it.

## Commands

```sh
npm ci
npm run check:air
npm run typecheck
npm run build
npm run smoke
npm run dev
```

From a fresh repository checkout:

```sh
npm ci
cd hosts/webgpu
npm ci
npm run build
npm run dev
```

Open the Vite URL printed by `npm run dev` in a WebGPU-capable browser. The
host builds the AIR package from:

- `../../examples/gfx_showcase/showcase.air`
- `../../examples/gfx_showcase/showcase.generated.airgfx.json`

No hidden local assets are required; `airc gfx-build` copies the package wasm,
manifest, shaders, and assets into `hosts/webgpu/public`.

`npm run smoke` passes in two valid states:

- WebGPU is available and a nonblank screenshot is rendered.
- WebGPU is unavailable and the page reports a clear unsupported status.

The smoke report includes a browser conformance JSON object with:

- supported features;
- unsupported features;
- warnings;
- loaded assets;
- missing assets;
- draw call count and pass counters when WebGPU is available.

## Inputs

The default sample is built from:

- `../../examples/gfx_showcase/showcase.air`
- `../../examples/gfx_showcase/showcase.generated.airgfx.json`
- `../../examples/gfx_showcase/shaders/showcase.wgsl`
- `../../examples/gfx_showcase/assets/*`

## Static Deployment

Build once and publish `hosts/webgpu/dist/` with any static host:

```sh
cd hosts/webgpu
npm ci
npm run build
```

For GitLab Pages, use `hosts/webgpu/dist/` as the published artifact. For
GitHub Pages or generic static hosting, upload the contents of `dist/` so
`index.html`, `air-package.json`, the `.wasm`, `.airgfx.json`, `assets/`, and
`shaders/` remain at the same relative paths.

The page is static after build. There is no server-side runtime beyond ordinary
file hosting with WebAssembly MIME support.
