# AIR v0.12 Demo Status

Status: release evidence

Demos are evidence and pressure tests, not authority for AIR Core, stdlib, or
public Host ABI.

## Contra Platformer

Status: primary v0.12 package demo evidence.

Current intended authority model:

- package capabilities: `audio`, `debug`, `gfx`, `input`;
- AIR imports direct `audio.beep`;
- direct audio import requires module and package `audio`;
- browser host owns actual HTMLAudio/WebAudio playback mechanics;
- audio assets do not grant authority;
- `debug.metric` must remain diagnostic and must not trigger audio.

Required source/audit check:

```sh
node bin/airc.js package-check demo/contra-platformer --profile browser-webgpu --source-only --json
```

Required built check after `public/game.wasm` exists:

```sh
node bin/airc.js package-check demo/contra-platformer --profile browser-webgpu --json
```

Both checks must report direct audio authority for `audio.beep`, valid package
assets, current generated handles, and no hidden authority diagnostics.

Module split note:

- Contra may use package-local `use "./level.air"` and generated handle modules
  as demo pressure evidence.
- v0.12 package-check can analyze the module graph, imported capabilities, and
  host import origins.
- Stable linked multi-module semantics are still experimental; demo module
  split must not be presented as a finalized public AIR contract.

## Voxel Demo

Status: pressure/partial unless its package-check report is made clean for the
selected profile.

Voxel Demo may continue to provide evidence for GFX/package/rendering pressure,
but it must not justify:

- `gfx.draw_voxel_chunk` public high-level ABI;
- demo-specific stdlib helpers;
- material, route, terrain, biome, or art-direction names in Core/stdlib;
- host object handles crossing the AIR boundary.

`kits/voxel-basic/air/voxel.air` is the experimental reusable kit candidate for
generic primitive-stream voxel helpers. It requires `gfx`, remains outside AIR
Core and stdlib, and does not add new `gfx.*` functions. Dense voxel chunk
rendering remains an RFC/package/`gpu.*`/render-graph path. Terrain, biome,
cave, road, river, animal, and art-direction helpers stay demo-local.

## Release Rule

v0.12 Core release gates use package/profile checks, request pipeline checks,
stdlib hygiene, and report determinism. Standalone demo builds remain
project-local checks unless explicitly promoted into Core release evidence.
