# AIR Release Versioning Policy

Status: active policy

AIR uses separate version axes for internal slices, public package versions, AIR
ABI, and Host ABI.

## Internal Slices

Internal slices name work chunks inside a milestone:

- `M45-S1`;
- `M45-S2`;
- `M45-S3`.

Internal slices are planning and review identifiers. They are not npm versions.

## Public Versions

Public versions name public package/release candidates or published releases:

- `0.45.0`;
- `0.45.1`;
- `0.45.2`.

Do not use npm patch versions for unpublished internal slices. Patch versions
are only for fixes to already-published packages.

`@underskys/air-core@0.44.1` remains the first published public alpha. Do not
publish `0.44.2` unless an urgent package-breaking fix is required for
`0.44.1`. The active public alpha release candidate is
`@underskys/air-core@0.45.0`; publish it later with dist-tag `alpha` only after
the separate tag/release decision.

Internal slices may be squashed or combined into one public version. For
example, `M45-S1`, `M45-S2`, and `M45-S3` may all land as `0.45.0` if they are
reviewed and released together.

Package version changes only for public release candidates or actual public
releases.

## ABI Axes

AIR ABI and Host ABI are independent version axes.

- AIR ABI changes require RFC, compatibility matrix, migration note,
  conformance fixture, report/evidence visibility, and gates.
- Host ABI changes require RFC, compatibility matrix, migration note,
  conformance fixture, report/evidence visibility, and gates.
- Demo-specific ABI is not accepted.
- Raw host authority is not accepted.

Public package version changes do not imply AIR ABI or Host ABI changes.
