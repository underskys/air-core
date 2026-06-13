# AIR Evidence Report

| Field | Value |
| --- | --- |
| Package | lan-observer-readonly-canonical-example |
| Package ID | lan-observer-readonly-canonical-example |
| Verification status | passed |
| AIR ABI | 0.10 |
| Required Host ABI | 0.10 |
| Package hash | sha256:d59768d7a395c4db8581df715fbf15ab0c71e7b1b09bd3c8399c2fcb583f32e7 |

## Capabilities

| Field | Value |
| --- | --- |
| Declared | none |
| Computed | none |
| Required | none |
| Host imports | none |
| Unsupported | none |

## Effects

| Field | Value |
| --- | --- |
| module.air | call.clamp_1000=2, call.clamp_nonnegative=2, call.confidence_x1000=1, call.diagnosis_code=1, call.recommended_action_id=1, call.severity=1, cpu.blocks=14, cpu.instructions=160, exports=6 |

## Output Intents

| Field | Value |
| --- | --- |
| contract outputs/lan_observer_diagnosis.output.json | passed; outputs=1; hash=sha256:701c036bb7be7e68fa91237ff3414ed1fd716c6f6228b309aaf9a364af9ca31e |
| command buffer outputs/lan_observer_diagnosis.commands.json | passed; records=1; hash=sha256:29b6bd8e5b8774b4318f612bcb9e92be0d5e2e4d2aac03d71d1e47fa9ac49ba8 |

## Structured IO

| Field | Value |
| --- | --- |
| handles generated/structured_io_handles.air | fresh; schemas=2; hash=sha256:cb81d425d3cc0bddbddccadaddda6c1630ec95d8fd45d2797f9947983dc5da5b |
| schema device_observation | air.structuredRowsetSchema; fields=10; maxRows=8; status=passed |
| schema diagnosis_summary | air.structuredOutputSummarySchema; fields=5; maxRows=n/a; status=passed |

## Host Policy Result

| Field | Value |
| --- | --- |
| Status | passed |
| Policy | lan-observer-readonly |
| Host profile | cli |
| Replay checksum | sha256:e8837488a3d194486180cdb95390ac8437ef4f60bd2c85b60ababcffbd1990cb |
| Allowed | 1 |
| Denied | 0 |
| Unknown output | 0 |
| Unsupported profile | 0 |

## Replay / Conformance

| Field | Value |
| --- | --- |
| Fixture | lan-observer-readonly-pass |
| Fixture kind | air.conformance.batchFixture |
| Status | passed |
| Package | lan-observer-readonly-canonical-example |
| Replay checksum | sha256:d6a4d51f911dae1e5b5669bd8f5099526e0ef8370fe0a6b11309617e92da296a |
| Expected outputs | 1 |
| Observed outputs | 1 |
| Expected commands | 1 |
| Observed commands | 1 |
| Mismatch count | 0 |
| Mismatch kinds | none |
| Output IDs involved | 3501 |
| State digest | not available |
| Host interaction evidence | passed |

## Diagnostics

| Field | Value |
| --- | --- |
| fail | none |
| hint | none |
| info | none |
| warn | air.review.repeated_literal: literal 100 appears 3 time(s)<br>air.review.repeated_literal: literal 100 appears 3 time(s)<br>air.review.repeated_literal: literal 2 appears 3 time(s)<br>air.review.repeated_literal: literal 2 appears 3 time(s)<br>air.review.select_chain_table: 1 select-chain pattern(s) look like table lookups encoded as branches<br>air.review.select_chain_table: 1 select-chain pattern(s) look like table lookups encoded as branches |

## Generated Artifacts

| Field | Value |
| --- | --- |
| generated/structured_io_handles.air | present; hash=cb81d425d3cc0bdd |

## Benchmark Summary

Not provided.

## Privacy Boundary

This report is derived from AIR evidence surfaces and omits sensitive payload classes and direct state/helper dumps by default.
