# AIR v0.16 Release Plan

Status: active first-slice release

Theme: Package Artifacts & Host Conformance

v0.16 moves AIR from diagnostic/report readiness toward explicit package
artifacts and host conformance discipline. It does not implement product
bundling by default, does not change AIR ABI or Host ABI automatically, and does
not reintroduce active demos into Core.

## P0 Scope

| Area | Gate | Acceptance |
| --- | --- | --- |
| `airpkg` artifact RFC / first slice | Define and implement deterministic metadata-only package artifacts before product bundling. | `airc package <package-dir> -o <output.airpkg.json>` emits first-slice JSON metadata, link-plan hash, linked output status, and optional linked Wasm hash without compressed archive semantics. |
| `airpkg` inspect/check path | Define and expose artifact inspection before product bundling. | `airc inspect-airpkg <file-or-dir>` emits deterministic JSON metadata from an artifact, including linked output status, without requiring package source. |
| Link plan first slice | Define linked executable package build inputs before richer product bundling. | `airc link-plan <package-dir> --profile <id> --json` emits deterministic module order, symbols, package exports, generated artifact status, and ABI impact prediction with `linkedWasm: false`. |
| Linked WAT/Wasm first slice | Emit linked output for simple package-local scalar module graphs without changing runtime ABI. | `airc build package <package-dir> --linked-wasm -o <output.wasm>` emits deterministic linked Wasm plus sidecar report with `linkedWasm: true`. |
| Build-time vs runtime boundary | Keep build tools out of shipped runtime assumptions. | [Build-Time vs Runtime Boundary](BUILD_RUNTIME_BOUNDARY.md) and `airpkg` metadata identify build-time-only tools and runtime-required artifacts without changing runtime ABI. |
| Host conformance / replay RFC + first slice | Define and expose host behavior evidence for supported profiles. | `airc conformance <package-dir> --profile <id> --trace <trace.json> --json` replays deterministic exported scalar function expectations without browser/GPU automation. |
| Event/output RFC continuation | Continue generic event/output contract design. | RFC remains spec/planning only; no event/output Host ABI implementation in v0.16 P0. |
| ABI decision gates | Make ABI changes explicit and reviewable. | Release gates state AIR ABI/Host ABI remain `0.10` unless runtime or Host ABI contracts actually change. |

## P1 / If Scope Allows

- web/native-dev target bundle skeleton;
- richer host conformance fixtures;
- richer linked package contracts beyond the simple scalar first slice;
- `airpkg` package-check integration;
- event/output Host ABI candidate design;
- public demo/adoption bundle that consumes Core without defining it.

## Deferred

- full native installers;
- Steam packaging;
- package registry;
- Unity/Godot adapter implementation;
- full JSON-RPC LSP server;
- dynamic maps, GC, reflection, runtime imports, and host object handles;
- game-specific APIs.

## Non-goals

v0.16 must not add:

- compressed `airpkg` archive semantics, embedded resource payloads, native app
  packaging, web deploys, or Steam-ready packages in the first slice;
- linked executable output beyond simple package-local scalar modules;
- game-specific Core APIs;
- demo-driven stdlib expansion;
- active demo implementations in Core;
- Host ABI changes without accepted RFC/spec/profile/tests;
- event/output Host ABI implementation before acceptance;
- product bundling as a hidden requirement of package-check;
- runtime dependency on Node, npm install, Python, Codex, source repo, or build
  scripts.

## ABI Policy

- Project milestone: `v0.16`.
- AIR ABI: remains `0.10` unless an executable/runtime package contract change
  is explicitly accepted.
- Host ABI: remains `0.10` unless a new/changed host import or event/output
  Host ABI is explicitly accepted.
- Package/report/schema changes must be named in release notes and should not
  imply AIR ABI or Host ABI changes by default.

See [Version and ABI Policy](VERSION_AND_ABI_POLICY.md).

## Acceptance Gates

- `npm test` passes.
- Markdown links and ABI request checks pass.
- Layer guard passes.
- Core tracks no active demo implementation files.
- `airpkg` first-slice JSON metadata is deterministic and inspectable.
- Target bundle RFC exists before product bundling implementation work.
- Host conformance/replay first-slice fixtures pass and fail deterministically.
- Event/output remains RFC-only unless explicitly promoted.
- AIR ABI and Host ABI remain `0.10` unless a separate ABI decision gate is
  passed.

## Representative Commands

```sh
npm test
node scripts/check_review_bundle.js --keep
node scripts/check_markdown_links.js
node scripts/check_abi_requests.js
node test/layer_guard.test.js
git diff --check
```

```sh
node bin/airc.js check examples/policy_audit_package --profile cli --lsp-json
node bin/airc.js report package examples/policy_audit_package --profile cli --json
node bin/airc.js package-check examples/policy_audit_package --profile cli --source-only --json
node bin/airc.js package examples/policy_audit_package -o build/policy.airpkg.json --profile cli
node bin/airc.js inspect-airpkg build/policy.airpkg.json
node bin/airc.js link-plan examples/policy_audit_package --profile cli --json
node bin/airc.js build package examples/policy_audit_package --linked-wasm --profile cli -o build/policy.linked.wasm
node bin/airc.js conformance <package-dir> --profile cli --trace <trace.json> --json
```
