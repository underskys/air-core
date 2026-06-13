# AIR v0.12 Release Gate

Status: active release gate

v0.12 is a package/profile/capability/stdlib-hygiene release. It is not a
v0.13/v0.14/v0.15 feature release.

## Required Gates

| Gate | Command | Required result |
| --- | --- | --- |
| Package-check source/audit mode | `node bin/airc.js package-check <package-dir> --profile browser-webgpu --source-only --json` | Reports manifest, capabilities, imports, audio authority, profile support, hidden authority, and repair hints without requiring wasm. |
| Package-check built mode | `node bin/airc.js package-check <package-dir> --profile browser-webgpu --json` | Requires declared wasm to exist. |
| Audio authority | `node test/host_profiles.test.js` | Direct audio imports require module and package `audio`; assets/debug do not grant authority. |
| Stdlib hygiene | `node test/layer_guard.test.js` | Every `stdlib/*.air` is pure, deterministic, backend-neutral, resource-free, `capabilities { }`, no externs, no Host ABI calls. |
| Markdown docs | `node scripts/check_markdown_links.js` | No broken local links. |
| Full core tests | `npm test` | Passes with source/package gates and stdlib hygiene enforced. |

`node scripts/check_review_bundle.js --keep` is a source-checkout structural
gate. It verifies the archive produced from the source tree, including
`test/fixtures/**/*.air` and tiny review-safe package/asset fixtures. It is not
the command to run from inside an already unpacked bundle.

## Current Watch Items

- Host-authority wrappers have been moved out of `stdlib/`:
  - `kits/gfx-basic/air/gfx3d.air`
  - `kits/gfx-basic/air/scene.air`
  - `kits/ui-basic/air/ui.air`
  - `kits/voxel-basic/air/voxel.air`
- `examples/stdlib-reference/math3d.air` remains an example/reference module,
  not public stdlib.
- `kits/voxel-basic/air/voxel.air` is an experimental reusable kit candidate:
  it requires `gfx`, is not stdlib, is not AIR Core, is not public Host ABI, and
  does not add new `gfx.*` functions.
- Dense voxel chunk rendering remains the RFC/package/`gpu.*`/render-graph
  path. Do not add `gfx.draw_voxel_chunk`; keep terrain, biome, cave, road,
  river, animal, and art-direction helpers demo-local.
- `stdlib/packet.air` now contains only generic bitflag logic.
- TCP-specific flag aliases live in `examples/network_tcp_flags.air` as
  example/kit evidence, not public stdlib.

The release gate is the layer guard: no host capability, host extern, or host
ABI call may appear in `stdlib/*.air`.

## Non-Goals

- No new public AIR Core syntax.
- No new public Host ABI functions.
- No `audio.event` unless fully promoted.
- No player/enemy/game-specific APIs.
- No target bundling or package registry.
- No demos made to pass by polluting stdlib.
- No browser-webgpu profile expansion just to make voxel-demo pass.
