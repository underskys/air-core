# Public Claims Policy

Status: launch-safety guardrail for public AIR documentation.

AIR public claims must be reproducible from checked-in code, public docs, or
explicitly referenced external evidence. Benchmark-specific evidence must stay
benchmark-specific.

## Allowed Claims

Allowed phrases and claim shapes:

- verifier-enforced IR;
- machine-checked capabilities and effect budgets;
- bounded execution under AIR's verifier model;
- deterministic semantics for the documented subset;
- evidence reports for human review;
- reference verifier and conformance suite;
- rejects invented APIs / hidden authority before execution;
- anti-hallucination resistance in tested invalid-authority cases;
- fast enough for small policy/decision modules;
- in the Java/JS performance class for the tested integer policy workload.

## Disallowed Claims

These phrases are blocked by `scripts/check_public_claims.js` unless the line is
explicitly allowlisted as an example of disallowed wording.

| Disallowed wording | Why it is blocked |
| --- | --- |
| `formally verified` | AIR has a reference verifier and tests, not a formally verified compiler. <!-- public-claims-allow --> |
| `proved correct` | Evidence reports support review; they do not prove arbitrary correctness. <!-- public-claims-allow --> |
| `proves correctness` | AIR enforces verifier-visible constraints, not product correctness. <!-- public-claims-allow --> |
| `secure AI code` | AIR narrows authority under its model; it does not make generated code universally secure. <!-- public-claims-allow --> |
| `faster than JS` | Performance evidence is benchmark-specific, not a broad language ranking. <!-- public-claims-allow --> |
| `faster than TypeScript` | TypeScript compiles to JS; broad speed claims are misleading. <!-- public-claims-allow --> |
| `faster than C++` | Current evidence does not support this and should not imply it. <!-- public-claims-allow --> |
| `impossible to escape` | Malicious host and out-of-model behavior remain out of scope. <!-- public-claims-allow --> |
| `AI cannot break out` | AIR rejects undeclared authority in AIR modules; it is not a universal AI sandbox. <!-- public-claims-allow --> |
| `universal sandbox` | AIR is a narrow verifier-enforced module boundary, not a universal sandbox. <!-- public-claims-allow --> |
| `general purpose replacement` | AIR is not a replacement for host languages or policy engines. <!-- public-claims-allow --> |

## Benchmark Claim Rules

Benchmark claims must include:

- workload description;
- environment or explicit environment limitation;
- raw result source;
- caveats;
- distinction between host-boundary and hot-loop measurements;
- no implication that AIR is a general-purpose language benchmark winner.

Allowed example:

> AIR is in the Java/JS performance class for the tested integer policy
> workload and is fast enough for small policy/decision modules.

Disallowed example:

> AIR is faster than JS. <!-- public-claims-allow -->

## Conformance Claim Rules

Conformance claims must say what was actually reproduced in the public repo.
Independent external results may be mentioned only as pending or external
unless the reproduction path is included and run as part of the release check.

## AI-Assisted Development Wording

Allowed:

> AIR is developed with AI assistance under human direction.

Disallowed:

> The entire toolchain was written by AI. <!-- public-claims-allow -->

AIR authorship, release decisions, architecture constraints, acceptance
criteria, and review gates remain human-directed.
