# lan-observer-style Prompt Summary

Status: safe captured summary

## Prompt Summary

- Goal: produce a read-only diagnosis package from sanitized network-like facts.
- Constraints: no real network, no secrets, no writes, no raw hostnames, no raw
  MAC/IP values.
- Expected AIR boundary: consume bounded scalar facts and emit bounded
  recommendation intent.
- Forbidden surfaces: raw host authority, runtime JSON payloads, automatic
  remediation, host object handles.

## Repair Notes

- Initial issue: unsafe attempts should route host/network access back to the
  host adapter.
- Diagnostic code: `air.api_gate.raw_host_authority_rejected`.
- Safe repair direction: use sanitized structured facts and bounded output
  intent.
