# Fixed State Basic Benchmark

Purpose: measure the existing Fixed Bounded State get/set path.

Command:

```sh
node bin/airc.js benchmark benchmarks/fixed_state_basic --json
```

Fixture package:

- `test/fixtures/conformance_state`

Expected metric fields:

- `verifierMs`
- `packageCheckMs`
- `reportMs`
- `evidenceMs`
- `conformanceReplayMs`
- `wasmBuildMs`
- `wasmExecutionMs`
- `packageSizeBytes`
- `wasmSizeBytes`

Known limitations:

- Runtime timing is a local elapsed duration and is not a release threshold.
- Host crossings are unavailable because this fixture does not call host imports.
- This benchmark measures existing `i32` fixed state only; it does not add compact state.
