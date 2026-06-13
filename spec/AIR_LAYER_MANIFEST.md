# AIR Layer Manifest

This manifest defines what belongs in AIR Core, AIR stdlib, host ABIs, and
demo/project kits. It is a repository architecture contract, not AIR Core
syntax.

## Terms

ABI means Application Binary Interface. In AIR it is the stable boundary
between compiled AIR/WASM modules and the host runtime. AIR calls scalar
imports such as `gfx.draw_primitive`, `gpu.execute_render_graph`,
`input.axis`, `fs.read_text`, or `net.http_get`; the host implements those
imports with browser, native, OS, GPU, network, or filesystem APIs.

Host means the embedding runtime that instantiates AIR/WASM and owns real
platform objects, devices, renderer state, IO stacks, windows, sensors, and
resource lifetimes.

## AIR Core

AIR Core is only the portable IR and verifier/lowering substrate:

- scalar and local composite types;
- SSA values;
- explicit memory regions;
- calls and extern declarations;
- capabilities, effects, and contracts;
- bounded loops and verifier-visible budgets;
- structured control flow;
- Wasm lowering rules.

AIR Core must not contain graphics, network, filesystem, UI, audio, physics,
gameplay, renderer, asset, or operating-system policy.

## AIR Stdlib

Stdlib modules are deterministic helper libraries for AIR authors. Stdlib can
contain generic helpers, but each domain must stay separate.

Allowed examples:

- `stdlib/math*` and `stdlib/transform*`: fixed-point math, vectors, matrices,
  interpolation, clamps, camera basis, and generic transform composition.
- `stdlib/bounds*`, `stdlib/color*`, and `stdlib/easing*`: generic culling
  bounds, hit tests, packed colors, exposure parameters, and deterministic
  animation curves.
- `stdlib/noise*`: deterministic hash/noise/remap helpers.
- `stdlib/grid*`: floor division, positive modulo, cell indexing.
- `stdlib/collision*`: generic AABB, capsule, ray, sphere, sweep helpers.
- generic bitset and scalar packing helpers, when they are not tied to one
  protocol, host service, product, or demo domain.

For v0.13, every AIR stdlib module must be structurally pure:

- it declares `capabilities { }`;
- it declares no `extern` imports;
- it does not call Host ABI families such as `gfx.*`, `gpu.*`, `ui.*`,
  `audio.*`, `net.*`, `fs.*`, `input.*`, `debug.*`, `device.*`, `io.*`,
  `time.*`, or `random.*`.

Host-facing wrappers, manifest-facing graphics helpers, protocol-specific
helpers, UI command helpers, and draw wrappers belong in reusable kits,
examples, demo/project kits, or host implementation unless and until a separate
request/RFC proves a pure generic stdlib shape.

Stdlib must not contain demo material IDs, project palettes, named game
objects, host object references, DOM/WebGPU/Metal objects, sockets, file
handles, resource paths, WGSL shaders, binary/text assets, `.airgfx.json`
resource manifests, or backend-specific resource packs.

If it has art direction, shader paths, texture paths, material presets, or demo
semantics, it is not stdlib. Put reusable starter resources in `kits/`,
educational fixtures in `examples/`, and project-specific assets or helpers in
`demo/`.

Stdlib promotion examples:

- Accept `grid.cell_origin_i32(cell, cell_size)` because it is deterministic,
  resource-free, backend-neutral, and useful for any grid-indexed data.
- Accept `grid.index_3d(x, y, z, width, height)` because it describes generic
  indexing and carries no project vocabulary.
- Reject `terrain_height_world_at`, `voxel_biome_at`, `cave_lamp_material`,
  `animal_spawn_route`, and `palette_for_rock` because those names encode demo
  art direction, gameplay, material IDs, or project object semantics.
- Reject any stdlib helper that opens files, touches sockets, calls host GPU/UI
  functions, embeds resource paths, or assumes a renderer/backend.

Detailed stdlib accepted/rejected examples and `stdlib/grid.air` hygiene checks
are maintained in [STDLIB_POLICY.md](../docs/STDLIB_POLICY.md).

## Host ABIs

Host ABIs are capability-qualified import families. They are independent
vertical boundaries:

- `gfx.*`: high-level host-owned drawing commands.
- `gpu.*`: raw GPU/render-graph commands backed by manifests.
- `ui.*`: host-owned dashboard/web-utility commands for panels, labels, buttons, inputs, tables, charts, metrics, statuses, warnings, and text fallback rendering.
- `input.*`: keyboard, pointer, touch, controller, sensor inputs.
- `fs.*`: capability-gated filesystem operations.
- `net.*`: capability-gated network operations.
- `io.*`: async request polling and buffer handoff.
- `audio.*`: host-owned audio playback/control.
- `debug.*`: metrics, diagnostics, and review signals.

Host ABIs must not depend on each other implicitly. A module that needs both
network and graphics must declare both capabilities and call both import
families explicitly.

## Manifests

Manifests describe package resources and host-visible render or app metadata:

- models, textures, shaders, materials, skeletons, animations;
- render graphs and quality profiles;
- collision metadata;
- host-visible buffer layout metadata;
- input bindings;
- UI resources;
- network policy/configuration where appropriate.

Manifests do not add AIR Core semantics. They are validated package data that
hosts consume.

## Hosts

Hosts own real platform devices and services:

- windows, DOM, canvases, app shells, and dashboards;
- WebGPU, WebGL, Metal, Vulkan, Direct3D, Three.js, and software renderers;
- filesystem and network stacks;
- raw sockets, packet capture, DNS execution, and subprocess tools;
- audio devices, input devices, timers, sensors, entropy, and permissions;
- asset loading, shader compilation, GPU resource creation, and actual drawing.

AIR must see only scalar values, handles, pointers, slices, lengths, and stable
manifest keys. AIR must not receive raw host objects.

## Reusable Kits

Reusable kits, such as `kits/gfx-basic`, may contain optional starter
resources: WGSL shader templates, manifest fragments, material presets, tiny
examples, and host-facing package scaffolding. Kits are not AIR Core and are
not AIR stdlib. Projects may use, fork, replace, or ignore them.

Reusable kit rules:

- Kits may contain resources, shaders, manifest fragments, starter materials,
  fixtures, and glue code that would be invalid in `stdlib/`.
- Kits must not define public AIR Core syntax or public Host ABI imports.
- Kit helpers must use existing public ABI, manifest schema, stdlib helpers, or
  host implementation hooks.
- A kit extracted from a demo must remove project names, material IDs, routes,
  palettes, gameplay rules, and art-direction assumptions before it becomes
  reusable.
- If a kit needs a new public import, manifest field, or Core feature, route
  that need through an ABI request/RFC before changing public surfaces.
- Kits are optional. A project may replace or fork a kit without changing AIR
  semantics.

Accept reusable kit examples:

- a starter unlit WGSL shader plus matching `.airgfx.json` fragment;
- a deterministic GLB fixture and manifest reference used by host conformance;
- a generic sprite atlas convention with documented handles.

Reject reusable kit examples:

- AirDoom arena routes, weapon pickups, or named level parts;
- Voxel Demo terrain palettes, cave lamp colors, animal placement, or water
  style;
- a platformer enemy lifecycle or level script presented as the standard kit.

## Examples

Examples are public teaching and conformance material. They may be more concrete
than `stdlib/`, but they must not silently become public ABI or Core behavior.

Example rules:

- Examples may demonstrate one complete use case with checked-in AIR, manifests,
  assets, scripts, and expected reports.
- Examples must use documented public ABI and existing manifest/schema behavior.
- Example-local helper code is not standard API unless promoted through the
  normal request/spec/test path.
- Examples should prefer generic names and comments when teaching a reusable
  pattern; project lore, palettes, routes, and named objects belong in `demo/`.
- Every example that proves a reusable pressure should point to the target
  layer: docs, kit, stdlib, host implementation, manifest schema, or ABI RFC.
- Examples must be runnable or explicitly marked as fixtures only.

Accept example examples:

- a network dashboard with mock data showing `ui.*` and `debug.metric`;
- a GFX showcase that validates render graphs, GLB fixtures, and host
  diagnostics through `.airgfx.json`;
- a side-scroller camera/viewport example that teaches world coordinates and
  activation windows without adding Core syntax or new host imports.

Reject example examples:

- a demo-specific helper copied into `examples/` to bypass project-kit review;
- an example that relies on undocumented host imports;
- an example that presents one project's material IDs, routes, enemies, or
  palettes as the generic AIR way.

## Project Kits

Project kits live with demos/products and may contain project-specific helpers:

- voxel cave lamps;
- demo palettes and material IDs;
- named arena parts;
- level routes;
- game-specific draw wrappers.

Reusable kits and project kits may depend on stdlib. Stdlib and Core must not
depend on kits.

## Promotion Rule

New behavior follows this path:

1. Demo-local implementation.
2. Project kit helper.
3. Generic extraction proposal.
4. Spec and ABI documentation.
5. Tests and verifier/audit coverage.
6. Stdlib promotion only after names and parameters are generic.

Core changes require proof that the feature is a verifier/lowering primitive
needed by multiple independent domains and cannot live in stdlib, manifest, or
host ABI.
