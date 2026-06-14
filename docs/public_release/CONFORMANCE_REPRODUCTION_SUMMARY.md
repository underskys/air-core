# Conformance Reproduction Summary

Status: implemented/P0 for the v0.43 public-alpha checkpoint.

This summary records the conformance commands reproduced from this repository.
It does not claim results from external suites that are not included here.

## Repository

| Field | Value |
| --- | --- |
| Branch | `main` |
| Package version | `0.44.2` |
| AIR ABI | `0.10` |
| Host ABI | latest `0.11`, limited to bounded `output.emit`; baseline `0.10` supported |

## Commands Run

| Command | Result |
| --- | --- |
| `npm test` | pass |
| `npm run test:bundle` | pass |
| `node scripts/check_markdown_links.js` | pass |
| `node scripts/check_request_ledger.js` | pass |
| `node scripts/check_public_package_surface.js` | pass |

## Independent air-tests Status

Independent `air-tests` were not present in this repository as a runnable
public copy, submodule, or package script for this checkpoint.

Result:

- air-tests present: no
- air-tests public reproduction: pending / not included in repo
- `74/74` reproduced in this repo: no

Launch copy must not claim `air-tests 74/74` from the public repository until
the exact public-clean suite is added or referenced and reproduced from this
repo.

## Scope

The reproduced commands cover the current AIR Core reference implementation:

- parser/formatter behavior;
- verifier diagnostics and safety checks;
- lowering/build behavior for supported operations;
- package and manifest checks;
- conformance replay fixtures;
- evidence/report output shapes;
- request ledger and public package surface checks.

Consumer evidence and external demo pressure are not Core conformance. They
remain intake/review evidence unless promoted through accepted RFCs, gates, and
conformance fixtures.

## ABI Status

- AIR ABI remains `0.10`.
- Host ABI remains unchanged.
- No Host ABI imports are added by this checkpoint.
