# AIR Agent Contract

AIR is developed with AI agents. Agents MUST preserve the architectural boundary
of the repository.

## Naming

Project name: AIR.

AIR stands for AI Intermediate Representation.

Preferred terms in new public-facing text:

- AIR
- AIR Core
- AIR module
- AIR Stdlib
- AIR Host ABI
- `.air`
- `airc`

AirLang is a legacy/internal development name. Avoid AirLang in new
public-facing text except when discussing legacy or historical context. Do not
perform broad mechanical rename work unless explicitly requested as a separate
task.

Read these first:

- [AIR Change Workflow](docs/CHANGE_WORKFLOW.md): required Codex/agent
  preflight, scope declaration, checks, commit, review bundle, and handoff
  workflow.
- [AIR Layer Manifest](spec/AIR_LAYER_MANIFEST.md): authoritative layer
  definitions and promotion path.
- [AIR Platform Contract](spec/AIR_PLATFORM_CONTRACT.md): product thesis and
  platform positioning.
- [Public API Hygiene](docs/PUBLIC_API_HYGIENE.md): public-surface promotion
  rules and stdlib contamination checks.
- Relevant ABI/spec files for the area being changed.

## Operational Rules

Agents MUST follow the [AIR Change Workflow](docs/CHANGE_WORKFLOW.md) before
editing files, before committing, and before creating review bundles.

Agents MUST:

- keep AIR Core small and verifier-focused;
- put demo/product-specific helpers in Project Kits, not stdlib;
- keep public AIR surfaces generic, backend-neutral, and resource-free unless
  they live in an explicit kit;
- keep host objects out of AIR source and ABI values;
- declare all host authority through capabilities;
- update specs, verifier/audit coverage, and tests when behavior changes;
- keep checked-in `.air` examples in canonical formatted multiline form.

Agents MUST NOT:

- add a Core feature for one demo bug;
- put demo material IDs, palettes, cave/lamp/arena helpers, resource paths, or
  named game objects into stdlib;
- mix `gfx.*` and `gpu.*` in one example unless the host/spec documents the
  bridge;
- add silent capabilities or hidden host authority;
- change host ABI signatures without synchronized specs, verifier checks, and
  tests.

## Red Flags

Pause and reclassify the change when a helper:

- mentions a specific demo, visual style, object name, material handle, route,
  palette, or asset key;
- reaches for DOM/WebGPU/Metal/Vulkan/socket/file-handle objects inside AIR;
- makes stdlib depend on a Project Kit;
- duplicates a rule already defined in the Layer Manifest.

## Required Checks

After changing AIR, stdlib, specs, examples, demos, or host ABIs, run relevant
checks:

- `npm test`;
- verifier on changed `.air` files;
- `verify --library` for stdlib and project-local library modules;
- `gfx-check` / `app-check` for graphics packages;
- `node test/layer_guard.test.js` when stdlib, kits, examples, or demos change;
- snapshot/smoke tests when review bundles or demos change;
- formatting and `git diff --check`.

Merge summaries should state which layer changed: Core, Stdlib, Project Kit,
Host ABI, Manifest, Host, or Demo.
