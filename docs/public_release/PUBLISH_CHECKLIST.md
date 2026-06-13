# AIR Public Alpha Publish Checklist

Status: implemented/P0 for v0.44; human-maintainer checklist for manual npm
alpha publish

This checklist is for a human maintainer. Codex must not receive npm tokens,
must not receive npm credentials in prompts or files, and must not publish. The
manual publish command below is listed only so the human maintainer can run it
outside Codex after v0.44 is merged and the final checks pass.

Target package: `air-verifier@0.43.0-alpha.1`

Planned git tag: `v0.43.0-alpha.1`

## Pre-Publish Repository Checks

- [ ] Current branch is clean `main` at the intended release commit.
- [ ] Checkout is clean.
- [ ] `git status --short --branch` shows no dirty files and no unexpected
  ahead/behind state.
- [ ] Planned tag `v0.43.0-alpha.1` does not already point to a different
  commit.
- [ ] The release commit has been reviewed and pushed.
- [ ] `package.json` version is `0.43.0-alpha.1`.
- [ ] `package.json` license is `Apache-2.0`.
- [ ] `package.json` has no `private: true`.
- [ ] `LICENSE`, `NOTICE`, and `AUTHORS` exist.
- [ ] `README.md`, `VERSIONING.md`, `CHANGELOG.md`, `SECURITY.md`,
  `THREAT_MODEL.md`, and `CONFORMANCE.md` are launch-safe.
- [ ] `CONFORMANCE.md` does not claim independent `air-tests 74/74` unless the
  public repository reproduces it.
- [ ] `REVIEW_RESULTS/RED_FLAGS.md` has no active red flags.
- [ ] `docs/PROMISE_DEBT.md` exists and request ledger validation passes.
- [ ] `docs/public_release/RELEASE_NOTES_v0_43_alpha_1.md` is ready for public
  release notes.
- [ ] `README.md` install instructions are correct for the publish state.

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
npm pack
mkdir -p build/public-smoke
tar -tf air-verifier-0.43.0-alpha.1.tgz | sort > build/public-smoke/npm-pack-files.txt
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
npm install -g ./air-verifier-0.43.0-alpha.1.tgz
airc version --json
airc check examples/public/safe_policy/module.air
npm uninstall -g air-verifier
```

If global install is unsafe, use a temporary npm prefix and record the
limitation.

Clean up before commit:

```sh
rm -f air-verifier-0.43.0-alpha.1.tgz
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

Codex must not run this step and must not receive the npm token.

Human maintainer command:

```sh
npm publish --access public --tag alpha ./air-verifier-0.43.0-alpha.1.tgz
```

Use npm account 2FA and the intended package visibility. Confirm the package
name and dist-tag before publishing.

## Post-Publish Verification

Run this only after the human maintainer completes npm publish.

```sh
npm view air-verifier@0.43.0-alpha.1 name
npm view air-verifier@0.43.0-alpha.1 version
npm view air-verifier@0.43.0-alpha.1 license
npm view air-verifier@0.43.0-alpha.1 bin
npm install -g air-verifier@0.43.0-alpha.1
airc version --json
airc --help
npm uninstall -g air-verifier
```

After publish, update public release notes if the final tag, package metadata,
or install behavior differs from this checklist.

If post-publish verification fails, do not publish another version until the
failure is documented and triaged.
