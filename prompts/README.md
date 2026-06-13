# AIR Prompt Library

These prompts are for AIR generation and repair loops.

Rules:

- Use only documented AIR syntax and public Host ABI.
- Do not invent Host ABI imports.
- Prefer package-local modules over large monolithic files.
- Declare every capability used by host imports.
- Use generated handles for manifest-backed IDs when available.
- Use static read-only scalar tables for fixed data.
- Do not use `debug.metric` as an event bus.
- Treat verifier, package-check, report, and AI-review output as repair input.

Files:

- `system/air-generator.md`: system prompt for AIR generation.
- `repair/verify-error-fix.md`: repair prompt for verifier/package-check errors.
- `fewshot/package-module.md`: small package-local module example.
- `fewshot/no-fs-net.md`: boundary example rejecting undeclared host authority.
- `fewshot/policy-audit-module.md`: non-game static-data package example.
