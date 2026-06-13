# Region Leak Rejected Example

Negative example showing same-function region leak rejection.

Expected result: `verify` fails with `air.memory.region_leak`.

```sh
node bin/airc.js verify examples/public/region_leak_rejected/module.air
```

