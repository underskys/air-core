# AIR v0.14 Architecture Request:
# Executable Package Composition, AIR-authored Data, and Anti-Slop Migration

Status: architecture request / planning

This document records v0.14 architecture pressure. It does not implement
features and does not approve new Core syntax, stdlib modules, or public Host
ABI.

## Purpose

v0.14 should move AIR from v0.13 source-level module graph validation toward
package-level verify/report/check over authored package graphs and
AIR-authored deterministic data.

Consumer projects, downstream packages, pressure demos, and examples are
pressure tests only. The goal is generic AI-generated system integrity:
modularity, verifiability, capability boundaries, host-profile contracts,
deterministic reports, and anti-slop structure.

Consumer needs must be generalized before becoming Core, stdlib, Host ABI, or
kit features.

## Current Pressure Evidence

Downstream consumers are evidence, not authority.

- Contra, voxel, AirDoom, ERP, DevOps/SRE experiments, and examples may produce
  pressure evidence;
- authored AIR-like modules may currently be flattened into generated AIR
  artifacts before verifier/build steps;
- package scripts may invoke consumer-local generation;
- generated files may reference external generators;
- review bundles must include any generator referenced by package scripts or
  generated headers when those generated files are part of a release fixture;
- v0.13 validates module graphs, but linked/executable multi-module package
  build is deferred.

This transitional pipeline proves the need for AIR-native executable package
composition. v0.14 P0 addresses verify/report/check over authored graphs and
generated artifact discipline. Stable linked executable package build remains
deferred. The issue is not the implementation language of a generator; the
issue is hidden or external source-of-truth transformation between authored AIR
modules and verifier/build output.

## 1. Scope

v0.14 should focus on:

- package-level verify/report/check over authored package graphs;
- AIR-authored deterministic data;
- generated artifact discipline;
- package/report/check over authored module graphs;
- anti-slop budgets;
- resource/host boundary;
- generic migration signals for downstream consumers.

## 2. Non-goals

v0.14 must not add:

- game-specific APIs such as `draw_actor`;
- Core dependency on any demo;
- demo-specific stdlib helpers;
- hidden host gameplay authority;
- `debug.metric` as gameplay/effect/audio event bus;
- ad-hoc JSON gameplay schemas as the primary verified path;
- dynamic maps;
- GC;
- reflection;
- host object handles;
- runtime imports;
- arbitrary filesystem imports;
- remote imports.

## 3. AIR-authored Deterministic Data

Problem:

Without AIR-native authored data, generated systems are pushed into external
JSON/Python/generated-AIR or procedural select-chain-as-table patterns.

v0.14 P0 should support or formalize:

- named constants;
- enum-like integer ids;
- static readonly scalar tables;
- table metadata in report;
- deterministic table access;
- bounds/guarded access diagnostics;
- generated artifact freshness checks.

Keep narrow:

- no dynamic arrays;
- no GC;
- no host-backed containers;
- no runtime mutation of readonly tables.

RFC/P1:

- tablegroups;
- record-like static schemas;
- fixed mutable pools.

## 4. Package-local Executable Composition

v0.14 P0:

- `airc verify package`;
- `airc report package`;
- `airc package-check package`;
- deterministic package-local module graph;
- package-root import safety;
- exported/private boundaries;
- capability propagation across modules;
- stable entrypoint declaration;
- generated output as derived artifact, not source of truth.

Deferred/P1:

- `airc build package` as stable linked executable package output;
- deterministic symbol mangling and linked multi-module Wasm;
- verifier and build sharing the same linked runtime contract.

Acceptance:

- no consumer-local AIR-to-AIR flattening script required for normal package
  verification, report, and package-check;
- verifier, report, and package-check use the same module graph;
- report identifies which module owns functions, globals, tables,
  capabilities, and large state.

## 5. Generated Artifacts

Generated files:

- are deterministic derived artifacts;
- are not source of truth;
- must not be manually edited;
- must not grant authority;
- must be stale/missing checked.

`package-check` should fail when:

- generated handles are missing;
- generated handles are stale;
- generated modules referenced by package metadata are missing;
- generated headers reference tools omitted from review bundles.

## 6. Resource/Manifests Boundary

JSON/resource manifests remain valid for host resources:

- texture paths;
- sprite paths;
- audio paths;
- material mappings;
- host profile metadata;
- package metadata.

Verifiable program semantics should live in AIR or validated AIR package/data
contracts.

AIR owns:

- ids;
- state;
- rules;
- capability use;
- semantic data;
- module graph.

Manifests bind ids to host files/resources.

Hosts may render/play/load only declared resources through declared
ids/capabilities.

`package-check` should validate:

- AIR ids referenced in manifests exist;
- manifest ids referenced by AIR exist;
- missing runtime resource paths fail;
- candidate/quarantine/tmp paths are not runtime refs;
- unused manifest entries can warn;
- host cannot silently invent gameplay from resource names.

## 7. Anti-slop Report Budgets

v0.14 should make AI review/report budgets enforceable by package policy.

Needed checks:

- max statements per function;
- max statements for exported entry/frame;
- max mutable globals per module;
- repeated literal detection;
- select-chain-as-table detection;
- slot-family/table-like state detection;
- `debug.metric` event-bus misuse;
- per-module ownership summary;
- generated artifact freshness;
- top large functions/modules.

Acceptance:

- budgets can be warnings or package-check failures;
- packages can enforce "entry/frame/main is orchestration only" policies when
  useful;
- report can track trends before/after refactors.

## 8. Deterministic Interactive Loop Convention

This is guidance/report policy, not Core game engine API.

Frame/main should orchestrate:

- input snapshot;
- mode/state update;
- subsystem updates in deterministic order;
- output command emission;
- audio/event emission;
- debug summary.

Subsystems should own their state and logic.

This applies to simulations, UI examples, DevOps/SRE tools, policy evaluators,
interactive packages, and other AI-generated systems.

## 9. Generic Fixed Pool Pressure Case

Classification: RFC/P1 or later, not immediate Core implementation.

Pressure:

Interactive systems need bounded fixed-capacity runtime slots for particles,
events, tasks, checks, work items, and similar data.

Do not add dynamic allocation or ECS.

Explore:

- fixed-size mutable pools;
- tablegroup plus mutable state patterns;
- kit-level helper patterns;
- report diagnostics for slot-family slop.

Acceptance for RFC:

- spawn/update/despawn patterns are bounded;
- lifetime does not accidentally control spawn rate;
- report can detect `item0`/`item1`/`task1`/`task2`-style mutable families and
  suggest a pool pattern.

## 10. Event/Output Boundary

Classification: v0.14 RFC, not immediate Core shortcut.

Need:

- output/event contracts;
- capability-gated;
- manifest-backed ids;
- visible in report;
- no `debug.metric` event bus;
- host executes declared commands/events and does not infer semantics from
  unrelated state.

Event/output contracts apply to alerts, actions, notifications, pipeline
outputs, visual effects, and other host-executed side effects.

## 11. Consumer Migration Policy

Consumer migration is out of scope for Core v0.14.

Core v0.14 provides generic mechanisms. It does not own migration plans,
milestones, acceptance gates, or refactors for consumer projects, downstream
packages, pressure demos, or examples.

Rules:

- Core provides package composition, AIR-authored data, generated artifact
  checks, reports, and policy hooks.
- Contra, voxel, AirDoom, ERP, DevOps/SRE examples, and other consumers are
  pressure evidence only.
- Consumers may migrate away from external flatteners once those mechanisms
  exist.
- A demo may produce RFCs, fixtures, and pressure evidence, but it cannot define
  Core release scope.
- Any consumer may be deleted, moved to a separate repository, or replaced
  without changing the AIR Core roadmap.
- Consumer migration tasks are not Core v0.14 release gates unless explicitly
  promoted as generic Core fixtures.

## 12. Layer Ownership

Core-level:

- modules/imports;
- static readonly tables;
- verifier;
- package-check;
- report budgets;
- capability tracking;
- deterministic package verification/reporting/checking.

Kit-level:

- reusable output conventions;
- render command conventions;
- sprite/material conventions;
- manifest validation helpers.

Consumer-local:

- level layouts;
- domain behavior;
- assets/art packs;
- tuning;
- temporary asset scripts;
- candidate/recommended packs.

Host-level:

- resource loading;
- rendering;
- audio playback;
- platform policy;
- declared capability implementation only.

## 13. Deliverables / RFC Breakdown

A. Core language RFC:

- constants/enums;
- readonly tables;
- possible tablegroups as RFC.

B. Package RFC:

- package-local executable composition;
- entrypoint;
- deterministic linking, deferred until linked executable package build is
  promoted;
- generated artifact policy.

C. Verifier/report RFC:

- per-module report;
- table access checks;
- budgets;
- capability origins.

D. Package-check RFC:

- generated handles freshness;
- manifest id consistency;
- runtime resource paths;
- review bundle reproducibility.

E. Event/output RFC:

- generic manifest-backed event/output contracts;
- `debug.metric` boundary.

F. Consumer migration guidance:

- generic migration signals for external generated/flattened AIR, without
  making any consumer migration a Core deliverable.

G. Non-goals:

- list what must not enter Core from demos.

H. Acceptance test plan:

- include at least one small non-game example;
- include one interactive example;
- prove mechanisms are generic and not consumer-specific.

## 14. Success Criteria For v0.14

- A package can be authored primarily as `.air` modules.
- `airc` can verify/report/check the authored package graph.
- external AIR-to-AIR flattening is not required for normal package
  verification, report, or package-check.
- JSON/resource manifests remain resource metadata, not hidden semantics.
- Generated output can be rebuilt deterministically.
- orchestration entrypoints can be budgeted and kept small.
- subsystem ownership is visible in report.
- package-check catches stale generated artifacts.
- reviewPolicy budgets can warn or fail by package policy.
- manifest/resource boundaries are checked without granting hidden authority.
- no game-specific Core APIs are added.
