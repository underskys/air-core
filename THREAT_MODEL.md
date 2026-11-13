# Threat Model

This document defines the public alpha threat model for AIR Core.

## In Scope

AIR Core focuses on protecting the AIR module boundary against:

- invented APIs and hallucinated host calls;
- undeclared capabilities/effects;
- unsupported Host ABI imports;
- unsupported dynamic data models;
- verifier-unbounded execution forms such as recursion;
- selected memory/resource lifetime mistakes;
- package/report/evidence drift that can be detected by package-check.

The relevant attacker model is mostly accidental or AI-generated invalid code,
plus review drift. AIR also rejects some deliberately malformed modules, but it
does not claim to handle every malicious input or hostile embedding.

## Out of Scope

The following are out of scope:

- malicious host runtime;
- malicious package manager or build system;
- compromised OS, browser, database, cloud account, or network;
- host policy correctness;
- business correctness;
- correctness of real-world input facts;
- private data that the host chooses to expose to AIR;
- external service validation;
- production sandboxing guarantees.

## Boundary Statement

The verifier enforces the AIR module boundary under AIR's model. The host owns
real platform authority and is responsible for deciding whether AIR output
intents are safe to execute.

AIR's checks run inside the host's JavaScript process. They are not a boundary against other code in that process, which can load any file of the package by path, call internal functions or change objects. Non-enumerable properties and the package's `exports` map shape the supported API. They are not access control.

Raw execution. Every Wasm execution entry on the package root runs only bytes AIR verified, lowered from verified source, matched to that lowering, or admitted. `@underskys/air-core/raw` (`instantiateRawWasm`, `invokeRawBorrowedMemory`, `prepareRawBorrowedMemoryInvocation`) runs caller bytes with caller imports and no admission; its results carry no AIR assurance. Neither is a sandbox against code in the same process.

Host authority. The embedding host is trusted; what it receives while serving (a client's request, a message, an AI model's tool call) is not. `air.run` takes the package descriptor, grants, limits with logical `now`, adapters and host-state facts only from `air.hostAuthority(...)`, and refuses a request that carries them, or carries `quotaUsed`, `rateUsed` or `requiresRedaction` among its facts. `air.runHostConstructed` keeps the single-object form for hosts that build the whole request; request data passed to it, or to `hostAuthority`, gets the host's authority, and AIR cannot detect that. Selecting among host-made authorities by request data hands that choice to the request.

A package folder can come from an untrusted source. On Linux and macOS, AIR admits a path that a package declares or imports (its manifest, entry, wasm, modules and imports, the legacy `air-package.json` format's files, its assets and its AIR ABI 0.12 descriptor) only when it names a regular file under the package root through real folders, with no symbolic link anywhere on the way. Anything else is refused with a code (`air.package.path_uncontained`, `air.package.file_invalid`) before it is read. The package manifest, the entry, the wasm, package modules and the legacy format's files are then read through one descriptor, opened without following a final link and without blocking, and checked to be the admitted regular file, within 4 MiB (`air.package.file_changed` otherwise). This is not full race-free containment. The package root and its ancestors are the caller's choice and are trusted. Only those listed reads check the file's identity, and every other read relies on the check at admission. Hard links, content changed in place, a folder swapped and swapped back between two checks, and Windows are outside this promise.

## Review Boundary

Evidence reports are review tools. They help humans inspect capabilities,
effects, schemas, outputs, conformance, and diagnostics. They are not a
substitute for product review, security review, or host policy review.
