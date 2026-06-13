# RFC: Explicit Audio Events And Audio Authority for v0.12

Status: RFC / not active public ABI

Version target: v0.12

Target layer: Host ABI RFC / package manifest / asset manifest / host profiles /
package-check / conformance reports

This RFC designs explicit audio event authority for AIR packages. It is a design
document only. It does not add `audio.event`, change the Host ABI registry, or
implement runtime audio behavior.

## Current Gate Decision

`audio.event` is not active public Host ABI in v0.12 yet.

Current implementation behavior:

- `audio.beep`, `audio.play_tone`, and `audio.set_gain` remain the existing
  public audio imports.
- `audio.event` must be rejected by strict Host ABI validation and host profile
  validation until this RFC is explicitly promoted.
- package-check may report audio authority and debug-metric migration debt, but
  it must not treat `debug.metric` as a valid audio transport.
- audio assets and generated audio handles do not grant playback authority.

Promotion requires the full public Host ABI path: spec update, registry update,
verifier/signature checks, capability checks, package-check/profile/report
support, host profile declarations, generic fixtures, migration notes, and no
demo-specific naming.

Related design:

- [RFC_AUDIO_AUTHORITY_v0.11.md](RFC_AUDIO_AUTHORITY_v0.11.md)
- [RFC_ASSET_MANIFEST_v0.12.md](RFC_ASSET_MANIFEST_v0.12.md)
- [AIR package manifest](../spec/AIR_PACKAGE_MANIFEST.md)
- [Asset manifest](../spec/ASSET_MANIFEST.md)
- [Host profiles](../spec/HOST_PROFILES.md)
- [Capabilities](../spec/CAPABILITIES.md)
- [contra-platformer request](abi-requests/contra-platformer.md)

## Problem

v0.11 added audio authority checks and reports. The key safety rule is already
clear: `debug.metric` is diagnostic telemetry and must not authorize host side
effects.

Demos still show a risk. A host can observe debug metrics, exported state, or
memory values and infer actions such as:

- shoot SFX;
- jump SFX;
- damage SFX;
- boss music transition;
- ambience switch;
- victory or failure jingle.

That turns `debug.metric` into a hidden gameplay/audio event bus. This is not
acceptable for AIR package review because the module appears to request only
`debug`, while the host performs `audio`.

v0.12 should define an explicit audio event path so generated AIR modules can
request audio in a reviewable way without exposing WebAudio, HTMLAudioElement,
CoreAudio, ALSA, files, or backend objects.

## Channel Definitions

### debug.metric

`debug.metric(id: i32, value: i32) -> void` is telemetry.

It may expose counters, internal calculations, visible debug values, or
diagnostic state. It must not be treated as authority for audio playback,
gameplay mutation, network probes, filesystem writes, or other side effects.

Allowed:

```air
@debug.metric(1, %visible_enemy_count)
```

Forbidden interpretation:

```text
debug.metric(1, 1) means play shoot.wav
```

### Gameplay Event

A gameplay event is domain behavior such as shoot, jump, hit, spawn, collect,
door open, or boss phase change. Gameplay events may be project-local and may
drive project-local state.

Gameplay events are not automatically audio events. They need explicit mapping
if the host should play audio.

### Audio Event

An audio event is a deliberate module request for an audio side effect. It is
reviewable only when all of the following are true:

- the AIR module/package declares `audio`;
- the public Host ABI function is accepted and registered;
- the event ID is declared in the package/app manifest;
- the event maps to declared audio assets or a documented fallback;
- package-check can report event authority, limits, and host compatibility.

### Host Diagnostic

A host diagnostic reports what the host did or could not do:

- audio unavailable;
- browser autoplay blocked;
- event rate limited;
- missing audio asset;
- placeholder audio used;
- silent fallback used;
- host profile does not support audio.

Diagnostics do not grant authority.

## Candidate AIR API

Candidate public Host ABI:

```air
extern audio.event(id: i32, value: i32) -> void
```

Example:

```air
module audio_events_demo

capabilities { audio, debug }

extern audio.event(id: i32, value: i32) -> void
extern debug.metric(id: i32, value: i32) -> void

export func frame(trigger: i32) -> void {
entry:
  @debug.metric(10, %trigger)
  @audio.event(1, %trigger)
  return
}
```

Interpretation:

- `id` is a manifest-declared audio event ID, not a filename or host object;
- `value` is a scalar event value, such as intensity, variant, or boolean edge;
- host decides whether to play, mute, rate-limit, fallback, or ignore according
  to manifest authority and host policy.

This candidate API is not implemented by this RFC. Before acceptance it needs
the normal public Host ABI path: spec update, `src/host_abi.js` registry entry,
verifier strictness, SDK import wrappers, conformance reports, host profile
support, tests, and migration notes when needed.

## Required Capability

Any direct `audio.event` import requires:

```air
capabilities { audio }
```

Rejected:

```air
module hidden_audio_event
capabilities { debug }
extern audio.event(id: i32, value: i32) -> void
```

Reason: explicit audio events are audio side effects. The `debug` capability is
not sufficient.

## Manifest Authority

The package/app manifest must declare allowed audio events and their authority.

Draft shape:

```json
{
  "hostAuthorities": {
    "audio": {
      "mode": "module-event",
      "events": [
        {
          "id": 1,
          "name": "player_shoot",
          "kind": "sfx",
          "handle": "sfx_shoot",
          "rateLimitPerSecond": 12,
          "fallback": "mute"
        },
        {
          "id": 2,
          "name": "stage_music",
          "kind": "music",
          "handle": "music_stage1",
          "rateLimitPerSecond": 1,
          "fallback": "silence"
        }
      ]
    }
  }
}
```

If assets are declared in an asset manifest, event handles should reference
manifest asset IDs:

```json
{
  "version": "0.12",
  "assets": {
    "audioSfx": {
      "sfx_shoot": { "path": "audio/sfx/shoot.wav" }
    },
    "audioMusic": {
      "music_stage1": { "path": "audio/music/stage1.ogg" }
    }
  }
}
```

Rules:

- event IDs must be unique integers in one package;
- event names are review labels, not AIR identifiers;
- handles must resolve to declared audio assets or declared host-owned audio
  actions;
- fallback behavior must be explicit;
- rate limits must be explicit for module-driven event streams;
- missing required audio assets fail unless manifest fallback allows warning;
- placeholder audio must be reported as placeholder, not accepted as production
  audio.

## Package-Check Integration

Package-check should validate and report:

1. audio assets are declared when events map to assets;
2. audio event IDs are declared when AIR imports `audio.event`;
3. AIR module declares `capabilities { audio }`;
4. selected host profile supports audio capability and `audio.event`;
5. event handles resolve to package-local asset manifest entries;
6. fallback behavior is explicit;
7. rate limits are present and valid;
8. `debug.metric`-based audio triggers are rejected or warned according to
   compatibility mode;
9. placeholder audio files do not count as production audio;
10. asset existence does not grant audio authority by itself.

Until `audio.event` is promoted, package-check should use experimental refusal
fixtures:

- a module importing `audio.event` must fail with an unsupported Host ABI
  diagnostic;
- a package whose audio manifest maps `debug.metric:*` triggers should report
  migration debt;
- a package that only declares audio assets should not gain audio authority.

Example JSON report:

```json
{
  "audio": {
    "used": true,
    "source": "direct-event",
    "authority": "module capability + package manifest",
    "status": "pass",
    "events": [
      {
        "id": 1,
        "name": "player_shoot",
        "handle": "sfx_shoot",
        "asset": "audio/sfx/shoot.wav",
        "rateLimitPerSecond": 12,
        "fallback": "mute"
      }
    ],
    "warnings": [],
    "errors": []
  }
}
```

Rejected report:

```json
{
  "audio": {
    "used": true,
    "source": "debug.metric",
    "authority": "missing",
    "status": "fail",
    "errors": [
      "debug.metric must not be used as hidden audio event authority",
      "declare capability 'audio' and use explicit audio.event or host-owned manifest authority"
    ]
  }
}
```

## Host Profile Compatibility

Host profiles must declare audio support explicitly.

### Browser Audio

Browser hosts may support:

- `audio` capability;
- `audio.event` Host ABI, if accepted;
- `audioSfx` and `audioMusic` asset kinds;
- autoplay/user-gesture diagnostics;
- mute fallback.

Browser-specific objects remain host-owned and are never exposed to AIR.

### Native Audio

Native hosts may support:

- `audio` capability;
- `audio.event` Host ABI, if accepted;
- decoded audio asset playback through host libraries;
- device-unavailable diagnostics;
- silent fallback.

Native backend handles remain host-owned.

### Silent/Fallback Host

Verifier-only, CLI, or CI-safe hosts may support package validation without
audio playback. They can report:

- `audio` unsupported;
- `audio.event` unsupported;
- audio muted by policy;
- placeholder assets detected;
- package requires a host with audio support.

A silent host must not report successful playback.

## Review Bundle Placeholders

Review bundle audio placeholders are not production audio.

Rules:

- placeholder files may satisfy review bundle shape checks only;
- placeholder existence does not grant audio authority;
- package-check should report placeholder audio as placeholder;
- release checks should validate real assets in the source checkout or demo
  project checkout when audio playback is a release requirement;
- demo review bundles remain evidence/informational unless promoted into a core
  release gate.

## Allowed Examples

### Explicit Module Event

AIR:

```air
capabilities { audio }
extern audio.event(id: i32, value: i32) -> void
```

Manifest:

```json
{
  "hostAuthorities": {
    "audio": {
      "mode": "module-event",
      "events": [
        { "id": 1, "name": "shoot", "handle": "sfx_shoot", "fallback": "mute" }
      ]
    }
  }
}
```

Allowed if host profile supports `audio` and the selected audio event ABI.

### Host-Owned Ambience

The host plays ambience after a user starts the app, independent of AIR state:

```json
{
  "hostAuthorities": {
    "audio": {
      "mode": "host-owned",
      "events": [
        { "id": 1, "name": "ambience", "handle": "music_ambient", "fallback": "silence" }
      ]
    }
  }
}
```

Allowed as host-owned behavior when it is not driven by AIR state or
`debug.metric`.

## Rejected Examples

### Debug Metric As Audio Bus

```air
capabilities { debug }
extern debug.metric(id: i32, value: i32) -> void
```

Host behavior:

```text
if debug.metric(7, 1) then play shoot.wav
```

Rejected. `debug.metric` is diagnostic and does not grant audio authority.

### Audio Asset Without Authority

```json
{
  "assets": {
    "audioSfx": {
      "shoot": { "path": "audio/shoot.wav" }
    }
  }
}
```

Rejected as audio authority. The package declares an asset only; it does not
declare permission to play it.

### Undeclared Event ID

```air
@audio.event(99, 1)
```

Rejected by package-check/app-check when event ID `99` is not declared by the
package/app manifest.

## Non-Goals

- No WebAudio exposure to AIR.
- No HTMLAudioElement exposure to AIR.
- No CoreAudio/ALSA/WASAPI/OpenAL backend objects exposed to AIR.
- No mixer implementation.
- No arbitrary file audio access.
- No implicit audio permission from asset existence.
- No debug.metric authority.
- No gameplay-specific public audio ABI.
- No package registry.
- No target bundling.

## Tests Required Before Acceptance

Before `audio.event` can become public ABI, tests must cover:

- verifier accepts exact `audio.event(i32, i32) -> void` only after registry
  acceptance;
- verifier requires `capabilities { audio }`;
- unknown `audio.*` names still fail strict Host ABI;
- package-check rejects undeclared audio event IDs;
- package-check rejects missing audio assets without fallback;
- package-check reports placeholder audio;
- package-check rejects or warns on `debug.metric`-driven audio triggers without
  explicit authority;
- browser and native host profiles report whether `audio.event` is supported;
- silent/verifier-only profiles fail or skip with clear diagnostics;
- conformance report includes audio event authority, fallbacks, warnings, and
  errors.

## First Implementation Slice

Recommended v0.12 slice, after RFC review:

1. extend package/app manifest validation for explicit audio event declarations;
2. add package-check diagnostics for debug-metric-driven audio triggers;
3. add host profile fields for explicit audio event support;
4. keep current `audio.beep`, `audio.play_tone`, and `audio.set_gain` behavior
   unchanged;
5. defer adding public `audio.event` until spec, registry, verifier, SDK,
   reports, and tests are approved together.

This preserves the v0.11 authority model while giving v0.12 a clear path away
from hidden debug-metric audio side effects.
