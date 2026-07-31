# f32 Math Basic Lowering Fixture

This fixture records the current v0.46 executable behavior for existing AIR
`f32.sqrt`, `f32.sin`, and `f32.cos` operations.

It covers:

- `f32.sqrt` on a positive value;
- `f32.sqrt` on zero;
- `f32.sqrt` on a negative value, expected to produce NaN on the Wasm path;
- `f32.sin` on representative inputs;
- `f32.cos` on representative inputs;
- linked Wasm execution for the package export path.

It intentionally does not add new math operations, host imports, tensors,
runtime JSON/object values, f64 expansion, or GPU/native acceleration.

Support status:

- verifier: pass
- package/report: pass
- single-module lower_wasm: pass
- linked Wasm: pass for this representative one-module package fixture
- host shim: n/a

The expected values are checked with the tolerance policy documented in
`docs/release/F32_MATH_SEMANTICS_v0_46.md`. The fixture must not be used to
claim bit-identical behavior across untested runtimes or backends.
