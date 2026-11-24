# N54-01 R2 threat model (pure path, proposal)

This supplements v0.53 THREAT_MODEL.md for a possible AOT adapter. It is not
a sandbox, a specification of malicious native code containment, a security
verdict or an implementation admission.

## Assets and trust

- Integrity of the verified Wasm, descriptor, applicable certificate, and
  approved derived native code; correct failure mapping and result lanes.
- No ambient authority for the pure call and no cross-invocation state.
  The host owns application decisions, OS access, lifecycle and scheduling.
- Trusted: app publisher and signing process, verifier and admitted build
  inputs, pinned translator/runtime/compiler, operating system and host
  adapter. Build tools are not a shipped runtime dependency.
- Untrusted at the boundary: call inputs, mismatching bundles/descriptors,
  obsolete artifacts and caches, and unsupported requests. No downloaded
  or third-party native executable may become trusted by presenting a Wasm
  hash. A compromised signing key, OS, compiler or host is not addressed by
  the pure port; reproducibility alone would not detect all of them.

## Failure modes and required evidence

| Failure mode | Proposed treatment | Evidence for independent review |
| --- | --- | --- |
| Wrong bytes, wrong descriptor or unsupported features | Bind size and digest to the exact bytes consumed; check provenance and signed bundle before admission, verify pure import table and descriptor; fail closed. | Negative identity, profile, import and descriptor coverage; reference path unchanged. |
| Incorrect translator/runtime/target pairing | Pin input and output identities, independent rebuild and signed distribution; refuse unknown target or transformer. A valid digest is not semantic evidence. | Build and corpus evidence for every supported combination, including independent fixture and differential checks. |
| Trap, host or memory fault in Wasm reference or native backend | Map only recognized failures; reject unknown ones. Preserve bounds checks. Both in-process paths are shadow-only, including Wasm fallback; neither can provide process containment. A compiler, translator or runtime defect can silently corrupt host memory, hang without an external kill path, or end the app on an unrecognized fault. | Distinguish recognized traps from faults on the actual device; verify failure identity and caller behavior. For authority, independently prove the RFC's termination boundary. iOS helper feasibility is UNKNOWN; D4 remains open. |
| State leakage, stale failure reason, races, re-entry | Start at the artifact's initial state in both profiles; fresh instances by default, any equivalent reset separately proven and admitted under D5. Caches and derived native files hold code only. Legacy reuse is a separate D5-B experiment. One active use per handle by default, no shared mutable result/failure buffers. A fault, unattributable in-flight completion, or identity mismatch as defined in CONTRACT section 4.5 poisons the handle; never reuse it, and require fresh admission. | Sequences of good and failing calls, cancel/close and concurrent invocations; do not infer safety from no explicit AIR state declaration. D5 remains open. |
| Revoked/superseded artifact and stale completion | Host-trusted status rejects the affected identity and its derived/cache entries before new execution; discard obsolete results. No replay into another backend after a call has started. | Test both a revoked derived output and a revoked source. Source revocation blocks fallback based on that source. No claim about freshness/distribution or complete fencing. |
| Release/rollback confusion | Roll back to previously admitted, non-revoked Wasm or refuse. In-process fallback remains shadow-only and grants no authority. Do not use a handwritten result, private export or raw call to restore service. | Clean install, verified update and rollback on target hardware; record exact artifacts and what was actually executing. |

## Explicitly not shown

No production isolation, arbitrary native plugin support, termination after
a wall-clock timeout, cross-engine floating point equivalence, or runtime
authority is demonstrated. Android performance and containment are
unmeasured here. Revocation implementation, activation, effect delivery,
persistent state, time, replay, evidence and fencing remain outside the
v0.54.0 cut. These are review requirements, not tests already run.
