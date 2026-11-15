# AIR Changelog

This changelog keeps public milestone history out of the README. It uses a
compact format:

- Added
- Changed
- Fixed
- Security
- Breaking / Migration

## v0.53.0

Package `@underskys/air-core@0.53.0`, with the typed-v0.53 source profile as a
candidate: it is selected only with `--source-profile typed-v0.53
--allow-candidate-profile` (SDK: `allowCandidateProfile: true`). 0.52.0 and
0.52.1 were never published; their entries below are part of 0.53.0. AIR ABI and
Host ABI do not move. The release notes, `docs/RELEASE_NOTES_0_53_0.md`, state
the ABI statements, the corrections and every known limit.

### Breaking / Migration

- `instantiateAirModule` left the package root. Callers that verify their own source use `instantiateVerifiedAirModule({ source, sourceName, imports, packageDigest, library })`, with the same result and evidence; callers with prebuilt or crafted bytes use `require("@underskys/air-core/raw").instantiateRawWasm`.
- The root's borrowed lane (`invokeBorrowedMemory`, `prepareBorrowedMemoryInvocation`) takes verified instances only; raw instances use `invokeRawBorrowedMemory` and `prepareRawBorrowedMemoryInvocation` from `@underskys/air-core/raw`. An export whose result is not exactly one `i32`, `f32` or `f64`, or whose Wasm parameters are not the lanes its descriptor entry names, is refused before it runs.
- Conformance replay binds `metadata.wasm` to the deterministic lowering of the verified source, single-entry or linked, and refuses other bytes with `air.conformance.wasm_source_mismatch`. The benchmark runs only the bytes it built.
- `run` and `runPackage` take `{ authority, facts }`: build the authority from host state with `hostAuthority({ package, grants, limits, adapters, hostFacts })` and pass only request facts. A request that carries the package descriptor, grants, limits or adapters is refused with `air.run.authority_unbranded`, and one that carries `quotaUsed`, `rateUsed`, `requiresRedaction` or a `hostFacts` key among its facts with `air.run.input_invalid`, before anything runs. Use `runHostConstructed`, today's single-object form, only when the host builds the whole request itself. `examples/tool_gate/request.js` now has `createToolGateAuthority(hostState)` and `toolGateRequestFacts(untrusted)`, and `createToolGateRequest()` with no arguments gives today's allowed run. The evidence bytes are unchanged.
- `air.run` and `air.runHostConstructed` refuse an entry-point argument outside the signed i32 range, where they passed it wrapped. The refusal is the message prefix `air.run.argument_invalid` inside `air.run.execution_failed`, not a registered code. Pass times and counts that fit, for example logical or relative times; Unix seconds fit until 2038-01-19.
- `airc run-proof`, conformance replay (`createConformanceReplayReport`, `airc conformance`) and `airc benchmark` refuse an argument outside the signed i32 range for a parameter that is i32 in Wasm, where they passed it wrapped. At conformance replay and `airc benchmark` such an argument must be an integer or a boolean: a fraction, a string or `null`, which JavaScript converted before, is refused. `airc benchmark` reports such a refusal as the warning `air.benchmark.runtime_unavailable` and keeps the status `pass`, with no timed call; its `wasmExecutionMs` is then only the time to the refusal, and its limitations say "wasmExecutionMs unavailable because runtime execution could not complete"; check the diagnostics. `air.benchmark.argument_invalid` is that warning's message, not a registered code.
- `package.json` has an `exports` map with three entries, `"."`, `"./package.json"` and `"./raw"`. A deep import by package name (for example `@underskys/air-core/src/sdk.js`) breaks on upgrade, and bundlers and TypeScript that honour `exports` resolve only the root and the two subpaths. The test-only builder-defect seam is not shipped. A root `lowerToWat` call with a typed-v0.53 AST and no opt-in gets `air.source_profile.candidate_disabled`.
- Typed admission changes only for crafted artifacts: a funcref, externref or v128 result, or any non-numeric value type anywhere in the type section, refuses the whole artifact at admission; other multi-value results get a coded refusal at `invoke`; a non-function name is refused before any host call. No shape the typed compiler emits changes behaviour.
- Packages: a link anywhere on a declared, imported, asset or legacy-format path is refused; a legacy-format path with ".." is refused; a FIFO or other non-regular asset is refused, where it used to hang the package check; package files over 4 MiB at the listed read sites are refused; an import is looked up in the package, never through the working directory; an import name with a backslash is refused in package mode; a name beginning "std." that is not a stdlib module name gets the package rule; the output-emit check fails with a code where it skipped a module silently.
- A type nested more than 1,024 levels, in typed-v0.51 and legacy sources, is refused with a code instead of a crash or a hang. `audit`, `explain` and `format` refuse a typed-v0.51 AST with a code where they threw a raw `TypeError`, and also refuse a function-less typed-v0.51 module that returned output before.

### Fixed

- Entry-point arguments outside the signed i32 range are no longer passed wrapped (SEC53-03 R-5): fixed at `air.run` by SEC53-08 and at the four other call sites by SEC53-09.
- CR-S6: a typed-v0.51 type nested more than 1,024 levels gets the nesting code at every depth (G-2); `lowerToWat(mod, { maxWatBytes })` refuses a WAT over its cap with `air.v052.work_limit_wat_bytes` (G-5); the typed-v0.51 CLI `--emit wasm` without a resolvable WABT gives `air.v052.toolchain_input_unavailable` (G-7); `auditModule`, `explainModule`, `formatModule` and `formatSource(..., legacy-v0.50)` refuse a typed-v0.51 AST with a code (O-2); a legacy-v0.50 type nested more than 1,024 levels gets the located nesting refusal.

### Known limits

Stated in full in `docs/RELEASE_NOTES_0_53_0.md`, each under its record's name, never as fixed:
F7; `engines` (`>=22`); F-1 L1 to L5; SEC53-02 R-1, R-2, R-4, R-5 and R-7; SEC53-03 R-1 to R-4; SEC53-01 R-1 to R-9; SEC53-08 R-2 to R-4; SEC53-06 R-1 to R-6 and R-8, with the lexical nesting count, O-2 on function-less typed-v0.51 modules, the legacy cost slope and the stack margin; SEC53-06B R-8, its linear-bound line, its cost on large legacy modules and KNOWN_1 to KNOWN_4; SEC53-09 R-1 to R-5; `invokeRaw`'s lanes; the benchmark's warning with status `pass`; linked packages' exports; the bundle secret scan's N1 to N10; M()'s coverage in 0.53.0 with its caveats; and the packaged documentation's relative links that do not resolve inside the installed package.

## v0.52.1 - Bounded Soundness Maintenance

Never published; its content is part of 0.53.0. The 0.52.0 candidate below was
never published either. See `docs/RELEASE_NOTES_0_52_1.md`.

### Fixed

- Charge structured phi loops at their 4096-iteration fuel in effect budgets,
  metric contracts, the Verified Resource Certificate and `realtime_safe`.
- Keep certificate work totals exact; overflowing totals are unknown and
  budgets on them fail with `air.resource.work_bound_overflow`.
- Report cross-module certificate work as unknown; reject typed-v0.51 modules
  in the legacy certificate, also when the typed marker is missing.
- Report unresolved `std.*` import work as unknown with its own reason,
  `stdlib_call_composition_unproven`.
- `airc check` reports bounded file errors with their `air.cli.file_*` code.

### Security

- Give each `alloc_region` site a slot that covers its verified maximum size;
  check dynamic sizes against it.
- Require live regions and in-bounds sizes for `buffer.from_ptr`,
  `slice.from_region` and host `(ptr, capacity)` arguments.
- Export the AIR-owned memory range from borrowed-lane modules; reject Wasm-view
  bindings that intersect it.
- Deny `run_package` admission before execution when a certified host-call or
  output bound is unknown, overflowed or malformed; a missing bound is never
  zero (`air.run.resource_bound_*`).
- Apply the same host `(ptr, capacity)` checks and region slots in
  `airc build package --linked-wasm` as in the single-module build; reject a
  view passed to a call after its region is freed; cap one module's region
  slots at 256 MiB (`air.memory.region_backing_unsupported`).
- Apply the verified typed build limits to `airc build --source-profile
  typed-v0.51`; walk legacy call graphs without recursion, summarise each
  function once and enforce deterministic verifier analysis limits
  (`air.verifier.analysis_limit_exceeded`); bound the observation-safety
  analysis; bound `airc check`, `semantic-patch` and `evidence report` JSON
  file inputs. Verifier work is not claimed to be linear.

### Breaking / Migration

- The legacy certificate no longer reports `verified` for unsupported shapes
  and cannot authorize admission for them. Programs that would overrun a
  budget, region, view or host capacity are rejected or trap before the overrun.
- AIR ABI and Host ABI versions are unchanged; typed-v0.51 acceptance is unchanged.
- A 0.52.1 borrowed-lane artifact on an older host is unprotected and gets no
  signal; hosts that call exports directly must apply the AIR-owned memory
  range check themselves. See the mixed-version table in the release notes.
- Effect budgets are module-local; package-global composition is an open
  residual. 0.52.1 does not define the typed-v0.53 WorkBound.

## v0.52.0 - Verified Typed Runtime Technical Release Candidate

S5 bounded correction passed independent exact-SHA QA at public commit
`4c62489f34a8149f758bc23dda892a031bae1023` and accepted unpublished
tarball SHA-256
`627ced8529caa5c91c9fe80f6e315e82ace189aeacec19bd8230c1929d540433`.
This version is not yet tagged or published.

### Added

- Explicit `legacy-v0.50` and `typed-v0.51` source profiles; the typed profile
  must be selected explicitly.
- Verified typed build/invoke and a process-local generic runtime with bounded
  compilation, immutable module caching, fresh instances and host admission
  rechecks on build and invocation.
- Executable deterministic-numerics and hostile-pressure conformance evidence,
  including portable cross-host HOLD classification.
- Installed-package reality checks with exact tarball, lockfile integrity and
  file-inventory verification.

### Changed

- Public package and CLI version are aligned at `0.52.0` for this candidate.
- Stable diagnostics are exposed through `.code` on parser and verifier errors.

### Security

- Reject unknown typed capability declarations and statements after return.
  Support the frozen exact decimal `const.i64` carrier only in typed initializer
  and return positions. Arithmetic operands still take bare i64 literals;
  formatting the carrier preserves the exact value but prints the bare literal.
- Bound CLI source-file reads to regular files of at most 4 MiB and return
  stable diagnostics. Browser evidence records actually executed versions
  and executable hashes separately from expected registry revisions.
- Unknown source-command options, malformed deep descriptors, untrusted build
  handles, stale runtime handles and revoked host admission fail closed.
- AIR ABI `0.12` remains candidate-only. Host ABI `0.10` and `0.11` are
  unchanged, and the runtime admission callback is not a CapabilityGrant or an
  effect authorization implementation.

### Breaking / Migration

- Legacy source remains the default. Typed source requires
  `--source-profile typed-v0.51` or the equivalent SDK option.
- Typed-v0.51 is a finite subset and does not admit user calls, loops,
  recursion, branches, imports or host effects.

## v0.51.0-alpha - Frozen Typed Decisions Candidate

### Added

- Frozen `v0.51` reference substrate: canonical typed values, candidate typed
  interface validation, checked numeric runtime coverage, typed Wasm ingress
  validation, and machine-readable conformance runners.
- A product-neutral AIRSwift conformance host and Golden AI Gate examples for
  bounded host-admission pressure testing.

### Changed

- Existing AIR ABI `0.10` and `0.11` behavior remains supported.
- AIR ABI `0.12` typed decisions is a candidate lane, disabled by default and
  available only through the explicit `allowCandidateAbi012: true` option.

### Security

- Candidate typed interfaces and unsupported `.airpkg` candidate transport
  paths fail closed. This is not an enforcement or Host ABI release.

### Breaking / Migration

- The candidate typed-decisions surface may change before `v1.0`. Frozen
  `v0.51` semantics are versioned by specification, not npm patch releases.

## v0.50.2 - Public Identity Correction

### Changed

- Public package and CLI version reporting are aligned at `0.50.2`.
- README and release notes consistently identify the product as AIR, the npm
  package as `@underskys/air-core`, the CLI as `airc`, and Dmitriy Shtro as
  creator and maintainer.

### Breaking / Migration

- None. No compiler, verifier, lowerer, AIR ABI, Host ABI, or feature behavior
  changed.

## v0.50.1 - Public Identity And Presentation Patch

### Changed

- README now identifies Dmitriy Shtro explicitly as AIR creator and maintainer,
  with the canonical LinkedIn link.
- Public package, npm `latest`, and installation guidance now point to
  `@underskys/air-core@0.50.1`.

### Breaking / Migration

- None. No compiler, verifier, AIR ABI, Host ABI, or feature behavior changed.

## v0.50.0 - Public Release Candidate

### Added

- Bounded refinement types, opt-in Provenance Flow, Verified Resource
  Certificates, and semantic patches with fail-closed non-expansion checks.
- A bounded embedding facade and agent tool-gate, region-bound memory checks,
  and the opt-in `borrowed_slice` AIR ABI `0.11` interface.
- A `realtime_safe` structural profile and expanded deterministic evidence,
  replay, and conformance coverage for the supported subset.

### Changed

- Existing AIR ABI `0.10` modules remain supported. Borrowed slices use opt-in
  AIR ABI `0.11`; Host ABI is not redefined by this release.

### Fixed

- `package-check` now fails closed for an infeasible declared
  `realtime_safe` execution profile, including when no profile flag is passed.

### Security

- AIR does not claim malicious-host safety, universal noninterference, a
  universal realtime deadline, or implied zero-copy transfer. Conformance
  claims apply only to explicitly tested host/engine combinations.

### Breaking / Migration

- AIR remains a bounded component language. Existing AIR ABI `0.10` modules
  need no migration.

## v0.45.1 - Show HN Package Presentation Patch

### Added

- None.

### Changed

- README first screen is hardened for package/rendered Markdown presentation:
  headings, paragraphs, bullets, and the Adobe AIR note are separated with
  explicit Markdown spacing.
- Package version prepared as `@underskys/air-core@0.45.1` for a presentation
  patch to the already published `0.45.0` alpha.

### Fixed

- Show HN-facing package presentation now avoids collapsed heading/paragraph
  rendering in strict package/public README views.

### Security

- None.

### Breaking / Migration

- None. No compiler, verifier, AIR ABI, Host ABI, or feature behavior changed.

## v0.45.0 - Public Release Candidate Preparation

### Added

- Public launch documentation: `WHY_AIR.md`, `METHOD.md`, `SECURITY.md`,
  `THREAT_MODEL.md`, `CONFORMANCE.md`, and `ROADMAP.md`.
- Release candidate notes and checklist updates for
  `@underskys/air-core@0.45.0`.

### Changed

- Package version prepared as `@underskys/air-core@0.45.0` for the next public
  alpha release candidate.
- Public version policy now keeps `@underskys/air-core@0.44.1` as the first
  published public alpha and reserves `0.44.2` only for urgent fixes to that
  already published package.
- README/docs/positioning/roadmap/release-governance work accumulated as
  internal `v0.45` slices (`M45-S1`, `M45-S2`, ...) for the npm public alpha
  release candidate `@underskys/air-core@0.45.0` with future dist-tag `alpha`.
- Patch versions are no longer used for unpublished internal work.
- Package description now presents AIR as a verifier-first programming
  language and CLI for AI-authored deterministic components that hosts can
  compose into tools, games, simulations, robotics policies, and 3D scenes.
- README now clarifies AIR as a verifier-first programming language/toolchain
  for AI-authored deterministic components.
- README now states that `.air` source files are unrelated to Adobe AIR.
- README top-level framing now uses bounded deterministic components and
  host-composed systems instead of small/micro module positioning.
- README Docs Links now use absolute GitLab URLs so they work from npm package
  rendering.
- README now uses strict anti-overclaim language for public alpha.
- Public npm package identity changed to `@underskys/air-core`; AIR remains the
  project name and `airc` remains the CLI. Version `0.44.0` was kept as a tag
  because npm blocked the unscoped `air-core` name as too similar to an
  existing package.
- Public-alpha governance docs now cover installability, conformance,
  package files, promise debt, and request ledger validation.
- No compiler, verifier, AIR ABI, Host ABI, or math implementation behavior
  changed.

### Fixed

- Public docs now avoid unsupported claims about formal methods, security, and
  performance.

### Security

- Public security documentation now states what AIR does and does not protect
  against.

### Breaking / Migration

- None.

## v0.42 - Resource Validators & ReviewPolicy Hard Gates

### Added

- Resource Validators RFC.
- ReviewPolicy Hard Gates RFC.
- API gates plan for resource/reviewPolicy surfaces.

### Changed

- Public release hygiene and Apache-2.0 licensing work prepared the repository
  for alpha launch review.

### Fixed

- Public-clean audit docs classify public-now, public-later, and excluded
  repository paths.

### Security

- Resource validation and reviewPolicy hard-gate plans keep validators
  deterministic and outside language semantics.

### Breaking / Migration

- None.

## v0.41 - Declared Fixed-Capacity Pools First Slice

### Added

- Declared fixed-capacity pool source syntax.
- `pool.capacity`.
- `pool.get.i32`, `pool.get.bool`, `pool.set.i32`, and `pool.set.bool`.
- Verifier checks for fixed positive capacity, required `active:bool`, allowed
  scalar field types, access bounds, and rejected unsupported pool surfaces.
- Report/evidence/diff visibility for pool metadata.
- v0.41 API gates.

### Changed

- reviewPolicy distinguishes declared pools from accidental mutable slot-family
  patterns.

### Fixed

- None.

### Security

- Pools remain fixed-capacity, scalar-only, and compiler-managed. No runtime
  JSON/object model, dynamic maps, GC, host object handles, or Host ABI
  expansion were added.

### Breaking / Migration

- Dynamic loop fuel cap: verifier/lowering behavior caps verifier-visible
  dynamic loop execution at `4096`.
- Why: recursive and arbitrary unbounded loops weaken AIR's bounded execution
  story and can fail only at runtime stack/fuel limits.
- What breaks: AIR modules relying on dynamic loops above `4096` iterations or
  verifier-unbounded execution forms must be rewritten.
- How to migrate: split work into host-owned batching, bounded AIR invocations,
  or static `loop.fold` counts at or below `4096`.
- How to test: run `npm test`, then add a negative fixture for counts above
  `4096` and a positive fixture for `4096`.

## v0.40 - Declared Fixed-Capacity Pools RFC & Gates

### Added

- Declared Fixed-Capacity Pools RFC.
- v0.40 API gates that rejected active pool implementation before the v0.41
  decision lock.

### Changed

- Clarified pool vs fixed state vs readonly tablegroup.

### Fixed

- None.

### Security

- Documented kill criteria for dynamic allocation, GC, runtime JSON, object
  identity, host object handles, and platform-specific APIs.

### Breaking / Migration

- None.

## v0.39 - Executable Package Composition / Authored Graph Runtime

### Added

- Executable package composition first slice.
- Authored graph vs executable graph ownership model.
- Deterministic linked executable output.
- Multi-module conformance fixture and negative unresolved/private import tests.
- v0.39 API gates.

### Changed

- Reports/evidence preserve authored ownership while executable output remains
  derived.

### Fixed

- None.

### Security

- Executable graph cannot introduce capabilities/effects absent from authored
  graph.

### Breaking / Migration

- None.

## v0.38 - End-to-End Execution Proof & AI Eval Capture

### Added

- `airc run-proof` first slice.
- `airc eval-ai import` for deterministic local capture/import scoring.
- E2E evidence report distinctions and benchmark fixture.
- v0.38 API gates.

### Changed

- Evidence reports can distinguish static validation, package policy,
  conformance replay, runtime execution proof, and host policy simulation.

### Fixed

- None.

### Security

- Capture/import rejects secret-like content, provider metadata, raw URLs, and
  nondeterministic live-provider data.

### Breaking / Migration

- None.

## v0.37 - Readonly Tablegroups First Slice

### Added

- Readonly tablegroup syntax and `tablegroup.get`.
- Equal-length and bounds validation.
- Lowering to existing static table machinery.
- Report/evidence visibility and anti-slop diagnostics.
- v0.37 API gates.

### Changed

- reviewPolicy can suggest readonly tablegroups for related static row data.

### Fixed

- None.

### Security

- Tablegroups are readonly, fixed-length, scalar-only, and do not add Host ABI
  authority.

### Breaking / Migration

- None.

## v0.36 - Consumer Evidence Corpus & Demo Pressure Intake

### Added

- `consumer_evidence/` skeleton, schemas, validator, separate evidence bundle,
  and seeded safe entries.

### Changed

- Demos are classified as pressure evidence, not Core authority.

### Fixed

- None.

### Security

- Consumer evidence excludes full demo bundles, large assets, raw logs, secrets,
  and private data.

### Breaking / Migration

- None.

## v0.35 - Read-only Consumer Proof & Product Evidence Pack

### Added

- lan-observer-style read-only proof package.
- Sanitized structured facts, bounded output intent, mock host policy,
  evidence report, package diff, replay, benchmark, AI eval case, and
  unsafe-to-safe rejection story.

### Changed

- Active docs and review artifacts aligned with v0.35 proof scope.

### Fixed

- None.

### Security

- Proof uses no real network access, writes, secrets, raw hostnames, MACs, IPs,
  or raw host authority.

### Breaking / Migration

- None.

## v0.34 - Documentation, Agent Context, and Workflow Automation Hygiene

### Added

- Slim README, CHANGELOG, examples/demos classification, and agent finish
  workflow automation.

### Changed

- Milestone history moved out of README.

### Fixed

- Review bundles include mobile summary and review request artifacts.

### Security

- No compiler/runtime changes.

### Breaking / Migration

- None.

## Earlier Milestones

- v0.33 added AI authoring eval and verifier safety deepening.
- v0.32 added bounded structured IO first slice, AI authoring replay mode, and
  verifier safety scaffolding.
- v0.31 planned bounded structured IO gates.
- v0.30 added evidence review surface and package diff first slice.
- v0.29 added benchmark report first slice.
- v0.28 hardened generated output handles for bounded `output.emit`.
- v0.27 stabilized Host ABI `0.11` for bounded `output.emit`.
- v0.26 introduced Host ABI `0.11` bounded `output.emit`.
- v0.25 added host interaction evidence and mock host policy.
- v0.24 planned generated state handles.
- v0.23 implemented fixed bounded state first slice.
- v0.22 planned fixed bounded state.
- v0.21 rebaselined API surfaces and host interaction contracts.
- v0.20 added verification evidence, bounded rowsets, and command buffers.
- v0.19 added compact static tables planning and diagnostics-only LSP.
- v0.18 added bounded facts and output contract tooling.
- v0.10 established AIR ABI `0.10`.
