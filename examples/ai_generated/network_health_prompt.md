# Prompt Fixture: Network Health Score

Create a small AIR module for an internal dashboard demo.

Inputs:

- latency in milliseconds;
- packet loss percent;
- number of service errors.

Requirements:

- compute a bounded health score from 0 to 100;
- emit debug metrics for score and total penalty;
- use only existing public Host ABI;
- do not perform real network probing;
- do not use filesystem, sockets, package registry, or target packaging.

Expected review path:

1. Format the generated AIR module.
2. Verify capabilities and Host ABI imports.
3. Explain and audit the module.
4. Build WASM where supported.
5. Build an AIR package and run `package-check`.
