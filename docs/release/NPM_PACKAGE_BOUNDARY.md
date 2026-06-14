# AIR NPM Package Boundary

Status: active policy

The AIR npm package is an allowlisted public source package. It is not a review
bundle, private export, demo archive, or pressure bundle.

## Package Surface

The package surface is allowlisted in `package.json`.

The package surface is checked by:

```sh
npm run check:public-package-surface
npm run check:review-protocol
```

Adding new package content requires an explicit package-surface decision.

## Never Include

Review bundles must never enter npm.

The npm package must never include:

- review bundles;
- raw review zips;
- private prompts;
- prompt logs;
- raw chat transcripts;
- snapshots;
- private notes;
- private/internal artifacts;
- `REVIEW_RESULTS/`;
- `MOBILE_SUMMARY.md`;
- `REVIEW_REQUEST.md`;
- `public_export/`;
- demo build outputs;
- generated tarballs;
- secrets or tokens.

## Review Artifacts

Review artifacts may be committed when they are public-safe policy/templates,
but generated review bundles never enter npm package contents.

`BUNDLE_MANIFEST.json`, `QA_REPORT.md`, and `RELEASE_DECISION.md` are review
artifacts. They are not automatically package contents.

Current npm policy excludes `review_artifacts/templates/` as well as actual
artifact instances. Packaging templates requires an explicit package-surface
decision and corresponding update to `scripts/check_public_package_surface.js`.

## Release Rule

Before publish:

- run package surface check;
- inspect `npm pack --dry-run --json`;
- confirm forbidden paths are absent;
- confirm public docs and CLI are present;
- confirm AIR ABI and Host ABI status is explicit.
