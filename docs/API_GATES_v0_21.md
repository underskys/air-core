# AIR v0.21 API Gates

Status: first-slice RC/review gate

v0.21 is the API Rebaseline & Host Interaction Contract milestone. These gates
are intended to prevent new API slop while preserving legacy compatibility.
They do not remove old APIs, migrate examples, change compiler semantics,
change AIR ABI, or change Host ABI.

## Gate Categories

### Hard Rejected In Core

These surfaces must not be introduced into AIR Core, stdlib, public Host ABI,
canonical examples, or package contracts:

- raw `chrome.*`;
- DOM, React, IndexedDB, Jira, or fetch authority in AIR;
- secrets, tokens, private text, or raw URL authority in AIR;
- host object handles;
- arbitrary JSON runtime object model;
- dynamic maps;
- GC or reflection;
- promises, callbacks, or async/await in AIR;
- runtime imports;
- automatic host-side action execution;
- game-specific Core APIs.

### Deferred / Decision Record Required

These surfaces are not allowed without a future accepted decision record,
RFC/spec/profile update, implementation plan, and tests:

- Host ABI `0.11`;
- AIR ABI `0.11`;
- `output.emit`, `output.event`, `audio.event`, or `effect.event`;
- tablegroups implementation;
- package registry;
- native installers.

### Canonical v0.21 Path

New canonical package guidance should use:

- bounded facts or bounded rowset schemas as structured input;
- Output Contract manifests for host-visible output intent IDs;
- command buffer output intents for bounded scalar output records;
- verification evidence JSON for machine-readable claims;
- deterministic conformance fixtures and reports for replayable behavior;
- LSP diagnostics and reviewPolicy for API and migration visibility.

### Legacy But Compatible

These surfaces remain compatible in v0.21:

- old scalar-only adapters for small decisions;
- simple scalar returns for pure computation;
- older examples not yet migrated.

Legacy compatibility must not be presented as the preferred v0.21 API path when
bounded data, output intents, verification evidence, or deterministic
conformance are relevant.

## Machine Check First Slice

The first machine check is intentionally conservative:

```sh
node scripts/check_api_gates_v0_21.js
```

It fails only on strong forbidden patterns in active non-doc paths:

- raw `chrome.*` in `src/`, `stdlib/`, `spec/`, `hosts/`, `data/`, `examples/`,
  or `kits/`;
- active `extern output.emit`, `extern output.event`, `extern audio.event`, or
  `extern effect.event` declarations outside tests and hallucination/rejection
  fixtures;
- Host ABI `0.11` in active host profile JSON;
- AIR ABI `0.11` or Host ABI `0.11` constants in active source;
- active `hostHandle` schema/API fields outside explicit rejection metadata.

Allowed:

- docs-only rejected or future mentions;
- tests and hallucination fixtures that assert rejection;
- migration/deprecation docs;
- clearly scoped experimental kits, once they exist.

The first slice does not make broad `payload` or `data` string heuristics
release-blocking because existing network, graphics, and schema validators use
those terms legitimately. Runtime JSON/object-model leakage remains covered by
specific rowset/command buffer validators, layer guard, docs review, and future
more precise gates.

## RC / Review Integration

`check:api-gates:v0.21` is an explicit npm script and part of the v0.21 Core
RC/review check flow through `scripts/run_rc_checks.sh`. The gate is required
when the v0.21 gate script and feature status doc are present.

The first slice remains conservative. It does not remove legacy APIs, migrate
examples, or break compatibility surfaces. It prevents new forbidden Core or
Host ABI surface from being introduced while the v0.21 rebaseline is underway.

It is not part of `npm test`; source checkout RC checks run it explicitly and
record a dedicated `API gate violation` red flag if it fails.

Future tightening should happen only after allowlists and canonical/legacy
example labels are stable.

## ABI Status

- AIR ABI remains `0.10`.
- Host ABI remains `0.10`.
- No Host ABI `0.11`, `output.emit`, `output.event`, `audio.event`, or
  `effect.event` is introduced by these gates.
