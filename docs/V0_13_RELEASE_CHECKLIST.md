# AIR v0.13 Release Checklist

Status: active release checklist

Theme: Verified Module Composition & AI Surface Discipline

## Version Semantics

- Project milestone: `v0.13`.
- Compiler/package version: `0.10.0`.
- AIR ABI version: `0.10`.
- Host ABI version: `0.10`.

v0.13 does not promote new public Host ABI surface.

## Core Gates

| Gate | Status | Command |
| --- | --- | --- |
| Full core suite | required | `npm test` |
| Review bundle structure | required | `node scripts/check_review_bundle.js --keep` |
| Review results snapshot commit | required | `node scripts/check_review_bundle.js --keep` |
| Markdown links | required | `node scripts/check_markdown_links.js` |
| ABI request pipeline | required | `node scripts/check_abi_requests.js` |
| Stdlib/layer hygiene | required | `node test/layer_guard.test.js` |
| Module graph behavior | required | `node test/module_graph.test.js` |
| Static scalar tables | required | `node test/static_tables.test.js` |
| AI review/report diagnostics | required | `node test/report.test.js` |
| Surface report hallucination guard | required | `node test/surface.test.js` |
| Negative hallucination fixtures | required | `node test/hallucination_fixtures.test.js` |
| Whitespace/conflict check | required | `git diff --check` |

## Package/Profile Spot Checks

```sh
node bin/airc.js surface --profile browser-webgpu --json
node bin/airc.js package-check test/fixtures/package_minimal --profile browser-webgpu --source-only --json
node bin/airc.js package-check examples/profile_portability --profile browser-webgpu --source-only --json
node bin/airc.js package-check examples/profile_portability --profile native-wgpu --source-only --json
node bin/airc.js report examples/package_manifest/module.air --profile browser-webgpu
```

## Scope Guard

The Core v0.13 branch must not contain `demo/contra-platformer/**` changes.
Contra migration belongs in `air-v0.13-contra-demo-migration`.

Rejected in v0.13:

- `audio.event`;
- `effect.event`;
- `gfx.draw_sprite_transform`;
- remote imports;
- runtime module loading;
- dynamic imports;
- package registry;
- dynamic maps, GC, reflection;
- host object handles;
- `std.gfx3d`, `std.scene`, or `std.voxel`.

## Merge Criteria

- All required Core gates pass on `air-v0.13-verified-module-composition`.
- `REVIEW_RESULTS/SUMMARY.md` matches the review bundle snapshot commit unless
  it is explicitly marked historical/superseded.
- `git diff --name-only origin/main...HEAD -- demo/contra-platformer` is empty.
- Version metadata remains intentionally at compiler/package `0.10.0`, AIR ABI
  `0.10`, and Host ABI `0.10`.
- Any demo failures are classified as demo migration work, not fixed by Core,
  stdlib, or public Host ABI expansion.
