# AIR v0.43 Release Plan

Status: active public-alpha governance milestone

Theme: Public Install, Conformance, and Promise Debt Ledger

v0.43 prepares AIR for public alpha by making installability, conformance
reproduction, and request/promise governance explicit. It follows v0.42
resource/reviewPolicy planning and public-clean repository work.

AIR ABI latest remains `0.10`. Host ABI latest remains `0.11`, limited to
bounded `output.emit`. Host ABI `0.10` remains the default/baseline target for
packages that do not use `output.emit`.

## Purpose

AIR has strong Core verifier, evidence, package-check, public package, and
consumer evidence infrastructure. v0.43 closes the governance gap around public
installation, conformance reproduction, and demo pressure routing.

The formal request pipeline must be active release infrastructure, not a
decorative directory.

## P0 Scope

| P0 item | Expected v0.43 outcome |
| --- | --- |
| Public installability plan | Document `npm pack --dry-run`, package surface inspection, local tarball/global install smoke, `npx` feasibility, `airc --version`, public example check, evidence report example, and `run-proof` example when available. |
| Public conformance plan | Document public repository conformance commands, air-tests claim policy, no-private-path expectations, and public result format. |
| npm package files plan | Document package include/exclude policy for Core/spec/CLI/conformance and launch-safe examples only. |
| Promise debt ledger | Summarize known demo/cross-demo pressure in `docs/PROMISE_DEBT.md`. |
| Request ledger import | Ensure known pressure from `docs/abi-requests/`, consumer evidence, examples, benchmarks, and public demo audit has formal request entries. |
| Request ledger validation | Provide `check:request-ledger` / `scripts/check_request_ledger.js` so release checks fail when pressure bypasses formal governance. |
| ROADMAP update | Record v0.44-v0.45 demo migrations and v0.46 consumer replay gate. |
| No feature implementation | Keep v0.43 scoped to public install/check planning and request governance. |

## P1

- public install smoke automation;
- npm package dry-run artifact summary;
- public conformance Markdown/HTML summary;
- request ledger report in review bundle;
- clearer contributor-facing request intake docs.

## Deferred

- npm publish;
- playground implementation;
- MCP sandbox demo implementation;
- live AI eval provider mode;
- chrome-extension Host ABI;
- new Host ABI imports;
- new Core features;
- external demo source changes.

## Hard Constraints

- Promise debt is not a reason to add features.
- Demo-specific, game-specific, chrome-extension-specific, or product-specific
  requests are rejected/kit/project/post-1.0 unless a generic Core need is
  proven.
- No Host ABI expansion before 1.0 unless separately approved.
- No AIR ABI change.
- No npm publish in v0.43.
- No external demo implementation in v0.43.

## Roadmap Gates

v0.43 establishes the following downstream gates:

- v0.44: playground plus demo migration pass 1, including one grid/board demo
  migrated to v0.41 pools and one output/event demo migrated to the command
  buffer/output contract pattern;
- v0.45: MCP sandbox demo plus demo migration pass 2, including pure-helper
  Wasm golden fixture convention and reusable demo verify/replay command
  pattern;
- v0.46: consumer replay gate P0 for lan-observer, AirOps,
  Airtris/Minesweeper if public-clean, FlowDesk policy fixture if
  public-clean, and public air-tests suite when reproducible;
- v0.47: maintainer readiness, contributor path, diagnostics docs, and good
  first issues;
- v0.48: beta freeze with no new Core semantics unless release-blocking;
- v0.49: release candidate;
- v1.0: no unresolved demo pressure in public docs, all known requests
  accepted/rejected/archived, no demo-specific Host ABI or Core API, consumer
  replay gate exists, and at least one demo migrated from workaround to a
  released AIR feature.

## Acceptance Criteria

v0.43 is complete when:

- public installability checkpoint docs exist;
- conformance public checkpoint docs exist;
- npm package files plan exists;
- promise debt ledger exists and links formal request entries;
- request ledger validation emits deterministic JSON and is wired into release
  checks;
- `ROADMAP.md` records v0.43-v1.0 gates;
- AIR ABI remains `0.10`;
- Host ABI remains unchanged.

## Links

- [Feature Status v0.43](FEATURE_STATUS_v0.43.md)
- [Public Install Check](public_release/PUBLIC_INSTALL_CHECK.md)
- [Conformance Public Check](public_release/CONFORMANCE_PUBLIC_CHECK.md)
- [npm Package Files Plan](public_release/NPM_PACKAGE_FILES_PLAN.md)
- [Promise Debt Ledger](PROMISE_DEBT.md)
- [Request Ledger](../requests/README.md)
- [Architecture Gates](ARCHITECTURE_GATES.md)
- [Version and ABI Policy](VERSION_AND_ABI_POLICY.md)
