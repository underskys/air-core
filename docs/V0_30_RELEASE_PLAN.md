# AIR v0.30 Release Plan

Status: RC hardening milestone

Theme: Evidence Review Surface

v0.30 makes AIR's proof layer more human-usable. The first implemented slices
cover package diff JSON, deterministic Markdown evidence reports, replay
summaries, host policy summaries, diagnostics grouping, and privacy-safe review
wording. AIR source remains optimized for AI generation, verification, and
deterministic lowering. Humans should approve intent and evidence through
reports, diffs, replay summaries, and anti-slop diagnostics rather than reading
raw `i32` SSA.

v0.30 is now in hardening/stabilization. The evidence review first slices are
implemented; the remaining work is to keep their outputs deterministic,
privacy-safe, review-bundle visible, and ABI-neutral.

This milestone does not change AIR ABI, change Host ABI, add Host ABI features,
add language features, implement structured data/tablegroups, touch demos, or
make performance claims.

AIR ABI latest remains `0.10`.

Host ABI latest remains `0.11`, limited to bounded `output.emit`; Host ABI
`0.10` remains the default/baseline compatibility target.

## P0 Scope

| Area | Goal | Acceptance |
| --- | --- | --- |
| Human-readable decision/evidence report | Summarize package intent and proof evidence for review. | Active first slice through `airc evidence report <dir> --format markdown -o <file>`; report names package status, required ABIs, capabilities, effects, diagnostics, evidence inputs, replay/conformance status, and red flags without raw private payloads. |
| Package diff | Make package changes reviewable between two revisions or evidence snapshots. | Active first slice through `airc diff package <old-dir> <new-dir> --json`; diff covers capability delta, effect delta, Host ABI requirement delta, output contract delta, fact/rowset schema delta, command buffer metadata delta, and generated artifact freshness delta. |
| Replay summary | Explain deterministic replay results without exposing private data. | Active first slice inside evidence reports when `--conformance <json>` is provided; summary states fixture identity, pass/fail, checksum, expected/observed counts, output IDs, state digest status, host interaction evidence status, and mismatches. |
| Host policy result summary | Surface host policy decisions as review evidence. | Summary covers allowed, denied, unknown output, and unsupported profile outcomes. |
| Machine-readable diagnostics consistency | Keep JSON diagnostics stable and specific. | Stable codes and fields remain consistent; specific diagnostics are not collapsed into generic package-check failures where specific diagnostics exist. |
| Privacy-safe human reports | Prevent evidence review from becoming a payload leak. | Human reports avoid raw private payloads, raw URLs, secrets, tokens, and private text. |
| Claim discipline | Keep evidence reports separate from performance marketing. | No new performance claims and no `x50`/`x200` claims. |

## P1 / If Scope Allows

- minimal HTML or Markdown evidence viewer;
- diff pretty-printer;
- AI repair prompt export;
- evidence snapshot comparison across commits.

## RC Hardening Checklist

- evidence report golden fixture;
- package diff golden fixture;
- replay summary fixture;
- host policy result summary fixture;
- privacy/redaction tests;
- no absolute paths or timestamps in generated review surfaces;
- no raw private payloads, raw URLs, secrets, tokens, private text, raw state
  values, or helper return dumps;
- no unsupported performance claims;
- no structured IO, tablegroups, new Host ABI features, or language features;
- final review bundle with `RED_FLAGS` none.

## Deferred

- structured IO implementation;
- tablegroups;
- LSP code actions;
- real host adapters;
- new Host ABI;
- performance dashboard.

## Review Surface Principles

- AIR source is not the primary human review surface.
- Human review should focus on intent, required authority, verifier evidence,
  diagnostics, deterministic replay, host policy result, and deltas from the
  previous approved package.
- Machine-readable JSON remains the source of truth for automated tooling.
- Human-readable reports must be derived from stable evidence and diagnostics,
  not a parallel proof engine.
- Reports must be privacy-minimized by default.

## Evidence Report First Slice

The first human-readable report command is:

```sh
node bin/airc.js evidence report <package-dir> --format markdown -o <file>
```

Optional evidence inputs:

```sh
--host-evidence <host-interaction-evidence.json>
--conformance <conformance-report.json>
--benchmark <benchmark-report.json>
--profile <profile-id>
```

The report summarizes:

- package name and package ID;
- verification status;
- AIR ABI and required Host ABI;
- package hash;
- capabilities and host imports used;
- effect usage summary;
- output contracts, command buffers, and `output.emit` usage;
- host policy result when host interaction evidence is provided;
- replay/conformance summary when a conformance report is provided;
- diagnostics grouped by severity;
- generated artifact freshness;
- benchmark summary when a benchmark report is provided.

Denied host policy decisions remain distinct from verifier failure: a package
may verify while host policy denies an output intent.

Replay summaries are derived from existing conformance report JSON. They do not
introduce new conformance semantics and do not expose raw fixture rows, command
arguments, or state digest helper return values.

## Required Diff Categories

The first review-surface design must account for:

- capability delta;
- effect delta;
- Host ABI requirement delta;
- output contract delta;
- fact schema and bounded rowset schema delta;
- command buffer metadata delta;
- generated artifact freshness delta;
- diagnostic code delta where useful.

## Package Diff First Slice

The first package diff command is:

```sh
node bin/airc.js diff package <old-package-dir> <new-package-dir> --json
```

It emits `kind: "air.packageDiff"` with deterministic JSON fields for:

- package hashes;
- AIR ABI and Host ABI required-by-package deltas;
- capability and effect deltas;
- output contract deltas;
- fact schema and bounded rowset schema deltas;
- command buffer metadata deltas;
- generated artifact freshness deltas;
- diagnostics and limitations.

The first slice compares package metadata, package reports, schema
fingerprints, and generated artifact metadata. It does not include raw private
payloads and does not create a second verifier or diagnostics engine.

## ABI Policy

AIR ABI latest remains `0.10`.

Host ABI latest remains `0.11`; Host ABI default/baseline remains `0.10`.
v0.30 does not add host imports, output events, payloads, dynamic output ids, or
platform authority.

## Representative Checks

```sh
node scripts/check_markdown_links.js
git diff --check
```
