# RFC: AIR v0.12 Core Generated Data Ergonomics

Status: draft

Version target: v0.12

Target layer: Core

This RFC handles pressure from generated demos and tools for readable constants,
handles, static tables, and generated data. It is a design document only. It
does not implement compiler changes, add Host ABI functions, or change v0.11
behavior.

Source evidence:

- [core-data-ergonomics.md](abi-requests/core-data-ergonomics.md)
- [voxel-demo.md](abi-requests/voxel-demo.md)
- [contra-platformer.md](abi-requests/contra-platformer.md)
- [network dashboard demo](../examples/network_dashboard/README.md)
- [GFX v0.11 plan](archive/v0.11/GFX_v0.11_PLAN.md)

Focused follow-up:

- [RFC_CORE_MODULE_CONSTANTS_v0.12.md](RFC_CORE_MODULE_CONSTANTS_v0.12.md)
- [RFC_CORE_STATIC_TABLES_v0.12.md](RFC_CORE_STATIC_TABLES_v0.12.md)

## Problem

Generated AIR becomes verbose when the same scalar values are repeated inside
many functions:

- material, model, camera, input, metric, and render graph handles;
- thresholds and fixed-point scale factors;
- status/severity values for UI dashboards;
- viewport and grid constants;
- small lookup data generated from tools.

Demos and tools need readable names for those values. That pressure must not be
hidden inside Host ABI. A missing source-language convenience is not a reason to
add new host imports, broader `gfx.*` functions, or demo-specific stdlib names.

The design goal is to improve reviewability of generated AIR while preserving:

- strict public Host ABI;
- deterministic formatter output;
- verifier/audit visibility;
- portable lowering;
- resource-free Core semantics;
- no demo-specific syntax.

## Current State

AIR v0.10 already supports local constants:

```air
%camera:i32 = 1
%threshold:i32 = const.i32 120
%scale:f32 = 0.5
```

AIR also supports `global name:type = const.* value`, but globals are mutable
through `global.set`. They are not a clean read-only constant declaration for
generated data.

Manifest-backed handles already exist for GFX packages through `.airgfx.json`.
AIR sees only scalar handles. Host-owned resources, assets, shaders, textures,
GPU buffers, and platform objects must remain outside AIR Core.

## Evidence From Demos

### Voxel Demo

Useful generic pressure:

- repeated material handles;
- repeated metric IDs;
- repeated chunk/cell sizes;
- repeated render graph or model handles;
- small fixed-point thresholds.

Project-local data that must not enter Core:

- terrain, biome, cave, road, river, animal, palette, sky, water, and spawn
  semantics;
- voxel-demo material ID names;
- art direction or gameplay rules.

### Contra Platformer

Useful generic pressure:

- viewport width/height constants;
- activation window constants;
- input handles;
- metric IDs;
- fixed-point movement thresholds;
- small state/status IDs.

Project-local data that must not enter Core:

- player, enemy, bullet, weapon, score, health, pickup, boss, music, level, and
  art semantics.

### Network Dashboard

Useful generic pressure:

- UI widget IDs;
- severity/status values;
- latency and packet-loss thresholds;
- table row/column counts;
- debug metric IDs.

Project-local or host-policy data that must not enter Core:

- real scan targets;
- CIDRs, ports, hostnames, credentials, or network policy;
- hidden network authority.

### GFX Showcase

Useful generic pressure:

- camera, model, pipeline, material, input, and render graph handles;
- post effect IDs;
- small scalar parameters for examples.

Project-local or host-owned data that must not enter Core:

- GLB/glTF parsing;
- shader code;
- textures;
- WebGPU buffers, pipelines, bind groups, and backend objects.

## Candidate 1: Module-Level Scalar Constants

Draft syntax:

```air
module generated_scene

const camera_main:i32 = 1
const metric_visible:i32 = 10
const latency_warn_ms:i32 = 120
const loss_warn_permille:i32 = 25

capabilities { debug }
effects { debug.metric <= 1 }

extern debug.metric(id: i32, value: i32) -> void

export func run() -> void {
entry:
  @debug.metric(metric_visible, latency_warn_ms)
  return
}
```

Recommended supported types:

- `i32`
- `i64`
- `f32`
- `f64`
- `bool`

`slice` string constants, arrays, structs, vectors, and buffers should be
deferred until read-only data sections are specified.

Parser impact:

- Add a top-level `const <name>:<type> = <literal>` form.
- Names share module-level namespace with globals, structs, externs, and
  functions to avoid ambiguous references.
- Constants may appear after `module` / `use` / `capabilities`, before
  functions.

Formatter impact:

- Emit constants in canonical top-level order.
- Preserve one declaration per line.
- Normalize literals exactly like local compact constants.
- Keep examples multiline and reviewable.

Verifier impact:

- Type-check literal against declared type.
- Reject duplicate names.
- Reject mutation attempts.
- Allow constants as call arguments and operation arguments where a literal of
  the same type is valid.
- Treat constants as statically visible for contracts, budgets, manifest handle
  checks, and repair hints.

Lowering impact:

- Prefer inline substitution into Wasm constants.
- No memory allocation.
- No import/export ABI change.
- No WIT change except optional metadata if later needed.

Audit impact:

- Report constants as review metadata.
- Do not count constants as allocations.
- Use constants when computing static effect/budget evidence.

Memory/resource impact:

- None for scalar constants.
- No data segment.
- No host resource authority.

Backwards compatibility:

- Additive syntax.
- Existing v0.10 examples remain valid.
- Formatter should not rewrite local constants into module constants.

Positive examples:

```air
const input_move_x:i32 = 1
const ui_health_id:i32 = 20
const fixed_one:i32 = 1000
const dashboard_warn:i32 = 1
```

Negative cases:

```air
const material_grass:i32 = 7      # rejected by policy in public examples/stdlib if project-specific
const ids:array<i32,4> = [1,2,3,4] # unsupported candidate 1
const name:slice = "main"          # deferred until read-only data sections
const camera_main:i32 = @random.u32() # initializer must be literal
```

## Candidate 2: Enum-Like Handles

Enum-like handles are named scalar constants, not a separate runtime type.

Draft syntax option A, preferred:

```air
const camera_main:i32 = 1
const pipeline_basic:i32 = 2
const input_orbit_x:i32 = 3
```

Draft syntax option B, deferred:

```air
enum handles:i32 {
  camera_main = 1
  pipeline_basic = 2
  input_orbit_x = 3
}
```

Parser impact:

- Option A uses Candidate 1 and adds no separate syntax.
- Option B adds a new top-level declaration and nested item parser.

Formatter impact:

- Option A remains simple one-line constants.
- Option B requires ordering and block formatting rules.

Verifier impact:

- Option A is regular scalar constant verification.
- Option B would need enum namespace rules, duplicate value policy, type rules,
  and reference syntax.
- Manifest handle validation can use Option A constants immediately if the
  verifier resolves constants before static handle checks.

Lowering impact:

- Option A inlines scalar constants.
- Option B should also inline, but adds metadata complexity.

Audit impact:

- Option A reports constants.
- Option B may report enum groups but adds no runtime evidence.

Memory/resource impact:

- None.
- Handles remain scalar numbers. Backend objects are never exposed to AIR.

Backwards compatibility:

- Option A is purely additive with Candidate 1.
- Option B is larger syntax expansion and should not be first.

Positive examples:

```air
const render_graph_main:i32 = 1
const model_crate:i32 = 2
const metric_latency_ms:i32 = 100
```

Negative cases:

```air
const webgpu_buffer:i32 = 99     # name implies backend object handle; reject by docs/policy
const enemy_soldier:i32 = 12     # project-specific, keep in project kit
enum enemies:i32 { grunt = 1 }   # defer enum block syntax
```

## Candidate 3: Static Tables

Draft syntax, not recommended for first v0.12 slice:

```air
table severity_thresholds:i32[3] = [80, 120, 200]
```

Parser impact:

- Adds array literal parsing and module-level typed table declarations.
- Needs exact grammar for lengths, element types, comments, and trailing
  commas.

Formatter impact:

- Must decide one-line vs multiline canonical table layout.
- Must normalize table literals deterministically.

Verifier impact:

- Verify fixed length and element types.
- Reject unbounded arrays.
- Define access operation or lowering into existing `array<T,N>`.
- Prove read-only behavior.

Lowering impact:

- Could inline small tables into local `array.new`, or lower to read-only data
  sections.
- Needs deterministic layout and bounds checks.

Audit impact:

- Report static table count and bytes.
- Include table bytes in `memory.static_alloc_bytes` only if lowered into
  memory.

Memory/resource impact:

- Potential static memory/data segment.
- No host resource authority.

Backwards compatibility:

- Additive, but larger than scalar constants.

Positive examples:

```air
table dashboard_latency_ms:i32[3] = [60, 120, 250]
table viewport_activation:i32[2] = [240, 480]
```

Negative cases:

```air
table terrain_biomes:i32[64] = [...] # project-specific content
table routes:i32[] = [...]           # unbounded length rejected
table objects:dynamic = [...]        # dynamic objects rejected
```

Decision: defer until scalar constants prove insufficient.

## Candidate 4: Compact Data Blocks

Draft concept:

```air
data metrics:i32 {
  latency = 1
  loss = 2
  health = 3
}
```

Parser impact:

- Adds new block syntax and named fields.
- Requires namespace rules and field lookup syntax.

Formatter impact:

- Requires canonical block formatting.
- Requires ordering rules and duplicate handling.

Verifier impact:

- Must type-check every field.
- Must decide whether fields are constants, table entries, or records.
- Must reject nested dynamic structures.

Lowering impact:

- Likely inline constants for scalar fields.
- Could become metadata only.

Audit impact:

- Report block names and static values.

Memory/resource impact:

- None if scalar-only.
- More complex if arrays/tables are allowed.

Backwards compatibility:

- Additive, but looks more like a language expansion.

Positive examples:

```air
data ui_ids:i32 {
  health = 10
  latency = 11
}
```

Negative cases:

```air
data enemies { grunt = { hp = 3, speed = 2 } } # dynamic/object-like syntax
data palette { cave = "#112233" }              # project art direction
```

Decision: defer. The same reviewability can be achieved first with named scalar
constants.

## Candidate 5: Read-Only Data Sections

Draft concept:

```air
rodata thresholds:i32[4] = [20, 40, 80, 160]
```

Parser impact:

- Similar to static tables but explicitly tied to memory/data layout.

Formatter impact:

- Canonical table formatting required.

Verifier impact:

- Must prove read-only access.
- Must define operations to get pointer/slice/length safely.
- Must prevent mutation and lifetime confusion.

Lowering impact:

- Lower to Wasm data segments or generated memory initialization.
- Needs deterministic offsets, alignment, and compatibility with existing
  memory region checks.

Audit impact:

- Must account for static bytes.
- Must expose data section sizes in audit.

Memory/resource impact:

- Static memory bytes.
- No host authority.

Backwards compatibility:

- Additive, but changes memory accounting surface.

Positive examples:

```air
rodata latency_thresholds:i32[3] = [80, 120, 250]
```

Negative cases:

```air
rodata compressed_model:bytes = ... # asset data belongs in package/host assets
rodata texture_png:bytes = ...      # textures remain host-owned package assets
```

Decision: defer until memory/resource accounting has a dedicated design slice.

## Candidate 6: Manifest-Backed Resources

Manifest-backed resources are already the right route for assets, shaders,
materials, models, render graphs, UI resources, and host-owned objects.

Example:

```json
{
  "handles": {
    "cameras": { "main": 1 },
    "pipelines": { "basic": 2 },
    "models": { "cube": 3 }
  }
}
```

AIR source references scalar handles:

```air
const camera_main:i32 = 1
extern gpu.set_camera(camera: i32) -> void
```

Parser impact:

- None if AIR only uses scalar constants.

Formatter impact:

- None beyond scalar constants.

Verifier impact:

- Existing manifest checks should validate static handle constants after
  constant resolution.
- Core verifier still checks only AIR semantics and Host ABI signatures.

Lowering impact:

- Constants inline as numbers.
- Host loads resources from manifest/package.

Audit impact:

- AIR audit reports constants/imports.
- Manifest/package reports resources and unsupported host features.

Memory/resource impact:

- Resources remain host/package-owned.
- No backend object crosses into AIR.

Backwards compatibility:

- Compatible with current `.airgfx.json` and package paths.

Positive examples:

```air
const camera_main:i32 = 1
const graph_main:i32 = 2
@gpu.set_camera(camera_main)
@gpu.execute_render_graph(graph_main)
```

Negative cases:

```air
const gpu_buffer_object:i32 = 44 # AIR must not hold backend object IDs
const file_descriptor:i32 = 3    # host-owned authority, not a Core constant
```

Decision: continue using manifest-backed resources, with scalar constants only
as readable aliases for stable handles.

## Recommendation

Choose one minimal v0.12 candidate:

1. Implement module-level immutable scalar constants.
2. Treat enum-like handles as a naming convention over scalar constants.
3. Resolve constants before verifier static checks, manifest handle checks,
   audit, and lowering.
4. Defer static tables, compact data blocks, and read-only data sections.

This gives generated AIR immediate readability without expanding Host ABI or
turning AIR into a Python/JavaScript-like scripting language.

## Required Implementation Path

No implementation is approved by this RFC draft until a concrete task includes:

1. Spec update in [AIR_CORE.md](../spec/AIR_CORE.md).
2. Parser support.
3. Formatter canonicalization.
4. Verifier type/namespace/static-value checks.
5. Lowering support through inline constants.
6. Audit/report visibility.
7. Manifest handle check integration where applicable.
8. Tests for positive and negative cases.
9. Migration notes confirming v0.10 examples remain valid.

## Non-goals

- No quick v0.11 syntax patch.
- No unbounded arrays.
- No dynamic objects.
- No host authority.
- No demo-specific syntax.
- No Python/JS-like language expansion.
- No new public Host ABI.
- No `gfx.*` growth.
- No project material IDs, routes, palettes, actor names, score rules, or
  network scan targets in Core or stdlib.
- No GLB/glTF, shader, texture, audio, or backend object data in AIR Core.

## Open Questions

- Should constant names use a reserved prefix policy for generated handles, or
  should public examples rely on review and layer guard only?
- Should constants appear before or after `capabilities` in canonical format?
- Should constants be included in WIT/package metadata, or only in audit/report
  metadata?
- Should `const.str` remain local only until read-only data sections exist?
- Should manifest handle checks accept only constants, local constants, or both?
