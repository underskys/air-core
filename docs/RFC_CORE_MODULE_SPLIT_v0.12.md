# RFC: AIR Core Package-Local Module Split for v0.12

Status: partially superseded by v0.13 graph-analysis implementation

Version target: v0.12

Target layer: AIR Core resolver / verifier / package-check / audit / lowering

Superseded note: v0.13 promotes the graph-analysis portion of this RFC:
package-local relative imports, aliases, cycle/path validation, exported-only
cross-module calls, capability origins, host import origins, and authority-chain
reports. Linked multi-module Wasm output remains deferred. The authoritative
current status is [FEATURE_STATUS_v0.13.md](FEATURE_STATUS_v0.13.md).

This RFC designs minimal package-local AIR module imports. It is a design
document for v0.12 and background for the active v0.13 graph-analysis slice.

Related design:

- [AIR Core](../spec/AIR_CORE.md)
- [AIR package manifest](../spec/AIR_PACKAGE_MANIFEST.md)
- [RFC_PACKAGE_MANIFEST_v0.12.md](RFC_PACKAGE_MANIFEST_v0.12.md)
- [RFC_CORE_GENERATED_DATA_v0.12.md](RFC_CORE_GENERATED_DATA_v0.12.md)
- [RFC_CORE_FIXED_DATA_STRUCTURES_v0.12.md](RFC_CORE_FIXED_DATA_STRUCTURES_v0.12.md)
- [contra-platformer request](abi-requests/contra-platformer.md)

## Problem

Large AIR demos become difficult to review when all logic lives in one file.
Current generated modules may combine player logic, enemy slots, collision,
render commands, level constants, and debug metrics into a single large
`*.air` file.

The goal is a minimal static import model for package-local source files:

```air
use "./player.air"
use "./enemy.air"
use "./collision.air"
use "./level1.air"
```

This must improve reviewability without adding hidden authority, remote
dependencies, package-manager behavior, runtime module loading, or new public
Host ABI.

## Design Goals

Required properties:

- relative imports only;
- package-local files only;
- no remote imports;
- no package manager;
- no cycles in the first implementation slice;
- unique module identity in one package;
- exported-only cross-module calls;
- capability union across imported modules;
- effect budget composition across imported modules;
- host import aggregation across imported modules;
- deterministic verification order;
- deterministic build output;
- clear relationship to `air.package.json`.

## Proposed Syntax

Entry module:

```air
module platformer_main

use "./player.air"
use "./enemy.air"
use "./collision.air"
use "./level1.air"
use std.grid

capabilities { debug, gfx, input }

extern debug.metric(id: i32, value: i32) -> void
extern input.axis(id: i32) -> f32

export func frame(tick: i32) -> void {
entry:
  %axis:f32 = @input.axis(0)
  %px:i32 = @player.step(%tick)
  %hit:i32 = @collision.hit_test(%px)
  @debug.metric(1, %hit)
  return
}
```

Imported module:

```air
module player

capabilities { }

export func step(tick: i32) -> i32 {
entry:
  %base:i32 = const.i32 560
  %x:i32 = i32.add %base, %tick
  return %x
}

func clamp_local(value: i32) -> i32 {
entry:
  return %value
}
```

Rules:

- `use "./file.air"` imports one package-local AIR file.
- `use std.grid` remains a standard library import and is not a relative file
  import.
- Cross-module calls must use exported functions.
- Imported module names qualify cross-module calls, for example
  `@player.step`.
- Private helper functions remain callable only inside their declaring module.
- Host extern imports remain strict and do not create new public ABI.

## Package Locality

Relative imports are resolved against the importing file. The resolved path must
stay inside the package root selected by `air.package.json`.

Allowed:

```air
use "./player.air"
use "./logic/collision.air"
use "../shared/grid_helpers.air"  # only if still inside package root
```

Rejected:

```air
use "../outside-package/player.air"
use "<absolute-path>/player.air"
use "https://example.com/player.air"
use "npm:some-package/player.air"
```

Package-check must reject:

- absolute paths;
- parent traversal outside package root;
- URLs;
- non-AIR files;
- missing files;
- symlink escape outside package root, if symlink resolution is supported.

## Relationship To air.package.json

`air.package.json` owns the package root and entry module:

```json
{
  "name": "split-platformer",
  "version": "0.1.0",
  "airAbi": "0.10",
  "hostAbi": "0.10",
  "entry": "main.air",
  "capabilities": ["debug", "gfx", "input"],
  "targetProfiles": ["browser-webgpu"]
}
```

Resolver entry point:

1. package-check loads `air.package.json`;
2. the package root is the directory containing that manifest;
3. `entry` selects the root AIR file;
4. relative imports are resolved from the importing file;
5. all resolved files must remain package-local;
6. the package report lists the full resolved module graph.

The manifest's `capabilities` field is the declared package-level expectation.
The verifier/package-check must compare it with the computed union from all AIR
modules:

- if the manifest omits a capability used by an imported module, fail or require
  an explicit manifest update;
- if the manifest declares extra capabilities, warn or fail according to
  package policy;
- report capability origin by module.

## Module Identity

Every resolved AIR file must declare exactly one module name:

```air
module collision
```

The package must have unique module names after resolving imports. Duplicate
names are rejected even if they come from different paths:

```text
duplicate module name 'collision':
  ./collision.air
  ./legacy/collision.air
```

Module identity is the declared module name plus the resolved package-local
path for diagnostics. Symbol qualification uses the module name.

## Exported-Only Cross-Module Calls

Only `export func` crosses module boundaries.

Allowed:

```air
module collision

export func hit_test(x: i32) -> i32 {
entry:
  return %x
}
```

```air
module main
use "./collision.air"

export func frame(x: i32) -> i32 {
entry:
  %hit:i32 = @collision.hit_test(%x)
  return %hit
}
```

Rejected:

```air
module collision

func private_hit_test(x: i32) -> i32 {
entry:
  return %x
}
```

```air
module main
use "./collision.air"

export func frame(x: i32) -> i32 {
entry:
  %hit:i32 = @collision.private_hit_test(%x) # rejected
  return %hit
}
```

Error:

```text
cross-module call to non-exported function collision.private_hit_test
```

## Cycles

Cycles are rejected in the minimal v0.12 design.

Rejected package:

```air
# main.air
module main
use "./player.air"
```

```air
# player.air
module player
use "./main.air"
```

Error:

```text
module import cycle: main.air -> player.air -> main.air
```

Cycle support would require additional initialization, visibility, and lowering
rules. It is not part of this RFC.

## Capability Union

Each module keeps its own `capabilities` declaration.

```air
module main
use "./render.air"
capabilities { debug, input }
```

```air
module render
capabilities { gfx }
extern gfx.draw_primitive(kind: i32, x: f32, y: f32, z: f32, size: f32, material: i32) -> void
```

Computed package capability union:

```json
{
  "capabilities": ["debug", "gfx", "input"],
  "capabilityOrigins": {
    "debug": ["main"],
    "gfx": ["render"],
    "input": ["main"]
  }
}
```

No imported module can silently add host authority. Package-check must show the
origin of every capability and compare the computed union against:

- `air.package.json` declared capabilities;
- selected host profile support;
- strict Host ABI imports.

## Effect Budget Composition

Effect and resource budgets compose at package level.

The verifier/audit should aggregate:

- static allocation bytes;
- dynamic allocation sites;
- loop/effect bounds;
- host import effects;
- table/static data sizes when those features exist;
- per-module warnings and errors.

Package-level budget checks should fail when the composed package exceeds the
declared or default budget, even if individual modules pass in isolation.

Example report shape:

```json
{
  "effectBudget": {
    "status": "pass",
    "modules": {
      "main": { "dynamicAllocations": 0, "staticBytes": 0 },
      "level1": { "dynamicAllocations": 0, "staticBytes": 128 }
    },
    "total": { "dynamicAllocations": 0, "staticBytes": 128 }
  }
}
```

## Host Import Aggregation

Host imports are still declared and verified per module. Package reports also
aggregate them:

```json
{
  "hostImports": ["debug.metric", "gfx.draw_primitive", "input.axis"],
  "hostImportsByModule": {
    "main": ["debug.metric", "input.axis"],
    "render": ["gfx.draw_primitive"]
  },
  "strictHostAbi": {
    "status": "pass"
  }
}
```

Unknown or mismatched host imports fail exactly as they do for single-file AIR.
Splitting modules must not become a way to bypass strict Host ABI validation.

## Deterministic Verification Order

Verification order must be stable:

1. resolve package root and entry from `air.package.json`;
2. parse entry file;
3. resolve imports depth-first by lexical path order;
4. canonicalize resolved package-local paths;
5. reject cycles and duplicate module names;
6. verify private module bodies;
7. verify cross-module exported calls;
8. compute capability/effect/import aggregation;
9. run package/profile compatibility checks.

Diagnostics should include both module name and package-local path.

## Deterministic Build Output

Build output must not depend on filesystem traversal order. Stable inputs:

- canonical package root;
- entry path from `air.package.json`;
- sorted resolved import graph;
- stable module name ordering;
- stable symbol mangling;
- stable formatter output;
- stable audit/package report ordering.

## Output Model Options

### Option A: Linked Single-WASM Output

All resolved AIR modules are linked before lowering. The package produces one
WASM module and one package report.

Benefits:

- simplest host loading model;
- current package/check/report pipeline stays close to v0.10/v0.11 behavior;
- one strict Host ABI import set;
- one capability union;
- one audit/effect budget result;
- deterministic symbol mangling can be internal to the compiler.

Costs:

- no independent module caching in the first slice;
- any source change rebuilds the linked output;
- larger compile unit for very large packages.

### Option B: Multi-Module Package With Explicit Linking

Each AIR file lowers to its own compiled module. The package manifest/linker
describes inter-module calls and host loading.

Benefits:

- future caching and separate compilation;
- clearer source/module artifact boundaries;
- possible future partial validation.

Costs:

- requires runtime/package linking model;
- more host responsibilities;
- cross-module ABI must become stable;
- more complicated capability/effect composition;
- harder deterministic failure modes;
- risks drifting into runtime module loading, which is a non-goal.

### Recommendation

Choose **Option A: linked single-WASM output** for the minimal v0.12 slice.

It solves the reviewability problem while preserving the current AIR execution
model. Option B should remain future design work after package manifests, host
profiles, and package-check compatibility are stable.

## Valid Split Package Example

Directory:

```text
examples/split_platformer/
  air.package.json
  main.air
  player.air
  collision.air
```

`air.package.json`:

```json
{
  "name": "split-platformer",
  "version": "0.1.0",
  "airAbi": "0.10",
  "hostAbi": "0.10",
  "entry": "main.air",
  "capabilities": ["debug", "input"],
  "targetProfiles": ["browser-webgpu"]
}
```

`main.air`:

```air
module main
use "./player.air"
use "./collision.air"

capabilities { debug, input }

extern debug.metric(id: i32, value: i32) -> void
extern input.axis(id: i32) -> f32

export func frame(tick: i32) -> i32 {
entry:
  %x:i32 = @player.step(%tick)
  %hit:i32 = @collision.hit_test(%x)
  @debug.metric(1, %hit)
  return %hit
}
```

`player.air`:

```air
module player
capabilities { }

export func step(tick: i32) -> i32 {
entry:
  %base:i32 = const.i32 560
  %x:i32 = i32.add %base, %tick
  return %x
}
```

`collision.air`:

```air
module collision
capabilities { }

export func hit_test(x: i32) -> i32 {
entry:
  %limit:i32 = const.i32 1000
  %hit:bool = i32.gt_s %x, %limit
  %out:i32 = select %hit, 1, 0
  return %out
}
```

## Rejected Examples

### Remote Import

```air
use "https://example.com/player.air"
```

Rejected because imports are package-local only.

### Cyclic Import

```air
# a.air
module a
use "./b.air"
```

```air
# b.air
module b
use "./a.air"
```

Rejected because cycles are not part of the minimal v0.12 slice.

### Hidden Capability Escalation

```air
module telemetry
capabilities { net }
extern net.probe_tcp(host: i32, port: i32) -> i32
```

If imported by a package that only declared `debug`, package-check must fail or
require the package manifest to declare `net`. The import cannot silently expand
runtime authority.

### Private Cross-Module Call

```air
%x:i32 = @player.private_step(%tick)
```

Rejected unless `private_step` is declared as `export func` in `player`.

## Report Requirements

Package-check/audit should include:

```json
{
  "entryModule": "main",
  "entryPath": "main.air",
  "modules": [
    { "name": "collision", "path": "collision.air" },
    { "name": "main", "path": "main.air" },
    { "name": "player", "path": "player.air" }
  ],
  "capabilities": ["debug", "input"],
  "capabilityOrigins": {
    "debug": ["main"],
    "input": ["main"]
  },
  "hostImportsByModule": {
    "main": ["debug.metric", "input.axis"]
  },
  "effectBudget": {
    "status": "pass"
  },
  "moduleGraph": {
    "status": "pass",
    "cycles": []
  }
}
```

## Non-Goals

- No dynamic imports.
- No runtime module loading.
- No external dependency registry.
- No package manager.
- No remote imports.
- No dependency resolver beyond package-local relative files.
- No hidden capability escalation.
- No public Host ABI additions.
- No Core data syntax implementation.
- No package registry.
- No target bundling.

## Tests Required Before Implementation

Required tests before any compiler implementation:

- valid split package resolves from `air.package.json`;
- relative import outside package root is rejected;
- absolute path import is rejected;
- URL import is rejected;
- missing imported file is rejected;
- duplicate module name is rejected;
- cyclic import is rejected;
- exported helper call succeeds;
- private helper cross-module call is rejected;
- imported module capability appears in package capability union;
- package manifest capability mismatch is reported;
- host imports aggregate by module;
- effect budgets aggregate by module and package;
- deterministic verification order is stable across runs;
- linked single-WASM output is deterministic.

## First Implementation Slice

Recommended v0.12 implementation slice, after RFC review:

1. resolve `use "./file.air"` from `air.package.json` entry;
2. enforce package-local paths;
3. reject cycles and duplicate module names;
4. allow calls only to imported `export func`;
5. compute capability union, effect budget composition, and host import
   aggregation;
6. lower as one linked single-WASM output;
7. add deterministic package-check/audit report fields.

Everything else, including multi-module runtime packages, remote imports,
registry support, dynamic imports, and separate compilation, remains deferred.
