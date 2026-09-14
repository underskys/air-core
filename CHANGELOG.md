# AIR Changelog

This changelog keeps public milestone history out of the README. It uses a
compact format:

- Added
- Changed
- Fixed
- Security
- Breaking / Migration

## v0.52.0 - Verified Typed Runtime Candidate

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
