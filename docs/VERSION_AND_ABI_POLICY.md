# AIR Version And ABI Policy

Status: active policy

This document defines version meanings for AIR Core planning and releases.
Project milestone versions do not automatically change AIR ABI or Host ABI.

## Version Meanings

| Version | Meaning | Owner |
| --- | --- | --- |
| Project milestone version | Planning/release milestone such as v0.22 or v0.23. | Roadmap/release docs. |
| Compiler/package version | Version of the npm/package/tooling distribution. | `package.json` and release process. |
| AIR language surface version | Parser/verifier/lowering language feature surface. | Core language specs/docs. |
| AIR ABI version | Runtime/executable contract for AIR modules/packages. | AIR ABI/version source and specs. |
| Host ABI version | Public host import names, signatures, and required semantics. | Host ABI registry/specs/profiles. |
| Package schema version | `air.package.json` schema and package-check contract. | Package manifest spec. |
| Report schema version | JSON report field names and deterministic output shape. | Report/conformance docs and tests. |
| Manifest schema versions | Asset, GFX, audio, and other manifest schemas. | Individual manifest specs. |
| Source profile id | One source language: `legacy-v0.50`, `typed-v0.51`, `typed-v0.53`. See "Source Profile Axis" below. | Source profile specs and the typed-v0.53 RFC. |
| Host-adapter contract | The execution-host interface of typed-v0.53 borrowed-lane artifacts, named by their contract import (`typed-v0.53.v1`). See "Host-Adapter Contract Axis" below. | Typed memory docs (`docs/v0.53/TYPED_MEMORY.md`) and this policy. |

These versions may move independently. A release may advance the project
milestone while leaving AIR ABI and Host ABI unchanged.

## Core Rules

1. Do not bump AIR ABI automatically because the project milestone advances.
2. Do not bump Host ABI automatically because the project milestone advances.
3. Do not use version bumps as a substitute for explicit compatibility notes,
   tests, and migration policy.
4. Keep reports clear about which version is being reported.

## Current ABI Baselines

The AIR ABI baseline is `0.10`. AIR ABI `0.11` is the borrowed-slices lane of
legacy-v0.50 artifacts (`BORROWED_SLICES_AIR_ABI_VERSION` in `src/version.js`).
typed-v0.53 artifacts with borrowed (memory-view) exports use the lane `0.13`.
AIR ABI `0.12` remains a candidate. 0.53.0 changes none of `0.10` and `0.11`.

The current Host ABI latest version is `0.11`, introduced for the bounded
`output.emit(output_id:i32, arg0:i32, arg1:i32, arg2:i32, arg3:i32) -> i32`
first slice. Host ABI `0.10` remains the default/baseline compatibility target
for packages and profiles that do not use `output.emit`.

When JSON reports or benchmark reports contain a single `hostAbi` field, that
field means the Host ABI required by that package, profile, benchmark, or
report. It is not a statement that the project latest Host ABI is only that
value. Project latest Host ABI is documented here and in active release docs.

Do not infer that ABI versions should match project milestone numbers.

## Source Profile Axis

A source profile id pins one source language. It is a separate version axis,
apart from the project milestone, the compiler/package version, AIR ABI, Host
ABI, the Host Contract version, and package and report schema versions. A
profile id pins:

1. the grammar;
2. the accepted and rejected program sets;
3. the canonical formatter output;
4. every stable diagnostic code and its meaning;
5. the observable runtime behaviour of accepted programs, including failure
   identities;
6. the WorkBound cost table version that applies to it.

The registered ids are `legacy-v0.50` (the default), `typed-v0.51` and
`typed-v0.53`. In 0.53.0, `typed-v0.53` is a candidate profile: it is selected
only together with `allowCandidateProfile: true` (CLI
`--allow-candidate-profile`).

A change to a frozen profile (`legacy-v0.50`, `typed-v0.51`) is valid only as an
explicit correction record, of class `FAIL_CLOSED_NARROWING`,
`IDENTITY_REFINEMENT` or `NORMATIVE_DEFECT_REPAIR`. No class may make a
previously rejected program accepted: that is profile growth, and it needs a new
profile id. `VERSIONING.md` states the axis and the classes for users.

## Host-Adapter Contract Axis

typed-v0.53 artifacts with borrowed (memory-view) exports import one AIR
contract function, `air:contract/typed-v0.53.v1`. Their execution-host
interface (the typed admission with a trusted record, the contract import and
the owned-range guard) is versioned by that host-adapter contract id, not by a
Host ABI number. Host ABI capability lanes `0.10` and `0.11` are unchanged.

Bump rule:

- A change to the required semantics of the contract import or of the typed
  admission gets a new contract id. An existing id keeps its meaning.
- A new contract id does not change a Host ABI number, and a Host ABI change
  does not change a contract id.
- A host supplies only the contract ids it implements. An artifact whose
  contract id the host does not implement is refused at admission.

## Release-Note Statements for 0.53.0

These statements carry the AIR ABI and host decision of the typed-v0.53
borrowed lane (the owner's ABI-3 H2) into the release documents:

1. "`typed-v0.53` is a new opt-in canonical source profile. The default remains
   `legacy-v0.50`."
2. "typed-v0.53 artifacts with borrowed (memory-view) exports use a new AIR ABI
   lane `0.13` and require the AIR contract import
   `air:contract/typed-v0.53.v1`." "Host ABI capability lanes 0.10/0.11 are
   unchanged; the host execution interface changed and is versioned by the
   host-adapter contract `typed-v0.53.v1`." "AIR ABI 0.12 remains a candidate."
3. "Hosts older than 0.53 cannot instantiate these artifacts; the engine refuses
   (no AIR diagnostic is possible on shipped hosts), in every binding mode,
   copied mode included."
4. "Hosts that call exports directly must use the 0.53 admission helper with a
   trusted record (in-process) or a digest they pin from a channel they trust.
   The contract handshake is not authentication. The artifact rejects borrowed
   ranges that overlap its own memory on every host. Digest pinning, external
   mutation and reentrancy remain host duties."
5. "typed-v0.53 protection requires the typed admission API with a trusted
   record. The legacy API offers legacy guarantees for any bytes, including
   stripped or relabelled typed-v0.53 bytes."
6. "Legacy (0.50-0.52.1) artifacts behave as documented for 0.52.1, including the
   disclosed unpinned-range residual (OPEN-42 legacy cell)."
7. "The 0.53 realtime session refuses typed-v0.53 packages with
   `air.assurance.profile_unsupported`; a typed realtime session is planned for
   0.54."
8. "Migration: rebuild from typed-v0.53 source with the 0.53 compiler and run
   with the 0.53 adapter. Rollback: disable the profile; legacy artifacts are
   unaffected."

## Project Milestone Version Policy

Project milestone versions such as `v0.22` and `v0.23` describe coherent
release milestones. They do not describe individual prompts, commits, RFCs,
small cleanups, or review-bundle repairs.

A project milestone bump is justified only when the new milestone has visible
release value in at least one of these categories:

- executable feature milestone;
- substantial architecture gate milestone;
- release hardening milestone with visible user or tooling value.

Do not bump the project milestone for only:

- one RFC;
- one docs cleanup;
- one pressure request;
- one API gate;
- one example;
- one review bundle fix;
- one audit.

Large milestones may use internal implementation phases without creating new
public project milestone versions. Common internal phases are:

- Phase 1 parser/formatter;
- Phase 2 verifier/report;
- Phase 3 lowering;
- Phase 4 conformance;
- Phase 5 RC audit.

These phases should be tracked in release plans, RFCs, issues, or review notes.
They do not become public project milestone versions unless the roadmap is
explicitly re-scoped into a new coherent release milestone.

Project milestone version is not AIR ABI version. Project milestone version is
not Host ABI version. Project milestone version is also separate from the
compiler/package version. AIR ABI bumps only when the executable/runtime
contract changes. Host ABI bumps only when host imports, signatures, or required
host semantics change.

## Current Roadmap Application

Current roadmap versioning follows this policy:

- `v0.22` = Fixed Bounded State RFC & ABI Gates.
- `v0.23` = Fixed Bounded State First Executable Slice, with internal phases for
  parser/formatter, verifier/report, lowering, conformance, and RC audit.
- `v0.24` = Generated State Handles RFC and ABI gates.
- `v0.25` = Host Interaction Contract evidence and mock policy executor.
- `v0.26` = Host ABI `0.11` bounded `output.emit` first slice.
- `v0.27` = Host ABI `0.11` stabilization and adapter evidence.
- `v0.28` = Output Emit Ergonomics Hardening with generated output handles.
- `v0.29` = Performance Evidence & Runtime Efficiency Baseline.

## AIR ABI Bump Policy

Bump AIR ABI only when the runtime/executable contract changes.

Examples that may require an AIR ABI bump:

- calling convention changes;
- import/export layout changes;
- memory or data representation changes;
- stable linked multi-module executable package contract changes;
- package entrypoint runtime semantics change;
- runtime-required package metadata changes;
- Wasm-facing artifact layout changes that hosts must understand.

Examples that do not automatically require an AIR ABI bump:

- new docs or RFCs;
- `verify`, `report`, `package-check`, or `reviewPolicy` behavior that only
  changes source validation, diagnostics, or review gates;
- package-check diagnostics;
- advisory AI-review warnings;
- source-only module graph reporting;
- stricter package manifest validation that does not change executable runtime
  contract;
- generated artifact freshness checks that do not change runtime layout.

## Host ABI Bump Policy

Bump Host ABI only when public host behavior changes.

Examples that require Host ABI review and may require a Host ABI bump:

- new host import is added;
- host import signature changes;
- host import required semantics change;
- event/output Host ABI is accepted;
- host capability contract changes in a way existing hosts must implement.

Examples that do not automatically require a Host ABI bump:

- new docs or RFCs;
- host profile metadata corrections;
- package-check reporting improvements;
- manifest validation that does not add or change host imports;
- demo or kit changes that do not alter public Host ABI.

## v0.14 Policy

v0.14 is the Executable Package Composition & AIR-authored Data milestone.

Expected default:

- AIR ABI remains `0.10`;
- Host ABI remains `0.10`.

v0.14 likely keeps these ABI versions unless executable runtime contract changes
or accepted Host ABI changes land through the full promotion path.

If v0.14 only adds package-level source graph checking, generated artifact
freshness, report budgets, and planning for deterministic linking, no ABI bump
is required.

## v0.15 Policy

v0.15 may introduce AIR ABI `0.11` or Host ABI `0.11` only if the runtime
contract truly changes.

Possible triggers:

- stable linked multi-module executable package contract;
- runtime package entrypoint semantics;
- host-visible package artifact layout changes;
- accepted event/output Host ABI;
- new public host imports or changed signatures.

If v0.15 remains documentation, package-check, or profile-only work, ABI versions
should remain unchanged.

## Required Release Notes

Every release checklist should state:

- project milestone version;
- compiler/package version;
- AIR ABI version;
- Host ABI version;
- package schema version if changed;
- report schema version if changed;
- manifest schema versions if changed;
- explicit reason for any ABI bump.

If no ABI bump occurs, the release notes should say so directly.
