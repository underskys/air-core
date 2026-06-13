# AIR v0.31 API Gates

Status: planning first slice

v0.31 API gates define forbidden patterns for Bounded Structured IO design.
They are documentation gates in this milestone unless a later task explicitly
adds low-noise machine checks. They do not remove legacy APIs and do not imply
structured IO implementation.

## Gate Intent

Bounded Structured IO should improve authoring and review ergonomics without
turning AIR into a dynamic object language, runtime JSON processor, ORM, host
adapter layer, or authority-bearing application runtime.

## Hard Rejected in Core

- runtime JSON values;
- arbitrary JSON object model;
- dynamic objects;
- dynamic maps;
- object identity;
- host object handles;
- raw host authority;
- raw Chrome, DOM, React, IndexedDB, Jira, fetch, filesystem, browser,
  renderer, Canvas, GPU, cloud, Kubernetes, database, or network authority;
- strings, raw URLs, private text, secrets, tokens, credentials, packet payloads,
  or notes as AIR runtime data;
- ORM/database model;
- automatic host-side action execution;
- unbounded rows, arrays, records, or dynamic keys;
- tablegroups as runtime objects;
- generated artifacts as source of truth;
- generated hidden host imports or hidden compiler exports;
- new Host ABI features.

## Deferred / Not Allowed Without Decision Record

- tablegroup syntax;
- AIR ABI `0.11`;
- Host ABI expansion beyond bounded `output.emit`;
- structured IO lowering/runtime representation;
- declared mutable pools;
- compact structured storage;
- standardized state or structured IO snapshots as ABI;
- generated binding semantics that affect AIR runtime behavior.

## Canonical Safe Direction

- host owns rich objects and private payloads;
- AIR sees minimized scalar IDs, handles, enums, flags, scores, counters, and
  bounded facts;
- fact schemas and bounded rowset schemas describe structured input metadata;
- Output Contracts and command buffers describe bounded output intent metadata;
- state declarations describe AIR-owned fixed scalar state;
- generated bindings are host/tooling artifacts derived from source-of-truth
  schemas and contracts;
- package report, verification evidence, package diff, evidence report, LSP,
  and conformance replay make metadata visible without exposing raw payloads.

## Future Machine Check Candidates

Low-noise checks may fail only on strong forbidden patterns in active non-doc
Core paths:

- new parser/verifier/lowering support for runtime JSON/object/map fields;
- active Core source declaring tablegroup syntax before RFC acceptance;
- active Core source treating generated structured IO artifacts as source of
  truth;
- new host imports or profiles for structured IO authority;
- payload/data/object/json fields in Core runtime schemas;
- host object handle fields;
- raw authority tokens in active Core/API paths.

Allowed:

- docs-only rejected/future mentions;
- tests/hallucination fixtures that explicitly assert rejection;
- migration/deprecation docs;
- package metadata schemas that describe bounded scalar records without runtime
  JSON semantics.

## Kill Criteria

Stop or reject the design if it requires:

- runtime JSON/object semantics;
- dynamic field lookup;
- dynamic maps;
- object identity;
- host object handles;
- unbounded rows or arrays;
- strings/raw URLs/private text/tokens/secrets inside AIR;
- host direct object access;
- ORM or database behavior;
- tablegroups as runtime objects;
- Host ABI expansion;
- AIR ABI bump without executable/runtime contract evidence;
- generated artifacts becoming source of truth.

## ABI Status

- AIR ABI remains `0.10`.
- Host ABI remains latest `0.11`, limited to bounded `output.emit`.
- Host ABI `0.10` remains the default/baseline compatibility target.
- v0.31 gates do not add host imports or runtime semantics.
