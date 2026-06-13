# Asset Manifest

`assets/manifest.json` is the v0.12 package-local asset manifest for host-owned
sprites, audio, models, shaders, textures, materials, rigs, backgrounds, and
generic binary resources. It is descriptive metadata for validators and hosts.
It does not grant AIR authority to play audio, load files, access the network,
or touch renderer/backend objects.

## Example

```json
{
  "version": "0.12",
  "assets": {
    "sprites": {
      "player_idle": {
        "path": "sprites/player_idle.png",
        "atlas": "main_atlas"
      }
    },
    "audioSfx": {
      "heal": {
        "path": "audio/sfx/heal.wav"
      }
    },
    "audioMusic": {
      "jungle_1": {
        "path": "audio/music/jungle-1.mp3"
      }
    },
    "models": {
      "crate": {
        "path": "models/crate.glb"
      }
    },
    "textures": {
      "player_idle_texture": {
        "path": "textures/player_idle.png"
      }
    },
    "shaders": {
      "unlit_mesh": {
        "path": "shaders/unlit_mesh.wgsl"
      }
    },
    "materials": {
      "basic_unlit": {
        "kind": "unlit",
        "shader": "unlit_mesh",
        "texture": "player_idle_texture"
      }
    }
  },
  "fallbacks": {
    "missingTexture": "textures/fallback.png",
    "missingAudio": "audio/silence.wav"
  }
}
```

## Validation Rules

- Asset and fallback paths must be relative and package-local.
- Absolute paths and parent traversal are rejected.
- Asset kind names must be known.
- File extensions are checked where practical.
- Missing assets are errors unless an explicit fallback for that class exists.
- Missing sprite, texture, and background assets may warn when
  `fallbacks.missingTexture` exists.
- Missing audio SFX and music may warn when `fallbacks.missingAudio` exists.
- Host profiles must support every declared asset kind.
- Review-bundle placeholders are reported as placeholders.
- Runtime references to `tmp_unused`, `assets_candidate`, `graphics_bundles`,
  `quarantine`, `old_bundles`, `assets_tmp_unused_previous`, and
  `references/full_pose` are rejected.
- Resource ID references are checked where the manifest schema defines them:
  `materials.*.shader` must reference `assets.shaders`, `materials.*.texture`
  must reference `assets.textures`, and `sprites.*.atlas` must reference
  `assets.spriteAtlases`.
- Unused reference-only manifest entries, such as unreferenced sprite atlases or
  shaders, are reported as warnings.

## Authority Rule

Asset existence does not grant authority:

- An audio file may exist, but AIR cannot trigger audio without `audio`
  capability or explicit host-owned audio authority.
- A texture may exist, but AIR must reference it through a declared
  manifest/render path.
- `debug.metric` is telemetry and must not be treated as gameplay, renderer, or
  audio event authority.

## Package Check

`package-check` validates `manifests.assets` when it is declared in
`air.package.json`.

```sh
node bin/airc.js package-check <package-dir> --profile browser-webgpu --json
```

The JSON report includes an `assets` section with manifest status, declared
assets, placeholders, warnings, errors, resource consistency diagnostics, and
an authority note.

## Non-Goals

- No asset downloader.
- No CDN support.
- No production asset pipeline.
- No implicit permissions from asset presence.
- No backend objects exposed to AIR.
- No new public Host ABI.
