# AIR API Gates v0.38

Status: active milestone gate

Scope: End-to-End Execution Proof and AI Eval Capture/Import boundaries

v0.38 implements `airc run-proof` and deterministic `eval-ai import` for
sanitized local capture files. The gate exists to keep these surfaces offline,
deterministic, privacy-safe, and ABI-neutral.

## Command

Run:

```sh
npm run check:api-gates:v0.38
```

The v0.38 gate inherits the stable historical gates through v0.37 and adds
checks for E2E proof and AI eval capture/import.

## Allowed Active Implementation

The v0.38 gate allows:

- `airc run-proof` first slice;
- deterministic E2E proof fixtures;
- `eval-ai import` from local sanitized capture files;
- E2E benchmark fixture metadata;
- evidence report sections for static validation, package policy validation,
  conformance replay, runtime execution proof, and host policy simulation;
- docs and RFC mentions of deferred live eval or package composition when they
  are clearly marked as deferred, rejected, non-goals, or future work.

## Rejected Active Implementation

The v0.38 gate rejects active implementation of:

- live AI provider calls;
- API key loading for `eval-ai`;
- network access in `eval-ai` or `run-proof`;
- provider SDK dependencies;
- nondeterministic CI behavior;
- package composition implementation as v0.38 scope;
- real host adapter implementation;
- raw OS/network access;
- raw private capture data;
- timestamps required for correctness;
- absolute paths in emitted reports;
- new Host ABI imports;
- Host ABI expansion;
- AIR ABI change.

## Positive Checks

The implemented gate verifies:

- `check:api-gates:v0.38` is registered in `package.json`;
- `scripts/run_rc_checks.sh` runs the v0.38 gate;
- required v0.38 docs and RFCs are present;
- docs mark E2E proof and eval import as implemented P0;
- active `eval-ai import` and `run-proof` implementation files do not use
  provider SDKs, network APIs, provider key environment variables, wall-clock
  timestamps, random values, subprocess host adapters, or OS/network modules;
- `airc run-proof` emits deterministic `air.e2eProofReport`;
- `airc eval-ai import` emits deterministic
  `air.aiAuthoringEvalImportReport`;
- secret-like and provider-metadata import fixtures are rejected;
- E2E benchmark emits deterministic `air.benchmarkReport`;
- reports contain no timestamp-like fields, absolute paths, credentials, raw
  URLs, or raw private fact names;
- AIR ABI remains `0.10`;
- Host ABI remains unchanged.

## Non-goals

This gate does not:

- implement live eval;
- approve provider SDK dependencies;
- approve network access;
- approve package composition;
- approve real host adapters;
- approve new Host ABI imports.

## ABI Status

AIR ABI remains `0.10`.

Host ABI latest remains `0.11`, limited to bounded `output.emit`; Host ABI
`0.10` remains the default/baseline for packages that do not use `output.emit`.
