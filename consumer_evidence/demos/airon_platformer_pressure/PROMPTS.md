# AIRON Platformer Pressure Prompt Notes

Status: pending

No safe captured AI prompt is tracked for this pressure-only entry.

## Prompt Summary

- Goal: classify platformer demo pressure without importing demo source.
- Constraints: no game-specific Core APIs, no tablegroups implementation, no
  declared pools implementation, no output event imports.
- Expected AIR boundary: generic pressure routing only.
- Forbidden surfaces: raw host authority and demo-local behavior promoted to
  Core.

## Repair Notes

- Safe repair direction: route generic pressure through RFC/gates and keep demo
  behavior demo-local.
