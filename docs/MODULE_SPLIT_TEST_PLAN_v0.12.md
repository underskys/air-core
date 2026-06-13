# AIR v0.12 Module Split Test Plan

Status: draft executable test plan

Version target: v0.12

Target layer: parser / package-local resolver / verifier / package-check / lowering / audit / reports

This document defines the test surface for package-local AIR module split before
implementing the resolver. It is intentionally not wired into `test/run.js`
yet, because the resolver and graph report do not exist. These cases should be
introduced as expected-fail fixtures, a feature-flagged harness, or a separate
`test/module_split.test.js` once implementation starts.

Related design:

- [AIR Core](../spec/AIR_CORE.md)
- [AIR package manifest](../spec/AIR_PACKAGE_MANIFEST.md)
- [RFC_CORE_MODULE_SPLIT_v0.12.md](RFC_CORE_MODULE_SPLIT_v0.12.md)
- [PACKAGE_CHECK_v0.12_PLAN.md](PACKAGE_CHECK_v0.12_PLAN.md)

## Scope

The first implementation target is package-local static source modules:

```air
use "./player.air"
use "../shared/math.air"
```

The test plan verifies:

- package-local path validation;
- deterministic dependency graph construction;
- cycle and duplicate identity rejection;
- exported-only cross-module visibility;
- capability, host import, and effect-origin aggregation;
- deterministic JSON reporting.

Out of scope for this plan:

- remote imports;
- package registry behavior;
- dynamic imports;
- runtime module loading;
- symbol mangling design;
- full effect-budget composition semantics;
- target packaging.

## Proposed Harness

Future executable harness:

```sh
node test/module_split.test.js
```

Low-risk staged alternative before resolver merge:

```sh
AIR_ENABLE_MODULE_SPLIT=1 node test/module_split.test.js
```

The harness should create temporary package directories under
`build/module-split-fixtures/`, write `air.package.json` plus `*.air` files,
run the resolver/package-check API, and compare deterministic JSON output.

Do not add these tests to `test/run.js` until one of these is true:

- module split is implemented;
- the harness supports explicit expected-fail mode;
- the harness is gated behind `AIR_ENABLE_MODULE_SPLIT=1`.

## Expected Report Shape

The resolver/package-check report should eventually expose a stable object:

```json
{
  "package": "split-demo",
  "entry": "main.air",
  "status": "pass",
  "modules": [
    {
      "name": "main",
      "path": "main.air",
      "imports": ["./player.air"],
      "capabilities": ["debug"],
      "hostImports": ["debug.metric"],
      "exports": ["frame"]
    }
  ],
  "graph": {
    "order": ["main", "player"],
    "edges": [
      { "from": "main", "to": "player", "path": "./player.air" }
    ]
  },
  "capabilities": {
    "union": ["debug"],
    "origins": {
      "debug": ["main"]
    }
  },
  "hostImports": {
    "used": ["debug.metric"],
    "origins": {
      "debug.metric": ["main"]
    }
  },
  "effects": {
    "origins": {
      "debug.metric": ["main"]
    }
  },
  "warnings": [],
  "errors": []
}
```

Field names should remain deterministic and sorted where order has no semantic
meaning. The graph order should be deterministic, for example depth-first from
entry with lexical tie-breaking after path normalization.

## Fixture Layout

Canonical positive fixture:

```text
split-basic/
  air.package.json
  main.air
  player.air
  collision.air
  shared/
    math.air
```

Canonical negative fixture families:

```text
split-bad-path/
split-cycle/
split-duplicate-module/
split-private-call/
split-missing-file/
split-escaped-root/
```

Each fixture should include the smallest AIR source needed to exercise one
behavior. Avoid demo-specific names, assets, media, shaders, or host-specific
files in resolver tests.

## Test Groups

### Path Validation

The resolver must treat paths as package-local source references, not general
filesystem or network references.

#### Accepts `use "./player.air"`

Fixture:

```air
module main
use "./player.air"
capabilities { }

export func run() -> i32 {
entry:
  %x:i32 = @player.spawn_x()
  return %x
}
```

Expected:

- status: pass;
- graph edge `main -> player`;
- resolved path `player.air`;
- no warnings.

#### Accepts `use "../shared/math.air"` only inside package root

Fixture layout:

```text
pkg/
  air.package.json
  app/main.air
  shared/math.air
```

`app/main.air` may use `../shared/math.air` because the normalized path remains
under `pkg/`.

Expected:

- status: pass;
- resolved path `shared/math.air`;
- report shows normalized package-local path.

#### Rejects `use "player.air"`

Rationale: imports must be explicitly relative. Bare names are reserved for
standard/bundle-style imports such as `std.grid` or future registry-free
well-known names.

Expected error:

```text
source import must start with ./ or ../
```

Repair hint:

```text
use "./player.air"
```

#### Rejects URLs

Rejected examples:

```air
use "https://example.com/player.air"
use "file:///tmp/player.air"
```

Expected errors:

- `remote AIR imports are not supported`;
- `file URL AIR imports are not supported`.

#### Rejects package-root escape

Rejected examples:

```air
use "../../outside.air"
use "../other-package/player.air"
```

Expected:

- status: fail;
- diagnostic includes importer path, requested path, normalized path, and
  package root;
- no files outside package root are parsed.

#### Rejects missing imported file

Expected:

- status: fail;
- diagnostic names the missing package-local import;
- repair hint says to add the file or remove the `use`.

### Dependency Graph

#### Builds deterministic graph

Fixture:

```text
main.air -> ./b.air
main.air -> ./a.air
a.air -> ./shared.air
b.air -> ./shared.air
```

Expected:

- shared module appears once;
- graph order is stable across runs;
- duplicate edges are either deduped or reported once deterministically.

Verification command:

```sh
node bin/airc.js package-check build/module-split-fixtures/split-graph --json > /tmp/graph-a.json
node bin/airc.js package-check build/module-split-fixtures/split-graph --json > /tmp/graph-b.json
diff -u /tmp/graph-a.json /tmp/graph-b.json
```

#### Rejects cycles

Fixture:

```text
main.air -> ./player.air
player.air -> ./main.air
```

Expected error:

```text
cyclic AIR import: main.air -> player.air -> main.air
```

#### Rejects duplicate module identity

Fixture:

```text
collision.air          # module collision
legacy/collision.air   # module collision
```

Expected:

- status: fail;
- diagnostic lists both package-local paths;
- no symbol merging occurs.

### Visibility

#### Allows call to exported function

Imported module:

```air
module player
capabilities { }

export func step(tick: i32) -> i32 {
entry:
  return %tick
}
```

Entry module:

```air
module main
use "./player.air"
capabilities { }

export func frame(tick: i32) -> i32 {
entry:
  %next:i32 = @player.step(%tick)
  return %next
}
```

Expected:

- status: pass;
- call target resolved to exported function `player.step`.

#### Rejects call to non-exported function from another module

Imported module:

```air
module player
capabilities { }

func private_step(tick: i32) -> i32 {
entry:
  return %tick
}
```

Entry call:

```air
%next:i32 = @player.private_step(%tick)
```

Expected error:

```text
function player.private_step is not exported from module player
```

Private calls inside the same module remain legal.

### Aggregation

Aggregation should be report-first in the first implementation. It should make
authority visible before strict composition rules are expanded.

#### Capability union with origin tracking

Fixture:

```text
main.air       capabilities { debug }
input.air      capabilities { input }
renderer.air   capabilities { gfx }
```

Expected report:

```json
{
  "capabilities": {
    "union": ["debug", "gfx", "input"],
    "origins": {
      "debug": ["main"],
      "gfx": ["renderer"],
      "input": ["input"]
    }
  }
}
```

If `air.package.json` declares only `["debug"]`, package-check should fail or
warn according to the package policy chosen for v0.12. The diagnostic must name
the imported module that introduced the missing capability.

#### Host import aggregation with origin tracking

Fixture:

```text
main.air       extern debug.metric(...)
input.air      extern input.axis(...)
```

Expected:

- `hostImports.used` contains both imports;
- `hostImports.origins["input.axis"]` contains `input`;
- strict Host ABI validation still rejects hallucinated host imports.

#### Effect budget origin reporting, not strict composition yet

Fixture:

```text
main.air       effects { debug.metric <= 1 }
renderer.air   effects { gfx.draw_primitive <= 10 }
```

Expected first-slice behavior:

- report lists effect budgets and visible usage by module;
- package-level effect composition is reported;
- strict cross-module effect budget composition may remain a documented TODO;
- diagnostics must not imply that an imported module's effects are hidden.

### Determinism

#### Verify package graph twice, compare JSON report

Command:

```sh
node bin/airc.js package-check build/module-split-fixtures/split-basic --json > /tmp/split-a.json
node bin/airc.js package-check build/module-split-fixtures/split-basic --json > /tmp/split-b.json
diff -u /tmp/split-a.json /tmp/split-b.json
```

Expected:

- byte-identical JSON output;
- stable module order;
- stable errors/warnings order;
- stable origin arrays;
- stable graph edge ordering.

## Implementation Slices

### Slice 1: Resolver-Only Package Graph

- Parse `use "./file.air"` and `use "../file.air"` only when package-check
  provides a package root.
- Reject URLs, bare file names, absolute paths, root escapes, and missing files.
- Build deterministic graph.
- Emit graph JSON.
- Do not lower linked modules yet.

### Slice 2: Verifier Visibility And Aggregation

- Verify every module individually.
- Validate exported-only cross-module calls.
- Aggregate capabilities, host imports, and effects with origin tracking.
- Keep package-check compatibility behavior opt-in for split packages.

### Slice 3: Linked Verification / Lowering Plan

- Choose linked single-Wasm or multi-module package output according to the RFC.
- Add deterministic symbol naming only after the graph semantics are stable.
- Keep public Host ABI unchanged.

### Slice 4: Audit And Report Polish

- Add module-origin sections to audit/explain/report.
- Add repair hints for missing export, root escape, duplicate identity, and
  capability mismatch.
- Add deterministic report fixture snapshots.

## Main Test Suite Policy

Do not add failing module split tests to `test/run.js` before implementation.
Accepted options:

- keep this document as the executable checklist;
- add `test/module_split.expected-fail.js` and keep it out of `npm test`;
- gate tests with `AIR_ENABLE_MODULE_SPLIT=1`;
- add passing parser-only tests only for syntax that is already implemented.

## Acceptance For Implementation Start

Before implementing resolver behavior, the implementation PR should identify:

- package root source of truth;
- graph report JSON field names;
- expected resolver API;
- package-check CLI behavior;
- error/repair-hint wording;
- whether tests are feature-gated or enabled in `npm test`.

No public Host ABI, target packaging, registry, or runtime module loading work is
required by this plan.
