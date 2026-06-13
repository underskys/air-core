# AIR v0.33 Feature Status

Status: active executable/test/evidence milestone

Version target: v0.33

v0.33 deepens the v0.32 AI authoring eval and verifier safety surfaces. It is
not planning-only: P0 work should add deterministic eval corpus coverage,
repairability evidence, verifier safety coverage, and fuzz-safety expansion.

No v0.33 work may add live AI provider calls, API keys, network access,
nondeterministic CI behavior, automatic code actions, automatic repair, new
language syntax, or Host ABI expansion.

AIR ABI latest remains `0.10`. Host ABI latest remains `0.11`, limited to the
bounded `output.emit` first slice. Host ABI `0.10` remains the default/baseline
compatibility target for packages that do not use `output.emit`.

Related documents:

- [AIR v0.33 Release Plan](V0_33_RELEASE_PLAN.md)
- [AI Authoring Eval Deepening RFC](rfcs/v0.33-ai-authoring-eval-deepening.md)
- [Verifier Safety Deepening RFC](rfcs/v0.33-verifier-safety-deepening.md)
- [API Gates v0.33](API_GATES_v0_33.md)
- [AIR v0.32 Release Plan](V0_32_RELEASE_PLAN.md)
- [AIR v0.32 Feature Status](FEATURE_STATUS_v0.32.md)
- [Version and ABI Policy](VERSION_AND_ABI_POLICY.md)

## Status Values

- `stable/active`: inherited behavior from earlier milestones.
- `planned/P0`: accepted v0.33 P0 scope, not necessarily implemented yet.
- `planned/P1`: accepted lower-priority v0.33 scope.
- `deferred`: future work outside v0.33.
- `rejected`: not allowed without a separate accepted plan or architecture gate.

## Stable / Active Baseline

| Feature | Layer | v0.33 status |
| --- | --- | --- |
| AIR ABI `0.10` | ABI | Stable/active. |
| Host ABI `0.10` | ABI | Stable/active and still supported. |
| Host ABI `0.11` bounded `output.emit` | Host ABI/package/runtime | Stable bounded first slice only. No expansion accepted for v0.33. |
| Bounded structured IO first slice | package/tooling/evidence | Stable/active from v0.32. Scalar-only, fixed-shape, bounded-row. |
| AI authoring eval replay command | tooling/evidence | Stable/active from v0.32. Replay-only. |
| Verifier safety contract | docs/tooling | Stable/active from v0.32. Does not claim formal verification. |
| Deterministic fuzz-safety scaffold | tooling/tests | Stable/active from v0.32. Seed-driven and deterministic. |

## v0.33 P0

| Feature | Layer | v0.33 status |
| --- | --- | --- |
| Expanded deterministic AI authoring eval corpus | eval/tooling | Implemented/P0 first expansion. Replay fixtures cover valid scalar, fixed state, `output.emit`, structured IO, forbidden surfaces, and repairable invalid cases. |
| Structured IO eval cases | eval/tooling | Implemented/P0 first expansion. Includes valid bounded structured IO and JSON/object rejection cases. |
| `output.emit` eval cases | eval/tooling | Implemented/P0 first expansion. Includes valid static handle/id path and dynamic `output_id` rejection. |
| Fixed state eval cases | eval/tooling | Implemented/P0 first expansion. |
| Forbidden surface eval cases | eval/tooling/gates | Implemented/P0 first expansion for runtime JSON, dynamic objects/maps, host object handles, dynamic `output_id`, raw host authority, and string payload drift. |
| Repairability metrics | eval/report | Implemented/P0 baseline. Reports first-pass verify, first-pass package-check, repair success at 1 and 3, average repair iterations, forbidden surface rate, top diagnostics, and diagnostic coverage. |
| Eval expected-constraint validation | eval/tooling | Implemented/P0. `expected/constraints.json` records expected statuses, required diagnostic codes, repair success step, and forbidden surface category; replay fails on mismatches. |
| Repair hint normalization | diagnostics/docs/tooling | Implemented/P0 first slice for current eval top diagnostics and nearby output/structured/generated authority codes. |
| Diagnostic repair hint coverage | eval/report | Implemented/P0 first slice. Eval reports include `diagnosticRepairHintCoverage` and per-case `diagnosticDetails` with stable hints where available. |
| Expanded fuzz/safety scaffold | tests/tooling | Implemented/P0 first expansion for arithmetic, fixed state, `output.emit`, structured IO schema cases, and generated handles. Includes valid and invalid cases per family. |
| Verifier safety coverage report | evidence/report | Implemented/P0 first slice through `air.verifierSafetyFuzzReport` family summaries, pass/fail/skip counts, diagnostics, and `minimizedCase`. |
| Eval regression report | evidence/report | Implemented/P0 first slice via `airc eval-ai evals/ai_authoring --json --regression`. Reports deterministic replay metrics, no-baseline `previousMetrics: null`, empty deltas, top diagnostics, repair hint coverage, and explicit limitations. |
| v0.33 API gates | tooling/checks | Implemented/P0. `npm run check:api-gates:v0.33` protects replay/fuzz boundaries against live AI calls, API key loading, network access, nondeterminism, code actions, automatic repair, formal verification overclaims, Host ABI expansion, and tablegroup/pool implementation drift. |

## v0.33 P1

| Feature | Layer | v0.33 status |
| --- | --- | --- |
| Live model eval design | docs/RFC | Planned/P1 design only. No live calls. |
| Model-by-model comparison design | docs/RFC | Planned/P1 design only. No provider integration. |
| AI repair transcript viewer | tooling/UI | Planned/P1. |
| Deeper fuzz corpus | tests/tooling | Planned/P1. |
| Parser roundtrip fuzz planning | docs/tests | Planned/P1 planning only. |

## Deferred / Rejected

| Feature | v0.33 status |
| --- | --- |
| Live AI provider calls | Deferred/rejected for P0. |
| API keys | Rejected. |
| Network access | Rejected. |
| Nondeterministic CI | Rejected. |
| Automatic code actions | Deferred. |
| Automatic repair | Deferred. |
| Formal verification claims | Rejected. |
| New language syntax | Deferred. |
| Structured IO expansion | Deferred. |
| Tablegroups implementation | Deferred. |
| Declared pools | Deferred. |
| Runtime JSON/object model | Rejected. |
| Host object handles | Rejected. |
| Host ABI expansion | Deferred/rejected for v0.33. |

## Version Semantics

- Project milestone: `v0.33`.
- AIR ABI latest: remains `0.10`.
- Host ABI latest: remains `0.11`.
- Host ABI default/baseline: remains `0.10`.
- Host ABI `0.11` support remains limited to bounded `output.emit` packages.
- Host ABI expansion in v0.33: none.
- AIR ABI change in v0.33: none.
