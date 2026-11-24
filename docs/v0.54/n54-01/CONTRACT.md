# AIR N54-01: pure native execution contract, R2 proposal

Status: PROPOSED, documentation only, 2026-11-20.
Basis: the approved release scope and the owner decision to start
step 2. This is not an accepted ABI, device-run permission, implementation
admission or release authorization. "Must" below states a draft requirement
unless the traceability table identifies an existing rule.

## 1. Roadmap reconciliation

Roadmap V3 remains the baseline. SCOPE-1 moved the eight runtime gates to
G54 and added G54-PUBLIC. The 18 November cut and confirmed step 1 narrow
v0.54.0 to contract/threat-model documents and repository tidy-up: no new
runtime. G54-PUBLIC is the only full gate in that release's scope, subject
to the accepted release checks: exact tarball, fresh macOS/Linux install, unchanged v0.53
corpus, documentation checks, independent exact-SHA QA and bounded claims.

G54-SWIFT gets invocation text only. G54-STATE gets the no-state-in-cache
rule only. G54-LIFECYCLE gets candidate-to-verified admission only, plus the
owner-requested text on refusal of obsolete artifacts. TIME, REPLAY, EFFECT,
EVIDENCE and FENCE are out. D2 schedules the excluded work; this text does
not assign it to a release or replace the embedded authority roadmap.

v0.54.1 is the planned AOT release, not admitted by this record. Running the
exact verified Wasm on a real Swift host is the G54-SWIFT reference evidence.
That evidence shows execution and parity, not authority. Both the Wasm
reference runtime and native execution on the Swift host are shadow-only
when in-process, under the unchanged v0.51 Swift RFC.
A translated native file is a separate derived artifact; parity and
provenance qualify that artifact, not a substitute for running the Wasm.

## 2. Profiles and accepted surfaces

| Profile | Reference behavior | Proposed initial native boundary |
| --- | --- | --- |
| legacy-v0.50 | Preserve the frozen legacy artifact identity and semantics. The first consumer pilot proposal uses an existing bounded, import-free i32 policy. | Match the concrete export descriptor and frozen legacy outcomes. Do not infer support for all legacy modules from one pilot. |
| typed-v0.53 PURE | Candidate opt-in remains. Check the descriptor and preserve typed argument/result lanes and failure identities. State, if admitted by the verified pure subset, is invocation-local. | Document separately; no first-release commitment (D6). Borrowed exports, actual Wasm imports, and unsupported features fail closed. No new aggregate export ABI or floating-point parity promise. |
| Effectful or borrowed artifacts | Existing v0.53 routes and protections stay as shipped. | Not accepted on this pure path. Separate scope and admission required. |

"Import-free" means the resulting Wasm import table is empty. A source
module dependency is not itself a Wasm host import. Conversely a Wasm
`air:contract/typed-v0.53.v1` import is not exempt because it looks like an
ABI handshake; it identifies a different route. Do not instantiate an
import-bearing module with a toy adapter to make it pass the pure gate.
Integer-only I/O for the first prototype is a recommendation, not a change
to the types supported by Core.

## 3. Layers and identities

- **Semantic contract:** source profile, verifier disposition, applicable
  resource certificate, typed operations and failure mapping.
- **Wasm artifact ABI:** exact Wasm bytes, descriptor, export signatures
  and profile-specific protocol. This is the reference executable identity.
- **Host ABI:** capability registry and host-side authority. Pure invocation
  requires no imports, grants, clocks, or host handles. No Host ABI change.
- **Native calling convention:** a separately identified platform adapter
  over the above semantics. Machine types or platform layout never become
  the AIR ABI. The first adapter encoding, profile subset, platform and
  target ABI must be declared by the implementing slice and independently
  reviewed; no new identity is reserved or approved here.
- **Lifecycle and evidence:** admission facts bind the immutable execution
  handle. Admission is not approval, activation, a persistent session or
  per-call DecisionEvidence. Do not expose an internal handle as authority.

## 4. Pure invocation

1. **Admission:** compare actual byte length and SHA-256 of bound input
   bytes to the trusted lock before parsing or loading those bytes; do not
   check one copy and run another. Bind the source profile, exact reference
   Wasm and descriptor, verifier and applicable certificate disposition.
   Reject missing or incoherent bindings, unsupported exports or profile,
   and imports on the pure path. The signed bundle/publisher is the native
   trust boundary; a runtime hash check is not a way to inspect untrusted
   native libraries before an OS loader could execute them.
2. **Handle:** a successful admission gives a backend-private, immutable
   binding of artifact identity, descriptor and backend. Per-invocation
   data and any mutable execution state are separate. No raw native symbol
   calls or raw Wasm invocation are an alternate path for verified callers.
3. **Pre-call:** select native or the independently admitted Wasm reference
   before invocation. An in-process reference fallback is shadow-only and
   creates no authority. Validate the declared export, exact arity and lane
   limits for the admitted surface; keep typed ingress and output rules.
   Never silently coerce range errors, unknown discriminants or type errors
   into a successful result. Return no partial success after refusal.
4. **Invocation:** every pure call in legacy-v0.50 and typed-v0.53 starts
   from the artifact's initial state. Use a fresh instance; a reset is not
   an alternative unless proven equivalent and separately approved under
   D5, without changing the existing typed fresh-instance rule here.
   Compiled caches and derived native files hold code only, never live or
   retained invocation state. Legacy reuse is only a separately admitted
   D5-B experiment with its own evidence, outside this norm. Any proposed
   optimization needs parity across successful, failing, successive and
   concurrent calls. Even without AIR state cells, a typed module can
   write the failure-reason global. As P0_07_STATE.md section 4.2 shows
   for typed Wasm, a host that reuses an instance sees its cells persist.
5. **Close/cancel:** proposed semantics: close blocks new calls; cancel
   queued work and discard an obsolete completion at the application
   boundary. No claim that an in-process call was interrupted or contained.
   Do not let a closed or poisoned handle admit another call. An
   unrecognized fault, a host or translator fault, an in-flight completion
   that cannot be attributed to its originating call, or an admission
   identity mismatch on an admitted handle poisons that handle. A poisoned
   handle is never reused: recovery requires fresh admission of a new
   handle after the affected execution is proven terminated or its boundary
   is quarantined or replaced, consistent with the Swift RFC's
   `poisoned` and `quarantined` states. Default to
   serial invocation of a handle and reject re-entry; concurrent execution
   is a later tested option, not implied by a shared compiled cache.
6. **Completion:** match the applicable reference failure identity and
   decode results against the bound descriptor. On typed Wasm a trap is
   interpreted with the failure reason of the *same fresh instance*, as
   v0.53 specifies; no copying another invocation's reason, default success,
   or silently retrying an already started operation on another backend.
   Record expected trap/refusal outcomes separately from host or translator
   faults. D4 covers every in-process backend on the Swift host, including
   the Wasm reference and native code. Both remain shadow-only. An
   authoritative route requires the termination boundary and evidence from
   the Swift RFC, which this draft does not amend.
7. **Revoked/superseded (text only):** when host-trusted release policy
   marks an artifact revoked or superseded, reject new execution of it and
   native/cache entries derived from it. For a native-only denial, fallback
   is permitted before execution only to an independently admitted,
   non-revoked reference. This fallback creates no authority and remains
   shadow-only if in-process. A revoked source also disqualifies its Wasm;
   never fall back to it. This does not specify distribution or freshness of a
   revocation list, eviction implementation, async cancellation guarantees,
   or complete the lifecycle gate. D2 owns that mechanism and placement.

Host grant/freshness checks, effect result validation, persistence/reset
beyond fresh instances and per-call evidence remain DEFERRED. Refusing an
unsupported input does not synthesize a new public diagnostic code here.

## 5. Trust model

See THREAT_MODEL.md. Accept only bundled, publisher-controlled native
output from locked, verified Wasm and pinned build tools. The derived
identity binds source digest, transformer/runtime/compiler identities,
flags, target ABI, descriptor and output digest. Reproduce build outputs
for the same target under independently checked, pinned inputs. **Parity**
means the derived backend's results and failure identities match the exact
verified Wasm reference on the whole applicable v0.53 conformance and
negative corpus for the admitted surface, plus independent vectors specific
to the artifact, on every claimed target. A sample or a matching
hash does not establish parity. Matching hashes prove identity, not
translation correctness. No runtime Node, runtime compiler,
downloaded native code, or iOS JIT/signing workaround.

## 6. WorkBound

Keep the v0.53 WorkBound static model, canonical evidence and CT-1
`P0-10-EFF-1` unchanged. Do not reinterpret steps as native instructions,
gas, memory isolation, wall-clock deadlines or cancellation of host work.
Latency, memory and load cost are measured separately on the actual
adapter and device.

## 7. Future slices, gates and rollback

| Slice | Proposed bounded review surface | Evidence needed before it advances |
| --- | --- | --- |
| Contract (this step) | This contract, threat model, norms table and owner decision packet only. | Author-independent review and owner acceptance. |
| Device protocol and evidence | Device protocol, raw runs and report, no Core behavior changes. | Named device and artifacts, independent expected results, device/spend approval, measured full invocation. |
| Build identity tooling | Build tooling, tool/target pins and derived manifest, not the language or Host ABI. | Two independent builds under the same target and input pins; exact-byte or explicitly justified platform-specific disposition. |
| Pure adapter / independent conformance | C/Swift pure adapter and separate reviewer-controlled conformance assets. | Exact reference Wasm on Swift, reproducible derived artifact, parity as defined in section 5, refusal/containment and state checks, independent verification. |
| Android selection / release packaging | Android selection separately (D7); packaging, install and rollback at release. | Physical platforms actually claimed, clean install, update and verified rollback, independent exact-SHA release review, owner word. |

Future file allowlists must be enumerated and admitted per slice. This
proposal does not allow changes to existing Core, frozen fixtures, release
tags or test lanes. Compatibility: v0.53 legacy Wasm remains reference;
typed-v0.53 Wasm remains opt-in; native unsupported or absent means selected
verified Wasm before invocation or structured refusal. Fallback creates no
authority: an in-process reference stays shadow-only. No implicit
compatibility promise for another compiler, target, profile or profile ABI.

## Acceptance

NORMS_TABLE.md labels each requirement with exactly one state.
OPEN_DECISIONS.md separates D4/D5 from the other owner gates. Independent
review must cover misuse, cancellation/revocation, reuse, in-process faults
in either backend and any proposed source-authority conflict. No candidate build,
measurement, approval, contained native execution or runtime gate is
claimed here.
