# AIR Release Slices Policy

Status: active release policy

AIR planning uses milestone versions and internal slices. npm uses public
package versions. These are intentionally separate.

## Version Types

Milestone versions name a public planning window:

- `v0.45`
- `v0.46`

Internal slices name work chunks inside a milestone:

- `M45-S1`
- `M45-S2`
- `M45-S3`

Public npm versions name actual public package releases:

- `0.45.0`
- `0.45.1`
- `0.45.2`

Internal slices are not npm versions. Do not spend npm patch versions on
unpublished internal work. Patch versions are only for actual public package
releases or release candidates that are intended to become public package
state.

Breaking changes, semantic changes, AIR ABI changes, Host ABI changes, or
behavior changes require release notes, compatibility review, and consumer
replay evidence before release.

## v0.45 Example Slices

- `M45-S1`: release hygiene and quickstart.
- `M45-S2`: anti-hallucination demo.
- `M45-S3`: MathLab consumer demo pressure.
- `M45-S4`: demo portfolio index.
- `M45-S5`: external smoke and launch readiness.

## v0.46 Planning Rule

`v0.46` slices must be created as internal planning identifiers first. They
must not reserve npm patch versions until a public release candidate exists and
release notes identify the externally visible change.

