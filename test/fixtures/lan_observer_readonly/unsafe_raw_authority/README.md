# Unsafe lan-observer attempt

This fixture is intentionally rejected. It represents an AI-authored attempt to
turn the read-only proof into raw host authority.

The fixture contains only synthetic identifiers and invalid schema/extern
surfaces. It does not contain real network data, hostnames, MAC addresses, IP
addresses, URLs, secrets, tokens, credentials, or packet payloads.

Expected failures:

- unsupported raw host externs such as `host.fetch` and `device.mutate`;
- runtime JSON/object structured IO fields;
- missing generated structured IO handles because the schema is not valid.

The safe replacement is `examples/lan_observer_readonly_package/`: the host
converts real platform state into sanitized scalar structured facts, AIR emits a
bounded recommendation intent, and mock host policy owns the execution decision.
