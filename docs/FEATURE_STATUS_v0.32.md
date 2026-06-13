# AIR v0.32 Feature Status

Status: completed / merged executable utility milestone

Version target: v0.32

v0.32 targets an executable utility slice: bounded scalar structured IO first
slice, AI authoring eval replay mode, and verifier safety contract with a tiny
fuzz scaffold. The bounded structured IO first slice, AI authoring eval replay
mode, and deterministic verifier safety fuzz scaffold are implemented.

AIR ABI latest remains `0.10`. Host ABI latest remains `0.11`, limited to the
bounded `output.emit` first slice. Host ABI `0.10` remains the default/baseline
compatibility target for packages that do not use `output.emit`.

Related documents:

- [AIR v0.32 Release Plan](V0_32_RELEASE_PLAN.md)
- [Bounded Structured IO First Slice RFC](rfcs/v0.32-bounded-structured-io-first-slice.md)
- [AI Authoring Eval RFC](rfcs/v0.32-ai-authoring-eval.md)
- [Verifier Safety Contract](VERIFIER_SAFETY_CONTRACT.md)
- [AIR v0.31 Release Plan](V0_31_RELEASE_PLAN.md)
- [Version and ABI Policy](VERSION_AND_ABI_POLICY.md)

## Status Values

- `stable/active`: inherited behavior from earlier milestones.
- `planned/P0`: v0.32 executable utility target.
- `implemented/P0`: v0.32 executable utility first slice landed.
- `P1`: optional work after P0 is stable.
- `deferred`: future work outside v0.32.
- `rejected`: not allowed in v0.32.

## Stable / Active Baseline

| Feature | Layer | v0.32 status |
| --- | --- | --- |
| AIR ABI `0.10` | ABI | Stable/active. |
| Host ABI `0.10` | ABI | Stable/active and still supported. |
| Host ABI `0.11` bounded `output.emit` | Host ABI/package/runtime | Stable bounded first slice only. No expansion in v0.32. |
| Bounded rowset schemas | package metadata/tooling | Stable metadata baseline. |
| Output Contracts | package metadata/tooling | Stable source of truth for output IDs/intents. |
| Command buffers | package metadata/conformance | Stable batch output-intent baseline. |
| Fixed state | AIR source/runtime | Stable executable scalar state baseline. |
| Generated state/output handles | generated artifacts/tooling | Stable derived artifacts. Not source of truth. |
| Evidence reports and package diff | review/evidence | Stable v0.30 baseline. |
| v0.31 Bounded Structured IO RFC/Gates | architecture/docs | Stable planning baseline for v0.32 implementation decisions. |

## Planned P0

| Feature | Layer | v0.32 status |
| --- | --- | --- |
| Bounded scalar records first slice | package metadata/tooling | Implemented/P0. Scalar-only, fixed-shape schemas through `structuredIO`. |
| Fixed rowset input first slice | package metadata/tooling/conformance | Implemented/P0. Structured rowsets require fixed `maxRows` and scalar fields. |
| Bounded structured output summary first slice | evidence/tooling | Implemented/P0. Scalar schema summary metadata only; no payload objects or Host ABI expansion. |
| Generated field handles/offsets/bindings | generated artifacts/tooling | Implemented/P0. `generated/structured_io_handles.air` constants and `generated/structured_io.meta.json` metadata are derived and freshness-checked. |
| Report/evidence/diff/replay visibility | review/evidence | Implemented/P0. Package report, verification evidence, package diff, and batch conformance can surface structured IO metadata without raw row values. |
| Negative JSON/object drift tests | tests/package-check | Implemented/P0. Reject runtime JSON/object/map/string/nested drift and stale generated bindings. |
| AI authoring eval replay mode | tooling/eval | Implemented/P0. `node bin/airc.js eval-ai evals/ai_authoring --json` reads checked-in captured fixtures only. |
| Eval metrics | tooling/evidence | Implemented/P0. First-pass verify/package-check, repair success at 1/3, average repair iterations, forbidden surface rate, diagnostic coverage, hallucination categories, and top diagnostic codes. |
| Verifier safety contract | verifier/docs | Implemented/P0. Defines verifier guarantees, non-guarantees, report/proof boundaries, and safety obligations. |
| Tiny property/fuzz scaffold | tests/tooling | Implemented/P0. `node bin/airc.js fuzz-safety --seed 1 --cases 50 --json` verifies/lowers/executes deterministic tiny valid cases and checks invalid cases reject before lowering. |

## P1

| Feature | v0.32 rule |
| --- | --- |
| Live model eval mode | P1. Must be optional and non-blocking. |
| lan-observer structured facts adapter | P1. No network authority or raw payloads in AIR. |
| FlowDesk policy structured proof | P1. No product scope, raw notes, raw URLs, or browser authority. |
| Parser roundtrip fuzz | P1. Deterministic and non-flaky only. |
| HTML evidence viewer | P1. Review UI only, no host authority. |
| Generated host binding examples | P1. Derived artifacts only. |

## Deferred / Rejected

| Feature | v0.32 status |
| --- | --- |
| Runtime JSON | Rejected. |
| Strings in AIR structured data | Deferred/rejected for v0.32. |
| Nested records | Deferred. |
| Dynamic arrays | Rejected. |
| Maps | Rejected. |
| Objects/object identity | Rejected. |
| ORM/database model | Rejected. |
| Host object handles | Rejected. |
| Real host writes | Deferred/rejected. |
| Tablegroups syntax | Deferred. |
| Declared mutable pools | Deferred. |
| Host ABI expansion | Deferred/rejected. |
| GFX-driven ABI | Deferred. |
| LSP code actions | Deferred. |
| Package registry | Deferred. |

## Version Semantics

- Project milestone: `v0.32`.
- AIR ABI latest: remains `0.10`.
- Host ABI latest: remains `0.11`.
- Host ABI default/baseline: remains `0.10`.
- Host ABI `0.11` support remains limited to bounded `output.emit` packages.
- Host ABI expansion in v0.32: none unless separately approved later.
- AIR ABI change in v0.32: none unless executable/runtime contract evidence
  explicitly justifies it and the change is approved before implementation.
