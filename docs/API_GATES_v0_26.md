# AIR API Gates v0.26

v0.26 uses a controlled gate for the narrow Host ABI `0.11` bounded output emit
first slice. The gate is safety tooling for implementation review. It permits
the package/profile/check/runtime first slice only and still rejects runtime JSON
payloads, raw host authority, host object handles, and event imports.

## Allowed For v0.26 Implementation

Only the exact bounded candidate is in scope:

```text
output.emit(output_id:i32, arg0:i32, arg1:i32, arg2:i32, arg3:i32) -> i32
```

The implementation gate must preserve these constraints:

- `output_id` is statically resolvable from a literal, constant, or generated
  output handle.
- args are scalar `i32` only.
- `output_id` is validated against package-local `outputContracts`.
- host profile, capability, and effect-budget gates are required.
- docs, RFCs, tests, and fixtures may mention `output.emit` while proving
  accepted and rejected behavior.

## Still Rejected

The v0.26 gate continues to reject:

- `output.event`;
- `audio.event`;
- `effect.event` / `effect_event`;
- dynamic `output_id`;
- string, payload, object, map, or runtime JSON args;
- pointers and slices;
- host object handles;
- raw `chrome.*`;
- DOM, DB, cloud, Jira, or `fetch` authority;
- automatic host-side action guarantees;
- game-specific host APIs.

## Gate Script

`scripts/check_api_gates_v0_26.js` is intentionally conservative and
low-noise:

- docs/RFC/test/fixture mentions of `output.emit` are allowed;
- the explicit mock Host ABI `0.11` profile for output emit validation is
  allowed;
- active implementation mentions must stay inside explicitly scoped files;
- implementation files that declare an `extern output.emit` signature must use
  the exact scalar first-slice signature;
- raw authority, runtime JSON/object payload patterns, host object handles, and
  event imports remain blocked in active implementation paths.

The first script slice is docs-aware. If the implementation expands beyond the
current explicit allowlist, the allowlist and checks must be updated in the same
patch as the implementation so review can see the intended public surface.

## RC Usage

```sh
npm run check:api-gates:v0.26
```

Stable Core RC checks run this gate together with the older v0.21/v0.22 gates.
