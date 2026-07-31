# Borrowed Memory Browser Conformance

`browser_conformance.mjs` uses the repository's existing Playwright/Chromium
host dependency to instantiate the same deterministic Wasm bytes exercised by
the Node reference test.

The browser runner covers the vector affine and bounded checksum kernels in
both `copied_into_wasm` and `wasm_memory_view` transfer modes. It checks the
borrowed-slice ABI marker and returns raw output bytes. The runner hashes those
returned bytes and the exact Wasm inputs in its Node controller before emitting
the result.

This is a generic Wasm conformance fixture. It uses no media, device, network,
filesystem, timer, or other ambient authority inside AIR.

The full descriptor validation and invocation-evidence contract is exercised by
the Node reference binding. The browser fixture checks the same ABI tuples,
copy/view transfer behavior, Wasm bytes, operation order, and output bytes; it
does not claim to be a second implementation of the SDK validator.
