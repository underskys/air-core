# Linked Wasm Basic Lowering Fixture

This fixture covers the v0.46 supported linked-Wasm first slice for a small
authored package graph.

It contains two authored AIR modules:

- `main.air` owns the package export `run`.
- `math.air` owns a pure helper used by `main.air`.

Expected support:

- verifier: pass
- report/package: pass
- single-module lowering: not the fixture target
- linked Wasm: pass
- host shim: none

Expected runtime result:

```json
{ "export": "run", "args": [20], "return": 42 }
```
