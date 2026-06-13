# AIR v0.43 Feature Status

Status: active public-alpha governance milestone

Version target: v0.43

v0.43 covers Public Install, Conformance, and Promise Debt Ledger work. It is a
docs/check/governance milestone, not a language or ABI milestone.

AIR ABI latest remains `0.10`. Host ABI latest remains `0.11`, limited to
bounded `output.emit`; Host ABI `0.10` remains the default/baseline target for
packages that do not use `output.emit`.

Related documents:

- [AIR v0.43 Release Plan](V0_43_RELEASE_PLAN.md)
- [Public Install Check](public_release/PUBLIC_INSTALL_CHECK.md)
- [Conformance Public Check](public_release/CONFORMANCE_PUBLIC_CHECK.md)
- [Conformance Reproduction Summary](public_release/CONFORMANCE_REPRODUCTION_SUMMARY.md)
- [npm Package Files Plan](public_release/NPM_PACKAGE_FILES_PLAN.md)
- [npm Pack Dry-Run Summary](public_release/NPM_PACK_DRY_RUN_SUMMARY.md)
- [Promise Debt Ledger](PROMISE_DEBT.md)
- [Request Ledger](../requests/README.md)
- [Architecture Gates](ARCHITECTURE_GATES.md)
- [Version and ABI Policy](VERSION_AND_ABI_POLICY.md)

## Status Values

- `stable/active`: inherited behavior from earlier milestones.
- `documented/P0`: v0.43 public-alpha checkpoint or ledger doc exists.
- `implemented/P0`: v0.43 local validation/check tooling exists.
- `planned/P1`: lower-priority follow-up.
- `deferred`: future work outside v0.43.
- `rejected`: not allowed without separate accepted scope.

## Stable / Active Baseline

| Feature | Layer | v0.43 status |
| --- | --- | --- |
| AIR ABI `0.10` | ABI | Stable/active. |
| Host ABI `0.10` | ABI | Stable/active and still supported. |
| Host ABI `0.11` bounded `output.emit` | Host ABI/package/runtime | Stable bounded first slice only. No expansion accepted for v0.43. |
| Consumer Evidence Corpus | evidence/tooling | Stable from v0.36. |
| Executable Package Composition first slice | package/linking/evidence | Stable from v0.39. |
| Declared fixed-capacity pools first slice | AIR source/verifier/lowering | Stable from v0.41. |
| Resource Validators & ReviewPolicy Hard Gates planning | package-check/reviewPolicy docs | Stable planning output from v0.42. |

## v0.43 P0

| Feature | Layer | v0.43 status |
| --- | --- | --- |
| Public installability plan | public release docs | Documented/P0. |
| Conformance public check | public release docs | Documented/P0. |
| Conformance reproduction summary | public release docs/checkpoint | Implemented/P0 for repository commands; independent `air-tests 74/74` remains pending public reproduction. |
| npm package files plan | public release docs/package surface | Documented/P0. |
| npm package dry-run summary | public release docs/package surface | Implemented/P0. |
| Promise debt ledger | request governance | Documented/P0. |
| Request ledger import | request governance | Implemented/P0 for known public-alpha pressure. |
| Request ledger validation | scripts/release checks | Implemented/P0 through `check:request-ledger`. |
| ROADMAP public-alpha gates | release docs | Documented/P0. |
| No feature implementation | release boundary | Active/P0. |

## P1

| Feature | v0.43 status |
| --- | --- |
| Public install smoke automation | Planned/P1. |
| Public conformance HTML/Markdown summary | Planned/P1. |
| Request ledger report in review bundle | Planned/P1. |
| Contributor-facing request intake polish | Planned/P1. |

## Deferred / Rejected

| Feature | v0.43 status |
| --- | --- |
| npm publish | Deferred. |
| Playground implementation | Deferred to v0.44. |
| MCP sandbox demo implementation | Deferred to v0.45. |
| Live AI eval provider mode | Deferred. |
| Chrome-extension Host ABI | Rejected before 1.0 unless separately approved. |
| New Host ABI imports | Rejected for v0.43. |
| New Core features | Rejected for v0.43. |
| External demo source changes | Rejected for v0.43. |

## Roadmap Gates

| Milestone | Gate |
| --- | --- |
| v0.44 | Playground and demo migration pass 1: one grid/board demo to v0.41 pools; one output/event demo to command buffer/output contract pattern. |
| v0.45 | MCP sandbox demo and demo migration pass 2: pure-helper Wasm golden fixture convention; reusable demo verify/replay command pattern. |
| v0.46 | Consumer replay gate P0: lan-observer, AirOps, Airtris/Minesweeper if public-clean, FlowDesk policy fixture if public-clean, public air-tests suite when reproducible. |
| v0.47 | Maintainer readiness, contributor path, diagnostics docs, good first issues. |
| v0.48 | Beta freeze; no new Core semantics unless release blocker. |
| v0.49 | RC. |
| v1.0 | No unresolved demo pressure in public docs; all known requests accepted/rejected/archived; no demo-specific Host ABI or Core API; consumer replay gate exists; at least one demo migrated from workaround to released AIR feature. |

## Version Semantics

- Project milestone: `v0.43`.
- AIR ABI latest: remains `0.10`.
- Host ABI latest: remains `0.11`.
- Host ABI default/baseline: remains `0.10`.
- Host ABI `0.11` support remains limited to bounded `output.emit` packages.
- Host ABI expansion in v0.43: none.
- AIR ABI change in v0.43: none.
