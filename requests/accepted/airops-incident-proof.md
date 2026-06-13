# AirOps-style Incident Proof

Title: AirOps-style Incident Proof
Source demo/project: AirOps-style incident package.
Original source path: consumer_evidence/demos/airops_incident_package/MANIFEST.json
Target layer: reusable kit
Status: implemented
Decision: Accepted as a small canonical policy/ops evidence example, not a production incident adapter.
Rationale: The generic Core value is bounded incident facts and command-buffer output intent with host-owned policy execution.
Compatibility risk: Low; no real incident system access, secrets, host writes, or Host ABI expansion.
Closed in: v0.36
Existing alternative: Use bounded facts and command buffers; keep real incident integrations outside Core.
Demo migration: Treat this as evidence/report example only.

## Notes

Automatic remediation and raw incident-system authority remain rejected.
