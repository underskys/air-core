# Verified Resource Certificate

## Status

This document defines the bounded v0.49 Verified Resource Certificate. The
certificate is deterministic verifier evidence. It does not claim that every
host enforces the reported bounds.

## Identity And Binding

The certificate has:

- `schemaVersion: "1.0"`;
- `kind: "air.verifiedResourceCertificate"`;
- certificate mode, `optional` or `required`;
- verifier version and source digest;
- exact source-module digests;
- package manifest digest;
- package digest derived from the manifest and ordered module digests;
- a domain-separated certificate digest over the complete payload.

Domain separation uses distinct labels for verifier identity, package identity,
module fallback identity, target-bundle binding, and the final certificate.
Validation recomputes the certificate digest and can require exact package,
verifier, or certificate digests. This rejects payload tampering,
cross-package substitution, and stale manifest pins.

## Bound Classes

Every bound is classified explicitly:

- `verified`: conservatively derived by the current verifier;
- `declared`: a source effect/resource budget;
- `unknown`: a required numeric upper bound was not proven;
- `unsupported`: deliberately outside this certificate's claim.

The certificate reports, where derivable:

- maximum and total statically bounded loop iterations;
- maximum and total dynamic-loop fuel upper bounds;
- static readonly, state, pool, and statically allocated memory;
- unknown dynamic-allocation byte bounds;
- host-call upper bounds by exact effect and capability;
- output host-call upper bounds and declared `output.*` budgets;
- verifier effect-usage upper bounds;
- module and function effect-budget declarations;
- stable unknown and unsupported reasons.

Existing loop verification rejects unrestricted loops. Dynamic loops use the
same conservative verifier upper bounds already used for effect accounting.
Host-call totals include bounded loop multiplication performed by that
accounting.

## Memory

Static table, state, pool, and statically known region allocation bytes are
reported separately and as a total upper bound.

An allocation whose byte count is not statically known remains `unknown`.
The certificate does not reinterpret a declaration such as
`memory.dynamic_allocations <= 1` as a byte-size proof.

Native stack usage, host allocator overhead, and host-owned memory are
unsupported claims.

## Modes

Package manifests may declare:

```json
{
  "resourceCertificate": {
    "mode": "required",
    "requiredBounds": [
      "effects",
      "hostCalls",
      "loops",
      "memory"
    ]
  }
}
```

Optional pins are:

- `verifierDigest`;
- `packageDigest`;
- `certificateDigest`.

All pins use `sha256:<64 lowercase hex>`.

In `required` mode, any unknown requested category fails package checking.
In `optional` mode, the certificate remains advisory and existing package
behavior remains compatible. A declared pin disagreement fails in either mode
because accepting a mismatched identity would make the evidence misleading.

## Exposure

The certificate is exposed through:

- `sdk.createPackageResourceCertificate`;
- `sdk.checkPackageDir(...).resourceCertificate`;
- `air.verificationEvidence.resourceCertificate`;
- the Markdown evidence report;
- optional `resource_certificate.json` inclusion in a target bundle.

Target bundles bind the exact certificate digest and package digest to the
bundled `airpkg` hash. Bundle validation checks the file hash, certificate
self-digest, package name, declared digests, and binding digest.

## Host Boundary

The certificate proves only what the AIR verifier derives from canonical AIR
and package metadata. A host may use it as an admission input, but actual
runtime enforcement, scheduling, external-service behavior, wall-clock time,
and host-side resource accounting remain separate host responsibilities.

## Stable Failure Codes

- `air.resource_certificate.invalid`
- `air.resource_certificate.schema_mismatch`
- `air.resource_certificate.kind_mismatch`
- `air.resource_certificate.digest_mismatch`
- `air.resource_certificate.package_substitution`
- `air.resource_certificate.verifier_mismatch`
- `air.resource_certificate.manifest_mismatch`
- `air.resource_certificate.required_bound_unknown`
- `air.resource_certificate.creation_failed`
- `air.resource_certificate.bound_invalid` (0.52.1)
- `air.resource_certificate.profile_unsupported` (0.52.1)

## AIR 0.52.1 Soundness Corrections

- Structured phi loops are charged at their lowering fuel. The body counts
  4096 times and the header 4097 times per entry, and the loop counts as a
  dynamic loop with 4096 iterations of fuel.
- Work and effect totals must stay exact safe integers. Any overflowing total
  makes the `loops`, `hostCalls`, `effects` and `outputs` categories `unknown`
  with reason `work_bound_overflow`, and their numbers are reported as `null`.
  A required-mode certificate is then `incomplete`, never `verified`.
- When a module calls a function of another package module, the same four
  categories are `unknown` with reason `package_call_composition_unproven`.
  Cross-module composition is not proven by this certificate.
- `createVerifiedResourceCertificate` rejects a typed-v0.51 AST with
  `air.resource_certificate.profile_unsupported`. This certificate walks only
  legacy block IR.
- `validateVerifiedResourceCertificate` returns
  `air.resource_certificate.bound_invalid` when a `verified` certificate
  carries a non-exact bound or an unverified required work category.

Compatibility: a certificate that 0.52.0 reported as `verified` for these
shapes is now `incomplete`, and an admission path that requires `verified` now
fails closed. This is an intentional breaking-safety correction.

### QA52 correction (0.52.1)

- A consumer reads a bound only from a category whose status is `verified`
  and whose value is an exact non-negative safe integer. A missing or `null`
  value is never zero. `run_package` denies before execution with
  `air.run.resource_bound_unproven` (status `unknown`),
  `air.run.resource_bound_overflow` (reason `work_bound_overflow`) or
  `air.run.resource_bound_invalid` (malformed section, status or value).
- `validateVerifiedResourceCertificate` also returns
  `air.resource_certificate.bound_invalid` when a `verified` category's total
  is missing, `null` or negative, or when a required category is absent.
- Calls into an unresolved `std.*` source import make the work categories
  `unknown` with reason `stdlib_call_composition_unproven` (module facts field
  `stdlibExternalCalls`), distinct from `package_call_composition_unproven`.
  Neither composition is proven by this certificate.
- The certificate accepts only the legacy block-IR shape: every function must
  be a list of blocks, with no statement body, enum declarations or typed
  marker. Any other AST is `air.resource_certificate.profile_unsupported`,
  whether or not the `v051TypedAst` marker is present.

## Compatibility And Rollback

No parser syntax, type syntax, lowering rule, AIR ABI, Host ABI, Protocol, or
runtime representation changes. Packages without a certificate policy receive
an optional SDK/evidence certificate and retain their previous pass/fail
behavior.

Rollback removes the certificate fields and SDK/report/bundle integration.
Existing packages, Wasm, and manifests without `resourceCertificate` require no
migration.
