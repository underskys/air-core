# AIR v0.12 Stdlib Hygiene Audit

Status: active release audit

Version target: v0.12

This audit checks whether `stdlib/` matches the v0.12 AIR language boundary:
stdlib must be pure, deterministic, backend-neutral, resource-free, and broadly
generic. Demos and products are evidence, not authority, and stdlib must not be
used to make demos pass by hiding host behavior or project vocabulary.

## Policy Baseline

For v0.12 publication, every `stdlib/*.air` module must satisfy all of these:

- `capabilities { }`;
- no `extern` declarations;
- no calls to public Host ABI families such as `@gfx.*`, `@gpu.*`, `@ui.*`,
  `@audio.*`, `@net.*`, `@fs.*`, `@input.*`, `@debug.*`, `@device.*`,
  `@io.*`, `@time.*`, or `@random.*`;
- no demo/project/domain vocabulary;
- no material, asset, scene, primitive, route, level, renderer, shader, or host
  object semantics presented as standard AIR behavior;
- no protocol/product-specific helpers when a generic bitset/scalar helper would
  be the reusable shape.

References:

- [AIR Stdlib Policy](STDLIB_POLICY.md)
- [AIR Layer Manifest](../spec/AIR_LAYER_MANIFEST.md)
- [AIR v0.12 AI-Language Contract](V0_12_AI_LANGUAGE_CONTRACT.md)
- [AIR v0.12 Release Checklist](V0_12_RELEASE_CHECKLIST.md)

## Current Findings

Automated guard added in [layer_guard.test.js](../test/layer_guard.test.js)
now checks all `stdlib/*.air` files for non-empty capabilities, host externs,
Host ABI calls, and obvious demo/resource vocabulary.

Current `node test/layer_guard.test.js` result is expected to pass. The guard
is the publication gate that prevents host-facing wrappers from re-entering
public stdlib.

Verified clean library checks:

```sh
node bin/airc.js verify --library stdlib/bounds.air
node bin/airc.js verify --library stdlib/collision.air
node bin/airc.js verify --library stdlib/color.air
node bin/airc.js verify --library stdlib/easing.air
node bin/airc.js verify --library stdlib/grid.air
node bin/airc.js verify --library stdlib/noise.air
node bin/airc.js verify --library stdlib/packet.air
node bin/airc.js verify --library stdlib/physics.air
node bin/airc.js verify --library stdlib/transform.air
```

These commands verify syntax/type shape. The layer guard is stricter and owns
publication hygiene.

## File-By-File Classification

| File | Current state | Classification | Proposed target | Reason |
| --- | --- | --- | --- | --- |
| [bounds.air](../stdlib/bounds.air) | `capabilities { }`, no externs | keep in stdlib | stdlib | Generic scalar bounds, AABB, sphere, range, and LOD helpers. |
| [collision.air](../stdlib/collision.air) | `capabilities { }`, no externs | keep in stdlib, review names | stdlib | Generic collision/contact helpers. `lift_y_from_ground` and `collision_hit_from_ground` should be reviewed for naming but are not host-bound. |
| [color.air](../stdlib/color.air) | `capabilities { }`, no externs | keep in stdlib | stdlib | Generic packed color and deterministic interpolation helpers. |
| [easing.air](../stdlib/easing.air) | `capabilities { }`, no externs | keep in stdlib, review dependency shape | stdlib | Generic deterministic easing. `damp_i32` wraps a Core numeric op and should remain generic if documented as scalar damping. |
| [gfx3d.air](../kits/gfx-basic/air/gfx3d.air) | moved out of stdlib; `capabilities { gfx }`, `gfx.*` externs/calls | quarantined in kit | reusable kit | Host-facing draw wrappers are not resource-free stdlib. |
| [grid.air](../stdlib/grid.air) | `capabilities { }`, no externs | keep in stdlib | stdlib | Narrow generic grid/index helpers; already protected by helper-name and vocabulary guard. |
| [math3d.air](../examples/stdlib-reference/math3d.air) | moved out of stdlib; reference `run()` module | quarantined as reference | examples | This is a reference/demo fixture shape, not a reusable helper module. |
| [noise.air](../stdlib/noise.air) | `capabilities { }`, no externs | keep in stdlib, split if needed | stdlib | Deterministic hash/noise. `height_cell`/`ridge_cell` should remain generic numeric helpers or be renamed if terrain semantics appear. |
| [packet.air](../stdlib/packet.air) | `capabilities { }`, no externs, generic bit helper only | keep in stdlib | stdlib | `has_flag` is generic bitset logic. Protocol-specific aliases moved out. |
| [physics.air](../stdlib/physics.air) | `capabilities { }`, no externs | keep in stdlib, review names | stdlib | Generic scalar damping/grounding/capsule math. Must not become a game physics engine. |
| [scene.air](../kits/gfx-basic/air/scene.air) | moved out of stdlib; `capabilities { gfx }`, `gfx.*` externs/calls | quarantined in kit | reusable kit | Camera/skybox Host ABI wrappers are host/manifest-facing, not pure stdlib. |
| [network_tcp_flags.air](../examples/network_tcp_flags.air) | TCP-specific aliases moved out of stdlib | quarantined as example | examples/kit candidate | Protocol-specific convenience is not core stdlib; it may inform a future reusable network kit. |
| [transform.air](../stdlib/transform.air) | `capabilities { }`, no externs | keep in stdlib | stdlib | Generic transform/vector/matrix helpers with no host authority. |
| [ui.air](../kits/ui-basic/air/ui.air) | moved out of stdlib; `capabilities { ui }`, `ui.*` externs | quarantined in kit | reusable kit | UI command wrappers are Host ABI usage, not resource-free stdlib. |
| [voxel.air](../kits/voxel-basic/air/voxel.air) | moved out of stdlib; `capabilities { gfx }`, `gfx.*` extern/call, domain name | experimental kit candidate | reusable kit | Voxel primitive wrappers may be reusable across multiple GFX demos, but remain outside stdlib, AIR Core, and public Host ABI. |

## Release Gate

P0 requirements before v0.12 publication:

1. Keep `node test/layer_guard.test.js` green so host-facing wrappers cannot
   re-enter `stdlib/`.
2. Keep protocol-specific helpers out of stdlib:
   - keep generic bitset helpers in stdlib;
   - keep TCP aliases in examples or a future reusable network kit.
3. Keep voxel helpers out of stdlib:
   - `kits/voxel-basic/air/voxel.air` may be consumed by demo/voxel-demo;
   - it remains an experimental `gfx` kit, not public Host ABI;
   - dense voxel chunks stay on the RFC/package/`gpu.*`/render-graph path;
   - terrain, biome, cave, road, river, animal, and art-direction helpers stay
     demo-local.
4. Re-run layer guard and full test suite after migration-sensitive changes.

## Migration Plan

Recommended safe order:

1. Keep the strict layer guard active.
2. Keep compatibility notes for affected imports:
   - `use std.gfx3d` -> kit/demo import;
   - `use std.scene` -> kit/demo import;
   - `use std.ui` -> kit/demo import;
   - `use std.voxel` -> `kits/voxel-basic` or demo/project kit import;
   - `use std.tcp_flags` -> `examples/network_tcp_flags.air` or a future
     reusable network kit.
3. Update demos to import project-local kit modules only in demo worktrees.
4. Keep [stdlib.js](../src/stdlib.js) advertising only pure stdlib modules and
   kit references.
5. Keep package/demo request docs as evidence for any future promotion.

No new Core syntax or public Host ABI is required for this migration.

## Tests To Update

- [layer_guard.test.js](../test/layer_guard.test.js): now enforces stdlib
  empty capabilities, no externs, no Host ABI calls.
- [run.js](../test/run.js): update source import/catalog tests after moving or
  deprecating host-facing stdlib modules.
- Demo/package smoke tests: update only in their own demo/project context,
  not by weakening stdlib policy.

## Verification Commands

Current expected blocker command:

```sh
node test/layer_guard.test.js
```

Expected final release commands after migration:

```sh
node test/layer_guard.test.js
npm test
node scripts/check_markdown_links.js
git diff --check
```
