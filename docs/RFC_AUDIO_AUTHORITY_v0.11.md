# RFC: Audio Authority And Manifest Policy for v0.11

Status: draft
Version target: v0.11
Target layer: host implementation / manifest schema / conformance reports

This RFC defines how AIR handles host-side audio playback when audio is
triggered directly by AIR imports or indirectly through AIR module state,
`debug.metric`, exported values, or host-visible runtime state.

The immediate evidence is the Contra Platformer demo: the AIR module exposes
state through `debug.metric`, while the browser host plays music and SFX through
`HTMLAudioElement` and `AudioContext`. The promoted request is tracked in
[docs/abi-requests/contra-platformer.md](abi-requests/contra-platformer.md),
with original demo notes in
`demo/contra-platformer/FD_LANGUAGE_REQUESTS.md` in the `demo/contra` branch.

## Problem

Audio is a host side effect. A module or package must not be able to cause audio
playback merely because the host observes debug metrics, exported values, or
state changes. `debug.metric` is useful telemetry, but telemetry cannot grant
sound, music, volume, or device authority.

v0.11 needs a small, reviewable rule:

- audio playback is allowed only when audio authority is explicit;
- missing audio authority is a validation error;
- browser autoplay fallback may mute or defer playback, but it must be reported.

## Audio Authority Modes

### Direct AIR Audio ABI Import

AIR imports an existing public audio Host ABI function such as `audio.beep`,
`audio.play_tone`, or `audio.set_gain`.

Required authority:

- AIR module declares capability `audio`;
- verifier enforces the public Host ABI signature;
- host may still apply platform policy such as mute, volume limits, or user
  gesture requirements.

Allowed example:

```air
module tone_demo
capabilities { audio }
extern audio.beep(id: i32) -> void

export func run() -> void {
entry:
  @audio.beep(1)
  return
}
```

Rejected example:

```air
module hidden_tone
capabilities { debug }
extern audio.beep(id: i32) -> void

export func run() -> void {
entry:
  @audio.beep(1)
  return
}
```

Reason: direct `audio.*` imports require the `audio` capability.

### Module-Declared Audio Capability

The module declares `audio` even if the current bridge is host implemented. This
is acceptable when host playback is driven by AIR-owned state and the package or
app manifest documents the trigger sources.

Allowed example:

```air
module platformer
capabilities { debug, gfx, input, audio }
extern debug.metric(id: i32, value: i32) -> void
```

Reason: the module explicitly declares audio authority. The host still owns
browser audio objects and should report the actual trigger mapping.

### Package/App Manifest Host-Owned Audio

The host owns audio behavior independently from AIR imports, but declares that
authority in an app or package manifest. This is the preferred mode for browser
autoplay policy, project-local music, and demo-owned SFX bridges.

Draft manifest shape:

```json
{
  "hostAuthorities": {
    "audio": {
      "mode": "host-owned",
      "triggers": [
        {
          "source": "debug.metric",
          "name": "player_shoot",
          "action": "sfx.shoot"
        }
      ],
      "assets": ["shoot.wav", "jump.wav", "stage1.ogg"]
    }
  }
}
```

The current v0.11 demo manifest may use an equivalent narrower audio manifest:

```json
{
  "authority": {
    "kind": "host-owned",
    "source": "module-driven",
    "triggers": ["debug.metric:bossActive", "debug.metric:bulletActive"]
  },
  "sfx": {
    "shoot": "assets/audio/sfx/shoot.wav"
  },
  "music": {
    "stage": "assets/audio/music/stage1.ogg"
  }
}
```

Required authority:

- `authority.kind` is `host-owned`, or future `hostAuthorities.audio.mode` is
  `host-owned`;
- triggers are listed when audio is driven by AIR state;
- package/app checks report whether authority is present or missing.

### Host Ambience Independent Of AIR

The host may play ambience that is not triggered by AIR state, AIR exports,
AIR memory, AIR imports, `debug.metric`, input calls, or module lifecycle. It
still needs manifest authority because it is part of the app/package behavior.

Allowed example:

```json
{
  "hostAuthorities": {
    "audio": {
      "mode": "host-owned",
      "triggers": [
        {
          "source": "host",
          "name": "user_start",
          "action": "music.ambience"
        }
      ],
      "assets": ["ambient_loop.ogg"]
    }
  }
}
```

Rejected example:

```json
{
  "music": {
    "ambience": "ambient_loop.ogg"
  }
}
```

Reason: the manifest lists audio assets but does not declare host-owned audio
authority.

### Forbidden Implicit Audio

Audio is forbidden when a host reacts to AIR state, debug metrics, exported
values, memory, or events without either:

- module capability `audio`; or
- host-owned audio authority in the app/package manifest.

Rejected example:

```air
module debug_only_audio
capabilities { debug }
extern debug.metric(id: i32, value: i32) -> void
```

If a host plays `sfx.shoot` when `debug.metric(2)` changes, that is an audio
side effect. The `debug` capability does not authorize it.

## Capability Model

v0.11 keeps the minimal capability:

```text
audio
```

This capability means the module/package may request or drive audio side effects
through accepted host mechanisms. It does not expose WebAudio, CoreAudio, ALSA,
OpenAL, platform handles, or backend objects to AIR.

Possible future sub-capabilities:

- `audio.play`
- `audio.sfx`
- `audio.music`
- `audio.stop`
- `audio.volume`

These are not implemented by this RFC. Sub-capabilities require the normal Host
ABI registry policy: spec update, registry entry, verifier behavior, SDK import
coverage, report behavior, tests, and migration notes when needed.

## Debug Channel Rule

`debug.metric` is telemetry.

`debug.metric` must not silently authorize host side effects. If a host reacts
to debug metrics with audio, filesystem writes, network probes, GPU allocations,
or other side effects, those side effects need their own explicit authority.

For audio:

- `debug.metric:bossActive -> music.boss` requires audio authority;
- `debug.metric:bulletActive -> sfx.shoot` requires audio authority;
- `debug.metric:score -> sfx.enemy_hit` requires audio authority.

The trigger may be listed for review, but the authority comes from `audio` or
the manifest, not from `debug`.

## Report Requirements

v0.11 reports that include audio validation must expose:

- audio used: `true` or `false`;
- trigger source: direct import, `debug.metric`, state, event, or host;
- authority source: module capability, package/app manifest, or missing;
- missing authority diagnostics;
- fallback or muted behavior when browser/platform policy blocks playback.

Canonical fields:

```json
{
  "audio": {
    "used": true,
    "source": "module-driven",
    "triggers": ["debug.metric:bossActive"],
    "authority": "module capability",
    "status": "pass",
    "errors": [],
    "warnings": []
  }
}
```

Failure shape:

```json
{
  "audio": {
    "used": true,
    "source": "module-driven",
    "triggers": ["debug.metric:bulletActive"],
    "authority": "missing",
    "status": "fail",
    "errors": [
      "audio authority missing: declare capability 'audio' or manifest authority.kind 'host-owned'"
    ],
    "warnings": []
  }
}
```

Browser fallback examples:

- autoplay blocked until user gesture: warning, not ABI failure;
- user muted music: fallback/muted behavior;
- missing audio asset: package/app diagnostic;
- unsupported audio backend: host diagnostic.

## Compliance Examples

Allowed:

- AIR module imports `audio.beep` and declares `capabilities { audio }`.
- AIR module declares `audio`, host plays project-local SFX from documented
  `debug.metric` triggers.
- AIR module does not declare `audio`, but app/package manifest declares
  host-owned audio authority and lists trigger sources.
- Host ambience starts from a host-only user action and manifest declares
  host-owned audio authority.

Rejected:

- AIR imports `audio.beep` without declaring `audio`.
- Host plays SFX from `debug.metric` while the module has only `debug`.
- Host switches music from AIR state without module `audio` or manifest
  host-owned authority.
- Manifest lists audio assets but no authority block.
- Any design that exposes raw WebAudio, device handles, backend mixers, or file
  descriptors to AIR.

## Non-goals

- No full audio engine.
- No raw WebAudio exposure to AIR.
- No backend audio objects exposed to AIR.
- No demo-specific SFX ABI.
- No new public audio ABI without RFC, spec, registry, verifier, SDK, and tests.
- No target packaging implementation.
- No package registry.

## v0.11 Decision

v0.11 treats audio authority as package-runtime validation and report metadata.
The accepted behavior is strict enough to prevent hidden audio side effects, but
small enough to avoid adding new public audio ABI from one demo.
