# Core Data Ergonomics Request

Status: proposed
Target layer: core
Source requests: [Voxel Demo ABI Request Triage](voxel-demo.md)

Formal ledger decisions:
[Static Tables And Readonly Tablegroups](../../requests/accepted/static-tables-tablegroups.md)
and [Generated Handle Freshness](../../requests/accepted/generated-handle-freshness.md).

Design RFC: [RFC_CORE_GENERATED_DATA_v0.12.md](../RFC_CORE_GENERATED_DATA_v0.12.md)

## Problem

AI-authored AIR modules often need stable IDs, thresholds, handles, colors, and
small deterministic lookup data. Today those values are usually repeated as raw
numbers inside functions, which makes review harder and increases the risk that
project-specific constants are mistaken for public stdlib or ABI concepts.

## Scope To Investigate

- Module-level constants.
- Enum-like scalar handles.
- Static table-like deterministic data.
- Formatter output and canonical AIR style.
- Verifier accounting, type checking, and repair hints.
- Lowering strategy and memory layout.
- WIT/package metadata implications.
- Compatibility with v0.10 examples.

## Non-Goals

- Do not add demo material IDs, palettes, spawn tables, animal dimensions, or
  project-specific names to stdlib or Core.
- Do not implement this as part of v0.11 host/package polish.
- Do not add syntax without parser, formatter, verifier, lowering, docs, and
  tests.

## Decision

proposed

This is a Core design request, not an accepted implementation task.
