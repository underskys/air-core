# Output Emit Trace Lowering Fixture

This fixture records the existing bounded `output.emit` executable path under
Host ABI `0.11`.

It is intentionally small:

- AIR owns the deterministic decision to emit output id `1`.
- Host owns the real side effect behind `output.emit`.
- The test host records the import call as a trace.

Expected support:

- verifier: pass
- report/package: pass
- single-module lower_wasm: pass
- linked Wasm: pass for this scalar package shape
- host shim: test import only
