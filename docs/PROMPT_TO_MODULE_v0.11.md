# AIR v0.11 Prompt-To-Module Release Evidence

This document defines the v0.11 prompt-to-module scripted demo as release
evidence. The demo is deterministic and offline: it does not call an LLM API,
does not perform live AI generation, does not access the network, does not
implement target packaging, and does not add public Host ABI.

## Command

From the repository root:

```sh
node scripts/prompt_to_module_demo.js
```

The script writes all generated review artifacts under:

```text
build/prompt-to-module-demo/
```

`npm test` also runs this loop as a smoke equivalent.

## Inputs

The prompt-like fixture is:

- [network_health_prompt.md](../examples/ai_generated/network_health_prompt.md)

The checked-in generated AIR fixture is:

- [network_health_generated.air](../examples/ai_generated/network_health_generated.air)

The markdown prompt records the intended AI-style request. The `.air` file is
the deterministic generated module fixture used for review. Keeping both files
checked in makes the release test reproducible without external network or LLM
dependencies.

## Review Flow

The script runs the AIR review loop in this order:

1. Copy the prompt fixture and generated `.air` fixture into
   `build/prompt-to-module-demo/`.
2. Run formatter:

   ```sh
   node bin/airc.js fmt build/prompt-to-module-demo/generated.air
   ```

   The canonical output is written to `formatted.air`.

3. Run verifier:

   ```sh
   node bin/airc.js verify build/prompt-to-module-demo/formatted.air
   ```

4. Run explain:

   ```sh
   node bin/airc.js explain build/prompt-to-module-demo/formatted.air
   ```

   Output is written to `explain.txt`.

5. Run audit:

   ```sh
   node bin/airc.js audit build/prompt-to-module-demo/formatted.air
   ```

   Output is written to `audit.txt`.

6. Emit JSON report with v0.12 AI review diagnostics:

   ```sh
   node bin/airc.js report build/prompt-to-module-demo/formatted.air --ai-review
   ```

   Output is written to `report.json`. The `aiReview` section is advisory: it
   reports repeated literals, magic handle candidates, oversized shapes,
   unused declarations, suspicious `debug.metric` event-bus patterns, and
   repair hints. These warnings do not reject otherwise valid AIR modules.

7. Build WASM where supported:

   ```sh
   node bin/airc.js build build/prompt-to-module-demo/formatted.air \
     --emit wasm \
     -o build/prompt-to-module-demo/ai_generated_health_score.wasm
   ```

8. Build an AIR package using the SDK package builder.

9. Run host-facing package check:

   ```sh
   node bin/airc.js package-check build/prompt-to-module-demo/package
   ```

   Output is written to `package-check.txt`.

## Expected Summary

A successful run prints a concise pass/fail transcript:

```text
AIR v0.11 prompt-to-module demo
prompt: examples/ai_generated/network_health_prompt.md
generated: examples/ai_generated/network_health_generated.air
output: build/prompt-to-module-demo
ok - copy prompt fixture
ok - format module
ok - verify module
ok - explain module
ok - audit module
ok - write JSON report with AI review
ok - build wasm
ok - build AIR package
ok - package-check
module: ai_generated_health_score
abi: 0.10
exports: evaluate
capabilities: debug
host imports: debug.metric
ai review: warn; warnings=2
package module: ai_generated_health_score
summary: pass
```

The expected module uses only `capabilities { debug }` and the registered
`debug.metric` Host ABI import. It performs deterministic score calculation for
mock network-health-style inputs; it does not perform real network probing.

## Failure Behavior

When a step fails, the script prints:

- the failing step name;
- the exact command that failed;
- captured stdout/stderr when available;
- a repair hint pointing to the generated review artifact and the command to
  rerun.

This makes failures repairable by inspecting the formatted AIR module, verifier
diagnostic, audit output, report JSON, WASM build output, or package-check
output.

## Release Checks

Required checks:

```sh
node scripts/prompt_to_module_demo.js
npm test
```

The test runner asserts that:

- the script prints the v0.11 prompt-to-module header;
- the summary is `pass`;
- the module is `ai_generated_health_score`;
- the report status is `pass`;
- the report contains deterministic `aiReview` diagnostics;
- the module capability list is deterministic;
- the package check returns `ok: true`.

## Non-goals

- No LLM API integration.
- No live AI generation.
- No external network dependency.
- No target packaging implementation.
- No package registry.
- No new public Host ABI.
- No real network scanning.
