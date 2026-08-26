# AIR v0.11 Release Checklist

This checklist turns the current v0.11 roadmap and gap report into release
review steps. It is a docs/checklist artifact only. It does not approve public
ABI growth, Core syntax changes, target packaging, package registry work, or
demo-specific stdlib additions.

Authorities:

- [ROADMAP_v0.11.md](archive/v0.11/ROADMAP_v0.11.md)
- [V0_11_GAP_REPORT.md](archive/v0.11/V0_11_GAP_REPORT.md)
- [VERSION_SEMANTICS_v0.11.md](VERSION_SEMANTICS_v0.11.md)
- [RC_REVIEW_BUNDLE_POLICY.md](RC_REVIEW_BUNDLE_POLICY.md)
- [CONFORMANCE_REPORT_v0.11.md](CONFORMANCE_REPORT_v0.11.md)
- [GFX_v0.11_PLAN.md](archive/v0.11/GFX_v0.11_PLAN.md)
- [GFX_v0.11_STATUS.md](archive/v0.11/GFX_v0.11_STATUS.md)
- [abi-requests.md](abi-requests.md)
- [ABI Request Pipeline](abi-requests/README.md)
- [AIR Layer Manifest](../spec/AIR_LAYER_MANIFEST.md)
- [AIR Platform Contract](../spec/AIR_PLATFORM_CONTRACT.md)
- [Public API Hygiene](PUBLIC_API_HYGIENE.md)
- [GFX ABI](../spec/GFX_ABI.md)
- [GFX High-Level ABI](../spec/GFX_HIGH_LEVEL_ABI.md)
- [GFX Buffer Layouts](../spec/GFX_BUFFER_LAYOUTS.md)

Status vocabulary:

- `done`: evidence and verification command exist.
- `partial`: evidence exists but release verification depends on optional local
  tooling, GPU/browser availability, or manual review.
- `missing`: release evidence is absent.

## Release Gate Model

v0.11 release gates are Core gates. A release candidate must run
`bash scripts/run_rc_checks.sh` from the real source checkout before the final
review bundle is generated. The resulting `REVIEW_RESULTS/` directory is part
of the RC evidence and must be included in the final Core review bundle.

The review bundle is a review artifact, not the primary execution environment.
It must carry check results, omitted-file reports, placeholder reports, snapshot
metadata, and bundle notes. It must not be treated as a standalone CI checkout.

Demo projects such as `demo/voxel-demo` and `demo/contra-platformer` are
developed and built in their own project checkouts. Their source, manifests, and
request files provide ABI pressure and evidence, but standalone demo builds are
not Core release blockers. Core `npm test` may inspect demo AIR/request/manifest
files for boundary enforcement, but it must not require installing every demo's
dependencies or producing every demo's standalone browser/native build.

Bundle roles:

- Core review bundle: release-relevant; must complete quickly; must include the
  docs, tools, tests, specs, kits, examples, host source, and small fixtures
  needed for Core validation; must include `REVIEW_RESULTS/` for RC review.
- Demo review bundle: orientation/evidence only; may replace or omit heavy media
  and build outputs; does not need to build standalone; demo requests remain
  evidence, not ABI authority.

## P0 Release Blockers

### P0.RC RC Check Results Included In Bundle

- Status: done
- Owner layer: docs
- Evidence files:
  - [RC_REVIEW_BUNDLE_POLICY.md](RC_REVIEW_BUNDLE_POLICY.md)
  - [scripts/run_rc_checks.sh](../scripts/run_rc_checks.sh)
  - [scripts/make_review_bundle.sh](../scripts/make_review_bundle.sh)
  - `REVIEW_RESULTS/SUMMARY.md`
  - `REVIEW_RESULTS/CHECKS.json`
  - `REVIEW_RESULTS/RED_FLAGS.md`
  - `REVIEW_RESULTS/COMMANDS.log`
- Command to verify:

```sh
bash scripts/run_rc_checks.sh
bash scripts/make_review_bundle.sh
```

- Acceptance criteria:
  - RC checks run in the source checkout before bundle creation.
  - `REVIEW_RESULTS/` includes summary, machine-readable check data, red flags,
    and command logs.
  - Final Core review bundle includes `REVIEW_RESULTS/`.
  - Bundle generation warns if `REVIEW_RESULTS/` is missing.
  - Browser/GPU-dependent smoke checks are recorded as skipped with a reason
    when unavailable, not as pass.

### P0.0 Version Semantics

- Status: done
- Owner layer: docs
- Evidence files:
  - [VERSION_SEMANTICS_v0.11.md](VERSION_SEMANTICS_v0.11.md)
  - [src/version.js](../src/version.js)
  - [package.json](../package.json)
  - [CONFORMANCE_REPORT_v0.11.md](CONFORMANCE_REPORT_v0.11.md)
- Command to verify:

```sh
node bin/airc.js version --json
node bin/airc.js report examples/gfx.air
```

- Acceptance criteria:
  - AIR ABI remains `0.10`.
  - Compiler/package version remains explicitly separate from roadmap
    milestone naming.
  - Conformance reports use `reportVersion: "0.11"`.
  - v0.11 is understood as a Product/Demo Loop milestone, not a public ABI bump.

### P0.1 Live/Browser Demo Path Release Recipe

- Status: done
- Owner layer: host
- Evidence files:
  - [BROWSER_DEMO_v0.11.md](archive/v0.11/BROWSER_DEMO_v0.11.md)
  - [hosts/webgpu/README.md](../hosts/webgpu/README.md)
  - [hosts/webgpu/src/main.ts](../hosts/webgpu/src/main.ts)
  - [hosts/webgpu/scripts/smoke.mjs](../hosts/webgpu/scripts/smoke.mjs)
  - [examples/gfx_showcase/README.md](../examples/gfx_showcase/README.md)
  - [README.md](../README.md)
- Command to verify:

```sh
cd hosts/webgpu
npm ci
npm run smoke
```

- Acceptance criteria:
  - Browser host loads the built AIR GFX package.
  - Visible output is rendered when WebGPU is available.
  - WebGPU unavailable state is reported as a clear diagnostic, not a blank
    screen.
  - Conformance panel/report includes package/module state, capabilities,
    loaded assets, unsupported features, warnings, and draw-call state.

### P0.2 Conformance Report Required Fields

- Status: done
- Owner layer: core
- Evidence files:
  - [CONFORMANCE_REPORT_v0.11.md](CONFORMANCE_REPORT_v0.11.md)
  - [src/conformance_report.js](../src/conformance_report.js)
  - [bin/airc.js](../bin/airc.js)
  - [test/run.js](../test/run.js)
  - [hosts/webgpu/README.md](../hosts/webgpu/README.md)
  - [hosts/native/README.md](../hosts/native/README.md)
- Command to verify:

```sh
node bin/airc.js report examples/gfx.air
node bin/airc.js report examples/gpu_arena.air --manifest examples/gpu_arena.airgfx.json
npm test
```

- Acceptance criteria:
  - Report includes module name, AIR ABI version, exports, capabilities, host
    imports, strict Host ABI verification status, pass/fail status,
    warnings/errors, and repair hint when practical.
  - Manifest-aware report includes manifest features and unsupported host
    features when a `.airgfx.json` manifest is supplied.
  - Manifest-aware report includes loaded asset/resource summaries and fallback
    behavior where applicable.
  - Unknown or unsupported host externs fail strict Host ABI verification.

### P0.3 Prompt-To-Module Scripted Loop Evidence

- Status: done
- Owner layer: docs
- Evidence files:
  - [PROMPT_TO_MODULE_v0.11.md](PROMPT_TO_MODULE_v0.11.md)
  - [scripts/prompt_to_module_demo.js](../scripts/prompt_to_module_demo.js)
  - [examples/ai_generated/network_health_prompt.md](../examples/ai_generated/network_health_prompt.md)
  - [examples/ai_generated/network_health_generated.air](../examples/ai_generated/network_health_generated.air)
  - [test/run.js](../test/run.js)
- Command to verify:

```sh
node scripts/prompt_to_module_demo.js
npm test
```

- Acceptance criteria:
  - Script runs offline with deterministic output.
  - Script runs formatter, verifier, explain or audit, JSON report, WASM build,
    package build, and one host-facing package check.
  - Failure messages remain human-readable and repairable.
  - No LLM API integration, external network dependency, target packaging, or
    new public ABI is introduced.

### P0.4 ABI Request Pipeline Validation

- Status: done
- Owner layer: docs
- Evidence files:
  - [abi-requests.md](abi-requests.md)
  - [abi-requests/README.md](abi-requests/README.md)
  - [scripts/check_abi_requests.js](../scripts/check_abi_requests.js)
  - [test/run.js](../test/run.js)
- Command to verify:

```sh
node scripts/check_abi_requests.js
npm test
```

- Acceptance criteria:
  - Top-level ABI request index exists.
  - ABI request README exists and defines lifecycle, target layers, template,
    and agent handling rules.
  - Canonical request files with concrete request blocks include required
    fields.
  - Demo request files remain evidence, not authority.

### P0.5 Core Review Bundle Sanity

- Status: done
- Owner layer: docs
- Evidence files:
  - [scripts/make_review_bundle.sh](../scripts/make_review_bundle.sh)
  - [scripts/check_review_bundle.js](../scripts/check_review_bundle.js)
  - [docs/MERGE_POLICY.md](MERGE_POLICY.md)
  - [test/run.js](../test/run.js)
- Command to verify:

```sh
bash scripts/run_rc_checks.sh
node scripts/check_review_bundle.js
npm test
```

- Acceptance criteria:
  - Core review bundle sanity check passes from a repository checkout.
  - Core review bundle supports `nogit` archive names when run from an unpacked
    bundle.
  - Required tests, scripts, docs, examples, shaders, fixture assets, native
    source, and lockfile are included.
  - Core bundle generation completes quickly and prunes dependency directories,
    build outputs, `tmp_unused`, old bundle archives, caches, and archived asset
    dumps during traversal.
  - Final RC bundle includes `REVIEW_RESULTS/SUMMARY.md`,
    `REVIEW_RESULTS/CHECKS.json`, `REVIEW_RESULTS/RED_FLAGS.md`, and
    `REVIEW_RESULTS/COMMANDS.log`.
  - Slim/review bundles preserve placeholder assets only when needed by
    Core-owned tests or public demo paths and document substitutions.
  - Contra/voxel standalone demo build success is not a Core review-bundle
    requirement.

### P0.6 No Public ABI Drift

- Status: done
- Owner layer: core
- Evidence files:
  - [src/host_abi.js](../src/host_abi.js)
  - [src/verifier.js](../src/verifier.js)
  - [spec/GFX_HIGH_LEVEL_ABI.md](../spec/GFX_HIGH_LEVEL_ABI.md)
  - [spec/GFX_ABI.md](../spec/GFX_ABI.md)
  - [test/run.js](../test/run.js)
- Command to verify:

```sh
npm test
```

- Acceptance criteria:
  - Strict public Host ABI remains the single registry-backed source of truth.
  - Verifier rejects unknown public host externs.
  - Existing public `gfx.*`, `gpu.*`, `input.*`, `ui.*`, utility, and debug
    signatures remain stable unless a spec-backed migration explicitly changes
    them.
  - No `gfx.draw_instanced`, public `gfx.draw_voxel_chunk`, or demo-driven
    public `gfx.*` expansion exists in v0.11.

### P0.7 No Demo Leakage Into Stdlib

- Status: done
- Owner layer: core
- Evidence files:
  - [test/layer_guard.test.js](../test/layer_guard.test.js)
  - [stdlib/grid.air](../stdlib/grid.air)
  - [spec/AIR_LAYER_MANIFEST.md](../spec/AIR_LAYER_MANIFEST.md)
  - [docs/PUBLIC_API_HYGIENE.md](PUBLIC_API_HYGIENE.md)
  - [test/run.js](../test/run.js)
- Command to verify:

```sh
node test/layer_guard.test.js
npm test
```

- Acceptance criteria:
  - Stdlib contains no resource packs, shaders, assets, backend directories, or
    project/demo vocabulary.
  - `stdlib/grid.air` remains deterministic, backend-neutral, resource-free,
    and generic.
  - Demo/project concepts remain in `demo/`, project kits, examples, reusable
    kits, manifests, or host implementation according to layer rules.

## P1 Release Polish

### P1.1 GFX Foundation Status

- Status: done
- Owner layer: host
- Evidence files:
  - [GFX_v0.11_PLAN.md](archive/v0.11/GFX_v0.11_PLAN.md)
  - [GFX_v0.11_STATUS.md](archive/v0.11/GFX_v0.11_STATUS.md)
  - [hosts/webgpu/src/assetLoader.ts](../hosts/webgpu/src/assetLoader.ts)
  - [tools/generate-gfx-fixtures.js](../tools/generate-gfx-fixtures.js)
  - [kits/gfx-basic/README.md](../kits/gfx-basic/README.md)
- Command to verify:

```sh
node tools/generate-gfx-fixtures.js --list
node bin/airc.js gfx-check examples/gpu_arena.air --manifest examples/gpu_arena.airgfx.json
npm test
```

- Acceptance criteria:
  - GLB/glTF loading is host-owned.
  - Missing assets, shaders, models, materials, and render graph resources
    produce diagnostics.
  - Existing GFX examples continue to pass.
  - No new public `gfx.*` functions are introduced.

### P1.2 Minimal GLB/glTF Fixture Path

- Status: done
- Owner layer: host
- Evidence files:
  - [examples/gfx_fixtures/assets/cube.glb](../examples/gfx_fixtures/assets/cube.glb)
  - [examples/gfx_showcase/assets/cube.glb](../examples/gfx_showcase/assets/cube.glb)
  - [tools/generate-gfx-fixtures.js](../tools/generate-gfx-fixtures.js)
  - [hosts/webgpu/scripts/smoke.mjs](../hosts/webgpu/scripts/smoke.mjs)
- Command to verify:

```sh
node tools/generate-gfx-fixtures.js --out build/gfx-fixture-check
npm --prefix hosts/webgpu test
```

- Acceptance criteria:
  - `cube.glb` is deterministic and small enough for checked-in fixture use.
  - Browser smoke reports loaded GLB evidence.
  - Unsupported advanced glTF features stay diagnostic-only.

### P1.3 Non-Game UI/Network Dashboard

- Status: done
- Owner layer: demo
- Evidence files:
  - [examples/network_dashboard/network_dashboard.air](../examples/network_dashboard/network_dashboard.air)
  - [examples/network_dashboard/run.mjs](../examples/network_dashboard/run.mjs)
  - [examples/network_dashboard/README.md](../examples/network_dashboard/README.md)
  - [abi-requests/network-scanner.md](abi-requests/network-scanner.md)
- Command to verify:

```sh
node examples/network_dashboard/run.mjs
npm test
```

- Acceptance criteria:
  - Dashboard verifies with existing `ui.*` and `debug.metric`.
  - Report includes capabilities, imports, mock input facts, computed status,
    and unsupported host features.
  - No real network scanning, raw sockets, filesystem access, or `net.*` public
    ABI is added for the v0.11 demo.

### P1.4 Native Host Reviewability

- Status: done
- Owner layer: host
- Evidence files:
  - [hosts/native/README.md](../hosts/native/README.md)
  - [hosts/native/src/main.rs](../hosts/native/src/main.rs)
  - [hosts/native/Cargo.lock](../hosts/native/Cargo.lock)
  - [docs/MERGE_POLICY.md](MERGE_POLICY.md)
- Command to verify:

```sh
cargo check --manifest-path hosts/native/Cargo.toml
cargo run --manifest-path hosts/native/Cargo.toml -- gfx-stream demo/voxel-demo/public/game-metal.wasm --frames 1000,34000,38000
```

- Acceptance criteria:
  - Native source and lockfile are review-bundle visible.
  - `gfx-stream` is headless and prints JSON metrics.
  - `gfx-window` remains manual/diagnostic and reports unsupported platforms
    clearly.

### P1.5 Demo Extraction Triage Coverage

- Status: done
- Owner layer: docs
- Evidence files:
  - [abi-requests/voxel-demo.md](abi-requests/voxel-demo.md)
  - [abi-requests/airdoom.md](abi-requests/airdoom.md)
  - [abi-requests/contra-platformer.md](abi-requests/contra-platformer.md)
  - [abi-requests.md](abi-requests.md)
- Command to verify:

```sh
node scripts/check_abi_requests.js
```

- Acceptance criteria:
  - Demo-derived requests are canonicalized before implementation.
  - Universal candidates are routed to examples, reusable kits, stdlib,
    manifest schema, host implementation, or RFCs.
  - Project-specific material IDs, routes, palettes, assets, music, gameplay,
    and named objects stay project-local.

### P1.6 Demo Review Bundle Evidence

- Status: done
- Owner layer: docs
- Evidence files:
  - [scripts/make_demo_review_bundle.sh](../scripts/make_demo_review_bundle.sh)
  - Demo source remains outside the public Core export.
  - [abi-requests.md](abi-requests.md)
  - [abi-requests/voxel-demo.md](abi-requests/voxel-demo.md)
  - [abi-requests/contra-platformer.md](abi-requests/contra-platformer.md)
- Command to verify:

```sh
bash scripts/make_demo_review_bundle.sh
node scripts/check_abi_requests.js
```

- Acceptance criteria:
  - Demo bundle is documented as orientation/evidence only.
  - Demo bundle notes state that it is not standalone and full demo builds happen
    in full demo project checkouts or adjacent AIR Core checkouts.
  - Demo bundle may replace or omit media, dependency directories, build outputs,
    `tmp_unused`, old bundle archives, and archived asset dumps.
  - Requests from demos remain structured evidence for Core triage, not
    automatic public ABI changes.

## P2 Deferred / Backlog

### P2.1 Broader Generated GFX Fixtures

- Status: partial
- Owner layer: kit
- Evidence files:
  - [GFX_v0.11_STATUS.md](archive/v0.11/GFX_v0.11_STATUS.md)
  - [tools/generate-gfx-fixtures.js](../tools/generate-gfx-fixtures.js)
- Command to verify:

```sh
node tools/generate-gfx-fixtures.js --list
```

- Acceptance criteria:
  - `uv_test`, `primitive_set`, and `material_test` remain optional until a
    release task explicitly promotes them.
  - Any new fixture stays deterministic and tooling-owned.

### P2.2 Target Packaging Roadmap

- Status: deferred
- Owner layer: docs
- Evidence files:
  - [ROADMAP_v0.11.md](archive/v0.11/ROADMAP_v0.11.md)
  - v0.12 target packaging roadmap is deferred planning and must remain outside
    v0.11 implementation scope.
- Command to verify:

```sh
node scripts/check_markdown_links.js
```

- Acceptance criteria:
  - v0.11 does not implement target packaging, `airc bundle`, package registry,
    or deployable artifact commands.
  - Target packaging remains v0.12 planning.

### P2.3 Core Data Ergonomics

- Status: deferred
- Owner layer: core
- Evidence files:
  - [abi-requests/core-data-ergonomics.md](abi-requests/core-data-ergonomics.md)
  - [abi-requests/voxel-demo.md](abi-requests/voxel-demo.md)
- Command to verify:

```sh
node scripts/check_abi_requests.js
```

- Acceptance criteria:
  - Core data ergonomics remain RFC-only in v0.11.
  - No parser, formatter, verifier, lowering, or audit changes land without an
    accepted Core RFC.

### P2.4 Real Network Scanner

- Status: deferred
- Owner layer: host
- Evidence files:
  - [abi-requests/network-scanner.md](abi-requests/network-scanner.md)
  - [examples/network_dashboard/README.md](../examples/network_dashboard/README.md)
- Command to verify:

```sh
node examples/network_dashboard/run.mjs
```

- Acceptance criteria:
  - v0.11 keeps network dashboard data mock/static.
  - Real probing remains future policy-gated host work.

## Explicit Non-Goals

These items must remain out of v0.11:

- Rename/rebrand work.
- File extension, CLI name, package name, or branding changes.
- New public `gfx.*` functions.
- `gfx.draw_instanced` implementation.
- Public `gfx.draw_voxel_chunk`.
- Raw network scanning.
- Target packaging implementation.
- Package registry.
- Core syntax patch without RFC.
- Demo-specific helpers in `stdlib/`.
- Backend objects exposed to AIR.
- Production renderer or production game engine layer.
- AI Studio/no-code builder behavior.

## Baseline Release Commands

Run these before marking v0.11 complete:

```sh
bash scripts/run_rc_checks.sh
node scripts/check_review_bundle.js
git diff --check
```

The RC script records the source-checkout checks in `REVIEW_RESULTS/`:

- `npm ci`
- `npm test`
- `node scripts/check_markdown_links.js`
- `node scripts/check_abi_requests.js`
- `node test/layer_guard.test.js`
- `node scripts/prompt_to_module_demo.js`
- `node scripts/check_review_bundle.js`
- `node bin/airc.js report examples/gfx.air`
- `node bin/airc.js report examples/gpu_arena.air --manifest examples/gpu_arena.airgfx.json`
- WebGPU host `npm ci`, `typecheck`, and `build` when available

Optional manual/environment-dependent checks:

```sh
npm --prefix hosts/webgpu run typecheck
npm --prefix hosts/webgpu run build
npm --prefix hosts/webgpu test
cargo check --manifest-path hosts/native/Cargo.toml
cargo run --manifest-path hosts/native/Cargo.toml -- gfx-stream demo/voxel-demo/public/game-metal.wasm --frames 1000,34000,38000
```
