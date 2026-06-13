# Network Scanner Host ABI

Title: Network Scanner Host ABI
Source demo/project: Network dashboard and lan-observer-style diagnostics.
Original source path: docs/abi-requests/network-scanner.md
Target layer: host ABI
Status: rejected/post-1.0
Decision: Rejected before 1.0; no scanner Host ABI or real network authority in public alpha.
Rationale: Real network probes, DNS, sockets, packet capture, interface inspection, and logs are security-sensitive host authority.
Compatibility risk: High; would require deny-by-default host policy, audit logs, conformance, rate limits, and security review.
Rejection reason: Host ABI expansion and real network authority are out of public alpha scope.
Alternative: post-1.0
Why not Core: DNS, sockets, packet capture, interface inspection, and probes are security-sensitive host authority, not AIR-owned computation.
Existing alternative: Use sanitized structured facts and read-only proof packages; host owns real probes and policy.
Demo migration: Route external scanner pressure through consumer evidence, not Core ABI.

## Notes

lan-observer-style proof is accepted only for sanitized facts and bounded output
intent, not real scanning.
