# AIR v0.45.0 Release Notes

Status: published public alpha.

Package: `@underskys/air-core@0.45.0`

Tag: `v0.45.0`

Npm dist-tag: `alpha`

Install:

```sh
npm install -g @underskys/air-core@alpha
airc version --json
```

## Summary

v0.45.0 shipped the next AIR Core public alpha from the public `air-core`
repository. It is a public positioning, governance, roadmap, README, npm
metadata, package-surface, and release-hygiene release.

`@underskys/air-core@0.44.1` remains the first published public alpha. `0.44.2`
is reserved only for an urgent package-breaking fix to `0.44.1`; it is not the
normal next public release.

## Included

- Package identity shipped as `@underskys/air-core@0.45.0`.
- CLI remains `airc`.
- License remains `Apache-2.0`.
- README first screen and npm-rendered docs links are release-ready.
- Public version policy distinguishes internal `M45-S*` slices from npm
  package versions.
- Release governance documents classify v0.45 as public-clean roadmap and
  positioning work.
- Publish checklist and CI release path targeted `v0.45.0` and dist-tag
  `alpha`.
- Package surface remains limited to Core/spec/CLI/conformance surfaces and
  launch-safe public examples.

## Not Included

- No compiler, verifier, or lowerer behavior change.
- No AIR ABI change.
- No Host ABI change.
- No new math implementation.
- No `exp`, `log`, or `pow` implementation.
- No compiler, verifier, or lowerer feature addition.
- No private `airlang` review bundle copied wholesale.
- No prompts, private notes, generated archives, review results, or demo build
  outputs added to the public package source.

## ABI Status

| Axis | v0.45.0 status |
| --- | --- |
| AIR ABI | remains `0.10` |
| Host ABI | latest remains `0.11`; `0.10` baseline remains supported |
| Spec family | remains `0.10` family |
| Package version | `0.45.0` |

## Verification

The release passed:

```sh
npm ci
npm test
npm run test:bundle
npm run check:public-package-surface
npm run check:public-claims
node scripts/check_markdown_links.js
node scripts/check_request_ledger.js
node scripts/check_abi_requests.js
node test/layer_guard.test.js
git diff --check
npm pack --dry-run --json
npm pack
```

Local tarball smoke verified:

```sh
npm install <repo>/underskys-air-core-0.45.0.tgz
./node_modules/.bin/airc version --json
./node_modules/.bin/airc --help
```

## Release Blockers Cleared

- Release gates and package-surface checks passed before publication.
- Active install docs used the scoped package name.
- The npm package surface excluded raw review bundles, prompts, private notes,
  generated archives, demo build outputs, `public_export`, and `node_modules`.
- No AIR ABI or Host ABI delta was included.
- v0.45.0 did not add new math behavior.
