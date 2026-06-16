# npm Pack Dry-Run Summary

Status: implemented for the `0.45.0` public-alpha release candidate.

This records the local `npm pack --dry-run --json` package-surface smoke for
the public alpha package. No npm publication was performed.

Version policy update: `@underskys/air-core@0.44.1` remains the first published
public alpha, `0.44.2` is emergency-only for urgent package-breaking fixes to
`0.44.1`, and the active public npm alpha release candidate is
`@underskys/air-core@0.45.0`.

## Result

| Field | Value |
| --- | --- |
| Package | `@underskys/air-core` |
| Version | `0.45.0` |
| Dry-run status | pass |
| File count | 139 |
| Package size | 304,444 bytes |
| Unpacked size | 1,383,057 bytes |
| Tarball name | `underskys-air-core-0.45.0.tgz` |

## Included Top-Level Paths

- `AUTHORS`
- `CHANGELOG.md`
- `CONFORMANCE.md`
- `CONTRIBUTING.md`
- `LICENSE`
- `METHOD.md`
- `NOTICE`
- `README.md`
- `ROADMAP.md`
- `SECURITY.md`
- `THREAT_MODEL.md`
- `VERSIONING.md`
- `WHY_AIR.md`
- `bin/`
- `examples/public/`
- `package.json`
- `spec/`
- `src/`
- `stdlib/`
- `test/fixtures/conformance_policy/`
- `test/fixtures/conformance_state/`
- `test/fixtures/profiles/`

## Required Public Files

| File | Included |
| --- | --- |
| `bin/airc.js` | yes |
| `LICENSE` | yes |
| `NOTICE` | yes |
| `AUTHORS` | yes |
| `README.md` | yes |
| `VERSIONING.md` | yes |
| `CHANGELOG.md` | yes |
| `SECURITY.md` | yes |
| `THREAT_MODEL.md` | yes |

## Excluded Critical Paths

The dry-run and `check:public-package-surface` confirmed these paths are not in
the public alpha package:

- `snapshots/`
- raw review bundles and `REVIEW_RESULTS/`
- `SNAPSHOT_*` and `BUNDLE_*` metadata
- prompt logs and raw chat transcripts
- `demo/`, `demos/`, and `demo_snapshots/`
- `consumer_evidence/`
- `docs/abi-requests/`
- `requests/`
- `evals/`
- `prompts/`
- `hosts/`
- `kits/`
- `node_modules/`
- `build/`, `dist/`, `tmp/`, and local generated outputs
- large media, raw screenshots, videos, generated archives, and generated Wasm

## Local Tarball Smoke

`npm pack` created `underskys-air-core-0.45.0.tgz`. The tarball was tested
without publishing:

- `node ./bin/airc.js version --json` returned version `0.45.0` and AIR
  ABI `0.10`.
- A temporary local npm project install from the local tarball returned the same
  `airc version --json` result.
- The generated tarball was removed after the smoke test and is ignored by
  repository/package exclusion rules.

No global user npm installation was modified.

## ABI Status

- AIR ABI remains `0.10`.
- Host ABI latest remains `0.11`, limited to bounded `output.emit`.
- This dry-run changes no compiler, runtime, AIR ABI, or Host ABI behavior.
