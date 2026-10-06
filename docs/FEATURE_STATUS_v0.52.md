# AIR v0.52 Feature Status

Status: technical stable release candidate. The bounded S5 implementation
passed independent exact-SHA QA (P0=0, P1=0, P2=2 documentation findings).
No merge, tag, npm publication or deployment is implied.

| Surface | Status | Boundary |
| --- | --- | --- |
| Package and CLI | 0.52.1 | `@underskys/air-core` is the public projection. 0.52.0 was a candidate that was never published; 0.52.1 is the first public release candidate of the 0.52 line. |
| 0.52.1 soundness maintenance | Implemented, awaiting independent QA | Phi-loop charging, exact work totals, cross-module and typed certificate fail-closed, region slots, live-region views and host capacities, AIR-owned memory for borrowed views, CLI typed build caps, bounded CLI JSON/check intake. See `docs/v0.52/V0521_SOUNDNESS_MAINTENANCE.md`. |
| Source profiles | Implemented | Legacy is default; typed-v0.51 requires explicit selection. |
| Typed subset | Implemented, finite | Checked i64, closed enums and flat sums; no calls, loops, recursion, imports or host effects. |
| `const.i64 N` | Implemented in initializer and return | Direct arithmetic-operand carrier spelling is rejected; bare i64 operands remain valid. Formatter emits the exact bare decimal value and is idempotent. |
| Verified typed build/invoke | Implemented | Trusted in-process handles; records do not grant authority. |
| Generic runtime and cache | Implemented | Process-local, bounded, fresh instances; host admission is rechecked. |
| G2 deterministic numerics | Research evidence | No fixed-point, u64 or general f64 Core admission. |
| S4 pressure corpus | Accepted bounded QA | HOLD and NOT_YET_PROVEN rows remain distinct from PASS. |
| AIR ABI 0.12 | Candidate only | Not promoted by public typed source. |
| Host ABI 0.10/0.11 | Unchanged | No production effect-time authority. |
| Browser | Executor rev 1234 PASS | Independent wrong-revision rejection PASS; independent exact-revision replay NOT_RUN. |
| Swift/Wasm cross-host | HOLD | Native Swift evidence is not Swift/Wasm execution. |
| Consumer replay, live shadow, model benchmark | NOT_RUN | Separate evidence lanes, not language or package release gates. |

Accepted private source: `48d414ab2349cc20e9b267b0656f128bb7557ee4`,
tree `bdc9d9bc97959679c1587c0e12e1f036d482b574`.
Accepted public projection: `4c62489f34a8149f758bc23dda892a031bae1023`,
tree `200daec43f66ff3afbf0682240306cf64e8d91f4`.
Accepted unpublished tarball SHA-256:
`627ced8529caa5c91c9fe80f6e315e82ace189aeacec19bd8230c1929d540433`.
Independent S5 report SHA-256:
`d842de4cb8f097ea8bbaa1ab8b73b164f4a74f03e2c2eda1cf4cab1061c442fd`.

`BROWSER_EXECUTOR_EXACT_REVISION=PASS`;
`BROWSER_IDENTITY_REJECTION_INDEPENDENT=PASS`;
`BROWSER_EXACT_REVISION_INDEPENDENT_REPLAY=NOT_RUN`.
Absent an identity mismatch or browser-specific semantic failure, that missing
independent positive replay does not block technical stable release preparation.
Public release actions remain separately authorized.
