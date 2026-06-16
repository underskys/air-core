# Public Install Check

Status: active install check for the `0.45.0` public alpha release candidate.
`npm pack --dry-run --json` and local tarball CLI smoke must pass before tag.
No npm publication has been performed.

Version policy update: the recorded `0.44.2` local install smoke is historical
evidence only. Do not publish `0.44.2` unless an urgent package-breaking fix is
required for `@underskys/air-core@0.44.1`. The active public alpha release
candidate is `@underskys/air-core@0.45.0`, to be published later with dist-tag
`alpha`.

This checklist defines the public installability proof for AIR alpha. It is a
release checkpoint, not a language feature, AIR ABI change, or Host ABI change.

## Scope

The public install check proves that a clean package artifact can install and
run the public CLI on small launch-safe examples.

It does not prove:

- production host integration;
- external demo readiness;
- browser/Vite demo bundling;
- live AI/provider integration;
- npm registry publication.

## Planned Checks

Run from a clean checkout:

```sh
npm ci
npm test
npm run check:public-package-surface
npm pack --dry-run --json
```

Then inspect the dry-run file list:

- verify included files match [NPM Package Files Plan](NPM_PACKAGE_FILES_PLAN.md);
- verify excluded files do not include snapshots, raw review bundles, private
  docs, prompt logs, large demos, build output, or large media;
- verify `bin/airc.js` is present;
- verify `README.md`, `LICENSE`, `NOTICE`, `AUTHORS`, `VERSIONING.md`,
  `CHANGELOG.md`, `SECURITY.md`, and `THREAT_MODEL.md` are present.

For the active `0.45.0` local install smoke test:

```sh
npm pack
npm install -g ./underskys-air-core-0.45.0.tgz
airc version --json
airc check examples/public/safe_policy/module.air
airc package-check examples/public/evidence_report --source-only --json
airc evidence report examples/public/evidence_report --format markdown -o evidence_report.md
```

If feasible for the local npm version, also test `npx` from the local tarball:

```sh
npx -y ./underskys-air-core-0.45.0.tgz airc version --json
```

If `npx` cannot execute a local tarball consistently on the test platform,
record the limitation and rely on global install plus direct `node bin/airc.js`
smoke tests.

If the E2E proof fixture is included in the package surface or available from
the repository checkout, run:

```sh
node bin/airc.js run-proof examples/lan_observer_readonly_package \
  --fixture examples/lan_observer_readonly_package/traces/pass.json \
  --policy examples/lan_observer_readonly_package/host_policies/lan_observer_readonly.policy.json \
  --json
```

If the fixture is not part of the npm package whitelist, mark this as a
repository conformance/evidence check rather than an npm install check.

## Latest Dry-Run Result

See [npm Pack Dry-Run Summary](NPM_PACK_DRY_RUN_SUMMARY.md).

The active `0.45.0` dry-run must confirm:

- package: `@underskys/air-core@0.45.0`;
- file count: 139;
- `bin/airc.js` included;
- required public docs included;
- snapshots, raw review bundles, prompts, demos, consumer evidence, hosts,
  kits, and build outputs excluded.

The local tarball smoke should use a temporary package directory instead of
modifying the user's global npm installation. `airc version --json` must return
package version `0.45.0` and AIR ABI `0.10`.

## Expected CLI Checks

Minimum public install smoke:

- `airc version --json`;
- `airc check examples/public/safe_policy/module.air`;
- `airc package-check examples/public/evidence_report --source-only --json`;
- `airc evidence report examples/public/evidence_report --format markdown -o evidence_report.md`;
- `airc explain examples/public/safe_policy/module.air`;
- `airc audit examples/public/safe_policy/module.air`.

The checks must not require network access, API keys, provider SDKs, external
services, raw demo assets, private paths, or external demo repositories.

## Launch Blockers

- `LICENSE` missing or not Apache-2.0.
- `NOTICE` or `AUTHORS` missing.
- `package.json` contains `private: true` when npm publication is intended.
- `package.json` has no `bin.airc` entry.
- `npm pack --dry-run --json` includes snapshots, raw review bundles, prompt
  logs, large demos, external demo source trees, `node_modules`, build output,
  large media, or private docs.
- `airc version --json` fails from the local package install.
- Public example verify/report command fails.
- Stale metadata references an old branch/commit in source docs.
- Promise debt ledger has unresolved known pressure.

## ABI Status

- AIR ABI remains `0.10`.
- Host ABI latest remains `0.11`, limited to bounded `output.emit`.
- No Host ABI imports are added by this check.
