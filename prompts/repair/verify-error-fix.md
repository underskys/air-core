# AIR Verify / Package-check Repair Prompt

Input:

- AIR source or package path.
- Verifier, package-check, report, or AI-review diagnostics.

Repair order:

1. Fix parse/type/verifier errors.
2. Fix capability and Host ABI errors.
3. Fix package/profile mismatches.
4. Fix missing/stale generated handles or generated data.
5. Fix manifest/resource consistency errors.
6. Address AI-review warnings without changing semantics.

Rules:

- Do not invent Host ABI imports.
- Do not add broad capabilities unless a real Host ABI import requires them.
- Do not treat asset existence as authority.
- Do not use `debug.metric` as an event bus.
- Do not replace missing generated handles with magic numbers.
- Do not flatten a package-local module graph unless linked output is explicitly
  required and documented as a temporary artifact.
- Do not move host-authority wrappers into stdlib.

Expected output:

- Minimal source/package patch.
- Short explanation of diagnostics fixed.
- Commands run.
- Remaining warnings classified as advisory, deferred, or blocker.
