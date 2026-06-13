# AIR GFX Scene Layout Manifest v0.1

AIR GFX scene layout is a high-level JSON layer for AI-generated game and
simulation packages. It is not AIR Core syntax and it is not a renderer. It is
package metadata that build-time tools can validate, transform into
`.airgfx.json` resources, and feed to WebGPU/native hosts.

The purpose is to let an AI agent describe a coherent arena or simulation space
without hardcoding that structure into AIR Core.

## Ownership Boundary

- AIR Core owns SSA, types, effects/contracts, memory, verification, and Wasm
  lowering.
- AIR GFX ABI owns handles, render graph contracts, draw/instancing commands,
  package metadata, and validation.
- The host owns GLB loading, texture upload, WebGPU/Metal/Vulkan objects, shader
  compilation, PBR, skybox drawing, input/camera runtime, and draw execution.
- The game package owns layout, art assets, collision metadata, spawn points,
  triggers, pickups, enemy logic references, and gameplay data.
- Optional reusable kit resources, such as `kits/gfx-basic` shaders or material
  fragments, may be referenced by packages, but they remain build-time/package
  resources and do not become AIR stdlib or Core semantics.

Scene layout manifests must be deterministic, declarative, and easy to diff.
They may reference AIR functions or handles, but they do not add new language
features.

## Build-Time Compiler Flow

`tools/scene-compiler.js` is a build-time compiler for layout JSON. It does not
run inside AIR modules, does not extend AIR Core, and does not own rendering.

```text
scene.layout.json
  + base .airgfx.json
  + optional asset/material registries
        ↓
tools/scene-compiler.js
        ↓
generated .airgfx.json
        ↓
airc gfx-check / gfx-build
        ↓
browser or native host
```

The compiler expands instance groups, assigns deterministic handles, validates
asset/material/render graph references, preserves collision metadata, and may
copy optional interaction metadata such as triggers, jump pads, teleporters, and
pickups into the generated manifest. Diagnostics should be specific enough for
AI/Codex repair loops.

Example:

```sh
node tools/scene-compiler.js \
  --layout examples/gpu_arena.layout.json \
  --manifest examples/gpu_arena.airgfx.json \
  --out examples/gpu_arena.generated.airgfx.json
```

Optional external registries can be merged at compile time:

```sh
node tools/scene-compiler.js \
  --layout scene.layout.json \
  --manifest base.airgfx.json \
  --assets asset-registry.json \
  --materials material-registry.json \
  --out generated.airgfx.json
```

## File Shape

Recommended filename:

```text
scene.layout.json
```

Top-level shape:

```json
{
  "version": "0.1",
  "kind": "air-gfx-scene-layout",
  "units": "meters",
  "upAxis": "Y",
  "coordinateSystem": "right-handed",
  "module": "sample_scene",
  "assets": {
    "models": {},
    "textures": {},
    "materials": {},
    "skyboxes": {}
  },
  "layout": {
    "arena": {},
    "modules": [],
    "routes": [],
    "spawns": [],
    "pickups": [],
    "triggers": []
  },
  "metadata": {}
}
```

Hosts and validators should reject unknown required `kind` values. Unknown
optional fields should be warnings unless the package opts into strict mode.

## Common Values

Transforms are explicit scalar arrays:

```json
{
  "position": [0, 0, 0],
  "rotation": [0, 0, 0],
  "scale": [1, 1, 1]
}
```

`position` and `scale` are world units. `rotation` is degrees `[yaw, pitch,
roll]`. AIR fixed-point runtime code may use `1000 == 1 degree`, but this JSON
format stores human-readable numeric degrees.

Stable IDs should use lowercase snake/kebab names:

```json
{ "id": "bridge_north", "type": "bridge" }
```

## Scene Modules

`layout.modules` is the primary AI-generated list. Each item has:

- `id`: stable unique string.
- `type`: module kind.
- `transform`: position/rotation/scale.
- `model`: optional GLB/glTF model key.
- `material`: optional material key.
- `collision`: optional collision key or inline collision object.
- `tags`: optional string tags for routes, gameplay, or tooling.

Suggested minimal module types:

- `floor_panel`
- `wall_ring`
- `wall_segment`
- `bridge`
- `ramp`
- `stairs`
- `central_platform`
- `pillar`
- `cover`
- `door_frame`
- `light_fixture`
- `pickup_marker`
- `vector_decal`
- `decor`

Example:

```json
{
  "id": "central_platform",
  "type": "central_platform",
  "transform": { "position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [24, 1, 24] },
  "model": "circular_platform",
  "material": "basic_metal",
  "collision": "central_platform_collision",
  "tags": ["mid_layer", "open_space"]
}
```

## Scene Bounds

`layout.bounds` gives coarse dimensions that tools can use for validation and
overview cameras:

```json
{
  "bounds": { "min": [-48, -8, -48], "max": [48, 24, 48] },
  "playerHeight": 1.8,
  "mainRouteWidth": [5, 8],
  "layers": [
    { "id": "lower", "height": -2 },
    { "id": "mid", "height": 0 },
    { "id": "upper", "height": 8 }
  ]
}
```

This is metadata, not collision truth. Collision truth belongs in
`collision.layout.json` as described in `GFX_COLLISION.md`.

## Routes

Routes describe navigation intent for AI/gameplay tooling. They are not pathing
meshes by themselves.

```json
{
  "id": "outer_ring_loop",
  "type": "loop",
  "layer": "mid",
  "width": 6,
  "waypoints": [[-38, 0, -38], [38, 0, -38], [38, 0, 38], [-38, 0, 38]],
  "connects": ["bridge_north", "bridge_south", "bridge_east", "bridge_west"]
}
```

Supported route types:

- `loop`
- `lane`
- `bridge`
- `ramp`
- `stairs`
- `jump`
- `teleport`

## Spawns And Pickups

Spawn points are package data that game AIR can consume by handle or by generated
tables:

```json
{
  "id": "player_spawn_0",
  "kind": "player",
  "position": [0, 1.8, 38],
  "yaw": 180,
  "tags": ["outer_ring"]
}
```

Pickup declarations:

```json
{
  "id": "ammo_north",
  "kind": "ammo",
  "position": [0, 0.5, -36],
  "respawnMs": 12000,
  "visual": "pickup_marker_ammo"
}
```

Common pickup kinds:

- `ammo`
- `health`
- `armor`
- `weapon`
- `powerup`
- `key`

## Skybox / Skydome

Skybox/skydome is environment state, not a scene node:

```json
{
  "skybox": {
    "id": "skydark",
    "texture": "skydark3x2",
    "layout": "cubemap-3x2",
    "rotation": [0, 0, 0],
    "exposure": 1.0
  }
}
```

For a spherical panorama, use an equirectangular environment texture:

```json
{
  "skybox": {
    "id": "skyblue_dome",
    "texture": "skyblue6x",
    "layout": "equirectangular",
    "projection": "spherical",
    "rotation": [0, 0, 0],
    "exposure": 1.0
  }
}
```

The host must ignore camera translation and sample by world-space view
direction, as specified in `GFX_ABI.md` and `GFX_HIGH_LEVEL_ABI.md`.
The historical manifest field `assets.cubemaps` stores environment assets; an
entry may describe either a cubemap atlas or an equirectangular skydome
projection. Tools should preserve the declared `layout`/`projection` fields so
hosts can choose the correct sampling path.

## Minimal Complete Example

```json
{
  "version": "0.1",
  "kind": "air-gfx-scene-layout",
  "units": "meters",
  "upAxis": "Y",
  "coordinateSystem": "right-handed",
  "module": "sample_scene",
  "assets": {
    "models": {
      "floor_panel": { "path": "assets/models/floor_panel_4x4.glb" },
      "bridge": { "path": "assets/models/bridge_module_8x3.glb" }
    },
    "textures": {
      "sky_3x2": { "path": "assets/textures/sky_3x2.png" }
    },
    "materials": {
      "basic_metal": "materials.basic_metal",
      "accent_emissive": "materials.accent_emissive"
    },
    "skyboxes": {
      "default_sky": { "texture": "sky_3x2", "layout": "cubemap-3x2" }
    }
  },
  "layout": {
    "bounds": {
      "bounds": { "min": [-48, -8, -48], "max": [48, 24, 48] },
      "playerHeight": 1.8
    },
    "modules": [
      { "id": "center", "type": "central_platform", "transform": { "position": [0, 0, 0], "scale": [24, 1, 24] }, "model": "floor_panel", "material": "basic_metal" },
      { "id": "north_bridge", "type": "bridge", "transform": { "position": [0, 0, -24], "scale": [8, 1, 20] }, "model": "bridge", "material": "basic_metal" }
    ],
    "spawns": [
      { "id": "player_spawn", "kind": "player", "position": [0, 1.8, 38], "yaw": 180 }
    ],
    "pickups": [
      { "id": "ammo_north", "kind": "ammo", "position": [0, 0.5, -36], "respawnMs": 12000 }
    ],
    "triggers": [
      { "id": "entry_trigger", "kind": "trigger", "target": "center" }
    ],
    "skybox": {
      "id": "default_sky",
      "texture": "sky_3x2",
      "layout": "cubemap-3x2",
      "rotation": [0, 0, 0],
      "exposure": 1.0
    }
  }
}
```

## Validation Rules

Minimal validators should check:

- required `version`, `kind`, and `layout`;
- unique IDs within `modules`, `routes`, `spawns`, `pickups`, and `triggers`;
- module `type` is known or explicitly extension-prefixed;
- referenced models/textures/materials/skyboxes exist;
- transforms are numeric arrays with finite values;
- route waypoints are finite 3D points;
- player spawns include position and yaw;
- skybox has no position, parent, node, mesh, or camera-follow field;
- collision references resolve to the collision manifest when present.
- generated instance handles are positive integers and do not collide;
- referenced assets, materials, pipelines, render targets, and post effects exist
  before package build;
- collision shapes are supported and have their required dimensions.

Unknown extension fields should use a namespaced prefix such as
`x-project.enemyBudget`.
