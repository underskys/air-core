# AIR Core 0.52.0 Release Candidate

Status: technical stable release candidate, not yet tagged or published.
Independent bounded S5 exact-SHA QA passed at private commit
`48d414ab2349cc20e9b267b0656f128bb7557ee4` (tree
`bdc9d9bc97959679c1587c0e12e1f036d482b574`) and public commit
`4c62489f34a8149f758bc23dda892a031bae1023` (tree
`200daec43f66ff3afbf0682240306cf64e8d91f4`), with unpublished tarball
SHA-256 `627ced8529caa5c91c9fe80f6e315e82ace189aeacec19bd8230c1929d540433`.
The independent report SHA-256 is
`d842de4cb8f097ea8bbaa1ab8b73b164f4a74f03e2c2eda1cf4cab1061c442fd`.
The QA disposition was P0=0, P1=0, P2=2; the two nonblocking documentation
findings are clarified below. This status does not authorize publication.

Package candidate: `@underskys/air-core@0.52.0`

## Included

- Explicit legacy and typed source-profile routing. Legacy remains the default;
  typed-v0.51 must be selected explicitly.
- Candidate verified typed build/invoke APIs and a product-neutral,
  process-local runtime with bounded work intake, immutable module caching,
  fresh instances and host admission rechecks.
- Checked i64 runtime diagnostics, deterministic numerics evidence and the S4
  pressure corpus using frozen expected values.
- Installed-package checks that bind tarball bytes, npm lock integrity, package
  inventory, CLI behavior and public SDK resolution.
- Bounded S5 correction: reject unknown typed capabilities and post-return
  statements, accept frozen exact `const.i64` source, safely bound source-file
  CLI reads, and record observed browser versions instead of registry-only
  execution claims. Private compiler identity is also aligned at 0.52.0.
- In `typed-v0.51`, `const.i64 N` is admitted in typed initializer and return
  positions only, not directly in an operation such as
  `i64.checked_add const.i64 2, %a`. Bare canonical i64 operands remain valid.
  Formatting `const.i64 9007199254740993` emits `9007199254740993`: the
  value is exact and formatting is idempotent, but spelling is normalized.

## Boundaries

- AIR ABI `0.12` remains candidate-only and disabled unless explicitly enabled.
- AIR ABI `0.10` and `0.11` compatibility and Host ABI `0.10` and `0.11` are
  unchanged.
- The generic runtime is for pure typed modules. Its host callback is an
  admission boundary, not a CapabilityGrant, EffectReceipt or production
  effect-time authorization system.
- Typed-v0.51 does not admit user calls, loops, recursion, branches, imports or
  host effects. No dynamic WorkBound ABI, fixed-point type, u64 type or general
  f64 arithmetic profile is introduced.
- Swift/Wasm cross-host execution remains an honest HOLD. Native Swift probes
  do not substitute for it.
- Consumer replay, live shadow and model-authoring benchmarks remain separate
  evidence lanes and are not implied by language or package conformance.
- Exact Playwright Chromium rev 1234 executed in the macOS executor evidence;
  independent QA could not repeat that exact revision but did launch a wrong
  revision and verify the identity gate rejected it. Thus
  `BROWSER_EXECUTOR_EXACT_REVISION=PASS`,
  `BROWSER_IDENTITY_REJECTION_INDEPENDENT=PASS`, and
  `BROWSER_EXACT_REVISION_INDEPENDENT_REPLAY=NOT_RUN`. The missing independent
  positive replay is not a technical-release blocker absent an identity
  mismatch or browser-specific semantic failure.
- Live consumer shadow, Swift/Wasm cross-host admission, model benchmark,
  production effect authority and AIR ABI `0.12` promotion are not claimed.
- Broker-generation fencing is the only currently identified METR-derived
  pressure item that may justify a future versioned Host Contract or
  EffectReceipt proposal. No such change is authorized by this candidate:
  `BROKER_GENERATION_HOST_CONTRACT_CHANGE_PREAUTHORIZED=false`.

## Candidate Verification

Technical stable release preparation requires green source/package suites,
RC checks, exact tarball inventory and a fresh-project install. The accepted
bounded S5 QA covers the implementation tarball above; any new docs-only
tarball is a distinct artifact and must be inspected separately. This document
does not authorize merge, tag, npm publication, dist-tag mutation or deployment.
