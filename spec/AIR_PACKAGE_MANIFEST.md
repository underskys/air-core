# AIR Package Manifest

Status: active package contract

Version target: active AIR package manifest contract with v0.12-v0.18
extensions.

Manifest file: `air.package.json`

`air.package.json` is the machine-checkable package manifest for AIR modules.
It defines the package side of the compatibility contract between an AIR
package and a target host profile.

The manifest declares package identity, ABI expectations, entry artifacts,
required capabilities, target profiles, and companion manifests. It is not a
package registry format, dependency resolver, remote dependency system, or
target bundler.

Related design:

- [Host Profiles](HOST_PROFILES.md)
- [Asset Manifest](ASSET_MANIFEST.md)
- [Target Packaging Model](../docs/TARGET_PACKAGING_MODEL.md)
- Historical background: [Package Check v0.12 Plan](../docs/PACKAGE_CHECK_v0.12_PLAN.md)
- Historical background: [AIR v0.12 Roadmap](../docs/ROADMAP_v0.12.md)

## Purpose

The package manifest answers:

- what package is this?
- which AIR ABI and Host ABI versions does it expect?
- what AIR file is the package entry point?
- does a built WASM artifact exist yet?
- what capabilities does it require?
- which host profiles is it intended to run against?
- which asset, GFX, audio, or other manifests belong to the package?

`package-check --profile` compares these requirements with a selected host
profile.

## Example

```json
{
  "name": "network-dashboard",
  "version": "0.1.0",
  "airAbi": "0.10",
  "hostAbi": "0.10",
  "entry": "module.air",
  "wasm": "module.wasm",
  "capabilities": ["ui", "debug"],
  "targetProfiles": ["browser-webgpu", "cli"],
  "factSchemas": ["facts/task_summary.facts.json", "facts/task_summary.rowset.schema.json"],
  "structuredIO": ["schemas/task_summary.structured.rowset.json"],
  "outputContracts": ["outputs/main.output.json"],
  "manifests": {
    "assets": "assets/manifest.json",
    "gfx": "scene.airgfx.json",
    "audio": "assets/manifests/audio.json"
  }
}
```

## File Location

The manifest lives at the package root:

```text
package/
  air.package.json
  module.air
  module.wasm
  assets/
```

The package root is the directory containing `air.package.json`. All package
paths are resolved relative to that root.

## Fields

| Field | Required | Type | Rule |
| --- | --- | --- | --- |
| `name` | yes | string | Stable package identifier. Recommended pattern: `^[a-z][a-z0-9._-]{0,127}$`. |
| `version` | yes | string | Package version. SemVer-compatible strings are recommended but not required in the draft. |
| `airAbi` | yes | string | AIR ABI version expected by the package. Current v0.15 planning keeps public AIR ABI at `0.10` unless changed by a separate runtime contract migration. |
| `hostAbi` | yes | string | Host ABI registry version expected by public extern imports. Host ABI `0.10` remains supported; v0.26 recognizes Host ABI `0.11` for the bounded `output.emit` package/profile/check/runtime first slice. |
| `entry` | yes | string | Package-local AIR entry file. Must exist for package validation. |
| `wasm` | no | string | Package-local compiled module artifact. May be absent before build; required in built-mode checks. |
| `capabilities` | yes | string array | Known AIR capability names required by the package. |
| `targetProfiles` | yes | string array | Known host profile ids the package expects to support. |
| `generatedModules` | no | string array | Package-local generated AIR modules that package-check must require and inspect. `generated/state_handles.air` activates Fixed Bounded State handle freshness checks and requires the sidecar `generated/state_handles.meta.json`. `generated/output_handles.air` activates Output Contract handle freshness checks and requires the sidecar `generated/output_handles.meta.json`. `generated/structured_io_handles.air` activates bounded structured IO handle freshness checks and requires the sidecar `generated/structured_io.meta.json`. |
| `factSchemas` | no | string array | Package-local bounded facts or bounded rowset schema JSON files that package-check validates and reports. |
| `structuredIO` | no | string array | Package-local bounded scalar record, structured rowset, or output summary schema JSON files that package-check validates and reports. |
| `outputContracts` | no | string array | Package-local Output Contract / Output Intents JSON files that package-check validates and reports as tooling-only metadata. |
| `packageExports` | no | object array | Host-visible package exports for linked package output. |
| `aiReview` | no | object | Legacy package-local AI review thresholds and optional warning-to-failure policy. Prefer `reviewPolicy` for v0.15 packages. |
| `reviewPolicy` | no | object | Package-local anti-slop review policy: path classes, thresholds, and warning/failure gates. |
| `manifests` | no | object | Manifest kind to package-local manifest path. |

Known capability names come from the AIR capability registry/spec. A manifest
must not define new capability names.

Known target profile names come from host profile definitions such as
`data/host_profiles/<id>.json`.

## Manifest Kinds

Initial manifest kind keys:

| Key | Meaning |
| --- | --- |
| `assets` | Package asset manifest. |
| `gfx` | GFX/render graph manifest such as `.airgfx.json`. |
| `audio` | Audio authority or audio asset manifest. |

Future manifest kinds may be added only when the corresponding spec and
package-check behavior are defined.

## Review Policy

`reviewPolicy` configures package-local anti-slop budgets. It does not change
AIR semantics and does not grant authority.

Example:

```json
{
  "reviewPolicy": {
    "profile": "interactive",
    "pathClasses": {
      "authored": ["src/**/*.air"],
      "generated": ["generated/**/*.air"],
      "vendor": ["kits/**"]
    },
    "thresholds": {
      "largeFunctionStatements": 80,
      "maxExportedEntryStatements": 220,
      "repeatedLiteralCount": 4
    },
    "pathClassThresholds": {
      "generated": {
        "largeFunctionStatements": 500
      }
    },
    "gates": {
      "largeEntryFunction": "fail",
      "debugMetricEventBus": "fail",
      "magicHandleCandidate": "warn"
    }
  }
}
```

Rules:

- thresholds are non-negative numbers;
- path classes are package-local glob-like patterns;
- supported gate actions are `off`, `warn`, and `fail`;
- generated/vendor paths may use different thresholds;
- package-check JSON must include the selected path class and emitted warnings;
- no review policy may weaken syntax, type, capability, Host ABI, package,
  profile, or generated artifact freshness checks.

## Package-Local Path Rules

Every path in `entry`, `wasm`, `packageExports[].module`, `factSchemas`,
`outputContracts`, and `manifests` must be package-local. Every path in
`generatedModules` follows the same package-local rule.

Allowed:

```json
{
  "entry": "module.air",
  "wasm": "build/module.wasm",
  "manifests": {
    "assets": "assets/manifest.json"
  }
}
```

Rejected:

```json
{
  "entry": "../module.air",
  "wasm": "/tmp/module.wasm",
  "manifests": {
    "assets": "../../assets/manifest.json"
  }
}
```

Validators must reject:

- absolute paths;
- parent traversal outside the package root;
- empty paths;
- null bytes;
- URL-like remote paths;
- symlink escapes outside the package root, if symlinks are resolved.

Package-local path validation is a security boundary. Manifests cannot grant
access to files outside the package.

## Package Exports

`packageExports` declares host-visible exports for linked package output. Module
`export func` declarations remain package-internal visibility unless selected by
`packageExports` or a documented compatibility fallback.

Example:

```json
{
  "entry": "main.air",
  "packageExports": [
    {
      "name": "run",
      "module": "main.air",
      "function": "run"
    }
  ]
}
```

Rules:

- `packageExports` must be an array when present;
- each item must be an object;
- `name` is required and must be a stable host-visible export name;
- `module` is optional; when present it must be a package-local AIR path;
- `function` is required and must be a stable AIR function identifier;
- duplicate export names fail validation;
- absolute paths, URL-like paths, null bytes, and package-root escapes fail.

If `packageExports` is absent, linked package tooling may use entry-module
exports as a compatibility fallback. Multi-module packages using this fallback
must emit `air.package.implicit_package_exports` so the behavior remains visible
and repairable.

## Generated Modules

`generatedModules` declares generated AIR files that are part of the package
review surface.

Example:

```json
{
  "generatedModules": [
    "generated/assets.air",
    "generated/asset_handles.air",
    "generated/audio_handles.air",
    "generated/material_handles.air",
    "generated/sprite_handles.air"
  ]
}
```

Rules:

- generated module paths must be relative and package-local;
- missing declared generated modules fail package-check;
- generated modules must not grant authority;
- generated modules may include `# Generator: <path>` headers;
- package-check fails when a generated header references a missing generator;
- generated handle modules are compared against source manifests where possible
  and fail when stale.

`# Generator: repo:<path>` references a repository tool. Other generator paths
are resolved relative to the package root. Review bundles must include any
generator referenced by generated headers when that generated module is part of
a release or package-check fixture.

### Generated State Handles

AIR v0.24 adds the first generated Fixed Bounded State handle freshness slice
without changing AIR ABI or Host ABI. Packages that want generated state handle
constants list the generated AIR file in `generatedModules`:

```json
{
  "generatedModules": ["generated/state_handles.air"]
}
```

The generator command writes two package-visible artifacts:

```sh
node bin/airc.js generate state-handles <package-dir>
```

```text
generated/state_handles.air
generated/state_handles.meta.json
```

`generated/state_handles.air` contains constants only, for example
`STATE_BOARD_ID`, `STATE_BOARD_LEN`, `STATE_BOARD_BYTES`, and
`STATE_BOARD_CELL_I32`. It must not contain public accessor functions, hidden
`__air_state_*` exports, state snapshots, host imports, or raw state values.

`generated/state_handles.meta.json` records source module fingerprints, state
name/id/type/length/byte size metadata, and the generated AIR file fingerprint.
State declarations remain the source of truth. Package-check reports stale,
missing, or mismatched generated state handle artifacts through
`stateHandleSets` diagnostics; the generated files are derived review
artifacts, not runtime ABI.

### Generated Structured IO Handles

AIR v0.32 adds generated bounded structured IO handle freshness without changing
AIR ABI or Host ABI. Packages that want generated field constants list the
generated AIR file in `generatedModules`:

```json
{
  "generatedModules": ["generated/structured_io_handles.air"]
}
```

The generator command writes two package-visible artifacts:

```sh
node bin/airc.js generate structured-io <package-dir>
```

```text
generated/structured_io_handles.air
generated/structured_io.meta.json
```

`generated/structured_io_handles.air` contains constants only, such as
`STRUCT_TASK_SUMMARY_MAX_ROWS`,
`STRUCT_TASK_SUMMARY_FIELD_TASK_ID_OFFSET`, and field type tags. It must not
contain functions, host imports, hidden data readers, runtime JSON helpers, or
generated emit wrappers.

`generated/structured_io.meta.json` records source schema fingerprints,
structured record/rowset/output summary metadata, generated handle constants,
and the generated AIR file fingerprint. `structuredIO` schemas remain the
source of truth. Package-check reports stale, missing, or mismatched generated
structured IO artifacts through `structuredIO.handleSets` diagnostics; the
generated files are derived review artifacts, not runtime ABI.

### Generated Output Handles

AIR v0.27 adds generated Output Contract handle freshness without changing AIR
ABI or expanding Host ABI. Packages that want generated output handle constants
list the generated AIR file in `generatedModules`:

```json
{
  "generatedModules": ["generated/output_handles.air"]
}
```

The generator command writes two package-visible artifacts:

```sh
node bin/airc.js generate output-handles <package-dir>
```

```text
generated/output_handles.air
generated/output_handles.meta.json
```

`generated/output_handles.air` contains constants only, for example:

```air
const OUTPUT_INCIDENT_RECOMMEND_ACTION:i32 = 1
const OUTPUT_INCIDENT_RECOMMEND_ACTION_ID:i32 = 1
const OUTPUT_INCIDENT_RECOMMEND_ACTION_ARG_COUNT:i32 = 4
```

It must not contain emit wrapper functions, hidden exports, host imports, or
`output.emit` calls.

`generated/output_handles.meta.json` records Output Contract fingerprints,
output id/name/handle/capability/arg-count metadata, and the generated AIR file
fingerprint. Output Contracts remain the source of truth. Package-check reports
stale, missing, or mismatched generated output handle artifacts through
`outputHandleSets` diagnostics; the generated files are derived review
artifacts, not runtime ABI.

## State Accessor Policy

AIR v0.24 package-check auto-detects an optional package-root file:

```text
state_accessors.policy.json
```

The policy validates package-authored state accessor helpers. It is not a
manifest entry and does not generate helper functions.

```json
{
  "schemaVersion": "0.24",
  "kind": "air.stateAccessorPolicy",
  "helpers": [
    {
      "name": "board_cell",
      "state": "board",
      "mode": "readCell",
      "exported": true,
      "observationOnly": true
    }
  ]
}
```

Validation checks that helpers exist, reference known state, are exported when
required, return scalar non-reference values, and remain observation-only:
no `state.set`, memory writes, global writes, host imports, command/output
calls, pointer/slice/reference exposure, or unknown calls. Package-check,
report, and verification evidence expose results through
`stateAccessorPolicies`.

## Bounded Facts Schemas

`factSchemas` declares JSON schema files for bounded structured facts and
bounded rowset schema metadata. This is schema/tooling metadata only. It does not add
an AIR runtime object model, tablegroup syntax, dynamic maps, arbitrary JSON
values, runtime imports, generated rowset handles, or Host ABI authority.

Example:

```json
{
  "factSchemas": [
    "facts/task_summary.facts.json",
    "facts/task_summary.rowset.schema.json"
  ]
}
```

Rules:

- schema paths must be relative and package-local;
- missing declared schema files fail package-check;
- schemas must declare fixed `maxRows` values;
- fact columns are scalar-only in the first slice (`i32` and `bool`);
- string/object/map/dynamic column types are rejected;
- duplicate fact column names are rejected;
- schema metadata must not encode timestamps or absolute local paths;
- report/package-check output lists schema fingerprints and fact/table metadata.

Bounded rowset schemas use the same `factSchemas` package metadata path with
`"kind": "air.boundedRowsetSchema"` and `schemaVersion: "0.20"`. Rowset schema
JSON is package metadata/tooling contract data for bounded host facts, not AIR
runtime JSON objects.

Additional rowset rules:

- layout is `columnar` in the first slice;
- `maxRows` is required and must be a bounded positive integer;
- rowset columns are scalar-only (`i32` and `bool`);
- duplicate rowset column names are rejected;
- `rows`, `data`, and `values` are rejected because rowset schemas describe
  shape only, not runtime rows or values;
- column `privacy` metadata is report-visible;
- privacy classifications must not use forbidden markers such as `raw_text`,
  `raw_url`, `token`, or `secret` as allowed column classifications;
- `storageHint` may be `u8`, `u16`, `i16`, `i32`, or `bool` as metadata only;
- compact `storageHint` values may inform reports and estimates, but they do
  not change AIR ABI, Host ABI, or runtime representation.

## Bounded Structured IO Schemas

`structuredIO` declares JSON schema files for bounded scalar records, structured
rowsets, and structured output summaries. This is package metadata/tooling and
generated-binding data only. It does not add AIR runtime JSON, dynamic objects,
nested records, strings, host object handles, tablegroup syntax, declared pools,
or Host ABI authority.

Example:

```json
{
  "structuredIO": [
    "schemas/task_summary.structured.rowset.json",
    "schemas/task_policy_summary.structured.output.json"
  ],
  "generatedModules": [
    "generated/structured_io_handles.air"
  ]
}
```

Supported schema kinds in the v0.32 first slice:

- `air.structuredRecordSchema`;
- `air.structuredRowsetSchema`;
- `air.structuredOutputSummarySchema`.

Rules:

- schema paths must be relative and package-local;
- `schemaVersion` is `0.32`;
- `fields[]` must be a fixed non-empty field list;
- fields are scalar-only (`i32` and `bool`);
- enum, handle, id, flag, counter, and score concepts are represented as `i32`
  fields plus semantic/classification metadata;
- every field must declare `privacy` or `classification`;
- structured rowsets require a positive fixed `maxRows`;
- string/object/map/any/json/payload/nested field shapes are rejected;
- raw URL, private text, token, secret, and credential classifications are
  rejected as allowed field classifications;
- report, verification evidence, package diff, and conformance replay expose
  schema metadata and generated binding status, not raw row values.

## Output Contract Manifests

`outputContracts` declares Output Contract / Output Intents JSON files. In
v0.25 and earlier this is tooling metadata only. In v0.26 it also becomes the
package-check source of truth for the narrow Host ABI `0.11` `output.emit`
runtime/lowering first slice. It does not add `output.event`, `audio.event`, runtime
event streams, generated output handles, or host-side action execution.

Example:

```json
{
  "outputContracts": [
    "outputs/main.output.json"
  ],
  "commandBuffers": [
    "outputs/main.commands.json"
  ]
}
```

Rules:

- output contract paths must be relative and package-local;
- missing declared output contract files fail package-check;
- manifest `kind` must be `air.outputContract`;
- `outputs[]` declares bounded output intents, not runtime events;
- output IDs must be positive integers and unique within the manifest;
- output names and arg names must be stable identifiers;
- arg types are scalar-only in the first slice (`i32` and `bool`);
- string/object/map/blob/dynamic arg payloads are rejected;
- duplicate output IDs, duplicate output names, and duplicate arg names fail;
- metadata must not encode timestamps or absolute local paths;
- package-check/report output lists output count, channels, capabilities,
  fingerprints, and diagnostics.

## Command Buffer Manifests

`commandBuffers` declares package-local command buffer metadata files. Command
buffers record bounded scalar output intent records and must reference
`output_id` values declared by `outputContracts`.

This is tooling/package/conformance metadata only. It remains the rollback and
evidence path for output intents. It does not add `output.event`, `audio.event`,
`effect.event`, automatic host-side action execution, standardized exported
entrypoints, or raw host authority.

Example:

```json
{
  "outputContracts": ["outputs/main.output.json"],
  "commandBuffers": ["outputs/main.commands.json"]
}
```

Rules:

- command buffer paths must be relative and package-local;
- missing declared command buffer files fail package-check;
- manifest `kind` must be `air.commandBuffer`;
- `schemaVersion` must be `0.20`;
- `maxCommands` must be a positive bounded integer;
- `records[]` length must not exceed `maxCommands`;
- command records contain only `output_id`, `arg0`, `arg1`, `arg2`, and `arg3`;
- all command record fields are scalar `i32` values;
- `output_id` must exist in declared `outputContracts`;
- metadata must not encode absolute paths, timestamps, random IDs, host object
  handles, dynamic payloads, strings, maps, or arbitrary JSON objects;
- package-check/report output lists command buffer fingerprints, record counts,
  used output IDs, output intent usage, and diagnostics.

## AI Review Policy

`aiReview` configures package-local anti-slop budgets. Report mode emits
AI-review warnings; package-check may optionally treat selected warnings as
failures when `failOn` is configured.

Example:

```json
{
  "aiReview": {
    "thresholds": {
      "largeFunctionStatements": 80,
      "maxExportedEntryStatements": 40,
      "maxMutableGlobalsPerModule": 24,
      "repeatedLiteralCount": 4,
      "tableLikeGroupSize": 3
    },
    "failOn": [
      "entry-frame-budget",
      "debug-metric-event-bus"
    ]
  }
}
```

Rules:

- thresholds are package policy, not global verifier failures;
- `report --ai-review` remains advisory and machine-readable;
- `package-check` fails only for warning ids or id prefixes listed in
  `aiReview.failOn`;
- warning ids may be exact, such as `entry-frame-budget:frame`, or prefix
  matches, such as `entry-frame-budget`;
- budgets do not add language semantics and do not authorize host behavior.

## Compatibility Contract

The package declares requirements. The host profile declares support.

`package-check --profile <id>` compares:

- package `airAbi` against supported AIR ABI policy;
- package `hostAbi` against profile `hostAbi`;
- package `capabilities` against computed module/package requirements;
- computed module capability union against profile `supports.capabilities`;
- host imports used by the entry module and package-local module graph against
  profile `supports.hostImports`;
- manifest kinds against profile `supports.manifestKinds`;
- asset kinds against profile `supports.assetKinds`;
- authority requirements caused by manifests or app behavior against declared
  package capabilities;
- package limits or resource needs against profile limits when available;
- unsupported features and fallback behavior.

Unsupported requirements must be reported clearly. They must not be silently
ignored or converted into public ABI.

The report keeps declared package capabilities separate from computed
requirements:

- `declaredCapabilities`: the exact `air.package.json` capabilities.
- `computedCapabilities`: capability union from the entry module,
  package-local module graph, and manifest-declared authority requirements.
- `capabilityOrigins`: source modules or manifests that require each
  capability.
- `hostImportOrigins`: source modules that declare public Host ABI imports.
- `profileSupport`: selected host profile support for capabilities, imports,
  manifest kinds, and asset kinds.
- `hiddenAuthority`: diagnostics for behavior that would occur without an
  explicit package capability.

If a module imports `audio.*`, `gfx.*`, `ui.*`, `input.*`, `fs.*`, `net.*`,
`random.*`, `time.*`, or any other public host family, the package manifest
must declare the corresponding capability and the selected host profile must
support both the capability and exact host import. If a manifest declares
module-driven behavior requiring host authority, the same package/profile rule
applies.

Extra package capabilities that are not required by the module graph or
manifest authority are warnings. They remain visible because capabilities are
review authority, not decoration.

## Built Mode

The `wasm` field may be absent before build.

`package-check` has two active modes:

- source/audit mode: `node bin/airc.js package-check <package-dir> --profile
  <id> --source-only` or `--no-built`;
- built mode: the default `node bin/airc.js package-check <package-dir>
  --profile <id>`.

Source/audit mode does not require the `wasm` file to exist. It still reports
package manifest validity, declared and computed capabilities, host imports,
module graph, audio authority, manifest references, generated handle status
where possible, declared generated module status, selected host profile support,
hidden-authority diagnostics, and repair hints.

When package-check runs in built mode:

- `wasm` must be present;
- `wasm` must be package-local;
- the referenced file must exist;
- the built artifact should match any checksum policy if one is later added.

Built mode is separate from target bundling. A package can have a valid WASM
artifact without being a web/native/CLI deployable artifact.

## Example: Utility Package

```json
{
  "name": "utility-metric",
  "version": "0.1.0",
  "airAbi": "0.10",
  "hostAbi": "0.10",
  "entry": "metric.air",
  "capabilities": ["debug"],
  "targetProfiles": ["cli", "verifier-only"]
}
```

Expected compatibility:

- passes a profile that supports `debug.metric`;
- fails a profile that supports no `debug` capability when the module imports
  `debug.metric`;
- fails if the module imports `debug.metric` but the package omits `debug` from
  `capabilities`;
- no assets or manifests required.

## Example: UI Dashboard Package

```json
{
  "name": "network-dashboard",
  "version": "0.1.0",
  "airAbi": "0.10",
  "hostAbi": "0.10",
  "entry": "module.air",
  "capabilities": ["ui", "debug"],
  "targetProfiles": ["browser-webgpu"],
  "manifests": {
    "assets": "assets/manifest.json"
  }
}
```

Expected compatibility:

- requires a profile with `ui` and `debug`;
- must not imply real network scanning;
- asset manifest existence does not grant network, filesystem, audio, or GPU
  authority.

## Example: GFX Package

```json
{
  "name": "gfx-showcase",
  "version": "0.1.0",
  "airAbi": "0.10",
  "hostAbi": "0.10",
  "entry": "module.air",
  "wasm": "module.wasm",
  "capabilities": ["gfx", "debug"],
  "targetProfiles": ["browser-webgpu", "native-wgpu"],
  "manifests": {
    "gfx": "scene.airgfx.json",
    "assets": "assets/manifest.json"
  }
}
```

Expected compatibility:

- fails `verifier-only` if the selected profile does not support `gfx`;
- reports missing shaders/models/assets through manifest and asset validation;
- does not add new public `gfx.*` functions.

## package-check Report Requirements

Profile-aware package-check should emit deterministic text and JSON reports.

Recommended JSON shape:

```json
{
  "package": "network-dashboard",
  "profile": "browser-webgpu",
  "status": "pass",
  "capabilities": {
    "required": ["debug", "ui"],
    "supported": ["debug", "ui"],
    "unsupported": []
  },
  "hostImports": {
    "used": ["debug.metric", "ui.metric"],
    "unsupported": []
  },
  "manifests": {
    "assets": { "path": "assets/manifest.json", "status": "pass" }
  },
  "assets": {},
  "warnings": [],
  "errors": []
}
```

Status values:

- `pass`: all required checks passed;
- `warn`: package can be inspected but has optional/fallback issues;
- `fail`: package is incompatible or invalid.

## Implementation Plan

Recommended implementation sequence:

1. Parse and validate `air.package.json`.
2. Enforce package-local path rules for `entry`, `wasm`, and `manifests`.
3. Validate known capabilities.
4. Validate known target profile ids.
5. Verify the entry AIR file with existing verifier behavior.
6. Collect host imports used by the module.
7. Load selected host profile.
8. Compare capabilities, host imports, manifest kinds, asset kinds, and limits.
9. Emit deterministic human-readable and JSON reports.
10. Keep target bundling and deployable artifacts out of package-check.

## Non-Goals

- No package registry.
- No remote dependencies.
- No dependency resolver.
- No target bundling.
- No runtime host probing.
- No package manager.
- No npm-like ecosystem.
- No new AIR Core syntax.
- No new public Host ABI beyond accepted milestone-specific slices such as the
  v0.26 bounded `output.emit` package/profile/check/runtime first slice.
