# AIR Voxel

Status: experimental alpha demo.

AIR Voxel is the visual/3D host-composition showcase target for bounded voxel
and scene logic composed with host rendering. This public repository currently
contains the public-clean layout and boundary contract only; full source
promotion is a separate review task.

AIR is not a game engine. AIR is not a 3D engine. AIR is not a replacement for
TypeScript, Python, Rust, or host application code.

## What it demonstrates

- Bounded voxel/scene logic that can be verified as AIR before rendering.
- A 3D host that interprets AIR output intents without granting AIR renderer,
  GPU, asset, or platform authority.
- Separation between portable AIR decisions and host-owned 3D presentation.

## What AIR owns

- Bounded deterministic voxel placement, scene decisions, camera/control
  policy where explicitly modeled, capabilities, effects, and evidence.
- AIR source under `air/` after a public-clean promotion.

## What the host owns

- WebGL/WebGPU/Three.js or native rendering, mesh/material creation, texture
  decode, input devices, UI, screenshots, audio, networking, and platform
  authority.
- TypeScript/JavaScript or native host code under `src/` after a public-clean
  promotion.

## Install/build/run commands

Current public-clean layout check:

```sh
npm run demo:voxel:check
```

After source promotion, the expected local demo workflow is:

```sh
cd demos/air-voxel
npm install
npm run check
npm run build
npm run dev
```

## AIR verify/package/check commands

After source promotion, the expected AIR checks are:

```sh
node ../../bin/airc.js verify air/voxel_scene.air
node ../../bin/airc.js audit air/voxel_scene.air
node ../../bin/airc.js package-check . --profile native-wgpu --json
node ../../bin/airc.js report package . --json
```

These commands are documented as the intended public-clean contract. They are
not claimed green until source is promoted and smoke output is recorded under
`evidence/`.

## Known limitations

- Full demo source is not yet promoted into this public repository.
- Existing private/dev voxel demo sources include generated handles, build
  outputs, screenshots, and private/dev state that must not be copied
  wholesale.
- No screenshots are committed yet.
- Not Show HN ready until public-clean source and evidence are reviewed.
