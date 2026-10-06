# AIR Core 0.52.1 — Bounded Soundness Maintenance

Package: `@underskys/air-core@0.52.1`

0.52.1 is maintenance of the 0.52 line. The 0.52.0 technical candidate was
reviewed but never published, so 0.52.1 is the first public release candidate
of the line. The npm registry, not this file, is the source of truth for
publication state and dist-tags.

0.52.1 contains everything in the 0.52.0 candidate (see
[0.52.0 notes](RELEASE_NOTES_0_52_0.md)): explicit `legacy-v0.50` (default)
and `typed-v0.51` (opt-in) source profiles, verified typed build/invoke, and
the process-local generic runtime. It adds soundness corrections found by the
v0.53 P0-00 normative rebaseline audit.

## Corrected

- **Loop work and effects.** Structured phi loops are charged at their
  4096-iteration fuel in effect budgets, metric contracts, the Verified
  Resource Certificate and `realtime_safe`. A budget that the loop can exceed
  is now rejected.
- **Exact certificate totals.** Work totals that leave the exact safe-integer
  range are reported as unknown, never as verified. Budgets on such totals
  fail with `air.resource.work_bound_overflow`. The certificate validator
  rejects `verified` certificates with inexact bounds
  (`air.resource_certificate.bound_invalid`).
- **No false verified certificates.** Cross-module work is reported as
  unknown (`package_call_composition_unproven`). A typed-v0.51 module is
  rejected by the legacy certificate
  (`air.resource_certificate.profile_unsupported`).
- **Region isolation.** Each `alloc_region` site owns a slot that covers its
  verified maximum size. Dynamic sizes are checked against the slot.
  `buffer.from_ptr`, `slice.from_region` and host `(ptr, capacity)` arguments
  require a live region and an in-bounds size, statically or by a runtime trap.
- **Borrowed views.** Borrowed-lane modules export their AIR-owned memory
  range (`__air_owned_memory_base`, `__air_owned_memory_end`). SDK and
  `realtime_safe` Wasm-view bindings that intersect it fail closed
  (`air.borrow.air_owned_memory_overlap`).
- **Bounded tooling.** `airc build --source-profile typed-v0.51` applies the
  verified typed build limits. Verifier work is linear in the call graph.
  `airc check`, `semantic-patch` and `evidence report` JSON inputs use the
  bounded regular-file reader.

## Compatibility (intentional, breaking-safety)

- The legacy resource certificate is retained only where its bounds are sound
  and defined. Unsupported cases no longer produce `verified` and cannot
  authorize admission.
- Programs that previously verified and would overrun a declared budget, a
  region, a view or a host capacity are now rejected, or trap at runtime
  before the overrun.
- Borrowed-lane Wasm gains two read-only exported globals.

## Boundaries

- AIR ABI `0.10` and `0.11` and Host ABI `0.10` and `0.11` are unchanged.
  AIR ABI `0.12` remains candidate-only.
- typed-v0.51 acceptance is unchanged; the frozen v0.51 conformance matrix
  passes unchanged.
- The runtime admission callback is not a CapabilityGrant or production
  effect authorization.
- Known limitations retained in this line are listed in
  `docs/v0.52/V0521_SOUNDNESS_MAINTENANCE.md` in the source repository. They
  include cross-module composition, region memory reuse, writable string
  literals, legacy literal precision, and legacy-only assurance APIs. Several
  memory and loop-accounting defects corrected here also exist in the
  published 0.51.0 package.
