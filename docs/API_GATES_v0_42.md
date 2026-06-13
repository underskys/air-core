# AIR API Gates v0.42

Status: planned/docs gate

v0.42 gates protect the Resource Validators & ReviewPolicy Hard Gates planning
scope. v0.42 is not a language or ABI milestone.

The gate must allow docs/RFC planning for deterministic resource validators and
reviewPolicy regression gates while rejecting active implementation of forbidden
runtime, host, demo-specific, or ABI surfaces.

## Accepted Planning Surface

v0.42 may define:

- resource validator registry design;
- package-check validator hook design;
- runtime root allowlist and forbidden root checks;
- manifest reference freshness checks;
- generated handle freshness integration;
- reviewPolicy hard gate model;
- trend compare regression model;
- report/evidence visibility for validator and reviewPolicy results;
- docs/RFC mentions of deterministic P1 media validators.

## Rejected Active Implementation

v0.42 rejects active implementation of:

- language syntax changes;
- AIR ABI expansion;
- Host ABI expansion;
- host authority;
- network or external services;
- raw private data ingestion;
- demo-specific Core APIs;
- browser/Vite bundling;
- asset pipeline rewrite;
- package registry;
- native installers;
- nondeterministic validators;
- large media in Core review bundles;
- runtime JSON/object model;
- dynamic maps;
- GC;
- host object handles.

Docs and RFCs may mention rejected/deferred items only as future work,
non-goals, pressure, or kill criteria.

## Planned Gate Behavior

Future `npm run check:api-gates:v0.42` should verify:

- v0.42 docs and RFCs are present;
- package-check/reviewPolicy planning does not claim implementation;
- resource validators are deterministic and package-local by design;
- no new language syntax, AIR ABI, Host ABI, host authority, or demo-specific
  API is introduced;
- deferred media validators remain explicitly deterministic and low-risk.

## ABI Decision

AIR ABI remains `0.10`.

Host ABI latest remains `0.11`, limited to bounded `output.emit`. v0.42 adds no
Host ABI imports and no host authority.

If a future validator implementation requires executable/runtime or host import
contract changes, implementation must stop and require ABI review.
