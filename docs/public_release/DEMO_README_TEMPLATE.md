# Demo README Template

Use this template for public demo repositories or public demo pages. Keep it
small, reproducible, and explicit about the AIR/Host boundary.

## One-Line Description

`<Demo name>` shows `<one concrete behavior>` using AIR for bounded
deterministic logic and a host for platform authority.

## AIR Owns / Host Owns

| AIR owns | Host owns |
| --- | --- |
| Deterministic policy/decision logic. | Rendering, UI, platform APIs, filesystem, network, browser, OS, or device access. |
| Capability/effect declarations checked by AIR tooling. | Real resource loading and execution policy. |
| Bounded output intent or scalar result. | Whether and how to execute an AIR output intent. |
| Evidence/report surface for human review. | Product correctness, user experience, deployment, and host security policy. |

## 60-Second Quickstart

```sh
npm ci
<demo install command if separate from AIR Core>
<demo run command>
```

Expected result:

- `<short visible outcome>`

## Verification Command

Use at least one AIR-owned command that does not require a browser, network, or
large media pipeline:

```sh
node bin/airc.js verify <path/to/module.air>
```

Or, for package-shaped demos:

```sh
node bin/airc.js package-check <path/to/package> --json
```

## Evidence / Report Command

```sh
node bin/airc.js report package <path/to/package> --json
```

If no package report exists yet, state:

- Evidence report: pending.
- Reason: `<short reason>`.

## Replay

```sh
node bin/airc.js replay <path/to/replay-or-package> --json
```

If replay is not available:

- Replay: pending.
- Reason: `<short reason>`.

## Screenshot / GIF

Add a small public screenshot or GIF:

- Screenshot/GIF: `<url or relative path in demo repo>`

Do not commit large raw videos, raw screenshots, or generated bundles to AIR
Core.

## Known Limitations

- `<limitation 1>`
- `<limitation 2>`

Avoid unsupported claims about security, formal correctness, or performance.

## Denied Authorities

This demo must not give AIR modules direct authority over:

- raw filesystem, network, browser, cloud, database, renderer, GPU, or OS APIs;
- secrets, tokens, credentials, private keys, raw URLs, or private user data;
- host object handles;
- runtime JSON/object models, dynamic maps, GC, or reflection;
- demo-specific Core APIs.

Host code may own real platform authority, but the AIR-owned surface should
remain bounded, declared, and reviewable.
