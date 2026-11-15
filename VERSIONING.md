# Versioning

AIR uses several version axes. They are related, but they do not mean the same
thing.

## Product / Package Version

The product/package version identifies an AIR release artifact such as the npm
package metadata in `package.json`.

AIR is the project name. `@underskys/air-core` is the npm package. `airc` is the CLI.

Current package:

- `@underskys/air-core@0.53.0`, with the typed-v0.53 source profile as a candidate

0.52.0 and 0.52.1 were never published; 0.51.0 is the last published version
before 0.53.0. The entries below are history.

Published public alpha baseline:

- `@underskys/air-core@0.44.1`

Active public alpha release candidate:

- `@underskys/air-core@0.45.1` with npm dist-tag `alpha`

Published public alpha:

- `@underskys/air-core@0.45.0`

Alpha releases may change behavior. Breaking semantic changes require a
migration note. Publishing is a separate release action and is not implied by a
version field change.

`0.44.2` is not a planned public npm release. Use `0.44.2` only for an urgent
package-breaking fix to the already published `0.44.1` package. Accumulate
README, docs, positioning, roadmap, and release-governance work accumulated as
internal `v0.45` slices for the public alpha release candidate `0.45.0`.

## Milestone Version

Milestone versions such as `v0.42` or `v0.43` describe roadmap slices and
review scope. A milestone may be documentation-only, implementation-focused, or
release-hygiene focused.

Milestone versions do not automatically change AIR ABI or Host ABI.

## Internal Slices vs Public Package Versions

Milestone versions such as `v0.45` and `v0.46` may be split into internal slice
ids such as `M45-S1`, `M45-S2`, and `M45-S3`.

Internal slices are not npm versions. Public package versions use package
versions such as `0.45.0` and later patch releases.

Rules:

- do not burn npm patch numbers for unpublished internal work;
- patch versions are only for fixes to already-published packages;
- semantic tightening needs migration notes and consumer replay where relevant.

Example `v0.45` slices:

- `M45-S1`: release hygiene and quickstart;
- `M45-S2`: anti-hallucination demo;
- `M45-S3`: MathLab consumer-demo pressure;
- `M45-S4`: demo portfolio index;
- `M45-S5`: external smoke and launch readiness.

## AIR ABI Version

The AIR ABI version describes the executable AIR module/runtime contract.

Current AIR ABI:

- `0.10`

AIR ABI changes require explicit review, migration notes, and compatibility
matrix updates.

In 0.53.0, AIR ABI `0.10` and `0.11` are unchanged. typed-v0.53 artifacts with
borrowed (memory-view) exports use the lane `0.13`. AIR ABI `0.12` remains a
candidate.

## Host ABI Version

The Host ABI version describes the host import/signature/semantic contract.

Current Host ABI:

- latest: `0.11`
- baseline supported for packages without bounded `output.emit`: `0.10`

Host ABI `0.11` is limited to bounded `output.emit`. Host ABI changes require
explicit review and compatibility matrix updates.

In 0.53.0, Host ABI capability lanes `0.10` and `0.11` are unchanged. The
execution-host interface of typed-v0.53 borrowed-lane artifacts is versioned by
the host-adapter contract `typed-v0.53.v1`, not by a Host ABI number (see
`docs/VERSION_AND_ABI_POLICY.md`).

## Source Profile Version

A source profile id pins one source language. It is a separate version axis,
apart from the milestone, the package version, AIR ABI, Host ABI, the Host
Contract version, and package and report schema versions. The registered ids are
`legacy-v0.50` (the default), `typed-v0.51` and `typed-v0.53`. In 0.53.0,
`typed-v0.53` is a candidate profile: select it with `--source-profile typed-v0.53
--allow-candidate-profile` (SDK: `allowCandidateProfile: true`).

A profile id pins all of the following, each part of its compatibility promise:

1. the grammar;
2. the accepted and rejected program sets;
3. the canonical formatter output;
4. every stable diagnostic code and its meaning;
5. the observable runtime behaviour of accepted programs, including failure
   identities;
6. the WorkBound cost table version that applies to it.

A change to a frozen profile (`legacy-v0.50`, `typed-v0.51`) is valid only as an
explicit correction record. Its class is one of:

- `FAIL_CLOSED_NARROWING`: a previously accepted input, or a previously
  "verified" claim, becomes a stable rejection, `unknown` or `unsupported`; no
  correct successful result changes value;
- `IDENTITY_REFINEMENT`: a failure that already happened (a raw trap, an uncoded
  message, a `TypeError`) gets a stable code and location; accept and reject
  dispositions are unchanged;
- `NORMATIVE_DEFECT_REPAIR`: on an exactly defined defect domain, behaviour
  changes from the incorrect result to the normative one.

No class may make a previously rejected program accepted. That would be profile
growth, and it needs a new profile id. Historic evidence, digests and hashes are
never rewritten by a correction record.

## Spec Version

The spec version describes the documented language, package, and host-profile
surface. AIR currently treats the public spec as part of the `0.10` family while
the package version and milestone version move independently.

## Conformance Suite Version

The conformance suite version is the repository test and fixture state used to
check compatibility. Public conformance claims should include the repository
commit and commands used to reproduce them.

## Compatibility Matrix

| Product version | Milestone | AIR ABI | Host ABI | Spec | Conformance | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `@underskys/air-core@0.44.1` | first published public alpha | `0.10` | `0.11` latest, `0.10` baseline | `0.10` family | repository tests and fixtures | Published public alpha baseline. |
| `@underskys/air-core@0.45.0` | published public alpha | `0.10` | `0.11` latest, `0.10` baseline | `0.10` family | repository tests and fixtures plus release gates | Public positioning, documentation, roadmap, and release-governance release. No new math implementation. |
| `@underskys/air-core@0.45.1` | Show HN presentation patch candidate | `0.10` | `0.11` latest, `0.10` baseline | `0.10` family | package presentation and release gates | README/package presentation fix only. No compiler, verifier, AIR ABI, Host ABI, or feature behavior changed. |
| `@underskys/air-core@0.52.0` | technical release candidate | `0.10` | `0.11` latest, `0.10` baseline | `0.10` family | repository tests and fixtures | Never published. Its content is part of 0.53.0. |
| `@underskys/air-core@0.52.1` | bounded soundness maintenance | `0.10` | `0.11` latest, `0.10` baseline | `0.10` family | repository tests and fixtures | Never published. Its content is part of 0.53.0. |
| `@underskys/air-core@0.53.0` | current package; typed-v0.53 candidate profile | `0.10` and `0.11` unchanged; typed-v0.53 borrowed lane `0.13`; `0.12` a candidate | `0.11` latest, `0.10` baseline; host-adapter contract `typed-v0.53.v1` | `0.10` family plus the typed-v0.53 RFC | repository tests, the installed-package gate and release gates | See `CHANGELOG.md` and the 0.53.0 release notes. |

## Policy

- Alpha releases can break behavior.
- Breaking semantic changes require a changelog migration note.
- Do not burn npm patch versions for unpublished internal work.
- Patch versions are only for fixes to already-published packages.
- AIR ABI changes require an explicit AIR ABI version bump.
- Host ABI changes require compatibility matrix updates.
- Evidence reports and conformance results should name the exact commit and
  command list used.
