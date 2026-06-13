# Capability ABI v0.10

AIR modules must declare every host capability they import.

```air
capabilities { debug, input }

extern input.axis(id: i32) -> f32
extern debug.metric(id: i32, value: i32) -> void
```

The verifier rejects any `extern module.function` if `module` is not listed in `capabilities`.
For public host modules, the verifier also rejects unsupported function names
and non-canonical signatures. Demo-local imports such as `input.forward` are not
public ABI; use manifest-declared handles with stable imports such as
`input.axis(id)`.

AIR v0.10 can also declare `use` bundles. Bundles are source-level shortcuts that expand to capabilities and canonical extern signatures before verification:

```air
use utility.fs
use utility.net
use utility.time
use utility.random
use utility.audio
```

If a module declares both `use utility.fs` and `capabilities { fs }`, the verifier rejects the duplicate authority. If a manual extern conflicts with the bundle signature, the verifier rejects the module.

## Known Capabilities

- `debug`: diagnostics, metrics, tracing.
- `device`: platform-specific hardware access; not portable by default.
- `fs`: file and directory operations.
- `gfx`: optional high-level host-owned drawing commands such as `gfx.draw_cube` and `gfx.draw_primitive`; see `GFX_HIGH_LEVEL_ABI.md`.
- `ui`: optional host-owned dashboard and web-utility commands for panels, labels, buttons, inputs, tables, metrics, charts, statuses, warnings, rows, bars, and sparklines. Text and datasets are referenced by numeric host IDs in v0.10.
- `gpu`: raw GPU command interfaces backed by WebGPU, Metal, Vulkan, Direct3D, or another host backend.
- `input`: keyboard, pointer, controller, sensor input.
- `io`: async request polling and cancellation.
- `audio`: sound, music, spatial audio, and audio event playback.
- `net`: network operations.
- `random`: entropy and random values.
- `stdio`: stdout/stderr/stdin style console access.
- `time`: clocks and timers.

## Design Rule

AIR Core does not know JavaScript, Three.js, Metal, Vulkan, sockets, or filesystems directly. AIR knows only capability-qualified imports. Each host decides how to implement those imports.

This keeps AIR portable while allowing browser, CLI, native macOS, native Linux, and embedded hosts to share the same module contract.

## Input ABI

Interactive modules use stable integer handles declared in the manifest:

```air
extern input.axis(id: i32) -> f32
extern input.button(id: i32) -> bool
extern input.pointer_delta_x() -> f32
extern input.pointer_delta_y() -> f32
extern input.pointer_down() -> bool
```

Browser hosts map those handles to keyboard, mouse, touch, wheel, or gamepad bindings. Native hosts expose the same ABI through their platform input layer.

## High-Level GFX ABI

The `gfx` capability is not the raw GPU / render graph contract. It is a small high-level host ABI for simple drawing and compatibility examples:

```air
extern gfx.begin_frame(t: i32) -> void
extern gfx.draw_cube(x: i32, y: i32, z: i32, size: i32, rot: i32) -> void
extern gfx.end_frame() -> void
```

For production WebGPU-style packages, use `capabilities { gpu }`, `gpu.*` imports, and an `.airgfx.json` manifest.

## Environment Skybox ABI

Visual hosts should expose skybox/environment backgrounds as world environment state, not as player-owned geometry:

```air
extern gfx.skybox_world(asset: i32, tint: i32, intensity: i32, yaw: i32, pitch: i32, roll: i32) -> void
```

`yaw`, `pitch`, and `roll` are fixed-point degrees using the existing `1000 == 1 degree` convention. Hosts must ignore camera translation for environment sampling, but must use the camera view direction plus this world environment rotation. AIR owns the environment transform; the renderer only samples the cubemap, 3x2 cubemap atlas, or spherical/equirectangular skydome asset.

Skyboxes and skydomes are environment state, not scene nodes. They may be drawn with an inside-out cube using `projection * mat4(mat3(view)) * skybox_vertex`, a dome mesh sampled by world ray, or with a fullscreen shader that reconstructs a world-space view ray from inverse projection plus inverse view rotation. Spherical/equirectangular skydomes map `atan2` to `u` and `acos(y)` to `v`. In all cases the environment must not inherit player/camera transform beyond the view direction used for sampling.

## UI Utility ABI

The `ui` capability is a host-owned dashboard/web-utility ABI. It does not
expose DOM, React, browser, terminal, or native view objects to AIR:

```air
extern ui.begin_frame(width: i32, height: i32, time_ms: i32) -> void
extern ui.panel(id: i32, x: i32, y: i32, w: i32, h: i32, style: i32) -> void
extern ui.label(id: i32, x: i32, y: i32, label: i32, style: i32) -> void
extern ui.badge(id: i32, x: i32, y: i32, label: i32, style: i32) -> void
extern ui.button(id: i32, x: i32, y: i32, w: i32, h: i32, label: i32, style: i32) -> bool
extern ui.input_i32(id: i32, x: i32, y: i32, w: i32, label: i32, value: i32, style: i32) -> i32
extern ui.input_f32(id: i32, x: i32, y: i32, w: i32, label: i32, value: f32, style: i32) -> f32
extern ui.bar(id: i32, x: i32, y: i32, w: i32, value: i32, max: i32, style: i32) -> void
extern ui.row(id: i32, x: i32, y: i32, w: i32, label: i32, value: i32, style: i32) -> void
extern ui.table(id: i32, x: i32, y: i32, w: i32, h: i32, rows: i32, cols: i32, data: i32, style: i32) -> void
extern ui.metric(id: i32, x: i32, y: i32, label: i32, value: i32, unit: i32, style: i32) -> void
extern ui.chart(id: i32, x: i32, y: i32, w: i32, h: i32, series: i32, style: i32) -> void
extern ui.status(id: i32, x: i32, y: i32, label: i32, severity: i32, style: i32) -> void
extern ui.warning(id: i32, x: i32, y: i32, label: i32, severity: i32, style: i32) -> void
extern ui.sparkline(id: i32, x: i32, y: i32, w: i32, h: i32, data: i32, style: i32) -> void
extern ui.end_frame() -> void
```

Canonical modules should budget UI calls, for example
`effects { ui.* <= 16 }`. Browser hosts map these commands to DOM, React,
Canvas, or another web layer; native hosts may map them to a native toolkit;
CLI hosts may render a text fallback. See `UI_ABI.md`.

## Utility Host ABI

Non-visual AIR plugins use the same capability model. The verifier treats public
host modules as strict: known functions must use the canonical scalar signatures
below, and unknown public host function names are rejected instead of treated as
project-local ABI.

```air
extern fs.exists(path_ptr: i32, path_len: i32) -> bool
extern fs.read_file(path_ptr: i32, path_len: i32, out_ptr: ptr, max_len: i32) -> i32
extern fs.write_file(path_ptr: i32, path_len: i32, data_ptr: ptr, data_len: i32) -> i32
extern fs.read_file_async(path_ptr: i32, path_len: i32, out_ptr: ptr, max_len: i32) -> i32
extern fs.write_file_async(path_ptr: i32, path_len: i32, data_ptr: ptr, data_len: i32) -> i32

extern net.http_get(url_ptr: i32, url_len: i32, out_ptr: ptr, max_len: i32) -> i32
extern net.http_get_async(url_ptr: i32, url_len: i32, out_ptr: ptr, max_len: i32) -> i32

extern io.poll(request: i32) -> i32
extern io.result_len(request: i32) -> i32
extern io.cancel(request: i32) -> void

extern time.now_ms() -> i64
extern time.monotonic_ms() -> i64

extern random.u32() -> i32
extern random.f32() -> f32

extern audio.beep(id: i32) -> void
extern audio.play_tone(freq: f32, duration_ms: i32) -> void
extern audio.set_gain(value: f32) -> void

extern output.emit(output_id: i32, arg0: i32, arg1: i32, arg2: i32, arg3: i32) -> i32
```

The ABI intentionally uses scalar pointer/length pairs instead of exposing host strings or objects. Hosts own the actual filesystem, network stack, clock, entropy source, and audio device.

`output.emit` is the v0.26 Host ABI `0.11` bounded output-intent validation
surface. It requires capability `output`, an explicit `output.emit` effect
budget, a statically resolvable `output_id`, and a matching package-local
Output Contract with up to four `i32` args. Host ABI `0.10` packages and
profiles do not support runtime output emit.

Async calls return deterministic request handles. Canonical AIR code should poll them through `io.poll_bounded %request, count`, not through `loop.fold.*` or its legacy alias `loop.range.*`. `io.poll_bounded` keeps the original request handle stable on every iteration and traps unless the final status is ready. Hosts should report `0` for pending, `1` for ready, and negative values for errors.

Async output calls that write into a `ptr` region, such as `fs.read_file_async` and `net.http_get_async`, must not share the same output buffer while both requests are pending. AIR code should either allocate separate buffers, or consume/cancel the first request with `io.result_len` / `io.cancel` before reusing the buffer.

`loop.poll @io.poll, %request, count` remains available for explicit status-handling control flow, but it only returns the latest status. It does not prove the request is ready, so `io.result_len(request)` for a statically tracked async request requires `io.poll_bounded` or an explicit future ready-status branch.

On module trap or instance teardown, the host must cancel or invalidate all outstanding async request handles owned by that module instance. The host must not write into that instance's linear memory after trap/teardown. Pending async output buffers must not be reused unless the previous request has completed or has been cancelled.

Canonical non-trapping manual cleanup keeps the request handle stable, checks status, and cancels on the non-ready/error path before freeing the output buffer:

```air
%status:i32 = loop.poll @io.poll, %request, 4
%ready:bool = i32.eq %status, 1
br_if %ready, ready, cleanup
cleanup:
  @io.cancel(%request)
  free_region %buf
  return -1
ready:
  %len:i32 = @io.result_len(%request)
  free_region %buf
  return %len
```
