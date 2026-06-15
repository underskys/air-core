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
- Keep public npm package identity on `@underskys/air-core`; private/dev review
  bundles must not overwrite public package metadata.

## Milestone Gates

| Milestone | Gate |
| --- | --- |
| v0.43 | Public installability plan, conformance public check, promise debt ledger, and request ledger validation. |
| v0.44.x | Public release hygiene, npm docs, README/package description checks, package surface review, and install smoke. |
| v0.45 | Math & Host Profile Planning/Audit milestone. Public sync requires public-clean cherry-pick; it is not an npm/public package release as-is. |
| v0.46 | Deterministic Math Stabilization: first implementation slice for accepted existing math behavior, conformance coverage, and caveat documentation. |
| v0.47 | AIR MathLab / host-composition demo: public-clean demo evidence that composes AIR deterministic logic with host-owned rendering/platform authority. |
| v0.48 | Host profile first slice / consumer replay: profile documentation, first public-safe replay fixture, and consumer evidence gate. |
| v0.49 | Beta/release readiness: release blocker review, package readiness, public claims audit, and freeze criteria. |
| v1.0 | Stable supported subset: no unresolved demo pressure in public docs; all known requests accepted/rejected/archived; no demo-specific Host ABI or Core API; consumer replay gate exists; supported behavior is documented and covered. |

## v0.45 Release Decision

The v0.45 dev/private review bundle at commit `ef24919` is accepted as a
completed planning/audit milestone for Math & Host Profile Roadmap. It is not
approved as an npm/public package release as-is because the bundle package
identity is stale (`air-core@0.44.0`) while public release state uses
`@underskys/air-core`.

Public v0.45 sync must be a scoped, public-clean cherry-pick into `air-core`.
It must not copy private/review artifacts, overwrite public package metadata,
change AIR ABI, change Host ABI, or claim implemented math operations that were
only planned or audited.

## v0.46 Math Stabilization Direction

v0.46 is the recommended first executable math stabilization slice. It should
stabilize and document already accepted math behavior before adding wider math
surface area. Initial scope is existing `f32.sin`, `f32.cos`, and `f32.sqrt`
semantics, deterministic conformance tests, approximation/range/error caveats,
and optional `std.math` examples or wrappers only when they reuse existing
semantics.

`exp`, `log`, `pow`, Host ABI changes, AIR ABI changes, or new language
features require separate review and are not part of the default v0.46 slice.

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
