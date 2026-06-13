# Dependency License Audit

Status: initial dependency license audit for AIR public alpha.

## Runtime/npm Dependencies

| Package | Version Source | License | Status | Notes |
| --- | --- | --- | --- | --- |
| `wabt` | `package-lock.json`: `1.0.39` | Apache-2.0 | Compatible | Used for WAT/Wasm tooling in local build/test flows. Dependency package includes its own Apache-2.0 LICENSE. |

## Root Package

| Field | Status |
| --- | --- |
| `license` | `Apache-2.0` |
| `private` | Removed for public package metadata readiness. No npm publish was performed. |
| `author` | `Dmitriii` |

## Notes

- The repository has no additional npm runtime dependencies beyond `wabt` at
  this audit point.
- `hosts/webgpu/` has its own package metadata and lockfile. It is classified
  as public-later/host-specific surface in the public cut matrix and is excluded
  from the root `.npmignore` package plan.
- If host packages or demo packages become public artifacts, audit those
  package dependency trees separately before release.
- This audit does not replace a legal review; it records the current technical
  dependency license state for the alpha launch cut.
