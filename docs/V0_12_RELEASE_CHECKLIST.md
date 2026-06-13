# AIR v0.12 Release Checklist

Status: active release checklist

Version target: v0.12

This checklist records release gates for v0.12. It does not approve target
packaging, package registry work, public Host ABI expansion, or demo-specific
Core/stdlib behavior.

Authorities:

- [ROADMAP_v0.12.md](ROADMAP_v0.12.md)
- [V0_12_AI_LANGUAGE_CONTRACT.md](V0_12_AI_LANGUAGE_CONTRACT.md)
- [FEATURE_STATUS_v0.12.md](FEATURE_STATUS_v0.12.md)
- [V0_12_CURRENT_AUDIT.md](V0_12_CURRENT_AUDIT.md)
- [V0_12_STDLIB_HYGIENE_AUDIT.md](V0_12_STDLIB_HYGIENE_AUDIT.md)
- [AIR Layer Manifest](../spec/AIR_LAYER_MANIFEST.md)
- [AIR Stdlib Policy](STDLIB_POLICY.md)

## P0 Release Gates

| Gate | Status | Command | Acceptance |
| --- | --- | --- | --- |
| Package/profile compatibility | pass | `node bin/airc.js package-check examples/package_manifest --profile browser-webgpu --source-only --json` | Package requirements and selected host profile support are deterministic and repairable without requiring built wasm. |
| Capability and Host ABI authority | pass | `npm test` | Unknown host imports fail; required capabilities and profile support are explicit. |
| Stdlib hygiene | pass | `node test/layer_guard.test.js` | Every `stdlib/*.air` module has `capabilities { }`, no `extern`, no Host ABI calls, and no demo/resource vocabulary. |
| Markdown and request governance | pass | `node scripts/check_markdown_links.js && node scripts/check_abi_requests.js` | Docs link cleanly and demo pressure remains canonical request evidence, not authority. |
| Review/report determinism | pass | `node test/report.test.js` | Reports expose package/profile/capability/AI-review facts with stable JSON. |

## Stdlib Hygiene Gate

The stdlib hygiene gate is intentionally strict. `stdlib/` is public AIR surface
and must remain pure, deterministic, backend-neutral, resource-free, and broadly
generic.

Current gate summary:

- Host-facing wrappers were moved out of `stdlib/` into kits or demo-local
  package code.
- `node test/layer_guard.test.js` now enforces empty stdlib capabilities, no
  stdlib externs, and no stdlib Host ABI calls across every `stdlib/*.air`.
- `stdlib/packet.air` now contains only generic bitflag logic.
- TCP-specific flag aliases live in `examples/network_tcp_flags.air` as
  example/kit evidence, not public stdlib.

The migration record is documented in
[V0_12_STDLIB_HYGIENE_AUDIT.md](V0_12_STDLIB_HYGIENE_AUDIT.md).

## Explicit Non-Goals

- No v0.13/v0.14/v0.15 roadmap implementation.
- No new public AIR Core syntax.
- No new public Host ABI functions.
- No game-specific or demo-specific APIs in Core, stdlib, or public Host ABI.
- No target bundling or package registry.
- No demos made to pass by polluting stdlib.
