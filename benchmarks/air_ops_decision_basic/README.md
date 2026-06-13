# AirOps Decision Basic Benchmark

Purpose: measure the existing AirOps-style deterministic decision package.

Command:

```sh
node bin/airc.js benchmark benchmarks/air_ops_decision_basic --json
```

Fixture package:

- `examples/airops_incident_package`

Expected metric fields:

- `verifierMs`
- `packageCheckMs`
- `reportMs`
- `evidenceMs`
- `conformanceReplayMs`
- `commandBufferRecordCount`
- `packageSizeBytes`

Known limitations:

- This is a synthetic canonical example benchmark, not a production AirOps
  product benchmark.
- Runtime Wasm timing is unavailable because the existing AirOps example is
  measured through package evidence and deterministic conformance replay.
- No real infrastructure, network, cloud, Kubernetes, secrets, credentials, or
  auto-remediation authority is used.
