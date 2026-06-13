# Browser And Vite Demo Bundling

Title: Browser And Vite Demo Bundling
Source demo/project: Airtris, Minesweeper, PhotoLoop, AIRON, FlowDesk Air.
Original source path: ../demos/AIR_DEMO_PRESSURE_AUDIT_2026_06_02.md
Target layer: project kit
Status: rejected/project-only
Decision: Rejected as Core scope; browser/Vite bundling remains demo-local or kit-local.
Rationale: Browser packaging is useful for demos but does not define AIR Core semantics, conformance, or Host ABI.
Compatibility risk: High if Core starts promising browser build behavior or asset pipeline layout.
Rejection reason: Public alpha Core package must expose Core/spec/CLI/conformance only.
Alternative: project-local
Why not Core: Browser/Vite bundling is demo packaging and host build workflow, not AIR language, verifier, or package semantics.
Existing alternative: Use project-local build scripts and future optional kits.
Demo migration: Provide one verify/build command and public README per demo without importing full demo builds into Core.

## Notes

This aligns with public package quarantine and consumer evidence separation.
