# typed-v0.53 P0-02 — WorkBound composition foundation (implementation note)

```text
TASK=AIR-0053-P0-WORKBOUND-COMPOSITION-FOUNDATION-0001 (kit card P0-02, R3.1 successor kit)
CONTRACT=RFC typed-v0.53 R3.1 §6.2-§6.12, §3.4 (package a549f3b4…), accepted at H53-P0-RFC (a932bcc8…)
BASE=H52 development baseline: airlang 94001cd1c822, air-core 9c2b1788a42f
STATUS=CANDIDATE, internal only; QA level FULL_INDEPENDENT; the implementer does not QA this slice
CORRECTION=F1 expression accounting and owner-authorized RD-3=2; awaiting fresh independent QA
```

## 1. What this slice adds

| File | Role |
| --- | --- |
| `src/workbound.js` | The single exact-integer WorkBound algebra (HD-2): BigInt values, strict partial `ok`/`fail`, ⊕ ⊗ `max` over the canonical composition tree, per-key effects, the zero rule, failure precedence, call-graph SCC, one memoised summary per function, entry summaries, `WorkBoundKeyV1`, the summary record and its domain-separated digest, the CT-1 loader. Internal module: not exported from `src/index.js`. |
| `src/workbound_cost_table_v1.json` | CT-1 (`air.workbound.cost/1`, schema `air.workbound.costTable/1`, revision `P0-02`) as a machine-readable file: exact construct names and exact decimal weights. It is the only source of weights. |
| `src/v052_verified_build.js` | After typed verification, the builder computes the summaries (phase S) and binds them in the private `BUILDS` state in place of the discarded, never-read work tuple. Runtime handles carry the same private binding. No record, schema, cache-key or admission change. |
| `src/diagnostics.js` | Repair hints and message parsing for the `air.workbound.*` codes. |
| `test/v053_workbound_foundation.test.js` | The P0-02 vector set and the deferred ledger. The two H10 sources are regenerated in the test from their frozen generator texts and pinned by their frozen sha256 (`12398f60…`, `55f00eae…`), so no fixture file is needed and the public review-bundle allowlist is unchanged. |

Nothing else changes: no parser, verifier, lowering, formatter, source-profile, typed-interface or CLI byte; no AIR ABI, Host ABI,
Host Contract or public schema; no new syntax. typed-v0.51 and legacy dispositions are unchanged. `air.v052.verifiedTypedBuild/2`
and `air.v052.verifiedRuntimeCacheKey/1` are unchanged.

## 2. The algebra (RFC §6.2-§6.5, §6.8 R-WB-14/15b)

- Values (R-WB-1, R-WB-4): `S = (steps, calls, iterations, effects)`, every dimension a BigInt in `0 … WB_MAX`, `WB_MAX =
  9223372036854775807`. Encoded as decimal strings; zero effect keys are omitted. JS numbers are rejected as WorkBound values.
- Strict partial algebra (R-WB-2): a node first applies strictness (any failing child fails the node with the first failing child, in
  child order), then its checked operation; a dimension above `WB_MAX` is `fail(overflow)` at that node. The failure set is exactly
  `overflow`, `unknown_bound`, `invalid_bound`, `missing_summary`, `recursion`.
- Canonical tree (R-WB-2, R-WB-2a): one node per CT-1 row instance; a statement sequence is a left-nested chain of binary ⊕ nodes;
  call sub-nodes `c1`/`c2`/`c3`, loop sub-nodes `t1`/`t2`/`t3` and the entry node `E(f) = ingress(f) ⊕ B(f)` as one checked node.
  No regrouping, no skipping under a zero multiplier (R-WB-2b), strict `max` (R-WB-2c), per-key effects (R-WB-2d).
- Failure precedence (R-WB-2f): the call-graph phase runs first (iterative Tarjan over call and loop-callback edges, edges behind
  statically false alternatives included); any cycle rejects the module with `air.call.recursion_rejected` and no summary is
  computed. Otherwise every function is summarised exactly once in reverse topological order (R-WB-14, R-WB-11), and the module
  report lists every root failure ordered by module identity, then line, then column; the first is the primary diagnostic.
  Propagated failures carry a `cause` and are not separate diagnostics.
- R-WB-15b: tree evaluation, ingress evaluation, SCC and summarisation use explicit stacks; no host recursion grows with the input.
- `air.workbound.cost_undefined` (R-WB-26): a construct without a CT-1 row aborts with this code as an `IMPLEMENTATION_DEFECT`. It is
  thrown, never a summary value, never a member of the failure set, never a default cost.

## 3. CT-1 file (RFC §6.4; R-WB-26, R-WB-27, R-WB-27a)

`cost_table_digest = sha256(UTF8("AIR_WORKBOUND_COST_TABLE_V1") || 0x00 || canonical(table))`, with `canonical` the v0.51 canonical
JSON (sorted keys, UTF-8, no whitespace) of the parsed file. The digest and the file sha256 are recorded in the slice evidence and are
part of every `WorkBoundKeyV1`, so a later CT-1 amendment yields a new digest and never compares equal (V53-WB-ID-07).

Rows: `statement.scalar`, `statement.constructor`, `refinement.check`, `match` (`1 + k`), `match.atom_arm` (0), `return`, the
algebra-level primitives without source syntax `call` (`c2`), `extern.call`, `branch`, `loop.iteration` (`t1`), `loop.exit`
(`t3`, `L_T = 0`: no aggregate accumulator is admitted), and entry ingress `ingress.i32|i64|f32|f64` (0), `ingress.bool` (1),
`ingress.refined_i32` (1), `ingress.enum` (`c`), `ingress.option` (`1 + ingress(T)`), `ingress.result`
(`1 + max(ingress(T), ingress(E))`). No row exists for an aggregate, memory, table or state construct: none is admitted.

### 3.1 CT-1 application readings (for QA; not new rules)

These readings apply the R3.1 text to typed-v0.51 shapes that no frozen vector pins. Each is exercised in the test file's readings
block (RD-n), kept apart from the catalogue results. RD-3 is now explicitly settled by the owner's 2026-10-14
[narrow CT-1 clarification](CT1_RD3_CLARIFICATION.md); the historical RFC remains unchanged.

- **RD-1 empty body.** A function with no statements (typed-v0.51 verifies `export func f() -> void { }`) has `B = S{0}`: the empty
  sequence is the ⊕ identity (R-WB-5 with n = 0). It is not a CT-1 row.
- **RD-2 one local statement, one statement row.** A `local` statement is one `statement.scalar` row, or one
  `statement.constructor` row when its value is an `option`/`result` constructor ("construction: at the constructor statement",
  R-WB-26b; V53-AGG-WB01 charges a constructing statement once).
- **RD-3 constructor outside a match arm, owner decision = 2.** A `return` adds its own row. A constructor operand outside a
  match arm adds its constructor row, so `return option.some<i32> %a` and `%o = option.some<i32> %a; return %o` both cost 2.
  Literal, enum-constant and reference operands remain free; constructor atom arms retain their explicit zero-cost exemption.
  `fixtures/v052/verified_build/ops_policy.air:22` therefore adds one summary step (`E(decide)` 6 -> 7), without changing its
  source or Wasm behaviour.
- **F1 direct operation operands.** Existing arithmetic, comparison and conversion operands contribute the scalar row in
  `return` and in a match arm. A direct operation return costs 2 (+ a refinement check if needed); a match-arm operation costs
  1 inside the max over arms. Unknown expression shapes fail with `air.workbound.cost_undefined`, not a free/default cost.
- **RD-4 / RD-5 / RD-6 refinement checks.** One `refinement.check` row is added where a value enters a refined type from another type:
  a literal or an operation result assigned to a refined local, returned from a refined function, or yielded by a match arm into a
  refined destination. A reference to a value of the identical refined type adds no check (typed-v0.51 admits a reference into a
  refined type only when the types are identical). Refined parameters cost 1 at ingress.
- **RD-7 loop counts.** The loop count is a leaf of `t2`; the body `t1` is evaluated before it (innermost first; the callback
  precedes the count in `loop.fold @cb, %seed, n`). A count is `invalid_bound` when it is negative, not an integer literal, or above
  `LOOP_MAX = 4096` (§6.6, R-LOOP-1, OPEN-14 (a) accepted at H53); `{unknown}` is `unknown_bound`.
- **Source positions (carried observation O1).** A synthetic node takes the position of the statement or function that introduces it:
  a ⊕ chain node takes the position of the statement it appends; call, loop, branch and match sub-nodes the position of their
  statement; the entry node the position of the function.
- **Cycle report.** "Every cycle is listed" is read as every cyclic strongly connected component, each reported once with the first
  cycle found from its first function in source order (`cyclePath` `@a -> @b -> @a`, the existing format). Enumerating every
  elementary cycle would not be linear (R-WB-14).
- **Ingress inside the entry node.** `ingress(f)` is the exact sum over the exported parameters and is checked only once, as part of
  the single checked entry node.

## 4. Identity binding (RFC §6.9; R-WB-18..21)

- `WorkBoundKeyV1 = {body_digest, compiler_implementation_digest, cost_table, cost_table_digest, dependencies, profile}`. P0-02 fills
  it only from existing identities (R-WB-20): `profile` = the build's `sourceProfile` (`typed-v0.51`), `body_digest` = its raw
  `sourceDigest`, `compiler_implementation_digest` = its `compiler.implementationDigest` (`air.v052.toolchainManifest/1`, every
  regular file under `src/`, the CT-1 file included, plus WABT), `cost_table` = `air.workbound.cost/1`, `cost_table_digest` as in
  §3, `dependencies = []` (typed-v0.51 has no imports). The interface descriptor is not part of the key.
- The summary record is `{entries, key, schema: "air.workbound.summary/1"}`, `entries` being the entry summaries `E(f)` of the
  exports; its digest is `sha256(UTF8("AIR_WORKBOUND_SUMMARY_V1") || 0x00 || canonical(record))`. The undomained v0.52
  `artifactDigest` is never a WorkBound digest. Field names are the PROPOSED R3.1 names accepted at H53 (D-VAL-04); the public record
  is OPEN-31 and is not created here.
- The binding (key, record, record bytes and digest, every function's `B(f)`, harness counters) lives in the private build state.
  `src/index.js` spreads every export of `src/v052_verified_build.js`, so that module gains no export; a read-only inspection reader
  is registered with `src/workbound.js` for tests. Nothing writes a binding from outside, and nothing reads one for admission,
  invocation, a Budget or a grant (RFC §6.7).
- R-WB-21: there is no summary cache; every build recomputes. A supplied summary or record is never an input: it can only be compared
  with the recomputed one, a mismatch fails with `air.workbound.identity_mismatch`, and the derived value stays bound.

## 5. Diagnostics (RFC §6.6)

`air.workbound.overflow`, `air.workbound.unknown_bound`, `air.workbound.missing_summary`, `air.workbound.invalid_bound`,
`air.workbound.identity_mismatch` (phase S), the reused `air.call.recursion_rejected` with its `cyclePath`, and
`air.workbound.cost_undefined` as the `IMPLEMENTATION_DEFECT` guard. Every message carries the `code:` delimiter and, where the node
has one, a source location. `air.workbound.analysis_limit_exceeded` is withdrawn and appears nowhere in `src/` or `bin/`.
No typed-v0.51 source can produce a WorkBound failure: it has no calls or loops, and its ingress is bounded by its source size.

## 6. Carried contract obligations (H53 item 10; owner field decisions H53 §B)

### R3-N2 — complexity obligation (`R3_N2_CHOICE=A`)

> After admission, every phase-S analysis runs in `O((ast_nodes(C) + analysis_units(C)) · K_max)` time and space, where `K_max` is
> the fixed Host ABI registry size, with host-stack depth `O(maxSyntaxNestingDepth)`. `analysis_units` is unchanged (R-WB-15c). The
> restatement is consistent with R-WB-15 (`O(N + E·K)`) and changes no verdict and no WorkBound value.

P0-02's own summarisation meets it: it is linear in the composition-tree nodes (at most a constant number per AST node) and memoised
(one summary per function), with explicit worklists. Witness shape: the H10 fixtures have 1000 parameters and 1000 enum cases, yet
`analysis_units` is 6 (EMISSION) and 4 (INGRESS); the `ast_nodes` term is what bounds them. No vector debt (option (a)).

### R3-N3 — conformance claim (`R3_N3_CHOICE=B`)

The claim is scoped to capacity; no intake floor is added (`INTAKE_FLOOR_ADDED=false`). Owner text, verbatim:

> A source is guaranteed to produce the same semantic verdict and the same WorkBound summary values on every conformant host that:
>
> 1. admits the source and closure under its declared intake limits; and
> 2. provides analysis capacity greater than or equal to the deterministic required value computed for that input.
>
> A host with insufficient analysis capacity may return:
>
> ANALYSIS_REFUSED
> air.analysis.capacity_exceeded
>
> This refusal is non-semantic and does not alter the program's WorkBound, validity, or expected semantic result.

No other wording in this slice promises analyzability. P0-02 owns the wording, the evidence fields and the stable refusal identity;
SCALAR owns the guard and its executable capacity vectors:

- refusal identity: disposition `ANALYSIS_REFUSED`, code `air.analysis.capacity_exceeded` (R-WB-15c; PROPOSED, OPEN-43 (a));
- evidence fields of a refusal: `measure` (`analysis_units` | `nesting_depth`), `required` (the deterministic measure of the input,
  a decimal integer) and `capacity` (the host's configured capacity, a decimal integer); `analysis_units` is named first when both
  measures exceed;
- these fields never appear in `WorkBoundKeyV1`, in a summary record or in a WorkBound failure (V53-ANA-07). P0-02 neither emits
  nor registers `air.analysis.capacity_exceeded`.

### R3-N4 — R-PIPE-1 qualified, and the evidence identity rule

> Conformant hosts reach identical verdicts and identical summary values. Summary records are byte-identical only for equal
> `compiler_implementation_digest` and `cost_table_digest`, because both are fields of `WorkBoundKeyV1`.

Evidence rule applied in this slice: every record-equality claim (V53-SEP-WB-02, V53-ANA-07, V53-WB-ID-05, V53-WB-ID-07,
V53-WB-REG-01) names both digests; byte equality is asserted only after both are shown equal; across different digests (V53-WB-ID-05:
one `src/` byte changed; V53-WB-ID-07: another CT-1 digest) only summary values are compared, and the records are shown to differ.

## 7. H10 and the deferred composites (PF-1)

- `H10_DIRECT_LOWER_READING=WITH_LIMITS` (H53 §B): a direct lowering attempt means `lowerToWat` with the accepted explicit limits, or
  a verified build entrypoint that supplies them. A bare `lowerToWat(mod)` is a low-level non-conformance path outside the H10 claim.
  `P0_02_BUILD_PASS_CRITERION=false`; `src/lower_wasm.js` and its default are untouched.
- P0-02 runs the typed-v0.51 parts of V53-WB-H10: EMISSION (the original X-BND-01 source, `12398f60…`; `verify`, `E(run) = S{1}`,
  `B(hidden) = S{1}`, ingress of `run` 0) and INGRESS (frozen fixture `55f00eae…`; `verify`, ingress of `wide` 1000000,
  `B(wide) = S{1}`, `E(wide) = S{steps:1000001}`, disposition VERIFIED + INTERNAL, corrections C1-C3 of the freeze review). Builds of
  the EMISSION source are attempted only with explicit accepted limits through the CLI, the SDK builder, the runtime and
  `lowerToWat`; each ends in a bounded `BUILD_REFUSED air.v052.work_limit_wat_bytes`. They are recorded, not counted as the pass
  criterion.
- V53-WB-H10 and V53-WB-H04 stay DEFERRED until SCALAR; their P0-02 parts are reported as part results. V53-WB-H01 (owned by P0-05)
  reports only its part (a) = V53-WB-P04.

## 8. Not in this slice

The analysis-capacity guard and `air.analysis.capacity_exceeded` (SCALAR); the typed-v0.53 profile id; calls, loops, imports,
externs, tables, state or memory in source; the R3-N1 parser nesting enforcement; a public WorkBound export or schema (OPEN-31);
any use of legacy M1 (`collectEffectUsage`, the legacy certificate, effect budgets, realtime fuel) as an input or oracle; any change
to DecisionEvidence, EffectReceipt, Budget or `PackageIdentityV1`.

```text
SECOND_COST_MODEL_CREATED=false
ANALYSIS_TERM_IN_WORKBOUND=false
ANALYSIS_LIMIT_CODE_PRESENT=false
M1_USED_AS_INPUT_OR_ORACLE=false
TYPED_V051_ACCEPTANCE_WIDENED=false
NEW_CALL_SYNTAX_ENABLED=false
NEW_LOOP_SYNTAX_ENABLED=false
PARSER_CHANGED=false
ABI_CHANGED=false
HOST_ABI_CHANGED=false
```
