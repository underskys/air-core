# AIR v0.21 Canonical Examples Plan

Status: first canonical example active

This document classifies example surfaces for the v0.21 API rebaseline,
records the first promoted canonical example, and keeps the remaining migration
candidates explicit. It does not touch demos, change AIR ABI, or change Host
ABI.

## Classification

| Class | Meaning | v0.21 rule |
| --- | --- | --- |
| canonical | Current adoption guidance for new users and AI-generated packages. | Must build, verify, run or have deterministic conformance, produce verification evidence, and use canonical bounded data/output surfaces where relevant. |
| experimental | Useful for pressure, host exploration, or optional kit work. | Must be clearly labeled and must not imply stable Core or Host ABI. |
| legacy | Supported compatibility examples that predate the v0.21 canonical path. | May remain, but should not be presented as the preferred API path. |
| archive | Historical reference only. | Must not be active onboarding guidance. |

Canonical examples must:

- build;
- verify;
- run or have a deterministic conformance fixture;
- produce verification evidence through `airc verify package <dir> --json`;
- use bounded facts or bounded rowsets where structured input is needed;
- use command/result buffers for output intents where host-visible output is
  needed;
- avoid raw host authority;
- avoid legacy APIs unless the example explicitly tests migration behavior.

## Existing Example Handling

v0.21 should classify existing examples before changing them:

- examples that demonstrate stable scalar language features can remain
  canonical for their narrow purpose if they build and verify;
- examples that demonstrate host/GFX/app surfaces should be classified as
  experimental or legacy until they are checked against the v0.21 canonical API
  path;
- examples using undocumented compatibility behavior should be labeled legacy
  before any migration;
- archived release material remains archive-only;
- demos and standalone demo repositories are out of scope for this plan.

## Canonical Migration Candidate 1: AirOps-Style Incident Diagnostic

Purpose:

Show a non-game operational package that scores incident observations and emits
bounded output intents for dashboard or pipeline policy review.

Current canonical package:

- [examples/airops_incident_package](../examples/airops_incident_package/README.md)

The package is synthetic. It promotes the existing AirOps batch fixture shape
into an example package without adding real infrastructure authority, network
or cloud APIs, credentials, auto-remediation, Host ABI `0.11`, or runtime
output events.

Required facts / rowsets:

- `incident_observation` bounded rowset schema;
- scalar columns such as `incident_id`, `severity_id`, `service_id`,
  `signal_count`, `age_minutes`, and `flags`;
- privacy policy that forbids raw incident text, raw URLs, tokens, secrets, and
  credentials;
- optional compact `storageHint` metadata for enum-like IDs and flags.

Output intents:

- `incident_alert_requested`;
- `pipeline_hold_requested`;
- `dashboard_status_update`;
- each declared through an Output Contract manifest with scalar args only;
- command buffer records use `output_id`, `arg0`, `arg1`, `arg2`, and `arg3`.

Verification evidence:

- must produce `kind: "air.verificationEvidence"`;
- evidence should include package identity, selected profile, rowset schema
  fingerprints, Output Contract fingerprints, command buffer evidence,
  diagnostics, package hash, ABI hash, AIR ABI, and Host ABI.

Conformance fixture:

- deterministic batch fixture with host/test-owned incident rows;
- expected command records for bounded incident policy intents;
- mismatch tests for wrong output ID, wrong args, row bound exceeded, privacy
  leak, unsupported profile, and nondeterministic fields.

Must remain host-owned:

- real incident text;
- raw logs;
- URLs;
- service topology objects;
- tokens and credentials;
- external API access;
- pager, dashboard, CI/CD, and incident-system side effects.

Must not enter Core:

- SRE/vendor-specific APIs;
- automatic infrastructure action execution;
- raw webhook/fetch authority;
- host object handles;
- arbitrary JSON runtime data;
- domain-specific Host ABI imports.

## Canonical Migration Candidate 2: FlowDesk-Style Policy/Recommendation

Purpose:

Show a non-game productivity/policy package that scores minimized task facts and
emits bounded recommendation or notification intents without browser authority.

Required facts / rowsets:

- `task_summary` bounded rowset schema;
- scalar columns such as `task_id`, `status_id`, `priority`, `blocked`,
  `age_minutes`, `link_count`, and `flags`;
- privacy policy that forbids raw task text, raw note text, raw URLs, tokens,
  secrets, and credentials;
- optional compact `storageHint` metadata for status IDs, flags, and bounded
  priority values.

Output intents:

- `priority_alert_requested`;
- `focus_suggestion_requested`;
- `ai_budget_cap_recommended`;
- `policy_violation_reported`;
- each declared through an Output Contract manifest with scalar args only;
- command buffer records use `output_id`, `arg0`, `arg1`, `arg2`, and `arg3`.

Verification evidence:

- must produce `kind: "air.verificationEvidence"`;
- evidence should include package identity, selected profile, rowset schema
  fingerprints, Output Contract fingerprints, command buffer evidence,
  diagnostics, package hash, ABI hash, AIR ABI, and Host ABI.

Conformance fixture:

- deterministic batch fixture with host/test-owned task rows;
- expected command records for priority/focus/budget/policy intents;
- mismatch tests for wrong output ID, wrong args, row bound exceeded, privacy
  leak, unsupported profile, and nondeterministic fields.

Must remain host-owned:

- Chrome Extension APIs;
- DOM and React state;
- IndexedDB/Dexie;
- Jira/fetch/external API access;
- raw task text;
- raw notes;
- raw URLs;
- tokens, secrets, and browser permissions;
- notification, badge, tab, storage, and alarm side effects.

Must not enter Core:

- raw `chrome.*`;
- extension-specific Core semantics;
- arbitrary JSON runtime objects;
- browser permission authority;
- automatic host-side action execution;
- domain-specific Host ABI imports.

## Release Gate Direction

v0.21 should plan release gates that distinguish canonical examples from legacy
examples:

- canonical examples should produce verification evidence;
- canonical examples with structured host facts should use bounded facts or
  bounded rowsets;
- canonical examples with host-visible output intents should use Output
  Contracts and command buffers;
- canonical examples should have deterministic conformance where behavior is
  part of the claim;
- legacy examples should remain allowed but labeled;
- experimental examples should not be presented as public API stability claims.

## ABI Status

- AIR ABI remains `0.10`.
- Host ABI remains `0.10`.
- This plan adds no `output.emit`, `output.event`, `audio.event`, or
  `effect.event`.
