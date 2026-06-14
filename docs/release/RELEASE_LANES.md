# AIR Release Lanes

Status: active policy

This policy separates public release work, feature/demo pressure work, and
private/internal research. It is intended to prevent accidental mixing of
release bundles, demo pressure, private artifacts, and public npm/tag work.
The artifact promotion rules are defined in
[Artifact Review Protocol](ARTIFACT_REVIEW_PROTOCOL.md).

AIR ABI remains `0.10`. Host ABI latest remains `0.11`, limited to bounded
`output.emit`. This policy does not change compiler, verifier, AIR ABI, Host
ABI, or language behavior.

## Lane A - Public Release / Hygiene

Repository:

- `git@gitlab.com:fd.skyrealm/air-core.git`
- role: production/public release source.

Branches:

- `main`
- `release/v0.44.x-*`
- future `release/*` branches owned by the release lane

Allowed work:

- `README.md` and public docs;
- npm metadata and package identity;
- CI/release workflow hygiene;
- release notes and publish checklist;
- public package surface checks;
- install, tarball, and smoke checks;
- release-lane and bundle-governance policy;
- public-claims and public-clean documentation fixes.

Forbidden in Lane A:

- compiler features;
- AIR ABI changes;
- Host ABI changes;
- demo implementation;
- robotics, MathLab, AirWorld, or other feature development;
- private/internal artifacts;
- raw review bundles, prompt logs, and generated tarballs;
- npm publish from Codex.

Only Lane A may produce a `core-release` bundle that can be used for npm/tag
release.

## Lane B - Feature / Demo / Pressure

Branches and repositories:

- `core/v0.45`;
- `demo/*`;
- separate public or private demo repositories;
- pressure/evidence branches that are not release-owned.
- role: consumer pressure, not release source.

Allowed work:

- MathLab;
- AirWorld;
- robotics policy sandbox;
- host profile pressure;
- demo migrations;
- performance experiments;
- showcase sketches;
- consumer evidence and pressure reports.

Forbidden in Lane B:

- npm publish;
- release tags;
- release docs changes without release-owner merge;
- AIR ABI changes without RFC and gate;
- Host ABI changes without RFC and gate;
- treating demo pressure as Core semantics.

Lane B bundles are consumer/demo pressure only. They may inform requests,
RFCs, examples, and future release work, but cannot be used directly for npm
release.

## Lane C - Private / Internal Research

Repositories and worktrees:

- private `airlang` repository;
- local research worktrees;
- private historical snapshots.
- role: dev/private/reference source.

Allowed work:

- private research;
- experiments;
- historical reconstruction;
- non-public notes.

Rules:

- never publish directly;
- never tag public release directly;
- never copy private artifacts into public release bundles;
- only public-clean cherry-picks or exports may enter `air-core`;
- sanitize private paths, raw prompts, private docs, large media, generated
  bundles, and credentials before any public transfer.

## Internal Slice Rule

Internal development slices use milestone slice ids such as `M45-S1`,
`M45-S2`, and `M45-S3`. Public npm/git versions use semver-like release
versions such as `0.45.0` and `0.45.1`.

Do not spend npm patch versions on unpublished internal slices. Patch versions
are for public release candidates or published public fixes.

## Release Ownership Rule

Public npm/tag release must come from Lane A only:

1. branch is `main` or `release/*`;
2. working tree is clean;
3. package is `@underskys/air-core`;
4. public checks are green;
5. no forbidden root artifacts or stale private/package references exist;
6. bundle kind is `core-release`.
7. required review artifacts exist for the promoted change:
   `CHANGESET_SUMMARY.md`, `QA_REPORT.md`, `RELEASE_DECISION.md`, and
   `BUNDLE_MANIFEST.json`.

If any condition fails, the bundle may still be useful for planning or pressure,
but it is not release-allowed.
