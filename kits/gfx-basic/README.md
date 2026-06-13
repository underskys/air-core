# AIR GFX Basic Kit

`kits/gfx-basic` is an optional reusable starter kit for AIR GFX packages.

It is not AIR Core and it is not AIR stdlib. AIR Core stays focused on the IR,
verifier, contracts, memory, control flow, and Wasm lowering. AIR stdlib stays
focused on deterministic `.air` helper modules. This kit contains reusable
graphics resources that projects may use, fork, replace, or ignore.

The kit provides:

- small WGSL shader templates;
- a manifest fragment with basic shaders, pipelines, and materials;
- basic material presets;
- a tiny AIR example that emits a high-level primitive draw command.

Hosts still own real renderer work. AIR modules only emit verified scalar
commands and reference manifest resources by stable keys or handles.

Do not put project art direction here. Demo-specific assets, themed materials,
named scene objects, and game-specific palettes belong under `demo/`,
`examples/`, or a dedicated project kit.
