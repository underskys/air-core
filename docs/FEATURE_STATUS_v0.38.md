# AIR v0.38 Feature Status

Status: active execution/evidence implementation milestone

Version target: v0.38

v0.38 implements the End-to-End Execution Proof first slice and safe AI-eval
capture/import. Imported captures are scored deterministically from files
without live provider calls, network access, API keys, package composition
implementation, new language features, or ABI changes.

AIR ABI latest remains `0.10`. Host ABI latest remains `0.11`, limited to the
bounded `output.emit` first slice. Host ABI `0.10` remains the default/baseline
compatibility target for packages that do not use `output.emit`.

Related documents:

- [AIR v0.38 Release Plan](V0_38_RELEASE_PLAN.md)
- [End-to-End Execution Proof RFC](rfcs/v0.38-end-to-end-execution-proof.md)
- [AI Eval Capture/Import RFC](rfcs/v0.38-ai-eval-capture-import.md)
- [Architecture Gates](ARCHITECTURE_GATES.md)
- [Version and ABI Policy](VERSION_AND_ABI_POLICY.md)

## Status Values

- `stable/active`: inherited behavior from earlier milestones.
- `planned/P0`: accepted v0.38 P0 planning scope.
- `planned/P1`: accepted lower-priority v0.38 planning scope.
- `deferred`: future work outside v0.38.
- `rejected`: not allowed without separate accepted scope.

## Stable / Active Baseline

| Feature | Layer | v0.38 status |
| --- | --- | --- |
| AIR ABI `0.10` | ABI | Stable/active. |
| Host ABI `0.10` | ABI | Stable/active and still supported. |
| Host ABI `0.11` bounded `output.emit` | Host ABI/package/runtime | Stable bounded first slice only. No expansion accepted for v0.38. |
| Bounded Structured IO first slice | package metadata/tooling | Stable from v0.32. |
| AI authoring eval replay mode | eval/tooling | Stable from v0.33. |
| Consumer Evidence Corpus | evidence/process | Stable from v0.36. |
| Readonly tablegroups first slice | AIR source/verifier/lowering | Stable from v0.37. |

## v0.38 P0

| Feature | Layer | v0.38 status |
| --- | --- | --- |
| E2E execution proof for lan-observer-style package | execution/evidence | Implemented/P0 through `airc run-proof <package-dir> --fixture <trace.json> --policy <policy.json> --json`. Executes the package module against sanitized structured facts. |
| Structured input fixture to AIR execution path | runner/conformance | Implemented/P0 using the lan-observer read-only batch fixture and scalar exported decision functions. |
| Output intent capture and mock host policy simulation | host policy/evidence | Implemented/P0. Captures one bounded scalar output intent and runs the existing mock host policy evidence path. |
| Evidence report for full loop | evidence report | Implemented/P0 through optional `--e2e-proof <json>` input to Markdown evidence reports. |
| Killer test for stale expected output | tests/conformance | Implemented/P0. `test/e2e_proof.test.js` fails deterministically when expected output/command data diverges from runtime execution. |
| `eval-ai` capture/import mode | eval/tooling | Implemented/P0 through `airc eval-ai import <capture-dir> --json`. File-import only; no live provider calls in CI. |
| Evidence report section distinctions | evidence report | Implemented/P0. E2E reports distinguish static validation, package policy validation, conformance replay, runtime execution proof, and host policy simulation. |
| Benchmark execution-path timing | benchmark | Implemented/P0 through `benchmarks/e2e_lan_observer_readonly_basic/`. Reports E2E proof, evidence report, mock host policy, output intent count, and host crossing metrics where available. |
| No real network/secrets/API keys | gates/process | Implemented/P0 by fixture policy and tests. The E2E runner reads only checked-in files and does not access network, OS devices, or secrets. |
| ABI decision | ABI policy | Implemented/P0. AIR ABI remains `0.10`; Host ABI unchanged. |

## v0.38 P1

| Feature | Layer | v0.38 status |
| --- | --- | --- |
| External capture script template | eval/tooling | Planned/P1. |
| Manual live eval instructions outside CI | docs/process | Planned/P1. |
| Additional consumer proof packages | evidence/corpus | Planned/P1. |

## Deferred / Rejected

| Feature | v0.38 status |
| --- | --- |
| Live model API integration | Deferred. |
| Provider SDK dependency | Deferred/rejected for Core CI. |
| API keys in Core or CI | Rejected. |
| Network access in CI | Rejected. |
| Package composition implementation | Deferred. |
| Real host adapter | Deferred. |
| Network/OS access | Rejected for P0. |
| Production lan-observer integration | Deferred. |
| New Host ABI imports | Rejected for v0.38. |
| AIR ABI change | Rejected for v0.38. |
| Host ABI change | Rejected for v0.38. |

## Version Semantics

- Project milestone: `v0.38`.
- AIR ABI latest: remains `0.10`.
- Host ABI latest: remains `0.11`.
- Host ABI default/baseline: remains `0.10`.
- Host ABI `0.11` support remains limited to bounded `output.emit` packages.
- Host ABI expansion in v0.38: none.
- AIR ABI change in v0.38: none.
