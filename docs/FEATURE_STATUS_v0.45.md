# AIR v0.45 Feature Status

Status: planning

Version target: public alpha release candidate `@underskys/air-core@0.45.0`

v0.45 covers Public Showcase & Host Composition. It is a showcase, docs,
examples, evidence-polish, and bugfix milestone. It is not an AIR ABI, Host ABI,
or language-expansion milestone.

AIR ABI latest remains `0.10`. Host ABI latest remains `0.11`, limited to
bounded `output.emit`; Host ABI `0.10` remains supported.

Related documents:

- [AIR v0.45 Release Plan](V0_45_RELEASE_PLAN.md)
- [Public Showcase & Host Composition RFC](rfcs/v0.45-public-showcase-host-composition.md)
- [v0.45 Showcase Criteria](public_release/V0_45_SHOWCASE_CRITERIA.md)
- [Public Claims Policy](PUBLIC_CLAIMS.md)
- [Project Identity](project-identity.md)

## Status Values

- `stable/active`: inherited behavior from earlier milestones.
- `planned/P0`: required v0.45 item.
- `planned/P1`: useful lower-priority showcase polish.
- `deferred`: explicitly outside v0.45.
- `rejected`: not allowed in v0.45.

## Stable / Active Baseline

| Feature | Layer | v0.45 status |
| --- | --- | --- |
| AIR ABI `0.10` | ABI | Stable/active; no v0.45 expansion planned. |
| Host ABI `0.10` | ABI | Stable/active and still supported. |
| Host ABI `0.11` bounded `output.emit` | Host ABI/package/runtime | Stable bounded first slice only. |
| npm package `@underskys/air-core` | package/release | Stable public alpha package identity. |
| CLI `airc` | CLI | Stable public CLI name. |
| Public package surface checker | package/release checks | Stable. |
| Public claims checker | docs/release checks | Stable. |
| Request ledger validation | release governance | Stable. |

## v0.45 P0

| Feature | Layer | v0.45 status |
| --- | --- | --- |
| Showcase criteria | public release docs | Planned/P0. |
| Anti-hallucination / safety demo | examples/public or linked showcase | Planned/P0. |
| Evidence report demo | examples/public or linked showcase | Planned/P0. |
| AIR MathLab / 3D math host-composed demo | public showcase index/docs | Planned/P0. |
| Simulation/game/AirWorld slice criteria | public showcase docs | Planned/P0. |
| README quickstart verification | release hygiene | Planned/P0. |
| External VM smoke | release hygiene | Planned/P0. |
| Consumer pressure ledger update | request governance | Planned/P0 for any new pressure. |
| Package/evidence polish | docs/bugfix | Planned/P0 where needed. |
| Overclaim audit | docs/release checks | Planned/P0. |

## P1

| Feature | v0.45 status |
| --- | --- |
| Public screenshots/GIF links outside npm package | Planned/P1. |
| Demo README template polish | Planned/P1. |
| Showcase conformance command summary | Planned/P1. |
| Evidence report excerpts for public docs | Planned/P1. |
| Stdlib/kit pressure notes | Planned/P1. |

## Deferred / Rejected

| Feature | v0.45 status |
| --- | --- |
| Runtime JSON/object model | Rejected. |
| Dynamic maps/dictionaries | Rejected. |
| Host object handles | Rejected. |
| Robotics hardware ABI | Rejected. |
| Full scene graph in AIR Core | Rejected. |
| CAD/Adobe/Blender replacement claims | Rejected. |
| General-purpose application-language claims | Rejected. |
| Demo-specific Core APIs | Rejected. |
| AIR ABI change | Rejected unless separately approved. |
| Host ABI change | Rejected unless separately approved. |
| npm publish by Codex | Rejected. |
| Tag creation in planning docs task | Rejected. |

## Version Semantics

- Project milestone: `v0.45`.
- Internal slices: `M45-S1`, `M45-S2`, ...
- Active public package release candidate: `@underskys/air-core@0.45.0`.
- npm dist-tag: `alpha`.
- Do not publish `0.44.2` unless an urgent package-breaking fix is required
  for the already-published `0.44.1` package.
- No new math implementation, AIR ABI change, or Host ABI change is included
  in `0.45.0`.
- No 1.0 compatibility promise.
- AIR ABI latest: remains `0.10`.
- Host ABI latest: remains `0.11`.
- Host ABI default/baseline: remains `0.10`.
- Host ABI expansion in v0.45: none planned.
- AIR ABI change in v0.45: none planned.
