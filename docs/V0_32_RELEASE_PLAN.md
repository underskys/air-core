# AIR v0.32 Release Plan

Status: completed / merged executable utility milestone

Theme: Executable Utility Slice - Bounded Structured IO, AI Eval, Verifier Safety

v0.32 is intended to stop the sequence of planning-only milestones by producing
a small executable consumer-grade utility slice. The target is not a broad data
model. The target is a bounded scalar structured IO first slice, AI authoring
evaluation replay mode, and verifier safety contract with a tiny fuzz scaffold.

The bounded structured IO first slice is implemented as package
metadata/tooling/generated bindings. It does not implement tablegroups,
declared pools, parser syntax, verifier/lowering semantics, AIR ABI changes,
Host ABI changes, runtime JSON, host authority, or demos.

AIR ABI latest remains `0.10`.

Host ABI latest remains `0.11`, limited to bounded `output.emit`; Host ABI
`0.10` remains the default/baseline compatibility target for packages that do
not use `output.emit`.

## P0 Scope

| Area | Goal | Acceptance |
| --- | --- | --- |
| Bounded scalar records first slice | Implement schema-declared scalar record metadata/tooling path. | Implemented through `structuredIO` schema files; scalar-only, fixed-shape records; schemas remain source of truth; no runtime JSON/object model. |
| Fixed rowset input first slice | Make bounded rowset input usable for executable utility packages. | Implemented for structured rowset metadata with required `maxRows`, package-check visibility, deterministic report/evidence/diff/replay metadata. |
| Bounded structured output summary first slice | Present structured output intent summaries without payload expansion. | Implemented as scalar schema metadata; Output Contracts remain source of truth; no payload objects or Host ABI expansion. |
| Generated field handles/offsets/bindings | Add derived authoring/host ergonomics. | Implemented as constants-only `generated/structured_io_handles.air` plus deterministic `generated/structured_io.meta.json`. |
| Report/evidence/diff/replay visibility | Make the first slice reviewable. | Implemented in package report, verification evidence, package diff, and batch conformance rowset validation without raw private payloads. |
| Negative JSON/object drift tests | Lock the boundary. | Implemented tests reject runtime JSON, object/map/string/nested drift, missing bounds, and stale generated artifacts. |
| AI authoring eval replay mode | Measure AI-authored package quality deterministically. | Replay mode reports first-pass verify/package-check rate, repair success at 1 and 3, forbidden surface rate, and top diagnostic codes. |
| Verifier safety contract | Define verifier invariants and non-regression claims. | Contract documents soundness boundaries, diagnostics obligations, and what reports must not imply. |
| Tiny property/fuzz scaffold | Add initial verified tiny-module safety pressure. | Deterministic scaffold exercises parser/formatter/verifier boundaries without making CI noisy or probabilistic. |

## P1 / If Scope Allows

- live model eval mode;
- lan-observer structured facts adapter;
- FlowDesk policy structured proof;
- parser roundtrip fuzz;
- HTML evidence viewer;
- generated host binding examples.

## Deferred

- runtime JSON;
- strings in AIR structured data;
- nested records;
- dynamic arrays;
- maps;
- objects;
- ORM/database model;
- host object handles;
- real host writes;
- tablegroups syntax;
- declared mutable pools;
- Host ABI expansion;
- GFX-driven ABI;
- LSP code actions;
- package registry.

## Hard Constraints

- scalar-only;
- fixed-size;
- bounded rows only;
- no runtime JSON;
- no dynamic object model;
- no host authority;
- generated bindings are derived artifacts;
- schemas remain source of truth.

## Required Documents

- [Bounded Structured IO First Slice RFC](rfcs/v0.32-bounded-structured-io-first-slice.md)
- [AI Authoring Eval RFC](rfcs/v0.32-ai-authoring-eval.md)
- [Verifier Safety Contract](VERIFIER_SAFETY_CONTRACT.md)

## Representative Checks

```sh
npm run check:api-gates:v0.32
node bin/airc.js eval-ai evals/ai_authoring --json
node bin/airc.js fuzz-safety --seed 1 --cases 50 --json
node scripts/check_markdown_links.js
git diff --check
```
