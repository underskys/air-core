# ABI Request Pipeline

External demos and project kits may generate request markdown files when they
hit missing higher-level AIR ABI, manifest, kit, or host needs. These
requests are input to ABI triage, not automatic ABI changes.

The purpose of this pipeline is to collect real demo pressure without letting
project-specific concepts leak into AIR Core, stdlib, or public host ABIs.

Formal decisions live in `../../requests/`. This directory records source
pressure; the request ledger records accepted, rejected, archived, or inbox
status. Public release checks fail if a non-README pressure file here has no
matching ledger entry.

## Formal Ledger Decisions

Every source pressure document in this directory maps to at least one formal
ledger entry. The ledger entry is the decision surface; the source document is
pressure evidence only.

| Source pressure doc | Formal request entries |
| --- | --- |
| [AIRON Platformer Pressure](airon-platformer-pressure.md) | [Executable Package Composition](../../requests/accepted/executable-package-composition.md), [Static Tables And Readonly Tablegroups](../../requests/accepted/static-tables-tablegroups.md), [Bounded Mutable Storage](../../requests/accepted/bounded-mutable-storage.md), [Resource Validators And ReviewPolicy Hard Gates](../../requests/accepted/resource-validators-reviewpolicy.md), [AIRON Platformer-specific APIs](../../requests/rejected/airon-platformer-specific-apis.md) |
| [AirDoom](airdoom.md) | [AirDoom Project Kit Requests](../../requests/rejected/airdoom-project-kit.md) |
| [Contra Platformer](contra-platformer.md) | [Generated Handle Freshness](../../requests/accepted/generated-handle-freshness.md), [Contra Platformer Game APIs](../../requests/rejected/contra-platformer-game-apis.md), [Audio Event Host ABI](../../requests/rejected/audio-event-host-abi.md), [Sprite And Modular Actor ABI](../../requests/rejected/sprite-modular-actor-abi.md) |
| [Core Data Ergonomics](core-data-ergonomics.md) | [Static Tables And Readonly Tablegroups](../../requests/accepted/static-tables-tablegroups.md), [Generated Handle Freshness](../../requests/accepted/generated-handle-freshness.md) |
| [Fixed Bounded State Segment](fixed-bounded-state-segment.md) | [Bounded Mutable Storage](../../requests/accepted/bounded-mutable-storage.md), [Pixel Buffer Kernel ABI](../../requests/rejected/pixel-buffer-kernel-abi.md), [Public Demo Migration Debt](../../requests/accepted/public-demo-migration-debt.md) |
| [FlowDesk Air](flowdesk-air.md) | [Chrome Extension Host ABI](../../requests/rejected/chrome-extension-host-abi.md), [Event And Output Intent Surface](../../requests/accepted/event-intent-surface.md), [Static Tables And Readonly Tablegroups](../../requests/accepted/static-tables-tablegroups.md) |
| [GFX Showcase](gfx-showcase.md) | [GFX Showcase New ABI](../../requests/rejected/gfx-showcase-new-abi.md) |
| [Network Scanner](network-scanner.md) | [Network Scanner Host ABI](../../requests/rejected/network-scanner-host-abi.md), [lan-observer-style Readonly Consumer Proof](../../requests/accepted/lan-observer-readonly-proof.md) |
| [UI Dashboard](ui-dashboard.md) | [UI Dashboard New Host ABI](../../requests/rejected/ui-dashboard-new-host-abi.md), [Event And Output Intent Surface](../../requests/accepted/event-intent-surface.md) |
| [Voxel Demo](voxel-demo.md) | [Voxel Demo Game APIs](../../requests/rejected/voxel-demo-game-apis.md), [Static Tables And Readonly Tablegroups](../../requests/accepted/static-tables-tablegroups.md) |

Current pressure request examples include:

- [FlowDesk Air](flowdesk-air.md): non-game Chrome extension pressure for
  bounded facts, structured data, and future command/output evidence.
- [Fixed Bounded State Segment](fixed-bounded-state-segment.md): bounded
  simulation pressure for persistent AIR-owned scalar state without dynamic
  collections or host authority.
- [AIRON Platformer Pressure](airon-platformer-pressure.md): platformer demo
  pressure for authored package composition, tablegroups, declared pools, and
  resource validation without granting demo authority to Core.

## Lifecycle

- `proposed`: Request has been filed, but no layer or implementation decision
  has been made.
- `accepted`: Request describes a generic need and is approved for a target
  layer, pending implementation.
- `rejected`: Request is not appropriate for AIR public surfaces or is
  already solved by existing APIs.
- `kit-only`: Request is reusable, but belongs in a reusable kit rather than
  Core, stdlib, or host ABI.
- `project-only`: Request is specific to one demo/project and must remain in
  that project kit or host.
- `implemented`: Approved request has shipped with docs, tests, and any
  required migration notes.

## Target Layers

- `core`: AIR syntax, verifier, lowering, effects, contracts, memory, or other
  portable IR semantics.
- `stdlib`: deterministic, backend-neutral, resource-free AIR helper modules.
- `host ABI`: capability-qualified import families implemented by hosts.
- `manifest schema`: package data such as assets, render graphs, UI resources,
  input bindings, collision metadata, or conformance metadata.
- `reusable kit`: optional reusable resources, shaders, materials, examples, or
  starter manifests.
- `project kit`: demo/product-local behavior, assets, material IDs, routes,
  palettes, named objects, or gameplay semantics.
- `host implementation`: browser/native/tool runtime behavior behind existing
  ABI or manifest contracts.

## Triage Rules

- Demo-generated requests are input to ABI triage, not automatic ABI changes.
- Request files are evidence, not authority. Agents must follow
  [AIR Agent Contract](../../AGENTS.md),
  [AIR Layer Manifest](../../spec/AIR_LAYER_MANIFEST.md), Public API Hygiene,
  and the relevant ABI/spec files when deciding whether any public surface may
  change.
- Demo worktrees may be active on other machines or under other agents. Treat
  demo source as read-only during ABI triage unless the user explicitly asks for
  demo implementation work.
- For demo-originated requests, read only documentation and request files by
  default: `README.md`, `request.md`, `requests.md`, `IMPLEMENT*.md`,
  `*AUDIT*.md`, and relevant specs/policies.
- A request must explain why the proposed API is generic across projects.
- If the request contains demo names, material handles, routes, palettes, level
  geometry, or named game objects, default to `project-only`.
- Prefer `host implementation`, `manifest schema`, `reusable kit`, or
  `project kit` before promoting anything into `stdlib` or `core`.
- Public ABI changes require matching specs, verifier/registry coverage where
  applicable, tests, and migration notes for any compatibility risk.
- An accepted request does not by itself approve a public ABI change; it only
  records a triage decision that must still satisfy the repository contracts and
  specs.
- Rejected requests should say what existing API, kit, manifest field, or host
  behavior should be used instead.

## Required Context Review

Before accepting or implementing any request, compare it against the current
architecture docs:

- [AIR Agent Contract](../../AGENTS.md)
- [AIR Layer Manifest](../../spec/AIR_LAYER_MANIFEST.md)
- [Public API Hygiene](../PUBLIC_API_HYGIENE.md)
- [AIR Platform Contract](../../spec/AIR_PLATFORM_CONTRACT.md)
- relevant ABI/spec files for the requested layer
- the source demo/project `README.md`, `request.md` or `requests.md`, and any
  local `IMPLEMENT*.md` / `*AUDIT*.md` notes

If those documents disagree with the request, record the conflict in the
decision section instead of changing public ABI.

## Request Template

```markdown
# <Title>

## Request: <Short request name>

Status: proposed
Decision: proposed
Source demo/project: <Project name, repository/path, branch, and contact/context if useful.>
Target layer: <core | stdlib | host ABI | manifest schema | reusable kit | project kit | host implementation>
Version target: <v0.11 | v0.12 | future>

## Problem

<What cannot be expressed or run cleanly today?>

## Current Workaround

<What the demo does now, including any host-specific or project-specific code.>

## Proposed Generic API

<The smallest generic API, manifest field, kit helper, or host behavior being requested.>

## Why Generic

<Why this applies beyond the source demo/project.>

## Why Not Project-Specific

<Why this should not remain in the project kit or host adapter.>

## Alternatives

<Existing APIs, manifest fields, kit helpers, host implementations, or project-only options considered.>

## Compatibility Risk

<Impact on v0.10 examples, public ABI, manifests, hosts, SDKs, and reports.>

## Non-goals

<What must not be implemented as part of this request.>

## Verifier impact

<No impact, or exact verifier behavior required.>

## Host ABI registry impact

<No impact, or exact registered public host signatures required.>

## Manifest / package impact

<No impact, or exact manifest/package/report behavior required.>

## Conformance tests

<Required tests, fixtures, commands, and unsupported-path checks.>

## Acceptance criteria

<Concrete pass/fail criteria.>

<Decision notes, owner, required docs/tests/specs, and migration notes.>
```

## Agent Handling

When an AI agent sees a `request.md` from a demo:

- read the demo request/README/implementation notes, but do not edit demo code
  while working in Core triage mode;
- copy or summarize the request into this format before proposing
  implementation;
- check the required context docs before deciding the layer;
- classify the target layer before changing code;
- keep demo-specific terms out of Core, stdlib, and public ABI;
- ask for human triage when the generic/project boundary is unclear or when a
  request conflicts with `AGENTS.md` or the relevant specs;
- do not implement new ABI functions until a request is accepted for a public
  target layer and the required specs, verifier/audit coverage, tests, and
  migration notes are in scope.
