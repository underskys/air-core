# AIR Core v0.44.0 Manual Publish Checklist

Status: human-maintainer checklist for `air-core@0.44.0` public alpha publish.

This checklist is operational documentation only. Codex must not publish to npm,
must not receive npm credentials, must not create tags, and must not run the
manual GitLab publish job.

Target package: `air-core@0.44.0`

CLI binary: `airc`

Planned git tag: `v0.44.0`

Planned npm dist-tag: `alpha`

## Before Manual Publish

Confirm the checkout is exactly on the release tag:

```sh
git status --short --branch
git describe --tags --exact-match
```

Expected tag: `v0.44.0`.

Confirm package identity:

```sh
node -e "const p=require('./package.json'); console.log(p.name,p.version,p.license,p.bin)"
```

Expected:

- package name: `air-core`
- package version: `0.44.0`
- license: `Apache-2.0`
- CLI binary: `airc` mapped to `./bin/airc.js`

Confirm the GitLab tag pipeline is green:

- `test`: pass
- `pack:smoke`: pass
- `publish:npm:alpha`: present as a manual job

Do not publish if the tag pipeline failed or if the manual publish job is not
clearly associated with tag `v0.44.0`.

## Local Pack And Install Smoke

Run from a clean checkout:

```sh
npm ci
npm test
npm run check:public-package-surface
npm run check:public-claims
npm pack --dry-run --json
npm pack
```

Install the produced tarball into a temporary project:

```sh
mkdir -p /tmp/air-core-local-smoke
cd /tmp/air-core-local-smoke
npm init -y
npm install /path/to/air-core-0.44.0.tgz
./node_modules/.bin/airc version --json
./node_modules/.bin/airc --help
```

Return to the repository and remove the generated tarball:

```sh
cd /path/to/air-core
rm -f air-core-0.44.0.tgz
```

Do not commit generated tarballs.

## npm Package Availability

Before first publish, check the package name state:

```sh
npm view air-core name version || true
```

If the package already exists and is not controlled by the maintainer, stop and
do not publish.

## Manual npm Publish

Run this only as the human maintainer, after the tag pipeline and local smoke
checks pass:

```sh
npm whoami
npm publish --access public --tag alpha
```

Do not paste npm tokens into repository files, prompts, docs, logs, or review
bundles.

## GitLab Manual Publish Option

If using the GitLab manual publish job instead of local npm publish:

- Store `NPM_TOKEN` only in protected and masked GitLab CI/CD variables.
- Do not paste the token into the repository, issue text, merge request text,
  docs, prompts, or Codex context.
- Press the manual `publish:npm:alpha` job only after the tag pipeline
  `test` and `pack:smoke` jobs pass.
- Verify the npm package afterward.

## Post-Publish Verification

After npm publish:

```sh
npm view air-core@alpha name version license bin
npm install -g air-core@alpha
airc version --json
airc --help
npm uninstall -g air-core
```

Expected:

- package name: `air-core`
- package version: `0.44.0`
- license: `Apache-2.0`
- CLI binary: `airc`
- AIR ABI in `airc version --json`: `0.10`

## Compatibility And Claims

- AIR Core v0.44.0 is a public alpha, not a 1.0 compatibility promise.
- AIR ABI remains `0.10`.
- Host ABI remains unchanged; latest documented Host ABI is `0.11`, limited to
  bounded `output.emit`.
- Public `air-tests 74/74` reproduction is pending unless that exact suite is
  included and reproduced from the public repository.
- Do not claim stronger guarantees than AIR's documented verifier model,
  complete sandbox coverage, or business-policy correctness.

## Stop Conditions

Do not publish if any of these are true:

- checkout is not exactly on tag `v0.44.0`;
- `package.json` is not `air-core@0.44.0`;
- tag pipeline failed;
- local tarball smoke failed;
- package surface includes private artifacts, review bundles, prompts, demos,
  hosts, kits, generated archives, or secrets;
- release notes or README overclaim the security/conformance model;
- npm account/package ownership is unclear.
