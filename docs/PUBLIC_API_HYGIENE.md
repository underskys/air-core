# AIR Public API Hygiene

This document defines what counts as public AIR surface and how code may be
promoted between repository layers. It exists to prevent AI agents and human
contributors from accidentally turning demo code into public language API.

For authoritative layer definitions, see
[AIR Layer Manifest](../spec/AIR_LAYER_MANIFEST.md). This document is the
practical review checklist for public API hygiene.

## Public Surfaces

- `core/` and `src/`: language implementation, verifier, parser, lowering,
  registries, package tooling, and SDK internals.
- `stdlib/`: stable generic AIR library modules. Stdlib is public surface that
  external users and AI agents may copy as canonical AIR style.
- `kits/`: reusable optional packages. Kits may include resources and starter
  manifests, but they are not AIR Core and not stdlib.
- `examples/`: learning references and conformance fixtures. Examples teach
  usage, but example-only helpers are not standard ABI.
- `demo/`: project-specific applications, games, experiments, palettes,
  material handles, routes, shaders, and art direction.
- `hosts/`: platform adapters. Hosts implement browser, native, OS, GPU, UI,
  network, filesystem, audio, and other platform behavior behind capability
  ABIs. Host code is not AIR Core or stdlib.

If external users would reasonably copy a file as “the AIR way,” treat it as
public surface and keep it generic.

## Promotion Rules

Promotion is one-way and evidence-based:

1. `demo/` -> `kits/`
   - Allowed only when the code/resource is project-neutral and reusable outside
     the original demo.
   - Remove named game objects, material handles, palettes, lore, scene routes,
     asset names, and gameplay assumptions before promotion.
   - Keep the original demo behavior in `demo/`; the kit must expose only the
     reusable convention, resource fragment, fixture, or host-facing setup.
   - If the extraction needs new public imports or manifest fields, file an ABI
     request/RFC instead of adding them from the kit.

2. `kits/` -> `stdlib/`
   - Allowed only when the helper is pure AIR, deterministic, backend-neutral,
     resource-free, and broadly useful.
   - Stdlib entries must not require shader files, texture paths, manifest
     fragments, host objects, or a specific renderer.
   - See [Stdlib Policy](STDLIB_POLICY.md) for accepted/rejected examples and
     the `stdlib/grid.air` hygiene rules.

3. `stdlib/` -> Core
   - Allowed only when the behavior is required by verifier or language
     semantics and cannot live as a library helper, manifest field, or host ABI.
   - A Core promotion must include spec, verifier, lowering, formatter, audit,
     and tests where applicable.

Never promote directly from `demo/` to Core.

`examples/` are not a shortcut around this path. An example may teach a pattern
or provide a conformance fixture, but example-local helper code is not public
ABI, not Core syntax, and not stdlib. Promote from an example only after the
target layer is explicit and the same evidence/spec/test requirements are met.

## Examples And Kits

Treat `examples/` and `kits/` as public-facing surfaces with separate rules:

- `examples/` teach documented behavior. They may include concrete assets,
  manifests, scripts, and reports, but they must not rely on undocumented host
  imports or imply new language semantics.
- `kits/` provide optional reusable starter resources and conventions. They may
  include shaders, material fragments, manifests, fixture assets, and glue code
  that would not be allowed in `stdlib/`.
- Neither `examples/` nor `kits/` may add public Host ABI functions, Core syntax,
  verifier semantics, or package behavior without the same request/spec/test
  process required everywhere else.
- Demo-derived examples and kits must strip project names, material IDs, routes,
  palettes, named objects, enemy/weapon rules, and art direction before they are
  treated as reusable.
- When a pattern is still tied to one project, keep it in `demo/` or mark it as
  `project kit`.

Accept:

- a generic GFX fixture showing GLB loading through `.airgfx.json`;
- a reusable unlit shader kit with documented handles and fallback behavior;
- a side-scroller example that demonstrates world coordinates, viewport camera,
  and activation windows using existing `input.*`, `gfx.*`, or `gpu.*`.

Reject:

- a demo level script moved into `examples/` to make it look generic;
- a kit that hides a new undocumented host function;
- a stdlib helper promoted from an example while still containing material IDs,
  palettes, routes, or gameplay terms.

## Anti-Rules

Do not put any of the following in `stdlib/`:

- project aesthetics, palettes, named visual themes, or lore;
- shader/resource files such as `.wgsl`, `.glb`, `.gltf`, `.png`, `.jpg`,
  `.jpeg`, `.svg`;
- backend-specific manifest fragments or renderer resource packs;
- demo material handles, material slot IDs, arena routes, cave/lamp helpers,
  pickup/teleporter/jump-pad semantics, or named game objects;
- project-specific concepts such as named materials, named skyboxes, arena
  gates, jump pads, teleport pads, demo routes, or game-specific visual themes;
- example-only APIs presented as standard ABI.

Do not expose host objects through AIR:

- no DOM nodes;
- no WebGPU/Metal/Vulkan/Direct3D objects;
- no sockets, OS file handles, subprocess handles, or platform pointers.

AIR calls scalar, pointer/length, and handle-style ABIs. Hosts own real platform
objects.

## PR Checklist

Before submitting or reviewing a change, answer:

- Is this generic across more than one project or demo?
- Is this backend-neutral?
- Does it contain file paths, assets, shaders, material presets, or manifest
  fragments?
- Does it reference a demo, game, palette, material handle, route, or named
  object?
- Would external users or AI agents copy this accidentally as public AIR style?
- Does the change belong in `demo/`, `examples/`, `kits/`, `stdlib/`, Host ABI,
  or Core?
- If it changes public ABI, were specs, registry, verifier/audit behavior, and
  tests updated together?

When the answer is unclear, keep the code in `demo/` or `examples/` until it has
proven reusable shape.

## Enforcement

The layer guard test [test/layer_guard.test.js](../test/layer_guard.test.js)
fails when public AIR surfaces contain resource files, backend resource
directories, demo/project API names, game-role API names, material/asset IDs as
standard semantics, route/level/art-direction names, or host objects exposed as
AIR handles.

The guard scans `stdlib/`, public Core/tooling names, Host ABI registry names,
host profile imports, selected specs, public schema docs, and canonical example
identifiers. Docs may still discuss rejected examples, migration notes, and
demo request evidence, but those examples must not become public API names.

It is intentionally conservative where a file defines public surface: if a
helper has art direction, shader paths, texture paths, material presets, demo
semantics, or host object handles, it is not Core, stdlib, or public Host ABI.

Run:

```sh
node test/layer_guard.test.js
npm test
```

The guard is not a substitute for review. It catches common leaks; reviewers
must still apply the promotion rules above.
