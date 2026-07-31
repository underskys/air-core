# AIR Host-Composed Demos

Status: public-clean demo layout. Demo source is promoted only after separate
public-safe review.

The demos in this directory are host-composed examples. They are not AIR Core
semantics, AIR ABI, Host ABI, verifier behavior, lowerer behavior, or npm
package authority.

AIR is not a game engine, a 3D engine, or a replacement for TypeScript, Python,
Rust, or host application code. AIR owns bounded deterministic logic,
capabilities and effects, evidence, and output intents. The host owns
rendering, IO, UI, assets, network, GPU/WebGPU/WebGL, audio, hardware, and
platform authority.

The Core npm package remains small. These demos are not included in
`@underskys/air-core` unless a future release explicitly approves package
surface expansion.

## Demo Maturity

| Demo | Maturity | Public-clean status |
| --- | --- | --- |
| [AIR Tetris](air-tetris/README.md) | primary showcase | Layout and boundary docs only; source promotion pending. |
| [AIR Voxel](air-voxel/README.md) | visual/3D host-composition showcase | Layout and boundary docs only; source promotion pending. |
| [AIR World](air-world/README.md) | experimental semantic world showcase | Layout and boundary docs only; source promotion pending. |

## Public-Clean Intake Notes

Existing local/private sources were inspected, but not copied wholesale.

| Demo | Source inspected | Size | Dependencies | Build/check command found | AIR files | Public-safe decision |
| --- | --- | ---: | --- | --- | --- | --- |
| air-tetris | `/Users/sky/DEV/demos/airtris` | 70M | Three.js, Vite, TypeScript | `npm run build`, `npm run air:check` | `air/airtris_core.air`, `air/airtris.air` | Do not copy wholesale: contains `node_modules`, `dist`, generated Wasm, consumer evidence, and prompt material. |
| air-voxel | `/Users/sky/DEV/airlang/demo/voxel-demo` plus public `kits/voxel-basic` | 129M private demo; 4K public kit | Three.js, Vite, TypeScript, Playwright, pngjs | `npm run release:check`, `npm run package:check` | `game/*.air`, generated `*.air`, public kit `kits/voxel-basic/air/voxel.air` | Do not copy private demo wholesale: contains `node_modules`, `dist`, generated Wasm, generated handles, screenshots, and private/dev state. Public kit may inform a later scoped diff. |
| air-world | `/Users/sky/DEV/demos/airworld` | 576K | Browser/HTML demo; local review script | `npm run air:check`, `node review/bundle_checks.js` | Generated/exported AIR at runtime, no stable public source file found in repo snapshot | Do not copy wholesale: contains `REVIEW_RESULTS`, logs, review bundles, prompt evidence, and generated archives. |

Forbidden inputs for this directory include raw review bundles, prompt logs,
private notes, local machine paths inside shipped docs, generated archives,
generated Wasm, `node_modules`, `dist`, `build`, and heavy media.

## Lightweight Checks

Run:

```sh
npm run demo:check
```

The check validates public-clean layout, README boundary language, private demo
package guards, and absence of forbidden generated/private artifacts. It does
not run dev servers, browser builds, or private demo repositories.
