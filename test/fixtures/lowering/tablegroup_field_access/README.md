# Tablegroup Field Access Lowering Fixture

This fixture captures the v0.46 tablegroup lowering decision point.

The package verifies and reports tablegroup field access using the accepted AIR
spelling:

```air
tablegroup.get.i32 @level_sections.x, %index
```

Current expected support:

- verifier: pass
- report/package: pass
- single-module lower_wasm: pass
- linked Wasm: expected fail
- host shim: none in Core

The linked-Wasm failure is intentional and visible. It records the current gap
where merged package lowering does not yet preserve tablegroup field access as
native linked executable support.

Expected linked diagnostic:

```text
unknown table level_sections.x
```
