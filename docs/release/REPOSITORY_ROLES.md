# AIR Repository Roles

Status: active release policy

AIR is the product name. `air-core` is the repository/package transport name.
The public npm package is `@underskys/air-core`, and the public CLI binary is
`airc`.

## Production/Public Source

`/Users/sky/DEV/air-core` is the production and public source of truth for AIR
release work.

All public release work happens only from this repository:

- npm package preparation;
- release tags;
- public docs;
- public package surface checks;
- CI and publish-lane hygiene;
- release notes and release checklists.

The canonical remote is:

```text
git@gitlab.com:fd.skyrealm/air-core.git
```

## Dev/Private Reference

`/Users/sky/DEV/airlang` is dev/private/reference-only.

It may contain history, experiments, private notes, demo pressure, review
bundles, prompts, generated archives, consumer evidence, or old package
identity. None of that makes it a release source.

AIR must not be released from the dev/private repository.

## Transfer Rule

Content from `airlang` may be cherry-picked into `air-core` only through an
explicit public-clean review. The copied diff must be minimal, reviewed in
`air-core`, and limited to public-safe material.

Direct copying of private artifacts is forbidden. In particular, do not copy
raw prompts, review bundles, generated tarballs, local-path reports, private
notes, consumer evidence dumps, demo build outputs, or staging exports into the
production release tree.

## Release Rule

Before any tag, publish, or protected merge, the AIR Release State Custodian
must produce an explicit OK/STOP report from `air-core`.

No release operation may start from `airlang`.

