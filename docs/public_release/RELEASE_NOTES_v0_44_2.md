# AIR v0.44.2 Release Notes

Status: historical release-candidate note; not the next planned npm publish.

Version policy update: `@underskys/air-core@0.44.1` remains the first published
public alpha. Do not publish `0.44.2` unless there is an urgent
package-breaking fix to `0.44.1`. README/docs/positioning/roadmap and
release-governance work now accumulates as internal `v0.45` slices for the next
planned public npm alpha `@underskys/air-core@0.45.0` with dist-tag `alpha`.

Package: `@underskys/air-core@0.44.2`

Planned tag: none. Use `v0.44.2` only for an urgent patch; otherwise the next
planned public tag is `v0.45.0`.

AIR is the project name. `@underskys/air-core` is the npm package. `airc` is the CLI.

Emergency-only manual publish command, for the human maintainer only:

```sh
npm publish --access public --tag alpha
```

Codex must not run publish and must not receive npm credentials.

## Summary

This is a public alpha patch for AIR Core package positioning and npm-rendered
documentation. It packages the reference CLI, parser/verifier/lowering
implementation, spec files, stdlib, selected public examples, and public
conformance fixtures.

AIR is a verifier-first programming language and toolchain for AI-authored
deterministic components. Hosts own real platform authority. AIR owns
deterministic logic, capability/effect checks, bounded execution under the
verifier model, and evidence reports for human review.

This release does not claim formal verification, compiler verification, or
general-purpose language coverage.

## Included

- updated README positioning and npm-rendered docs links;
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

## Installation Policy

For the normal alpha channel, install the published package with:

```sh
npm install -g @underskys/air-core@alpha
airc version --json
airc check <path-to-module.air>
```

For historical one-off local testing of the abandoned `0.44.2` candidate, use
the local tarball workflow in [npm Tarball Smoke v0.44.2](NPM_TARBALL_SMOKE_v0_44_2.md).

## Compatibility

| Surface | Version / status |
| --- | --- |
| Package version | `0.44.2` |
| AIR ABI | `0.10` |
| Host ABI latest | `0.11`, limited to bounded `output.emit` |
| Host ABI baseline | `0.10` supported |

Alpha releases may break. AIR ABI or Host ABI changes require explicit version
and compatibility documentation.

## Public Conformance Status

The repository conformance and release checks are the public reproducibility
surface for this release. Independent `air-tests 74/74` is not claimed from this
public package unless the exact public-clean suite is added and reproduced from
the repository.

See [Conformance](../../CONFORMANCE.md) and [Conformance Reproduction Summary](CONFORMANCE_REPRODUCTION_SUMMARY.md).

## Local Tarball Smoke Result

The v0.44 tarball smoke created `underskys-air-core-0.44.2.tgz`, inspected the
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

See [npm Tarball Smoke v0.44.2](NPM_TARBALL_SMOKE_v0_44_2.md).

## Before Publish

Before publication, a human maintainer should complete:

- [Publish Checklist](PUBLISH_CHECKLIST.md)
- [npm Package Files Plan](NPM_PACKAGE_FILES_PLAN.md)
- [npm Pack Dry-Run Summary](NPM_PACK_DRY_RUN_SUMMARY.md)
- [npm Tarball Smoke v0.44.2](NPM_TARBALL_SMOKE_v0_44_2.md)
- [Public Install Check](PUBLIC_INSTALL_CHECK.md)

Codex must not publish and must not handle npm credentials.

## Known Limitations

- AIR is not a general-purpose language.
- AIR does not protect against a malicious host.
- AIR does not prove business correctness or host policy correctness.
- Consumer evidence and demo pressure do not define Core semantics.
- Browser playground, MCP demo, and demo hosting are deferred.
