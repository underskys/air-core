# Versioning

AIR uses several version axes. They are related, but they do not mean the same
thing.

## Product / Package Version

The product/package version identifies an AIR release artifact such as the npm
package metadata in `package.json`.

AIR is the project name. `@underskys/air-core` is the npm package. `airc` is the CLI.

Current public alpha package version:

- `@underskys/air-core@0.44.2`

Alpha releases may change behavior. Breaking semantic changes require a
migration note. Publishing is a separate release action and is not implied by a
version field change.

## Milestone Version

Milestone versions such as `v0.42` or `v0.43` describe roadmap slices and
review scope. A milestone may be documentation-only, implementation-focused, or
release-hygiene focused.

Milestone versions do not automatically change AIR ABI or Host ABI.

## Internal Slices vs Public Package Versions

Milestone versions such as `v0.45` and `v0.46` may be split into internal slice
ids such as `M45-S1`, `M45-S2`, and `M45-S3`.

Internal slices are not npm versions. Public package versions use package
versions such as `0.45.0`, `0.45.1`, and later patch releases.

Rules:

- do not burn npm patch numbers for unpublished internal work;
- patch versions are only for actual public package releases or release
  candidates intended to become public package state;
- semantic tightening needs migration notes and consumer replay where relevant.

Example `v0.45` slices:

- `M45-S1`: release hygiene and quickstart;
- `M45-S2`: anti-hallucination demo;
- `M45-S3`: MathLab consumer-demo pressure;
- `M45-S4`: demo portfolio index;
- `M45-S5`: external smoke and launch readiness.

## AIR ABI Version

The AIR ABI version describes the executable AIR module/runtime contract.

Current AIR ABI:

- `0.10`

AIR ABI changes require explicit review, migration notes, and compatibility
matrix updates.

## Host ABI Version

The Host ABI version describes the host import/signature/semantic contract.

Current Host ABI:

- latest: `0.11`
- baseline supported for packages without bounded `output.emit`: `0.10`

Host ABI `0.11` is limited to bounded `output.emit`. Host ABI changes require
explicit review and compatibility matrix updates.

## Spec Version

The spec version describes the documented language, package, and host-profile
surface. AIR currently treats the public spec as part of the `0.10` family while
the package version and milestone version move independently.

## Conformance Suite Version

The conformance suite version is the repository test and fixture state used to
check compatibility. Public conformance claims should include the repository
commit and commands used to reproduce them.

## Compatibility Matrix

| Product version | Milestone | AIR ABI | Host ABI | Spec | Conformance | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `@underskys/air-core@0.44.2` | `v0.44 active` | `0.10` | `0.11` latest, `0.10` baseline | `0.10` family | repository tests and fixtures | Public-alpha packaging and release-smoke checkpoint. Host ABI `0.11` is limited to bounded `output.emit`. |

## Policy

- Alpha releases can break behavior.
- Breaking semantic changes require a changelog migration note.
- AIR ABI changes require an explicit AIR ABI version bump.
- Host ABI changes require compatibility matrix updates.
- Evidence reports and conformance results should name the exact commit and
  command list used.
