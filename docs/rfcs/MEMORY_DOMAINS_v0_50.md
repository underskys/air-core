# Memory Domains v0.50

Status: Accepted for Borrowed Slices implementation

## Purpose

A borrowed slice names a bounded byte range, but a byte range is meaningful
only inside a concrete memory domain. This document defines the domain
identity, host transfer disclosure, and lifetime fences required by
[Borrowed Slices v0.50](BORROWED_SLICES_v0_50.md).

## Source and Runtime Separation

The AIR source type is backend-neutral:

```air
borrowed_slice<readonly,len<=4096,align=4>
```

It does not contain a native pointer, host object, Wasm instance, or transfer
mode. Those facts belong to the selected invocation profile and evidence.

Every executable target profile MUST define:

- domain identifier;
- address interpretation;
- maximum address and length representation;
- backing-store identity;
- lifetime fence;
- alignment behavior;
- `copied_into_wasm`/`wasm_memory_view` behavior;
- concurrent and reentrant invocation policy;
- evidence fields;
- unsupported host memory forms.

## Accepted v0.50 Domain

The only executable domain accepted by this RFC is:

```text
wasm-linear
```

Its canonical descriptor contains:

```json
{
  "domain": "wasm-linear",
  "addressUnit": "bytes",
  "addressWidth": 32,
  "backing": "selected-instance-memory",
  "lifetime": "invocation",
  "growthDuringBorrow": "forbidden",
  "reentrancy": "forbidden-for-mutable-borrows"
}
```

The pointer is an unsigned byte offset into the selected
`WebAssembly.Memory`. It is not an address into a Swift, Java, C, JavaScript,
or operating-system heap.

## Transfer Modes

Every host adapter MUST disclose one of:

### `copied_into_wasm`

The adapter reserves a checked range in instance memory and copies readable
input bytes into it. After successful or policy-permitted execution, it copies
mutable output bytes back to the caller.

Copy direction is determined only by the declared access mode:

| Access | Copy in | Copy out |
| --- | --- | --- |
| `readonly` | required | forbidden |
| `writeonly` | forbidden | required |
| `readwrite` | required | required |

The adapter MUST NOT read caller bytes merely to initialize a `writeonly`
range. A failed invocation copies output back only when the accepted host
profile explicitly permits failed-result output collection.

Evidence records:

- input copy byte count;
- output copy byte count;
- source and destination content digests where permitted;
- allocation range identity local to the invocation;
- cleanup outcome.

### `wasm_memory_view`

The caller supplies a view already backed by the selected instance memory.
The adapter validates backing identity, byte offset, byte length, alignment,
access mode, and invocation exclusivity.

Evidence records:

- backing memory identity digest;
- view byte offset and length in private target evidence;
- content digests where permitted;
- the fact that no adapter-level copy was performed.

`wasm_memory_view` is not a universal zero-copy claim. A caller may have copied
data before creating the view, and an engine or platform may perform
implementation copies outside AIR's observation.

Missing or unknown transfer mode is a fail-closed invocation error.

## Range Validation

For each non-negative actual byte length:

```text
ptr <= memory_size
byte_length <= memory_size - ptr
```

This subtraction form prevents `ptr + byte_length` overflow. Both values are
validated before any content hashing or AIR execution.

The declared alignment is checked independently:

```text
ptr % alignment == 0
```

Zero-length ranges may point exactly at `memory_size`, remain subject to
alignment, and cannot be accessed.

## Backing Identity and Growth

The adapter captures the exact `WebAssembly.Memory` and its backing buffer
before establishing the borrow.

While any borrow is active:

- the AIR entrypoint cannot request memory growth;
- the adapter cannot replace the instance memory;
- the host cannot reenter the same instance with a conflicting borrow;
- a changed backing buffer causes fail-closed termination;
- no async continuation may retain a view.

An engine-level memory-growth event may detach or replace a JavaScript view.
The adapter MUST compare backing identity before output collection and fail
with `air.borrow.memory_changed` if the identity changed.

## Concurrency

The v0.50 Wasm profile permits one mutable borrowed invocation per instance at
a time.

Parallel readonly invocations require distinct instances. This avoids relying
on engine-specific shared-memory behavior and keeps evidence ordering
deterministic.

Shared Wasm memory, threads, atomics, and cross-thread borrows are unsupported.

## Domain and Aliasing

Overlap is evaluated only among ranges in the same backing memory.

- readonly/readonly overlap is permitted;
- any overlap involving a mutable range is rejected;
- zero-length ranges do not overlap;
- range comparison occurs only after overflow-safe end validation.

Ranges from different instances cannot be passed to one invocation.

## Future Native Profile

`native-process` is reserved as a possible future profile identifier. It is
not accepted by v0.50.

A native profile would need a separate architecture decision defining:

- safe platform representation;
- pinning and lifetime ownership;
- process and allocator identity;
- page and alignment constraints;
- signal/fault behavior;
- `copied_into_wasm` and `wasm_memory_view` disclosure;
- thread confinement;
- FFI and callback restrictions;
- evidence confidentiality;
- conformance with the logical borrowed-slice contract.

AIR source would still receive a bounded borrowed slice, never an arbitrary
native pointer.

## Unsupported Domains

The following are fail-closed in v0.50:

- arbitrary process address;
- Swift object or buffer address;
- Java heap or direct-buffer address;
- C/C++ heap pointer;
- GPU device memory;
- operating-system shared memory;
- memory-mapped file;
- shared Wasm memory;
- retained host handle;
- cross-thread or asynchronous view.

Future profiles must use new identifiers. They cannot reinterpret
`wasm-linear`.

## Evidence

Portable evidence binds:

- domain identifier;
- transfer mode;
- instance/package/interface digest;
- actual byte length;
- declared range and alignment;
- preflight outcome;
- input/output content digests where policy permits;
- copy byte counts;
- backing-stability outcome.

Portable evidence SHOULD omit raw pointers. A target-private diagnostic log MAY
include offsets but MUST label them non-portable.

Host-origin claims remain declared facts. AIR can verify that a range is in
the selected instance memory; it cannot prove where a malicious host obtained
the bytes.

## Rollback

Disabling AIR ABI 0.11 borrowed-slice admission disables this domain without
changing AIR ABI 0.10, internal slices, or region memory. Packages requiring
borrowed slices then fail at package admission with a stable ABI diagnostic.
