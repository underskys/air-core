# Voxel Demo ABI Request Triage

Status: proposed
Source demo/project: `demo/voxel-demo`
Canonical triage location: `docs/abi-requests/voxel-demo.md`

Formal ledger decisions:
[Voxel Demo Game APIs](../../requests/rejected/voxel-demo-game-apis.md)
and [Static Tables And Readonly Tablegroups](../../requests/accepted/static-tables-tablegroups.md).

These requests capture generic AIR pressure discovered in the voxel demo.
They are evidence for v0.11 planning, not authority to change public ABI.

## Request Entry Standard

Request entries should use these fields when they are created or refreshed:

- `Status`: proposed / accepted / implemented / deferred / rejected
- `Decision`: current routing decision and what is explicitly not approved
- `Source demo`: originating demo or project
- `Target layer`: Core / Host ABI / GFX ABI / Kit / Host / Docs
- `Priority`: P0 / P1 / P2
- `Version target`: v0.11 / v0.12 / post-v1
- `Problem`
- `Current workaround`
- `Proposed generic capability`
- `Non-goals`
- `Verifier impact`
- `Host ABI registry impact`
- `Manifest / package impact`
- `Conformance tests`
- `Acceptance criteria`

## Triage Policy For v0.11

- Demo requests are evidence, not authority.
- Do not add new public `gfx.*` functions unless a separate RFC accepts them.
- Prefer existing `gpu.*`, `.airgfx.json`, render graphs, scene compiler
  instances, host conformance, and reusable kits before growing public ABI.
- Keep demo art direction project-local: terrain style, animal shapes,
  palettes, material IDs, cave lamps, water colors, sky art, roads, rivers,
  routes, biome styling, and spawn rules do not belong in Core or stdlib.
- Route source-language ergonomics to Core RFCs instead of quick patches.
- Treat code snippets below as request sketches only, not approved ABI.

## Unified Implementation Routing

Every accepted request must name the layer where code may change before an
agent starts implementation:

- Product/demo-loop polish should prefer package docs, examples, manifests,
  conformance reports, host diagnostics, scene compiler output, and reusable
  kits.
- Public ABI changes must be rare and require a separate RFC when they add
  imports, syntax, or cross-host contracts.
- Demo-specific behavior may be implemented inside the demo project, but that
  does not promote it into Core, stdlib, or public ABI.
- When the same need can be solved by a host implementation behind existing
  ABI, choose that path before adding new imports.
- When the same need can be solved by `.airgfx.json` or a reusable kit, choose
  that path before changing AIR source syntax.

Allowed code locations for v0.11 requests:

- `docs/` and `spec/`: public contracts, migration notes, report shapes, and
  request decisions.
- `examples/`: generic examples that teach public AIR behavior.
- `kits/`: reusable resources or conventions that are not Core or stdlib.
- `hosts/`: implementation behind existing ABI or manifest contracts.
- `tools/scene-compiler.js`: deterministic manifest/instance generation when
  the feature is build-time package data.
- `stdlib/`: only generic, deterministic, backend-neutral, resource-free AIR
  helpers.
- `src/`: only after an accepted Core or public ABI RFC names the required
  parser/verifier/lowering/registry changes.
- `demo/voxel-demo`: project-local implementation only; useful for proving a
  need, not for defining public semantics.

## Universal Request Review

Current Voxel Demo requests have been checked for generic applicability:

| Request | Universal? | Routing |
|---|---:|---|
| Native Gfx Stream Probe | yes, as host compatibility | Host implementation behind existing imports only. |
| Instanced Primitive Draw | not enough evidence yet | Defer public `gfx.*`; prove via host batching, kits, manifests, or multiple demos first. |
| Voxel Chunk Render Path | yes, if package-owned | Existing `gpu.*`, `.airgfx.json`, host conformance, and diagnostics. |
| Generic Grid And Fixed-Point Math Helpers | yes, only with neutral names | Stdlib/reusable kit only for resource-free grid/fixed-point helpers. |
| Generated AIR Data Ergonomics | yes, but Core-risky | Core RFC only; no quick v0.11 syntax patch. |
| PBR Lighting And Post-Processing Package Path | yes, if renderer/package-owned | Manifest schema, render graphs, kits, and host implementation. |

Universal means the need can apply outside Voxel Demo. It does not mean public
ABI is approved. Any public ABI promotion still requires the separate specs,
verifier/registry coverage, tests, and migration notes required by repository
policy.

Cross-check these decisions against [GFX_v0.11_PLAN.md](../archive/v0.11/GFX_v0.11_PLAN.md),
[GFX_v0.11_STATUS.md](../archive/v0.11/GFX_v0.11_STATUS.md),
[GFX_ABI.md](../../spec/GFX_ABI.md),
[GFX_HIGH_LEVEL_ABI.md](../../spec/GFX_HIGH_LEVEL_ABI.md), and
[GFX_BUFFER_LAYOUTS.md](../../spec/GFX_BUFFER_LAYOUTS.md).

## v0.11 / v0.12 Routing Snapshot

| Request | Layer | v0.11 action | v0.12/post-v1 status |
|---|---|---|---|
| Native Gfx Stream Probe And Window Renderer | host implementation | Implemented behind existing imports only; keep `gfx-stream` headless and `gfx-window` manual/GPU-dependent. | Continue host polish only if it stays behind registered `gfx.*`, `debug`, and `input` imports. |
| Instanced Primitive Draw | host implementation / reusable kit / docs | Deferred for public high-level `gfx.*`; use host batching, manifest instances, existing `gpu.*`, kits, or examples. | Separate RFC required after multiple independent demos prove a generic `transform_set` model. |
| Voxel Chunk Render Path | manifest schema / host implementation | Use existing `gpu.draw_voxel_chunk`, `.airgfx.json`, buffer layouts, host conformance, and diagnostics; do not add `gfx.draw_voxel_chunk`. | Expand package examples and host support only through manifest/package work. |
| Generic Grid And Fixed-Point Math Helpers | stdlib | Accept only generic, deterministic, backend-neutral, resource-free helpers. | Continue additive stdlib polish without demo vocabulary. |
| Generated AIR Data Ergonomics | core | RFC only; no v0.11 quick syntax patch. | Core RFC must cover parser, formatter, verifier, lowering, audit, tests, and migration notes. |
| PBR Lighting And Post-Processing Package Path | manifest schema / reusable kit / host implementation | Route through `.airgfx.json`, render graphs, materials, pipelines, kits, and host diagnostics; no new `gfx.*`. | Future kit/host expansion without Core or high-level ABI drift. |

## Request: Native Gfx Stream Probe And Window Renderer

Status: implemented
Decision: Implemented as host/demo polish behind existing imports. This is not
a new public ABI and not a Core change. The command-stream probe remains the
stable non-windowed check; the windowed renderer is a native host rendering path
for the same existing stream.
Source demo/project: `demo/voxel-demo`
Target layer: host implementation
Priority: P1
Version target: v0.11

### Problem

Voxel Demo emits a high-volume `gfx.draw_primitive` stream from AIR. The
browser host can render it, but the Rust native host previously only ran
`.airgfx`/`gpu.*` packages or printed command-stream metrics.

### Current workaround

Build `game/voxel_scene.air` to wasm, then stop before launching the
neighboring AirDoom Swift/Metal app because that host owns unrelated texture
atlas, skybox, material defaults, marquee, and renderer behavior.

### Proposed generic capability

Instantiate a `gfx.*` wasm module in `hosts/native`, implement the same generic
imports as the web host, call `frame(t)`, and print a JSON command-stream
report. For visual inspection, the native host may also open a `wgpu` window and
rasterize the same captured stream through `gfx.camera_look_at` with host-owned
instanced cube fallback geometry, material colors, and a depth buffer.

The implemented probe supports only existing imports:

- `debug.metric`
- `input.axis`
- `gfx.begin_frame`
- `gfx.end_frame`
- `gfx.camera_look_at`
- `gfx.skybox_world`
- `gfx.draw_primitive`

### Non-goals

- Do not reuse AirDoom assets, material defaults, skybox, marquee, or renderer
  behavior as the Voxel Demo backend.
- Do not add new public `gfx.*` functions.
- Do not change AIR Core syntax, verifier semantics, stdlib, package registry,
  or target packaging.

### Verifier impact

None. Existing extern signature verification and capability audit are
sufficient.

### Host ABI registry impact

None. The probe implements existing registered imports only.

### Manifest / package impact

None. Voxel Demo remains a standalone high-level `gfx.*` wasm stream, not an
`.airgfx` package.

### Why Generic

The headless stream probe and native compatibility renderer are generic host
review tools for any AIR module that emits the existing high-level `gfx.*`
stream. The reusable part is host-side command capture, JSON metrics, diagnostic
failure, and optional native visualization behind already registered imports,
not voxel-specific materials, terrain, animals, caves, or art direction.

### Conformance tests

- `./demo/voxel-demo/scripts/run-metal.sh` builds the voxel wasm and runs
  `hosts/native gfx-window` by default.
- `./demo/voxel-demo/scripts/run-metal.sh --native-window` is an explicit alias
  for the same native windowed compatibility renderer.
- `./demo/voxel-demo/scripts/run-metal.sh --native-gfx-probe` is an explicit
  command-stream JSON probe.
- `./demo/voxel-demo/scripts/run-metal.sh --build-only` builds the native
  wasm artifact without running a native probe.
- `hosts/native gfx-window <wasm>` opens a native `wgpu` window and renders the
  same existing `gfx.draw_primitive` stream for visual inspection.
- `hosts/native conformance <package>` for `.airgfx`/`gpu.*` packages must
  continue to pass.
- Voxel smoke verifies command budget, day/cave lighting state, animal metrics,
  and bird orientation.

### Acceptance criteria

- Probe prints JSON with command counts, visible instances, primitive batches,
  camera, skybox, and debug metrics.
- Window renderer opens through `wgpu`/`winit`, projects through
  `gfx.camera_look_at`, renders instanced fallback cubes with depth, and does
  so without adding public AIR ABI.
- Command stream uses only existing host imports.
- No Core, stdlib, public ABI, package registry, or target packaging files
  change.

## Request: Instanced Primitive Draw

Status: deferred
Decision: Deferred for public high-level `gfx.*` ABI in v0.11. If revisited,
the sketch must use a host-owned manifest handle named `transform_set`, not a
raw or magic buffer handle.
Source demo/project: `demo/voxel-demo`
Target layer: host implementation / reusable kit / docs
Priority: P1
Version target: v0.12
Design RFC: [RFC_GFX_INSTANCING_v0.12.md](../RFC_GFX_INSTANCING_v0.12.md)

### Problem

Voxel Demo draws thousands of repeated primitive shapes per frame. The current
AIR source must emit one `gfx.draw_primitive` call per visible block, leaf,
rock, animal part, lamp part, and cave feature. This keeps the host generic,
but makes AIR code verbose and limits how far primitive-only rendering can
scale.

### Current workaround

Repeated calls to `gfx.draw_primitive` through `kits/voxel-basic` or demo-local kit
wrappers. The Three.js host batches matching commands into `InstancedMesh`
objects after AIR has already emitted scalar draw calls.

### Why Generic

Many visual modules can produce repeated primitive draws: voxel scenes, simple
3D debug views, grid visualizations, particle-like markers, and generated
layout previews. That pressure may be generic only after multiple independent
demos prove the same host-owned transform-set model. Voxel-specific material
IDs, animal parts, cave lamps, palettes, and terrain rules are not generic.

### Proposed generic capability

This sketch is not approved ABI. It documents the safer shape if a later RFC
accepts high-level instancing:

```air
extern gfx.draw_instanced(
  primitive: i32,
  transform_set: i32,
  count: i32,
  material: i32,
) -> void
```

`transform_set` is a host-owned manifest handle. AIR does not own GPU buffers
or transform memory in v0.11.

### Non-goals

- Do not expose backend objects such as WebGPU buffers, Metal buffers, pointers,
  or DOM handles to AIR source.
- Do not make `transform_set: i32` a magic number; it must resolve through
  manifest/package rules and any future registry rules.
- Do not make AIR allocate, mutate, or own transform memory in v0.11.
- Do not add `gfx.draw_instanced` or `gfx.draw_primitive_instanced` in v0.11.
- Do not promote Voxel Demo material IDs, animal IDs, cave IDs, palette rules,
  tree plans, cave lamps, or art direction into stdlib or public ABI.

### Verifier impact

In v0.11, none because the function is not implemented. If accepted later, the
verifier should validate only ABI signature, argument arity, and required `gfx`
capability. Manifest handle existence, layout, and count support belong to the
gfx/app checker, not AIR Core verification.

### Host ABI registry impact

None in v0.11. If accepted later, add a backend-neutral import and a named
`transform_set` resource class only after a separate RFC.

### Manifest / package impact

In v0.11, prototype through existing `.airgfx.json` scene/instance metadata,
`gpu.draw_mesh_instanced`, `gpu.draw_scene_node`, reusable kit conventions, or
host batching behind existing `gfx.draw_primitive`.

If a high-level instanced draw is accepted later, packaged examples must declare
host-owned transform sets, layout, maximum instance count, and producer. The
gfx/app checker must validate that `transform_set` exists in the manifest and
supports the requested `count` and layout.

### Conformance tests

- Compare scalar and instanced paths for equivalent primitive counts.
- Verify zero-count draws are no-ops.
- Verify invalid or undeclared transform-set handles fail deterministically.
- Verify gfx/app checker rejects missing transform sets and insufficient
  count/layout support.
- Verify browser and native hosts report the same instance count.

### Acceptance criteria

- No public high-level instancing ABI is added in v0.11.
- Voxel Demo and AirDoom can both demonstrate the same generic pressure before
  a public ABI RFC is considered.
- Any future sketch uses `transform_set`, not `transform_buffer`.
- AIR command count can be reduced without hidden host authority or AIR-owned
  GPU memory.

## Request: Voxel Chunk Render Path

Status: proposed
Source demo/project: `demo/voxel-demo`
Requested by: `voxel_scene` terrain and cave generation
Priority: P1
Version target: v0.11 / v0.12

Decision: accepted as host/package polish.
Target layer: manifest schema / host implementation
Next action: document chunk and instance handles, manifest fields, buffer layout
requirements, and unsupported-feature diagnostics for voxel chunks.
Do not implement: a new high-level `gfx.*` voxel function.
Design RFC: [RFC_GFX_VOXEL_CHUNK_PATH.md](../RFC_GFX_VOXEL_CHUNK_PATH.md)

Implementation routing:

- Generic path: `spec/GFX_ABI.md`, `spec/GFX_BUFFER_LAYOUTS.md`,
  `src/gfx_manifest.js`, `examples/`, `hosts/`, and conformance/report docs.
- Demo-local path: `demo/voxel-demo` may keep high-level primitive streaming as
  a compatibility/demo host path.
- Public ABI path: use existing `gpu.draw_voxel_chunk`; do not add
  `gfx.draw_voxel_chunk`.

### Problem

Realistic voxel terrain needs detailed cliffs, caves, layered surfaces, water,
foliage, and lighting. Emitting every visible voxel-like block as an individual
high-level primitive is useful for exploration, but it will not reach rich
terrain density or native/WebGPU parity.

### Current Workaround

AIR generates a streaming grid of height columns and decorative primitive
clusters. The host receives scalar primitive commands and batches them by
material/color.

### Existing Generic Direction

Use the existing raw GPU ABI direction:

```air
extern gpu.draw_voxel_chunk(chunk: i32, instances: i32) -> void
```

The request is for package examples, validation, host implementation, and
diagnostics around voxel chunks, not demo-specific terrain rules.

### Why Generic

Voxel chunks are useful for terrain, destructible worlds, simulation grids,
medical/scientific volumes, and procedural editors.

### Why Not Project-Specific

The chunk/rendering contract can be generic. Road, river, cave formulas, animal
placement, cave lamps, and art direction stay inside `demo/voxel-demo`.

### Alternatives

- Continue high-level primitive emission for compatibility and smoke demos.
- Host-side batching behind existing commands.
- Raw `gpu.*` package with `.airgfx.json` voxel resources.

### Compatibility Risk

Low if implemented as host/package polish behind existing `gpu.*` and manifest
surfaces. Medium if new public high-level ABI is introduced.

### Non-goals

- Do not add `gfx.draw_voxel_chunk`.
- Do not move demo terrain rules, palettes, routes, cave logic, water colors,
  or animal placement into public ABI or stdlib.
- Do not make AIR Core own renderer resources or GPU buffers.

### Verifier impact

None for v0.11 host/package polish. Existing strict Host ABI checks already
cover public extern names and signatures.

### Host ABI registry impact

None in v0.11. Use existing `gpu.draw_voxel_chunk` only where raw GPU package
examples need it; do not add high-level `gfx.*` voxel imports.

### Manifest / package impact

Document or validate chunk handles, buffer layouts, package references, and
unsupported-feature diagnostics through existing `.airgfx.json` and package
surfaces.

### Conformance tests

Add host/package checks only when chunk examples exist. Until then, keep current
manifest, GFX showcase, and native/browser stream checks passing.

### Acceptance criteria

- Any v0.11 work lands as host/package/conformance polish, not public ABI.
- Unsupported chunk features are reported clearly.
- Existing `gfx.draw_primitive` demo streams remain compatible.

## Request: Generic Grid And Fixed-Point Math Helpers

Status: proposed
Source demo/project: `demo/voxel-demo`
Requested by: `voxel_scene` generic coordinate and interpolation pressure
Priority: P2
Version target: v0.11

Decision: accepted cautiously.
Target layer: stdlib
Next action: propose small resource-free helpers with generic names, tests, and
canonical examples. Verify no helper mentions terrain, voxel, biome, road,
river, cave, animal, or demo-specific cell sizes.
Do not implement: road/river/cave/animal/biome helpers or voxel-demo naming in
stdlib.

Implementation routing:

- Generic path: `stdlib/grid.air` or an existing generic math module, plus
  `src/stdlib.js`/registry catalog docs only if the helper becomes public
  stdlib.
- Tests/examples path: focused verifier/lowering tests and generic examples
  with neutral names such as grid, cell, index, remainder, interpolation, or
  slope.
- Demo-local path: helpers containing terrain, voxel, road, river, cave,
  animal, biome, palette, or fixed project cell-size assumptions stay in
  `demo/voxel-demo`.

### Problem

Procedural worlds repeatedly need floor division, positive modulo,
world-to-cell conversion, streaming local coordinates, fixed-point
interpolation, and generic slope checks. Today these are hand-written in demo
AIR, which is verbose and easy for AI agents to duplicate in slightly different
forms.

### Current Workaround

Demo-local helpers such as `floor_cell_1200`, `positive_rem_1200`,
`local_z_from_world_z`, `terrain_height_world_at`, and slope rejection logic.

### Proposed Generic API Sketch

These names are candidate sketches, not approved API:

```air
func grid_floor_cell(v: i32, cell: i32) -> i32
func grid_positive_rem(v: i32, cell: i32) -> i32
func fixed_lerp_i32_1000(a: i32, b: i32, w: i32) -> i32
func slope_reject_i32(center: i32, a: i32, b: i32, limit: i32) -> bool
```

Only promote helpers that remain independent of voxel-demo terrain semantics.

### Why Generic

Grid math and fixed-point interpolation are common across procedural terrain,
physics, pathing, layout, collision, simulation packages, UI layout, and tests.

### Why Not Project-Specific

The generic coordinate math is reusable. Helpers that encode terrain style,
biomes, roads, rivers, caves, animals, rocks, or fixed project cell sizes are
not reusable.

### Alternatives

- Keep all helpers demo-local.
- Add examples that use existing `fixed.*`, `bounds.*`, or `collision.*`
  helpers without new stdlib.
- Promote only one helper at a time after tests.

### Compatibility Risk

Low if additive and generic. Main risk is stdlib contamination through
project-specific names or assumptions.

### Non-goals

- Do not add terrain, voxel, biome, road, river, cave, animal, palette, or
  project-route helper names to stdlib.
- Do not add AIR Core syntax for data ergonomics in this request.
- Do not add host imports.

### Verifier impact

Only normal stdlib verification and precondition checks. No verifier semantics
change is required.

### Host ABI registry impact

None. These helpers are resource-free AIR stdlib functions, not host ABI.

### Manifest / package impact

None beyond package/audit visibility for examples that use the helpers.

### Conformance tests

Verify `stdlib/grid.air` in library mode, verify/format/audit/lower a generic
example, and keep layer guard checks active for project-term leakage.

### Acceptance criteria

- Helpers have generic names and deterministic AIR implementations.
- Examples verify and lower without host capabilities.
- Layer guard prevents project/demo terms from entering the grid helpers.

## Request: Generated AIR Data Ergonomics

Status: proposed
Source demo/project: `demo/voxel-demo`
Requested by: `voxel_scene` palettes, metrics, material handles, spawn tuning
Priority: P2
Version target: future / Core RFC

Decision: Core RFC.
Target layer: core
Next action: discuss module-level constants, enum-like handles, static tables,
and formatter/verifier/lowering implications in the Core RFC before any code
change.
Do not implement: source-language data ergonomics in v0.11 as a quick patch.

Implementation routing:

- Generic path: RFC first, then `src/parser.js`, `src/format.js`,
  `src/verifier.js`, `src/lower_wasm.js`, specs, examples, and tests only if
  the RFC is accepted.
- Demo-local path: generated or helper-module constants may remain in
  `demo/voxel-demo` while the Core design is unresolved.
- Public API path: no syntax, formatter, verifier, or lowering change in this
  request.

### Problem

Large AI-authored scenes need many stable constants: primitive IDs, material
IDs, metric IDs, thresholds, colors, dimensions, and spawn weights. Plain AIR
currently forces many raw numbers and boilerplate temporaries, which makes
review harder and increases the chance of accidental public-surface pollution.

### Current Workaround

Raw numeric IDs and repeated local constants inside demo AIR functions.

### Proposed Generic API Sketch

This sketch is not approved syntax:

```air
const material_grass:i32 = 1
const metric_animals_visible:i32 = 10
```

Static table-like data needs a separate design because it may affect parsing,
formatting, verifier accounting, memory layout, lowering, WIT/package metadata,
and canonical examples.

### Why Generic

Named constants and compact deterministic data help AI generate readable AIR
for games, UI tools, network tools, render packages, simulations, and tests.

### Why Not Project-Specific

Better syntax may be generic. Voxel-demo material names, palettes, spawn
tables, animal dimensions, and art choices remain local data.

### Alternatives

- Continue raw local constants.
- Use imported project-local `.air` helper modules for enum-like functions.
- Generate canonical AIR from a project-local source format before verification.

### Compatibility Risk

High. This touches source syntax and likely parser, formatter, verifier,
lowering, examples, and docs. It should not ride along with host/package polish.

### Non-goals

- Do not implement Core data ergonomics in v0.11 as a quick patch.
- Do not add syntax that bypasses formatter, verifier, lowering, audit, or
  migration planning.
- Do not encode project material IDs or placement tables in Core.

### Verifier impact

Requires a separate Core RFC before implementation. The RFC must specify parser,
formatter, verifier, lowering, audit/report, and migration behavior together.

### Host ABI registry impact

None. This is Core/source ergonomics pressure, not Host ABI.

### Manifest / package impact

To be decided by the Core RFC. Static data may affect package/audit reporting,
but no v0.11 manifest change is approved here.

### Conformance tests

Future RFC must include parser/formatter/verifier/lowering/audit tests and
backward compatibility cases. No v0.11 implementation tests are expected.

### Acceptance criteria

- Request remains RFC-only until a full Core plan is accepted.
- No v0.11 Core syntax or semantics change lands from this request.
- Demo-generated data pressure is documented without becoming public ABI.

## Request: PBR Lighting And Post-Processing Package Path

Status: proposed
Source demo/project: `demo/voxel-demo`
Requested by: `voxel_scene` water, sky, cave lamps, terrain readability
Priority: P2
Version target: v0.11 / v0.12

Decision: accepted as manifest/render graph/host/kit work.
Target layer: manifest schema / reusable kit / host implementation
Next action: build package examples, reusable material/shader kit pieces, host
implementation, and conformance reports using existing `gpu.*` and manifest
concepts.
Do not implement: new `gfx.*` functions for PBR lighting or post-processing.

Implementation routing:

- Generic path: `.airgfx.json` examples, `spec/GFX_MATERIALS.md`,
  `spec/GFX_ABI.md`, render graph docs, `kits/gfx-basic` or future
  `kits/gfx-pbr`, and host implementation/reporting behind existing `gpu.*`.
- Demo-local path: voxel sky art, water/lava colors, cave lamp styling, and
  terrain palettes stay in `demo/voxel-demo`.
- Public ABI path: no high-level `gfx.*` imports for PBR, shadows, water, fog,
  bloom, or tone mapping.

### Problem

The current high-level Three.js host shows terrain, shadows, water shimmer,
cave lights, and sky, but it does not demonstrate the richer renderer path AIR
needs for polished game-like visuals: PBR materials, normal/roughness maps,
environment lighting, shadows, bloom, tone mapping, fog, and depth-aware post.

### Current Workaround

The demo uses material IDs, host-side Three.js material heuristics, a custom
water shader hook, point-light selection, and smoke screenshots. These are good
for primitive exploration but not a portable renderer package.

### Existing Generic Direction

Use existing render graph concepts and raw GPU imports:

```air
extern gpu.set_scene_time(time_ms: i32) -> void
extern gpu.set_camera(camera: i32) -> void
extern gpu.execute_render_graph(graph: i32) -> void
```

The request is for manifest examples, reusable material/shader kit pieces, host
implementation, and conformance reports before adding any new ABI functions.

### Why Generic

PBR materials, shadows, sky/environment, bloom, tone mapping, fog, and water are
shared needs for many AIR visual packages.

### Why Not Project-Specific

The renderer/package path can be generic. Voxel-specific sky art, cave lamps,
water/lava colors, and terrain palettes remain demo assets or project-kit
choices.

### Alternatives

- Keep high-level Three.js host heuristics for demo iteration.
- Use existing GFX material/post schemas and improve host support.
- Add reusable kit resources without changing AIR Core or public high-level
  GFX ABI.

### Compatibility Risk

Low to medium if this stays additive in manifests, kits, and host
implementation. High if it becomes new `gfx.*` public ABI.

### Non-goals

- Do not add public `gfx.*` PBR or post-processing functions.
- Do not move voxel-specific sky, cave lamps, water colors, terrain palettes,
  or art direction into stdlib or public ABI.
- Do not turn `kits/gfx-basic` into a production renderer.

### Verifier impact

None for v0.11. AIR verifier continues to validate existing host imports and
portable AIR semantics.

### Host ABI registry impact

None in v0.11. PBR and post-processing should use manifests, render graphs,
kits, and host implementation behind existing ABI.

### Manifest / package impact

Expected work belongs in `.airgfx.json` material, pipeline, render graph,
quality profile, and conformance-report fields.

### Conformance tests

Use GFX showcase and WebGPU/native host diagnostics to report supported
features, unsupported features, material fallbacks, and render graph behavior.

### Acceptance criteria

- Advanced visual features route through manifest/render graph/host/kit work.
- Unsupported features are explicit diagnostics.
- No new public `gfx.*` functions are added for PBR or post effects.
