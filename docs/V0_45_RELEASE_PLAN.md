# AIR v0.45 Release Plan

Status: planning

Theme: Public Showcase & Host Composition

v0.45 is the first showcase-oriented milestone after public npm release. It is
intended to demonstrate AIR as a verifier-first language/toolchain for bounded
deterministic components that hosts can compose into larger systems.

AIR ABI latest remains `0.10`. Host ABI latest remains `0.11`, limited to
bounded `output.emit`; Host ABI `0.10` remains supported.

## Purpose

`@underskys/air-core@0.44.1` is the first published public alpha. v0.45 makes
the public story concrete through internal slices (`M45-S1`, `M45-S2`, ...) that
prepare public package release candidate `0.45.0`:

- AIR rejects invented APIs and undeclared authority before execution.
- AIR components remain bounded, deterministic, capability/effect checked, and
  evidence-reportable.
- Hosts compose those components into larger tools, games, simulations,
  dashboards, robotics policies, and 2D/3D scenes while retaining platform
  authority.

This milestone is not a language expansion milestone. It can include docs,
public examples, showcase indexing, package/evidence polish, and bugfixes.

## Showcase Tracks

| Track | Goal | Expected proof |
| --- | --- | --- |
| Anti-hallucination / safety demo | Show AIR rejecting invented APIs, hidden authority, unbounded execution, unsafe memory/resource patterns, or invalid host calls. | Public command that fails deterministically with a stable diagnostic and repair-oriented context. |
| AIR MathLab / 3D math scene demo | Show AIR as deterministic math/control logic that a host can compose into a visual or 3D scene. | Public docs or linked demo showing AIR-owned math/policy and host-owned rendering/assets. |
| Simulation/game/AirWorld slice demo | Show AIR components participating in a larger host-composed interactive slice without making Core game-specific. | Public demo index entry, verification command, evidence/report command, and boundary table. |

## Host Boundary

AIR owns:

- deterministic component logic;
- capability and effect declarations;
- bounded execution under AIR's verifier model;
- package checks, diagnostics, conformance/replay hooks, and evidence reports;
- emitted intents within declared output surfaces.

The host owns:

- rendering and scene presentation;
- IO, assets, UI, windows, devices, hardware, networking, and platform
  authority;
- real policy decisions for host effects;
- demo/application composition, art direction, timing, and deployment.

Consumer demos and host showcases are pressure evidence. They do not define AIR
Core semantics, AIR ABI, Host ABI, or public package authority.

## P0 Scope

| P0 item | Expected v0.45 outcome |
| --- | --- |
| Showcase criteria | Define what a public showcase must prove, how it is verified, and what claims are forbidden. |
| Anti-hallucination / safety demo | At least one public command demonstrates deterministic rejection of an invented API or unsafe surface. |
| Evidence report demo | At least one public package demonstrates an evidence report workflow. |
| AIR MathLab / 3D math host-composed demo | Exists in public docs or is linked from a public-safe showcase index, with AIR/Host ownership called out. |
| Simulation/game/AirWorld slice criteria | Define the minimum public-clean slice requirements and host boundary. |
| Public examples improvements | Improve `examples/public/` only where needed for copy-paste public commands. |
| Demo portfolio index | Provide or update a public-safe index that separates Core semantics from downstream demos. |
| Consumer pressure ledger update | Any showcase pressure that implies Core/stdlib/Host ABI work must enter the request ledger or be explicitly marked no-active-pressure. |
| Package/evidence polish | Bugfix or docs polish only; no new AIR or Host ABI behavior. |
| Overclaim audit | Public showcase language avoids claims that AIR is a full engine, robotics stack, CAD/Adobe/Blender replacement, or general-purpose application language. |

## P1

- Public screenshots/GIF links if hosted outside the Core npm package;
- reusable demo README template improvements;
- public conformance command summary for showcase examples;
- better evidence report excerpts for README or release notes;
- stdlib/kit pressure notes for future milestones.

## Deferred / Not Allowed

- runtime JSON/object model;
- dynamic maps or dictionaries;
- host object handles;
- robotics hardware ABI;
- full scene graph in AIR Core;
- CAD, Adobe, Blender, engine, or general-purpose application-language
  replacement claims;
- browser/Vite host bundling in Core;
- package registry or native installer;
- demo-specific Core APIs;
- Host ABI expansion unless separately approved;
- AIR ABI expansion unless separately approved;
- npm publish from Codex;
- release tag creation in this planning task.

## Acceptance Criteria

v0.45 is complete when:

- npm install path for `@underskys/air-core@alpha` works;
- README quickstart works from repository checkout and, where applicable, from
  the npm package;
- external VM smoke or equivalent clean-environment install smoke passes and is
  documented;
- one anti-hallucination / safety demo works;
- one evidence report demo works;
- one 3D math host-composed demo exists or is linked with clear AIR/Host
  ownership;
- consumer pressure ledger is updated for any new pressure;
- no overclaim language is present;
- no language features are added unless separately approved;
- AIR ABI remains `0.10`;
- Host ABI remains unchanged.

## Versioning

- Internal slices: `M45-S1`, `M45-S2`, ...
- Active public package release candidate: `@underskys/air-core@0.45.0`.
- npm dist-tag: `alpha`.
- Do not publish `0.44.2` unless an urgent package-breaking fix is required
  for the already-published `0.44.1` package.
- No 1.0 compatibility promise yet.
- AIR ABI remains `0.10`.
- Host ABI latest remains `0.11`, limited to bounded `output.emit`.
- No new math implementation is included in `0.45.0`.

## Links

- [Feature Status v0.45](FEATURE_STATUS_v0.45.md)
- [Public Showcase & Host Composition RFC](rfcs/v0.45-public-showcase-host-composition.md)
- [v0.45 Showcase Criteria](public_release/V0_45_SHOWCASE_CRITERIA.md)
- [Project Identity](project-identity.md)
- [Public Claims Policy](PUBLIC_CLAIMS.md)
- [Version and ABI Policy](VERSION_AND_ABI_POLICY.md)
