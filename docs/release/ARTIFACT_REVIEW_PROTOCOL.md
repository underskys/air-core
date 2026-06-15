# AIR Artifact Review Protocol

Status: active policy

AIR release work is artifact-based. Chat notes, private branch memory, demo
readmes, and review bundles are not release authority. A feature, demo pressure
item, hygiene change, or release candidate is promoted only through explicit
review artifacts that identify source, scope, QA, and release decision.

This protocol does not change AIR ABI, Host ABI, compiler behavior, verifier
behavior, language semantics, or npm package contents.

## Repository Roles

`air-core` is the production public release source.

- Public npm packages, release tags, public release notes, release branches, and
  Core release bundles must originate here.
- Public package surface is allowlisted by `package.json` and checked by
  `scripts/check_public_package_surface.js`.

`airlang` is the private/dev/reference source.

- It may contain experiments, historical work, private prompts, private review
  state, and dev-only artifacts.
- It must not be published directly.
- Dev work may not be copied wholesale into `air-core`.
- Only public-clean diffs may be cherry-picked, reimplemented, or exported into
  `air-core` after review.

Demos are consumer pressure.

- Demo repositories and demo branches can produce evidence, pressure requests,
  and showcase artifacts.
- Demo pressure cannot define Core semantics or Host ABI authority.
- Demo requests must enter the request ledger or be explicitly rejected,
  archived, or routed to a kit/project layer.

## Bundle Kinds

AIR uses these bundle kinds:

- `core-release`: release candidate from `air-core` `main` or `release/*`.
- `core-hygiene`: release-owned docs/npm/CI/public-package cleanup.
- `consumer-demo`: demo or consumer pressure bundle.
- `internal-dev`: private `airlang` or local development bundle.

Only `core-release` bundles may be used for npm/tag release, and only after the
release manager runs release gates.

Review bundles are artifacts. They are never npm package contents and never
replace source review, request ledger review, release gates, or package surface
checks.

## Interaction Artifacts

Every promoted change should use the smallest complete set of artifacts below.
Templates live in [artifact templates](artifact_templates/README.md).

| Artifact | Purpose | Required for |
| --- | --- | --- |
| `PRESSURE_REQUEST.md` | Captures demo/dev/consumer pressure and routing. | `consumer-demo`, feature intake, ABI pressure. |
| `ARCHITECTURE_DECISION.md` | Records accepted/rejected design decision and boundaries. | Core behavior, ABI, verifier, package semantics. |
| `CHANGESET_SUMMARY.md` | Summarizes public-clean diff and files changed. | Any promoted diff into `air-core`. |
| `QA_REPORT.md` | Records checks, artifacts, failures, and residual risk. | Any merge/release candidate. |
| `RELEASE_DECISION.md` | Records release manager decision, gates, version, and blockers. | `core-release`, tag, publish decision. |
| `BUNDLE_MANIFEST.json` | Machine-readable bundle identity and release allowance. | All bundle kinds. |

## Promotion Flow

1. Pressure starts in a demo, private branch, issue, or request source.
2. Pressure is recorded as `PRESSURE_REQUEST.md` or a formal request ledger
   entry.
3. Architecture decision records accepted scope, rejected scope, ABI status, and
   ownership boundary.
4. Public-clean diff is created in `air-core` or cherry-picked into an
   appropriate `air-core` branch.
5. `CHANGESET_SUMMARY.md` and `QA_REPORT.md` describe what changed and what was
   tested.
6. Release manager runs gates in `air-core`.
7. `RELEASE_DECISION.md` decides merge/tag/publish or blocks it.
8. `BUNDLE_MANIFEST.json` names the bundle kind and whether release is allowed.

At no point may private artifacts, demo build outputs, prompt logs, raw review
zips, snapshots, or unreviewed wholesale dev copies enter the public package.

## Versioning Rule

Internal slices use milestone slice ids:

- `M45-S1`
- `M45-S2`
- `M45-S3`

Public versions use npm/git release versions:

- `0.45.0`
- `0.45.1`
- `0.45.2`

Do not use npm patch versions for unpublished internal slices. Patch versions
are only for fixes to already-published packages.

`@underskys/air-core@0.44.1` remains the first published public alpha. Do not
publish `0.44.2` unless an urgent package-breaking fix is required for
`0.44.1`. The next planned npm public alpha is
`@underskys/air-core@0.45.0` with dist-tag `alpha`.

## Review Rule

Dev work may not be copied wholesale into `air-core`.

Allowed transfer:

- public-clean cherry-pick;
- small reimplementation against accepted RFC/request;
- sanitized export with artifact review;
- docs-only promotion with public-clean links.

Rejected transfer:

- copying private prompts, review bundles, snapshots, local paths, private docs,
  demo build outputs, or generated bundles;
- treating demos as Core semantics;
- moving Host ABI pressure directly into `air-core` without RFC, gates, and
  compatibility review.

## NPM Rule

Review bundles never enter npm.

Forbidden npm contents include:

- raw review bundles;
- private prompts;
- snapshots;
- raw chat transcripts;
- `MOBILE_SUMMARY.md`;
- `REVIEW_REQUEST.md`;
- `REVIEW_RESULTS/`;
- `public_export/`;
- demo build outputs;
- private/internal artifacts.

The npm package surface is allowlisted and checked before release. A release is
blocked if package surface checks fail.

## Release Manager Gate

Before merge/tag/publish, the release manager must verify:

- repository lane is release-allowed;
- bundle kind is `core-release`;
- tree is clean;
- package is `@underskys/air-core`;
- public package surface check passes;
- public claims check passes;
- request ledger and ABI request checks pass;
- release decision artifact exists for the release candidate;
- AIR ABI and Host ABI status are explicit.

If any condition fails, the work may remain useful as pressure or hygiene, but
it is not a release candidate.
