# Color And Channel Arithmetic

Title: Color And Channel Arithmetic
Source demo/project: PhotoLoop and cross-demo visual policy pressure.
Original source path: ../demos/AIR_LANGUAGE_PRESSURE.md
Target layer: stdlib
Status: implemented
Decision: Generic color/channel arithmetic is implemented as deterministic stdlib helpers.
Rationale: PhotoLoop needed repeated clamped RGB/channel math. The generic part is resource-free scalar color math, not Canvas, ImageData, GPU, or filesystem authority.
Compatibility risk: Low; stdlib helpers are additive and do not change AIR ABI or Host ABI.
Closed in: std.color
Existing alternative: Use `std.color` helpers for packing, channel extraction, interpolation, exposure, and related deterministic scalar operations.
Demo migration: Keep image decode, canvas traversal, file pickers, and export in the host; call AIR only for bounded scalar policy or kernels.

## Notes

This closes the basic color/channel arithmetic request. Pixel-buffer ABI remains
separate and rejected for Core before 1.0.
