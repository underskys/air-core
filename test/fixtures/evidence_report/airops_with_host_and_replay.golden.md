# AIR Evidence Report

| Field | Value |
| --- | --- |
| Package | airops-incident-canonical-example |
| Package ID | airops-incident-canonical-example |
| Verification status | passed |
| AIR ABI | 0.10 |
| Required Host ABI | 0.10 |
| Package hash | sha256:1042ee16903724c8e565536d44079c8f35578fcdd4a610ca8883caf83db7a9f0 |

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
| module.air | call.bit_i32=14, call.clamp_100=14, call.clamp_nonnegative=14, call.confidence_score=1, call.recommended_action_id=1, call.risk_score=1, call.root_cause_kind_id=1, cpu.blocks=51, cpu.instructions=240, exports=5, memory.static_readonly_bytes=96, memory.table_read=4, static_readonly_bytes=96 |

## Output Intents

| Field | Value |
| --- | --- |
| contract outputs/incident_policy.output.json | passed; outputs=1; hash=sha256:1a212dec928088d8d87716456e9798c4b12bfa83465ce461339a6c55c63320f5 |
| command buffer outputs/incident_policy.commands.json | passed; records=1; hash=sha256:41e61440e0939bd614ce99bc2c00fbc4d7b4314f270baaffa2774243eee92a3b |

## Structured IO

No structured IO metadata was reported.

## Host Policy Result

| Field | Value |
| --- | --- |
| Status | passed |
| Policy | incident-readonly |
| Host profile | cli |
| Replay checksum | sha256:405d1bcc4e0d4a32f7d666ddc61e680f4483ce6cff22cefe4296b4fbdcce8245 |
| Allowed | 1 |
| Denied | 0 |
| Unknown output | 0 |
| Unsupported profile | 0 |

## Replay / Conformance

| Field | Value |
| --- | --- |
| Fixture | airops-incident-canonical-pass |
| Fixture kind | air.conformance.batchFixture |
| Status | passed |
| Package | airops-incident-canonical-example |
| Replay checksum | sha256:1dc644adc9ee5ccf2fb9f03240b8655f58f4fc1d86bc9581fdca12c7d035ccbf |
| Expected outputs | 1 |
| Observed outputs | 1 |
| Expected commands | 1 |
| Observed commands | 1 |
| Mismatch count | 0 |
| Mismatch kinds | none |
| Output IDs involved | 2001 |
| State digest | not available |
| Host interaction evidence | passed |

## Diagnostics

| Field | Value |
| --- | --- |
| fail | none |
| hint | none |
| info | none |
| warn | none |

## Generated Artifacts

No generated artifacts were reported.

## Benchmark Summary

Not provided.

## Privacy Boundary

This report is derived from AIR evidence surfaces and omits sensitive payload classes and direct state/helper dumps by default.
