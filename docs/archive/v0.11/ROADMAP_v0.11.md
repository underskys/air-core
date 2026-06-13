# AIRLang v0.11 Roadmap

AIRLang v0.11 is the Product/Demo Loop + ABI Request Pipeline + GFX/Utility
Foundation release.

The v0.10 public API and WebGPU proof baseline should remain stable. v0.11 is
not a broad language expansion release and not a target-packaging release. It
is the release that makes AIRLang understandable and usable as a small product
loop while letting parallel demos and utilities submit evidence without leaking
project-specific needs into public ABI.

Version semantics are explicit: AIR ABI remains `0.10`, the current
compiler/package version remains `0.10.0`, the v0.11 conformance report schema
uses `reportVersion: "0.11"`, and `v0.11` names this roadmap milestone. See
[VERSION_SEMANTICS_v0.11.md](../../VERSION_SEMANTICS_v0.11.md).

```text
Prompt or example
-> AIR module
-> verifier
-> WASM/package
-> WebGPU/UI host
-> visible result
-> conformance/capability report
```

## Product Positioning

AIRLang is a verified runtime layer for AI-generated interactive modules.

It gives AI a small, strict target for portable behavior: generate an AIR
module, verify its capabilities and effects, package it as WASM plus manifest
metadata, run it in a host, and show a reviewable result with diagnostics.

## Execution Scope

v0.11 work should stay inside these themes:

- Live/browser demo path: a visible public browser loop with diagnostics,
  loaded resources, package metadata, and conformance/capability reporting.
- Prompt-to-module scripted loop: a reproducible path from prompt-like input or
  example to formatted, verified, explained, packaged AIR output.
- Non-game UI/network dashboard demo: practical utility-style AIR behavior
  outside game or renderer semantics.
- GFX foundation: `kits/gfx-basic` polish, WebGPU host asset/model/shader path,
  GLB/glTF loading path, generated GFX fixtures, and conformance diagnostics.
- ABI request pipeline: structured intake for parallel demos and external
  projects before anything is promoted into public surfaces.
- Core/package/conformance polish: verifier diagnostics, package/conformance
  reports, layer guard checks, and documentation consistency.

The scope must preserve layer boundaries:

- Core owns portable AIR IR semantics, verification, lowering, effects,
  contracts, and diagnostics.
- `stdlib/` owns deterministic, backend-neutral, resource-free helpers only.
- `kits/` owns reusable optional starter resources and examples.
- `hosts/` owns real platform objects, devices, renderers, assets, shaders,
  input, network, audio, filesystem access, and runtime policy.
- `examples/` demonstrate public generic paths.
- `demo/` contains project-specific kits, art direction, assets, names,
  gameplay, and external experiment pressure.

## Priority State

v0.11 is ready to execute when the `MUST` set is covered. `SHOULD` and `COULD`
items are useful only if they do not destabilize the v0.10 baseline or expand
public ABI without the required specs and tests.

### MUST

- ABI request pipeline.
- Live/browser demo path.
- GFX foundation plan.
- Minimal GLB/glTF fixture path, or at least a clear host-owned loading plan.
- Non-game UI dashboard with mock network data.
- Prompt-to-module scripted demo.
- Conformance report polish.

### SHOULD

- Generated GFX fixtures.
- Better shader/material examples.
- Voxel-demo host/package polish.
- AirDoom request triage.

### COULD

- Minimal GLB renderer.
- Visual model generator.
- Network scanner RFC.
- Screenshot tests.

### MUST NOT

- Real network scanning without explicit host policy.
- Target Packaging implementation.
- New public `gfx.*` functions for every demo request.
- Demo leakage into `stdlib/`.

## Milestones

### M1: ABI Request Pipeline Hardening

- Keep [ABI requests](../../abi-requests/README.md) as the intake path for missing
  higher-level ABI, manifest, kit, host, and policy needs from parallel demos.
- Normalize active demo `request.md` / `requests.md` files into canonical
  triage docs before implementation.
- Require every request to name a target layer and explain why the need is
  generic before it can affect Core, stdlib, host ABI, or manifest schema.
- Treat [AIRLang Agent Contract](../../../AGENTS.md), [AIR Layer Manifest](../../../spec/AIR_LAYER_MANIFEST.md),
  and the relevant spec files as the authority for whether a change is allowed.
- Record rejected, kit-only, project-only, and accepted decisions explicitly so
  future agents cannot treat proposal snippets as approved public ABI.
- Use request outcomes to drive docs, examples, kits, host implementation, or
  RFCs without random public API growth.

### M2: Live Browser Demo

- Publish the existing WebGPU proof host as a stable public demo target.
- Keep the demo runnable from the repository with documented commands.
- Show visible output, package metadata, loaded resources, unsupported feature
  diagnostics, and a conformance/capability report on the page.
- Treat WebGPU unavailable states as valid diagnostics, not blank screens.

### M3: GFX Foundation And GLB/glTF Fixture Path

- Use [GFX v0.11 plan](GFX_v0.11_PLAN.md) as the planning contract for this
  milestone.
- Polish `kits/gfx-basic` as a reusable starter kit, not Core or stdlib.
- Improve the WebGPU host path for assets, models, shaders, manifests, and
  package diagnostics behind existing contracts.
- Document and validate the GLB/glTF loading path used by public examples and
  reusable kits.
- Add or refresh generated GFX fixtures where they help verify package,
  manifest, shader, model, and conformance behavior.
- Keep renderer, model, shader, material, texture, and asset ownership in kits,
  examples, demos, manifests, and hosts rather than AIR Core.
- Do not use GFX foundation work as a reason to add random high-level `gfx.*`
  functions.

### M4: Non-Game UI/Network Dashboard Demo

- Add or promote a small dashboard-style example that uses AIR UI, utility, or
  network reasoning concepts without game or renderer semantics.
- Demonstrate a practical non-game loop such as metrics, validation, status
  panels, simple calculations, network reasoning facts, or policy diagnostics.
- Keep UI resources, network access, filesystem access, and host policy outside
  AIR Core.
- Treat network scanner pressure as host/policy/request-pipeline work unless a
  separate RFC accepts a generic public ABI surface.

### M5: Prompt-To-Module Scripted Loop

- Provide a scripted demo path that starts from a prompt-like example and ends
  at a verified AIR module.
- The script should run formatter, verifier, explain/audit, WIT/package output,
  and one host-facing check.
- Make failure output repairable and human-readable so the demo teaches the
  AIR review loop instead of hiding errors.
- Keep generated examples compatible with v0.10 public baseline behavior where
  practical.

### M6: Core/Package/Conformance Polish

- Improve verifier diagnostics for common authoring and generated-code errors.
- Make package validation and conformance reports easier to inspect in browser
  and CLI workflows.
- Surface module name, AIR ABI version, capabilities, imports, exports,
  manifest features, unsupported host features, and pass/fail status.
- Keep layer guard checks active so demo terms, material IDs, palettes, routes,
  named objects, and project semantics do not enter Core or stdlib.
- Document any unavoidable report field changes with migration notes.

## Parallel Demo Intake

v0.11 supports parallel demos and utilities by treating demo-generated
`request.md` / `requests.md` files as evidence for triage, not authority to
change AIRLang public surfaces.

Core-side agents should read demo request files, README files, implementation
notes, audits, and relevant architecture docs, then classify each request by
target layer before proposing implementation. Active demo source should remain
read-only during Core triage unless demo implementation work is explicitly
requested.

Request text does not decide whether ABI commands or functions are added. Public
surface decisions must follow [AIRLang Agent Contract](../../../AGENTS.md),
[AIR Layer Manifest](../../../spec/AIR_LAYER_MANIFEST.md), Public API Hygiene, and
the relevant ABI/spec documents. If a request conflicts with those contracts,
record the conflict and keep the implementation out of public ABI.

Accepted work must land in the correct layer:

- `core`: portable AIR syntax, verifier, lowering, effects, contracts, memory,
  and diagnostics.
- `stdlib`: deterministic, backend-neutral, resource-free helpers.
- `host ABI`: capability-qualified imports with specs, checks, tests, and
  migration notes.
- `manifest schema`: package data for assets, render graphs, UI resources,
  input, conformance, or host-visible metadata.
- `reusable kit`: optional generic resources, shaders, examples, fragments, or
  starter layouts.
- `project kit`: demo/product-local assets, material IDs, routes, palettes,
  named objects, gameplay, and art direction.
- `host implementation`: browser/native/tool behavior behind existing ABI,
  manifest, and policy contracts.
- `examples` or `docs`: public teaching material that does not require ABI
  changes.

This keeps AirDoom, GFX showcase, UI dashboard, voxel demo, network utilities,
and external project concepts useful as pressure tests without letting them
pollute Core, stdlib, or public ABI.

## Deferred Target Packaging Work

Target Packaging is intentionally deferred to v0.12. v0.11 may improve package
reports, conformance diagnostics, browser demo deployment, and host-facing
checks, but it must not implement a new target packaging system, `airc bundle`
workflow, package registry, or promise that one AIR binary runs everywhere.

AIR should continue to produce verified portable modules and packages. Target
specific deployable artifacts belong to a later roadmap that combines AIR
packages with host runtimes, bundlers, platform adapters, and capability
compatibility checks.

The draft v0.12 package metadata and compatibility model is tracked in
[RFC_PACKAGE_MANIFEST_v0.12.md](../../RFC_PACKAGE_MANIFEST_v0.12.md). It defines
package identity, artifact layout, target profiles, compatibility checks, and
security boundaries without implementing target packaging in v0.11.
Host support metadata is drafted in
[RFC_HOST_PROFILES_v0.12.md](../../RFC_HOST_PROFILES_v0.12.md), which defines how
future package checks compare requirements against browser, native, CLI, and
verifier-only host profiles.

## Non-Goals

v0.11 must not:

- add random public `gfx.*` ABI functions;
- implement Target Packaging; it is deferred to v0.12;
- implement a Unity adapter;
- build a production renderer or production game engine layer;
- add a package registry;
- implement a full network scanner ABI without a policy RFC;
- implement Core data ergonomics without a Core RFC;
- introduce major ABI drift without migration notes;
- leak demo or Project Kit concepts into stdlib;
- add random language features that are not required by the product/demo loop;
- destabilize the v0.10 public API, examples, or WebGPU proof baseline.

## Compatibility

- Keep v0.10 examples working where practical.
- Prefer additive docs, demos, packaging polish, GFX fixture polish, host
  diagnostics, and report clarity over Core syntax changes.
- If an ABI or report shape must change, document the old behavior, new
  behavior, and migration path in the same change.
- Existing layer rules remain active: Core stays small, stdlib stays generic,
  manifests carry resources, kits carry reusable starter assets, demos carry
  project semantics, and hosts own real platform objects.

## Release Exit Criteria

- A user can run or visit a browser demo and see the full AIR product loop.
- A non-game UI/network dashboard example demonstrates AIR outside graphics and
  gameplay.
- A scripted prompt-to-module path shows generation, verification, packaging,
  and host-facing diagnostics.
- GFX foundation work proves reusable kit resources, GLB/glTF fixture handling,
  WebGPU host asset/model/shader behavior, and conformance diagnostics without
  new random public ABI.
- ABI requests from parallel demos are classified before implementation and do
  not become automatic public ABI changes.
- Package and conformance reports are clear enough for a human reviewer to
  understand capabilities, missing host support, and pass/fail status.
