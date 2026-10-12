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
  unknown (`package_call_composition_unproven`), and so is work behind an
  unresolved `std.*` source import (`stdlib_call_composition_unproven`).
  A typed-v0.51 module, with or without its marker, is rejected by the legacy
  certificate (`air.resource_certificate.profile_unsupported`). A `verified`
  category with a missing, `null` or negative total is invalid
  (`air.resource_certificate.bound_invalid`).
- **Fail-closed run admission.** `run_package` admits a package only when the
  certified host-call and output totals it checks are verified exact
  integers within the supplied limits. Unknown, overflowed or malformed
  bounds deny before any effect runs (`air.run.resource_bound_unproven`,
  `air.run.resource_bound_overflow`, `air.run.resource_bound_invalid`).
- **Region isolation.** Each `alloc_region` site owns a slot that covers its
  verified maximum size. Dynamic sizes are checked against the slot, and one
  module's slots total at most 256 MiB
  (`air.memory.region_backing_unsupported`). `buffer.from_ptr`,
  `slice.from_region` and host `(ptr, capacity)` arguments require a live
  region and an in-bounds size, statically or by a runtime trap. The linked
  package build (`airc build package --linked-wasm`) applies the same checks
  and slots as the single-module build. A view passed to a call after its
  region is freed is rejected.
- **Borrowed views.** Borrowed-lane modules export their AIR-owned memory
  range (`__air_owned_memory_base`, `__air_owned_memory_end`). SDK and
  `realtime_safe` Wasm-view bindings that intersect it fail closed
  (`air.borrow.air_owned_memory_overlap`).
- **Bounded tooling.** `airc build --source-profile typed-v0.51` applies the
  verified typed build limits. The legacy verifier summarises each function
  once, walks call graphs without recursion and enforces deterministic
  structural analysis limits (4096 functions, 65536 local call edges, call
  depth 256, 4,194,304 structural visits and 4,194,304 summary-work units per
  module); outside them it reports `air.verifier.analysis_limit_exceeded`.
  These are tooling limits, not a WorkBound, and verifier work is not claimed
  to be linear. `airc check`, `semantic-patch` and `evidence report` JSON
  inputs use the bounded regular-file reader, and `airc check` reports its
  `air.cli.file_*` code.

## Compatibility (intentional, breaking-safety)

- The legacy resource certificate is retained only where its bounds are sound
  and defined. Unsupported cases no longer produce `verified` and cannot
  authorize admission.
- Programs that previously verified and would overrun a declared budget, a
  region, a view or a host capacity are now rejected, or trap at runtime
  before the overrun.
- Borrowed-lane Wasm gains two read-only exported globals.
- Modules beyond the legacy verifier analysis limits, or whose region slots
  exceed 256 MiB, are rejected with a stable diagnostic.

## Mixed artifacts and hosts

No AIR ABI or Host ABI version changed, so nothing signals a 0.52.1 artifact
to an older host.

| Artifact \ Host | Host without the 0.52.1 range check (0.52.0, 0.51.0) | 0.52.1 host |
| --- | --- | --- |
| 0.52.0 artifact | Unprotected baseline: an overlapping Wasm-view can be mutated. | Wasm-view bindings fail closed (`air.borrow.air_memory_layout_unknown`); copied mode works; rebuild for `realtime_safe`. |
| 0.52.1 artifact | **Unprotected**, with no diagnostic: the old host ignores the exported range. | Protected: overlapping views fail with `air.borrow.air_owned_memory_overlap`. |

Hosts that call Wasm exports directly, without the SDK binding or
`realtime_safe` session, must themselves read `__air_owned_memory_base` and
`__air_owned_memory_end`, reject a missing or inverted range and any view
that intersects it, and pin the verified module digest. The SDK exports no
public helper for this. How the new-artifact/old-host case is signalled
remains open (OPEN-42).

## Boundaries

- AIR ABI `0.10` and `0.11` and Host ABI `0.10` and `0.11` are unchanged.
  AIR ABI `0.12` remains candidate-only.
- typed-v0.51 acceptance is unchanged; the frozen v0.51 conformance matrix
  passes unchanged.
- The runtime admission callback is not a CapabilityGrant or production
  effect authorization.
- Effect budgets are module-local: a budget counts its own module's
  operations, and no 0.52.1 check bounds a package's effects or work across
  modules. The certificate reports such packages as unknown, so required-mode
  admission fails closed, but package-global composition remains an open
  residual (X-SND-03 is not globally closed).
- 0.52.1 does not define the typed-v0.53 WorkBound. A full, compositional
  WorkBound is planned for typed-v0.53.
- Known limitations retained in this line are listed in
  `docs/v0.52/V0521_SOUNDNESS_MAINTENANCE.md` in the source repository. They
  include cross-module
  composition, region memory reuse, writable string literals, legacy literal
  precision, and legacy-only assurance APIs. Several memory and
  loop-accounting defects corrected here also exist in the published 0.51.0
  package.
