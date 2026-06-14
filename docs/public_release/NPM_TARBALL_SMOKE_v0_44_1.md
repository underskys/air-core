# npm Tarball Smoke v0.44.1

Status: implemented/P0 for v0.44 packaging smoke

Package: `@underskys/air-core@0.44.1`

Tarball: `underskys-air-core-0.44.1.tgz`

No npm publication was performed. No npm token was used or required.

## Summary

The real npm tarball was created locally, inspected, installed into a temporary
project, and exercised through the packaged `node_modules/.bin/airc` entrypoint.

Result: pass.

## Package Surface

| Field | Value |
| --- | --- |
| Package version | `0.44.1` |
| Tarball file | `underskys-air-core-0.44.1.tgz` |
| Included file count | `139` |
| Tarball size | `302356` bytes |
| Install method | temp project local install from tarball |
| Global install | not used; temp project install avoids changing system npm state |

Included critical files:

- `package.json`
- `README.md`
- `LICENSE`
- `NOTICE`
- `AUTHORS`
- `CHANGELOG.md`
- `VERSIONING.md`
- `SECURITY.md`
- `THREAT_MODEL.md`
- `CONFORMANCE.md`
- `bin/airc.js`
- `data/host_profiles/`
- `src/`
- `spec/`
- `stdlib/`
- `examples/public/`
- selected public conformance fixtures under `test/fixtures/`

Excluded critical paths:

- `snapshots/`
- raw review bundles and `REVIEW_RESULTS/`
- prompt logs and raw chat transcripts
- private notes
- `consumer_evidence/`
- `requests/`
- `evals/`
- `demo/` and `demos/`
- `hosts/`
- `kits/`
- `node_modules/`
- `build/`, `dist/`, and `tmp/`
- large media
- generated Wasm and generated archives
- secrets and tokens

## Commands Run

```sh
npm run check:public-package-surface
npm pack --dry-run --json
npm pack
tar -tf underskys-air-core-0.44.1.tgz
```

Tarball inspection verified required files were present and forbidden roots were
absent.

Temp project smoke:

```sh
npm init -y
npm install <repo>/underskys-air-core-0.44.1.tgz
node_modules/.bin/airc version --json
node_modules/.bin/airc check node_modules/@underskys/air-core/examples/public/safe_policy/module.air
node_modules/.bin/airc package-check node_modules/@underskys/air-core/examples/public/evidence_report --source-only --json
node_modules/.bin/airc evidence report node_modules/@underskys/air-core/examples/public/evidence_report --format markdown -o evidence_report.md
```

Results:

- `airc version --json`: pass, package version `0.44.1`, AIR ABI `0.10`.
- `airc check`: pass.
- `airc package-check --source-only`: pass.
- `airc evidence report`: pass, wrote a non-empty Markdown report.

## Limitations

- `run-proof` was not run from the npm package because the public package
  surface does not include the lan-observer consumer proof fixture or another
  public-clean proof fixture with fixture/policy files.
- The public `examples/public/evidence_report` package is source-only; built
  package-check mode is not applicable unless a public Wasm artifact is added
  intentionally.
- Global install was not used; temp project local install was sufficient and
  avoids mutating system npm state.

## Package Surface Fix Captured

Initial tarball smoke showed that packaged `package-check` needs
`data/host_profiles/`. The package whitelist now includes that directory, and
the public package surface checker allowlists it.

This is package metadata/runtime-data hygiene only. It does not change compiler
semantics, AIR ABI, or Host ABI.

## Manual Publish Command

Human maintainer only:

```sh
npm publish --access public --tag alpha
```

Codex must not run publish and must not receive npm credentials.

## Cleanup

The generated tarball must be removed before commit:

```sh
rm -f underskys-air-core-0.44.1.tgz
```

## ABI Status

- AIR ABI remains `0.10`.
- Host ABI latest remains `0.11`, limited to bounded `output.emit`.
- Host ABI `0.10` remains supported.
