# AIR GFX Collision Metadata v0.1

AIR GFX collision metadata describes gameplay and physics volumes separately
from GLB art meshes. It is package/tooling data, not AIR Core syntax.

The host may build acceleration structures, broadphase grids, trigger dispatch,
and controller collision runtime from this metadata. AIR game code may consume
generated scalar tables or handles, but collision shapes do not become language
types.

## Goals

- Keep collision deterministic and easy to validate.
- Avoid deriving gameplay collision from high-detail render meshes by default.
- Let AI agents generate simple, readable shapes for arenas and simulations.
- Keep runtime implementation in the host or generated AIR tables, not in AIR
  Core.

## File Shape

Recommended filename:

```text
collision.layout.json
```

Top-level shape:

```json
{
  "version": "0.1",
  "kind": "air-gfx-collision",
  "units": "meters",
  "upAxis": "Y",
  "colliders": [],
  "triggers": [],
  "layers": {},
  "metadata": {}
}
```

## Collider Types

All colliders share:

- `id`: stable unique string.
- `type`: collider type.
- `transform`: optional position/rotation/scale.
- `layer`: collision layer key.
- `material`: optional physical material key.
- `tags`: optional string tags.

### Box

Axis-aligned boxes are preferred for arena floors, walls, bridge decks, and
simple cover. Oriented boxes may be used when `rotation` is non-zero.

```json
{
  "id": "bridge_north_collision",
  "type": "box",
  "transform": { "position": [0, 0.25, -24], "rotation": [0, 0, 0] },
  "size": [8, 0.5, 20],
  "layer": "world"
}
```

### Sphere

Use spheres for radial pickups, proximity triggers, and simple round hazards:

```json
{
  "id": "rocket_pickup_radius",
  "type": "sphere",
  "center": [0, 1, -36],
  "radius": 1.25,
  "layer": "pickup"
}
```

### Capsule

Use capsules for player/enemy controllers and tall rounded trigger volumes:

```json
{
  "id": "player_capsule",
  "type": "capsule",
  "center": [0, 0.9, 38],
  "height": 1.8,
  "radius": 0.35,
  "axis": "Y",
  "layer": "actor"
}
```

Capsule `height` includes the rounded ends. Validators should require
`height >= radius * 2`.

### Mesh Reference

Mesh collision is allowed as an explicit reference, not as an implicit fallback:

```json
{
  "id": "central_platform_mesh_collision",
  "type": "mesh",
  "mesh": "central_platform_collision",
  "source": "assets/collision/central_platform_collision.glb",
  "mode": "static-triangle-mesh",
  "layer": "world"
}
```

Supported `mode` values:

- `static-triangle-mesh`
- `convex-hull`
- `navmesh`

Hosts may reject mesh collision on low-end/mobile targets unless a simplified
fallback collider is present.

## Trigger Volumes

Triggers use the same shape vocabulary as colliders plus trigger-specific
payload. They do not block movement unless `blocking` is true.

Shared trigger fields:

- `id`
- `kind`
- `shape`
- `layer`
- `target`
- `cooldownMs`
- `blocking`

### Generic Trigger

```json
{
  "id": "door_enter_north",
  "kind": "trigger",
  "shape": { "type": "box", "center": [0, 1, -44], "size": [5, 2, 1] },
  "target": "north_door",
  "cooldownMs": 0
}
```

### Damage Zone

Use damage zones for lava, void, acid, force fields, and kill floors:

```json
{
  "id": "lava_moat_damage",
  "kind": "damage_zone",
  "shape": { "type": "box", "center": [0, -1.5, 0], "size": [40, 1, 40] },
  "damagePerSecond": 45,
  "damageType": "lava",
  "layer": "hazard"
}
```

### Jump Pad Trigger

```json
{
  "id": "jump_west_trigger",
  "kind": "impulse_zone",
  "shape": { "type": "cylinder", "center": [-32, 0.2, 0], "radius": 1.4, "height": 0.4 },
  "impulse": [0, 9, 0],
  "preserveHorizontalVelocity": true,
  "cooldownMs": 250
}
```

`cylinder` is allowed for trigger shape metadata even if the blocking collider
set only supports box/sphere/capsule/mesh.

### Teleport Trigger

```json
{
  "id": "teleport_west_to_east",
  "kind": "teleport",
  "shape": { "type": "box", "center": [-42, 1, 0], "size": [2, 2, 4] },
  "destination": { "position": [42, 1.8, 0], "yaw": -90 },
  "cooldownMs": 800,
  "preserveVelocity": false
}
```

## Collision Layers

Layers are package-defined but should be explicit:

```json
{
  "layers": {
    "world": { "collidesWith": ["actor", "projectile"] },
    "actor": { "collidesWith": ["world", "actor", "pickup", "trigger", "hazard"] },
    "projectile": { "collidesWith": ["world", "actor"] },
    "pickup": { "triggerOnly": true },
    "trigger": { "triggerOnly": true },
    "hazard": { "triggerOnly": true }
  }
}
```

## Physical Materials

Physical material metadata is optional:

```json
{
  "physicalMaterials": {
    "metal_floor": { "friction": 0.82, "restitution": 0.05, "footstep": "metal" },
    "ice": { "friction": 0.08, "restitution": 0.02 },
    "impulse_zone": { "friction": 0.5, "restitution": 0.0 }
  }
}
```

AIR game modules can choose to use these values, or the host can use them in a
controller runtime. The spec does not mandate a physics engine.

## Minimal Complete Example

```json
{
  "version": "0.1",
  "kind": "air-gfx-collision",
  "units": "meters",
  "upAxis": "Y",
  "layers": {
    "world": { "collidesWith": ["actor", "projectile"] },
    "actor": { "collidesWith": ["world", "pickup", "trigger", "hazard"] },
    "pickup": { "triggerOnly": true },
    "hazard": { "triggerOnly": true }
  },
  "colliders": [
    { "id": "center_floor", "type": "box", "transform": { "position": [0, 0, 0] }, "size": [24, 0.5, 24], "layer": "world" },
    { "id": "player_capsule", "type": "capsule", "center": [0, 0.9, 38], "height": 1.8, "radius": 0.35, "axis": "Y", "layer": "actor" }
  ],
  "triggers": [
    { "id": "lava_damage", "kind": "damage_zone", "shape": { "type": "box", "center": [0, -1.5, 0], "size": [40, 1, 40] }, "damagePerSecond": 45, "damageType": "lava", "layer": "hazard" },
    { "id": "impulse_west", "kind": "impulse_zone", "shape": { "type": "sphere", "center": [-32, 0.5, 0], "radius": 1.4 }, "impulse": [0, 9, 0], "cooldownMs": 250 },
    { "id": "teleport_west", "kind": "teleport", "shape": { "type": "box", "center": [-42, 1, 0], "size": [2, 2, 4] }, "destination": { "position": [42, 1.8, 0], "yaw": -90 }, "cooldownMs": 800 }
  ]
}
```

## Validation Rules

Minimal validators should check:

- required `version`, `kind`, `colliders`, and `triggers`;
- unique collider and trigger IDs;
- collider `type` is one of `box`, `sphere`, `capsule`, or `mesh`;
- trigger `kind` is one of `trigger`, `damage_zone`, `impulse_zone`, or `teleport`;
- numeric shape fields are finite and positive where required;
- capsule height is at least diameter;
- mesh collision references resolve to declared package assets;
- layer references exist;
- trigger payload matches kind:
  - damage zones require `damagePerSecond`;
  - jump pads require `impulse`;
  - teleports require `destination.position`;
- render meshes are not used as collision implicitly.

## AIR Integration

Collision metadata can be consumed in three ways:

- host runtime builds collision structures from JSON;
- build tooling emits compact AIR tables for deterministic gameplay modules;
- AIR code references stable integer handles generated from this manifest.

All three are tooling/ABI choices. None require AIR Core to gain collider,
physics-engine, or scene-node semantics.
