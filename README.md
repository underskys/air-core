# AIR

AIR is a verifier-first programming language and toolchain for AI-authored deterministic components.

AIR is the project name. `@underskys/air-core` is the npm package. `airc` is the CLI.

It is designed for code that AI can write and machines can check: capabilities,
effects, bounded execution, deterministic semantics, host boundaries, and
evidence reports.

AIR programs are written in a compact `.air` source format and compiled with
`airc`. The reference backend targets Wasm today, while AIR's model is
host-owned: the host controls rendering, IO, assets, UI, hardware, networking,
and platform authority.

AIR components can be small policy functions, but hosts can compose them into
larger systems: tools, games, simulations, dashboards, robotics policies, and
2D/3D scenes.

> Note: AIR source files use the `.air` extension. This project is unrelated to
> Adobe AIR.

## What AIR Is

AIR provides:

- a compact `.air` source format;
- a reference parser, formatter, verifier, lowerer, package checker, and CLI;
- machine-checked capabilities and effect budgets;
- bounded execution under AIR's verifier model;
- deterministic semantics for supported operations;
- package reports, conformance/replay checks, diffs, benchmarks, and evidence
  reports for human review;
- anti-hallucination checks that reject invented APIs before execution.

AIR is for bounded deterministic components such as policy, scoring, routing,
validation, recommendation, control, and decision code. It is not intended to
replace Wasm, Rust, TypeScript, OPA, Starlark, eBPF, databases, browsers,
renderers, or host application code.

## Why AIR Exists

AI-assisted code can be useful, but it can also invent APIs, drift across host
boundaries, hide side effects, or create review work that does not scale.

AIR reduces that surface by making generated components constrained and
checkable:

- the module declares what it can import and emit;
- the verifier checks the module against AIR's bounded execution and capability
  model;
- package-check validates schemas, generated artifacts, profiles, and evidence
  surfaces;
- hosts decide whether emitted intents are allowed;
- humans review reports and diffs instead of trusting raw generated code.

See [WHY_AIR.md](WHY_AIR.md) for a careful comparison with adjacent systems.

For benchmark and comparison evidence, see [SHOWCASE.md](SHOWCASE.md).
AIR is not designed to be a faster general-purpose language. In the measured
integer policy workload it runs in the Java/JS performance class, while adding
verifier-enforced capabilities, effect budgets, bounded execution,
deterministic semantics, and evidence reports.

## Quickstart

```sh
npm ci
npm test

node bin/airc.js version --json
node bin/airc.js fmt examples/public/safe_policy/module.air
node bin/airc.js verify examples/public/safe_policy/module.air
node bin/airc.js explain examples/public/safe_policy/module.air
node bin/airc.js audit examples/public/safe_policy/module.air
node bin/airc.js build examples/public/bounded_execution/module.air --emit wasm -o build/public_bounded_execution.wasm
node bin/airc.js report package examples/public/evidence_report --json
```

Review workflow:

```sh
npm run agent:finish
```

`agent:finish` runs Core checks, builds a review bundle, and writes local
review artifacts. Those artifacts are for review workflow, not source of truth.

Install the public alpha package with:

```sh
npm install -g @underskys/air-core@alpha
airc version --json
```

## What AIR Rejects

AIR's current public surface rejects or keeps out of scope:

- undeclared host imports and invented APIs;
- raw filesystem, network, cloud, browser, DOM, database, renderer, GPU, and OS
  authority inside AIR modules;
- secrets, tokens, credentials, raw URLs, private text, and host object handles
  as AIR-owned data;
- runtime JSON/object models, dynamic maps, GC, reflection, and promises;
- dynamic output identifiers and object/string output payloads;
- unbounded recursion;
- static loop counts above the verifier cap of `4096`;
- memory region leaks, double free, and use-after-free under the current region
  lifetime model.

These checks do not make a malicious host safe. They enforce the AIR module
boundary under AIR's model. See [SECURITY.md](SECURITY.md) and
[THREAT_MODEL.md](THREAT_MODEL.md).

## Evidence Reports

For a small package:

```sh
node bin/airc.js report package examples/airops_incident_package --json
```

Evidence reports are intended for human review. They summarize verification,
package policy, capabilities/effects, output contracts, structured IO, replay,
diff, benchmark, and diagnostics where available. They are not a claim that the
business policy is correct.

## Core vs Consumer Pressure

AIR Core conformance is defined by the reference verifier, specs, CLI, package
checks, and conformance fixtures. Demos and consumer evidence are pressure
inputs only. They do not define AIR Core semantics, AIR ABI, Host ABI, package
semantics, or new host authority.

The public npm package is intentionally limited to Core/spec/CLI/conformance
surface and launch-safe examples under `examples/public/`. Downstream consumer
proofs and demo pressure remain in repository evidence/intake paths and are not
shipped as public Core package authority.

## Version / ABI Matrix

| Product/package | Milestone | AIR ABI | Host ABI | Spec | Conformance | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `0.44.2` | `v0.44 active` | `0.10` | `0.11` latest, `0.10` baseline | `0.10` family | repo test/conformance suite | Public-alpha packaging and release-smoke checkpoint. Host ABI `0.11` is limited to bounded `output.emit`. |

Current active milestone:

- Project milestone: `v0.44 active`
- Package/product version: `0.44.2`
- Active roadmap: [docs/V0_44_RELEASE_PLAN.md](docs/V0_44_RELEASE_PLAN.md)
- Feature status: [docs/FEATURE_STATUS_v0.44.md](docs/FEATURE_STATUS_v0.44.md)

Version axes are separate:

- product/package version: npm/package release identity;
- milestone version: internal/public roadmap slice;
- AIR ABI version: executable module/runtime contract;
- Host ABI version: host import/signature/semantic contract;
- spec version: documented language/package/spec surface;
- conformance suite version: tests and fixtures used for compatibility checks.

See [docs/VERSION_AND_ABI_POLICY.md](docs/VERSION_AND_ABI_POLICY.md).
See [VERSIONING.md](VERSIONING.md) for the public release version axes.

## Development Method

AIR is developed with AI assistance under human direction. Dmitriii created and
directs the project: product direction, architecture constraints, acceptance
criteria, review orchestration, evidence gates, release decisions, and the
AI-orchestrated engineering process.

AI tools may assist implementation, tests, docs, and review hygiene. They do
not replace authorship, ownership, acceptance, or release responsibility.

See [METHOD.md](METHOD.md).

## Docs Links

- [Why AIR](https://gitlab.com/fd.skyrealm/air-core/-/blob/main/WHY_AIR.md)
- [Method](https://gitlab.com/fd.skyrealm/air-core/-/blob/main/METHOD.md)
- [Security](https://gitlab.com/fd.skyrealm/air-core/-/blob/main/SECURITY.md)
- [Threat Model](https://gitlab.com/fd.skyrealm/air-core/-/blob/main/THREAT_MODEL.md)
- [Conformance](https://gitlab.com/fd.skyrealm/air-core/-/blob/main/CONFORMANCE.md)
- [Showcase and benchmark evidence](https://gitlab.com/fd.skyrealm/air-core/-/blob/main/SHOWCASE.md)
- [Versioning](https://gitlab.com/fd.skyrealm/air-core/-/blob/main/VERSIONING.md)
- [Roadmap](https://gitlab.com/fd.skyrealm/air-core/-/blob/main/ROADMAP.md)
- [Contributing](https://gitlab.com/fd.skyrealm/air-core/-/blob/main/CONTRIBUTING.md)
- [Docs index](https://gitlab.com/fd.skyrealm/air-core/-/blob/main/docs/README.md)
- [AIR Strategy](https://gitlab.com/fd.skyrealm/air-core/-/blob/main/docs/AIR_STRATEGY.md)
- [Architecture Gates](https://gitlab.com/fd.skyrealm/air-core/-/blob/main/docs/ARCHITECTURE_GATES.md)
- [Version and ABI Policy](https://gitlab.com/fd.skyrealm/air-core/-/blob/main/docs/VERSION_AND_ABI_POLICY.md)
- [AIR Layer Manifest](https://gitlab.com/fd.skyrealm/air-core/-/blob/main/spec/AIR_LAYER_MANIFEST.md)
- [Public Release Audit](https://gitlab.com/fd.skyrealm/air-core/-/blob/main/docs/public_release/PUBLIC_CUT_AUDIT.md)
- [Changelog](https://gitlab.com/fd.skyrealm/air-core/-/blob/main/CHANGELOG.md)
