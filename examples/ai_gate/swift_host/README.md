# AIRSwift Host Boundary

This small executable compiles against the standalone `swift/AIRSwift` package.
It constructs real `AIRCanonicalTypedInput`, `AIRDecisionIntent`,
`AIRCapabilityGrant`, `AIRGrantSet`, `GenerationFence`, deadline, and budget
values. Its `UntrustedProposal` is a host tutorial type, explicitly marked
`NON_AIR_CORE_TYPE`; raw text and claimed authority do not enter the resulting
canonical AIR records.

The current AIRSwift public surface intentionally does not expose a convenience
high-level `gate.evaluate(intent:grants:observations:...)` evaluator. The Node
reference implementation owns the frozen effective-authority derivation used by
the executable examples. A real Swift host adapter binds these low-level values
to a verified AIR artifact/runtime boundary; this sample does not invent that
API or execute a host effect.

Run it with:

```sh
swift run --package-path examples/ai_gate/swift_host GoldenAIGateSwiftHost
```
