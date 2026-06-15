# AIR v0.44 Feature Status

Status: historical packaging/release-smoke status milestone

Version target: v0.44 planning and package smoke. `0.44.2` is not the next
planned npm release.

Version policy update: `@underskys/air-core@0.44.1` remains the first published
public alpha. Do not publish `0.44.2` unless an urgent package-breaking fix is
required for that already published package. README/docs/positioning/roadmap
and release-governance work now accumulates as internal `v0.45` slices
(`M45-S1`, `M45-S2`, ...) toward the next planned public npm alpha
`@underskys/air-core@0.45.0`.

v0.44 covers Public Alpha Packaging & Release Smoke. It is not a language,
runtime, compiler-semantics, AIR ABI, or Host ABI milestone.

AIR ABI latest remains `0.10`. Host ABI latest remains `0.11`, limited to
bounded `output.emit`; Host ABI `0.10` remains the default/baseline target for
packages that do not use `output.emit`.

Related documents:

- [AIR v0.44 Release Plan](V0_44_RELEASE_PLAN.md)
- [Public Alpha Packaging RFC](rfcs/v0.44-public-alpha-packaging.md)
- [Publish Checklist](public_release/PUBLISH_CHECKLIST.md)
- [Release Notes v0.44.2](public_release/RELEASE_NOTES_v0_44_2.md)
- [npm Package Files Plan](public_release/NPM_PACKAGE_FILES_PLAN.md)
- [npm Pack Dry-Run Summary](public_release/NPM_PACK_DRY_RUN_SUMMARY.md)
- [Public Install Check](public_release/PUBLIC_INSTALL_CHECK.md)
- [Conformance Reproduction Summary](public_release/CONFORMANCE_REPRODUCTION_SUMMARY.md)

## Status Values

- `stable/active`: inherited behavior from earlier milestones.
- `implemented/P0`: required v0.44 item completed and documented.
- `planned/P0`: required v0.44 plan item.
- `planned/P1`: lower-priority release polish.
- `deferred`: explicitly outside v0.44.
- `rejected`: not allowed in v0.44.

## Stable / Active Baseline

| Feature | Layer | v0.44 status |
| --- | --- | --- |
| AIR ABI `0.10` | ABI | Stable/active. |
| Host ABI `0.10` | ABI | Stable/active and still supported. |
| Host ABI `0.11` bounded `output.emit` | Host ABI/package/runtime | Stable bounded first slice only. No expansion accepted for v0.44. |
| Public license metadata | repository/package | Stable from v0.43. |
| Public package surface checker | package/release checks | Stable from v0.43. |
| Request ledger validation | release governance | Stable from v0.43. |
| Public conformance checkpoint | public release docs | Stable from v0.43; independent `air-tests 74/74` remains pending public reproduction unless a public-clean suite is added and run. |

## v0.44 P0

| Feature | Layer | v0.44 status |
| --- | --- | --- |
| npm package final file audit | package/release checklist | Implemented/P0. |
| Real `npm pack` tarball smoke | package/release checklist | Implemented/P0. |
| Local install from tarball | package/release checklist | Implemented/P0 using a temp project local install. |
| `bin/airc.js` smoke commands | CLI/release checklist | Implemented/P0 for `version`, `check`, `package-check --source-only`, and `evidence report`; `run-proof` is not in the public npm package surface. |
| Public repository visibility checklist | release checklist | Implemented/P0. |
| Release notes for `0.44.2` | public release docs | Historical smoke/release-candidate record; not a planned publish unless urgent package-breaking fix is required. |
| Git tag plan `v0.44.2` | release checklist | Superseded by v0.45 release planning except emergency patch flow. |
| npm publish checklist | release checklist | Implemented/P0; manual publish only by the human maintainer. |
| Post-publish verification plan | release checklist | Implemented/P0. |

## P1

| Feature | v0.44 status |
| --- | --- |
| GitHub/GitLab release draft | Planned/P1. |
| npm provenance / trusted publishing research | Planned/P1. |
| CI release workflow draft | Planned/P1. |
| Public conformance artifact | Planned/P1. |

## Deferred / Rejected

| Feature | v0.44 status |
| --- | --- |
| npm publish by Codex | Rejected. |
| npm token handling by Codex | Rejected. |
| Show HN or launch campaign | Deferred. |
| Playground implementation | Deferred. |
| MCP demo | Deferred. |
| VS Code extension | Deferred. |
| Demo hosting | Deferred. |
| Demo migration | Deferred. |
| New language features | Rejected. |
| AIR ABI change | Rejected. |
| Host ABI change | Rejected. |

## Version Semantics

- Project milestone: `v0.44`.
- First published public alpha: `@underskys/air-core@0.44.1`.
- Package used for local smoke: `0.44.2`.
- Planned next public npm alpha: `@underskys/air-core@0.45.0` with dist-tag
  `alpha`.
- Planned git tag: `v0.45.0`.
- Emergency-only patch: `0.44.2`, only for urgent fixes to `0.44.1`.
- AIR ABI latest: remains `0.10`.
- Host ABI latest: remains `0.11`.
- Host ABI default/baseline: remains `0.10`.
- Host ABI `0.11` support remains limited to bounded `output.emit` packages.
- Host ABI expansion in v0.44: none.
- AIR ABI change in v0.44: none.
