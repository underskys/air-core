# AIR GFX Assets Manifest v0.1

AIR GFX asset metadata describes reusable render resources for game,
simulation, UI, and visualization packages. It is a package/tooling layer, not
AIR Core syntax.

The host owns binary parsing, GPU resource creation, shader compilation,
skinning, animation mixing, vector tessellation/rasterization, texture upload,
and backend-specific optimization. AIR modules only use scalar handles and
commands; manifests describe the resources those handles point to.

## Boundary

- AIR Core does not parse GLB, SVG, FBX, USD, PNG, or animation data.
- AIR GFX manifests can declare meshes, skeletons, animation clips, vector
  graphics, sprites, textures, and render graph passes.
- Hosts may implement these resources with WebGPU, WebGL, Metal, Vulkan,
  Direct3D, software rendering, or precomputed asset cooking.
- Game packages own specific art assets and animation names. Stdlib may expose
  generic asset categories only.
- Reusable starter assets, shader templates, material presets, and manifest
  fragments belong in kits such as `kits/gfx-basic`, not in `stdlib/`.

## Model Assets

Runtime-ready mesh assets should be GLB or glTF:

```json
{
  "assets": {
    "models": {
      "hero_mesh": {
        "path": "assets/models/hero.glb",
        "format": "glb",
        "handle": 11,
        "attributes": ["POSITION", "NORMAL", "TEXCOORD_0", "TANGENT", "JOINTS_0", "WEIGHTS_0"],
        "skinned": true,
        "skeleton": "hero_skeleton",
        "animations": ["idle", "run"]
      }
    }
  }
}
```

Recommended model fields:

- `path`: package-relative path.
- `format`: `glb`, `gltf`, `obj`, `fbx`, `usd`, `usda`, or `usdc`.
- `runtimeReady`: boolean. `glb` and `gltf` are runtime-ready by default.
- `conversion`: optional source-asset conversion hint for non-runtime formats.
- `attributes`: optional mesh attribute list. Common values are `POSITION`,
  `NORMAL`, `TEXCOORD_0`, `TANGENT`, `COLOR_0`, `JOINTS_0`, `WEIGHTS_0`.
- `skinned`: boolean.
- `skeleton`: optional skeleton key.
- `animations`: optional animation clip keys.

## Skeleton Assets

Skeletons are manifest resources referenced by models and scene animators:

```json
{
  "assets": {
    "skeletons": {
      "hero_skeleton": {
        "model": "hero_mesh",
        "handle": 21,
        "joints": ["root", "spine", "head", "arm_l", "arm_r"],
        "root": "root",
        "inverseBindMatrices": "embedded"
      }
    }
  }
}
```

Skeletons may be embedded in a GLB or supplied as a separate host-specific
asset. The manifest identifies relationships and stable handles; it does not
define a CPU/GPU skinning algorithm.

## Animation Clips

Animation clips are generic timeline resources:

```json
{
  "assets": {
    "animations": {
      "run": {
        "model": "hero_mesh",
        "skeleton": "hero_skeleton",
        "handle": 31,
        "durationMs": 833,
        "channels": ["translation", "rotation", "scale"],
        "loop": true
      }
    }
  }
}
```

Supported fields:

- `model`: optional model key.
- `skeleton`: optional skeleton key.
- `path`: optional package-relative external clip path.
- `durationMs`: non-negative number.
- `channels`: array of `translation`, `rotation`, `scale`, `weights`, or
  extension-prefixed channel names.
- `loop`: boolean hint.

## Scene Animators

Scene animators bind clips to nodes. They are declarative host work, not AIR
Core behavior:

```json
{
  "scene": {
    "animators": {
      "hero_animator": {
        "node": "hero_node",
        "skeleton": "hero_skeleton",
        "clip": "run",
        "playback": "loop",
        "speed": 1.0,
        "weight": 1.0
      }
    }
  }
}
```

Supported `playback` values are `once`, `loop`, and `pingpong`.

## Vector Assets

Vector graphics are first-class package assets, not strings embedded in AIR:

```json
{
  "assets": {
    "vectors": {
      "rune_mark": {
        "path": "assets/vectors/rune.svg",
        "format": "svg",
        "handle": 41,
        "usage": "decal",
        "tessellation": "host",
        "colorSpace": "srgb"
      }
    }
  }
}
```

Supported vector formats in v0.1:

- `svg`: host rasterizes or tessellates.
- `path2d`: package-level path data or host-specific compiled path resource.
- `msdf`: multi-channel signed distance field package asset.

Vector assets can be used for UI icons, decals, map signs, labels, debug
overlays, and styleable symbolic marks.

## Vector Decals

Vector decals place vector graphics in world or screen space:

```json
{
  "scene": {
    "vectorDecals": {
      "floor_rune": {
        "vector": "rune_mark",
        "material": "red_rune_panel",
        "space": "world",
        "transform": { "translation": [0, 0.04, 0], "rotation": [0, -90, 0], "scale": [4, 4, 1] },
        "alpha": 0.85
      }
    }
  }
}
```

Supported `space` values are `world`, `screen`, and `ui`. Hosts own sorting,
blending, tessellation, and batching.

## Validation

Validators should check:

- model, skeleton, animation, vector, material, and node references resolve;
- handles are positive integers and unique within their handle group;
- runtime-ready formats are explicit;
- skinned models reference known skeletons;
- model animation references point to known clips;
- scene animators reference known nodes, skeletons, and clips;
- vector decals reference known vector assets and materials;
- vector render graph passes do not require AIR Core changes.

These rules follow `AGENTS.md`: generic resource contracts live in manifests and
host ABIs, not AIR Core or demo-specific stdlib helpers.
