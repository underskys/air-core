# Merge Request Policy

AIR uses merge requests as a shared review phase for AI-assisted work.

## Required Checks

Before merge, run the checks that match the change:

```sh
npm ci
npm test
node scripts/check_review_bundle.js
node test/layer_guard.test.js
node scripts/check_markdown_links.js
```

Full test execution from either a clean git checkout or an unpacked review
bundle requires `npm ci` first. Running `npm test` without dependencies may fail
when optional WASM emission tests cannot load the `wabt` package.

Review bundles use the single snapshot script configured in `package.json` at
`config.reviewBundle`: `scripts/make_review_bundle.sh`. Local and CI calls
should use:

```sh
npm run snapshot
node scripts/check_review_bundle.js
```

The bundle must include explicit omission reports (`EXCLUDED_FILES.txt`,
`BUNDLE_OMITTED_FILES.md`, and `BUNDLE_OMITTED_FILES.jsonl`) so reviewers can
see which files were intentionally left out. Use `STRIP_DEMOS=1` only for
review-safe slim bundles where demo source/assets are intentionally excluded.
Review bundles also include `BUNDLE_REVIEW_NOTES.md` and placeholder reports
(`BUNDLE_PLACEHOLDER_FILES.md`, `BUNDLE_PLACEHOLDER_FILES.jsonl`). By default,
omitted image assets are replaced inside the archive with tiny deterministic
light-blue placeholders at the original paths. This keeps local markdown/demo
loading checks from failing on missing files while making it explicit that the
real artwork was not included.

For AIR language, stdlib, or example changes, also verify changed modules:

```sh
node bin/airc.js verify examples/<file>.air
node bin/airc.js verify --library stdlib/<file>.air
```

For graphics/package changes, run the relevant manifest and host checks:

```sh
node bin/airc.js gfx-check <module.air> --manifest <file.airgfx.json>
node bin/airc.js app-check <module.air> --manifest <file.airgfx.json>
npm --prefix hosts/webgpu test
```

For native host changes, keep CI-safe commands separate from manual GPU/window
commands:

```sh
cargo check --manifest-path hosts/native/Cargo.toml
cargo run --manifest-path hosts/native/Cargo.toml -- gfx-stream demo/voxel-demo/public/game-metal.wasm --frames 1000,34000,38000
cargo run --manifest-path hosts/native/Cargo.toml -- conformance build/conformance/ui-tool --screenshot native-smoke.txt
```

Manual window/GPU smoke remains opt-in:

```sh
AIR_NATIVE_EXIT_MS=2500 cargo run --manifest-path hosts/native/Cargo.toml -- gfx-window demo/voxel-demo/public/game-metal.wasm
```

## Required Approval

Every merge request should receive at least one approval before merge.

The CI job `mr-approval-policy` enforces this by checking GitLab MR approvals:

- pass: the MR has at least one approval;
- pass: the MR has a `skip-approval` label;
- fail: the MR has zero approvals and no explicit skip label.

`skip-approval` is an intentional bypass for agreed urgent or solo work. It
should be visible in the MR labels so reviewers can see that the normal review
phase was skipped.

## Auto-Merge

Auto-merge can be requested by either:

- adding the `auto-merge` label to the MR; or
- setting `AIR_AUTO_MERGE=1` in the pipeline.

The `mr-auto-merge` job first runs the same approval policy. It then asks
GitLab to merge when the pipeline succeeds and remove the source branch.

## Token Requirements

The policy script uses GitLab API data. In GitLab CI it tries `CI_JOB_TOKEN`
first. If the project restricts that token from reading MR approvals or
requesting auto-merge, configure a masked variable such as `GITLAB_API_TOKEN`
with enough project permissions.

## Local Branch Workflow

Suggested push command for an AIR v0.9 branch:

```sh
git push -u origin HEAD \
  -o merge_request.create \
  -o merge_request.target=main \
  -o merge_request.remove_source_branch \
  -o merge_request.merge_when_pipeline_succeeds
```

The MR still requires one approval unless reviewers intentionally apply the
`skip-approval` label.

## Layer Boundary Rules

- Core changes require matching spec, verifier/lowering, formatter/audit where
  relevant, and tests.
- Host ABI changes require ABI docs, `src/host_abi.js` / registry updates, host
  stubs or implementations, and tests.
- Stdlib changes must remain generic, deterministic, backend-neutral, and
  resource-free.
- Kits may include reusable resources, shaders, materials, and starter manifest
  fragments.
- Demos must remain project-local. Demo material handles, palettes, routes,
  named objects, and art direction must not move into stdlib or Core.

When a layer placement is ambiguous, keep the code in `examples/` or `demo/`
until the reusable shape is clear.

## Documentation Requirements

- Public API changes require README and spec updates.
- New host imports require ABI documentation and host ABI registry coverage.
- New examples need runnable commands or a clear reason they are fixtures only.
- Broken local links in public docs are release blockers.
- Review/export bundles must include files required by README links, documented
  commands, tests, examples, manifests, shaders, and assets.

## Compatibility Policy

- Supported manifest and ABI versions must be explicit.
- Version drift between specs, package metadata, WebGPU/native hosts, and
  validators is not allowed.
- Legacy demo APIs may remain only when clearly marked as compatibility-only and
  not standard AIR ABI.
- Backward compatibility paths should warn or document their status; they should
  not silently redefine current behavior.

## AI-Agent Rules

- Do not delete files just to satisfy tests unless the user explicitly asks.
- Prefer move/refactor over silent removal.
- Report architecture ambiguity before promoting code to `stdlib/` or Core.
- Do not make demos pass by polluting `stdlib/`, `kits/gfx-basic/`, or public
  host ABIs with project-specific concepts.
- Do not add broad language features to fix a single demo bug; use project kits,
  manifests, or host adapters when that is the right layer.
