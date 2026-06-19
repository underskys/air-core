# v0.46 Math Stabilization Plan

Status: proposed first executable math stabilization slice.

v0.46 should follow the v0.45 public release candidate. It should turn the
v0.45 Math & Host Profile Planning/Audit outcome into a small public
implementation slice without widening AIR ABI or Host ABI by default.

`@underskys/air-core@0.45.0` does not include new math implementation. It
shipped public positioning, governance, roadmap, and release hygiene.
`@underskys/air-core@0.45.1` is a README/package presentation patch candidate
only and also does not include new math implementation.

## Scope

- Stabilize and document existing `f32.sin`, `f32.cos`, and `f32.sqrt`
  behavior.
- Add conformance tests for accepted existing math behavior.
- Document approximation, input range, determinism, and error caveats.
- Add `std.math` examples or wrappers only if they reuse existing semantics.
- Keep Host ABI unchanged.
- Keep AIR ABI unchanged unless an explicit review approves otherwise.
- Do not implement `exp`, `log`, or `pow` without a separate RFC.

## Non-Goals

- No npm publish.
- No tag creation.
- No language feature additions.
- No Host ABI expansion.
- No AIR ABI expansion by default.
- No private/review artifact import.
- No package identity changes.

## Acceptance Checks

Before v0.46 can become a public release candidate, the public repository must
show:

- deterministic tests for accepted existing math operations;
- documented caveats for approximations and input ranges;
- no public claims that unimplemented math operations exist;
- no AIR ABI or Host ABI delta unless separately approved;
- package surface and public-claims checks passing;
- consumer-facing examples that reuse released semantics only.

## Review Stop Conditions

Stop for explicit release review if the implementation proposes any of the
following:

- new math operations outside existing accepted behavior;
- `exp`, `log`, `pow`, or equivalent wider numeric surface;
- new host imports or host authority;
- AIR ABI or Host ABI version changes;
- package identity or publish workflow changes;
- private/dev bundle artifacts in public state.
