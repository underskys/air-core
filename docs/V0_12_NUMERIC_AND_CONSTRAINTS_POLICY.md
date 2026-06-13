# AIR v0.12 Numeric And Constraints Policy

AIR numeric work exists to make AI-authored modules smaller, more reviewable,
and more deterministic without turning AIR into a broad high-level language.
This document defines where numeric behavior belongs and how constraints should
be reviewed.

## Layer Ownership

Core numeric ops are portable IR semantics. Core may define scalar integer,
floating-point, boolean, comparison, select, bounded loop, memory, constant, and
contract behavior when the semantics can lower deterministically to Wasm without
host-specific assumptions.

Stdlib numeric helpers are pure deterministic functions built from Core ops.
They must be backend-neutral, resource-free, and broadly reusable. Good stdlib
helpers include clamp/min/max/abs, fixed-point interpolation, deterministic
easing, generic bounds checks, generic contact tests, and grid indexing.

Package-local generated code may define handles, constants, and static data that
belong to one package. Generated code must not grant authority, expose host
objects, or become stdlib merely because multiple generated modules contain
similar literals.

Hosts own platform devices, timers, windows, GPU/audio/filesystem/network
behavior, and any target-specific acceleration. Core numeric ops must not depend
on host profile, GPU backend, OS, browser, or native runtime behavior.

## Fixed-Point Conventions

AIR uses explicit fixed-point helper names instead of implicit numeric modes.
The current shared convention is `_1000`, where `1000` represents `1.0`.

Rules:

- helper names must expose their scale, such as `easing.in_out_quad_1000`;
- integer division uses existing AIR/Wasm signed division semantics;
- rounding is truncating unless a helper explicitly documents a different
  deterministic rule;
- ranges should be documented with `requires` contracts where static checking is
  useful;
- fixed-point helpers must avoid hidden unit meanings such as world units,
  pixels, samples, or backend coordinates.

## Overflow, Trap, And Wrap Policy

AIR follows existing Core/Wasm scalar semantics:

- integer add/sub/mul wrap according to Wasm integer behavior;
- signed integer division and remainder trap on invalid divisors according to
  the lowered Wasm operation;
- shift counts follow Wasm behavior;
- floating-point ops follow Wasm/IEEE behavior for the selected scalar op;
- no optimizer may reassociate floating-point expressions unless Core semantics
  explicitly allow it.

Stdlib helpers should use contracts to make risky inputs visible. For example,
division helpers should require a non-zero divisor or clamp/select a safe
fallback explicitly.

## Constraints And Effect Budgets

`requires`, `ensures`, and `effects` are review tools as much as verifier tools.
They should make assumptions visible to humans and AI agents.

Expected use:

- module-level contracts document required exports, capabilities, and aggregate
  effect/resource budgets;
- function-level contracts document scalar input ranges and return ranges;
- effect budgets cap host calls, dynamic loops, allocation sites, and resource
  use;
- diagnostics should include repair hints when static information is available.

Static proof is intentionally conservative. When a value cannot be proven from
literals or constants, AIR should keep the program deterministic and surface the
assumption through report/audit output rather than guessing.

Dynamic bounded loops are charged against verifier budgets using conservative
upper bounds. A budget failure should be repaired by tightening the loop bound,
reducing counted work, or raising the explicit budget.

## Optimizer Policy

v0.12 does not make optimization a feature goal by itself. Any optimizer pass
must be semantics-preserving and reviewable.

Allowed future candidates:

- constant folding for pure scalar operations;
- dead local or unused constant diagnostics;
- removal of unused pure computations only when lowering correctness is proven.

Rejected in v0.12:

- reordering effectful calls;
- floating-point reassociation;
- target-specific intrinsics;
- host-profile-specific Core rewrites;
- transformations that change audit/effect accounting.

## Stdlib Admission Checklist

A numeric helper can enter stdlib only when all are true:

- it is pure and deterministic;
- it has empty capabilities and no host imports;
- it is backend-neutral and resource-free;
- it is useful outside one product or demo;
- names are generic and do not encode project vocabulary;
- contracts document important ranges;
- tests verify, format, audit, lower, and run a generic consumer example.

Accepted shapes:

- `bounds.abs_i32(value) -> i32`
- `bounds.in_range_i32(value, center, radius) -> bool`
- `bounds.aabb_overlap_center_i32(...) -> bool`
- `grid.index_3d(x, y, z, width, height) -> i32`
- `easing.in_out_quad_1000(t) -> i32`

Rejected shapes:

- helpers that name a product domain or visual theme;
- helpers that hardcode package material IDs or asset handles as standard
  semantics;
- helpers that call `gfx.*`, `gpu.*`, `ui.*`, audio, filesystem, or network
  imports;
- helpers that expose backend objects or host resources.

## Generic Test Fixtures

Generic examples should use neutral words such as value, bound, cell, center,
radius, region, score, and threshold. They should not depend on assets, host
calls, renderer state, or product-specific vocabulary.

The canonical v0.12 numeric fixture is:

```sh
node bin/airc.js verify examples/numeric_constraints.air
node bin/airc.js audit examples/numeric_constraints.air
node bin/airc.js build examples/numeric_constraints.air --emit wasm -o build/numeric_constraints.wasm
```
