# AIR v0.19 Release Plan

Status: planning

Theme: Compact Storage & Verification UX

v0.19 starts from the v0.18 bounded facts and Output Contract tooling baseline.
The milestone focuses on compact storage/layout types for static package data
and on diagnostics-only verification UX. It must not add Host ABI `0.11`, AIR ABI
`0.11`, tablegroups, dynamic maps, arbitrary JSON runtime values, GC,
reflection, host object handles, promises, async/await, runtime imports,
`output.emit`, Chrome APIs, package registry behavior, native installers, or
game-specific APIs.

The compact storage work is intentionally narrow: v0.19 P0 targets packed
static tables only. AIR keeps `i32` as the computation carrier. `u8`, `u16`,
and `i16` are compact table storage types, not new scalar arithmetic types.
`table name:u8 = [...]`, `table name:u16 = [...]`, and
`table name:i16 = [...]` declare fixed readonly compact tables.
`table.get.u8`, `table.get.u16`, and `table.get.i16` materialize `i32`.
No silent truncation is allowed. P0 must not require an AIR ABI or Host ABI
bump.

## P0 Scope

| Area | Gate | Acceptance |
| --- | --- | --- |
| Compact storage first slice | Implement storage/layout types only for packed static tables. | Static tables may use `u8`, `u16`, and `i16` storage. `table.get.u8`, `table.get.u16`, and `table.get.i16` return `i32`. Reports expose table element type, storage type, table length, byte size, equivalent `i32` byte size, and estimated savings. |
| No new scalar arithmetic types | Keep verifier and lowering semantics small. | AIR does not add full `u8`/`u16` SSA value types, `u8`/`u16` arithmetic, C-like integer promotion, or silent truncation. Loaded compact values become `i32`. |
| Full LSP MVP | Implement a diagnostics-only JSON-RPC server without IDE feature scope. | [Full LSP MVP RFC](rfcs/v0.19-full-lsp-mvp.md) covers `airc lsp --stdio`, initialize/shutdown, document open/change/save/close, publishDiagnostics, parser/verifier/package-check/reviewPolicy diagnostics, package graph awareness, generated artifact diagnostics, manifest/resource diagnostics, bounded facts diagnostics, Output Contract diagnostics, and compact table diagnostics. The MVP uses full-document didChange sync; package-aware diagnostics run on didSave when a package root is discoverable. Hover, go-to-definition, code actions, formatting, semantic tokens, daemon cache, AI repair commands, and VS Code extension remain outside P0. |
| Formal grammar / parser hardening RFC | Make parser behavior reviewable before broad syntax work. | [Formal Grammar and Parser Hardening RFC](rfcs/v0.19-formal-grammar-parser-hardening.md) covers EBNF, AST shape, formatter roundtrip guarantees, positive/negative parse fixtures, fuzzing strategy, and parser/verifier/lowerer feature admission. No parser rewrite or language syntax expansion is required by this planning step. |
| ABI decision gates | Keep ABI changes explicit. | AIR ABI remains `0.10` unless compact storage changes executable runtime representation, calling convention, memory/data layout, package entrypoint semantics, or runtime-required package metadata. Host ABI remains `0.10` because compact storage and verification UX do not add host imports or host authority. |

## P1 / If Scope Allows

- `load/store` `u8`, `u16`, and `i16` RFC or implementation only after packed
  static tables are stable;
- typed buffers RFC;
- tablegroups RFC hardening, still without implementation unless separately
  accepted;
- Full LSP client integration experiments after the diagnostics-only server is
  stable;
- generated handles integration with packed static tables;
- benchmarks for table bytes, Wasm size, WAT size, report size, and
  verification diagnostics.

## Deferred

- full `u8`/`u16` SSA value types;
- `u8`/`u16` arithmetic;
- silent truncation;
- tablegroups implementation;
- dynamic maps, arbitrary JSON runtime values, GC, reflection, and host object
  handles;
- JS promises and async/await in AIR;
- runtime imports;
- `output.emit`, `output.event`, `audio.event`, and `effect.event`;
- Host ABI `0.11`;
- AIR ABI `0.11`;
- raw Chrome APIs;
- package registry;
- native installers;
- Full VS Code extension.
- Hover, go-to-definition, document symbols, code actions, formatting,
  semantic tokens, background daemon cache, and AI repair commands.

## Non-goals

v0.19 must not:

- add compact storage as a general integer type system;
- change existing scalar value type semantics;
- introduce object identity or dynamic allocation through storage work;
- use compact storage to smuggle dynamic maps or JSON runtime objects into AIR;
- implement event/output Host ABI;
- reintroduce active demos into Core.

## ABI Policy

- Project milestone: `v0.19`.
- AIR ABI: remains `0.10` for packed static tables if they lower through the
  existing scalar table/runtime conventions and do not change executable package
  contracts.
- AIR ABI `0.11` may be required only if compact storage changes runtime
  representation, calling convention, memory/data layout, package entrypoint
  semantics, or runtime-required package metadata.
- Host ABI: remains `0.10`; compact storage and verification UX do not add host
  imports or host authority.
- Host ABI `0.11` remains deferred to a separate accepted Host ABI RFC.

See [Version and ABI Policy](VERSION_AND_ABI_POLICY.md).

## Acceptance Gates

- `npm test` passes.
- Markdown links and ABI request checks pass.
- Layer guard passes.
- Core tracks no active demo implementation files.
- P0 packed tables report byte size and `i32` storage savings.
- P0 does not add full `u8`/`u16` SSA value types or arithmetic.
- P0 does not implement tablegroups, output events, Chrome APIs, package
  registry behavior, or native installers.
- P0 LSP is diagnostics-only and reuses LSP-lite diagnostics normalization.
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
