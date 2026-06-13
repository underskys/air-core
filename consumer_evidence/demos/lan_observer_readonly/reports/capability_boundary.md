# lan-observer-style Capability Boundary

Status: core-proof

## Allowed

- Sanitized scalar structured facts.
- Bounded output intent.
- Deterministic replay and evidence summaries.

## Denied

- Real network access.
- Raw packet capture.
- Writes/mutations.
- Secrets/tokens, raw hostnames, raw MAC/IP values unless sanitized IDs, and
  private text.

## Routing

- Core: read-only consumer proof and evidence pack.
- stdlib: none.
- kit: future host adapter helpers may live outside Core.
- host adapter: external integration planning only.
- demo-local: external scanner details.
- rejected: raw host authority and automatic remediation.
