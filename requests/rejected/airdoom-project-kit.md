# AirDoom Project Kit Requests

Title: AirDoom Project Kit Requests
Source demo/project: AirDoom arena project kit.
Original source path: docs/abi-requests/airdoom.md
Target layer: project kit
Status: rejected/project-only
Decision: Rejected as Core/Host ABI pressure; keep AirDoom materials, routes, pickups, teleporters, and gameplay in project kit or host implementation.
Rationale: AirDoom can produce useful host/report polish pressure, but its arena semantics are project-specific.
Compatibility risk: High if promoted directly because it would contaminate public surfaces with demo vocabulary.
Rejection reason: Project-specific gameplay and assets are not Core semantics.
Alternative: project-local
Why not Core: AirDoom arena materials, routes, pickups, teleporters, and gameplay are project-specific and do not define portable AIR semantics.
Existing alternative: Use existing `gfx.*`, `gpu.*`, `input.*`, manifests, and project-local kit code.
Demo migration: File separate generic requests only for collision/report/manifest gaps proven outside AirDoom.

## Notes

This entry satisfies the formal ledger link for the AirDoom triage summary.
