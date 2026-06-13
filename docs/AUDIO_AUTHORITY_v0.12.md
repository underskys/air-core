# AIR v0.12 Audio Authority

Status: active v0.12 release policy

AIR v0.12 closes the current audio authority model without adding new public
audio ABI.

## Active Model

- `audio.beep`, `audio.play_tone`, and `audio.set_gain` are direct AIR Host ABI
  imports.
- Direct AIR audio imports require module capability `audio`.
- Direct AIR audio imports also require package capability `audio` for v0.12
  `air.package.json` packages.
- The selected host profile must support both capability `audio` and the used
  `audio.*` host imports.
- Audio assets do not grant playback authority.
- `debug.metric` is diagnostic telemetry only and must not authorize audio.
- `audio.event` remains RFC/deferred and is not part of the active v0.12 public
  Host ABI.

## Package-Check Expectations

`package-check --profile` must report audio authority even in source/audit mode:

```sh
node bin/airc.js package-check <package-dir> --profile browser-webgpu --source-only --json
```

The report should include:

- `declaredCapabilities`;
- `computedCapabilities`;
- `hostImports.used`;
- `audio.used`;
- `audio.source`;
- `audio.authority`;
- `audio.status`;
- `profileSupport`;
- `hiddenAuthority`;
- repair hints for missing capability/profile support.

For a direct audio import:

```air
capabilities { audio }
extern audio.beep(id: i32) -> void
```

the expected audio report is:

```json
{
  "used": true,
  "source": "direct-import",
  "authority": "module capability",
  "status": "pass"
}
```

## Rejected Patterns

These must fail or warn:

- `audio.beep` without module capability `audio`;
- an AIR package using `audio.beep` without package capability `audio`;
- a selected host profile that lacks `audio` or the used `audio.*` import;
- audio playback inferred from `debug.metric`;
- audio playback inferred from the mere presence of audio assets.

## Deferred Work

`audio.event` remains covered by [RFC_AUDIO_EVENTS_v0.12.md](RFC_AUDIO_EVENTS_v0.12.md).
It must not be implemented until the full public Host ABI promotion path is
complete: spec, registry, verifier, capability checks, package-check/profile
support, host-profile declarations, generic fixtures, tests, and migration
notes.
