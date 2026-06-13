# Voxel Demo Game APIs

Title: Voxel Demo Game APIs
Source demo/project: Voxel Demo pressure.
Original source path: docs/abi-requests/voxel-demo.md
Target layer: project kit
Status: rejected/project-only
Decision: Rejected as direct Core/Host ABI; voxel terrain, animals, caves, material IDs, and art direction remain demo/project-kit concerns.
Rationale: Voxel pressure can inform host implementation, reusable kits, and manifest/report polish, but not public Core semantics.
Compatibility risk: High if voxel-specific rendering APIs enter high-level Host ABI.
Rejection reason: Demo-specific rendering and content concepts are not generic.
Alternative: project-local
Why not Core: Voxel terrain, animals, caves, materials, and art direction are demo content and renderer/kit concerns, not Core semantics.
Existing alternative: Use existing `gpu.*`, `.airgfx.json`, scene compiler, render graphs, kits, and host diagnostics.
Demo migration: Keep generated AIR package patterns and benchmark snippets generic if promoted.

## Notes

Generic grid/fixed-point helpers may be considered separately only with neutral
names and non-demo evidence.
