# AIR v0.21 Canonical Examples Readiness

Status: AirOps migration active

This document audits readiness for migrating the two v0.21 canonical example
candidates described in [Canonical Examples v0.21](CANONICAL_EXAMPLES_v0_21.md).
The AirOps candidate has been promoted into a small synthetic example package.
This document does not touch demos, remove legacy APIs, change AIR ABI, change
Host ABI, or add Host ABI `0.11`.

## Existing Material

| Area | Available files | Readiness notes |
| --- | --- | --- |
| Legacy non-game policy package | [policy audit package](../examples/policy_audit_package/README.md) | Good small package/report precedent. It is scalar-only and predates bounded rowsets, Output Contracts, command buffers, and verification evidence. Treat as compatibility input, not the final canonical v0.21 example. |
| Scalar conformance policy fixture | [conformance policy fixture](../test/fixtures/conformance_policy/air.package.json) | Useful for deterministic scalar trace precedent. It does not exercise bounded rowsets or command buffers. |
| AirOps batch pressure fixture | [AirOps batch fixture](../test/fixtures/conformance_batch/airops/air.package.json) | Strongest direct candidate. Already includes bounded rowset schema, Output Contract manifest, command buffer metadata, and deterministic batch fixture. |
| AirOps canonical example package | [AirOps incident package](../examples/airops_incident_package/README.md) | First promoted canonical v0.21 example. Synthetic, scalar-only, authority-free, and based on the bounded rowset/output-intent/conformance path. |
| FlowDesk batch pressure fixture | [FlowDesk batch fixture](../test/fixtures/conformance_batch/flowdesk/air.package.json) | Strong direct candidate. Already includes bounded rowset schema, Output Contract manifest, command buffer metadata, and deterministic batch fixture. Needs extra care because FlowDesk pressure is browser/Chrome-adjacent and must stay host-owned. |

## Candidate: AirOps-Style Incident Diagnostic

Purpose:
Demonstrate a non-game operations package that consumes minimized incident
facts and produces bounded pipeline/dashboard output intents.

Existing files/fixtures:

- [test/fixtures/conformance_batch/airops/air.package.json](../test/fixtures/conformance_batch/airops/air.package.json)
- [incident_observation.rowset.schema.json](../test/fixtures/conformance_batch/airops/facts/incident_observation.rowset.schema.json)
- [incident_policy.output.json](../test/fixtures/conformance_batch/airops/outputs/incident_policy.output.json)
- [incident_policy.commands.json](../test/fixtures/conformance_batch/airops/outputs/incident_policy.commands.json)
- [pass.json](../test/fixtures/conformance_batch/airops/traces/pass.json)
- [module.air](../test/fixtures/conformance_batch/airops/module.air)

Migration status:

- promoted package: [examples/airops_incident_package](../examples/airops_incident_package/README.md)
- verification evidence command documented in the example README;
- package-check, report, and deterministic conformance commands documented in
  the example README;
- infrastructure execution remains host policy and is explicitly out of scope.

Remaining future hardening if this becomes more than a first minimal example:

- at least one negative or documented test path for wrong command args or output
  ID if the example claims conformance failure behavior;
- optional docs that map numeric decision IDs to host-owned localized labels.

Required bounded rowset schemas:

- `incident_observation` with scalar columns for incident IDs, severity,
  service/tier identifiers, counts or age buckets if needed, and flags;
- privacy policy forbidding raw incident text, raw URLs, tokens, secrets, and
  credentials;
- optional `storageHint` values only as metadata.

Required output contracts:

- one or more pipeline/dashboard/action-request intents such as
  `pipeline_decision_recorded`, `incident_alert_requested`, or
  `dashboard_status_update`;
- scalar args only;
- channels and capabilities declared in Output Contract metadata.

Required command buffers:

- bounded package-local command buffer with `output_id`, `arg0`, `arg1`,
  `arg2`, and `arg3`;
- `output_id` values must match the Output Contract manifest;
- capacity must be fixed and small.

Required verification evidence:

- `kind: "air.verificationEvidence"`;
- package identity, selected profile, package hash, ABI hash, AIR ABI, Host ABI;
- rowset schema fingerprint;
- Output Contract fingerprint;
- command buffer evidence;
- diagnostics and profile compatibility.

Required conformance fixture:

- deterministic batch fixture with host/test-owned incident rows;
- expected output intent records and expected command records;
- replay checksum generated from stable inputs only.

Host-owned data/authority:

- real incident text, logs, URLs, service topology objects, tokens,
  credentials, external API access, pager/dashboard/CI/CD authority, and all
  side effects.

Forbidden authority / what must not enter Core:

- vendor-specific SRE APIs;
- raw webhook/fetch authority;
- automatic infrastructure action execution;
- host object handles;
- arbitrary JSON runtime objects;
- domain-specific Host ABI imports.

Risk rating:
Low to medium. The fixture already exercises the v0.21 canonical path and has
less browser/private-text pressure than FlowDesk. Main risk is accidentally
presenting pipeline decisions as host-side execution rather than output intents.

Recommended migration order:
First.

Recommended milestone:
v0.21 P1 if the migration remains a small example-package promotion using
existing bounded rowset, Output Contract, command buffer, verification evidence,
and batch conformance tooling. Defer to v0.22 if the package needs new compiler
features, new Host ABI, generated handles, or domain-specific authority.

## Candidate: FlowDesk-Style Policy/Recommendation

Purpose:
Demonstrate a non-game productivity/policy package that consumes minimized task
facts and produces recommendation, notification, or budget output intents
without browser authority.

Existing files/fixtures:

- [test/fixtures/conformance_batch/flowdesk/air.package.json](../test/fixtures/conformance_batch/flowdesk/air.package.json)
- [task_summary.rowset.schema.json](../test/fixtures/conformance_batch/flowdesk/facts/task_summary.rowset.schema.json)
- [task_policy.output.json](../test/fixtures/conformance_batch/flowdesk/outputs/task_policy.output.json)
- [task_policy.commands.json](../test/fixtures/conformance_batch/flowdesk/outputs/task_policy.commands.json)
- [pass.json](../test/fixtures/conformance_batch/flowdesk/traces/pass.json)
- [module.air](../test/fixtures/conformance_batch/flowdesk/module.air)
- [FlowDesk Air pressure request](abi-requests/flowdesk-air.md)

Missing files/fixtures before migration:

- example package under `examples/` with README and package-local files;
- explicit privacy-focused README section that says raw task text, raw notes,
  raw URLs, browser state, and Chrome APIs remain host-owned;
- verification evidence command example;
- package-check/report command examples;
- conformance narrative that fixture JSON is host/test-owned input, not AIR
  runtime JSON.

Required bounded rowset schemas:

- `task_summary` with scalar columns for task ID, status ID, priority,
  blocked/age/link-count buckets, and flags;
- privacy policy forbidding raw task text, raw note text, raw URLs, tokens,
  secrets, and credentials;
- optional compact storage hints as metadata only.

Required output contracts:

- recommendation and policy intents such as `priority_alert_requested`,
  `focus_suggestion_requested`, `ai_budget_cap_recommended`, or
  `policy_violation_reported`;
- scalar args only;
- no browser command authority in AIR.

Required command buffers:

- bounded package-local command buffer with scalar output intent records;
- output IDs must be declared by Output Contract manifests;
- host policy owns notification, badge, focus, storage, alarm, and external
  action execution.

Required verification evidence:

- `kind: "air.verificationEvidence"`;
- package identity, selected profile, package hash, ABI hash, AIR ABI, Host ABI;
- rowset schema fingerprint;
- Output Contract fingerprint;
- command buffer evidence;
- diagnostics and profile compatibility.

Required conformance fixture:

- deterministic batch fixture with host/test-owned task rows;
- expected output intent and command records;
- mismatch coverage for row bound exceeded, privacy leak, wrong output ID,
  wrong args, unsupported profile, and nondeterministic fields if claimed.

Host-owned data/authority:

- Chrome Extension APIs, DOM/React state, IndexedDB/Dexie, Jira/fetch/external
  API access, raw task text, raw notes, raw URLs, tokens, secrets, browser
  permissions, notifications, badges, tabs, storage, alarms, and side effects.

Forbidden authority / what must not enter Core:

- raw `chrome.*`;
- extension-specific Core semantics;
- arbitrary JSON runtime objects;
- browser permission authority;
- automatic host-side action execution;
- domain-specific Host ABI imports.

Risk rating:
Medium. The fixture is ready, but the domain is closer to Chrome Extension and
private productivity data pressure. The migration must be stricter about
host-owned authority and privacy wording.

Recommended migration order:
Second.

Recommended milestone:
v0.21 P1 after AirOps establishes the canonical example pattern. Defer to
v0.22 if privacy/browser-boundary wording or host-owned Chrome Extension
pressure requires new kit/profile work rather than a small package example.

## Readiness Summary

| Candidate | Existing coverage | Missing migration work | Risk | Order |
| --- | --- | --- | --- | --- |
| AirOps-style incident diagnostic | Bounded rowset, Output Contract, command buffer, package manifest, AIR module, batch conformance fixture, and promoted example package exist. | Optional negative/example-hardening paths only. No ABI or host authority changes required. | Low | 1 |
| FlowDesk-style policy/recommendation | Bounded rowset, Output Contract, command buffer, package manifest, AIR module, batch conformance fixture, and pressure request already exist. | Promote into a small example package, add stronger privacy/browser-boundary wording, commands, and verification evidence expectation. | Medium | 2 |

## Recommendation

Recommendation: **A. migrate AirOps first**.

Reasoning:

- AirOps has the same canonical v0.21 mechanics with less risk of being read as
  Chrome/browser authority.
- The existing AirOps batch fixture already covers bounded rowsets, Output
  Contracts, command buffers, and deterministic conformance.
- A successful AirOps migration creates a neutral pattern that FlowDesk can
  follow with stricter privacy and browser-authority notes.

Do not create a smaller neutral example first unless the AirOps fixture becomes
too domain-specific during migration. Do not defer migration to v0.22 unless
the example package needs new tooling beyond existing v0.20/v0.21 surfaces.

## ABI Status

- AIR ABI remains `0.10`.
- Host ABI remains `0.10`.
- No Host ABI `0.11`, `output.emit`, `output.event`, `audio.event`, or
  `effect.event` is required for either migration candidate.
