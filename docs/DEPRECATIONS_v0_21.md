# AIR v0.21 Deprecations

Status: planning inventory

This document lists legacy or discouraged API surfaces for the v0.21 API
rebaseline. It does not remove compatibility behavior, change compiler
semantics, change AIR ABI, or change Host ABI.

Deprecation states:

- `legacy`: supported for compatibility, but not the canonical v0.21 path.
- `deprecated`: should be migrated when practical; future strict gates may warn
  or fail.
- `experimental`: may change behind release gates.
- `internal`: not public API and not adoption guidance.

| Surface | Status | Replacement | Deprecation timeline | Allowed compatibility mode | Later strict mode behavior |
| --- | --- | --- | --- | --- | --- |
| Scalar-only host/adaptor input surfaces for structured facts | legacy | Bounded facts schemas and bounded rowset schemas under `factSchemas`. | v0.21 documents migration; v0.22+ may warn on new canonical examples that avoid bounded schemas. | Existing scalar adapters remain valid for small decisions and compatibility packages. | Canonical examples may be required to expose bounded fact/rowset metadata when structured inputs are present. |
| Dozens of scalar call parameters for task/status/link/note summaries | deprecated | Bounded rowset schemas with scalar columns, privacy metadata, and fixed `maxRows`. | v0.21 planning; v0.22+ candidate for report/LSP warning in canonical examples. | Existing modules continue to verify if they satisfy current AIR rules. | New canonical examples may fail review if structured host facts are modeled only as ad-hoc scalar parameter lists. |
| Ad-hoc output scalar return paths for host-visible intents | legacy | Output Contract manifests plus package-local command buffers. | v0.21 documents replacement; v0.22+ may require canonical examples to use command buffer output intents. | Simple scalar returns remain valid for pure computation and compatibility modules. | Host-visible output intent examples may be required to declare `outputContracts` and `commandBuffers`. |
| Debug or metric-like output signaling | deprecated | Output Contract manifests, command buffers, and deterministic conformance records. | Already discouraged by event/output boundary docs; v0.21 keeps the boundary visible. | Diagnostic metrics remain allowed for diagnostics-only use. | Review policy may fail event-bus-like `debug.metric` usage in release-candidate profiles. |
| Examples that rely on undocumented legacy APIs | legacy | Canonical examples should use documented CLI, package manifest, bounded data, output contract, verification evidence, and conformance surfaces. | v0.21 inventory; migrations are P1 and should be small and explicit. | Existing examples may remain while labeled or treated as compatibility examples. | Future release gates may distinguish canonical examples from legacy examples and fail undocumented API usage in canonical examples. |
| Demo-local host imports not promoted to kits or host profiles | internal | Host profile RFCs, reusable kits, or project-local demo documentation. | v0.21 documents classification; promotion requires separate RFC/spec/profile/tests. | Demo-local imports remain outside Core public API. | Core, stdlib, canonical examples, and public Host ABI must reject demo-specific host imports. |
| Report claims without verification evidence | deprecated | `airc verify package <dir> --json` with `kind: "air.verificationEvidence"`. | v0.21 documents verification evidence as canonical; v0.22+ may require it in canonical package review artifacts. | Human-readable reports remain useful, but should not be treated as release evidence alone. | Release or canonical package gates may require deterministic verification evidence for machine-readable claims. |
| Package or bundle claims without artifact validation | legacy | `check-airpkg`, `check-bundle`, and verification evidence. | v0.21 compatibility; future gates may require validation for release artifacts. | Existing package/bundle workflows continue to run. | Release artifacts may be required to show validation evidence before review-ready status. |
| Output intent execution implied by metadata | deprecated | Host policy execution decision outside AIR, after reviewing command intent records. | v0.21 documents host ownership. | Metadata may describe output intents, but must not imply automatic execution. | Future checks may fail docs/examples that imply host-side action execution without an accepted Host ABI/profile. |

## Compatibility Rules

- Legacy surfaces are not removed in v0.21.
- Existing packages should keep working unless they already violate current
  verifier, package-check, or Host ABI rules.
- New canonical examples should prefer bounded facts/rowsets, Output Contracts,
  command buffers, verification evidence, and deterministic conformance.
- Deprecated usage should become report/LSP-visible before it becomes a hard
  release gate.

## ABI Status

- AIR ABI remains `0.10`.
- Host ABI remains `0.10`.
- No Host ABI `0.11`, `output.emit`, `output.event`, `audio.event`, or
  `effect.event` is introduced by this deprecation plan.
