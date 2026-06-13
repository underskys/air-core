# AIR v0.20 Release Plan

Status: active first slice

Theme: Bounded Data & Command Buffer First Slice

v0.20 starts from the v0.19 compact static table and diagnostics-only Full LSP
baseline. The milestone should make bounded data and bounded output practical,
not by giving AIR more authority, but by making host facts, AIR decisions,
command intents, verification evidence, and replay reports line up as one
deterministic pipeline.

v0.20 must not add Host ABI `0.11`, AIR ABI `0.11`, raw Chrome authority,
arbitrary JSON runtime values, dynamic maps, GC, reflection, host object
handles, promises, callbacks, async/await, runtime imports, package registry
behavior, native installers, or game-specific Core APIs.

## P0 Scope

| Area | Gate | Acceptance |
| --- | --- | --- |
| Stable verification evidence JSON | Make release and package evidence machine-readable. | `airc verify package <dir> --json` emits a deterministic `air.verificationEvidence` report artifact with package identity, selected profile, diagnostics, fact schema fingerprints, Output Contract fingerprints, generated artifact status, profile compatibility, package hash, ABI hash, and ABI status without timestamps or absolute paths. |
| Bounded rowset schema metadata first slice | Make structured host facts reviewable without runtime objects. | Active through `factSchemas` entries with `kind: "air.boundedRowsetSchema"`. Package-local metadata describes bounded rowset schemas with stable names, fixed row limits, scalar columns, privacy classification, compact storage hints, fingerprints, diagnostics, verification evidence, and report visibility. This is tooling/package metadata first, not arbitrary JSON inside AIR. |
| Command/result buffer output-intent first slice | Make bounded output intents reviewable before Host ABI promotion. | Active through package-local `commandBuffers` metadata that records bounded scalar command intent records tied to `outputContracts`. Reports expose output intent usage and conformance can compare expected command records. No runtime `output.emit`, Host ABI `0.11`, or host-side automatic action execution is added. |
| Batch conformance pressure fixtures | Prove the pipeline across non-game pressure. | Active through deterministic `air.conformance.batchFixture` traces for FlowDesk-style task/policy pressure and AirOps-style operations/pipeline pressure. Fixture JSON is host/test-owned input and expected output-intent evidence, not AIR runtime JSON. Reports include replay checksums and stable mismatch diagnostics. |
| ABI decision gates | Keep ABI changes explicit. | AIR ABI remains `0.10` unless runtime/package representation changes. Host ABI remains `0.10` unless a new accepted host import or host authority contract is added. |

## P1 / If Scope Allows

- `extension-basic` experimental kit for host-owned Chrome Extension pressure;
- AirOps AIR authority demo or proof package that remains non-authoritative and
  host-owned;
- generated handle regeneration and LSP diagnostics for v0.20 contracts;
- packed facts / compact column storage that builds on v0.19 packed static
  tables;
- command buffer ergonomics improvements after the metadata and conformance
  contract is stable.

## Deferred

- Host ABI `0.11`;
- AIR ABI `0.11`;
- `output.emit`, `output.event`, `audio.event`, and `effect.event`;
- raw `chrome.*`;
- DOM, React, IndexedDB, Jira, or fetch authority in AIR;
- secrets, tokens, private text, or raw URL authority in AIR;
- arbitrary JSON objects inside AIR;
- dynamic maps;
- GC;
- reflection;
- host object handles;
- promises, callbacks, or async/await in AIR;
- package registry;
- native installers;
- game-specific Core APIs;
- full `u8`/`u16` SSA arithmetic;
- silent truncation.

## Non-goals

v0.20 must not:

- turn bounded rowsets into a dynamic object model;
- make AIR own browser, DOM, database, network, secret, or external API
  authority;
- promote output intents to Host ABI without the event/output promotion gate;
- introduce game-specific command APIs into Core;
- weaken v0.19 diagnostics-only LSP boundaries.

Verification evidence JSON is a machine-readable report artifact for downstream
systems such as AirOps and FlowDesk. It does not add AIR runtime semantics, does
not add Host ABI authority, does not imply real infrastructure authority, and
does not execute output intents. The first-slice `packageHash` covers
package-relevant report metadata available to the tool: modules, package graph,
fact schema fingerprints, Output Contract fingerprints, generated artifact
status, and capability summary. The first-slice `abiHash` covers AIR ABI, Host
ABI, required capabilities, and used host imports visible in the evidence.

Bounded rowset schema metadata is the v0.20 structured-data first slice. Rowset schema
files remain under the existing package `factSchemas` path and use
`kind: "air.boundedRowsetSchema"`. The rowset layer is package metadata/tooling only:
it validates fixed row limits, columnar layout, scalar `i32`/`bool` columns,
privacy metadata, and storage hints such as `u8` or `u16` without adding
tablegroup syntax, generated rowset handles, runtime JSON objects, dynamic maps,
or ABI changes. Tablegroups remain a future AIR source ergonomics candidate.

Batch conformance fixtures are test-harness artifacts. The harness decodes JSON
fixtures, validates rowset inputs against package rowset schemas, and compares
harness-captured output intent records against expected scalar records. AIR does
not parse the fixture JSON, receive arbitrary JSON objects, access dynamic
fields, or execute output intents. Batch reports include a deterministic
`replayChecksum`, rowset summaries, observed/expected output intent summaries,
and mismatch diagnostics for output count, output ID/channel/args, unsupported
profiles, privacy leaks, row bound violations, and nondeterministic fields.

Command buffers are package-local tooling metadata. A command buffer record is a
bounded scalar intent record with `output_id`, `arg0`, `arg1`, `arg2`, and
`arg3`. `output_id` must reference an output declared by `outputContracts`.
Command buffers are not a standardized exported entrypoint, host import, or
runtime ABI. Host policy owns any future execution decision.

## ABI Policy

- Project milestone: `v0.20`.
- AIR ABI: remains `0.10` for metadata, report, and conformance-first bounded
  data work unless executable runtime representation, calling convention,
  memory/data layout, package entrypoint semantics, or runtime-required package
  metadata changes.
- Host ABI: remains `0.10`; bounded rowset schema metadata, command intent
  metadata, command buffer metadata, and conformance fixtures do not add host
  imports or host authority.
- Host ABI `0.11` remains deferred to a separate accepted Host ABI RFC.

See [Version and ABI Policy](VERSION_AND_ABI_POLICY.md).

## Acceptance Gates

- `npm test` passes.
- Bundle-mode tests pass.
- Review bundle, markdown link, ABI request, and layer guard checks pass.
- Core tracks no active demo implementation files.
- P0 evidence JSON and metadata outputs are deterministic.
- P0 does not add Host ABI `0.11`, AIR ABI `0.11`, output event imports,
  arbitrary JSON runtime values, dynamic maps, GC, reflection, host object
  handles, promises, async/await, runtime imports, raw Chrome APIs, package
  registry behavior, native installers, or game-specific Core APIs.

## Representative Commands

```sh
npm test
npm run test:bundle
node scripts/check_review_bundle.js --keep
node scripts/check_markdown_links.js
node scripts/check_abi_requests.js
node test/layer_guard.test.js
git diff --check
```
