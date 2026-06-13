# AIR v0.12 Merge Readiness

Status: final merge-readiness snapshot after v0.12 gate fixes

Branch: `air-v0.12-package-profile-core-ergonomics`

Commit: MR head

Worktree: clean after committing this release patch

Recommendation: **READY TO OPEN MR**

Reason: Core gates are green after the v0.12 review-bundle fixture fixes,
source-only package-check stabilization, stdlib hygiene enforcement, and
voxel-basic kit reclassification. Demo media packs remain ignored and outside
the Core release gate. No Core test gate is currently failing.

## Version Semantics

Version metadata remains intentionally conservative:

- `src/version.js`: `AIR_VERSION = "0.10.0"`, `AIR_ABI_VERSION = "0.10"`;
- `package.json`: `version = "0.10.0"`;
- v0.12 is a package/profile/core hygiene milestone with `reportVersion:
  "0.12-draft"` in package-check output;
- [AIR_PACKAGE_MANIFEST.md](../spec/AIR_PACKAGE_MANIFEST.md) states v0.12 keeps
  the current public AIR ABI at `0.10` unless changed by a separate migration.

A package/compiler version bump is a release-management decision before tag
publication. It is not required by the current AIR ABI contract.

## Repository Hygiene

The branch is intended to be committed as one v0.12 release-gate patch before
opening the merge request. Large local demo media packs are ignored by
`.gitignore` and are not part of the Core release gate or review bundle.

## Checklist

| Gate | Status | Command run | Evidence/log path | Blocker classification |
| --- | --- | --- | --- | --- |
| Repository status | PASS | `git branch --show-current && git rev-parse HEAD && git status --short` | final git status after commit | No Core blocker. |
| Version metadata | PASS | `cat src/version.js`; `package.json` inspection | [src/version.js](../src/version.js), [AIR_PACKAGE_MANIFEST.md](../spec/AIR_PACKAGE_MANIFEST.md) | No Core blocker. AIR ABI remains `0.10` intentionally. |
| Full Core test suite | PASS | `npm test` | terminal output; existing `REVIEW_RESULTS/logs/npm-test.log` in the source checkout used for the v0.12 review | No Core blocker. |
| Layer guard | PASS | `node test/layer_guard.test.js` | terminal output; [test/layer_guard.test.js](../test/layer_guard.test.js) | No Core blocker. |
| Package manifest tests | PASS | `node test/package_manifest.test.js` | terminal output | No Core blocker. |
| Host profile tests | PASS | `node test/host_profiles.test.js` | terminal output; `test/fixtures/profiles/` | No Core blocker. |
| Module graph tests | PASS | `node test/module_graph.test.js` | terminal output; [test/module_graph.test.js](../test/module_graph.test.js) | No Core blocker. |
| Report/AI review tests | PASS | `node test/report.test.js` | terminal output | No Core blocker. |
| Markdown links | PASS | `node scripts/check_markdown_links.js` | terminal output | No Core blocker. |
| ABI request validation | PASS | `node scripts/check_abi_requests.js` | terminal output | No Core blocker. |
| Stdlib hygiene | PASS | `node test/layer_guard.test.js`; direct `stdlib/*.air` scan | `stdlib/`, [V0_12_STDLIB_HYGIENE_AUDIT.md](V0_12_STDLIB_HYGIENE_AUDIT.md) | No Core blocker. |
| Package-check source-only fixture | PASS | `node bin/airc.js package-check examples/package_manifest --profile browser-webgpu --source-only --json` | terminal output | No Core blocker. Status is `warn` because placeholder fixture assets are intentionally reported. |
| Asset manifest fixtures | PASS | `node test/asset_manifest.test.js`; covered by `npm test` | terminal output | No Core blocker. |
| Audio authority | PASS | `node test/host_profiles.test.js`; `node demo/contra-platformer/scripts/check_audio_capability_negative.mjs` | terminal output; [AUDIO_AUTHORITY_v0.12.md](AUDIO_AUTHORITY_v0.12.md) | No Core blocker. |
| Debug metric policy | PASS | `node test/report.test.js`; `npm test` | terminal output; [AUDIO_AUTHORITY_v0.12.md](AUDIO_AUTHORITY_v0.12.md), [RFC_AUDIO_EVENTS_v0.12.md](RFC_AUDIO_EVENTS_v0.12.md) | No Core blocker. |
| Host profile consistency | PASS | `node test/host_profiles.test.js`; profile inspection | `data/host_profiles/` | No Core blocker. `browser-webgpu` was not expanded with voxel-only native imports. |
| Contra pressure diagnostics | PASS | `node bin/airc.js package-check demo/contra-platformer --profile browser-webgpu --source-only --json` | terminal output | No Core blocker. Contra source-only diagnostics now pass; remaining demo work stays demo-local. |
| Voxel pressure status | PARTIAL | documentation/status review | [DEMO_STATUS_v0.12.md](DEMO_STATUS_v0.12.md), [docs/abi-requests/voxel-demo.md](abi-requests/voxel-demo.md) | Pressure evidence, not Core blocker. |
| RC review script/version text | PASS | `rg "v0\\.11 RC|AIR v0\\.11 RC" scripts/run_rc_checks.sh docs/RC_REVIEW_BUNDLE_POLICY.md` | terminal output | No Core blocker after v0.12 text fix. |
| Review/snapshot hygiene | PARTIAL | `find REVIEW_RESULTS`; `find snapshots`; `find . -maxdepth 2 -type d -name demo_snapshots` | terminal output | Docs/snapshot follow-up: existing root `demo_snapshots/` and root snapshot layout remain. |
| Whitespace diff check | PASS | `git diff --check` | terminal output | No Core blocker. |

## Stdlib Hygiene Details

Current `stdlib/*.air` files:

- `bounds.air`
- `collision.air`
- `color.air`
- `easing.air`
- `grid.air`
- `noise.air`
- `packet.air`
- `physics.air`
- `transform.air`

Direct scan result:

- every `stdlib/*.air` has `capabilities { }`;
- no `stdlib/*.air` declares host extern imports;
- no `stdlib/*.air` calls Host ABI families such as `gfx`, `ui`, `audio`,
  `net`, `fs`, `input`, `debug`, or `gpu`;
- `gfx3d.air`, `scene.air`, and `ui.air` are reclassified under kits;
- `voxel.air` is reclassified under `kits/voxel-basic` as an experimental
  reusable kit candidate, not stdlib/Core/public ABI;
- `math3d.air` is reclassified under examples/reference material;
- `packet.air` contains only generic bitflag logic, with TCP-specific helpers
  moved to [network_tcp_flags.air](../examples/network_tcp_flags.air).

This gate is green for merge.

## Module Graph Gate

`test/module_graph.test.js` covers:

- `use "./x.air" as alias`;
- calls like `@alias.exported_func(...)`;
- duplicate aliases;
- cycles;
- URL import rejection;
- package-root escape rejection;
- symlink escape rejection;
- exported-only cross-module calls;
- deterministic graph/report output.

Invalid imports produce deterministic package-check JSON diagnostics.

## Package-Check Source-Only Gate

`package-check --source-only` is active and does not require wasm. The
`examples/package_manifest` fixture report includes:

- declared capabilities;
- computed capabilities;
- host imports;
- audio authority;
- profile compatibility;
- asset manifest status;
- generated handle status;
- hidden authority;
- AI review warnings.

The fixture exits successfully with status `warn` because deterministic
placeholder assets are explicitly reported as placeholders. This is acceptable
for v0.12 source/audit mode and review-bundle resilience.

## Audio Authority Gate

v0.12 active model:

- `audio.beep` is a direct AIR host import;
- direct audio imports require `audio` in module and package capabilities;
- audio assets do not grant playback authority;
- host playback remains host-owned;
- `audio.event` remains RFC/deferred and is rejected unless promoted through
  spec/profile/tests;
- `debug.metric` is diagnostic telemetry only and cannot authorize audio.

Tests cover:

- audio import with module/package `audio` capability passes;
- audio import without module capability fails;
- package using audio import without package `audio` capability fails;
- debug-metric-driven audio authority fails or warns according to policy.

## Host Profile Gate

Host profiles validated:

- `browser-webgpu`
- `native-wgpu`
- `cli`
- `verifier-only`
- `mobile-gpu-draft`

`browser-webgpu` was not expanded to make voxel-demo pass. Native-style
`gfx.camera_look_at` and `gfx.skybox_world` are present in `native-wgpu`, not in
`browser-webgpu`. Unsupported imports are rejected by host profile tests.

Profile limits and diagnostics are represented in profile metadata. Any
runtime/host probing remains out of scope for v0.12.

## Demo Pressure Status

### Contra Platformer

Classification: demo migration task / pressure evidence.

Current source-only package-check passes and reports:

- declared/computed capabilities: `audio`, `debug`, `gfx`, `input`;
- host imports: `audio.beep`, `debug.metric`, `gfx.begin_frame`,
  `gfx.draw_primitive`, `gfx.end_frame`, `input.axis`;
- audio authority: direct import, status `pass`;
- profile support: `pass`;
- asset manifest: valid;
- generated handles: current;
- hidden authority: none;
- AI review: advisory warnings remain visible.

Contra remains a demo pressure consumer, not a Core ABI authority.

### Voxel Demo

Classification: pressure evidence / partial.

Voxel remains useful for GFX/package pressure. `kits/voxel-basic/air/voxel.air`
is an experimental reusable kit candidate that may be consumed by
demo/voxel-demo, but it must not drive public `gfx.*` growth, stdlib pollution,
or browser-webgpu profile expansion. Dense voxel chunks remain on the
RFC/package/`gpu.*`/render-graph path.

### Browser/Manual Smoke

Classification: manual/non-core unless explicitly selected.

Browser and GPU-dependent smoke checks remain manual or host-local. They should
be recorded when run, but they are not required for Core merge readiness.

## Review And Snapshot Hygiene

Observed:

- `scripts/run_rc_checks.sh` now writes `AIR v0.12 RC Review Results`;
- `REVIEW_RESULTS/` exists and contains `SUMMARY.md`, `CHECKS.json`,
  `RED_FLAGS.md`, `COMMANDS.log`, and logs;
- [RC_REVIEW_BUNDLE_POLICY.md](RC_REVIEW_BUNDLE_POLICY.md) documents the review
  bundle as an artifact, not the primary execution environment;
- root `demo_snapshots/` still exists;
- existing root `snapshots/2026-05-15_20-49-19_airlang-review_1905af2/` exists.

Snapshot placement cleanup is a docs/release-artifact follow-up, not a Core
semantic blocker.

## Verified Definition

For v0.12, "verified" means:

- syntax/type checks pass;
- capability checks pass;
- strict Host ABI checks pass;
- package manifest checks pass when package context is used;
- selected host profile compatibility checks pass when `--profile` is used.

It does not mean:

- domain correctness;
- gameplay correctness;
- replay correctness;
- structural cleanliness;
- absence of all AI-slop;
- demo-specific behavior correctness;
- host presentation correctness.

Anti-slop diagnostics are advisory in v0.12 unless a specific blessed fixture
or release gate makes them hard failures.

## Core Blockers

No Core test gate is failing.

Merge-blocking non-test issue:

1. Dirty working tree. Commit/review the intended v0.12 branch changes before
   merging to main.

## Demo Migration Tasks

- Keep Contra gameplay, asset, and runtime migration in the demo workstream, not Core.
- Keep demo module split usage classified as pressure evidence until linked semantics are stable.
- Keep voxel-demo as GFX/package pressure evidence unless promoted to a blessed
  passing gate.

## Pressure-Demo Non-Blockers

- Contra source-only package-check passes as pressure evidence, but standalone demo gameplay/runtime polish remains demo-local.
- Voxel browser/manual smoke status is pressure evidence and not a Core blocker.
- Stripped review-bundle media/build outputs are not Core blockers.

## Docs-Only Follow-Ups

- Decide whether to bump package/compiler version before tag publication while
  keeping AIR ABI at `0.10`.
- Move or archive existing root `demo_snapshots/` and root snapshot output into
  the agreed `snapshots/demo/` and `snapshots/core/` layout if this is required
  for the release artifact.
- Archive superseded planning docs only if the release owner wants a smaller
  docs root before publication.
