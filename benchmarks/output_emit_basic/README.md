# Output Emit Basic Benchmark

Purpose: measure the existing bounded Host ABI `0.11` `output.emit` path and
mock-host evidence-adjacent metadata.

Command:

```sh
node bin/airc.js benchmark benchmarks/output_emit_basic --json
```

Fixture package:

- `test/fixtures/host_interaction/output_emit`

Expected metric fields:

- `verifierMs`
- `packageCheckMs`
- `reportMs`
- `evidenceMs`
- `wasmBuildMs`
- `wasmExecutionMs`
- `hostCrossings`
- `outputEmitCount`
- `packageSizeBytes`
- `wasmSizeBytes`

Known limitations:

- `output.emit` is measured only as the existing bounded scalar first slice.
- No real host action is executed; runtime imports use a deterministic local mock.
- Conformance replay timing is unavailable because this benchmark has no
  conformance trace descriptor.
- This benchmark does not add `output.event`, payloads, dynamic output IDs, or
  new Host ABI features.
