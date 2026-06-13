# Compact Tables Package

This package is a tiny canonical example for AIR compact static table storage.
It is not a demo and has no demo assets, host dependencies, or generated files.

It demonstrates:

- `table status_ids:u8 = [...]`
- `table material_ids:u16 = [...]`
- `table offsets:i16 = [...]`
- `table.get.u8`, `table.get.u16`, and `table.get.i16`

`u8`, `u16`, and `i16` are storage/layout types only. AIR computation still
uses `i32`; compact table reads materialize as `i32` values.

Compact static tables reduce readonly table bytes compared with equivalent
`i32` tables. They do not add compact scalar arithmetic, mutable compact
tables, raw `load/store` operations, buffers, or tablegroups.

Run:

```sh
node bin/airc.js package-check examples/compact_tables_package --profile cli --source-only --json
node bin/airc.js report package examples/compact_tables_package --profile cli --json
```
