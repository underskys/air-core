# N54-01 R2 requirements-to-norms traceability

ORIGINAL = existing rule, not a claim that the new host implements it.
When a source cites approved scope in a private record (or records),
ORIGINAL denotes an approved v0.54.0 scope rule, not a shipped v0.53 rule
or implementation approval.
NEW_PROPOSAL = proposal in this contract or private planning records, not an approval.
DEFERRED = excluded by the approved cut; D2 owns timing unless noted.
UNKNOWN = evidence or owner decision not available. Repo citations below
are at public `f3b0ca098d4bc5c5ad926fefdd44e9f0d213ba4b`
where the source is public. Private citations are described, not linked.

| ID | State | Requirement / missing fact | Source |
| --- | --- | --- | --- |
| R1 | ORIGINAL | G54-PUBLIC only may fully close in v0.54.0; approved documents and tidy-up only, no new runtime. | Roadmap scope amendment; approved release-scope decisions (private records) |
| R2 | ORIGINAL | Swift reference executes the same verified Wasm; native has separate identity, and source digest plus parity are required. This is execution evidence, not authority. | Roadmap G53-SWIFT and G54-SWIFT; approved reference-backend scope (private record); RFC boundary in R12 |
| R3 | ORIGINAL | Legacy identity remains; typed-v0.53 is a separate opt-in candidate; no Host ABI bump. | VERSIONING.md, RFC_TYPED_V053.md section 2, P0_10_EFFECT_DEMAND.md flags |
| R4 | ORIGINAL | The admitted pure path refuses every actual Wasm import. A borrowed route is not pure; its contract import is part of another ABI. | Approved pure-path scope (private record); TYPED_MEMORY.md R-ABI53-1..4; lower_wasm.js v053ContractLane |
| R5 | ORIGINAL | Validate/verify and require applicable certificate before execution; trusted typed build digest and descriptor checks. | docs/EMBEDDING_FACADE.md Verification Order; src/v052_verified_build.js assertTrustedBuild |
| R6 | NEW_PROPOSAL | Bind native/Swift input size and SHA-256 before parsing or loading that exact input. Use signed app bundle loading policy, not an assumption about hashing preloaded native code. | Approved invocation scope and private planning/protocol records; CONTRACT section 4 |
| R7 | ORIGINAL | Checked typed export lookup, descriptor, exact arity, typed normalization and result-decode rules. Enforce applicable lane limit, not an unconditional promise for every route. | src/v052_verified_build.js normalizeArguments, invokeInstantiatedExport, invocationLaneCount and runtime limit definition |
| R8 | ORIGINAL | Typed trap identities use the same fresh Wasm instance and profile-specific registry; other/unknown failures are refused. | P0_03_REFINEMENTS.md sections 3-4; src/v052_verified_build.js invokeInstantiatedExport |
| R9 | ORIGINAL | Fresh typed invocation; compiled cache holds no state. No aggregate at export on the existing typed surface. | P0_07_STATE.md section 4.2; P0_06_AGGREGATES.md P6-R10 |
| R10 | ORIGINAL | WorkBound is static with unchanged CT-1, not native instruction accounting or time. | RFC_TYPED_V053.md section 6; P0_02_WORKBOUND_FOUNDATION.md; src/workbound_cost_table_v1.json |
| R11 | ORIGINAL | Shipped runtime does not depend on build-time Node or toolchain. | docs/BUILD_RUNTIME_BOUNDARY.md Runtime Must Not Require; G54-SWIFT wording |
| R12 | ORIGINAL | Every in-process Swift backend, including reference Wasm/fallback and native, stays shadow-only. Authority requires the RFC's termination boundary. | Existing v0.51 Swift containment RFC (private source): boundary, disposition, session and containment |
| R13 | NEW_PROPOSAL | Immutable verified handle; serial use; reject re-entry; close blocks future use; discard canceled completion, no claimed in-process interruption. Poison on an unrecognized, host or translator fault, unattributable in-flight completion or bound identity mismatch; never reuse; require fresh admission. | Invocation planning (private record); CONTRACT sections 4.5-4.6; RFC session states in R12 |
| R14 | NEW_PROPOSAL | Canonical Wasm plus distinct native build manifest; pinned translator/runtime/compiler, reproducible target-specific build, signed publisher bundle, and full parity as defined in CONTRACT section 5. | Derived build, trust and conformance planning (private records); CONTRACT sections 3, 5 and 7 |
| R15 | NEW_PROPOSAL | Backend chosen before invocation; fall back only to independently admitted non-revoked Wasm, with no rerun to mask a failed call. Fallback creates no authority. | Approved reference and revocation scope and fallback planning (private records); RFC boundary in R12 |
| R16 | ORIGINAL | Textual refusal of revoked/superseded source/native/cache identities; revoked source also disqualifies reference fallback. | Approved textual revocation scope (private record); implementation belongs to D2 |
| R17 | NEW_PROPOSAL | First experiment: one verified legacy i32-only, import-free consumer policy, on a physical iPhone, non-authoritative; not a shipped subset choice. | First-pilot planning (private record); OPEN_DECISIONS.md D6 |
| R18 | DEFERRED | Persistent state/sessions and reset beyond fresh-instance behavior. | Approved pure-state scope (private record); G54-STATE / D2; future reuse requires D5 |
| R19 | DEFERRED | Time, replay, effect mediation/grants/host-result validation, evidence and fencing (including grant freshness). | Approved exclusions (private record); G54-TIME/REPLAY/EFFECT/EVIDENCE/FENCE / D2 |
| R20 | DEFERRED | Lifecycle approval, activation, revocation distribution and invalidation mechanism, beyond candidate-to-verified and textual refusal. | Approved admission and textual revocation scope (private record); G54-LIFECYCLE / D2 |
| R21 | NEW_PROPOSAL | Run exact reference Wasm plus derived candidate with the same caller contract; reproduce build, compare results and failure identities on the full applicable v0.53 conformance and negative corpus plus independent artifact vectors per claimed target, and verify install and rollback. | Build, parity and rollback planning (private records); CONTRACT sections 5 and 7 |
| R22 | ORIGINAL | The approved pure-state rule applies to legacy as to typed: every pure call starts from initial state; no cache, derived file or reused instance carries state between calls. D5's proposed implementation choices remain open (R18, U2). | Approved pure-state scope (private record); P0_07_STATE.md section 4.2 demonstrates persistence on reuse for typed, not a legacy runtime guarantee |
| R23 | NEW_PROPOSAL | Machine types and platform layouts in the adapter do not become the AIR ABI. | CONTRACT section 3 (Native calling convention) |
| R24 | NEW_PROPOSAL | An internal execution handle must not be exposed as authority. | CONTRACT section 3 (Lifecycle and evidence) |
| R25 | NEW_PROPOSAL | Verified callers cannot use raw native symbols or raw Wasm calls as an alternate route. | CONTRACT section 4.2 |
| R26 | NEW_PROPOSAL | No downloaded native code, runtime compiler, or iOS JIT/signing workaround in the pure adapter. | CONTRACT section 5 |
| U1 | UNKNOWN | D4: authority boundary for either backend and third-party iOS killable-helper feasibility; no proven interruption or isolation in-process. | OPEN_DECISIONS.md; existing Swift RFC unchanged |
| U2 | UNKNOWN | D5: any allowed reuse predicate or reset equivalence, with failure-reason state included. | OPEN_DECISIONS.md and private device-protocol requirements |
| U3 | UNKNOWN | Fresh-instance full cost under wasm2c and typed-v0.53 on physical iPhone. | Private cost and device-protocol planning records |
| U4 | UNKNOWN | Per-operation trap capture cost and full-path p95/peak memory under the production-like calling convention. | Private performance planning; earlier legacy measurements do not answer it |
| U5 | UNKNOWN | D6 supported surface; pinned pilot artifact (Wasm digest/descriptor), host build and device, and approved latency target. | OPEN_DECISIONS.md; first-surface and parity planning (private record) |
| U6 | UNKNOWN | D7 Android backend, on-device timings and device-lab authorization. | Private device-protocol and Android planning records |
| U7 | UNKNOWN | Native adapter identity, target compiler/runtime flags and reproducibility across the approved builders. | Native calling convention and later build/adapter planning (private records) |
| U8 | UNKNOWN | D2 lifecycle mechanism timing relative to the release; required admission self-test cost/cadence and concurrency equivalence. | Revocation-timing and admission/call-semantics planning (private records) |
| U9 | UNKNOWN | Floating-point/NaN parity outside the proposed initial integer pilot. | Private device-protocol requirements; no new floating-point rule here |
| U10 | UNKNOWN | Author-independent reviewer and a frozen expected-result corpus for the first candidate. | Approved independent-review scope and pre-registration planning (private records) |
