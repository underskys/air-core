# AIR Benchmark and Showcase Evidence

Status: public-safe benchmark and comparison evidence. This document records
measured AIR behavior without treating AIR as a general-purpose language
benchmark or a replacement for host languages.

## Summary

AIR is a verifier-enforced IR for bounded deterministic policy and decision
modules. It is not a faster JavaScript, TypeScript, C++, Java, Python, or Rust.

The useful measured result is narrower:

- AIR is in the Java/JS performance class for the tested integer policy
  workload.
- AIR is fast enough for small policy/decision modules.
- AIR's value is verification, determinism, authority boundaries, effect
  budgets, bounded execution, diagnostics, and evidence reports.

The independent `air-tests` result set inspected for this document recorded 74
passing checks, 0 failures, and 0 findings. Those checks live outside the
public npm package surface and should be reproduced separately before making
release claims about the external suite.

## What Was Measured

The `air-tests` suite compares AIR against hand-written control programs on a
small integer policy workload and on invalid-authority examples. The benchmark
is intentionally narrow:

- clamp / fixed multiply / interpolation style integer scoring;
- `i32` wraparound and truncating division behavior;
- host-boundary calls into a compiled AIR/Wasm module;
- batch execution inside the module with the boundary amortized;
- deterministic build/execution checks;
- invalid authority and AI-slop rejection cases.

The measured workload is representative of small policy modules. It is not a
general language, IO, UI, string, JSON, database, renderer, SIMD, or host
application benchmark.

## Environment

The independent suite documentation records:

- Node/V8 for JavaScript and Wasm execution;
- TypeScript 5.9 with `tsc --strict`;
- g++ 11 with `-O2`;
- OpenJDK 11;
- CPython 3.10.

The inspected `air-tests/results/perf.json` and `air-tests/results/results.json`
files did not include a normalized hardware manifest. Treat the numbers as
benchmark-specific evidence, not as portable hardware-independent rankings.

## Performance Results

Representative local `air-tests` runs produced the following class of results
for the same integer policy workload.

| Mode | AIR/Wasm | JS | TS | C++ `-O2` | Java 11 | Python 3.10 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Hot loop, M iters/sec | ~395-430 | ~492-522 | ~552-559 | ~763-770 | ~462-482 | ~2.8-2.9 |
| Host-boundary, M ops/sec | ~283-304 | ~241-255 | ~230-262 | not measured | not measured | not measured |

The inspected `air-tests/results/perf.json` snapshot included:

| Metric | AIR/Wasm | JS | TS |
| --- | ---: | ---: | ---: |
| Host-boundary ops/sec | 283,378,100 | 253,146,132 | 229,915,010 |
| Batch/hot-loop iters/sec | 360,574,934 | 491,967,273 | 552,106,597 |

The cross-language hot-loop run in the same raw file records:

| Runtime | iters/sec |
| --- | ---: |
| AIR/Wasm | 394,755,022 |
| C++ `-O2` | 762,854,091 |
| Java 11 | 478,927,203 |
| Python 3.10 | 2,775,211 |

In the tested host-boundary scenario, AIR/Wasm outperformed the measured JS/TS
variants. That is a statement about this specific workload and host-boundary
setup. It is not a general language-speed claim.

## Determinism Results

The benchmark's fixed-width integer ground-truth result for `N=2,000,000` was:

```text
1687010910
```

AIR/Wasm, disciplined JS/TS, C++ with unsigned/cast discipline, Java, and
carefully masked Python can match the result.

A naive Python port returned:

```text
5981200941
```

That divergence is not a claim that Python, C++, JS, or TypeScript are wrong.
Those languages have different default numeric semantics and require discipline
when the intended policy semantics are fixed-width `i32` wraparound and
truncating division. AIR makes those semantics mandatory for the documented
subset.

The f32 chain matched the `Math.fround`-style reference in the tested suite.
This is not a universal bitwise f32 replay claim across every engine and every
NaN payload case. NaN payload canonicalization is not currently a cross-engine
bitwise replay claim unless explicitly canonicalized or documented.

## Anti-Hallucination / AI-Slop Results

The tested AIR verifier rejects these invalid surfaces before execution:

- invented stdlib API, such as `std.voxel`;
- invented host API, such as `net.fetch_json`;
- known host API with invalid signature;
- dynamic map / JSON-style runtime model;
- hallucinated API hidden behind a rare or unreachable branch;
- hidden authority such as undeclared network/filesystem imports;
- recursion / verifier-unbounded execution after v0.41 hardening;
- region leaks after v0.41 region lifetime checking.

The control-group behavior should be read carefully:

- JS `node --check` can pass syntax for invalid dynamic-authority examples.
- TypeScript can catch typed API misuse, but AI-generated plugin/tool code can
  escape typed surfaces via `as any` or dynamic host objects. AIR rejects
  unknown authority at the IR verifier level.
- C++ and Java compilers catch many known symbol/signature issues, but they do
  not provide AIR-style capability/effect/evidence semantics.
- Python often reports invented names at runtime.

AIR's claim is not that other languages are unsafe. The claim is that AIR's
smaller IR gives the verifier a stricter boundary for AI-authored policy code.

## What AIR Is Not

AIR is not:

- a general-purpose programming language;
- a replacement for TypeScript, Rust, C++, Java, Python, Wasm, OPA/Rego,
  Starlark, or eBPF;
- a browser, renderer, database, networking, or OS abstraction;
- a broad sandbox for arbitrary programs;
- a proof that business logic is correct;
- a guarantee that a malicious host is safe;
- a compiler-optimization project.

AIR is intended for small, bounded, deterministic modules where the host owns
real platform authority.

## How To Reproduce

From a sibling checkout containing the independent suite:

```sh
cd air-tests
npm install
node run_all.js
```

Raw result files:

```text
results/perf.json
results/results.json
```

The current AIR Core npm package does not ship `air-tests`. Do not claim exact
public reproduction from the AIR Core package until the suite or a public copy
is included in the repository or documented as a reproducible external input.

The cross-language suite requires local toolchains such as g++, Java, and
Python. If a toolchain is missing, reproduce the available suites and report the
missing toolchain instead of converting the result into a product claim.

## Known Limitations And Caveats

- Performance results are workload-specific and environment-sensitive.
- The host-boundary scenario measures one local JS/Wasm calling pattern.
- The hot-loop result reflects current AIR lowering and fuel checks, not an
  optimized Wasm pipeline.
- AIR has intentionally limited data types and host authority.
- AIR does not model strings, runtime JSON, dynamic maps, object identity, GC,
  browser APIs, filesystem APIs, or network APIs as AIR-owned authority.
- Evidence reports support human review; they do not prove product correctness.
- Independent `air-tests` output should be regenerated before each public
  release claim.

## Future Comparison Work

Planned comparison work should add evidence before claims:

- Rust;
- Go;
- Starlark;
- Rego / OPA;
- Swift on macOS;
- Binaryen / `wasm-opt` experiment;
- LLM repair-hint success metrics;
- normalized hardware/environment metadata;
- repeated-run variance and confidence intervals.

Potential performance work is explicitly future work, not part of this
showcase:

- fuel-check amortization;
- Binaryen `wasm-opt`;
- lowerer peephole pass;
- NaN canonicalization policy.
