# AIR World

Status: experimental alpha demo.

AIR World is an experimental semantic object/world representation showcase
target. It explores how AIR-authored deterministic components can describe
bounded world/object decisions while a host owns rendering, maps, UI, IO,
assets, and platform authority.

AIR is not a game engine. AIR is not a 3D engine. AIR is not a replacement for
TypeScript, Python, Rust, or host application code.

## What it demonstrates

- Semantic object and world representation experiments with AIR-owned bounded
  deterministic decisions.
- Host composition around rendering, maps, scene preview, IO, assets, and UI.
- Pressure for future public-clean examples without changing AIR Core
  semantics.

## What AIR owns

- Bounded deterministic object/world decisions that can be represented as AIR
  source after public-clean promotion.
- Capabilities, effects, evidence reports, and output intents.

## What the host owns

- Map data access, rendering, terrain/mesh/material systems, browser APIs, UI,
  file loading, assets, network, GPU/WebGPU/WebGL, audio, and platform
  authority.
- Host adapter code under `src/` after a public-clean promotion.

## Install/build/run commands

Current public-clean layout check:

```sh
npm run demo:world:check
```

After source promotion, the expected local demo workflow is:

```sh
cd demos/air-world
npm install
npm run check
npm run build
npm run dev
```

## AIR verify/package/check commands

After source promotion, the expected AIR checks are:

```sh
node ../../bin/airc.js verify air/air_world.air
node ../../bin/airc.js audit air/air_world.air
node ../../bin/airc.js package-check . --source-only --json
node ../../bin/airc.js report package . --json
```

These commands are documented as the intended public-clean contract. They are
not claimed green until source is promoted and smoke output is recorded under
`evidence/`.

## Known limitations

- Full demo source is not yet promoted into this public repository.
- Existing local airworld sources include review results, logs, review bundles,
  prompt evidence, and generated archives that must not be copied wholesale.
- No screenshots are committed yet.
- Not Show HN ready until public-clean source and evidence are reviewed.
