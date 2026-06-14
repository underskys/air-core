# v0.45 Public Showcase Criteria

Status: planning

This document defines the acceptance criteria for v0.45 public showcase work.
It is a release/public-docs gate, not a language feature.

AIR ABI remains `0.10`. Host ABI remains `0.11` latest, limited to bounded
`output.emit`.

## Required Showcase Tracks

| Track | Required public proof | Minimum command/status |
| --- | --- | --- |
| Anti-hallucination / safety demo | AIR rejects an invented API, undeclared authority, unbounded execution, or unsafe memory/resource pattern before execution. | Command exits non-zero with stable diagnostic. |
| Evidence report demo | AIR generates a human-reviewable package evidence report. | Command writes or prints report without private data. |
| AIR MathLab / 3D math scene demo | AIR owns deterministic math/control logic while host owns rendering/assets/platform authority. | Demo exists or is linked with verification/evidence command. |
| Simulation/game/AirWorld slice demo | AIR participates in a host-composed larger system without defining game-specific Core APIs. | Public-safe index entry with AIR/Host boundary table. |

## Required Boundary Table

Every v0.45 showcase entry must include:

| AIR owns | Host owns |
| --- | --- |
| deterministic component logic | rendering and presentation |
| capabilities/effects | IO, UI, assets, hardware, networking |
| bounded execution under AIR's verifier model | platform authority and real-world actions |
| declared output intents | host policy decisions |
| evidence/report surface | deployment and runtime integration |

## Public Commands

Each showcase entry should include the smallest applicable command set:

```sh
airc version --json
airc check <module-or-package>
airc package-check <package> --source-only --json
airc evidence report <package> --format markdown -o evidence.md
```

If a host-composed demo lives outside the npm package, the Core repo may link
to it, but the Core docs must still explain what AIR verifies and what the host
owns.

## Acceptance Checklist

- [ ] `npm install -g @underskys/air-core@alpha` works.
- [ ] README quickstart works.
- [ ] External VM smoke or equivalent clean install smoke passes.
- [ ] One anti-hallucination / safety demo works.
- [ ] One evidence report demo works.
- [ ] One AIR MathLab / 3D math host-composed demo exists or is linked.
- [ ] Simulation/game/AirWorld slice has public-safe criteria or index entry.
- [ ] Consumer pressure ledger updated for any new Core/stdlib/package/Host ABI
      pressure.
- [ ] No overclaim language.
- [ ] No secrets, private data, raw prompt logs, or large media in npm package.
- [ ] No AIR ABI change.
- [ ] No Host ABI change.

## Forbidden Claims

v0.45 showcase language must not claim that AIR is:

- formally verified; <!-- public-claims-allow -->
- a compiler that proves correctness; <!-- public-claims-allow -->
- secure AI code; <!-- public-claims-allow -->
- a universal AI sandbox;
- faster than JS/C++/Rust in general; <!-- public-claims-allow -->
- a full engine;
- a full robotics stack;
- a CAD, Adobe, or Blender replacement;
- a general-purpose application language.

Preferred wording:

- verifier-first language/toolchain;
- verifier-enforced components;
- bounded execution under AIR's verifier model;
- deterministic semantics for supported operations;
- evidence reports for human review;
- host-composed systems;
- hosts own platform authority.

## Deferred Work

- playground;
- MCP sandbox demo unless separately scoped;
- VS Code extension;
- hosted demo infrastructure;
- browser/Vite bundling in Core;
- robotics hardware ABI;
- full scene graph in AIR Core;
- runtime JSON/object model;
- dynamic maps;
- host object handles;
- demo-specific Core APIs.
