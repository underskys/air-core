# AIR Target Packaging Model

Status: draft

Version target: v0.12

Target layer: package tooling / host profiles / compatibility checks / release
artifacts

This document describes how AIR packages can become web, native, and CLI
deliverables without making AIR Core platform-specific. It is a roadmap/design
document only. It does not implement `airc bundle`, target bundling, installers,
or platform adapters.

Related design:

- [ROADMAP_v0.12.md](ROADMAP_v0.12.md)
- [AIR package manifest](../spec/AIR_PACKAGE_MANIFEST.md)
- [Host profiles](../spec/HOST_PROFILES.md)
- [RFC_PACKAGE_MANIFEST_v0.12.md](RFC_PACKAGE_MANIFEST_v0.12.md)
- [RFC_HOST_PROFILES_v0.12.md](RFC_HOST_PROFILES_v0.12.md)
- [PACKAGE_CHECK_v0.12_PLAN.md](PACKAGE_CHECK_v0.12_PLAN.md)

## Core Principle

AIR does not directly compile to one universal standalone binary.

AIR produces verified portable modules and packages. Target-specific
deliverables combine AIR packages with host runtimes, platform adapters, asset
pipelines, and bundlers.

This keeps AIR Core focused on portable semantics:

- verifier rules;
- strict Host ABI imports;
- capabilities;
- effects and resource accounting;
- deterministic lowering;
- package/report metadata.

Platform devices, browser APIs, native windows, GPU backends, audio backends,
filesystems, network policy, and deployment formats belong to hosts and target
bundles.

## Artifact Pipeline

```text
AIR source
-> verifier
-> WASM / AIR module
-> AIR package
-> target bundle
-> deployable artifact
```

Each step adds a different kind of responsibility:

| Stage | Responsibility |
| --- | --- |
| AIR source | Portable AIR code, capabilities, host imports, deterministic module logic. |
| Verifier | Core validity, strict Host ABI signatures, capability checks, effect/resource checks. |
| WASM / AIR module | Lowered or verifier-checked module artifact with no target deployment assumptions. |
| AIR package | Module, manifests, assets, metadata, capabilities, compatibility expectations. |
| Target bundle | Host runtime plus package and target-specific glue. |
| Deployable artifact | Static site, native app/archive, or CLI/WASI artifact. |

## Artifact Layers

### AIR Module

An AIR module contains verified portable logic:

- module exports;
- strict host imports;
- declared capabilities;
- effects and resource expectations;
- no platform-specific assumptions.

An AIR module does not own:

- browser APIs;
- native windows;
- WebGPU/Metal/Vulkan objects;
- audio devices;
- filesystem or network authority;
- deployable app layout.

### AIR Package

An AIR package is the portable review and compatibility unit.

It may contain:

- `air.package.json`;
- AIR source modules;
- `module.wasm` or another compiled module artifact;
- `.airgfx.json` or other manifests;
- asset manifests;
- assets;
- shaders;
- package metadata;
- capability requirements;
- conformance expectations;
- generated package-local helper modules.

The package declares what it needs. It does not force a host to support those
needs.

### Target Bundle

A target bundle combines an AIR package with a host runtime:

- browser host and JavaScript loader;
- native host executable and platform adapter;
- CLI/WASI runner;
- selected host profile;
- policy configuration;
- asset copying or embedding;
- diagnostics and conformance report presentation.

Target bundles are host-specific.

### Deployable Artifact

A deployable artifact is what a user or reviewer can run:

- static web directory;
- native executable plus sidecar package;
- native app bundle/archive;
- CLI/WASI command directory;
- future installer format.

The deployable artifact is not an AIR Core output by itself. It is a product of
AIR package plus target host tooling.

## Target Profiles

Target profiles describe what a host supports. Package compatibility is checked
by comparing package requirements against a selected profile.

### `webgpu`

Purpose:

- static browser site;
- WebGPU host;
- JavaScript/WASM/assets;
- diagnostics and conformance panel.

Expected deliverable:

```text
dist/webgpu/
  index.html
  assets/
  module.wasm
  air.package.json
  host.js
```

Notes:

- suitable for GitHub Pages, GitLab Pages, or static hosting;
- WebGPU availability must be diagnosed;
- browser audio/input policies remain host-owned;
- package assets remain manifest-validated.

### `webgl-fallback`

Status: future.

Purpose:

- browser fallback path for hosts without WebGPU;
- limited graphics feature set;
- explicit compatibility diagnostics.

Notes:

- not a promise that every WebGPU package can run under WebGL;
- package-check must report unsupported render graph, shader, asset, or buffer
  features.

### `native-wgpu`

Purpose:

- native host executable;
- `wgpu`-style graphics backend;
- embedded or sidecar AIR package.

Expected deliverable:

```text
dist/native-wgpu/
  air-host
  package/
    air.package.json
    module.wasm
    assets/
```

Notes:

- platform adapters own window/input/GPU/audio/filesystem/network policy;
- native host may be CI-safe for headless probes and manual for GPU/window runs;
- sidecar package is preferred first because it is easier to inspect.

### `macos-metal`

Status: future / specialized.

Purpose:

- macOS-focused native host using Metal directly or through a compatible layer;
- app bundle or archive when practical.

Notes:

- should not affect AIR Core semantics;
- may share package/profile compatibility with `native-wgpu`;
- native packaging details belong to host tooling.

### `wasi-cli`

Purpose:

- validators;
- analyzers;
- data transforms;
- DevOps-style tools;
- no graphics by default.

Expected deliverable:

```text
dist/wasi-cli/
  tool.wasm
  air.package.json
  README.md
```

Notes:

- filesystem and network access require explicit policy;
- graphics/input/audio capabilities should fail unless a specific CLI host
  declares support;
- useful for verifier-only and automation workflows.

### `unity-host`

Status: architecture note only.

Purpose:

- future Unity host integration design.

Notes:

- no Unity adapter implementation in v0.12 target packaging planning;
- Unity objects and engine APIs must remain host-owned;
- AIR packages would declare capabilities and manifests, then Unity host would
  decide what it supports.

## Future Commands

These commands are design targets, not implemented behavior in this task:

```sh
airc package examples/gfx_showcase
airc inspect dist/gfx_showcase.airpkg
airc bundle --target webgpu examples/gfx_showcase
airc bundle --target native-wgpu examples/gfx_showcase
airc bundle --target wasi-cli examples/network_dashboard
```

Expected command roles:

| Command | Role |
| --- | --- |
| `airc package <path>` | Build or collect an AIR package from source, manifests, and assets. |
| `airc inspect <airpkg>` | Print deterministic package metadata and compatibility summary. |
| `airc bundle --target webgpu <path>` | Create a static browser target bundle. |
| `airc bundle --target native-wgpu <path>` | Create a native host + AIR package target bundle. |
| `airc bundle --target wasi-cli <path>` | Create a CLI/WASI-oriented target bundle. |

## Compatibility Rules

The same AIR package can run on multiple targets only when the host supports the
package requirements.

Examples:

- a package requiring `{ debug }` may run on verifier-only, CLI, browser, and
  native hosts if imports are supported;
- a package requiring `{ ui, debug }` needs a UI-capable host;
- a package requiring `{ gpu, input }` needs a graphics/input host;
- a package requiring `{ fs, net }` needs explicit host policy grants;
- a package requiring unsupported capabilities must fail with clear diagnostics.

Package-check compares:

- package AIR ABI;
- package Host ABI;
- required capabilities;
- public host imports;
- manifest kinds;
- asset kinds;
- target profile support;
- host limits;
- known unsupported features;
- fallback behavior.

## Diagnostics

Target packaging must report unsupported features instead of silently producing
broken artifacts.

Required diagnostics:

- unsupported capability;
- unsupported host import;
- missing or unsupported manifest kind;
- missing asset;
- unsupported asset kind or format;
- WebGPU unavailable;
- native GPU/window unavailable;
- audio policy unavailable;
- filesystem/network policy missing;
- fallback used;
- placeholder asset detected;
- target profile mismatch.

## Non-Goals

- No implementation in this task.
- No Unity adapter implementation.
- No package registry.
- No dependency resolver.
- No remote package downloads.
- No promise that one binary runs everywhere.
- No platform code in AIR Core semantics.
- No WebGPU/Metal/WASI details in AIR Core semantics.
- No bypass of Host ABI capability checks.
- No hidden authority from manifests or assets.
