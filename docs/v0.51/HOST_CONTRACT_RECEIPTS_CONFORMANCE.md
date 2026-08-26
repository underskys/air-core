# Typed Host Contract and Receipt Conformance

This is a specification vector index for a future Node and Swift runner. A3
does not implement a runner. Vectors use A2 canonical typed-value encoding and
the `AIR_DECISION_EVIDENCE_V1` and `AIR_EFFECT_RECEIPT_V1` domains.

| ID | Input condition | Required result |
| --- | --- | --- |
| HC01 | Same grant and intent | Same deterministic decision and decision digest. |
| HC02 | Missing grant | Deny `grant_missing`. |
| HC03 | Scope mismatch | Deny `grant_scope_mismatch`. |
| HC04 | Stale fence | Deny `stale_generation`. |
| HC05 | Future or unknown fence | Deny `stale_generation`. |
| HC06 | Deadline exactly at boundary | Permit only when `now_ns == not_after_ns`. |
| HC07 | Budget exactly at limit | Permit with exact effective budget. |
| HC08 | Budget exceeded | Deny `budget_exceeded`. |
| HC09 | Unknown capability | Deny `unknown_capability`. |
| HC10 | Unknown effect | Deny `unknown_effect`. |
| HC11 | Duplicate preterminal intent delivery | Coalesce one host execution only. |
| HC12 | Replayed terminal decision | Reject `replay_rejected`. |
| HC13 | Receipt bound to other decision | Reject `invalid_receipt`. |
| HC14 | Same receipt ID and identical bytes | Idempotent receipt duplicate. |
| HC15 | Same receipt ID and changed bytes | Reject `invalid_receipt`. |
| HC16 | Host execution fails | Receipt `host_failed`, reason `host_failure`; prior decision unchanged. |
| HC17 | Allow decision, host refusal | Receipt `host_refused`; no retroactive denial. |
| HC18 | Deny decision | No permitted effect receipt. |
| HC19 | Limit result | Effective scope is a strict subset and budgets do not rise. |
| HC20 | Equal decision inputs | Byte-identical decision evidence digest. |
| HC21 | Equal receipt facts | Byte-identical receipt digest. |
| HC22 | Unknown semantic field | Fail closed. |
| HC23 | Unknown observational extension | Ignore only when namespaced and excluded from policy/digests. |
| HC24 | Negative or overflowing checked i64 | Fail closed. |
| HC25 | Invalid A2 tag/type identity | Fail closed before contract evaluation. |
| HC26 | Old-generation receipt | Reject as stale replay. |
| HC27 | Same intent ID with different bytes | Reject identity collision. |
| HC28 | Changed digest domain prefix | Reject as incompatible record version. |

## Cross-host requirements

Node and Swift must agree on A2 canonical typed values, all closed enum
discriminants, checked-i64 outcomes, deterministic AIR decision result, and
canonical decision evidence. They do not need equal measured latency,
completion timing, platform telemetry, or host execution identifiers. This is
the distinction between semantic equality and observational equality.

The future runner must pin vectors and their canonical bytes. It must report
unsupported record versions as fail-closed results, not as a best-effort
conversion. P2 R3 covers runner implementation; A2 P2 R1 and R2 remain
separate nonblocking inputs.
