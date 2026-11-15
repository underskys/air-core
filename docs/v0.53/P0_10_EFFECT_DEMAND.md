# typed-v0.53 P0-10: typed host imports and effect-demand declarations

Card AIR-0053-P0-10-0001; admitted slice text R2.3 (`AIR_V053_P0_10_SLICE_RFC_R2_3_2026_10_29/`, SHA256SUMS `570084ad…`) with the
admission record (`AIR_V053_P0_10_ADMISSION_RECORD_2026_10_30/`, `dd74fb6d…`: AD-P10-1 … AD-P10-13, each (a); the CLARIFICATION) and the
P0-10 ledger (`03d949fa…`: OD-P10-1 (d), -2 (a), -3 (a), -4 (a), -5 (a), -6 (b), -7 (a), -8 (a), -9 (a)). This note records what the
implementation does and where; the slice text is the specification.

Flags: NEW_HOST_IMPORT=false DEMAND_IS_GRANT=false DEFAULT_IMPORTS=false REENTRANCY_GUARD=true HOST_ABI_BUMP_AUTHORIZED=false
RUNTIME_LINKING=false PF1_DEFERRED_OPEN=0. X-SND-03 is first executed by P0-10's tests (V53-IMP-P01, V53-WB-H03, V53-EFF-P06) and is not
claimed closed before independent QA.

## 1. Where it lives

| Rule | File | What |
| --- | --- | --- |
| P10-R1, P10-R4 | `src/parser.js` | `extern <family>.<name>(<p>: <T>, …) -> <R>` and `demand { <key> <= <n>, … }`, in any order after the header; the `externs` list and `demand` exist only once declared |
| P10-R2, R3, R5, R6, R7 | `src/verifier.js` | registry admission (the Host ABI registry less its six async and io entries), the alias rule, capabilities, demand key validity, extern calls and their arguments, demand completeness and bound |
| P10-R8, R9 | `src/workbound.js` + `src/workbound_cost_table_v1.json` | an extern call is `extern.call` (steps 1, effects[k] 1) plus one `extern.f32_canonical` per `f32` argument; CT-1 revision P0-10-EFF-1 |
| P10-R10 | `src/format.js` | `capabilities`, `work`, `demand` on consecutive lines, demand keys sorted; then one blank line and the `extern` lines sorted by name |
| P10-R11 | `src/lower_wasm.js` | every declared extern is one Wasm import (module = the family, field = the rest), after the contract import, sorted; an artifact with any capability import has P0-08's contract shape; `f32` arguments canonicalized and `(ptr, cap)` capacities checked before the call |
| P10-R12 … R16 | `src/borrowed_memory_binding.js` (the five typed-admission functions and private helpers serving them, AD-P10-2 (a)); `src/v052_verified_build.js` (`typedV053.hostResult`, `hostWindowIn`, `hostWindowOut`) | step 1's import set and the handler map; disarmed and armed wrappers; result validation; promise handling; the in-call guard; memory windows |
| P10-R17, R21, R28 | `src/v052_verified_build.js`, `src/typed_interface.js` | the verified runtime refuses a contract artifact; the T1 record lists the capability imports; the manifest lane for a Host ABI 0.11 import; the runtime's closure intake keyed by a module-key `sourceName` |
| P10-R26 | `src/diagnostics.js` | a typed-v0.53 hint for each code below |
| P10-R27 | `src/parser.js:1588` | a dotted `use` is classified by its name whatever follows it (AD-P10-11 (a)) |
| P10-R29 | `src/verifier.js` | the root's verify counter (AD-P10-13 (a)) |

Earlier tests: exactly the 37 CT-1 pin lines of SCOPE_AMENDMENTS.md §2 move (AD-P10-1 (a)); every other earlier test is unchanged. Not
changed: `src/typed_closure.js` (AD-P10-3 (a)), `src/host_abi.js`, `src/v051_reference.js`, the grant model of `src/run_package.js`, the
legacy functions, exports and handle and instance keys of `src/borrowed_memory_binding.js`, `docs/v0.53/P0_09_IMPORTS.md`.

## 2. Codes (P10-R26; AD-P10-4 (a))

| Code | Status | Where |
| --- | --- | --- |
| `air.extern.unsupported` | PROPOSED (R3.1, R-EFF-1) | verifier, at the extern line; the six async and io entries name DEFERRED_V054 |
| `air.extern.signature_mismatch` | PROPOSED (R3.1, R-EFF-1) | verifier, at the extern line |
| `air.extern.alias_conflict` | PROPOSED (P0-10, OD-P10-5 (a)) | verifier, at the extern line |
| `air.capability.required_missing` | PROPOSED (R3.1, R-EFF-1) | verifier, at the extern line or the first call that reaches the key |
| `air.effect.demand_missing` | PROPOSED (R3.1, R-EFF-3) | verifier, at the first call that contributes the key |
| `air.effect.demand_exceeded` | PROPOSED (R3.1, R-EFF-2) | verifier, at the export's `func` line, naming the key, the bound and the value (AD-P10-8 (a)) |
| `air.effect.demand_key_invalid` | PROPOSED (R3.1, R-EFF-3) | verifier, at the demand line, for the first invalid key |
| `air.host.binding_missing` | PROPOSED (R3.1, R-EFF-8) | adapter, admission step 1 |
| `air.host.binding_invalid` | PROPOSED (P0-10, P10-R12) | adapter, admission step 1 |
| `air.host.result_invalid` | PROPOSED (R3.1, R-EFF-13) | adapter, the failed invocation |
| `air.host.import_failed` | PROPOSED (R3.1, R-EFF-12) | adapter, the failed invocation |
| `air.host.reentrancy_forbidden` | PROPOSED (R3.1, R-EFF-11) | adapter, the refused entry and the running invocation |
| `air.host.call_before_admission` | PROPOSED (R-ABI53-3 step 2; the P0-08 admission) | adapter, admission step 2 |

The adapter codes are binding errors (a refusal at admission is thrown; an invocation failure is the failed result, as P0-08's traps
are), never failure-reason registry values (D-VAL-09). EXISTING codes P0-10 reaches: `air.capability.unknown` (no source line, G-5),
`air.v051.typed_syntax_invalid`, `air.v051.function_duplicate`, `air.call.argument_count_mismatch`, `air.call.result_unbound`,
`air.call.unknown_function`, `air.v051.typed_atom_type_mismatch`, `air.memory.region_bounds_static`, `air.memory.region_bounds_runtime`
(value 34), `air.loop.count_out_of_range`, `air.assurance.profile_unsupported`, `air.abi.record_untrusted`, `air.abi.contract_unsupported`,
`air.borrow.module_identity_mismatch`, `air.borrow.interface_invalid`, `air.v051.record_invalid`; P0-09's import codes for V53-IMP-N13 and N14.

## 3. Implementer readings (no scope change)

- **Order in a module.** The parse; the base's unknown-capability check; P10-R2 over the extern lines; the alias rule (OD-P10-5 (a)) over
  the extern lines; P10-R3's extern check; P10-R4's key validity; the functions; the WorkBound phase and P0-05's `work` assertion; then
  P10-R3's call check, P10-R5 (1) and P10-R5 (2). The alias rule is not in R2.3's order list; it is a declaration check, so it runs with
  them, after P10-R2. The demand checks run right after the WorkBound phase on its analysis (kept with the closure; recomputed for a
  module without imports), and only for a module with an extern, a demand or an import.
- **A contributing call.** A direct extern call, or a call or `loop.fold` callback whose callee's summary has the key (an imported
  callee's from its own module). The completeness set is every key of an extern called anywhere plus every key of an export's `E(e)`; a
  missing key is reported at the first contributing call in source order.
- **An empty `demand { }`** is a syntax error, as an empty `work { }` is: a declaration names at least one bound.
- **The contract descriptor.** An artifact with an extern takes P0-08's v2 descriptor, listing every root export (a scalar parameter as
  `kind: "value"`), so the typed admission can invoke any export; an artifact without an extern keeps P0-08's descriptor. A builder input
  with another descriptor for an extern-only module is refused as `air.borrow.interface_invalid`.
- **Write-back.** The adapter never writes a window back into bytes that an active data segment of the artifact initializes (the
  read-only literal views; tables and states cannot be passed): it reads those ranges from the private copy's data section, so the rule
  holds under T2 too. A region slot is never a data segment.
- **The guard.** One guard per admission object, shared by every instance it makes; a separate admission of the same bytes is not
  guarded (V53-EFF-N14 (v)).
- **What the typed `invoke` carries.** P0-08's `invoke` takes i32-family and `f32` arguments, so the tests run a `bool` parameter
  (V53-CFG-P02) through `invokeRaw`. Its invocation evidence hashes the result, and `invoke` runs an export only when its Wasm result lanes
  are one of nine shapes (SEC53-04): `i32`, `f32`, `f64`, `i32 i32`, `i32 f32`, `i32 f64`, `i32 i32 i32`, `i32 f32 i32` and `i32 f64 i32`,
  which the typed-v0.53 compiler emits for `i32` and `bool`, `f32`, `f64`, and `option<...>` and `result<..., E>` of them. Every other
  shape (`void`, `i64`, `option<i64>` and `result<i64,E>` included), and a name that is not an exported function, is refused with
  `air.borrow.interface_invalid` before any binding or host call (OD-P10-10 (A), OD-P10-11 (B); P0-10-CHECK-INVOKE-RESULT and
  SEC53-04-CHECK-INVOKE-SHAPES). The result lanes are read from the private copy's sections, because the v2 descriptor names none, and a
  reference or `v128` type in a function type (the type section) is refused at admission step 1 with `air.abi.contract_unsupported`.
  `invokeRaw` still runs every export.
- **P10-R28.** The module-key test is P9-R5's key form (the form `validateModuleMap` requires of a root key), written again in
  `src/v052_verified_build.js` because `src/typed_closure.js` does not export it.

## 4. Carried

V53-MIG-N07 becomes executable here and is P0-11's increment after P0-10's QA PASS. Demand-versus-grant mediation, receipts, fencing,
async imports, polling and `print` stay out (v0.54 or OUT_OF_CORE). The legacy `output.emit` static-id rule is not carried into typed
(OD-P10-6 (b)).
