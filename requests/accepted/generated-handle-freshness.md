# Generated Handle Freshness

Title: Generated Handle Freshness
Source demo/project: Contra Platformer, AIRON, package manifest fixtures.
Original source path: docs/abi-requests/contra-platformer.md
Target layer: manifest schema
Status: implemented
Decision: Implemented as package-check/generated handle freshness diagnostics and review-safe fixtures.
Rationale: Generated handle files are derived artifacts and must stay fresh without becoming source of truth or public API authority.
Compatibility risk: Low; this is package-check/report behavior and does not change AIR ABI or Host ABI.
Closed in: v0.13+
Existing alternative: Regenerate handles from manifest/source of truth and let package-check fail stale or missing artifacts.
Demo migration: Do not hand-edit generated handles; treat them as derived artifacts.

## Notes

This closes freshness pressure only. It does not accept generated demo APIs as
Core semantics.
