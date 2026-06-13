# Event And Output Intent Surface

Title: Event And Output Intent Surface
Source demo/project: AIRON, Airtris, Minesweeper, FlowDesk Air, AirOps-style package pressure.
Original source path: docs/abi-requests/airon-platformer-pressure.md
Target layer: host ABI
Status: implemented
Decision: Implemented as output contracts, command buffers, generated output handles, mock host policy, and bounded `output.emit`; do not add `output.event` or debug-metric event buses.
Rationale: Demos needed bounded host-visible intents, but host policy must own execution. AIR should emit bounded scalar intent, not direct renderer/audio/network action.
Compatibility risk: Medium at design time, now closed by explicit Host ABI 0.11 bounded `output.emit` scope. Host ABI 0.10 remains supported for packages without `output.emit`.
Closed in: v0.28/v0.35/v0.38
Existing alternative: Use output contracts, command buffers, generated handles, `mock-host`, and E2E proof reports.
Demo migration: Replace debug metric signaling and ad hoc visual/audio event paths with bounded output intents interpreted by host policy.

## Notes

This entry closes the generic event/intent request. It rejects automatic repair,
hidden host effects, debug metrics as behavior authority, and demo-specific
event imports.
