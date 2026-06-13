# ABI Requests Index

This file is the top-level index for AIR ABI request triage. Detailed
request lifecycle, template, and agent handling rules live in
[ABI Request Pipeline](abi-requests/README.md).

Demo request files are evidence, not authority. A request may be implemented
only after it has a target layer, a generic rationale, and compatibility with
[AIR Agent Contract](../AGENTS.md), [AIR Layer Manifest](../spec/AIR_LAYER_MANIFEST.md),
[Public API Hygiene](PUBLIC_API_HYGIENE.md), and the relevant ABI/spec files.

## Universal Fit Rules

- Public ABI changes require more than one demo or host proving the same generic
  need, plus specs, verifier/registry checks, tests, and migration notes.
- Prefer host implementation, manifest schema, reusable kits, examples, and
  conformance diagnostics before adding Core syntax or public host imports.
- Stdlib promotions must follow [Stdlib Policy](STDLIB_POLICY.md): pure,
  deterministic, backend-neutral, resource-free, and project-neutral.
- Keep project names, material IDs, routes, palettes, terrain formulas, animal
  placement, sky art, cave lamps, and gameplay semantics in project kits.
- `accepted` means accepted for the named layer, not accepted as public ABI.
- `implemented` means implemented only in the named layer.

## Current Requests

| Request | Source | Universal verdict | Target layer | v0.11 action |
|---|---|---|---|---|
| [Native Gfx Stream Probe And Window Renderer](abi-requests/voxel-demo.md#request-native-gfx-stream-probe-and-window-renderer) | Voxel Demo | Generic host compatibility probe and native window renderer for existing `gfx.*` streams. | Host | Implemented behind existing imports; no public ABI change. |
| [Instanced Primitive Draw](abi-requests/voxel-demo.md#request-instanced-primitive-draw) / [v0.12 RFC](RFC_GFX_INSTANCING_v0.12.md) | Voxel Demo | Potentially generic, but not proven across independent demos yet. | Host/Kit/Docs now; GFX ABI only by accepted RFC later | Deferred; do not add `gfx.draw_instanced` in v0.11. |
| [Voxel Chunk Render Path](abi-requests/voxel-demo.md#request-voxel-chunk-render-path) | Voxel Demo | Generic for dense voxel/volume/grid rendering if kept in `gpu.*` and manifests. | Manifest schema / Host implementation / Conformance | Accepted as host/package polish; do not add `gfx.draw_voxel_chunk`. |
| [Generic Grid And Fixed-Point Math Helpers](abi-requests/voxel-demo.md#request-generic-grid-and-fixed-point-math-helpers) | Voxel Demo | Generic only for resource-free grid/fixed-point helpers with neutral names. | Stdlib or reusable kit | Accepted cautiously; no terrain/voxel/biome names. |
| [Generated AIR Data Ergonomics](abi-requests/voxel-demo.md#request-generated-air-data-ergonomics) | Voxel Demo | Generic authoring pressure, but high Core risk. | Core RFC | RFC only; no v0.11 quick syntax patch. |
| [PBR Lighting And Post-Processing Package Path](abi-requests/voxel-demo.md#request-pbr-lighting-and-post-processing-package-path) | Voxel Demo | Generic renderer/package pressure if expressed through manifests, kits, and hosts. | Manifest schema / Reusable kit / Host implementation | Accepted as package path work; no new `gfx.*` PBR/post imports. |
| [AirDoom Project Kit Requests](abi-requests/airdoom.md) | AirDoom | Mostly project-specific until split into narrow generic requests. | Project kit by default | Keep project-local unless independent generic evidence appears. |
| [GFX Showcase Request](abi-requests/gfx-showcase.md) | GFX Showcase | Generic host diagnostics/showcase pressure. | Host implementation | Use for host/package polish, not Core growth. |
| [UI Dashboard Request](abi-requests/ui-dashboard.md) | UI Dashboard | Generic non-game UI tool pressure. | Host ABI / Host implementation | Keep within existing `ui.*` and host-owned UI model unless RFC accepts changes. |
| [Contra Platformer Extraction Triage](abi-requests/contra-platformer.md) | Contra Platformer | Useful 2D viewport, bounds/contact, sprite kit, audio authority, asset manifest, module split, and fixed-data evidence; not public ABI by itself. | Examples / reusable kit / manifest schema / Core RFC / project kit | Extract only generic patterns; keep gameplay, material IDs, assets, and audio project-local unless authority is explicit. |
| [Network Scanner RFC](abi-requests/network-scanner.md) | Network Dashboard / Future utilities | Generic but security-sensitive. | Host ABI / Policy / Host implementation | Documentation/RFC only in v0.11; mock data remains the demo path. |
| [Core Data Ergonomics RFC](abi-requests/core-data-ergonomics.md) | Voxel Demo / generated AIR pressure | Generic but Core syntax/lowering risk. | Core | RFC only until parser/formatter/verifier/lowering plan is accepted. |
| [FlowDesk Air Pressure Request](abi-requests/flowdesk-air.md) | FlowDesk Air / Chrome extension | Non-game pressure for bounded facts, structured data contracts, async request handles, and bounded output commands; not public ABI by itself. | Future example / reusable kit / host profile RFC / structured data RFC | v0.17 pressure evidence only; no Chrome extension Host ABI. |
| [Fixed Bounded State Segment Pressure Request](abi-requests/fixed-bounded-state-segment.md) | Airtris / Minesweeper / PhotoLoop / bounded simulations | Generic pressure for persistent AIR-owned fixed scalar state, but not accepted implementation. | Core RFC candidate / conformance tooling / examples or kits | v0.21 pressure evidence only; no AIR ABI or Host ABI change. |
| [AIRON Platformer Pressure Request](abi-requests/airon-platformer-pressure.md) | AIRON Platformer | Platformer pressure for authored package composition, tablegroups, declared pools, resource validation, and mock-host policy assertions; demo-specific behavior is not Core authority. | Core RFC / package tooling / reusable kit / host implementation / project kit by item | v0.31 pressure evidence only; no AIR ABI or Host ABI change. |

## Voxel Demo Request Coverage

All known Voxel Demo requests are represented in
[Voxel Demo ABI Request Triage](abi-requests/voxel-demo.md):

- Native Gfx Stream Probe And Window Renderer.
- Instanced Primitive Draw.
- Voxel Chunk Render Path.
- Generic Grid And Fixed-Point Math Helpers.
- Generated AIR Data Ergonomics.
- PBR Lighting And Post-Processing Package Path.

The active demo file `demo/voxel-demo/requests.md` in the `demo/voxel` branch
is intentionally only a pointer to canonical triage so parallel demo work does
not become automatic public ABI.

## Contra Platformer Request Coverage

All known `FD_LANGUAGE_REQUESTS.md` entries are represented in
[Contra Platformer Extraction Triage](abi-requests/contra-platformer.md):

- Audio Capability Enforcement.
- Sprite Transform ABI.
- Asset Manifest / Bundle Support.
- Module Split / Imports.
- Fixed Data Structures.

The demo-local `demo/contra-platformer/FD_LANGUAGE_REQUESTS.md` in the
`demo/contra` branch is now a pointer/source note, not a parallel unmanaged
backlog.
