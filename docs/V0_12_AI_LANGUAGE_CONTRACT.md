# AIR v0.12 AI-Language Execution Contract

Status: active v0.12 contract

Version target: v0.12

AIR means AI Intermediate Representation. AIR is an AI-first verified
intermediate representation for portable Wasm modules.

AIR exists to let AI generate small, structured, capability-scoped modules that
machines can verify and humans can review.

Slogan:

```text
AI writes. AIR verifies. Host runs. Human decides.
```

Related documents:

- [AIR Layer Manifest](../spec/AIR_LAYER_MANIFEST.md)
- [AIR Platform Contract](../spec/AIR_PLATFORM_CONTRACT.md)
- [Public API Hygiene](PUBLIC_API_HYGIENE.md)
- [AIR v0.12 Roadmap](ROADMAP_v0.12.md)
- [AIR v0.12 Phase Plan](V0_12_PHASE_PLAN.md)
- [AIR v0.12 Feature Status](FEATURE_STATUS_v0.12.md)

## Purpose

v0.12 is an AI-language hardening release. It does not make AIR a general
application framework. It makes generated AIR easier to verify, review, repair,
package, and match against real host capabilities.

The release has three practical goals:

- reduce AI-generated slop;
- enforce package, capability, and host-profile boundaries;
- keep demo pressure out of AIR Core, stdlib, and public Host ABI.

## Anti-Slop Goals

AIR should guide generators toward source that is small, deterministic, and
reviewable:

- canonical syntax and deterministic formatter output;
- small modules instead of giant generated blobs;
- deterministic audit, explain, package-check, and conformance reports;
- explicit capabilities, effects, imports, manifests, assets, and host profile
  requirements;
- bounded data and bounded control flow instead of dynamic objects;
- package-local generated handles, constants, static scalar tables, and modules
  instead of repeated magic literals;
- repairable diagnostics that tell an AI or human what to change.

v0.12 tools should reject or warn on common slop patterns:

- hidden capability use;
- unsupported host imports for the selected profile;
- debug metrics used as an event or side-effect bus;
- repeated literal floods that should become constants or generated handles;
- package/profile mismatch;
- demo vocabulary leaking into public surfaces;
- unused imports, unreachable blocks, and oversized generated modules where
  diagnostics can identify them deterministically.

## AI Review Report Defaults

`airc report --ai-review <module.air>` adds advisory diagnostics for generated
source quality. These diagnostics are review signals, not verifier failures,
unless they expose semantic or authority violations already rejected elsewhere.

Default warning thresholds:

| Signal | Default |
| --- | ---: |
| Repeated non-trivial literal | 3 uses |
| Magic host-call literal candidate | absolute value >= 2 |
| Large module | 220 non-empty lines or 180 statements |
| Large function | 80 statements or 20 blocks |
| Table-like indexed naming group | 3 names |

Repair hints should point to existing or planned AIR mechanisms:

- generated package-local handles for manifest-backed IDs;
- module constants for repeated scalar values;
- static scalar tables for repeated slot-style data, once accepted;
- package-local module split for oversized files/functions, once accepted;
- explicit capabilities and profile support for hidden authority;
- explicit capability-qualified event ABI only after it is accepted.

## Portability Goals

AIR source should remain portable when the selected host profile supports the
same declared requirements. Portability is explicit, not assumed.

v0.12 portability is built on:

- scalar Host ABI imports qualified by capabilities;
- `air.package.json` package requirements;
- host profiles for browser, native, CLI, verifier-only, mobile, Linux,
  Windows, and future host families;
- manifest validation for assets, GFX, audio, and package-local resources;
- deterministic package-check output that reports unsupported capabilities,
  imports, manifests, asset kinds, and limits.

Hosts own platform mechanics: browser DOM, native windows, mobile APIs, GPU
devices, audio devices, filesystem, network, input devices, timers, and OS
policy. AIR modules see only portable scalar values and manifest-backed handles.

## Layer Contract

AIR Core contains portable IR semantics, parser, formatter, verifier, lowering,
audit/report behavior, capabilities, effects, memory contracts, bounded control
flow, module/package validation, and strict Host ABI validation.

AIR Stdlib contains only pure deterministic backend-neutral resource-free
helpers.

Host ABI contains generic scalar, pointer, and handle imports qualified by
capability.

Packages contain app-local modules, manifests, generated handles, assets,
profile requirements, and reports.

Hosts own browser, native, mobile, OS, GPU, audio, filesystem, network, window,
device, and runtime mechanics.

Demos and products are evidence, not authority.

## Demo/Core Boundary

Demo pressure can justify a request, RFC, test fixture, or reusable kit. It does
not directly approve AIR Core syntax, stdlib helpers, public Host ABI functions,
manifest schema fields, or package behavior.

Do not promote these into AIR Core, stdlib, or public Host ABI:

- demo vocabulary;
- game objects;
- art direction;
- material IDs;
- level names;
- actor names;
- weapon, pickup, boss, player, enemy, platformer, or demo-specific concepts.

Any public Host ABI addition requires all of these together:

- spec update;
- registry update;
- verifier/signature checks;
- capability checks;
- package-check, profile, and report support;
- host-profile declarations;
- generic fixtures and tests;
- migration notes;
- no demo-specific naming.

## Authority Rules

AIR must not gain hidden authority through convenience features.

- `debug.metric` is diagnostic telemetry only.
- `debug.metric` must not become the final transport for audio, effects,
  gameplay, filesystem, network, UI, or any other side effect.
- Assets do not grant authority.
- An audio file in a manifest does not grant playback permission.
- Generated handles do not grant host authority.
- Host profiles describe support; they do not create public ABI.
- A package or module must declare every capability it uses or causes through
  host behavior.
- The selected host profile must explicitly support required capabilities,
  imports, manifests, asset kinds, and limits.

## What AIR Is

AIR is:

- an AI-first verified IR;
- a portable Wasm module source language;
- a strict capability and Host ABI boundary;
- a package/profile compatibility surface;
- a human-reviewable target for AI-generated modules;
- a place for bounded, deterministic, scalar-first behavior.

## What AIR Is Not

AIR is not:

- a game engine;
- a browser framework;
- a dynamic scripting language;
- a renderer API dumping ground;
- a package registry;
- a replacement for Rust, TypeScript, Kotlin, Swift, Zig, C++, Python, Unity,
  Unreal, WebGPU, Metal, or native runtimes.

## Forbidden v0.12 Core Expansions

v0.12 must not add:

- dynamic maps;
- garbage collection;
- generics;
- runtime reflection;
- dynamic imports;
- remote imports;
- package registry behavior;
- runtime module loading;
- host object handles;
- demo-specific ABI;
- browser/native special cases in AIR Core semantics.
