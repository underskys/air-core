# RFC: AIR v0.12 Host Profiles

Status: draft

Version target: v0.12

This RFC defines descriptive host profile metadata for package compatibility
checks. It does not add public Host ABI functions, implement deployment
bundling, create a package registry, or assume every host supports every AIR
capability.

Host profiles are support declarations. AIR packages declare requirements; host
profiles declare support; `package-check` compares them and reports pass/fail
diagnostics.

## Goals

- Give packages a deterministic way to ask whether a host supports required
  capabilities, Host ABI modules, graphics paths, UI features, assets, shaders,
  and limits.
- Keep host capability support explicit and reviewable.
- Preserve strict Host ABI verification: unknown public externs are still
  rejected by the verifier before runtime compatibility is considered.
- Separate CI-safe inspection paths from manual GPU/window/device paths.

## Non-goals

- No new public ABI.
- No package registry.
- No dependency resolver.
- No marketplace.
- No deployment bundling or `airc bundle` implementation.
- No hidden authority through profiles.
- No assumption that browser, native, CLI, and verifier-only hosts are
  interchangeable.

## Profile Fields

A host profile should declare:

| Field | Meaning |
| --- | --- |
| `id` | Stable profile id such as `browser-webgpu`. |
| `name` | Human-readable profile name. |
| `hostAbi` | Host ABI registry version this host supports. |
| `supports.capabilities` | Capabilities available in this host profile. |
| `supports.hostImports` | Exact public Host ABI imports the host implements or checks. |
| `supports.assetKinds` | Asset classes such as `texture`, `shader`, `model`, `material`, `audioSfx`, or `audioMusic`. |
| `supports.manifestKinds` | Manifest classes such as `gfx`, `assets`, or `audio`. |
| `limits` | Known portable budgets or host-specific limits. |

The draft JSON examples live in:

- [browser-webgpu.json](../data/host_profiles/browser-webgpu.json)
- [native-wgpu.json](../data/host_profiles/native-wgpu.json)
- [cli.json](../data/host_profiles/cli.json)
- [verifier-only.json](../data/host_profiles/verifier-only.json)

## Initial Profiles

### `browser-webgpu`

Browser WebGPU is the v0.11 visible product/demo host path. It is GPU and
manifest oriented. It may expose browser UI overlays in future, but profile
metadata must not imply unrestricted filesystem, network, or OS access.

Expected support:

- capabilities: `debug`, `time`, `random`, `input`, `gfx`, `gpu`, `ui`, and
  `audio` when the containing app declares the relevant authority;
- Host ABI imports: selected public `debug.*`, `input.*`, `gfx.*`, `gpu.*`,
  `ui.*`, and existing `audio.*` imports from the strict registry;
- graphics path: `.airgfx.json`, render graphs, WGSL shaders, GLB/glTF model
  fixtures, assets, materials, and fallback diagnostics;
- network policy: no real network scanning by default;
- execution: CI-safe smoke with WebGPU unavailable fallback, manual for visual
  inspection on hardware.

### `native-wgpu`

Native wgpu is the v0.11 second host evidence path and v0.12 packaging
candidate. Its profile must separate headless probes from manual GPU/window
runs.

Expected support:

- capabilities: high-level `gfx` stream, `input`, and `debug` where
  implemented;
- Host ABI imports: selected public `gfx.*`, `input.*`, and `debug.*` imports
  from the strict registry;
- graphics path: headless `gfx.*` stream probe, manual window renderer;
- execution: CI-safe headless probe, manual-only window/GPU flow.

### `cli`

CLI hosts are for validators, analyzers, data transforms, reports, and utility
modules. They should not claim graphics, UI, input, or network probing support
unless an explicit host implementation and policy exists.

Expected support:

- capabilities: `debug`, `time`, `random`, `fs`, and `io` for utility modules;
- Host ABI imports: selected public utility imports from the strict registry;
- graphics path: none by default;
- UI support: none by default;
- network policy: denied by default;
- execution: CI-safe.

### `verifier-only`

Verifier-only profiles inspect AIR source, manifests, and package metadata
without running a host runtime.

Expected support:

- capabilities: none at runtime;
- Host ABI modules: none implemented;
- graphics path: manifest/resource validation only;
- UI support: signature and manifest validation only;
- network policy: denied;
- execution: CI-safe.

## Compatibility Algorithm

Future `package-check` compatibility should run these checks:

1. Read package metadata from the v0.12 package manifest RFC
   [RFC_PACKAGE_MANIFEST_v0.12.md](RFC_PACKAGE_MANIFEST_v0.12.md).
2. Read a selected host profile.
3. Compare package `hostAbi` against profile `hostAbi`.
4. Ensure every package capability is in `supports.capabilities`.
5. Ensure every public host import appears in `supports.hostImports` and
   matches the strict Host ABI registry.
6. For `.airgfx.json`, assets, and audio manifests, compare declared manifest
   kinds against `supports.manifestKinds`.
7. Compare declared asset classes against `supports.assetKinds` when asset
   manifests are validated.
8. Compare counts and sizes against `limits`.
10. Compare network/filesystem requirements against explicit policy.
11. Emit required diagnostics for unsupported, fallback, missing, denied, or
    manual-only features.

Compatibility checks are descriptive. They do not grant authority and do not
turn optional profile support into public ABI.

## Required Diagnostics

Host profiles should require diagnostics for:

- unsupported AIR ABI version;
- unsupported Host ABI version;
- unsupported capability;
- unsupported Host ABI module;
- unsupported `gfx.*` function;
- unsupported `gpu.*` package feature;
- unsupported manifest kind or schema version;
- missing asset/model/shader/material;
- shader compile failure;
- unsupported render graph pass;
- fallback material, texture, model, or feature behavior;
- denied network or filesystem policy;
- manual-only execution path selected in CI;
- WebGPU/GPU/window unavailable.

## Security Rules

- Profiles describe support; they do not grant capabilities.
- Package metadata describes requirements; it does not grant capabilities.
- AIR source capabilities remain explicit.
- Public Host ABI remains strict.
- Assets, models, shaders, textures, GPU resources, windows, network access,
  filesystem access, and OS services remain host-owned.
- Real network scanning remains denied unless a future policy-gated host
  capability is accepted through RFC/spec/tests.

## Example Comparison

Package:

```json
{
  "name": "gfx_showcase",
  "airAbi": "0.10",
  "hostAbi": "0.10",
  "capabilities": ["gpu", "input"],
  "targetProfiles": ["browser-webgpu"],
  "manifests": {
    "gfx": "showcase.airgfx.json"
  }
}
```

Profile: `browser-webgpu`.

Expected result:

- AIR ABI version supported: pass.
- Host ABI version supported: pass.
- `gpu` and `input` capabilities supported: pass.
- `.airgfx.json` manifest supported: pass.
- GLB/glTF/WGSL/render graph support checked: pass or pass with fallback
  diagnostics.
- Unsupported PBR/material/texture/render graph behavior reported explicitly.

Same package against `cli` should fail because `gpu`, `input`, `.airgfx.json`
runtime execution, WebGPU, shaders, and model loading are unsupported in that
profile.

## Draft JSON Examples

The JSON examples under `data/host_profiles/` are draft metadata, not runtime
configuration. They are intentionally conservative and should be updated only
when host implementation, specs, tests, and diagnostics support the claim.

Future validation may check that:

- JSON files parse;
- profile ids match filenames;
- capability names are known;
- Host ABI module/function names match the registry;
- diagnostic lists include required release categories.

The planned `package-check` compatibility flow that consumes these profiles is
tracked in [PACKAGE_CHECK_v0.12_PLAN.md](PACKAGE_CHECK_v0.12_PLAN.md).
