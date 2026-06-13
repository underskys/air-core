# AIR v0.12 Roadmap

Status: draft

Version target: v0.12

Theme: Package / Host Profiles / Data Ergonomics

v0.12 starts after the v0.11 Product/Demo Loop + Governance release. The release
has two concrete jobs:

1. make AIR packages machine-checkable against host profiles;
2. reduce generated AIR verbosity without turning AIR into a general-purpose
   dynamic scripting language.

The goal is stricter package correctness and better authoring ergonomics while
preserving verifier guarantees, strict Host ABI validation, explicit
capabilities, and public API hygiene.

Authoritative v0.12 planning documents:

- [V0_12_AI_LANGUAGE_CONTRACT.md](V0_12_AI_LANGUAGE_CONTRACT.md)
- [V0_12_PHASE_PLAN.md](V0_12_PHASE_PLAN.md)
- [FEATURE_STATUS_v0.12.md](FEATURE_STATUS_v0.12.md)
- [V0_12_NUMERIC_AND_CONSTRAINTS_POLICY.md](V0_12_NUMERIC_AND_CONSTRAINTS_POLICY.md)
- [V0_12_CONFORMANCE_MATRIX.md](V0_12_CONFORMANCE_MATRIX.md)
- [V0_12_STDLIB_HYGIENE_AUDIT.md](V0_12_STDLIB_HYGIENE_AUDIT.md)
- [V0_12_RELEASE_CHECKLIST.md](V0_12_RELEASE_CHECKLIST.md)
- [V0_12_RELEASE_GATE.md](V0_12_RELEASE_GATE.md)
- [AUDIO_AUTHORITY_v0.12.md](AUDIO_AUTHORITY_v0.12.md)
- [DEMO_STATUS_v0.12.md](DEMO_STATUS_v0.12.md)

## Scope

v0.12 focuses on:

- minimal `air.package.json` package manifests;
- host profiles;
- `package-check --profile`;
- package-local module resolver design;
- module-level immutable constants;
- numeric and constraints policy for generic Core/stdlib math;
- stdlib hygiene closure: pure deterministic backend-neutral resource-free
  helpers only;
- asset manifest validation;
- generated manifest-backed handles;
- static read-only scalar tables RFC;
- explicit audio authority/events RFC;
- sprite kit and rig manifest planning before any public sprite transform ABI;
- LSP MVP and live demo URL tracking as adoption blockers;
- LLM prompt library for reproducible prompt-to-module workflows.

v0.12 is not a broad public ABI expansion release. Demo features and product
requests must pass through request, RFC, spec, verifier, package-check/profile,
report, and test gates before promotion. New public Host ABI functions must
still go through spec, registry, verifier, SDK, reports, tests, and migration
notes.

## P0 Goals

| Goal | Status | Target outcome |
| --- | --- | --- |
| Minimal `air.package.json` manifest | active | Packages declare identity, ABI versions, entry, capabilities, target profiles, and manifests. |
| Host profiles | active | Hosts declare supported capabilities, imports, assets, manifests, limits, and diagnostics. |
| `package-check --profile` | active | Package requirements are compared against a selected host profile with deterministic text/JSON output. |
| Package-local module resolver design | experimental | Relative package-local imports are specified without remote imports, package manager, cycles, or hidden authority. First graph-analysis slice is v0.12 scoped; linked output remains gated. |
| Module-level immutable constants | active | Generated modules can replace repeated magic literals with reviewed compile-time names. |
| LSP-lite diagnostics and live demo URL tracking | adoption blocker | Reviewers can inspect AIR files, consume machine-readable diagnostics, and access a stable live browser demo path. |

## P1 Goals

| Goal | Status | Target outcome |
| --- | --- | --- |
| Asset manifest validation | active | Package-local sprites, audio, models, shaders, textures, materials, and rigs validate with explicit fallback behavior. |
| Generated manifest-backed handles | active | Package-local generated AIR helper modules reduce magic `i32` handles without adding language enums. |
| Static read-only scalar tables RFC | RFC | Fixed compile-time scalar tables are designed for generated data without dynamic arrays or objects. |
| Audio authority/events RFC | RFC | `debug.metric` remains diagnostic; explicit audio events and manifest authority are designed before ABI change. |
| Sprite kit + rig manifest | RFC/planning | 2D sprite transforms are routed through kits/manifests before any public `gfx.draw_sprite_transform` ABI. |
| LLM prompt library | planning | Checked-in prompt fixtures document reproducible AI-generated module workflows. |

## Milestones

| Milestone | Name | Scope | Acceptance |
| --- | --- | --- | --- |
| M1 | Package Manifest | Define and validate minimal `air.package.json`. | Valid sample passes; missing entry, unknown capability/profile, and path traversal fail. |
| M2 | Host Profiles | Define machine-readable host profile JSON. | Known profiles validate; unknown profile fails clearly; reports can include selected profile. |
| M3 | `package-check --profile` | Compare package requirements with host support. | CLI and JSON reports show capabilities, host imports, manifests, assets, warnings, and errors. |
| M4 | Module Resolver RFC / Minimal Design | Specify package-local split modules. | Relative imports only, package-local files only, no cycles, exported-only calls, capability union, effect budget composition, deterministic linked output. |
| M5 | Module Constants | Implement and stabilize module-level immutable scalar constants. | Parser, formatter, verifier, lowering, audit, explain, and report surfaces remain deterministic. |
| M6 | Asset Manifest / Generated Handles | Validate assets and generate package-local handle modules. | Assets are package-local; fallbacks explicit; generated handles deterministic and stale drift detectable. |
| M7 | Static Tables / Audio / Sprite RFCs | Design next ergonomics and media authority work. | RFCs keep dynamic objects, hidden audio authority, and demo-specific GFX ABI out of v0.12 implementation by default. |
| M8 | LSP-lite / Live Demo / Prompt Library | Remove adoption blockers. | AIR files are easier to inspect; machine-readable diagnostics are available for editor/AI repair loops; live demo URL is tracked; prompt fixtures are reproducible and offline. |

## Package Correctness

The package side of v0.12 should answer these questions deterministically:

- what module is the package entry point?
- what AIR ABI and Host ABI versions are expected?
- what capabilities does the package require?
- what host imports does the AIR module actually use?
- what manifests and assets are referenced?
- what target profiles are expected?
- what selected host profile supports or rejects the package?
- what diagnostics explain unsupported features?

Core references:

- [AIR package manifest](../spec/AIR_PACKAGE_MANIFEST.md)
- [Host profiles](../spec/HOST_PROFILES.md)
- [Asset manifest](../spec/ASSET_MANIFEST.md)
- [PACKAGE_CHECK_v0.12_PLAN.md](PACKAGE_CHECK_v0.12_PLAN.md)
- [RFC_PACKAGE_MANIFEST_v0.12.md](RFC_PACKAGE_MANIFEST_v0.12.md)
- [RFC_HOST_PROFILES_v0.12.md](RFC_HOST_PROFILES_v0.12.md)

## Data Ergonomics

The data ergonomics side of v0.12 addresses the generated AIR "farsh" problem:
large modules filled with repeated SSA-like constants, magic `i32` handles, and
monolithic files.

Accepted direction:

- prefer compile-time names over repeated magic literals;
- prefer generated package-local handles over stdlib pollution;
- prefer package-local module split over one huge generated file;
- prefer manifest-backed resources over backend object handles;
- keep verifier/audit visibility for every new convenience;
- keep sizes and authority explicit.

Relevant RFCs:

- [RFC_CORE_MODULE_CONSTANTS_v0.12.md](RFC_CORE_MODULE_CONSTANTS_v0.12.md)
- [RFC_CORE_STATIC_TABLES_v0.12.md](RFC_CORE_STATIC_TABLES_v0.12.md)
- [RFC_CORE_MODULE_SPLIT_v0.12.md](RFC_CORE_MODULE_SPLIT_v0.12.md)
- [RFC_CORE_GENERATED_DATA_v0.12.md](RFC_CORE_GENERATED_DATA_v0.12.md)
- [RFC_CORE_FIXED_DATA_STRUCTURES_v0.12.md](RFC_CORE_FIXED_DATA_STRUCTURES_v0.12.md)

## Media And GFX Governance

v0.12 should continue the v0.11 rule: demo pressure is evidence, not direct ABI
authority.

For audio:

- `debug.metric` remains diagnostic;
- audio authority must be explicit;
- audio assets do not grant playback authority;
- existing `audio.beep`, `audio.play_tone`, and `audio.set_gain` are direct
  AIR audio imports and require `audio` capability;
- explicit `audio.event` ABI remains RFC-gated/deferred unless promoted through
  spec, registry, verifier, profile, report, and tests.

For sprites:

- sprite transforms should be evaluated through sprite kit and rig manifest
  design before any public GFX ABI addition;
- project-specific body parts, enemy/player semantics, scoring, and art assets
  remain project-local.

Relevant documents:

- [RFC_AUDIO_EVENTS_v0.12.md](RFC_AUDIO_EVENTS_v0.12.md)
- [RFC_AUDIO_AUTHORITY_v0.11.md](RFC_AUDIO_AUTHORITY_v0.11.md)
- [RFC_GFX_SPRITE_TRANSFORM_v0.12.md](RFC_GFX_SPRITE_TRANSFORM_v0.12.md)
- [RFC_ASSET_MANIFEST_v0.12.md](RFC_ASSET_MANIFEST_v0.12.md)

## Target Packaging Relationship

Target packaging is planned, but it is not the primary implementation goal of
this v0.12 start scope.

AIR does not directly compile to one universal standalone binary. AIR produces
verified portable packages. Target-specific deliverables combine AIR packages
with host runtimes.

Pipeline:

```text
AIR source
-> verifier
-> WASM / AIR module
-> AIR package
-> target bundle
-> deployable artifact
```

See [TARGET_PACKAGING_MODEL.md](TARGET_PACKAGING_MODEL.md). Future `airc bundle`
commands remain design targets until package manifests, host profiles, and
compatibility checks are stable.

## Adoption Blockers

### LSP-Lite MVP

LSP-lite is the early adoption blocker, before a full language server. It
should make AIR files easier to review, edit, and repair:

- parse diagnostics;
- verifier diagnostics;
- machine-readable diagnostic ranges and repair hints;
- hover for capabilities/imports when practical;
- go-to definition for package-local modules when resolver work exists;
- formatting integration.

This is an adoption blocker because generated AIR must be reviewable by humans,
not only by test scripts.

Full LSP behavior can remain later, but basic diagnostics/editor integration
should not wait until near-1.0 because the AI repair loop depends on stable
machine-readable diagnostics.

### Live Demo URL Tracking

The live/browser demo path must have a documented URL or release location once
available. The roadmap should track:

- current deploy source;
- host profile used;
- package checked;
- conformance report shown;
- WebGPU unavailable behavior.

### LLM Prompt Library

Prompt fixtures should stay offline and deterministic:

- prompt-like input;
- generated `.air` fixture;
- verifier/audit/report output;
- repair guidance;
- no live LLM API dependency.

## Non-Goals

- No random public `gfx.*` ABI growth.
- No Unity adapter implementation.
- No Godot adapter implementation.
- No full package registry.
- No target packaging implementation yet.
- No real network scanner ABI.
- No dynamic objects.
- No garbage collection.
- No generics.
- No async language model.
- No demo-specific stdlib helpers.
- No weakening verifier guarantees.
- No hidden capability escalation through imported modules, manifests, assets,
  generated handles, or debug metrics.

## Compatibility

Keep v0.10/v0.11 examples compatible where practical.

When compatibility cannot be preserved, v0.12 changes must include:

- migration notes;
- report/schema version notes;
- package-check diagnostics;
- clear separation between AIR ABI, Host ABI, package schema, and roadmap
  milestone version.
