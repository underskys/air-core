# AIR Core 0.52.0 Release Candidate

Status: public-clean candidate awaiting exact-tarball independent QA. It has not
been tagged or published.

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
- Broker-generation fencing is the only currently identified METR-derived
  pressure item that may justify a future versioned Host Contract or
  EffectReceipt proposal. No such change is authorized by this candidate:
  `BROKER_GENERATION_HOST_CONTRACT_CHANGE_PREAUTHORIZED=false`.

## Candidate Verification

The candidate must pass the complete repository suite, RC checks, exact
tarball inventory and a fresh-project install before independent review. This
document does not authorize merge, tag, npm publication, dist-tag mutation or
deployment.
