# Contra Platformer Extraction Triage

Source demo/project: `demo/contra-platformer`
Canonical triage location: `docs/abi-requests/contra-platformer.md`

Formal ledger decisions:
[Generated Handle Freshness](../../requests/accepted/generated-handle-freshness.md),
[Contra Platformer Game APIs](../../requests/rejected/contra-platformer-game-apis.md),
[Audio Event Host ABI](../../requests/rejected/audio-event-host-abi.md),
and [Sprite And Modular Actor ABI](../../requests/rejected/sprite-modular-actor-abi.md).

This document records what the Contra Platformer demo proves for AIR v0.11
and what can be extracted without violating the AIR Layer Manifest or Public API
Hygiene.

Demo requests are evidence, not authority. Nothing in this document approves new
public Host ABI, AIR Core syntax, or stdlib semantics by itself.

v0.14 architecture pressure from this demo is summarized in
[V0_14_ARCHITECTURE_REQUEST.md](../V0_14_ARCHITECTURE_REQUEST.md). The demo
remains evidence, not authority.

## v0.13 / v0.14 Pressure Classification

These requests are classified for release planning. They do not grant demo
authority to change AIR Core, stdlib, public Host ABI, or host profiles.

### v0.13 Accepted / Covered

| Request | Classification | Target layer | v0.13 handling |
| --- | --- | --- | --- |
| Missing or stale generated handle modules fail package-check | v0.13 | package-check / generated handles | Covered by generated handle stale/missing diagnostics and review-safe package fixtures. |
| Generated data modules are authority-free deterministic derived artifacts | v0.13 | package tooling | Covered by `generated/assets.air` policy: deterministic, package-local, stale-checkable, and authority-free. |
| Static read-only scalar tables support authored level data | v0.13 | AIR Core first slice | Covered only as scalar, fixed-length, literal, read-only tables with deterministic `table.get`; not a dynamic data system. |
| AI-review budgets can be package/demo gates | v0.13 policy / report | report tooling / release gates | AI-review warnings are deterministic and machine-readable. Core keeps them advisory unless a blessed fixture or project gate opts in. |
| `debug.metric` event-bus misuse is detected | v0.13 | AI review / authority policy | Covered as warning/policy. `debug.metric` remains diagnostic only and must not authorize audio/effects/gameplay. |
| Capability/import origins and stale generated files are clear | v0.13 | package-check / reports | Covered by capability origins, host import origins, authority chains, and generated handle status. |

### v0.14+ Candidates

| Request | Classification | Target layer | Reason deferred |
| --- | --- | --- | --- |
| Linked multi-module Wasm | v0.14+ | lowering/linking | v0.13 verifies and reports graphs only; stable symbol/linking semantics remain deferred. |
| Kit vendoring model | v0.14+ | package/tooling | Kits must not become `std.*` or registry imports without a separate design. |
| Manifest-backed effect event ABI | v0.14+ / RFC | Host ABI / manifest | Needs spec, registry, verifier, profiles, report support, and generic tests. |
| Manifest-driven sprite rig / transform path | v0.14+ / RFC | manifest / reusable kit / possible GFX ABI later | Must stay manifest/kit-first before any public `gfx.*` expansion. |
| Richer audio events/music model | v0.14+ / RFC | Host ABI / audio authority | `audio.beep` remains the active direct import path; richer events need authority and profile design. |
| Level recipe schema to generated AIR tooling | v0.14+ / demo/tooling | tooling / generated AIR | Useful pressure, but not AIR Core syntax or stdlib. |
| Fixed entity buffers RFC for enemy/projectile slots | v0.14+ / RFC | Core/package data model | Requires bounded memory/effect semantics; no demo actor vocabulary in Core. |
| Stronger host/runtime asset manifest validation | v0.14+ | manifest / host validation | Continue strict package validation; runtime host checks need separate host/profile rules. |

### Rejected For Core / Stdlib

| Request | Classification | Reason |
| --- | --- | --- |
| `draw_actor` | rejected | Game-specific ABI; use existing generic draw commands, manifest/kits, or future RFC-backed GFX APIs. |
| `std.gfx3d`, `std.scene`, `std.voxel` | rejected | Host/resource/demo wrappers are not stdlib; use kits or project-local modules. |
| Hidden TypeScript gameplay authority | rejected | AIR/package behavior must declare capabilities and authority; host conventions must not hide gameplay authority. |
| `debug.metric` as effect/audio/gameplay event bus | rejected | `debug.metric` is diagnostic telemetry only. |
| Dynamic maps, GC, reflection, runtime imports | rejected | Outside v0.13 Core model and current AIR safety contract. |
| Host object handles | rejected | DOM, WebAudio, WebGPU/Metal/Vulkan, sockets, files, renderer objects, and platform handles must not cross into AIR. |

## Observed Demo Surface

- AIR module: `demo/contra-platformer/game/platformer.air`.
- Capabilities: `audio`, `debug`, `gfx`, `input`.
- Public imports used: `debug.metric`, `input.axis`, `gfx.begin_frame`,
  `gfx.draw_primitive`, `gfx.end_frame`.
- Host: thin browser canvas/Vite host with keyboard/pointer input, SVG sprite
  assets, optional skeletal sprite assembly experiment, MP3 music playback,
  smoke test, and native `gfx-stream` probe.
- AIR-owned state: world/player position, camera progress, player velocity,
  grounded/drop-through state, invulnerability/hurt timers, bullets, enemy waves,
  pickup state, boss state, score, health, lives, and visible draw commands.
- World model: 480-unit generated segments, one-way scrolling camera, viewport
  activation windows, screen-space draw conversion, deterministic segment seeds,
  and repeated foreground/background layers.

## Universal Extraction Summary

| Area | Verdict | Target layer | Notes |
|---|---|---|---|
| 2D viewport/world coordinate pattern | Useful and generic | Example / reusable kit | Good candidate for an educational `examples/` side-scroller fixture. |
| One-way camera progress and activation window | Useful and generic | Example / possible stdlib after extraction | Keep as pure math if promoted; no platformer names. |
| AABB overlap and projectile/contact checks | Already generic pressure | Stdlib collision/bounds candidate | Only pure rectangle/radius helpers qualify. |
| Segment seed/hash and triangular wave | Generic if renamed and parameterized | Stdlib math/noise/easing candidate | Avoid level/enemy naming. |
| Sprite material IDs and SVG assets | Project-specific | Project kit / possible reusable sprite kit | Do not move material IDs or art direction into stdlib. |
| Skeletal sprite atlas experiment | Potentially reusable | Reusable kit / manifest schema RFC later | Needs manifest/schema design before public standardization. |
| Browser audio policy and music toggle | Host/project behavior | Host implementation / example docs | Not AIR Core, not stdlib, not public ABI in v0.11. |
| Platformer gameplay rules | Project-specific | Project kit | Player, weapons, enemies, pits, pickups, score stay demo-local. |

## Pattern Classification Table

| Pattern | Target layer | Status | Required evidence | v0.11 action |
|---|---|---|---|---|
| 2D viewport bounds and world-to-screen conversion | examples / reusable kit | generic candidate | At least one neutral example that verifies and lowers using existing `gfx.*`, `input.*`, and `debug.metric`; no player/enemy/scoring names. | Document as example/kit pressure only; do not add Core syntax or `gfx.*` camera APIs. |
| Grid/fixed-point helpers | stdlib | already covered by generic policy | Reuse or extend only generic helpers such as `stdlib/grid.air`, `bounds`, `collision`, or `easing`; layer guard must reject platformer/demo vocabulary. | No Contra-specific stdlib promotion; route any helper through the generic stdlib policy. |
| Simple collision/contact helpers | stdlib / examples | generic candidate | Pure rectangle/range/contact examples that lower/run without host imports; names must avoid player, enemy, bullet, weapon, damage, pickup, or platformer semantics. | Keep current demo helpers local; consider future generic `bounds`/`collision` additions only after review against existing stdlib. |
| Sprite kit manifest patterns | reusable kit / manifest schema RFC | deferred | A neutral sprite-kit example with stable asset handles, fallback diagnostics, and no project material IDs; manifest schema changes require separate RFC. | Keep Contra sprite assets, rig JSON, material IDs, and SVG mapping project-local in v0.11. |
| Browser input policy | host implementation / examples | evidence only | Host documentation showing keyboard/pointer mapping into existing `input.axis`; no DOM objects or browser event handles exposed to AIR. | Keep in demo/browser host; no new `input.*` ABI. |
| Deterministic frame/update loop | examples / docs | generic candidate | A neutral AIR module that owns deterministic state and emits existing host commands; smoke evidence for stable command counts. | Use as teaching pattern only; do not promote gameplay lifecycle semantics into Core. |
| Player/enemy names and behavior | project kit | project-local | N/A: names, actor roles, spawn rules, AI, and combat behavior are demo semantics. | Keep local to `demo/contra-platformer`. |
| Shooting rules, projectiles, scoring, health, lives, boss rules | project kit | project-local | N/A: gameplay balance and scoring are product rules. | Keep local; no stdlib or public ABI promotion. |
| Level layout, segment seeds, pits, waterfall sections, art direction | project kit | project-local except generic math | N/A for art/layout; only pure seed/hash/range math can be reconsidered generically. | Keep layout/art local; extract only neutral math if independently justified. |
| Art assets, material IDs, sprite atlases, audio/music behavior | project kit / host implementation | project-local | N/A: assets and browser audio policy are host/project resources. | Keep SVG/PNG/MP3/rig data out of stdlib and public ABI. |

The table classifies evidence only. It does not approve new public ABI,
manifest schema, Core syntax, renderer behavior, or stdlib helpers.

## Request: 2D Scrolling Viewport And Activation Pattern

Status: proposed
Decision: kit-only
Source demo/project: `demo/contra-platformer`
Target layer: examples / reusable kit
Version target: v0.11

## Problem

AIR demos that use 2D worlds need a clear reference for world coordinates,
screen-space viewport conversion, camera progress, and activation windows. The
Contra Platformer demonstrates a useful pattern: AIR owns world state, advances
a one-way camera after the player reaches mid-screen, renders a few segments
ahead, and keeps old waves from reactivating when the player moves backward.

## Current Workaround

The demo implements this directly in `platformer.air` with project names and
gameplay state: `player_world_x`, `camera_x`, `active_segment`, enemy waves,
pickup state, and per-enemy activation/visibility checks.

## Proposed Generic API

No new public API. Extract only an example or reusable kit convention:

- world-space actor position;
- camera progress scalar;
- screen-space conversion `screen_x = world_x - camera_x`;
- activation range checks around a viewport;
- deterministic segment/window setup.

## Why Generic

The pattern applies to side-scrollers, timeline visualizations, map viewers,
2D simulations, data dashboards with horizontal panning, and simple educational
graphics demos. It does not require new AIR Core syntax or host imports.

## Why Not Project-Specific

The camera/viewport math is independent of Contra-specific enemies, weapons,
music, sprites, score, and level art. Those project details must remain in the
demo or a project kit.

## Alternatives

- Keep the whole pattern demo-local.
- Add a small `examples/side_scroller` fixture using existing `input.*`,
  `gfx.*`, and `debug.metric`.
- Later extract pure coordinate helpers to stdlib only if multiple examples need
  exactly the same generic functions.

## Compatibility Risk

Low if kept as example/kit work. Public ABI risk is high only if this is
mistakenly turned into new `gfx.*` camera or sprite commands.

## Non-goals

- Do not add `gfx.scroll_*`, `gfx.camera_2d`, or platformer-specific host ABI.
- Do not add Core syntax.
- Do not promote player, enemy, pickup, score, weapon, music, pit, or route
  semantics into stdlib.
- Do not move SVG/MP3 assets into stdlib.

## Verifier impact

None. Existing verifier behavior is sufficient.

## Host ABI registry impact

None. The demo uses existing `input.axis`, `gfx.draw_primitive`, and
`debug.metric`.

## Manifest / package impact

Optional future kit/example work may document sprite handles and viewport
metadata in a manifest, but v0.11 should not require new manifest fields for
this pattern.

## Conformance tests

If extracted as an example, test that the AIR module verifies, lowers, and emits
stable draw commands with existing imports. A browser smoke test may verify that
camera progress increases and command count remains nonzero.

## Acceptance criteria

- Any extracted example or kit uses only existing public ABI.
- The pattern is documented as example/kit behavior, not public Core semantics.
- Demo names, material IDs, music, enemy behavior, and level art remain
  project-local.

## Request: Generic 2D Bounds And Contact Helpers

Status: proposed
Decision: accepted
Source demo/project: `demo/contra-platformer`
Target layer: stdlib
Version target: v0.11 / future

## Problem

The demo repeats small pure math checks for projectile hits, actor contact,
viewport visibility, and range tests. The useful generic part is rectangle/radius
overlap and scalar range testing, not platformer gameplay.

## Current Workaround

`platformer.air` defines local helpers such as `abs_i32`, `hit_enemy`, and
`touch_enemy`, then combines them with project-specific alive flags, enemy
positions, bullet state, health, and score.

## Proposed Generic API

No immediate API in this task. Candidate future stdlib helpers must use generic
names, for example:

- `bounds.abs_i32` if not already covered by existing math helpers;
- `bounds.in_range_i32(value, center, radius) -> bool`;
- `bounds.aabb_overlap_center_i32(ax, ay, aw, ah, bx, by, bw, bh) -> bool`;
- `bounds.point_in_aabb_center_i32(px, py, cx, cy, half_w, half_h) -> bool`.

Exact names require review against existing `stdlib/bounds.air` and
`stdlib/collision.air` before implementation.

## Why Generic

Bounds/contact helpers are useful for games, UI hit testing, dashboards,
selection rectangles, debug overlays, and simulations.

## Why Not Project-Specific

Only the math is generic. Enemy alive flags, bullet ownership, score changes,
invulnerability, knockback, pickups, and platformer dimensions are
project-specific.

## Alternatives

- Keep all helpers local to each demo.
- Use existing `bounds` or `collision` helpers if they already cover these
  cases.
- Add examples that show composition without adding stdlib functions yet.

## Compatibility Risk

Low if additive and pure. Risk comes from names that encode platformer or
gameplay semantics.

## Non-goals

- Do not add `enemy`, `bullet`, `player`, `weapon`, `pickup`, `platform`, or
  `damage` helpers to stdlib.
- Do not add host ABI.
- Do not add resources or manifests to stdlib.

## Verifier impact

None beyond normal stdlib verification.

## Host ABI registry impact

None.

## Manifest / package impact

None.

## Conformance tests

If implemented later, verify the stdlib module in library mode and add a generic
example that lowers/runs without host imports.

## Acceptance criteria

- Helpers are deterministic, backend-neutral, resource-free, and generic.
- Layer guard does not find platformer/demo vocabulary in stdlib.
- Existing examples remain compatible.

## Request: Sprite Asset And Rig Convention

Status: proposed
Decision: deferred
Source demo/project: `demo/contra-platformer`
Target layer: reusable kit / manifest schema
Version target: future

## Problem

The demo has useful pressure around 2D sprite assets: stable material handles,
SVG sprite replacement, digit sprites, repeated water/platform tiles, audio
assets, and an experimental rigged sprite atlas. Today these are browser-host
project conventions, not AIR package conventions.

## Current Workaround

The TypeScript host imports SVG and MP3 files directly through Vite, maps
material IDs to sprites, and optionally assembles player/enemy sprites from
atlas/rig JSON files. AIR emits only `gfx.draw_primitive` commands with material
IDs, dimensions, and flags.

## Proposed Generic API

No public API in v0.11. A future reusable 2D kit could define:

- sprite handle naming conventions;
- atlas/rig fixture format;
- material-to-asset manifest examples;
- fallback behavior for missing sprites;
- smoke tests for asset availability and nonblank canvas output.

If this becomes a standard manifest feature, it needs a separate manifest schema
RFC.

## Why Generic

2D sprite asset binding is useful for platformers, dashboards with icon sets,
educational simulations, UI overlays, and simple games.

## Why Not Project-Specific

Contra-specific player/enemy art, music, material numbers, weapon levels,
waterfall style, and score digit art are project-specific. The reusable part is
only the asset binding and fallback convention.

## Alternatives

- Keep all sprite mapping in the browser demo host.
- Build a reusable kit with examples but no schema changes.
- Route manifest-level sprite atlas support through a future RFC.

## Compatibility Risk

Medium if manifest schema changes are added. Low if kept as kit/example
documentation.

## Non-goals

- Do not add new `gfx.*` sprite APIs in v0.11.
- Do not put SVG, MP3, atlas files, or rig JSON into stdlib.
- Do not standardize Contra material IDs.
- Do not make the browser host behavior a required AIR runtime feature.

## Verifier impact

None for kit/example work. Future manifest schema changes may need package
checks, but not AIR Core verifier changes.

## Host ABI registry impact

None in v0.11.

## Manifest / package impact

Future candidate: sprite/atlas/rig manifest references and missing asset
diagnostics. This requires separate schema review before implementation.

## Conformance tests

For kit-only work, use browser smoke tests and package asset checks. For future
manifest work, add missing-sprite and unsupported-rig diagnostics.

## Acceptance criteria

- v0.11 keeps sprite binding project-local or kit-local.
- No public ABI or Core changes are introduced.
- Any reusable kit removes Contra names and documents asset fallback behavior.

## Request: Sprite Transform ABI

Status: deferred
Decision: deferred
Source demo/project: `demo/contra-platformer`
Target layer: reusable kit / manifest schema
Priority: P1
Version target: v0.12

## Problem

The modular actor experiment needs sprite-part drawing with x/y, pivot/origin,
rotation, scale, alpha, mirroring, and stable draw order. The current browser
host expands a single AIR actor sprite command into modular PNG parts in
`src/modularActorRenderer.ts`, so AIR does not have a first-class portable
sprite-part transform command.

## Current Workaround

AIR emits existing `gfx.draw_primitive` commands with project material IDs and
flags. The browser host interprets selected material IDs as actor sprites and
applies project-local rig JSON, PNG part assets, pose rules, and draw ordering.

## Proposed Generic API

No public API in v0.11. The v0.12 design space is captured in
[RFC_GFX_SPRITE_TRANSFORM_v0.12.md](../RFC_GFX_SPRITE_TRANSFORM_v0.12.md):

- Candidate A: public scalar `gfx.draw_sprite_transform` ABI;
- Candidate B: manifest-driven sprite rig system;
- Candidate C: keep the current behavior project-local until more evidence
  exists.

Spec impact: not required for v0.11. A public `gfx.draw_sprite_transform`
candidate would require a future GFX ABI spec update before implementation.

## Why Generic

Sprite-part transforms are useful outside this demo: 2D actors, educational
simulations, UI mascots, animated dashboards, and sprite-heavy examples can all
need deterministic draw order, pivots, mirroring, alpha, and fallback assets.

## Why Not Project-Specific

Player/enemy names, body-part names, weapon recoil rules, pose names, material
IDs, art assets, and rig files are project-specific. Only the transform contract
or manifest convention may be generic.

## Alternatives

- Keep host-side expansion project-local for v0.11.
- Promote a reusable Sprite Kit with manifest examples and diagnostics.
- Add manifest-level rig declarations before adding a public `gfx.*` command.
- Add public GFX ABI only after another independent 2D/sprite demo proves the
  same scalar shape.

## Compatibility Risk

High if added directly to public `gfx.*` in v0.11. Medium if routed through a
manifest schema. Low if kept as project-local evidence or reusable kit draft.

## Non-goals

- Do not expose DOM, ImageBitmap, Canvas, WebGL, WebGPU, or native sprite objects
  to AIR.
- Do not add demo-specific player, enemy, body-part, weapon, or material names
  to public ABI.
- Do not add public ABI in v0.11.
- Do not allow hidden host expansion without manifest/report disclosure.

## Verifier impact

None in v0.11. If public `gfx.draw_sprite_transform` is accepted later, the
verifier checks only ABI existence, scalar signature, and `gfx` capability.

## Host ABI registry impact

None in v0.11. A public command would require the full Host ABI registry path:
spec, registry, verifier, SDK, conformance report, tests, and migration notes.

## Manifest / package impact

Likely needed before public ABI acceptance. The app/gfx checker should validate
sprite handles, atlas/rig references, pivot defaults, alpha range, z-order, and
fallback asset diagnostics.

## Conformance tests

Before acceptance, tests must cover missing sprite handles, invalid alpha/flags,
stable draw order, browser/native command count agreement where applicable, and
missing asset fallback diagnostics.

## Acceptance criteria

- v0.11 keeps this request as evidence only.
- The v0.12 RFC recommends a sprite kit / manifest-rig path before public ABI.
- No public GFX ABI is added from this request.

## Request: Asset Manifest / Bundle Support

Status: accepted
Decision: accepted as RFC
Source demo/project: `demo/contra-platformer`
Target layer: manifest schema / host implementation
Priority: P1
Version target: v0.12

## Problem

The demo needs repeatable ingestion and validation for sprites, backgrounds,
audio, rigs, and manifests. Runtime assets must exist, fallback behavior must be
explicit, and legacy fallback assets must not be silently selected.

## Current Workaround

The browser host imports assets directly through Vite and project-local JSON.
Some fallback behavior is encoded in host code rather than a canonical package
manifest, so reviewers must inspect the demo host to know which asset is primary
and which fallback was selected.

## Proposed Generic API

No AIR Core API. The v0.12 design is a package asset manifest and validation
workflow captured in [RFC_ASSET_MANIFEST_v0.12.md](../RFC_ASSET_MANIFEST_v0.12.md).
It defines asset classes, required fields, explicit fallback policy, host profile
constraints, audio authority linkage, and sprite rig linkage.

## Why Generic

Repeatable asset ingestion applies to browser demos, native hosts, UI tools,
graphics showcases, and generated examples. The generic need is asset existence,
type validation, fallback disclosure, and host support diagnostics.

## Why Not Project-Specific

Contra sprite names, background art, MP3 files, rig part names, and material IDs
remain project-local. Only the manifest/validation contract is generic.

## Alternatives

- Keep all asset loading project-local.
- Extend only `.airgfx.json` asset sections.
- Add a package-level asset manifest and let host-specific manifests reference
  it.

## Compatibility Risk

Medium. Manifest validation can improve reviewability, but a schema change must
avoid turning project asset conventions into AIR Core semantics.

## Non-goals

- Do not implement package registry or deployment bundling.
- Do not download remote assets.
- Do not scrape assets automatically.
- Do not expose host asset objects to AIR.
- Do not make asset existence grant audio authority.

## Verifier impact

None. AIR Core verifier does not parse assets.

## Host ABI registry impact

None. Asset manifests do not define public host imports.

## Manifest / package impact

Add v0.12 manifest/package validation for asset existence, type matching,
explicit fallback policy, missing required assets, optional asset warnings, host
profile constraints, and unsupported feature diagnostics.

## Conformance tests

Before implementation, add tests for missing required assets, optional fallback
warnings, rejected silent fallback, unsupported asset class diagnostics, and
audio asset declarations that do not grant audio playback authority.

## Acceptance criteria

- Asset manifest RFC is the canonical v0.12 design.
- No v0.11 implementation or public ABI change is implied.
- Contra asset behavior is represented as evidence, not authority.

## Request: Module Split / Imports

Status: proposed
Decision: RFC only
Source demo/project: `demo/contra-platformer`
Target layer: core
Priority: P1
Version target: v0.12

## Problem

`game/platformer.air` is large and mixes player, enemy, collision, render, and
state helpers in one file. AIR needs a stable way to split large generated
modules while preserving capability review and deterministic lowering.

## Current Workaround

The demo keeps all logic in one AIR module. This avoids resolver complexity but
makes review, generated-code repair, and helper reuse harder.

## Proposed Generic API

No implementation in this task. The v0.12 design is captured in
[RFC_CORE_MODULE_SPLIT_v0.12.md](../RFC_CORE_MODULE_SPLIT_v0.12.md), including
relative imports such as `use "./player.air"`, exported functions, private
helpers, module-level capabilities, package-level capability union, and audit
origin reporting.

## Why Generic

Large AIR modules are expected in games, graphics demos, UI tools, and
AI-generated utilities. Module splitting improves reviewability without adding
host ABI functions or demo-specific stdlib helpers.

## Why Not Project-Specific

The split points in Contra are project-specific, but the resolver, visibility,
capability union, and audit origin rules are generic Core concerns.

## Alternatives

- Keep all large modules single-file.
- Use generator-side includes before AIR parsing.
- Defer imports until v0.12 package manifests are stable.

## Compatibility Risk

Medium to high. Resolver behavior affects parser, formatter, verifier, audit,
and lowering. v0.12 should start with a minimal acyclic relative import slice.

## Non-goals

- Do not add package registry or remote imports.
- Do not add dynamic imports or runtime module loading.
- Do not add NPM-like dependency resolution.
- Do not let imported modules silently add host authority.
- Do not implement this in v0.11.

## Verifier impact

Future verifier work must validate dependency graph, duplicate module names,
cycle rejection, export visibility, name collisions, capability origin by
module, and strict Host ABI imports across the package.

## Host ABI registry impact

None. Module split does not define new host imports.

## Manifest / package impact

Package-check/audit should report entry module, imported modules,
package-level capability union, capability origins, and host imports by module.

## Conformance tests

Before implementation, add tests for pure helper imports, imported extra
capability reporting, cycle rejection, duplicate export rejection, deterministic
lowering, and audit listing imported capabilities.

## Acceptance criteria

- v0.12 RFC is canonical.
- No compiler behavior changes are made in v0.11.
- Imported modules cannot hide host authority.

## Request: Fixed Data Structures

Status: proposed
Decision: RFC only
Source demo/project: `demo/contra-platformer`
Target layer: core
Priority: P1
Version target: v0.12

## Problem

The demo uses repeated fixed-slot code such as `enemy0_alive`,
`enemy1_alive`, `enemy2_alive`, repeated HP globals, repeated base positions,
and repeated update/draw logic. Generated AIR needs safer ergonomics for fixed
entity slots, static tables, and readable records without dynamic objects.

## Current Workaround

The AIR module expands each slot manually with separate globals and scalar
operations. Existing internal arrays and structs help some cases, but static
tables, enum-like handles, and module-level constants are not yet ergonomic.

## Proposed Generic API

No implementation in this task. The v0.12 design is captured in
[RFC_CORE_FIXED_DATA_STRUCTURES_v0.12.md](../RFC_CORE_FIXED_DATA_STRUCTURES_v0.12.md).
It evaluates module-level scalar constants, enum-like handles, static read-only
tables, fixed-size arrays, records/structs, and deterministic fixed-range loops.

## Why Generic

Fixed slots and static data are useful for graphics examples, UI dashboards,
network fixtures, simulations, and generated game logic. The generic need is
deterministic data ergonomics, not platformer-specific entities.

## Why Not Project-Specific

Enemy/player/bullet/weapon/score/boss semantics stay in the demo. Core may only
provide neutral fixed data structures and deterministic iteration.

## Alternatives

- Keep generated code fully expanded.
- Improve generator templates without Core syntax.
- Use existing arrays/structs where they are already sufficient.
- Start with constants/static tables only and defer broader ergonomics.

## Compatibility Risk

High if implemented broadly. Low to medium if the first v0.12 slice is limited
to module-level scalar constants and static read-only scalar tables.

## Non-goals

- Do not add JS/Python-like objects.
- Do not add heap-managed object systems, maps, or generics.
- Do not use host ABI as a workaround for source ergonomics.
- Do not add demo-specific entity syntax.
- Do not patch Core syntax in v0.11.

## Verifier impact

Future verifier work must enforce static sizes, immutable constants/tables,
known table lengths, deterministic iteration bounds, composite ABI boundaries,
and clear diagnostics for rejected dynamic structures.

## Host ABI registry impact

None. Fixed data structures are Core/source ergonomics, not host imports.

## Manifest / package impact

None for the minimal Core slice. Reports/audit may add read-only data byte
accounting and source references.

## Conformance tests

Before implementation, add tests for constants, static tables, table length
mismatch, static and dynamic bounds checks, deterministic lowering, audit byte
accounting, and rejection of composite host/export boundaries.

## Acceptance criteria

- v0.12 RFC is canonical.
- No compiler behavior changes are made in v0.11.
- No host ABI or demo-specific syntax is introduced.

## Request: Audio Capability Enforcement

Status: accepted
Decision: accepted
Source demo/project: `demo/contra-platformer`
Target layer: manifest schema / host implementation
Priority: P0
Version target: v0.11

## Problem

The demo shows a practical browser issue: music must start after user
interaction because of autoplay rules. The host tracks local preference and
exposes status through the HUD.

## Current Workaround

The TypeScript host loads `Jungle-1.mp3`, `Jungle-2.mp3`, and
`Jungle-boss.mp3`. The first two tracks play as the Stage 1 playlist, and the
boss track replaces the playlist when the AIR module reports boss state through
`debug.metric(8)`. Playback starts on keyboard/pointer interaction, persists a
local preference, and keeps AIR unaware of the browser audio object.

The module-driven SFX bridge also reacts to AIR-derived metric deltas such as
enemy count, bullet activity, score, weapon level, health, and ammo. This must
not be treated as authorized by `debug`; `debug.metric` exposes telemetry only.

## Proposed Generic API

No new AIR API. v0.11 validates the package/runtime boundary instead:

- direct `audio.*` AIR imports require the existing `audio` capability;
- host playback driven by AIR state or `debug.metric` requires either module
  `audio` capability or host-owned audio authority in the app/package manifest;
- host-owned manifest authority must list trigger sources.

## Why Generic

Browser autoplay policy affects many demos, but AIR should not own DOM audio
objects or browser permission state.

## Why Not Project-Specific

The policy lesson is generic, but the asset and music behavior are
project-specific.

## Alternatives

- Keep audio entirely project-local but require explicit host-owned manifest
  authority.
- Later define audio host ABI only through a dedicated audio capability RFC.

## Compatibility Risk

Low if documented as project behavior. High if it is accidentally treated as
AIR Core or standard ABI.

## Non-goals

- Do not add new `audio.*` functions from this demo.
- Do not add hidden network/file/audio access.
- Do not make MP3 playback part of AIR stdlib.
- Do not let `debug.metric` authorize audio playback.

## Verifier impact

None for new ABI. The verifier already enforces the existing `audio` capability
for direct `audio.*` imports.

## Host ABI registry impact

None. No new public audio ABI is added.

## Manifest / package impact

The platformer audio manifest declares host-owned audio authority and trigger
sources. `airc audio-check` and `airc report --audio-manifest` expose
`audio.used`, `audio.source`, `audio.triggers`, `audio.authority`, and
`audio.status`.

## Conformance tests

Project smoke tests must run the audio authority check before browser playback.
Core tests cover missing authority, manifest authority, explicit module
capability, and the rule that `debug` alone does not grant audio.

## Acceptance criteria

- Audio remains host/project-owned and browser-owned audio objects are not
  exposed to AIR.
- The AIR module or package manifest declares explicit audio authority before
  host playback can be driven by AIR-derived state.
- No public audio ABI is added from this request.
