# Roadmap

This roadmap is intentionally modest for public alpha. It records near-term
engineering direction, not a promise of dates or scope.

## Current Public Alpha Focus

- Keep AIR Core small and reviewable.
- Preserve AIR ABI `0.10`.
- Preserve Host ABI `0.11` as the latest host surface, limited to bounded
  `output.emit`.
- Prepare public installability, conformance reproduction, request governance,
  demo migration, and consumer replay gates before widening public scope.

## Milestone Gates

| Milestone | Gate |
| --- | --- |
| v0.43 | Public installability plan, conformance public check, promise debt ledger, and request ledger validation. |
| v0.44 | Playground and demo migration pass 1: migrate one grid/board demo to v0.41 pools; migrate one output/event demo to command buffer/output contract pattern. |
| v0.45 | MCP sandbox demo and demo migration pass 2: pure-helper Wasm golden fixture convention plus reusable demo verify/replay command pattern. |
| v0.46 | Consumer replay gate P0: replay lan-observer, AirOps, Airtris/Minesweeper if public-clean, FlowDesk policy fixture if public-clean, and the public air-tests suite when reproducible. |
| v0.47 | Maintainer readiness: contributor path, diagnostics docs, and good first issues. |
| v0.48 | Beta freeze: no new Core semantics unless needed for a release blocker. |
| v0.49 | Release candidate. |
| v1.0 | No unresolved demo pressure in public docs; all known requests accepted/rejected/archived; no demo-specific Host ABI or Core API; consumer replay gate exists; at least one demo migrated from workaround to released AIR feature. |

## v0.43 Public Alpha Governance

v0.43 is a public-alpha governance milestone. It focuses on:

- public installability plan;
- conformance public check;
- npm package file plan;
- promise debt ledger;
- request ledger validation.

It does not publish to npm, add language features, change AIR ABI, change Host
ABI, add Host ABI imports, implement chrome-extension Host ABI, or move
demo-specific APIs into Core.

## Demo Migration Direction

Demo migration is explicitly migration to already released AIR features:

- grid/board state should use fixed state or v0.41 declared pools where that
  is the right bounded shape;
- output/event behavior should use output contracts, command buffers, generated
  output handles, or bounded `output.emit` where appropriate;
- pure helper Wasm should get a reproducible verify/build/golden convention;
- demo replay should use small public-clean fixtures and avoid raw host data,
  private logs, large media, and external services.

Demo migration is not approval for game-specific Core APIs, browser/Vite
bundling, chrome-extension Host ABI, raw host authority, package registry,
runtime JSON/object model, dynamic maps, GC, or host object handles.

## Request Governance

AIR Core accepts generic mechanisms through the formal request ledger under
`requests/`, RFCs, release plans, and gates. Consumer evidence and demo pressure
are useful intake, but they do not define Core semantics, AIR ABI, Host ABI, or
public package behavior.

Known demo pressure is summarized in [PROMISE_DEBT.md](docs/PROMISE_DEBT.md).
New pressure must not live only in demo docs or `docs/abi-requests/`; it needs
a formal accepted, rejected, archived, or inbox request entry before it can
affect release scope.

## Deferred

- package registry;
- native installers;
- production host adapters;
- browser/Vite host bundling;
- asset pipeline rewrites;
- demo-specific Core APIs;
- runtime JSON/object model;
- dynamic maps/GC;
- host object handles;
- chrome-extension Host ABI before 1.0;
- Host ABI expansion;
- AIR ABI expansion without explicit review.

## Alpha Policy

Alpha releases may break APIs or behavior. Breaking semantic changes require a
migration note. AIR ABI changes require an explicit AIR ABI version bump. Host
ABI changes require a compatibility matrix update.
