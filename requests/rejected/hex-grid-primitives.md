# Hex Grid Primitives

Title: Hex Grid Primitives
Source demo/project: Minesweeper hex edge clue pressure.
Original source path: ../demos/minesweeper/AIR_HEX_EDGE_CLUE_REQUEST.md
Target layer: reusable kit
Status: rejected/kit
Decision: Rejected for Core before 1.0; eligible as reusable kit or project kit after public alpha.
Rationale: Hex axial helpers and scan-direction policy are useful, but they are domain helpers, not Core semantics.
Compatibility risk: Low if kept in kit/project code; medium if promoted into stdlib without independent non-game evidence.
Rejection reason: Demo-specific grid vocabulary is not Core behavior.
Alternative: kit
Why not Core: Hex axial helpers and scan policies are domain helpers, not minimum AIR Core semantics before 1.0.
Existing alternative: Implement deterministic hex helpers inside the Minesweeper package or a future optional `std.grid.hex`/kit proposal.
Demo migration: Keep host rendering, pointer picking, camera orbit, and visual scan decoration host-owned.

## Notes

This explicitly rejects moving hex grid primitives into Core before 1.0.
