# AIR Architecture Overview

AIR is a compact verified IR and package contract for AI-authored portable
modules. AIR Core owns verified semantics, package contracts, and
capability-scoped commands. Wasm/airpkg is the current primary backend
artifact. Hosts own real platform devices and runtime integration.

```mermaid
flowchart TB
  subgraph Inputs["Authoring Layers"]
    Demos["Project Kits / demos"]
    Kits["Reusable Kits"]
    Stdlib["stdlib"]
  end

  subgraph Core["AIR Core"]
    Source["AIR Source"]
    Verify["Verifier / audit / explain"]
    Wasm["AIR package / Wasm backend"]
  end

  subgraph Caps["Capability ABIs"]
    Gfx["gfx / gpu"]
    Input["input"]
    UI["ui"]
    FS["fs"]
    Net["net"]
    Audio["audio"]
    Debug["debug"]
  end

  subgraph Hosts["Host Runtimes"]
    Browser["Browser WebGPU"]
    Native["Native wgpu"]
    Game["Game host"]
    Tools["CLI / tools"]
  end

  Demos --> Source
  Kits --> Source
  Stdlib --> Source
  Source --> Verify
  Verify --> Wasm
  Wasm --> Gfx
  Wasm --> Input
  Wasm --> UI
  Wasm --> FS
  Wasm --> Net
  Wasm --> Audio
  Wasm --> Debug
  Gfx --> Browser
  Input --> Browser
  UI --> Browser
  FS --> Tools
  Net --> Tools
  Audio --> Game
  Debug --> Native
  Wasm --> Browser
  Wasm --> Native
  Wasm --> Game
  Wasm --> Tools
```

## Layer Reading

- `Project Kits / demos`: project-specific gameplay, materials, art direction,
  routes, and app logic.
- `Reusable Kits`: optional starter resources such as WGSL shaders, manifest
  fragments, and material presets.
- `stdlib`: generic deterministic AIR helpers only.
- `AIR Core`: source format, verified semantics, package contracts,
  verifier, audit/explain, effects, memory model, and current Wasm lowering.
- `Capability ABIs`: scalar import families that expose authority explicitly.
- `Host Runtimes`: browser, native, game, or tool adapters that own real
  devices, renderers, OS services, platform objects, and execution policy.
