# Public Cut Sanitization Report

Status: initial sanitation report for AIR alpha launch.

## Scans Performed

Tracked-file scans were performed for:

- local absolute paths such as user-home or Linux-home directory prefixes;
- machine/user identifiers such as local hostnames;
- private key markers, common cloud key prefixes, bearer tokens, and
  secret-like API key assignments;
- private email patterns;
- AppleDouble `._*` files;
- large media/archive extensions;
- raw bundle and transcript naming patterns.

## Findings

| Finding | Status | Action |
| --- | --- | --- |
| Historical RFC example contained a user-home absolute path. | Sanitized. | Replaced with `<absolute-path>/player.air` so the example still documents absolute path rejection without carrying a local path shape. |
| `package.json` previously used private/unlicensed package metadata. | Sanitized. | Removed the private package flag, set `license` to `Apache-2.0`, and added `author: Dmitriii`. No npm publish was performed. |
| Intentional secret-like negative fixtures exist under `test/fixtures/ai_eval_import/secret/`. | Reviewed fixture. | Keep; tests assert secret-like content is rejected and not echoed. |
| Secret scan also matches terms such as `secret`, `token`, and `skybox` in docs/tests. | Reviewed false positives/contextual policy text. | Keep; these are policy descriptions, diagnostic tests, or unrelated identifiers. |
| `examples/profile_portability/module.wasm` and `test/fixtures/pools/projectile_pool_basic/module.wasm` are tracked compiled artifacts. | Public-package exclusion required. | Keep in repo only if needed by tests; exclude from npm package and review bundles unless explicitly required. |
| No tracked AppleDouble `._*` files found. | Clean. | `.npmignore` excludes future `._*` files. |
| No tracked raw review archives or large media files found by extension scan. | Clean. | `.npmignore` excludes common archive/media outputs. |

## npm / Package Exclusion

Added `.npmignore` as a future package exclusion plan. It excludes:

- `snapshots/`, `demo_snapshots/`, and review result artifacts;
- generated mobile/review/consumer evidence summaries;
- `demo/`, `kits/`, `hosts/`, `prompts/`, `requests/`, and
  `consumer_evidence/`;
- dependency and build outputs;
- logs, temp files, archives, media files, compiled `.wasm`, AppleDouble files,
  `.DS_Store`, and secret-like files.

This does not publish the package and does not change runtime behavior.

## Remaining Blockers Before Public Alpha

- Decide whether npm publication is in scope. If yes, run `npm pack --dry-run`
  and review the resulting package in a dedicated release task.
- Review whether `kits/` and `hosts/` should be public repository content or
  public-later content for alpha. They are excluded from the future npm package
  plan.
- Keep raw review bundles, raw prompt logs, and full demo bundles out of public
  package artifacts.

## ABI Status

- AIR ABI unchanged: `0.10`.
- Host ABI unchanged: latest `0.11`, limited to bounded `output.emit`.
