# AIR Verifier Safety Contract

Status: active contract with v0.33 deterministic scaffold expansion

## Purpose

Document the safety obligations that AIR's verifier must preserve as AIR adds
more package metadata, generated artifacts, evidence reports, and executable
utility slices.

This document is a contract for implementation and review. It does not change
parser, verifier, lowering, AIR ABI, Host ABI, or runtime semantics by itself.

## Verifier Guarantees

Within the accepted AIR Core language and package surface, the verifier must
reject or precisely diagnose:

- type mismatches;
- undeclared symbols;
- undeclared host imports;
- capability/effect misuse;
- statically visible bounds violations;
- invalid memory/slice/buffer/state access;
- state access outside declared bounds;
- same-function memory region leaks, double-free, and use-after-free for
  `alloc_region` / `free_region` paths;
- structured IO access outside declared bounds when visible through package and
  conformance metadata;
- output IDs outside Output Contracts when package context makes contracts
  visible;
- dynamic output IDs where the selected output path forbids them;
- host calls outside the selected Host ABI/profile;
- forbidden host object handle types;
- unsupported control-flow shapes;
- local function call cycles, including self-recursion, mutual recursion, and
  cycles through `loop.fold.*`, `loop.array.*`, or `loop.buffer.*` callback
  references;
- recursion hidden behind rare, statically false, or otherwise non-hot branches;
- any CFG backedge without a verifier-visible bound or deterministic lowering
  fuel cap;
- runtime JSON/object payload dependencies;
- source-of-truth mismatches when those are verifier-visible.

The verifier must not accept runtime JSON, dynamic maps, object identity, host
object handles, raw host authority, or arbitrary runtime imports as AIR Core
features.

Simple scalar contracts may contribute verifier facts only within the accepted
first-slice range model. `i32` parameter preconditions with literal `>=`, `<=`,
or `==` bounds narrow the parameter range inside that function. Local callee
return postconditions with literal `>=`, `<=`, or `==` bounds narrow the call
result range at the call site. The verifier must not infer cross-variable
relations, solve arbitrary arithmetic, or treat compound boolean predicates as
proven facts.

The verifier/lowering boundary must not accept a module that lowers into a
runtime trap outside declared fail-fast semantics. Static failures must remain
verifier failures. Dynamic bounds failures must lower to deterministic trap or
documented checked behavior. Current bounded loops and structured phi loops use
a maximum bound of 4096 iterations; the verifier rejects static counts above
4096, and lowering must trap deterministically if a dynamic or structured loop
attempts to exceed that bound.

Memory regions are explicit bounded resources. Within a function, every
`alloc_region` result must be released by `free_region` on every return path.
The verifier rejects leaked regions at return, double-free, and use-after-free.
AIR does not infer ownership transfer, GC, dynamic heap objects, or hidden host
resource cleanup for regions.

## Non-guarantees

The verifier does not guarantee:

- business correctness;
- quality of a recommendation or ranking;
- host policy correctness;
- performance optimality;
- protection against a malicious host;
- correctness of host-owned rich data before it is minimized into AIR facts,
  rowsets, or scalar inputs;
- that report-visible properties were verifier-proven unless the report names
  them as verifier-enforced.

## Proof vs Report Visibility

Reports are not proofs. If a property is only observed, summarized, or
package-checked, reports must not imply that the verifier proved it.

Verifier-proven properties should be described separately from:

- package-check validation;
- evidence/report visibility;
- conformance replay outcomes;
- generated artifact freshness;
- review policy warnings.

## Diagnostic Contract

Diagnostics must be stable enough for AI repair loops and human review:

- stable code where behavior is stable;
- deterministic ordering;
- source location where available;
- specific diagnostics instead of generic package-check collapse when a specific
  cause is known;
- no private payload leakage in messages.

## Tiny Fuzz / Property Scaffold

The scaffold is deterministic and intentionally small. It runs:

```sh
node bin/airc.js fuzz-safety --seed 1 --cases 50 --json
```

The command emits `kind: "air.verifierSafetyFuzzReport"`. It does not claim
formal verification.

The scaffold exercises:

- parser/formatter roundtrip for tiny modules;
- verifier rejection of malformed tiny modules;
- deterministic diagnostic ordering;
- no crash on bounded generated inputs;
- no accidental acceptance of forbidden surfaces;
- lowering to Wasm for generated valid modules where supported;
- mock-host instantiation for bounded `output.emit`;
- simple exported-function execution;
- failure on unexpected trap, import, signature, or bounds mismatch.

The scaffold must be deterministic and CI-friendly. Randomized fuzzing may be
added later only with stable seeds and clear failure reproduction.

Supported subset:

- arithmetic;
- fixed state `state.len` / `state.get` / `state.set`;
- bounded `output.emit` valid static IDs and invalid dynamic IDs;
- generated handle constants;
- structured IO valid schema/package-check coverage;
- structured IO invalid JSON/object/string field rejection;
- generated structured IO handle missing/stale metadata rejection.

Generated invalid cases must be rejected before lowering. If a failing case is
found, the report records a stable source fingerprint, case id, family, kind,
diagnostic codes, and `minimizedCase` reference. Broader source minimization
remains future work.

The JSON report includes:

- `seed`;
- `cases`;
- top-level `passed`, `failed`, and `skipped`;
- `families` with valid/invalid/pass/fail/skip counts;
- `diagnostics`;
- `minimizedCase` when a case fails, otherwise `null`;
- no timestamps;
- no absolute paths.

## Non-goals

- no formal proof system in v0.32;
- no broad optimizer validation;
- no dynamic JSON/object fuzzing as accepted runtime behavior;
- no host authority fuzzing;
- no ABI change.

## Kill Criteria

Stop verifier-safety changes if they:

- weaken existing verifier rejections;
- add a parallel diagnostics engine;
- make diagnostics nondeterministic;
- imply report visibility is verifier proof;
- accept runtime JSON/object/map semantics;
- require AIR ABI or Host ABI changes without a separate accepted decision.
