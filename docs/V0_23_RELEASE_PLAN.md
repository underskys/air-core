# AIR v0.23 Release Plan

Status: active implementation milestone

Theme: Fixed Bounded State Segment First Slice

v0.23 starts after the v0.22 Fixed Bounded State RFC & ABI Decision Gates
milestone. v0.22 accepted the pressure as reviewable architecture only; v0.23
is the first executable slice, split into implementation phases.

The default ABI target is recorded in
[Fixed State ABI Decision](rfcs/v0.23-fixed-state-abi-decision.md): AIR ABI
`0.10`, Host ABI `0.10`. Implementation must stop before changing AIR ABI or
Host ABI.

AIR semantic state remains backend-neutral. Wasm is the current primary lowering
backend, not the definition of the feature.

## P0 Scope

| Area | Gate | Acceptance |
| --- | --- | --- |
| Minimal fixed bounded state segment first slice | Implement only the smallest persistent AIR-owned scalar state surface. | `i32` cells, fixed length, zero/fill-literal initialization, `state.len`, `state.get`, and `state.set` only. |
| `i32` state cells only | Avoid compact-state and scalar-zoo expansion. | No `u8`, `u16`, `i16`, `bool`, structs, objects, maps, JSON, or dynamic cells in P0. |
| Fixed length only | Prevent dynamic collections. | Length is compile-time literal and verifier-visible. |
| Deterministic initialization | Avoid uninitialized or host-seeded state. | Zero or fill-literal init only; no wall-clock, randomness, host data, or runtime-sized init. |
| Per-execution-instance persistence | Preserve isolated package execution semantics. | State belongs to one AIR execution instance / package execution instance; re-instantiation resets state. |
| Verifier obligations | Make safety proof/enforcement explicit. | Verifier covers fixed length, deterministic initialization, no uninitialized cells, no pointer/slice/reference escape, static OOB rejection, dynamic bounds check or deterministic trap, read/write budget accounting, and loop-bound multiplied accounting. |
| Report/evidence metadata | Make state visible without pretending report visibility is proof. | Reports expose `stateSegments` metadata: name, cell type, length, static byte size, read/write budgets, module-level observed read/write counters, diagnostics. |
| Conformance final state digest | Make persistent state replayable. | Conformance can include final-state digest and mismatch diagnostics without host state read authority. |
| Backend-neutral semantics with current Wasm lowering | Keep feature portable beyond Wasm. | Wasm lowering is implementation strategy only; no pointer escape, raw memory export, or host direct state access. |

## P0 Phase Split

| Phase | Scope | Explicit non-scope | Acceptance |
| --- | --- | --- | --- |
| Phase 1 | Parser/formatter and diagnostic taxonomy for fixed bounded state syntax and state op spelling. | No lowering. No verifier proof beyond syntax/diagnostic shape required. No ABI change. | Syntax round-trips deterministically, unknown/invalid state forms produce repairable diagnostics, and forbidden forms are rejected early. |
| Phase 2 | Verifier, report, and verification evidence for state declarations and state operations. | No lowering unless a narrowly scoped test requires a non-executable stub; no ABI change. | Verifier checks fixed length, `i32` cells, deterministic fill, bounds where statically visible, no export/escape, budgets, and report/evidence `stateSegments`. |
| Phase 3 | Wasm lowering with memory isolation. | No AIR ABI bump unless the ABI decision record is updated first. No host state access. | Lowered Wasm uses private mutable globals for `i32` state cells, dynamic bounds trap deterministically, and user-visible memory operations cannot alias state. If a future memory-backed lowering cannot prevent aliasing, lowering must stop. |
| Phase 4 | Conformance final digest. | No host-managed snapshot/restore. No runtime JSON/object model. | Conformance reports deterministic final state digest evidence from explicit exported scalar helper calls without making state a Host ABI surface. |
| Phase 5 | RC scope audit. | No feature expansion. | RC checks prove no compact state, tablegroups, output events, Host ABI `0.11`, state export/escape, shared mutable state, or demo-specific semantics entered the release. |

## P1 / If Scope Allows

- runtime `state.fill` if not included in P0;
- `state.swap`;
- `bool` state cells;
- generated state handles;
- generic grid index helper in stdlib/kit only if it stays project-neutral;
- tiny synthetic Airtris/Minesweeper-style fixtures for conformance pressure;
- state diagnostic taxonomy expansion;
- report/evidence snapshot helpers that return explicit scalar values only.

## Deferred

- compact `u8`/`u16`/`i16` state;
- tablegroups implementation;
- state snapshots as ABI;
- state pointer/slice export;
- host direct state access;
- shared mutable state;
- atomics or shared memory;
- cross-instance state;
- `output.emit`;
- `output.event`;
- `audio.event`;
- `effect.event`;
- Host ABI `0.11`;
- AIR ABI `0.11` unless runtime/package contract changes require it and are
  separately accepted;
- Canvas/ImageData/pixel-buffer authority;
- raw browser, renderer, GPU, filesystem, network, or Chrome authority;
- arbitrary runtime JSON object model;
- dynamic maps;
- GC;
- reflection;
- host object handles;
- promises, callbacks, or async/await;
- package registry;
- native installers;
- game-specific Core APIs.

## ABI Policy

- Project milestone: `v0.23`.
- AIR ABI: remains `0.10` unless state becomes externally visible
  runtime/package contract.
- Host ABI: remains `0.10`.
- If implementation requires AIR ABI `0.11`, stop and report before changing
  it.
- Host ABI `0.11` is out of scope for this milestone.

## Current Wasm Lowering Choice

The first executable state slice lowers each `i32` state cell to a private
mutable Wasm global. State is not placed in exported linear memory, state base
addresses are not emitted, and state is not exported as an ABI surface.

This gives the first slice the required isolation property: existing
user-visible memory, slice, and buffer operations cannot read or write state
storage. `state.len` lowers to a constant; `state.get` and `state.set` lower to
checked access over private cells. Dynamic out-of-bounds indexes trap
deterministically with Wasm `unreachable`.

## Current Conformance Digest Choice

The first final-state digest path uses explicit package-authored exported scalar
helpers such as `board_cell(index:i32) -> i32`. Conformance traces list the
helper calls, the runner calls those public exports, and the runner hashes the
scalar returns deterministically.

The runner does not use hidden compiler-generated exports, direct host reads of
private state globals, state pointers, state slices, state references, or raw
state dumps. Digest helpers must be observation-only: no state writes, global or
memory writes, command-buffer writes, host imports, or `debug.metric` event-style
output. Digest inputs exclude wall-clock time, randomness, local environment
state, and host private data.

## Non-Goals

v0.23 P0 must not:

- expose state memory, pointers, slices, references, or handles to hosts;
- add host direct state reads or writes;
- make Output Contract declarations state-conditional;
- implement output/audio/effect events;
- add compact state;
- add tablegroups;
- add runtime JSON, object, map, GC, reflection, or host-object semantics;
- add game-specific helpers to Core.

## Release Gate

v0.23 planning is complete when the implementation RFC, feature status, active
roadmap links, ABI policy, kill criteria, and deferred list are reviewable and
pass markdown/link hygiene.

No AIR ABI or Host ABI bump is part of this planning step.
