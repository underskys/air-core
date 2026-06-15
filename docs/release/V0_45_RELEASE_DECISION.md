# v0.45 Release Decision

Status: accepted as dev planning/audit milestone; not approved as npm/public
package release as-is.

Reference dev/private review bundle: commit `ef24919`.

## Decision

v0.45 is accepted as a completed planning/audit milestone for the Math & Host
Profile Roadmap.

v0.45 is not approved as an npm/public package release as-is. The dev/private
review bundle passed bundle review checks for its own review purpose, but it is
not directly public-release-ready and must not be published or merged wholesale
into public package state.

## Public Release Classification

- v0.45 public sync requires a scoped public-clean cherry-pick.
- v0.45 package identity in the dev bundle is stale: `air-core@0.44.0`.
- Current public package identity is `@underskys/air-core`.
- Current npm published package is `@underskys/air-core@0.44.1`.
- `0.44.2` is not a planned public npm release unless an urgent
  package-breaking fix is required for the already published `0.44.1` package.
- README/docs/positioning/roadmap/release-governance work should accumulate as
  internal `v0.45` slices toward `@underskys/air-core@0.45.0`.
- v0.45 states no release packaging or npm publish work.
- v0.45 did not implement new math operations.
- v0.45 contains no AIR ABI change.
- v0.45 contains no Host ABI change.

## Required Public Sync Rule

Any v0.45 material considered for public `air-core` must be reviewed as a
minimal public-clean diff. The sync must not:

- publish npm;
- create a tag;
- change AIR ABI;
- change Host ABI;
- add language features;
- copy the whole dev bundle;
- copy private or review artifacts;
- overwrite public package identity;
- regress README or package description language.

## Public-Clean Sync Candidates

The v0.45 planning documents are not copied wholesale into this repository by
this decision. Candidate material for future public-clean sync:

- `V0_45_RELEASE_PLAN.md`
- `FEATURE_STATUS_v0.45.md`
- `MATH_SURFACE_AUDIT_v0_45.md`
- `rfcs/v0.45-math-and-numeric-semantics.md`
- `rfcs/v0.45-host-profile-roadmap.md`
- `rfcs/v0.45-airmatlab-pressure.md`
- request ledger entry for AirMatLab math foundation

Each candidate needs its own scoped review before landing in public release
state.

## Follow-On Recommendation

v0.46 is recommended as the first executable math stabilization slice. It
should stabilize existing accepted math behavior before expanding math surface
area, and it should not change AIR ABI or Host ABI without explicit review.
