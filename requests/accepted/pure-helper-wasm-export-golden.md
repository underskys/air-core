# Pure Helper Wasm Export Golden Convention

Title: Pure Helper Wasm Export Golden Convention
Source demo/project: Airtris, Minesweeper, PhotoLoop, demo build pressure.
Original source path: ../demos/AIR_DEMO_PRESSURE_AUDIT_2026_06_02.md
Target layer: reusable kit
Status: accepted/planned
Decision: Accepted as demo migration/tooling debt for v0.44-v0.45, not as new language semantics.
Rationale: Demos need reproducible export manifests and golden checks for pure AIR helper Wasm. The generic need is packaging/test convention, not Core syntax or Host ABI.
Compatibility risk: Low if kept as tooling/kit convention. Risk rises if it becomes a new runtime ABI without review.
Version target: v0.44-v0.45
Owner: AIR Core release governance
Existing alternative: Use current `verify`, `build`, `report`, conformance replay, benchmark, and generated metadata where available.
Demo migration: Add one verify/build/golden command per public demo before launch.

## Notes

This does not accept browser loader APIs, Vite bundling, or host runtime changes
in Core.
