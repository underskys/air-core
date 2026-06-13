# AIR v0.29 Performance Baseline Summary

Status: initial single-run baseline

This document records the first AIR v0.29 performance baseline run. It is
evidence for roadmap direction, not a public performance claim.

AIR is evaluated here as a deterministic verified logic layer inside
host-owned applications. These measurements do not evaluate AIR as a universal
app language or as a replacement for host TypeScript, Swift, Rust, Python, or
application frameworks.

## Commands Run

```sh
node bin/airc.js benchmark benchmarks/fixed_state_basic --json
node bin/airc.js benchmark benchmarks/output_emit_basic --json
node bin/airc.js benchmark benchmarks/command_buffer_basic --json
node bin/airc.js benchmark benchmarks/air_ops_decision_basic --json
node bin/airc.js benchmark benchmarks/flowdesk_policy_basic --json
```

## Benchmark Results

`hostAbi` in each underlying benchmark report means the Host ABI required by
that benchmark package. `output_emit_basic` requires Host ABI `0.11` because it
uses bounded `output.emit`; the non-`output.emit` benchmarks require Host ABI
`0.10`. Host ABI latest is `0.11`, Host ABI default/baseline remains `0.10`,
and v0.29 does not expand Host ABI.

| Benchmark | Purpose | Status | Package bytes | Wasm bytes | Verify/evidence ms | Package-check ms | Report ms | Conformance ms | Runtime ms | Host crossings | Output emits | Command records |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Fixed state basic | Fixed state get/set path. | pass | 1365 | 691 | 1 | 10 | 0 | 1 | 0 | n/a | 0 | 0 |
| Output emit basic | Bounded `output.emit` path with local mock output import. | pass | 1628 | 146 | 1 | 11 | 0 | n/a | 0 | 1 | 1 | 0 |
| Command buffer basic | FlowDesk-style command buffer intent path. | pass | 3103 | n/a | 2 | 13 | 0 | 1 | n/a | n/a | 0 | 1 |
| AirOps decision basic | Synthetic AirOps-style deterministic decision package. | pass | 10875 | n/a | 3 | 16 | 1 | 2 | n/a | n/a | 0 | 1 |
| FlowDesk policy basic | FlowDesk-style policy/recommendation fixture. | pass | 3103 | n/a | 2 | 13 | 0 | 1 | n/a | n/a | 0 | 1 |

`Verify/evidence ms` is the measured `airc verify package --json` evidence
generation duration. For this first slice, verifier timing and evidence timing
are collected together through the verification evidence path.

## Limitations

- This is a single local run. Timings are not statistically significant.
- Durations are elapsed local measurements and are not CI thresholds.
- Runtime execution is only measured where a benchmark declares an executable
  Wasm path and runtime export.
- Command-buffer fixtures measure metadata/conformance replay, not direct Wasm
  execution.
- Host crossings are counted only when `output.emit` calls are statically
  measurable.
- `n/a` means the metric is intentionally unavailable for that benchmark and
  is reflected in the benchmark report `limitations` field.

## Conclusions

### 1. Runtime Execution

What was measured:

- Fixed state get/set execution through `fixed_state_basic`.
- Bounded `output.emit` execution through `output_emit_basic`.

Result:

- Both executable fixtures completed with measured `wasmExecutionMs` of `0` ms
  at the current timer granularity.
- Fixed state produced a 691-byte Wasm artifact.
- Output emit produced a 146-byte Wasm artifact.

Confidence:

- Low. The measurements are useful as smoke evidence that the runner can
  execute tiny modules, but the modules are too small and the run count is too
  low for throughput or latency claims.

### 2. Host Boundary / Output

What was measured:

- `output_emit_basic` records one bounded `output.emit` call and one host
  crossing through the local mock output import. Its benchmark report requires
  Host ABI `0.11`.
- `command_buffer_basic`, `air_ops_decision_basic`, and
  `flowdesk_policy_basic` each record one command-buffer output intent record
  and require Host ABI `0.10`.

Result:

- `output.emit` is visible as an immediate host crossing.
- Command buffers remain visible as bounded output intent records without
  direct host crossings in the benchmark report.
- Host ABI baseline/default `0.10` remains supported; Host ABI `0.11` is
  supported for bounded `output.emit` packages; v0.29 does not expand Host ABI.

Confidence:

- Medium for count correctness in these fixtures.
- Low for performance comparison, because command-buffer fixtures currently
  measure conformance/metadata replay rather than equivalent runtime execution.

### 3. Verification Cost

What was measured:

- Verification evidence generation through `airc verify package --json`.
- Package-check timing through the benchmark runner.
- Package report timing through the benchmark runner.

Result:

- Verification/evidence timing ranged from 1 ms to 3 ms.
- Package-check timing ranged from 10 ms to 16 ms.
- Package report timing ranged from 0 ms to 1 ms.

Confidence:

- Low-to-medium. The result shows current small-fixture costs are modest, but
  not enough to establish scaling behavior for larger packages.

### 4. Evidence / Report Cost

What was measured:

- Verification evidence generation.
- Report package generation.
- Conformance replay where benchmark traces exist.

Result:

- Evidence generation ranged from 1 ms to 3 ms.
- Report package generation ranged from 0 ms to 1 ms.
- Conformance replay ranged from 1 ms to 2 ms where traces exist.

Confidence:

- Low-to-medium for these fixtures. Evidence and conformance paths look cheap
  for small packages, but larger package graphs and generated artifact sets need
  repeated measurements before prioritizing optimization work.

### 5. Artifact Size

What was measured:

- Package directory size for every benchmark.
- Wasm size where the benchmark requested a build.

Result:

- Package sizes ranged from 1365 bytes to 10875 bytes.
- Wasm size was available for fixed state and output emit:
  - fixed state: 691 bytes;
  - output emit: 146 bytes.

Confidence:

- Medium for these exact artifacts.
- Low for broader size claims because WAT size, linked package size, and larger
  package graphs are not yet included in this summary.

## What Can Be Concluded

- The benchmark runner can emit stable `air.benchmarkReport` JSON for current
  AIR package, evidence, report, conformance, and small runtime paths.
- Current tiny fixtures pass and produce measurable package-check,
  verification evidence, report, conformance, and size metrics.
- `output.emit` host crossing count is visible when output emit usage is
  statically measurable.
- Command-buffer output intent counts are visible through conformance/report
  paths and remain suitable for batch-oriented evidence.

## What Cannot Be Concluded

- AIR is not proven faster than TypeScript, Rust, Python, or any host language.
- No `x50`, `x200`, or similar multiplier claim is supported.
- The data does not prove optimizer impact.
- The data does not prove runtime throughput for realistic host applications.
- The data does not compare equivalent `output.emit` and command-buffer runtime
  workloads yet.
- The data does not establish variance, regression thresholds, or CI pass/fail
  performance budgets.

## Roadmap Implications

Should compact state move earlier?

- Not yet. The fixed-state Wasm artifact is small in this fixture, and runtime
  timing is below current measurement granularity. Compact state should wait
  for larger fixed-state benchmarks that show static byte size or cache effects
  matter.

Should command buffers remain primary batch path?

- Yes. The current evidence supports keeping command buffers as the primary
  batch output-intent path. They provide deterministic conformance records
  without per-intent host crossings.

Should `output.emit` stay a low-frequency signal path?

- Yes. The benchmark makes the host crossing explicit. Until repeated
  equivalent workloads show otherwise, bounded `output.emit` should stay a
  low-frequency signal path rather than the batch output mechanism.

Should caching/incremental package-check become priority?

- Candidate P1. Package-check is the largest measured tooling cost in these
  tiny fixtures. The numbers are still small, but repeated runs and larger
  package graphs should determine whether caching or incremental package-check
  becomes a v0.30+ priority.

Should LSP incremental diagnostics move earlier?

- Not from this evidence alone. Current measurements are CLI package-level
  timings, not editor keystroke diagnostics. LSP incremental diagnostics need a
  separate benchmark that measures file-level vs package-aware diagnostics over
  repeated edit scenarios.

## Claims Not Allowed Yet

- No global "AIR is faster than TS/Rust/Python" claim.
- No `x50`, `x200`, or similar acceleration claim.
- No claim that command buffers are faster than `output.emit` for equivalent
  runtime workloads.
- No claim that compact state is performance-critical.
- No claim that package-check or evidence generation is optimized.

Future claims require repeated benchmark runs, controlled environment metadata,
variance reporting, checked-in evidence, and review.
