# S5 bounded source and evidence correction

Status: independent exact-SHA S5 re-QA PASS at dev
`48d414ab2349cc20e9b267b0656f128bb7557ee4` (tree
`bdc9d9bc97959679c1587c0e12e1f036d482b574`) and public
`4c62489f34a8149f758bc23dda892a031bae1023` (tree
`200daec43f66ff3afbf0682240306cf64e8d91f4`). The unpublished
tarball SHA-256 was
`627ced8529caa5c91c9fe80f6e315e82ace189aeacec19bd8230c1929d540433`.
Independent report SHA-256:
`d842de4cb8f097ea8bbaa1ab8b73b164f4a74f03e2c2eda1cf4cab1061c442fd`.
Disposition: `PASS_AIR_V052_S5_BOUNDED_CORRECTION`; P0=0, P1=0, P2=2
(the documentation-precision findings addressed below).

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
- The frozen RFC's `const.i64 N` carrier is accepted for i64 in typed
  initializer and typed return positions only. It is not admitted as a direct
  arithmetic operand: `i64.checked_add const.i64 2, %a` fails closed. Bare
  canonical i64 literals remain accepted in arithmetic operands. The verifier
  checks BigInt boundaries and the existing lowerer emits exact values without
  JS Number conversion. This fixes one missing frozen spelling, not admission
  of future numeric operations or uniform carrier syntax.
- In `typed-v0.51`, formatting `const.i64 9007199254740993` produces
  `9007199254740993`. The value is exact and formatting is idempotent, but the
  carrier spelling is not preserved.

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
The independent S5 re-QA bound the accepted source and tarball identities above.
It reproduced installed-package probes but could not run exact Chromium rev
1234. Executor macOS evidence records positive execution at rev 1234;
independent QA launched a substituted wrong revision and verified that the
browser identity gate rejected it. Record these separately:

```text
BROWSER_EXECUTOR_EXACT_REVISION=PASS
BROWSER_IDENTITY_REJECTION_INDEPENDENT=PASS
BROWSER_EXACT_REVISION_INDEPENDENT_REPLAY=NOT_RUN
```

Exact-revision independent replay is not a technical-release blocker unless an
identity mismatch or browser-specific semantic failure is found. It is not an
independent positive browser PASS.

Consumer replay, live shadow and model benchmark are not run by this correction.
Swift/Wasm remains HOLD; technical stable release preparation is separate from
public release authorization. No unconditional product/readiness PASS is inferred.
