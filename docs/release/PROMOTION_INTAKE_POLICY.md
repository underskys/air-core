# AIR Promotion Intake Policy

Status: active release policy

This policy defines which inputs may enter public `air-core` release state from
private/dev `airlang` or adjacent review work.

## Accepted Sources

The following sources may be considered for `air-core` after release review:

- public-clean cherry-picks from `airlang`;
- manually recreated public-safe diffs;
- docs and roadmap decisions approved by release review.

Accepted sources are not automatic merges. Every promoted change must be scoped
to public release state, preserve package identity, avoid private artifacts, and
pass release checks in `air-core`.

## Rejected Sources

The following sources are rejected as direct public release inputs:

- raw review bundles;
- prompts;
- private notes;
- `consumer_evidence` unless explicitly public;
- demo build outputs;
- generated `tgz` or `zip` artifacts;
- private local paths;
- wholesale directory copy from `airlang`.

Rejected sources may inform a public-clean rewrite, RFC, request ledger entry,
or release decision, but they must not be copied directly into public release
state.

## Intake Requirements

Each accepted promotion must identify:

- source commit or source rationale;
- public files changed;
- package identity impact, if any;
- AIR ABI impact, if any;
- Host ABI impact, if any;
- checks run in `air-core`.

If the answer for package identity, AIR ABI, Host ABI, or private/public
boundary impact is unclear, stop and request release review before merge.
