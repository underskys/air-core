# typed-v0.53 P0-09: source imports and package composition

Card AIR-0053-P0-09-0001; admitted slice text R2.5 (`AIR_V053_P0_09_SLICE_RFC_R2_5_2026_10_29/`, SHA256SUMS `07a356c9…`) with the
admission record (`36f65655…`: AD-P9-1 … AD-P9-16, each (a); the BINDING_CLARIFICATION) and the P0-09 ledger (`d072edfb…`: OD-P9-1 …
OD-P9-6, each (a)). This note records what the implementation does and where; the slice text is the specification.

Flags: RUNTIME_LINKING=false AUTHORITY_THROUGH_IMPORTS=false X_SND_03_CLAIMED_CLOSED=false.

X-SND-03 (the card's binding wording): "Do not label X-SND-03 closed here. Under PF-1 it is first executed at P0-10. The 0.52.1
module-local budget scope (H52, P2-9) is a narrowed legacy guarantee and is not evidence for typed package-global composition."

## 1. Where it lives

| Rule | File | What |
| --- | --- | --- |
| P9-R1..P9-R3 | `src/parser.js` | `use "<path>" as <alias>`; the `uses` list (path, alias, line) exists only when a module has a `use` line |
| P9-R4..P9-R10, P9-R15 | `src/typed_closure.js` (the card's "final name in the note") | the loader: packages, resolution, the worklist, intake limits, cycles, link order, identities, the closure measure, the per-module counters; `TYPED_CLOSURE_LIMITS`; the `modules` and `closureLimits` validation |
| P9-R10..P9-R14 | `src/verifier.js` | each module verified once, dependencies first; `@alias.f` resolves to an export; P9-R12 before any argument check |
| P9-R16, P9-R22 | `src/workbound.js` | an imported callee's `B(f)` from its own module's summary; its region peak; the key's `dependencies` |
| P9-R18..P9-R21 | `src/lower_wasm.js` | one Wasm module: storage module by module in link order, then P0-08's layout pass; `$<k>.<name>`; the root's exports only; the root's lane |
| P9-R25 | `src/format.js` | the `use` group after the header, sorted by path |
| P9-R26, P9-R26a, P9-R26b | `src/v052_verified_build.js`, `src/source_profile.js` (bounded: `:76`, `:81`, `:126`, `:139` and one `require`) | the input key `modules`, the runtime option `closureLimits`, `closureDigest`, the closure capacity at every entrypoint |
| P9-R24 | `src/diagnostics.js` | a typed-v0.53 hint for each code below |

One earlier test changes, by the owner's OD-P9-7 (A) (record `AIR_V053_P0_09_OD_P9_7_OWNER_DECISION_2026_10_29/`, `9acff7be…`):
`test/v053_workbound_foundation.test.js:629` (P0-02's V53-WB-H05 (b)) lists `"modules"` in its sorted place, so the scanned set of
`air.v052.work_limit_*` codes is the nine of 94001cd plus the admitted `air.v052.work_limit_modules` (AD-P9-2 (a)). Nothing else in that test
or in any other earlier test changes, and the code is not hidden from the scan.

Not changed: `src/imports.js`, the legacy link plan, `sourceGraphHash`, the `.airpkg` fingerprint, `src/module_graph.js`,
`src/linked_package.js`, `src/analysis_capacity.js`, `bin/airc.js`, `src/sdk.js`, `src/v051_reference.js`, `src/typed_interface.js`,
`src/host_abi.js`, CT-1 (P0-08-MEM-1, blob `4a5c2055…`; OD-P9-1 (a)).

## 2. Codes (P9-R24; AD-P9-7 (a))

| Code | Status | Hint |
| --- | --- | --- |
| `air.import.path_uncontained` | PROPOSED (R3.1 §12) | Import a package-relative module: `use "./name.air" as alias` or `"../dir/name.air"`, with ASCII segments and no path that leaves the package root, directly or through a symbolic link. |
| `air.import.cycle` | PROPOSED (R3.1 §12) | typed-v0.53 module imports form no cycle: move the shared functions into a module that both import. |
| `air.import.bundle_unsupported` | PROPOSED (R3.1 §12) | typed-v0.53 imports package-relative modules only: write `use "./name.air" as alias`; bundles are not imported. |
| `air.import.stdlib_unsupported` | PROPOSED (R3.1 §12) | typed-v0.53 has no standard library: import a package-relative module or write the function in this module. |
| `air.import.profile_mismatch` | PROPOSED (R3.1 §12) | A typed-v0.53 module imports typed-v0.53 modules only: port the imported module or keep it out of this closure. |
| `air.import.not_found` | PROPOSED (P0-09) | Name a module file of the package, spelled exactly as its directory entry; a `<…>` source label has no package. |
| `air.import.duplicate_module` | PROPOSED (P0-09) | Import each module once per module: keep one `use` line for it and call its exports through that alias. |
| `air.import.signature_type_unsupported` | PROPOSED (P0-09) | Only i32, i64, f32, f64, bool, refined integers and option<T> of these cross a module boundary. |
| `air.v052.work_limit_modules` | PROPOSED (P0-09; AD-P9-2 (a)) | INTAKE_REFUSED is not a verdict: the closure reaches more modules than the configured limit (64 by default). |

EXISTING codes P0-09 reaches: `air.v051.typed_syntax_invalid`, `air.call.unknown_function`, `air.decision.enum_unknown`,
`air.abi.borrowed_lane_plain_export` (P0-08's, per module; AD-P9-14 (a)), `air.v052.work_limit_source_bytes`,
`air.v052.work_limit_ast_nodes`, `air.analysis.capacity_exceeded`, `air.v052.runtime_input_invalid`,
`air.v052.verified_build_input_invalid`, `air.v052.runtime_limits_invalid`. `air.import.alias_reserved` is not a code (OD-P9-5 (a)).

An intake refusal carries `disposition: "INTAKE_REFUSED"` and the fields `scope` (`"module"` or `"closure"`), `measure`, `required`,
`limit` and `module` (the module key that crossed it), and no line. A `use`-line failure is at the importing module's `use` line; a
failure inside an imported module is in that module's file, named by its key.

## 3. Implementer readings (no scope change)

- **The loader.** `parseTypedV053Closure` (the SDK parse at `src/source_profile.js:76`) parses the root with the same parser and, for a
  text with `use`, reads the closure from the root file's directory; `loadMapClosure` reads it from the module map (builder and
  runtime). The root's own per-module limits are checked by the loader again, before any import is read, so the order of P9-R8 holds.
- **Link order.** `k` is the module's index when, among the modules whose imports are all placed, the smallest key is placed next
  (P9-R18: reverse topological order, ties by key). The root is last.
- **A `void` result crosses nothing.** P9-R12 lists the types that may cross; a callee whose result is `void` passes no value, so only its
  parameters are checked. No vector covers it.
- **Memoization and counters (OD-P9-8 (A)).** Within one closure intake each module key is read, parsed and measured once; the verifier's
  closure pass verifies each module once and the WorkBound phase summarizes each once (the analyses are kept with the closure).
  `closureCounters` reports the five counts per key (card exact_evidence; V53-PIPE-04 (i)), and every counter counts each real pass
  (`+= 1`), so a module verified or summarized twice reads 2. The counters count the verifier's closure pass only: a later call on the
  same root re-verifies the root outside them. The builder's lowering verifies its input again (`src/lower_wasm.js`), as for one module.
  P0-09-CHECK-CLOSURE kills a mutant that verifies a shared module once per importer (M4) and one without the per-key summary cache (M5).
- **Identities stay private.** The module identities and each module's bound record live in the verified build's private state
  (P9-R17); the root's key `dependencies` are the WorkBound record's.
- **The P0-08 controls.** The C8 anchors in `src/lower_wasm.js` stay once each: a closure's features are computed by
  `v053ModuleFeatures`, and each module's features inherit the artifact's, so a field the lowering sets on the artifact reaches every
  function.

## 4. Carried and deferred

V53-IMP-P01, N01, N05, ID-01 and V53-WB-H03 are DEFERRED to P0-10 (a typed `extern`). The legacy package commands keep refusing
typed-v0.53 text with an uncoded legacy syntax error (AD-P9-11 (a)): a known, recorded limitation for a later slice. The import-alias /
extern collision rule is P0-10's (OD-P9-5).
