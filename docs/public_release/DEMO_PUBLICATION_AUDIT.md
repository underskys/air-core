# Demo Publication Audit

Status: public launch readiness audit. This document does not import external
demos into AIR Core and does not make demo code part of Core authority.

Source basis:

- `docs/public_release/PUBLIC_CUT_AUDIT.md`
- `docs/public_release/PUBLIC_FILE_MATRIX.md`
- `docs/public_release/CLEANUP_CANDIDATES.md`
- `consumer_evidence/DEMO_REGISTRY.json`
- current local demo/snapshot inventory

## Publication Rule

Demos are pressure and showcase material. Core remains the verifier, package
checker, specs, conformance tests, evidence fixtures, and small canonical
examples. A demo can show usefulness, but it cannot define AIR ABI, Host ABI,
language semantics, package semantics, or Core APIs by itself.

Public demo material should be a small, reviewable layer around AIR evidence:

- one English intro;
- one screenshot or GIF;
- one verify command;
- one report/evidence command where available;
- a clear AIR owns / Host owns boundary;
- denied authorities;
- known limitations.

Full demo repositories, build outputs, large media, generated archives, and raw
review bundles should stay outside AIR Core.

## Tier 1 Launch Showcase

Tier 1 demos are candidate public launch showcases after each has a small public
README, hosted visual, and reproducible AIR command.

| Demo | Intended launch role | Current source form | Publication status | Required blockers |
| --- | --- | --- | --- | --- |
| `photoloop` | Small visual/interactive showcase. | Local/generated archive inventory only: `demo_snapshots/air-photoloop-demo.zip`. | Not ready from Core alone. | Needs hosted page or GIF, English intro, AIR/Host boundary table, one verify command, one evidence/report command if available. |
| `airworld` | Small world/simulation showcase. | Local/generated archive inventory only: `demo_snapshots/airworld.zip`. | Not ready from Core alone. | README currently says airlang is a Rust implementation; fix required before public use. Needs hosted page or GIF, English intro, one verify command, one evidence/report command if available. |
| `airtris` | Small game/policy-loop showcase. | Local/generated archive inventory only: `demo_snapshots/airtris-demo.zip`. | Not ready from Core alone. | Needs hosted page or GIF, English intro, AIR/Host boundary table, one verify command, one evidence/report command if available. |
| `minesweeper` | Small deterministic decision/game showcase. | Local/generated archive inventory only: `demo_snapshots/air-minesweeper-demo.zip`. | Not ready from Core alone. | Needs hosted page or GIF, English intro, AIR/Host boundary table, one verify command, one evidence/report command if available. |

Tier 1 minimum launch checklist:

- public README uses `docs/public_release/DEMO_README_TEMPLATE.md`;
- no private paths, private emails, raw logs, prompt transcripts, or generated
  bundles in public source;
- no claim that the demo defines AIR Core behavior;
- no broad speed claim over host languages or claim that AIR makes demo
  code automatically safe;
- at least one command verifies the AIR package or module;
- screenshot/GIF or hosted page exists outside Core.

## Tier 2 Real Apps

Tier 2 entries are real-app pressure evidence. They are valuable, but they need
stronger privacy/product review than Tier 1. Public launch should use summaries
or proof cards, not full app imports.

| Demo / app | Intended role | Current Core evidence | Publication status | Required blockers |
| --- | --- | --- | --- | --- |
| `Flowdesk-Air` | Browser/product pressure for bounded facts, host-owned browser authority, and policy/recommendation modules. | `docs/abi-requests/flowdesk-air.md`, FlowDesk-style fixtures and benchmarks. | Summary/proof-card only unless external repo is separately sanitized. | Do not import full product code. Verify no raw notes, raw URLs, private browser data, or Chrome authority enters AIR. Needs public README, one verify command, and explicit host-owned browser boundary. |
| `lan-observer-air` | Read-only network-observation proof pressure. | `examples/lan_observer_readonly_package/` and `consumer_evidence/demos/lan_observer_readonly/`. | Core proof card is launch-safe; external adapter remains public-later. | No real network access, raw packet dumps, raw hostnames/MAC/IP values, secrets, or host writes. External repo needs separate README/GIF/verify command. |
| `Airops` | Policy/ops decision proof pressure. | `examples/airops_incident_package/` and `consumer_evidence/demos/airops_incident_package/` if present. | Core proof card is launch-safe if current sanitized fixture remains small. | Keep private/product details out. Needs public app README if externalized. |
| `ZeitFall` | Real-app/product pressure evidence. | Local/generated archive inventory only: `demo_snapshots/zeitfall.zip`. | Not ready from Core alone. | Needs sanitation review, public README, hosted page/GIF, verify command, AIR/Host boundary, and proof card before launch. |

Tier 2 minimum launch checklist:

- prefer `consumer_evidence/` proof card or summary over full app import;
- private product data stays outside Core;
- raw URLs/private text/secrets/tokens are rejected or removed;
- host policy and platform authority are explicit;
- AIR module commands are reproducible from public material.

## Tier 3 Internal Cleanup

Tier 3 entries are internal or public-later cleanup targets. They should not be
used as launch showcases until blockers are resolved.

| Path / demo | Reason | Required blocker |
| --- | --- | --- |
| `demo/airon` | Large host-specific demo with assets, generated AIR, nested repo/build surfaces, and demo-local validators. | Keep excluded from Core/public package. Public only after separate demo repo cleanup, README, hosted page/GIF, verify command, and no generated/private artifacts. |
| `demo/airdoom` | Host-specific demo with package files and local build/log surfaces. | `demo/airdoom` is missing manifest entry `game/benchmark.air`; fix required before demo package-check claims. Keep excluded until sanitized. |
| `demo/voxel-demo` | Host-specific demo with build/public Wasm and demo-specific pressure. | Keep excluded from Core/public package until separate host/demo sanitation and README review. |
| `demo/airon/game_src/*.air` | Authored legacy AIR sources can diverge from generated executable package path. | `demo/airon` legacy `game_src/*.air` may fail if verified directly; do not present them as public-ready verification commands. |
| `FlowDesk-Claude/switcher_score.air` | External/private or product-specific artifact name. | Do not include without owner sanitation and public license/provenance decision. |
| `Flowdesk-Air.before-*` backups | Backup snapshots are stale/generated/private-risk artifacts. | Exclude from public repo/package and do not use as evidence. |

## Exact Blockers To Resolve

- `airworld` README says airlang is a Rust implementation; fix required before
  public use.
- `demo/airdoom` is missing manifest entry `game/benchmark.air`.
- `demo/airon` legacy `game_src/*.air` may fail if verified directly.
- `Flowdesk-Air.before-*` backups should be excluded.
- Each Tier 1 demo needs a GIF or hosted page.
- Each Tier 1 demo needs an English intro.
- Each Tier 1 demo needs one verify command.
- Each demo needs an AIR owns / Host owns boundary.
- Each demo needs denied-authorities language.
- Full demo archives under `demo_snapshots/` remain excluded from Core.

## Recommended Verify Command Shape

Use the smallest command that checks the demo's AIR-owned surface:

```sh
node bin/airc.js verify path/to/module.air
```

For package-shaped demos:

```sh
node bin/airc.js package-check path/to/package --json
```

For Core proof packages:

```sh
node bin/airc.js report package examples/lan_observer_readonly_package --json
```

Do not use host build commands, browser smoke tests, Vite builds, native
renderers, or external services as the only AIR verification command.

## Launch Recommendation

- Use Tier 1 only after README/GIF/verify-command fixes are complete outside
  Core.
- Use Tier 2 through proof cards and sanitized evidence summaries.
- Keep Tier 3 excluded from public launch material until separate demo cleanup.

## ABI Status

- AIR ABI unchanged: `0.10`.
- Host ABI unchanged: latest `0.11`, limited to bounded `output.emit`.
