# AIR v0.12 Current Audit

Status: current-state audit

Date: 2026-05-15

Branch audited: `air-v0.12-package-profile-core-ergonomics`

Scope:

- AIR core/toolchain repository.
- Current `demo/contra-platformer` state in this worktree.
- Current demo pressure evidence where it affects v0.12 closure.

This audit is intentionally not an implementation plan for later roadmaps. It
does not approve demo-specific Core APIs, game-specific Host ABI, or broad AIR
Core expansion.

## Snapshot Notes

The worktree was not clean at audit time. There were active parallel changes in
`demo/contra-platformer` and `demo/voxel-demo`. This report treats those files
as current evidence, not as release-gate source truth.

Commands used:

```sh
node bin/airc.js report demo/contra-platformer/game/platformer.air --json
node bin/airc.js package-check demo/contra-platformer --profile browser-webgpu --json
node bin/airc.js package-check demo/voxel-demo --profile browser-webgpu --json
wc -l demo/contra-platformer/game/platformer.air demo/contra-platformer/src/*.ts demo/contra-platformer/src/levels/*.air
npm test
```

Current test status:

- `node scripts/check_markdown_links.js`: pass.
- `node scripts/check_review_bundle.js --keep`: pass after changing audit links
  to concrete files rather than review-bundle-omitted directories.
- `npm test`: currently fails on the stricter stdlib hygiene gate because
  host-authority wrappers still live in `stdlib/`. The earlier audio authority
  drift has been resolved in favor of the accepted direct-import model:
  `audio.beep` is a direct AIR audio import requiring `audio` capability.

## 1. Current v0.12 Status

| Area | Status | Evidence | Gap |
| --- | --- | --- | --- |
| Package manifest | implemented | [spec/AIR_PACKAGE_MANIFEST.md](../spec/AIR_PACKAGE_MANIFEST.md), [src/package_manifest.js](../src/package_manifest.js), [test/package_manifest.test.js](../test/package_manifest.test.js) | Built-mode packages still require concrete wasm artifacts; this is correct but needs clearer fixture discipline. |
| Host profiles | implemented | [spec/HOST_PROFILES.md](../spec/HOST_PROFILES.md), [src/host_profiles.js](../src/host_profiles.js), [browser-webgpu.json](../data/host_profiles/browser-webgpu.json) | Profile limits are schema-validated but not deeply enforced against all package resource counts. |
| `package-check --profile` | implemented | [src/sdk.js](../src/sdk.js), [test/host_profiles.test.js](../test/host_profiles.test.js) | Compatibility is strong for capabilities/imports/manifests/assets, partial for limits and domain-kit validation. |
| Asset manifest validation | implemented | [spec/ASSET_MANIFEST.md](../spec/ASSET_MANIFEST.md), [src/asset_manifest.js](../src/asset_manifest.js), [test/asset_manifest.test.js](../test/asset_manifest.test.js) | Runtime host consumption is still host-owned; validation does not prove renderer/audio behavior. |
| Generated handles | implemented | [src/handle_generator.js](../src/handle_generator.js), [test/handle_generator.test.js](../test/handle_generator.test.js), [package manifest example README](../examples/package_manifest/README.md) | Handles reduce magic IDs only when packages actually import/use generated modules. |
| Module constants | implemented first slice | [spec/AIR_CORE.md](../spec/AIR_CORE.md), [examples/module_constants.air](../examples/module_constants.air), [test/run.js](../test/run.js) | Helps scalar literals; does not solve repeated slot/table data. |
| Module graph analysis | partially implemented | [src/module_graph.js](../src/module_graph.js), [test/module_graph.test.js](../test/module_graph.test.js) | Graph/report only. No linked output, no cross-module calls, no symbol linking. |
| Static scalar tables | documented, not enforced | [docs/RFC_CORE_STATIC_TABLES_v0.12.md](RFC_CORE_STATIC_TABLES_v0.12.md), [docs/FEATURE_STATUS_v0.12.md](FEATURE_STATUS_v0.12.md) | Needed for entity slots and level tables, but still RFC-gated. |
| Audio authority | partially implemented | [src/audio_authority.js](../src/audio_authority.js), [docs/RFC_AUDIO_EVENTS_v0.12.md](RFC_AUDIO_EVENTS_v0.12.md), [test/host_profiles.test.js](../test/host_profiles.test.js) | `audio.beep` exists; `audio.event` remains rejected. Host can still make presentation/effect decisions from metrics. |
| Anti-slop report | implemented as advisory | [src/ai_review.js](../src/ai_review.js), [test/report.test.js](../test/report.test.js) | Mostly warnings. It exposes slop but does not yet block large safe-but-unreviewable modules. |
| Layer guard/public hygiene | implemented | [test/layer_guard.test.js](../test/layer_guard.test.js), [docs/PUBLIC_API_HYGIENE.md](PUBLIC_API_HYGIENE.md), [docs/STDLIB_POLICY.md](STDLIB_POLICY.md) | Must keep expanding public-surface scans as package schemas/RFCs grow. |
| Target packaging | documented only | [docs/TARGET_PACKAGING_MODEL.md](TARGET_PACKAGING_MODEL.md) | Correctly not implemented in v0.12 closure scope. |
| LSP/live URL | missing or not release-proven | [docs/ROADMAP_v0.12.md](ROADMAP_v0.12.md) lists it as an adoption blocker | No evidence in this audit of an LSP MVP or stable live demo URL gate. |

## 2. Capabilities Audit

### Contra Platformer Package

`demo/contra-platformer/air.package.json` declares:

- `audio`
- `debug`
- `gfx`
- `input`

`package-check --profile browser-webgpu` reports:

- status: `pass`
- computed capabilities: `audio`, `debug`, `gfx`, `input`
- host imports used:
  - `audio.beep`
  - `debug.metric`
  - `gfx.begin_frame`
  - `gfx.draw_primitive`
  - `gfx.end_frame`
  - `input.axis`
- unsupported host imports: none
- hidden authority diagnostics: one audio-authority entry noting that the audio
  manifest declares AIR-driven audio behavior.

The AIR module itself reports audio as:

- `audio.used`: `true`
- `audio.source`: `direct-import`
- `audio.triggers`: `audio.beep`
- `audio.authority`: `module capability`
- `audio.status`: `pass`

### Audio Handling

Current state is better than the earlier v0.11 gap:

- `game/platformer.air` declares `audio`.
- `air.package.json` declares `audio`.
- `assets/manifests/active/audio.json` declares host-owned authority and
  explicitly says `debug.metric` must not drive audio.
- AIR emits `audio.beep` with package-local generated audio handle IDs.

Remaining issue:

- `src/music.ts` and `src/main.ts` still own real `HTMLAudioElement` playback,
  user gesture retry, playlist behavior, and presentation state.
- `startAudioForCurrentState()` can start audio from UI/user state.
- `processAudioEvents()` maps AIR audio handle IDs to host playback.
- This is acceptable as host-owned execution only if the manifest remains
  explicit and package-check keeps requiring `audio`.

Answer: with the current package, audio should not pass package-check without
the `audio` capability. However, host code still has independent audio paths
that must remain covered by host-owned authority and user-gesture policy.

### Debug Metrics

`debug.metric` is currently used for telemetry and host HUD/effects inputs:

- enemies alive
- bullet active
- camera X
- score
- weapon level
- health
- enemy bullet active
- boss active
- lives
- ammo
- player in water
- game state

Risk:

- `src/main.ts` uses `host.metrics` to drive presentation decisions:
  - HUD text;
  - parallax/decor placement;
  - sprite rig pose/recoil;
  - projectile trails;
  - explosions and water voxel effects in `updateRendererFx()`.
- This is not direct audio authority now, but it is still a hidden convention
  channel for visual/effect behavior.

v0.12 closure should not make `debug.metric` a stable event bus. Host-side
effects derived from metrics should be either documented as demo-local
presentation behavior or migrated to explicit capability-qualified events after
RFC/spec acceptance.

### Voxel Demo Secondary Finding

Current dirty `demo/voxel-demo` fails `package-check --profile browser-webgpu`:

- unsupported imports:
  - `gfx.camera_look_at`
  - `gfx.skybox_world`
- unsupported manifest kind:
  - `host-contract`
- module graph errors:
  - unknown `gfx3d.primitive_flags`
  - unknown `noise.hash2`

This is demo evidence, not a Core release blocker, but it shows that package
profile checks are useful and should stay strict.

## 3. Host Boundary Audit

### Behavior In AIR

`demo/contra-platformer/game/platformer.air` currently owns substantial behavior:

- input sampling through `input.axis`;
- player position, velocity, health, lives, invulnerability, water state;
- title/play/fade state;
- scrolling camera state;
- enemy and projectile state;
- collision-like checks;
- score/ammo/weapon state;
- audio event decisions via `audio.beep`;
- primitive render stream via `gfx.draw_primitive`;
- telemetry via `debug.metric`.

### Behavior In Host TypeScript

`demo/contra-platformer/src` owns:

- browser input mapping and pointer aim;
- Wasm loading;
- DOM/HUD text;
- Canvas rendering;
- asset imports and fallback images;
- sprite images, sprite rig interpretation, modular actor rendering;
- parallax background, decorations, water, foreground vegetation;
- projectile line FX, explosion FX, water voxel FX;
- `HTMLAudioElement` playback and browser audio policy;
- host metric decoding from numeric debug IDs;
- localStorage preferences.

### Pure Adapter vs Decision-Making Host Code

Mostly pure adapter:

- `demo/contra-platformer/src/airHost.ts` in the `demo/contra` branch
  maps host imports to arrays/metrics/events.
- Wasm loading in `loadAirModule()`.

Host code that makes demo/product decisions:

- `demo/contra-platformer/src/main.ts` in the `demo/contra` branch
  maps material IDs to sprites and gameplay extras.
- `render()` decides whether a frame is title/gameplay by checking primitive
  and material IDs.
- `updateRendererFx()` spawns visual effects from changes in debug metrics.
- `resolveActorState()` chooses sprite rig states from debug metrics and
  primitive flags.
- `demo/contra-platformer/src/music.ts` in the `demo/contra` branch
  owns playlist/track behavior.

### Hidden Conventions

Current hidden conventions between AIR and host include:

- numeric material IDs such as `MAT_PLAYER`, `MAT_TITLE_BG`, `MAT_FADE_BLACK`;
- numeric metric IDs `1..12`;
- primitive kind `2` means sprite;
- host reads `cmd.material === 20` as player/gameplay signal;
- host reads `cmd.material === 60` as title frame signal;
- host derives rig animation state from primitive flags and metrics;
- host derives FX from metric transitions.

These are acceptable as demo-local conventions but should not enter AIR Core,
stdlib, or public Host ABI.

## 4. AIR/Host Ownership Report

Measured LOC:

| Area | LOC |
| --- | ---: |
| `demo/contra-platformer/game/platformer.air` | 1848 |
| `demo/contra-platformer/src/levels/*.air` | 712 |
| Total AIR demo source counted | 2560 |
| `demo/contra-platformer/src/*.ts` | 2751 |

Largest host files:

| File | LOC | Ownership |
| --- | ---: | --- |
| `src/main.ts` | 2036 | Browser app, rendering, assets, HUD, effects, audio event processing. |
| `src/spriteAssembler.ts` | 217 | Host sprite assembly support. |
| `src/modularActorRenderer.ts` | 164 | Host-owned sprite rig renderer. |
| `src/music.ts` | 154 | Host-owned audio playback and playlist policy. |
| `src/airHost.ts` | 120 | Wasm import adapter and metric/event bridge. |

Major logic owned by AIR:

- game state update;
- collision-ish scalar checks;
- projectile/enemy/boss state;
- score/health/ammo/lives;
- audio event selection;
- primitive draw commands.

Major logic still owned by host:

- asset selection and loading;
- sprite rig interpretation;
- visual effects;
- HUD formatting;
- parallax/decor rendering;
- actual audio playback;
- user gesture/browser policy;
- metric-to-presentation mapping.

Target ownership for v0.12 closure:

- AIR package should own declared behavior, capabilities, imports, generated
  handles, and manifest references.
- Host should own browser mechanics, actual media playback, Canvas/WebGPU, and
  asset decoding.
- Any host behavior derived from AIR telemetry must be disclosed as demo-local
  or promoted through request/RFC/spec/report/tests.

## 5. Slop Audit

### Contra Platformer

`package-check` AI review status: `fail`

Main structural findings:

- `game/platformer.air`: 1848 LOC.
- One exported `frame` function has 1141 statements and 1 block.
- 105 module constants.
- 66 globals.
- 291 `select.*` operations.
- 12 `debug.metric` calls.
- 7 `input.axis` calls.
- 2 direct `gfx.draw_primitive` call sites, mostly behind local draw helpers.
- 1 direct `audio.beep` call site behind `emit_audio_if`.
- 78 AI-review warnings in package-check.

Top repeated literals in `game/platformer.air`:

| Literal | Count | Likely fix |
| --- | ---: | --- |
| `2` | 1963 | Many are type suffixes/noise from current textual scan; use report-aware filtering before gating. |
| `3` | 55 | constants/tables where semantic. |
| `24` | 22 | constants or table data. |
| `16` | 21 | constants or table data. |
| `5` | 19 | constants or table data. |
| `12` | 17 | constants or table data. |
| `18` | 15 | constants or table data. |
| `9` | 14 | constants or table data. |
| `58` | 12 | constants or table data. |
| `34` | 9 | constants or table data. |

Indexed/repeated slot patterns:

- `e0_`, `e1_`, `e2_` enemy slot families.
- `enemy_bullet_*` slot state.
- `bullet_after*` chain.
- `hit*`, `touch*`, `water_x*`, `top*`.
- repeated `select.i32` chains used as tables.

Suspicious mixed concerns:

- `frame` mixes input sampling, title/menu state, physics, collision, combat,
  audio event choice, render command emission, and debug metrics.
- Host `main.ts` then mixes command rendering, HUD, animation state, FX, asset
  selection, and audio processing.

Unused/broad surface:

- `package-check` reports generated handles current.
- It also reports no unsupported imports for Contra.
- AI review still flags unused import/declaration debt in some contexts; this
  should be reviewed after package-local module split and generated handles
  settle.

### Voxel Demo

`package-check` AI review status: `fail`

Key findings:

- module graph exists but currently fails strict verification due unknown local
  helper calls.
- browser profile rejects native-style high-level GFX imports.
- effect usage is extremely high in generated scene code.
- this is useful pressure for module split/static tables/profile-specific host
  contracts, but not evidence for public Core/ABI shortcuts.

## 6. "Verified" Definition Gap

| Verification level | v0.12 status | Evidence | Gap |
| --- | --- | --- | --- |
| Syntax/type safety | supported | parser/verifier tests, `airc report` pass for Contra | Existing large monolithic code can still be type-safe but hard to review. |
| Capability safety | supported | strict extern capability checks, `package-check` computed capabilities | Must keep package-level missing capability failures strict. |
| Host-profile compatibility | supported for core fields | `package-check --profile` reports capabilities/imports/manifests/assets | Profile limits and domain-specific behavior are not fully enforced. |
| Resource budgets | supported in Core | verifier/audit effects and budgets | Contra has no meaningful effect budget closure for giant frame complexity. |
| Determinism/replay | partial | deterministic reports, bounded execution model | No replay harness for demo behavior or host presentation outcomes. |
| Anti-slop structural diagnostics | partial | `aiReview` flags large modules/functions/repeated literals | Mostly advisory; not yet a release gate for safe-but-unreviewable code. |
| Domain validation through kits | missing/partial | asset/gfx manifests validate generic resources | No sprite kit/domain kit validator that can prove actor rig/render conventions. |

Current meaning of "verified":

- verified portable syntax/types/capabilities/known Host ABI;
- optionally package/profile-compatible;
- not necessarily structurally clean;
- not necessarily replay-proven;
- not necessarily domain-valid beyond generic manifest checks.

## 7. v0.12 Blockers

Current gate status is tracked by [V0_12_MERGE_READINESS.md](V0_12_MERGE_READINESS.md).
The items below were the P0 closure issues identified by this audit:

1. Keep host-authority stdlib wrappers out of `stdlib/`.
   - `gfx3d.air`, `scene.air`, and `ui.air` have been moved to kits.
   - `voxel.air` has been moved to `kits/voxel-basic/air/voxel.air` as an
     experimental reusable kit candidate.
   - `node test/layer_guard.test.js` is the release gate that prevents these
     wrappers from re-entering public stdlib.
2. Decide release gate semantics for anti-slop.
   - At minimum, large `frame` functions and table-like slots must be visible
     in release reports.
   - Prefer warning gate first, fail gate only for semantic/authority issues.
3. Close capability/profile contract gaps.
   - Keep Contra passing with explicit `audio`.
   - Add negative fixture showing removal of `audio` fails package-check for
     current Contra-style audio manifest/import.
4. Clarify debug metric boundary.
   - Metrics may feed HUD.
   - Metrics must not be treated as stable event/effect authority.
   - Host visual FX derived from metrics must be documented as demo-local.
5. Stabilize package-local module split scope.
   - Graph analysis exists.
   - Linked output/cross-module calls are not complete.
   - v0.12 must either stop at graph/report or implement a small linked slice.
6. Decide static scalar table status.
   - Contra shows clear table pressure.
   - If not implemented in v0.12, document it as explicit deferred blocker for
     reducing duplicated slots.
7. Enforce or document host profile limits.
   - Schema exists.
   - Deep limit enforcement is missing.
8. Separate demo release evidence from Core release gates.
   - Contra and voxel are evidence.
   - Current voxel package-check fails and must not block Core unless selected
     as a release-gate fixture.
9. Confirm LSP/live demo adoption blockers.
   - Roadmap lists them.
   - This audit found no release-ready evidence.

## 8. Do-Not-Do List

Do not add these to AIR Core or public Host ABI:

- `player.*`, `enemy.*`, `boss.*`, `weapon.*`, `pickup.*`, `platformer.*`;
- game-specific rendering calls;
- `gfx.draw_player`, `gfx.draw_enemy`, `gfx.draw_boss_bar`, or similar;
- `host_everything` or broad authority capabilities;
- dynamic object model;
- growable maps/lists;
- GC;
- runtime reflection;
- dynamic or remote imports;
- DOM/Canvas/ImageBitmap/WebAudio/WebGPU/Metal/Vulkan/Direct3D handles;
- demo material IDs as standard semantics;
- debug metrics as final audio/effects/gameplay event transport;
- shortcuts that make Contra or voxel easier by weakening package/profile
  checks.

## 9. Recommended Next Steps

### v0.12 Closure Tasks

1. Freeze the v0.12 definition of "verified" in docs and reports.
2. Add an audit/release gate command that runs:
   - package-check with profile;
   - AI review;
   - layer guard;
   - markdown links;
   - selected package fixtures only.
3. Add a generic anti-slop fixture for large `frame` and table-like slots.
4. Add Contra-specific evidence docs outside Core promotion paths:
   - what AIR owns;
   - what host owns;
   - what remains demo-local.
5. Add negative tests for audio authority and debug-metric side-effect debt.
6. Decide whether v0.12 implements static scalar tables or explicitly defers
   them while keeping module constants/generated handles active.
7. Keep voxel as evidence until its package-check failures are intentionally
   routed to profile/native-host work.

### v0.13 Candidates

- Minimal package-local linked modules if v0.12 stops at graph analysis.
- Static scalar tables if v0.12 keeps them RFC-only.
- Stronger AI-review gating for generated code.
- Sprite kit/rig manifest validator before any public sprite transform ABI.

### v0.14 Candidates

- Domain kit validation for common interactive module shapes.
- Replay/conformance harness for host-observable behavior.
- More complete profile limit enforcement.
- Optional optimizer passes only if audit/effect ordering remains unchanged.

### v0.15 North-Star Only

- Higher-level authoring loop around AIR packages and review reports.
- Cross-profile release evidence for browser/native/mobile-style hosts.
- This must remain a north-star until v0.12 package/profile/anti-slop closure
  is stable.
