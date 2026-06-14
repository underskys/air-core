# AIR Bundle Manifest Template

Use this template for release-adjacent bundles. A filled manifest should be
stored inside the bundle root.

```yaml
bundleKind: core-release | core-hygiene | consumer-demo | internal-research
repo: git@gitlab.com:fd.skyrealm/air-core.git
branch: main
commit: <full git commit>
dirtyTree: yes | no
releaseAllowed: yes | no
npmPackage: '@underskys/air-core'
packageVersion: 0.44.2
AIR_ABI: '0.10'
Host_ABI: '0.11 latest, limited to bounded output.emit; 0.10 baseline supported'
includedPaths:
  - README.md
  - package.json
  - bin/
  - src/
  - spec/
  - stdlib/
excludedPaths:
  - node_modules/
  - '*.tgz'
  - REVIEW_RESULTS/
  - snapshots/
  - prompts/
  - demo/
  - demos/
  - consumer_evidence/
generatedAt: <ISO-8601 timestamp or omitted when deterministic output is required>
checksRun:
  - npm test
  - npm run test:bundle
  - npm run check:public-package-surface
  - npm run check:public-claims
  - npm run check:release-lane
  - node scripts/check_markdown_links.js
knownLimitations:
  - <none | list known limits>
```

Release note:

- `generatedAt` may be omitted for deterministic artifacts.
- `releaseAllowed: yes` is valid only for `core-release` bundles from a clean
  `main` or `release/*` lane with green checks.
