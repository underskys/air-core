# AIR Dev to Production Sync Policy

Status: active release policy

This policy controls any movement from `/Users/sky/DEV/airlang` into
`/Users/sky/DEV/air-core`.

## Allowed Transfer Classes

The following classes may be considered for transfer after review:

- docs wording that is public-safe and does not expose private paths or review
  process notes;
- public-safe scripts that only check repository hygiene or release surface;
- tests that validate existing public behavior;
- examples under public example boundaries;
- bugfixes after explicit review in `air-core`.

Allowed does not mean automatic. Every transfer still needs a scoped diff in
`air-core` and release checks before merge.

## Forbidden Transfer Classes

The following classes must not be copied into `air-core` release state:

- raw prompts;
- review bundles;
- local paths;
- private notes;
- consumer evidence unless explicitly packaged and sanitized for public review;
- demos and build outputs;
- `node_modules`;
- generated tarballs;
- `MOBILE_SUMMARY.md` and `REVIEW_REQUEST.md`;
- staging exports such as `public_export`;
- generated zip archives and snapshot bundles.

## Required Process

1. Create or use a release-owned branch in `air-core`.
2. Treat `airlang` as read-only reference material.
3. Copy only the minimal public-safe diff into `air-core`.
4. Review package identity, public docs, public package surface, and release
   lane boundaries.
5. Run release checks in `air-core`.
6. Commit in `air-core` only.
7. Do not mutate `airlang` as part of release sync.

## Stop Conditions

Stop and ask for a human decision if a candidate diff changes compiler,
verifier, lowerer, AIR ABI, Host ABI, package identity, release authority,
publish automation, demo semantics, or private/public boundaries.

