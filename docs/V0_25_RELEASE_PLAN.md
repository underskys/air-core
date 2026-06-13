# AIR v0.25 Release Plan

Status: active evidence/tooling milestone

Theme: Host ABI Promotion Evidence & Reference Host Contract

v0.25 starts after v0.24 generated state handle/accessor policy diagnostics.
It does not implement Host ABI `0.11`. The milestone defines the evidence,
reference-host contract, and promotion gates required before any future runtime
host import such as `output.emit` can be considered.

AIR remains a portable verified plugin IR / package contract / execution
substrate for small AI-authored modules/packages:

```text
AI/domain intent
-> small AIR module
-> verifier/audit/report
-> backend artifact, currently Wasm/airpkg
-> strict host profile
-> host-owned execution
```

Host adapters may be rich. Public Host ABI must remain small, canonical,
versioned, capability-scoped, and conformance-tested.

## P0 Scope

| Area | Gate | Acceptance |
| --- | --- | --- |
| Host interaction contract inventory | Inventory existing host interaction surfaces before promotion. | [Host Interaction Inventory v0.25](HOST_INTERACTION_INVENTORY_v0_25.md) classifies host profiles, capabilities/effects, Output Contracts, command buffers, verification evidence, conformance replay, airpkg/bundles, LSP diagnostics, API gates, AirOps, and FlowDesk pressure. |
| Reference mock host / policy executor first slice | Define and implement a no-side-effect host policy evidence tool. | [Reference Mock Host Policy Executor RFC](rfcs/v0.25-reference-mock-host-policy-executor.md) defines deterministic inputs, outputs, policy model, decision model, safety rules, conformance tests, and kill criteria. `airc mock-host <package-dir> --policy <policy.json> --profile <id> --json` produces deterministic `air.hostInteractionEvidence`. |
| Host interaction contract RFC | Define the public boundary between AIR intent, package metadata, host policy, and host-owned execution. | [Host Interaction Contract RFC](rfcs/v0.25-host-interaction-contract.md) exists and rejects raw host authority, automatic execution, runtime JSON, and host object handles. |
| Command buffer host contract conformance plan | Prove command buffer intents are interpretable without runtime emit imports. | The host interaction contract and mock host RFC define allowed/denied decisions, output id resolution, deterministic checksums, negative cases, and evidence fields. |
| Verification evidence for host interaction | Make host policy decisions reviewable without side effects. | `air.hostInteractionEvidence` records package hash, ABI hash, host profile, policy id, command records, decisions, denied capabilities, diagnostics, and replay checksum. `airc verify package --host-evidence <json> --json` embeds a deterministic summary only. |
| Two-domain promotion evidence fixtures | Prevent one-domain APIs from becoming public Host ABI. | [Host ABI 0.11 Promotion Evidence RFC](rfcs/v0.25-host-abi-011-promotion-evidence.md) requires one non-game policy/ops domain and one interactive/visual domain before Host ABI `0.11` promotion. v0.25 includes AirOps-style policy/ops and synthetic visual/panel fixtures. |
| Host ABI `0.11` decision gate | Keep runtime imports frozen until evidence is sufficient. | [Host ABI 0.11 Decision Record](rfcs/v0.25-host-abi-011-decision-record.md) records that Host ABI `0.11` is not accepted in v0.25, AIR ABI remains `0.10`, Host ABI remains `0.10`, and `output.emit` remains deferred. |
| Negative tests plan for raw host authority | Keep raw platform APIs out of AIR Core and public Host ABI. | RFCs define negative coverage for raw `chrome.*`, DOM/React/IndexedDB/Jira/fetch authority, DB/cloud SDK imports, host object handles, runtime JSON, and automatic side effects. |

## P1 / If Scope Allows

- `output.emit` Host ABI candidate RFC;
- `extension-basic` experimental kit;
- generated output handles;
- LSP diagnostics for host contract/profile mismatch;
- FlowDesk/AirOps pressure mapping.

P1 work remains design/evidence unless separately accepted. P1 must not
silently implement Host ABI `0.11`.

## Deferred

- actual Host ABI `0.11` implementation;
- `output.emit`;
- `output.event`;
- `audio.event`;
- `effect.event`;
- raw `chrome.*`;
- DOM/React/IndexedDB/Jira/fetch authority;
- DB/cloud SDK imports;
- host object handles;
- runtime JSON/object model;
- automatic host-side side effects;
- package registry;
- native installers.

## What Is Already Possible Through Command Buffers

Without Host ABI `0.11`, AIR packages can already declare bounded host
interaction intent:

- package-local `outputContracts` describe stable output ids and scalar
  argument contracts;
- package-local `commandBuffers` carry bounded scalar command intent records;
- package-check validates output id usage and package-local paths;
- reports and verification evidence expose fingerprints, command counts, and
  diagnostics;
- conformance replay can compare expected command records;
- `airc mock-host` can apply a deterministic allow/deny policy fixture to
  command buffer intents and emit `air.hostInteractionEvidence`;
- `airc verify package --host-evidence <json> --json` can include a compact
  host interaction summary: status, policy id, host profile, decision count,
  denied capability count, diagnostics count, and replay checksum;
- AirOps-style fixtures prove non-game policy/ops decisions without real
  infrastructure authority.

These surfaces are metadata, evidence, and conformance contracts. They do not
execute real host side effects.

## What Would Require Host ABI `0.11`

Host ABI `0.11` becomes necessary only if a public runtime host boundary
changes:

- a new public host import is accepted;
- an existing host import signature or semantics changes;
- direct command-target behavior becomes public runtime ABI;
- `output.emit`, `output.event`, `audio.event`, or `effect.event` becomes a
  runtime import;
- a host must interpret new runtime-visible metadata to execute AIR calls;
- host-managed side-effect execution becomes part of AIR's public contract.

## Missing Evidence Before Host ABI `0.11`

The remaining evidence before any Host ABI `0.11` decision is:

- broader reference mock host / policy executor behavior beyond the first
  allow/deny slice;
- broader command buffer host contract conformance fixtures beyond the first
  two-domain fixtures;
- additional verification evidence that distinguishes declared intent from host
  policy decisions across more packages;
- expanded negative tests for raw authority leakage;
- additional two-domain proof if a specific Host ABI `0.11` candidate proposes
  semantics beyond current command-buffer intent:
  - a non-game policy/ops domain;
  - an interactive/visual domain;
- rollback/compatibility rules for packages that remain on Host ABI `0.10`;
- profile mismatch diagnostics for unsupported host contract behavior.

v0.25 now includes initial two-domain fixture evidence:

- `test/fixtures/conformance_batch/airops/` for non-game policy/ops command
  intent;
- `test/fixtures/host_interaction/visual_panel/` for a synthetic
  interactive/visual-like command intent.

Both fixtures use Output Contracts, command buffers, mock host policies,
expected `air.hostInteractionEvidence`, and deterministic replay checksums.
Neither fixture executes real side effects or requires raw platform authority.

## Rollback And Compatibility Path

Host ABI `0.10` packages must continue to work through Output Contracts,
command buffers, verification evidence, and conformance replay. Any future Host
ABI `0.11` candidate must be opt-in through explicit profile/version selection.
Hosts that do not support a candidate import must fail package-check before
runtime with clear diagnostics. Where practical, promoted imports should have a
downgrade path back to command buffer intent metadata.

## Why v0.25 Does Not Implement `output.emit`

`output.emit` would be a public runtime host import. AIR does not yet have
enough evidence that its semantics are generic across independent domains, that
host policy decisions are safely represented, or that rollback from runtime emit
to command-buffer intent remains clear. v0.25 therefore gathers promotion
evidence instead of adding the import.

## ABI Policy

AIR ABI remains `0.10`.

Host ABI remains `0.10`.

Planning documents, inventory, evidence schemas, mock-host tooling, and
promotion gates do not change executable AIR semantics or public host import
semantics.

## Representative Checks

```sh
node scripts/check_markdown_links.js
git diff --check
```
