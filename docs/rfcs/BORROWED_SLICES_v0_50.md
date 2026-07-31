# Borrowed Slices v0.50

Status: Accepted for serial implementation

Decision authority: accepted v0.50 memory-boundary architecture decision,
2026-07-27. The source routing identifier is retained in the local task
evidence rather than the public language document.

## Summary

AIR v0.50 adds an explicitly bounded borrowed-slice type for synchronous
exported calls. A borrowed slice is host-owned, non-owning,
invocation-scoped, explicitly permissioned, and backed by a declared memory
domain. AIR cannot grow, free, return, store, retain, or transfer the borrow.

This RFC defines source and AST forms, verifier rules, the Wasm calling
convention, entry checks, evidence, and migration. It does not implement them.

The existing `slice` type remains an AIR-owned/internal value. Its current
byte-based semantics are not changed.

## Normative Terms

The words MUST, MUST NOT, SHOULD, and MAY are normative.

`borrowed_slice` means the type specified here. `slice` means the existing
internal slice type.

## Goals

- Permit bounded host buffers to enter synchronous exported AIR functions.
- Preserve fail-closed verification and deterministic diagnostics.
- Make access permission, actual length, domain, and transfer mode explicit.
- Keep AIR ABI 0.10 behavior unchanged.
- Provide a target-neutral source model with an exact Wasm ABI 0.11 mapping.
- Bind invocation evidence to the exact borrow contract and observed metadata.

## Non-Goals

- Codecs.
- Media streams.
- Video frames as a Core type.
- Arbitrary native pointers.
- Retained host handles.
- Garbage collection.
- Asynchronous borrow.
- Cross-thread borrow.
- Shared mutable concurrency.
- Universal zero-copy.
- Realtime deadline proof.

## Existing Semantics

Repository evidence establishes these current rules:

- `slice.from_region` creates a pointer and hidden length.
- `slice.sub` uses byte offsets and byte lengths.
- `slice.load.*` and `slice.store.*` use byte offsets; the scalar operation
  determines access width.
- `slice<len<=N>`, `slice<len=MIN..MAX>`, and `slice<nonempty>` constrain byte
  length.
- an exported plain `slice` is rejected by
  `air.abi.slice_parameter_unsupported` because AIR ABI 0.10 has no length
  metadata.

Borrowed slices extend this byte model. They do not reinterpret existing
operations in elements or target-dependent units.

## Source Syntax

The canonical parameter type is:

```text
borrowed_slice<ACCESS,LENGTH,align=ALIGNMENT>
```

`ACCESS` is exactly one of:

- `readonly`
- `writeonly`
- `readwrite`

`LENGTH` is exactly one of:

```text
len<=MAX
len=MIN..MAX
```

All lengths are bytes. `MAX` MUST be finite and no greater than
`2147483647`. `MIN` defaults to zero in the `len<=MAX` form. `MIN` and `MAX`
are inclusive, and `0 <= MIN <= MAX`.

`ALIGNMENT` is mandatory. v0.50 accepts the powers of two `1`, `2`, `4`, `8`,
and `16`.

Examples:

```air
export func inspect(
  src: borrowed_slice<readonly,len<=1536,align=4>
) -> i32
```

```air
export func transform(
  src: borrowed_slice<readonly,len<=1536,align=4>,
  dst: borrowed_slice<writeonly,len<=512,align=4>,
  state: borrowed_slice<readwrite,len=64..64,align=4>,
  frames: i32
) -> i32
```

The formatter MUST emit the compact ordering shown above. Aliases MAY be
accepted by a future revision, but the v0.50 AST and formatter contain only
the canonical forms.

A bare or unbounded `borrowed_slice` is invalid.

## Canonical AST

The parser MUST preserve borrowed-slice semantics rather than erasing the type
to `slice`.

```json
{
  "type": "borrowed_slice",
  "declaredType": "borrowed_slice<readonly,len<=1536,align=4>",
  "borrow": {
    "access": "readonly",
    "length": {
      "unit": "bytes",
      "min": 0,
      "max": 1536
    },
    "alignment": 4,
    "lifetime": "invocation",
    "noescape": true,
    "growable": false,
    "freeable": false,
    "returnable": false,
    "storable": false
  }
}
```

The AST fields above are semantic. They MUST participate in canonical
formatting, package identity, semantic diffs, evidence identity, and target
interface identity.

## Length and Refinements

The actual invocation length is a byte count.

- `len<=N` admits actual lengths from zero through `N`.
- `len=MIN..MAX` admits actual lengths from `MIN` through `MAX`.
- a zero actual length is valid only when `MIN` is zero.
- the finite maximum is required for package verification and resource
  certification.

Typed loads and stores continue to use byte offsets. Their scalar type
determines access width. For example, `slice.load.i32` at byte offset `4`
accesses bytes `[4, 8)`.

A sub-slice preserves memory domain, invocation lifetime, and access mode. Its
declared maximum MUST not exceed the parent maximum. The verifier MUST prove
or entry/runtime-check:

```text
0 <= offset
0 <= requested_length
offset + requested_length <= actual_parent_length
```

The arithmetic MUST be overflow-safe. A sub-slice retaining alignment `A`
requires `offset % A == 0`. v0.50 does not implicitly weaken alignment.

## Access Modes

| Mode | Read | Write |
| --- | --- | --- |
| `readonly` | allowed | forbidden |
| `writeonly` | forbidden | allowed |
| `readwrite` | allowed | allowed |

The verifier applies these rules to all current and future slice operations.
Mode conversion is fail-closed:

- a helper may receive the exact same borrowed type;
- a sub-slice may narrow length while preserving mode;
- permission elevation is forbidden;
- implicit conversion to plain `slice` or `ptr` is forbidden.

Host-side output hashing or copying does not grant AIR read access to a
`writeonly` borrow.

## Lifetime and Noescape

The borrow begins after all invocation preflight checks succeed and ends when
the synchronous exported call returns or traps.

During that interval a borrowed slice MUST NOT:

- be returned;
- be stored in a global, pool, table, retained state, package object, or
  longer-lived aggregate;
- be converted to an unrestricted pointer or plain slice;
- be passed to an extern that lacks the same accepted borrow contract;
- be freed with `free_region` or any future ownership operation;
- survive an asynchronous boundary;
- cross a thread boundary;
- be retained by a reentrant invocation.

AIR functions MAY pass a borrow synchronously to local helpers when the helper
signature has an equal or narrower accepted borrowed type and no escape path.

The host adapter MUST reject concurrent or reentrant use of the same mutable
invocation memory. The adapter MUST also fail if the backing Wasm memory
identity changes while a borrow is active.

## Persistent State

Persistent algorithmic state for realtime or conformance consumers MUST be an
explicit `readwrite` borrowed-slice parameter. It MUST NOT be hidden in
reachable mutable globals.

The Core type does not add a special "state" keyword. A conformance or package
descriptor MAY designate a particular explicit parameter as persistent state
for evidence and replay. That designation does not weaken lifetime, access,
aliasing, or bounds rules.

## Memory Domains

The source type is backend-neutral. Every accepted invocation binds each
borrow to a concrete memory domain.

v0.50 implements one executable domain:

```text
wasm-linear
```

For Wasm, `ptr` addresses the selected instance's
`WebAssembly.Memory`. It never addresses an arbitrary Swift, Java, C, or other
host heap.

The host may use either transfer mode:

- `copied_into_wasm`: bytes are copied into instance memory before the call
  and, for mutable output, copied out after it;
- `wasm_memory_view`: the supplied view is already backed by the selected
  instance memory.

The actual transfer mode MUST be disclosed in invocation evidence. The term
`wasm_memory_view` describes backing identity only. It is not a universal
zero-copy claim and does not describe copies that may have happened before the
adapter received the view.

See [Memory Domains v0.50](MEMORY_DOMAINS_v0_50.md).

## Alignment

The actual pointer MUST satisfy:

```text
ptr % declared_alignment == 0
```

An operation requiring natural alignment greater than the declared alignment
is rejected in v0.50, even if a target could execute an unaligned access. This
keeps the source contract portable to future native bindings.

Alignment is checked before execution and is included in the interface
descriptor and invocation evidence.

## Zero-Length Behavior

When the declared minimum is zero:

- actual length zero is allowed;
- the pointer MUST remain aligned;
- the unsigned pointer MAY equal the current linear-memory byte length;
- no load, store, or non-empty sub-slice is valid;
- the range is treated as empty for overlap checks.

No special null-pointer value is required. `ptr == 0` has no ownership or
absence meaning.

## Aliasing and Overlap

The host adapter compares actual half-open byte ranges after validating both
ends:

```text
[ptr, ptr + byte_length)
```

Two non-empty ranges overlap when:

```text
a.ptr < b.end && b.ptr < a.end
```

The v0.50 default is:

- `readonly` with `readonly`: overlap allowed;
- any pair where either side is `writeonly` or `readwrite`: overlap rejected;
- zero-length ranges: no overlap.

No explicit mutable-overlap or in-place mode is accepted in v0.50. A future
mode requires a separate architecture decision, evidence model, and
determinism analysis.

## Wasm Calling Convention

Borrowed slices require AIR ABI 0.11. AIR ABI 0.10 is unchanged.

Each borrowed-slice parameter flattens in source order to:

```text
(ptr: i32, byte_len: i32)
```

The pointer is interpreted as an unsigned Wasm32 byte offset. The length MUST
be a non-negative signed i32 and MUST not exceed the declared maximum.

Before user instructions run, the generated entry preflight MUST check:

1. ABI and interface descriptor identity.
2. parameter count and pair ordering.
3. non-negative actual length.
4. declared minimum and maximum.
5. pointer alignment.
6. overflow-safe `ptr + byte_len <= memory_size`.
7. pairwise aliasing policy.
8. scalar and cross-value entry contracts.
9. active invocation, memory identity, and domain.

The bounds check MUST use arithmetic that cannot wrap. An acceptable
subtraction form is:

```text
ptr <= memory_size
byte_len <= memory_size - ptr
```

Failure occurs through a stable AIR diagnostic/trap path before the exported
function body.

The generated interface metadata represents the pair as:

```wit
record borrowed-slice-v1 {
  ptr: u32,
  byte-len: u32,
}
```

The package's canonical interface descriptor additionally records access,
length range, alignment, lifetime, domain requirements, and parameter order.
The current WIT output is metadata; this RFC does not claim a Component Model
canonical ABI.

## Native Binding Compatibility

A future native binding consumes the same logical descriptor: access mode,
byte range, alignment, invocation lifetime, and transfer disclosure.

The native adapter may internally use a platform pointer and length, but:

- arbitrary native pointers are not AIR source values;
- target-specific representation is outside Core;
- the adapter owns validation and lifetime fencing;
- a native profile requires its own accepted ABI mapping and tests;
- AIR evidence records the accepted domain, not a portable pointer value.

No native execution profile is authorized by this RFC.

## Entry Relationships

Current refinement contracts cannot prove cross-value multiplication such as
an actual slice length against another parameter. v0.50 therefore defines
deterministic checked-entry contracts.

An exported function can state the required relationships as:

```air
requires checked param frames >= 0
requires checked param frames <= 256
requires checked bytes src >= param frames * 6
requires checked bytes dst >= param frames * 2
```

The variable name `frames` is an ordinary scalar identifier and gives Core no
domain-specific semantics.

The canonical AST forms are:

```json
{
  "kind": "checked_param",
  "parameter": "frames",
  "op": ">=",
  "literal": 0
}
```

```json
{
  "kind": "checked_borrow_length",
  "borrow": "src",
  "unit": "bytes",
  "op": ">=",
  "parameter": "frames",
  "multiplier": 6
}
```

v0.50 limits the right side to one non-negative i32 parameter multiplied by a
positive integer literal. The generated entry check MUST reject negative
inputs and multiplication overflow before comparison. For multiplier `K`,
the check includes:

```text
parameter <= floor(2147483647 / K)
```

Static refinement facts MAY prove internal uses after entry. They are not a
substitute for validating untrusted external arguments. A borrowed export that
uses a scalar in a length relationship MUST have an accepted checked-entry
contract for that scalar.

Each result is recorded as `runtime_enforced` evidence with the canonical
expression digest, involved parameter identities, actual scalar/length
metadata, and outcome. Raw borrowed bytes and pointer values are not required
in public evidence.

## Diagnostics

The implementation uses stable diagnostics:

| Code | Meaning |
| --- | --- |
| `air.borrow.syntax_invalid` | malformed borrowed-slice syntax |
| `air.borrow.mode_invalid` | unsupported access mode |
| `air.borrow.length_invalid` | invalid or impossible length range |
| `air.borrow.alignment_invalid` | invalid alignment declaration |
| `air.borrow.unbounded` | finite maximum missing |
| `air.borrow.mode_violation` | operation violates access mode |
| `air.borrow.escape_return` | borrowed value returned |
| `air.borrow.escape_storage` | borrowed value retained or stored |
| `air.borrow.free_forbidden` | ownership/free operation attempted |
| `air.borrow.call_mismatch` | helper/extern borrow contract mismatch |
| `air.borrow.async_forbidden` | asynchronous or cross-thread escape |
| `air.borrow.domain_unsupported` | invocation domain not accepted |
| `air.borrow.transfer_mode_missing` | transfer disclosure absent |
| `air.borrow.length_out_of_range` | actual length violates refinement |
| `air.borrow.pointer_out_of_bounds` | pair exceeds backing memory |
| `air.borrow.alignment_mismatch` | actual pointer is misaligned |
| `air.borrow.mutable_overlap` | forbidden mutable overlap |
| `air.borrow.entry_relation_failed` | checked entry relation false |
| `air.borrow.entry_arithmetic_overflow` | checked relation would overflow |
| `air.borrow.reentrant_invocation` | conflicting invocation active |
| `air.borrow.memory_changed` | backing memory identity changed |
| `air.borrow.evidence_incomplete` | required evidence metadata absent |
| `air.abi.borrowed_slice_requires_0_11` | package selected an older ABI |

Diagnostics MUST include phase, file, line, function, and parameter where
available. Equivalent repeated failures MUST format byte-identically.

## Evidence Model

Package evidence binds:

- AIR ABI and compiler/verifier identity;
- module and package digest;
- canonical interface descriptor and digest;
- parameter order, access, byte range, and alignment;
- accepted memory domains and transfer-mode requirement;
- checked-entry contract set and digest;
- noescape and overlap policy.

Invocation evidence binds:

- package and interface digest;
- invocation identity;
- actual byte lengths;
- memory domain;
- transfer mode for each borrow;
- grants and limits already used by the embedding facade;
- entry-check outcomes;
- overlap-check outcome;
- input content digests for readable inputs;
- output content digests for mutable outputs;
- result, diagnostics, and failure phase.

Pointer values SHOULD be omitted from portable evidence. When retained in
private debugging evidence, they MUST be marked target-local and MUST NOT
participate in cross-run semantic claims.

Evidence MUST distinguish host declarations from verifier facts and runtime
checks. A host's claim about where bytes originated is declared, not verified
by Core.

## Resource Certificate Model

The Verified Resource Certificate reports:

- each borrowed parameter's finite declared maximum byte length as verified
  interface metadata;
- the sum of non-aliased mutable maxima as a conservative maximum concurrently
  exposed borrowed range;
- actual invocation lengths as runtime-enforced evidence, not static facts;
- adapter copy-in and copy-out byte limits as declared host-transfer bounds;
- AIR-owned allocation separately from host-owned borrowed bytes;
- native allocator behavior and external copies as `unsupported` or `unknown`
  until a target profile proves them.

Certificate-required mode fails closed when the package requests a borrowed
bound that is absent, unbounded, inconsistent with the interface digest, or
unsupported by the selected target profile.

The certificate does not claim host enforcement after the invocation or prove
realtime deadlines.

## Security Properties

For accepted v0.50 Wasm invocations, the implementation is intended to ensure:

- all borrowed accesses stay within the actual byte range;
- declared access permissions are verifier-enforced;
- integer arithmetic used by preflight cannot wrap;
- mutable ranges do not overlap;
- the borrow cannot escape the synchronous invocation;
- the pointer/length pair stays within the selected instance memory;
- evidence binds the accepted contract and observed invocation metadata.

These properties do not make a malicious host truthful, remove side channels,
or turn Wasm pointers into arbitrary safe native references.

See [Borrowed Slices Threat Model](../v0.50/BORROWED_SLICES_THREAT_MODEL.md).

## ABI Versioning and Migration

- AIR ABI 0.10 remains unchanged.
- exported plain `slice` remains rejected.
- borrowed slices require explicit AIR ABI 0.11.
- Host ABI is unchanged because no host import is added.
- old packages run under their existing ABI without rewriting.
- a package MUST NOT be silently upgraded from exported `slice` to
  `borrowed_slice`.
- package, evidence, semantic patch, and target interface digests include the
  full borrowed descriptor.
- rollback is removal of AIR ABI 0.11 package admission; AIR ABI 0.10 remains a
  stable fallback.

## Backward Compatibility

Internal `slice`, region allocation, region bounds checks, and current
slice operations preserve their behavior. Unlabelled or unborrowed modules do
not acquire implicit host memory.

The stable `air.abi.slice_parameter_unsupported` diagnostic remains correct
for exported plain slices. Borrowed-slice diagnostics use the new family.

## Acceptance Criteria

Implementation is complete only when:

- parser and formatter round-trip canonical syntax;
- AST identity preserves all borrow fields;
- verifier enforces permissions, finite bounds, lifetime, and noescape;
- entry checks enforce actual bounds, alignment, aliasing, and relationships;
- Wasm ABI 0.11 emits deterministic pointer/byte-length pairs;
- AIR ABI 0.10 and Host ABI remain compatible;
- evidence and resource certificates bind the exact descriptor;
- `copied_into_wasm` and `wasm_memory_view` modes are disclosed;
- hostile tests cover overflow, overlap, escape, wrong modes, stale memory,
  substitution, and direct Wasm invocation;
- native/headless/browser conformance fixtures agree where applicable;
- no implementation claims universal zero-copy or realtime proof.

The exact serial implementation ownership is defined in
[Borrowed Slices Implementation Map](../v0.50/BORROWED_SLICES_IMPLEMENTATION_MAP.md).
