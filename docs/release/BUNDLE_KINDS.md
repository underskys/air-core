# AIR Bundle Kinds

Status: active policy

Bundle kind determines source, contents, review expectations, and npm
eligibility.

## `core-release`

Source repo:

- `air-core` `main` or approved `release/*`.

Allowed contents:

- public source;
- release notes;
- QA report;
- release decision;
- bundle manifest;
- public package surface evidence.

Forbidden contents:

- private prompts;
- raw review zips;
- snapshots;
- private notes;
- demo build outputs;
- consumer evidence dumps unless explicitly public-clean and release-approved;
- generated tarballs as committed source.

Required artifacts:

- `CHANGESET_SUMMARY.md`;
- `QA_REPORT.md`;
- `RELEASE_DECISION.md`;
- `BUNDLE_MANIFEST.json`.

Eligible for npm:

- yes, only when clean, green, release-allowed, and approved by the release
  manager/human maintainer.

Reviewer expectations:

- release manager owns OK/STOP;
- QA verifies gates;
- architecture reviewer verifies ABI and boundary status when applicable.

## `core-hygiene`

Source repo:

- `air-core` release-owned hygiene branch.

Allowed contents:

- docs;
- npm metadata;
- CI;
- public package surface checks;
- smoke checks;
- release notes.

Forbidden contents:

- compiler/verifier behavior changes;
- AIR ABI changes;
- Host ABI changes;
- feature work;
- demo source changes.

Required artifacts:

- `CHANGESET_SUMMARY.md`;
- `QA_REPORT.md`;
- `BUNDLE_MANIFEST.json`.

Eligible for npm:

- no direct npm publish. Must merge into a `core-release` lane first.

Reviewer expectations:

- release manager confirms no feature/demo work is mixed in.

## `consumer-demo`

Source repo:

- demo repository, demo branch, or consumer pressure branch.

Allowed contents:

- pressure report;
- sanitized demo evidence;
- version pin for `@underskys/air-core`;
- request routing notes.

Forbidden contents:

- npm release decision;
- public release tag decision;
- Core semantics;
- Host ABI authority.

Required artifacts:

- `PRESSURE_REQUEST.md`;
- `QA_REPORT.md` when checks are run;
- `BUNDLE_MANIFEST.json`.

Eligible for npm:

- no.

Reviewer expectations:

- route pressure to request ledger, kit, project, host implementation, or reject.

## `internal-dev`

Source repo:

- private `airlang` or local private worktrees.

Allowed contents:

- private experiments;
- reference work;
- historical notes;
- local research.

Forbidden contents:

- public npm release;
- public release tag;
- direct public sharing without public-clean export.

Required artifacts:

- `BUNDLE_MANIFEST.json` if a bundle is produced.

Eligible for npm:

- no.

Reviewer expectations:

- treat as private-only unless a public-clean promotion task is created.
