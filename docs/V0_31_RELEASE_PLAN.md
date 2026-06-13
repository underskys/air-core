# AIR v0.31 Release Plan

Status: planning/RFC and gates milestone

Theme: Bounded Structured IO RFC & Gates

v0.31 defines the terminology, safety boundaries, evidence surfaces, and API
gates for bounded structured input and output ergonomics. It is not an
implementation milestone. It does not change parser, verifier, lowering, AIR
ABI, Host ABI, host authority, demos, or runtime semantics.

AIR already has bounded rowset schema metadata, Output Contracts, command
buffers, bounded `output.emit`, fixed state, generated state handles, generated
output handles, evidence reports, package diff, conformance/replay, and a
benchmark baseline. v0.31 decides how those surfaces should line up before any
bounded structured IO implementation is attempted.

AIRON platformer pressure is tracked as request-intake evidence for authored
package composition, tablegroups, declared pools, and resource validation. It
does not grant demo authority to Core and does not add implementation scope.

AIR ABI latest remains `0.10`.

Host ABI latest remains `0.11`, limited to bounded `output.emit`; Host ABI
`0.10` remains the default/baseline compatibility target for packages that do
not use `output.emit`.

## P0 Scope

| Area | Goal | Acceptance |
| --- | --- | --- |
| Terminology | Define bounded structured IO terms. | RFC clearly defines bounded scalar record, fixed rowset, tablegroup, bounded structured output, generated binding, host kit, and Core/package-metadata boundaries. |
| Bounded scalar record model | Establish the safe unit of structure. | Records are fixed-shape, scalar-only, schema-declared, bounded, and privacy-minimized. No runtime JSON, dynamic fields, maps, strings, raw URLs, tokens, private text, or object identity. |
| Fixed rowset / tablegroup relationship | Separate metadata contracts from source ergonomics. | Rowset schemas remain package metadata/tooling. Tablegroups are future source syntax/ergonomics, not object models or dynamic runtime collections. |
| Bounded structured output summary model | Define structured output review shape. | Output summaries are derived from Output Contracts, command buffers, bounded `output.emit`, generated handles, and evidence reports; they do not add payloads or host authority. |
| Source of truth | Prevent generated artifact drift. | Fact schemas, bounded rowset schemas, Output Contracts, command buffer schemas, and state declarations remain source of truth. Generated artifacts are derived and freshness-checked. |
| Generated host bindings model | Describe safe host-facing ergonomics. | Bindings are generated from schemas/contracts, deterministic, versioned, freshness-checked, and host-owned. They do not add AIR runtime object semantics or host object handles. |
| Report/evidence/diff/replay visibility | Make structured IO reviewable. | RFC defines how package report, verification evidence, package diff, evidence report, conformance/replay, LSP diagnostics, and API gates should surface structured IO metadata. |
| Verifier/package-check obligations | Define enforcement before implementation. | Package-check rejects JSON/object/ORM drift, unbounded rows, dynamic keys, private payload fields, and source-of-truth mismatches. Verifier obligations are listed only for future accepted syntax/runtime work. |
| API gates and kill criteria | Prevent slop while design is in progress. | API gates document hard rejected patterns and future check candidates without breaking existing legacy compatibility. |
| ABI impact decision | Keep ABI versions honest. | v0.31 planning does not require AIR ABI `0.11` or Host ABI expansion. Any future bump requires an executable/runtime or host import contract change. |
| Pressure routing matrix | Route known pressure sources. | FlowDesk, lan-observer, AIRON, Airtris, Minesweeper, and PhotoLoop pressure is classified by target layer and deferred/rejected boundaries. |

## P1 / If Scope Allows

- schema fixtures;
- parser syntax alternatives;
- generated binding examples;
- FlowDesk-style task summary fixture;
- lan-observer observation fixture;
- AIRON level tablegroup sketch;
- LSP diagnostic taxonomy planning for structured IO drift.

## Deferred

- implementation;
- parser changes;
- verifier changes;
- lowering changes;
- tablegroups syntax;
- declared mutable pools;
- runtime JSON;
- dynamic maps;
- object identity;
- strings, raw URLs, private text, tokens, and secrets as AIR data;
- host object handles;
- ORM/database model;
- Host ABI expansion;
- compact structured storage;
- real host adapters;
- demos.

## Hard Constraints

- First slice must be scalar-only if implemented later.
- All rows and record counts must be fixed or statically bounded.
- AIR must not gain runtime JSON, dynamic objects, dynamic maps, object identity,
  host object handles, or raw host authority.
- Host owns rich objects and private payloads.
- AIR sees minimized IDs, handles, enums, flags, scores, counters, and other
  bounded scalar facts.
- Generated artifacts are not source of truth.

## Design Questions to Close

- What is a bounded scalar record?
- What is a fixed rowset?
- What is a tablegroup, and why is it not an object?
- What is bounded structured output?
- Which pieces are Core, package metadata, generated bindings, or host kits?
- How do package report, verification evidence, package diff, evidence report,
  and conformance replay expose structured IO?
- How does package-check reject JSON/object/ORM drift?
- Does any future first slice require AIR ABI `0.11`?
- Does any future first slice require Host ABI changes?

## Representative Checks

```sh
node scripts/check_markdown_links.js
git diff --check
```
