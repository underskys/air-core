# AIR v0.33 Release Plan

Status: active executable/test/evidence milestone

Theme: AI Authoring Eval & Verifier Safety Deepening

v0.33 deepens the v0.32 executable utility surfaces instead of opening another
planning-only milestone. The milestone focuses on deterministic replay evals,
repairability evidence, verifier safety coverage, and fuzz-safety expansion.

v0.33 does not add language syntax, does not expand structured IO, does not add
tablegroups or declared pools, and does not add live AI provider calls.

AIR ABI latest remains `0.10`.

Host ABI latest remains `0.11`, limited to bounded `output.emit`; Host ABI
`0.10` remains the default/baseline compatibility target for packages that do
not use `output.emit`.

## Previous Milestone

v0.32 completed the Executable Utility Slice:

- bounded scalar structured IO first slice;
- generated structured IO handles and metadata;
- AI authoring eval replay mode;
- verifier safety contract;
- tiny deterministic fuzz scaffold;
- v0.32 API gates.

v0.32 did not add parser syntax, tablegroups syntax, declared pools, runtime
JSON, Host ABI expansion, or AIR ABI changes.

## P0 Scope

1. Expand deterministic AI authoring eval corpus.
2. Add structured IO eval cases.
3. Add `output.emit` eval cases.
4. Add fixed state eval cases.
5. Add forbidden surface eval cases:
   - runtime JSON;
   - dynamic objects;
   - host object handles;
   - dynamic `output_id`;
   - raw host authority.
6. Track repairability metrics:
   - first-pass verify rate;
   - first-pass package-check rate;
   - repair success at 1;
   - repair success at 3;
   - average repair iterations;
   - forbidden surface rate;
   - top diagnostic codes;
   - diagnostic repair hint coverage.
7. Normalize repair hints for high-value diagnostics.
8. Expand deterministic fuzz/safety scaffold:
   - small arithmetic;
   - fixed state;
   - `output.emit`;
   - structured IO schema cases;
   - generated handles.
9. Add verifier safety coverage report.
10. Add eval regression report.
11. Add v0.33 API gates for eval/fuzz/replay boundaries.

## P1 Scope

- live model eval design only;
- model-by-model comparison design only;
- AI repair transcript viewer;
- deeper fuzz corpus;
- parser roundtrip fuzz planning.

## Deferred

- live AI provider calls;
- API keys;
- network;
- nondeterministic CI;
- automatic code actions;
- automatic repair;
- formal verification claims;
- new language syntax;
- Host ABI expansion.

## Hard Constraints

- `eval-ai` remains replay-only in P0.
- Captured eval outputs are deterministic fixtures.
- No live model calls, API keys, network, or nondeterministic CI behavior.
- `fuzz-safety` remains deterministic and seed-driven.
- No formal verification is claimed.
- Structured IO remains scalar-only, fixed-shape, and bounded-row.
- Generated handles and bindings remain derived artifacts.
- Schemas and contracts remain source of truth.
- AIR ABI remains `0.10`.
- Host ABI remains `0.11` only for bounded `output.emit`.

## Evidence Outputs

v0.33 should produce reviewable evidence rather than new language surface:

- eval replay reports with deterministic metrics;
- repairability summaries by diagnostic code;
- forbidden-surface regression summaries;
- verifier safety coverage reports;
- fuzz-safety deterministic run reports;
- review bundle visibility for eval fixtures and reports.

## API Gate Expectations

v0.33 gates protect eval/fuzz/replay boundaries even though v0.33 does not add
language or Host ABI surface. They should continue rejecting:

- runtime JSON or object model drift;
- dynamic maps;
- host object handles;
- dynamic `output_id`;
- raw host authority;
- tablegroups implementation;
- declared pools implementation;
- output event surfaces outside accepted Host ABI;
- live AI provider calls, API key loading, network access, nondeterministic CI,
  automatic code actions, automatic repair, and formal verification overclaims.

See [API Gates v0.33](API_GATES_v0_33.md).

## Representative Checks

```sh
npm test
npm run test:bundle
npm run check:api-gates:v0.21
npm run check:api-gates:v0.22
npm run check:api-gates:v0.26
npm run check:api-gates:v0.27
npm run check:api-gates:v0.28
npm run check:api-gates:v0.32
npm run check:api-gates:v0.33
bash scripts/run_rc_checks.sh
node scripts/check_review_bundle.js --keep
node scripts/check_markdown_links.js
node scripts/check_abi_requests.js
node test/layer_guard.test.js
git diff --check
```
