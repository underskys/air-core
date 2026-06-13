# Public Conformance Check

Status: v0.43 public-alpha checkpoint document. Current reproduction summary:
[Conformance Reproduction Summary](CONFORMANCE_REPRODUCTION_SUMMARY.md).

This document defines how AIR public alpha conformance should be reproduced
from the public repository. It does not add conformance claims by itself.

## Public Conformance Baseline

The public repository baseline is:

```sh
npm ci
npm test
npm run test:bundle
node scripts/check_markdown_links.js
node scripts/check_request_ledger.js
node scripts/check_abi_requests.js
node test/layer_guard.test.js
```

Optional release checks:

```sh
npm run check:consumer-evidence
npm run consumer-evidence:bundle
bash scripts/run_rc_checks.sh
```

All commands must run without private paths, network access, API keys, provider
SDKs, external services, or external demo repositories.

## air-tests Status

Do not claim an external `air-tests 74/74` result unless that exact suite is
available and reproducible from the public repository or a public referenced
submodule/copy.

Current public-alpha status:

- repository conformance: reproducible through `npm test` and `npm run test:bundle`;
- request ledger and public package surface checks: reproduced for v0.43;
- independent `air-tests 74/74`: pending public reproduction path unless a
  clean public suite is added and documented.

If `air-tests` is added later, this document must record:

- exact path or submodule;
- command;
- expected pass/fail count;
- skipped/manual tests;
- commit used for reproduction;
- whether the suite contains only public-clean fixtures.

## What Counts As Conformance

Core conformance is defined by:

- reference parser and formatter behavior;
- verifier diagnostics and accepted/rejected fixtures;
- lowering/build behavior for supported operations;
- package-check behavior;
- conformance replay fixtures;
- report/evidence output shapes;
- API gates and layer guard checks.

Consumer evidence is not conformance. It records downstream pressure and proof
cards, but it cannot define AIR Core semantics, AIR ABI, Host ABI, package
semantics, or host authority.

## Required Public Result Format

Any public conformance claim should include:

- repository commit;
- command list;
- package version;
- AIR ABI version;
- Host ABI version;
- pass/fail count;
- skipped/manual checks;
- known limitations.

Do not use local absolute paths, machine names, private emails, private branch
names, raw review bundle paths, prompt logs, or private demo paths in public
conformance output.

## Launch Blockers

- `npm test` fails.
- `npm run test:bundle` fails.
- `node scripts/check_request_ledger.js` fails.
- `node scripts/check_abi_requests.js` fails.
- `node scripts/check_markdown_links.js` fails.
- Conformance docs claim `air-tests 74/74` without a public reproduction path.
- Conformance output includes private paths or stale review metadata.
- Promise debt ledger contains unresolved known pressure.

## ABI Status

- AIR ABI remains `0.10`.
- Host ABI latest remains `0.11`, limited to bounded `output.emit`.
- Conformance reproduction does not require Host ABI expansion.
