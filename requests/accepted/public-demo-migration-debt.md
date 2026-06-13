# Public Demo Migration Debt

Title: Public Demo Migration Debt
Source demo/project: PhotoLoop, AirWorld, Airtris, Minesweeper, and public demo publication audit.
Original source path: docs/public_release/DEMO_PUBLICATION_AUDIT.md, docs/public_release/PUBLIC_CUT_AUDIT.md, docs/abi-requests/fixed-bounded-state-segment.md
Target layer: project kit
Status: accepted/planned
Decision: Accepted as demo migration debt for v0.44-v0.45, not as Core language, AIR ABI, or Host ABI scope.
Rationale: Public demos need launch-safe README files, one verify command, evidence/report commands where available, screenshots/GIFs, and migration to existing AIR features without defining Core semantics.
Compatibility risk: Low if kept project-local. Risk becomes high if demo-specific board, generated package, rendering, or host behavior becomes Core/API authority.
Version target: v0.44-v0.45
Owner: AIR Core release governance
Existing alternative: Use existing fixed state, declared pools, tablegroups, output contracts, command buffers, package-check, reports, and public demo README template.
Demo migration: Add one verify command per public demo; migrate Airtris/Minesweeper/PhotoLoop/AirWorld AIR-owned logic to existing public AIR surfaces where applicable; keep rendering/assets/browser behavior host-owned.

## Notes

This request covers public demo cleanup and migration debt only. It does not
accept new Core syntax, game APIs, browser APIs, Host ABI imports, or npm
package surface.
