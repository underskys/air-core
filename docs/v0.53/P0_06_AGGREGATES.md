# typed-v0.53 P0-06 — read-only tables, internal structs and arrays, lane-weighted charging (implementation note)

Card `AIR-0053-P0-06-0001`. Admitted spec: the P0-06 slice RFC text R2 (`AIR_V053_P0_06_SLICE_RFC_R2_2026_10_27/`, SHA256SUMS
`8090cf23…`), owner admission record `1f1d47a9…` with its BINDING_ADDITION (P0-06-CHECK-O1 part 2), owner ledger `28fa6b53…`
(OD-P6-1 (a), OD-P6-2 (b), OD-P6-3 (a), OD-P6-4 (a), OD-P6-5 (a), OD-P6-6 (a)) and its erratum 1 `a5d7697c…`. This note says where each
rule lives in the code and records the lowering choice P6-R19 asks for. It adds no rule: where it differs from the slice text, the slice
text wins.

## 1. Scope

Everything below applies to typed-v0.53 ASTs only, keyed on the profile tag. legacy-v0.50 and typed-v0.51 parse, verify, format and
lowering results, codes and artifact bytes are unchanged, legacy tables, tablegroups, structs and arrays included (card
`forbidden_mutation`). There is no AIR ABI or Host ABI change and no host import. Flags: `EXPORTED_MEMORY=false`.

CT-1 is the revision `P0-06-AGG-1` (slice text §5.2; OD-P6-1 (a)): `src/workbound_cost_table_v1.json` is byte for byte the R2 file
`tool_outputs/ct1_proposed_P0-06-AGG-1.json` (5,370 bytes, raw `770315ad…`, git blob `c3a2022b…`, `cost_table_digest`
`sha256:d8b341ea…`), and the loader admits the weight field `steps_per_lane`. Two rows are added after `statement.constructor`:

| Row | Weights | Value for `L` lanes |
| --- | --- | --- |
| `aggregate.transfer` | `steps 0`, `steps_per_lane 1` | `L` |
| `aggregate.access` | `steps 1` | `1` |

The row texts stay as recorded (any text change is a new digest). The normative statements beside them are the slice text's:

- P6-R15: a constructor atom used as an operand of `struct.new`, `struct.set`, `array.new` or `array.set` is one `statement.constructor`
  row; a literal or local operand adds nothing.
- P6-R17: each transfer of P6-R13 is charged exactly one `aggregate.transfer` row, with one exception. For a fold with `n ≥ 1`, the final
  callback-to-result transfer is charged twice: once by the callback's `return` (`1 + L`), and once by `L_T` in `t3` for binding the fold
  result. "Once per transfer" is therefore not literal for folds with `n ≥ 1`: this is a deliberate, sound over-count of exactly `L_T`
  steps per fold execution (V53-AGG-WB03). For `n = 0`, the `t3` charge is the one transfer of the seed into the result (V53-AGG-WB04).

The 14 CT-1 identity pin sites of the earlier slices' tests take the new identity exactly as `SCOPE_AMENDMENT_PIN_EDITS.diff` states
(12 value-only swaps, 2 splits of P0-03-CHECK-CT1); no other earlier test file changes.

## 2. AST shapes

| Construct | Node |
| --- | --- |
| `table <name>: <T>[<N>] = [v0, …]` | an entry of the module's `tables` list: `{elementType, length, loc, name, values}`; `values` is one array of literal strings, normalized as a local's literal is (`-0` is `0` for an integer, `1` is `1.0` for a float), so a table adds a fixed number of intake nodes whatever its length (P6-R24) |
| `struct <Name> { f1: T1, … }` | an entry of the module's `structs` list: `{fields: [{name, type}, …], loc, type_id}`; field types canonical (a struct or enum name qualified) |
| `array<T,N>` | a canonical type text, everywhere a type appears |
| `%x: T = <op> …` for `struct.new`, `struct.get.<f>`, `struct.set.<f>`, `array.new`, `array.get`, `array.set`, `table.get` | a `local` whose `value` is `{kind: "aggregate_operation", op, args, field?}`; `args` keeps the operands as written, an index literal normalized as an i32 operand is (`-0` is `0`), and operands typed by a field or element normalized once every struct is known |

The `tables` and `structs` lists exist only once one is declared, so a module without them keeps its AST, measures and intake count.

## 3. Where each rule lives

| Rule | Code |
| --- | --- |
| P6-R1, P6-R2 items 1-4 (shape, element type, length, literal count) at the table's line | `src/parser.js` (`v053TableDeclaration`) |
| P6-R2 items 5, 6 (each literal as `%v: T = <literal>`, then a duplicate name), in source order | `src/verifier.js` (`verifyV053Tables`) |
| P6-R4 `table.set` (bound or not, any operands) → `air.table.readonly` at its line | `src/parser.js` (`v053RejectTableSet`) |
| P6-R6 struct line, fields, refined field type (OD-P6-3 (a)), one type namespace with enums | `src/parser.js` (`v053StructDeclaration`; the duplicate check at the struct line and at an enum's close) |
| P6-R6 named types known, recursion at the first struct of a cycle in source order, P6-R11 lane cap (OD-P6-6 (a)) | `src/verifier.js` (`verifyV053Structs`, `v053CyclicStructs`; `measureType` in `src/parser.js`) |
| P6-R7 `array<T,N>`; P6-R10 an aggregate payload of `option` or `result` | `src/parser.js` (`parseV053TypedType`, `canonicalizeV053ArrayType`); `src/verifier.js` (`resolveV053Type`) |
| P6-R4, P6-R8, P6-R9 operations, operand kinds and types, the result entering `D`, the static index domain (SCALAR R-16) | `src/verifier.js` (`verifyV053AggregateOperation`) |
| P6-R10 an aggregate at an export, after the signature's types are valid, at the `export func` line | `src/verifier.js` (`verifyV053TypedModule`) |
| P6-R12..P6-R17 charging | `src/workbound.js` (`transfer`, `typedAggregateNode`, `typedCallNode`, `typedFoldNode`, the assignment, `yield`, atom-arm and `return` cases of `typedStatementNode`) |
| P6-R18 `decls` counts structs and tables | `src/analysis_capacity.js` (`measureTypedModule` only; OD-P6-4 (a)) |
| P6-R5, P6-R19 lowering (below) | `src/lower_wasm.js` (`v053MemoryPlan`, `emitV053AggregateOperation`, `emitV053IndexCheck`) |
| P6-R21 canonical output | `src/format.js` (structs by type id, tables by name, after the enums; the operation forms) |

## 4. Lowering (P6-R5, P6-R19) and the largest buildable aggregate per position

- **Memory.** A module with a table or an aggregate value gets one internal memory, never exported and never imported
  (`EXPORTED_MEMORY=false`; no host import); a module with neither declares none, so its WAT is the base's. Each invocation instantiates
  afresh (R-STATE-1), so nothing persists.
- **Tables.** Each table's values are one data segment at an 8-aligned base, each value at its element width (i32, f32, bool: 4 bytes;
  i64, f64: 8). Integers are exact; a float literal is rounded once, to nearest with ties to even, `-0.0` keeping its sign (P6-R3).
- **Aggregates live in memory, by lanes.** A struct is its fields' lanes in field order, `array<T,N>` is N elements of T's size, each lane
  at its width. Every aggregate value a function holds — an aggregate parameter, the aggregate result, an aggregate local or `if`/`match`
  destination — owns a fixed slot of the function's static frame. Static frames are sound because the call graph has no cycle (R-WB-2f.1),
  so no function is active twice. Assignment, `yield`, an atom arm, `return`, call arguments, the fold accumulator, `struct.set` and
  `array.set` copy whole values with `memory.copy` (P6-R9); an aggregate crosses a call by a copy into the callee's parameter slot and out
  of its result slot. No aggregate occupies a WebAssembly parameter, result or local.
- **O(1) access.** `table.get` and a dynamic `array.get`/`array.set` lower to a fixed sequence: the domain check (`0 ≤ i`, then `i < N`,
  signed), each failing path calling the helper that sets 33 (table) or 35 (array) followed by `unreachable`; the address `base + i·w`; one
  load (or, for `array.set`, one store) of the element width. For `array.set` the whole-value copy of the operand into the result comes
  first, outside the per-access sequence. No compare chain, `br_table` or loop. A one-lane element is loaded directly; an element of
  several lanes (`option`, `result`) or an aggregate element goes through an address temporary. P0-06-CHECK-O1 checks the four parts and
  the binding addition's whitelist on V53-AGG-P02 (`N` = 16, 65536) and V53-AGG-P05 (`array<i32,4>`, `array<i32,4096>`).
- **An index literal** is read as a signed i32 value at every step: `-0` is 0 (P6-R4).

Largest lane count that builds in each position under this lowering (P6-R19; QA records it):

| Position | Largest lane count that builds | Why |
| --- | --- | --- |
| local (or `if`/`match` destination) | 65,536 (the lane cap) | a memory slot, not WebAssembly locals |
| parameter | 65,536 | the callee's memory slot; no WebAssembly parameter |
| result | 65,536 | the callee's memory slot; no WebAssembly result |
| field | 65,536 | part of the enclosing value's memory |

P0-06-CHECK-BUILD-SIZES builds and runs a module with a 65,536-lane value in all four positions. Beyond that, the only limits are the
module's: a VERIFIED module whose static frames and table data need more than 65,536 memory pages, or more than 100,000 data segments, is
BUILD_REFUSED with `air.build.engine_limit` (two count limits added to the engine-limit plan, same source as the others), never a
STATIC_REJECT, and nothing is truncated (P0-06-CHECK-BUILD-REFUSED: 8,193 values of 512 KiB). `maxWatBytes` and `maxWasmBytes` bound the
WAT and the binary as before.

## 5. Code registry additions at P0-06 (R-DIAG-2)

Codes that typed-v0.53 paths emit from P0-06 on, in addition to `docs/v0.53/SCALAR.md` §6, `docs/v0.53/P0_03_REFINEMENTS.md` §5,
`docs/v0.53/P0_04_CALLS_CFG.md` §5 and `docs/v0.53/P0_05_LOOPS.md` §5.

| Code | Status | Where |
| --- | --- | --- |
| `air.table.readonly` | new (R3.1 §15 PROPOSED; slice text P6-R4) | §3 (P6-R4) |
| `air.abi.export_type_unsupported` | new (R3.1 §15 PROPOSED; slice text P6-R10) | §3 (P6-R10) |
| `air.table.index_out_of_range` | static rejection (P6-R4) and runtime identity of value 33 (registry entry existed) | §3, §4 |
| `air.array.index_out_of_range` | static rejection (P6-R8) and runtime identity of value 35 (registry entry existed) | §3, §4 |

Reused with their base meaning: `air.v051.typed_syntax_invalid`, `air.v051.type_reference_invalid`, `air.v051.typed_atom_invalid`,
`air.v051.typed_atom_type_mismatch`, `air.numeric.i64_constant_out_of_range`, `air.numeric.operation_invalid`,
`air.decision.enum_duplicate_type`, `air.decision.enum_unknown`, `air.decision.payload_type_unsupported`, `air.build.engine_limit`.
`src/errors.js` holds no code list (an `AirError` takes its code from its message), so the new codes need no entry there; their repair
hints are in `src/diagnostics.js`.

## 6. Carried, not closed

V53-AGG-P03 and V53-AGG-N04 belong to P0-07 (OD-P6-2 (b)); at P0-06 a `const` line keeps failing as `air.v051.typed_syntax_invalid`
(P0-06-CHECK-CONST). V53-REF-N12's composite stays DEFERRED → P0-08 (values 33 and 35 become reachable here). The R2 delta review's P3-1,
P3-2 (read with the binding addition) and P3-3 are carried, as are the earlier slices' items listed in the admission record.
