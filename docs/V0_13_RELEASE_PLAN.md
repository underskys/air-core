# AIR v0.13 Release Plan

Status: executable release plan

Theme: Verified Module Composition & AI Surface Discipline

v0.13 closes the next gap after v0.12 package/profile hygiene: AIR packages
must be verified as structured graphs of package-local modules, not just as one
large file.

Authoritative status:

- [FEATURE_STATUS_v0.13.md](FEATURE_STATUS_v0.13.md)
- [V0_13_RELEASE_CHECKLIST.md](V0_13_RELEASE_CHECKLIST.md)
- [V0_13_GAP_REPORT.md](V0_13_GAP_REPORT.md)
- [AIR Core](../spec/AIR_CORE.md)
- [AIR Layer Manifest](../spec/AIR_LAYER_MANIFEST.md)
- [Public API Hygiene](PUBLIC_API_HYGIENE.md)

## P0 Gates

| Gate | Required evidence | Command |
| --- | --- | --- |
| v0.12 gates still pass | Existing package/profile/stdlib hygiene checks remain green. | `npm test` |
| Package-local import validation | Relative imports, aliases, missing modules, duplicate aliases, package-root escape, and cycles are tested. | `node test/module_graph.test.js` |
| Cross-module visibility | Exported functions can be called through aliases; private functions cannot. | `node test/module_graph.test.js` |
| Capability propagation | Reachable modules expose capability origins, host import origins, and authority chains. | `node test/module_graph.test.js` |
| Static scalar tables | Parser, formatter, verifier, audit, report, and Wasm lowering cover fixed read-only scalar tables. | `node test/static_tables.test.js` |
| Generated data determinism | Generated handle/data modules are stable across repeated generation. | `node test/handle_generator.test.js` |
| Stdlib purity | Stdlib stays host-authority-free and demo vocabulary stays out of public layers. | `node test/layer_guard.test.js` |

## P1 Gates

| Gate | Required evidence | Command |
| --- | --- | --- |
| Module graph reports | `package-check --profile --json` includes modules, graph edges, exports, private functions, capability origins, host import origins, and authority chains. | `node test/module_graph.test.js` |
| AI repair diagnostics | Reports keep stable machine-readable slop warnings and repair hints. | `node test/report.test.js` |
| Markdown/spec consistency | Active v0.13 docs link cleanly and do not claim target packaging or new Host ABI. | `node scripts/check_markdown_links.js` |

## Implemented Scope

- `use "./x.air" as alias` is the package-local import form.
- Module graph analysis rejects URL imports, absolute imports, package-root
  escape, missing files, duplicate import aliases, cycles, duplicate module
  identities, private cross-module calls, and missing exported symbols.
- `package-check --profile --json` reports deterministic module graph metadata,
  capability origins, host import origins, and authority chains.
- Static tables use the first-slice syntax:

```air
table xs:i32[3] = [10, 20, 30]

export func read(index: i32) -> i32 {
entry:
  %value:i32 = table.get xs, %index
  return %value
}
```

This slice is read-only, scalar-only, fixed-length, literal-only, and
deterministically bounds-checked. It is not a dynamic collection feature.

## Explicit Non-Goals

- No new public Host ABI functions.
- No `audio.event`, network expansion, filesystem expansion, or UI expansion.
- No game-specific Core APIs.
- No demo-specific stdlib helpers.
- No target packaging implementation.
- No package registry or remote imports.
- No dynamic imports or runtime module loading.
- No dynamic maps, GC, reflection, ECS, generics, or host object handles.
- No linked multi-module Wasm output until symbol/linking semantics are
  separately specified and tested.

## Demo Boundary

Contra/platformer and voxel demos remain pressure evidence. They can consume
module graph reports, generated data, and table diagnostics after Core semantics
stabilize, but demo migration failures are not Core release blockers unless a
specific demo fixture is promoted into the Core gate.
