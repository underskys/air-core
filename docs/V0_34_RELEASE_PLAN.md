# AIR v0.34 Release Plan

Status: RC hardening milestone

Theme: Documentation, Agent Context, and Workflow Automation Hygiene

v0.34 prepares AIR Core for the next real read-only consumer proof by reducing
agent-context noise and making the review workflow easier to complete
consistently.

This milestone is documentation and workflow hygiene. Its P0 implementation is
mostly complete: README context is slimmed, milestone history lives in
`CHANGELOG.md`, examples/demos/snapshots are classified, `agent:finish` exists,
and review bundles include mobile/review summaries.

v0.34 does not change compiler semantics, AIR ABI, Host ABI, language syntax,
structured IO behavior, output emit behavior, package semantics, demos, or
consumer proof behavior. The lan-observer-style read-only proof remains
deferred to v0.35.

AIR ABI latest remains `0.10`.

Host ABI latest remains `0.11`, limited to bounded `output.emit`; Host ABI
`0.10` remains the default/baseline compatibility target for packages that do
not use `output.emit`.

## Purpose

AIR has accumulated many useful milestone documents, review artifacts, demos,
examples, and agent-facing process rules. That history is now useful but noisy
for agents and human reviewers.

Before starting the read-only consumer proof, v0.34 should make the active
context small, explicit, and automatable:

- the README should explain current AIR quickly instead of carrying every
  milestone detail;
- old milestone history should move to a changelog or release index;
- examples, demos, snapshots, fixtures, and generated artifacts should have
  explicit review-bundle routing;
- the common finish workflow should be scriptable and deterministic;
- review artifacts should include short mobile-readable and reviewer-ready
  summaries.

## P0 Scope

1. Slim `README.md`.
2. Move milestone history to `CHANGELOG.md` or `docs/releases/`.
3. Add examples/demos/snapshots classification.
4. Add an agent finish script that performs:
   - preflight git checks;
   - full check set;
   - review bundle generation;
   - `MOBILE_SUMMARY.md` generation;
   - `REVIEW_REQUEST.md` generation.
5. Add npm script:

```sh
npm run agent:finish
```

6. Ensure review bundles include `MOBILE_SUMMARY.md` and
   `REVIEW_REQUEST.md`.
7. Keep AIR strategy docs linked from active guidance.

## P1 Scope

- GitLab CI artifact plan for review bundles.
- Auto-generated Claude/GPT review prompt templates.
- Merge request summary generation.
- Docs index cleanup.

## Deferred

- repo directory restructuring;
- deleting old docs;
- moving demos;
- CI enforcement;
- lan-observer proof;
- new language features.

## Hard Constraints

- Do not change compiler semantics.
- Do not change AIR ABI.
- Do not change Host ABI.
- Do not add language features.
- Do not touch demos.
- Do not start lan-observer proof in v0.34 planning.
- Do not remove old docs as part of planning.
- Do not make review bundle dirty-state behavior weaker for Core.

## RFCs

- [Agent Workflow Automation RFC](rfcs/v0.34-agent-workflow-automation.md)
- [README and Demo Hygiene RFC](rfcs/v0.34-readme-and-demo-hygiene.md)

## Representative Checks

Planning-only changes should run:

```sh
node scripts/check_markdown_links.js
git diff --check
```

Implementation tasks later in v0.34 should run the full Core check set and the
new agent finish workflow once implemented.

## Exit Criteria

v0.34 can close when:

- active README guidance is slim and points to durable strategy docs;
- milestone history is no longer repeated in the README;
- examples/demos/snapshots have documented classification and review-bundle
  handling;
- `npm run agent:finish` exists and performs the documented workflow;
- review bundles include `MOBILE_SUMMARY.md` and `REVIEW_REQUEST.md`;
- RC checks and review bundle sanity pass with `RED_FLAGS` none.
