# S5 bounded source and evidence correction

Status: implementation candidate awaiting independent exact-SHA re-QA.

This correction addresses the September 28 advisory probes and three remaining
S5 P2 items. It does not authorize merge, tag, publish, deployment or future
typed grammar. AIR ABI 0.10/0.11 and candidate-only 0.12, Host ABI, canonical
codecs and frozen expected fixtures remain unchanged.

## Source admission

- Typed capability declarations use the same known capability set as legacy
  verification. Unknown names fail with `air.capability.unknown`. Known names
  remain declaration metadata, not grants or executable host effects; the
  typed subset still admits no imports/effects.
- Any statement after a function return fails with
  `air.control.statement_after_return`, including a second return.
- The frozen RFC's `const.i64 DECIMAL` carrier is accepted only for i64 and
  normalized to the existing exact decimal atom. The verifier checks BigInt
  boundaries and the existing lowerer emits it without JS Number conversion.
  Existing bare decimal syntax and formatter output are preserved. This fixes
  one missing frozen spelling, not admission of future numeric operations.

## Operational identity and intake

- Private compiler, private package and lockfile version are 0.52.0. The
  private workspace remains nonpublishable. This is not an ABI/version-lane
  promotion and does not retroactively change historical evidence.
- Source-file CLI commands, including `format`, open nonblocking, inspect the
  same descriptor, reject nonregular files, and bound reads to 4 MiB including
  growth during reading. Invalid paths, missing files, read errors and excess
  size have stable AIR CLI codes instead of native errno stacks. This file
  intake limit is not a WorkBound/authority proof. Explicit `format --stdin`
  retains its existing stream behavior and is outside this file-read change.
- Browser identity tooling launches both default headless shell and Chromium
  channel, records observed versions, hashes the actual spawned executable,
  and rejects version mismatch. Registry revisions are labeled expectations;
  neither directory names nor a version match attest download provenance.
  The browser runtime probe also records its observed version and compares
  it to the lockfile-installed registry. Historical substituted-browser runs
  are not relabeled as exact-revision runs.

## Verification boundary

`test/v052_bounded_correction.test.js` covers source and safe-builder rejection,
exact compiled i64 boundaries, bare/carrier Wasm byte equivalence, formatter
roundtrip, and mismatched observed browser identity. CLI tests cover invalid
paths, device/FIFO rejection, source-size limits and supported regular symlinks.
Full suites, installed-package probes and actual browser observations must be
bound to the new terminal commits and tarball before independent re-QA.

Consumer replay, live shadow and model benchmark are not run by this correction.
Swift/Wasm remains HOLD; no unconditional release/readiness PASS is inferred.
