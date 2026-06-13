# AIR Core RC Review Bundle Policy

The Core RC review bundle is a review artifact, not the primary execution
environment for release checks.

Full release checks run first in the real source checkout. The generated
`REVIEW_RESULTS/` directory is then included in the Core review bundle so a
reviewer can inspect what was run, what passed, what failed, and what was
skipped.

## Source Checkout Is Authoritative

Run the RC gate from a normal checkout with dependencies and local toolchains:

```sh
bash scripts/run_rc_checks.sh
```

`scripts/check_review_bundle.js` is also a source-checkout structural gate. It
creates a new bundle from the current source tree and verifies that required
files are present in the archive. It is not intended to be run from inside an
already unpacked review bundle.

The script writes:

- `REVIEW_RESULTS/SUMMARY.md`
- `REVIEW_RESULTS/CHECKS.json`
- `REVIEW_RESULTS/RED_FLAGS.md`
- `REVIEW_RESULTS/COMMANDS.log`

`CHECKS.json` records each check name, command, status, duration when
available, skip reason when applicable, and log location or excerpt.

## Bundle Role

After RC checks complete, create the Core review bundle:

```sh
bash scripts/make_review_bundle.sh
```

The bundle must include `REVIEW_RESULTS/` when it is used for Core RC review.
If `REVIEW_RESULTS/` is missing, bundle generation warns and writes
`REVIEW_RESULTS_MISSING.md` into the archive.

The bundle still carries lightweight structural sanity material:

- included/omitted file reports;
- placeholder reports;
- snapshot status and diff files;
- bundle review notes.

It does not rerun full CI inside the archive.

Review archives may not be full git checkouts. Source-checkout RC checks remain
strict and should be run with:

```sh
npm test
bash scripts/run_rc_checks.sh
```

After unpacking a review archive, use the bundle-safe test mode:

```sh
npm ci
npm run test:bundle
```

`npm run test:bundle` runs meaningful compiler, manifest, report, and package
tests while avoiding failures that only come from missing `.git` metadata or
source-checkout review-bundle generation. It is not a replacement for
source-checkout RC checks.

Core package/profile tests use tiny deterministic fixtures under
`test/fixtures/assets_minimal/` and `test/fixtures/package_minimal/`. Those
fixtures are intentionally kept in the review bundle even when large media,
models, and demo build outputs are stripped. Missing demo media should be
reported as demo migration evidence, not as a Core fixture failure.

v0.29 benchmark descriptors under `benchmarks/*/README.md` and
`benchmarks/*/benchmark.json` are also included. They are small deterministic
review inputs for performance baseline evidence. Benchmark runtime outputs,
logs, dependency folders, generated artifacts, and large assets remain excluded.

v0.32 AI authoring replay fixtures under `evals/ai_authoring/` are included
because replay mode is a deterministic review surface. Included files are
limited to prompts, captured model outputs, captured repair transcripts,
expected constraints, and the reports README. They must not contain API keys,
tokens, secrets, raw private URLs, absolute local paths, timestamps, large logs,
or live model API payloads.

Evidence report golden fixtures under `test/fixtures/evidence_report/` are
included because human-readable evidence reports are an AIR review product
surface. Golden Markdown and JSON fixtures must remain deterministic and free of
raw private payloads, tokens, secrets, timestamps, absolute paths, raw state
values, and helper return dumps.

Do not claim source-checkout `npm test` passes from an unpacked review bundle
unless the bundle has actually been unpacked, `npm ci` has been run there, and
`npm test` has completed successfully in that unpacked directory.
Source-checkout RC results remain the release authority; bundle-local validation
should be reported as `npm run test:bundle`.

## Demo Boundary

Demo projects are evidence and pressure tests. They are not standalone Core
release gates.

The Core review bundle may include demo README files, request files, canonical
AIR modules, and active manifests needed by Core checks. It excludes heavy demo
media/assets, demo build output, dependency directories, and archived asset
dumps by default.

Full demo builds happen in their own project checkouts or adjacent AIR Core
checkout environments. Demo-generated requests continue to flow through
[abi-requests.md](abi-requests.md) and the canonical
[ABI request pipeline](abi-requests/README.md).

## Host Checks

Host checks are split by reliability:

- CI-safe checks such as WebGPU host `npm ci`, `typecheck`, and `build` are
  recorded by `scripts/run_rc_checks.sh` when the host package is present.
- Browser/GPU smoke checks are recorded as skipped when local browser or GPU
  support is unavailable. A skip with a clear reason is not a pass.

## Non-Goals

The RC review bundle does not:

- include `node_modules`;
- include heavy demo media/assets in the Core bundle;
- replace CI or source-checkout release validation;
- implement target packaging;
- add a package registry;
- add public Host ABI or AIR Core syntax.
