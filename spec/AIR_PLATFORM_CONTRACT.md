# AIR Platform Contract v0.10

## North Star

AIR is a compact verified IR for AI-authored modules that compile to Wasm
and interact with hosts through capability-scoped scalar ABIs.

AIR exists to provide an optimized, deterministic code space for AI-generated
programs. AI writes small modules, AIR verifies and audits them, hosts run them
inside explicit capability boundaries, and humans decide whether the formatted
IR, contracts, manifests, and test output are acceptable.

AIR is not a Unity clone, not a JavaScript framework, and not a general
replacement for Rust, Zig, C, Python, or TypeScript. Those remain better for
large human-authored systems. AIR should win where the useful unit is a small
sandboxed plugin, visual behavior module, utility transform, simulation rule,
UI panel, policy, automation, or host-controlled scene logic that AI can
generate repeatedly with low ambiguity.

## Platform Boundary

AIR owns deterministic behavior: gameplay rules, procedural generation,
simulation state, controller logic, fixed math, scalar policy decisions,
effect-limited host calls, render/UI command emission, and debug metrics.

Hosts own real platform work: windows, DOM, WebGPU/WebGL/Metal/Vulkan/Direct3D,
filesystem, network stack, audio device, input devices, timers, entropy, asset
loading, shader compilation, GPU resource creation, and actual rendering.

Manifests own package data: assets, materials, meshes, render graphs, collision
metadata, UI resources, input bindings, quality profiles, and target platform
profiles.

The authoritative layer definitions, Project Kit rules, Host ABI rules,
Manifest rules, and promotion path live in [AIR Layer Manifest](AIR_LAYER_MANIFEST.md).

## Principles

- **Portability:** AIR source should not change when moving between browser and
  native hosts if the host implements the same ABI and manifest contract.
- **Performance:** AIR should stay small, deterministic, and cheap to verify.
  Heavy work belongs in hosts, shaders, native systems, precomputed assets, or
  generated tables.
- **Security:** every host interaction must be declared by capability, and
  every nontrivial resource use should be visible through effects, manifests,
  or audit reports.
- **AI generation:** prefer scalar parameters, fixed handles, bounded loops,
  clear module boundaries, deterministic helpers, explicit effects, and
  repairable diagnostics.

Avoid implicit host state, dynamic object models, ad hoc strings, hidden global
authority, ambiguous names, and overloaded domain-specific helpers.

## Review Contract

Every merge that changes AIR, stdlib, specs, examples, demos, or host ABIs
should answer:

- Which layer changed?
- Does the change make AI generation more deterministic or less ambiguous?
- Does it preserve a small Core?
- Are capabilities and effects explicit?
- Can a human review the formatted `.air` and audit output?
- Does a verifier, manifest validator, or test reject the obvious bad form?

This keeps AIR focused: a compact AI-first IR plus strict contracts, not a pile
of demo code inside the language.
