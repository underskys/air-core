# ADR: Borrowed Slices v0.50

Status: Accepted

Date: 2026-07-27

Decision authority: accepted v0.50 memory-boundary architecture decision. The
source routing identifier is retained in the local task evidence rather than
the public language document.

## Context

AIR's current internal `slice` is a byte range derived from AIR-owned region
memory. It lowers to a pointer plus internal length metadata, but AIR ABI 0.10
exports only one scalar handle for a `slice` parameter. Verification therefore
cannot establish the actual host-provided length.

Task 01 correctly made exported plain slices fail closed before lowering.
Task 02 made raw region access respect logical region boundaries rather than
only Wasm linear-memory bounds. A safe exported buffer boundary now needs a
first-class source contract, an exact target mapping, and evidence.

## Decision

AIR v0.50 will implement a distinct `borrowed_slice` type with:

- byte-based lengths and offsets;
- a mandatory finite length maximum;
- mandatory alignment;
- `readonly`, `writeonly`, or `readwrite` access;
- invocation-scoped lifetime;
- noescape, non-owning, non-growable, and non-freeable semantics;
- fail-closed mutable overlap;
- deterministic checked-entry relationships;
- explicit memory domain and host transfer disclosure;
- AIR ABI 0.11 pointer/byte-length flattening for Wasm;
- package, evidence, and resource-certificate binding.

The canonical source form is:

```text
borrowed_slice<ACCESS,len<=MAX,align=A>
borrowed_slice<ACCESS,len=MIN..MAX,align=A>
```

All length fields are bytes. This follows existing `slice.sub`,
`slice.load.*`, `slice.store.*`, and refinement behavior.

## Consequences

### Positive

- Verification, package admission, lowering, and host invocation share one
  support contract.
- A host buffer carries actual length and permission metadata.
- Internal `slice` behavior and AIR ABI 0.10 remain unchanged.
- Wasm pointers are explicitly constrained to selected instance memory.
- Host `copied_into_wasm` versus `wasm_memory_view` behavior is visible rather
  than implied.
- Future native bindings can reuse the logical contract without exposing
  arbitrary pointers to Core.

### Costs

- AIR ABI 0.11 is required for borrowed exports.
- Hosts need checked adapters and deterministic entry preflight.
- Mutable in-place overlap is unavailable in the first implementation.
- Cross-value length relationships require runtime entry checks.
- Async, shared-memory, and cross-thread consumers must use a later design.

## Rejected Alternatives

### Reuse exported plain `slice`

Rejected because AIR ABI 0.10 lacks actual length and access metadata. Silent
reinterpretation would break compatibility and preserve the verify/lower
inconsistency.

### Treat lengths as elements

Rejected because current slice offsets and refinements are bytes. Element units
would depend on each operation and make bounds/evidence ambiguous.

### Typed operation-dependent units

Rejected for the same reason. Typed operations determine access width, not the
slice's unit.

### Use Wasm `list<u8>` canonical ABI immediately

Rejected because the current target is core Wasm and its WIT output is
interface metadata, not an accepted Component Model ABI. The raw v0.50 mapping
is an explicit pointer/byte-length pair.

### Permit mutable overlap with an annotation

Rejected because ordering, evidence, and deterministic in-place behavior are
not yet specified. v0.50 fails closed.

### Claim zero-copy

Rejected because Wasm pointers address linear memory, and hosts or engines may
copy outside AIR's observation. Transfer mode is disclosed instead.

### Use hidden mutable globals for persistent state

Rejected for conformance and realtime consumers. State must be an explicit
mutable borrowed parameter so size, permission, and evidence remain visible.

### Add arbitrary native pointers

Rejected because they cannot satisfy target-neutral lifetime and memory-domain
rules without a separately accepted native profile.

## Compatibility

- AIR ABI 0.10 is unchanged.
- exported plain `slice` remains unsupported.
- Host ABI is unchanged.
- existing internal slices and region operations are unchanged.
- borrowed packages opt into AIR ABI 0.11.
- disabling 0.11 admission is the rollback.

## Implementation Gate

Tasks 04-09 may proceed serially only within the ownership and stop conditions
in
[Borrowed Slices Implementation Map](../v0.50/BORROWED_SLICES_IMPLEMENTATION_MAP.md).

No unresolved architecture question remains for that bounded implementation.
