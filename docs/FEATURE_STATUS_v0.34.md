# AIR v0.34 Feature Status

Status: RC hardening milestone

Version target: v0.34

v0.34 focuses on documentation, agent context, and workflow automation hygiene.
It prepares AIR Core for the next read-only consumer proof by reducing active
context noise and making the review workflow more repeatable.

No v0.34 work may change compiler semantics, AIR ABI, Host ABI, language
features, demos, or start the lan-observer proof unless a later task explicitly
changes scope.

AIR ABI latest remains `0.10`. Host ABI latest remains `0.11`, limited to the
bounded `output.emit` first slice. Host ABI `0.10` remains the default/baseline
compatibility target for packages that do not use `output.emit`.

Related documents:

- [AIR v0.34 Release Plan](V0_34_RELEASE_PLAN.md)
- [Agent Workflow Automation RFC](rfcs/v0.34-agent-workflow-automation.md)
- [README and Demo Hygiene RFC](rfcs/v0.34-readme-and-demo-hygiene.md)
- [AIR Strategy](AIR_STRATEGY.md)
- [Architecture Gates](ARCHITECTURE_GATES.md)
- [Version and ABI Policy](VERSION_AND_ABI_POLICY.md)

## Status Values

- `stable/active`: inherited behavior from earlier milestones.
- `implemented/P0`: completed v0.34 P0 scope.
- `planned/P0`: accepted v0.34 P0 scope, not implemented yet.
- `planned/P1`: accepted lower-priority v0.34 scope.
- `deferred`: future work outside v0.34.
- `rejected`: not allowed without separate accepted scope.

## Stable / Active Baseline

| Feature | Layer | v0.34 status |
| --- | --- | --- |
| AIR ABI `0.10` | ABI | Stable/active. |
| Host ABI `0.10` | ABI | Stable/active and still supported. |
| Host ABI `0.11` bounded `output.emit` | Host ABI/package/runtime | Stable bounded first slice only. No expansion accepted for v0.34. |
| v0.33 AI eval and verifier safety surfaces | tooling/evidence/tests | Stable/active from v0.33. |
| Core review bundle workflow | tooling/process | Stable/active from earlier milestones; targeted for hygiene automation in v0.34. |

## v0.34 P0

| Feature | Layer | v0.34 status |
| --- | --- | --- |
| Slim README | docs | Implemented/P0. README is now a short thesis, quickstart, safety, version, example, and links entrypoint. |
| Move milestone history to changelog or release index | docs | Implemented/P0. Milestone history lives in [CHANGELOG.md](../CHANGELOG.md). |
| Examples/demos/snapshots classification | docs/process | Implemented/P0. See [Examples, Demos, and Snapshots](EXAMPLES_AND_DEMOS.md). |
| Agent finish script | tooling/process | Implemented/P0. Performs preflight, full checks, review bundle, `MOBILE_SUMMARY.md`, and `REVIEW_REQUEST.md`. |
| `npm run agent:finish` | tooling/process | Implemented/P0. |
| Review bundle includes mobile and review summaries | tooling/review | Implemented/P0. |
| AIR strategy docs remain linked | docs | Implemented/P0. README and docs index link AIR strategy, architecture gates, version/ABI policy, and workflow docs. |

## v0.34 P1

| Feature | Layer | v0.34 status |
| --- | --- | --- |
| GitLab CI artifact plan for review bundles | docs/CI | Planned/P1. |
| Claude/GPT review prompt templates | docs/tooling | Planned/P1. |
| Merge request summary generation | tooling/process | Planned/P1. |
| Docs index cleanup | docs | Planned/P1. |

## Deferred / Rejected

| Feature | v0.34 status |
| --- | --- |
| Repo directory restructuring | Deferred. |
| Deleting old docs | Deferred. |
| Moving demos | Deferred. |
| CI enforcement | Deferred. |
| lan-observer proof | Deferred. |
| New language features | Rejected for v0.34. |
| Compiler semantic changes | Rejected for v0.34. |
| AIR ABI change | Rejected for v0.34. |
| Host ABI change | Rejected for v0.34. |
| Demo changes | Rejected for v0.34. |

## Version Semantics

- Project milestone: `v0.34`.
- AIR ABI latest: remains `0.10`.
- Host ABI latest: remains `0.11`.
- Host ABI default/baseline: remains `0.10`.
- Host ABI `0.11` support remains limited to bounded `output.emit` packages.
- Host ABI expansion in v0.34: none.
- AIR ABI change in v0.34: none.
