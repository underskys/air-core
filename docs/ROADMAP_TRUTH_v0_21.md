# AIR v0.21 Roadmap Truth

Status: public-claims alignment

This document aligns v0.21+ roadmap language with current implementation
reality. AIR remains an AI-first verified IR. It is not being repositioned as a
broad general-purpose language, and v0.21 does not add compiler features,
Host ABI `0.11`, `output.emit`, tablegroups, optimizer passes, native
installers, or package registry behavior.

| Claim | Status | Evidence | Next step |
| --- | --- | --- | --- |
| Deterministic verified packages | Implemented first slices. | `package-check`, `report package`, `airc verify package <dir> --json`, artifact/bundle checks, and deterministic conformance fixtures exist from v0.14-v0.20. | Keep verification evidence as the canonical release claim surface and require it for canonical examples. |
| LSP diagnostics | Implemented first slices. | LSP-lite JSON diagnostics exist from v0.15; diagnostics-only `airc lsp --stdio` exists from v0.19. | Add deprecated API diagnostics only after v0.21 deprecation categories stabilize. |
| Compact static tables | Implemented first slice. | v0.19 implements `table<u8>`, `table<u16>`, `table<i16>`, compact `table.get.*` reads returning `i32`, and storage savings reporting. | Keep full compact scalar arithmetic, compact load/store ops, typed buffers, and tablegroups deferred. |
| Bounded facts / rowsets | Implemented as tooling/package metadata first slices. | v0.18 facts schemas and v0.20 bounded rowset schemas validate scalar, bounded, privacy-visible package metadata. | Use bounded rowsets in canonical examples; do not describe rowset JSON as AIR runtime objects. |
| Command buffers | Implemented as tooling/package/conformance first slice. | v0.20 command buffer metadata validates bounded scalar output intent records tied to Output Contract IDs. | Use command buffers in canonical examples; host policy remains owner of side-effect execution. |
| Host ABI `0.11` | Deferred. | Host profiles remain at Host ABI `0.10`; v0.21 docs/API gates reject Host ABI `0.11` without a decision record. | Require separate accepted Host ABI RFC, profile update, implementation, tests, and promotion evidence. |
| Tablegroups | RFC/deferred. | Bounded facts docs discuss tablegroups as possible source ergonomics, but no tablegroup syntax or implementation is active. | Keep tablegroups behind a future RFC and AIR ABI decision gate if runtime representation changes. |
| Performance `x50`-`x200` | Target only, not measured release fact. | No committed benchmark suite or optimizer-pass evidence proves these multipliers in v0.21. Current foundations are compact static tables, bounded facts, command buffers, batching, linked package output, conformance/replay, and LSP diagnostics. | Build a benchmark suite and publish measured results before advertising acceleration claims as achieved. |
| AirOps canonical example | Implemented first slice / active P1 promoted example. | [examples/airops_incident_package](../examples/airops_incident_package/README.md) verifies, package-checks, reports, and replays deterministic conformance using bounded rowset schema metadata, Output Contract metadata, command buffers, verification evidence, and batch fixture input. | Harden negative conformance paths, privacy-leak checks, and mismatch fixtures before treating it as broad adoption proof. |
| FlowDesk canonical example | Planned/P1, not implemented. | [Canonical Examples Readiness v0.21](CANONICAL_EXAMPLES_READINESS_v0_21.md) identifies test fixtures and higher privacy/browser-boundary risk. | Migrate after AirOps establishes the canonical example pattern. |
| Fixed Bounded State Segment | Future pressure/RFC, not implementation in v0.22. | [Fixed Bounded State Segment Pressure Request](abi-requests/fixed-bounded-state-segment.md) and the v0.22 RFC capture Airtris/Minesweeper/PhotoLoop pressure while keeping parser/verifier/lowering changes deferred. | Use v0.23 implementation planning only after syntax, memory isolation, verifier, report, conformance, and ABI gates are accepted. |
| Compiler optimization | Deferred. | v0.21 has verification, metadata, compact storage, conformance, and diagnostics foundations, not optimizer passes. | Define optimizer goals, benchmark fixtures, and correctness gates before implementation. |

## Public Claim Rules

- Say "implemented" only for shipped code, CLI commands, validators, reports, or
  tests in the repository.
- Say "planned", "candidate", "target", or "deferred" for roadmap items without
  implementation or benchmark evidence.
- Do not advertise `x10`-`x200` style performance claims as achieved until a
  deterministic benchmark suite and results exist.
- Do not describe tablegroups, Host ABI `0.11`, or `output.emit` as active
  v0.21 behavior.
- Keep AIR framed as an AI-first verified IR with bounded, reviewable contracts,
  not as a broad general-purpose language.
