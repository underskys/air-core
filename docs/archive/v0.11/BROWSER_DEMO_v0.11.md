# AIRLang v0.11 Browser Demo Release Recipe

This is the release-ready path from a clean repository checkout to the v0.11
live browser proof. It uses the existing Browser WebGPU host and
`examples/gfx_showcase`; it does not add target packaging, package registry
behavior, or new public Host ABI.

## Scope

- Host: [hosts/webgpu](../../../hosts/webgpu/README.md)
- Demo package input: [examples/gfx_showcase](../../../examples/gfx_showcase/README.md)
- AIR source: [showcase.air](../../../examples/gfx_showcase/showcase.air)
- Manifest: [showcase.generated.airgfx.json](../../../examples/gfx_showcase/showcase.generated.airgfx.json)
- Host smoke: [smoke.mjs](../../../hosts/webgpu/scripts/smoke.mjs)

The WebGPU host owns WebGPU devices, canvas state, shader modules, model asset
loading, GPU buffers, input events, and diagnostics. AIR references capabilities
and manifest handles; AIR does not parse GLB/glTF or own browser objects.

## Clean Checkout Setup

From the repository root:

```sh
npm ci
cd hosts/webgpu
npm ci
```

The root install is needed for the AIR compiler/test tooling. The WebGPU host
has its own package and lockfile, so install host dependencies inside
`hosts/webgpu` before running browser checks.

## Build And Run Manually

From `hosts/webgpu`:

```sh
npm run build
npm run dev
```

Open the Vite URL printed by `npm run dev`, normally
`http://127.0.0.1:5173/`, in a WebGPU-capable browser.

`npm run dev` first runs:

```sh
node ../../bin/airc.js gfx-build ../../examples/gfx_showcase/showcase.air \
  --manifest ../../examples/gfx_showcase/showcase.generated.airgfx.json \
  --out public
```

That writes the browser-loadable AIR package into `hosts/webgpu/public`.

## CI-Safe Smoke

From `hosts/webgpu`:

```sh
npm run smoke
```

`npm run smoke` is the CI-safe browser proof command. It:

- rebuilds the AIR GFX package into `hosts/webgpu/public`;
- starts Vite on `http://127.0.0.1:4183`;
- opens Chromium through Playwright with WebGPU flags;
- accepts either a rendered WebGPU frame or a clear WebGPU unsupported status;
- fails on blank canvas, missing conformance JSON, missing loaded asset
  diagnostics, missing unsupported/fallback diagnostics, or broken input
  diagnostics.

Full host verification is:

```sh
npm test
```

which runs `check:air`, `build`, and `smoke`.

## Expected Visible Output

When WebGPU is available, the page should show:

- a visible canvas render, not a blank screen;
- the `gfx_showcase` package loaded;
- a model-backed scene using the generated `cube.glb` fixture;
- draw-call state greater than zero;
- input/orbit response after pointer or keyboard interaction.

The smoke test writes a screenshot to:

```text
hosts/webgpu/test-artifacts/airgfx-webgpu-smoke.png
```

when a rendered WebGPU path is available.

## Expected Conformance Panel

The diagnostics panel should expose at least:

- package/module loaded: `gfx_showcase`;
- manifest version: `0.10`;
- AIR ABI version through package metadata;
- enabled capabilities;
- backend: `webgpu`, or a WebGPU unavailable reason;
- loaded asset summary;
- unsupported host feature summary;
- material fallback summary where applicable;
- draw-call count and pass counters when rendering succeeds.

The browser also publishes `globalThis.__airgfxReport` for smoke checks. The
expected report includes:

- `host: "browser"`;
- `backend: "webgpu"`;
- `module: "gfx_showcase"`;
- `abi: "0.10"`;
- `supportedFeatures`;
- `unsupportedFeatures`;
- `loadedAssets`;
- `loadedModelAssets`;
- `missingAssets`;
- `unsupportedGltfFeatures`;
- `materialFallbacks`;
- `render.drawCalls`;
- `inputs` and `input` state.

## Loaded Asset Diagnostics

The v0.11 browser proof must report the generated GLB fixture:

- `loadedAssets` includes `assets/cube.glb`;
- `loadedModelAssets` includes `showcase_block:assets/cube.glb`;
- `missingAssets` is empty for the checked-in showcase package.

Missing model, texture, shader, or manifest paths must appear as diagnostics
instead of producing silent blank output.

## Unsupported Feature Diagnostics

The report and panel should name unsupported or simplified host features. The
current showcase path is expected to include material fallback diagnostics such
as `material fallback used: ...`.

Unsupported GLB/glTF features such as animations, skinning, morph targets,
compressed texture extensions, unsupported primitive modes, or unsupported
required extensions must be reported by the host loader. They do not become AIR
Core semantics or public `gfx.*` functions.

## WebGPU Unavailable Behavior

If WebGPU is unavailable, adapter creation fails, or the browser cannot create a
`webgpu` canvas context, the page must show a diagnostic status in the same
panel. The valid unsupported states include:

- `WebGPU unsupported`;
- `WebGPU adapter unavailable`;
- `WebGPU context unavailable`.

This state is acceptable for CI machines without GPU access as long as the
status is explicit. A blank canvas without diagnostics is a failure.

## Static Hosting

Static publishing is planned as a v0.11 demo deployment path, not target
packaging.

From `hosts/webgpu`:

```sh
npm run build
```

Publish:

```text
hosts/webgpu/dist/
```

The static artifact must preserve the relative layout produced by Vite and
`airc gfx-build`, including `index.html`, JavaScript, WASM, `.airgfx.json`,
`air-package.json`, `assets/`, and `shaders/`.

Suitable hosts include GitLab Pages, GitHub Pages, and ordinary static hosting
with WebAssembly MIME support.

## Release Verification Matrix

| Check | Command | Type | Expected result |
| --- | --- | --- | --- |
| AIR/package manifest check | `npm run check:air` | CI-safe | AIR source and manifest validate. |
| Browser build | `npm run build` | CI-safe | Static site builds into `hosts/webgpu/dist/`. |
| Browser smoke | `npm run smoke` | CI-safe | Nonblank WebGPU render or explicit unsupported status. |
| Full host test | `npm test` | CI-safe | `check:air`, `build`, and `smoke` pass. |
| Manual browser review | `npm run dev` | Manual | Reviewer sees the canvas and diagnostics panel. |

## Non-goals

- No target packaging implementation.
- No package registry.
- No new public Host ABI.
- No new public `gfx.*` functions.
- No GLB/glTF parsing in AIR Core.
- No backend browser/WebGPU objects exposed to AIR.
