# Contra Platformer Game APIs

Title: Contra Platformer Game APIs
Source demo/project: Contra/AIRON platformer pressure.
Original source path: docs/abi-requests/contra-platformer.md
Target layer: project kit
Status: rejected/project-only
Decision: Rejected as direct Core or Host ABI. Platformer actor, water, boss, projectile, sprite, and level semantics remain project-kit or reusable-kit pressure.
Rationale: The generic parts have already been routed to tablegroups, pools, package composition, output intent, and resource validators.
Compatibility risk: High if demo APIs such as actor draw helpers or gameplay events enter Core/Host ABI.
Rejection reason: Game/platformer-specific APIs are not public Core semantics.
Alternative: project-local
Why not Core: Actor, water, boss, projectile, sprite, and level semantics are platformer/project concepts, not generic AIR semantics.
Existing alternative: Use v0.37 tablegroups, v0.41 pools, v0.39 package composition, and output contracts/command buffers.
Demo migration: Migrate platformer code to existing generic features; keep renderer, gameplay presentation, assets, and browser host local.

## Notes

Specific future reusable sprite/rig conventions require kit RFCs, not Core
language changes.
