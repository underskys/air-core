# AirOps Incident Canonical Example

This is a small synthetic AIR v0.21 canonical example package. It demonstrates
the bounded data and output-intent path without moving a real operations
product into AIR Core.

Pipeline:

```text
bounded rowset input
-> AIR deterministic scalar decision
-> command buffer output intents
-> verification evidence JSON
-> deterministic conformance replay
```

This is not production observability. It has no real infrastructure authority,
no network/cloud/Kubernetes API access, no secrets, no credentials, no raw logs,
no URLs, and no auto-remediation.

AIR owns only deterministic bounded decision logic:

- `root_cause_kind_id(flags, signal_count) -> i32`
- `risk_score(severity_id, signal_count, age_minutes, flags) -> i32`
- `confidence_score(signal_count, age_minutes) -> i32`
- `recommended_action_id(root_cause_kind, risk, confidence) -> i32`
- `bounded_command_intent(...) -> i32`

The host owns all real authority:

- infrastructure access;
- network and cloud APIs;
- Kubernetes or deployment systems;
- secrets and credentials;
- wall-clock time and randomness;
- report writing;
- execution policy for any command intent.

The package metadata owns the reviewable boundary:

- `facts/incident_observation.rowset.schema.json` declares a bounded rowset
  with minimized scalar fields only.
- `outputs/incident_policy.output.json` declares the scalar output contract.
- `outputs/incident_policy.commands.json` declares bounded command-buffer
  output intents.
- `traces/pass.json` is a deterministic host/test-owned conformance fixture.

## Commands

From the repository root:

```sh
node bin/airc.js verify package examples/airops_incident_package --json
node bin/airc.js package-check examples/airops_incident_package --profile cli --source-only --json
node bin/airc.js conformance examples/airops_incident_package --profile cli --trace examples/airops_incident_package/traces/pass.json --json
node bin/airc.js report package examples/airops_incident_package --json
```

`verify package --json` produces verification evidence with package identity,
`packageHash`, `abiHash`, fact schema fingerprints, Output Contract
fingerprints, command buffer metadata, status fields, and diagnostics.

`package-check --source-only` passes without requiring a built Wasm artifact.

`conformance` replays the deterministic batch fixture and compares observed and
expected command buffer records. The trace has no wall-clock dependency,
randomness, local environment dependency, private raw data, or real
infrastructure authority.

## ABI Status

- AIR ABI remains `0.10`.
- Host ABI remains `0.10`.
- No Host ABI `0.11` import is introduced.
- No runtime output/audio/effect event import is used.
