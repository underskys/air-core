# FlowDesk Policy Basic Benchmark

Purpose: measure existing FlowDesk-style policy/recommendation pressure using
the checked-in batch conformance fixture.

Command:

```sh
node bin/airc.js benchmark benchmarks/flowdesk_policy_basic --json
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

- This is fixture pressure, not a full FlowDesk product benchmark.
- Runtime Wasm timing is unavailable because this benchmark uses bounded rowset
  fixture metadata and conformance replay.
- Browser, Chrome, DOM, fetch, Jira, secrets, and private text remain host-owned
  and outside AIR Core.
