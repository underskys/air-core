# AIR v0.14 Release Plan

Status: planning

Theme: Executable Package Composition & AIR-authored Data

v0.14 keeps AIR Core focused on generic package integrity. Downstream
consumers, pressure demos, and examples can provide evidence, but they do not
define Core, stdlib, Host ABI, or release scope.

## Bundle / Release Classification

v0.14 release evidence is classified explicitly:

- `core-rc`: clean Core release-candidate bundle with matching
  `REVIEW_RESULTS` and snapshot metadata. This is the only bundle class that can
  close a Core release.
- `core-with-pressure`: Core bundle plus selected pressure evidence from demos
  or downstream packages. Pressure failures must be classified separately from
  Core blockers.
- `demo-review`: informational bundle for a demo/downstream package. It is not
  Core RC evidence and does not need to be a standalone Core build artifact.

Changes under `demo/**` are not Core release changes by default. A demo failure
is a Core blocker only when it exposes a compiler, verifier, package-check,
stdlib, or Host ABI regression reproducible outside that demo. Demo-local
Python/Node/Vite/asset tooling is allowed when isolated and not required by AIR
Core runtime or product artifacts.

Core release gates must not depend on heavy demo assets unless explicitly
declared as Core-owned fixtures. Demo requests must be generalized into RFCs
before entering Core, stdlib, Host ABI, or v0.14 P0 scope.

## Demo Pressure Requests Triage

Active `demo/**/requests/*.md` files are pressure evidence, not Core authority.
Archive notes under `demo/**/requests/archive_notes/**` are historical and do
not become active scope unless rewritten as generic RFCs.

v0.14 P0 accepts only generic mechanisms already aligned with this plan:

- package-check/verifier/report graph parity for authored package modules;
- AIR-authored deterministic data through constants and static scalar tables;
- generated handle/artifact freshness checks;
- configurable `reviewPolicy` / anti-slop budgets;
- manifest/resource consistency, including rejection of runtime refs to
  `tmp_unused`, `assets_candidate`, `graphics_bundles`, and quarantine paths;
- `debug.metric` diagnostics-only enforcement;
- at least one non-game package example gate.

v0.14 RFC / v0.15 candidates:

- generic event/output ABI;
- richer audio/music event ABI;
- sprite/presentation transform contract;
- fixed pools / bounded mutable state;
- browser/native camera and skybox profile decision.

Demo-local only:

- assets, graphics packs, sprite repair, art direction, and visual target plans;
- level content, water/canyon recipes, pacing, and gameplay bugs;
- temporary Python/Node/Vite/import/build scripts when isolated to demos;
- platformer, voxel, AirDoom, ERP, DevOps/SRE consumer migration notes.

Rejected as direct Core:

- `draw_actor`, `draw_contra_enemy`, or game-specific water/platform APIs;
- demo-specific stdlib helpers;
- `debug.metric` as gameplay/effect/audio event bus;
- hidden TypeScript or host gameplay authority;
- Host ABI additions just to satisfy one demo.

## P0 Scope

| Area | v0.14 gate | Acceptance |
| --- | --- | --- |
| Package-level verify/report/check | `airc verify package`, `airc report package`, and `airc package-check` operate over the authored package module graph. | Verifier, report, and package-check use the same deterministic package-local graph, including package-root import safety and exported/private boundaries. |
| Static AIR-authored data ownership/reporting | Constants and static read-only scalar tables are AIR-owned deterministic data. | Reports list table/function/global ownership by module; no dynamic arrays, maps, GC, host-backed containers, or runtime mutation are introduced. |
| Generated handle/artifact freshness | Generated handles and generated data are derived artifacts, not source of truth. | Package-check reports missing/stale generated files and deterministic fingerprints where possible. |
| reviewPolicy / anti-slop budgets | Packages can configure structural review budgets. | Package-check/report can warn or fail selected anti-slop checks by policy without globally hardcoding style failures. |
| Manifest/AIR ID consistency | Runtime manifests bind AIR semantic IDs to host resources. | Package-check validates missing resource paths, forbidden candidate/quarantine/tmp runtime references, and manifest ID references where schemas allow. |
| Non-game package example | v0.14 mechanisms are proven outside games. | A small policy/SRE/CI/service-style package passes package-check and reports modules/tables/functions without host rendering or game concepts. |
| Interactive example as pressure | Interactive packages may provide pressure evidence. | Interactive examples are not Core authority and do not force Host ABI, stdlib, or Core API expansion. |
| ABI/version policy | Version meanings remain explicit. | AIR ABI and Host ABI remain `0.10` unless runtime contract or accepted Host ABI changes require a separate bump. |

## P1 / Deferred Tracks

These are recognized needs, not v0.14 P0 release gates:

- linked executable package build;
- event/output ABI;
- fixed pools;
- target product bundle;
- full LSP;
- Unity/Godot adapters;
- package registry.

## Non-goals

v0.14 must not add:

- game-specific Core APIs;
- stdlib pollution or host-authority wrappers;
- Host ABI bump without accepted new host imports or changed host import
  semantics;
- `debug.metric` as an event bus;
- demo migration as a Core deliverable;
- dynamic maps;
- GC;
- reflection;
- runtime imports;
- host object handles;
- remote imports.

## Acceptance Gates

- No game-specific Core API is added.
- Non-game example passes package-check.
- Package-check reports generated freshness.
- reviewPolicy can warn or fail selected anti-slop checks.
- `linkedWasm` remains `false`/deferred unless explicitly promoted.
- AIR ABI remains `0.10` unless runtime contract changes.
- Host ABI remains `0.10` unless accepted host imports or host import semantics
  change.
- Stdlib remains pure, deterministic, domain-neutral, and host-authority-free.
- Demo/consumer migration remains outside Core release scope.

## Expected Fixture Warnings

Some v0.14 Core fixtures intentionally warn while still serving as release-safe
checks:

- `examples/package_manifest` may report placeholder asset warnings because the
  review bundle uses tiny deterministic fixtures instead of production media.
- Multi-module source graph examples may report `linkedWasm: false` or a
  linked-Wasm deferred warning because stable linked executable package output
  is not implemented in v0.14.

These warnings are expected for the named fixtures. They are not production
success criteria and must not be used to weaken package-check semantics.

## Required RC Commands

```sh
npm test
node scripts/check_review_bundle.js --keep
node scripts/check_markdown_links.js
node scripts/check_abi_requests.js
node test/layer_guard.test.js
git diff --check
```

Representative package/profile checks:

```sh
node bin/airc.js surface --profile cli --json
node bin/airc.js surface --profile browser-webgpu --json
node bin/airc.js package-check examples/package_manifest --profile browser-webgpu --source-only --json
node bin/airc.js package-check examples/policy_audit_package --profile cli --source-only --json
```

## Version Policy

v0.14 is a project milestone. It does not automatically bump compiler/package,
AIR ABI, Host ABI, package schema, report schema, or manifest schema versions.

- Project milestone: `v0.14`.
- Compiler/package version: follows package release policy.
- AIR ABI: remains `0.10` unless runtime/executable contract changes.
- Host ABI: remains `0.10` unless new host imports or changed host import
  semantics are accepted.

See [Version and ABI Policy](VERSION_AND_ABI_POLICY.md).
