# AIR v0.51 Frozen Conformance Clarification V2.1

Status: executable-fixture authority completion for the candidate v0.51 lane.

This addendum binds the original frozen conformance document,
[TYPED_DECISIONS_NUMERICS_CONFORMANCE.md](TYPED_DECISIONS_NUMERICS_CONFORMANCE.md),
to the following human-authorized metadata-only clarification inputs:

- V1 JSON SHA-256:
  7e9b2c369044220a7186aea91c6b90dae00b66539a8391b74448de0fdfc304dc
- V2 JSON SHA-256:
  d916aa9b3c9a69d14d1e344f04abc708e578643ef3e4dd5daa5c5722a1d31f3a
- V2.1 JSON SHA-256:
  8f9bc31ec07f9268197d77926fb5203b89b2d050836b2bed0a69fdedaa435a8d
- Human implementation task:
  AIR-0051-FROZEN-CONFORMANCE-CORPUS-CLOSURE-0003

V2.1 has REVISION_KIND=METADATA_ONLY_AUTHORITY_COMPLETION,
SEMANTIC_FIXTURE_CHANGES=0, UNAUTHORIZED_V1_FIXTURE_CHANGES=0, and
ROWS_STILL_HOLD=0. It does not change any semantic rule, parent vector ID,
subcase ID, operand, type, expected value, diagnostic, bits, bytes, hash, or
rounding rule from V2. The V1 values are retained as provenance; V2.1 adds the
literal metadata needed to admit the existing human clarification.

The canonical executable fixture manifest is
fixtures/v051/conformance/typed_decisions_numerics_clarified.json.
Its raw SHA-256 is the V2.1 JSON SHA above. Node and AIRSwift conformance
runners bind this exact file before executing a fixture.

The executable Cxx rows remain fixtures under their original parents:

- N15, N27 through N30, N35, and N36;
- D15, D21 through D25, and D27;
- H02, H03, and H04;
- D16, with its frozen host-facing
  air.decision.enum_discriminant_invalid diagnostic.

The original parents N01 through N37, D01 through D28, and H01 through H08
remain the canonical vector identities. No type-alias surface is introduced:
TRUE_TYPE_ALIAS_SURFACE=NOT_PRESENT_IN_V051; a future alias surface requires a
separate RFC.
