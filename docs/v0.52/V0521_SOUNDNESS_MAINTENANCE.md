# AIR 0.52.1 — bounded soundness maintenance

Task: `AIR-0052-1-M1-SOUNDNESS-MAINTENANCE-0001`.
Authority: owner decision of 2026-10-06 (HD-5 = bounded 0.52.1 before any
publication of the 0.52 line).
Input: P0-00 normative rebaseline ledger (X-SND-01..07, X-BND-01..03, X-REL-03).

0.52.1 is maintenance of the existing 0.52 line. It adds no typed-v0.53
feature, no new WorkBound algebra, no new syntax, no AIR ABI or Host ABI
semantic version change, and no ABI 0.12 promotion. Accepted typed-v0.51
behaviour is unchanged. The frozen N01-N37, D01-D28 and H01-H08 matrix passes
unchanged.

The 0.52.0 candidate (tarball sha256 `24b4be70…`) was never published. 0.52.1
is the first public release candidate of the 0.52 line.

## Corrections

| Ledger | Defect in 0.52.0 (and 0.51.0 where noted) | 0.52.1 behaviour |
| --- | --- | --- |
| X-SND-01 | Effect budgets, metric contracts, the resource certificate and `realtime_safe` counted a structured phi loop's blocks once. Up to 4096 iterations ran per entry. Reproduced on 0.51.0. | The loop is charged at its fuel: the body counts 4096 times and the header 4097 times, and the loop counts as a dynamic loop with 4096 iterations. A `debug.metric <= 1` budget over a phi body that calls `debug.metric` is now rejected. |
| X-SND-02 | Work totals were JS Number products. A nest of 4096^90 produced `Infinity`, serialised as `null`, and the certificate still said `verified`. | Totals outside the exact safe-integer range are `unknown` (`work_bound_overflow`). Budgets fail with `air.resource.work_bound_overflow`. The validator rejects `verified` certificates with non-exact bounds (`air.resource_certificate.bound_invalid`). |
| X-SND-03 | A package certificate summed per-module counts and called the result `verified`, although cross-module calls were not composed. | The certificate no longer claims composition: work categories are `unknown` (`package_call_composition_unproven`), so a required certificate is `incomplete` and admission fails closed. Effect budgets are checked per module only. **Package-global composition is not solved; X-SND-03 is not globally closed** (see "Residual X-SND-03" below). |
| X-SND-04 | A typed-v0.51 AST received a `verified` legacy certificate with zero bounds, and digests collided for different bodies. | `air.resource_certificate.profile_unsupported`. |
| X-SND-05 | Every `alloc_region` got a fixed 4096-byte slot. Larger regions overlapped the next region. Reproduced on 0.51.0. | Each site owns a slot that covers its verified maximum (4096 B..16 MiB). A non-constant size is checked at runtime against the slot. Initial memory covers all slots. |
| X-SND-06 | `buffer.from_ptr` was only type-checked, so freed, oversized and foreign pointers were accepted. `slice.from_region` lengths and host write capacities were not tied to the region size. Reproduced on 0.51.0. | These require a live region. View size, slice length and host capacity must fit the region, statically or by a runtime trap before the view or host call. A buffer view used after `free_region` is rejected. |
| X-SND-07 | Borrowed-slice alias checks ignored AIR-owned memory, so a module store could mutate a host `readonly` view. Reproduced on 0.51.0. | Borrowed-lane modules export `__air_owned_memory_base` and `__air_owned_memory_end`. SDK Wasm-view bindings and `realtime_safe` plans that intersect that range fail closed. |
| X-BND-01 | `airc build --source-profile typed-v0.51` was uncapped (23.8 KB of source produced 61.9 MB of WAT). | The CLI applies the verified typed build limits: source 256 KiB, AST nodes, WAT and Wasm 4 MiB. |
| X-BND-02 | Verifier work was exponential in call-DAG depth (depth 18 took about 0.5-5 s). | Callee usage is memoised, so the exponential DAG case is closed and the counts are identical. The first 0.52.1 candidate still re-summarised every function (about cubic in call-chain depth) and overflowed the JavaScript stack at depth 1500; the QA52 correction below adds an iterative walk and deterministic analysis limits. Verifier work is **not** claimed to be linear. |
| X-BND-03 | `airc check`, `semantic-patch inspect/verify <json>` and the `evidence report` JSON options read FIFOs and devices unbounded (known QA P2-1). | They use the shared bounded regular-file reader (4 MiB, `air.cli.file_*`). |
| X-REL-03 | Shipped docs claimed "not published". | Release notes state facts that stay true after publication. |

Regression vectors: `test/v0521_maintenance.test.js` (24 cases, in `npm test`).

## QA52 correction (AIR-0052-1-QA52-REQUEST-CHANGES-CORRECTION-0002)

The independent QA52 review of the first 0.52.1 candidate returned
REQUEST_CHANGES with three P1 defects. This correction closes them and the
bounded P2 findings. Vectors: `test/v0521_qa52_correction.test.js`.

| Finding | Defect | Correction |
| --- | --- | --- |
| P1-1 | `run_package` coerced an unknown certified host-call or output bound (`null`) to `0`, so a package with an unproven bound passed `maxHostCalls`. | Admission reads a bound only from a `verified` category that holds an exact non-negative safe integer. Unknown bounds deny with `air.run.resource_bound_unproven`, overflowed bounds with `air.run.resource_bound_overflow`, malformed bounds with `air.run.resource_bound_invalid` (decision reason `resource_bound_unproven`), before any effect runs. The validator also rejects a `verified` category whose total is missing, `null` or negative (`air.resource_certificate.bound_invalid`). `realtime_safe` no longer reads a missing loop total as zero. |
| P1-2 | `airc build package --linked-wasm` lowered re-parsed, unverified modules, so the host `(ptr, capacity)` check was missing and a host write could overwrite a neighbouring live region. | The linked build lowers the module ASTs package-check verified (`verifiedPackageModuleAsts`), with the same region slot, region bounds and host-capacity facts as the single-module build. Lowering also fails closed on its own: a host import call without verifier facts gets the runtime capacity check, and a host `ptr` that is not a live region of the function fails the build. |
| P1-3 | Legacy verifier work was about cubic in call-chain depth (623 KB took 42 s), depth 1500 raised a raw `RangeError`, and there was no verifier-work limit. | Usage collection and the local-cycle check are iterative, each callee summary is computed once per module, and a deterministic structural limit applies before any call-graph walk (see "Legacy verifier analysis limits"). Outside the limits the verifier rejects with `air.verifier.analysis_limit_exceeded`. |
| P2-2 | A single-module package that calls `std.*` imports got the misleading reason `package_call_composition_unproven`. | Unresolved `std.*` callees are counted as `call.stdlib_external` and the certificate reports `stdlib_call_composition_unproven`. The certificate stays `incomplete`: std callee work is not composed into a package certificate. CR-0521-03 ("single-module packages are unaffected") was wrong for packages that use std imports. |
| P2-3 | A valid static region above 4096 bytes trapped on the linked path (slot annotation absent). | Fixed by P1-2: the linked path uses the verified slot. |
| P2-4 | Aggregate region slots were unbounded: 250 x 16 MiB instantiated 3.9 GiB, more failed with raw wabt errors. | The checked sum of a module's region slots must stay within 256 MiB, in the verifier and again in lowering (which also covers merged linked modules): `air.memory.region_backing_unsupported`. This is a build/admission resource ceiling, not a WorkBound. |
| P2-5 | Deleting the `v051TypedAst` marker gave a typed AST a `verified` zero-work certificate. | The legacy certificate requires the legacy block-IR shape (every function a block list, no statement bodies, enums or typed markers); anything else is `air.resource_certificate.profile_unsupported`. |
| P2-7 | `airc check` reported bounded file errors as `air.package.file_read`. | The diagnostic code is the stable `air.cli.file_*` code (`file_missing`, `file_invalid`, `file_too_large`, `file_read_failed`). |
| P2-8 | The observation-safety analyzer (state-accessor policy, conformance replay) was exponential in call-DAG depth. | Iterative and memoised: each function is summarised once (per module when the local call graph is acyclic), and a summary keeps each distinct origin issue once with the first call path that reaches it. The reasons and origin issues are those of the former exhaustive walk; repeated paths to the same origin are no longer listed. A structural work limit (4,194,304 units) fails closed with reason `analysis_limit_exceeded`. |
| P2-9 | X-SND-03 was presented as closed by defining budgets as module-local. | Stated as a narrower guarantee plus an open residual (below). No owner decision is implied. |
| P2-10 | A region-derived slice or buffer passed to a local call after `free_region` verified. | A view argument of any call requires its region to be live. |
| P2-6, P2-1, P2-11 | Release notes, package file modes, stale CI tag. | See "Compatibility of mixed artifacts and hosts", the release notes, and the public package/CI changes of this correction. |

### Legacy verifier analysis limits

These limits protect the verifier and its tools. They are deterministic and
structural: they do not depend on wall-clock time, they are not a Host Budget,
and they are not the typed-v0.53 WorkBound. A module inside the limits is
analysed exactly as before; the counts and verdicts do not change.

| Limit | Value | Counts |
| --- | --- | --- |
| `maxFunctions` | 4096 | functions in one module |
| `maxCallEdges` | 65536 | local call sites and loop callbacks |
| `maxCallDepth` | 256 | functions on the longest local call chain (back edges excluded; local recursion is rejected separately) |
| `maxStructuralVisits` | 4,194,304 | instructions plus functions x module constants (the per-function constant scope) |
| `maxSummaryWork` | 4,194,304 | callee summaries computed or reused, instructions summarised, and usage entries merged |

The exceeded resource is named in the message, for example
`air.verifier.analysis_limit_exceeded: legacy verifier call depth 257 exceeds
the maintenance limit 256`. Complexity, stated structurally: every function
is summarised once, so summary work is the instruction count plus, for each
call edge, the size of the callee summary. A callee summary has one entry per
distinct usage key reachable from it (including one `call.<name>` key per
reachable local function), so the work can grow with edges x reachable
functions. It is bounded by the counter above, not linear. All repository
sources (262 files) and the local consumer sources measured for this
correction stay at least 17 times below every limit (largest: 235 functions,
556 edges, call depth 10, 31,096 structural visits, 8,097 summary units).

### Residual X-SND-03 (package-global composition)

The exact 0.52.1 guarantee is narrower than package-global composition:

- An effect budget or metric contract declared in a module is checked against
  that module's own operations. A call into another package module counts
  once as `call.package_external`; the callee's operations count only against
  the callee module's own budgets.
- No 0.52.1 check bounds the total effects, host calls or work of a package
  across its modules. A package can therefore perform more of an effect than
  any single module budget states.
- The Verified Resource Certificate never reports such a package as
  `verified`: the affected categories are `unknown`, and required-mode
  admission (`run_package`, `realtime_safe`) fails closed.

Package-global composition remains an open residual. 0.52.1 does not define
the typed-v0.53 WorkBound; a sound compositional WorkBound is planned for
typed-v0.53. Whether the module-local scope is acceptable for the 0.52.1
release is an owner decision at H52, not a property this document asserts.

### Compatibility of mixed artifacts and hosts

Borrowed-lane artifacts built by 0.52.1 export `__air_owned_memory_base` and
`__air_owned_memory_end` (immutable i32 globals). No AIR ABI or Host ABI
version changed, so nothing signals the difference to an older host.

| Artifact \ Host | Host without the 0.52.1 range check (0.52.0, 0.51.0) | 0.52.1 host |
| --- | --- | --- |
| 0.52.0 artifact | Baseline: a Wasm-view binding that overlaps AIR-owned memory can be mutated by the module (X-SND-07, unprotected). | Every Wasm-view binding fails closed (`air.borrow.air_memory_layout_unknown`); copied mode works; `realtime_safe` reports `air.realtime.wasm_source_mismatch`. Rebuild with 0.52.1. |
| 0.52.1 artifact | **Unprotected.** The old host ignores the exported range, an overlapping read-only view can be mutated, and there is no diagnostic or version signal. Do not treat this cell as protected. | Protected: overlapping views fail with `air.borrow.air_owned_memory_overlap` (`air.realtime.air_owned_memory_overlap` for `realtime_safe`); non-overlapping views and copied mode work. |

The range globals are metadata, not proof. A host that does not pin the
verified `moduleDigest` can be given forged range values. This correction
changes no exported global and no artifact metadata.

### Direct-export hosts

Hosts that call Wasm exports directly, without the SDK binding or
`realtime_safe` session, get none of the SDK checks. Such a host must read
`__air_owned_memory_base` and `__air_owned_memory_end` from the verified
module, reject a missing, inverted or non-exported range, reject any view that
intersects `[base, end)`, and pin the module digest it verified. The SDK does
not export a public range helper for this in 0.52.1.

### OPEN-42

OPEN-42 (how the new-artifact/old-host cell is signalled or prevented) stays
open. This correction does not resolve it and does not change ABI semantics
to do so.

## Compatibility changes (intentional, breaking-safety)

- **M1 legacy certificate retained only where sound/defined; unsupported cases
  no longer produce VERIFIED and cannot authorize admission.** Any path that
  required `status: verified` (required-mode packages, `realtime_safe`, run
  admission) now fails closed for phi-loop, overflow, cross-module and typed
  inputs.
- Legacy modules with a structured phi loop whose budget or contract does not
  cover 4096 iterations are now rejected.
- `buffer.from_ptr` over a non-region pointer or an undersized region, and
  oversized static `slice.from_region` lengths or host capacities, are now
  rejected. Dynamic ones trap at runtime instead of corrupting memory.
- Dynamic `alloc_region` sizes above 4096 bytes now trap. Previously they
  overlapped the next region. Static sizes above 4096 bytes now get a correctly
  sized slot instead of overlapping.
- Borrowed-lane Wasm exports gain two read-only globals. Wasm-view bindings
  over AIR-owned memory, or on instances without the range, are rejected.
- `airc build --source-profile typed-v0.51` rejects sources above the
  verified typed build limits with `air.v052.work_limit_*`.

## Known limitations retained (disclosure)

- Cross-module effect and work composition is not proven (residual
  X-SND-03 above). The certificate reports it as unknown; 0.52.1 does not
  define the typed-v0.53 WorkBound.
- Region memory is not cleared between allocations, and string literals are
  writable data that the certificate counts as 0 bytes (X-SND-11).
- An exported function returning `slice` loses its length at the boundary
  (X-SND-12).
- Legacy literals are lowered through JS Number: i64 constants above 2^53 and
  float `-0.0` change value (X-SND-08). Typed-v0.51 i64 is exact.
- Legacy refinements on exported parameters are static assumptions, not
  runtime checks. `requires checked param` is enforced only for borrowed-slice
  entry relations (X-SND-09).
- Async readiness tracking is intra-procedural (X-SND-10).
- Assurance APIs other than the certificate (`createAiReviewReport`,
  `auditModule`, `explainModule`, provenance, semantic patch) are legacy-only
  and do not reject a typed AST with a stable code (X-PROF-05).
- Hosts that call Wasm exports directly, bypassing the SDK, must apply the
  AIR-owned memory range check themselves (see "Direct-export hosts").
- A 0.52.1 artifact on a 0.52.0 or older host is unprotected (OPEN-42).
- 0.51.0 remains the historical published line and contains X-SND-01, -05,
  -06 and -07.
