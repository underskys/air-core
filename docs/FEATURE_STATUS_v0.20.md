# AIR v0.20 Feature Status

Status: active first slice

Version target: v0.20

v0.20 is the Bounded Data & Command Buffer First Slice milestone. It builds on
the v0.18 bounded facts and Output Contract tooling, and on the v0.19 compact
static table and diagnostics-only Full LSP MVP baseline. The active P0 target is
deterministic tooling/conformance alignment for bounded rowsets, command/result
buffer output intents, and verification evidence.

v0.20 must not add Host ABI `0.11`, AIR ABI `0.11`,
`output.emit`/`output.event`/`audio.event`/`effect.event`, raw `chrome.*`,
DOM/React/IndexedDB/Jira/fetch authority, secrets/tokens/private text/raw URL
authority, arbitrary JSON objects inside AIR, dynamic maps, GC, reflection,
host object handles, promises, callbacks, async/await, runtime imports, package
registry behavior, native installers, game-specific Core APIs, full `u8`/`u16`
SSA arithmetic, or silent truncation.

Status values:

- `stable/active`: inherited active behavior from earlier milestones.
- `active/planned`: v0.20 P0 planning or implementation target.
- `P1`: optional work if scope allows and RFC gates pass.
- `deferred`: future work outside v0.20 P0.
- `rejected`: not allowed in AIR Core, stdlib, Host ABI, package contracts, or
  host profiles.

Related documents:

- [AIR v0.20 Release Plan](V0_20_RELEASE_PLAN.md)
- [AIR v0.19 Feature Status](FEATURE_STATUS_v0.19.md)
- [AIR v0.19 Release Plan](V0_19_RELEASE_PLAN.md)
- [Compact Storage Types RFC](rfcs/v0.18-compact-storage-types.md)
- [Full LSP MVP RFC](rfcs/v0.19-full-lsp-mvp.md)
- [Formal Grammar and Parser Hardening RFC](rfcs/v0.19-formal-grammar-parser-hardening.md)
- [Bounded Structured Facts RFC](rfcs/v0.18-bounded-structured-facts.md)
- [Bounded Rowsets RFC](rfcs/v0.20-bounded-rowsets.md)
- [Batch Conformance Fixtures RFC](rfcs/v0.20-batch-conformance-fixtures.md)
- [Command Buffer Output Intents RFC](rfcs/v0.20-command-buffer-output-intents.md)
- [Output Contract Manifest Tooling RFC](rfcs/v0.18-output-events-manifest.md)
- [Version and ABI Policy](VERSION_AND_ABI_POLICY.md)

## Stable / Active Baseline

| Feature | Layer | v0.20 status |
| --- | --- | --- |
| Diagnostic normalization and LSP-lite JSON | tooling/report | Active from v0.15 through `airc check <file-or-package> --lsp-json`. |
| `airpkg` metadata artifact | package/artifact | Inherited active first slice from v0.16. |
| Link plan and linked WAT/Wasm first slice | package/linking | Inherited active first slice from v0.16 for simple scalar package-local graphs. |
| Host conformance/replay first slice | host/profile | Inherited active first slice from v0.16 for deterministic scalar traces. |
| `check-airpkg` | package/artifact | Inherited active first slice from v0.17. |
| `bundle` and `check-bundle` | product/tooling | Inherited active first slice from v0.17 for `web-dev` and `native-dev` folder bundles. |
| Bounded facts schema validator | package/check/report | Inherited active first slice from v0.18 through package-local `factSchemas`. |
| Output Contract manifest validator | package/check/report | Inherited active first slice from v0.18 through package-local `outputContracts`; tooling-only, no runtime emit. |
| Packed static tables | storage/layout | Inherited active first slice from v0.19. Static tables may use `u8`, `u16`, and `i16`; compact table reads return `i32`. |
| Diagnostics-only Full LSP MVP | tooling | Inherited active first slice from v0.19 through `airc lsp --stdio`; no IDE feature scope. |
| Core/demo separation | repo policy | Active. Core tracks no active demo implementations. |

## Active / Planned P0

| Feature | Layer | v0.20 status |
| --- | --- | --- |
| Stable verification evidence JSON | release/package evidence | Active P0 first slice through `airc verify package <dir> --json`. Evidence emits a deterministic `air.verificationEvidence` report artifact that connects package identity, selected profile, diagnostics, fact schema fingerprints, Output Contract fingerprints, generated artifact status, profile compatibility, package hash, ABI hash, and ABI status. |
| Bounded rowset schema metadata | package/check/report/evidence | Active P0 first slice through existing `factSchemas` references with `kind: "air.boundedRowsetSchema"`. Rowset schemas validate package-local columnar metadata with fixed `maxRows`, scalar `i32`/`bool` columns, privacy metadata, storage hints, stable diagnostics, report visibility, and verification evidence. No tablegroup syntax, generated rowset handles, runtime JSON model, AIR ABI change, or Host ABI change. |
| Command/result buffer output intents | package/check/report/conformance | Active P0 first slice through package-local `commandBuffers` metadata. Records are bounded scalar output intents tied to `outputContracts`; package-check validates visible `output_id` usage, reports expose usage, and conformance compares command records. No runtime `output.emit`, Host ABI `0.11`, or automatic host-side action execution. |
| FlowDesk-style batch conformance pressure | conformance/fixtures | Active P0 through `air.conformance.batchFixture` test-harness JSON using minimized rowset inputs and deterministic scalar expected output intents. Fixture JSON is not AIR runtime data. |
| AirOps-style batch conformance pressure | conformance/fixtures | Active P0 through `air.conformance.batchFixture` operations/pipeline pressure evidence using host-owned authority boundaries, deterministic replay checksums, and scalar output intent comparisons. |
| ABI decision gates | release policy | Planned P0. AIR ABI and Host ABI stay `0.10` unless explicit runtime or host import gates pass. |

## P1

| Feature | Target | v0.20 rule |
| --- | --- | --- |
| `extension-basic` experimental kit | host profile / kit | P1 only; host-owned Chrome Extension pressure without raw `chrome.*` authority in AIR. |
| AirOps AIR authority demo | examples / pressure evidence | P1 proof package only; no Core authority expansion. |
| Generated handle regeneration diagnostics | tooling/LSP | P1 after v0.20 contracts stabilize. |
| Packed facts / compact column storage | storage/layout | P1 reuse of v0.19 compact static tables; no full compact SSA arithmetic. |
| Tablegroups for rowset ergonomics | AIR source syntax | P1/v0.21 candidate only; not implemented in v0.20 P0. |
| Command buffer ergonomics | package/check/report | P1 improvements after metadata and conformance surfaces are stable. |

## Deferred

| Feature | v0.20 status |
| --- | --- |
| Host ABI `0.11` | Deferred. |
| AIR ABI `0.11` | Deferred. |
| `output.emit` / `output.event` / `audio.event` / `effect.event` | Deferred. |
| Raw `chrome.*` | Rejected/deferred from Core surface. |
| DOM / React / IndexedDB / Jira / fetch authority in AIR | Rejected. |
| Secrets, tokens, private text, or raw URL authority in AIR | Rejected. |
| Arbitrary JSON objects inside AIR | Rejected. |
| Dynamic maps | Rejected. |
| GC | Rejected. |
| Reflection | Rejected. |
| Host object handles | Rejected. |
| Promises / callbacks / async-await in AIR | Rejected. |
| Runtime imports | Rejected. |
| Package registry | Deferred. |
| Native installers | Deferred. |
| Game-specific Core APIs | Rejected. |
| Full `u8`/`u16` SSA arithmetic | Deferred. |
| Silent truncation | Rejected. |

## Rejected / Direct No

| Feature | Layer | v0.20 rule |
| --- | --- | --- |
| More AIR authority as a shortcut for host facts | AIR Core / Host ABI | Rejected. Hosts own raw state and authority; AIR receives minimized bounded facts. |
| Dynamic object model for rowsets | AIR Core | Rejected. Rowsets are bounded metadata and scalar contracts, not runtime objects. |
| Automatic host-side action execution from command intents | Host ABI | Rejected in P0. Output intents are reviewable metadata/conformance surface until a separate Host ABI promotion is accepted. |
| Browser-specific Core semantics | AIR Core | Rejected. Chrome Extension pressure belongs in host profile/kit design, not Core semantics. |

## Version Semantics

- Project milestone: `v0.20`.
- AIR ABI version: remains `0.10` unless runtime/executable contract changes.
- Host ABI version: remains `0.10` unless accepted host imports or host import
  semantics change.
- Package/tooling version remains separate from project milestone version.

Verification evidence JSON is report/tooling output only. It is suitable for
downstream reports such as AirOps and FlowDesk, but it does not add AIR runtime
semantics, Host ABI authority, real infrastructure authority, or runtime output
execution.
