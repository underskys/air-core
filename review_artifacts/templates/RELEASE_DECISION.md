# RELEASE_DECISION

## Required Fields

- title:
- publicVersion:
- internalSlice:
- repo:
- branch:
- commit:
- bundleKind:
- decision: merge | tag | publish | block
- releaseManager:
- airAbiStatus:
- hostAbiStatus:
- npmPackage:
- packageVersion:
- publishRunByCodex: no

## Gates

- tests:
- packageSurface:
- publicClaims:
- requestLedger:
- abiRequests:
- npmPack:

## Blockers

List blockers or `none`.

## Example

```yaml
title: v0.45 release decision
decision: block
npmPackage: '@underskys/air-core'
publishRunByCodex: no
```
