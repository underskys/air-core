# AI-Generated Module Fixture

This directory contains the v0.11 prompt-to-module scripted demo fixtures.

The demo is intentionally offline. It does not call an LLM API and does not use
the network. The prompt-like markdown file records the intended request, and the
checked-in AIR file represents the generated module that the review loop will
format, verify, explain, audit, lower, package, and validate.

Run:

```sh
node scripts/prompt_to_module_demo.js
```

Release evidence and expected output are documented in
[PROMPT_TO_MODULE_v0.11.md](../../docs/PROMPT_TO_MODULE_v0.11.md).
