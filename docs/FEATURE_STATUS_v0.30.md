# AIR v0.30 Feature Status

Status: RC hardening milestone

Version target: v0.30

v0.30 is the Evidence Review Surface milestone. It implements first slices for
turning verifier evidence, package diffs, conformance replay, host policy
summaries, and anti-slop diagnostics into a human-reviewable approval surface.
It is now in hardening/stabilization: package diff, Markdown evidence report,
replay summary, host policy summary, diagnostics grouping, privacy-safe report
wording, and no-performance-claim guardrails are active first slices.

This is not a language-feature milestone. It does not change compiler
semantics, AIR ABI, Host ABI, `output.emit`, benchmark semantics, or AIR source
syntax.

AIR ABI latest remains `0.10`. Host ABI latest remains `0.11`, limited to the
bounded `output.emit` first slice. Host ABI `0.10` remains the
default/baseline compatibility target for packages that do not use
`output.emit`.

Related documents:

- [AIR v0.30 Release Plan](V0_30_RELEASE_PLAN.md)
- [Evidence Review Surface RFC](rfcs/v0.30-evidence-review-surface.md)
- [AIR v0.29 Performance Baseline Summary](PERFORMANCE_BASELINE_v0_29.md)
- [Version and ABI Policy](VERSION_AND_ABI_POLICY.md)

## Status Values

- `stable/active`: inherited behavior from earlier milestones.
- `active/P0`: v0.30 first-slice implementation.
- `planned/P0`: v0.30 target not yet implemented.
- `P1`: optional future work if scope allows.
- `deferred`: future work outside v0.30.
- `rejected`: not allowed as part of evidence review work.

## Stable / Active Baseline

| Feature | Layer | v0.30 status |
| --- | --- | --- |
| AIR ABI `0.10` | ABI | Stable/active. |
| Host ABI `0.10` | ABI | Stable/active and still supported. |
| Host ABI `0.11` bounded `output.emit` | Host ABI/package/runtime | Stable bounded first slice only. No expansion in v0.30. |
| Verification evidence JSON | report/evidence | Stable baseline for machine-readable evidence. |
| Package reports | report/tooling | Stable baseline for package metadata and diagnostics. |
| Conformance replay | conformance/evidence | Stable baseline for deterministic replay evidence. |
| Output Contracts | package metadata/tooling | Stable source of truth for bounded outputs. |
| Command buffers | package metadata/conformance | Stable batch output-intent baseline. |
| Bounded rowset schemas | package metadata/tooling | Stable metadata baseline for structured minimized input. |
| API gates and anti-slop diagnostics | review/tooling | Stable baseline for forbidden-surface checks. |
| Benchmark reports | benchmark/evidence | Stable v0.29 baseline; v0.30 adds no performance claims. |

## Active P0

| Feature | Layer | v0.30 status |
| --- | --- | --- |
| Human-readable decision/evidence report | report/review | Active/P0 first slice through `airc evidence report <dir> --format markdown -o <file>`. Derived from verifier/evidence/report data, not a parallel proof engine. |
| Package diff | review/tooling | Active/P0 first slice through `airc diff package <old-dir> <new-dir> --json`. Covers capability, effect, Host ABI, output contract, fact/rowset schema, command buffer metadata, and generated artifact freshness deltas. |
| Replay summary | conformance/review | Active/P0 first slice inside evidence reports when `--conformance <json>` is provided. Shows fixture identity, pass/fail, checksum, output IDs, mismatch counts/kinds, state digest status, and host interaction evidence status without raw payloads. |
| Host policy result summary | host-policy/review | Active/P0 first slice inside evidence reports when `--host-evidence <json>` is provided. Shows allowed, denied, unknown output, unsupported profile, replay checksum, and diagnostics. |
| Diagnostics consistency | diagnostics/review | Active/P0 by preserving stable diagnostic codes and grouped severities in evidence reports and package diffs. Specific diagnostics remain visible where existing sources provide them. |
| Privacy-safe reports | review/privacy | Active/P0. Evidence reports and package diffs use IDs, counts, hashes, statuses, and diagnostics; they omit raw private payloads, raw URLs, secrets, tokens, private text, raw state values, and helper return dumps. |
| Performance claim guard | docs/review | Active/P0. v0.30 adds no new performance claims and keeps benchmark summaries as evidence inputs, not marketing claims. |

## RC Hardening Checklist

| Check | v0.30 status |
| --- | --- |
| Evidence report golden fixture | Required for RC hardening. |
| Package diff golden fixture | Required for RC hardening. |
| Replay summary fixture | Required for RC hardening. |
| Privacy/redaction tests | Required for RC hardening. |
| No absolute paths/timestamps | Required for evidence report, package diff, replay summaries, and review bundles. |
| No raw private payloads | Required; raw URLs, secrets, tokens, private text, raw state values, and helper return dumps must not appear in human reports. |
| No performance claims | Required; benchmark summaries are evidence inputs only. |
| Final review bundle | Required with `RED_FLAGS` none before merge. |

## Package Diff JSON

The first package diff report uses:

- `schemaVersion: "0.30"`;
- `kind: "air.packageDiff"`;
- `status: "passed" | "changed" | "failed"`;
- `oldPackageHash` and `newPackageHash`;
- `airAbiDelta`;
- `hostAbiDelta`;
- `capabilityDelta`;
- `effectDelta`;
- `outputContractDelta`;
- `factSchemaDelta`;
- `rowsetSchemaDelta`;
- `commandBufferDelta`;
- `generatedArtifactDelta`;
- `diagnostics`;
- `limitations`.

The `hostAbiDelta` values are package-required Host ABI values, not a
project-wide latest Host ABI declaration.

## Evidence Report Markdown

The first evidence report command writes deterministic Markdown:

```sh
node bin/airc.js evidence report <package-dir> --format markdown -o <file>
```

Optional inputs:

- `--host-evidence <json>`;
- `--conformance <json>`;
- `--benchmark <json>`;
- `--profile <id>`.

The report includes package identity, verification status, AIR ABI, required
Host ABI, package hash, capability/effect summaries, output intent usage, host
policy results, replay/conformance summary, diagnostics grouped by severity,
generated artifact freshness, and optional benchmark summary. It omits raw
private payloads and raw state/helper return values by default.

Replay summaries are derived from existing `air.conformance.report` JSON. They
include fixture id/kind, replay checksum, expected/observed output and command
counts, mismatch count and kinds, output IDs involved, state digest status when
available, and host interaction evidence status when host evidence is provided.
They do not expose command arguments, raw helper returns, or raw fixture data.

## P1

| Feature | v0.30 rule |
| --- | --- |
| Minimal HTML or Markdown evidence viewer | P1. Must be generated from stable evidence/report JSON. |
| Diff pretty-printer | P1. Human formatting only; no new diff semantics without stable JSON. |
| AI repair prompt export | P1. Suggestions only, no LSP code actions or automatic rewrites. |
| Evidence snapshot comparison across commits | P1. Must avoid raw private payloads and timestamps as proof. |

## Deferred / Rejected

| Feature | v0.30 status |
| --- | --- |
| Structured IO implementation | Deferred. |
| Tablegroups | Deferred. |
| LSP code actions | Deferred. |
| Real host adapters | Deferred. |
| New Host ABI | Deferred/rejected for v0.30. |
| Performance dashboard | Deferred. |
| New performance claims | Rejected. |
| Raw private payloads in human reports | Rejected. |

## Version Semantics

- Project milestone: `v0.30`.
- AIR ABI latest: remains `0.10`.
- Host ABI latest: remains `0.11`.
- Host ABI default/baseline: remains `0.10`.
- Host ABI `0.11` support remains limited to bounded `output.emit` packages.
- Host ABI expansion in v0.30: none.
- AIR ABI change in v0.30: none.
