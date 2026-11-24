# N54-01 R2 decision packet (unsent)

Nothing here is selected, admitted or scheduled. In particular this does
not amend the v0.51 Swift RFC or v0.53 fresh-instance semantics.

## D4 - Where can either backend execute and how are failures contained?

D4 applies to all execution on the Swift host, including the reference Wasm
runtime when it is used as fallback. The existing RFC permits in-process
execution only in shadow mode. G54-SWIFT execution and parity evidence do
not establish authority; fallback does not change that.

| Option | What it gives | Cost and risk |
| --- | --- | --- |
| A. In-process Wasm or native only in a shadow prototype | Preserves the existing Apple posture. Measure recognized trap handling and compare against the host's authoritative outcome. | In-process defects in either backend can silently corrupt host memory, hang without an external kill path, or end the app on an unrecognized fault. No killable isolation or watchdog termination is shown. |
| B. Explicit exception for a narrowly admitted pure backend | Potentially lower overhead for normal calls; only with signed, independently reproduced bytes, bounds checks, per-operation failure mapping and an explicitly accepted fault boundary. | Not eligible for authority under the unchanged RFC. Would require a direct owner amendment and independent threat/negative review. In-process Wasm or native can still silently corrupt host memory, hang without an external kill path, or end the app on an unrecognized fault. |
| C. Killable boundary for either authoritative backend | Uses an external termination boundary as required by the existing RFC. | Whether a third-party iOS app can deploy a killable helper at all is UNKNOWN; latency is unknown too. Without the boundary, in-process execution remains shadow-only and can silently corrupt host memory, hang without an external kill path, or end the app on an unrecognized fault. |

To resolve C's feasibility, check current public iOS APIs, entitlements
and distribution restrictions for the proposed helper. In a separately
approved signed on-device prototype, demonstrate independent termination
or replacement of an intentionally non-completing helper, show that the
app survives and stale completions are rejected, and measure the
full-path cost. A desktop run or an in-process timeout does not answer it.

Recommendation: A for the first authorized experiment, retain the Swift
RFC for any authoritative execution, and bring the measured result back
before choosing an implementation/release boundary. If reliable in-process
failure attribution fails, stop the prototype or narrow it; do not turn
that result into a published exception. Per-batch trap capture is not a
substitute for per-operation correctness without an approved batch contract.

## D5 - Fresh instances, compiled cache, or reuse?

| Option | What it gives | Cost and risk |
| --- | --- | --- |
| A. Fresh every pure invocation, code-only caches and derived files | Starts both legacy-v0.50 and typed-v0.53 at the artifact's initial state; preserves the existing typed rule and applies the approved pure-state boundary to legacy. | Fresh wasm2c cost on iPhone under the proposed contract remains UNKNOWN. Faster generated instructions may not improve the full invocation. |
| B. Separately admitted legacy reuse experiment | Can test how much startup contributes for one import-free legacy artifact independently shown to have no mutable state or externally visible residue. | Outside the pure-path norm. Requires its own record and proof over the exact artifact and runtime, including traps and library-private state; not a blanket legacy property and not the typed route. |
| C. Future reset-equivalence proposal | Potential long-run optimization if initial-state equivalence can be proven. | Not an exception or current permission. A separate contract and approval would be needed for memory, globals, failure reasons, trap aftermath and concurrency, with sealed evidence including sequential failures. Out of this first pilot. |

Recommendation: A for both pure profiles and as the comparison baseline.
Consider B only as a distinct legacy experiment with independent checks;
do not use C to claim the first release is ready. Absence of declared
state/memory does not show a typed module cannot write the failure-reason
global. Keep caches and derived files code-only and distinct from a live
instance.

## Other owner decisions and immediate inputs

- D2: place the rest of lifecycle and the excluded runtime gates. Before
  any native shipment, resolve what prevents revoked native identities from
  running; the approved scope is text only, not a mechanism or a release exception.
- D6: recommend measuring one bounded legacy-v0.50 i32 consumer policy
  before admitting typed or multiple policies to the first iOS release.
  Supply exact verified Wasm/descriptor, candidate source hash, callable
  export, independent vectors, and the designated physical iPhone.
- D7: propose iOS-first and Android outside the first candidate's critical
  path. No Android backend, device session or device-lab spend is approved.
- Review: name an independent reader and obtain an owner-admitted small
  prototype scope. Keep its tests independent from the native builder.
  Measure Wasm and AOT with the same verification/ingress/result contract,
  one real user operation plus cold/warm costs, and report p95 and memory.
  Record performance thresholds before treating timings as pass/fail.
