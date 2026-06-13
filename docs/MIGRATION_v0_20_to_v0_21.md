# AIR v0.20 to v0.21 Migration

Status: planning guide

This guide explains the canonical v0.21 API path after the v0.20 bounded data
and command buffer first slice. It does not remove compatibility behavior,
change compiler semantics, change AIR ABI, or change Host ABI.

## Canonical Pipeline

```text
host rich state
-> minimized bounded facts / bounded rowset schemas
-> AIR deterministic scalar decision
-> command buffer output intent
-> host policy execution decision
-> verification evidence / conformance replay report
```

AIR should receive minimized scalar facts. Hosts remain responsible for raw
objects, strings, URLs, private text, tokens, browser/infra authority, and
side-effect authorization.

## Canonical Input Path

Use bounded facts and bounded rowset schemas for structured host facts:

- declare package-local schemas through `factSchemas`;
- use `kind: "air.boundedRowsetSchema"` for rowset metadata;
- keep `layout: "columnar"` and fixed `maxRows`;
- use scalar `i32` and `bool` columns in the current first slice;
- include privacy metadata and storage hints where useful;
- keep JSON as package metadata/schema or conformance fixture data only.

Avoid treating JSON as an AIR runtime object model. AIR must not parse
arbitrary JSON, access dynamic object fields, or receive host object handles.

## Canonical Output Path

Use Output Contract manifests plus command buffer output intents:

- declare output IDs, channels, capabilities, and scalar arg schemas through
  `outputContracts`;
- declare package-local command buffer metadata through `commandBuffers`;
- use bounded scalar records with `output_id`, `arg0`, `arg1`, `arg2`, and
  `arg3`;
- keep `output_id` tied to declared Output Contract IDs;
- treat commands as intents only.

Host policy owns execution. v0.21 does not add `output.emit`,
`output.event`, `audio.event`, `effect.event`, Host ABI `0.11`, or automatic
host-side action execution.

## Canonical Evidence Path

Use verification evidence JSON for machine-readable package claims:

```sh
node bin/airc.js verify package <package-dir> --json
```

The canonical evidence object is `kind: "air.verificationEvidence"`. It should
connect package identity, selected profile, diagnostics, fact schema
fingerprints, Output Contract fingerprints, command buffer evidence, generated
artifact status, profile compatibility, package hash, ABI hash, AIR ABI, and
Host ABI.

Human-readable reports remain useful, but release or adoption claims should
prefer deterministic verification evidence.

## Canonical Conformance Path

Use deterministic replay fixtures:

- scalar conformance traces remain valid for existing scalar packages;
- batch conformance fixtures are canonical for bounded rowset and output intent
  pressure;
- fixture JSON is host/test-harness owned input and expected output evidence;
- replay reports should include deterministic checksums and stable mismatch
  diagnostics.

Fixtures must not contain wall-clock time, randomness, absolute paths, raw
private data, secrets, tokens, raw URLs, or mutable local state in replay
checksums.

## What Remains Compatible in v0.21

- Existing scalar AIR modules remain valid.
- Scalar-only adapters remain valid for small decisions and compatibility
  packages.
- Simple scalar returns remain valid for pure computation.
- Existing Host ABI `0.10` imports remain governed by the Host ABI registry and
  host profiles.
- v0.16-v0.20 package, artifact, bundle, linking, conformance, LSP, and report
  surfaces remain supported.
- Legacy examples may remain while v0.21 inventory and migration gates are
  designed.

## What May Become Strict in v0.22+

Future strict gates may require:

- canonical examples with structured host facts to declare bounded facts or
  bounded rowset schemas;
- host-visible output intent examples to declare Output Contracts and command
  buffers;
- release artifacts to include verification evidence JSON;
- deprecated API usage to be visible through package-check, report, or LSP
  diagnostics before becoming a failure;
- demo-local host imports to stay outside Core, stdlib, public Host ABI, and
  canonical examples.

Future strict gates must not silently change AIR ABI or Host ABI. Any Host ABI
promotion, including output events, requires a separate accepted RFC/spec/profile
and tests.

## Non-goals

- No legacy API removal in v0.21.
- No example migration in this planning document.
- No AIR ABI change.
- No Host ABI change.
- No `output.emit`, `output.event`, `audio.event`, or `effect.event`.
- No runtime JSON object model, dynamic maps, GC, reflection, host object
  handles, promises, async-await, runtime imports, raw Chrome authority, package
  registry, or native installers.

## Checklist for New Canonical Packages

- Package metadata uses `air.package.json`.
- Structured inputs use bounded facts or bounded rowset schemas.
- Host-visible output intents use Output Contracts and command buffers.
- Machine-readable claims use verification evidence JSON.
- Behavior claims are covered by deterministic conformance fixtures where
  practical.
- Reports avoid raw private text, URLs, tokens, secrets, and host-owned objects.
