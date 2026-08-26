# AIRSwift SDK Contract

This is an implementation-grade API candidate, not a Swift implementation.
All semantic serialization and authority decisions remain in frozen A2/A3.

| API | Layer / visibility | Responsibility and lifecycle |
| --- | --- | --- |
| `AIRPackageIdentity` | Core / public value | Canonical package identity; immutable and `Sendable`; host never invents it. |
| `AIRVerifiedArtifact` | Core / public value | Immutable artifact bytes plus verified identity/certificate binding. |
| `AIRArtifactVerifier` | Runtime / public protocol | Validates an artifact from host-supplied resources before a session exists. |
| `AIRRuntimeSession` | Runtime / public reference | Single-generation prepared session; off-main synchronous evaluate, explicit close/quarantine. |
| `AIRExecutionBackend` | Runtime / SPI protocol | Contained execution adapter; returns structured backend result, not Swift authority. |
| `AIRHostProfile` | HostContract / public value | Descriptive supported mapping; never creates a capability or ABI. |
| `AIRCapabilityObservation` | HostContract / public value | A3 fact record with explicit source/precision/fence. |
| `AIRCapabilityGrant` | HostContract / public value | Explicit A3 authority record; intersections only. |
| `AIRDecisionIntent` | HostContract / public value | Canonical bounded proposal; no host object identity. |
| `AIRDecision` | HostContract / public value | A3 allow/deny/limit and stable reason; does not execute an effect. |
| `AIRDecisionEvidenceDigest` | HostContract / public value | Opaque A3 digest, never Swift-serialized. |
| `AIREffectReceipt` | HostContract / public value | Host observation bound to a decision; cannot grant authority. |
| `AIRSessionGeneration` | Runtime / public value | Exact A3 fence binding; mismatch rejects stale work. |
| `AIRRuntimeEvaluationFailure` | Runtime / public value | Pre-decision evaluation timeout/poison/failure; containment diagnostic, never an A3 receipt. |
| `AIRSessionQuarantineEvent` | Runtime / public value | Host containment of one runtime generation; records no decision or host-effect result. |

Public values are immutable and `Sendable`; session/backend implementations are
actor-isolated or own a serial executor. The session is non-copyable by policy:
concurrent/nested use is rejected unless a future backend proves a stricter
model. Artifact loading and preparation occur outside the main actor; UI stays
host-owned. Backend failures are structured SDK errors and map to A3 failure
reasons only where A3 defines one. A thrown Swift error is never itself an AIR
`FailureReason`. In particular, a timeout, poison, or quarantine while
`AIRRuntimeSession` is `evaluating` before a valid `Decision` exists is an
`AIRRuntimeEvaluationFailure` (and optional `AIRSessionQuarantineEvent`), not
an `AIREffectReceipt`; it has no `decision_evidence_digest` or `intent_id`.

Serialization ownership is explicit: Node/AIR canonical serializers own A2
typed values and A3 decision/receipt bytes; generated bindings decode validated
records; host adapters serialize host-local diagnostics only. The optional
DecisionEvidence byte view is immutable and opaque until A1 pins its schema.
No API accepts `Any`, untyped dictionary, native layout, global mutable state,
or arbitrary host object as semantic input.

## Preparation and execution contract

1. Host supplies bytes/resources and requested profile.
2. `AIRArtifactVerifier` validates immutable identity, provenance, ABI and
   certificate disposition.
3. `AIRRuntimeSession` resolves one entrypoint, binds one generation/fence,
   validates profile and fixed input plan, and warms outside the invoke path.
4. A host adapter validates observation/grant/intent and calls AIR only through
   the selected backend.
5. A `Decision` gates host execution; the adapter rechecks host capability.
6. If a valid `Decision` exists and a bound host effect is attempted, refused,
   cancelled, or fails, host records an A3 `AIREffectReceipt` outside AIR.
7. A pre-decision runtime failure is recorded only as runtime containment /
   diagnostic evidence; the host must not synthesize decision bindings to make
   it receipt-shaped.

Safe native fallback is host-owned, explicit, observable, independently tested,
and no broader than the failed/denied path. It is not represented as an AIR
allow.
