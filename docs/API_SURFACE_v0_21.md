# AIR API Surface v0.21

Status: planning inventory

This document classifies AIR API surfaces before v0.21 refactoring. It does not
remove legacy APIs, add Host ABI imports, change compiler semantics, or change
AIR ABI / Host ABI versions.

Status categories:

- `public`: stable or intended public surface.
- `experimental`: usable with caution; may change behind release gates.
- `internal`: implementation detail; not adoption guidance.
- `legacy`: supported for compatibility, but not the canonical v0.21 path.
- `rejected/deferred`: not part of AIR Core or public Host ABI unless promoted
  by future RFC/spec/profile/tests.

Canonical v0.21 path:

```text
bounded facts / bounded rowset schemas
-> AIR deterministic scalar decisions
-> output contracts and command buffer output intents
-> verification evidence JSON
-> deterministic conformance fixtures and reports
```

| API surface | Status | Owner | Replacement / canonical path | Notes | Target milestone if changing |
| --- | --- | --- | --- | --- | --- |
| AIR scalar SSA syntax | public | AIR Core | Keep as canonical computation surface. | `i32`, `i64`, `f32`, `f64`, and `bool` remain computation value types. | None. |
| AIR control-flow/function syntax | public | AIR Core | Keep with parser/verifier diagnostics. | Existing function, block, branch, call, return, effects, and contracts remain active. | None. |
| Compact static table syntax | public | AIR Core | Keep `table<u8/u16/i16>` storage as v0.19 first slice. | Storage/layout types only; `table.get.*` returns `i32`. | None. |
| Raw compact load/store ops | rejected/deferred | AIR Core | Use compact static tables only. | No `load.u8`, `store.u16`, typed buffers, or compact arithmetic in v0.21 P0. | Future RFC. |
| Tablegroups syntax | rejected/deferred | AIR Core | Use bounded rowset schema metadata and existing scalar tables. | Candidate source ergonomics only; no implementation in v0.21 P0. | Future RFC / v0.22+ candidate. |
| Package manifest `air.package.json` | public | Package/tooling | Keep as package metadata source of truth. | Canonical path for modules, profiles, facts, output contracts, command buffers, generated modules, and package exports. | v0.21 may add documentation/gate clarity only. |
| Legacy package metadata forms | legacy | Package/tooling | Prefer current `air.package.json` schema. | Keep compatibility until migration gates exist. | Migration plan in v0.21. |
| Host ABI `0.10` imports | public | Host ABI | Keep registry/profile validated imports. | Host ABI remains `0.10`; no new output/event import. | None. |
| Host ABI `0.11` | rejected/deferred | Host ABI | Separate accepted Host ABI RFC required. | Not part of v0.21 P0. | Future RFC. |
| `output.emit` / `output.event` | rejected/deferred | Host ABI | Use Output Contract metadata plus command buffers. | No runtime emit or Host ABI import. | Future promotion gate only. |
| `audio.event` / `effect.event` | rejected/deferred | Host ABI | Use existing accepted host imports or metadata/intents. | Remain rejected/deferred from public Host ABI. | Future promotion gate only. |
| Host profiles | public | Host/profile | Keep as capability/profile compatibility surface. | Profiles describe support and restrictions; they do not grant AIR raw host authority. | None. |
| Chrome Extension profile pressure | experimental | Host/profile docs | Host-owned profile/kit RFC only. | No raw `chrome.*`, DOM, IndexedDB, Jira/fetch, tokens, or browser permissions in AIR. | Future RFC / kit candidate. |
| `airpkg` metadata artifact | public | Package/artifact | Keep v0.16-v0.17 artifact path. | Metadata artifact and inspect/check commands remain active. | None. |
| `check-airpkg` | public | Package/artifact | Keep artifact validation command. | Validates deterministic artifact metadata and runtime boundary. | None. |
| Target folder bundles | public | Product/tooling | Keep `web-dev` / `native-dev` first slice. | Folder bundles are not installers or registry packages. | Future hardening only. |
| Verification evidence JSON | public | Release/package evidence | Canonical machine-readable evidence surface. | `airc verify package <dir> --json`, `kind: "air.verificationEvidence"`. | v0.21 gate/report hardening possible. |
| Bounded facts schemas | public | Package/check/report | Canonical structured input contract with scalar columns. | Package metadata JSON only; not AIR runtime JSON. | None. |
| Bounded rowset schemas | public | Package/check/report/evidence | Canonical v0.21 structured host-fact path. | `kind: "air.boundedRowsetSchema"` under `factSchemas`; shape/limits/privacy only. | v0.21 docs/gate hardening. |
| Rowset fixture JSON | experimental | Conformance/test harness | Keep as host/test-owned input fixture. | Not AIR runtime data; AIR does not parse arbitrary JSON. | v0.21 gate clarity. |
| Output Contract manifests | public | Package/check/report | Canonical output-intent ID/channel/capability schema. | Tooling-only; no runtime emit. | None. |
| Command buffers | public | Package/check/report/conformance | Canonical bounded output-intent record surface. | `kind: "air.commandBuffer"`; scalar `output_id`, `arg0`-`arg3`; host policy owns execution. | v0.21 ergonomics hardening. |
| Generated rowset handles | experimental | Tooling/package | Candidate generated helper surface. | Not implemented in current v0.21 planning task. | P1 after RFC/gates. |
| Generated output handles | experimental | Tooling/package | Candidate generated helper surface. | Not implemented in current v0.21 planning task. | P1 after RFC/gates. |
| Generated modules/handles freshness checks | public | Package/tooling | Keep report-visible generated artifact diagnostics. | Existing generated module checks remain active. | v0.21 may extend plan only. |
| Conformance scalar traces | public | Conformance | Keep v0.16 deterministic scalar replay. | Existing scalar trace format remains active. | None. |
| Batch conformance fixtures | public | Conformance/test harness | Canonical pressure evidence for bounded data and output intents. | FlowDesk/AirOps fixtures are test harness evidence, not demos or AIR runtime data. | v0.21 gate hardening possible. |
| LSP-lite JSON diagnostics | public | Tooling | Keep `airc check --lsp-json`. | Stable diagnostic codes must be preserved. | None. |
| Diagnostics-only Full LSP MVP | public | Tooling | Keep `airc lsp --stdio`. | Diagnostics only; no hover/go-to-definition/code actions in v0.21 P0. | Future P1 for deprecated API diagnostics. |
| LSP hover/go-to-definition/code actions | deferred | Tooling | Diagnostics-first LSP remains canonical. | No IDE feature expansion in this planning task. | Future milestone. |
| CLI `fmt`, `verify`, `check`, `package-check`, `report` | public | CLI/tooling | Keep as primary local workflows. | v0.21 may classify canonical command paths vs legacy examples. | Gate plan in v0.21. |
| CLI `verify package --json` | public | CLI/release evidence | Canonical verification evidence command. | Machine-readable deterministic package evidence. | None. |
| CLI `conformance` | public | CLI/conformance | Keep deterministic scalar and batch conformance reports. | Batch fixtures remain host/test-owned. | None. |
| CLI GFX/app commands | experimental | CLI/host tooling | Keep as existing host/tooling surfaces. | Not the v0.21 canonical bounded-data path; do not delete in planning task. | Inventory/migration review. |
| `stdlib/` generic helpers | public | Stdlib | Keep generic, resource-free helpers. | No demo/project vocabulary or host authority. | None. |
| `kits/` optional starter packages | experimental | Kits | Keep reusable optional resources separate from Core/stdlib. | P1 `extension-basic` kit remains future/experimental only. | P1 candidate. |
| `examples/` canonical examples | public/legacy mixed | Examples/docs | Rebaseline around non-game bounded data examples. | v0.21 should classify canonical vs legacy examples before migrations. | P1 migrations. |
| `demo/` local APIs | legacy/internal | Demo/project local | Keep outside Core API surface. | Demo-local APIs must not become Core, stdlib, or Host ABI. | No broad rewrite in v0.21 P0. |
| Standalone demo repositories | internal/external | Demo repos | Do not touch from AIR Core release planning. | Out of scope for this task. | None. |
| Raw `chrome.*` authority | rejected/deferred | Host/browser | Host-owned profile/kit pressure only. | AIR never accesses raw browser APIs directly. | Future host profile RFC only. |
| DOM/React/IndexedDB/Jira/fetch authority | rejected | Host/application | Host owns rich platform authority. | AIR receives minimized scalar facts only. | None. |
| Arbitrary JSON runtime model | rejected | AIR Core | Use bounded fact/rowset schemas and scalar records. | JSON allowed only as package metadata/schema or test fixture. | None. |
| Dynamic maps / GC / reflection | rejected | AIR Core | Use static schemas, scalar tables, and package-checked contracts. | Not part of AIR safety model. | None. |
| Host object handles | rejected | AIR Core / Host ABI | Use scalar IDs and host-owned resources. | Raw platform objects must not cross into AIR. | None. |
| Promises / async-await in AIR | rejected | AIR Core | Use existing bounded polling patterns. | No JS promise/callback runtime model. | None. |
| Package registry | deferred | Distribution | Use local package/artifact/bundle workflows. | Not part of v0.21. | Future milestone. |
| Native installers | deferred | Distribution | Use folder bundles / host packaging outside Core. | Not part of v0.21. | Future milestone. |

## Canonical vs Legacy Gate Plan

v0.21 should define review gates and a conservative first machine check:

- canonical examples should use package metadata, bounded facts/rowsets, Output
  Contracts, command buffers, verification evidence, and deterministic
  conformance where applicable;
- legacy examples should remain allowed but labeled;
- deprecated API usage should become LSP/report-visible before it becomes a
  failure;
- runtime JSON/object model, raw host authority, output Host ABI imports,
  tablegroup syntax, generated handles, and demo-specific Core APIs must remain
  blocked unless explicitly promoted.

The first machine check is documented in [API Gates v0.21](API_GATES_v0_21.md).
It is intentionally narrow: it blocks strong forbidden patterns in active
non-doc paths and does not remove or break legacy APIs.
