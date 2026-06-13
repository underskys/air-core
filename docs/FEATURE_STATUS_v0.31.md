# AIR v0.31 Feature Status

Status: planning/RFC and gates milestone

Version target: v0.31

v0.31 is the Bounded Structured IO RFC & Gates milestone. It defines safe
structured input/output terminology and guardrails before implementation.

This is not a language-feature milestone. It does not change parser, verifier,
lowering, AIR ABI, Host ABI, `output.emit`, fixed state, demos, or AIR source
syntax. It does not add runtime JSON, dynamic maps, host object handles, raw
host authority, structured IO implementation, or tablegroup syntax.

AIR ABI latest remains `0.10`. Host ABI latest remains `0.11`, limited to the
bounded `output.emit` first slice. Host ABI `0.10` remains the default/baseline
compatibility target for packages that do not use `output.emit`.

Related documents:

- [AIR v0.31 Release Plan](V0_31_RELEASE_PLAN.md)
- [Bounded Structured IO RFC](rfcs/v0.31-bounded-structured-io.md)
- [API Gates v0.31](API_GATES_v0_31.md)
- [AIR v0.30 Release Plan](V0_30_RELEASE_PLAN.md)
- [Version and ABI Policy](VERSION_AND_ABI_POLICY.md)

## Status Values

- `stable/active`: inherited behavior from earlier milestones.
- `planned/P0`: v0.31 RFC/gates first-slice planning target.
- `P1`: optional planning work if scope allows.
- `deferred`: future work outside v0.31.
- `rejected`: not allowed as part of bounded structured IO work.

## Stable / Active Baseline

| Feature | Layer | v0.31 status |
| --- | --- | --- |
| AIR ABI `0.10` | ABI | Stable/active. |
| Host ABI `0.10` | ABI | Stable/active and still supported. |
| Host ABI `0.11` bounded `output.emit` | Host ABI/package/runtime | Stable bounded first slice only. No expansion in v0.31. |
| Bounded rowset schemas | package metadata/tooling | Stable metadata baseline for minimized structured input. |
| Output Contracts | package metadata/tooling | Stable source of truth for bounded output IDs/channels/args. |
| Command buffers | package metadata/conformance | Stable batch output-intent baseline. |
| Fixed state | AIR source/runtime | Stable first executable slice inherited from v0.23. |
| Generated state handles | generated artifacts/tooling | Stable inherited baseline; generated artifacts are derived, not source of truth. |
| Generated output handles | generated artifacts/tooling | Stable canonical authoring path for bounded `output.emit` output IDs. |
| Verification evidence JSON | report/evidence | Stable machine-readable evidence baseline. |
| Package diff | review/tooling | Stable v0.30 evidence review baseline. |
| Evidence reports | review/tooling | Stable v0.30 Markdown first slice. |
| Conformance/replay | conformance/evidence | Stable deterministic replay baseline. |
| Benchmark baseline | benchmark/evidence | Stable v0.29 baseline; v0.31 adds no performance claims. |

## Planned P0

| Feature | Layer | v0.31 status |
| --- | --- | --- |
| Bounded Structured IO terminology | architecture/docs | Planned/P0. Define bounded scalar record, fixed rowset, tablegroup, bounded structured output, generated bindings, host kit, and Core/package metadata boundaries. |
| Bounded scalar record model | package metadata / future Core candidate | Planned/P0. Scalar-only, fixed-shape, schema-declared, bounded records. No runtime JSON/object/map semantics. |
| Fixed rowset / tablegroup relationship | architecture/docs | Planned/P0. Rowset is package metadata/tooling; tablegroup is future syntax/ergonomics only and not an object model. |
| Bounded structured output summary model | package metadata/evidence | Planned/P0. Describe structured output summaries using Output Contracts, command buffers, bounded `output.emit`, generated handles, and evidence reports without payload expansion. |
| Source of truth decision | package metadata/tooling | Planned/P0. Fact schemas, bounded rowset schemas, Output Contracts, command buffer schemas, and state declarations remain source of truth. Generated artifacts are derived. |
| Generated host bindings model | host kit/tooling | Planned/P0. Bindings are deterministic host-owned artifacts generated from source-of-truth schemas/contracts. No host object handles. |
| Report/evidence/diff/replay visibility | review/evidence | Planned/P0. Define structured IO metadata fields and privacy boundaries for package report, evidence, diff, replay, LSP, and human reports. |
| Verifier/package-check obligations | verifier/package-check planning | Planned/P0. Define rejection rules for JSON/object/ORM drift, unbounded rows, dynamic keys, private payload fields, and source-of-truth mismatches. |
| API gates / kill criteria | docs/tooling planning | Planned/P0. Document hard rejected patterns and conservative future checks. |
| ABI impact decision | ABI policy | Planned/P0. v0.31 planning does not require AIR ABI `0.11` or Host ABI expansion. |
| Pressure routing matrix | architecture/docs | Planned/P0. Route FlowDesk, lan-observer, AIRON, Airtris, Minesweeper, and PhotoLoop pressure without adding implementation scope. |

## P1

| Feature | v0.31 rule |
| --- | --- |
| Schema fixtures | P1. Fixtures may describe safe metadata shapes only. No runtime JSON model. |
| Parser syntax alternatives | P1 planning only. No parser changes in v0.31. |
| Generated binding examples | P1 docs/examples only. Bindings remain host-owned and derived. |
| FlowDesk-style task summary fixture | P1 planning/fixture only. No product scope or raw notes/private text in AIR. |
| lan-observer observation fixture | P1 planning/fixture only. No raw network authority, packet payloads, or host object handles. |
| AIRON level tablegroup sketch | P1 planning/sketch only. No tablegroup syntax, declared mutable pools, game APIs, or demo asset behavior. |

## Deferred / Rejected

| Feature | v0.31 status |
| --- | --- |
| Structured IO implementation | Deferred. |
| Tablegroups syntax | Deferred. |
| Declared mutable pools | Deferred. Separate future PRO-gated milestone if accepted. |
| Runtime JSON | Rejected. |
| Dynamic maps | Rejected. |
| Object identity | Rejected. |
| Strings/raw URLs/private text/tokens/secrets in AIR data | Rejected. |
| Host object handles | Rejected. |
| ORM/database model | Rejected. |
| Host ABI expansion | Deferred/rejected for v0.31. |
| Compact structured storage | Deferred. |
| Real host adapters | Deferred. |
| Demos | Out of scope. |

## Version Semantics

- Project milestone: `v0.31`.
- AIR ABI latest: remains `0.10`.
- Host ABI latest: remains `0.11`.
- Host ABI default/baseline: remains `0.10`.
- Host ABI `0.11` support remains limited to bounded `output.emit` packages.
- Host ABI expansion in v0.31: none.
- AIR ABI change in v0.31: none.
