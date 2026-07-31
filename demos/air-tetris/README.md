# AIR Tetris

Status: experimental alpha demo.

AIR Tetris is the primary showcase target for deterministic game rules composed
with host rendering and host input. This public repository currently contains
the public-clean layout and boundary contract only; full source promotion is a
separate review task.

AIR is not a game engine. AIR is not a 3D engine. AIR is not a replacement for
TypeScript, Python, Rust, or host application code.

## What it demonstrates

- Deterministic game rules that can be authored in AIR and verified before host
  execution.
- Host-composed rendering, animation, input, UI, and asset loading around AIR
  output intents.
- Evidence-first review of the AIR/host boundary before showcase publication.

## What AIR owns

- Bounded deterministic scoring, timing, rotation, shape, and board-state logic.
- Capabilities, effects, evidence reports, and output intents.
- AIR source under `air/` after a public-clean promotion.

## What the host owns

- Rendering, canvas/WebGL/WebGPU/DOM, input devices, UI, assets, audio,
  networking, persistence, and platform authority.
- TypeScript/JavaScript orchestration under `src/` after a public-clean
  promotion.

## Install/build/run commands

Current public-clean layout check:

```sh
npm run demo:tetris:check
```

After source promotion, the expected local demo workflow is:

```sh
cd demos/air-tetris
npm install
npm run check
npm run build
npm run dev
```

## AIR verify/package/check commands

After source promotion, the expected AIR checks are:

```sh
node ../../bin/airc.js verify air/air_tetris.air
node ../../bin/airc.js audit air/air_tetris.air
node ../../bin/airc.js package-check . --source-only --json
node ../../bin/airc.js report package . --json
```

These commands are documented as the intended public-clean contract. They are
not claimed green until source is promoted and smoke output is recorded under
`evidence/`.

## Known limitations

- Full demo source is not yet promoted into this public repository.
- No screenshots are committed yet.
- No generated Wasm, build output, review bundle, prompt log, or private
  consumer evidence is included.
- Not Show HN ready until public-clean source and evidence are reviewed.
