# Declared Pool Basic Fixture

This fixture exercises the v0.41 declared fixed-capacity pool first slice.

- The pool has fixed capacity `8`.
- Fields are scalar `i32`/`bool`.
- `active:bool` is required and present.
- AIR mutates only compiler-managed private pool storage.
- No host authority, object model, dynamic maps, GC, or game-specific API is used.
