# AIR UI Host ABI v0.10

AIR UI is a small host-owned dashboard ABI for web utilities, analyzers,
DevOps panels, and other reviewable tools. AIR computes state, chooses stable
IDs, and emits scalar UI commands. The host owns actual rendering and input
widgets.

Modules declare:

```air
capabilities { ui }
```

UI calls should be visible in effects:

```air
effects { ui.* <= 16 }
```

## Boundary

AIR does not receive DOM nodes, React components, browser APIs, native view
objects, terminal handles, or host string objects. Text is referenced by stable
integer label IDs. Tables and charts reference host-owned data or series IDs.

The same AIR module can run against different adapters:

- browser host: maps UI commands to DOM, React, Canvas, or another web UI layer;
- native host: maps UI commands to SwiftUI, AppKit, Qt, GTK, or another toolkit;
- CLI host: renders a text fallback with panels, rows, metrics, and warnings.

Unsupported widgets must be reported as diagnostics. Hosts must not silently
pretend a widget was rendered if it was ignored.

## Stable Imports

- `ui.begin_frame(width, height, time_ms) -> void`
- `ui.panel(id, x, y, w, h, style) -> void`
- `ui.label(id, x, y, label, style) -> void`
- `ui.badge(id, x, y, label, style) -> void`
- `ui.button(id, x, y, w, h, label, style) -> bool`
- `ui.input_i32(id, x, y, w, label, value, style) -> i32`
- `ui.input_f32(id, x, y, w, label, value, style) -> f32`
- `ui.bar(id, x, y, w, value, max, style) -> void`
- `ui.row(id, x, y, w, label, value, style) -> void`
- `ui.table(id, x, y, w, h, rows, cols, data, style) -> void`
- `ui.metric(id, x, y, label, value, unit, style) -> void`
- `ui.chart(id, x, y, w, h, series, style) -> void`
- `ui.status(id, x, y, label, severity, style) -> void`
- `ui.warning(id, x, y, label, severity, style) -> void`
- `ui.sparkline(id, x, y, w, h, data, style) -> void`
- `ui.end_frame() -> void`

Coordinates and dimensions are host logical pixels. Hosts may scale them for
device pixel ratio, terminal cell dimensions, or native toolkit units.

## Widget Semantics

`panel` creates a visual group. It does not own nested objects; each child is
still emitted as its own command with stable coordinates.

`label`, `badge`, `status`, and `warning` select host-owned text by label ID.
`severity` is an integer scale where `0` means ok/info, higher values mean
more severe status. Hosts decide colors and localized strings.

`button` returns whether the control was activated in the current frame. The
host owns debouncing and pointer/key activation policy.

`input_i32` and `input_f32` return the current parsed value. The host owns text
entry, focus, validation display, and locale-specific formatting.

`table`, `chart`, and `sparkline` reference host-owned data IDs. AIR may choose
which dataset to show, but does not pass arbitrary row strings or chart objects
through the ABI.

`metric`, `bar`, and `row` are scalar display helpers for common analyzer and
dashboard output.

## Host Responsibilities

Hosts must:

- validate that the module declared `capabilities { ui }`;
- implement the stable imports or return explicit unsupported diagnostics;
- keep raw platform/UI objects outside AIR;
- keep text, table rows, and chart series in host-owned registries;
- provide deterministic button/input values for tests and conformance fixtures;
- expose UI command counts in audit/conformance reports where possible.

AIR Core must not gain DOM, CSS, React, browser storage, native widget, or
terminal object semantics. Those are host adapter responsibilities.
