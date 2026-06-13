# AIR v0.38 Release Plan

Status: active execution/evidence implementation milestone

Theme: End-to-End Execution Proof & AI Eval Capture

v0.38 proves AIR's complete execution loop with a safe consumer-style package
and implements a deterministic AI-eval capture/import path. It does not
implement live provider calls, package composition, new Host ABI imports, or
external demo integration.

AIR ABI latest remains `0.10`.

Host ABI latest remains `0.11`, limited to bounded `output.emit`; Host ABI
`0.10` remains the default/baseline compatibility target for packages that do
not use `output.emit`.

v0.38 must not add live model APIs, API keys, network access, package
composition implementation, real host adapters, AIR ABI changes, Host ABI
changes, or external demo source changes.

## Purpose

v0.38 should prove the full product loop:

```text
host-shaped input
-> sanitized structured facts
-> AIR execution
-> bounded output intent
-> mock host policy
-> evidence report
```

It should also define how real model outputs can be captured outside CI,
imported as files, and measured deterministically by `eval-ai` without live
provider calls or nondeterministic network behavior.

## P0 Scope

| P0 item | Expected output |
| --- | --- |
| E2E execution proof | Implemented first slice through `airc run-proof <package-dir> --fixture <trace.json> --policy <policy.json> --json` for the lan-observer-style read-only package. |
| Runner path | Implemented structured fixture input, AIR package execution, bounded output intent capture, mock host policy simulation, and evidence report flow. |
| Killer test | Implemented deterministic stale-output mismatch test in `test/e2e_proof.test.js`. |
| `eval-ai` capture/import mode | Implemented file-import mode for sanitized captures through `airc eval-ai import <capture-dir> --json`; no live provider calls in CI. |
| Evidence report distinctions | Implemented optional E2E proof section with static validation, package policy validation, conformance replay, runtime execution proof, and host policy simulation. |
| Benchmark update | Implemented `benchmarks/e2e_lan_observer_readonly_basic/` with E2E proof, evidence report, mock host policy, output intent, and host crossing metrics where available. |
| No real network access | Explicit non-goal and gate requirement. |
| No secrets/tokens | Explicit non-goal and gate requirement. |
| No Host ABI expansion | AIR ABI remains `0.10`; Host ABI remains `0.11` bounded `output.emit` only. |

## P1 Scope

- optional external capture script template;
- manual live eval instructions outside CI;
- additional consumer proof packages.

## Deferred

- live model API integration;
- provider SDK dependency;
- package composition;
- real host adapter;
- network or OS access;
- production lan-observer integration;
- new Host ABI imports;
- AIR ABI changes;
- Host ABI changes.

## Hard Constraints

- replay/import mode only for CI;
- no API keys;
- no network access;
- no live provider calls;
- no provider SDK dependency in Core;
- no real host writes;
- no secrets, tokens, raw URLs, raw hostnames, raw MAC/IP values, or packet
  dumps in fixtures or reports;
- package composition remains planning/deferred;
- host policy remains mock/reference only;
- evidence remains deterministic and reviewable.

## Acceptance Criteria

v0.38 can close when:

- the E2E proof model and runner path are implemented for the first slice;
- the killer test catches stale expected output;
- AI eval capture/import semantics are implemented for sanitized file captures;
- evidence report section boundaries are implemented for E2E proof input;
- benchmark measurement updates are implemented for the E2E proof fixture;
- live provider calls, API keys, network access, package composition, and Host
  ABI expansion remain deferred;
- AIR ABI and Host ABI remain unchanged.

## Links

- [Feature Status v0.38](FEATURE_STATUS_v0.38.md)
- [End-to-End Execution Proof RFC](rfcs/v0.38-end-to-end-execution-proof.md)
- [AI Eval Capture/Import RFC](rfcs/v0.38-ai-eval-capture-import.md)
- [Consumer Evidence Corpus](../consumer_evidence/README.md)
- [Architecture Gates](ARCHITECTURE_GATES.md)
- [Version and ABI Policy](VERSION_AND_ABI_POLICY.md)
