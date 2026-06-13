# lan-observer-style Readonly Consumer Proof

Title: lan-observer-style Readonly Consumer Proof
Source demo/project: lan-observer-style read-only diagnostics.
Original source path: consumer_evidence/demos/lan_observer_readonly/MANIFEST.json
Target layer: core
Status: implemented
Decision: Implemented as a sanitized read-only Core proof package and product evidence pack.
Rationale: AIR can consume minimized scalar structured facts and emit bounded diagnosis/recommendation intent while the host owns raw network state and effects.
Compatibility risk: Low; no real network access, no Host ABI expansion, and AIR ABI remains 0.10.
Closed in: v0.35/v0.38
Existing alternative: Use sanitized facts, structured IO metadata, bounded output intent, mock host policy, replay, evidence, benchmark, and eval import fixtures.
Demo migration: External lan-observer adapters must stay host-owned and submit sanitized evidence only.

## Notes

This does not accept real network scanning, raw packet capture, raw hostnames,
raw MAC/IP values, secrets, writes, or automatic remediation.
