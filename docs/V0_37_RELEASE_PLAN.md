# AIR v0.37 Release Plan

Status: active implementation milestone

Theme: Readonly Tablegroups First Slice

v0.37 implements the readonly tablegroup first slice. The milestone addresses
repeated pressure from parallel scalar tables and select-chain-as-table patterns
while keeping AIR bounded, scalar, readonly, and verifier-visible.

AIR ABI latest remains `0.10`.

Host ABI latest remains `0.11`, limited to bounded `output.emit`; Host ABI
`0.10` remains the default/baseline compatibility target for packages that do
not use `output.emit`.

v0.37 must not implement mutable tablegroups, mutable pools, runtime
JSON/object models, host object handles, game-specific APIs, AIR ABI changes,
or Host ABI changes.

## Purpose

Readonly tablegroups are intended to reduce AI-authored slop around related
static scalar data:

```text
parallel scalar tables / select-chain-as-table
-> named readonly tablegroup
-> equal-length validation
-> verifier-visible bounds
-> lowering to existing static table machinery
```

The first executable slice is narrow: AIR source syntax lowers through existing
static table machinery and does not create a host-visible layout contract.

## Pressure Sources

| Source | Pressure |
| --- | --- |
| AIRON | Readonly grouped scalar tables for level sections, platforms, collision rects, water volumes, visual layers, enemy anchors, pickup anchors, and resource ID sets. |
| FlowDesk | Bounded structured facts and summaries without runtime objects. |
| lan-observer | Bounded read-only structured facts without host object handles. |
| reviewPolicy | Existing `select-chain-as-table` and table-like/slot-family warnings now have explicit routing: readonly related static data -> tablegroup; mutable repeated state -> future declared pool. |

## P0 Scope

| P0 item | Expected output |
| --- | --- |
| Readonly tablegroup model | Implemented grouped readonly scalar fields with fixed row count. |
| Allowed first-slice field/storage types | Implemented `i32` and `bool`. Compact `u8`/`u16`/`i16` deferred. |
| Declaration syntax | Implemented `tablegroup <name> len <N> { field:type = [...] }`. |
| Access operation | Implemented `tablegroup.get.i32 @group.field, idx` and `tablegroup.get.bool @group.field, idx`. |
| Equal-length validation | Implemented through parser/verifier validation. |
| Bounds validation | Implemented static OOB rejection and deterministic dynamic table read behavior through existing static table lowering. |
| Report/evidence visibility | Implemented `tableGroups[]` in conformance/package report and verification evidence. |
| Lowering model | Implemented lowering to existing static table machinery without ABI change. |
| LSP diagnostics | Implemented stable tablegroup diagnostic codes through existing diagnostics/LSP pipeline. |
| reviewPolicy integration | Planned follow-up; existing warnings now have an implemented route. |
| AIRON level-data fixture | Implemented synthetic AIRON-style level-data tablegroup test only; no demo import or game-specific API. |
| ABI decision | AIR ABI remains `0.10`; Host ABI unchanged. |

## P1 Scope

- generated tablegroup handles;
- editor roundtrip;
- richer compact storage;
- tablegroup diff visualization;
- package-local completion metadata.

## Deferred

- mutable tablegroups;
- dynamic row counts;
- nested records;
- runtime JSON;
- objects/maps;
- tablegroup methods;
- declared mutable pools;
- host object handles;
- demo-specific platformer APIs.

## Hard Constraints

- readonly only;
- static/fixed length only;
- scalar fields only;
- no runtime JSON;
- no object identity;
- no mutation;
- no host authority;
- no game-specific API;
- generated artifacts, if added later, are derived and cannot become the
  semantic source of truth.

## Acceptance Criteria

v0.37 can close when:

- readonly tablegroup terminology and model are documented;
- allowed field/storage types and deferred types are explicit;
- syntax alternatives and access operation are documented;
- equal-length and bounds validation obligations are defined;
- report/evidence/package-diff/replay visibility is defined;
- lowering-to-static-tables model is implemented without a new ABI contract;
- reviewPolicy and LSP diagnostic expectations are documented;
- AIRON pressure is routed as generic tablegroup pressure only;
- API gates document the v0.37 forbidden surfaces;
- AIR ABI and Host ABI remain unchanged.

## Links

- [Feature Status v0.37](FEATURE_STATUS_v0.37.md)
- [Readonly Tablegroups RFC](rfcs/v0.37-readonly-tablegroups.md)
- [API Gates v0.37](API_GATES_v0_37.md)
- [Architecture Gates](ARCHITECTURE_GATES.md)
- [Version and ABI Policy](VERSION_AND_ABI_POLICY.md)
