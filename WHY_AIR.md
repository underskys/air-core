# Why AIR

AIR exists because AI-assisted code benefits from a small, checkable target.

The core idea is not that AIR is smarter than a general-purpose language. The
core idea is that AIR intentionally has less authority and a narrower semantic
surface, so a reference verifier and conformance suite can reject common failure
modes before execution.

## The Problem

Generated code can:

- call APIs that do not exist;
- smuggle host authority into logic code;
- use dynamic objects, maps, strings, or JSON where bounded facts were expected;
- hide side effects behind rare branches;
- drift from generated handles, package contracts, or output contracts;
- become hard to review because the unit is too large.

AIR makes the generated unit smaller: deterministic logic plus declared
capabilities, effect budgets, schemas, and bounded output intents.

## Comparison to Adjacent Systems

### Wasm

AIR currently lowers to Wasm for executable modules, but AIR is not a Wasm
replacement. Wasm is a portable execution format. AIR is a verifier-enforced
authoring/package layer with AIR-specific capabilities, effect budgets,
contracts, package evidence, and anti-hallucination checks.

### OPA / Rego

OPA/Rego is strong for policy evaluation. AIR overlaps with policy-style
decision logic, but AIR also focuses on AI-authored module boundaries, Host ABI
profiles, package evidence, output intents, conformance replay, and compiler
lowering. AIR does not replace OPA.

### Starlark

Starlark is a deterministic embedded language for configuration-like programs.
AIR shares the goal of constrained execution, but AIR is lower-level and built
around verifier-visible capabilities, effects, ABI profiles, and Wasm/package
evidence. AIR does not replace Starlark.

### eBPF Analogy

AIR has an eBPF-like design instinct: constrain the program shape, verify it
before execution, and keep the host boundary explicit. The analogy is limited.
AIR is not kernel technology, not packet filtering infrastructure, and not an
eBPF replacement.

## What AIR Is Good For

AIR is a fit for small modules where:

- the host can provide sanitized scalar facts;
- deterministic decisions are acceptable;
- capability and effect boundaries matter;
- evidence reports are useful for human review;
- invented APIs should be rejected before execution.

AIR is usually not a fit for:

- full application logic;
- UI rendering;
- asset pipelines;
- network clients;
- database ownership;
- real host adapters;
- large dynamic data structures;
- business rules that need unrestricted host state.

## Performance Position

AIR should be fast enough for small policy and decision modules. Performance
claims should be tied to reproducible benchmarks in this repository. AIR should
not be described as generally faster than JavaScript, TypeScript, C++, Rust, or
Wasm.
