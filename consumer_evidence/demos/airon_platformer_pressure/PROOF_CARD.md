# AIRON Platformer Pressure Proof Card

Status: pressure-evidence

Category: interactive demo pressure

AI-authored: unknown

## AIR Owns

- Deterministic game logic pressure.
- Authored package/tablegroup/pool pressure.
- Core/kit/host-adapter boundary review.

## Host Owns

- Rendering.
- Assets.
- Browser/WebGPU.
- Input.
- Demo-specific gameplay behavior.

## Allowed Capabilities

- Pressure routing.
- Package-check evidence.
- Review notes.

## Denied Authorities

- Platformer-specific Core APIs.
- `draw_actor`.
- Dynamic host object handles.
- GC/maps.
- `debug.metric` event bus.

## Evidence

- The pressure request is documented in
  `docs/abi-requests/airon-platformer-pressure.md`.
- Capability boundaries are summarized in `reports/capability_boundary.md`.

## Known Limitations

- This is pressure evidence only.
- Replay and metrics are pending because no external AIRON demo source is
  imported into Core.

## Routing Notes

- Core: tablegroup pressure remains deferred behind RFC/gates.
- kit: sprite/rig/presentation contracts may route to future kit work.
- demo-local: game rules, rendering, assets, and local editor behavior.
- rejected: demo-specific Core APIs and raw host authority.
