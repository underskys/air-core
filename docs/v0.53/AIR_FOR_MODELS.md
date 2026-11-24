# AIR for models: typed-v0.53 in one page

For AIR 0.54 and the typed-v0.53 source profile. This page ships in the
npm package and the repository at `docs/v0.53/AIR_FOR_MODELS.md`; its
examples are in `docs/v0.53/for-models/examples/`. The repository test
`test/air_for_models.test.js` checks that every code listed here exists and
that every example compiles, or is refused with the stated code and line.

## 1. What AIR is

AIR is a verifier-first language for small, deterministic components that an
AI writes and a machine checks before a host runs them. A module declares its
capabilities, host imports, effect demand and work bounds; the verifier checks
types, exhaustive matches, no recursion, bounded loops, region lifetimes and
static indexes, and refuses what it cannot prove with a stable `air.*` code.
The host keeps all authority (files, network, UI, devices). The backend is
WebAssembly. legacy-v0.50 is still the CLI default: always pass the
typed-v0.53 flags below (two words, `--source-profile typed-v0.53`).
In AIR 0.54, typed-v0.53 is a candidate profile: it is selected only
together with `--allow-candidate-profile`.

## 2. The commands you need

```sh
airc verify  FILE --source-profile typed-v0.53 --allow-candidate-profile
airc build   FILE --source-profile typed-v0.53 --allow-candidate-profile --emit wasm -o out.wasm
airc fmt     FILE --source-profile typed-v0.53 --allow-candidate-profile
airc format  FILE --source-profile typed-v0.53 --allow-candidate-profile --check --json
airc check   FILE --source-profile typed-v0.53 --allow-candidate-profile --lsp-json
airc migrate LEGACY_FILE [-o OUT.air] [--record RECORD.json] [--module-id ID]
airc version --json
```

- `airc` is an airc that is already installed: `node_modules/.bin/airc` in a project
  that has `@underskys/air-core` installed, `airc` from a global install, or
  `node bin/airc.js` inside the air-core repository. If none of them exists, the
  code is unchecked: say so and ask the user to install `@underskys/air-core`.
  Never fetch or run a tool by a package name through a package runner: it can
  install and run a different package.
- `verify`: `ok: FILE`, exit 0; a refusal is `FILE:LINE: CODE: message`, exit 1.
- `build`: verify, engine and size limits, then WAT (default) or Wasm.
- `check --lsp-json`: JSON `status` and `diagnostics[]` (`code`, `line`,
  `message`, `repairHint`, `fields.disposition`); parse and verify only.
- `fmt` drops `#` comments; `format --write` refuses a file that has them.
- `fmt` and `format` print the canonical form: functions sorted by name, a comma after
  every enum case and match arm, declared types named with their module
  (`demo.parse::Why`), and `some(%x)`, `ok(%x)`, `err(Why.Bad)` written in full
  (`option.some<T> %x`, `result.ok<T,E> %x`, `result.err<T,E> Why.Bad`). Both forms
  verify. The examples here use the short forms, so `format --check` can refuse them;
  `fmt` shows any file's canonical form.
- `migrate`: legacy-v0.50 in, typed-v0.53 on stdout, a record on stderr.
- `explain`, `audit`, `report`, `wit` and gfx/app commands refuse typed-v0.53.

## 3. Grammar in brief

A file is lines. `#` starts a comment. The first declaration is
`module NAME` (lower case, `[a-z][a-z0-9._-]*`). Every other module-level
item is one line, in any order, except `enum` and `func`, which are blocks:

```text
capabilities { output, time }                       families this module may use
use "./lib.air" as lib                              package-relative import
work { steps <= N, calls <= N, iterations <= N }    per-export work assertion (at most one)
extern output.emit(id: i32, a: i32, b: i32, c: i32, d: i32) -> i32   Host ABI entry
demand { output.emit <= 1 }                         max calls per effect key (at most one)
const LIMIT: i32 = 100                              upper-case name, one literal
table costs: i32[3] = [1, 2, 3]                     read-only, i32|i64|f32|f64|bool
state hits: i32[4] = fill 0                         mutable cells of the instance
struct Box { w: i32, h: i32 }                       internal aggregate
enum Lane {                                         one case per line,
  Slow = 0,                                         explicit discriminant
  Fast = 1                                          0..2147483647
}
error enum Why {                                    the E of result<T,E>
  Bad = 1
}
export func name(p: T, q: U) -> R { ... }           exported; plain `func` is internal
```

Types:

- Scalars `i32 i64 f32 f64 bool`; `void` only as a result.
- Refined `i32<MIN..MAX>`: i32 only, top level only (not a field, element or payload).
- `option<T>` and `result<T,E>`: T is a scalar or enum; E must be an `error enum`.
- `struct Name` and `array<T,N>` (no spaces, 1 <= N <= 65536): internal only;
  an export never takes or returns them.
- Memory `ptr`, `slice`, `buffer<i32|f32,N>`, `borrowed_slice<...>`: locals and parameters only;
  an export takes only `borrowed_slice<...>` among them (the borrowed lane) and returns none.

Atoms (what an operand, `yield`, call argument or match arm may be):
`%local`, an integer or decimal literal, `true`/`false`, a constant name,
an enum case `Lane.Fast`, `some(%x)`, `none`, `ok(%x)`, `err(Why.Bad)`.

Statements in a function body:

```text
%a: T = ATOM
%b: T = OPERATION x, y
%c: T = call @f(x, y)
call @g(x)                                   (only when g returns void)
%d: T = if %cond {
  ...
  yield ATOM
} else {
  ...
  yield ATOM
}
%e: T = match %lane {
  Lane.Slow => ATOM
  Lane.Fast => {
    ...
    yield ATOM
  }
}
%f: T = loop.fold @step, SEED, 10            or a dynamic count: %n max 64
%g: T = table.get costs, %i
%h: T = state.get hits, 0
state.set hits, 0, %h
%k: Box = struct.new %w, %h
%m: i32 = struct.get.w %k
%k2: Box = struct.set.w %k, 7
%p: array<i32,3> = array.new 1, 2, 3
%q: i32 = array.get %p, %i
%p2: array<i32,3> = array.set %p, %i, %q
return ATOM-OR-OPERATION
return                                       (void function)
```

Rules: every `%name` is bound once per function, blocks included. Each block
ends with exactly one `yield`. `return` is the last statement of the body and
never inside a block. Match patterns are `Type.Case`, `some(v)`/`none`,
`ok(v)`/`err(e)` or `true`/`false`; every case once. A pattern binds `v`
without `%`, the arm uses it as `%v`, and it must not shadow a local.

Operations (operands are atoms; one operation per statement):

- i32: `checked_add sub mul div_s rem_s`, `wrapping_add sub mul`, `and or xor shl shr_u`, `eq ne lt_s le_s gt_s ge_s`
- i64: `checked_add sub mul div_s rem_s neg`, `eq ne lt_s le_s gt_s ge_s`
- f32: `add sub mul div min max`, `eq ne lt le gt ge`. f64 has no arithmetic.
- conversions: `i32.to_i64`, `i64.to_i32_checked`, `i32.to_f32_checked`, `f32.trunc_to_i32_checked`, `f32.to_f64`, `f64.to_f32_checked`
- `bool.and bool.or bool.not`; `select.T %c, %a, %b` gives `%a` when `%c` is true (T: i32 i64 f32 f64 bool)

Checked operations fail on overflow, division by zero or an invalid
conversion; with statically known integer operands the verifier evaluates
them and refuses a failure.

## 4. Idioms

Each block below is a whole file in `docs/v0.53/for-models/examples/`, unless
marked shortened.

**4.1 Branch with a value if; pick with select** (`01_value_if_select.air`)

```air
module demo.limits

export func clamp(x: i32, lo: i32, hi: i32) -> i32 {
  %below: bool = i32.lt_s %x, %lo
  %r: i32 = if %below {
    yield %lo
  } else {
    %above: bool = i32.gt_s %x, %hi
    %v: i32 = select.i32 %above, %hi, %x
    yield %v
  }
  return %r
}

export func add_fee(price: i64, fee: i64) -> i64 {
  return i64.checked_add %price, %fee
}
```

**4.2 Closed choices: enum plus exhaustive match** (`02_enum_match.air`)

```air
module demo.route

enum Lane {
  Slow = 0,
  Fast = 1,
  Blocked = 2
}

export func lane_score(code: i32) -> i32 {
  %lane: Lane = call @classify(%code)
  %score: i32 = match %lane {
    Lane.Slow => 10
    Lane.Fast => 30
    Lane.Blocked => 0
  }
  return %score
}

export func boost(fast: bool, x: i32) -> i32 {
  %lane: Lane = match %fast {
    true => Lane.Fast
    false => Lane.Slow
  }
  %r: i32 = match %lane {
    Lane.Slow => %x
    Lane.Fast => {
      %d: i32 = i32.checked_mul %x, 2
      yield %d
    }
    Lane.Blocked => 0
  }
  return %r
}

func classify(code: i32) -> Lane {
  %neg: bool = i32.lt_s %code, 0
  %r: Lane = if %neg {
    yield Lane.Blocked
  } else {
    %big: bool = i32.ge_s %code, 100
    %l: Lane = if %big {
      yield Lane.Fast
    } else {
      yield Lane.Slow
    }
    yield %l
  }
  return %r
}
```

**4.3 Failure as a value: result and option** (`03_option_result.air`, shortened here; the file also has `first_positive` and `pick` over `option<i32>`)

```air
error enum Why {
  Negative = 1,
  TooBig = 2
}

export func safe_percent(x: i32) -> i32 {
  %r: result<i32,Why> = call @percent(%x)
  %out: i32 = match %r {
    ok(v) => %v
    err(e) => -1
  }
  return %out
}
```

**4.4 Ranges in the type: refinements** (`04_refinement.air`). A wider
value enters a refined slot by a run-time check; a known bad value is refused.

```air
module demo.refine

export func grade(score: i32<0..100>) -> i32<0..4> {
  %pass: bool = i32.ge_s %score, 50
  %g: i32<0..4> = if %pass {
    yield 3
  } else {
    yield 1
  }
  return %g
}

export func to_percent(x: i32) -> i32<0..100> {
  %lo: bool = i32.lt_s %x, 0
  %a: i32 = select.i32 %lo, 0, %x
  %hi: bool = i32.gt_s %a, 100
  %b: i32 = select.i32 %hi, 100, %a
  %r: i32<0..100> = %b
  return %r
}
```

**4.5 Module data: constants, read-only tables, state** (`05_module_data.air`).
State indexes must be statically known; table and array indexes may be dynamic (checked at run time).

```air
module demo.tiers

const MAX_TIER: i32 = 4
table tier_cost: i32[5] = [0, 10, 25, 50, 100]
state spent: i32[1] = fill 0

export func cost(tier: i32) -> i32 {
  %low: bool = i32.lt_s %tier, 0
  %t0: i32 = select.i32 %low, 0, %tier
  %high: bool = i32.gt_s %t0, MAX_TIER
  %t: i32 = select.i32 %high, MAX_TIER, %t0
  %c: i32 = table.get tier_cost, %t
  return %c
}

export func spend(tier: i32) -> i32 {
  %c: i32 = call @cost(%tier)
  %old: i32 = state.get spent, 0
  %new: i32 = i32.checked_add %old, %c
  state.set spent, 0, %new
  return %new
}
```

**4.6 The one loop: loop.fold, with a work assertion** (`06_loop_fold.air`).
The callback takes the accumulator (and optionally an i32 index) and returns
it. A dynamic count needs `max N`; outside 0..N it fails at run time.

```air
module demo.folds
work { iterations <= 64 }

export func triangle() -> i32 {
  %t: i32 = loop.fold @step, 0, 10
  return %t
}

export func sum_to(n: i32) -> i32 {
  %t: i32 = loop.fold @step, 0, %n max 64
  return %t
}

func step(acc: i32, i: i32) -> i32 {
  %next: i32 = i32.checked_add %acc, %i
  return %next
}
```

**4.7 Internal aggregates: struct and array** (`07_struct_array.air`). Aggregates are values; `struct.set` and `array.set` return a new value.

```air
module demo.box

struct Box { w: i32, h: i32 }

export func area_plus(w: i32, h: i32, extra: i32) -> i32 {
  %b: Box = struct.new %w, %h
  %a: i32 = call @area(%b)
  %xs: array<i32,3> = array.new %a, %extra, 0
  %first: i32 = array.get %xs, 0
  %second: i32 = array.get %xs, 1
  %s: i32 = i32.checked_add %first, %second
  return %s
}

func area(b: Box) -> i32 {
  %w: i32 = struct.get.w %b
  %h: i32 = struct.get.h %b
  %a: i32 = i32.checked_mul %w, %h
  return %a
}
```

**4.8 Host effects: capability, extern, demand** (`08_extern_demand.air`).
Only Host ABI registry entries, with their exact types. Async and io entries
are not admitted. The demand bounds calls per export; it grants nothing.

```air
module demo.alert
capabilities { output }
demand { output.emit <= 1 }

extern output.emit(output_id: i32, arg0: i32, arg1: i32, arg2: i32, arg3: i32) -> i32

export func check(temp: i32) -> i32 {
  %hot: bool = i32.gt_s %temp, 80
  %r: i32 = if %hot {
    %s: i32 = call @output.emit(7, %temp, 0, 0, 0)
    yield %s
  } else {
    yield 0
  }
  return %r
}
```

**4.9 Imports** (`09_import_main.air` with `09_import_lib.air` beside it).
Only typed-v0.53 modules inside the package; only scalars, refined i32 and
`option` of those cross; importing grants no capability.

```air
module demo.useimport
use "./09_import_lib.air" as m

export func score(x: i32) -> i32<0..100> {
  %c: i32<0..100> = call @m.clamp100(%x)
  return %c
}
```

**4.10 Scratch memory: a region freed on every path** (`10_memory_region.air`)

```air
module demo.scratch

export func pair_sum(a: i32, b: i32) -> i32 {
  %p: ptr = alloc_region 8
  store.i32 %p, 0, %a
  store.i32 %p, 4, %b
  %x: i32 = load.i32 %p, 0
  %y: i32 = load.i32 %p, 4
  free_region %p
  %s: i32 = i32.wrapping_add %x, %y
  return %s
}
```

## 5. Common mistakes

Each row is a file in `docs/v0.53/for-models/examples/mistakes/`, refused with
exactly this code.

| You wrote | Code | Fix |
| --- | --- | --- |
| `%s: i32 = i32.add %a, %b` (m01) | `air.numeric.operation_mode_required` | `i32.checked_add` or `i32.wrapping_add` |
| `entry:` label, `br`, `phi` (m02) | `air.control.unstructured_unsupported` | value `if` / `match` with `yield` |
| `if %c { ... }` without a binding (m03) | `air.v051.typed_syntax_invalid` | `%r: T = if %c { ... } else { ... }` |
| value `if` without `else` (m04) | `air.control.yield_missing` | add `} else {` ... `yield` |
| match missing a case (m05) | `air.decision.match_nonexhaustive` | one arm per case |
| `true => i32.checked_add %o, 1` (m06) | `air.decision.match_arm_invalid` | arms yield atoms; use a block arm |
| `%r: i32<0..100> = 150` (m07) | `air.refinement.assignment_out_of_range` | a value inside the range |
| `i32.checked_add 2147483647, 1` (m08) | `air.numeric.checked_failure` | fix the constant, or wrap on purpose |
| `call @g(%x)` where g returns i32 (m09) | `air.call.result_unbound` | `%r: i32 = call @g(%x)` |
| `f` calls `f` (m10) | `air.call.recursion_rejected` | `loop.fold` |
| `while`, `for`, `loop.range` (m11) | `air.loop.form_unsupported` | `loop.fold` |
| `loop.fold @g, 0, %n` (m12) | `air.workbound.unknown_bound` | `%n max 64` |
| export takes a struct (m13) | `air.abi.export_type_unsupported` | scalar export, build the struct inside |
| `table.set t, 0, 5` (m14) | `air.table.readonly` | `state` for mutable cells |
| `state.get s, %i` (m15) | `air.state.dynamic_bounds_required` | literal or constant index |
| extern without `capabilities` (m16) | `air.capability.required_missing` | `capabilities { output }` |
| extern call without `demand` (m17) | `air.effect.demand_missing` | `demand { output.emit <= N }` |
| `extern net.post_json(...)` (m18) | `air.extern.unsupported` | registry entries only |
| `use std.math as m` (m19) | `air.import.stdlib_unsupported` | no stdlib; write it or `use "./x.air"` |
| region not freed before return (m20) | `air.memory.region_leak` | `free_region` on every path |
| `%y` bound twice (m21) | `air.v051.local_duplicate` | new name (`%y2`) |
| `result<i32,Why>` with a plain enum (m22) | `air.decision.result_error_type_invalid` | `error enum Why` |
| `return %x` with x: i64, result i32 (m23) | `air.v051.typed_atom_type_mismatch` | `i64.to_i32_checked` first |
| fold exceeds `work { iterations <= 5 }` (m24) | `air.workbound.assertion_exceeded` | fewer iterations or a higher bound |
| `%l: Lane = select.i32 %big, 1, 0` (m25) | `air.v051.typed_atom_type_mismatch` | enums are not i32; value `if` |
| `load.i32 %p, 8` on an 8-byte region (m26) | `air.memory.region_bounds_static` | offset + width <= size |
| `return call @g(%x)` (m27) | `air.numeric.operation_invalid` | bind the call, return the local |
| `f64.add %a, %b` (m28) | `air.numeric.operation_invalid` | f32 math, or keep f64 as data |
| `i32.checked_add %a, i32.checked_mul %b, 2` (m29) | `air.numeric.operation_invalid` | one operation per statement |
| missing `--allow-candidate-profile` | `air.source_profile.candidate_disabled` | add the flag |
| `--source-profile=typed-v0.53` | `air.source_profile.invalid_form` | `--source-profile typed-v0.53` |

## 6. Every error code a typed-v0.53 source can get

Static codes (exit 1). Rows marked API come only from the SDK, not from a file.

| Code | Meaning | Typical fix |
| --- | --- | --- |
| **Profile and CLI** | | |
| `air.source_profile.candidate_disabled` | typed-v0.53 without the opt-in | add `--allow-candidate-profile` |
| `air.source_profile.unsupported` | unknown profile name | `typed-v0.53` (exact) |
| `air.source_profile.invalid_form` / `.duplicate` / `.missing` / `.file_missing` | bad `--source-profile` use or no file | flag once, two words, then the file |
| `air.source_profile.command_unsupported` | command has no typed-v0.53 path | verify, build, fmt, format, check |
| `air.source_profile.ast_mismatch` | API: AST from another profile | process under its own profile |
| `air.cli.option_unknown` / `air.cli.command_unknown` | flag or command not accepted | see section 2 |
| `air.cli.file_missing` / `.file_invalid` / `.file_too_large` / `.file_read_failed` / `.file_write_failed` | file not readable, not regular, over 4 MiB, or not writable | fix the path |
| `air.format.parse_failed` / `.not_canonical` / `.comments_not_preserved` / `.write_failed` | `format` results | run `fmt`; remove comments before `--write` |
| `air.v052.toolchain_input_unavailable` / `.toolchain_input_invalid` / `.toolchain_changed` | WABT missing, not a plain file tree (links, special files), or changed during a Wasm build | stop: ask the user to reinstall `@underskys/air-core` and its dependencies, then rerun |
| **Size and capacity (refusals, not verdicts)** | | |
| `air.v052.work_limit_source_bytes` | over 256 KiB per module or 1 MiB per closure | split the module |
| `air.v052.work_limit_ast_nodes` | over 65,536 nodes per module or 262,144 per closure | split |
| `air.v052.work_limit_modules` | over 64 modules in the closure | fewer imports |
| `air.v052.work_limit_wat_bytes` / `.work_limit_wasm_bytes` | output over 4 MiB | smaller module |
| `air.analysis.capacity_exceeded` | analysis units over 1,048,576 or nesting over 64 | smaller closure |
| `air.build.engine_limit` | a Wasm engine limit (functions, locals, params...) | split the function |
| **Syntax and structure** | | |
| `air.v051.typed_syntax_invalid` | malformed line: no module, bare `if`, `return` in a block, `yield` outside a block, bad `work`/`demand`/`table`/`struct`/`const` line, duplicate constant/table/alias | follow section 3 |
| `air.v051.typed_statement_invalid` | API: unknown statement in an AST | - |
| `air.v051.function_duplicate` / `.parameter_duplicate` / `.local_duplicate` | name used twice (externs too) | rename |
| `air.v051.local_unknown` | `%x` not bound before use | bind it earlier in scope |
| `air.v051.return_missing` / `.return_type_mismatch` | no return, or value vs `void` mismatch | one final `return` of the result type |
| `air.control.statement_after_return` | code after `return` | `return` last |
| `air.control.unstructured_unsupported` | labels, `br`, `br_if`, `phi` | value `if` / `match` |
| `air.control.yield_missing` | block without final `yield`, `if` without `else` | end each block with `yield` |
| `air.loop.form_unsupported` | any loop but `loop.fold` | `loop.fold` |
| **Types and values** | | |
| `air.v051.type_reference_invalid` | bad type text, array/buffer/table size, refined field, self-containing struct, over 65,536 lanes | fix the type |
| `air.v051.typed_atom_invalid` | operand is not an atom | atom or bind a local |
| `air.v051.typed_atom_type_mismatch` | atom, call result, fold or operation of the wrong type | convert explicitly |
| `air.v051.typed_constructor_invalid` / `.typed_constructor_type_mismatch` | `ok`/`err` without payload, wrong type arguments | `ok(%x)`; payload of the slot type |
| `air.decision.payload_type_unsupported` | nested or aggregate payload, refinement inside a type, nesting over 64 | scalar or enum payloads |
| `air.decision.enum_empty` / `.enum_discriminant_required` / `.enum_discriminant_out_of_range` | enum without cases, case without `= N`, N outside 0..2147483647 | `Case = N,` |
| `air.decision.enum_duplicate_case` / `.enum_duplicate_discriminant` / `.enum_duplicate_type` | repeated case, number or type name (structs share the namespace) | rename |
| `air.decision.enum_unknown` / `.enum_invalid` | unknown enum type; API: malformed enum | declare it |
| `air.decision.result_error_type_invalid` | result error is not an `error enum` | `error enum` |
| `air.decision.match_arm_invalid` / `.match_duplicate_arm` / `.match_binding_shadow` | bad pattern or operation arm, repeated arm, binding hides a local | see section 3 |
| `air.decision.match_nonexhaustive` / `.match_type_unsupported` / `.match_unknown_value` | missing case, match on i32 etc., unknown subject | enum, option, result or bool subject |
| `air.refinement.base_type_unsupported` | refinement on i64/f32/f64 | `i32<MIN..MAX>` only |
| `air.refinement.syntax_invalid` / `.bound_out_of_range` / `.range_invalid` | malformed `i32<..>`, bound outside i32, MIN > MAX | `i32<0..100>` |
| `air.refinement.assignment_out_of_range` | known value outside the range | fit the value or widen the type |
| `air.numeric.operation_mode_required` | `i32.add/sub/mul/div_s/rem_s` without mode | `checked_` or `wrapping_` |
| `air.numeric.operation_invalid` | unknown operation, wrong operand count, nested operation, `return call` | section 3 operation list |
| `air.numeric.checked_failure` | known operands overflow, divide by zero or convert inexactly | fix the values |
| `air.numeric.i64_constant_out_of_range` | i64 literal out of range | smaller literal |
| **Calls and work** | | |
| `air.call.unknown_function` / `.argument_count_mismatch` / `.result_unbound` | unknown callee, wrong arity, non-void call as a statement | declare, match arity, bind result |
| `air.call.recursion_rejected` | a call cycle | `loop.fold` |
| `air.workbound.unknown_bound` / `.invalid_bound` | count with no proven maximum; signed count | literal count or `%n max N` |
| `air.workbound.overflow` / `.missing_summary` | a work total above 2^63-1; callee without a summary | reduce counts; call verified functions |
| `air.workbound.assertion_exceeded` | an export breaks `work { ... }` | less work or a higher bound |
| **Module data** | | |
| `air.const.initializer_invalid` | constant not one literal | `const N: i32 = 5` |
| `air.table.readonly` / `air.table.index_out_of_range` | `table.set`; known index outside 0..N-1 | `state` for writes; valid index |
| `air.array.index_out_of_range` | known array index outside 0..N-1 | valid index |
| `air.state.segment_invalid` / `.cell_type_invalid` / `.dynamic_length` / `.length_invalid` / `.init_invalid` | malformed `state` line, name taken, bad type, length or `fill` | `state s: i32[4] = fill 0` |
| `air.state.op_invalid` / `.dynamic_bounds_required` / `.index_out_of_bounds` | bad `state.*` use, unknown index, index outside | static index inside 0..N-1 |
| `air.abi.export_type_unsupported` | export takes/returns a struct, array or state; takes a `ptr`, `slice` or `buffer`; returns a `ptr` or `buffer` | scalars at the boundary |
| **Effects and host imports** | | |
| `air.capability.unknown` / `.required_missing` | unknown family; extern or reached key without its family | `capabilities { family }` |
| `air.extern.unsupported` / `.signature_mismatch` / `.alias_conflict` | not a registry entry (or async/io); wrong types; alias equals family | exact registry signature; rename alias |
| `air.effect.demand_key_invalid` / `.demand_missing` / `.demand_exceeded` | bad key; key not declared; export calls more often | `demand { key <= N }` |
| **Imports** | | |
| `air.import.path_uncontained` / `.not_found` | path not `./x.air`/`../x.air` inside the package; file missing | fix the path |
| `air.import.cycle` / `.duplicate_module` / `.profile_mismatch` | import cycle; same module twice; imported file not typed-v0.53 | restructure |
| `air.import.bundle_unsupported` / `.stdlib_unsupported` | `use a.b`, `use std.x` | package-relative files only |
| `air.import.signature_type_unsupported` | imported export uses enum, result, struct... | scalar, refined i32, option of those |
| **Memory** | | |
| `air.memory.region_leak` / `.region_not_live` / `.free_not_owner` | not freed on a path; used after free; freeing a parameter | free once, in the allocating function |
| `air.memory.region_bounds_static` / `.region_size_unsupported` | offset + width past the region; size over 16 MiB | stay inside |
| `air.memory.view_escape` / `.readonly_data` | memory value stored, returned or yielded; write to a literal view | keep views local; copy first |
| `air.abi.borrowed_lane_plain_export` / `.slice_return_unsupported` / `.borrowed_slice_interface_mismatch` | a plain export beside a borrowed one; an export returns a slice; an export uses the reserved typed-memory marker name | borrowed_slice params, scalar results, another name |
| `air.borrow.syntax_invalid` / `.mode_invalid` / `.alignment_invalid` / `.length_invalid` / `.unbounded` | malformed `borrowed_slice<ACCESS,len<=N,align=K>` | fix the descriptor |
| `air.borrow.mode_violation` / `.call_mismatch` / `.escape_return` / `.free_forbidden` / `.reinterpret_forbidden` | write to readonly, widening at a call, returning, freeing or recasting a borrow | respect the declared mode |
| **Migration** | | |
| `air.migration.unsupported_construct` | `migrate` cannot port a construct | keep it legacy or rewrite by hand |
| **Not caused by your source** | | |
| `air.v051.typed_lowering_unsupported`, `air.workbound.cost_undefined`, `air.workbound.identity_mismatch`, `air.v052.runtime_limits_invalid`, `air.build.memory_backing_limit`, `air.host.*` | defect, SDK option or host adapter | report it |

Run-time failures. A trapped export sets the exported global
`__air_failure_reason`; the host maps it:

| Value | Code | Cause |
| --- | --- | --- |
| 1 / 2 / 3 | `air.numeric.checked_failure` | overflow / division_by_zero / invalid_conversion |
| 16 | `air.refinement.ingress_out_of_range` | host passed a value outside an exported refinement |
| 17 | `air.refinement.assignment_out_of_range` | narrowing into `i32<..>` failed |
| 32 | `air.loop.count_out_of_range` | dynamic fold count outside 0..max |
| 33 / 35 | `air.table.index_out_of_range` / `air.array.index_out_of_range` | dynamic index outside 0..N-1 |
| 34 | `air.memory.region_bounds_runtime` | dynamic region access out of bounds |
| 48 / 49 / 50 / 51 | `air.decision.enum_discriminant_invalid` / `.payload_tag_invalid` / `.bool_lane_invalid` / `.payload_lane_noncanonical` | a direct Wasm caller passed a bad enum, tag, bool or lane |
| 64 | `air.borrow.air_owned_memory_overlap` | a borrowed range overlaps AIR-owned memory |
| 0 / other | `air.runtime.trap_unclassified` / `air.runtime.failure_reason_unknown` | implementation defect; unknown value fails closed |

## 7. Limits worth knowing

Source 256 KiB per module; 65,536 AST nodes; type nesting 64; arrays,
tables, states and buffers at most 65,536 elements; enum discriminants
0..2147483647; work and demand bounds at most 2^63-1; a region at most
16 MiB; WAT and Wasm at most 4 MiB each; a closure at most 64 modules,
1 MiB and 262,144 nodes.

## 8. Use with Claude Code, Codex and other agents

The package carries everything an agent needs. A copy for people may
also be published on the site, at https://air-core.dev/for-models/.

- Claude Code: the package ships a skill in `skills/air/`. Copy it into a
  project, or into your personal skills for every project. These commands are
  for a person: the second writes outside the project (`~/.claude/skills`), so
  an agent runs it only when the user asks.

  ```sh
  mkdir -p .claude/skills && cp -R node_modules/@underskys/air-core/skills/air .claude/skills/
  mkdir -p ~/.claude/skills && cp -R "$(npm root -g)/@underskys/air-core/skills/air" ~/.claude/skills/
  ```

  The skill reads this page and checks each file with `airc check`.
- Codex and other agents: point the agent's instructions (for example
  `AGENTS.md`) at this page, `node_modules/@underskys/air-core/docs/v0.53/AIR_FOR_MODELS.md`,
  and ask it to run the `airc check ... --lsp-json` command of section 2 on
  every file it writes.
- `llms.txt` at the package root lists these paths for any model.
