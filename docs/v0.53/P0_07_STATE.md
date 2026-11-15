# typed-v0.53 P0-07 — exact module constants, invocation-scoped state cells (implementation note)

Card `AIR-0053-P0-07-0001`. Admitted spec: the P0-07 slice RFC text R2 (`AIR_V053_P0_07_SLICE_RFC_R2_2026_10_27/`, SHA256SUMS
`a7ac98e4…`, `P0_07_SLICE_RFC.md` `5f478f5d…`), owner admission record `e5b0f2e7…` with its BINDING_ADDITIONS BA-1 and BA-2, owner
ledger `6f26106c…` (OD-P7-1 (a′), OD-P7-2 (a), OD-P7-3 (a)) and OD-P7-4 (a) `1040ce53…`. This note says where each rule lives in the
code and records the choices the slice text leaves to the implementer: the state lowering (P7-R11), the host-path table and the
artifact contract (P7-R9), the typed-v0.53 hint of each state code (P7-R8) and the CT-1 note for P0-08 (§5 of the slice text). It adds
no rule: where it differs from the slice text, the slice text wins.

## 1. Scope

Everything below applies to typed-v0.53 ASTs only, keyed on the profile tag. legacy-v0.50 and typed-v0.51 parse, verify, format and
lowering results, codes and artifact bytes are unchanged: legacy `const`, `state`, `global` and `pool` keep their behaviour
(`test/fixed_state.test.js`, `test/pools.test.js`), and `test/v052_verified_runtime.test.js` passes unchanged. There is no AIR ABI or
Host ABI change and no host import. `src/typed_interface.js`, `src/v052_verified_build.js` and `src/sdk.js` are not changed.

Flags: `PERSISTENT_STATE=false` (a property of AIR's verified invocation paths, §4.2), `CACHE_HOLDS_STATE=false`,
`EXPORTED_MEMORY=false`.

CT-1 is unchanged (OD-P7-1 (a′)): `src/workbound_cost_table_v1.json` is the P0-06 file byte for byte (revision `P0-06-AGG-1`, 5,370
bytes, raw `770315ad…`, git blob `c3a2022b…`, `cost_table_digest` `sha256:d8b341ea…`, 22 rows). The coverage table of slice text §5 is
the reviewed amendment that maps the new constructs onto existing rows:

| Construct | CT-1 row |
| --- | --- |
| `const` line, `state` line | none |
| constant reference | none (an atom); in a refined destination, `refinement.check` |
| `state.get` (static index), `state.set` (static index) | `aggregate.access` |
| refined `D` on `state.get` | `aggregate.access` + `refinement.check` |

**Which row charges state until P0-08.** `aggregate.access` (1 step), read through its leading clause "element or field access with a
static index". Its text still lists only the P0-06 operations. P0-08's forced CT-1 revision must reword it to name `state.get` and
`state.set` too, with no weight change (slice text §5, binding on P0-08).

## 2. AST shapes

| Construct | Node |
| --- | --- |
| `const NAME: T = <literal>` | an entry of the module's `constants` list: `{loc, name, type, value}`; `value` is the literal normalized as a local's literal is (`-0` is `0` for an integer, `1` is `1.0` for a float) |
| `state <name>: T[N] = fill <literal>` | an entry of the module's `states` list: `{elementType, fill, init, length, loc, name}`; `fill` is the normalized literal, or `null` when the rest is not `fill` and one literal token (the verifier then refuses it, P7-R6 item 5); one entry whatever `N`, so a state adds a fixed number of intake nodes (P7-R18) |
| `%v: T = state.get s, i` | a `local` whose `value` is `{kind: "aggregate_operation", op: "state.get", args}`; the index normalized as an i32 operand is (`-0` is `0`) |
| `state.set s, i, v` | a statement `{kind: "state_set", loc, value: {kind: "aggregate_operation", op: "state.set", args}}`; the value operand normalized against the cell type once every state is known |

The `constants` and `states` lists exist only once one is declared, so a module without them keeps its AST, measures and intake count.
A constant reference stays its name in the AST; verification attaches nothing to the AST (the verifier keeps the module's constants in a
`WeakMap` keyed by its own declaration map).

## 3. Where each rule lives

| Rule | Code |
| --- | --- |
| P7-R21 / BA-2: the `module` header before any module item, a `const` or `state` line included | `src/parser.js` (`parseV053TypedAir`: the header check precedes the `const` and `state` branches) |
| P7-R1, P7-R2 items 1-3 (shape and name, type, literal token) at the constant's line | `src/parser.js` (`v053ConstDeclaration`); a `const` line in a body keeps the statement catch-all |
| P7-R2 items 4, 5 (the literal by the base rule, then a duplicate name), in source order with tables and states | `src/verifier.js` (`verifyV053ModuleItems`) |
| P7-R3 a constant is a typed atom of its own type (also as a constructor payload), statically known (R-16) | `src/verifier.js` (`verifyV053TypedAtom`, `v053StaticInteger`, `v053ConstantOf`) |
| P7-R3 (R-9) literal-text positions refuse constants: table literals, `fill`, constant initializers, fold counts and `work` bounds | `src/verifier.js` (`verifyV053ModuleItems` checks those literals with the base atom rule, which knows no constant); `src/workbound.js` (fold counts stay literal text) |
| P7-R5, P7-R6 items 1-4 (shape, cell type, dynamic length, length) at the state's line | `src/parser.js` (`v053StateDeclaration`) |
| P7-R6 items 5, 6 (`fill` literal, the name already a state or a table; a table after a state keeps the table's code) | `src/verifier.js` (`verifyV053ModuleItems`) |
| P7-R7 `state.get` as a value, `state.set` as the one unbound statement; shape errors `air.state.op_invalid`, type errors `typed_atom_type_mismatch` | `src/parser.js` (`v053StateValue`, the `state.set` statement); `src/verifier.js` (`verifyV053AggregateOperation`, `verifyV053Statement`) |
| P7-R8 static indexes only (`index_out_of_bounds`, `dynamic_bounds_required`) | `src/verifier.js` (`verifyV053AggregateOperation`, through `v053StaticInteger`) |
| P7-R10 a state name in an exported signature (`export_type_unsupported` at the `export func` line), another type position, a value position | `src/parser.js` (the signature types of `parseV053TypedAir`, with a pre-scan of state names); `src/verifier.js` (`verifyV053TypedModule`) |
| P7-R13 charging | `src/workbound.js` (`typedAggregateNode` for `state.get`, `typedStatementNode` for `state_set`) |
| P7-R14 / BA-1 `generate state-handles` refuses a typed-v0.53 request | `bin/airc.js` (before any profile parsing, candidate gate or package read) |
| P7-R11 lowering (below) | `src/lower_wasm.js` (`v053MemoryPlan`, `v053StateBytes`, `v053StateAddress`, `emitV053StateSet`, `emitV053AggregateOperation`; constants in `emitV051TypedExpression` and `v053IndexOperand`, typed-v0.53 lowering states only) |
| P7-R16 canonical output | `src/format.js` (constants by name after the structs, states by name after the tables; `state.set` lines) |
| P7-R17 `decls` counts constants and states | `src/analysis_capacity.js` (`measureTypedModule` only; OD-P7-2 (a)) |

## 4. Lowering (P7-R11) and the host paths (P7-R9)

### 4.1 State cells live in the internal memory

- **Choice.** Internal memory, not globals. A module with a state gets the P0-06 internal memory (never exported, never imported). Each
  state is `N` cells of its element width (i32, f32, bool: 4 bytes; i64, f64: 8) at an 8-aligned base, after the tables' data.
- **Initialization.** One active data segment per state, in the order the states are declared and after the tables' segments, holds the
  `fill` value in every cell, encoded as a table value is (P6-R3: exact integers, a float rounded once, `-0.0` keeping its sign, bool 0 or
  1). The cells receive their values at instantiation and nowhere else: there is no start function, and no function body writes a cell
  except through its own `state.set` statements (P0-07-CHECK-STATE part 5).
- **Access.** An index is statically known and inside `0 ≤ i < N` (P7-R8), so an access has no domain check and no failure value. A
  literal or constant index lowers to one address constant `base + i·w`; a statically known local index to `i·w + base` from the local.
  Then exactly one load (`state.get`, followed by the store into the destination local, and the narrowing check first for a refined
  `D`) or one store (`state.set`, after its value). The sequence does not depend on `i` or `N` (P0-07-CHECK-STATE parts 2-4).
- **Constants** lower to their literal at each use; they emit nothing of their own.

Largest total of state cells that builds under the default verified-build limits (`maxWatBytes` and `maxWasmBytes` 4 MiB): the data
segments dominate the WAT (three WAT bytes per data byte), so the bound is about 1.3 MiB of cell bytes, measured as

| Cell type | Largest total that builds | First refusal |
| --- | --- | --- |
| i32, f32, bool (4 bytes) | 327,680 cells (5 states of 65,536) | the sixth: `air.v052.work_limit_wat_bytes` (BUILD_REFUSED) |
| i64, f64 (8 bytes) | 131,072 cells (2 states of 65,536) | the third: `air.v052.work_limit_wat_bytes` (BUILD_REFUSED) |

A larger module is refused at build time by the configured work limit, never by a static verdict. With larger configured limits, the
engine limits apply: more than 65,536 memory pages or 100,000 data segments is BUILD_REFUSED with `air.build.engine_limit` (P0-06). One
state of the largest length, 65,536 cells, builds and runs (V53-STATE-P02 (iii)).

### 4.2 Invocation scope is one instance per invocation

Cells live inside the Wasm instance and are set to their `fill` values when the instance is created. Invocation scope is therefore a
property of one instance per invocation, the property R-STATE-1 and the card name and the failure-reason global already relies on. Per
host path:

| Host path | Instances | State seen by the host |
| --- | --- | --- |
| `createVerifiedTypedRuntime().invoke` | a fresh instance per `invoke` | invocation-scoped (V53-SEP-CACHE-01) |
| `invokeVerifiedTypedExport` (direct) | a fresh instance per call | invocation-scoped (V53-STATE-P01) |
| `instantiateAirModule` (SDK; package API) | one instance, created once and returned to the host | cells persist across calls on that instance: 1, 2 on one instance, 1, 1 on two (V53-STATE-P01 (ii), characterization) |
| `inspectVerifiedTypedBuild().wasmBytes`, the CLI `build` output | whatever the host instantiates | as the row above |

**Artifact contract.** A typed-v0.53 artifact is invoked on a fresh instance per invocation. `PERSISTENT_STATE=false` is a property of
AIR's verified invocation paths, not of the artifact by itself: a host that reuses one instance sees its cells persist, as it would see
the failure-reason global persist. The typed runtime cache holds compiled modules only (P7-R12; `CACHE_HOLDS_STATE=false`).

## 5. Code registry additions at P0-07 (R-DIAG-2)

Codes that typed-v0.53 paths emit from P0-07 on, in addition to `docs/v0.53/SCALAR.md` §6 and the §5 tables of the P0-03 to P0-06
notes. The `air.state.*` codes are EXISTING legacy codes reused with their meaning (OPEN-2 (a)); the v0.15 registry is not edited, and
its stale hint for `cell_type_invalid` (i32 cells only) does not apply to typed-v0.53. The typed-v0.53 hint of each:

| Code | Status | Typed-v0.53 hint |
| --- | --- | --- |
| `air.const.initializer_invalid` | new (R3.1 §15 PROPOSED; P7-R2 item 3) | A constant takes exactly one literal of its type: `const NAME: T = <literal>`; an operation, a local, another constant, a carrier or a constructor is not a literal. |
| `air.state.segment_invalid` | EXISTING (P7-R6 items 1, 6) | Write one state per line as `state <name>: T[N] = fill <literal>`, and give it a name no other state or table has. |
| `air.state.cell_type_invalid` | EXISTING (P7-R6 item 2) | A cell is `i32`, `i64`, `f32`, `f64` or `bool`; compact, refined and aggregate cell types are not admitted. |
| `air.state.dynamic_length` | EXISTING (P7-R6 item 3) | Give the length as a decimal literal. |
| `air.state.length_invalid` | EXISTING (P7-R6 item 4) | Give a length from 1 through 65,536, without a leading zero. |
| `air.state.init_invalid` | EXISTING (P7-R6 item 5) | Initialize with `fill` and one literal of the cell type; a constant, a carrier, a list or a trailing word is not accepted, and there is no persistence syntax. |
| `air.state.op_invalid` | EXISTING (P7-R7) | Read with `%v: T = state.get s, i` and write with the unbound statement `state.set s, i, v`; no other `state.*` operation exists. |
| `air.state.index_out_of_bounds` | EXISTING (P7-R8) | Keep a static state index inside `0 ≤ i < N`. |
| `air.state.dynamic_bounds_required` | EXISTING (P7-R8) | A state index must be statically known: a literal, a constant, or a local bound to a literal; typed-v0.53 has no dynamic state index. |

Reused with their base meaning: `air.v051.typed_syntax_invalid`, `air.v051.typed_atom_invalid`, `air.v051.typed_atom_type_mismatch`,
`air.v051.type_reference_invalid`, `air.abi.export_type_unsupported`, `air.table.index_out_of_range`,
`air.refinement.assignment_out_of_range`, `air.numeric.checked_failure`, `air.workbound.invalid_bound`,
`air.source_profile.command_unsupported`. `src/errors.js` holds no code list (an `AirError` takes its code from its message), so the new
code needs no entry there; its repair hint is in `src/diagnostics.js`.

## 6. Carried, not closed

- P0-08's forced CT-1 revision rewords `aggregate.access` to name `state.get` and `state.set` (§1). V53-MIG-N06 becomes executable here
  and is run by the P0-11 increment. Persistent state and sessions are v0.54 (G54-STATE).
- BA-1 is read as refusing a typed-v0.53 request in either flag form (`--source-profile typed-v0.53`, `--source-profile=typed-v0.53`); the
  command's other arguments, `--source-profile typed-v0.51` included, keep the legacy behaviour (V53-STATE-N02 (v), (vi)).
- The V53-AGG-N15 (xiv) pair control keeps its literal carrier (`%v: i32 = const.i32 5`), which the base formatter prints as `5`, so that
  one control is not canonical bytes; every other P0-07 ACCEPT fixture is (V53-FMT-01@P0-07 records it).
- The R2 delta review's P3-1 to P3-6 and the earlier slices' items listed in the admission record are carried.
