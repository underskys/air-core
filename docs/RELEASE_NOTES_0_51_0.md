# AIR v0.51.0-alpha Release Notes

Package candidate: `@underskys/air-core@0.51.0`

Planned dist-tag: `alpha`

CLI: `airc`

## Scope

This candidate promotes the frozen `v0.51` reference substrate into the
public AIR Core repository. It includes canonical typed-value handling,
candidate typed-interface validation, checked numeric runtime coverage,
canonical sum-ABI ingress validation, executable conformance runners, and a
product-neutral AIRSwift conformance host.

## ABI Status

- Existing AIR ABI `0.10` and `0.11` modules remain supported.
- The typed-decisions surface is a candidate lane, AIR ABI `0.12`.
- AIR ABI `0.12` is enabled only by the explicit
  `allowCandidateAbi012: true` option and may change before `v1.0`.
- Host ABI `0.10` and `0.11` remain unchanged.
- Frozen `v0.51` semantics are versioned by specification, not npm patch
  releases.

## Publication State

This document describes a promotion candidate, not a completed publication.
Independent review of the exact candidate diff and tarball is required before
any `npm publish --tag alpha` action. The candidate does not move npm `latest`.
