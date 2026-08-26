# Golden AI Gate Examples

This pack shows how a host connects any AI or ML system to real effects through
the frozen AIR v0.51 authority boundary. The examples are integration examples,
not a new AIR policy, wire format, digest domain, or Core capability.

## The Boundary

```text
user or environment
  -> model, planner, or external brain
  -> UNTRUSTED PROPOSAL
  -> host normalization
  -> typed DecisionIntent and requested demand
     + GrantSet authority ceiling
     + CapabilityObservation
     + GenerationFence
     + Deadline
     + Budget and ResourceClass
  -> AIR deterministic gate
  -> allow, deny, or limit
  -> host rechecks current state
  -> host executes only effective authority
  -> EffectReceipt and evidence after a real effect attempt
```

Model output is proposal data, not a grant, capability, decision, or authority.
AIR is not a planner: it does not decide what a person probably meant, choose
the best item, or interpret natural-language text as authority. A model may be
wrong, manipulated, jailbroken, or malicious; none of that expands host
capabilities by itself.

Conceptually, effective authority is requested demand intersected with explicit
grants, observations, generation, deadline, and resource ceilings. The exact
derivation is frozen in the [Host Contract RFC](../../docs/rfcs/v0.51-typed-host-contract-receipts.md)
and [final architecture freeze](../../docs/rfcs/v0.51-final-architecture-freeze.md).
This README is explanatory and does not replace those rules.

In AIR v0.51, Capability Contract is a developer-facing name for an explicit
authority ceiling assembled from existing frozen Host Contract primitives; it
is not a new AIR Core wire type.

## What Belongs Where

The provider may be Apple/local inference, Core ML, a Windows or Android local
runtime, remote HTTP, remote gRPC, a human-authored planner, or another model.
Provider transport and model runtime stay host-owned. The same normalized typed
proposal with the same grants and observations produces the same authority
result; providers receive no implicit capability.

The host owns framework APIs, devices, network, filesystem, media playback,
hardware, and model invocation. AIR only determines bounded authority. It does
not automatically intercept every host API, model call, GPU, device, or effect.
AIR cannot protect an effect path that the host deliberately exposes around the
gate.

`EffectReceipt` exists only after a valid AIR decision/evidence binding and a
real host effect attempt. A raw model proposal, a denied/no-op proposal, and a
pre-decision runtime failure are not receipt-shaped evidence.

## Examples

| Directory | Demonstrates |
| --- | --- |
| [01_music_assistant](01_music_assistant/README.md) | Model-selected media actions stay within search/play grants. |
| [02_prompt_injection](02_prompt_injection/README.md) | Instruction reset and claimed authority cannot mint capabilities. |
| [03_provider_portability](03_provider_portability/README.md) | Four provider adapters normalize to one authority result. |
| [04_bounded_actuator](04_bounded_actuator/README.md) | A generic actuator host uses effective narrowed values only. |
| [05_filesystem_network_agent](05_filesystem_network_agent/README.md) | Desktop-agent filesystem and network ceilings are explicit. |
| [swift_host](swift_host/README.md) | A compiling AIRSwift host-side low-level adapter boundary. |

`common/host_normalization.js` defines a tutorial-only `UntrustedProposal`
(`NON_AIR_CORE_TYPE`). Its conversion to the existing `DecisionIntentV1` and
`GrantSetV1` shapes is host normalization. The code delegates all authority
outcomes to `src/v051_reference.js`; it does not implement a second evaluator.

## Running

```sh
node scripts/run_v051_ai_gate_examples.js
node test/v051_ai_gate_examples.test.js
cd examples/ai_gate/swift_host && swift run
```

The Node runner emits one JSONL record per scenario with `EXAMPLE_ID`,
`SCENARIO_ID`, `REQUESTED`, `EXPECTED_DECISION`, `ACTUAL_DECISION`,
`EXPECTED_EFFECTIVE`, `ACTUAL_EFFECTIVE`, and `PASS`.

## Practical Answers

1. A model connects at host normalization, before `DecisionIntent` creation.
2. Model text, explanations, confidence, and provider identity are untrusted.
3. The host maps a bounded recognized proposal to typed arguments, demand, and
   an existing `DecisionIntent` record.
4. Hosts configure grants in `GrantSet`; AIR does not infer them from text.
5. Scope, `max_uses`, `Budget`, `ResourceClass`, fence, and deadline are
   explicit existing Host Contract records.
6. `limit` is valid narrowed effective authority, never a broader fallback.
7. The planner or host chooses a concrete item/action before the gate.
8. The host executes the effect after it rechecks current state.
9. Prompt injection cannot create a matching explicit grant.
10. Replacing a provider does not change the typed proposal or authority model.
11. A bypassed host path is outside AIR protection and must be fixed by host
    routing.
12. Capability Contract is an explanatory composition of existing primitives,
    not `AIRContractV1` or a new Core entity.

Vela is one consumer/pressure example among many. It is not AIR's semantic
definition, and no Vela type is present in this examples pack's Core boundary.
