# AIR Release Review Protocol

Status: active policy

AIR release decisions are artifact-based. Chat memory, ad hoc summaries, demo
readmes, and private repository state are not release authority.

This protocol does not change AIR ABI, Host ABI, compiler behavior, verifier
behavior, or language semantics.

## Source Roles

- `air-core` is the production/public release source.
- `airlang` is private/dev/reference/experimentation source.
- demos are consumer pressure, not release source.

The public repository is not a dump of the private repository. Dev/private work
must be converted into public-clean diffs before it can enter `air-core`.

## Roles

Release manager:

- owns release lane status, OK/STOP reports, release gates, tag readiness,
  publish readiness, and package surface decisions;
- must block merge/tag/publish if required artifacts or gates are missing.

Architecture reviewer:

- reviews Core, stdlib, Host ABI, package, verifier, and host-boundary impact;
- owns `ARCHITECTURE_DECISION.md` for accepted or rejected design decisions.

QA reviewer:

- records checks, failures, skipped checks, residual risk, and package surface
  findings in `QA_REPORT.md`;
- does not define release authority by itself.

Demo/consumer pressure owner:

- records pressure in `PRESSURE_REQUEST.md` or the request ledger;
- must not treat demo behavior as Core semantics or Host ABI authority.

## Artifact Flow

1. Pressure or change is captured in `PRESSURE_REQUEST.md` when it originates
   from demos, private/dev work, or consumers.
2. Architecture decision records accepted/rejected scope when Core, stdlib,
   Host ABI, package semantics, verifier policy, or release architecture may be
   affected.
3. Public-clean diff is summarized in `CHANGESET_SUMMARY.md`.
4. QA results are recorded in `QA_REPORT.md`.
5. Release manager records merge/tag/publish/block decision in
   `RELEASE_DECISION.md`.
6. Bundle identity and release allowance are recorded in `BUNDLE_MANIFEST.json`.

No release decision may be chat-memory-only.

## Public Package Boundary

Review bundles are artifacts, never npm package contents.

Forbidden npm contents include private prompts, review zips, raw review bundles,
snapshots, raw chat transcripts, `REVIEW_RESULTS/`, `MOBILE_SUMMARY.md`,
`REVIEW_REQUEST.md`, staging exports, demo build outputs, and private/internal
artifacts.

Package contents are allowlisted and checked by
`scripts/check_public_package_surface.js`.

## Promotion Rule

Dev work may not be copied wholesale into `air-core`.

Allowed promotion:

- public-clean cherry-pick;
- small reimplementation in `air-core`;
- sanitized docs-only promotion;
- request-ledger or RFC-driven implementation.

Forbidden promotion:

- copying private directories;
- copying raw prompts or review artifacts;
- copying snapshots or generated archives;
- importing demo build outputs;
- accepting demo-specific semantics into Core without generic request review.
