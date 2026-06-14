# AIR v0.29 Release Plan

Status: planning milestone

Theme: Performance Evidence & Runtime Efficiency Baseline

v0.29 establishes measured performance evidence before AIR makes optimization
or product-speed claims. The milestone is intentionally measurement-first: it
does not optimize the compiler, change AIR ABI, change Host ABI, expand
`output.emit`, or add language features.

AIR should be evaluated as a small verified decision/action layer inside
host-owned applications:

- a language for deterministic verifier-enforced modules;
- not a universal app language;
- not a replacement for host TypeScript, Swift, Rust, Python, or application
  frameworks;
- not a substitute for host-owned renderers, networks, storage, or platform
  authority.

AIR ABI latest remains `0.10`.

Host ABI latest is `0.11`, introduced in v0.26 only for bounded
`output.emit` packages. Host ABI `0.10` remains the default/baseline
compatibility target for packages that do not use `output.emit`. v0.29 does not
expand Host ABI beyond the v0.26 bounded `output.emit` first slice.

## P0 Scope

| Area | Goal | Acceptance |
| --- | --- | --- |
| Benchmark runner plan | Define how benchmarks run without making the runner a language feature. | Plan covers deterministic fixture discovery, stable output, environment metadata, and non-blocking CI use. |
| Stable benchmark JSON schema | Make results machine-readable and reviewable. | RFC defines metric names, units, schema version, package identity, fixture identity, and no timestamp-dependent fields. |
| Fixed state benchmark | Measure the v0.23 fixed bounded state first slice. | Fixture plan captures runtime execution time, package/report timing, artifact size, and state-related evidence without exposing private state. |
| `output.emit` vs command buffer benchmark | Compare host crossing and output-intent cost. | Plan measures bounded emit calls, command buffer records, host crossing count, output command count, and conformance replay time. |
| AirOps-style decision benchmark | Measure a non-game bounded decision package. | Uses existing AirOps-style canonical/example fixture material if available. |
| FlowDesk-style policy benchmark | Measure policy/recommendation pressure if fixture exists. | Uses existing FlowDesk-style fixture material when present; otherwise documents as pending fixture. |
| Verification/package-check/report timing | Measure tooling costs separately from runtime. | Captures verifier time, package-check time, report/evidence generation time, and conformance replay time. |
| Host crossing / call count measurement | Make host interaction cost explicit where possible. | Counts exported calls, host imports, `output.emit` calls, command records, and host/Wasm boundary crossings when the harness can observe them. |
| Package/Wasm size measurement | Track artifact costs. | Captures source package bytes, WAT bytes, Wasm bytes where emitted, and relevant generated artifact bytes. |
| Baseline report document | Keep claims evidence-gated. | First report template states measured values, environment, limitations, and bottleneck hypotheses without public speed multipliers. |

## P1 / If Scope Allows

- benchmark trend baseline;
- CI non-blocking performance report;
- simple markdown benchmark summary;
- AI repair loop benchmark plan.

## Deferred

- compiler optimization passes;
- compact state optimization;
- `output.emit` expansion;
- Host ABI changes;
- public `x50`/`x200` claims;
- performance dashboard UI;
- benchmark-driven language features.

## Required Metric Categories

v0.29 benchmark planning must separate at least these metrics:

- runtime execution time;
- host crossing count;
- verification time;
- package-check time;
- report/evidence generation time;
- conformance replay time;
- artifact size;
- module/package size;
- AI repair iterations, as a plan only.

## Claim Policy

v0.29 establishes baseline measurements. It does not claim AIR is globally
faster than TypeScript, Rust, Python, Swift, or host application code.

Performance claims are evidence-gated. The first goal is to identify
bottlenecks, quantify runtime and tooling costs, and guide roadmap decisions.

## ABI Policy

AIR ABI latest remains `0.10`.

Host ABI latest remains `0.11`; Host ABI default/baseline remains `0.10`.
v0.29 does not add host imports, output events, payloads, dynamic output ids, or
platform authority. The `hostAbi` field in package/report/benchmark output
means the Host ABI required by that package or benchmark, not a project-wide
latest-version declaration.

## Representative Checks

```sh
node scripts/check_markdown_links.js
git diff --check
```
