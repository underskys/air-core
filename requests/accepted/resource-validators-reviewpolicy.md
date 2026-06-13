# Resource Validators And ReviewPolicy Hard Gates

Title: Resource Validators And ReviewPolicy Hard Gates
Source demo/project: AIRON, public package/resource pressure, consumer evidence pressure.
Original source path: docs/abi-requests/airon-platformer-pressure.md
Target layer: manifest schema
Status: accepted/planned
Decision: Accepted as current v0.42 scope for deterministic package-check/report validators and reviewPolicy hard gates.
Rationale: Generic resource references, generated handle freshness, and anti-slop regression gates belong in package-check/reviewPolicy, not language semantics or demo code.
Compatibility risk: Low to medium; checks may fail packages with stale manifests or new reviewPolicy regressions, but do not change AIR ABI or Host ABI.
Version target: v0.42
Owner: AIR Core release governance
Existing alternative: Keep demo-specific art/media validation demo-local; Core accepts only deterministic generic manifest/resource checks.
Demo migration: Use declared pools/tablegroups/output contracts to suppress false positives intentionally, and route remaining debt through baselines.

## Notes

Accepted P0 generic validators include allowed runtime roots, forbidden roots,
manifest reference existence, generated handle freshness, resource manifest
shape, and release fallback rejection when represented in manifest policy.
