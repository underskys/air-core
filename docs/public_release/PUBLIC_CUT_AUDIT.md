# AIR Alpha Public Cut Audit

Status: public-clean repository content inventory for AIR alpha launch.

This audit classifies repository content for a public alpha cut. It does not
publish the package and does not change compiler architecture, AIR ABI, Host
ABI, or language features.

## Summary Counts

| Classification | Count |
| --- | ---: |
| Public now | 25 |
| Public later / delayed | 12 |
| Must remove / sanitize / exclude | 20 |

Counts are inventory groups, not file counts.

## Public Now

These paths are appropriate for the initial public repository cut, subject to
the sanitation notes in [SANITIZATION_REPORT.md](SANITIZATION_REPORT.md):

- `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `LICENSE`, `NOTICE.md`;
- `bin/`;
- `src/`;
- `spec/`;
- `stdlib/`;
- `test/`;
- `examples/public/`, limited to launch-safe Core examples for the npm/public
  package;
- `benchmarks/`, limited to deterministic small benchmark fixtures;
- `evals/ai_authoring/`, limited to deterministic replay/import fixtures;
- `consumer_evidence/`, limited to repository evidence/intake manifests, proof
  cards, summaries, and small evidence metadata; excluded from the npm package;
- `docs/`, excluding raw review bundles or private launch notes;
- `scripts/`, limited to deterministic local development, check, gate, and
  bundle scripts.
- public launch docs: `WHY_AIR.md`, `METHOD.md`, `SECURITY.md`,
  `THREAT_MODEL.md`, `CONFORMANCE.md`, `ROADMAP.md`, `VERSIONING.md` when
  present, and `docs/public_release/`.

## Public Later

These paths are useful but should remain outside the first public alpha package
or require a separate review before inclusion:

- `kits/`;
- `hosts/`;
- `demo/`;
- `demo_snapshots/`;
- `prompts/` and `requests/` until public contribution/intake policy is
  finalized;
- large demos and host-specific demos;
- FlowDesk/AirOps private or product artifacts if any appear outside sanitized
  fixtures;
- raw review bundles;
- raw prompt logs or chat transcripts;
- large media, screenshots, generated archives, and local build outputs.

## Must Remove or Sanitize Before Public Launch

The public cut must not expose:

- private or proprietary license text not intended for public release;
- `private: true` if the package is intended for npm publication;
- local absolute paths, usernames, or machine names;
- secrets, tokens, private keys, credentials, or private emails;
- personal, political, relocation, or other non-technical narrative;
- AppleDouble `._*` files or `.DS_Store`;
- stale review metadata;
- raw chat transcripts;
- raw review bundles or large generated bundles.
- generated `.wasm`/binary artifacts unless explicitly kept as
  reproducibility fixtures.

See [CLEANUP_CANDIDATES.md](CLEANUP_CANDIDATES.md) for path-level inventory.

## npm Packaging Position

`package.json` is now public-package-ready metadata with Apache-2.0 licensing.
No npm publication was performed. Before any publication, verify package
contents with `npm pack --dry-run`.

`package.json` uses a `files` whitelist for the alpha npm package. `.npmignore`
adds exclusions for generated/local artifacts. The package surface excludes
snapshots, raw review metadata, external/host/demo surfaces, generated build
outputs, large media, prompt/chat logs, secret-like fixtures, consumer evidence,
and downstream demo pressure.

`scripts/check_public_package_surface.js` verifies the actual `npm pack
--dry-run --json` surface. The alpha package surface is limited to Core/spec/CLI,
stdlib, public examples, and narrow conformance fixtures.

## Verification Commands

Required public-clean audit checks:

- `npm test`;
- `npm run test:bundle`;
- `npm run check:consumer-evidence`, when available;
- all available `check:api-gates:*` scripts;
- `bash scripts/run_rc_checks.sh`;
- `node scripts/check_review_bundle.js --keep`;
- `node scripts/check_markdown_links.js`;
- `node scripts/check_abi_requests.js`;
- `node test/layer_guard.test.js`;
- `git diff --check`.

## Launch Blockers

- Decide whether the public alpha is repository-only or npm-published. For npm
  publication, run a dedicated package dry-run/review task first.
- Review `kits/`, `hosts/`, `demo/`, and `demo_snapshots/` before any public
  package inclusion.
- Keep raw review bundles and generated artifacts excluded from package output.
- Regenerate or remove local review metadata before cutting public release
  artifacts.

## ABI Status

- AIR ABI remains `0.10`.
- Host ABI latest remains `0.11`, limited to bounded `output.emit`.
