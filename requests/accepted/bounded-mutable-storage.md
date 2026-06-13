# Bounded Mutable Storage

Title: Bounded Mutable Storage
Source demo/project: Airtris, Minesweeper, PhotoLoop, AIRON, bounded simulation pressure.
Original source path: docs/abi-requests/fixed-bounded-state-segment.md
Target layer: core
Status: implemented
Decision: Implemented as fixed state and v0.41 declared fixed-capacity pools; no dynamic collections, GC, object model, or host authority.
Rationale: Multiple demos needed bounded mutable scalar state, but the generic need is fixed-capacity verifier-visible AIR-owned storage rather than game boards, pixel buffers, or host objects.
Compatibility risk: Low for existing packages; implementation preserved AIR ABI 0.10 and Host ABI 0.11.
Closed in: v0.41
Existing alternative: Use fixed state or declared pools with scalar `i32`/`bool` fields and explicit verifier bounds.
Demo migration: Replace scalar slot families with declared pools or fixed state, then expose host-visible effects through output contracts or command buffers.

## Notes

This closes the generic pressure for bounded mutable storage. It does not accept
dynamic arrays, maps, heap allocation, GC, browser objects, renderer objects, or
pixel-buffer ABI.
