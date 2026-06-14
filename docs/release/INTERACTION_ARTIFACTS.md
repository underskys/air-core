# AIR Interaction Artifacts

Status: active release policy

AIR release work uses explicit artifacts so pressure, decisions, QA, and release
authority stay separate.

Templates live in [artifact_templates](artifact_templates/README.md).

## PRESSURE_REQUEST.md

Purpose: capture demo, dev, consumer, or host pressure without turning it into
Core semantics.

Owner: requester or Dev Codex.

Created when: a demo, private branch, QA review, or external consumer need asks
for Core, stdlib, Host ABI, manifest, kit, or docs changes.

Required fields:

- title;
- source repo/branch/commit/path;
- bundle kind;
- problem;
- requested capability;
- target layer;
- routing decision;
- rationale;
- alternatives;
- AIR ABI impact;
- Host ABI impact;
- release impact.

Acceptance criteria: request is routed to the correct layer and does not claim
release authority by itself.

## ARCHITECTURE_DECISION.md

Purpose: record accepted or rejected design boundaries.

Owner: Architecture GPT with human maintainer review when needed.

Created when: a request could affect Core behavior, ABI, package semantics,
host boundary, verifier policy, or release architecture.

Required fields:

- title;
- status;
- context;
- decision;
- AIR/Host/Demo ownership boundaries;
- rejected scope;
- compatibility impact;
- evidence required;
- follow-up.

Acceptance criteria: accepted and rejected scope are explicit, and ABI impact is
named.

## CHANGESET_SUMMARY.md

Purpose: summarize a public-clean diff before review or merge.

Owner: Dev Codex.

Created when: a diff is promoted into `air-core`.

Required fields:

- summary;
- source repo/branch/commit;
- transfer method;
- files changed;
- public-clean review;
- AIR ABI status;
- Host ABI status;
- package surface impact;
- related artifacts.

Acceptance criteria: reviewer can see what changed, what was excluded, and
whether package contents changed.

## QA_REPORT.md

Purpose: record checks, artifacts, failures, skipped areas, and residual risk.

Owner: Claude QA or release reviewer.

Created when: a merge candidate, release candidate, demo pressure bundle, or
public-clean transfer needs independent review.

Required fields:

- scope;
- environment;
- exact checks run;
- package surface summary;
- release lane summary;
- findings;
- residual risk;
- decision recommendation.

Acceptance criteria: every skipped check or residual risk is explicit.

## RELEASE_DECISION.md

Purpose: record merge, tag, publish, or block decision.

Owner: Release Manager, with human maintainer authority for tag/publish.

Created when: a release candidate, protected merge, tag, or npm publish is
under consideration.

Required fields:

- public version;
- internal slice;
- repo;
- branch;
- commit;
- bundle kind;
- decision;
- gates;
- AIR ABI status;
- Host ABI status;
- npm package/version/dist-tag;
- publish status;
- blockers;
- release manager.

Acceptance criteria: decision is `merge`, `tag`, `publish`, or `block`; all
gates are named; npm publish is explicitly yes/no.
