# AIR API Gates v0.33

Status: active milestone gate

Scope: AI authoring eval replay and verifier safety boundaries

v0.33 does not add language or Host ABI surface. This gate protects the
executable/test/evidence surfaces introduced and deepened in v0.32-v0.33:

- deterministic `eval-ai` replay;
- deterministic `eval-ai --regression`;
- deterministic `fuzz-safety`;
- verifier safety contract wording;
- review-bundle-safe eval fixtures.

## Command

```sh
npm run check:api-gates:v0.33
```

The v0.33 gate chains the v0.32 gate first.

## Rejected Active Implementation

The gate rejects active implementation of:

- live AI provider calls;
- API key, token, secret, provider, or model environment loading in eval code;
- network APIs in eval/fuzz implementation;
- nondeterministic report behavior such as wall-clock time or unseeded random;
- automatic code actions;
- automatic repair;
- formal verification overclaims;
- Host ABI expansion;
- new language syntax via structured IO/tablegroup/pool shortcuts;
- tablegroups implementation;
- declared pools implementation.

Docs and RFCs may still discuss future or rejected ideas when clearly marked as
deferred, rejected, or non-goals.

## Positive Checks

Where practical, the gate verifies:

- `eval-ai` emits `air.aiAuthoringEvalReport`;
- `eval-ai --regression` emits `air.aiAuthoringEvalRegressionReport`;
- eval reports declare replay mode with no live model calls, network, or API key
  requirements;
- eval reports contain no timestamp-like fields or absolute paths;
- `fuzz-safety --seed 1 --cases 50 --json` emits deterministic seed-driven
  report shape;
- eval fixtures live under deterministic `evals/ai_authoring/` captured-output
  paths;
- no provider-specific SDK dependency is added.

## Non-goals

This gate does not:

- prove verifier correctness;
- run live model comparisons;
- validate model quality;
- create code actions;
- perform automatic repair;
- expand AIR ABI or Host ABI.

## ABI Status

AIR ABI remains `0.10`.

Host ABI latest remains `0.11`, limited to bounded `output.emit`; Host ABI
`0.10` remains the default/baseline for packages that do not use `output.emit`.
