# AIR v0.45.1 Release Notes

Status: Show HN package presentation patch candidate. No npm publication has
been performed from this document.

Package: `@underskys/air-core@0.45.1`

Planned tag: `v0.45.1`

Planned npm dist-tag: `alpha`

Install after publish:

```sh
npm install -g @underskys/air-core@alpha
airc version --json
```

## Summary

v0.45.1 is a README/package presentation patch for the already published
`@underskys/air-core@0.45.0` public alpha. It prepares the package for Show HN
review by hardening the README first screen and package-rendered Markdown.

## Included

- Package identity prepared as `@underskys/air-core@0.45.1`.
- README first screen keeps headings, paragraphs, bullets, and the Adobe AIR
  note separated with explicit Markdown spacing.
- README Docs Links remain absolute GitLab links.
- CLI remains `airc`.
- License remains `Apache-2.0`.

## Not Included

- No npm publish in this preparation task.
- No git tag creation in this preparation task.
- No AIR ABI change.
- No Host ABI change.
- No compiler, verifier, or lowerer behavior change.
- No new language features.
- No new math operations.
- No Control Plane files.

## ABI Status

| Axis | v0.45.1 status |
| --- | --- |
| AIR ABI | remains `0.10` |
| Host ABI | latest remains `0.11`; `0.10` baseline remains supported |
| Spec family | remains `0.10` family |
| Package version | `0.45.1` |

Tag and npm publish require a separate OK/STOP release decision.
