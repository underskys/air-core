# Borrowed Slices v0.50 Implementation Map

Status: Serial implementation authorized

Activation authority: accepted v0.50 memory-boundary architecture decision,
2026-07-27. The source routing identifier is retained in local task evidence.

This map is normative for Tasks 04-09. It aligns the accepted RFC with the
human-forced serial queue and replaces the earlier split that treated syntax
and verification as separate tasks.

## Rules

- Tasks execute serially in numeric order.
- Each task activates from the exact pushed green terminal commit of the
  previous task.
- One branch and one clean isolated worktree are used per task.
- File ownership is exact. A required file outside the list returns
  `REQUEST_OWNERSHIP_REVISION`.
- Existing regression files named only as test inputs are run but not modified.
- No task may silently expand AIR ABI, Host ABI, parser, verifier, host, or
  evidence semantics beyond
  [Borrowed Slices v0.50](../rfcs/BORROWED_SLICES_v0_50.md).
- No merge, tag, release, public projection, or deployment is implied.

## Task 04: Borrowed-Slice Semantics

Goal: implement the accepted syntax, AST, canonical formatting, permissions,
invocation lifetime, and verifier semantics. Exported execution remains
unavailable until Task 05.

Exact owned files:

```text
spec/AIR_CORE.md
src/parser.js
src/types.js
src/format.js
src/verifier.js
src/diagnostics.js
src/borrowed_slices.js
test/borrowed_slices_semantics.test.js
examples/borrowed_slices/source_only/**
docs/v0.50/BORROWED_SLICES_LANGUAGE.md
```

No package or schema file is required for Task 04. Discovering such a
requirement is an ownership-revision stop.

Required behavior:

- parse and format `borrowed_slice<ACCESS,LENGTH,align=A>`;
- preserve every canonical AST field;
- enforce byte units, finite maximum, alignment, and access mode;
- enforce invocation-only lifetime and noescape;
- reject return, storage, free, growth, pointer laundering, unsupported
  extern forwarding, and unresolved memory domains;
- preserve legacy ordinary slices;
- reject target build with
  `air.abi.borrowed_slice_lowering_unavailable` until Task 05.

Forbidden:

```text
src/lower_wasm.js
src/wit.js
src/sdk.js
src/run_package.js
src/package_manifest.js
src/verification_evidence.js
src/evidence_report.js
src/target_bundle.js
hosts/**
package.json
```

Stop if semantics require erasing the borrowed type to plain `slice`, changing
AIR ABI 0.10, or entering lowering.

## Task 05: Wasm Lowering and AIR ABI 0.11

Goal: implement the explicit AIR ABI 0.11 `(ptr, byte_len)` lowering, generated
entry preflight, checked relationships, and deterministic interface metadata.

Exact owned files:

```text
src/lower_wasm.js
src/verifier.js
src/borrowed_slices.js
src/diagnostics.js
src/wit.js
src/target_bundle.js
src/package_manifest.js
src/version.js
test/borrowed_slices_lowering.test.js
examples/borrowed_slices/wasm/**
docs/v0.50/BORROWED_SLICES_WASM_ABI.md
```

`src/package_manifest.js` and `src/version.js` ownership is limited to the
explicit AIR ABI 0.11 feature marker and fail-closed package selection.

Required behavior:

- flatten each borrowed parameter in source order to `(ptr:i32, byte_len:i32)`;
- expose actual byte length to all borrowed bounds checks;
- check minimum, maximum, alignment, backing range, alias policy, and accepted
  scalar-to-length relationships before user instructions;
- use overflow-safe arithmetic;
- preserve AIR ABI 0.10 exports unchanged;
- reject old handles at 0.11 entries and 0.11 tuples at legacy entries;
- emit deterministic Wasm and interface metadata;
- fail through stable AIR behavior without a raw JavaScript exception;
- make no automatic-copy or zero-copy claim.

Forbidden:

```text
src/parser.js
src/types.js
src/format.js
src/sdk.js
src/run_package.js
src/index.js
src/verification_evidence.js
src/evidence_report.js
hosts/**
package.json
```

Stop if Host ABI changes, AIR ABI 0.10 must be reinterpreted, or a supported
raw invocation path bypasses preflight.

## Task 06: Host Memory Bindings

Goal: expose host-neutral JavaScript bindings for the two accepted transfer
modes: `copied_into_wasm` and `wasm_memory_view`.

Exact owned files:

```text
src/sdk.js
src/run_package.js
src/index.js
src/borrowed_memory_binding.js
src/verification_evidence.js
src/evidence_report.js
src/package_manifest.js
src/target_bundle.js
test/borrowed_memory_binding.test.js
test/run_package_facade.test.js
examples/borrowed_slices/sdk/**
docs/v0.50/BORROWED_MEMORY_SDK.md
```

`src/package_manifest.js` and `src/target_bundle.js` ownership is limited to
the accepted borrowed-memory descriptor and transfer/domain identity.

Required behavior:

- accept immutable validated descriptors for buffer, access, maximum length,
  alignment, alias group, and memory domain;
- disclose `copied_into_wasm` or `wasm_memory_view` for every invocation;
- validate real buffer extent, alignment, domain, overlap, and backing identity;
- copy according to readonly, writeonly, and readwrite policy;
- reject detached, truncated, mutated, or substituted descriptors;
- bind actual lengths, copy counts, domain, validation, output, and certificate
  into deterministic evidence;
- preserve legacy `air.run` behavior;
- never claim arbitrary native-memory zero-copy.

Forbidden:

```text
src/parser.js
src/types.js
src/format.js
src/lower_wasm.js
hosts/**
package.json
```

Stop if SDK-only checks would be the sole protection against direct Wasm calls.

## Task 07: Lifetime and Alias Hardening

Goal: adversarially harden the accepted borrowed slice as a synchronous,
invocation-scoped capability.

Exact owned files:

```text
src/borrowed_slices.js
src/borrowed_memory_binding.js
src/verifier.js
src/lower_wasm.js
src/diagnostics.js
src/verification_evidence.js
src/evidence_report.js
test/borrowed_slices_adversarial.test.js
test/borrowed_memory_binding.test.js
fuzz/borrowed_slices/**
docs/v0.50/BORROWED_SLICES_SECURITY.md
```

Required behavior:

- prove no return, storage, pool, host-handle, async, extern, or pointer escape;
- reject free, growth, permission violations, reinterpretation, misalignment,
  pointer/length overflow, stale epochs, and cross-instance reuse;
- reject every non-empty overlap involving a mutable borrow;
- allow readonly/readonly overlap and treat zero-length ranges as empty;
- freeze or snapshot validated descriptors against TOCTOU;
- fuzz base, length, maximum, width, alignment, alias ranges, and operation
  sequences with bounded deterministic seeds.

No mutable in-place exception exists in v0.50. Adding one requires a new
architecture decision.

Forbidden:

```text
src/parser.js
src/types.js
src/format.js
src/package_manifest.js
src/package_diff.js
src/semantic_patch.js
src/sdk.js
src/run_package.js
hosts/**
package.json
```

Stop if a borrowed value can survive invocation completion or any accepted
mutable overlap cannot be checked before execution.

## Task 08: Borrowed-Memory Certificate and Semantic Diff

Goal: bind static borrowed-memory bounds into the Verified Resource
Certificate, bind actual invocation facts into evidence, and classify borrowed
contract changes semantically.

Exact owned files:

```text
src/verification_evidence.js
src/evidence_report.js
src/verifier.js
src/semantic_patch.js
src/package_diff.js
src/package_manifest.js
src/target_bundle.js
test/borrowed_memory_certificate.test.js
test/verified_resource_certificate.test.js
test/semantic_patch.test.js
docs/v0.50/BORROWED_MEMORY_CERTIFICATE.md
```

`src/verifier.js` ownership is limited to borrowed-certificate derivation and
certificate-required validation.

Required behavior:

- certify parameter count, permissions, maxima, total borrowed bytes,
  alignment, alias policy, read/write budgets, dynamic checks, loop/fuel
  contribution, domains, and AIR ABI feature;
- record actual lengths, transfer modes, copy counts, domain identity,
  validation, and trap outcomes separately as invocation evidence;
- classify maximum increases, permission increases, alignment weakening,
  alias relaxation, borrowed-export additions, noescape removal, and required
  check removal as expansion or weakening;
- reject unknown comparison in strict mode;
- reject tampering and package/interface substitution.

Forbidden:

```text
src/parser.js
src/types.js
src/format.js
src/lower_wasm.js
src/sdk.js
src/run_package.js
hosts/**
package.json
```

Stop if exact interface identity cannot be bound without an undocumented
package-format change.

## Task 09: Realtime-Safe Profile and Reusable Session

Goal: implement a generic `realtime_safe` verified profile and a reusable,
prevalidated execution session. This profile contains no domain-specific
media vocabulary.

Exact owned files:

```text
src/package_manifest.js
src/verifier.js
src/sdk.js
src/run_package.js
src/verified_execution_session.js
src/verification_evidence.js
src/evidence_report.js
src/host_profiles.js
test/realtime_safe_profile.test.js
test/verified_execution_session.test.js
examples/realtime_safe/**
docs/v0.50/REALTIME_SAFE_PROFILE.md
```

Required behavior:

- reject host calls, effects, capabilities, logging, allocation, free, memory
  growth, dynamic resolution, recursion, and unbounded loops;
- require fixed resource/fuel bounds and borrowed input/output/state;
- validate package, certificate, instance, and fixed memory plan before reuse;
- warm up outside the invocation path;
- collect only bounded counters/errors during invocation;
- serialize evidence outside the invocation;
- reject stale, closed, substituted, or reconfigured sessions;
- fail closed on unknown profile fields;
- make no universal wall-clock deadline claim.

Forbidden:

```text
src/parser.js
src/types.js
src/format.js
src/lower_wasm.js
src/wit.js
src/package_diff.js
src/semantic_patch.js
hosts/**
package.json
```

Stop if the SDK path requires locks, callbacks, allocation, or evidence
serialization during a verified realtime invocation.

## Task 09 Handoff Gate

Before later generic conformance work begins, external QA must verify:

- every Task 04-09 tip is pushed and ancestrally serial;
- AIR ABI 0.10 and legacy package behavior are unchanged;
- AIR ABI 0.11 packages are descriptor- and evidence-bound;
- raw Wasm calls cannot bypass entry preflight;
- every borrowed access width uses the actual byte length;
- no borrowed value escapes;
- `copied_into_wasm` and `wasm_memory_view` disclosure is accurate;
- certificates and semantic patches cover borrowed authority and resources;
- the realtime profile makes no universal deadline claim;
- no Host ABI mutation occurred.

Only a separate human decision may authorize conformance work, merge, release,
or publication.
