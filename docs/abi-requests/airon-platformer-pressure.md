# AIRON Platformer Pressure Request:
# Authored Package Composition, Tablegroups, Declared Pools, and Resource Validation

Status: proposed / pressure evidence

Target: v0.31+ architecture and request triage input

Formal ledger decisions:
[Executable Package Composition](../../requests/accepted/executable-package-composition.md),
[Static Tables And Readonly Tablegroups](../../requests/accepted/static-tables-tablegroups.md),
[Bounded Mutable Storage](../../requests/accepted/bounded-mutable-storage.md),
[Resource Validators And ReviewPolicy Hard Gates](../../requests/accepted/resource-validators-reviewpolicy.md),
and [AIRON Platformer-specific APIs](../../requests/rejected/airon-platformer-specific-apis.md).

## Purpose

Capture AIRON platformer pressure without treating the demo as AIR Core
authority. AIRON is evidence for generic package, data, resource, and host
interaction pressure. It does not approve Core features, Host ABI changes,
stdlib helpers, or demo-specific APIs.

Demo-specific behavior remains demo-local. Core work must not be implemented by
patching from the demo.

## Request: AIRON platformer pressure

Status: proposed
Decision: proposed / pressure evidence only
Source demo/project: AIRON platformer demo pressure
Target layer: core
Version target: v0.31+ pressure evidence

## Problem

AIRON is creating repeat pressure that is not cleanly addressed by one existing
surface:

- generated flattened source hides authored module composition pressure;
- table-like data and slot families create warnings instead of a canonical
  bounded metadata/tooling path;
- mutable pool-like state is hard to distinguish from uncontrolled global
  growth in review policy;
- resource freshness and quality checks are package/tooling concerns, but their
  evidence currently appears as demo-local workflow pressure;
- `debug.metric` can be misused as an event-like path if package policy does
  not clearly reject it.

The generic problem is not platformer gameplay. The generic problem is how AIR
should route authored package composition, bounded table-like metadata,
declared fixed-capacity pools, package resource validation, and host-policy
assertion pressure without adding demo-specific Core APIs or host authority.

## Current Workaround

The current workaround is demo-local:

- authored modules are flattened into generated `game/platformer.air`;
- table-like data remains encoded through generated AIR patterns and warnings;
- fixed-capacity slot families remain ordinary mutable globals from the Core
  perspective;
- asset and resource repair workflows live in local demo tooling;
- host/browser behavior remains outside AIR Core;
- `debug.metric` remains diagnostic-only and must not become an event bus.

This preserves AIR boundaries, but leaves useful generic pressure for future
RFCs and package-check hardening.

## Why Generic

The pressure is generic only after stripping AIRON vocabulary and gameplay:

- authored package composition applies to non-game packages with generated and
  authored modules;
- tablegroups with equal-length and bounds verification apply to bounded facts,
  dashboards, simulations, and policy data;
- declared fixed-capacity pools apply to bounded state machines and simulations
  if they remain scalar, fixed, and verifier-visible;
- resource freshness and quality validation applies to package manifests and
  generated artifacts;
- mock-host command-buffer policy assertions apply to bounded output intent
  verification.

The request is not generic if it contains player/enemy/boss semantics, platformer
water rules, sprite vocabulary, browser UI behavior, or project-local asset
repair workflows.

## 1. Current Evidence

Observed AIRON pressure includes:

- package-check status: `warn`;
- generated handles are current;
- runtime asset manifest passes;
- `browser-webgpu` profile is compatible;
- linked multi-module Wasm output remains deferred for this demo;
- generated game source is flattened into `game/platformer.air`;
- frame logic is large;
- mutable globals are over budget;
- select-chain-as-table warnings appear;
- table-like and slot-family warnings appear;
- `debug.metric` produces event-like warnings when used as a signaling path.

These are review and architecture signals. They do not imply that AIRON
vocabulary, gameplay rules, asset behavior, or browser host behavior belongs in
Core.

## 2. Generic Core / Platform Pressure

The generic pressure is:

| Pressure | Candidate layer | Notes |
| --- | --- | --- |
| Executable package composition from authored modules | Future Core/platform milestone | AIRON wants authored modules to compose into executable package output without flattening everything into one generated file. This is separate from demo gameplay. |
| Tablegroups with equal-length and bounds verification | v0.31 Bounded Structured IO RFC / future Core candidate | AIRON table-like data pressure should feed tablegroup design only as fixed, scalar, bounded metadata or source ergonomics. It must not become an object model. |
| Declared fixed-capacity mutable pools / slot groups | Future PRO-gated Core milestone | Slot-family pressure is generic only if expressed as fixed-capacity scalar pools with verifier-visible bounds, not dynamic entities or GC. |
| Package-check resource freshness and quality validators | Package tooling | Resource freshness, generated handle checks, asset manifest quality, and deterministic validation can harden package-check without changing language semantics. |
| `reviewPolicy` trend gates with declared-pool/static-data awareness | Report/review tooling | Trend gates can distinguish declared bounded pools and static data from unreviewable slop. |
| LSP-lite support for AIR data tables and generated handles | LSP/tooling | Useful if diagnostics remain grounded in existing schemas, generated handles, and package-check. |
| Generic capability-gated output/event mechanism | Future Host ABI RFC only | AIRON pressure does not approve output/event imports. Any promotion requires independent domains, policy, conformance, and ABI review. |
| Mock-host command-buffer policy assertions | Conformance/tooling | Useful for proving host policy decisions over bounded scalar intents without automatic host-side action execution. |

## 3. Candidate Kit / RFC Pressure

These items may be reusable, but they should route through kits, manifests, or
separate RFCs before any Core or Host ABI discussion:

- manifest-backed sprite, rig, and presentation contract;
- richer audio/music event convention;
- visual layer, material, and transform convention;
- editor-facing AIR data schema and round-trip support.

These are not accepted Core semantics. They are candidates for reusable kit
docs, package manifests, host implementation conventions, or future RFCs.

## 4. Demo-Local Only

The following must remain demo-local or project-kit local:

- AIRON art style;
- player, enemy, and boss sprites;
- platformer water behavior;
- Contra-like `draw_actor` API;
- boss bullet-hell API;
- level design and pacing;
- asset slicing and contact sheets;
- Vite, Canvas, and browser UI;
- local editor server;
- Playwright smoke screenshots;
- `pngjs`-based repair tools.

These are valid project assets and workflows, but they are not AIR Core, stdlib,
or Host ABI evidence by themselves.

## 5. Rejected as Direct Core

The following are rejected as direct Core additions:

- `draw_actor`;
- `draw_contra_enemy`;
- platformer-specific water API;
- boss-specific projectile API;
- dynamic host object handles for game entities;
- GC or dynamic maps for projectile pools;
- hidden host gameplay authority;
- `debug.metric` as an event bus;
- demo-specific stdlib helpers.

If a future generic mechanism covers related pressure, it must use neutral
terminology, verifier-visible bounds, package-check/report visibility,
conformance evidence, and existing authority boundaries.

## 6. Routing / Roadmap Impact

Recommended routing:

- v0.31 Bounded Structured IO RFC should include AIRON tablegroup pressure.
- v0.32 Bounded Structured IO first slice may include readonly tablegroup
  metadata/tooling if accepted.
- Executable package composition is a separate future Core/platform milestone.
- Declared fixed-capacity pools are a separate future PRO-gated milestone.
- Resource validators can be package-check hardening, not language semantics.
- Sprite, rig, and presentation contracts remain kit/RFC pressure, not Core
  Host ABI.

## Non-goals

This request does not:

- implement AIRON features;
- change AIR ABI;
- change Host ABI;
- add `output.event`, `audio.event`, or `effect.event`;
- add tablegroup implementation;
- add declared pool implementation;
- add game-specific Core APIs;
- add raw host authority;
- authorize demo-specific stdlib helpers.

## Compatibility Risk

The request is low risk as pressure evidence. Risk becomes high if demo
vocabulary or project behavior is promoted directly into Core, stdlib, or Host
ABI. Any future implementation must pass the normal architecture gates,
package-check/report/evidence requirements, negative tests, and ABI review.

## Alternatives

- Keep all AIRON pressure demo-local.
- Route sprite, rig, visual layer, material, and editor workflow pressure to
  reusable kits or manifest RFCs.
- Route resource freshness and generated artifact validation to package-check
  hardening.
- Route command-buffer policy assertions to conformance/mock-host tooling.
- Route tablegroups and bounded structured data pressure to the v0.31 Bounded
  Structured IO RFC.
- Route declared fixed-capacity pools to a separate future PRO-gated milestone.

## Verifier impact

No verifier impact in this request. Future accepted Core work would need
separate verifier obligations for equal-length tablegroups, fixed row bounds,
declared pool capacity, scalar-only fields, budget accounting, and rejection of
dynamic maps, GC, object handles, and event-bus misuse.

## Host ABI registry impact

No Host ABI registry impact. This request does not add `output.event`,
`audio.event`, `effect.event`, platformer draw imports, sprite imports, browser
authority, or host object handles. Any future generic output/event mechanism
requires a separate Host ABI RFC and promotion evidence.

## Manifest / package impact

No manifest or package schema change is approved by this request. Future
package-check hardening may cover generated artifact freshness, resource
validation, tablegroup metadata, and declared-pool metadata if accepted by
separate milestone scope.

## Conformance tests

No conformance tests are added by this docs-only request. Future accepted work
should add negative tests for demo-specific API leakage, `debug.metric` event-bus
misuse, unbounded pools, tablegroup length mismatches, stale generated artifacts,
and host-policy command-buffer assertions.

## Acceptance Criteria

- AIRON pressure is represented in Core request intake.
- Demo-specific behavior is explicitly kept out of Core.
- Tablegroup, composition, declared-pool, resource-validation, LSP, and
  command-buffer policy pressure are routed to the correct future layers.
- AIR ABI remains unchanged.
- Host ABI remains unchanged.
- No implementation is added.
