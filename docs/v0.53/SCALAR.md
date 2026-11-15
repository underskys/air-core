# typed-v0.53 SCALAR slice — implementation note

```text
TASK=AIR-0053-P0-SCALAR-0001 (kit card "SCALAR"; admitted 2026-10-22, admission record 09b9120b…)
SPEC=AIR_V053_SCALAR_SLICE_RFC_R3_FROZEN_2026_10_22 (SHA256SUMS 66eac708…; SCALAR_SLICE_RFC.md 957467e6…) on RFC R3.1
BASE=airlang 388c790e69de (P0-02 + F1/RD-3), air-core ede6be77aa4a
STATUS=CANDIDATE, internal only; QA level EXACT_SHA, different contour; the implementer does not QA this slice
OWNER_DECISIONS=OD-1 (b), OD-2 (a), OD-3 (c), OD-4 (b), OD-5 (b), OD-6 (c), OD-7 (a), OD-8 (b); admission notes F-8, F-9, F-10
```

typed-v0.53 is a candidate source profile. It is selectable only with the explicit opt-in (`allowCandidateProfile: true`, CLI
`--allow-candidate-profile`) until H53-RELEASE decides otherwise. Its surface at SCALAR is the typed-v0.51 surface plus the SCALAR
operations of RFC §5 (D-VAL-12..14). typed-v0.51 and legacy-v0.50 results, codes, error order and formatter output are unchanged.

## 1. What this slice adds

| File | Role |
| --- | --- |
| `src/source_profile.js` | Id `typed-v0.53` behind the candidate gate (`air.source_profile.candidate_disabled`), the kill switch `disable_typed_v053_profile` (a module-level constant, off), phase A for typed-v0.53 bytes, and the R-PROF-7 profile check (`air.source_profile.ast_mismatch`) for typed-v0.53 ASTs |
| `src/errors.js` | The profile tag helper and the floor error `air.assurance.profile_unsupported` (a leaf module, so assurance tools load no parser) |
| `src/analysis_capacity.js` | **The new internal module for the R-WB-15c measures** (card scope): `analysis_units`, `nesting_depth`, the capacity option (PS-1), the refusal `ANALYSIS_REFUSED` `air.analysis.capacity_exceeded {measure, required, capacity}` |
| `src/parser.js` | The typed-v0.53 parser: one pass over the lines with an explicit stack of open frames (AMD-1), the type-nesting guard of 64 before any recursive type processing (AMD-2), the SCALAR operation table, carriers and literal normalization (OPEN-4 (a)) |
| `src/verifier.js` | typed-v0.53 verification (§5), static checked evaluation (R-SCL-2 with reading R-16), `match` over `bool`, the certificate refusal and the realtime floor for typed-v0.53 ASTs |
| `src/lower_wasm.js` | typed-v0.53 lowering with the exact incremental WAT cap (R17-a, R17-b), the SCALAR operations, the phase-B engine-limit check (OD-2 (a)) |
| `src/format.js` | The typed-v0.53 canonical form: the typed-v0.51 rules plus exactly one trailing LF (OPEN-3 (a)) |
| `src/v052_verified_build.js` | Builder and runtime accept typed-v0.53 under the gate; phase A (capacity before verification and, in the runtime, before the cache); the record carries `sourceProfile: "typed-v0.53"` |
| `bin/airc.js`, `src/lsp_diagnostics.js`, `src/lsp_server.js` | Profile selection with the opt-in; `check` and the LSP for typed-v0.53 (R-LSP-1); F3 fixed for typed-v0.53 (§6.1) |
| `src/ai_review.js`, `src/audit.js`, `src/explain.js`, `src/provenance_flow.js`, `src/wit.js`, `src/semantic_patch.js`, `src/verified_execution_session.js`, `src/audio_authority.js`, `src/conformance_report.js` | R-ASSUR-1 floor guards only (OD-3 (c) option on the two package-based entrypoints; OD-8 (b) for the two reports) |
| `src/diagnostics.js` | Repair hints for the new codes |
| `test/v053_scalar.test.js`, `test/v053_scalar_pipeline.test.js`, `test/v053_assurance_floor.test.js`, `test/v053_analysis_capacity.test.js` | The SCALAR vector set and the deferred ledger. Sources are embedded and pinned by sha256 (R-19); `fixtures/v053/scalar/**` is unused |

## 2. Decisions recorded here (names and readings the spec leaves to the note)

- **Profile tag (R-2).** A typed-v0.53 AST carries the own property `sourceProfile: "typed-v0.53"`: enumerable, not writable, not
  configurable. It also keeps `v051TypedAst: true`, because descriptor validation (`src/typed_interface.js:250`) and the WorkBound
  model need it; every shared function that dispatches on that marker checks the tag first. Untagged ASTs keep their 388c790 paths.
- **Internal module name:** `src/analysis_capacity.js`. The typed-v0.53 parse, verify, format and engine-limit functions are internal. They are non-enumerable `typedV053` properties of their modules and are not in the root's exports. Non-enumerability is not access control. The supported entries are the package root and `airc`, and they select typed-v0.53 only under the candidate gate (SCALAR F-1). The package's `exports` map refuses `@underskys/air-core/src/...` imports by name. Code in the same process that loads `src/` files by path still reaches these functions without the gate, and no package setting can prevent that.
- **AST measures.** `decls` counts functions, enums and each `capabilities` declaration line (`capabilityDeclarations`); SCALAR admits
  no extern, struct, table, constant, state, demand block or `use`. `stmts` counts every `local`, `match` and `return`; `match` arms
  are atoms, not statements. `nesting_depth` is 1 for every SCALAR body (no block statement).
- **`-> void` (OPEN-17 belongs to P0-04).** typed-v0.53 does not admit void functions before P0-04. They verify but never lower in
  typed-v0.51 (RFC §3.2), and R-COMP-3 forbids a typed-v0.53 program that verifies and then fails to build, so the verifier rejects
  them with `air.v051.typed_syntax_invalid` (an unsupported typed declaration, the RFC §15 reuse example). QA should confirm or
  reject this reading.
- **Integer-spelled float literals** are normalized to `N.0` by the parser wherever the expected type is `f32`/`f64` (local and return
  values, match-arm atoms, constructor payloads, operation arguments with a known signature), so verification, lowering and the
  formatter see one spelling. Integer `-0` is `0`; float `-0` is `-0.0`.
- **Qualified enum patterns** of the module itself (`module::Type.case`) are accepted and normalized to `Type.case` (OPEN-9 (a)).
- **Engine limits** (OD-2 (a)): the count limits of the WebAssembly JavaScript Interface, W3C CRD of 22 October 2026, §8 (content
  sha256 `80a91c1a…`), are checked in phase B on the module the build would emit (functions, types, imports, exports, globals;
  per function: parameters, results, locals including parameters), counted by running the typed-v0.53 lowering in counting mode.
  Refusal: `BUILD_REFUSED` `air.build.engine_limit`, naming the limit.
- **CT-1** is unchanged (OD-6 (c)): `src/workbound_cost_table_v1.json`, revision `P0-02-F1-RD3`, raw sha256
  `1afbe97ffb8b18c34f4591e6a3e99b0cd0d6666e298654ad55d8b93d6739d312`, `cost_table_digest`
  `sha256:1ae0cddb2b01ca1f16f5b8da059ebd0a594d8c222aea4e5bf8f5e2c6d17e80c9`. Every SCALAR operation is one `statement.scalar` row
  (slice text §5.1), so `src/workbound.js` needs no change.
- **Legacy certificate identity.** `resourceVerifierIdentity` hashes `src/verifier.js`; the SCALAR change to that file changes the
  legacy certificate's verifier digest, as any verifier change does. No disposition changes.

## 3. Conformance claim (R3-N3, owner choice B; quoted verbatim from H53 §B)

```text
A source is guaranteed to produce the same semantic verdict and the same
WorkBound summary values on every conformant host that:

1. admits the source and closure under its declared intake limits; and
2. provides analysis capacity greater than or equal to the deterministic
   required value computed for that input.

A host with insufficient analysis capacity may return:

ANALYSIS_REFUSED
air.analysis.capacity_exceeded

This refusal is non-semantic and does not alter the program's WorkBound,
validity, or expected semantic result.

INTAKE_FLOOR_ADDED=false
```

**N-1** (slice text §3.3, quoted): The analysis-capacity conformance floor (R-WB-15c, OPEN-43 (a): `ANALYSIS_UNITS_FLOOR` 65,536,
`NESTING_DEPTH_FLOOR` 32) and `R3_N3_CHOICE=B` answer different questions and are compatible. The floor is a host minimum for
**capacity**: a host that claims typed-v0.53 conformance may lower `maxAnalysisUnits` and `maxSyntaxNestingDepth` only down to it.
`INTAKE_FLOOR_ADDED=false` means there is no host minimum for **intake**: a conformant host may lower `maxSourceBytes`, `maxAstNodes`
and the closure limits to any value and return `INTAKE_REFUSED`. Neither is a universal promise that a source is analyzed. The floor
guarantees only that a closure within it passes the capacity check; analysis also needs that host's intake admission. The only
guarantee about verdicts and summary values is the CONFORMANCE_CLAIM: its condition 1 is intake admission and its condition 2 is
capacity ≥ `required`. The floor makes condition 2 automatic for closures within the floor and says nothing about condition 1. No other
wording in SCALAR's code, diagnostics or documents may promise analyzability or admission.

Capacity values: defaults `maxAnalysisUnits` 1,048,576 and `maxSyntaxNestingDepth` 64. The CLI and the LSP use the defaults. The SDK
parse, verify, format and lower functions, the builder and the runtime accept `analysisCapacity: { maxAnalysisUnits,
maxSyntaxNestingDepth }` (PS-1, admitted with SCALAR, F-9): each an integer from 1 through its default, otherwise
`air.v052.runtime_limits_invalid`. A configured value is honoured exactly, also below the floor (a test host).

## 4. Phase order of every typed-v0.53 entrypoint (slice text §3.1, §4.2)

source bytes (the CLI's bounded 4 MiB reader first) → iterative parse (parse-time rejections) → AST-node intake → capacity check
(`analysis_units`, then `nesting_depth`) → verification (phase S) → WorkBound summaries (builder) → phase-B engine limits (E1, E2, E3) →
toolchain guard (assembling entrypoints) → lowering with the exact incremental WAT cap → assembly → Wasm cap on the assembler output
(AMD-10) before the bytes are hashed, compiled, cached or returned. An entrypoint that takes an AST (SDK verify, format, lower)
recomputes both measures before it verifies, formats or lowers. The runtime runs phase A on every build request before the compile
cache is consulted (R-13). Refusals keep their own disposition: `INTAKE_REFUSED`, `ANALYSIS_REFUSED` (never a verdict, never cached,
never WorkBound evidence), `BUILD_REFUSED`, `ENVIRONMENT_UNAVAILABLE`.

## 5. R-ASSUR-2 table (typed-v0.53 ASTs)

| Surface | State |
| --- | --- |
| formatter | SUPPORTED |
| diagnostics | SUPPORTED |
| LSP / `airc check` | SUPPORTED (files; package targets refuse with `air.source_profile.command_unsupported`) |
| legacy resource certificate | UNSUPPORTED_FAIL_CLOSED (`air.resource_certificate.profile_unsupported`) |
| provenance | UNSUPPORTED_FAIL_CLOSED |
| semantic patch | UNSUPPORTED_FAIL_CLOSED (`sourceProfile` option, OD-3 (c)) |
| audit / explain | UNSUPPORTED_FAIL_CLOSED |
| ai_review | UNSUPPORTED_FAIL_CLOSED |
| WIT | UNSUPPORTED_FAIL_CLOSED (CLI: `air.source_profile.command_unsupported`) |
| realtime-safe admission / session | UNSUPPORTED_FAIL_CLOSED (DEFERRED_V054; session via the `sourceProfile` option) |
| audio authority report | UNSUPPORTED_FAIL_CLOSED (OD-8 (b)) |
| conformance report | UNSUPPORTED_FAIL_CLOSED (OD-8 (b)) |

## 6. Registry of the codes typed-v0.53 emits at SCALAR (R-DIAG-1, R-DIAG-2)

Every code carries the `code:` delimiter. Codes are reused byte-for-byte where the meaning is identical (OPEN-2 (a)); no
`air.v053.*` code exists. New codes (PROPOSED in RFC §15, accepted with D-VAL-10) are marked **new**.

| Code | Disposition | Where |
| --- | --- | --- |
| `air.source_profile.candidate_disabled` | selection refused (**new**) | gate |
| `air.source_profile.unsupported` | selection refused | unknown id; kill switch on |
| `air.source_profile.ast_mismatch` | STATIC_REJECT (**new**) | R-PROF-7 |
| `air.source_profile.command_unsupported` | UNSUPPORTED | CLI commands without typed support |
| `air.source_profile.invalid_form` | CLI usage | `--source-profile=` |
| `air.source_profile.duplicate` | CLI usage | repeated `--source-profile` |
| `air.source_profile.missing` | CLI usage | no value |
| `air.source_profile.file_missing` | CLI usage | no source file |
| `air.cli.option_unknown` | CLI usage | unknown option |
| `air.cli.file_too_large` | INTAKE_REFUSED | bounded 4 MiB reader |
| `air.cli.file_invalid` | INTAKE_REFUSED | bounded reader (not a regular file) |
| `air.v052.work_limit_source_bytes` | INTAKE_REFUSED | phase A |
| `air.v052.work_limit_source_name_bytes` | INTAKE_REFUSED | builder, runtime |
| `air.v052.work_limit_ast_nodes` | INTAKE_REFUSED | phase A |
| `air.v052.work_limit_descriptor_bytes` | INTAKE_REFUSED | builder, runtime |
| `air.analysis.capacity_exceeded` | ANALYSIS_REFUSED (**new**) | end of phase A |
| `air.v052.runtime_limits_invalid` | host configuration refused | capacity / limit values |
| `air.v052.runtime_input_invalid` | host input refused | runtime request |
| `air.v051.typed_syntax_invalid` | STATIC_REJECT | parse; void functions |
| `air.v051.function_duplicate` | STATIC_REJECT | parse, verify |
| `air.v051.type_reference_invalid` | STATIC_REJECT | types |
| `air.decision.payload_type_unsupported` | STATIC_REJECT | type guard of 64 (AMD-2); non-flat payload |
| `air.refinement.syntax_invalid` | STATIC_REJECT | refinement types |
| `air.refinement.assignment_out_of_range` | STATIC_REJECT / RUNTIME_FAIL | refined values |
| `air.decision.enum_invalid` | STATIC_REJECT | enums |
| `air.decision.enum_empty` | STATIC_REJECT | enums |
| `air.decision.enum_duplicate_type` | STATIC_REJECT | enums |
| `air.decision.enum_duplicate_case` | STATIC_REJECT | enums |
| `air.decision.enum_duplicate_discriminant` | STATIC_REJECT | enums |
| `air.decision.enum_discriminant_required` | STATIC_REJECT | enums |
| `air.decision.enum_discriminant_out_of_range` | STATIC_REJECT | enums |
| `air.decision.enum_unknown` | STATIC_REJECT | types |
| `air.decision.result_error_type_invalid` | STATIC_REJECT | types |
| `air.decision.match_arm_invalid` | STATIC_REJECT | match (incl. operation arms, OPEN-9 (a)) |
| `air.decision.match_duplicate_arm` | STATIC_REJECT | match |
| `air.decision.match_binding_shadow` | STATIC_REJECT | match |
| `air.decision.match_nonexhaustive` | STATIC_REJECT | match |
| `air.decision.match_type_unsupported` | STATIC_REJECT | match |
| `air.decision.match_unknown_value` | STATIC_REJECT | match |
| `air.capability.unknown` | STATIC_REJECT | capabilities |
| `air.control.statement_after_return` | STATIC_REJECT | statements |
| `air.v051.parameter_duplicate` | STATIC_REJECT | functions |
| `air.v051.local_duplicate` | STATIC_REJECT | statements |
| `air.v051.local_unknown` | STATIC_REJECT | atoms |
| `air.v051.return_missing` | STATIC_REJECT | functions |
| `air.v051.return_type_mismatch` | STATIC_REJECT | returns |
| `air.v051.typed_statement_invalid` | STATIC_REJECT | statements |
| `air.v051.typed_atom_invalid` | STATIC_REJECT | atoms |
| `air.v051.typed_atom_type_mismatch` | STATIC_REJECT | atoms, operations |
| `air.v051.typed_constructor_invalid` | STATIC_REJECT | constructors |
| `air.v051.typed_constructor_type_mismatch` | STATIC_REJECT | constructors |
| `air.numeric.i64_constant_out_of_range` | STATIC_REJECT | i64 literals |
| `air.numeric.operation_mode_required` | STATIC_REJECT (**new**) | R-SCL-1 |
| `air.numeric.operation_invalid` | STATIC_REJECT | unknown or unadmitted operation |
| `air.numeric.checked_failure` | STATIC_REJECT / RUNTIME_FAIL | R-SCL-2, R-SCL-3 (`overflow`, `division_by_zero`, `invalid_conversion`) |
| `air.v051.typed_value_invalid` | RUNTIME_FAIL | ingress value (incl. a bool lane other than 0/1) |
| `air.decision.enum_discriminant_invalid` | RUNTIME_FAIL | enum ingress |
| `air.v052.invocation_arguments_invalid` | invocation refused | checked invocation |
| `air.v052.work_limit_invocation_lanes` | invocation refused | invocation lanes |
| `air.build.engine_limit` | BUILD_REFUSED (**new**) | phase B (OD-2 (a)) |
| `air.v052.work_limit_wat_bytes` | BUILD_REFUSED | phase L, incremental |
| `air.v052.work_limit_wasm_bytes` | BUILD_REFUSED | phase L, assembler output (AMD-10) |
| `air.v052.toolchain_input_unavailable` | ENVIRONMENT_UNAVAILABLE | toolchain guard |
| `air.v052.toolchain_input_invalid` | ENVIRONMENT_UNAVAILABLE | toolchain guard |
| `air.assurance.profile_unsupported` | UNSUPPORTED (**new**) | R-ASSUR-1 floor |
| `air.resource_certificate.profile_unsupported` | UNSUPPORTED | legacy certificate (R-WB-24) |

`air.verifier.analysis_limit_exceeded` (the H52 legacy guard) is not used by typed-v0.53: its meaning (fixed legacy verifier limits)
is not the R-WB-15c host capacity (slice text R-15).

## 7. Carried and not done here

- R3-N5, R3-N6 (P0-03/P0-08), R3-N11, R3-N12 (P0-06/P0-07) are not touched.
- V53-ANA-09 and V53-ANA-10 are owned here and **DEFERRED → P0-04** (value `if` arrives there).
- V53-ANA-11: the line-3-only pin is HOLD_FOR_ARCHITECTURE_REVIEW. The implementation adds no rule for it; the evidence records which
  line and code occurred.
- typed-v0.51 defects found during SCALAR stay recorded and unchanged (OD-5 (b)): the type-nesting `RangeError` (G-2), F3 on the
  typed-v0.51 CLI, the missing `code:` delimiter of some typed-v0.51 messages.
- F5 and F7 are not SCALAR acceptance items.
