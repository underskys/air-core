# QA_REPORT

## Required Fields

- title:
- repo:
- branch:
- commit:
- bundleKind:
- status: pass | fail | blocked
- checksRun:
- findings:
- residualRisk:
- recommendation:

## Scope

What was checked and what was intentionally not checked.

## Package Surface

Package allowlist and npm dry-run status when relevant.

## Release Lane

Release lane status when relevant.

## Example

```yaml
title: Release governance QA
status: pass
checksRun:
  - node scripts/check_markdown_links.js
  - git diff --check
recommendation: proceed
```
