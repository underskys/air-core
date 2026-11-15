# typed-v0.53 P0-05 — bounded loops, the dynamic-count guard, callback edges, `work` assertions (implementation note)

Card `AIR-0053-P0-05-0001`. Admitted spec: the P0-05 slice RFC text R2.2 (`AIR_V053_P0_05_SLICE_RFC_R2_2_2026_10_26/`, SHA256SUMS
`3071676b…`), owner admission record `dd47c898…`, owner ledgers `af34ad22…` (OD-P5-1 (b), OD-P5-2 (a)) and `f5793d34…` (OD-P5-3 (a)).
This note says where each rule lives in the code. It adds no rule: where it differs from the slice text, the slice text wins.

## 1. Scope

Everything below applies to typed-v0.53 ASTs only, keyed on the profile tag. legacy-v0.50 and typed-v0.51 parse, verify, format and
lowering results, codes and artifact bytes are unchanged, and so are the legacy `loop.*` forms, their lowering and `phi` (card
`forbidden_mutation`). CT-1 is unchanged (revision `P0-02-F1-RD3`, raw `1afbe97f…`, `cost_table_digest` `sha256:1ae0cddb…`); there is no
AIR ABI or Host ABI change. Flags: `LOOP_FORMS_ADMITTED=loop.fold-only`, `INDEPENDENT_FUEL=false`.

## 2. AST shapes

| Construct | Node |
| --- | --- |
| `%acc: T = loop.fold @f, <seed>, <count>` | `local` whose `value` is `{kind: "fold", op: "loop.fold", callback, seed, count}`; `count` is `{kind: "literal", value}`, `{kind: "dynamic", local, max}` (`%c max m`) or `{kind: "dynamic", local}` (a bare `%c`) |
| `work { steps <= N, … }` | the module's `work` property, `{loc, limits: [{key, bound}, …]}`, limits in the dimension order `steps`, `calls`, `iterations`; absent when the module has none |

The fold's value has `op: "loop.fold"`, never `op: "call"`, so the R-WB-15c measure never counts it as a call site. It names its callback,
so the statement is a tree under enumerable properties (P5-R1 note).

## 3. Where each rule lives

| Rule | Code |
| --- | --- |
| P5-R1 the fold line; three operands at bracket depth 0; the callback written `@name` (dotted segments allowed); the seed normalized against the callback's first parameter | `src/parser.js` (`v053FoldValue`, the seed pass after the parse) |
| P5-R9 other loop forms: `air.loop.form_unsupported` at parse time, at the first such line | `src/parser.js` (`v053RejectOtherLoopForm`; also an atom `match` arm whose expression begins with another loop form) |
| P5-R10 an unbound canonical fold stays `air.v051.typed_syntax_invalid` | `src/parser.js` (no statement form matches) |
| P5-R11 the `work` line, its keys, bounds, whitespace and syntax errors | `src/parser.js` (`v053WorkDeclaration`) |
| P5-R2, P5-R2a callback shape, one type `T`, the index `i32`, containment only at both boundaries, the dynamic count's local | `src/verifier.js` (`verifyV053Fold`, `v053TypeContained`) |
| P5-R3 count classification; `invalid_bound` / `unknown_bound` | the WorkBound count leaf (`src/workbound.js`, unchanged) through the fold's node |
| P5-R6 callback edges, cycles at the fold line | `src/workbound.js` (the fold's `summary_of` node; edge collection unchanged) |
| P5-R7, P5-R16 the fold's composition node `t0 ⊕ t3` | `src/workbound.js` (`typedFoldNode`) |
| P5-R12, P5-R13 the `work` check after the WorkBound phase, on the entry summaries the phase returned | `src/verifier.js` (`verifyV053WorkAssertion`, called from `verifyV053WorkBound`) |
| P5-R14 `callback_refs` and `decls` (`work`) | `src/analysis_capacity.js` (`measureTypedModule` only; OD-P5-2 (a)) |
| P5-R5, P5-R15 the guard (value 32) and the size-independent loop | `src/lower_wasm.js` (`emitV053Fold`; helper `__air_v053_loop_count_out_of_range` only when a dynamic fold exists) |
| P5-R1, P5-R11 canonical output | `src/format.js` (the `work` line after the module header; the fold line) |

## 4. Readings made by the implementation (none changes an expected value)

- A fold's "value" for P5-R9 is a local's value, a `yield` or `return` operand, or an atom `match` arm's expression; a "statement" is the
  whole line. A canonical `loop.fold ` value in a `return` or `yield` position is not another loop form and keeps the base code.
- The verifier checks, in order: the callback exists; it has one or two parameters; its result equals its first parameter; its second
  parameter is `i32`; the seed is contained in `T`; a dynamic count's local is in scope and in the `i32` family; `T` is contained in the
  destination. Each vector of the slice text has exactly one of these failures.
- The guard is always emitted for a dynamic count (the optional elision of P5-R5 is not used). A literal count lowers to an `i32.const`;
  the loop counter is an `i32` local.
- The `work` check reports the first violation in export source order and key dimension order, with `error.workAssertion =
  {export, key, bound, value}`.
- (P05-QA-F-1) A count or maximum text written with a sign (`-0`, `+0`, `-00`, `-1`) is `air.workbound.invalid_bound` at the fold line:
  P5-R3 with P5-R11's decimal form ("no sign and no leading zero"). `typedFoldNode` gives such a text an `invalid_bound` leaf in the
  count position, because the P0-02 count leaf reads `-0` as 0; the count leaf itself is unchanged. A verified fold therefore always has a
  canonical unsigned count, which is what the lowering accepts.

## 5. Code registry additions at P0-05 (R-DIAG-2)

Codes that typed-v0.53 paths emit from P0-05 on, in addition to `docs/v0.53/SCALAR.md` §6, `docs/v0.53/P0_03_REFINEMENTS.md` §5 and
`docs/v0.53/P0_04_CALLS_CFG.md` §5.

| Code | Status | Where |
| --- | --- | --- |
| `air.loop.form_unsupported` | new (R3.1 §15 PROPOSED) | §3 (P5-R9) |
| `air.workbound.assertion_exceeded` | new (slice text P5-R12, PROPOSED) | §3 (P5-R12) |
| `air.loop.count_out_of_range` | runtime identity of value 32 (registry entry existed) | §3 (P5-R5) |
| `air.workbound.invalid_bound` | reused (§6.6) | §3 (P5-R3) |
| `air.workbound.unknown_bound` | reused (§6.6) | §3 (P5-R3) |

## 6. Carried, not closed

V53-LOOP-P05 and V53-WB-H01 → P0-10 (typed extern; no mock). V53-LOOP-N10 is owned by P0-10. V53-MIG-P03 and V53-MIG-N02 become
executable here and are run by the P0-11 increment after P0-05's QA PASS. V53-REF-N12 runs part 32 here; the composite stays DEFERRED →
P0-08. The R2.2 delta review's optional P3-1 wording is carried, as are the earlier slices' items listed in the admission record.
