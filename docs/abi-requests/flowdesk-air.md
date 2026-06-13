# FlowDesk Air Pressure Request:
# Chrome Extension Host Pressure, Structured Facts, and Bounded Output Commands

Status: proposed / pressure evidence

Target versions:

- v0.17: pressure evidence only; no implementation
- v0.18+: possible RFC candidates for structured facts, bounded output command
  buffers, and Chrome Extension host profile

Formal ledger decisions:
[Chrome Extension Host ABI](../../requests/rejected/chrome-extension-host-abi.md),
[Event And Output Intent Surface](../../requests/accepted/event-intent-surface.md),
and [Static Tables And Readonly Tablegroups](../../requests/accepted/static-tables-tablegroups.md).

The v0.18+ references are candidate pressure only. They do not create an active
v0.18 release plan, active roadmap, AIR ABI change, or Host ABI change.

## Purpose

Document FlowDesk Air as non-game pressure evidence for future AIR architecture
work. FlowDesk Air is pressure evidence, not AIR Core authority. This request
may inform v0.18+ planning, but it must not add public ABI now.

## Request: FlowDesk Air pressure evidence

Status: proposed
Decision: proposed / pressure evidence only; no v0.17 implementation
Source demo/project: FlowDesk Air / Chrome Extension product pressure
Target layer: docs / examples / reusable kit / manifest schema / host implementation
Version target: v0.17 pressure evidence; v0.18+ RFC candidates

## Problem

FlowDesk Air needs deterministic policy, scoring, timer, and focus decisions
over browser-owned task state. The current scalar boundary works for small
decisions, but structured task/status/link/note facts become awkward when every
fact must be passed as a separate `i32`/`bool` parameter.

AIR owns:

- deterministic scalar logic;
- timer policy;
- priority scoring;
- AI budget caps;
- focus decisions;
- bounded policy decisions;
- future bounded UI/output command intent emission, if accepted by RFC.

TypeScript / host owns:

- Chrome MV3 APIs;
- service worker, popup, and content scripts;
- Dexie / IndexedDB;
- React / DOM;
- Jira / fetch;
- encryption and secret vaults;
- JSON parsing;
- backup import/export;
- external API access;
- raw browser permissions.

Current boundary: AIR modules use only `i32`/`bool` exported parameters. The host
converts strings, dates, URLs, object graphs, and browser state into minimized
scalar facts.

Main pressure: structured bounded data is the main blocker. FlowDesk needs
efficient ways to pass bounded task/status/link/note summaries into AIR without
dozens of scalar call parameters.

Do not solve this with:

- dynamic maps;
- arbitrary JSON objects inside AIR;
- reflection;
- host object handles;
- runtime imports;
- JS promises;
- async/await;
- raw browser APIs.

Preferred future direction:

- bounded fact snapshots;
- static schemas;
- tablegroups as RFC;
- fixed-size scalar tables;
- generated handles;
- package-checked data contracts;
- bounded output command buffers.

## Current Workaround

The TypeScript/Chrome Extension host owns all rich state and platform
authority. It converts strings, dates, URLs, Jira objects, IndexedDB records,
and browser state into minimized scalar facts before calling AIR exports.

This keeps authority out of AIR, but it does not scale well for richer bounded
fact snapshots.

## Why Generic

The pressure is not Chrome-specific. Many non-game AIR consumers need bounded,
reviewable facts and bounded output command intent:

- policy evaluators;
- dashboards;
- SRE and DevOps tools;
- CI gatekeepers;
- notification planners;
- local productivity tools.

The generic requirement is structured bounded data and declared output intent,
not raw browser authority.

## Scope

This request covers:

- Chrome extension host pressure;
- structured bounded host facts;
- bounded output command intents;
- async request-handle pressure;
- privacy/security boundaries;
- possible example/kit path before Host ABI promotion.

## Non-goals

This request explicitly rejects:

- raw `chrome.*` access from AIR;
- DOM/React authority;
- IndexedDB/Dexie authority;
- arbitrary fetch/Jira access;
- encryption keys in AIR;
- arbitrary JSON object model inside AIR;
- dynamic maps;
- GC;
- reflection;
- host object handles;
- JS promises / async-await in AIR;
- extension-specific Core semantics;
- public Host ABI promotion before example/kit evidence.

## Current Boundary

AIR is responsible for deterministic scalar logic and bounded policy decisions.
The browser/platform host owns all Chrome extension authority and rich
application state.

Current AIR modules should use only scalar boundaries such as `i32` and `bool`.
The host converts rich objects into minimized scalar facts before calling AIR.
Examples of host-owned conversion inputs include:

- task titles and notes;
- dates and durations;
- URLs and tab state;
- Jira issue objects;
- IndexedDB records;
- browser permissions and extension state.

AIR reports must avoid private task text, raw URLs, tokens, and notes unless
explicitly allowed by host policy.

## Structured Data Pressure

Dozens of scalar parameters do not scale for task and policy scoring. They make
generated AIR harder to review, make call sites brittle, and encourage hidden
host-side source-of-truth transformations.

Required future exploration:

- bounded fact snapshots;
- static schemas;
- fixed table inputs;
- tablegroups as RFC;
- generated handles;
- package-checked schema contracts.

Dynamic JSON/maps are rejected for Core. The pressure is for bounded,
deterministic, package-checked data contracts, not arbitrary object authority.

## Chrome Extension Host Profile Candidate

A future host profile may describe support levels for:

- MV3 service worker;
- popup;
- content script;
- storage;
- context menus;
- active tab;
- scripting;
- alarms;
- notifications.

This must be a host profile/RFC, not Core semantics. The profile should describe
host support and constraints; it must not expose raw `chrome.*` authority to AIR.

## Narrow Command/Fact ABI Candidates

Do not expose raw `chrome.*` authority.

Possible future command/fact shapes:

- `extension.badge_set`;
- `extension.context_action`;
- `extension.capture_active_page_fact`;
- `extension.storage_policy`;
- `extension.notification_request`;
- `extension.alarm_policy`.

These are examples only, not accepted Host ABI. Any future shape must be
capability-gated, profile-gated, report-visible, conformance-testable, and
generalized beyond FlowDesk Air.

## Async Request-Handle Pressure

Async browser APIs create request-handle pressure. AIR should not adopt JS
promises, callbacks, or async/await.

Future work should align with bounded polling concepts such as
`io.poll_bounded`: AIR can reason about bounded request state, while the host
owns browser API scheduling, permissions, retries, and platform errors.

## Example/Kit Before ABI Promotion

Possible future locations:

- `examples/chrome_extension_policy`;
- `kits/extension-basic`.

Promotion rule: do not promote to public Host ABI until at least one more
independent non-FlowDesk use case proves the same shape.

An example or kit may demonstrate host-owned Chrome authority and AIR-owned
bounded policy logic without creating public Host ABI.

## Security / Privacy Pressure

AIR should receive minimized scalar facts, not raw private data.

Host owns:

- encryption;
- secret vaults;
- tokens;
- external credentials;
- raw notes/task text;
- URLs;
- browser permissions.

AIR reports must avoid leaking sensitive task text, URLs, tokens, or private
notes unless explicitly allowed by host policy.

## Performance Expectation

Tiny scalar calls may be slower than TypeScript due to JS/Wasm boundary
crossings.

The value is not raw speed yet.

The value is:

- reviewability;
- deterministic reports;
- capability discipline;
- policy visibility;
- AI-generated module repair;
- future batch scoring once AIR has better structured data ergonomics.

## Classification

Classify this request as:

- pressure evidence now;
- possible example/kit later;
- possible structured data RFC;
- possible Chrome extension host profile RFC;
- no ABI bump now.

## ABI Policy

This request does not require an AIR ABI bump now.

This request does not require a Host ABI bump now.

Future Host ABI bump may be considered only if a narrow extension command/fact
ABI is accepted.

Future AIR ABI bump may be considered only if structured data contracts change
executable package/runtime representation.

## Verifier impact

No verifier change is requested now.

Future RFCs may need verifier-visible static schemas, bounded fact snapshots,
fixed table inputs, tablegroups, generated handles, or bounded output command
buffers. Those must be reviewed separately.

## Host ABI registry impact

No Host ABI registry change is requested now.

No `chrome.*`, `extension.*`, `output.emit`, `output.event`, `audio.event`, or
browser permission import is accepted by this request.

Future Host ABI work requires separate RFC/spec/profile/tests and independent
non-FlowDesk evidence.

## Manifest / package impact

No package manifest change is requested now.

Future RFCs may explore package-checked structured fact contracts,
Chrome-extension host profile metadata, generated handles, and bounded command
intent manifests.

## Conformance tests

No conformance fixture is added now.

Future RFCs should include fixtures that prove:

- AIR receives minimized scalar facts, not raw private objects;
- host profile unsupported paths fail deterministically;
- bounded output command intents are visible in reports if accepted;
- private text, URLs, tokens, and notes do not leak into reports by default.

## Alternatives

Alternatives rejected for Core:

- arbitrary JSON object model in AIR;
- raw browser APIs;
- host object handles;
- dynamic maps;
- JS promises or async/await;
- TypeScript-only hidden policy authority for decisions that should be
  reviewable.

## Acceptance criteria

This request is accepted only as pressure evidence when:

- it is linked from ABI request indexes;
- it does not add compiler, stdlib, Host ABI, or AIR ABI changes;
- it does not add Chrome extension APIs;
- it keeps FlowDesk Air as evidence, not Core authority.

## Acceptance for This Document

- `docs/abi-requests/flowdesk-air.md` exists.
- No `src/` changes.
- No stdlib changes.
- No spec/Host ABI changes.
- No new public ABI.
- No demo/example implementation.
- Markdown links pass.
