# Contributing

AIR is preparing for public alpha under the Apache License, Version 2.0.

## Contribution Rules

By contributing, you confirm that:

- you have the rights to submit the work;
- your contribution can be distributed under Apache-2.0;
- the contribution does not include employer-owned, confidential,
  proprietary, or third-party code unless explicitly authorized;
- the contribution does not include secrets, tokens, credentials, private keys,
  private data, raw prompt logs, or local machine artifacts;
- the contribution does not add runtime semantics, ABI changes, or host
  authority without an accepted RFC/release plan.

## Engineering Expectations

Contributions should include appropriate tests or docs and should preserve the
current architecture boundaries:

- AIR ABI changes require explicit review and versioning.
- Host ABI changes require explicit review and compatibility matrix updates.
- Demo pressure does not directly define Core APIs.
- Public docs must avoid unsupported security, correctness, or performance
  claims.

## Before Contributing

Read:

- [README.md](README.md)
- [WHY_AIR.md](WHY_AIR.md)
- [METHOD.md](METHOD.md)
- [SECURITY.md](SECURITY.md)
- [THREAT_MODEL.md](THREAT_MODEL.md)
- [CONFORMANCE.md](CONFORMANCE.md)
- [AGENTS.md](AGENTS.md)
- [AIR Layer Manifest](spec/AIR_LAYER_MANIFEST.md)
- [AIR Platform Contract](spec/AIR_PLATFORM_CONTRACT.md)
