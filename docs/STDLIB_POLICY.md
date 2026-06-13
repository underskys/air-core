# AIR Stdlib Policy

AIR stdlib is public surface. A helper may enter `stdlib/` only when it is pure,
deterministic, backend-neutral, resource-free, and broadly useful outside one
demo or product.

Stdlib may depend on AIR Core semantics and other generic stdlib helpers. It
must not depend on host devices, assets, manifests, shaders, renderer state,
network access, filesystem access, audio, DOM/browser state, package registry
behavior, or project-specific gameplay.

For v0.13 publication, every `stdlib/*.air` module must satisfy these structural
rules:

- `capabilities { }` exactly;
- no `extern` declarations;
- no calls to public Host ABI families such as `@gfx.*`, `@gpu.*`, `@ui.*`,
  `@audio.*`, `@net.*`, `@fs.*`, `@input.*`, `@debug.*`, `@device.*`,
  `@io.*`, `@time.*`, or `@random.*`;
- no demo/project vocabulary, host object vocabulary, material/asset IDs, scene
  routes, renderer resources, or protocol/product shortcuts presented as the
  standard AIR way.

Host-facing convenience wrappers may still be useful, but they are not stdlib.
Place them in reusable kits, examples, demo/project kits, or host
implementation.

## Accepted Examples

These are acceptable stdlib shapes:

- `grid.cell_origin_i32(cell, cell_size) -> i32`
- `grid.index_3d(x, y, z, width, height) -> i32`
- `bounds.abs_i32(value) -> i32`
- `bounds.in_range_i32(value, center, radius) -> bool`
- `bounds.aabb_overlap_center_i32(...) -> bool`
- `bounds.point_in_circle_sq(px, py, cx, cy, radius_sq) -> bool`
- `collision.aabb_overlap_center_i32(...) -> bool`, if named and scoped
  generically.
- `easing.in_out_quad_1000(t) -> i32`
- `color.rgb_lerp_1000(a, b, t) -> i32`

They are accepted because they are deterministic math/data helpers. They do not
name a project, material ID, actor role, renderer, host capability, asset path,
or gameplay rule.

## Rejected Examples

These do not belong in `stdlib/`:

- `terrain_height_world_at`
- `voxel_biome_at`
- `cave_lamp_material`
- `animal_spawn_route`
- `doom_door_state`
- `contra_player_score_route`
- `platformer_enemy_hit`
- `weapon_pickup_score`
- `gfx3d.box` wrappers that directly call `gfx.draw_primitive`
- `ui.metric` wrappers that declare `extern ui.metric`
- `scene.skybox_world` wrappers that call `gfx.skybox_world`
- helpers that hardcode project material IDs such as `20`, `21`, or `7038563`
  as named gameplay/art semantics;
- helpers that load files, open sockets, call `gfx.*`, call `gpu.*`, call
  `ui.*`, allocate renderer resources, reference shaders/assets/manifests, or
  require host policy.

These examples may be valid inside `demo/`, `examples/`, `kits/`, host
implementation, or project kits, but they are not stdlib.

## Grid Policy

`stdlib/grid.air` is intentionally narrow. It may contain only generic
coordinate, cell, bounds, and index helpers with empty capabilities and no host
imports.

Current allowed public helper names:

- `grid.cell_trunc_i32`
- `grid.cell_origin_i32`
- `grid.cell_center_i32`
- `grid.clamp_coord_i32`
- `grid.in_bounds_2d`
- `grid.index_2d`
- `grid.in_bounds_3d`
- `grid.index_3d`

Forbidden in `stdlib/grid.air`:

- demo domains: voxel, terrain, biome, cave, animal, route, palette;
- project domains: doom, AirDoom, Contra, platformer;
- gameplay names: player, enemy, bullet, weapon, pickup, score, health, boss;
- art/resource names: material IDs, material slots, water, lava, grass, stone,
  skybox, spawn, lamps, trees, rocks;
- host calls, externs, memory/resource operations, shader paths, asset paths,
  manifest paths, or backend-specific code.

## Promotion Rule

Demo pressure is evidence, not authority. A helper may be promoted only after:

- the generic need is documented in ABI request triage;
- project names and material IDs are removed;
- the target layer is confirmed as stdlib rather than Core, Host ABI, manifest,
  reusable kit, project kit, host implementation, examples, or docs;
- tests prove the helper verifies, formats, audits, lowers, and stays
  resource-free;
- layer guard is updated when a concrete leakage risk appears.

## Verification

Stdlib modules without exported host entrypoints use library verification:

```sh
node bin/airc.js verify --library stdlib/grid.air
```

End-to-end stdlib behavior is verified through generic consumer examples:

```sh
node bin/airc.js verify examples/grid_math.air
node bin/airc.js verify examples/numeric_constraints.air
node bin/airc.js audit examples/grid_math.air
node bin/airc.js audit examples/numeric_constraints.air
node bin/airc.js build examples/grid_math.air --emit wasm -o build/grid_math_check.wasm
node bin/airc.js conformance-fixture grid --out build/grid-policy-check
node bin/airc.js package-check build/grid-policy-check
node test/layer_guard.test.js
```

The layer guard must fail if `stdlib/grid.air` absorbs obvious demo vocabulary
or host/resource behavior.

The layer guard must also fail if any `stdlib/*.air` module requests host
capabilities, declares host externs, or calls host ABI families.
