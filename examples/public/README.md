# Public Examples

These examples are launch-safe Core examples for the npm/public package.

They are intentionally small and avoid downstream consumer names, large assets,
host-specific demos, raw review bundles, and private product pressure.

## Examples

| Example | Purpose | Expected command |
| --- | --- | --- |
| `safe_policy/` | Small deterministic policy module. | `verify` succeeds. |
| `hallucinated_api_rejected/` | Invented host API rejection. | `verify` fails with diagnostics. |
| `bounded_execution/` | Bounded loop example. | `verify` succeeds. |
| `region_leak_rejected/` | Region lifetime leak rejection. | `verify` fails with diagnostics. |
| `contract_range/` | Scalar contract range propagation. | `verify` succeeds. |
| `evidence_report/` | Small package report/evidence example. | `report package` succeeds. |

## Commands

```sh
node bin/airc.js verify examples/public/safe_policy/module.air
node bin/airc.js verify examples/public/bounded_execution/module.air
node bin/airc.js verify examples/public/contract_range/module.air
node bin/airc.js report package examples/public/evidence_report --json
```

Negative examples are intended to fail:

```sh
node bin/airc.js verify examples/public/hallucinated_api_rejected/module.air
node bin/airc.js verify examples/public/region_leak_rejected/module.air
```

