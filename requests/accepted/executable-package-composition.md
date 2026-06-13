# Executable Package Composition

Title: Executable Package Composition
Source demo/project: AIRON authored module flattening pressure.
Original source path: docs/abi-requests/airon-platformer-pressure.md
Target layer: core
Status: implemented
Decision: Implemented as v0.39 executable package composition first slice with authored graph, executable graph, and ownership map.
Rationale: The generic need is preserving authored ownership while producing deterministic executable output. AIRON flattening is pressure evidence only.
Compatibility risk: Low; executable graph is derived and cannot introduce new capabilities/effects absent from the authored graph. AIR ABI remains 0.10 and Host ABI unchanged.
Closed in: v0.39
Existing alternative: Use authored graph as source/review surface and deterministic executable graph as derived output.
Demo migration: Stop treating demo-local flattening as semantic authority; use package composition ownership metadata.

## Notes

This does not accept package registries, native installers, browser/Vite
bundling, asset pipeline rewrites, or game-specific composition APIs.
