# Few-shot: Policy Audit Module

Use AIR-authored static data for fixed policy facts.

`allowlist.air`:

```air
module allowlist
const SERVICE_API:i32 = 0
const SERVICE_CI:i32 = 1
const SERVICE_ADMIN:i32 = 2
const RETRY_FAST_MS:i32 = 100
const RETRY_SLOW_MS:i32 = 250
const RETRY_BLOCKED_MS:i32 = 0
table allowed:i32[3] = [1, 1, 0]
table retry_ms:i32[3] = [RETRY_FAST_MS, RETRY_SLOW_MS, RETRY_BLOCKED_MS]
capabilities { }

export func service_allowed(service_id: i32) -> i32 {
entry:
  %allowed:i32 = table.get allowed, %service_id
  return %allowed
}

export func retry_budget_ms(service_id: i32) -> i32 {
entry:
  %budget:i32 = table.get retry_ms, %service_id
  return %budget
}
```

Why this is preferred:

- Fixed data is visible in report metadata.
- Tables replace select-chain-as-table patterns.
- No host authority is introduced.
- The package remains portable across verifier/CLI-style profiles.

Avoid:

- repeated literal floods;
- `service0`, `service1`, `service2` mutable slot families;
- debug metrics as policy events;
- JSON files as hidden program semantics.
