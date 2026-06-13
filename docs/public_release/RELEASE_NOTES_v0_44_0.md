# AIR Core v0.44.0 Release Notes

Status: release candidate notes for manual `air-core@0.44.0` public alpha
publish.

AIR is the project name. `air-core` is the npm package. `airc` is the CLI.

Planned git tag: `v0.44.0`

Planned npm dist-tag: `alpha`

Manual publish command, for the human maintainer only:

```sh
npm publish --access public --tag alpha
```

Codex must not publish and must not receive npm credentials.

## Summary

AIR Core v0.44.0 is a public alpha packaging release for AIR's reference CLI,
verifier, package checks, specs, selected public examples, and launch-safe
documentation.

AIR is a verifier-enforced IR/language for bounded deterministic modules. Hosts
own real platform authority. AIR owns deterministic logic, capability/effect
checks, bounded execution under the verifier model, and evidence reports for
human review.

This is not a 1.0 compatibility promise.

## Included

- `airc` CLI entrypoint through `bin/airc.js`;
- Core parser, formatter, verifier, lowering, package checks, and reporting;
- public specs and version/ABI docs;
- launch-safe examples under `examples/public/`;
- public package surface checks;
- request ledger and promise-debt governance docs;
- public conformance status docs;
- Apache-2.0 license metadata.

## Not Included

- npm token or automated npm publish by Codex;
- browser playground;
- MCP demo;
- VS Code extension;
- raw review bundles;
- prompt logs or chat transcripts;
- consumer evidence corpus in the npm package;
- demo source trees;
- host implementations;
- kits;
- external demo migration.

## Installation After Publish

After the human maintainer publishes the alpha package:

```sh
npm install -g air-core@alpha
airc version --json
airc check <path-to-module.air>
```

## Compatibility

| Surface | Version / status |
| --- | --- |
| npm package | `air-core@0.44.0` |
| npm dist-tag | `alpha` |
| CLI | `airc` |
| AIR ABI | `0.10` |
| Host ABI latest | `0.11`, limited to bounded `output.emit` |
| Host ABI baseline | `0.10` supported |

Alpha releases may break. AIR ABI or Host ABI changes require explicit version
and compatibility documentation.

## Public Conformance Status

The repository conformance and release checks are the public reproducibility
surface for this alpha. Independent `air-tests 74/74` is not claimed from this
public package unless the exact public-clean suite is included and reproduced
from the repository.

See [Conformance](../../CONFORMANCE.md) and [Conformance Reproduction Summary](CONFORMANCE_REPRODUCTION_SUMMARY.md).

## Claims Boundary

This release does not claim:

- compiler verification;
- complete sandbox coverage;
- business-policy correctness;
- host-policy correctness;
- general-purpose language coverage.

AIR enforces the AIR module boundary under AIR's verifier model. A malicious or
incorrect host remains out of scope.

## Before Publish

Before publication, a human maintainer should complete:

- [Publish Checklist](PUBLISH_CHECKLIST.md)
- [npm Package Files Plan](NPM_PACKAGE_FILES_PLAN.md)
- [npm Pack Dry-Run Summary](NPM_PACK_DRY_RUN_SUMMARY.md)
- [Public Install Check](PUBLIC_INSTALL_CHECK.md)

Codex must not publish and must not handle npm credentials.
