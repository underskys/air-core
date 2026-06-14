# AIR v0.44 Release Plan

Status: active packaging/release-smoke status milestone

Theme: Public Alpha Packaging & Release Smoke

v0.44 turns the v0.43 public-alpha governance baseline into a publishable
package and public repository release candidate. It is a packaging, smoke-test,
and release-checklist milestone only.

AIR ABI latest remains `0.10`. Host ABI latest remains `0.11`, limited to
bounded `output.emit`; Host ABI `0.10` remains supported for packages that do
not use `output.emit`.

## Purpose

v0.43 established public license metadata, package surface checks,
conformance-status discipline, and request-ledger governance. v0.44 defines the
final release-smoke procedure needed before a human publishes the first public
alpha package.

Codex must not receive npm credentials and must not publish. The output of
v0.44 is a reproducible checklist, tarball smoke plan, release notes, and
post-publish verification plan.

## P0 Scope

| P0 item | Expected v0.44 outcome |
| --- | --- |
| npm package final file audit | Confirm `package.json` `files` whitelist and public package surface exclude snapshots, prompts, demos, consumer evidence, hosts, kits, build outputs, and private artifacts. |
| Real tarball smoke | Create a local `npm pack` tarball, inspect it, test from tarball, then remove the tarball before commit. |
| Local install from tarball | Document local install/global install smoke path and cleanup. |
| `bin/airc.js` smoke | Verify `airc version`, `airc check` on a public example, `airc package-check` on a public package example, `airc evidence report`, and `airc run-proof` when a public-clean proof fixture is available. |
| Public repository visibility checklist | Confirm public docs, license metadata, versioning, conformance status, request ledger, and package surface are launch-safe. |
| Release notes | Create public alpha release notes for `0.44.1`. |
| Git tag plan | Define tag `v0.44.1` and pre-tag verification requirements. |
| npm publish checklist | Manual publish only; no token in repo, Codex, logs, prompts, review bundles, or CI output. |
| Post-publish verification plan | Define `npm view`, clean install, `npx` or local smoke, and package file re-check after publication. |

## P1

- GitHub/GitLab release draft;
- npm provenance / trusted publishing research;
- CI release workflow draft;
- public conformance artifact.

## Deferred

- actual npm publish from Codex;
- Show HN or launch-post workflow;
- playground;
- MCP demo;
- VS Code extension;
- demo hosting;
- demo migration.

## Hard Constraints

- Codex must not receive an npm token.
- Codex must not publish.
- No secrets, tokens, private paths, raw prompts, raw review bundles, or private
  artifacts in the package.
- No overclaim language.
- No AIR ABI change.
- No Host ABI change.
- No language features.
- No playground or demo migration work in v0.44.

## Acceptance Criteria

v0.44 is complete when:

- package final file audit is recorded;
- local tarball smoke is recorded;
- install and `bin/airc.js` smoke commands are recorded;
- public repo visibility checklist is complete;
- release notes for `0.44.1` exist;
- tag and publish checklists exist;
- post-publish verification plan exists;
- `node scripts/check_markdown_links.js` passes;
- `git diff --check` passes;
- AIR ABI remains `0.10`;
- Host ABI remains unchanged.

## Links

- [Feature Status v0.44](FEATURE_STATUS_v0.44.md)
- [Public Alpha Packaging RFC](rfcs/v0.44-public-alpha-packaging.md)
- [Publish Checklist](public_release/PUBLISH_CHECKLIST.md)
- [Release Notes v0.44.1](public_release/RELEASE_NOTES_v0_44_1.md)
- [npm Package Files Plan](public_release/NPM_PACKAGE_FILES_PLAN.md)
- [npm Pack Dry-Run Summary](public_release/NPM_PACK_DRY_RUN_SUMMARY.md)
- [Public Install Check](public_release/PUBLIC_INSTALL_CHECK.md)
- [Conformance Reproduction Summary](public_release/CONFORMANCE_REPRODUCTION_SUMMARY.md)
- [Version and ABI Policy](VERSION_AND_ABI_POLICY.md)
