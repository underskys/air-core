# WIT-Compatible ABI v0.10

AIR can emit WIT-compatible interface metadata with:

```sh
node bin/airc.js wit examples/plugin_metric.air
```

The emitted WIT is metadata for host/tooling integration. It is not yet a full Component Model binary emitter.

## Mapping

- Each `extern module.function(...) -> type` becomes an imported WIT interface function.
- Each `export func name(...) -> type` becomes a WIT world export.
- `i32`, `i64`, `f32`, `f64`, and `bool` map to WIT scalar types.
- `ptr` and `slice` map to `u32` handles.
- Internal composite values such as vectors, matrices, arrays, structs, and buffers do not cross the WIT boundary in v0.10.

## Example

AIR:

```air
module plugin_metric
capabilities { debug }
effects { debug.metric <= 1 }
requires capability debug
requires export run

extern debug.metric(id: i32, value: i32) -> void

export func run() -> void {
entry:
  %id:i32 = const.i32 1
  %value:i32 = const.i32 42
  call @debug.metric(%id, %value)
  return
}
```

WIT metadata:

```wit
package air:plugin-metric;

interface debug {
  metric: func(id: s32, value: s32);
}

world plugin-metric-world {
  import debug;
  export run: func();
}
```
