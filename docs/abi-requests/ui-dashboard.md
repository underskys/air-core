# UI Dashboard Requests

Status: proposed
Target layer: host ABI

Formal ledger decisions:
[UI Dashboard New Host ABI](../../requests/rejected/ui-dashboard-new-host-abi.md)
and [Event And Output Intent Surface](../../requests/accepted/event-intent-surface.md).

## Source Demo/Project

Planned v0.11 non-game UI/dashboard demo.

## Problem

AIR needs a small product demo that is not game-shaped. A dashboard demo
should show AIR emitting deterministic UI/status/metric decisions through
capability-scoped scalar commands while the host owns real UI rendering.

## Current Workaround

Existing UI examples and specs validate dashboard-style host ABI concepts, but
v0.11 still needs a polished product loop demo and clearer report path.

## Proposed Generic API

Start with existing `ui.*` commands and manifest validation. File separate
requests only if the demo proves a missing generic dashboard command or report
field.

## Why Generic

Metrics, status panels, validation results, tables, warnings, and simple charts
are broadly useful for tools and automations beyond one demo.

## Why Not Project-Specific

Dashboard primitives should avoid project-specific labels, visual themes,
service names, or business rules. AIR should emit scalar UI commands; the host
chooses actual DOM/native layout and styling.

## Alternatives

- Use existing `ui.*` ABI and stdlib wrappers.
- Keep demo-specific labels/data in the example manifest or project.
- Improve host implementation/reporting before adding ABI surface.

## Compatibility Risk

Adding UI host ABI must preserve v0.10 examples where practical. Any new public
command requires spec updates, host ABI registry coverage, verifier tests, and
migration notes if existing report output changes.

## Decision

proposed

Default triage is to build the demo on existing UI ABI first, then promote only
proven generic gaps.
