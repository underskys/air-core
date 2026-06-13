# Consumer Evidence Corpus

Title: Consumer Evidence Corpus
Source demo/project: lan-observer-style proof, AIRON pressure, AirOps-style package pressure.
Original source path: consumer_evidence/DEMO_REGISTRY.json
Target layer: manifest schema
Status: implemented
Decision: Implemented as `consumer_evidence/` skeleton, schemas, validator, bundle generator, and seeded safe entries.
Rationale: Downstream demos should provide pressure evidence without defining Core semantics or npm package surface.
Compatibility risk: Low; this is tooling/docs/evidence intake and does not change AIR ABI or Host ABI.
Closed in: v0.36
Existing alternative: Use `consumer_evidence/` proof cards and summaries; do not import full demos into Core.
Demo migration: Submit pressure through consumer evidence entries and then formal request ledger entries before asking for Core changes.

## Notes

Consumer evidence is not Core authority. It records allowed capabilities,
denied authorities, and pressure routing only.
