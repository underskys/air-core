# AIR Back-Sync to Dev

Status: active release policy

`air-core` is the public release projection of AIR. `airlang` is the
private/dev/latest repository. Public truth finalized in `air-core` must be
back-synced into `airlang` so dev work stays aligned with current release
state.

## Back-Sync Scope

README, npm metadata, public docs, release roadmap, release decisions, CI
policy, package surface policy, and release hygiene changes made in `air-core`
should be back-synced into `airlang`.

Back-sync is a separate task. A public release commit landing in `air-core`
does not automatically mutate `airlang`.

## Back-Sync Prohibitions

Back-sync must not carry:

- npm tarballs;
- generated `tgz` or `zip` release artifacts;
- review bundles;
- generated release bundles;
- private release tokens;
- local machine paths;
- CI secrets or npm credentials.

## Purpose

Back-sync keeps `airlang` aligned with the latest public truth while preserving
the direction of authority:

- `airlang` remains private/dev/latest;
- `air-core` remains public release and npm source;
- public package identity stays `@underskys/air-core`;
- release policy changes are not lost when dev work continues.
