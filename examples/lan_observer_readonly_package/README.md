# LAN Observer Read-only Package

This is a synthetic Core proof for a lan-observer-style read-only consumer. It
does not scan a network, read OS devices, capture packets, store secrets, or
write to external systems.

The host owns real network/platform state and converts it into sanitized bounded
scalar structured facts before AIR runs. AIR owns only deterministic
diagnosis/recommendation logic over those facts.

## Boundary

Allowed inside AIR:

- sanitized `i32` ids, flags, enums, scores, and counters;
- bounded structured IO metadata;
- deterministic scalar diagnosis/recommendation functions;
- bounded output intent metadata and command buffer records.

Forbidden inside AIR:

- raw hostnames, MAC addresses, IP addresses, packet payloads, URLs, private
  notes, tokens, secrets, credentials, and raw logs;
- OS, cloud, browser, database, packet capture, or network APIs;
- writes, mutation, auto-remediation, or host-side execution authority.

## Commands

```sh
node bin/airc.js generate structured-io examples/lan_observer_readonly_package
node bin/airc.js package-check examples/lan_observer_readonly_package --profile cli --source-only --json
node bin/airc.js verify package examples/lan_observer_readonly_package --profile cli --json
node bin/airc.js conformance examples/lan_observer_readonly_package --profile cli --trace examples/lan_observer_readonly_package/traces/pass.json --json
node bin/airc.js mock-host examples/lan_observer_readonly_package --policy examples/lan_observer_readonly_package/host_policies/lan_observer_readonly.policy.json --profile cli --trace examples/lan_observer_readonly_package/traces/pass.json --json
node bin/airc.js evidence report examples/lan_observer_readonly_package --format markdown -o build/lan_observer_readonly_evidence.md
node bin/airc.js benchmark benchmarks/lan_observer_readonly_basic --json
node bin/airc.js eval-ai evals/ai_authoring --json
```

Package diff coverage is locked by
`expected/package_diff_output_contract.summary.json`; the test compares old/new
proof copies with a changed output contract id and expects package diff to show
that bounded intent change without raw private data.

## Decision Surface

The example exposes:

- `diagnosis_code(...) -> i32`
- `severity(...) -> i32`
- `recommended_action_id(...) -> i32`
- `confidence_x1000(...) -> i32`
- `requires_human_approval(...) -> i32`
- `recommendation_code(...) -> i32`

The command buffer records the bounded scalar intent:

- `diagnosis_code`
- `severity`
- `recommended_action_id`
- `confidence_x1000`

`requires_human_approval` remains an explicit scalar decision helper. It is not
a host-side action and does not grant authority.

The structured input facts are `device_id`, `link_status`, `latency_ms`,
`packet_loss_x1000`, `gateway_reachable`, `dns_reachable`,
`recent_change_flag`, `interface_kind`, `confidence_source`, and
`observation_age_ms`. Each field is scalar and sanitized; none is a raw
hostname, MAC address, IP address, URL, packet, note, token, secret, or
credential.

## Unsafe-to-Safe Story

The rejected fixture
`test/fixtures/lan_observer_readonly/unsafe_raw_authority/` shows the unsafe
shape AIR is designed to stop: an AI-authored package tries to call raw host
externs such as `host.fetch` and `device.mutate`, and it tries to model runtime
JSON/object payloads in structured IO. Package-check and verification reject
that package with stable diagnostics for unsupported host imports/profile
mismatch and runtime JSON/object structured IO drift.

The safe replacement is this package:

- the host converts real platform state into sanitized scalar facts;
- AIR computes deterministic diagnosis and recommendation values;
- AIR records bounded output intent through the command buffer;
- mock host policy decides whether the intent is allowed;
- evidence and replay explain the boundary without exposing raw private data.

## ABI Status

AIR ABI remains `0.10`.

Host ABI remains unchanged. The package uses Host ABI `0.10` and command buffer
metadata. No new host imports are added.
