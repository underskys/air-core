# Pixel Buffer Kernel ABI

Title: Pixel Buffer Kernel ABI
Source demo/project: PhotoLoop pixel-processing pressure.
Original source path: ../demos/AIR_LANGUAGE_PRESSURE.md
Target layer: reusable kit
Status: rejected/kit
Decision: Rejected as Core/Host ABI before 1.0; convention or kit candidate only.
Rationale: PhotoLoop proves useful scalar kernel pressure, but Canvas, ImageData, file pickers, PNG export, layer composition, and neighborhood traversal are host/demo responsibilities.
Compatibility risk: Medium to high if Core accepts pixel-buffer ABI because it could imply memory layout and host readback contracts.
Rejection reason: Pixel buffers are domain/runtime conventions, not Core semantics for public alpha.
Alternative: kit
Why not Core: Canvas/ImageData traversal, buffer layout, export, and host readback are runtime/domain conventions that would overdefine Core.
Existing alternative: Use scalar AIR exports and `std.color`; keep image traversal and IO host-owned.
Demo migration: Document a kit convention for bounded pixel kernels after Core public alpha.

## Notes

This does not reject scalar color math; that part is already implemented by
`std.color`.
