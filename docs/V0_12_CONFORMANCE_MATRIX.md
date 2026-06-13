# AIR v0.12 Conformance Matrix

Status: draft release-gate document

Version target: v0.12

AIR portability is measured by explicit package requirements compared with
host profiles. AIR does not promise one universal binary. AIR produces verified
portable packages; hosts own platform execution.

## Contract

| Layer | Responsibility |
| --- | --- |
| AIR Core | Portable verified behavior, capabilities, strict Host ABI validation, audit/report data. |
| AIR package | Entry module, manifests, assets, generated handles, declared capabilities, target profile expectations. |
| Host profile | Supported capabilities, Host ABI imports, manifest kinds, asset kinds, limits, diagnostics expectations. |
| Host runtime | Browser/native/mobile-style/CLI execution, devices, windows, GPU/audio/filesystem/network mechanics. |

Host profiles are compatibility contracts, not deployment bundles. A package may
be portable across profiles only when every required capability, host import,
manifest kind, asset kind, and limit is supported by each selected profile.

## Profiles

| Profile | Status | CI-safe | Purpose | Typical failure mode |
| --- | --- | --- | --- | --- |
| `verifier-only` | stable static profile | yes | Static verifier/report inspection with no runtime host behavior. | Any host capability/import fails unless the package is verifier-only. |
| `browser-webgpu` | active | yes for package-check; manual for browser smoke | Browser host with WebGPU/UI/input/audio asset diagnostics. | Unsupported imports/assets/manifests fail with repair hints. |
| `native-wgpu` | active host evidence | manual | Native graphics host profile for high-level GFX stream and native review evidence. | Browser-only UI/GPU package features may fail. |
| `cli` | active | yes | Utility profile for debug/time/random/fs/io packages. | GFX/UI/audio/input packages fail. |
| `mobile-gpu-draft` | experimental metadata only | manual | Mobile-style compatibility planning profile; no runtime is implied. | Limits and unsupported imports must fail diagnostically. |

## Required Report Fields

For profile-aware package checks, reviewers should inspect:

- `package`
- `profile`
- `status`
- `declaredCapabilities`
- `computedCapabilities`
- `capabilities.required/supported/unsupported`
- `hostImports.used/unsupported`
- `manifests`
- `assetKinds.required/supported/unsupported`
- `profileSupport`
- `profileSupport.diagnostics`
- `hiddenAuthority`
- `unsupportedHostFeatures`
- `repairHints`
- `checks`

## Release Gate Examples

CI-safe package compatibility:

```sh
node bin/airc.js package-check examples/profile_portability --profile browser-webgpu --json
node bin/airc.js package-check examples/profile_portability --profile native-wgpu --json
```

Manual or toolchain-dependent compatibility:

```sh
node bin/airc.js package-check <package-dir> --profile verifier-only --json
node bin/airc.js package-check <package-dir> --profile mobile-gpu-draft --json
```

The second group is profile metadata validation unless a concrete host/runtime
smoke command exists. It must not be treated as target bundling.

## Interpretation

`pass` means the package requirements fit the selected profile metadata.

`warn` means the package is structurally checkable but includes review debt such
as extra capabilities, placeholder assets, debug-metric migration debt, or
manual-only evidence.

`fail` means the package is not compatible with the selected profile. The report
must make the failing layer explicit: package manifest, AIR module, Host ABI,
manifest kind, asset kind, hidden authority, host ABI version, or profile
limits.

## Non-Goals

- No target bundler.
- No universal standalone binary promise.
- No runtime host probing.
- No mobile runtime implementation.
- No platform objects in AIR.
- No hidden authority through profile metadata.
