# UI Dashboard New Host ABI

Title: UI Dashboard New Host ABI
Source demo/project: UI/dashboard demo pressure.
Original source path: docs/abi-requests/ui-dashboard.md
Target layer: host ABI
Status: rejected/post-1.0
Decision: Rejected for new Host ABI before 1.0; use existing UI commands and host implementation/report polish.
Rationale: Dashboard demos should prove product loops through existing bounded scalar UI/status commands before any Host ABI expansion.
Compatibility risk: Medium to high if new UI imports are added without independent evidence and host registry review.
Rejection reason: No Host ABI expansion before 1.0 for dashboard polish.
Alternative: post-1.0
Why not Core: Dashboard layout/rendering commands can use existing UI surfaces or host implementation until a cross-domain Host ABI gap is proven.
Existing alternative: Use existing `ui.*` commands, manifests, and report/evidence paths.
Demo migration: File a new request only for a generic command gap proven across domains.

## Notes

Existing UI ABI usage remains allowed; this rejects new dashboard-specific Host
ABI growth.
