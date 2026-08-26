# AIR v0.51 Typed Decisions and Numerics Conformance

Status: Normative vector plan; no implementation is certified by this document.

This plan implements the RFC's rule that an admitted feature is demonstrated by
deterministic vectors rather than by host-language behavior. Every vector is
run through parse, format, verify, package/interface validation, lowering where
implemented, Node, and Swift once a Swift host exists. Browser runs are useful
but do not substitute for Node/Swift agreement.

## Result Record

Each runner writes canonical JSON with the top-level keys, in this exact order:
`evidence_digest`, `interface_digest`, `source_digest`, `status`,
`value_or_failure`, and `vector`. No raw host exception text is an expected
result. The same vector run twice MUST be byte-identical after fields explicitly
designated as environment facts are removed. Source location is required for
static rejection vectors.

Example canonical result record (keys sorted, UTF-8, no insignificant
whitespace):

```json
{"evidence_digest":"sha256:EXAMPLE","interface_digest":"sha256:EXAMPLE","source_digest":"sha256:EXAMPLE","status":"pass","value_or_failure":{"decimal":"42","type":"i64"},"vector":"N04"}
```

### A2-R1 canonical serializer self-test

`A2R1-S01` serializes the example record above as exactly the following 185 UTF-8
bytes, with no trailing newline or insignificant whitespace:

```text
{"evidence_digest":"sha256:EXAMPLE","interface_digest":"sha256:EXAMPLE","source_digest":"sha256:EXAMPLE","status":"pass","value_or_failure":{"decimal":"42","type":"i64"},"vector":"N04"}
```

Its raw-byte SHA-256 is
`sha256:f28f4f51f397d490ef68d002ed9ddb07f2f5e7e3ebb6354ea8befa3aec2f9a38`.
Each runner MUST compare its literal output bytes and this digest before it may
report serializer conformance. This vector is a serializer fixture; it does not
introduce a new AIR semantic digest domain.

Example little-endian canonical option layout for `option<i32>` with
`some(42)`: `010000002a000000`. Bytes 0..3 are tag `1`; bytes 4..7 are payload
`42`. `none` is `0000000000000000`.

## Numeric Vectors

| ID | Input / operation | Required result |
| --- | --- | --- |
| N01 | `const.i32 -2147483648` | accepts exact minimum |
| N02 | `const.i32 2147483647` | accepts exact maximum |
| N03 | `const.i64 -9223372036854775808` | accepts exact minimum without host-number loss |
| N04 | `const.i64 9223372036854775807` | accepts exact maximum without host-number loss |
| N05 | `const.i64 9223372036854775808` | static `air.numeric.i64_constant_out_of_range` |
| N06 | `i64.checked_add(MAX, 1)` | `air.numeric.checked_failure`, `overflow` |
| N07 | `i64.checked_sub(MIN, 1)` | checked failure / `overflow` |
| N08 | `i64.checked_mul(MAX, 2)` | checked failure / `overflow` |
| N09 | `i64.checked_div_s(1, 0)` | checked failure / `division_by_zero` |
| N10 | `i64.checked_div_s(MIN, -1)` | checked failure / `overflow` |
| N11 | `i64.to_i32_checked(2147483647)` | exact `i32` |
| N12 | `i64.to_i32_checked(2147483648)` | checked failure / `invalid_conversion` |
| N13 | `f32` positive and negative zero | equal comparison; evidence bits `00000000` and `80000000` |
| N14 | `f32` NaN comparisons | ordered comparisons false; `ne` true; evidence classification `nan` |
| N15 | finite `f32` operation corpus | exact binary32/Wasm result bits |
| N16 | `f32.to_f64` | exact widening |
| N17 | lossless `f64.to_f32_checked` | success |
| N18 | lossy `f64.to_f32_checked` | checked failure / `invalid_conversion` |
| N19 | `f64` NaN and signed zero boundary evidence | NaN classified, signed zero bit-preserved |
| N20 | `i64.checked_neg(0)` | exact zero |
| N21 | `i64.checked_neg(MIN)` | checked failure / `overflow` |
| N22 | `i64.checked_rem_s(5, 2)` | exact `1` |
| N23 | `i64.checked_rem_s(-5, 2)` | exact `-1` |
| N24 | `i64.checked_rem_s(5, -2)` | exact `1` |
| N25 | `i64.checked_rem_s(MIN, -1)` | exact `0`, not overflow |
| N26 | `i64.checked_rem_s(1, 0)` | checked failure / `division_by_zero` |
| N27 | all six i64 comparisons | exact total boolean result for signed operands |
| N28 | successful arithmetic assigned to refinement | success if result is in range |
| N29 | successful arithmetic outside refinement | `air.refinement.assignment_out_of_range` |
| N30 | arithmetic overflow with incompatible refinement | numeric checked failure before refinement evaluation |
| N31 | `bool false` / `bool true` | canonical false / true |
| N32 | inbound Wasm bool other than 0/1 | stable validation rejection |
| N33 | integer `-0` | formatter evidence canonicalizes to `0` |
| N34 | float `-0`, `-0.0` | formatter preserves `-0.0`; signed-zero bits preserved |
| N35 | correctly-rounded f32 halfway boundary literal | direct binary32 ties-to-even result bits |
| N36 | correctly-rounded f64 halfway boundary literal | direct binary64 ties-to-even result bits |
| N37 | f64 +/- infinity and NaN to f32 checked | exact non-finite conversion policy |

## Decision Vectors

| ID | Input | Required result |
| --- | --- | --- |
| D01 | enum with `deny = 0`, `allow = 1` | formatter sorts canonically; `i32` layout candidate |
| D02 | enum duplicate discriminant | `air.decision.enum_duplicate_discriminant` |
| D03 | enum negative or > `i32` discriminant | static range rejection |
| D04 | unknown inbound enum discriminant | `air.decision.enum_discriminant_invalid` |
| D05 | `option.none<i32>` | tag 0 and zero inactive payload |
| D06 | `option.some<i64>` | tag 1, aligned 8-byte payload |
| D07 | `result.ok<i32,ParseError>` | tag 0, inactive error bytes zero |
| D08 | `result.err<i32,ParseError>` | tag 1, inactive success bytes zero |
| D09 | non-`error enum` as result error | `air.decision.result_error_type_invalid` |
| D10 | nested option/result payload | `air.decision.payload_type_unsupported` |
| D11 | enum match complete | result equal to selected arm |
| D12 | enum match missing case | `air.decision.match_nonexhaustive` |
| D13 | option match missing `none` or `some` | `air.decision.match_nonexhaustive` |
| D14 | result match missing `ok` or `err` | `air.decision.match_nonexhaustive` |
| D15 | duplicate or unknown match arm | stable match rejection |
| D16 | runtime invalid tag/discriminant | stable AIR invalid-tag path, not host default |
| D17 | enum duplicate case name | static duplicate-name rejection |
| D18 | enum missing explicit discriminant | static syntax rejection |
| D19 | enum discriminant `2147483647` | accepts maximum valid discriminant |
| D20 | enum discriminant outside signed i32 range | static range rejection |
| D21 | same enum name from two modules | fully-qualified identities remain distinct |
| D22 | option equality cases | none/some semantics, no structural host equality |
| D23 | result equality cases | ok/err semantics, no structural host equality |
| D24 | `option<i64>` some evidence | nested typed decimal i64, not JSON number |
| D25 | enum/option/result byte vectors | little-endian tags/discriminants/payloads |
| D26 | inactive payload and padding | every inactive/padding byte is zero |
| D27 | canonical type strings | aliases/whitespace normalize before evidence |
| D28 | canonical evidence serialization | key order/UTF-8/no-whitespace record bytes |

## Host and ABI Vectors

| ID | Required assertion |
| --- | --- |
| H01 | Node receives/emits exact `i64` as `bigint`; JSON `number` is rejected for typed `i64`. |
| H02 | Swift receives/emits exact `Int64`; typed evidence decimal matches Node. |
| H03 | Node and Swift agree on finite `f32` bits and signed-zero evidence. |
| H04 | NaN cross-host comparison asserts only `classification: nan`, not payload identity. |
| H05 | enum/option/result layout bytes exactly match the candidate layout. |
| H06 | unknown tag/discriminant and unknown host fields are rejected fail closed. |
| H07 | each existing package remains byte- and behavior-compatible within its own declared AIR ABI and Host ABI lane; neither 0.10 nor 0.11 is reinterpreted as typed decisions. |
| H08 | an exposed typed-decision interface is refused until its A1-approved ABI and Host Contract lane is selected. |

## Required Execution Matrix

| Surface | Required for a feature claim |
| --- | --- |
| Parser/formatter/verifier | all applicable vectors from N01-N37, D01-D28, and H01-H08 |
| Lowerer/runtime | all applicable dynamic/failure vectors from N01-N37, D01-D28, and H01-H08 |
| Node | N01-N37, D01-D28, H01-H08 |
| Swift | N01-N37, D01-D28, H01-H08 |
| Cross-host | N01-N37, D01-D28, H01-H08: same canonical source, interface digest, finite result bits, and semantic evidence digest |

A missing Swift runner means `HOLD_TYPED_DECISIONS_SWIFT_CONFORMANCE`, not a
cross-host PASS. A failure to run a browser runner similarly records the exact
environmental absence and makes no browser conformance claim.
