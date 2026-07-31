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

## Compatibility And Rollback

No parser syntax, type syntax, lowering rule, AIR ABI, Host ABI, Protocol, or
runtime representation changes. Packages without a certificate policy receive
an optional SDK/evidence certificate and retain their previous pass/fail
behavior.

Rollback removes the certificate fields and SDK/report/bundle integration.
Existing packages, Wasm, and manifests without `resourceCertificate` require no
migration.
