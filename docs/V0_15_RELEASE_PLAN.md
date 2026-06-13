# AIR v0.15 Release Plan

Status: active planning

Theme: Diagnostics, Anti-Slop, and LSP-lite

v0.15 turns v0.14 package/report/check data into stable machine-readable
diagnostics for AI repair loops, release gates, and editor adapters. It does not
change AIR ABI, Host ABI, stdlib authority, or demo scope.

## Request Intake Governance

Incoming downstream and demo requests are tracked through `/requests`.

- Inbox requests are proposals, not release scope.
- Core keeps a minimal `/requests` skeleton so active docs and review bundles
  have a stable path; detailed triage may continue on the `core/requests`
  governance branch.
- Accepted v0.15 requests must be reflected in this release plan or an RFC.
- Rejected requests must record the reason.
- Demo requests are pressure evidence only; Core accepts generalized
  mechanisms, not game-specific APIs.
- Request checks are release hygiene, not language semantics.

## P0 Scope

| Area | v0.15 gate | Acceptance |
| --- | --- | --- |
| Diagnostic code registry | Stable code names for parser, verifier, package, review, generated, manifest, profile, surface, and trend diagnostics. | JSON diagnostics use `air.<domain>.<name>` where supported and preserve legacy IDs where needed. |
| Normalized diagnostic shape | Reports and LSP-lite output expose a common diagnostic envelope. | Diagnostics include severity, category, source, repair hint, file/range/module/symbol when available, and deterministic ordering. |
| Package-level AI review | Review runs over authored package graphs, not only entry files. | Non-entry module warnings appear in package reports with path class and module ownership. |
| reviewPolicy maturity | Package policies can gate selected review diagnostics without global hardcoding. | Code-based gates work, legacy aliases remain compatible, path-class precedence is deterministic, and waivers are review-only. |
| LSP-lite diagnostics | CLI emits editor-friendly JSON. | `airc check <file-or-package> --lsp-json` reports parser, verifier, package, generated, manifest, and review diagnostics deterministically. |
| Review trend baselines | Local deterministic baselines track anti-slop movement over time. | Baselines contain no timestamps or absolute paths and compare module/function metrics plus diagnostic counts. |
| Review policy profiles | Recommended presets document common postures. | Presets are opt-in guidance and do not change default package-check behavior. |
| Request intake | Requests are collected without becoming automatic roadmap. | `/requests` separates inbox, accepted, rejected, and archive states. |

## P1 / Deferred Tracks

These are recognized needs, not v0.15 P0 release gates:

- linked executable package build;
- event/output ABI;
- fixed pools / bounded mutable state;
- target product bundles;
- full JSON-RPC LSP server;
- VS Code extension, completions, hover, go-to-definition, and incremental
  workspace diagnostics;
- Unity/Godot/native adapters;
- package registry.

## Non-goals

v0.15 must not add:

- game-specific Core APIs;
- Host ABI changes for demo pressure;
- AIR ABI bump without runtime contract changes;
- stdlib pollution or host-authority wrappers;
- `debug.metric` as an event bus;
- linked package build;
- event/output ABI;
- dynamic maps, GC, reflection, runtime imports, remote imports, or host object
  handles.

## Acceptance Gates

- v0.15 diagnostics use `schemaVersion`/`reportVersion` `0.15` where this
  milestone owns the output shape.
- `npm test` passes.
- Markdown links and ABI request checks pass.
- Layer guard passes; stdlib remains pure and host-authority-free.
- LSP-lite package/file checks are deterministic.
- Review baselines are deterministic and path-stable.
- Request intake is preserved in `core/requests` and does not modify demo
  implementation files.
- Demo branches remain consumer/pressure branches; demo failures are not Core
  blockers unless reproduced as Core fixtures.

## Expected Fixture Warnings

These warnings are expected in current v0.15 RC fixtures:

- `air.package.linked_wasm_deferred` / `linked_wasm_deferred` can appear for
  multi-module examples while linked executable package build remains deferred.
- `examples/package_manifest` may report placeholder asset warnings because the
  fixture intentionally uses tiny deterministic placeholder assets. Placeholder
  warnings keep review bundles reproducible and are not production success
  criteria.

## Representative Commands

```sh
npm test
node scripts/check_review_bundle.js --keep
node scripts/check_markdown_links.js
node scripts/check_abi_requests.js
node test/layer_guard.test.js
git diff --check
```

```sh
node bin/airc.js check examples/policy_audit_package --profile cli --lsp-json
node bin/airc.js report package examples/policy_audit_package --profile cli --json
node bin/airc.js report package examples/policy_audit_package --profile cli --review-baseline
node bin/airc.js package-check examples/policy_audit_package --profile cli --source-only --json
```

## Version Policy

v0.15 is a project milestone. It does not automatically bump compiler/package,
AIR ABI, Host ABI, package schema, report schema, or manifest schema versions.

- Project milestone: `v0.15`.
- AIR ABI: remains `0.10` unless runtime/executable contract changes.
- Host ABI: remains `0.10` unless accepted host imports or host import
  semantics change.

See [Version and ABI Policy](VERSION_AND_ABI_POLICY.md).
