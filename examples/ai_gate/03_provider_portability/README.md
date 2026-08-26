# Provider Portability

The provider boundary is a host adapter boundary:

```text
provider-specific output -> UntrustedProposal -> host normalization -> AIR input
```

`AIEX-05` runs the same normalized proposal from four stub adapters:
Apple/local, Windows/local, Android/local, and remote gRPC. Provider identity
and transport do not enter the canonical AIR authority records, so the result
is identical. A host may use provider information as an explicit observation or
policy fact only when a frozen contract actually models it; it is never an
implicit capability.
