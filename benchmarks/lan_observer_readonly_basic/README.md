# LAN Observer Read-only Basic Benchmark

Measures the sanitized lan-observer-style read-only proof package.

The benchmark exercises package-check, package report, verification evidence,
and conformance replay over a deterministic command-buffer output intent. It
does not scan a network, access OS devices, call external services, use secrets,
or write to external systems.

Expected metric fields:

- `packageCheckMs`
- `reportMs`
- `evidenceMs`
- `verifierMs`
- `conformanceReplayMs`
- `commandBufferRecordCount`
- `packageSizeBytes`

Known limitations:

- runtime Wasm execution is not measured by this first-slice benchmark;
- host crossings are not reported because the package uses command buffers, not
  `output.emit`;
- measured durations are baseline evidence only and are not CI performance
  thresholds.
