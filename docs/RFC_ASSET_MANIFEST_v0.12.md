# RFC: Asset Manifest And Bundle Support for v0.12

Status: draft
Version target: v0.12
Target layer: manifest schema / package-check / host implementation

This RFC defines a v0.12 asset manifest direction for repeatable asset
ingestion and validation. It is motivated by the Contra Platformer request for
sprites, backgrounds, audio, rigs, and manifests, but the format must remain
generic across demos, UI tools, simulations, and graphics packages.

Original evidence:

- `demo/contra-platformer/FD_LANGUAGE_REQUESTS.md` in the `demo/contra` branch
- [docs/abi-requests/contra-platformer.md](abi-requests/contra-platformer.md)

Related RFCs:

- [RFC_AUDIO_AUTHORITY_v0.11.md](RFC_AUDIO_AUTHORITY_v0.11.md)
- [RFC_GFX_SPRITE_TRANSFORM_v0.12.md](RFC_GFX_SPRITE_TRANSFORM_v0.12.md)
- [RFC_PACKAGE_MANIFEST_v0.12.md](RFC_PACKAGE_MANIFEST_v0.12.md)

## Goal

Define how AIR packages declare assets and how validators check that assets
exist, match declared types, use explicit fallback policy, and do not rely on
silent legacy fallback behavior.

This is package/manifest/host work. AIR Core does not parse images, audio,
models, rigs, shaders, or binary resources.

## Asset Classes

v0.12 asset manifests should support these classes:

- `sprite`: single image sprite, icon, HUD graphic, or frame.
- `spriteAtlas`: atlas image plus layout metadata.
- `background`: parallax layer, tileable background, sky, map backdrop, or UI
  panel image.
- `audioMusic`: music track, ambience loop, intro/loop pair, or boss/variant
  track.
- `audioSfx`: short sound effect.
- `rig`: sprite rig, skeletal rig, modular actor rig, or animation binding data.
- `material`: material preset or style record.
- `shader`: shader source or prevalidated shader package resource.
- `model`: GLB, glTF, OBJ, FBX, USD, or other model file.
- `binary`: generic binary resource owned by host/package tooling.

Existing GFX-specific resource details remain in
[spec/GFX_ASSETS.md](../spec/GFX_ASSETS.md). This RFC defines the broader
package asset policy.

## Manifest Fields

Each asset entry should have:

- `id`: stable package-local identifier.
- `type`: one of the asset classes above.
- `path`: package-relative path.
- `hash` or `checksum`: optional integrity field.
- `required`: boolean; required assets fail validation when missing.
- `fallback`: explicit fallback policy.
- `hostProfiles`: optional host profile constraints.
- `license`: optional SPDX or project-local license label.
- `attribution`: optional attribution string or file reference.
- `metadata`: class-specific metadata.

Class-specific metadata examples:

- sprites/backgrounds: `width`, `height`, `colorSpace`, `layout`, `tileable`.
- sprite atlases: `image`, `frames`, `frameWidth`, `frameHeight`, `origin`.
- audio: `durationMs`, `loop`, `volumeDefault`, `channels`, `sampleRate`.
- rigs: `format`, `parts`, `poses`, `atlas`, `coordinateSpace`.
- shaders: `stage`, `entryPoint`, `language`, `profile`.
- models: `format`, `attributes`, `skinned`, `animations`.
- binary: `usage`, `schema`, `byteLength`.

## Example: Contra Platformer Draft

```json
{
  "version": "0.12-draft",
  "assets": [
    {
      "id": "player_blue_head",
      "type": "sprite",
      "path": "assets/sprites/player/blue/head.png",
      "required": true,
      "fallback": { "policy": "fail" },
      "metadata": {
        "width": 64,
        "height": 64,
        "colorSpace": "srgb"
      }
    },
    {
      "id": "jungle_parallax_far",
      "type": "background",
      "path": "assets/backgrounds/jungle/far.png",
      "required": true,
      "fallback": { "policy": "declared", "asset": "jungle_parallax_far_svg" },
      "metadata": {
        "layout": "parallax",
        "tileable": true
      }
    },
    {
      "id": "jungle_parallax_far_svg",
      "type": "background",
      "path": "assets/backgrounds/jungle/far.svg",
      "required": false,
      "fallback": { "policy": "none" }
    },
    {
      "id": "stage1_intro",
      "type": "audioMusic",
      "path": "assets/audio/music/Jungle-1.mp3",
      "required": true,
      "fallback": { "policy": "mute" },
      "metadata": {
        "loop": false
      }
    },
    {
      "id": "shoot_base",
      "type": "audioSfx",
      "path": "assets/audio/sfx/Single Rifle Shot.mp3",
      "required": true,
      "fallback": { "policy": "mute" }
    },
    {
      "id": "player_blue_rig",
      "type": "rig",
      "path": "assets/rigs/player_blue.json",
      "required": false,
      "fallback": { "policy": "declared", "asset": "player_blue_single_sprite" },
      "metadata": {
        "format": "sprite-rig-v0",
        "coordinateSpace": "screen",
        "parts": ["head", "torso", "pelvis", "rifle"]
      }
    }
  ],
  "hostAuthorities": {
    "audio": {
      "mode": "host-owned",
      "triggers": [
        { "source": "debug.metric", "name": "bulletActive", "action": "audioSfx.shoot_base" },
        { "source": "debug.metric", "name": "bossActive", "action": "audioMusic.stage1_boss" }
      ],
      "assets": ["stage1_intro", "shoot_base"]
    }
  }
}
```

The identifiers are examples only. Contra-specific art names stay project-local;
the reusable contract is the manifest shape and validation behavior.

## Validation Rules

Validators should check:

- every declared asset path exists relative to the package/app root;
- declared `type` matches the file extension and, where cheap, file signature;
- fallback is explicit for every asset;
- no silent legacy fallback is allowed;
- missing required assets fail validation;
- missing optional assets emit warnings and name the declared fallback;
- fallback targets exist and have compatible asset classes;
- host profile constraints are compared with the selected host profile;
- unsupported asset features emit diagnostics;
- hashes/checksums match when present;
- asset IDs are unique and stable;
- AIR references handles only through validated manifest IDs.

## Fallback Policy

Suggested `fallback.policy` values:

- `fail`: missing or unsupported asset fails validation.
- `none`: asset is optional and no fallback is used.
- `declared`: use another manifest asset by ID.
- `mute`: audio-only fallback; host stays silent and reports muted behavior.
- `placeholder`: use a tooling-generated placeholder asset, with report
  disclosure.

Rejected fallback behavior:

- host silently selecting old SVG/PNG/MP3 paths;
- host silently substituting unrelated assets;
- implicit network download;
- implicit generated art without report disclosure.

## Audio Link

Audio asset existence does not grant playback authority.

`audioMusic` and `audioSfx` assets must interact with the Audio Authority policy:

- direct AIR `audio.*` imports require capability `audio`;
- host playback driven by AIR state requires module `audio` capability or
  manifest host-owned audio authority;
- `debug.metric` triggers must be listed if they drive playback;
- muted/autoplay fallback must appear in reports.

See [RFC_AUDIO_AUTHORITY_v0.11.md](RFC_AUDIO_AUTHORITY_v0.11.md).

## Sprite Rig Link

Sprite parts and rigs are host-owned manifest resources. AIR may reference
validated handles, actor IDs, pose IDs, or sprite IDs, but AIR must not receive
DOM, ImageBitmap, Canvas, WebGL, WebGPU, native texture, or backend rig objects.

The v0.12 sprite transform direction is described in
[RFC_GFX_SPRITE_TRANSFORM_v0.12.md](RFC_GFX_SPRITE_TRANSFORM_v0.12.md).

## Allowed Examples

Allowed required sprite:

```json
{
  "id": "hud_health_pip",
  "type": "sprite",
  "path": "assets/sprites/hud/health-pip.png",
  "required": true,
  "fallback": { "policy": "fail" }
}
```

Allowed optional rig with declared fallback:

```json
{
  "id": "actor_modular_rig",
  "type": "rig",
  "path": "assets/rigs/actor.json",
  "required": false,
  "fallback": { "policy": "declared", "asset": "actor_single_sprite" }
}
```

Allowed audio asset with muted fallback:

```json
{
  "id": "stage_music",
  "type": "audioMusic",
  "path": "assets/audio/music/stage.ogg",
  "required": true,
  "fallback": { "policy": "mute" }
}
```

## Rejected Examples

Rejected silent fallback:

```json
{
  "id": "player",
  "type": "sprite",
  "path": "assets/player.png",
  "required": true
}
```

Reason: fallback policy is missing.

Rejected remote download:

```json
{
  "id": "background",
  "type": "background",
  "path": "https://example.com/background.png",
  "required": true,
  "fallback": { "policy": "fail" }
}
```

Reason: v0.12 asset manifests are package-local and do not perform remote asset
downloads.

Rejected hidden audio authority:

```json
{
  "id": "shoot",
  "type": "audioSfx",
  "path": "assets/shoot.wav",
  "required": true,
  "fallback": { "policy": "mute" }
}
```

Reason: this declares an audio asset, not permission for host playback. Audio
authority must be declared separately when AIR state drives playback.

## Report Requirements

Asset validation reports should include:

- asset ID;
- type;
- path;
- required/optional status;
- loaded, missing, fallback, unsupported, or invalid status;
- fallback asset or fallback behavior used;
- host profile constraints and unsupported features;
- checksum result when applicable;
- repair hint when possible.

## Non-goals

- No package registry.
- No remote asset downloads.
- No automatic web scraping.
- No host object exposure to AIR.
- No AIR Core syntax changes.
- No deployment bundler implementation.
- No hidden capability grants through assets.

## v0.12 Implementation Direction

`package-check` should eventually validate asset manifests alongside package
metadata and host profiles. Browser and native hosts should report loaded assets
and fallback behavior using the same asset IDs. This remains a v0.12 package and
host validation workflow, not a v0.11 public ABI expansion.
