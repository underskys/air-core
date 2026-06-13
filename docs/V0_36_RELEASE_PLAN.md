# AIR v0.36 Release Plan

Status: RC hardening milestone

Theme: Consumer Evidence Corpus & Demo Pressure Intake

v0.36 implements the first standardized intake layer for downstream demo and
consumer pressure without importing demo projects into AIR Core and without
letting demo needs define Core ABI directly.

AIR Core review bundles prove the compiler, verifier, reports, evidence,
package-check, replay, benchmark, and API gates. Consumer evidence bundles prove
that AIR survives pressure from real downstream domains while keeping that
pressure routed through explicit Core, stdlib, kit, host-adapter, demo-local, or
rejected decisions.

AIR ABI latest remains `0.10`.

Host ABI latest remains `0.11`, limited to bounded `output.emit`; Host ABI
`0.10` remains the default/baseline compatibility target for packages that do
not use `output.emit`.

v0.36 must not add language features, AIR ABI changes, Host ABI changes, raw
host authority, demo-specific APIs, external demo source code, or large demo
assets.

## Purpose

The milestone defines and implements a first tooling/skeleton slice of a
consumer evidence corpus that can receive small, reviewable proof cards from
downstream domains:

```text
downstream demo / consumer project
-> sanitized evidence summary
-> proof card + manifest + replay/evidence summary
-> pressure routing decision
-> Core RFC/gates only if accepted
```

The corpus is not a package registry, demo bundle archive, media archive, or
roadmap automation system. It is a review intake surface.

## P0 Scope

| P0 item | Expected output |
| --- | --- |
| `consumer_evidence/` directory structure | Implemented directory layout for registry, proof cards, manifests, summaries, and bundle output. |
| `DEMO_REGISTRY.json` schema | Implemented registry for downstream evidence sources. |
| Proof card schema | Implemented JSON schema plus Markdown template for consumer pressure proof cards. |
| Demo manifest schema | Implemented schema for capabilities, denied authorities, evidence artifacts, and routing hints. |
| Replay/evidence summary schema | Implemented schemas for replay and evidence summaries. |
| `check:consumer-evidence` validator | Implemented deterministic validator and npm script. |
| Separate consumer evidence bundle | Implemented `consumer-evidence:bundle`, separate from Core review bundles. |
| Demo-side contribution rules | Documented and represented in corpus README/template. |
| Pressure routing rules | Implemented in manifests/proof cards. Routes: Core, stdlib, kit, host adapter, demo-local, rejected. |
| Seed evidence plan | Implemented safe seed entries for lan-observer read-only proof, AIRON pressure summary, and AirOps incident package. |

## P1 Scope

- media hash support;
- screenshot/video link metadata;
- demo-generated evidence import;
- trend report across consumer evidence;
- GitLab artifact plan;
- external demo evidence ingestion.

## Deferred

- full demo bundles in Core;
- large assets;
- browser smoke artifacts;
- `node_modules`;
- production host adapters;
- demo-specific Core APIs;
- automatic roadmap changes from demo pressure.

## Hard Rules

- Demos are pressure, not authority.
- No demo can directly define Core ABI.
- Every accepted pressure must route through RFC/gates before implementation.
- Consumer evidence must include allowed capabilities and denied authorities.
- Consumer evidence must not include secrets, raw private data, raw URLs,
  tokens, local absolute paths, or large logs.
- External demo source code is not imported into Core.
- Demo-specific APIs stay demo-local unless a generalized Core/stdlib/kit/host
  RFC accepts them.
- Consumer evidence bundles are separate from Core review bundles.

## Proposed Directory Shape

```text
consumer_evidence/
  DEMO_REGISTRY.json
  README.md
  proofs/
    <consumer-id>/
      proof-card.json
      demo-manifest.json
      replay-summary.json
      evidence-summary.json
      pressure-routing.json
```

This milestone implements the shape first. The validator rejects missing required
evidence descriptors and unsafe committed content while keeping full demos and
large assets out of Core.

## Seed Candidates

| Candidate | Source | v0.36 route |
| --- | --- | --- |
| lan-observer read-only proof | `examples/lan_observer_readonly_package/` | Safe Core proof evidence. Seed card can summarize existing checked-in proof without duplicating package files. |
| AIRON pressure summary | ABI request / pressure docs | Pressure-only evidence. No demo source import, game API, or asset import. |
| AirOps canonical example | `examples/airops_incident_package/` if present | Optional existing Core example summary. |
| FlowDesk-style evidence | Existing docs/fixtures only if already in repo | Optional summary only; no product import. |

## Pressure Routing

Every proof card must classify each requested change:

| Route | Meaning |
| --- | --- |
| Core | Candidate generalized language/package/verifier/report mechanism. Requires RFC/gates. |
| stdlib | Generic helper/library surface, not host authority. |
| kit | Domain/project kit convention outside Core language semantics. |
| host adapter | Host-owned integration or policy executor behavior. |
| demo-local | Remains local to the downstream demo/consumer project. |
| rejected | Not accepted for AIR due to authority, privacy, ABI, or slop risk. |

## Acceptance Criteria

v0.36 can close when:

- the consumer evidence corpus shape is documented and implemented;
- registry, proof card, demo manifest, and replay/evidence summary schemas are
  defined;
- `check:consumer-evidence` passes;
- `consumer-evidence:bundle` builds a separate bundle;
- consumer evidence bundle boundaries are documented;
- demo-side contribution rules are documented;
- pressure routing rules are explicit;
- safe seed entries exist without importing external demos;
- no language features, AIR ABI changes, Host ABI changes, raw host authority,
  game-specific APIs, or demo source changes are added.

## Links

- [Feature Status v0.36](FEATURE_STATUS_v0.36.md)
- [Consumer Evidence Corpus RFC](rfcs/v0.36-consumer-evidence-corpus.md)
- [Examples, Demos, and Snapshots](EXAMPLES_AND_DEMOS.md)
- [Architecture Gates](ARCHITECTURE_GATES.md)
- [Version and ABI Policy](VERSION_AND_ABI_POLICY.md)
