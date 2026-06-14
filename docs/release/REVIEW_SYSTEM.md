# AIR Release Review System

Status: active release policy

This document defines the AIR release/review governance system. It separates
public release work, private development, demo pressure, QA review, and review
bundles so they cannot accidentally become npm package contents or release
authority.

This process does not change AIR ABI, Host ABI, compiler behavior, verifier
behavior, lowerer behavior, or language features.

## Participants

| Participant | Responsibilities | May modify | Must not modify |
| --- | --- | --- | --- |
| Release Manager | Owns release lane, OK/STOP reports, release decisions, npm/tag readiness, public package surface, and final merge/publish gates. | Release docs, changelog, version docs, CI release hygiene, package metadata after review, release decision artifacts. | Compiler/verifier/lowerer semantics, AIR ABI, Host ABI, demo code, private artifacts, npm tokens. |
| Dev Codex | Implements scoped public-safe diffs in `air-core` after task approval. Produces checks and changeset summaries. | Code/docs/tests/scripts inside the approved scope. | Publish jobs, tags, private `airlang` mutation, wholesale dev copies, ABI changes unless explicitly requested and gated. |
| Claude QA | Performs independent QA review, checks claims, examines artifacts, and reports blockers. | QA reports and review comments. | Source behavior, release tags, npm publish, package identity. |
| Architecture GPT | Reviews architecture boundaries, ABI implications, request routing, and layer ownership. | Architecture decision artifacts, design notes, request recommendations. | Release authority, source changes without explicit task scope, publish/tag operations. |
| Human maintainer | Owns final authority for protected merges, tags, npm publishing, and external communication. | Any repository area according to maintainer policy. | Manual tag/publish without green gates and an explicit release decision. |

## OK/STOP Reports

Before protected merge, tag, npm publish, or release-candidate handoff, the
Release Manager must produce an OK/STOP report.

An OK report requires:

- current repo is `air-core`;
- current branch is a release-allowed lane;
- working tree is clean;
- package identity is `@underskys/air-core`;
- CLI is `airc`;
- release checks are green;
- public package surface excludes forbidden artifacts;
- AIR ABI and Host ABI status are explicit;
- no private/dev/demo artifacts are in the release diff.

A STOP report is required if any gate fails, if repository state is ambiguous,
or if a change touches compiler/verifier/lowerer semantics, AIR ABI, Host ABI,
publish automation, package identity, or private/public boundaries without an
explicit maintainer decision.

## Tag and Publish Rule

No manual tag or npm publish may happen without green gates, a release decision
artifact, and explicit human maintainer authorization.

Codex must not publish npm, create tags, ask for tokens, print tokens, or run
publish jobs unless explicitly instructed in a protected release context.

