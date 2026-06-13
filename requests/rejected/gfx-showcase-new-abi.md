# GFX Showcase New ABI

Title: GFX Showcase New ABI
Source demo/project: GFX showcase package.
Original source path: docs/abi-requests/gfx-showcase.md
Target layer: host implementation
Status: rejected/project-only
Decision: Rejected for new ABI; route to host implementation/report polish behind existing manifest and GFX surfaces.
Rationale: Showcase unsupported-feature reporting is generic host polish, but showcase art/assets are example content.
Compatibility risk: Medium if report schema changes; high if new GFX ABI is added without RFC.
Rejection reason: No new public GFX/Host ABI is required for this pressure.
Alternative: host-owned
Why not Core: Showcase rendering polish and unsupported-feature reporting can be handled by host implementation/reporting without new Core syntax or Host ABI.
Existing alternative: Improve diagnostics, host support, and examples behind existing contracts.
Demo migration: Keep visual assets and showcase style example-local.

## Notes

This does not block host implementation work behind already registered imports.
