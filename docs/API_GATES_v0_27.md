# AIR API Gates v0.27

v0.27 is a Host ABI `0.11` stabilization milestone. The API gate preserves the
bounded `output.emit` first slice accepted in v0.26 and prevents new event,
payload, raw authority, or demo-driven Host ABI surfaces from entering AIR Core.

The gate does not accept new Host ABI features. AIR ABI remains `0.10`. Host ABI
remains `0.11` only for the bounded `output.emit` first slice:

```text
output.emit(output_id:i32, arg0:i32, arg1:i32, arg2:i32, arg3:i32) -> i32
```

## Allowed

The v0.27 gate allows only the v0.26 bounded output intent surface:

- exact `output.emit(output_id:i32, arg0:i32, arg1:i32, arg2:i32, arg3:i32) -> i32`;
- scalar `i32` args only;
- statically resolvable `output_id`;
- validation against package-local `outputContracts`;
- explicit host profile, capability, and effect-budget gates;
- docs, RFCs, tests, and fixtures that describe accepted and rejected behavior.

Command buffers remain the preferred batch output-intent path. `output.emit` is
the bounded scalar intent path for packages that explicitly opt into Host ABI
`0.11`.

## Rejected

The v0.27 gate rejects:

- `output.event`;
- `audio.event`;
- `effect.event` / `effect_event`;
- `output.emit` with dynamic `output_id`;
- string, object, map, JSON, payload, raw text, raw URL, or private text args;
- pointer or slice args;
- raw `chrome.*`;
- DOM, React, IndexedDB, Jira, or `fetch` authority;
- DB, cloud SDK, Kubernetes, docker, or shell authority in public AIR surfaces;
- host object handles;
- automatic host-side action guarantees;
- demos becoming Host ABI authority.

## Gate Script

`scripts/check_api_gates_v0_27.js` runs the v0.26 gate first, then applies the
v0.27 stabilization checks:

- no new `output.emit` shape beyond the v0.26 first slice;
- no dynamic `@output.emit(%...)` calls outside docs/tests/rejection fixtures;
- no Host ABI `0.11` or `output.emit` authority under `demo/`;
- no active event-import or raw-authority expansion.

The script is intentionally low-noise. It should fail on API-surface creep, not
on docs that explicitly describe rejected behavior.

## RC Usage

```sh
npm run check:api-gates:v0.27
```

Core RC checks run this gate together with the v0.21, v0.22, and v0.26 gates.
