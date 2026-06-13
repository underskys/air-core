# Host Profiles

Status: draft

Version target: v0.12

Host profiles are machine-readable declarations of what an AIR host can support.
They define the host side of the compatibility contract between an AIR package
and a target host.

Profiles are descriptive metadata. They do not probe a real runtime, open
devices, grant hidden authority, polyfill unsupported behavior, or create new
public Host ABI functions.

Related design:

- [AIR Package Manifest](AIR_PACKAGE_MANIFEST.md)
- [Asset Manifest](ASSET_MANIFEST.md)
- [Host ABI](CAPABILITIES.md)
- [Target Packaging Model](../docs/TARGET_PACKAGING_MODEL.md)
- [Package Check v0.12 Plan](../docs/PACKAGE_CHECK_v0.12_PLAN.md)
- [v0.12 Conformance Matrix](../docs/V0_12_CONFORMANCE_MATRIX.md)
- [AIR v0.12 Roadmap](../docs/ROADMAP_v0.12.md)

## Profile Location

Repository-owned draft profiles live in:

```text
data/host_profiles/<id>.json
```

The file basename should match the profile `id`.

## Example

```json
{
  "id": "browser-webgpu",
  "hostAbi": "0.10",
  "supports": {
    "capabilities": ["debug", "ui", "gfx", "gpu", "input", "audio"],
    "hostImports": [
      "debug.metric",
      "ui.metric",
      "gfx.draw_primitive",
      "gpu.execute_render_graph",
      "input.axis",
      "audio.beep"
    ],
    "assetKinds": ["texture", "shader", "model", "material", "audioSfx", "audioMusic"],
    "manifestKinds": ["assets", "gfx", "audio"]
  }
}
```

Profiles may include optional human-readable fields and limits:

```json
{
  "id": "browser-webgpu",
  "name": "Browser WebGPU Host",
  "hostAbi": "0.10",
  "supports": {
    "capabilities": ["debug", "time", "random", "input", "gfx", "gpu", "ui", "audio"],
    "hostImports": ["debug.metric", "input.axis", "gfx.draw_primitive", "ui.metric"],
    "assetKinds": ["texture", "shader", "model", "material", "audioSfx", "audioMusic"],
    "manifestKinds": ["gfx", "assets", "audio"]
  },
  "limits": {
    "maxAssets": 256,
    "maxTextureSize": 4096,
    "maxAudioFiles": 64
  },
  "diagnostics": {
    "ciSafe": true,
    "manualOnly": false,
    "requiredReports": ["package-check --profile", "unsupported feature diagnostics"],
    "unsupportedFeatureBehavior": "fail-with-diagnostic"
  }
}
```

## Required Fields

| Field | Required | Type | Rule |
| --- | --- | --- | --- |
| `id` | yes | string | Stable profile identifier. Must match the selected profile name. |
| `hostAbi` | yes | string | Host ABI registry version supported by this profile. |
| `supports` | yes | object | Feature support declaration. |
| `supports.capabilities` | yes | string array | AIR capability families supported by the host. |
| `supports.hostImports` | yes | string array | Exact public Host ABI imports implemented by the host profile. |
| `supports.assetKinds` | yes | string array | Asset kinds supported by the host or validator. |
| `supports.manifestKinds` | yes | string array | Manifest kinds supported by the host or validator. |
| `name` | no | string | Human-readable host name. |
| `limits` | no | object | Known host limits for package compatibility checks. |
| `diagnostics` | no | object | Reporting expectations for release gates and reviewers. |

## Strict Host ABI Rule

`supports.hostImports` must list existing public Host ABI imports only.

A host profile cannot create public ABI by listing a new function. Unknown
entries such as `audio.event` or `gfx.draw_sprite_transform` must fail profile
validation until the corresponding public ABI is accepted through spec,
registry, verifier, SDK, report, and tests.

v0.26 recognizes the narrow Host ABI `0.11` `output.emit` package/profile/check
surface. A Host ABI `0.11` profile may list `output.emit` only when it supports
the exact bounded scalar signature documented by the v0.26 RFC. Host ABI `0.10`
profiles must not imply `output.emit` support.

The package verifier remains responsible for rejecting unknown externs and
signature mismatches. The host profile answers a separate question: whether a
known public Host ABI import is supported by this target host.

## Supported Capabilities

`supports.capabilities` declares capability families the host can authorize.

Examples:

- `debug`
- `ui`
- `gfx`
- `gpu`
- `input`
- `audio`
- `fs`
- `net`
- `time`
- `random`

Capabilities must be known AIR capability names. A profile must not introduce a
new capability by metadata alone.

## Supported Asset Kinds

`supports.assetKinds` declares asset classes a host can load or validate.

Initial kinds:

- `texture`
- `shader`
- `model`
- `material`
- `audioSfx`
- `audioMusic`
- `sprite`
- `spriteAtlas`
- `background`
- `rig`
- `binary`

Asset support does not grant authority. For example, support for `audioSfx`
means the host can validate or load SFX assets; it does not mean an AIR module
may trigger audio without `audio` capability and audio authority.

Asset support also participates in `package-check --profile`. A package that
declares `manifests.assets` must report required, supported, and unsupported
asset kinds for the selected profile.

## Supported Manifest Kinds

`supports.manifestKinds` declares manifest classes a host can consume or
validate.

Initial kinds:

- `assets`
- `gfx`
- `audio`
- `ui`

A package that declares a required manifest kind unsupported by the selected
profile must fail package-check with a clear diagnostic.

## Limits

`limits` is optional but recommended.

Initial limits:

| Limit | Meaning |
| --- | --- |
| `maxAssets` | Maximum declared assets supported by the profile. |
| `maxTextureSize` | Maximum texture dimension supported by the profile. |
| `maxAudioFiles` | Maximum audio files supported by the profile. |

Unknown limits should be rejected unless explicitly added to this spec.

## Diagnostics Expectations

`diagnostics` makes portability measurable without probing the runtime.

Initial fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `ciSafe` | boolean | Profile checks can run in CI without device/window/browser access. |
| `manualOnly` | boolean | Profile needs manual device, GPU, browser, or OS host evidence. |
| `requiredReports` | string array | Reports a reviewer should expect for this profile. |
| `unsupportedFeatureBehavior` | string | One of `fail-with-diagnostic`, `warn-with-fallback`, or `skip-with-reason`. |

Diagnostics metadata does not grant authority and does not imply deployment
support. It describes how package-check/conformance evidence should explain
unsupported capabilities, imports, manifests, assets, and host limits.

## Initial Profiles

| Profile | Purpose |
| --- | --- |
| `browser-webgpu` | Browser host for WebGPU, UI, input, audio-authority-aware packages, manifests, and asset diagnostics. |
| `native-wgpu` | Native `wgpu` host for high-level GFX stream review and native graphics evidence. |
| `cli` | CLI utility host for debug, filesystem, async IO, time, and random utility modules. |
| `verifier-only` | Static inspection profile with no runtime host implementation promise. |
| `mobile-gpu-draft` | Experimental mobile-style host profile for compatibility planning only; no runtime is implied. |

## Compatibility Algorithm

Given a package manifest and selected host profile, `package-check --profile`
should:

1. Validate `air.package.json`.
2. Load and validate the selected host profile.
3. Compare package `hostAbi` with profile `hostAbi`.
4. Verify package capabilities are known.
5. Compute effective capabilities from the entry module, package-local module
   graph, and manifest-declared authority.
6. Compare computed capabilities with both package `capabilities` and
   `supports.capabilities`.
7. Verify entry AIR module with strict Host ABI validation.
8. Collect host imports used by the module graph with origins.
9. Compare used host imports with `supports.hostImports`.
10. Compare declared manifest kinds with `supports.manifestKinds`.
11. Validate asset manifests when declared.
12. Compare declared asset kinds with `supports.assetKinds`.
13. Compare known limits.
14. Report unsupported features, warnings, fallback behavior, hidden authority,
    and repair hints.

The algorithm must not run the package or require device access.

## Unsupported Feature Diagnostics

Unsupported features must be deterministic and repairable.

Examples:

- `unsupported capability ui for profile verifier-only`
- `unsupported host import ui.metric for profile cli`
- `unsupported manifest kind gfx for profile cli`
- `unsupported asset kind model for profile verifier-only`
- `host ABI mismatch: package requires 0.10, profile supports 0.9`
- `missing profile: browser-webgpu`

Diagnostics should explain whether the issue belongs to:

- package manifest;
- AIR module imports/capabilities;
- host profile support;
- asset manifest;
- GFX/audio/UI manifest;
- future target packaging.

## Report Shape

Recommended JSON shape for profile-aware reports:

```json
{
  "profile": "browser-webgpu",
  "hostAbi": "0.10",
  "status": "pass",
  "declaredCapabilities": ["debug", "ui"],
  "computedCapabilities": ["debug", "ui"],
  "capabilities": {
    "supported": ["debug", "ui", "gfx"],
    "unsupported": []
  },
  "hostImports": {
    "supported": ["debug.metric", "ui.metric"],
    "unsupported": []
  },
  "manifests": {
    "supportedKinds": ["assets", "gfx"],
    "unsupportedKinds": []
  },
  "assets": {
    "supportedKinds": ["shader", "texture"],
    "unsupportedKinds": []
  },
  "diagnostics": {
    "ciSafe": true,
    "manualOnly": false,
    "requiredReports": ["package-check --profile"],
    "unsupportedFeatureBehavior": "fail-with-diagnostic"
  },
  "warnings": [],
  "errors": []
}
```

## Implementation Plan

Recommended implementation sequence:

1. Define profile JSON shape and validator.
2. Reject unknown top-level fields unless the spec explicitly allows them.
3. Reject unknown `supports` fields.
4. Reject unknown capability names.
5. Reject unknown host imports not present in the public Host ABI registry.
6. Reject unknown asset and manifest kinds.
7. Add helper to load profile by id.
8. Add clear diagnostics for missing or malformed profiles.
9. Integrate selected profile into `package-check --profile`.
10. Add profile section to conformance/package reports.

## Non-Goals

- No runtime probing.
- No target bundling.
- No deployable artifact generation.
- No remote host registry.
- No package registry.
- No automatic feature polyfills.
- No new public Host ABI.
- No hidden authority through host profile metadata.
