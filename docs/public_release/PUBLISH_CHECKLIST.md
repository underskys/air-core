# AIR Public Alpha Publish Checklist

Status: active checklist for the `0.45.1` Show HN package presentation patch
candidate; human-maintainer checklist for manual npm publish.

This checklist is for a human maintainer or protected GitLab CI release job.
Codex must not receive npm tokens, must not receive npm credentials in prompts
or files, and must not publish from a local checkout. Protected GitLab CI may
use masked CI variables such as `NPM_TOKEN` after an explicit OK/STOP release
decision and manual job start.

Target package: `@underskys/air-core@0.45.1`

Planned git tag: `v0.45.1`

Planned npm dist-tag: `alpha`

Version policy: `@underskys/air-core@0.44.1` remains the first published public
alpha. `@underskys/air-core@0.45.0` is the published public alpha. Do not
publish `0.44.2` unless there is an urgent package-breaking fix to `0.44.1`.
`@underskys/air-core@0.45.1` is reserved for a Show HN README/package
presentation patch only.

## Pre-Publish Repository Checks

- [ ] Current branch is clean `main` at the intended release commit.
- [ ] Checkout is clean.
- [ ] `git status --short --branch` shows no dirty files and no unexpected
  ahead/behind state.
- [ ] Planned tag `v0.45.1` does not already point to a different
  commit.
- [ ] The release commit has been reviewed and pushed.
- [ ] `package.json` version is `0.45.1`.
- [ ] `package.json` license is `Apache-2.0`.
- [ ] `package.json` has no `private: true`.
- [ ] `LICENSE`, `NOTICE`, and `AUTHORS` exist.
- [ ] `README.md`, `VERSIONING.md`, `CHANGELOG.md`, `SECURITY.md`,
  `THREAT_MODEL.md`, and `CONFORMANCE.md` are launch-safe.
- [ ] `CONFORMANCE.md` does not claim independent `air-tests 74/74` unless the
  public repository reproduces it.
- [ ] `REVIEW_RESULTS/RED_FLAGS.md` has no active red flags.
- [ ] `docs/PROMISE_DEBT.md` exists and request ledger validation passes.
- [ ] Release notes for `0.45.1` are ready for public release notes.
- [ ] `README.md` install instructions use `npm install -g @underskys/air-core@alpha`.
- [ ] `0.45.1` release notes state no AIR ABI change, no Host ABI change, and
  no new math implementation.

## Required Checks

```sh
npm test
npm run test:bundle
npm run check:consumer-evidence
npm run consumer-evidence:bundle
npm run check:request-ledger
npm run check:public-package-surface
bash scripts/run_rc_checks.sh
node scripts/check_markdown_links.js
node scripts/check_abi_requests.js
node scripts/check_request_ledger.js
node scripts/check_public_package_surface.js
node test/layer_guard.test.js
git diff --check
```

## Tarball Smoke

```sh
npm pack --dry-run --json
npm pack --json > npm-pack.json
TARBALL="$(node -e 'const fs=require("fs"); const pack=JSON.parse(fs.readFileSync("npm-pack.json","utf8"))[0]; process.stdout.write(pack.filename);')"
mkdir -p build/public-smoke
tar -tf "$TARBALL" | sort > build/public-smoke/npm-pack-files.txt
node ./bin/airc.js version --json
node ./bin/airc.js check examples/public/safe_policy/module.air
node ./bin/airc.js package-check examples/public/evidence_report --source-only --json
node ./bin/airc.js evidence report examples/public/evidence_report --format markdown -o build/public-smoke/evidence_report.md
```

If a public-clean `run-proof` fixture is available in the package surface:

```sh
node ./bin/airc.js run-proof <package-dir> --fixture <fixture.json> --policy <policy.json> --json
```

If not, record `run-proof` as repository-only or not applicable for the npm
package smoke.

## Local Install Smoke

Preferred:

```sh
npm install -g ./underskys-air-core-0.45.1.tgz
airc version --json
airc check examples/public/safe_policy/module.air
npm uninstall -g @underskys/air-core
```

If global install is unsafe, use a temporary npm prefix and record the
limitation.

Clean up before commit:

```sh
rm -f underskys-air-core-0.45.1.tgz
rm -rf build/public-smoke
```

Do not commit generated tarballs.

## Forbidden Publish Inputs

- [ ] No npm token in repository.
- [ ] No npm token in Codex prompt/context.
- [ ] No npm token in review bundle.
- [ ] No API keys or provider credentials.
- [ ] No private paths, raw prompts, raw review bundles, snapshots, demos,
  consumer evidence, hosts, kits, or build outputs in npm package surface.

## Manual Publish

Codex must not run this step locally and must not receive the npm token.

Preferred protected CI path:

1. Ensure `NPM_TOKEN` is configured as a masked/protected GitLab CI variable.
2. Run the manual `npm:auth:check` job to verify `npm ping`, `npm whoami`, and
   `npm view` without publishing.
3. Create/run a protected tag pipeline where `CI_COMMIT_TAG` is exactly
   `v0.45.1`, then manually start `publish:npm`.
4. To update a dist-tag for an already published version, use `npm:dist-tag`
   with `AIR_NPM_DIST_TAG_UPDATE=1`, `AIR_RELEASE_DECISION=OK`,
   `AIR_NPM_VERSION`, and `AIR_NPM_DIST_TAG`.

The CI publish job validates package identity as `@underskys/air-core@0.45.1`,
requires tag pipeline `v0.45.1`, refuses to publish a version that already
exists on npm, reruns public package/claims/review-bundle policy checks,
performs `npm pack --dry-run --json`, creates a tarball, discovers the actual
scoped tarball filename from `npm pack --json`, and then runs `npm publish
--access public --tag alpha`.

Fallback human maintainer command:

```sh
npm publish --access public --tag alpha ./underskys-air-core-0.45.1.tgz
```

Use npm account 2FA and the intended package visibility. Confirm the package
name and dist-tag before publishing.

## Post-Publish Verification

Run this only after the human maintainer completes npm publish.

```sh
npm view @underskys/air-core@0.45.1 name
npm view @underskys/air-core@0.45.1 version
npm view @underskys/air-core@0.45.1 license
npm view @underskys/air-core@0.45.1 bin
npm install -g @underskys/air-core@alpha
airc version --json
airc --help
npm uninstall -g @underskys/air-core
```

After publish, update public release notes if the final tag, package metadata,
or install behavior differs from this checklist.

If post-publish verification fails, do not publish another version until the
failure is documented and triaged.
