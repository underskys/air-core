# AIR v0.35 Feature Status

Status: active read-only consumer proof milestone

Version target: v0.35

v0.35 adds the first read-only consumer proof and defines the product evidence
pack around it: lan-observer-style sanitized structured facts into
deterministic AIR diagnosis/recommendation output, with evidence, replay, diff,
benchmark, and AI-eval coverage.

The first Core fixture has landed under
`examples/lan_observer_readonly_package/`. It remains synthetic and read-only:
no real network access, host writes, secrets, raw hostnames, MACs, IPs, packet
dumps, or external demo code are included.

AIR ABI latest remains `0.10`. Host ABI latest remains `0.11`, limited to the
bounded `output.emit` first slice. Host ABI `0.10` remains the default/baseline
compatibility target for packages that do not use `output.emit`.

Related documents:

- [AIR v0.35 Release Plan](V0_35_RELEASE_PLAN.md)
- [Read-only Consumer Proof RFC](rfcs/v0.35-readonly-consumer-proof.md)
- [lan-observer Read-only Proof RFC](rfcs/v0.35-lan-observer-readonly-proof.md)
- [Examples, Demos, and Snapshots](EXAMPLES_AND_DEMOS.md)
- [AIR Strategy](AIR_STRATEGY.md)
- [Architecture Gates](ARCHITECTURE_GATES.md)
- [Version and ABI Policy](VERSION_AND_ABI_POLICY.md)

## Status Values

- `stable/active`: inherited behavior from earlier milestones.
- `implemented/P0`: implemented v0.35 P0 scope.
- `planned/P0`: accepted v0.35 P0 scope, not implemented yet.
- `planned/P1`: accepted lower-priority v0.35 planning scope.
- `deferred`: future work outside v0.35.
- `rejected`: not allowed without separate accepted scope.

## Stable / Active Baseline

| Feature | Layer | v0.35 status |
| --- | --- | --- |
| AIR ABI `0.10` | ABI | Stable/active. |
| Host ABI `0.10` | ABI | Stable/active and still supported. |
| Host ABI `0.11` bounded `output.emit` | Host ABI/package/runtime | Stable bounded first slice only. No expansion accepted for v0.35. |
| Bounded Structured IO first slice | package metadata/tooling/evidence | Stable/active from v0.32. |
| AI authoring eval and verifier safety surfaces | tooling/evidence/tests | Stable/active from v0.33. |
| Agent finish and review workflow hygiene | tooling/process/docs | Stable/active from v0.34. |

## v0.35 P0

| Feature | Layer | v0.35 status |
| --- | --- | --- |
| lan-observer-style read-only package fixture | example/proof | Implemented/P0 in `examples/lan_observer_readonly_package/`. |
| Sanitized structured facts schema | package metadata/schema | Implemented/P0 in `examples/lan_observer_readonly_package/schemas/`. Scalar-only, fixed bounds, no raw private/network identifiers. |
| AIR diagnosis/recommendation module | example or fixture | Implemented/P0 in `examples/lan_observer_readonly_package/module.air`. Deterministic AIR-owned bounded decision logic only. |
| Bounded output intent path | output contract/command buffer/Host ABI profile | Implemented/P0 with output contract plus command buffer metadata. No new Host ABI imports. |
| Mock host policy fixture | host fixture/test data | Implemented/P0 via synthetic trace and mock host policy. No real network/OS access. |
| Evidence report golden | evidence report | Implemented/P0 as `examples/lan_observer_readonly_package/expected/evidence_report.md`. |
| Package diff golden | evidence review surface | Implemented/P0 as `examples/lan_observer_readonly_package/expected/package_diff_output_contract.summary.json`; tests compare old/new proof copies with output contract delta. |
| Replay/conformance fixture | conformance/replay | Implemented/P0 as `examples/lan_observer_readonly_package/traces/pass.json`. |
| Unsafe-to-safe rejection story | policy/tests/docs | Implemented/P0 for raw host authority rejection; additional narrative can be expanded if needed. |
| Benchmark fixture using benchmark runner | benchmark/product evidence | Implemented/P0 as `benchmarks/lan_observer_readonly_basic/`. Uses existing v0.29 runner and avoids performance claims beyond measured metrics. |
| AI authoring eval case using eval-ai replay | eval/product evidence | Implemented/P0 as `lan_observer_readonly_proof` in `evals/ai_authoring/`. Deterministic replay-only; no live model calls. |
| README quickstart / product explanation | docs/example | Implemented/P0 in package README. |
| Evidence/replay/report expectations | evidence/conformance/report | Implemented/P0 for the proof fixture; product evidence pack hardening continues through benchmark, AI eval, and optional diff golden. |
| No-write/no-secret/no-real-network constraints | policy/package-check/docs/tests | Implemented/P0 in README, mock policy, and tests. |
| Package diff workflow | evidence review surface | Implemented/P0 in tests by comparing old/new fixture copies with output contract changes. |
| Acceptance criteria | release/check policy | Implemented/P0 in `test/lan_observer_readonly.test.js`. Blocks raw authority, raw private data, and ABI drift for the proof fixture. |

## v0.35 P1

| Feature | Layer | v0.35 status |
| --- | --- | --- |
| External `lan-observer-air` adapter planning | external/host planning | Planned/P1. No external demo/code changes in P0. |
| Rust/Wasmtime host fixture planning | host/test planning | Planned/P1 if synthetic and read-only. |
| FlowDesk policy secondary proof | example/planning | Planned/P1. Secondary proof only after lan-observer-style path is safe. |

## Deferred / Rejected

| Feature | v0.35 status |
| --- | --- |
| Real network scan | Deferred/rejected for v0.35 P0. |
| Real packet capture | Deferred/rejected for v0.35 P0. |
| Real device mutation | Rejected. |
| Secrets/tokens/credentials | Rejected. |
| Raw hostnames/MACs/IPs/raw URLs/private hostnames | Rejected unless transformed into sanitized ids before AIR. |
| Production observability | Deferred. |
| Package registry | Deferred. |
| New Host ABI | Rejected for v0.35. |
| New Host ABI imports | Rejected for v0.35. |
| Host writes or auto-remediation | Rejected. |
| External demo changes | Rejected unless separately requested. |
| Real host adapter | Deferred. |
| Tablegroups | Deferred. |
| Declared pools | Deferred. |

## Version Semantics

- Project milestone: `v0.35`.
- AIR ABI latest: remains `0.10`.
- Host ABI latest: remains `0.11`.
- Host ABI default/baseline: remains `0.10`.
- Host ABI `0.11` support remains limited to bounded `output.emit` packages.
- Host ABI expansion in v0.35: none.
- AIR ABI change in v0.35: none.
