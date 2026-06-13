# AIR v0.19 Feature Status

Status: planning

Version target: v0.19

v0.19 is the Compact Storage & Verification UX milestone. It builds on the
v0.18 bounded facts schema validator and tooling-only Output Contract manifest
validator. The active P0 storage slice is packed static table storage only:
`table name:u8 = [...]`, `table name:u16 = [...]`, and
`table name:i16 = [...]` with `table.get.u8`, `table.get.u16`, and
`table.get.i16` materializing `i32`. The active P0 tooling slice is the
diagnostics-only Full LSP MVP through `airc lsp --stdio`.

v0.19 must not add full `u8`/`u16` SSA value types, `u8`/`u16` arithmetic,
silent truncation, tablegroups implementation, event/output Host ABI, Host ABI
`0.11`, AIR ABI `0.11`, Chrome APIs, package registry behavior, native
installers, dynamic maps, arbitrary JSON runtime values, GC, reflection, host
object handles, promises, async/await, runtime imports, hover, go-to-definition,
document symbols, code actions, formatting, semantic tokens, VS Code extension,
background daemon cache, AI repair commands, or game-specific APIs.

Status values:

- `stable/active`: inherited active behavior from earlier milestones.
- `active/planned`: v0.19 P0 planning or implementation target.
- `P1`: optional work if scope allows and RFC gates pass.
- `deferred`: future work outside v0.19 P0.
- `rejected`: not allowed in AIR Core, stdlib, Host ABI, package contracts, or
  host profiles.

Related documents:

- [AIR v0.19 Release Plan](V0_19_RELEASE_PLAN.md)
- [Compact Storage Types RFC](rfcs/v0.18-compact-storage-types.md)
- [Full LSP MVP RFC](rfcs/v0.19-full-lsp-mvp.md)
- [Formal Grammar and Parser Hardening RFC](rfcs/v0.19-formal-grammar-parser-hardening.md)
- [AIR v0.18 Feature Status](FEATURE_STATUS_v0.18.md)
- [AIR v0.18 Release Plan](V0_18_RELEASE_PLAN.md)
- [Bounded Structured Facts RFC](rfcs/v0.18-bounded-structured-facts.md)
- [Output Contract Manifest Tooling RFC](rfcs/v0.18-output-events-manifest.md)
- [Version and ABI Policy](VERSION_AND_ABI_POLICY.md)

## Stable / Active Baseline

| Feature | Layer | v0.19 status |
| --- | --- | --- |
| Diagnostic normalization and LSP-lite JSON | tooling/report | Active from v0.15 through `airc check <file-or-package> --lsp-json`. |
| `airpkg` metadata artifact | package/artifact | Inherited active first slice from v0.16. |
| Link plan and linked WAT/Wasm first slice | package/linking | Inherited active first slice from v0.16 for simple scalar package-local graphs. |
| Host conformance/replay first slice | host/profile | Inherited active first slice from v0.16 for deterministic scalar traces. |
| `check-airpkg` | package/artifact | Inherited active first slice from v0.17. |
| `bundle` and `check-bundle` | product/tooling | Inherited active first slice from v0.17 for `web-dev` and `native-dev` folder bundles. |
| Bounded facts schema validator | package/check/report | Inherited active first slice from v0.18 through package-local `factSchemas`. |
| Output Contract manifest validator | package/check/report | Inherited active first slice from v0.18 through package-local `outputContracts`; tooling-only, no runtime emit. |
| Core/demo separation | repo policy | Active. Core tracks no active demo implementations. |

## Active / Planned P0

| Feature | Layer | v0.19 status |
| --- | --- | --- |
| Packed static tables | storage/layout | Active P0 first slice. Static tables may use compact storage types `u8`, `u16`, and `i16`; they remain readonly and fixed-length. |
| Compact table reads | verifier/lowering/report | Active P0 first slice. `table.get.u8`, `table.get.u16`, and `table.get.i16` return `i32`; no full compact SSA value types. |
| Storage savings reporting | report/reviewPolicy | Active P0 first slice. Reports expose element type, storage type, length, byte size, equivalent `i32` bytes, and estimated savings. |
| Full LSP MVP | tooling | Active P0 first slice. `airc lsp --stdio` implements diagnostics-only JSON-RPC LSP transport and reuses LSP-lite diagnostics normalization. |
| Formal grammar / parser hardening RFC | parser/tooling | Active P0 planning. [Formal Grammar and Parser Hardening RFC](rfcs/v0.19-formal-grammar-parser-hardening.md) defines EBNF, AST schema documentation, formatter roundtrip law, golden corpora, fuzzing plan, and feature admission checklist; no parser implementation change in this planning step. |
| ABI decision gates | release policy | Planned P0. AIR ABI and Host ABI stay `0.10` unless explicit runtime or host import gates pass. |

## P1

| Feature | Target | v0.19 rule |
| --- | --- | --- |
| `load/store` `u8`/`u16`/`i16` | storage/layout | RFC or implementation only after packed static tables are stable. |
| Typed buffers RFC | storage/layout | P1 planning. |
| Tablegroups RFC hardening | bounded facts / source ergonomics | P1 planning; no implementation unless separately accepted. |
| LSP client integration experiments | tooling | P1 after diagnostics-only server behavior is stable. |
| Generated handles for packed tables | package/tooling | P1 integration. |
| Benchmarks | release evidence | Table bytes, Wasm size, WAT size, report size, and diagnostic deltas. |

## Deferred

| Feature | v0.19 status |
| --- | --- |
| Full `u8`/`u16` SSA value types | Deferred. |
| `u8`/`u16` arithmetic | Deferred. |
| Silent truncation | Rejected. |
| Tablegroups implementation | Deferred. |
| Compact load/store beyond static packed tables | Deferred unless separately accepted. |
| Dynamic maps, arbitrary JSON runtime values, GC, reflection, host object handles | Rejected. |
| JS promises / async-await in AIR | Rejected. |
| Runtime imports | Rejected. |
| `output.emit` / `output.event` / `audio.event` / `effect.event` | Deferred. |
| Host ABI `0.11` | Deferred. |
| AIR ABI `0.11` | Deferred. |
| Raw Chrome APIs | Rejected. |
| Package registry | Deferred. |
| Native installers | Deferred. |
| Full VS Code extension | Deferred. |
| Hover / go-to-definition / document symbols / code actions | Deferred. |
| Formatting / semantic tokens / rename | Deferred. |
| Background LSP daemon cache / AI repair commands | Deferred. |

## Rejected / Direct No

| Feature | Layer | v0.19 rule |
| --- | --- | --- |
| Compact storage as general scalar arithmetic | AIR Core | Rejected. `i32` remains the computation carrier. |
| Silent narrowing/truncation | verifier/lowering | Rejected. Range uncertainty must stay visible as diagnostics, guards, or explicit policy. |
| Dynamic object model through packed storage | AIR Core | Rejected. Compact storage is layout, not runtime objects. |
| Game-specific packed layouts in Core | AIR Core / stdlib | Rejected. Downstream examples may provide pressure evidence only. |

## Version Semantics

- Project milestone: `v0.19`.
- AIR ABI version: remains `0.10` unless runtime/executable contract changes.
- Host ABI version: remains `0.10` unless accepted host imports or host import
  semantics change.
