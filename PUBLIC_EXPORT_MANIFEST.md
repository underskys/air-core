# Public Export Manifest

- Source private commit: 19c04e0
- Product: AIR
- Public repository: git@gitlab.com:fd.skyrealm/air-verifier.git
- npm package: air-verifier
- Package version: 0.43.0-alpha.1
- CLI binary: airc
- AIR ABI: 0.10
- Host ABI: 0.11 latest, limited to bounded output.emit

## Included Top-Level Paths

- .gitignore
- .gitlab-ci.yml
- .npmignore
- AGENTS.md
- AUTHORS
- CHANGELOG.md
- CONFORMANCE.md
- CONTRIBUTING.md
- LICENSE
- METHOD.md
- NOTICE
- NOTICE.md
- README.md
- ROADMAP.md
- SECURITY.md
- SHOWCASE.md
- THREAT_MODEL.md
- VERSIONING.md
- WHY_AIR.md
- benchmarks
- bin
- consumer_evidence
- data
- demo
- docs
- evals
- examples
- hosts
- package-lock.json
- package.json
- prompts
- requests
- kits
- scripts
- spec
- src
- stdlib
- test
- tools

## Excluded Categories

- private Git history and private repository remotes
- raw review bundles and generated review metadata
- snapshots and generated archives
- local build, dist, tmp, and node_modules output
- external demo implementation trees; only a `demo/README.md` placeholder is included to preserve historical documentation links
- host implementation trees and kits are excluded from the npm package; tracked host/kit sources are included in the public repository only because the public test suite references them.
- large media and generated tarballs
- AppleDouble and macOS metadata files
- large unreferenced public-launch images
- realistic-looking fake credential strings in negative tests; public export uses
  non-provider-shaped sentinel values while preserving rejection behavior

## Smoke Commands

```sh
npm test
npm run test:bundle
npm run check:public-package-surface
npm pack --dry-run --json
npm pack
```

## Notes

AIR is the project name. `air-verifier` is the npm package. `airc` is the CLI.
Consumer evidence and request-ledger files included in this repository are governance/evidence surfaces; the npm package whitelist excludes them from the published package surface.
