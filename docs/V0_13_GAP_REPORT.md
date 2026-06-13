# AIR v0.13 Gap Report

Status: current v0.13 closeout report

## Current State

Implemented for v0.13:

- package-local `use "./x.air" as alias` graph validation;
- package-root import safety, including URL/absolute/path escape rejection;
- duplicate alias, duplicate module identity, missing module, and cycle
  diagnostics;
- exported-only cross-module calls and private boundary rejection;
- deterministic module graph, capability origin, host import origin, and
  authority-chain reporting;
- static read-only scalar table first slice;
- generated handle/data module determinism and stale detection;
- AI review warnings for repeated literals, magic handles, table-like patterns,
  and debug metric event-bus smells;
- surface report for active/rejected features;
- review-safe package/profile fixture assets.

## Known Non-Blockers

- Linked multi-module Wasm output is deferred.
- Effect budget composition is report-oriented, not a strict linked-output gate.
- AI review structural warnings are advisory unless a specific blessed fixture
  turns them into a gate.
- Kit vendoring/import mechanics are deferred.
- Contra/platformer migration is separate demo work, not a Core merge blocker.

## Remaining Deferred Work

| Area | Status | Target |
| --- | --- | --- |
| Linked multi-module Wasm | deferred | v0.14+ |
| Kit vendoring/import mechanism | deferred | v0.14+ |
| Sprite/rig manifests | deferred | v0.14+ / RFC |
| Rich audio events | deferred | RFC |
| Effect events | deferred | RFC |
| Browser/native GFX parity for native-only imports | deferred | host profile decision |
| Persistent entity buffers | deferred | RFC |
| Level recipe compiler | deferred | demo/tooling |

## Contra Pressure Classification

Contra Platformer remains pressure evidence, not Core authority.

Classified as v0.13 covered:

- package-check fails clearly on missing or stale generated handle modules;
- generated handle/data modules are deterministic, package-local, stale
  checkable, and authority-free;
- static read-only scalar tables cover the first authored-data slice;
- AI-review warnings can feed package/demo gates when a project opts in;
- `debug.metric` event-bus misuse is detected as a warning/policy violation;
- package-check/report output surfaces capability origins, host import origins,
  authority chains, and stale generated files.

Classified as v0.14+ or RFC:

- linked multi-module Wasm;
- kit vendoring/import model;
- manifest-backed effect events;
- manifest-driven sprite rig/transform path;
- richer audio events/music model;
- level recipe schema to generated AIR tooling;
- fixed entity buffers for slots such as enemies/projectiles;
- stronger host/runtime asset manifest validation.

Rejected for Core/stdlib:

- `draw_actor`;
- `std.gfx3d`, `std.scene`, and `std.voxel`;
- hidden TypeScript gameplay authority;
- `debug.metric` as an effect/audio/gameplay event bus;
- dynamic maps, GC, reflection, runtime imports;
- host object handles.

## Blocker Assessment

No Core blockers are currently known when the release checklist passes.

The v0.13 Core branch must remain free of `demo/contra-platformer/**` changes.
Demo-generated pressure may inform future RFCs, but it must not add public Host
ABI, Core syntax, or stdlib helpers in this release.
