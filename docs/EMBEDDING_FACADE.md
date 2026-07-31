# JavaScript Embedding Facade

## Status

The v0.49 facade is a bounded, host-neutral JavaScript entrypoint:

```js
const air = require("./src");

const result = await air.run({
  package,
  facts,
  grants,
  limits,
  adapters
});
```

The stable result shape is:

```js
{
  decision,
  outputs,
  evidence,
  resourceCertificate,
  diagnostics
}
```

## Verification Order

The facade:

1. validates the explicit package descriptor;
2. runs source package verification for the selected host profile;
3. requires and validates a Verified Resource Certificate;
4. validates bounded facts, grants, limits, and adapter declarations;
5. checks certified host-call and output bounds against supplied limits;
6. compiles and instantiates only the verified source module;
7. invokes one declared exported i32 decision entrypoint;
8. captures bounded scalar output intents;
9. returns deterministic digest-bound evidence.

No package executes before verification and certificate validation.

## Explicit Inputs

`package.directory` must be an absolute path supplied by the embedding host.
The facade reads only that explicit package and its package-declared files.
The path is not included in evidence.

Facts are bounded JSON scalars. Grant material is limited to stable IDs,
capabilities, effects, one target, numeric bounds, expiry, and redaction mode.
Credential-like or ambient-authority keys are rejected.

Limits must explicitly include:

- maximum amount;
- quota limit;
- rate limit;
- logical `now`;
- maximum outputs;
- maximum host calls.

Logical time is supplied by the host. The facade does not read wall-clock time.

## Adapters

The first bounded slice supports:

```js
{
  "output.emit": "capture"
}
```

This declaration creates a scalar output capture import only after the package,
grant, effect, certificate, and limit checks pass. No callback, filesystem,
network, process, credential, or hidden host object is supplied to AIR.

Unknown, missing, extra, or unsupported adapters fail closed.

## Evidence Binding

The evidence contains domain-separated SHA-256 bindings for:

- package certificate digest and public execution descriptor;
- facts;
- grants;
- adapter declarations;
- limits;
- outputs;
- the Verified Resource Certificate.

`bindingDigest` binds those fields together. `replayDigest` binds the complete
decision, execution record, diagnostics, and binding record. There are no
timestamps, random values, absolute package paths, or adapter functions in the
evidence.

## Failure Behavior

Package verification, certificate, grant, capability, effect, adapter, limit,
or output mismatches return a denied decision with stable diagnostics. AIR is
not invoked when a pre-execution check fails.

The facade does not merge, publish, deploy, or provide host enforcement beyond
the explicitly selected in-process capture adapter.
