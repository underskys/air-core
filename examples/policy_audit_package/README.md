# Policy Audit Package

This is a small non-game AIR package that demonstrates v0.14 mechanisms in a
capability-free setting.

It uses:

- package-local modules;
- AIR-authored constants;
- static read-only scalar tables;
- deterministic package reports;
- optional review-policy budgets.

It does not use graphics, audio, input, networking, browser APIs, or demo/game
concepts.

Run:

```sh
node bin/airc.js package-check examples/policy_audit_package --profile cli --source-only --json
node bin/airc.js report package examples/policy_audit_package --json
```

`package-check` exits successfully. The JSON status may be `warn` while linked
multi-module Wasm output remains deferred; the example is meant to prove
package graph/report behavior, not linked executable output.
