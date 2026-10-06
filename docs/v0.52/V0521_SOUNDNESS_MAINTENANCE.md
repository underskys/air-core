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
| X-SND-03 | A package certificate summed per-module counts and called the result `verified`, although cross-module calls were not composed. | Work categories are `unknown` (`package_call_composition_unproven`), so a required certificate is `incomplete`. Module budgets are documented as module-local. |
| X-SND-04 | A typed-v0.51 AST received a `verified` legacy certificate with zero bounds, and digests collided for different bodies. | `air.resource_certificate.profile_unsupported`. |
| X-SND-05 | Every `alloc_region` got a fixed 4096-byte slot. Larger regions overlapped the next region. Reproduced on 0.51.0. | Each site owns a slot that covers its verified maximum (4096 B..16 MiB). A non-constant size is checked at runtime against the slot. Initial memory covers all slots. |
| X-SND-06 | `buffer.from_ptr` was only type-checked, so freed, oversized and foreign pointers were accepted. `slice.from_region` lengths and host write capacities were not tied to the region size. Reproduced on 0.51.0. | These require a live region. View size, slice length and host capacity must fit the region, statically or by a runtime trap before the view or host call. A buffer view used after `free_region` is rejected. |
| X-SND-07 | Borrowed-slice alias checks ignored AIR-owned memory, so a module store could mutate a host `readonly` view. Reproduced on 0.51.0. | Borrowed-lane modules export `__air_owned_memory_base` and `__air_owned_memory_end`. SDK Wasm-view bindings and `realtime_safe` plans that intersect that range fail closed. |
| X-BND-01 | `airc build --source-profile typed-v0.51` was uncapped (23.8 KB of source produced 61.9 MB of WAT). | The CLI applies the verified typed build limits: source 256 KiB, AST nodes, WAT and Wasm 4 MiB. |
| X-BND-02 | Verifier work was exponential in call-DAG depth (depth 18 took about 0.5-5 s). | Callee usage is memoised per verification; work is linear in the call DAG and the counts are identical. |
| X-BND-03 | `airc check`, `semantic-patch inspect/verify <json>` and the `evidence report` JSON options read FIFOs and devices unbounded (known QA P2-1). | They use the shared bounded regular-file reader (4 MiB, `air.cli.file_*`). |
| X-REL-03 | Shipped docs claimed "not published". | Release notes state facts that stay true after publication. |

Regression vectors: `test/v0521_maintenance.test.js` (24 cases, in `npm test`).

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

- Cross-module effect and work composition is not proven. The certificate
  reports it as unknown; a sound compositional WorkBound arrives with
  typed-v0.53 (P0-02).
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
  AIR-owned memory range check themselves.
- 0.51.0 remains the historical published line and contains X-SND-01, -05,
  -06 and -07.
