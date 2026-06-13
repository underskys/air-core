# AIR Project Boundaries

## Purpose

AIR is an AI-first verified language/package contract. The repository keeps
strict boundaries to prevent AI-generated bloat, hidden authority, demo-driven
API creep, and stdlib pollution.

Key principle:

Demos are pressure tests, not language authority.

## Core

Core may contain:

- parser/verifier/lowering/report/package-check logic;
- package-local module graph validation;
- capability/effect/host import validation;
- deterministic diagnostics;
- stable language semantics;
- release gates.

Core must not contain:

- demo-specific behavior;
- game-specific helpers;
- host rendering policy;
- asset artwork assumptions;
- platformer-specific shortcuts;
- feature additions driven only by demo breakage.

## Stdlib

Stdlib must be:

- pure;
- deterministic;
- domain-neutral;
- host-authority-free.

Stdlib must not contain:

- capabilities;
- extern host calls;
- UI wrappers;
- gfx3d wrappers;
- scene helpers;
- voxel helpers;
- demo-specific abstractions;
- game-specific helpers.

If a helper requires host authority or domain-specific rendering, it belongs in
a kit, demo, example, or RFC, not stdlib.

## Kits

Kits may contain reusable domain-specific helpers.

Kits:

- may wrap host-facing patterns only when declared through manifests, profiles,
  or RFCs;
- must not silently become stdlib;
- must not grant hidden authority;
- must be explicit about required capabilities;
- should be vendored or package-local when used by demos/packages.

## Demos

Demos may:

- pressure-test AIR;
- reveal missing diagnostics;
- reveal missing package/profile checks;
- provide evidence for future RFCs;
- validate real host behavior;
- demonstrate recommended patterns.

Demos may not:

- force Core release scope expansion;
- add public Host ABI without RFC/spec/profile/tests;
- move demo-specific helpers into stdlib;
- rely on hidden TypeScript gameplay authority;
- use `debug.metric` as gameplay/effect/audio event bus;
- make Core release gates depend on heavy demo assets unless explicitly
  declared.

Demo failures must be classified as:

- Core blocker: compiler/verifier/package-check/stdlib/Host ABI regression
  reproducible outside the demo.
- Demo blocker: demo asset/TypeScript/render/gameplay issue.
- Future request: valid need but outside current release.
- Rejected: request violates AIR boundaries.

Changes under `demo/**` are not Core changes by default. They are pressure
evidence and migration work unless the same failure is reproduced by a
Core-owned fixture, spec test, package-check test, or stdlib/Host ABI gate.

Demo-local Python, Node, Vite, `pngjs`, and other tooling is allowed when it is
isolated to the demo and is not required by AIR Core runtime or product
artifacts.

## Examples

Examples should be small, canonical, and stable.

Examples may be used as Core release gates only if:

- they are lightweight;
- deterministic;
- do not require heavy runtime assets;
- do not depend on unstable demo behavior.

## Generated Files

Generated files:

- are derived artifacts;
- must be deterministic;
- must not be manually edited;
- must not grant authority;
- must be checked for missing/stale state by package-check or demo-local gates.

Examples:

- `generated/assets.air`
- `generated/asset_handles.air`
- `generated/audio_handles.air`
- `generated/material_handles.air`
- `generated/sprite_handles.air`

Handwritten AIR should prefer generated symbolic handles over magic numeric IDs.

## Hosts

Hosts may:

- implement declared Host ABI/profile capabilities;
- render declared commands/events;
- load declared assets/manifests;
- handle platform policy such as browser audio autoplay.

Hosts must not:

- infer gameplay authority from debug metrics;
- invent hidden events from unrelated state;
- decide gameplay water/collision/deathplanes;
- silently support undeclared capabilities;
- make demo-specific behavior look like stable AIR semantics.

## Manifests And Assets

Runtime manifests should contain runtime-active assets only.

Candidate/quarantine/tmp assets should live outside active runtime manifests or
be explicitly marked non-runtime.

Forbidden as runtime references:

- `tmp_unused`
- `assets_candidate`
- `graphics_bundles`
- `quarantine` paths

Active runtime manifests should be boring and deterministic.

## Pressure Requests / RFCs

When a demo reveals a missing AIR feature, it must be recorded as a request/RFC,
not implemented ad hoc.

Examples of v0.14+ pressure requests:

- linked multi-module Wasm;
- kit vendoring;
- effect event ABI;
- sprite/rig manifest path;
- rich audio events;
- level recipe compiler;
- fixed entity buffers;
- stronger runtime asset validation.

Rejected as direct Core shortcuts:

- game-specific `draw_actor` API;
- returning `std.gfx3d`, `std.scene`, or `std.voxel` to stdlib;
- using `debug.metric` as event bus;
- hidden TypeScript gameplay authority;
- dynamic maps/GC/reflection/runtime imports;
- host object handles.

## Release Discipline

Core release branches must stay narrow.

For the current Core release:

- keep the release scope tied to the active release plan and feature status;
- do not add new public Host ABI;
- do not expand stdlib for demos;
- do not solve consumer/demo failures by changing Core semantics;
- keep consumer/demo migration separate from Core release gates.

A demo can influence the roadmap, but it cannot silently rewrite the release
scope.

Only clean Core branches with matching `REVIEW_RESULTS` and snapshot metadata
can close Core releases. Demo bundles are review/pressure artifacts, not Core RC
evidence.

## Bundle Classes

AIR review artifacts must declare one of these bundle classes:

- `core-rc`: release-candidate Core artifact. It must come from a clean Core
  branch, include matching `REVIEW_RESULTS`/snapshot metadata, and run Core
  gates without relying on heavy demo assets.
- `core-with-pressure`: Core artifact plus selected pressure evidence. Demo
  failures are advisory unless reproduced by Core-owned gates.
- `demo-review`: informational demo artifact. It can include demo-local tooling,
  generated outputs, placeholders, and omitted assets, but it cannot close a
  Core release.

Core release gates must not depend on heavy demo assets unless the gate
explicitly declares the asset fixture as Core-owned. Demo requests must be
generalized into RFCs before entering Core, stdlib, Host ABI, or release scope.
