# Sprite And Modular Actor ABI

Title: Sprite And Modular Actor ABI
Source demo/project: AIRON/Contra modular actor pressure.
Original source path: demo/airon/FD_LANGUAGE_REQUESTS.md
Target layer: reusable kit
Status: rejected/kit
Decision: Rejected as Core/Host ABI before 1.0; sprite, rig, actor, pose, and transform conventions are kit candidates.
Rationale: Actor rendering and pose selection are reusable demo concerns, but not Core language semantics.
Compatibility risk: High if actor APIs become public Host ABI without renderer/profile review.
Rejection reason: Platformer/game-specific presentation APIs must not enter Core.
Alternative: kit
Why not Core: Sprite rigs, actor pose selection, and transform conventions belong in reusable/project kits, not AIR Core or Host ABI before 1.0.
Existing alternative: Emit bounded scalar output intents or low-level existing draw commands; host owns rendering.
Demo migration: Prototype sprite/rig conventions in a reusable kit after Core public alpha.

## Notes

This rejects `draw_actor` and similar actor-specific imports.
