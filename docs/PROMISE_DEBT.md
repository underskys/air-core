# AIR Promise Debt Ledger

Status: public-alpha request governance summary.

This document summarizes known demo and cross-demo pressure that has been
imported into the formal request ledger under `requests/`. It does not approve
new language features, AIR ABI changes, Host ABI changes, demo-specific Core
APIs, or public package surface changes by itself.

The ledger source of truth is:

- `requests/accepted/`
- `requests/rejected/`
- `requests/archive/`
- `requests/inbox/`

Future pressure must not live only in demo docs, `docs/abi-requests/`,
consumer evidence, examples, benchmarks, or raw prompt/review notes. Public
release checks use `node scripts/check_request_ledger.js` to fail when known
pressure bypasses the ledger.

## Summary

| Category | Count | Notes |
| --- | ---: | --- |
| Implemented / closed by language, Core, stdlib, or package tooling | 9 | Generic pressure already has a bounded AIR answer. |
| Demo migration debt | 2 | Public demo cleanup and pure-helper golden conventions remain outside Core semantics. |
| Rejected / kit / post-1.0 | 14 | Demo-specific, browser-specific, game-specific, or host-authority requests are not Core commitments. |
| Process debt | 1 | Keep request ledger validation wired into release checks. |
| Inbox unresolved | 0 | No known public-alpha request is intentionally left undecided. |

## Closed By Language/Core

These requests are closed by existing generic AIR surfaces. They do not create
additional public alpha promises beyond the linked implementation scope.

| Pressure | Formal request | Decision |
| --- | --- | --- |
| Bounded mutable storage / scalar slot-family pressure | [Bounded Mutable Storage](../requests/accepted/bounded-mutable-storage.md) | Implemented by fixed state and v0.41 declared fixed-capacity pools. |
| Static tables / tablegroups | [Static Tables And Readonly Tablegroups](../requests/accepted/static-tables-tablegroups.md) | Implemented by static tables and v0.37 readonly tablegroups. |
| Color/channel arithmetic | [Color And Channel Arithmetic](../requests/accepted/color-channel-arithmetic.md) | Implemented by deterministic `std.color` helpers. |
| Output contracts / command buffers / handles / bounded output intent | [Event And Output Intent Surface](../requests/accepted/event-intent-surface.md) | Implemented by output contracts, command buffers, generated handles, mock-host policy, and bounded `output.emit`. |
| Consumer evidence intake | [Consumer Evidence Corpus](../requests/accepted/consumer-evidence-corpus.md) | Implemented by v0.36 corpus, schemas, validator, bundle generator, and seeded entries. |
| Executable package composition | [Executable Package Composition](../requests/accepted/executable-package-composition.md) | Implemented by v0.39 authored/executable graph first slice. |
| Generated handle freshness | [Generated Handle Freshness](../requests/accepted/generated-handle-freshness.md) | Implemented as package-check generated artifact freshness diagnostics. |
| lan-observer-style read-only proof | [lan-observer-style Readonly Consumer Proof](../requests/accepted/lan-observer-readonly-proof.md) | Implemented as sanitized Core proof package and E2E proof path. |
| AirOps-style incident proof | [AirOps-style Incident Proof](../requests/accepted/airops-incident-proof.md) | Implemented as a sanitized canonical policy/ops evidence example. |

## Demo Migration Debt

These are public demo or kit migration items. They are not Core semantics and
do not approve new AIR ABI or Host ABI surface.

| Debt | Formal request | Decision |
| --- | --- | --- |
| Pure-helper Wasm export golden convention for public demos | [Pure Helper Wasm Export Golden Convention](../requests/accepted/pure-helper-wasm-export-golden.md) | Accepted/planned for v0.44-v0.45 tooling/kit migration. |
| Tier 1 public demo README/verify/evidence cleanup, including Airtris/Minesweeper/PhotoLoop/AirWorld blockers where applicable | [Public Demo Migration Debt](../requests/accepted/public-demo-migration-debt.md) | Accepted/planned for v0.44-v0.45 demo migration without Core API growth. |

Known examples:

- Airtris board/state work should consume existing fixed state, declared pools,
  tablegroups, output contracts, and command buffers where applicable.
- Minesweeper scalar slot workarounds should migrate to existing declared
  pools/tablegroups only when the demo proves the shape.
- Event/output paths should migrate to bounded output intent, not
  `debug.metric` behavior signaling.
- Pure-helper Wasm golden tests should become a public demo convention rather
  than a new runtime ABI.

## Rejected / Kit / Post-1.0

These requests are explicitly not Core commitments for public alpha.

| Pressure | Formal request | Decision |
| --- | --- | --- |
| Hex grid primitives | [Hex Grid Primitives](../requests/rejected/hex-grid-primitives.md) | Rejected/kit; not Core before 1.0. |
| Chrome-extension Host ABI | [Chrome Extension Host ABI](../requests/rejected/chrome-extension-host-abi.md) | Rejected/post-1.0; no Host ABI expansion before 1.0. |
| Pixel buffer kernel ABI | [Pixel Buffer Kernel ABI](../requests/rejected/pixel-buffer-kernel-abi.md) | Rejected/kit; convention/kit candidate only. |
| GFX showcase new ABI / asset pipeline growth | [GFX Showcase New ABI](../requests/rejected/gfx-showcase-new-abi.md) | Rejected/project-only for new ABI; host/report polish only. |
| AirWorld generated package semantics | [AirWorld Showcase Semantics](../requests/rejected/airworld-showcase-semantics.md) | Rejected/project-only; showcase/demo semantics are not Core semantics. |
| AIRON platformer-specific APIs | [AIRON Platformer-specific APIs](../requests/rejected/airon-platformer-specific-apis.md) | Rejected/project-only; generic pressure is routed elsewhere. |
| Contra/platformer gameplay APIs | [Contra Platformer Game APIs](../requests/rejected/contra-platformer-game-apis.md) | Rejected/project-only. |
| Sprite/modular actor ABI | [Sprite And Modular Actor ABI](../requests/rejected/sprite-modular-actor-abi.md) | Rejected/kit. |
| Audio event Host ABI | [Audio Event Host ABI](../requests/rejected/audio-event-host-abi.md) | Rejected/post-1.0. |
| Browser/Vite demo bundling | [Browser And Vite Demo Bundling](../requests/rejected/browser-vite-demo-bundling.md) | Rejected/project-only. |
| Network scanner Host ABI | [Network Scanner Host ABI](../requests/rejected/network-scanner-host-abi.md) | Rejected/post-1.0. |
| UI dashboard new Host ABI | [UI Dashboard New Host ABI](../requests/rejected/ui-dashboard-new-host-abi.md) | Rejected/post-1.0. |
| Voxel demo game APIs | [Voxel Demo Game APIs](../requests/rejected/voxel-demo-game-apis.md) | Rejected/project-only. |
| AirDoom project kit requests | [AirDoom Project Kit Requests](../requests/rejected/airdoom-project-kit.md) | Rejected/project-only. |

Default rule: demo-specific, game-specific, browser-extension-specific, or
product-specific requests are rejected as project/kit/post-1.0 unless a
generic Core need is proven through an RFC, gates, tests, and compatibility
review.

## Process Debt

| Process item | Status |
| --- | --- |
| Formal request ledger validation | Implemented by `scripts/check_request_ledger.js`. |
| `docs/abi-requests/` coverage | Every non-README source pressure doc must have a matching request entry. |
| Consumer evidence coverage | Every seeded consumer evidence entry must have a matching request entry. |
| Unresolved inbox count | `0` for public alpha at this cut. |

## Release Gates

Public-alpha release checks should include:

```sh
node scripts/check_request_ledger.js
node scripts/check_abi_requests.js
node scripts/check_consumer_evidence.js
```

The ledger gate fails when:

- a source pressure doc under `docs/abi-requests/` has no matching request;
- a consumer evidence entry has no matching request;
- an accepted request has no target layer, version target, or rationale;
- a rejected request has no reason or alternative;
- a chrome-extension Host ABI request is not rejected/post-1.0 before 1.0.

## ABI Status

- AIR ABI remains `0.10`.
- Host ABI latest remains `0.11`, limited to bounded `output.emit`.
- No Host ABI expansion is approved by this promise debt ledger.
