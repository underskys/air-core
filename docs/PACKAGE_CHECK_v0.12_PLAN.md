# AIR v0.12 Package Check Plan

Status: draft plan

Version target: v0.12

This document plans how `package-check` should evolve into the compatibility
gate for v0.12 package manifests and host profiles. It is planning only: it
does not implement target packaging, a package registry, new public ABI, or AIR
Core syntax changes.

Authority docs:

- [RFC_PACKAGE_MANIFEST_v0.12.md](RFC_PACKAGE_MANIFEST_v0.12.md)
- [RFC_HOST_PROFILES_v0.12.md](RFC_HOST_PROFILES_v0.12.md)
- [CONFORMANCE_REPORT_v0.11.md](CONFORMANCE_REPORT_v0.11.md)
- [V0_11_GAP_REPORT.md](archive/v0.11/V0_11_GAP_REPORT.md)

## Current v0.11 Behavior

Current `package-check` is intentionally small:

- CLI entry: `node bin/airc.js package-check <dir>`
- SDK implementation: `validatePackageDir(packageDir)` in
  [src/sdk.js](../src/sdk.js)
- Current checks:
  - legacy `air-package.json` exists, or v0.12 `air.package.json` exists;
  - referenced WASM exists;
  - referenced manifest exists when declared;
  - manifest hash matches when declared.
  - v0.12 package manifest fields are schema-checked by
    `node bin/airc.js package-manifest-check <dir>`.
- Current output shape:

```json
{
  "ok": true,
  "module": "example",
  "abi": "0.10",
  "capabilities": [],
  "wasm": "example.wasm",
  "manifest": null
}
```

v0.12 compatibility work must preserve this simple behavior unless a caller
opts into the new profile-aware mode.

## Required Package Fields

Profile-aware `package-check` should accept the current v0.10 metadata while
preferring the v0.12 package manifest fields from
[RFC_PACKAGE_MANIFEST_v0.12.md](RFC_PACKAGE_MANIFEST_v0.12.md).

Required package fields for v0.12 compatibility:

| Field | Required | Compatibility use |
| --- | --- | --- |
| `name` or `module` | yes | Report identity and host diagnostics. |
| `version` | yes for v0.12 manifests | Package version display and future release checks. |
| `entry` or `wasm` | yes | Compiled module artifact lookup. |
| `airAbi` or legacy `abi` | yes | Compare against supported AIR ABI versions. |
| `hostAbi` | yes for v0.12 manifests | Compare against profile `hostAbi`. |
| `capabilities` | yes | Compare against supported/optional host capabilities. |
| `imports` | yes when present | Compare public host imports against Host ABI modules/functions. |
| `targetProfiles` | yes for v0.12 manifests | Ensure selected profile is declared or warn when absent. |
| `manifests` or `manifest` | optional | Trigger manifest kind/feature checks. |
| `artifacts` | optional | Asset, shader, report, and checksum lookup. |
| `manifestHash` / checksums | optional | Integrity validation. |

Compatibility aliases should be explicit:

- v0.10 `module` maps to v0.12 `name` for reporting.
- v0.10 `abi` maps to v0.12 `airAbi`.
- v0.10 `manifest` maps to `manifests.gfx` only when it is an `.airgfx.json`
  package manifest.
- v0.10 package metadata has no `hostAbi`; profile-aware mode should
  warn and default to the AIR ABI only until v0.12 metadata exists.

## Required Host Profile Fields

Host profile files are drafted in `data/host_profiles/` and described by
[RFC_HOST_PROFILES_v0.12.md](RFC_HOST_PROFILES_v0.12.md).

Required fields:

| Field | Required | Compatibility use |
| --- | --- | --- |
| `id` | yes | Selected profile name. |
| `name` | yes | Human-readable host name. |
| `hostAbi` | yes | Host ABI registry version supported by this profile. |
| `supports.capabilities` | yes | Required package capability pass/fail. |
| `supports.hostImports` | yes | Exact public Host ABI import support. |
| `supports.assetKinds` | yes | Asset/model/shader/material/audio support classes. |
| `supports.manifestKinds` | yes | Manifest class support such as `gfx`, `assets`, or `audio`. |
| `limits` | yes | Known host limits for assets, textures, and audio files. |

## Compatibility Algorithm

Profile-aware `package-check` should run in phases:

1. Load the package directory with the existing v0.11 checks.
2. Normalize package metadata into a v0.12 compatibility object.
3. Load the selected host profile.
4. Validate the host profile shape.
5. Compare AIR ABI version.
6. Compare Host ABI version when package metadata declares it.
7. Compare required capabilities.
8. Compare public host imports.
9. Compare manifest kind and manifest schema version.
10. Compare manifest features against profile support.
11. Compare asset/model/shader/material declarations.
12. Compare UI requirements.
13. Compare network/filesystem requirements against policy.
14. Compare limits/budgets where both package and profile define them.
15. Emit a deterministic compatibility report.

The existing package existence/hash checks must remain the first phase so broken
package directories fail before compatibility policy is considered.

## Report Output

v0.12 should add a deterministic JSON report while preserving the current
minimal output for existing callers.

Recommended report shape:

```json
{
  "reportVersion": "0.12-draft",
  "status": "pass",
  "package": {
    "name": "gfx_showcase",
    "version": "0.1.0",
    "airAbi": "0.10",
    "hostAbi": "0.10",
    "capabilities": ["gpu", "input"],
    "targetProfiles": ["browser-webgpu"]
  },
  "hostProfile": {
    "id": "browser-webgpu",
    "hostAbi": "0.10"
  },
  "checks": [],
  "warnings": [],
  "errors": [],
  "unsupportedHostFeatures": [],
  "fallbackBehavior": [],
  "repairHints": []
}
```

Each `checks[]` entry should include:

| Field | Meaning |
| --- | --- |
| `id` | Stable check id such as `air-abi-version`. |
| `status` | `pass`, `warning`, or `fail`. |
| `packageValue` | Requirement read from package metadata. |
| `hostValue` | Support read from the selected host profile. |
| `message` | Human-readable diagnostic. |
| `repairHint` | Optional concrete next action. |

## Errors vs Warnings

Errors fail compatibility:

- missing package metadata (`air-package.json` or `air.package.json`);
- missing WASM;
- missing declared manifest;
- manifest hash mismatch;
- unsupported AIR ABI version;
- unsupported Host ABI version;
- required capability not supported;
- public host import module not supported by profile;
- public host import function not supported by profile;
- unknown public host import rejected by strict Host ABI;
- required manifest kind unsupported by profile;
- required asset/model/shader format unsupported by profile;
- denied network/filesystem policy;
- package explicitly targets a different profile and no override is provided.

Warnings keep compatibility report status as `pass` or `warning` depending on
policy:

- v0.10 package lacks v0.12-only fields such as `hostAbi` or `version`;
- selected profile not listed in legacy package metadata;
- optional capability requires policy/mode enablement;
- host supports a feature with fallback behavior;
- manual-only execution path selected;
- checksums are absent when not required;
- profile limits are unknown.

## Capabilities And Imports

Capabilities and imports must be checked separately:

- Capabilities answer whether AIR is allowed to request a family of host
  behavior.
- Imports answer whether the exact public Host ABI names and signatures are
  known and supported.

Algorithm:

1. Sort package `capabilities`.
2. For each capability:
   - pass if in `hostProfile.supports.capabilities`;
   - fail otherwise.
3. For each package import:
   - verify the import exists in the strict Host ABI registry;
   - verify the full import name appears in `hostProfile.supports.hostImports`;
   - verify required capability is declared by package metadata.

This preserves the v0.11 rule: demo-generated or hallucinated host imports do
not become public ABI.

## Manifest Feature Comparison

Manifest checks should remain layer-specific:

- `gfx-check` / `app-check` validate `.airgfx.json` structure, handles,
  resources, render graph lifecycle, and budgets.
- Profile-aware `package-check` compares the already-declared manifest features
  against host support.

For `.airgfx.json` packages, compare:

- manifest schema version;
- required target backend/profile;
- use of render graphs;
- render target count and formats;
- shader language and shader file declarations;
- material model and texture requirements;
- model asset formats;
- input bindings;
- UI manifest sections;
- post effects;
- fallback-relevant features.

If a feature is valid in the manifest but unsupported by the selected host, the
report should include `unsupportedHostFeatures` rather than treating it as a
Core verifier error.

## Unsupported Host Features

Unsupported host features should be deterministic, sorted, and repairable.

Examples:

- `unsupported capability gpu for profile cli`
- `unsupported host import gpu.execute_render_graph for profile native-wgpu`
- `unsupported manifest feature glb-gltf-model-loading for profile cli`
- `unsupported shader language wgsl for profile verifier-only runtime`
- `network capability denied by profile policy`
- `manual-only window path selected in CI`

Fallback behavior should be separate from unsupported failures:

- `material fallback used: default material`
- `texture fallback used: checkerboard`
- `post pass fallback used: reference probe`
- `WebGPU unavailable: browser host reported unsupported state`

## Keeping v0.11 Stable

v0.12 implementation must not destabilize current v0.11 behavior.

Rules:

- `node bin/airc.js package-check <dir>` keeps the current minimal checks and
  output unless a new flag opts into profile-aware reporting.
- Existing package-check tests continue to pass unchanged.
- Profile-aware behavior uses an explicit option, for example:

```sh
node bin/airc.js package-check <dir> --profile browser-webgpu --json
```

- Source/audit mode is explicit:

```sh
node bin/airc.js package-check <dir> --profile browser-webgpu --source-only --json
```

- Source/audit mode does not require `wasm` and should still report manifest
  validity, declared/computed capabilities, host imports, audio authority,
  profile support, hidden-authority diagnostics, and repair hints.
- Built mode is the default and requires the declared `wasm` artifact to exist.
- No target bundling, registry, install command, deployment artifact, or
  package publishing behavior belongs in `package-check`.
- No public Host ABI functions are added through this work.
- No AIR Core syntax changes are added through this work.

## Implementation Slices

Recommended low-risk sequence:

1. Add profile file loader and JSON shape validation.
2. Add package metadata normalization from v0.10 and v0.12 fields.
3. Add `--profile <id>` plus `--json` report mode behind tests.
4. Add ABI/capability/import compatibility checks.
5. Add manifest feature extraction from existing `gfx-check` summaries.
6. Add unsupported/fallback host feature reporting.
7. Add host profile examples to review bundle allowlists if needed.
8. Add docs and release checklist commands.

Each slice should keep existing package-check behavior green before expanding
the next check class.

## Non-goals

- No package registry.
- No deployable target artifacts.
- No target bundler.
- No dependency resolver.
- No marketplace.
- No new public ABI.
- No AIR Core syntax changes.
- No real network scanning.
- No hidden authority through package or profile metadata.
