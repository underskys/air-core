# AirWorld Showcase Semantics

Title: AirWorld Showcase Semantics
Source demo/project: AirWorld public showcase pressure.
Original source path: docs/public_release/DEMO_PUBLICATION_AUDIT.md
Target layer: project kit
Status: rejected/project-only
Decision: Rejected as Core semantics. AirWorld may become a public showcase, but generated package semantics, world objects, visuals, and host behavior stay demo/project-owned.
Rationale: The public audit records AirWorld launch blockers, including README accuracy and public presentation needs. Those are documentation/demo migration issues, not generic AIR Core needs.
Compatibility risk: High if world/showcase vocabulary or generated package behavior becomes public Core authority.
Rejection reason: Showcase semantics and generated demo package behavior are project-specific and not Core behavior.
Alternative: project-local
Why not Core: World/showcase vocabulary, visuals, and generated demo package behavior are presentation concerns, not verifier-enforced AIR semantics.
Existing alternative: Use existing AIR package-check, verify, report/evidence commands, tablegroups, pools, output contracts, and host-owned rendering.
Demo migration: Fix public README language, add one verify command, document AIR owns / Host owns, and keep hosted page/GIF outside Core semantics.

## Notes

This entry closes AirWorld-specific promise debt without importing the external
demo or accepting demo-specific APIs.
