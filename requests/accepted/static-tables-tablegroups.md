# Static Tables And Readonly Tablegroups

Title: Static Tables And Readonly Tablegroups
Source demo/project: Voxel Demo, AIRON, Airtris, Minesweeper, FlowDesk Air.
Original source path: docs/abi-requests/core-data-ergonomics.md
Target layer: core
Status: implemented
Decision: Static scalar tables and readonly tablegroups are the accepted Core answer for related readonly scalar data.
Rationale: Demos repeatedly needed grouped constants, level sections, presets, and bounded facts. The generic Core need is static scalar data with verifier-visible length and bounds, not runtime objects.
Compatibility risk: Low; tablegroups lower to existing static table machinery and preserve AIR ABI 0.10.
Closed in: v0.13/v0.37
Existing alternative: Use module constants, static tables, or readonly tablegroups; keep records/objects/maps out of runtime AIR.
Demo migration: Convert select-chain-as-table and parallel readonly table families into tablegroups where row relation matters.

## Notes

This entry covers static tables from v0.13 and readonly tablegroups from v0.37.
It does not accept mutable tablegroups, dynamic rows, nested records, or object
identity.
