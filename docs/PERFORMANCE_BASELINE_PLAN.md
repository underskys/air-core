# AIR Performance Baseline Plan

Status: v0.29 first slice active

Purpose: define the first baseline measurement program for AIR runtime,
tooling, package, and conformance costs.

AIR performance should be measured before claims are made. The project should
avoid global statements such as "AIR is faster than TypeScript/Rust/Python" and
instead report scoped, reproducible results for small verified modules inside
host-owned applications.

## Evaluation Model

AIR is evaluated as:

- deterministic verified logic modules;
- bounded decision/action packages;
- a small layer inside host-owned applications;
- a source of verifier, report, conformance, and host-interaction evidence.

AIR is not evaluated as:

- a universal app language;
- a replacement for host TypeScript, Swift, Rust, Python, or application
  frameworks;
- a browser, renderer, filesystem, network, cloud, or platform authority layer.

## Benchmark Groups

The first runner entrypoint is:

```sh
node bin/airc.js benchmark <benchmark-dir> --json
```

Each benchmark directory contains a deterministic `benchmark.json` descriptor
that points at an existing package/fixture. The runner measures the existing
verification, package-check, report, verification evidence, optional
conformance replay, optional Wasm build, and optional runtime execution paths.
It is manually run / non-blocking in v0.29.

### Fixed State

Measures existing fixed bounded state behavior:

- runtime execution time for state get/set patterns;
- deterministic trap or bounds behavior where applicable;
- package-check/report timing;
- Wasm/WAT size where emitted;
- conformance replay time where a replay fixture exists.

No compact state or new state operations are part of this baseline.

### Output Intent Path

Compares bounded runtime `output.emit` with command buffer output intents:

- host crossing count;
- `output.emit` call count;
- command record count;
- runtime execution time;
- mock host / policy executor evidence time;
- conformance replay time.

This does not expand `output.emit` and does not add payload support.

### AirOps-Style Decision

Measures a non-game bounded incident/ops decision package where fixture material
exists:

- package-check time;
- verification evidence generation time;
- runtime execution time;
- output command/emit count;
- artifact size.

### FlowDesk-Style Policy

Measures FlowDesk-style policy/recommendation pressure if fixture material
exists. If no canonical fixture is present, v0.29 should report that as a
fixture gap rather than inventing performance claims.

## Metric Categories

Every benchmark result should keep these categories separate:

- runtime execution time;
- host crossing count;
- verification time;
- package-check time;
- report/evidence generation time;
- conformance replay time;
- artifact size;
- module/package size;
- AI repair iterations, plan only.

## Size Metrics

Baseline reports should include:

- AIR source bytes for benchmark modules;
- package directory size where deterministic;
- generated artifact bytes;
- WAT bytes when emitted;
- Wasm bytes when emitted;
- relevant manifest/evidence JSON bytes.

## Timing Policy

Wall-clock measurements must be labeled and controlled. The first baseline may
collect elapsed time, but it must report environment and variance limitations.
No public claim should be derived from one uncontrolled run.

Recommended metadata:

- runner version;
- AIR compiler version;
- AIR ABI;
- Host ABI required by the measured package or benchmark;
- Node version;
- OS/architecture;
- benchmark id;
- package hash;
- fixture hash;
- command line;
- iteration count.

## Host Crossing Policy

Where possible, count:

- exported AIR calls;
- host import calls;
- `output.emit` calls;
- command buffer records;
- mock host policy decisions;
- JS/Wasm/native boundary crossings.

If a crossing cannot be measured directly, the report must distinguish
estimated counts from observed counts.

## ABI Reporting Policy

AIR ABI latest remains `0.10`.

Host ABI latest is `0.11`, introduced for bounded `output.emit`. Host ABI
`0.10` remains the default/baseline compatibility target for packages that do
not use `output.emit`.

Benchmark reports use `hostAbi` to mean the Host ABI required by the measured
package or benchmark. For example, `output_emit_basic` reports `hostAbi:
"0.11"`, while non-`output.emit` benchmarks report `hostAbi: "0.10"`.
v0.29 does not expand Host ABI beyond the existing bounded `output.emit` first
slice.

## Baseline Report

The first baseline report should answer:

1. Which package or fixture was measured?
2. Which metric category was measured?
3. Which environment was used?
4. Which results are observed, estimated, or unavailable?
5. Which bottleneck is suggested by the evidence?
6. Which roadmap item could address that bottleneck?

The report must not advertise `x50`, `x200`, or similar claims as achieved
without checked-in benchmark evidence and review.

## First-Slice Benchmarks

v0.29 includes these starter benchmark descriptors under `benchmarks/`:

- `fixed_state_basic`: builds the fixed-state conformance fixture, measures
  package/report/evidence/conformance timing, and runs an explicit exported
  state mutation function.
- `output_emit_basic`: measures the existing bounded `output.emit` fixture with
  mock-output Host ABI `0.11` support and counts one host crossing.
- `command_buffer_basic`: measures the FlowDesk batch command-buffer fixture
  and records command-buffer record count through conformance replay.
- `air_ops_decision_basic`: measures the AirOps-style canonical package
  verification/report/conformance path.
- `flowdesk_policy_basic`: measures the existing FlowDesk-style policy fixture
  without adding product scope.

Runtime execution timing is best-effort. Benchmarks without a runtime export
report that limitation instead of claiming unavailable data.

## Non-Goals

- no optimizer implementation;
- no compiler semantic changes;
- no AIR ABI changes;
- no Host ABI expansion;
- no `output.emit` expansion;
- no benchmark-only language features;
- no dashboard UI in v0.29.
