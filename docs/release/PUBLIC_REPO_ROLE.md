# AIR Public Repository Role

Status: active release policy

AIR is the product name. `air-core` is the public release repository, the npm
package source for `@underskys/air-core`, and the source of the public `airc`
CLI package.

## Role

`air-core` is the public release projection of AIR. It is where public release
state is finalized:

- README and npm package description;
- public docs and roadmap decisions;
- CI and release hygiene;
- public package surface;
- release notes, checklists, and package smoke evidence;
- protected manual npm publish flow.

`air-core` is not the active experimental/dev repository. It must not be used
as the place to land broad feature experiments, private review state, or
unapproved dev snapshots.

## Development Boundary

Feature development must not happen directly in `air-core` except for scoped
public release, hygiene, or bugfix branches that are reviewed against public
release constraints.

Allowed direct work in `air-core`:

- public docs, README, npm metadata, CI, and release process hygiene;
- package surface checks and release smoke checks;
- public-safe bugfixes after review;
- release notes, decisions, and roadmap clarification.

Not allowed direct work in `air-core`:

- experimental language features;
- AIR ABI or Host ABI expansion without explicit release review;
- private/dev bundle import;
- raw prompt, review, or consumer-evidence dumps;
- package identity changes away from `@underskys/air-core`.

## Promotion Rule

`airlang` is the private/dev/latest repository. All changes from `airlang` must
arrive in `air-core` through public-clean promotion. Promotion means a scoped
public-safe cherry-pick or manually recreated diff that is reviewed in
`air-core`, keeps the public package identity, and passes public release
checks.

Wholesale directory copy from `airlang` is forbidden. Raw review bundles,
private notes, prompts, demo build outputs, generated archives, local paths,
and unpublished staging exports are not valid public release inputs.
