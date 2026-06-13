# AIR v0.21 Release Plan

Status: active planning milestone

Theme: API Rebaseline & Host Interaction Contract

v0.21 starts after the v0.20 bounded data and command buffer first slice. The
milestone makes the canonical API path explicit before refactoring or deleting
legacy surface area.

v0.21 must make bounded facts, bounded rowset schemas, command buffers,
verification evidence, and deterministic conformance the canonical path. It
must expose API debt and compatibility obligations without removing legacy
behavior in this planning step.

v0.21 must not add Host ABI `0.11`, AIR ABI `0.11`, raw Chrome authority,
arbitrary JSON runtime values, dynamic maps, GC, reflection, host object
handles, promises, callbacks, async/await, runtime imports, package registry
behavior, native installers, or game-specific Core APIs.

## P0 Scope

| Area | Gate | Acceptance |
| --- | --- | --- |
| API surface inventory | Make current public, experimental, internal, legacy, and rejected/deferred surfaces explicit. | [API Surface v0.21](API_SURFACE_v0_21.md) classifies language syntax, package manifests, Host ABI, host profiles, `airpkg`, verification evidence, bounded facts/rowsets, output contracts, command buffers, conformance fixtures, LSP, CLI commands, examples/kits, and demo-local APIs. |
| Anti-slop/API gates first slice | Prevent new public surface from bypassing canonical contracts. | [API Gates v0.21](API_GATES_v0_21.md) defines gate categories for canonical vs legacy examples, deprecated API usage, host authority leakage, runtime JSON/object leakage, output Host ABI imports, and demo-specific APIs. The first machine check is conservative and does not delete or break legacy APIs. |
| Deprecation and migration plan | Expose API debt without breaking existing users immediately. | Identify legacy and experimental surfaces, canonical replacements, expected migration direction, and target milestone for change. No deletion in this planning task. |
| Canonical v0.21 API contract | Make the default path unambiguous. | Canonical path is package metadata plus bounded facts/rowsets, Output Contract manifests, command buffer output intents, verification evidence JSON, deterministic conformance fixtures, and diagnostics/LSP surfaces. |
| Compatibility strategy | Preserve working v0.10/v0.15-v0.20 surfaces while rebaseline is designed. | Legacy surfaces remain supported until specific migration gates and tests exist. Compatibility fallback must be visible in docs/reports where applicable. |
| Release gate updates for canonical vs legacy examples | Keep onboarding and CI aligned with the rebaseline. | Plan review gates that distinguish canonical examples from legacy examples, without touching demos or rewriting examples in this task. |

## P1 / If Scope Allows

- migrate two canonical non-game examples or package fixtures:
  - AirOps-style incident diagnostic;
  - FlowDesk-style policy/recommendation;
- LSP diagnostics for deprecated API usage;
- generated handles for rowsets and output contracts;
- `extension-basic` experimental kit, with host-owned authority only;
- AirOps/FlowDesk non-game examples as evidence packages, not Core authority.
- Fixed Bounded State Segment pressure request for v0.22+ architecture triage
  only; no v0.21 implementation, parser, verifier, lowering, AIR ABI, or Host
  ABI change.

## Deferred

- Host ABI `0.11`;
- AIR ABI `0.11`;
- `output.emit`, `output.event`, `audio.event`, and `effect.event`;
- raw `chrome.*`;
- DOM, React, IndexedDB, Jira, or fetch authority in AIR;
- secrets, tokens, private text, or raw URL authority in AIR;
- host object handles;
- arbitrary JSON runtime values inside AIR;
- dynamic maps;
- GC;
- reflection;
- promises, callbacks, or async/await in AIR;
- runtime imports;
- package registry;
- native installers;
- tablegroups implementation;
- broad demo rewrite;
- game-specific Core APIs;
- full `u8`/`u16` SSA arithmetic;
- silent truncation.

## Canonical API Direction

The v0.21 canonical path is:

```text
host rich state
-> minimized bounded facts / bounded rowset schemas
-> AIR deterministic scalar decision
-> command buffer output intent
-> host policy execution decision
-> verification evidence / conformance replay report
```

AIR owns deterministic scalar logic, bounded policy decisions, verification
metadata, and report-visible contracts. Hosts own raw objects, browser or infra
authority, private data, side-effect authorization, and real execution.

## Roadmap Truth Alignment

v0.21 is an API Rebaseline & Host Interaction Contract planning/gates
milestone. It makes the canonical path reviewable and guarded; it does not
claim that every future roadmap item is implemented or measured.

Performance acceleration claims are targets, not measured release facts.
`x10`-`x200` style claims require benchmark evidence before they can be
advertised as achieved. Current performance foundation comes from:

- compact static tables;
- bounded facts and bounded rowset schemas;
- command buffers;
- batching through deterministic conformance fixtures;
- linked package output;
- conformance/replay;
- LSP diagnostics.

Actual optimizer passes, a benchmark suite, and measured acceleration claims
are future work.

## Compatibility Strategy

- `stable/active` surfaces remain supported.
- `experimental` surfaces may change, but must remain documented and gated.
- `legacy` surfaces should get a documented canonical replacement before
  removal.
- `internal` surfaces are not public API and should not be used as adoption
  guidance.
- `rejected/deferred` surfaces must stay outside Core unless a future RFC,
  spec, profile, implementation, tests, and ABI decision explicitly promote
  them.

## Non-goals

v0.21 must not:

- implement features as part of this planning task;
- turn rowset schemas or command buffers into runtime object models;
- make AIR own browser, DOM, database, network, secret, or external API
  authority;
- promote output intents to Host ABI without the event/output promotion gate;
- introduce tablegroups as syntax;
- rewrite broad demos or standalone demo repositories;
- introduce game-specific command APIs into Core.

## ABI Policy

- Project milestone: `v0.21`.
- AIR ABI: remains `0.10` for docs, inventory, migration planning, examples
  classification, diagnostics planning, and gate planning unless executable
  runtime representation, calling convention, memory/data layout, package
  entrypoint semantics, or runtime-required package metadata changes.
- Host ABI: remains `0.10`; API inventory, deprecation planning, canonical
  contract documentation, and example classification do not add host imports or
  host authority.
- Host ABI `0.11` remains deferred to a separate accepted Host ABI RFC.

See [Version and ABI Policy](VERSION_AND_ABI_POLICY.md).

## Acceptance Gates

- Markdown links pass.
- `git diff --check` passes.
- No files under `src/`, `bin/`, `stdlib/`, `hosts/`, `demo/`, or standalone
  demo repositories are changed.
- No AIR ABI or Host ABI changes are made.
- No new runtime, host, registry, installer, or output event implementation is
  added.
- `npm run check:api-gates:v0.21` passes as part of the Core RC/review checks.

## Representative Commands

```sh
node scripts/check_markdown_links.js
node scripts/check_api_gates_v0_21.js
git diff --check
```
