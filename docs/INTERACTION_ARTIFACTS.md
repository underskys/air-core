# AIR Interaction Artifacts

Status: active process mapping

AIR already has request intake, release plans, review results, and review
bundle metadata. This document maps common interaction artifact names onto
those existing systems. It does not create a new intake directory or a second
bundle system.

## `PRESSURE_REQUEST`

Store as `requests/inbox/*.md`.

Validation: `scripts/check_request_ledger.js`.

This is not a separate directory. Demo, consumer, private-dev, and host pressure
must enter the existing request ledger or be explicitly rejected, archived, or
marked as no active pressure.

## `ARCHITECTURE_DECISION`

Store as an RFC, an accepted/rejected request decision, or a public-safe section
in the relevant release plan.

It must cite the request id/path that caused the decision. Gated architecture
work follows [ARCHITECTURE_GATES.md](ARCHITECTURE_GATES.md).

## `CHANGESET_SUMMARY`

Store in the release plan, merge request description, or pull-request
description.

It should summarize what changed, what did not change, what stayed outside
Core, and whether AIR ABI, Host ABI, package contents, or public docs changed.

## `QA_REPORT`

Store in `REVIEW_RESULTS/` or public-safe review notes.

Private QA notes stay in `airlang` or another private location. Do not copy raw
private QA notes, local paths, transcripts, review zips, or snapshots into the
public repository.

## `RELEASE_DECISION`

Store in the release checklist, release notes, or tag/publish decision record.

It must include an explicit OK/STOP result and the checks used to reach that
decision.

## `BUNDLE_MANIFEST`

Embed in the existing review bundle metadata when supported.

Do not create a second bundle system. Review bundles remain artifacts; npm
package contents remain governed by `package.json` `files` and
`scripts/check_public_package_surface.js`.

