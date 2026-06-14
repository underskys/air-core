# AIR Workspace State Report

Timestamp: 2026-06-14T13:24:54+03:00

## Repositories

| Role | Repository | Branch | HEAD |
| --- | --- | --- | --- |
| Production/public | `air-core` | `release/v0.44.x-hygiene` | `3d0f5ea89f857b2ac9a3ec799cdbc09b73104cba` |
| Dev/private/reference | `airlang` | `main` | `8ef8beb8d7d2223f6644ef9067df8432af5e8b0b` |

Production remote:

```text
git@gitlab.com:fd.skyrealm/air-core.git
```

Dev remote:

```text
git@gitlab.com:fd.skyrealm/airlang.git
```

## Package Identities

| Repo | Package | Version | CLI | License |
| --- | --- | --- | --- | --- |
| `air-core` | `@underskys/air-core` | `0.44.2` | `airc` | `Apache-2.0` |
| `airlang` | `air-core` | `0.44.0` | `airc` | `Apache-2.0` |

Observed npm package:

```text
@underskys/air-core@alpha = 0.44.1
dist-tags: alpha=0.44.1, latest=0.44.1
published versions: 0.44.1
```

Local `air-core` is prepared as `0.44.2`; npm still shows `0.44.1` published.
No npm publish was run during this task.

## Release Tags

Production tags observed:

- `v0.44.1`
- `v0.44.0`

Dev/private tags include historical archive/demo tags such as
`archive/demo-airdoom-standalone-migration`,
`archive/demo-contra-standalone-migration`, and
`archive/demo-voxel-standalone-migration`. These are reference/history only and
are not production release tags.

## CI Status

`air-core` has GitLab CI stages for test, pack, and protected manual npm
publish. The CI configuration checks `@underskys/air-core`, version `0.44.2`,
the `airc` binary, tests, bundle tests, public package surface, public claims,
markdown links, and dry-run packaging.

No live remote pipeline status was queried in this local workspace report.

## Comparison Summary

`air-core` is already the public release lane for AIR. It has the scoped npm
package identity, current public install command, public docs, release lane
policy, bundle policy, public package surface checks, and CI publish gate.

`airlang` is a dev/private repository. It is locally ahead of origin, keeps an
older unscoped package identity, and contains private or pressure areas such as
prompts, review results, consumer evidence, demos, kits, hosts, generated
snapshots, and public export staging. It must remain read-only for release-state
work.

## Difference Classification

| Path/topic | Source repo | Class | Recommendation |
| --- | --- | --- | --- |
| Package name `@underskys/air-core` | `air-core` | A | Already synced as production identity. |
| Package name `air-core` | `airlang` | C | Dev/private historical identity; do not release from it. |
| Package version `0.44.2` | `air-core` | A | Production candidate version; keep in release lane. |
| Published npm version `0.44.1` | npm registry | F | Human release decision required before any `0.44.2` publish. |
| README product positioning | `air-core` | A | Public AIR positioning is current. |
| README install command | `air-core` | A | Uses `@underskys/air-core@alpha`. |
| README old install wording | `airlang` | C | Historical/dev only. |
| `.gitlab-ci.yml` scoped package checks | `air-core` | A | Production CI is aligned with scoped package. |
| `.gitlab-ci.yml` unscoped package checks | `airlang` | C | Dev/private only. |
| `scripts/check_public_package_surface.js` | `air-core` | A | Keep as production public package gate. |
| `scripts/check_public_claims.js` | `air-core` | A | Keep as production public claims gate. |
| `scripts/check_release_lane.js` | `air-core` | A | Keep as production release-lane gate. |
| `REVIEW_RESULTS/` | `airlang` | C | Private/review output; never copy into release source. |
| `prompts/` and `evals/ai_authoring/prompts` | `airlang` | C | Private/dev prompt material; never copy raw. |
| `consumer_evidence/` and `snapshots/consumer_evidence` | `airlang` | D | Consumer pressure; package separately only after explicit sanitization. |
| `demo/` and `demo_snapshots/` | `airlang` | D | Demo pressure; separate branch or repo only. |
| `hosts/` and `kits/` | `airlang` | D | Host/kit pressure; not release source. |
| `public_export/` | `airlang` | C | Staging artifact; never copy directly. |
| Generated review zip snapshots | `airlang` | C | Generated archive artifacts; never copy into release source. |
| `node_modules/` | `airlang` | C | Dependency output; never copy. |
| Dev repo ahead of origin by 4 commits | `airlang` | F | Human decision required if any history needs later review. |
| Production current branch not `main` | `air-core` | F | This is a release hygiene branch; merge policy decision remains human-owned. |

Classes:

- A: already synced / no action.
- B: public-safe candidate for `air-core`, needs separate review.
- C: dev/private only, never copy to `air-core`.
- D: demo/consumer pressure, separate repo/branch only.
- E: release blocker in `air-core`.
- F: unknown / requires human decision.

## Current Blockers

No `air-core` package identity blocker was found.

Human decisions remain required for:

- whether and when to merge `release/v0.44.x-hygiene` into `main`;
- whether and when to publish `@underskys/air-core@0.44.2`;
- whether any locally ahead `airlang` commits contain public-safe candidates.

## Next Recommended Codex Tasks

1. Run the full `air-core` release check set after these docs and scripts land.
2. Merge the release hygiene branch according to the protected `air-core`
   workflow.
3. Produce a separate OK/STOP report before any tag or npm publish.
4. Keep `airlang` read-only unless a specific public-clean cherry-pick review
   is requested.
