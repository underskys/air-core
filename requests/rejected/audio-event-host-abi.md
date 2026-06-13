# Audio Event Host ABI

Title: Audio Event Host ABI
Source demo/project: AIRON/Contra audio pressure.
Original source path: demo/airon/FD_LANGUAGE_REQUESTS.md
Target layer: host ABI
Status: rejected/post-1.0
Decision: Rejected for new Host ABI before 1.0; use existing audio/report boundaries or bounded output intents.
Rationale: Audio playback is host authority. AIR may choose bounded intent IDs, but the host owns browser/native playback, assets, volume, and policy.
Compatibility risk: High if new audio imports imply runtime behavior across hosts without conformance.
Rejection reason: No Host ABI expansion before 1.0 for demo audio events.
Alternative: host-owned
Why not Core: Audio playback, browser/native media state, assets, and volume policy are host authority and require Host ABI review before any public surface.
Existing alternative: Use existing audio capability where already supported, or output contracts/command buffers for policy-owned audio intent.
Demo migration: Do not use `debug.metric` as audio/event bus; route audible behavior through bounded host policy.

## Notes

Future granular audio capabilities require a separate Host ABI RFC.
