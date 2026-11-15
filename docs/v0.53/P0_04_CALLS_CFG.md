# typed-v0.53 P0-04 — typed local calls, structured control flow, call graph, void (implementation note)

Card `AIR-0053-P0-04-0001`. Admitted spec: the P0-04 slice RFC text R2 (`AIR_V053_P0_04_SLICE_RFC_R2_2026_10_24/`, SHA256SUMS
`98d6ce53…`), owner admission record `b85c5592…`, owner ledger `256d4b73…` (OD-P4-1 (b)). This note says where each rule lives in the
code. It adds no rule: where it differs from the slice text, the slice text wins.

## 1. Scope

Everything below applies to typed-v0.53 ASTs only, keyed on the profile tag. legacy-v0.50 and typed-v0.51 parse, verify, format and
lowering results, codes and artifact bytes are unchanged, and so are the legacy CFG codes `air.control.br_syntax_invalid` and
`air.control.br_if_syntax_invalid` (card `forbidden_mutation`).

## 2. AST shapes (slice text P4-R17)

| Construct | Node |
| --- | --- |
| `%r: T = call @f(a, …)` | `local` whose `value` is `{kind: "call", op: "call", callee, args}` |
| `call @f(a, …)` | `{kind: "call", loc, value: {kind: "call", op: "call", callee, args}}` |
| `%r: T = if %c { … } else { … }` | `{kind: "if", loc, destination, destinationType, condition, blocks: [then, else]}`; a block is `{statements}` ending in `{kind: "yield", loc, value}` |
| a block-bodied `match` arm | the arm `{pattern, loc, block}`; the `match` statement lists its arm blocks in `blocks` |
| bare `return` | `{kind: "return", loc, value: ""}` |

A call carries `op: "call"` and a block statement lists its blocks in `blocks`, so the R-WB-15c measure of `src/analysis_capacity.js`
(outside the card's `allowed_mutation`) counts every call site, the statement form included, and every block level, unchanged. One level
of the R3-N1 shape is 11 counted AST nodes; `nest(4894)` is 53,845 (P4-R1).

## 3. Where each rule lives

| Rule (slice text) | Code |
| --- | --- |
| §4.3 P4-R9, P4-R10, P4-R15; §4.4 P4-R12; §4.5 P4-R13: block frames, placement rules, `yield_missing`, bare `return`, unstructured forms, all at parse time | `src/parser.js` `parseV053TypedAir` (one loop, explicit frame stack; no depth test, AMD-1/AMD-4) |
| §4.1 call shapes, arguments, result binding, codes (P4-R3, P4-R4, P4-R5) | `src/verifier.js` `verifyV053Call` |
| §4.3 blocks, scopes (P4-R11), the `bool` condition; §4.4 `void` | `src/verifier.js` `verifyV053Statement`, `verifyV053Block`, `verifyV053Return` |
| §4.2 P4-R7, P4-R8: the call-graph SCC (iterative Tarjan over every call edge, false branches included) and the summaries at every verifying entrypoint | `src/verifier.js` `verifyV053WorkBound` → `src/workbound.js` `analyzeVerifiedTypedModule` (P0-02 `analyzeModel`) |
| §4.6 composition: `c1` (P4-R14, P4-R16), `c2`, `c3`, the binding check (P4-R5), branch, block, `yield`, block arms; positions (P4-R2) | `src/workbound.js` `typedCallNode`, `typedStatementNode`, `typedSequence` |
| §4.1 call lowering (call-site checks, 17), value `if`, block arms, `void` | `src/lower_wasm.js` `emitV053Statement`, `emitV053Block`, `emitV053Call`, `emitV053ResultCheck` |
| P4-R9 canonical layout | `src/format.js` `formatV053TypedAir` |

CT-1 is unchanged: `src/workbound_cost_table_v1.json` is the c284dab4 / 50df5546 blob `118511fe…` (raw sha256 `1afbe97f…`,
`cost_table_digest` `sha256:1ae0cddb…`).

## 4. Readings made by the implementation (none changes an expected value)

1. The formatter keeps OPEN-3 (a)'s typed-v0.51 rule, functions in name order. The R2 fixtures whose order is pinned otherwise
   (V53-CALL-P03/ANA-04, V53-ANA-05, V53-CALL-N06, V53-CALL-P05, V53-CFG-P05, and the unindented `nest(k)`) are judged by idempotence
   in V53-FMT-01, as SCALAR judged V53-SCL-P29; every other P0-04 source equals its canonical output.
2. P4-R6: callee-entry validation stays on the internal call path; a refined argument is checked at the call site first (17), so the
   callee's entry check cannot fail there.
3. A call result is never statically known (SCALAR R-16 lists literals, references to statically known locals and checked
   operations), so a narrowing binding is checked at run time.
4. `return call @f(…)` is not a call shape (R-CALL-1): it keeps the existing `air.numeric.operation_invalid`.
5. An operation as a `yield` operand and the statement forms of P4-R10 are rejected by the parser when it reads the line.
6. Blocks recurse in the verifier, the WorkBound model, the formatter and the lowering only after the capacity check, so their depth is
   at most `maxSyntaxNestingDepth` (SCALAR AMD-3); parsing, the intake count, the measures, the SCC and the tree evaluation use explicit
   stacks.

## 5. Code registry additions at P0-04 (R-DIAG-2)

Codes that typed-v0.53 paths emit from P0-04 on, in addition to `docs/v0.53/SCALAR.md` §6 and `docs/v0.53/P0_03_REFINEMENTS.md` §5.

| Code | Status | Where |
| --- | --- | --- |
| `air.call.unknown_function` | new (R3.1 §15) | §4.1 |
| `air.call.result_unbound` | new (R3.1 §15) | §4.1 (R-CALL-2) |
| `air.call.argument_count_mismatch` | new (P4-R3) | §4.1 |
| `air.control.unstructured_unsupported` | new (R3.1 §15) | §4.5 (R-CFG-3) |
| `air.control.yield_missing` | new (R3.1 §15) | §4.3 (P4-R15) |
| `air.call.recursion_rejected` | reused | §4.2 (R-CALL-3) |
| `air.workbound.overflow` | reused | §4.2 (P4-R8) |

## 6. Carried, not closed

V53-CFG-P02 → P0-10 (typed extern); V53-WB-H01 stays DEFERRED → P0-10 (part (c) runs here); V53-REF-N12 → P0-08. The callback-edge
part of R-CALL-3 has no P0-04 vector (loops arrive with P0-05). Review items F-9, F-10, F-11 (R1) and N-1, N-2 (R2 delta) are carried,
as are the earlier slices' items listed in the admission record.
