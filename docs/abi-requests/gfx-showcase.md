# GFX Showcase Requests

Status: proposed
Target layer: host implementation

Formal ledger decision:
[GFX Showcase New ABI](../../requests/rejected/gfx-showcase-new-abi.md).

## Source Demo/Project

`examples/gfx_showcase`, the public browser WebGPU proof package.

## Problem

The showcase demonstrates AIR GFX package flow, render graph metadata, assets,
materials, and diagnostics. The current WebGPU host intentionally reports some
features as unsupported rather than pretending full renderer support exists.

## Current Workaround

The host renders deterministic placeholder output and surfaces unsupported
feature diagnostics in the browser report.

## Proposed Generic API

No new ABI functions are requested. The immediate need is host implementation
and report polish behind existing package, manifest, and conformance surfaces.

## Why Generic

Clear unsupported-feature reporting and package inspection apply to any AIR GFX
package, not just the showcase.

## Why Not Project-Specific

The showcase is a public proof package, but its art direction and asset keys are
example content. Renderer capability reporting is generic; showcase visuals are
not.

## Alternatives

- Keep placeholder rendering but improve diagnostics.
- Implement missing host support behind existing manifest fields.
- Add migration notes only if report fields must change.

## Compatibility Risk

Report polish should remain compatible with v0.10 examples where practical.
Any report schema change needs migration notes and tests.

## Decision

proposed

Default triage is `host implementation` or `manifest schema` polish, not new
AIR Core or stdlib behavior.
