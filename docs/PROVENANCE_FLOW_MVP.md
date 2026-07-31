# Provenance Flow MVP

## Scope

The Provenance Flow MVP is a bounded, package-enabled verifier check for
explicit source labels, sink ceilings, direct dependencies, supported control
dependencies, and reviewed declassification. It runs before execution and
adds deterministic evidence to package reports.

It does not change lowering, runtime representations, AIR ABI, or Host ABI.
Unlabelled packages remain compatible because the analysis is enabled only by
`provenanceFlow.mode = "required"`.

## Labels

The ordering is fixed:

```text
public < internal < sensitive < restricted
```

A value may flow to the same or a higher sink ceiling. A flow to a lower
ceiling is rejected.

## Module Declarations

Every module in a required package contains one:

```air
flow policy required
```

Exported parameters and returns are boundaries:

```air
flow source param decide.secret sensitive
flow sink return decide public
```

Schema-backed parameters also name their exact source:

```air
flow source param decide.score from fact request.score internal
flow source param decide.token from structured request.token restricted
```

Used extern returns and arguments, print, globals, fixed state, and pool fields
must be labelled explicitly:

```air
flow source extern random.u32 return internal
flow sink extern debug.metric arg 1 internal
flow sink print arg 0 public
flow source global seed internal
flow storage global cache sensitive
flow storage state board internal
flow storage pool objects.owner sensitive
```

## Package Policy

The package manifest enables required mode and binds module declarations to
schema metadata and declassification authority:

```json
{
  "provenanceFlow": {
    "mode": "required",
    "sourceBindings": [
      {
        "from": "fact:request.score",
        "to": "param:policy.decide.score",
        "label": "internal"
      }
    ],
    "declassifiers": [
      {
        "id": "redact_sensitive",
        "module": "policy",
        "function": "redact",
        "from": "sensitive",
        "to": "public",
        "reasonCode": "PII_REDACTION_V1"
      }
    ]
  }
}
```

Facts, structured-input fields, and output-contract arguments use `flowLabel`
with one of the fixed labels. Module declarations, package bindings, and
schema labels must match exactly.

## Propagation

The analysis joins labels through:

- SSA values, arithmetic, comparisons, selects, and supported aggregate ops;
- local and direct package-local calls and returns;
- bounded fold, array, and buffer loops;
- structured-phi loops with bounded fixed-point analysis;
- globals, fixed state, pools, whole arrays, slices, buffers, and regions;
- extern returns, extern arguments, print, and output-contract arguments.

A labelled branch condition contributes a control dependency to reachable
successor blocks. A later return, write, or effect therefore cannot hide a
restricted choice behind a public value.

Unknown calls, recursion, unresolved output IDs, unsupported aliases, missing
labels, and exceeded analysis limits fail closed.

## Declassification

A declassifier must be:

- declared in the module and authorized exactly in the package policy;
- a local function with a scalar first input and the same scalar return type;
- free of extern calls, mutable writes, effects, and nested declassification;
- called with auxiliary arguments whose labels are public;
- used only for an input no higher than its authorized `from` label.

Evidence records the authority ID, reason code, policy digest, function digest,
call site, source identities, and result label. Declassification does not
erase a secret control dependency.

## Evidence And Diagnostics

Required-mode evidence contains deterministic:

- policy, analyzer, and summary digests;
- source and sink inventories;
- accepted and rejected source-to-sink paths;
- declassification records;
- analysis limits and unsupported channels;
- stable `air.flow.*` diagnostics with file, line, symbol, and repair hint.

Evidence records identities and static dependency paths, never runtime secret
values.

## Bounds

The MVP limits analysis to:

- 32 sources per value;
- 64 nodes per dependency path;
- 2048 nodes per function;
- 16384 nodes per package;
- 256 functions;
- 32 declassifiers;
- 3 structured-phi fixed-point rises.

Crossing a limit emits `air.flow.analysis_budget_exceeded`; evidence is not
silently truncated and accepted.

## Unsupported Channels

The result makes no claim about:

- timing or termination channels;
- covert or microarchitectural channels;
- host-side propagation after an explicit boundary;
- semantic correctness of an authorized declassification;
- per-element array labels or per-byte region labels.

## Rollback

Remove `provenanceFlow` from the package manifest and the corresponding `flow`
declarations to return to legacy verification behavior. Existing AIR syntax,
lowering, package execution, and ABI remain unchanged.
