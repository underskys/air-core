# AIR v0.35 Release Plan

Status: active read-only consumer proof milestone

Theme: Read-only Consumer Proof & Product Evidence Pack

v0.35 delivers the first read-only consumer proof and defines the product
evidence pack around it after the v0.29 benchmark baseline, v0.30 evidence
review surface, v0.32 bounded structured IO first slice, v0.33 AI
authoring/verifier safety deepening, and v0.34 documentation/workflow hygiene.

This milestone must prove that AIR can consume real host-shaped read-only
structured facts and produce deterministic diagnosis/recommendation output
without becoming a general app language, production observability system, raw
network wrapper, or host authority surface.

The Core proof fixture is synthetic and read-only. It does not implement an
external lan-observer integration, real network access, host writes, secrets,
package registry behavior, new Host ABI imports, or external demo changes.

AIR ABI latest remains `0.10`.

Host ABI latest remains `0.11`, limited to bounded `output.emit`; Host ABI
`0.10` remains the default/baseline compatibility target for packages that do
not use `output.emit`.

v0.35 does not add AIR ABI changes, Host ABI changes, new Host ABI imports,
real network access, host writes, secrets, package registry behavior, or external
demo changes.

## Purpose

The lan-observer-style proof should show AIR as a small verified decision layer
inside a host-owned application:

```text
host real platform/network state
-> sanitized bounded scalar structured facts
-> AIR deterministic diagnosis/recommendation
-> bounded output intent / command buffer
-> host policy decision
-> evidence, replay, report, and package diff
```

The host owns rich platform state, real network access, raw observations,
secrets, timestamps, device identity, and execution policy. AIR sees only
minimized scalar facts and emits bounded intent.

The product evidence pack makes that boundary reviewable through package-check,
verification evidence, human-readable evidence report, replay, package diff,
benchmark baseline, and AI authoring eval coverage. v0.35 must not make product
or performance claims beyond what those surfaces actually measure.

## Required Questions

### What problem does this proof demonstrate?

It demonstrates that AIR can sit inside a host-owned read-only consumer as a
deterministic diagnosis/recommendation layer. The host shapes realistic platform
observations into sanitized bounded scalar facts; AIR computes bounded intent
without acquiring network, device, or write authority.

### Which AIR surfaces are exercised?

- bounded structured IO schemas and generated structured IO handles;
- AIR scalar decision functions;
- output contract and command buffer metadata;
- mock host policy evidence;
- package-check, verification evidence, package report, evidence report;
- conformance/replay;
- package diff;
- benchmark runner and AI authoring eval as product evidence surfaces.

### What remains host-owned?

The host owns real network/platform state, scans, packet capture, device APIs,
raw identifiers, private names, secrets, credentials, wall-clock time,
randomness, persistence, write authority, and execution policy.

### What is intentionally synthetic/sanitized?

The Core fixture uses synthetic observations and sanitized scalar ids, flags,
scores, and counters. Device ids are not MACs, IPs, hostnames, or private names.
No raw packet dumps, raw URLs, private hostnames, notes, tokens, or secrets are
present in package inputs or reports.

### How does evidence prove the boundary?

Evidence proves the package boundary by showing the package requires only
existing AIR ABI `0.10`, Host ABI `0.10`, no host imports, bounded structured IO
metadata, bounded output intent metadata, replay status, host policy status, and
privacy-safe diagnostics. It does not prove real-world network correctness or
host policy quality.

### How does package diff show change risk?

Package diff should surface structured IO schema deltas, output contract
deltas, capability/effect deltas, Host ABI requirement deltas if any, and
generated artifact freshness changes without exposing raw private payloads.

### How does benchmark establish baseline?

Benchmark coverage should use the v0.29 runner to record package-check,
verification/report/evidence, replay, artifact size, and runtime timings where
available. It establishes a baseline only; it does not justify global
performance claims.

### How does AI eval measure authorability/repairability?

AI eval coverage should use deterministic replay fixtures to measure whether an
AI-authored candidate can reproduce the read-only proof shape, avoid forbidden
surfaces, and repair diagnostics without live model calls or network access.

## P0 Scope

| P0 item | Expected output |
| --- | --- |
| lan-observer-style read-only package fixture | Implemented under `examples/lan_observer_readonly_package/`. |
| Sanitized structured facts schema | Implemented as scalar-only bounded structured IO schemas under `examples/lan_observer_readonly_package/schemas/`. |
| AIR diagnosis/recommendation module | Implemented in `examples/lan_observer_readonly_package/module.air` with deterministic diagnosis, severity, action, confidence, and approval helper functions. |
| Bounded output intent | Implemented with output contract plus command buffer metadata; no new Host ABI imports. |
| Mock host policy fixture | Implemented as synthetic trace plus mock host policy; no real network/OS access. |
| Evidence report golden | Implemented as `examples/lan_observer_readonly_package/expected/evidence_report.md`. |
| Package diff golden | Implemented as `examples/lan_observer_readonly_package/expected/package_diff_output_contract.summary.json`; tests compare old/new proof copies with output contract changes. |
| Replay/conformance fixture | Implemented as `examples/lan_observer_readonly_package/traces/pass.json`. |
| Unsafe-to-safe rejection story | Implemented in tests for raw host authority rejection; docs define the rejected surfaces. |
| Benchmark fixture using benchmark runner | Implemented as `benchmarks/lan_observer_readonly_basic/` using the existing benchmark runner without performance claims. |
| AI authoring eval case using eval-ai replay | Implemented as the deterministic replay-only `lan_observer_readonly_proof` eval case. |
| README quickstart / product explanation | Implemented in `examples/lan_observer_readonly_package/README.md`. |
| Evidence/replay/report expectations | Implemented for the fixture; product evidence pack hardening continues through benchmark, AI eval, and optional diff golden. |
| No-write/no-secret/no-real-network constraints | Enforced in fixture docs, mock policy, and test assertions. |
| Package diff workflow | Covered by tests comparing old/new fixture copies with output contract changes. |
| Acceptance criteria | Covered by `test/lan_observer_readonly.test.js` and full Core checks. |

## P1 Scope

- External `lan-observer-air` adapter planning only.
- Rust/Wasmtime host fixture planning if it stays synthetic and read-only.
- FlowDesk policy secondary proof planning.

## Deferred

- real network scan;
- real packet capture;
- real device mutation;
- secrets or tokens;
- raw hostnames, MACs, IPs, raw URLs, or private hostnames unless transformed
  into sanitized ids;
- production observability;
- package registry;
- new Host ABI;
- new Host ABI imports;
- host writes;
- external demo changes.
- real host adapter;
- tablegroups;
- declared pools.

## Hard Constraints

- Host owns real network and platform state.
- Host owns raw packets, raw device identifiers, private names, credentials,
  wall-clock time, randomness, persistence, and execution policy.
- AIR sees only minimized scalar structured facts with fixed bounds.
- AIR emits bounded recommendation/output intent only.
- Host policy owns any execution decision.
- Evidence, replay, report, and diff outputs must be deterministic.
- Reports must not expose raw packet dumps, secrets, tokens, raw URLs, raw
  hostnames, MAC addresses, IP addresses, or private text.
- No AIR ABI change.
- No Host ABI change.
- No real network access.
- No external writes or mutations.

## Fixture Shape

The proof uses:

```text
examples/lan_observer_readonly_package/
```

- `air.package.json`;
- structured IO schema for sanitized observations;
- AIR module for deterministic diagnosis/recommendation;
- output contract and/or command buffer contract;
- mock read-only host policy;
- conformance/replay fixture;
- expected evidence report;
- README quickstart.

## Representative Commands

The fixture is expected to pass:

```sh
node bin/airc.js verify package examples/lan_observer_readonly_package --json
node bin/airc.js package-check examples/lan_observer_readonly_package --profile cli --source-only --json
node bin/airc.js report package examples/lan_observer_readonly_package --json
node bin/airc.js evidence report examples/lan_observer_readonly_package --format markdown -o build/lan_observer_evidence.md
node bin/airc.js conformance examples/lan_observer_readonly_package --profile cli --trace examples/lan_observer_readonly_package/traces/pass.json --json
node test/lan_observer_readonly.test.js
```

## Acceptance Criteria

v0.35 can close only when:

- sanitized scalar structured facts are implemented and package-checked;
- no raw packet dumps, hostnames, MACs, IPs, URLs, secrets, tokens, or private
  text appear in AIR package inputs/reports by default;
- no real network/OS/cloud/browser/database access exists in the fixture;
- no writes, mutations, auto-remediation, or host-side execution are added;
- diagnosis/recommendation output is deterministic and bounded;
- output intent remains command-buffer or bounded `output.emit` only;
- mock host policy owns execution decisions;
- evidence report is readable and privacy-safe;
- conformance/replay passes deterministically;
- package diff surfaces structured IO/output/capability changes;
- full Core checks pass;
- AIR ABI remains `0.10`;
- Host ABI remains unchanged.

## Links

- [Feature Status v0.35](FEATURE_STATUS_v0.35.md)
- [Read-only Consumer Proof RFC](rfcs/v0.35-readonly-consumer-proof.md)
- [lan-observer Read-only Proof RFC](rfcs/v0.35-lan-observer-readonly-proof.md)
- [Bounded Structured IO First Slice](rfcs/v0.32-bounded-structured-io-first-slice.md)
- [Examples, Demos, and Snapshots](EXAMPLES_AND_DEMOS.md)
- [Version and ABI Policy](VERSION_AND_ABI_POLICY.md)
