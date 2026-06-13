# AIR v0.22 Release Plan

Status: active planning milestone

Theme: Fixed Bounded State RFC & ABI Decision Gates

v0.22 starts after the v0.21 API Rebaseline & Host Interaction Contract
milestone. v0.21 added API surface inventory, API gates, deprecation and
migration docs, the first AirOps-style canonical example, and Fixed Bounded
State Segment as pressure evidence only.

v0.22 is RFC/gates/design first. No implementation is included in P0 unless it
is explicitly approved later. Planning work must not change parser behavior,
verifier behavior, lowering, AIR ABI, Host ABI, host imports, or host authority.

AIR is not conceptually Wasm-only. AIR semantic state must be backend-neutral.
Wasm is the current primary lowering backend, not the semantic definition of any
future state feature.

## P0 Scope

| Area | Gate | Acceptance |
| --- | --- | --- |
| Fixed Bounded State Segment RFC | Decide whether persistent bounded AIR-owned scalar state is acceptable as a future Core semantic feature. | [Fixed Bounded State Segment RFC](rfcs/v0.22-fixed-bounded-state-segment.md) exists and keeps implementation deferred. |
| Backend-neutral AIR semantic storage framing | Define state in AIR terms, not Wasm memory terms. | RFC states per-execution-instance semantics and treats Wasm lowering as backend model only. |
| AIR ABI / Host ABI impact decision | Avoid ABI bumps caused only by milestone version changes. | [ABI 0.11 Pressure Audit](rfcs/v0.22-abi-011-pressure-audit.md) keeps AIR ABI and Host ABI at `0.10` unless runtime/host contracts change. |
| Verifier model | Define proof/enforcement obligations before syntax or lowering. | RFC separates verifier obligations from report visibility and includes bounds, initialization, escape, and budget requirements. |
| Lowering model | Describe possible backend strategies without accepting implementation. | RFC documents Wasm lowering candidates and keeps globals/memory/data layout decisions behind later implementation approval. |
| Conformance/evidence model | Make state replay and final-state evidence reviewable before implementation. | RFC defines final-state digest, optional snapshot helpers, mismatch diagnostics, and verification evidence needs. |
| Migration story from globals/arrays/buffers | Avoid creating a duplicate dynamic collection model. | RFC explains what current globals, static tables, arrays, buffers, rowsets, and fixtures do and do not solve. |
| Demo pressure triage | Treat Airtris, Minesweeper, and PhotoLoop as evidence, not authority. | RFC classifies generic Core pressure vs example/kit/host-only parts. |
| API gates update plan | Prevent state RFC from becoming host authority or dynamic data. | State-specific API gates are active as conservative RC/review checks; they do not imply implementation. |
| Kill criteria | Stop feature growth before it becomes dynamic collections, host authority, or game-specific API. | RFC lists hard stop conditions. |

## P1 / If Scope Allows

- parser syntax fixtures only if useful for RFC clarity;
- example plans only, with no implementation;
- API gate tests for future state-specific slop patterns;
- state diagnostic taxonomy planning;
- report/evidence field naming plan;
- conformance fixture sketch for final-state digest only.

## Deferred

- fixed state implementation;
- compact state;
- tablegroups;
- `output.emit`;
- `output.event`;
- `audio.event`;
- `effect.event`;
- Host ABI `0.11`;
- AIR ABI `0.11`;
- state snapshots as ABI;
- host direct state access;
- pixel kernels;
- game-specific helpers;
- shared mutable state;
- atomics;
- cross-instance state;
- runtime JSON object model;
- dynamic maps;
- GC;
- reflection;
- host object handles;
- promises, callbacks, or async/await;
- package registry;
- native installers.

## Demo Pressure Routing

| Pressure | v0.22 routing |
| --- | --- |
| Airtris board cells, row scanning, row compaction, deterministic shuffle state | Core RFC pressure only for fixed scalar state; game rules and visuals remain example/kit/host-owned. |
| Minesweeper board, reveal/flag state, win/blast outcomes, packed snapshots | Core RFC pressure only for bounded scalar state and conformance evidence; UI/game semantics stay outside Core. |
| PhotoLoop pixel/channel kernels | Example/kit pressure first. AIR may eventually compute bounded scalar channel/kernel decisions, but Canvas/ImageData/export/filesystem/browser/renderer/GPU authority stays host-owned. |

## ABI Policy

- Project milestone: `v0.22`.
- AIR ABI: remains `0.10` during planning.
- Host ABI: remains `0.10` during planning.
- AIR ABI `0.11` requires an accepted runtime/executable contract change.
- Host ABI `0.11` requires a separate accepted Host ABI RFC and promotion
  evidence.

## Non-Goals

v0.22 planning must not:

- implement Fixed Bounded State Segment;
- implement tablegroups;
- implement compact state;
- implement output/audio/effect events;
- add host imports or host authority;
- add raw browser, renderer, GPU, Canvas, filesystem, network, or Chrome
  authority;
- make state shared across execution instances;
- treat report visibility as verifier proof;
- make Output Contract declarations state-conditional;
- introduce game-specific Core APIs.

## Release Gate

v0.22 P0 is complete when the RFCs, ABI audit, state safety boundaries, API gate
update plan, and kill criteria are reviewable and pass markdown/link hygiene.

`npm run check:api-gates:v0.22` is a conservative first-slice RC/review gate
when the v0.22 feature-status document is present. It prevents strong forbidden
Core/Host ABI patterns such as state pointer escape, runtime JSON/object-model
markers, raw `chrome.*`, Host ABI `0.11`, and output/audio/effect event
implementation from landing during the RFC phase.

No AIR ABI or Host ABI bump is part of the planning phase.
