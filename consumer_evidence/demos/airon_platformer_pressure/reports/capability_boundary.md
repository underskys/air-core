# AIRON Platformer Capability Boundary

Status: pressure evidence

## Allowed

- Generic pressure routing.
- Package-check and review notes.
- Deferred RFC pressure for table-like data and resource validators.

## Denied

- Platformer-specific Core APIs.
- `draw_actor`.
- Dynamic host object handles.
- GC/maps.
- `debug.metric` event bus.

## Routing

- Core: bounded structured IO/tablegroup pressure, deferred.
- stdlib: none accepted.
- kit: sprite/rig/presentation conventions, deferred.
- host adapter: renderer and asset handling remain host-owned.
- demo-local: gameplay, art style, browser UI, and editor tooling.
- rejected: game-specific APIs and hidden host gameplay authority.
