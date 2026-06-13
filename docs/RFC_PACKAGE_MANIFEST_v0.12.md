# RFC: AIR v0.12 Package Manifest

Status: draft

Version target: v0.12

This RFC defines the planned package manifest metadata and compatibility model
for v0.12 Target Packaging work. It is a planning document only: it does not
implement target packaging, a registry, a dependency resolver, new AIR Core
syntax, or new public Host ABI functions.

## Problem

v0.11 packages already expose enough evidence for demos and conformance checks:
AIR source can verify, lower to WASM where supported, reference manifests, and
produce host-facing reports. v0.12 needs a clearer package metadata contract so
hosts and tools can compare package requirements against host support before a
module runs.

The package manifest must answer:

- what module is this package;
- which AIR and Host ABI contracts it expects;
- which capabilities and target profiles it needs;
- which optional graphics/UI/app manifests are part of the package;
- which artifacts, assets, reports, and checksums belong to the package;
- whether a given host can run or inspect it safely.

## Core Principle

AIR packages declare requirements. Hosts declare support. `package-check`
compares the two and reports compatibility.

Manifests cannot grant hidden authority. AIR modules still need explicit
capabilities, the Host ABI remains strict, and assets/resources remain
host-owned.

Host support metadata is drafted separately in
[RFC_HOST_PROFILES_v0.12.md](RFC_HOST_PROFILES_v0.12.md). Package manifests
declare what a package needs; host profiles declare what a host can provide.

## Package Identity

A v0.12 package manifest should include these identity fields:

| Field | Required | Meaning |
| --- | --- | --- |
| `name` | yes | Stable package name used by tools and reports. |
| `version` | yes | Package version, preferably SemVer-compatible for tools. |
| `entry` | yes | Main AIR module entry path. |
| `wasm` | no before build, yes in built checks | Compiled module artifact path. |
| `airAbi` | yes | AIR ABI version expected by the module/package. |
| `hostAbi` | yes | Host ABI registry version expected by public extern imports. |
| `capabilities` | yes | Required AIR capabilities such as `ui`, `debug`, `gpu`, `input`, `fs`, or `net`. |
| `targetProfiles` | yes | Target profiles the package expects or has been checked against. |
| `manifests` | no | Optional manifest references such as `.airgfx.json`, UI manifests, or app manifests. |

Draft shape:

```json
{
  "name": "network_dashboard",
  "version": "0.1.0",
  "entry": "dashboard.air",
  "wasm": "module.wasm",
  "airAbi": "0.10",
  "hostAbi": "0.10",
  "capabilities": ["ui", "debug"],
  "targetProfiles": ["browser-webgpu", "verifier-only"],
  "manifests": {
    "ui": "dashboard.ui.json"
  }
}
```

`hostAbi` is explicit even if it initially matches `airAbi`.
Separating the fields prevents future host import registry compatibility from
being confused with AIR Core or compiler compatibility.

## Artifact Layout

A package directory may contain:

| Path | Meaning |
| --- | --- |
| `air.package.json` | Package identity, requirements, manifest references, and artifact references. |
| `src/` | Source AIR modules when source distribution is enabled. |
| `module.wasm` | Compiled AIR module artifact when lowering/building is supported. |
| `*.airgfx.json` | Graphics manifest for GPU/render graph packages. |
| `*.ui.json` | Optional UI/app manifest if that layer is accepted later. |
| `assets/` | Model, texture, sprite, data, or fixture assets owned by the package/host layer. |
| `shaders/` | WGSL or other host-consumed shader resources. |
| `reports/` | Audit, verifier, package-check, conformance, or host smoke reports. |
| `checksums.json` | Optional/future checksums for reproducible artifact verification. |

The manifest describes files and requirements. It does not make assets,
textures, GPU buffers, host windows, file handles, sockets, or operating system
services available to AIR. Those remain host-owned and capability-gated.

## Target Profiles

Initial v0.12 package manifests should use a small set of target profile names:

| Profile | Meaning |
| --- | --- |
| `browser-webgpu` | Browser host with WebGPU, JavaScript glue, WASM, manifests, and browser-safe assets. |
| `native-wgpu` | Native host using a wgpu-style GPU backend and explicit platform adapters. |
| `cli` | Command-line host with no graphics by default. Suitable for validators, analyzers, and data transforms. |
| `verifier-only` | Package can be verified/audited/reported without running a host. |

Target profiles are compatibility declarations, not bundler commands. They do
not imply `airc bundle`, native installers, static site generation, or a
deployable artifact pipeline in this RFC.

## Compatibility Model

Compatibility is a comparison between package requirements and host support:

1. Package declares `airAbi`, `hostAbi`, `capabilities`,
   `targetProfiles`, public host imports, optional manifests, and assets.
2. Host declares supported AIR ABI versions, Host ABI versions, capabilities,
   target profile, manifest kinds, asset/model/shader support, and policy
   limits. See [RFC_HOST_PROFILES_v0.12.md](RFC_HOST_PROFILES_v0.12.md).
3. `package-check` compares the package and host declarations.
4. Unsupported requirements fail with clear diagnostics and repair hints.

Compatibility report fields should align with
[CONFORMANCE_REPORT_v0.11.md](CONFORMANCE_REPORT_v0.11.md) where practical:
module name, ABI versions, capabilities, host imports, manifest features, loaded
or declared assets, unsupported host features, fallback behavior, warnings,
errors, status, and repair hints.

Example compatibility outcomes:

| Package requirement | Host support | Result |
| --- | --- | --- |
| `capabilities: ["ui", "debug"]` | Browser UI host supports `ui` and `debug` | pass |
| `capabilities: ["gpu", "input"]` | CLI host has no GPU/input support | fail with unsupported capabilities |
| `.airgfx.json` with GLB assets | Browser WebGPU host supports GLB loading | pass or pass with fallback diagnostics |
| `capabilities: ["fs", "net"]` | Host policy denies both | fail with policy diagnostics |
| Host ABI `0.11` required | Host supports only `0.10` | fail with version diagnostic |

## Security Model

Package manifests are descriptive. They must not grant authority by themselves.

Security rules:

- Capabilities remain explicit in AIR source and package metadata.
- Host ABI remains strict: unknown public host externs are rejected.
- Hosts own files, network access, GPU devices, windows, input devices,
  textures, shaders, pipelines, and native resources.
- Assets/resources are data references for hosts to load or reject.
- Network, filesystem, and OS-like capabilities require explicit host policy.
- Hidden authority through manifests is forbidden.
- Unsupported or denied capabilities must fail with diagnostics, not silently
  degrade into partial authority.

## Examples

### Simple Utility Package

```json
{
  "name": "packet_flags",
  "version": "0.1.0",
  "entry": "packet_flags.air",
  "wasm": "module.wasm",
  "airAbi": "0.10",
  "hostAbi": "0.10",
  "capabilities": [],
  "targetProfiles": ["cli", "verifier-only"],
  "manifests": {}
}
```

Expected compatibility: verifier-only and CLI hosts can inspect or run the
module without graphics, network, or filesystem authority.

### UI/Network Dashboard Package

```json
{
  "name": "network_dashboard",
  "version": "0.1.0",
  "entry": "dashboard.air",
  "wasm": "module.wasm",
  "airAbi": "0.10",
  "hostAbi": "0.10",
  "capabilities": ["ui", "debug"],
  "targetProfiles": ["browser-webgpu", "verifier-only"],
  "manifests": {}
}
```

Expected compatibility: host can render UI widgets and debug metrics from mock
data. Real network scanning is out of scope and would require separate
capability and policy work.

### GFX Stream Package

```json
{
  "name": "gfx_stream_demo",
  "version": "0.1.0",
  "entry": "gfx.air",
  "wasm": "module.wasm",
  "airAbi": "0.10",
  "hostAbi": "0.10",
  "capabilities": ["gfx"],
  "targetProfiles": ["native-wgpu", "verifier-only"],
  "manifests": {}
}
```

Expected compatibility: host supports the existing high-level `gfx.*` stream.
This does not add new public `gfx.*` functions.

### `.airgfx` / `gpu` Package Placeholder

```json
{
  "name": "gfx_showcase",
  "version": "0.1.0",
  "entry": "showcase.air",
  "wasm": "gfx_showcase.wasm",
  "airAbi": "0.10",
  "hostAbi": "0.10",
  "capabilities": ["gpu", "input"],
  "targetProfiles": ["browser-webgpu", "native-wgpu", "verifier-only"],
  "manifests": {
    "gfx": "showcase.airgfx.json"
  },
  "artifacts": {
    "assets": "assets/",
    "shaders": "shaders/",
    "reports": "reports/"
  }
}
```

Expected compatibility: host checks `.airgfx.json`, declared assets, shader
paths, render graph features, public `gpu.*` imports, and fallback behavior.
Unsupported GLB/glTF, shader, material, or render graph features must report
diagnostics rather than silent drops.

## Non-goals

- No package registry.
- No dependency resolver.
- No marketplace.
- No deployable target bundler.
- No `airc bundle` implementation.
- No native installer generation.
- No static hosting publisher.
- No new AIR Core syntax.
- No new public Host ABI.
- No hidden capability grants through manifests.
- No promise that one binary runs on every target.

## Open Questions

- Whether `hostAbi` should use the same numbering as AIR ABI initially
  or a separate registry version from the first v0.12 implementation.
- Whether checksums should be optional metadata or required for release
  packages.
- Whether host support declarations should live beside package manifests, in
  conformance reports, or both.
- Whether source AIR modules are required in review packages or optional for
  binary-only package distribution.

## Acceptance For Future Implementation

Future implementation work should be split into reviewable slices:

1. Document the final manifest schema.
2. Teach `package-check` to compare package requirements with host support.
3. Emit deterministic compatibility reports.
4. Add tests for utility, UI dashboard, `gfx.*` stream, and `.airgfx`/`gpu`
   packages.
5. Keep target bundling and deployable artifacts outside this RFC unless a
   separate v0.12 task explicitly accepts that work.

The compatibility gate implementation sequence is tracked in
[PACKAGE_CHECK_v0.12_PLAN.md](PACKAGE_CHECK_v0.12_PLAN.md).
