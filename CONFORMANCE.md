# Conformance

AIR Core includes a reference verifier and a repository conformance/test suite.

## Public Repo Checks

The public repository supports:

```sh
npm test
npm run test:bundle
node scripts/check_markdown_links.js
```

Additional milestone and review checks are available through package scripts
such as `check:api-gates:*`, `check:consumer-evidence`, and `rc:check`.

The current public-alpha reproduction checkpoint is recorded in
[Conformance Reproduction Summary](docs/public_release/CONFORMANCE_REPRODUCTION_SUMMARY.md).

## What Conformance Covers

The suite covers supported parser, formatter, verifier, lowering, package,
Host ABI, evidence, conformance replay, benchmark, reviewPolicy, and negative
fixture behavior.

Conformance is scoped to this implementation and its documented fixtures. It is
not a statement that every AIR-like implementation is compatible unless it
passes the same public fixtures and expected diagnostics.

## Core Conformance vs Consumer Evidence

Core conformance defines AIR behavior through the reference verifier, CLI,
specs, package checks, and conformance fixtures. These are the surfaces that can
block an AIR Core release.

`consumer_evidence/`, downstream demo summaries, and consumer proof cards
record pressure from real domains. They are useful intake for future RFCs and
review, but they do not define AIR Core semantics, AIR ABI, Host ABI, package
semantics, or host authority.

If consumer pressure needs Core behavior, it must be routed through an accepted
RFC, API gate, conformance fixture, and release plan before it becomes part of
Core.

## air-tests

Independent `air-tests` evidence can be useful for launch review, especially
for anti-hallucination and bounded execution pressure. At this point, a
standalone `74/74` air-tests result is not claimed in public docs unless the
exact suite is available and reproducible from the public repository.

Status for public alpha: independent `air-tests` public reproduction is pending
unless a clean public copy, submodule, or script is added and documented. The
current repository checkpoint does not reproduce `74/74`; launch copy must not
claim that result from this public repo.

## Reporting

When publishing conformance results, include:

- repository commit;
- command list;
- platform/tool versions when relevant;
- pass/fail counts;
- skipped/manual checks;
- any known limitations.
