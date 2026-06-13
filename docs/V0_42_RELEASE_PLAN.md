# AIR v0.42 Release Plan

Status: active planning/docs milestone

Theme: Resource Validators & ReviewPolicy Hard Gates

v0.42 plans deterministic package/resource validation hooks and harder
reviewPolicy regression gates. It follows v0.41, which completed the Declared
Fixed-Capacity Pools First Slice. v0.42 must not add language features, AIR ABI,
Host ABI, host authority, demo-specific APIs, or external demo source changes.

AIR ABI latest remains `0.10`. Host ABI latest remains `0.11`, limited to
bounded `output.emit`. Host ABI `0.10` remains the default/baseline target for
packages that do not use `output.emit`.

## Purpose

Some pressure currently lives in demo-local validation: runtime asset usage,
sprite alpha checks, audio stub checks, generated handle freshness checks, and
reviewPolicy trend gates. v0.42 defines the safe generic subset that belongs in
Core package-check/report/reviewPolicy surfaces.

This is generic package/resource validation pressure, not a platformer or
browser bundling API request.

## P0 Scope

| P0 item | Expected v0.42 planning outcome |
| --- | --- |
| Resource validator registry design | Define deterministic validator registration, input, output, status, diagnostics, and ownership metadata. |
| Package-check validator hooks | Define where package-check invokes resource validators without changing language semantics. |
| Runtime root checks | Define allowed runtime/package roots and forbidden root diagnostics. |
| Manifest reference freshness checks | Define stale/missing/unknown manifest reference validation. |
| Generated handle freshness integration | Define how generated handle freshness participates in package-check/report without making generated artifacts source of truth. |
| ReviewPolicy hard gate model | Define hard gates for new select-chain-as-table, undeclared slot-family, and debug.metric regressions. |
| Declared-pool/tablegroup exceptions | Define how declared pools and readonly tablegroups suppress false positives. |
| Trend compare regression gates | Define baseline debt representation and failure behavior for new regressions. |
| Report/evidence visibility | Define report/evidence fields for resource validators and reviewPolicy gates. |
| v0.42 API gates | Define docs/gate expectations for no language/ABI/resource-authority expansion. |
| No language/ABI changes | Keep v0.42 scoped to package-check/report/reviewPolicy planning. |

## P1

- PNG alpha / image quality validator if deterministic and low-risk;
- audio non-silence/stub validator if deterministic and low-risk;
- Consumer Evidence Corpus integration;
- LSP diagnostics for resource/reviewPolicy issues;
- repair hints.

## Deferred

- demo-specific validators;
- browser/Vite bundling;
- asset pipeline rewrite;
- full media analysis;
- external demo source changes;
- Host ABI changes;
- AIR ABI changes;
- package registry;
- native installers.

## Hard Constraints

- validators must be deterministic;
- no network;
- no external services;
- no raw private data;
- no large media in Core review bundles;
- no demo-specific Core APIs;
- no host authority;
- resource validation is package-check/report layer, not language semantics.

## Design Questions

v0.42 RFCs must answer:

- what validators are generic;
- what remains demo-local;
- how baseline debt is represented;
- how regressions fail;
- how declared pools and tablegroups suppress false positives;
- how report/evidence exposes validator and reviewPolicy results.

## API Gates

v0.42 API gates are planning gates. They must reject active implementation of
language/ABI/resource-authority expansion while allowing docs/RFC discussion of
future deterministic validators.

## Acceptance Criteria

v0.42 planning is complete when:

- the resource validator RFC defines registry, package-check hooks, generic
  validators, demo-local boundaries, reports, and kill criteria;
- the reviewPolicy hard gates RFC defines baseline debt, regression failure,
  declared-pool/tablegroup exceptions, and diagnostics;
- API gates document the accepted planning boundary;
- AIR ABI remains `0.10`;
- Host ABI remains unchanged.

## Links

- [Feature Status v0.42](FEATURE_STATUS_v0.42.md)
- [Resource Validators RFC](rfcs/v0.42-resource-validators.md)
- [ReviewPolicy Hard Gates RFC](rfcs/v0.42-reviewpolicy-hard-gates.md)
- [API Gates v0.42](API_GATES_v0_42.md)
- [Architecture Gates](ARCHITECTURE_GATES.md)
- [Version and ABI Policy](VERSION_AND_ABI_POLICY.md)
