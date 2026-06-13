# AIR Package Manifest Example

This package demonstrates the v0.12 package/profile/asset foundation and
generated manifest-backed handles.

Run:

```sh
node bin/airc.js generate-handles examples/package_manifest
node bin/airc.js verify examples/package_manifest/use_generated_handles.air
node bin/airc.js package-manifest-check examples/package_manifest
```

`generated/*.air` files are package-local helper modules. They are generated
from `air.package.json` and `assets/manifest.json`.
The asset manifest is validated before generation; invalid package-local paths,
missing required assets without explicit fallback, or unknown asset kinds stop
handle generation.

Generated handles are not AIR Stdlib. They are not public ABI. They are
package-local review aids that replace magic `i32` literals with stable,
manifest-backed functions such as:

- `material_handles.mat_package_basic()`
- `asset_handles.texture_package_checker()`
- `audio_handles.sfx_package_click()`

The example imports generated handle modules directly:

```air
use "./generated/material_handles.air" as material_handles
use "./generated/asset_handles.air" as asset_handles
use "./generated/audio_handles.air" as audio_handles
```

This uses the existing source-import mechanism. It is not the v0.12
package-local module resolver RFC implementation.

`package-check --profile --source-only` is the source/audit mode. It does not
require `module.wasm` yet and still reports package metadata, capabilities,
host imports, manifests, generated handle status where possible, and host
profile compatibility:

```sh
node bin/airc.js package-check <package-dir> --profile browser-webgpu --source-only --json
```

Built mode is the default. It runs after a built `module.wasm` exists. It
compares checked-in generated handles with freshly generated output. If a
generated file is missing or stale, the check fails with a repair hint:

```sh
node bin/airc.js package-check <built-package-dir> --profile browser-webgpu --json
```

```sh
node bin/airc.js generate-handles <package-dir>
```

The texture and audio files in this example are placeholders. Placeholder assets
are useful for deterministic tests, but they do not grant graphics or audio
authority.
Generated audio, material, sprite, and asset handle functions return stable
scalar IDs only. They do not grant `audio`, `gfx`, filesystem, network, or host
object authority.
