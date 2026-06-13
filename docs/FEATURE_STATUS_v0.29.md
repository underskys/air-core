# AIR v0.29 Feature Status

Status: planning milestone

Version target: v0.29

v0.29 is the Performance Evidence & Runtime Efficiency Baseline milestone. It
creates the first benchmark runner, measurement plan, and report schema needed
before optimizer work or public performance claims.

This is not an optimizer milestone. It does not change compiler semantics, AIR
ABI, Host ABI, `output.emit`, or AIR language syntax.

AIR ABI latest remains `0.10`. Host ABI latest is `0.11`, introduced in v0.26
only for bounded `output.emit` packages. Host ABI `0.10` remains the
default/baseline compatibility target for packages that do not use
`output.emit`. v0.29 does not expand Host ABI beyond the v0.26 bounded
`output.emit` first slice.

Related documents:

- [AIR v0.29 Release Plan](V0_29_RELEASE_PLAN.md)
- [Performance Baseline Plan](PERFORMANCE_BASELINE_PLAN.md)
- [Benchmark Report Schema RFC](rfcs/v0.29-benchmark-report-schema.md)
- [Performance Evidence and Benchmarks v0.21 RFC](rfcs/v0.21-performance-evidence-benchmarks.md)

## Status Values

- `stable/active`: inherited behavior from earlier milestones.
- `active/P0`: implemented in the v0.29 first slice.
- `planned/P0`: v0.29 baseline target not yet implemented.
- `P1`: optional future work if scope allows.
- `deferred`: future work outside v0.29.
- `rejected`: not allowed as part of performance evidence work.

## Stable / Active Baseline

| Feature | Layer | v0.29 status |
| --- | --- | --- |
| AIR ABI `0.10` | ABI | Stable/active. |
| Host ABI `0.10` | ABI | Stable/active and still supported. |
| Host ABI `0.11` bounded `output.emit` | Host ABI/package/runtime | Stable bounded first slice only. No expansion in v0.29. |
| Verification evidence JSON | report/evidence | Stable baseline for package evidence. |
| Bounded rowset schemas | package metadata/tooling | Stable metadata baseline for structured minimized input. |
| Command buffers | package metadata/conformance | Stable output-intent baseline. |
| Fixed bounded state first slice | language/runtime | Existing executable slice to measure; no new state features in v0.29. |
| Generated output handles | tooling/package | Existing ergonomics baseline to measure where relevant. |

## Planned P0

| Feature | Layer | v0.29 status |
| --- | --- | --- |
| Benchmark runner | tooling/CLI | Active/P0 first slice through `airc benchmark <dir> --json`. Manual/non-blocking. |
| Stable benchmark JSON schema | report/schema | Active/P0 first slice through `kind: "air.benchmarkReport"`. |
| Fixed state benchmark | benchmark fixture | Active/P0 first slice through `benchmarks/fixed_state_basic`. Measures existing fixed state behavior only. |
| `output.emit` vs command buffer benchmark | benchmark fixture | Active/P0 first slice through `output_emit_basic` and `command_buffer_basic`; no ABI expansion. |
| AirOps-style decision benchmark | benchmark fixture | Active/P0 first slice through `benchmarks/air_ops_decision_basic` against the AirOps canonical package. |
| FlowDesk-style policy benchmark | benchmark fixture | Active/P0 first slice through `benchmarks/flowdesk_policy_basic` against the FlowDesk batch fixture. |
| Verification/package-check/report timing | tooling/report | Active/P0. Timings are reported as measured durations, not release gates. |
| Host crossing/call count measurement | tooling/report | Active/P0 where statically observable, currently through bounded `output.emit` count. |
| Package/Wasm size measurement | tooling/report | Active/P0 where package scan/build output is available. |
| Baseline report document | docs/report | Planned/P0. Document results without broad speed claims. |

## P1

| Feature | v0.29 rule |
| --- | --- |
| Benchmark trend baseline | P1. Establish trend storage only after first schema is stable. |
| CI non-blocking perf report | P1. Informational only until variance and thresholds are understood. |
| Markdown benchmark summary | P1. Derived from stable JSON, not manually invented claims. |
| AI repair loop benchmark plan | P1 planning only. No repair engine changes. |

## Deferred / Rejected

| Feature | v0.29 status |
| --- | --- |
| Compiler optimization passes | Deferred. |
| Compact state optimization | Deferred. |
| `output.emit` expansion | Deferred/rejected for v0.29. |
| Host ABI changes | Deferred. |
| Public `x50`/`x200` claims | Rejected until measured and reviewed. |
| Performance dashboard UI | Deferred. |
| Benchmark-only language features | Rejected. |
| Raw host authority or platform adapters | Rejected. |

## Version Semantics

- Project milestone: `v0.29`.
- AIR ABI latest: remains `0.10`.
- Host ABI latest: `0.11`.
- Host ABI default/baseline: `0.10`.
- Host ABI `0.11` support remains limited to bounded `output.emit` packages.
- The `hostAbi` field in package, report, evidence, and benchmark JSON means
  the Host ABI required by that package/report/benchmark.
- Host ABI expansion in v0.29: none.
- v0.29 is a measurement planning milestone, not an optimization or ABI
  expansion milestone.
