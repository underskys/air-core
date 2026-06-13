# E2E Lan Observer Readonly Basic

Measures the v0.38 end-to-end proof path for the sanitized
lan-observer-style read-only package.

The benchmark uses only checked-in fixture data:

- package-check and verification evidence;
- conformance replay for the sanitized batch trace;
- runtime E2E proof over one scalar structured row;
- mock host policy simulation;
- evidence report generation.

No real network, OS device access, secrets, raw hostnames, MACs, IPs, packet
dumps, or external services are used.

Known limitations:

- first-slice proof executes one sanitized rowset row;
- host crossing count is `0` unless bounded `output.emit` is used;
- benchmark timings are local measurements and are not performance claims.
