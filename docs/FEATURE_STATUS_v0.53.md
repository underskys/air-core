# AIR v0.53 Feature Status

Package: `@underskys/air-core@0.53.0`. It contains the never-published 0.52.0
and 0.52.1 and adds the typed-v0.53 source profile as a candidate. No merge,
tag, npm publication or deployment is implied by this file.

## The candidate gate

typed-v0.53 is selected only together with `--allow-candidate-profile` on the
CLI, or `allowCandidateProfile: true` in the SDK. Without it, a typed-v0.53
selection fails with `air.source_profile.candidate_disabled`. `legacy-v0.50`
stays the default and `typed-v0.51` is unchanged. A kill switch in
`src/source_profile.js`, off in every committed state, turns every typed-v0.53
selection into `air.source_profile.unsupported`. The gate is consent, not
security: any caller may pass the flag.

## What 0.53.0 ships

| Surface | Status | Where it is described |
| --- | --- | --- |
| typed-v0.53 source profile | Candidate | `docs/v0.53/RFC_TYPED_V053.md` (the RFC), and `docs/v0.53/` notes, one per slice |
| WorkBound foundation and the CT-1 cost table | Candidate, typed-v0.53 only | `docs/v0.53/P0_02_WORKBOUND_FOUNDATION.md`, `docs/v0.53/CT1_RD3_CLARIFICATION.md` |
| Scalars (i32, i64, f32, bool, checked and wrapping operations) | Candidate | `docs/v0.53/SCALAR.md` |
| Refinements | Candidate | `docs/v0.53/P0_03_REFINEMENTS.md` |
| Calls and structured control flow | Candidate | `docs/v0.53/P0_04_CALLS_CFG.md` |
| Bounded loops (`loop.fold`) | Candidate | `docs/v0.53/P0_05_LOOPS.md` |
| Tables, structs and arrays | Candidate | `docs/v0.53/P0_06_AGGREGATES.md` |
| Constants and module state | Candidate | `docs/v0.53/P0_07_STATE.md` |
| Typed memory and the borrowed lane (AIR ABI lane `0.13`, contract `typed-v0.53.v1`) | Candidate | `docs/v0.53/TYPED_MEMORY.md` |
| Source imports | Candidate | `docs/v0.53/P0_09_IMPORTS.md` |
| Externs, capabilities and effect demand | Candidate | `docs/v0.53/P0_10_EFFECT_DEMAND.md` |
| Migration from legacy-v0.50 (`airc migrate`, M()) | Candidate, partial coverage | `docs/v0.53/MIGRATION.md` |
| The page for models, `llms.txt` and the skill | Shipped in the package | `docs/v0.53/AIR_FOR_MODELS.md` |
| AIR ABI `0.10`, `0.11` | Unchanged | `VERSIONING.md`, `docs/VERSION_AND_ABI_POLICY.md` |
| AIR ABI `0.12` | Candidate only | the same |
| Host ABI `0.10`, `0.11` | Unchanged | the same |
| The ten security and soundness fixes | In 0.53.0 | `CHANGELOG.md` and the 0.53.0 release notes |

The 0.53.0 release notes list every known limit.

## What goes to v0.54

These are outside v0.53 and are referenced only as boundaries:

- the embedded Swift runtime;
- persistent state and session lifecycle;
- logical time and ticks;
- replay;
- runtime effect mediation of demand against grants;
- DecisionEvidence and EffectReceipt evolution;
- generation and revision fencing;
- artifact lifecycle;
- the v0.54 public gate.

A typed realtime session is planned for 0.54; the 0.53 realtime session refuses
typed-v0.53 packages with `air.assurance.profile_unsupported`.
