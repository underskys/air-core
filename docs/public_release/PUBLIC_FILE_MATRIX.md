# Public File Matrix

This matrix classifies repository paths for AIR alpha launch.

| Path | Classification | Rationale | Launch Action |
| --- | --- | --- | --- |
| `README.md` | Public now | Public entrypoint and quickstart. | Include after current-milestone review. |
| `CHANGELOG.md` | Public now | Compact milestone history. | Include. |
| `CONTRIBUTING.md` | Public now | Contributor process. | Include. |
| `LICENSE` / `NOTICE` / `NOTICE.md` / `AUTHORS` | Public now | Public licensing and authorship metadata. | Include. |
| `WHY_AIR.md`, `METHOD.md`, `SECURITY.md`, `THREAT_MODEL.md`, `CONFORMANCE.md`, `ROADMAP.md` | Public now | Public alpha launch docs with strict anti-overclaim language. | Include. |
| `bin/` | Public now | CLI entrypoint. | Include. |
| `src/` | Public now | Core parser/verifier/lowerer/report implementation. | Include. |
| `spec/` | Public now | Language, package, ABI, and host profile specs. | Include. |
| `stdlib/` | Public now | Core standard library surface. | Include. |
| `test/fixtures/conformance_*`, `test/fixtures/profiles/` | Public now | Narrow conformance fixtures for public package surface. | Include in npm package. |
| `fixtures/v051/` | Public now | Frozen v0.51 conformance fixtures; product-neutral machine inputs. | Include in npm package. |
| `test/` | Public now in repository | Full verifier/package/evidence/regression tests. | Keep in repo; include only narrow conformance fixtures in npm package. |
| `examples/public/` | Public now | Launch-safe Core examples for npm/public package. | Include. |
| `examples/consumer/` | Public now as documentation only | Documents consumer examples as pressure/evidence, not Core authority. | Keep in repository; exclude from npm package unless separately accepted. |
| `examples/ai_gate/` | Public now as repository examples | Product-neutral Golden AI Gate examples exercise host-admission boundaries without defining Core authority. | Keep in repository; exclude from npm package. |
| `examples/lan_observer_readonly_package/`, `examples/airops_incident_package/` | Public later / evidence | Consumer proof packages are useful evidence but do not define Core semantics. | Keep in repository evidence; exclude from npm package. |
| `benchmarks/` | Public now | Deterministic benchmark fixtures and reports. | Include small fixtures only. |
| `evals/ai_authoring/` | Public now | Deterministic AI-authoring replay/import evidence. | Include sanitized fixtures only. |
| `consumer_evidence/` | Public now as repository evidence | Consumer pressure summaries and proof cards. | Keep in repository; exclude from npm package. |
| `docs/` | Public now | Specs, RFCs, status, workflow, and release docs. | Include; exclude private launch notes if added later. |
| `scripts/` | Public now | Local checks, gates, bundle, and sanitation workflows. | Include deterministic scripts. |
| `data/` | Public now | Small static test/support data. | Include after sanitation scan. |
| `tools/` | Public now | Local support tooling. | Include after sanitation scan. |
| `kits/` | Public later | Reusable kits need separate public support/readiness review. | Exclude from npm package for alpha. |
| `hosts/` | Public later | Host-specific surfaces and dependencies. | Exclude from npm package for alpha. |
| `swift/AIRSwift/` | Public now as repository source | Product-neutral Swift conformance host; a separate SwiftPM package, not a Node runtime dependency. | Keep in repository; exclude from npm package. |
| `demo/` | Public later | External or local demo implementations are pressure, not Core authority. | Exclude from npm package and review separately. |
| `demo_snapshots/` | Public later | Generated/review artifacts, not source of truth. | Exclude. |
| `prompts/` | Public later | Prompt templates may be useful, but launch needs prompt/log policy first. | Review before inclusion. |
| `requests/` | Public later | Intake archive can expose stale/private planning context. | Review before inclusion. |
| `snapshots/` | Must exclude | Raw review bundles and generated archives. | Exclude. |
| `REVIEW_RESULTS/` | Must exclude | Local review-bundle output. | Exclude. |
| `MOBILE_SUMMARY.md` | Must exclude from npm | Review artifact, can be regenerated. | Exclude from npm package. |
| `REVIEW_REQUEST.md` | Must exclude from npm | Review artifact, can be regenerated. | Exclude from npm package. |
| `CONSUMER_EVIDENCE_SUMMARY.md` | Must exclude from npm | Generated consumer evidence summary. | Exclude from npm package. |
| `node_modules/` | Must exclude | Dependency install output. | Exclude. |
| `build/`, `.build/`, `dist/`, `public/` | Must exclude unless explicitly required | Generated build output. | Exclude. |
| `*.wasm` | Must exclude unless explicitly required | Generated binaries should be reproducible from source, except explicit fixtures. | Review per file. |
| `.DS_Store`, `._*` | Must exclude | Local filesystem artifacts. | Exclude. |

## Publication Notes

The first public alpha should keep Core review evidence visible without
shipping raw bundles, large generated artifacts, or demo build outputs. If a
later task publishes to npm, verify the final package with `npm pack --dry-run`
and compare the result against this matrix.
