# AIR Repository Roles

Status: active process policy

AIR is the product, language, and toolchain name. `@underskys/air-core` is the
public npm package. `airc` is the CLI.

## `air-core`

`air-core` is the public, production, and release source of truth.

Public npm package work, release tags, public docs, release checks, package
surface checks, and release review all happen from this repository. Only
`air-core` `main` and approved `release/*` branches can be tagged or published.

## `airlang`

`airlang` is private, dev, reference, and experimental source.

For release work it is read-only by default. AIR must not be released directly
from `airlang`, and `airlang` content must not be copied wholesale into
`air-core`.

## Demos

Demos are consumer pressure and showcase material. They are not AIR Core release
source and do not define Core semantics, AIR ABI, or Host ABI authority.

## Transfer Rule

Dev/private changes enter `air-core` only by public-clean cherry-pick or an
explicit recreated diff. Raw private artifacts, review zips, snapshots, prompts,
personal notes, and private demo contents must not be copied into `air-core`.

All pressure requests must use the existing `requests/` ledger.

## Release Rule

Review bundles are review artifacts, not npm package contents. The public npm
package surface is controlled by `package.json` `files` and
`scripts/check_public_package_surface.js`.

