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

## Review Boundary

Evidence reports are review tools. They help humans inspect capabilities,
effects, schemas, outputs, conformance, and diagnostics. They are not a
substitute for product review, security review, or host policy review.
