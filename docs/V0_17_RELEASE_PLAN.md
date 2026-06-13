# AIR v0.17 Release Plan

Status: active first-slice release

Theme: Artifact Validation & Target Bundles

v0.17 starts from the v0.16 package artifact, linked package, and conformance
first slices. The milestone hardens artifact validation and introduces minimal
target bundle folders without adding package registry behavior, native
installers, game-specific APIs, or event/output Host ABI implementation.

Future milestone note: references to v0.18+ in pressure requests are candidate
pressure only. They do not define active v0.17 scope and do not imply AIR ABI or
Host ABI changes.

## P0 Scope

| Area | Gate | Acceptance |
| --- | --- | --- |
| `airpkg` artifact validation | Treat `airpkg` metadata as a checkable artifact, not just emitted JSON. | [airpkg Artifact Validation RFC](rfcs/v0.17-airpkg-artifact-validation.md) defines schema errors, missing required metadata, stale linked/package summaries, absolute paths, timestamps, runtime build-tool requirements, and ABI/profile mismatches. |
| package-check / check-airpkg over artifacts | Allow release gates to inspect package artifacts without requiring source package traversal. | `airc check-airpkg <file-or-dir> --json` validates `.airpkg.json` artifacts and emits deterministic machine-readable diagnostics. |
| Target bundle first slice | Define and prototype minimal `web-dev` and `native-dev` folder bundles. | [Target Bundle First Slice RFC](rfcs/v0.17-target-bundle-first-slice.md) plus `airc bundle <airpkg> --target web-dev|native-dev -o <dir>` define folder artifacts with explicit metadata, runtime files, and no hidden dependency on Node, npm install, Python, source repo, Codex, or build scripts. |
| Bundle validation | Make target bundles checkable before they are treated as product outputs. | `airc check-bundle <dir> --json` checks declared runtime files, artifact metadata, hashes, and build-time/runtime boundary rules. |
| Build-time/runtime boundary enforcement | Convert v0.16 boundary policy into artifact and bundle checks. | `check-airpkg` and `check-bundle` fail deterministically when runtime artifacts encode build-only requirements or local absolute paths. |
| Non-game package bundle proof | Prove target bundle mechanisms are generic. | `examples/policy_audit_package` produces and validates a first-slice bundle without host rendering or demo assets. |
| ABI decision gates | Keep ABI changes explicit. | AIR ABI and Host ABI remain `0.10` unless a separately accepted runtime or Host ABI contract change lands. |

## P1 / If Scope Allows

- [event/output promotion package](rfcs/v0.17-event-output-promotion-package.md),
  still without Host ABI implementation unless accepted separately;
- FlowDesk Air / Chrome extension pressure evidence for future structured data
  and host profile RFCs, with no v0.17 ABI change;
- output-events manifest tooling draft;
- conformance output stream fixture for a future accepted output contract;
- public demo/adoption planning that consumes Core without defining it;
- linked output integration improvements inside `airpkg` and bundle metadata.

## Deferred

- Host ABI `0.11` implementation;
- `audio.event`, `effect.event`, or `output.emit` implementation;
- full native installers;
- Steam packaging;
- package registry;
- Unity/Godot adapter implementation;
- full JSON-RPC LSP server;
- dynamic maps, GC, reflection, runtime imports, and host object handles;
- game-specific APIs.

## Non-goals

v0.17 must not add:

- package registry or remote install behavior;
- native installer, Steam, app-store, or production deployment promises;
- event/output Host ABI imports;
- active demo implementations in Core;
- game-specific Core or Host ABI APIs;
- stdlib helpers driven only by demos;
- runtime dependency on Node, npm install, Python, Codex, source repo, or build
  scripts.

## ABI Policy

- Project milestone: `v0.17`.
- AIR ABI: remains `0.10` unless package runtime, calling convention,
  import/export layout, memory/data representation, entrypoint semantics, or
  runtime-required package metadata changes.
- Host ABI: remains `0.10` unless new/changed host imports or host import
  semantics are accepted through RFC/spec/profile/tests.
- Artifact, bundle, report, and manifest schema changes must be named, but do
  not imply AIR ABI or Host ABI changes by default.

See [Version and ABI Policy](VERSION_AND_ABI_POLICY.md).

## Acceptance Gates

- `npm test` passes.
- Markdown links and ABI request checks pass.
- Layer guard passes.
- Core tracks no active demo implementation files.
- `airpkg` validation is deterministic and source-independent where possible.
- First-slice bundles are folder artifacts, not native installers.
- Bundle validation enforces build-time/runtime boundary rules.
- Non-game package bundle proof passes.
- Event/output remains RFC/tooling-only unless separately promoted.
- AIR ABI and Host ABI remain `0.10` unless explicit ABI gates pass.

## Representative Commands

```sh
npm test
node scripts/check_review_bundle.js --keep
node scripts/check_markdown_links.js
node scripts/check_abi_requests.js
node test/layer_guard.test.js
git diff --check
```

Representative v0.17 command shapes:

```sh
node bin/airc.js package examples/policy_audit_package -o build/policy.airpkg.json --profile cli
node bin/airc.js inspect-airpkg build/policy.airpkg.json
node bin/airc.js check-airpkg build/policy.airpkg.json --json
node bin/airc.js bundle build/policy.airpkg.json --target web-dev -o build/policy-web
node bin/airc.js bundle build/policy.airpkg.json --target native-dev -o build/policy-native
node bin/airc.js check-bundle build/policy-web --json
```
