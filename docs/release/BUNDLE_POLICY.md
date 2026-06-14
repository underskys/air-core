# AIR Bundle Policy

Status: active policy

AIR uses separate bundle kinds for public releases, release hygiene, consumer
demo pressure, and private/internal research. Bundle kind determines whether a
bundle may be used for npm/tag release.

## Bundle Kinds

| Bundle kind | Source | Release allowed | Purpose |
| --- | --- | --- | --- |
| `core-release` | `air-core` `main` or `release/*` | yes, if clean and green | Public npm/tag release candidate. |
| `core-hygiene` | `release/v0.44.x-*` or release-owned docs/npm/CI branch | merge-only | Release docs, npm metadata, CI, public package surface, and smoke hygiene. |
| `consumer-demo` | `demo/*`, demo repositories, or pressure branches | no | Showcase/demo/consumer pressure evidence. |
| `internal-research` | private `airlang` or local private worktrees | no | Private research and historical development. |

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

Allowed use:

- request ledger input;
- demo review;
- public showcase evidence if separately sanitized.

Not allowed:

- npm release;
- public Core release tag;
- defining AIR Core semantics or Host ABI authority.

## `internal-research`

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

## Minimum Bundle Rule

Every release-adjacent bundle should include a bundle manifest based on
[Bundle Manifest Template](BUNDLE_MANIFEST_TEMPLATE.md). Missing manifest means
the bundle is not release-allowed.
