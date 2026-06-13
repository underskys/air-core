# AIR v0.18 Release Plan

Status: first-slice implementation

Theme: Bounded Facts & Output Contract Readiness

v0.18 starts from the v0.17 artifact validation and target bundle first slice.
The milestone focuses on ergonomic, reviewable, bounded structured data and on
the evidence needed before any event/output Host ABI promotion. It must not add
raw browser authority, `output.emit`, Host ABI `0.11`, AIR ABI `0.11`, dynamic
maps, GC, reflection, host object handles, promises, async/await, runtime
imports, package registry behavior, or native installers.

FlowDesk Air and Chrome Extension pressure are non-game evidence for generic
architecture only. They are RFC candidates, not AIR Core authority and not
accepted public ABI.

Current first-slice implementation: package metadata may reference bounded
facts schemas through `factSchemas` and tooling-only Output Contract manifests
through `outputContracts`. Package-check validates those files and package
reports expose schema metadata, fingerprints, channels, capabilities, and
diagnostics. This is tooling and review/report surface only. It does not add an
AIR runtime object model, runtime output emission, dynamic JSON/maps,
tablegroups, runtime imports, or Host ABI behavior.

Bounded facts are treated as a boundary-of-authority contract:

```text
Host rich state -> minimized facts -> AIR bounded schema -> AIR deterministic decision -> output intent -> host policy execution
```

Host policy, not AIR, owns side-effect execution and browser/platform
authority.

## P0 Scope

| Area | Gate | Acceptance |
| --- | --- | --- |
| Request and ABI pressure triage | Review active pressure inputs before designing new surface. | [v0.18 Request Triage](V0_18_REQUEST_TRIAGE.md) classifies `docs/abi-requests/`, `requests/`, and event/output RFC pressure into P0, P1, deferred, rejected, duplicate, and needs-RFC categories. No pressure request becomes release scope without RFC/release-plan acceptance. |
| Bounded facts schema validator | Keep structured data package-visible without runtime objects. | `air.package.json` may declare package-local `factSchemas`; package-check validates fixed `maxRows`, scalar columns, duplicate columns, dynamic/unbounded markers, absolute paths, and timestamp-like metadata. Reports expose schema fingerprints and fact/table metadata. |
| Bounded facts privacy boundary | Keep raw private data out of AIR and reports. | Schemas must carry privacy metadata; reports surface classifications without raw task text, URLs, tokens, secrets, notes, or browser state. Initial enforcement may be metadata/shape-only, but the boundary is P0 and not optional. |
| Bounded structured facts RFC | Define ergonomic structured inputs without dynamic objects. | [Bounded Structured Facts RFC](rfcs/v0.18-bounded-structured-facts.md) covers static schemas, bounded fact snapshots, fixed-size scalar tables, tablegroups as candidate design, generated handles, package-checked data contracts, report visibility, privacy policy, and conformance compatibility. |
| Output Contract manifest validator | Define event/output intent metadata without runtime emission. | [Output Contract Manifest Tooling RFC](rfcs/v0.18-output-events-manifest.md) covers package-local `outputContracts`, manifest-backed IDs, channels, required capabilities, scalar arg schemas, package-check/report visibility, profile compatibility planning, and no runtime `output.emit`. |
| Event/output Host ABI promotion package | Define evidence required before Host ABI `0.11`. | Promotion package requires at least two domains: interactive/game-like and DevOps/SRE/FlowDesk/policy/dashboard. Evidence must include package-check visibility, report visibility, conformance output stream requirements, debug.metric negative tests, profile unsupported tests, and manifest mismatch tests. |
| `debug.metric` boundary coverage audit | Keep diagnostics separate from semantic events. | Audit tests and docs so event-like `debug.metric` usage remains an anti-slop diagnostic and release policies can fail it. Normal diagnostic metrics should not be over-rejected when the detector can distinguish them. |
| ABI decision gates | Keep ABI changes explicit. | AIR ABI and Host ABI remain `0.10` unless a separate accepted RFC proves runtime contract or Host ABI import changes. |
| FlowDesk / Chrome Extension pressure classification | Keep browser pressure generic and host-owned. | FlowDesk Air remains pressure evidence only. Chrome Extension profile work is RFC candidate only; AIR must not expose raw `chrome.*`, DOM/React, IndexedDB/Dexie, arbitrary fetch/Jira, browser permissions, secrets, or raw private data. |

## P1 / If Scope Allows

- tablegroups first slice, only if the bounded facts RFC accepts a narrow,
  static scalar representation. Tablegroups are not implemented by the current
  bounded facts schema validator first slice;
- [compact storage types and packed tables RFC](rfcs/v0.18-compact-storage-types.md)
  as a future performance path for `u8`/`u16` storage, packed tables, typed
  buffers, and range validation. This is RFC/P1 only, with no implementation
  and no AIR ABI or Host ABI change in v0.18;
- generated output handles tooling for Output Contract manifests;
- [Chrome Extension host profile RFC](rfcs/v0.18-chrome-extension-host-profile.md)
  with host-owned MV3, popup, content script, storage, alarms, notifications,
  context menus, active tab, and scripting authority;
- conformance output stream planning for future accepted event/output contracts;
- two-domain examples for event/output promotion evidence, kept generic and
  outside public Host ABI.

## Deferred

- `output.emit` implementation;
- `audio.event` and `effect.event` implementation;
- Host ABI `0.11`;
- AIR ABI `0.11`;
- tablegroups runtime/syntax support unless separately accepted;
- raw `chrome.*`;
- DOM/React authority in AIR;
- IndexedDB/Dexie authority in AIR;
- arbitrary fetch/Jira authority in AIR;
- dynamic maps, GC, reflection, and host object handles;
- JS promises and async/await in AIR;
- runtime imports;
- package registry;
- native installers.

## Full LSP Roadmap

v0.15 LSP-lite JSON diagnostics are active through:

```sh
airc check <file-or-package> --lsp-json
```

v0.18 must keep bounded facts and output contract diagnostics compatible with
that LSP-lite envelope. Full JSON-RPC LSP server work is deferred to a future
tooling milestone, likely v0.19+.

The first Full LSP milestone should be diagnostics-only:

- `airc lsp --stdio`;
- `initialize` and `shutdown`;
- `textDocument/didOpen`, `textDocument/didChange`, and
  `textDocument/didSave`;
- `textDocument/publishDiagnostics`;
- parser, verifier, package-check, and reviewPolicy diagnostics;
- package graph awareness;
- bounded facts schema diagnostics;
- output contract diagnostics.

Hover, go-to-definition, and code actions are P1 after a diagnostics server is
stable.

## Non-goals

v0.18 must not:

- implement event/output Host ABI;
- implement tablegroups or runtime structured objects;
- turn FlowDesk Air or any consumer into AIR Core authority;
- add Chrome Extension APIs to Core;
- add arbitrary JSON objects or dynamic maps;
- add browser storage, DOM, network, encryption, secret vault, token, URL, or
  private text authority to AIR;
- add game-specific APIs;
- reintroduce active demos into Core.

## ABI Policy

- Project milestone: `v0.18`.
- AIR ABI: remains `0.10` for RFCs, manifests, package-check/report changes,
  static schemas, generated handles, and tooling-only fact/output contracts.
- AIR ABI `0.11` may be required only if structured data contracts change the
  executable runtime representation, package entrypoint semantics, memory/data
  layout, calling convention, or runtime-required package metadata.
- Host ABI: remains `0.10` for manifest tooling, report visibility, profile
  RFCs, conformance planning, and Output Contract metadata.
- Host ABI `0.11` may be required only if a new host import such as a scalar
  `output.emit` candidate is separately accepted through RFC/spec/profile/tests.

See [Version and ABI Policy](VERSION_AND_ABI_POLICY.md).

## Acceptance Gates

- `npm test` passes.
- Markdown links and ABI request checks pass.
- Layer guard passes.
- Core tracks no active demo implementation files.
- v0.18 planning does not create `output.emit`, `audio.event`, or
  `effect.event`.
- Bounded facts design rejects dynamic JSON/maps, GC, reflection, host object
  handles, promises, async/await, and runtime imports.
- FlowDesk / Chrome Extension pressure remains RFC candidate only.
- AIR ABI and Host ABI remain `0.10`.

## Representative Commands

```sh
npm test
node scripts/check_review_bundle.js --keep
node scripts/check_markdown_links.js
node scripts/check_abi_requests.js
node test/layer_guard.test.js
git diff --check
```
