# AIR v0.43.0-alpha.1 Release Notes

Status: release candidate for manual npm alpha publish after v0.44 merge

Package: `air-verifier@0.43.0-alpha.1`

Planned tag: `v0.43.0-alpha.1`

AIR is the project name. `air-verifier` is the npm package. `airc` is the CLI.

Manual publish command, for the human maintainer only:

```sh
npm publish --access public --tag alpha
```

Codex must not run publish and must not receive npm credentials.

## Summary

This is the first public-alpha packaging candidate for AIR Core. It packages
the reference CLI, parser/verifier/lowering implementation, spec files,
stdlib, selected public examples, and public conformance fixtures.

AIR is a verifier-enforced IR/language for bounded deterministic modules.
Hosts own real platform authority. AIR owns deterministic logic,
capability/effect checks, bounded execution under the verifier model, and
evidence reports for human review.

This release does not claim formal verification, compiler verification, or
general-purpose language coverage.

## Included

- `airc` CLI entrypoint through `bin/airc.js`;
- package runtime data needed by profile-aware CLI checks under
  `data/host_profiles/`;
- Core parser, formatter, verifier, lowering, package checks, and reporting;
- public specs and version/ABI docs;
- launch-safe examples under `examples/public/`;
- public package surface checker;
- request ledger and promise-debt governance docs;
- public conformance status docs;
- Apache-2.0 license metadata.

## Not Included

- npm publish automation;
- npm tokens or API keys;
- raw review bundles;
- prompt logs or chat transcripts;
- consumer evidence corpus in the npm package;
- demo source trees;
- host implementations;
- kits;
- playground;
- MCP demo;
- VS Code extension;
- external demo migration.

## Installation After Publish

After the human maintainer publishes the alpha package, install it with:

```sh
npm install -g air-verifier@0.43.0-alpha.1
airc version --json
airc check <path-to-module.air>
```

For one-off local testing before publish, use the local tarball workflow in
[npm Tarball Smoke v0.43.0-alpha.1](NPM_TARBALL_SMOKE_v0_43_alpha_1.md).

## Compatibility

| Surface | Version / status |
| --- | --- |
| Package version | `0.43.0-alpha.1` |
| AIR ABI | `0.10` |
| Host ABI latest | `0.11`, limited to bounded `output.emit` |
| Host ABI baseline | `0.10` supported |

Alpha releases may break. AIR ABI or Host ABI changes require explicit version
and compatibility documentation.

## Public Conformance Status

The repository conformance and release checks are the public reproducibility
surface for this alpha. Independent `air-tests 74/74` is not claimed from this
public package unless the exact public-clean suite is added and reproduced from
the repository.

See [Conformance](../../CONFORMANCE.md) and [Conformance Reproduction Summary](CONFORMANCE_REPRODUCTION_SUMMARY.md).

## Local Tarball Smoke Result

The v0.44 tarball smoke created `air-verifier-0.43.0-alpha.1.tgz`, inspected the
package contents, installed it into a temporary project, and ran the packaged
`node_modules/.bin/airc` entrypoint.

Recorded result: pass.

Smoke commands covered:

- `airc version --json`;
- `airc check` on `examples/public/safe_policy/module.air`;
- `airc package-check --source-only` on `examples/public/evidence_report`;
- `airc evidence report` on `examples/public/evidence_report`.

`run-proof` was not run from the npm tarball because no public-clean proof
fixture with fixture/policy files is included in the public package surface.

See [npm Tarball Smoke v0.43.0-alpha.1](NPM_TARBALL_SMOKE_v0_43_alpha_1.md).

## Before Publish

Before publication, a human maintainer should complete:

- [Publish Checklist](PUBLISH_CHECKLIST.md)
- [npm Package Files Plan](NPM_PACKAGE_FILES_PLAN.md)
- [npm Pack Dry-Run Summary](NPM_PACK_DRY_RUN_SUMMARY.md)
- [npm Tarball Smoke v0.43.0-alpha.1](NPM_TARBALL_SMOKE_v0_43_alpha_1.md)
- [Public Install Check](PUBLIC_INSTALL_CHECK.md)

Codex must not publish and must not handle npm credentials.

## Known Limitations

- AIR is not a general-purpose language.
- AIR does not protect against a malicious host.
- AIR does not prove business correctness or host policy correctness.
- Consumer evidence and demo pressure do not define Core semantics.
- Browser playground, MCP demo, and demo hosting are deferred.
