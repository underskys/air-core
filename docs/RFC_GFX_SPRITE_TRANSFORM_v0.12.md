# RFC: GFX Sprite Transform ABI And Sprite Kit Direction for v0.12

Status: draft
Version target: v0.12
Target layer: reusable kit / manifest schema / possible Host ABI

This RFC evaluates sprite-part transform drawing pressure from the Contra
Platformer demo. It does not add public ABI in v0.11 and does not implement a
renderer feature.

The source request is tracked in
[docs/abi-requests/contra-platformer.md](abi-requests/contra-platformer.md).
The original demo notes are in
`demo/contra-platformer/FD_LANGUAGE_REQUESTS.md` in the `demo/contra` branch.

## Current Situation

`demo/contra-platformer/game/platformer.air` emits existing
`gfx.draw_primitive` commands. The browser host maps selected project material
IDs to sprite assets and expands actor-like commands into modular PNG parts in
`demo/contra-platformer/src/modularActorRenderer.ts`.

The requested generic surface is sprite-part drawing with:

- x/y;
- pivot/origin;
- rotation;
- scale;
- alpha;
- mirroring;
- stable draw order.

The portability problem is real, but the current evidence is still mixed with
project-specific player/enemy art, pose names, body-part names, material IDs,
and gameplay rules.

## Recommendation

Defer public `gfx.draw_sprite_transform` for v0.11.

For v0.12, prefer a reusable Sprite Kit plus manifest-driven rig path before
standardizing a public high-level `gfx.*` command. Public GFX ABI remains an
option only after at least one more independent 2D/sprite demo proves the same
generic scalar shape without project vocabulary.

Recommended path:

1. Keep Contra host expansion project-local for v0.11.
2. Draft a neutral sprite kit with sample sprite handles, pivots, alpha, mirror
   flags, z-order, and fallback diagnostics.
3. Define a manifest-rig schema for host-owned sprite parts and rig data.
4. Reconsider public `gfx.draw_sprite_transform` only if the kit/manifest path
   cannot express the generic case cleanly.

## Candidate A: Public `gfx.draw_sprite_transform`

Candidate signature:

```text
gfx.draw_sprite_transform(
  sprite: i32,
  x: i32,
  y: i32,
  w: i32,
  h: i32,
  pivot_x: i32,
  pivot_y: i32,
  rotation_deg: i32,
  scale_x: i32,
  scale_y: i32,
  alpha: i32,
  flags: i32,
  z: i32
) -> void
```

Properties:

- scalar-only ABI;
- `sprite` is a manifest-declared handle, not a DOM, ImageBitmap, Canvas,
  WebGL, WebGPU, native texture, or backend object;
- fixed-point conventions must be specified before acceptance, for example
  `scale_x`/`scale_y` in thousandths and `alpha` in `0..1000`;
- `flags` may include mirror bits, but project pose semantics must not be
  encoded in public flags;
- `z` defines stable ordering within a frame.

Verifier responsibility:

- public ABI exists;
- signature matches exactly;
- module declares `gfx` capability.

App/gfx checker responsibility:

- sprite handle exists in manifest;
- atlas or image asset exists;
- pivot defaults are valid;
- alpha and flags are deterministic;
- z-order is stable;
- fallback/missing asset diagnostics are emitted;
- host limits are reported.

Pros:

- portable and explicit command stream;
- easy to count commands in browser/native hosts;
- keeps pose computation in AIR when desired.

Cons:

- expands public high-level `gfx.*` ABI;
- may be premature with only one demo proving the need;
- can turn project-specific body/pose semantics into generic ABI pressure;
- risks duplicating lower-level `gpu.*` sprite batch paths.

## Candidate B: Sprite Rig Manifest

Model:

- host owns sprite parts, atlases, rig JSON, image decoding, texture upload, and
  backend rendering;
- AIR emits actor state, pose/action handles, facing, phase, and transform;
- manifest maps actor/pose/action handles to sprite parts, pivots, ordering, and
  fallback assets;
- host applies modular animation and reports diagnostics.

Possible AIR command shape, if needed later:

```text
gfx.draw_sprite_actor(
  actor: i32,
  pose: i32,
  x: i32,
  y: i32,
  phase: i32,
  flags: i32,
  z: i32
) -> void
```

This command is not proposed for v0.11. It is included only to explain the
manifest-rig direction.

Manifest responsibilities:

- actor and sprite-part handles;
- part asset paths;
- pivot/origin per part;
- draw order per pose;
- mirror/facing rules;
- fallback assets;
- unsupported rig features.

Pros:

- fewer AIR commands for modular actors;
- host can optimize batching and atlas use;
- keeps asset formats and rig data host/package-owned;
- avoids exposing renderer objects to AIR.

Cons:

- more host behavior;
- stronger manifest schema requirements;
- less explicit draw stream for reviewers unless reports expose expansion.

Required report disclosure:

- actor command count;
- expanded sprite part count;
- rig/atlas handles used;
- fallback assets used;
- unsupported rig features;
- deterministic draw order summary.

## Candidate C: Keep Project-Local

Model:

- Contra keeps `src/modularActorRenderer.ts` as a demo host feature;
- AIR continues to emit existing `gfx.draw_primitive` commands;
- no public ABI or manifest schema changes are made;
- the request remains evidence for v0.12.

Pros:

- safest v0.11 choice;
- no public API drift;
- lets another sprite demo validate the generic shape;
- avoids standardizing project pose/body-part vocabulary.

Cons:

- portability remains limited to this host implementation;
- native/browser behavior may diverge unless the project host code is ported;
- reviewers must inspect demo-specific expansion logic.

## Non-goals

- No DOM, ImageBitmap, Canvas, WebGL, WebGPU, Metal, Vulkan, texture, or sprite
  objects exposed to AIR.
- No demo-specific player, enemy, weapon, body-part, pose, or material names in
  public ABI.
- No public ABI addition in v0.11.
- No hidden host expansion without manifest/report disclosure.
- No production renderer.
- No target packaging implementation.

## Required Tests Before Acceptance

Any accepted v0.12 path must add tests for:

- missing sprite handle fails in gfx/app checker;
- invalid alpha range is rejected or clamped by documented deterministic rules;
- invalid flags are rejected or masked by documented deterministic rules;
- stable draw order for equal and distinct z values;
- missing atlas/image asset reports fallback or failure;
- unsupported rig features report diagnostics;
- browser and native report the same sprite command count or expansion count
  where applicable;
- no project body-part names appear in public ABI or stdlib.

## Decision Matrix

| Candidate | v0.11 decision | v0.12 viability | Risk |
| --- | --- | --- | --- |
| Public `gfx.draw_sprite_transform` | Deferred | Possible after more evidence | High public ABI risk |
| Sprite rig manifest | Deferred | Preferred investigation path | Medium schema/host risk |
| Reusable Sprite Kit | Deferred | Preferred first implementation path | Low if docs/examples only |
| Keep project-local | Accepted for v0.11 | Still valid fallback | Low |

## v0.12 Acceptance Bar

Before public GFX ABI is accepted, reviewers need:

- at least two independent sprite/2D demos proving the same generic transform
  shape;
- manifest handle design for sprite assets and fallback behavior;
- app/gfx checker diagnostics;
- browser/native report agreement;
- migration notes for any new public `gfx.*` function.
