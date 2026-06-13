# AIR v0.22 ABI Requests Triage

Status: active triage snapshot

This document prioritizes current files under `docs/abi-requests/` for v0.22.
Request files are pressure evidence, not authority. Default routing is
deferred / needs RFC unless a request has already been accepted for a narrower
layer such as host implementation, manifest schema, example, or kit.

## Triage Table

| File | Status | Owner layer | Next review milestone | Decision summary | Risk notes |
| --- | --- | --- | --- | --- | --- |
| `docs/abi-requests/fixed-bounded-state-segment.md` | proposed / pressure evidence | Core RFC candidate | v0.23 implementation planning | Accept for RFC/gates/design review only. First slice candidate is fixed `i32` AIR-owned state with no Host ABI change. | High Core risk: must not become dynamic collections, runtime JSON, host-visible memory, shared state, or game-specific API. |
| `docs/abi-requests/flowdesk-air.md` | deferred / needs canonical example plan | example / reusable kit / host profile RFC / manifest schema | v0.23+ after AirOps hardening | Keep as non-game pressure for bounded facts, rowsets, command buffers, privacy boundaries, and possible Chrome Extension host profile RFC. | High privacy/browser risk: raw Chrome, DOM, IndexedDB, Jira/fetch, URLs, tokens, and private text stay host-owned. |
| `docs/abi-requests/airdoom.md` | deferred / project-kit by default | project kit / example | future, after generic split requests | Keep AirDoom concepts project-local unless a narrow generic request is filed with independent evidence. | High demo leakage risk: materials, routes, pickups, arena semantics, and gameplay vocabulary must not enter Core/stdlib/Host ABI. |
| `docs/abi-requests/voxel-demo.md` | mixed: some accepted host/package polish; Core items deferred | host implementation / manifest schema / kit / Core RFC for generated data only | future RFC by sub-request | Host/package polish behind existing `gfx.*`/manifest surfaces is acceptable. New Core syntax or public GFX ABI remains deferred. | Performance pressure may be caused by host batching/pipeline/debug behavior, not ABI; requires metrics before ABI decisions. |
| `docs/abi-requests/contra-platformer.md` | deferred / extract generic patterns only | example / reusable kit / manifest schema / possible stdlib helpers | future after independent evidence | Keep platformer gameplay and assets project-local; only pure generic helpers or manifest/report patterns may be extracted. | High game-specific leakage risk around sprites, audio/music, actors, level recipes, and fixed entity buffers. |
| `docs/abi-requests/gfx-showcase.md` | accepted for host/report polish, not ABI growth | host implementation / manifest schema | ongoing host polish | Use showcase to improve unsupported-feature diagnostics and renderer/package clarity behind existing contracts. | Must not add new Core syntax or public host imports just to improve showcase visuals. |
| `docs/abi-requests/core-data-ergonomics.md` | partly accepted by prior constants/static table work; remaining items deferred | Core / tooling | future parser/verifier/lowering RFC when needed | Existing constants/static readonly tables cover first slices. Further data ergonomics need a specific RFC and tests. | Core syntax risk; avoid demo material IDs, palettes, spawn tables, or project-specific names. |
| `docs/abi-requests/network-scanner.md` | deferred / security-sensitive host policy RFC | host / external policy / host ABI candidate | future security review | Keep as policy-gated host pressure only. AIR may orchestrate scalar requests and analyze facts; host owns network access. | Very high authority risk: no raw sockets, DNS, scanning, packet capture, OS interface inspection, or hidden network access in AIR. |
| `docs/abi-requests/ui-dashboard.md` | deferred / use existing UI surfaces first | host implementation / example / possible Host ABI RFC later | future non-game example review | Build on existing `ui.*` and host-owned UI model before proposing new dashboard commands. | DOM/React/native UI authority remains host-owned; avoid product-specific labels/data as public ABI. |

## v0.22 Priority

1. Keep Fixed Bounded State Segment as the active v0.22 RFC/gates topic.
2. Treat FlowDesk as next non-game canonical pressure after AirOps hardening.
3. Keep demo-originated visual/game requests out of Core unless they are split
   into generic, independently evidenced RFCs.
4. Keep Host ABI `0.11`, `output.emit`, raw browser/network authority, runtime
   JSON, dynamic maps, host object handles, and shared mutable state deferred.
