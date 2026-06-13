# AIRGFX Native Host

Rust `wgpu` reference host scaffold for AIR GFX v0.10 packages. It preserves
compatibility with v0.9 package manifests where the shared ABI remains stable.

## CI-Safe Commands

```sh
cargo run -- run ../../build/conformance/ui-tool
cargo run -- conformance ../../build/conformance/ui-tool --screenshot native-smoke.txt
cargo run -- gfx-stream ../../demo/voxel-demo/public/game-metal.wasm --frames 1000,34000,38000
```

The host reads `air-package.json`, validates the referenced `.wasm` and `.airgfx.json`, requests a `wgpu` adapter/device, compiles WGSL shader modules, counts input/UI resources, and prints a browser-compatible conformance JSON report.

`gfx-stream` is a high-level `gfx.*` compatibility probe for demos that still
stream `gfx.draw_primitive` commands instead of shipping `.airgfx`/`gpu.*`
packages. It instantiates the wasm module, provides the generic `debug`, `gfx`,
and `input` imports, calls `frame(t)` for selected frame times, and prints
native command metrics as JSON. It is the preferred headless CI command because
it does not create a window or require a GPU surface.

The `gfx-stream` JSON report includes:

- top-level pass/fail state: `available`, `passed`, `failed`;
- the existing import capability set: `debug`, `gfx`, `input`;
- one `frames[]` entry per requested frame time;
- per-frame command counts: `commands`, `visibleInstances`,
  `zeroSizeCommands`, `emissiveCommands`, `transparentCommands`, and
  `primitiveBatches`;
- per-frame camera and skybox state from `gfx.camera_look_at` and
  `gfx.skybox_world`;
- generic `debugMetrics` keyed by metric id, plus compatibility aliases for
  known demo metrics such as `clearance`, `animalVisible`, `animalRejected`,
  and `birdVisible`;
- `frameTimeMicros` when timing is available;
- a deterministic `checksum` for review diffs.

`conformance` is CI-safe when a GPU adapter is unavailable: it prints a JSON
report with `available: false` and `unsupportedReason` instead of failing
silently. Use it for package-level host review.

`Cargo.lock` is intentionally checked in because this is an application-style
native host, not a published Rust library. Review bundles should include
`Cargo.toml`, `Cargo.lock`, `src/*.rs`, and this README.

## Manual GPU/window Commands

```sh
cargo run -- gfx-window ../../demo/voxel-demo/public/game-metal.wasm
AIR_NATIVE_EXIT_MS=2500 cargo run -- gfx-window ../../demo/voxel-demo/public/game-metal.wasm
```

`gfx-window` uses the same existing `gfx.draw_primitive` stream and opens a
windowed `wgpu` surface. It projects commands through the AIR
`gfx.camera_look_at` state and draws host-owned instanced cube fallback
geometry with a depth buffer and simple sky pass. AIR still emits only the
existing public `gfx.*` commands; no new AIR Core syntax or public GFX ABI is
required for this compatibility renderer. Run it through
`demo/voxel-demo/scripts/run-metal.sh` for the release-profile path used by the
demo. Set `AIR_NATIVE_EXIT_MS=2500` when you need a short automated launch
smoke. On unsupported platforms it prints diagnostic JSON with
`backend: "gfx-window"` and `unsupportedReason`, then exits with an error.

Local verification requires a Rust toolchain. This workspace currently may not have `rustc` installed.

## v0.11 Boundaries

The native host is host implementation work only. It must stay behind existing
registered imports and must not add AIR Core syntax, public `gfx.*` functions,
public GPU/voxel ABI, target packaging, package registry behavior, or backend
objects visible to AIR.
