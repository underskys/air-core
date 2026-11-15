# typed-v0.53 P0-08 — typed memory: regions, views, buffers and the borrowed lane (implementation note)

Card `AIR-0053-P0-08-0001`. Admitted spec: the P0-08 slice RFC text R2.1 (`AIR_V053_P0_08_SLICE_RFC_R2_1_2026_10_28/`, SHA256SUMS
`7b27fcad…`), owner admission record `6417643a…` (AD-1 to AD-8, clarifications M-1 to M-3), owner ledger `95e8027f…` (ABI-1 (A),
ABI-3 H2, ABI-6 (b), ABI-7) and the base record of OD-P7-6 (a). This note says where each rule lives in the code and records the choices
the slice text leaves to the implementer: the memory layout and lowering (P8-R8, P8-R15 to P8-R17, P8-R22, P8-R23), the typed
admission's API (R-ABI53-3, -3a, -8; ABI-7), the host-path table (P8-R24), the diagnostics registry (P8-R26) and the test-only
builder-defect seam. It adds no rule: where it differs from the slice text, the slice text wins.

## 1. Scope

Everything below applies to typed-v0.53 ASTs and typed-v0.53 borrowed-lane artifacts only. legacy-v0.50 and typed-v0.51 parse, verify,
format and lowering results, codes and artifact bytes are unchanged: the legacy memory lane, the borrowed-slice-v1 schema, digest
domain, marker and preflight, `invokeBorrowedMemory` and `instantiateAirModule` (since SEC53-02 `instantiateVerifiedAirModule`, with `instantiateRawWasm` on `@underskys/air-core/raw`) are unchanged. `src/host_abi.js`, `src/airpkg.js`,
`src/typed_interface.js`, `src/analysis_capacity.js`, `src/v051_reference.js` and `spec/` are not changed. The Host ABI capability
registry and lanes 0.10/0.11 are unchanged (`HOST_ABI_BUMP=false`); the execution-host interface is versioned by the host-adapter
contract `typed-v0.53.v1` (ABI-3 H2).

Flags: `EXPORTED_RAW_PTR=false`, `VIEW_ESCAPE_ADMITTED=false`, `OWNED_RANGE_EXPORTED=true` (metadata only; A1).

CT-1 is revision `P0-08-MEM-1` (`src/workbound_cost_table_v1.json`, 7,253 bytes, raw `sha256:4f9b6ea3…`, git blob `4a5c2055…`,
`cost_table_digest` `sha256:e12c77da…`, 28 rows), the R2.1 file byte for byte. Its new rows: `memory.alloc` = 1 + ceil(B/8)
(`steps_per_8_bytes`), and `memory.view`, `memory.access`, `memory.f32_canonical`, `ingress.borrowed_slice`, `ingress.borrowed_alias`
= 1 each (P8-R18). The loader admits the `steps_per_8_bytes` field; the `aggregate.access` text names `state.get` and `state.set`.

## 2. AST shapes

| Construct | Node |
| --- | --- |
| `ptr`, `slice`, `buffer<T,N>`, `borrowed_slice<…>` | a type text: `ptr` and `slice` as written; `buffer<T,N>` without whitespace (`T` is `i32` or `f32`, `N` in 1..65,536, else `air.v051.type_reference_invalid` at the type); `borrowed_slice<…>` checked by `parseBorrowedSliceType` and kept as written without whitespace (its `len=` form included) |
| `%x: T = <memory operation>` | a `local` whose `value` is `{kind: "memory_operation", op, args}`; `alloc_region %n max B` keeps `max` as its literal text; a literal view `%s: slice = "<text>"` has `op: "slice.literal"` and the decoded `text`; offset and index positions are normalized as i32 operands (`-0` is `0`) |
| `free_region %p`, `store.T %p, o, v`, `slice.store.T %s, o, v`, `buffer.store %b, i, v` | a statement `{kind: "memory", loc, value}`, admitted only with its operand count (else `air.v051.typed_syntax_invalid`); a store value is normalized against its element type once the function's locals are known |

A memory type nested in `option`, `result` or `array`, or a struct field of a memory type, parses and is refused by the verifier with
`air.memory.view_escape` at the line that states it (P8-R12). Each `alloc_region` statement is a site; the verifier records its maximum
in a `WeakMap` keyed by the statement, read by WorkBound and the lowering through `verifier.typedV053.memorySite`.

## 3. Where each rule lives

| Rule | Code |
| --- | --- |
| P8-R1, P8-R2, P8-R3 (types, statements, literal views) | `src/parser.js` (`v053MemoryType`, `v053MemoryValue`, `v053MemoryStatement`) |
| P8-R4 to P8-R12 (static checks, lifetime, escape), P8-R13 (frozen borrowed rules) | `src/verifier.js` (`verifyV053MemoryOperation`, `joinV053Regions`, `verifyV053NoLeak`, `verifyV053MemorySignature`, `verifyV053BorrowedAccess`) |
| P8-R18 to P8-R20 (CT-1 rows, `region_bytes`) | `src/workbound.js` (`typedMemoryNode`, `typedEntryParams`, `withRegionPeaks`) |
| P8-R8, P8-R15 to P8-R17, P8-R22, P8-R23 (layout, lowering, artifact) | `src/lower_wasm.js` (`v053MemoryLayout`, `emitV053MemoryOperation`, `emitV053BorrowedParameterPreflight`, `v053BorrowedLaneLines`) |
| P8-R13 (v2 descriptor and digest) | `src/borrowed_slices.js` (`typedV053.interfaceDescriptor`, `typedV053.interfaceDigest`) |
| P8-R22 (backing limit), P8-R15 (T1 record, v2 descriptor validation) | `src/v052_verified_build.js` |
| R-ABI53-3, -3a, -8 (typed admission) | `src/borrowed_memory_binding.js` (`typedV053.admitTypedV053Artifact`), public as `admitTypedV053Artifact` in `src/sdk.js` |
| R-ABI53-9 (realtime refusal) | `src/verified_execution_session.js` (`refuseTypedContractPackage`) |
| P8-R25 (formatter) | `src/format.js` |
| P8-R26 (hints) | `src/diagnostics.js` |

## 4. Layout and lowering

### 4.1 Layout and backing (P8-R8, P8-R22)

The earlier slices' storage (tables, states, aggregate frame slots, each at the next multiple of 8 from offset 0) ends at `P`. Each
literal view statement owns a copy of its bytes at the next multiple of 16, in source order (identical texts are not merged); the region
slots follow, `ceil16(max(site))` bytes each at the next multiple of 16, in function order and source order. `backing_bytes` =
`ceil16(P) + Σ ceil16(literal bytes) + Σ ceil16(max(site))`; region-slot bytes = `Σ ceil16(max(site))`. Both are reported on every
typed-v0.53 build as the non-enumerable `build.memory` (`{backingBytes, regionSlotBytes}`), so the build's keys and JSON are
unchanged. An artifact with a borrowed export shifts its whole backing by `BASE` = 16; its owned range is `[16, 16 + backing_bytes)`.

The build compares `backing_bytes` with the host's backing limit before lowering, after the engine-structural limits (so a module whose
memory exceeds them keeps `air.build.engine_limit`, P0-06): 67,108,864 bytes by default, lowerable by the host
through the build input `memoryBackingLimit` (an integer from 0 to 67,108,864; anything else is `air.v052.runtime_input_invalid`).
Above the limit the build fails with `air.build.memory_backing_limit`, disposition `BUILD_REFUSED`. The legacy 256 MiB ceiling is
unchanged.

### 4.2 Lanes

A region pointer is two i32 lanes (its slot address and its runtime size), a view two (address and length), a buffer one (address), a
borrowed view two (pointer and length). A memory parameter crosses a local call by its lanes; an exported borrowed parameter is the
frozen `(ptr, byte_len)` pair. A module without a memory statement and without a borrowed export keeps its earlier layout, pages and
WAT byte for byte.

### 4.3 Checks and transport (P8-R5, P8-R6, P8-R16, P8-R17, P8-R23)

Every region-domain check is signed, compares before it subtracts, and on failure calls `$__air_v053_region_bounds_runtime`, which sets
`__air_failure_reason` to 34 and traps. An `alloc_region` checks `0 ≤ s` and `s ≤ max(site)`, then zeroes `[base, base + s)` with one
`memory.fill` (value `i32.const 0`, length the runtime size), on every execution. `free_region` lowers to nothing; lifetime is static. An
access through a borrowed view keeps the frozen transport: `$__air_borrow_failure (param $code i32)` with the legacy codes, no reason
value set. Every f32 store (`store.f32`, `slice.store.f32`, `buffer.store` on `buffer<f32,N>`) stores
`select(value, f32.reinterpret_i32(0x7fc00000), value == value)`. An f32 literal operand is pushed with `f32.const`.

### 4.4 The borrowed-lane artifact (P8-R13 to P8-R15, ABI-1 (A))

A typed-v0.53 module with an exported `borrowed_slice` parameter lowers to an artifact whose first module field is
`(import "air:contract" "typed-v0.53.v1" (func (result i32)))`, with a start function that calls it once and traps unless the result is
1095324209 (it touches no memory, global or table); its memory `(memory (export "memory") N)` with `N = max(1, ceil((16 +
backing_bytes) / 65536))`, never imported and never grown by generated code; the immutable exported globals
`__air_abi_feature_typed_memory_v1` = 851969, `__air_owned_memory_base` = 16 and `__air_owned_memory_end` = 16 + `backing_bytes`
(metadata only); and no `__air_abi_feature_borrowed_slice_v1`. The verifier reserves the export name
`__air_abi_feature_typed_memory_v1` (`air.abi.borrowed_slice_interface_mismatch`), as the legacy lane reserves the v1 name. Every export
of a borrowed-lane module takes a `borrowed_slice` (OD-P8-6 (b), F-1): the artifact is invoked only through the typed admission, whose v2
descriptor lists borrowed exports only, so a plain export beside a borrowed one is refused before any artifact exists, as
`air.abi.borrowed_lane_plain_export` at the first plain export's line (P0-08-OD-P8-6-F1).

Each exported borrowed parameter's preflight runs in parameter order with the other ingress checks: the frozen length, alignment and
memory checks, then, when `16 < END`, the owned-range guard: trap iff `len ≠ 0 ∧ p < END ∧ p + len > 16` (compile-time constants;
`p + len` cannot wrap after the memory checks), setting `__air_failure_reason` to 64 before calling `$__air_borrow_failure`. Then the
frozen pairwise overlap check runs for every two borrowed parameters not both readonly. There are no `requires` contracts.

The verified build takes, for a borrowed-lane module, the v2 descriptor (`air.borrowed-slice-interface.v2`, `airAbi` `"0.13"`,
`feature` `"typed-memory-v1"`, the v1 fields, digest domain `"air.borrowed-slice-interface.v2\0"`), compares it with the one the source
implies (else `air.borrow.interface_invalid`) and records it with `descriptorDigest` = `sha256:` + its v2 digest. A typed-interface
descriptor of AIR ABI 0.12 for such a module is `air.abi.borrowed_slice_requires_0_11` at the first borrowed export, its message naming
lane 0.13 (AD-4, reading R-12). The T1 record (wasm digest, contract id, lane, owned range, descriptor) lives in the builder's private
state, next to the build object. `invokeVerifiedTypedExport` and the verified runtime refuse a borrowed-lane build with
`air.assurance.profile_unsupported` before instantiation: its exports are invoked only through the typed admission (§6).

## 5. Code registry additions at P0-08 (R-DIAG-2)

Codes that typed-v0.53 paths emit from P0-08 on, in addition to `docs/v0.53/SCALAR.md` §6 and the §5 tables of the P0-03 to P0-07
notes. EXISTING codes keep their meaning; each row gives its typed-v0.53 hint:

| Code | Status | Typed-v0.53 hint |
| --- | --- | --- |
| `air.memory.region_not_live` | new (PROPOSED; P8-R9) | Use a region, or a view or buffer made from it, only between its `alloc_region` and its `free_region` on every path; free it exactly once. |
| `air.memory.view_escape` | new (PROPOSED; P8-R12, AD-6) | Keep memory values in locals and parameters: no memory-typed result, field, element, payload, accumulator, branch destination or copy is admitted at P0-08. |
| `air.memory.free_not_owner` | new (PROPOSED; P8-R9) | Free a region only in the function that allocated it; a `ptr` parameter belongs to the caller. |
| `air.memory.readonly_data` | new (PROPOSED; P8-R3) | A literal view is read-only: copy its bytes into a region before writing, and pass it only to readonly uses. |
| `air.abi.borrowed_lane_plain_export` | new (PROPOSED; OD-P8-6 (b), F-1) | A module with a `borrowed_slice` export is invoked only through the typed admission: give every export a `borrowed_slice` parameter, or move the plain export to a module without borrowed exports. |
| `air.abi.slice_return_unsupported` | new (PROPOSED; P8-R12) | An export cannot return a slice: return a scalar, or write into a writeonly or readwrite `borrowed_slice` parameter. |
| `air.build.memory_backing_limit` | new (PROPOSED; P8-R22) | `BUILD_REFUSED`: the module's `backing_bytes` exceed this host's backing limit; reduce region maxima or literal views, or use a host with a larger limit. |
| `air.abi.contract_unsupported` | new (PROPOSED; R-ABI53-3) | The artifact's AIR contract import is not the one this host implements (`air:contract` `typed-v0.53.v1`, nothing else imported). |
| `air.abi.record_untrusted` | new (PROPOSED; R-ABI53-3a) | Admit the artifact with its verified build record from this process (T1) or a host-pinned digest of its bytes (T2). |
| `air.memory.region_bounds_static` | EXISTING (P8-R4, P8-R5) | Keep statically known sizes, offsets, lengths and indexes inside the region, view or buffer. |
| `air.memory.region_bounds_runtime` | EXISTING (registry value 34) | A runtime size, offset, length or index left its domain; the check ran before the operation. |
| `air.memory.region_size_unsupported` | EXISTING (P8-R7) | Keep every region maximum at most 16,777,216 bytes (REGION_MAX). |
| `air.memory.region_leak` | EXISTING (P8-R9) | Call `free_region` on every path before `return`. |
| `air.abi.borrowed_slice_requires_0_11` | EXISTING (AD-4; N14) | A typed-v0.53 module with a borrowed export needs AIR ABI 0.13 and the v2 borrowed descriptor. |
| `air.abi.borrowed_slice_interface_mismatch` | EXISTING (P8-R15) | The export name `__air_abi_feature_typed_memory_v1` is reserved for the feature marker. |
| `air.borrow.air_owned_memory_overlap` | EXISTING (registry value 64; ABI-6 (b)) | A borrowed range overlaps AIR-owned memory: bind host ranges outside `[16, 16 + backing_bytes)`. |
| `air.borrow.module_identity_mismatch` | EXISTING (R-ABI53-3 step 1) | The artifact bytes are not the bytes the trust root names; admit the exact verified artifact. |
| `air.borrow.air_memory_layout_unknown` | EXISTING (R-ABI53-3 step 3) | The instance's owned range is absent or differs from the trusted record; the instance is discarded. |

The frozen `air.borrow.*` codes of the borrowed surface keep their v0.50 meaning on the typed lane (P8-R13): `free_forbidden`,
`escape_return`, `mode_violation`, `alignment_invalid`, `length_invalid`, `reinterpret_forbidden`, `call_mismatch` (phase S),
`pointer_out_of_bounds` (the frozen transport, reason 0; V53-MEM-N39), `mutable_overlap`, `interface_invalid` and the binding codes.
The other EXISTING codes P0-08 reaches (`air.abi.export_type_unsupported`, `air.assurance.profile_unsupported`, `air.build.engine_limit`,
`air.workbound.unknown_bound`, `air.workbound.invalid_bound`, `air.v051.type_reference_invalid`, `air.v051.typed_syntax_invalid`,
`air.numeric.operation_invalid`, `air.state.cell_type_invalid`) keep the hints of the earlier notes.

## 6. The typed admission (R-ABI53-3, -3a, -8; ABI-7)

`admitTypedV053Artifact({ wasmBytes, record, pinnedDigest, interfaceDescriptor, trace })` (`src/sdk.js`, spread by `src/index.js`):

- **Step 1, at admission and again before every instantiation.** A private copy of `wasmBytes` is taken synchronously, before the first
  await. The trust root is T1, a build object returned by `buildVerifiedTypedModule` in this process, recognised by identity through
  the builder's private state, or T2, `pinnedDigest` (`sha256:…`), whose bytes are the authority. Anything else, a plain object shaped
  like a record included, is `air.abi.record_untrusted`. The copy's digest must equal the root's (`air.borrow.module_identity_mismatch`);
  the Module is compiled from that copy (cached by digest only); its contract id is read through `WebAssembly.Module.imports` and must
  be `air:contract` `typed-v0.53.v1`, the only import (`air.abi.contract_unsupported`; no imported memory, no retry).
- **Step 2.** The instance gets a contract function created for that instantiation, in a fresh import object; the handshake must call it
  once. No capability is bound at P0-08.
- **Step 3.** `__air_owned_memory_base`/`__air_owned_memory_end` must form a range equal to the T1 record's (with T2, to the supplied
  record's when one is supplied; else the range is the one read here), else `air.borrow.air_memory_layout_unknown`; the
  `__air_abi_feature_typed_memory_v1` global must read 851969 and the v1 marker must be absent, else `air.borrow.interface_invalid`. A
  failing instance is discarded, never returned.
- **Step 4.** `handle.instantiate()` resolves to an admitted instance (its `memory` is visible only now) for one invocation:
  `invoke({entrypoint, bindings, arguments})` binds with the trusted range (the T1 record's, or for T2 the step-3 range) and the v1
  binding semantics, and returns `{result, diagnostics, evidence}` as `invokeBorrowedMemory` does; `invokeRaw(entrypoint, lanes)` is a
  direct-export host's call (R-ABI53-7). `handle.invoke(request)` is `instantiate()` then `invoke(request)`.

A trap is classified as P8-R16 says: through `$__air_borrow_failure` with reason 64, `air.borrow.air_owned_memory_overlap`; with
reason 0, `air.borrow.pointer_out_of_bounds`; any other trap by the R-REF-9 registry. Steps 1 to 3 throw a `TypedAdmissionError` with
`code` and `step`. `trace` (an array) receives the event names `step1.private_copy`, `step1.trust`, `step1.digest`, `step1.compile`,
`step1.contract_id`, `step2.instantiate`, `step2.contract_call`, `step3.owned_range`, `step3.marker`, `step4.arm`, `step4.bind`,
`step4.invoke`. The contract function, its word and any factory are never exported.

**Builder-defect seam (test only, not shipped).** The shipped `src/v052_verified_build.js` has no seam: `readBorrowedLaneRecord` reads only the builder's own records. `test/support/harness_seam.js` loads a copy of `src/` with the seam added (a function that mints a harness record from `{ from, wasmBytes, ownedRange }`), and only V53-MEM-N23, N38 and V53-ABI-04, -42, -58 and -65 use that copy. A test checks that the copy differs from `src/` only by the seam.

## 7. Host paths (P8-R24)

| Claim | Verified runtime `invoke`, direct `invokeVerifiedTypedExport` | `instantiateRawWasm` (`@underskys/air-core/raw`), `inspectVerifiedTypedBuild().wasmBytes`, CLI output (one instance reused) |
| --- | --- | --- |
| region contents start from zeros | holds: zeroing at every allocation and a fresh instance per call (V53-MEM-N09 (i), N42) | holds: zeroing does not depend on freshness (V53-MEM-N09 (ii), N42) |
| the owned-range claim for borrowed exports | holds through the typed admission, refused from the record at step 4 (V53-ABI-30); the plain verified paths refuse a borrowed-lane build | holds on every host through the in-module guard (V53-ABI-24, -29, -43); the artifact does not instantiate without the contract import (V53-ABI-10 to -12, -20 to -23) |

## 8. Implementer readings

- **Read-only views at a call** (accepted reading, OD-P8-6 (b), F-2). A literal view, or a view derived from one, passed to a `slice`
  parameter of a local call is `air.memory.readonly_data` at the call, whether or not the callee stores: the callee could store through it.
  P0-08-OD-P8-6-F2 pins it (a callee that only reads `slice.len` is refused at the call; a region view to the same callee verifies).
- **f32 literal store operands.** An f32 literal value of a store lowers to `f32.const`; P0-08-CHECK-MEM part 2 admits it as the store's
  value operand.
- **V53-MEM-P09 (erratum, OD-P8-6 (b), F-4).** Its pinned text lists `run` before `raw`, so it is not in the formatter's function order
  (P8-R25); its formatted text verifies and gives the same results. It is the one P0-08 ACCEPT fixture that is not canonical (P8-R25 reads
  "every ACCEPT fixture except V53-MEM-P09"), recorded in V53-FMT-01@P0-08.

## 9. Deferred

V53-MEM-N06 and N34 (P0-10); V53-ABI-59 and -65 (P0-10; `air.host.call_before_admission`); V53-ABI-60 NOT_APPLICABLE (the optional
static decoder of step 1 is not adopted); F-STARTFX.
