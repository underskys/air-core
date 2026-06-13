# AIR Consumer Evidence Corpus

Status: v0.36 skeleton

The consumer evidence corpus is the intake layer for downstream demo and
consumer pressure. It records what a domain tried to prove, which AIR surfaces
were used, which authorities were denied, and where the pressure should route.

Core review bundles and consumer evidence bundles answer different questions:

- Core review bundles prove compiler, verifier, package-check, reports,
  evidence, replay, and review-surface behavior for the current source commit.
- Consumer evidence bundles prove that AIR survives pressure from downstream
  domains without letting those domains define Core semantics or Host ABI.

Short rule:

**Demos are pressure. Core is law.**

## What Belongs Here

Consumer evidence entries should be small, deterministic descriptors and
summaries:

- `MANIFEST.json` for demo identity, ownership boundaries, allowed capabilities,
  denied authorities, proof files, pressure routing, and privacy notes.
- `PROOF_CARD.md` for human review of the domain pressure.
- Prompt and repair notes that are safe to review.
- Replay, report, and metrics summaries that contain no raw private data.

Each demo must prove its capability boundary. A useful proof shows both what AIR
is allowed to observe or emit and what remains host-owned or rejected.

## What Does Not Belong Here By Default

Heavy assets, generated media, runtime build output, raw logs, and full demo
bundles are not committed by default. Large evidence snapshots may be release
artifacts instead of git-tracked files.

Do not commit:

- secrets, tokens, API keys, credentials, or private notes;
- raw hostnames, raw URLs, packet dumps, MAC addresses, or private text;
- large videos, screenshots, generated builds, dependency folders, or raw logs;
- external demo source trees copied into AIR Core.

## Directory Shape

```text
consumer_evidence/
  DEMO_REGISTRY.json
  schemas/
  demos/
    <demo-id>/
      MANIFEST.json
      PROOF_CARD.md
      PROMPTS.md
      reports/
      replay/
      metrics/
```

The `_template` entry documents the minimum shape for future evidence entries.

## Routing

Every pressure item must route to exactly one of:

- `Core`
- `stdlib`
- `kit`
- `host adapter`
- `demo-local`
- `rejected`

Accepted pressure still needs the normal RFC, gates, verifier, report,
conformance, and ABI decision path before it can affect AIR Core.

See also [Examples, Demos, and Snapshots](../docs/EXAMPLES_AND_DEMOS.md).
