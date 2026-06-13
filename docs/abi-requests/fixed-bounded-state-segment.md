# Fixed Bounded State Segment Pressure Request:
# Persistent AIR-Owned State Without Dynamic Collections or Host Authority

Status: proposed / pressure evidence

Target: v0.22+ architecture candidate

Formal ledger decisions:
[Bounded Mutable Storage](../../requests/accepted/bounded-mutable-storage.md),
[Pixel Buffer Kernel ABI](../../requests/rejected/pixel-buffer-kernel-abi.md),
and [Public Demo Migration Debt](../../requests/accepted/public-demo-migration-debt.md).

## Purpose

Capture repeated pressure from Airtris, Minesweeper, PhotoLoop, bounded
simulations, and stateful AI-authored modules for persistent bounded AIR-owned
state.

Fixed Bounded State Segment is pressure evidence, not accepted
implementation. It must not add parser, verifier, lowering, AIR ABI, or Host
ABI behavior in v0.21.

## Request: Fixed Bounded State Segment

Status: proposed
Decision: proposed / pressure evidence only
Source demo/project: Airtris, Minesweeper, PhotoLoop, bounded simulation
pressure, and stateful AI-authored package pressure
Target layer: core
Version target: v0.22+ architecture candidate

## Problem

Standalone demos and bounded simulations keep creating the same pressure:
stateful AIR modules need small persistent, deterministic, bounded storage
without turning AIR into a dynamic runtime or giving AIR host authority.

Current scalar exports work for pure decisions. Static tables work for readonly
lookup data. Bounded rowset schemas describe host-owned input facts. Command
buffers describe host-visible output intents. None of these directly model
AIR-owned mutable state that persists across calls within one package execution
instance.

The requested capability is a fixed, statically declared state segment with
scalar cells, deterministic initialization, verifier-counted reads and writes,
report-visible budgets, and deterministic conformance evidence.

## Current Workaround

Projects currently choose between imperfect workarounds:

- pass all state through scalar parameters and return scalar decisions;
- keep mutable state entirely in the host;
- encode readonly data in static tables;
- use package metadata and conformance fixtures for host-owned rowset input;
- keep demo-specific state layouts in examples or project kits.

These approaches preserve AIR authority boundaries, but they do not provide a
canonical AIR-owned persistent bounded state contract.

## Why Generic

The pressure is generic when narrowed to fixed scalar state. Airtris,
Minesweeper, PhotoLoop, bounded simulations, policy batches, and AI-authored
state machines all need persistent bounded cells without host authority,
dynamic collections, or runtime object models.

The generic mechanism is not a game board, pixel buffer, renderer, browser API,
or host object. It is fixed AIR semantic storage with verifier-visible size and
effects. Domain layouts, names, dimensions, and helper policies remain in
examples, kits, manifests, or host policy.

## Backend-Neutral AIR Semantic Framing

The feature must be specified as AIR semantic storage first. Wasm is the
current primary executable/lowering target, but Wasm memory layout is not the
definition of the feature.

Candidate semantics:

- statically declared fixed-size scalar state;
- deterministic initialization;
- persistent per AIR execution instance / package execution instance;
- current Wasm backend may lower to per-Wasm-instance storage;
- verifier-counted reads and writes;
- report-visible state size and budgets;
- conformance final-state evidence.

## State sharing and execution instances

State belongs to one AIR execution instance / package execution instance. It is
not shared package-global mutable state. Parallel executions or parallel AI
agents must use separate state instances unless a future explicit shared-state
RFC is accepted.

Re-instantiating the package resets state unless a future explicit
reset/persistence RFC says otherwise.

Out of scope for the first slice:

- shared memory;
- atomics;
- cross-instance state;
- host-visible shared state;
- package-global mutable state shared across execution instances.

Wasm per-instance memory is only the current backend model, not the semantic
definition. Wasm lowering may use per-Wasm-instance memory, globals, or another
backend-private storage strategy, but that remains backend implementation
detail.

The design must preserve AIR's authority boundary. State segments are AIR-owned
scalar storage, not host object handles, not runtime JSON, and not a browser,
renderer, GPU, Canvas, filesystem, or network capability.

## Airtris Pressure

Airtris creates pressure for:

- board cells with deterministic read/write access;
- row scanning and compaction;
- bounded score and phase state;
- deterministic shuffle state such as seven-bag indexes or bag counters;
- visual event/readback surfaces owned by package metadata or host policy, not
  `output.emit`.

Generic part: persistent bounded scalar board/state storage.

Non-generic part: tetromino rules, board dimensions, scoring names, and visual
event vocabulary. Those belong in examples, kits, or host policy, not Core.

## Minesweeper Pressure

Minesweeper creates pressure for:

- full board state;
- reveal and flag state;
- adjacent count state;
- win/blast outcomes;
- packed cell snapshots for deterministic conformance.

Generic part: bounded scalar state that can be read and written by deterministic
AIR functions.

Non-generic part: Minesweeper cell semantics, UI state names, blast visuals,
and input routing. Those belong in examples, kits, or host policy.

## PhotoLoop Pressure

PhotoLoop creates pressure for:

- verifier-visible bounded pixel/channel kernels;
- repeated bounded channel operations;
- deterministic kernel state or scratch state;
- report-visible byte budgets and read/write counts.

PhotoLoop pressure must not be interpreted as Canvas, ImageData, pixel-buffer,
renderer, filesystem, browser, or GPU authority in Core. AIR may eventually
compute bounded scalar channel/kernel decisions only if generic state/kernel
RFCs accept that shape.

Host owns:

- image decode;
- Canvas;
- ImageData;
- export;
- filesystem, browser, renderer, and GPU authority.

Any pixel/channel example must be example or kit pressure first. No
pixel-specific Core API is accepted by this pressure request.

## Why Existing Globals/Arrays/Buffers May Be Insufficient

Existing mechanisms cover adjacent cases but do not cleanly define the
requested semantic boundary:

- globals are small scalar state and do not model bounded indexed storage with
  report-visible byte/read/write accounting;
- static tables are readonly and do not model persistent mutable state;
- arrays and buffers in current language tests are not yet the canonical
  package-level state contract for reviewable bounded simulations;
- rowset schemas are package metadata for host-owned bounded facts, not AIR
  runtime storage;
- conformance fixtures may contain host/test-owned JSON rows, but AIR must not
  parse JSON or receive arbitrary JSON objects at runtime.

A state segment could make the intended boundary explicit if it remains fixed,
bounded, scalar, verifier-counted, and non-escaping.

## Proposed Minimal Core Mechanism

Candidate Core mechanism:

- statically declared fixed-size scalar state;
- `i32` first slice only;
- deterministic initializer such as zero fill;
- package execution instance persistence;
- verifier-counted `get` and `set`;
- no pointer or slice escape;
- no host visibility except through exported functions, reports, and
  conformance evidence;
- no dynamic allocation or dynamic collection behavior.

This is a Core candidate because it changes AIR semantic storage and verifier
behavior if accepted. Stdlib, kits, examples, and manifests may define domain
layouts and helper functions on top of it without changing language semantics.

## First-Slice Sketch

Illustrative syntax only:

```air
state board:i32[200] = fill 0

func read_cell(index: i32) -> i32 {
entry:
  %cell:i32 = state.get board, %index
  return %cell
}

func write_cell(index: i32, value: i32) -> i32 {
entry:
  state.set board, %index, %value
  return %value
}

func board_len() -> i32 {
entry:
  %len:i32 = state.len board
  return %len
}
```

Candidate first-slice operations:

- `state.len @name -> i32`;
- `state.get @name, idx -> i32`;
- `state.set @name, idx, value`;
- possibly `state.fill @name, value` only if verifier cost is simple and
  deterministic;
- defer `state.swap` unless a real generic need survives RFC review.

First slice should not include compact state. `u8`, `u16`, and `i16` storage
can be considered later after `i32` state proves the model. If compact cells are
added later, compact reads should materialize `i32`, and writes must reject
out-of-range values or trap deterministically. No silent truncation.

State must not be exported as a pointer, slice, host handle, or raw memory
region. Access should be through AIR functions and reviewable reports.

## Verifier obligations vs report visibility

The verifier must prove or enforce:

- fixed state length;
- deterministic initialization;
- no uninitialized cells;
- no pointer, slice, or reference escape;
- static out-of-bounds rejection;
- dynamic bounds check or deterministic trap;
- read/write budget upper bounds;
- loop upper-bound multiplication of state read/write effects;
- no host direct state access;
- no dynamic allocation or resizing.

Report and evidence visibility must show:

- state segment names;
- cell type;
- length;
- static byte size;
- declared read/write budgets where available;
- module-level observed read/write counters where available;
- final state digest for conformance where available;
- diagnostics and budget violations.

Report visibility is not proof. If the verifier cannot prove or enforce a
property, the report must not imply that the property was proven.

No verifier change is accepted by this pressure request. These bullets describe
requirements for a future RFC if the request advances.

## Verifier impact

Future verifier impact would include scalar cell validation, aliasing rules that
keep each state segment named and non-overlapping, and the proof/enforcement
obligations listed in the previous section. No verifier implementation is
accepted by this pressure request.

## Manifest / package impact

Package/report changes are not accepted in v0.21. A future RFC must decide
whether state segment declarations affect package metadata, report schema,
verification evidence, or AIR ABI versioning.

## Host ABI registry impact

No Host ABI registry impact is requested. Fixed Bounded State Segment should not
add host imports, Host ABI `0.11`, `output.emit`, raw browser/renderer/GPU/
Canvas/filesystem/network authority, host object handles, or automatic
host-side action execution.

## Output Contract boundary

State and Output Contract surfaces must remain separate. Output Contract
manifests remain state-independent declarations. The first slice must not
introduce state-conditional Output Contract semantics.

State may influence:

- exported scalar function results;
- internal deterministic decisions;
- future command buffer contents only if the command buffer contract already
  exists.

State must not:

- mutate Output Contract definitions;
- conditionally grant or revoke host authority;
- imply `output.emit`;
- imply Host ABI `0.11`;
- create automatic host-side action execution.

## Conformance tests

Conformance needs:

- deterministic reset/init behavior;
- optional final state digest;
- optional bounded scalar snapshot helpers;
- mismatch diagnostics for final-state digest, selected cell snapshots,
  out-of-bounds traps, and read/write budget violations.

Privacy rules:

- reports must expose shape, byte counts, and diagnostics, not raw private text,
  raw URLs, tokens, secrets, or host-owned data;
- examples may snapshot synthetic scalar cells, but private host data must not
  enter state segments.

Future conformance tests should cover deterministic initialization, per-instance
persistence, final state digest, selected scalar snapshots, out-of-bounds traps,
read/write budget violations, reset behavior, and privacy-safe reporting.

## ABI Impact Questions

AIR ABI `0.11` may be required only if accepted state segments change executable
runtime/package contracts, calling conventions, memory/data representation, or
conformance-required package metadata. An RFC must decide this explicitly.

AIR ABI `0.10` may remain sufficient if the first implementation is purely
source-level AIR semantics lowered into existing backend-private storage without
changing public package/runtime ABI.

Host ABI `0.11` should not be required. State segments are AIR-owned storage and
do not require new host imports, raw host authority, or host-side action
execution.

## Core Vs Stdlib Vs Kit Vs Example Routing

| Pressure | Routing |
| --- | --- |
| Fixed scalar state segment semantics | Core RFC candidate only after gates. |
| Domain layouts such as board widths, cell meanings, and score constants | Examples or project kits. |
| Generic helper functions over scalar state indexes | Stdlib candidate only if pure, deterministic, resource-free, and domain-neutral. |
| Visual events, Canvas/ImageData/export, browser rendering, GPU, filesystem, network | Host implementation or future host/profile RFC; not this request. |
| Conformance final-state fixtures and digests | Manifest/conformance tooling. |
| Demo-specific APIs | Rejected from Core. |

## Non-Goals

- dynamic arrays;
- dynamic maps;
- GC;
- reflection;
- host object handles;
- runtime JSON;
- pointer or slice escape to host;
- raw browser, renderer, GPU, Canvas, filesystem, or network authority;
- game-specific Core APIs;
- `output.emit`;
- Host ABI `0.11`;
- compact `u8`/`u16` state in the first slice.

## Acceptance criteria

This pressure request is complete when:

- this document exists under `docs/abi-requests/`;
- it is linked from ABI request indexes;
- it frames Fixed Bounded State Segment as pressure evidence only;
- it states AIR semantic storage is backend-neutral and Wasm lowering is only
  the current backend model;
- it states state is per AIR execution instance / package execution instance,
  not shared package-global mutable state;
- it separates verifier proof/enforcement obligations from report/evidence
  visibility;
- it keeps state independent from Output Contract declaration semantics;
- it rejects dynamic collections, runtime JSON, host object handles, pointer or
  slice escape, host authority, game-specific Core APIs, `output.emit`, Host ABI
  `0.11`, and compact state in the first slice;
- markdown links and ABI request pipeline checks pass;
- no parser, verifier, lowering, AIR ABI, Host ABI, demo, tablegroup, compact
  state, or host authority implementation is added.

## Kill Criteria

Stop or reject the feature if the design begins to require:

- dynamic collection length;
- arbitrary runtime JSON values;
- object fields or dynamic keys;
- host object handles;
- pointers or slices escaping to host;
- raw browser, renderer, GPU, Canvas, filesystem, or network authority;
- shared mutable state across execution instances;
- state-conditional host authority;
- reports pretending to prove unenforced properties;
- Canvas, ImageData, or pixel-buffer authority in Core;
- game-specific APIs or named demo semantics in Core;
- automatic host-side action execution;
- unbounded read/write effects that cannot be reported or budgeted;
- privacy-sensitive raw data in state reports or conformance evidence.

## Proposed Roadmap

- v0.22: RFC, gates, design, diagnostic planning, conformance evidence shape,
  and ABI decision record only.
- v0.23: possible `i32` state first executable slice if the RFC is accepted and
  gates pass.
- v0.24: ergonomics, canonical examples, stdlib/kit helpers, and conformance
  hardening if the first slice remains bounded and generic.
- v0.25: compact state and pixel-kernel storage candidate only after `i32`
  state proves useful without authority leakage.

This roadmap is candidate pressure only. It does not create active v0.21 scope
and does not imply AIR ABI or Host ABI changes.
