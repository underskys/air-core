# AIR v0.40 Release Plan

Status: active planning/RFC/gates milestone

Theme: Declared Fixed-Capacity Pools / Slot Groups RFC & Gates

v0.40 defines the design boundary for intentional fixed-capacity mutable runtime
collections. It does not implement pools, change AIR ABI, change Host ABI, add
runtime JSON/object semantics, add dynamic allocation, add GC, or introduce
game-specific APIs.

AIR ABI latest remains `0.10`.

Host ABI latest remains `0.11`, limited to bounded `output.emit`; Host ABI
`0.10` remains the default/baseline compatibility target for packages that do
not use `output.emit`.

## Purpose

AIR already has fixed state, readonly tablegroups, bounded structured IO, and
package/evidence surfaces. Downstream pressure now shows a distinct pattern:
authors need intentional fixed-capacity mutable slot sets, while reviewPolicy
should continue flagging accidental scalar slot-family slop.

Declared pools are the proposed vocabulary for that distinction:

```text
declared fixed-capacity pool
-> verifier-visible capacity and field bounds
-> report/evidence ownership
-> reviewPolicy suppresses intentional slot-family warnings
```

The milestone is documentation and gates only. Implementation remains deferred.

## Pressure

| Source | Pressure |
| --- | --- |
| AIRON | Needs fixed-capacity runtime pools for projectiles, enemy bullets, enemies, pickups, particles/effects, boss projectiles, and transient UI notifications. |
| reviewPolicy | Current scalar slot families can look like accidental table-like/slop patterns. |
| Fixed state | Repeated mutable state slots need an explicit bounded ownership model rather than ad hoc scalar expansion. |
| Evidence reports | Reviewers need to see whether repeated mutable state is intentional and bounded. |

AIRON is pressure evidence only. The v0.40 plan is generic Core state pressure,
not a platformer API request.

## P0 Scope

| P0 item | Expected output |
| --- | --- |
| Declared pool model | Define fixed-capacity mutable pool semantics and terminology. |
| Relation to fixed state | Explain pool as bounded mutable state with declared capacity, not tablegroup/dynamic array/object model. |
| First-slice constraints | Fixed capacity literal, active flag, scalar fields only, deterministic update, verifier-visible bounds, report-visible ownership, no GC/maps/handles. |
| Source of truth | Pool declaration is source of truth; generated pool handles/bindings are derived artifacts. |
| Verifier obligations | Capacity bounds, field access bounds, active flag rules, no pointer/slice/reference escape, loop budget accounting. |
| Report/evidence/diff/replay visibility | Define how pool metadata appears without raw private payloads. |
| reviewPolicy behavior | Declared pool suppresses accidental slot-family warnings; undeclared slot families remain warnings/errors. |
| Diagnostics | Define stable planned `air.pool.*` diagnostics. |
| ABI impact decision | AIR ABI remains `0.10` for planning; Host ABI unchanged. Future implementation must stop if ABI review is needed. |
| Kill criteria | Stop if design requires dynamic allocation, GC, object identity, runtime JSON, host handles, or platform-specific APIs. |

## P1 Scope

- generated pool handles;
- pool snapshot helper proposal;
- AIRON-style projectile pool sketch;
- LSP diagnostics;
- repair hints;
- pool benchmark plan.

## Deferred

- implementation;
- dynamic capacity;
- heap/GC;
- maps/dicts;
- object identity;
- nested records;
- host object handles;
- tablegroup mutation;
- real game APIs;
- Host ABI expansion;
- compact pool storage.

## Hard Constraints

- fixed capacity only;
- scalar fields only;
- no dynamic allocation;
- no GC;
- no runtime JSON;
- no object identity;
- no host authority;
- no platformer-specific API;
- AIRON remains pressure evidence only;
- generated pool handles/bindings are derived artifacts.

## Acceptance Criteria

v0.40 can close when:

- the RFC defines declared pools and their boundary with fixed state and
  readonly tablegroups;
- verifier/report/evidence/diff/replay obligations are documented;
- reviewPolicy behavior is specified;
- diagnostics and kill criteria are documented;
- API gates document rejected active implementation;
- AIR ABI and Host ABI decisions remain unchanged.

## Links

- [Feature Status v0.40](FEATURE_STATUS_v0.40.md)
- [Declared Fixed-Capacity Pools RFC](rfcs/v0.40-declared-fixed-capacity-pools.md)
- [API Gates v0.40](API_GATES_v0_40.md)
- [Architecture Gates](ARCHITECTURE_GATES.md)
- [Version and ABI Policy](VERSION_AND_ABI_POLICY.md)
