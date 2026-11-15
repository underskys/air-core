# typed-v0.53 P0-03 — refinements and checked public ingress (implementation note)

Card `AIR-0053-P0-03-0001`. Admitted spec: the P0-03 slice RFC text R2
(`AIR_V053_P0_03_SLICE_RFC_R2_2026_10_23/`, SHA256SUMS `29bb12d5…`), owner admission record `f213f5a6…`. This note
says where each rule lives in the code. It adds no rule: where it differs from the slice text, the slice text wins.

## 1. Scope

Everything below applies to typed-v0.53 ASTs only. Each path dispatches on the profile tag
(`sourceProfile: "typed-v0.53"`, `src/errors.js`). typed-v0.51 and legacy-v0.50 are unchanged: the same parse, verify, format
and lowering results, codes and artifact bytes (R-PROF-4; slice text T-6; V53-REF-REG01).

## 2. Where each rule lives

| Rule (slice text) | Code |
| --- | --- |
| §4.1 R-REF-6, P3-R4, R-TYPE-4: `i64/f32/f64<..>` → `air.refinement.base_type_unsupported`; a nested refinement → `air.decision.payload_type_unsupported`; no ABI-candidate wording | `src/parser.js` `rejectV053RefinementForm` (every declared type); `src/verifier.js` `verifyV053TypedType` (the same rule on an AST) |
| §4.1 P3-R2 containment; narrowing at assignment, match-arm yield and return | `src/verifier.js` `verifyV053TypedAtom` (an `i32`-family reference into an `i32`-family slot; a refined constructor payload reference widens into its plain slot) |
| §4.1 P3-R3 static proof and rejection limited to SCALAR R-16 | `src/verifier.js` `verifyV053TypedExpression` (unchanged rule); `verifyV053TypedMatch` now passes the function's static values to the arms |
| §4.2 `desc(i32<a..b>) = i32` | `src/typed_interface.js` `validateDescriptorAgainstSource` (`descriptorImage`; profile tag first) |
| §4.3 `air.v053.verifiedTypedBuild/1`, `sourceSignature`; /2 typed-v0.51 only (P3-R7); handle schema unchanged (P3-R16) | `src/v052_verified_build.js` `normalizedBuildRecord`, `normalizedSourceSignature`, `typedV053SourceSignature` |
| §4.4 T-1..T-5: `__air_failure_reason`, no numeric global, registry values on the failing path, 16 vs 17, 48-51, the match fall-through | `src/lower_wasm.js` `v053ModuleHeaderLines`, `emitV053TypedRuntimeValidation`, `emitV053NarrowingCheck`, `emitV053TypedMatch` |
| §4.4 A-1, A-2, A-5 | `src/v052_numeric_diagnostic.js` `typedV053FailureIdentity`; `src/v052_verified_build.js` `invokeInstantiatedExport` |
| §5.0, §5.2 CT-1 application rule (containment exception) | `src/workbound.js` `withRefinementCheck`, `referenceContained`, `typedFunctionBody` |

CT-1 is unchanged (OD-P3-4 (a)): `src/workbound_cost_table_v1.json` is byte-identical to the c284dab object (git blob
`118511fe…`, raw sha256 `1afbe97f…`, `cost_table_digest` `sha256:1ae0cddb…`).

## 3. Adapter mapping table (reason -> code)

The typed-v0.53 adapter is the verified builder's and runtime's invocation path for `air.v053.verifiedTypedBuild/1` builds. On
a `WebAssembly.RuntimeError` it reads `__air_failure_reason` of the same, fresh instance (slice text §4.4 A-1; R-REF-9 as amended
by AMD-P3-1):

| Reason value | Host-facing identity |
| --- | --- |
| 0 | `air.runtime.trap_unclassified` (IMPLEMENTATION_DEFECT) |
| 1 | `air.numeric.checked_failure` / `overflow` |
| 2 | `air.numeric.checked_failure` / `division_by_zero` |
| 3 | `air.numeric.checked_failure` / `invalid_conversion` |
| 16 | `air.refinement.ingress_out_of_range` |
| 17 | `air.refinement.assignment_out_of_range` |
| 32 | `air.loop.count_out_of_range` |
| 33 | `air.table.index_out_of_range` |
| 34 | `air.memory.region_bounds_runtime` |
| 35 | `air.array.index_out_of_range` |
| 48 | `air.decision.enum_discriminant_invalid` |
| 49 | `air.decision.payload_tag_invalid` |
| 50 | `air.decision.bool_lane_invalid` |
| 51 | `air.decision.payload_lane_noncanonical` |
| 64 | `air.borrow.air_owned_memory_overlap` |
| any other value | `air.runtime.failure_reason_unknown` (fail closed) |

Any other exception keeps `air.v052.invocation_runtime_failure` (A-2). typed-v0.51 builds keep the numeric global and values
1-3 (A-5). The thrown error carries `.code`, `.reason` (numeric identities only) and `.failureReason` (the value read).

## 4. Readings made by the implementation (none changes an expected value)

1. The verified runtime does not validate a refined parameter host-side (A-4 says MAY). The module's entry check gives 16.
2. Lowering keeps the narrowing check where the value is a statically proven literal (R-REF-4 makes elision optional); it is
   unobservable. A contained local reference gets no check (P3-R2).
3. `__air_failure_reason` is not reset at function entry: it is set only on a failing path (T-3), and every invocation uses a
   fresh instance (R-STATE-1).
4. V53-REF-N11 and the V53-REF-N13 option-(a) half run the adapter's mapping on a synthetic instance: no compiler produces an
   unregistered value or an option-(a) artifact (P3-R15).
5. V53-MIG-N04 is executed by the P0-11 increment after this slice's QA PASS (kit generated table); this slice does not run it.
6. P3-R7 (/2 refuses a typed-v0.53 record) has no public entry point that accepts a record; it is enforced by the normalizer
   every trusted build and handle passes through.

## 5. Code registry additions at P0-03 (R-DIAG-2)

Codes that typed-v0.53 paths emit from P0-03 on, in addition to the SCALAR registry (`docs/v0.53/SCALAR.md` §6). "new" codes
are RFC §15 PROPOSED codes first emitted here; "reused" codes keep their existing meaning (OPEN-2 (a)).

| Code | Status | Where |
| --- | --- | --- |
| `air.refinement.base_type_unsupported` | new | §4.1 (R-REF-6) |
| `air.refinement.ingress_out_of_range` | new | §4.4 value 16 |
| `air.runtime.trap_unclassified` | new | §4.4 A-1 value 0 |
| `air.runtime.failure_reason_unknown` | new | §4.4 A-1 unregistered value |
| `air.decision.payload_tag_invalid` | new | §4.4 value 49 |
| `air.decision.bool_lane_invalid` | new | §4.4 value 50 |
| `air.decision.payload_lane_noncanonical` | new | §4.4 value 51 (AMD-P3-1) |
| `air.refinement.range_invalid` | reused | §4.1 static refusals |
| `air.refinement.bound_out_of_range` | reused | §4.1 static refusals |
| `air.v051.typed_interface_source_invalid` | reused | §4.2 P3-R6 |
| `air.v051.record_invalid` | reused | §4.4 A-3 (typed call) |
| `air.v052.invocation_runtime_failure` | reused | §4.4 A-2; §4.5 old adapter |
| `air.v052.verified_build_invalid` | reused | §4.3 items 2, 6 |
| `air.v052.verified_build_descriptor_mismatch` | reused | §4.3 item 3 |

## 6. Carried, not closed

V53-REF-N10 and V53-REF-P05 → P0-04; V53-REF-N12 → P0-08 (COMPOSITE: parts 1, 2, 3, 16, 17, 48, 49, 50, 51 run here as part
results; 32 → P0-05, 33 and 35 → P0-06, 34 → P0-08). The R2 delta review's P3 items N-1..N-4, the R1 review's F-7 and F-12, the
Swift adapter mapping (R-REF-11; no Swift path in the card), and the SCALAR residuals (F-1 BLOCK_PUBLISH, F-2, F-3, the V53-ANA-11
line-3 HOLD, ANA-09/10, OD-5) are untouched.
