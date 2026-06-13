# Command Buffer Basic Benchmark

Purpose: measure the command buffer output intent path using the existing
FlowDesk-style batch conformance fixture.

Command:

```sh
node bin/airc.js benchmark benchmarks/command_buffer_basic --json
```

Fixture package:

- `test/fixtures/conformance_batch/flowdesk`

Expected metric fields:

- `verifierMs`
- `packageCheckMs`
- `reportMs`
- `evidenceMs`
- `conformanceReplayMs`
- `commandBufferRecordCount`
- `packageSizeBytes`

Known limitations:

- Runtime Wasm execution timing is unavailable because this is a metadata and
  conformance replay benchmark.
- Host crossings are unavailable because command buffers are package/test-owned
  output intent evidence, not direct host calls.
- This benchmark does not add command buffer runtime ABI.
