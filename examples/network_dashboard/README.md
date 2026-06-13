# Network Health Dashboard

This is a non-game AIR demo for AI-generated internal tools.

The AIR module analyzes mock/static network health data and drives a host-owned
UI dashboard through the existing `ui.*` and `debug.metric` ABIs. The host owns
widgets, labels, table data, chart series, input state, and rendering. AIR only
computes scalar decisions: score, severity, warnings, and metrics.

No real network scan is performed in this v0.11 demo. There is no `net`
capability, no filesystem access, no OS-level scanning, and no raw socket use.
Real probing would require an explicit host capability, policy model, audit
surface, and RFC in a future version.

## Run

Verify the AIR module:

```sh
node bin/airc.js verify examples/network_dashboard/network_dashboard.air
```

Run the mock UI host harness:

```sh
node examples/network_dashboard/run.mjs
```

Change thresholds and recompute:

```sh
node examples/network_dashboard/run.mjs --latency-threshold 180 --loss-threshold 2.0 --refresh
```

Use wider thresholds to see an `ok` result:

```sh
node examples/network_dashboard/run.mjs --latency-threshold 240 --loss-threshold 5.0
```

The script builds the AIR module into `build/network_dashboard`, instantiates it
with deterministic mock UI/debug host imports, and prints a JSON report showing
the module capabilities, imports, strict Host ABI status, unsupported host
features, mock input facts, UI commands, computed score/status, thresholds, and
internal debug metrics.

## Demo Shape

- `ui.metric`: overall health score.
- `ui.status`: ok/warn/error classification.
- `ui.warning`: risk summary severity.
- `ui.table`: mock nodes/services dataset reference.
- `ui.chart`: mock latency/loss series reference.
- `ui.input_i32`: latency threshold.
- `ui.input_f32`: packet loss threshold.
- `ui.button`: recompute/refresh signal.
- `debug.metric`: average latency, packet loss, and score metrics.
