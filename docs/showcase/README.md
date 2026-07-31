# AIR Visual Showcase

Status: public-clean screenshot and demo gallery structure. Screenshots are
added only after safety review.

AIR is a verifier-first language and toolchain for AI-authored deterministic
components. The entries in this gallery show host-composed systems that can use
AIR for bounded logic and evidence while the host owns the application surface.

These screenshots are showcase evidence. They are not proof that AIR is a full
application engine, game engine, 3D engine, AR engine, storage system, or
replacement for Python, TypeScript, Rust, or host application code.

## What These Screenshots Show

The gallery is intended to show how AIR-authored deterministic components can
be composed by hosts into tools, demos, games, simulations, maps, or visual
experiences. A screenshot can show the host UI or renderer, but it must not
claim that AIR owns the host platform.

## AIR vs Host Boundary

AIR owns:

- bounded deterministic logic;
- capabilities and effects;
- table and data semantics inside the accepted AIR surface;
- package checks, evidence, and reports;
- output intents that a host may interpret.

Hosts own:

- UI and user interaction;
- rendering, maps, AR, canvas, WebGPU, WebGL, and GPU execution;
- storage, files, network, sync, and external service access;
- assets, screenshots, audio, hardware, and device APIs;
- platform authority and final product behavior.

## Demo Gallery

| Demo | Status | Screenshot placeholder | Check command |
| --- | --- | --- | --- |
| AIR Control Plane | concept | `docs/showcase/assets/air-control-plane/` | pending |
| Airon | concept | `docs/showcase/assets/airon/` | pending |
| AIR Tetris | alpha layout | `docs/showcase/assets/air-tetris/` | `npm run demo:tetris:check` |
| AIR Voxel | alpha layout | `docs/showcase/assets/air-voxel/` | `npm run demo:voxel:check` |
| AIR World | experimental alpha layout | `docs/showcase/assets/air-world/` | `npm run demo:world:check` |
| TimeRift | concept | `docs/showcase/assets/timerift/` | pending |

## Gallery Entries

### AIR Control Plane

Status: concept.

AIR demonstrates structured task, policy, and release governance. The host or
storage layer may be file sync, Google Drive, or another external system. AIR's
role is bounded policy/checking and evidence, not the UI or storage system.

- What AIR owns: bounded policy checks, release gates, task-state validation,
  evidence summaries, and output intents.
- What the host owns: UI, file sync, document storage, identity, permissions,
  network access, and external service APIs.
- Screenshot path placeholder: `docs/showcase/assets/air-control-plane/`.
- Run/check command: pending public-clean runnable package.
- Known limitations: concept entry only; no screenshot approved yet.

### Airon

Status: concept.

Airon is a browser/WebGPU host demo concept. AIR provides bounded scene, game,
or control logic and evidence. The host owns rendering, input, assets, and GPU
execution.

- What AIR owns: deterministic scene/control decisions, capabilities/effects,
  evidence, and output intents.
- What the host owns: browser APIs, WebGPU/WebGL, renderer, input, assets, and
  runtime presentation.
- Screenshot path placeholder: `docs/showcase/assets/airon/`.
- Run/check command: pending public-clean runnable package.
- Known limitations: concept entry only; no screenshot approved yet.

### AIR Tetris

Status: alpha layout.

AIR Tetris is a deterministic game rules demo. AIR owns board state, piece
movement, collision, and scoring. The host owns rendering, input, UI, and
audio.

- What AIR owns: bounded game rules, board transitions, scoring policy,
  capabilities/effects, evidence, and output intents.
- What the host owns: rendering, animation, input devices, UI, audio, assets,
  browser APIs, and platform authority.
- Screenshot path placeholder: `docs/showcase/assets/air-tetris/`.
- Run/check command: `npm run demo:tetris:check`.
- Known limitations: layout smoke only; public-clean source and screenshot
  evidence are still pending.

### AIR Voxel

Status: alpha layout.

AIR Voxel is a 3D/voxel host-composition demo. AIR owns bounded scene/control
data. The host owns mesh generation, camera, materials, and rendering.

- What AIR owns: deterministic voxel/scene decisions, command intents,
  capabilities/effects, evidence, and package checks.
- What the host owns: mesh generation, camera implementation, renderer,
  materials, textures, GPU/WebGPU/WebGL, input, and assets.
- Screenshot path placeholder: `docs/showcase/assets/air-voxel/`.
- Run/check command: `npm run demo:voxel:check`.
- Known limitations: layout smoke only; public-clean source and screenshot
  evidence are still pending.

### AIR World

Status: experimental alpha layout.

AIR World is a semantic object/world representation experiment. AIR can
describe deterministic object data such as buildings, roads, districts, and
parameters. The host composes and renders the world.

- What AIR owns: bounded object/world data, deterministic parameters,
  capabilities/effects, evidence, and output intents.
- What the host owns: map data, terrain rendering, scene composition, UI,
  assets, network access, files, GPU/WebGPU/WebGL, and platform authority.
- Screenshot path placeholder: `docs/showcase/assets/air-world/`.
- Run/check command: `npm run demo:world:check`.
- Known limitations: experimental layout only; public-clean source and
  screenshot evidence are still pending.

### TimeRift

Status: concept.

TimeRift is an AR/map/time-world concept. AIR owns bounded state transitions
and policy logic. The host owns AR/map rendering, device capabilities, assets,
and user interaction.

- What AIR owns: bounded transition logic, policy checks, capabilities/effects,
  evidence, and output intents.
- What the host owns: AR APIs, map rendering, sensors, device capabilities,
  assets, UI, storage, network, and platform authority.
- Screenshot path placeholder: `docs/showcase/assets/timerift/`.
- Run/check command: pending public-clean runnable package.
- Known limitations: concept entry only; no screenshot approved yet.

## Maturity Labels

- Runnable: public source, repeatable checks, and screenshot evidence are in
  the public repository.
- Alpha: public layout or source exists, but evidence or polish is incomplete.
- Experimental: useful pressure, but not a stable public demo.
- Concept: documented target only; no public-clean runnable source is claimed.

## Known Limitations

- No screenshots are approved in this structure yet.
- Large images are not part of the npm package surface.
- Demo screenshots may show host behavior; they must not imply unsupported AIR
  platform authority.
- Runnable claims require public-clean source and recorded checks.

## How To Run/Check Demos

Current lightweight layout checks:

```sh
npm run demo:check
npm run demo:tetris:check
npm run demo:voxel:check
npm run demo:world:check
```

Full demo build/run commands are added only after the relevant demo source is
public-clean and the screenshot policy is satisfied.

See [Screenshot Policy](SCREENSHOT_POLICY.md) before adding media.
