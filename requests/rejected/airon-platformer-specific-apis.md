# AIRON Platformer-specific APIs

Title: AIRON Platformer-specific APIs
Source demo/project: AIRON platformer pressure.
Original source path: docs/abi-requests/airon-platformer-pressure.md
Target layer: project kit
Status: rejected/project-only
Decision: Rejected as direct Core/Host ABI; AIRON is pressure evidence only.
Rationale: AIRON showed real pressure for generic package composition, tablegroups, pools, and resource validation, all of which must remain generic.
Compatibility risk: High if AIRON vocabulary or gameplay rules become public API.
Rejection reason: Platformer-specific APIs, `draw_actor`, dynamic entity handles, GC/maps, and debug metric event buses are out of Core.
Alternative: project-local
Why not Core: Platformer vocabulary, rendering behavior, actor semantics, and gameplay rules are demo-specific and cannot define Core or Host ABI.
Existing alternative: Use implemented generic features and project-local renderer/asset systems.
Demo migration: Use tablegroups for readonly level data, pools for bounded mutable slots, output contracts for intents, and resource validators for package hygiene.

## Notes

This entry does not reject the generic features already accepted from AIRON
pressure.
