# AIR Bundle Manifest Template

Use this template for release-adjacent bundles. A filled manifest should be
stored inside the bundle root.

The canonical machine artifact is
[BUNDLE_MANIFEST.json](artifact_templates/BUNDLE_MANIFEST.json). Use JSON for
the actual bundle manifest so release tooling can validate it deterministically.

```json
{
  "bundleKind": "core-release",
  "repo": "git@gitlab.com:fd.skyrealm/air-core.git",
  "branch": "main",
  "commit": "<full git commit>",
  "dirtyTree": "no",
  "releaseAllowed": "yes",
  "npmPackage": "@underskys/air-core",
  "packageVersion": "0.45.0",
  "airAbi": "0.10",
  "hostAbi": "0.11 latest, limited to bounded output.emit; 0.10 baseline supported",
  "internalSlice": "M45-S1",
  "publicVersion": "0.45.0",
  "includedPaths": ["README.md", "package.json", "bin/", "src/", "spec/", "stdlib/"],
  "excludedPaths": ["node_modules/", "*.tgz", "REVIEW_RESULTS/", "snapshots/", "prompts/"],
  "checksRun": ["npm test", "npm run check:public-package-surface", "npm run check:release-lane"],
  "knownLimitations": []
}
```

Release note:

- `generatedAt` may be omitted for deterministic artifacts.
- `releaseAllowed: yes` is valid only for `core-release` bundles from a clean
  `main` or `release/*` lane with green checks.
- Review bundles are artifacts and are never npm package contents.
