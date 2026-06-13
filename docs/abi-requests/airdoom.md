# AirDoom Project Kit Requests

Status: proposed
Target layer: project kit

Formal ledger decision:
[AirDoom Project Kit Requests](../../requests/rejected/airdoom-project-kit.md).

## Source Demo/Project

`demo/airdoom`, the AIR-first arena Project Kit.

## Problem

AirDoom exercises first-person controller logic, collision, sky/environment
rendering, material selection, and arena composition. These needs create useful
pressure on AIR, but many details are intentionally game-specific.

## Current Workaround

The demo keeps arena parts, material handles, pickup/teleporter semantics,
routes, and art direction in `demo/airdoom`. AIR emits scalar commands and the
host owns rendering, input devices, assets, audio, and platform integration.

## Proposed Generic API

No public ABI change is requested by default. Potential generic follow-ups
should be split into separate requests, such as:

- generic collision helper improvements;
- manifest-level environment/sky asset metadata;
- clearer conformance reporting for unsupported host rendering features.

## Why Generic

Only the narrow helper/reporting needs above may be generic. AirDoom-specific
materials, routes, objects, and gameplay rules are not generic.

## Why Not Project-Specific

Most AirDoom requests should remain project-specific unless another independent
demo needs the same behavior without AirDoom names or assumptions.

## Alternatives

- Keep behavior in the AirDoom Project Kit.
- Extract reusable resources into a reusable kit only after names and parameters
  are project-neutral.
- Use existing `gfx.*`, `gpu.*`, `input.*`, and manifest surfaces where
  practical.

## Compatibility Risk

Promoting AirDoom concepts directly into public ABI risks contaminating stdlib
or Core with demo semantics. Any accepted public request must include specs,
tests, and migration notes if it changes v0.10 behavior.

## Decision

proposed

Default triage is `project-only` until a specific generic request is filed with
evidence from more than one demo or host.
