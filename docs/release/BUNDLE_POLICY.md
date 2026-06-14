# AIR Bundle Policy

Status: active policy

AIR uses separate bundle kinds for public releases, release hygiene, consumer
demo pressure, and private/internal development. Bundle kind determines whether
a bundle may be used for npm/tag release, committed, or npm-packaged.

Bundle promotion follows [Artifact Review Protocol](ARTIFACT_REVIEW_PROTOCOL.md).
Review bundles are artifacts; they are never npm package contents.

## Bundle Kinds

| Bundle kind | Allowed source | Release allowed | Can be committed | Can be npm-packaged | Purpose |
| --- | --- | --- | --- | --- | --- |
| `core-release` | `air-core` `main` or `release/*` | yes, if clean and green | manifest/reports yes; generated bundle no | source package yes; bundle no | Public npm/tag release candidate. |
| `core-hygiene` | `air-core` release-owned docs/npm/CI branch | no direct publish; merge-only | manifest/reports yes; generated bundle no | no | Release docs, npm metadata, CI, public package surface, and smoke hygiene. |
| `consumer-demo` | demo repo, demo branch, or consumer pressure branch | no | pressure report yes; generated bundle no | no | Showcase/demo/consumer pressure evidence. |
| `internal-dev` | private `airlang` or local private worktrees | no | no in `air-core` | no | Private development, experiments, and historical reference. |

## Required Manifest Fields

Every release-adjacent bundle must include a manifest with:

- `bundleKind`;
- `repo`;
- `branch`;
- `commit`;
- `dirtyTree`;
- `releaseAllowed`;
- `npmPackage`;
- `packageVersion`;
- `airAbi`;
- `hostAbi`;
- `generatedAt`;
- `includedPaths`;
- `excludedPaths`;
- `checksRun`;
- `knownLimitations`;
- `pressureRequests`;
- `releaseDecision`.

Use [Bundle Manifest Template JSON](BUNDLE_MANIFEST_TEMPLATE.json).

## Forbidden Contents

No bundle kind may include secrets, npm tokens, private keys, or unreviewed
private material.

`core-release` and `core-hygiene` must exclude:

- review bundles and raw review bundle directories;
- `build/review-bundles/`;
- generated `*.zip`, `*.tgz`, `*.tar`, and `*.tar.gz` archives;
- `public_export/`;
- raw prompts and prompt logs;
- `REVIEW_RESULTS/`;
- `MOBILE_SUMMARY.md`;
- `REVIEW_REQUEST.md`;
- demo build outputs;
- `node_modules/`;
- private notes and private pressure docs.

`consumer-demo` bundles must include a pressure report. They are not release
artifacts and cannot define Core semantics or Host ABI authority.

`internal-dev` bundles are private-only and must not be committed into
`air-core`.

## `core-release`

Requirements:

- source is `air-core` `main` or `release/*`;
- working tree is clean;
- release checks are green;
- package is `@underskys/air-core`;
- no generated tarballs, raw review bundles, prompt logs, private paths,
  `MOBILE_SUMMARY.md`, `REVIEW_REQUEST.md`, or `public_export/`;
- no demo/consumer/private artifacts in public package surface;
- bundle manifest marks `releaseAllowed: yes`.
- includes `CHANGESET_SUMMARY.md`, `QA_REPORT.md`, `RELEASE_DECISION.md`, and
  `BUNDLE_MANIFEST.json`.

Allowed use:

- public release review;
- release tag preparation;
- npm package publish by a human maintainer or protected manual CI job.

## `core-hygiene`

Requirements:

- source is a release-owned hygiene branch;
- work is limited to docs, npm metadata, CI, public package surface, smoke
  checks, and release notes;
- no compiler/verifier behavior changes;
- no AIR ABI or Host ABI changes;
- no feature or demo implementation.

Allowed use:

- merge into `main`;
- produce review bundles for release-owner review.
- use `CHANGESET_SUMMARY.md`, `QA_REPORT.md`, and `BUNDLE_MANIFEST.json`.

Not allowed:

- direct npm publish;
- release tag without merge into a release-allowed lane.

## `consumer-demo`

Requirements:

- source is a demo branch, demo repository, or explicit consumer pressure
  branch;
- bundle includes a pressure report;
- bundle pins the `@underskys/air-core` version used;
- bundle identifies which pressure items are Core requests, kit requests,
  host-owned work, or project-local work.
- includes `PRESSURE_REQUEST.md` and `BUNDLE_MANIFEST.json`.

Allowed use:

- request ledger input;
- demo review;
- public showcase evidence if separately sanitized.

Not allowed:

- npm release;
- public Core release tag;
- defining AIR Core semantics or Host ABI authority.

## `internal-dev`

Requirements:

- private only;
- contains no public-release assumptions;
- cannot be shared externally without a public-clean export.

Allowed use:

- research and planning.

Not allowed:

- npm release;
- public release tag;
- public bundle without sanitation.

`internal-research` is a legacy label for older internal/private bundles. Use
`internal-dev` for new manifests.

## Minimum Bundle Rule

Every release-adjacent bundle should include a bundle manifest based on
[Bundle Manifest Template JSON](BUNDLE_MANIFEST_TEMPLATE.json). The canonical
machine artifact is named `BUNDLE_MANIFEST.json`. Missing manifest means the
bundle is not release-allowed.

## NPM Exclusion Rule

The following must never enter npm package contents:

- review bundles;
- `REVIEW_RESULTS/`;
- `MOBILE_SUMMARY.md`;
- `REVIEW_REQUEST.md`;
- raw prompts;
- prompt logs;
- snapshots;
- private review zips;
- demo build outputs;
- `consumer_evidence/`;
- private/internal artifacts.

The package surface must remain allowlisted and checked by
`scripts/check_public_package_surface.js`.

Release bundles may be CI/GitLab artifacts, not npm contents. Review bundles
are normally gitignored generated artifacts.
