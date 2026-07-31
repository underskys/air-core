# AIR v0.50.0 Release Notes

Status: public release candidate. This document does not publish the package,
create a tag, or change an npm dist-tag.

Package: `@underskys/air-core@0.50.0`

CLI: `airc`

## What Users Gain Since v0.45.1

- Refinement types for bounded integer and slice-length facts.
- Provenance and bounded information-flow verification for supported explicit
  sources, sinks, dependencies, control dependencies, and declassification.
- Verified Resource Certificates and semantic patches with fail-closed
  non-expansion checks.
- An embedding facade and bounded agent tool-gate.
- Region bounds and memory-boundary integrity.
- Opt-in `borrowed_slice` with AIR ABI `0.11`.
- A `realtime_safe` structural profile and stronger deterministic evidence,
  replay, and conformance coverage.

## Compatibility

- Existing AIR ABI `0.10` modules remain supported.
- Borrowed slices use opt-in AIR ABI `0.11`.
- Host ABI is not redefined by this release.

## Limits And Boundaries

- No malicious-host safety guarantee.
- No universal noninterference proof.
- No universal realtime deadline.
- No implied zero-copy transfer.
- Only explicitly tested host/engine conformance is claimed.
- AIR remains a bounded component language; the host retains rendering, I/O,
  UI, assets, networking, hardware, and platform authority.

## Further Reading

- [Refinement Types MVP](https://gitlab.com/fd.skyrealm/air-core/-/blob/main/docs/REFINEMENT_TYPES_MVP.md)
- [Provenance Flow MVP](https://gitlab.com/fd.skyrealm/air-core/-/blob/main/docs/PROVENANCE_FLOW_MVP.md)
- [Verified Resource Certificate](https://gitlab.com/fd.skyrealm/air-core/-/blob/main/docs/VERIFIED_RESOURCE_CERTIFICATE.md)
- [Semantic Patches](https://gitlab.com/fd.skyrealm/air-core/-/blob/main/docs/SEMANTIC_PATCHES.md)
- [Embedding Facade](https://gitlab.com/fd.skyrealm/air-core/-/blob/main/docs/EMBEDDING_FACADE.md)
- [Borrowed Slices RFC](https://gitlab.com/fd.skyrealm/air-core/-/blob/main/docs/rfcs/BORROWED_SLICES_v0_50.md)
