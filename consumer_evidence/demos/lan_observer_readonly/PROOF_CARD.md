# lan-observer-style Read-only Proof Card

Status: core-proof

Category: read-only diagnostics

AI-authored: yes

## AIR Owns

- Sanitized bounded structured facts.
- Deterministic diagnosis/recommendation logic.
- Bounded output intent metadata.
- Evidence, replay, package diff, benchmark, and eval summaries.

## Host Owns

- Raw network/platform state.
- Sanitization and privacy filtering.
- Policy execution.
- All real side effects.

## Allowed Capabilities

- Bounded structured IO metadata.
- Bounded output intent.
- Deterministic replay.
- Privacy-safe evidence report.

## Denied Authorities

- Real network access.
- Raw packet capture.
- Host writes.
- Secrets.
- Raw hostnames.
- Raw MAC/IP values unless sanitized IDs.
- Writes/mutations.
- Secrets/tokens.

## Evidence

- Existing Core proof package is referenced from `examples/lan_observer_readonly_package`.
- Capability boundary is summarized in `reports/capability_boundary.md`.
- Replay and metrics summaries are represented by safe JSON descriptors.

## Known Limitations

- This entry references the Core fixture; it does not import an external
  lan-observer project.
- Raw network observations remain host-owned and are not part of the corpus.

## Routing Notes

- Core: accepted as v0.35 read-only consumer proof.
- Host adapter: deferred for external integrations.
- Rejected: real scanner behavior, raw host authority, and automatic writes.
