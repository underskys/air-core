# AIRLang v0.11 Gap Report

This report audits the current v0.11 baseline against
[ROADMAP_v0.11.md](ROADMAP_v0.11.md), [GFX_v0.11_PLAN.md](GFX_v0.11_PLAN.md),
[abi-requests.md](../../abi-requests.md), [ABI Request Pipeline](../../abi-requests/README.md),
[AIR Layer Manifest](../../../spec/AIR_LAYER_MANIFEST.md), and
[Public API Hygiene](../../PUBLIC_API_HYGIENE.md).

Status vocabulary:

- `done`: implementation, docs, and test or smoke coverage exist.
- `partial`: direction and some evidence exist, but release evidence is not
  complete.
- `missing`: no concrete runnable or documented path exists yet.

Active demo request files remain evidence, not authority. Promotion into Core,
stdlib, Host ABI, manifest schema, kits, examples, or host implementation must
go through the request/spec/test path.

## Summary

| Theme | Status | Priority | Required next action |
|---|---|---:|---|
| ABI Request Pipeline | done | P1 | Keep every new request classified before implementation. |
| Live/browser demo path | done | P0 | Run the WebGPU smoke command in release verification. |
| GFX foundation compliance | done | P1 | Keep cube-only as the v0.11 minimum generated fixture set. |
| Minimal GLB/glTF fixture path | done | P1 | Keep GLB/glTF host-owned and unsupported features diagnostic. |
| Non-game UI/network dashboard | done | P1 | Keep mock data; route real probing through the RFC. |
| Prompt-to-module scripted loop | done | P1 | Keep the script offline and deterministic. |
| Conformance/report polish | done | P0 | Preserve deterministic JSON shape and browser/native diagnostics. |
| Native host reviewability | done | P1 | Keep CI-safe commands separate from manual GPU/window commands. |
| Layer guard / stdlib hygiene | done | P1 | Extend guards only for concrete leakage risks. |

## 1. ABI Request Pipeline

Status: done

Evidence:

- [abi-requests.md](../../abi-requests.md) defines universal fit rules and indexes
  canonical request documents.
- [abi-requests/README.md](../../abi-requests/README.md) defines lifecycle, target
  layers, required request fields, and agent handling rules.
- [scripts/check_abi_requests.js](../../../scripts/check_abi_requests.js) validates
  canonical request structure.
- [test/run.js](../../../test/run.js) runs the ABI request checker.
- Canonical triage now covers voxel demo, AirDoom, GFX showcase, UI dashboard,
  network scanner, Core data ergonomics, and Contra Platformer extraction:
  [abi-requests/voxel-demo.md](../../abi-requests/voxel-demo.md),
  [abi-requests/airdoom.md](../../abi-requests/airdoom.md),
  [abi-requests/gfx-showcase.md](../../abi-requests/gfx-showcase.md),
  [abi-requests/ui-dashboard.md](../../abi-requests/ui-dashboard.md),
  [abi-requests/network-scanner.md](../../abi-requests/network-scanner.md),
  [abi-requests/core-data-ergonomics.md](../../abi-requests/core-data-ergonomics.md),
  and [abi-requests/contra-platformer.md](../../abi-requests/contra-platformer.md).

Required next action:

- Keep using request docs as evidence, not authority.
- New demo pressure must name a target layer before touching Core, stdlib, Host
  ABI, manifest schema, host implementation, examples, or kits.

## 2. Live/Browser Demo Path

Status: done

Evidence:

- [BROWSER_DEMO_v0.11.md](BROWSER_DEMO_v0.11.md) documents the clean checkout
  path, manual browser run, CI-safe smoke, diagnostics panel expectations, and
  static hosting artifact path.
- [hosts/webgpu/README.md](../../../hosts/webgpu/README.md) documents the browser
  WebGPU proof, diagnostics panel, smoke command, and static deployment path.
- [hosts/webgpu/src/main.ts](../../../hosts/webgpu/src/main.ts) reports package/module
  state, capabilities, loaded assets, unsupported features, warnings, draw-call
  state, material fallback, and WebGPU unavailable states.
- [hosts/webgpu/scripts/smoke.mjs](../../../hosts/webgpu/scripts/smoke.mjs) validates
  visible/nonblank output when WebGPU is available and diagnostic unsupported
  output when it is not.
- [README.md](../README.md) links the browser proof and documents browser demo
  commands.

Required next action:

- During release verification, run the host smoke command from
  `hosts/webgpu/README.md`.
- If a public static URL is published later, record it as release metadata; do
  not turn that into target packaging work for v0.11.

## 3. GFX Foundation Compliance

Status: done

Evidence:

- [GFX_v0.11_PLAN.md](GFX_v0.11_PLAN.md) defines the boundary: no GLB parsing
  in AIR Core, no new public `gfx.*`, host-owned assets/shaders/materials.
- [GFX_v0.11_STATUS.md](GFX_v0.11_STATUS.md) audits the current implementation
  against the GFX plan.
- [kits/gfx-basic/README.md](../../../kits/gfx-basic/README.md) documents reusable
  starter shaders, material fragments, and fixture conventions.
- [examples/gfx_showcase/README.md](../../../examples/gfx_showcase/README.md)
  documents manifest-driven GFX, shader/material examples, assets, generated
  manifests, and WebGPU host behavior.
- [test/run.js](../../../test/run.js) covers GFX manifest validation, render graph
  diagnostics, scene compiler diagnostics, GFX showcase build, WebGPU host
  diagnostics, skybox contract, and no random high-level `gfx.*` growth.

Required next action:

- Keep advanced graphics routed through `.airgfx.json`, render graphs, `gpu.*`,
  host implementation, examples, and reusable kits.
- Keep `cube.glb` as the v0.11 minimum generated fixture set.
- Defer `uv_test`, `primitive_set`, and `material_test` fixture expansion to
  v0.12/post-v0.11 loader coverage.

## 4. Minimal GLB/glTF Fixture Path

Status: done

Evidence:

- [hosts/webgpu/src/assetLoader.ts](../../../hosts/webgpu/src/assetLoader.ts) owns
  GLB/glTF loading and reports unsupported glTF features.
- [tools/generate-gfx-fixtures.js](../../../tools/generate-gfx-fixtures.js) generates
  deterministic `cube.glb` fixture output.
- [examples/gfx_fixtures/assets/cube.glb](../../../examples/gfx_fixtures/assets/cube.glb)
  and [examples/gfx_showcase/assets/cube.glb](../../../examples/gfx_showcase/assets/cube.glb)
  provide committed generated fixture assets.
- [hosts/webgpu/scripts/smoke.mjs](../../../hosts/webgpu/scripts/smoke.mjs) checks
  loaded GLB fixture reporting.
- [test/run.js](../../../test/run.js) asserts WebGPU diagnostics include GLB/glTF
  model loading and GPU buffer upload.

Required next action:

- Keep animations, skinning, morph targets, compressed textures, complex PBR
  extensions, and unsupported primitive modes diagnostic-only unless separate
  host/package work accepts them.

## 5. Non-Game UI/Network Dashboard

Status: done

Evidence:

- [examples/network_dashboard/network_dashboard.air](../../../examples/network_dashboard/network_dashboard.air)
  uses `capabilities { debug, ui }` with mock/static network facts.
- [examples/network_dashboard/run.mjs](../../../examples/network_dashboard/run.mjs)
  runs a deterministic UI/debug host harness and prints a JSON report with
  capabilities, imports, mock facts, computed status, and unsupported features.
- [examples/network_dashboard/README.md](../../../examples/network_dashboard/README.md)
  states that real scanning is not part of the v0.11 initial demo.
- [abi-requests/network-scanner.md](../../abi-requests/network-scanner.md) keeps real
  network probing policy-gated and future-facing.
- [test/run.js](../../../test/run.js) verifies the dashboard module and smoke report.

Required next action:

- Keep dashboard data mock/static in v0.11.
- Route real network probing through the network scanner RFC and explicit host
  policy work.

## 6. Prompt-To-Module Scripted Loop

Status: done

Evidence:

- [PROMPT_TO_MODULE_v0.11.md](../../PROMPT_TO_MODULE_v0.11.md) documents the
  deterministic offline release loop, expected output, repairable failures, and
  non-goals.
- [examples/ai_generated/network_health_prompt.md](../../../examples/ai_generated/network_health_prompt.md)
  is the checked-in prompt-like input fixture.
- [examples/ai_generated/network_health_generated.air](../../../examples/ai_generated/network_health_generated.air)
  is the generated AIR module fixture.
- [scripts/prompt_to_module_demo.js](../../../scripts/prompt_to_module_demo.js)
  copies the fixture, runs formatter, verifier, explain, audit, JSON report,
  WASM build, package build, and `package-check`.
- [test/run.js](../../../test/run.js) includes `v0.11 prompt-to-module scripted demo
  runs offline`.

Required next action:

- Keep the script offline and deterministic.
- Do not add LLM API integration, target packaging, registry behavior, or new
  public ABI in v0.11.

## 7. Conformance/Report Polish

Status: done

Evidence:

- [src/conformance_report.js](../../../src/conformance_report.js) produces a
  deterministic v0.11 JSON report with module name, AIR ABI version, exports,
  capabilities, host imports, strict Host ABI status, manifest features,
  unsupported host features, warnings/errors, pass/fail status, and repair hint.
- [bin/airc.js](../../../bin/airc.js) exposes `airc report`.
- [test/run.js](../../../test/run.js) covers utility modules, high-level GFX stream
  modules, GPU manifest reports, and unsupported host feature diagnostics.
- [hosts/webgpu/README.md](../../../hosts/webgpu/README.md) documents browser
  conformance JSON fields.
- [hosts/native/README.md](../../../hosts/native/README.md) documents native
  conformance JSON behavior.

Required next action:

- Preserve the report shape for v0.11 review tooling.
- If fields change, update tests and migration notes in the same change.

## 8. Native Host Reviewability

Status: done

Evidence:

- [hosts/native/README.md](../../../hosts/native/README.md) separates CI-safe commands
  from manual GPU/window commands.
- [hosts/native/Cargo.lock](../../../hosts/native/Cargo.lock) is intentionally
  checked in for the application-style native host.
- [scripts/make_review_bundle.sh](../../../scripts/make_review_bundle.sh) includes
  native Rust source and `Cargo.lock` in the review bundle allowlist.
- [hosts/native/src/main.rs](../../../hosts/native/src/main.rs) reports diagnostic JSON
  for unsupported `gfx-window` paths and headless `gfx-stream` metrics with
  command counts, visible instances, camera, skybox, debug metrics, frame times,
  checksum, and pass/fail state.
- [test/run.js](../../../test/run.js) checks native metadata, docs, lockfile, and
  review bundle allowlist.

Required next action:

- Keep `gfx-stream` as the headless review command.
- Keep `gfx-window` manual/diagnostic and opt-in.

## 9. Layer Guard / Stdlib Hygiene

Status: done

Evidence:

- [test/layer_guard.test.js](../../../test/layer_guard.test.js) blocks resource files,
  backend-specific directories, and demo/project terms in `stdlib/`.
- The grid stdlib path has extra checks for demo vocabulary, public helper
  names, empty capabilities, no externs, no host calls, and no resource/memory
  operations.
- [spec/AIR_LAYER_MANIFEST.md](../../../spec/AIR_LAYER_MANIFEST.md) defines rules for
  Core, stdlib, host ABIs, manifests, hosts, reusable kits, examples, project
  kits, and promotion.
- [docs/PUBLIC_API_HYGIENE.md](../../PUBLIC_API_HYGIENE.md) documents examples/kits
  rules and promotion hygiene.
- [test/run.js](../../../test/run.js) verifies stdlib modules, stdlib catalog, layer
  manifest sections, and layer guard negative cases.

Required next action:

- Keep guards active in release checks.
- Add new forbidden terms only when a concrete leakage risk appears.

## Explicit Non-Goals For v0.11 Completion

- Do not rename the project.
- Do not change file extensions, CLI names, package names, or branding.
- Do not implement target packaging or `airc bundle`.
- Do not add a package registry.
- Do not add new public Host ABI functions as a side effect of demo pressure.
- Do not add `gfx.draw_instanced`, `gfx.draw_voxel_chunk`, or random new public
  `gfx.*` functions.
- Do not add new AIR Core syntax or semantics without an accepted Core RFC.
- Do not implement real network scanning without explicit host policy and RFC
  acceptance.
- Do not move GLB/glTF parsing, shader compilation, material binding, renderer
  ownership, filesystem access, network access, or OS/device ownership into AIR
  Core.
- Do not leak project-local art direction, material IDs, routes, palettes,
  named objects, gameplay terms, or demo semantics into `stdlib/`.

## Release Verification Commands

Baseline:

```sh
npm test
node scripts/check_markdown_links.js
node test/layer_guard.test.js
node scripts/check_abi_requests.js
git diff --check
```

Browser host, when WebGPU/browser dependencies are available:

```sh
cd hosts/webgpu
npm ci
npm run smoke
```

Native host, when Rust tooling is available:

```sh
cargo check --manifest-path hosts/native/Cargo.toml
cargo run --manifest-path hosts/native/Cargo.toml -- gfx-stream demo/voxel-demo/public/game-metal.wasm --frames 1000,34000,38000
```

## Remaining Risk

The main v0.11 risk is not missing broad functionality. It is accidental scope
creep: public ABI growth, target packaging, real network scanning, Core syntax
patches, or demo leakage into stdlib. Current docs and tests route that pressure
through the ABI request pipeline and layer rules.
