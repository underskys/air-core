# AIR v0.22 API Gates

Status: active first-slice RC/review gate

v0.22 adds conservative API gates for Fixed Bounded State Segment pressure. The
gates are intended to keep the RFC/design work from leaking into runtime state,
host authority, or dynamic data models before an implementation RFC is accepted.

These gates do not implement Fixed Bounded State Segment. They do not remove
legacy APIs. They do not change AIR ABI or Host ABI.

## Canonical Boundary

Fixed Bounded State Segment remains a future Core semantic storage candidate:

- statically declared;
- fixed length;
- scalar cells only;
- deterministic initialization;
- per AIR execution instance / package execution instance;
- verifier-counted reads and writes;
- report-visible budgets and evidence;
- no pointer, slice, or reference escape.

## Hard-Rejected State Patterns

The following patterns are rejected in active Core implementation unless a
future accepted RFC explicitly changes the rule:

- dynamic state length;
- state pointer, slice, or reference escape;
- host direct state read/write authority;
- shared mutable state across execution instances;
- cross-instance state;
- atomics or shared memory;
- state as JSON, object, or map;
- state fields that imply a runtime JSON object model;
- state-conditional host authority;
- state-conditional Output Contract declarations;
- state requiring `output.emit`;
- state requiring Host ABI `0.11`;
- Canvas, ImageData, or pixel-buffer authority in Core;
- game-specific state helpers in Core;
- report claims that treat visibility as proof.

## Allowed Mentions

The gates must not fail only because docs, RFCs, migration notes, or rejection
fixtures discuss forbidden patterns. v0.22 is an RFC/gates/design milestone, so
future/rejected wording is expected in documentation.

Tests may include rejection fixtures when the fixture clearly exists to prove
that a forbidden pattern fails.

## Machine Check First Slice

`npm run check:api-gates:v0.22` is conservative and low-noise. It scans active
non-doc Core paths for strong forbidden implementation patterns only:

- raw `chrome.*`;
- `output.emit` / `output.event` / `audio.event` / `effect.event`
  implementation;
- Host ABI `0.11` source/profile support without a decision record;
- obvious Fixed Bounded State Segment implementation markers before acceptance;
- obvious state pointer/slice/reference escape markers paired with state
  segment implementation markers;
- obvious runtime JSON/object model fields in active Core API implementation.

The check is a release hygiene guard, not a verifier. It does not prove semantic
safety. Verifier obligations remain defined by the RFC.

Clean runs should not print standing warnings. If the script emits a warning, it
must be tied to a specific state-like pattern that was found and intentionally
treated as non-blocking.

## RC / Review Status

The v0.22 API gate check is part of RC/review checks when both
`scripts/check_api_gates_v0_22.js` and `docs/FEATURE_STATUS_v0.22.md` are
present.

If the gate fails, RC review must treat it as an active API gate violation until
the forbidden implementation is removed or a decision record explicitly accepts
the surface.
