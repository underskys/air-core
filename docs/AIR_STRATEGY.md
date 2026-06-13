# AIR Strategy

## Thesis

AIR is not intended to become a universal application language.

AIR is a portable verified execution substrate and plugin IR for small
AI-authored modules/packages.

AIR should stay narrow enough that generated modules remain deterministic,
reviewable, capability-scoped, and cheap to verify.

## Architecture

```text
AI/domain intent
-> small AIR module/package
-> verifier/audit/report
-> backend artifact, currently Wasm/airpkg
-> strict host profile
-> host-owned execution
```

## AIR Owns

- bounded deterministic intent;
- scalar facts;
- ids/handles;
- policy decisions;
- effect declarations;
- capability usage;
- audit/report surface;
- package/module graph;
- conformance/evidence surface.

## Host Owns

- raw platform objects;
- files/network/DOM/GPU/DB/secrets;
- external API access;
- real side effects;
- resource loading;
- platform permissions;
- rendering/audio/platform integration.

## AIR Is Not

- a universal app language;
- a browser framework;
- a game engine;
- an object runtime;
- a JSON runtime;
- a package registry clone;
- a universal FFI scripting language;
- a cloud SDK wrapper;
- a host object handle system.

## Host ABI Philosophy

Host adapters may be rich.

Public AIR Core and public Host ABI must remain small, canonical, versioned,
capability-scoped, and conformance-tested.

Reject raw host-specific APIs in Core:

- raw `chrome.*`;
- DOM/React/IndexedDB/Jira/fetch;
- AWS/Postgres/cloud SDK imports;
- Unity/Bevy/game-engine object APIs;
- secrets/tokens/private text/raw URL authority.

Prefer generic capability-oriented contracts:

- output intent;
- notification request;
- storage policy;
- compute batch;
- render graph / command buffer;
- audit/report evidence.

## Host ABI Promotion Gate

New Host ABI imports require:

- generic semantics;
- at least two independent domains/use cases;
- capability model;
- effect model;
- host profile support;
- package-check/report/verification visibility;
- conformance fixtures;
- negative tests;
- no raw authority leak;
- rollback/compatibility path.

## Strategic Risk

The main risk is not that AIR is too small.

The main risk is that AIR becomes too broad and loses:

- reviewability;
- boundedness;
- verifier strength;
- capability clarity;
- deterministic diagnostics;
- small audit surface.
