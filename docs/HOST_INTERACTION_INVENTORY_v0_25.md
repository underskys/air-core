# AIR v0.25 Host Interaction Inventory

Status: planning / audit inventory for v0.25

This document inventories existing AIR host interaction surfaces before any
Host ABI `0.11` promotion work. It is documentation only. It does not add host
imports, `output.emit`, raw host authority, runtime JSON/object semantics,
package registry behavior, or native installer behavior.

AIR remains a portable verified plugin IR / package contract / execution
substrate for small AI-authored modules. Host adapters may be rich, but public
Host ABI must remain small, canonical, versioned, capability-scoped, and
conformance-tested.

## 1. Current Host Interaction Model

The current model is:

```text
AIR package
-> bounded facts / package metadata
-> deterministic AIR decision
-> command buffer output intents
-> host policy decision
-> verification evidence / conformance report
```

AIR can express intent and evidence. The host owns authority. Command buffers
are scalar output-intent metadata tied to Output Contracts; they are not
runtime host calls and do not execute side effects by themselves.

Host-side execution remains a policy decision outside AIR Core:

- the package declares capabilities, profiles, facts, Output Contracts, and
  command buffers;
- package-check validates the declared surfaces;
- verification evidence records deterministic fingerprints and status;
- conformance replay compares expected bounded records;
- a future reference mock host may simulate host policy without granting real
  authority.

## 2. Inventory

| Surface | Current layer | Status | Host ABI? | AIR ABI? | Source of truth | Report/evidence visibility | Conformance coverage | Known gaps | v0.25 action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Host ABI registry and profiles | host profile / public contract | public | yes, for existing imports only | no | [Host Profiles](../spec/HOST_PROFILES.md), host ABI registry | package-check profile support and host ABI mismatch diagnostics | host profile tests and package-check coverage | no reference policy executor contract yet | inventory and define reference host contract evidence |
| Capabilities and effects | Core/package contract | public | no by themselves | yes, existing AIR ABI only | AIR source, verifier, specs | audit/report surfaces and verifier diagnostics | verifier/effects tests | effect budgets are not side-effect execution policy | keep as intent/evidence; do not promote raw authority |
| Output Contracts | package metadata | public/tooling | no | no | package `outputContracts` in [AIR Package Manifest](../spec/AIR_PACKAGE_MANIFEST.md) | report/evidence fingerprints and diagnostics | output contract schema tests, package tests | no runtime emit import | keep as declaration layer; gather promotion evidence |
| Command buffers | package metadata / conformance | public/tooling | no | no | package `commandBuffers` metadata in [AIR Package Manifest](../spec/AIR_PACKAGE_MANIFEST.md) | report/evidence command buffer metadata and output intent usage | command buffer schema tests and conformance replay | no reference host policy executor yet | define command buffer host contract conformance plan |
| Verification evidence JSON | report / release evidence | public | no | no | `airc verify package <dir> --json`, verification evidence schema | primary evidence artifact | verification evidence tests | no host-policy execution result schema | add host interaction evidence requirements |
| Conformance replay | conformance/test harness | public/test harness | no | no | package traces / conformance fixtures | replay checksums, expected records, diagnostics | conformance replay tests, batch fixtures | limited reference-host vocabulary | specify reference mock host / policy executor design |
| airpkg / target bundles | package/tooling | public first slices | no | no | package artifact and target bundle metadata | package/bundle validation reports | airpkg, target bundle, linked package tests | not a registry, installer, or host authority path | keep as artifact boundary; no package registry scope |
| LSP diagnostics | diagnostics / tooling | public diagnostics-only | no | no | package-check/verifier diagnostics | diagnostics only, no execution | LSP-lite and Full LSP tests | no host contract/profile mismatch plan beyond existing diagnostics | plan diagnostics for host contract/profile mismatch |
| API gates | release governance | public gate | no | no | [API Gates v0.21](API_GATES_v0_21.md), [API Gates v0.22](API_GATES_v0_22.md) | check outputs and release reports | API gate scripts | broad heuristics remain conservative | add negative raw-authority gate plan |
| AirOps canonical example | example / conformance evidence | public example | no | no | [AirOps incident package](../examples/airops_incident_package/README.md) | package-check, verification evidence, conformance replay | example package and trace | synthetic only; no real infra authority | use as non-game policy/ops evidence |
| FlowDesk pressure docs/fixtures | pressure docs / conformance fixtures | pressure evidence | no | no | [FlowDesk pressure request](abi-requests/flowdesk-air.md), batch fixtures | fixture/report evidence where used | batch conformance pressure | browser/private-text pressure risk | use carefully as second-domain evidence, not Core authority |
| Raw browser/cloud/DB APIs | rejected | rejected/deferred | would require explicit Host ABI review | no unless AIR syntax changes | rejected gates and strategy docs | rejection diagnostics/gates only | hallucination/negative fixtures | not accepted public surface | keep rejected; add negative tests plan |
| `output.emit` / event imports | rejected/deferred | deferred | yes, if accepted later | no unless AIR calling semantics change | RFC/promotion-gate docs only | rejected/deferred status | negative fixture coverage | missing two-domain evidence and reference host contract | do not implement in v0.25 P0 |

## 3. What Is Already Possible Without Host ABI `0.11`

AIR can already provide strong host-interaction evidence without adding runtime
host imports:

- bounded command intent metadata through package-local `commandBuffers`;
- Output Contract validation through package-local `outputContracts`;
- command buffer conformance that compares expected bounded scalar records;
- verification evidence with package identity, hashes, ABI status, fact schema
  fingerprints, Output Contract fingerprints, command buffer metadata, and
  diagnostics;
- host profile compatibility checks for already-public Host ABI imports;
- deterministic conformance replay for package fixtures;
- AirOps-style synthetic incident decision packages with no real
  infrastructure authority;
- FlowDesk-style pressure evidence as a browser-adjacent domain, while keeping
  Chrome/browser authority host-owned.

This means v0.25 can evaluate host interaction semantics using reports,
fixtures, and mock policy execution before adding `output.emit` or any Host ABI
`0.11` import.

## 4. What Would Require Host ABI `0.11`

Host ABI `0.11` becomes necessary only if a public runtime host boundary
changes, for example:

- a new public host import is accepted;
- an existing host import signature or semantics change;
- direct command-target behavior becomes a public runtime ABI;
- `output.emit`, `output.event`, `audio.event`, or `effect.event` becomes a
  runtime import;
- the host must interpret new runtime-visible package metadata to execute AIR
  calls;
- host-managed side-effect execution becomes part of AIR's public contract.

Host ABI `0.11` is not required for:

- package metadata validation;
- command buffer intent records;
- verification evidence;
- conformance replay fixtures;
- host profile compatibility checks;
- a mock reference host that consumes reports/fixtures as test evidence rather
  than runtime AIR imports.

## 5. Raw Authority Rejection

v0.25 must continue to reject raw host authority in AIR Core and public Host
ABI unless it passes the promotion gate. Rejected surfaces include:

- raw `chrome.*`;
- DOM/React/IndexedDB/Jira/fetch authority;
- DB/cloud SDK imports;
- host object handles;
- secrets, tokens, credentials, or private raw text authority;
- runtime JSON object model;
- automatic host-side action execution;
- direct filesystem/network/cloud/Kubernetes authority outside existing
  capability-scoped imports and host-owned policy.

AIR may describe bounded intent. Hosts decide whether to execute real actions.

## 6. Missing Evidence Before Host ABI `0.11`

Before any Host ABI `0.11` promotion, AIR needs:

- a reference mock host / policy executor contract;
- command buffer host contract conformance fixtures;
- verification evidence fields that distinguish declared intent from host
  policy decisions;
- negative tests for raw authority leakage;
- two independent domains proving generic semantics:
  - non-game policy/ops domain, such as AirOps-style incident diagnostics;
  - interactive/visual domain, such as a dashboard or visual command policy;
- rollback/compatibility rules for packages that stay on Host ABI `0.10`;
- profile mismatch diagnostics for unsupported host contract behavior.

## 7. Rollback And Compatibility Path

The compatibility path should keep current packages valid:

- Host ABI `0.10` packages continue to use Output Contracts, command buffers,
  verification evidence, and conformance replay without runtime emit imports;
- Host ABI `0.11` candidates must be opt-in through explicit profile/version
  selection;
- hosts that do not support a candidate import must fail package-check with a
  clear diagnostic before runtime;
- any promoted import must have a documented downgrade path back to command
  buffer intent metadata where practical.

## 8. Recommendation

Recommendation: **A. continue with promotion evidence only.**

v0.25 does not accept Host ABI `0.11`. The decision is recorded in
[Host ABI 0.11 Decision Record](rfcs/v0.25-host-abi-011-decision-record.md).

The conditions for Host ABI `0.11` are not yet met. The existing
surfaces already support bounded host interaction evidence through package
metadata, command buffers, verification evidence, host profiles, and conformance
replay. v0.25 continues with the evidence/policy model only.

Do not implement `output.emit` in v0.25 P0. Use v0.25 to specify and test the
reference host contract, host policy simulation, conformance expectations,
negative raw-authority cases, and promotion evidence needed before any Host ABI
`0.11` decision. Do not infer from v0.25 evidence that `output.emit` is
unlocked.
