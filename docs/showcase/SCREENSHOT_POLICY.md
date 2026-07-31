# Screenshot Policy

Status: active showcase media safety policy.

Screenshots and media under `docs/showcase/assets/` are public showcase assets.
They must be safe to publish and must not expand AIR Core claims.

## Required Rules

- No secrets.
- No tokens.
- No private email addresses unless intentionally public.
- No raw chat logs.
- No internal local paths.
- No personal data.
- No proprietary employer content.
- No screenshots that imply unsupported claims.
- Large images must be compressed.
- Prefer PNG or WebP.
- Prefer less than 500 KB per image unless justified in the demo entry.
- Animated GIFs and WebMs require explicit approval before commit.

## Claim Boundary

Screenshots may show host-composed systems. They must not claim or imply that
AIR is a game engine, 3D engine, AR engine, Google Drive system, storage
system, browser platform, GPU runtime, or replacement for Python, TypeScript,
Rust, or host application code.

AIR-owned behavior must be described as bounded deterministic logic,
capabilities/effects, table/data semantics, package/evidence checks, and output
intents. Host-owned behavior must remain host-owned in captions and docs.

## Review Before Commit

Before committing a screenshot:

1. Inspect the image at full size.
2. Confirm the image has no private data, credentials, local paths, or raw
   chat content.
3. Confirm the file is compressed and normally below 500 KB.
4. Confirm the file is referenced from `docs/showcase/README.md`.
5. Confirm `npm pack --dry-run --json` does not unexpectedly include large
   showcase media in the npm package.
