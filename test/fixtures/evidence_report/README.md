# Evidence Report Golden Fixtures

These fixtures lock the deterministic Markdown shape for human-readable AIR
evidence reports. They use existing synthetic packages and generated evidence
from test setup; they do not contain private payloads, host secrets, timestamps,
absolute paths, or raw state/helper dumps.

Covered replay summary shapes:

- passing replay with host interaction evidence;
- failing replay with mismatch kinds and output IDs;
- passing state digest summary without raw helper names or return dumps.
