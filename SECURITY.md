# Security

AIR is a constrained module format with a reference verifier and package-check
tooling. It is not a complete security boundary for arbitrary hosts or
untrusted deployment environments.

## What AIR Protects Against

Under AIR's verifier model, AIR is intended to reject:

- undeclared host imports;
- invented APIs;
- unsupported Host ABI signatures;
- capability/effect budget violations;
- runtime JSON/object/dynamic map surfaces;
- host object handles;
- unbounded recursion;
- static loop counts above `4096`;
- memory region leaks, double free, and use-after-free in the current region
  model;
- raw private payloads in supported schema/report surfaces where checks apply.

## What AIR Does Not Protect Against

AIR does not protect against:

- malicious or compromised hosts;
- incorrect host policy decisions;
- incorrect business logic;
- incorrect sanitized input facts;
- bugs in host adapters or platform APIs;
- side channels outside the AIR execution model;
- denial-of-service outside configured verifier/execution limits;
- unsafe behavior in code that is not represented as AIR modules.

## Reporting Security Issues

For the public alpha, report security issues through the project issue tracker
or maintainer contact once published. Do not include secrets, private data, or
exploit payloads in public issues.

## Claims Boundary

AIR should be described as verifier-enforced under its model, not as a guarantee
that AI-generated code is safe in all contexts.
