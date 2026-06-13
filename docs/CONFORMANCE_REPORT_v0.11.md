# AIR v0.11 Conformance Report

v0.11 standardizes one reviewable JSON shape for CLI, browser, and native host
conformance evidence. The report is inspection metadata only: it does not add
target packaging, a package registry, AIR Core syntax, or public Host ABI
functions.

The canonical CLI command is:

```sh
node bin/airc.js report examples/gpu_arena.air --manifest examples/gpu_arena.airgfx.json
```

For modules without a graphics manifest:

```sh
node bin/airc.js report examples/gfx.air
```

For host/project audio playback driven by AIR state, pass the app/package audio
manifest so the report can verify authority:

```sh
node bin/airc.js report demo/contra-platformer/game/platformer.air --audio-manifest demo/contra-platformer/assets/manifests/active/audio.json
```

## Required Fields

Every v0.11 conformance report must keep these top-level fields stable:

| Field | Required | Meaning |
| --- | --- | --- |
| `reportVersion` | yes | Report schema version. v0.11 uses `"0.11"`. |
| `status` | yes | Overall `"pass"` or `"fail"`. |
| `moduleName` | yes | AIR module name from source. |
| `airAbiVersion` | yes | AIR ABI version used by the compiler/runtime contract. |
| `exports` | yes | Exported AIR functions with params and return type. |
| `capabilities` | yes | Declared AIR capabilities, sorted deterministically. |
| `hostImports` | yes | Host extern imports with capability, params, and return type. |
| `strictHostAbi` | yes | Public Host ABI verification status and errors. |
| `manifestFeatures` | yes | Manifest feature summary, or `null` when no manifest is supplied. |
| `loadedAssets` | yes | Manifest asset summary for CLI; runtime-loaded assets for browser/native hosts when available. |
| `resources` | yes | Manifest resource references such as shaders, pipelines, render targets, render graphs, and handles. |
| `audio` | yes | Audio authority status: `used`, `source`, `triggers`, `authority`, `status`, diagnostics. |
| `unsupportedHostFeatures` | yes | Unsupported or fallback host-facing diagnostics. |
| `fallbackBehavior` | yes | Explicit fallback/default behavior warnings where applicable. |
| `warnings` | yes | Sorted warning strings. |
| `errors` | yes | Sorted error strings. |
| `repairHint` | yes | Human-readable repair hint when practical, otherwise `null`. |

## JSON Shape

The deterministic CLI shape is:

```json
{
  "reportVersion": "0.11",
  "status": "pass",
  "moduleName": "gpu_arena",
  "airAbiVersion": "0.10",
  "exports": [],
  "capabilities": [],
  "hostImports": [],
  "strictHostAbi": {
    "status": "pass",
    "errors": []
  },
  "manifestFeatures": null,
  "loadedAssets": [],
  "resources": null,
  "audio": {
    "used": false,
    "source": "host-owned",
    "triggers": [],
    "authority": "missing",
    "status": "pass",
    "directImports": [],
    "errors": [],
    "warnings": []
  },
  "unsupportedHostFeatures": [],
  "fallbackBehavior": [],
  "warnings": [],
  "errors": [],
  "repairHint": null
}
```

When a `.airgfx.json` manifest is supplied, `loadedAssets` is grouped by asset
kind. CLI reports mark assets as `declared`, `missing`, `unsupported`, or
`invalid` from manifest validation. Browser/native hosts may extend the same
field with actual runtime load status, but must preserve the top-level field.

`resources` is `null` without a manifest. With a manifest, it lists shaders,
pipelines, render targets, render graphs, and handle groups referenced by the
package. These are manifest/package facts, not AIR Core semantics.

`audio` is always present. Direct AIR `audio.*` imports require the existing
`audio` capability. Host playback driven by AIR state or `debug.metric` must be
authorized by either the module `audio` capability or a host-owned app/package
audio manifest with explicit trigger sources. The `debug` capability alone never
authorizes audio playback.

## Strict Host ABI

`strictHostAbi.status` must be `pass` only when all public host extern names and
signatures match the Host ABI registry. Unknown public host externs are report
failures. This protects v0.11 from demo-generated or hallucinated ABI growth.

The verifier remains the authority for public Host ABI signatures. Manifest and
host checks validate resource references, handles, lifecycle, and unsupported
features.

## Runtime Reports

Browser and native host reports may add host-specific runtime metrics such as
draw counts, canvas status, loaded model counts, GPU adapter details, or window
diagnostics. They should still map their release evidence to the required fields
above when reporting module/package compatibility.

Host-specific diagnostics must not expose backend objects to AIR and must not
turn unsupported features into public ABI.

## Release Evidence

Required smoke commands:

```sh
node bin/airc.js report examples/gfx.air
node bin/airc.js report examples/gpu_arena.air --manifest examples/gpu_arena.airgfx.json
node examples/network_dashboard/run.mjs
node test/run.js
```

Optional host evidence, when the local toolchain and GPU/window environment are
available:

```sh
cargo run --manifest-path hosts/native/Cargo.toml --bin air-native-host -- gfx-stream --metrics-json
npm --prefix hosts/webgpu test
```

## Non-goals

- No target packaging implementation.
- No package registry.
- No new public Host ABI functions.
- No AIR Core syntax changes.
- No GLB/glTF parsing in AIR Core.
- No real network scanning.
