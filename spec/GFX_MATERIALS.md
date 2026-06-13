# AIR GFX Materials Manifest v0.1

AIR GFX materials describe render-facing material metadata for game/simulation
packages. They are part of the AIR GFX package/tooling layer, not AIR Core.

The host owns shader compilation, texture upload, sampler creation, PBR math,
normal mapping, transparency sorting, bloom, and backend-specific optimization.
AIR and manifests provide stable handles and deterministic metadata.

## Goals

- Give AI agents a small PBR material vocabulary.
- Keep material definitions portable across WebGPU/native hosts.
- Keep texture and shader implementation out of AIR Core.
- Make materials easy to validate before runtime.
- Keep reusable material presets in kits such as `kits/gfx-basic/materials/`.
  Do not place `.airgfx.json` material/resource manifests under `stdlib/`.

## File Shape

Recommended filename:

```text
materials.airgfx.json
```

Top-level shape:

```json
{
  "version": "0.1",
  "kind": "air-gfx-materials",
  "textures": {},
  "materials": {},
  "samplers": {},
  "metadata": {}
}
```

## Texture Declarations

Textures are package assets referenced by key:

```json
{
  "textures": {
    "metal_albedo": { "path": "assets/textures/platforms.png", "colorSpace": "srgb" },
    "metal_normal": { "path": "assets/textures/platforms_n.png", "colorSpace": "linear", "usage": "normal" },
    "flow_emissive": { "path": "assets/textures/flow_emissive.png", "colorSpace": "srgb", "usage": "emissive" }
  }
}
```

Recommended texture fields:

- `path`: package-relative asset path.
- `colorSpace`: `srgb` or `linear`.
- `usage`: `albedo`, `normal`, `roughness`, `metallic`, `metallicRoughness`,
  `emissive`, `occlusion`, `height`, or `data`.
- `wrapU` / `wrapV`: `repeat`, `clamp`, or `mirror`.
- `filter`: `nearest`, `linear`, or `anisotropic`.

## PBR Material Shape

Each material has a stable key and optional integer handle:

```json
{
  "materials": {
    "basic_metal": {
      "handle": 1,
      "model": "pbr-metallic-roughness",
      "albedoTexture": "metal_albedo",
      "normalTexture": "metal_normal",
      "roughnessTexture": "metal_roughness",
      "metallicFactor": 0.85,
      "roughnessFactor": 0.42,
      "emissiveTexture": "blue_light_strip",
      "emissiveFactor": [0.0, 0.35, 0.8],
      "alphaMode": "opaque",
      "uvScale": [2, 2],
      "uvOffset": [0, 0]
    }
  }
}
```

Supported fields:

- `model`: `pbr-metallic-roughness`, `unlit`, `emissive`, `transparent`, or
  extension-prefixed.
- `albedoTexture`: texture key.
- `normalTexture`: texture key.
- `roughnessTexture`: texture key.
- `metallicTexture`: texture key.
- `metallicRoughnessTexture`: packed ORM/MR texture key.
- `occlusionTexture`: texture key.
- `emissiveTexture`: texture key.
- `heightTexture`: optional height/parallax hint texture key.
- `albedoFactor`: `[r, g, b, a]`, default `[1, 1, 1, 1]`.
- `metallicFactor`: number `0..1`, default `0`.
- `roughnessFactor`: number `0..1`, default `1`.
- `emissiveFactor`: `[r, g, b]`, values may exceed `1` for bloom-capable hosts.
- `alphaMode`: `opaque`, `mask`, or `blend`.
- `alphaCutoff`: number `0..1`, used when `alphaMode == "mask"`.
- `doubleSided`: boolean.
- `uvScale`: `[u, v]`, default `[1, 1]`.
- `uvOffset`: `[u, v]`, default `[0, 0]`.
- `animation`: optional texture animation hints.

## Animation Hints

Animation hints tell the host how to animate texture coordinates or shader
parameters. They are hints, not AIR Core behavior.

### Lava

```json
{
  "animation": {
    "kind": "lava_flow",
    "uvVelocity": [0.05, -0.12],
    "noiseScale": 2.0,
    "distortion": 0.08,
    "emissivePulse": { "speed": 0.7, "amount": 0.25 }
  }
}
```

### Energy

```json
{
  "animation": {
    "kind": "energy_scroll",
    "uvVelocity": [0.12, 0.0],
    "scanlineSpeed": 1.5,
    "fresnel": 0.6,
    "opacityPulse": { "speed": 1.2, "amount": 0.18 }
  }
}
```

Supported minimal `animation.kind` values:

- `none`
- `uv_scroll`
- `lava_flow`
- `energy_scroll`
- `emissive_pulse`

Hosts may ignore unsupported animation fields but should report this in
conformance diagnostics.

## Alpha Modes

- `opaque`: no transparency sorting required.
- `mask`: alpha test using `alphaCutoff`.
- `blend`: transparent material; host owns sorting or weighted blending.

Energy barriers and glass should use `blend` only when the host supports
transparent pass ordering. Otherwise package tooling should provide an opaque or
masked fallback.

## Minimal Complete Example

```json
{
  "version": "0.1",
  "kind": "air-gfx-materials",
  "textures": {
    "metal_albedo": { "path": "assets/textures/platforms.png", "colorSpace": "srgb", "usage": "albedo", "wrapU": "repeat", "wrapV": "repeat" },
    "metal_normal": { "path": "assets/textures/platforms_n.png", "colorSpace": "linear", "usage": "normal" },
    "concrete_albedo": { "path": "assets/textures/concrete.png", "colorSpace": "srgb", "usage": "albedo" },
    "flow_emissive": { "path": "assets/textures/flow_emissive.png", "colorSpace": "srgb", "usage": "emissive" },
    "energy_albedo": { "path": "assets/textures/forcefield.png", "colorSpace": "srgb", "usage": "albedo" },
    "accent_emissive": { "path": "assets/textures/powergrid.png", "colorSpace": "srgb", "usage": "emissive" }
  },
  "materials": {
    "basic_metal": {
      "handle": 1,
      "model": "pbr-metallic-roughness",
      "albedoTexture": "metal_albedo",
      "normalTexture": "metal_normal",
      "metallicFactor": 0.8,
      "roughnessFactor": 0.45,
      "alphaMode": "opaque",
      "uvScale": [2, 2]
    },
    "rough_concrete": {
      "handle": 2,
      "model": "pbr-metallic-roughness",
      "albedoTexture": "concrete_albedo",
      "metallicFactor": 0.0,
      "roughnessFactor": 0.9,
      "alphaMode": "opaque",
      "uvScale": [3, 3]
    },
    "emissive_flow": {
      "handle": 3,
      "model": "emissive",
      "albedoTexture": "flow_emissive",
      "emissiveTexture": "flow_emissive",
      "emissiveFactor": [4.0, 1.2, 0.1],
      "roughnessFactor": 0.2,
      "alphaMode": "opaque",
      "animation": { "kind": "lava_flow", "uvVelocity": [0.05, -0.12], "noiseScale": 2.0, "distortion": 0.08 }
    },
    "blue_energy_barrier": {
      "handle": 4,
      "model": "transparent",
      "albedoTexture": "energy_albedo",
      "emissiveTexture": "energy_albedo",
      "emissiveFactor": [0.1, 1.2, 2.5],
      "metallicFactor": 0,
      "roughnessFactor": 0.08,
      "alphaMode": "blend",
      "animation": { "kind": "energy_scroll", "uvVelocity": [0.12, 0.0], "fresnel": 0.6 }
    },
    "accent_panel": {
      "handle": 5,
      "model": "pbr-metallic-roughness",
      "albedoTexture": "accent_emissive",
      "emissiveTexture": "accent_emissive",
      "emissiveFactor": [2.5, 0.15, 0.05],
      "metallicFactor": 0.65,
      "roughnessFactor": 0.35,
      "alphaMode": "opaque"
    }
  }
}
```

## Validation Rules

Minimal validators should check:

- required `version`, `kind`, `textures`, and `materials`;
- unique material handles when present;
- all texture references resolve;
- texture paths are package-relative;
- factors are finite numbers;
- `metallicFactor`, `roughnessFactor`, and `alphaCutoff` are within `0..1`;
- `albedoFactor` has four finite values;
- `emissiveFactor` has three finite non-negative values;
- `alphaMode` is `opaque`, `mask`, or `blend`;
- `uvScale` and `uvOffset` have two finite values;
- animation `kind` is known or extension-prefixed;
- transparent materials are flagged for host support checks.

## AIR Integration

AIR modules should refer to materials by stable handles or generated constants:

```air
%mat_lava:i32 = 3
```

The material schema remains outside AIR Core. AIR does not parse PNGs, compile
PBR shaders, upload textures, or implement transparency. Those are host and
package-tooling responsibilities.

Vector graphics can reference the same material keys when used as decals or UI
elements. The host owns vector rasterization/tessellation and blending; the
material manifest only describes the render-facing surface contract.
