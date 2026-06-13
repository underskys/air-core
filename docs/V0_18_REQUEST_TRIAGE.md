# AIR v0.18 Request Triage

Status: active v0.18 planning input

This document triages active ABI, package, host-profile, and pressure requests
before v0.18 implementation work. Requests are pressure, not scope. Demos and
FlowDesk Air are evidence, not AIR Core authority.

Rules for this triage:

- no raw `chrome.*`;
- no DOM/React, IndexedDB/Dexie, arbitrary fetch/Jira, browser permission, token,
  secret, URL, or raw private text authority in AIR;
- no arbitrary JSON object model inside AIR;
- no dynamic maps;
- no GC;
- no reflection;
- no host object handles;
- no JS promises or async/await in AIR;
- no runtime imports;
- no Host ABI bump without the event/output promotion gate;
- no AIR ABI bump without runtime or package executable contract change.

## Inputs Inspected

- [ABI Requests Index](abi-requests.md)
- [ABI Request Pipeline](abi-requests/README.md)
- [AirDoom Project Kit Requests](abi-requests/airdoom.md)
- [Contra Platformer Extraction Triage](abi-requests/contra-platformer.md)
- [Core Data Ergonomics Request](abi-requests/core-data-ergonomics.md)
- [FlowDesk Air Pressure Request](abi-requests/flowdesk-air.md)
- [GFX Showcase Requests](abi-requests/gfx-showcase.md)
- [Network Scanner Host Capability RFC](abi-requests/network-scanner.md)
- [UI Dashboard Requests](abi-requests/ui-dashboard.md)
- [Voxel Demo ABI Request Triage](abi-requests/voxel-demo.md)
- [Request Intake](../requests/README.md)
- [Event and Output Contract RFC](rfcs/v0.16-event-output-contract.md)
- [Event/Output Promotion Package RFC](rfcs/v0.17-event-output-promotion-package.md)

The current `requests/` tree contains intake governance README files only. It
does not contain active concrete request documents on this branch.

## Summary Classification

| Category | v0.18 classification | Rationale |
| --- | --- | --- |
| Structured bounded facts | P0 / needs RFC | Core data ergonomics, Voxel generated data pressure, Contra fixed data pressure, FlowDesk bounded facts, dashboards, network policy, and artifact/report workflows all point to package-checked bounded data contracts. |
| Output/events | P0 / needs RFC and promotion evidence | v0.16/v0.17 RFCs define boundary and promotion gate. v0.18 should refine manifest tooling and readiness without adding Host ABI imports. |
| Chrome extension host profile | P1 / needs RFC | FlowDesk proves non-game pressure, but raw browser authority must remain host-owned. Profile design is useful after bounded facts/output manifest work is clearer. |
| Package/artifact/bundle | duplicate / implemented baseline | v0.16 and v0.17 already delivered `airpkg`, link-plan/linked first slice, `check-airpkg`, `bundle`, and `check-bundle`. v0.18 should not reopen this as P0 except where bounded facts/output manifests need artifact metadata. |
| `debug.metric` boundary | P0 / audit | Existing diagnostics exist; v0.18 should audit coverage against output/event readiness and release-policy gates. |
| Host profiles | P1 / needs RFC where new profile appears | Existing host profiles stay `0.10`. Chrome Extension and output-channel support are profile RFC candidates only. |
| Stdlib | P1 or deferred | Generic grid/bounds/contact helpers are possible only if resource-free, deterministic, backend-neutral, and name-clean. No demo vocabulary. |
| Rejected demo-specific APIs | rejected | `draw_actor`, `draw_contra_enemy`, platformer water APIs, `std.voxel`, `gfx.draw_voxel_chunk`, hidden host gameplay authority, and debug metrics as events remain rejected. |

## v0.18 P0

| Request / pressure | Sources | Category | v0.18 decision |
| --- | --- | --- | --- |
| Bounded structured facts | [Core Data Ergonomics](abi-requests/core-data-ergonomics.md), [Voxel Generated AIR Data Ergonomics](abi-requests/voxel-demo.md#request-generated-air-data-ergonomics), [Contra Fixed Data Structures](abi-requests/contra-platformer.md#request-fixed-data-structures), [FlowDesk Air](abi-requests/flowdesk-air.md) | structured bounded facts | P0 RFC. Define static schemas, bounded fact snapshots, fixed-size scalar tables, tablegroups as RFC/P1 candidate, generated handles, package-checked contracts, report visibility, privacy policy, and conformance compatibility. |
| Output-events manifest tooling | [Event and Output Contract RFC](rfcs/v0.16-event-output-contract.md), [Event/Output Promotion Package](rfcs/v0.17-event-output-promotion-package.md), [FlowDesk Air](abi-requests/flowdesk-air.md) | output/events | P0 RFC. Define manifest-backed IDs, channels, capabilities, scalar arg schemas, generated output handles plan, missing/unused ID checks, profile compatibility, and no runtime emit. |
| Event/output Host ABI promotion package | [Event/Output Promotion Package](rfcs/v0.17-event-output-promotion-package.md), [Contra audio/effect pressure](abi-requests/contra-platformer.md#request-audio-capability-enforcement), [UI Dashboard](abi-requests/ui-dashboard.md), [FlowDesk Air](abi-requests/flowdesk-air.md) | output/events | P0 evidence plan. Require two domains: interactive/game-like and DevOps/SRE/FlowDesk/policy/dashboard. No Host ABI bump until evidence is complete and separately accepted. |
| `debug.metric` diagnostics-only boundary | [v0.16 Event Contract](rfcs/v0.16-event-output-contract.md), [v0.17 Promotion Package](rfcs/v0.17-event-output-promotion-package.md), [Contra triage](abi-requests/contra-platformer.md) | debug.metric boundary | P0 audit. Verify event-like metric pulses emit `air.review.debug_metric_event_bus`, release-candidate policy can fail it, and normal diagnostic metrics are not over-rejected where distinguishable. |
| ABI decision gates | [Version and ABI Policy](VERSION_AND_ABI_POLICY.md), [FlowDesk Air](abi-requests/flowdesk-air.md), [v0.17 Promotion Package](rfcs/v0.17-event-output-promotion-package.md) | ABI | P0 gate. AIR ABI and Host ABI remain `0.10` unless runtime/executable contract or host import contracts change through accepted RFC/spec/profile/tests. |
| FlowDesk / Chrome Extension pressure classification | [FlowDesk Air](abi-requests/flowdesk-air.md) | Chrome extension host profile | P0 classification only. FlowDesk is non-game pressure evidence for bounded facts/output readiness and a future Chrome Extension host profile RFC; it is not implementation scope. |

## v0.18 P1

| Request / pressure | Sources | Category | v0.18 decision |
| --- | --- | --- | --- |
| Tablegroups first slice | [Core Data Ergonomics](abi-requests/core-data-ergonomics.md), [FlowDesk Air](abi-requests/flowdesk-air.md), [Contra Fixed Data Structures](abi-requests/contra-platformer.md#request-fixed-data-structures) | structured bounded facts | P1 only if P0 bounded facts RFC accepts a narrow static scalar representation. No dynamic rows, maps, records-as-objects, GC, or runtime mutation. |
| Generated output handles tooling | [v0.17 Promotion Package](rfcs/v0.17-event-output-promotion-package.md) | output/events | P1 tooling. Generated handles may expose stable IDs but must not grant host authority or bypass capability/profile checks. |
| Chrome Extension host profile RFC | [FlowDesk Air](abi-requests/flowdesk-air.md) | host profiles | P1 RFC. Describe MV3 service worker, popup, content script, storage, alarms, notifications, context menus, active tab, and scripting as host-owned support levels. No raw browser authority in AIR. |
| Conformance output stream planning | [v0.16 Event Contract](rfcs/v0.16-event-output-contract.md), [v0.17 Promotion Package](rfcs/v0.17-event-output-promotion-package.md) | output/events / conformance | P1 planning. Define deterministic future output stream tuples, unsupported-profile cases, and mismatch categories without implementing emit. |
| Two-domain examples for event/output promotion | [v0.17 Promotion Package](rfcs/v0.17-event-output-promotion-package.md), [FlowDesk Air](abi-requests/flowdesk-air.md), [UI Dashboard](abi-requests/ui-dashboard.md) | output/events | P1 evidence. One interactive/game-like and one non-game DevOps/SRE/FlowDesk/policy/dashboard example are required before Host ABI promotion. |
| Safe network request-handle pressure | [Network Scanner RFC](abi-requests/network-scanner.md), [FlowDesk Air async pressure](abi-requests/flowdesk-air.md#async-request-handle-pressure) | host profiles / bounded async | P1 RFC candidate. Align with bounded polling concepts; no promises, callbacks, raw sockets, DNS execution, or browser/network authority in AIR. |
| Generic UI/dashboard output pressure | [UI Dashboard](abi-requests/ui-dashboard.md), [FlowDesk Air](abi-requests/flowdesk-air.md) | output/events / host profiles | P1 evidence for non-game output channels. Keep within existing `ui.*` and host-owned UI until RFC gates pass. |

## Deferred

| Request / pressure | Sources | Category | Reason |
| --- | --- | --- | --- |
| Runtime `output.emit` / `output.event` | [v0.16 Event Contract](rfcs/v0.16-event-output-contract.md), [v0.17 Promotion Package](rfcs/v0.17-event-output-promotion-package.md) | output/events | Deferred until promotion package is complete and Host ABI `0.11` is explicitly accepted. |
| `audio.event` / `effect.event` | [Contra triage](abi-requests/contra-platformer.md), [v0.16 Event Contract](rfcs/v0.16-event-output-contract.md) | output/events | Deferred. Domain-specific imports are not enough evidence for generic event/output Host ABI. |
| Chrome Extension host profile implementation | [FlowDesk Air](abi-requests/flowdesk-air.md) | host profiles | Deferred. RFC candidate only in v0.18; raw browser authority remains host-owned. |
| Network scanner host ABI | [Network Scanner RFC](abi-requests/network-scanner.md) | host profiles / Host ABI | Deferred. Security-sensitive; requires separate host policy, request handles, rate limits, target validation, profiles, and tests. |
| Sprite transform public ABI | [Contra Sprite Transform ABI](abi-requests/contra-platformer.md#request-sprite-transform-abi) | output/events / GFX / manifest | Deferred. Use reusable kit/manifest path first; no direct Host ABI without generic evidence. |
| Instanced primitive high-level `gfx.*` ABI | [Voxel Instanced Primitive Draw](abi-requests/voxel-demo.md#request-instanced-primitive-draw) | host implementation / GFX | Deferred. Use host batching, kits, manifests, or existing lower-level package paths first. |
| PBR/post-processing public ABI | [Voxel PBR Lighting And Post-Processing](abi-requests/voxel-demo.md#request-pbr-lighting-and-post-processing-package-path) | manifest / host implementation | Deferred from Core/Host ABI. Manifest/kit/host polish may continue separately. |
| AirDoom project kit extraction | [AirDoom Project Kit Requests](abi-requests/airdoom.md) | project kit | Deferred until narrow generic requests exist with independent evidence. |
| GFX showcase host polish | [GFX Showcase](abi-requests/gfx-showcase.md) | host implementation | Deferred from v0.18 P0. Host diagnostics/showcase polish is useful but not bounded-facts/output readiness. |

## Duplicate / Already Covered

| Request / pressure | Sources | Category | Covered by |
| --- | --- | --- | --- |
| Package graph verify/report/check | [Contra Module Split / Imports](abi-requests/contra-platformer.md#request-module-split--imports) | package/artifact/bundle | v0.14/v0.15 package graph work. |
| Linked package first slice | [Contra linked multi-module pressure](abi-requests/contra-platformer.md#v014-candidates), [v0.16 linked RFC](rfcs/v0.16-linked-executable-package-build.md) | package/artifact/bundle | v0.16 link-plan and linked WAT/Wasm first slice. |
| Asset manifest / bundle support | [Contra Asset Manifest / Bundle Support](abi-requests/contra-platformer.md#request-asset-manifest--bundle-support) | package/artifact/bundle | v0.17 `check-airpkg`, `bundle`, and `check-bundle` first slice. |
| Generated handle freshness | [Contra v0.13 covered pressure](abi-requests/contra-platformer.md#v013--v014-pressure-classification) | package/artifact/bundle | v0.14+ generated artifact checks and package-check diagnostics. |
| Native GFX stream probe | [Voxel Native Gfx Stream Probe](abi-requests/voxel-demo.md#request-native-gfx-stream-probe-and-window-renderer) | host implementation | Implemented behind existing imports; no new public ABI. |
| Voxel chunk package path | [Voxel Chunk Render Path](abi-requests/voxel-demo.md#request-voxel-chunk-render-path) | manifest / host implementation | Existing `gpu.draw_voxel_chunk`, `.airgfx.json`, host conformance, and diagnostics; no high-level `gfx.*` addition. |

## Rejected

| Request / pressure | Sources | Category | Reason |
| --- | --- | --- | --- |
| Raw `chrome.*` in AIR | [FlowDesk Air](abi-requests/flowdesk-air.md) | Chrome extension host profile | Rejected. Browser APIs, permissions, service workers, popup/content scripts, storage, scripting, alarms, and notifications are host-owned. |
| Arbitrary JSON object model inside AIR | [FlowDesk Air](abi-requests/flowdesk-air.md) | structured bounded facts | Rejected. v0.18 should use bounded static schemas and scalar facts. |
| Dynamic maps / GC / reflection / host object handles | [FlowDesk Air](abi-requests/flowdesk-air.md), [v0.16 Event Contract](rfcs/v0.16-event-output-contract.md) | structured bounded facts / Host ABI | Rejected from AIR Core safety model. |
| JS promises / async-await in AIR | [FlowDesk Air](abi-requests/flowdesk-air.md) | host profiles / bounded async | Rejected. Future async pressure must align with bounded polling/request handles. |
| `draw_actor` / `draw_contra_enemy` | [Contra triage](abi-requests/contra-platformer.md), [v0.16 Event Contract](rfcs/v0.16-event-output-contract.md) | rejected demo-specific API | Rejected. Game-specific Host ABI. |
| Platformer water APIs | [v0.17 Promotion Package](rfcs/v0.17-event-output-promotion-package.md) | rejected demo-specific API | Rejected. Keep project-specific visuals in consumers/kits. |
| `std.voxel`, `std.gfx3d`, `std.scene` as demo wrappers | [Contra triage](abi-requests/contra-platformer.md), [Voxel triage](abi-requests/voxel-demo.md) | stdlib | Rejected. Use kits, examples, manifests, or host implementation; stdlib must stay deterministic, backend-neutral, and resource-free. |
| `debug.metric` as event/effect/audio/gameplay bus | [Contra triage](abi-requests/contra-platformer.md), [v0.16 Event Contract](rfcs/v0.16-event-output-contract.md), [v0.17 Promotion Package](rfcs/v0.17-event-output-promotion-package.md) | debug.metric boundary | Rejected. `debug.metric` remains diagnostics-only and may be failed by reviewPolicy. |
| Hidden host gameplay or product authority | [Contra triage](abi-requests/contra-platformer.md), [AirDoom](abi-requests/airdoom.md), [FlowDesk Air](abi-requests/flowdesk-air.md) | host profiles / authority | Rejected. Host may own platform/resource authority, but AIR-visible semantics must be declared through capabilities/manifests/reports. |

## Needs RFC

| RFC candidate | Sources | Category | Minimum content |
| --- | --- | --- | --- |
| v0.18 bounded structured facts | Core Data Ergonomics, Voxel generated data, Contra fixed data, FlowDesk Air, dashboard/policy pressure | structured bounded facts | Static schemas, bounded snapshots, scalar-only fields, generated handles, package-check/report visibility, privacy, conformance fixtures, ABI decision tree, rejection of JSON/maps/GC/reflection/host handles. |
| v0.18 output-events manifest tooling | v0.16 event contract, v0.17 promotion package, FlowDesk output command pressure | output/events | Manifest schema, IDs, names, channels, capabilities, scalar args, generated handles, stale/missing checks, profile compatibility, no runtime emit. |
| v0.18 event/output Host ABI readiness | v0.17 promotion package | output/events | Two-domain evidence, conformance output stream requirements, debug.metric negative tests, package-check/report visibility, profile unsupported tests, manifest mismatch tests, Host ABI decision record. |
| Chrome Extension host profile pressure | FlowDesk Air | Chrome extension host profile | Host-owned MV3/browser capabilities, forbidden AIR authority, fact snapshot boundary, bounded request-handle pressure, privacy/report policy, no raw `chrome.*`. |
| Safe bounded request handles | Network Scanner, FlowDesk async pressure | host profiles | Scalar request handles, bounded polling, host-owned scheduling/permissions/errors, profile support, no promises/callbacks/raw network/browser access. |
| Generic stdlib helper review | Contra bounds/contact, Voxel grid/fixed-point | stdlib | Only if helpers are pure, deterministic, resource-free, backend-neutral, name-clean, and independently useful outside demos. |

## ABI Status

v0.18 triage does not require an AIR ABI bump.

AIR ABI remains `0.10` unless a future accepted RFC changes executable package
runtime representation, calling convention, memory/data layout, entrypoint
semantics, or runtime-required package metadata.

v0.18 triage does not require a Host ABI bump.

Host ABI remains `0.10` unless a future accepted RFC adds or changes host
imports or required host import semantics. Output-events manifests, bounded fact
schemas, profile RFCs, report metadata, and conformance planning are not Host
ABI changes by themselves.
