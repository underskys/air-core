# npm Package Files Plan

Status: v0.43 public-alpha package surface plan with a passing dry-run summary.
No npm publication has been performed.

AIR's public npm package should expose Core/spec/CLI/conformance surfaces and
small launch-safe examples only. Consumer evidence and demos remain repository
pressure/intake unless explicitly allowlisted later.

AIR is the project name. `air-core` is the npm package. `airc` is the CLI.

## Include

The alpha package should include:

- `bin/airc.js`;
- `data/host_profiles/`;
- `src/`;
- `spec/`;
- `stdlib/`;
- minimal public examples under `examples/public/`;
- narrow public conformance fixtures needed by package smoke tests;
- `README.md`;
- `LICENSE`;
- `NOTICE`;
- `AUTHORS`;
- `VERSIONING.md`;
- `CHANGELOG.md`;
- `CONFORMANCE.md`;
- `SECURITY.md`;
- `THREAT_MODEL.md`;
- `WHY_AIR.md`;
- `METHOD.md`;
- `CONTRIBUTING.md`;
- `ROADMAP.md`.

Current `package.json` uses a `files` whitelist. The whitelist must remain the
source of truth for package inclusion, with `.npmignore` as a defensive
exclusion layer.

## Exclude

The alpha package must exclude:

- `snapshots/`;
- raw review bundles;
- `REVIEW_RESULTS/`, `SNAPSHOT_*`, `BUNDLE_*`, and generated review metadata;
- private docs or local launch notes;
- prompt logs and raw chat transcripts;
- large demos and external demo source trees;
- `consumer_evidence/`;
- `docs/abi-requests/`;
- `requests/`;
- `evals/`;
- `prompts/`;
- `hosts/`;
- `kits/`;
- `demo/` and `demos/`;
- `demo_snapshots/`;
- `node_modules/`;
- `build/`, `dist/`, and `tmp/`;
- large media, raw screenshots, videos, and generated archives;
- generated `.wasm`/binaries unless explicitly required by a public
  reproducibility fixture.

## Verification

Required package-surface commands:

```sh
npm run check:public-package-surface
npm pack --dry-run --json
```

The dry-run output must be reviewed for:

- unexpected demo/consumer/private paths;
- missing CLI entry;
- missing license/authorship/versioning docs;
- stale review artifacts;
- large media or generated archives.

Current dry-run result:

- [npm Pack Dry-Run Summary](NPM_PACK_DRY_RUN_SUMMARY.md)
- `air-core@0.44.0`
- 139 package files
- `bin/airc.js` included
- `data/host_profiles/` included for packaged profile-aware CLI checks
- required public docs included
- forbidden demo/consumer/review/build surfaces excluded

## Launch Blockers

- Missing `LICENSE`, `NOTICE`, or `AUTHORS`.
- `package.json` has `private: true` when npm publication is intended.
- Missing `bin.airc`.
- Package files include snapshots, raw review bundles, private docs, prompt
  logs, consumer evidence, demos, hosts, kits, large media, build output, or
  `node_modules`.
- Package files omit `README.md`, `LICENSE`, `NOTICE`, `AUTHORS`,
  `VERSIONING.md`, `CHANGELOG.md`, `SECURITY.md`, or `THREAT_MODEL.md`.
- Public example commands fail after local install.
- Request ledger or conformance checks fail.

## ABI Status

- AIR ABI remains `0.10`.
- Host ABI latest remains `0.11`, limited to bounded `output.emit`.
- Package file selection does not change AIR or Host ABI behavior.
