# AIR Examples, Demos, and Snapshots

Status: active classification policy

This document defines how AIR Core treats canonical examples, experimental
demos, generated snapshots, and external consumer proofs.

Short rule:

**Demos are pressure. Core is law.**

Demo pressure can justify review, RFCs, package-check hardening, or future
milestone planning. Demo pressure does not define AIR syntax, AIR ABI, Host ABI,
host authority, verifier semantics, package semantics, or canonical APIs by
itself.

## Canonical Examples

Canonical examples are small packages used as Core proof.

They should demonstrate the current recommended AIR path with minimal product
surface:

- bounded facts, rowsets, or structured IO metadata;
- deterministic AIR-owned scalar decisions;
- output contracts, command buffers, or bounded `output.emit` where applicable;
- generated handles when the current canonical path requires them;
- package-check, verify, report, evidence, diff, and conformance/replay
  visibility where supported.

Canonical examples must:

- pass `airc verify package` when package verification applies;
- pass `airc package-check` for the intended profile;
- produce package reports/evidence without raw private payloads;
- use current canonical APIs/handles instead of stale or legacy shortcuts;
- stay small enough to be reviewable as Core evidence;
- avoid real host authority, secrets, credentials, network/cloud access, and
  production side effects.

Canonical examples may be release-gated. A regression in a canonical example
can block Core RC readiness when that example is part of the milestone evidence.

Current example to start with:

- [AirOps-style incident package](../examples/airops_incident_package/README.md)

## Experimental Demos

Experimental demos are pressure evidence.

They may be larger, product-shaped, host-specific, visually rich, or intentionally
rougher than canonical examples. They may carry local debt while exploring
whether AIR needs better authoring ergonomics, package metadata, generated
bindings, host adapters, or future Core mechanisms.

Experimental demos may:

- use host-specific project scaffolding;
- contain larger assets or presentation code;
- expose missing ergonomics before Core accepts a solution;
- use local helper scripts, screenshots, or smoke tests;
- be reviewed as pressure for RFCs, architecture gates, or future milestones.

Experimental demos must not:

- define AIR Core ABI by themselves;
- create Host ABI imports by convention;
- bypass architecture gates;
- smuggle demo-specific APIs into Core or stdlib;
- claim canonical status unless promoted by docs and checks;
- force Core to accept raw host authority, runtime JSON, dynamic objects, host
  object handles, tablegroups, pools, event streams, or platform APIs.

Local demo debt is not automatically Core debt. Core may decide that the correct
answer is a package-check warning, a kit, a host adapter, a generated artifact,
or no Core change.

## Demo Snapshots And Generated Review Artifacts

Demo snapshots and generated review artifacts are not source of truth.

Examples include:

- review bundle archives;
- `REVIEW_RESULTS/`;
- `MOBILE_SUMMARY.md`;
- `REVIEW_REQUEST.md`;
- screenshots, smoke-test output, generated public builds, and temporary
  snapshots;
- generated demo assets or local repair outputs.

These artifacts may be useful for review, QA, or handoff, but they are not AIR
source, active API, ABI evidence, or canonical package truth unless a milestone
explicitly says so.

Core review bundles may exclude large demo assets, build output, snapshots, and
runtime artifacts. Bundle omissions do not delete source files and do not
change Core semantics. For Core review, the release authority remains the source
checkout plus generated `REVIEW_RESULTS` for the current commit.

## Consumer Evidence Corpus

The [Consumer Evidence Corpus](../consumer_evidence/README.md) is the intake
layer for downstream demo and consumer pressure.

Core review bundles prove the compiler, verifier, package-check, reports,
evidence, replay, and review workflow for AIR Core. Consumer evidence bundles
prove that AIR survives pressure from downstream domains without letting those
domains define Core semantics, AIR ABI, Host ABI, or host authority.

Consumer evidence entries should include:

- a demo manifest with AIR-owned and host-owned responsibilities;
- a proof card with allowed capabilities and denied authorities;
- replay, report, prompt, and metrics summaries when safe;
- pressure routing to Core, stdlib, kit, host adapter, demo-local, or rejected.

Heavy assets, raw logs, generated builds, screenshots, videos, and full demo
bundles are not committed by default. Large evidence snapshots may be release
artifacts instead of git-tracked Core files.

Consumer evidence must not include secrets, tokens, raw private data, raw URLs,
local absolute paths, external demo source trees, or demo-specific Core APIs.

## External Consumer Proofs

External consumer proofs are product- or host-shaped validation efforts outside
the Core language surface.

Examples include:

- lan-observer-air-style read-only observation facts;
- FlowDesk-style task, status, link, and policy summaries;
- AIRON-style authored game/package pressure;
- Airtris, Minesweeper, and PhotoLoop-style bounded state/readback pressure.

These proofs should preserve the AIR boundary:

- the host owns rich state, platform objects, raw text, URLs, secrets, network,
  browser, renderer, filesystem, GPU, Canvas, and execution policy;
- AIR sees bounded scalar facts, ids, handles, enums, flags, counters, scores,
  rowsets, structured IO metadata, fixed state, and output intents;
- generated host bindings are derived artifacts, not semantic source of truth;
- schemas, output contracts, package manifests, and state declarations remain
  source of truth.

External consumer proof pressure can route to:

- canonical examples when small and Core-shaped;
- RFCs when a generic Core mechanism may be justified;
- kits when reusable host/project scaffolding is useful but not language
  semantics;
- host adapters when the platform integration belongs outside AIR;
- package-check/report/evidence hardening when Core only needs better visibility.

It must not route directly to:

- runtime JSON/object models;
- dynamic maps or ORM behavior;
- host object handles;
- raw host APIs;
- game/product-specific Core APIs;
- Host ABI expansion without promotion evidence;
- AIR ABI changes without executable/runtime contract evidence.

## Promotion Rule

An artifact becomes canonical Core evidence only when the active release plan,
feature status, docs, and checks say so.

Until then:

- examples are educational or canonical only as documented;
- demos are pressure;
- snapshots are review artifacts;
- external proofs are evidence inputs;
- Core semantics remain defined by AIR specs, accepted RFCs, API gates,
  verifier/lowering behavior, package-check, and ABI policy.
