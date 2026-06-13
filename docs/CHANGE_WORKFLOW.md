# AIR Change Workflow

Status: active process policy

This document defines the required workflow for Codex/agent work in AIR Core.
It is process-only and does not change compiler semantics, AIR ABI, or Host ABI.

## 1. Preflight Before Every Task

Run before making changes:

```sh
git fetch origin --prune
git branch --show-current
git rev-parse --short HEAD
git status --short
node -v
npm -v
```

Rules:

- if the working tree is dirty, stop and report;
- if the branch is not the expected branch, stop and report;
- if `HEAD` is behind `origin`, use `git pull --ff-only`;
- do not work on `main` directly unless explicitly asked;
- do not force-push.

## 2. Scope Declaration

Before making changes, restate:

- branch;
- intended files/layers;
- forbidden files/layers;
- expected AIR ABI status;
- expected Host ABI status.

This is required even for small docs-only changes. It prevents accidental work
on the wrong branch or layer.

## 3. Implementation Rules

One task should map to one branch/commit scope.

Do not silently add adjacent features. If implementation appears to require an
AIR ABI or Host ABI change, stop and report before editing code, specs, tests,
or host profiles that rely on that change.

Do not treat demo pressure as Core authority. Core changes require generalized
mechanisms and must preserve AIR's verifier-first boundaries.

## 4. Checks Before Commit

Run task-appropriate checks before committing.

For Core tasks, the default full check set is:

```sh
npm test
npm run test:bundle
node scripts/check_review_bundle.js --keep
node scripts/check_markdown_links.js
node scripts/check_abi_requests.js
node test/layer_guard.test.js
git diff --check
```

If milestone API gates exist, run them:

```sh
npm run check:api-gates:v0.21
npm run check:api-gates:v0.22
```

Docs-only tasks may use a narrower check set only when the task explicitly
allows it. The final report must list exactly which checks were run.

## 5. Commit Rules

Commit only intended files.

Use a clear commit message that describes the actual scope. After commit, the
working tree must be clean.

Do not include generated review artifacts in a source commit unless the project
convention explicitly tracks them for that task.

## 6. Post-Commit Checks

Run the full check set again after commit for Core review, RC, merge, release,
or implementation tasks.

For small docs-only tasks, run at least the requested docs checks after commit
when review bundle generation is not part of the task.

## 7. Review Bundle Rules

For Core review/RC tasks, generate a review bundle at the end.

Before creating any Core review/RC bundle, run and record the branch-sync
ritual:

```sh
git fetch origin --prune
git status --short
git branch --show-current
git rev-parse HEAD
git rev-parse --abbrev-ref --symbolic-full-name @{upstream}
git log --oneline <upstream>..HEAD
git log --oneline HEAD..<upstream>
```

The review bundle script records this block in `SNAPSHOT_PREBUNDLE_GIT.txt`
using the current branch upstream, not a hardcoded milestone branch. Reviewers
can see whether local commits, missing pulls, or branch drift existed when the
bundle was created. If the branch has no upstream, the summary must say
`upstream: none`; Core RC bundles should normally be built from branches with
an upstream configured.

The bundle must be clean:

- `dirty: no`;
- `REVIEW_RESULTS` matches the current source commit;
- `RED_FLAGS` has no active flags.

The bundle secret scan fails on dangerous secret-looking values such as private
keys and common service tokens. Known scanner/policy environment variable label
names in review tooling are allowed so clean bundles do not warn every time.
Unexpected secret-like labels in other files still warn and must be reviewed.

Dirty review bundles are not allowed unless explicitly marked as dirty
planning/debug snapshots. Dirty planning/debug snapshots must not be reported as
Core RC review-ready.

If `REVIEW_RESULTS` does not match the current source commit, rerun:

```sh
bash scripts/run_rc_checks.sh
bash scripts/make_review_bundle.sh
node scripts/check_review_bundle.js --keep
```

For local interactive bundle creation, use the visible recipe wrapper:

```sh
npm run bundle:recipe
```

`bundle:recipe` is a colored progress wrapper around the canonical
`scripts/make_review_bundle.sh` builder. It streams the slow git/network
preflight, prints 0-100 percent recipe stages, writes
`snapshots/review_bundle_recipe.log`, and stops with a concrete failing stage
and next action. It does not change bundle contents or review policy.

Use this stricter variant when the branch must have an upstream configured:

```sh
npm run bundle:recipe -- --require-upstream
```

## 8. Consumer Evidence Workflow

Consumer evidence is separate from Core review bundles. Core review bundles prove
the compiler/verifier/reporting source commit. Consumer evidence bundles package
standardized downstream demo and consumer pressure descriptors.

Validate consumer evidence before bundling:

```sh
npm run check:consumer-evidence
```

Create the separate consumer evidence bundle:

```sh
npm run consumer-evidence:bundle
```

The consumer evidence bundle includes only review-safe descriptors, schemas,
proof cards, prompts, reports, replay summaries, metrics summaries, and selected
governance docs. It must not include full demo projects, large media, build
outputs, raw logs, secrets, tokens, or local absolute paths.

## 9. Agent Finish Automation

For local Codex/agent task completion, use:

```sh
npm run agent:finish
```

Use this stricter variant when the branch must have an upstream configured:

```sh
npm run agent:finish -- --require-upstream
```

## 10. AI Eval Capture Import

`eval-ai` replay remains deterministic and offline. Sanitized external model
captures can be imported from files:

```sh
node bin/airc.js eval-ai import <capture-dir> --json
```

Capture directories must contain `MANIFEST.json` plus local
`model_outputs/*.json` files, with optional `repair_transcripts/*.json` and
`constraints.json`. The importer rejects API keys, tokens, provider request ids,
account ids, provider metadata, raw private prompts, raw URLs, timestamps,
absolute paths, network logs, and secret-like content. It performs no live
provider calls, network access, automatic repair, or code actions.

Use a task-specific next action in the generated mobile summary:

```sh
npm run agent:finish -- --next-action "Send bundle for final v0.34 review."
```

`agent:finish` is the local one-command finish path. It performs git preflight,
fails on dirty Core files, fails when the branch is behind upstream, runs the
default Core check set plus every available milestone API gate, verifies
`REVIEW_RESULTS`, creates the final review bundle, and writes:

- `MOBILE_SUMMARY.md`;
- `REVIEW_REQUEST.md`;
- `CONSUMER_EVIDENCE_SUMMARY.md` when `consumer_evidence/` is present.

Those generated files are local ignored artifacts, but the review bundle
includes them so phone review and external reviewer prompts have the exact
branch, commit, check, ABI, consumer-evidence, `RED_FLAGS`, and bundle context. If
`--next-action` is omitted, `MOBILE_SUMMARY.md` uses the safe default:
`Review the bundle and confirm blockers before merge or next prompt.`

If any check fails, `agent:finish` stops at the failing command and must not be
reported as bundle-ready. It does not merge, push, auto-repair, call AI
providers, or change AIR/Host ABI.

## 10. Final Report

Every Codex task must end with:

- branch;
- commit before;
- commit after;
- dirty status;
- files changed;
- commands run with pass/fail;
- AIR ABI status;
- Host ABI status;
- review bundle path/name if generated;
- `RED_FLAGS` status;
- forbidden implementation checklist;
- remaining blockers.

For docs-only tasks, explicitly confirm docs-only scope.

## 11. Two-Machine Workflow

If using multiple machines:

- one task owner at a time per branch;
- sequential handoff only after clean commit/push;
- the next machine must fetch/pull and verify clean state before work;
- if local and remote branches diverge, compare both sides before merging;
- never discard local commits unless explicitly requested and understood.
