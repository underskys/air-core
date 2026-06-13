# AIR Stdlib Hygiene Audit

Status: v0.12 release gate

The canonical v0.12 stdlib hygiene audit is
[V0_12_STDLIB_HYGIENE_AUDIT.md](V0_12_STDLIB_HYGIENE_AUDIT.md).

Summary:

- stdlib must be pure, deterministic, backend-neutral, resource-free, and
  broadly generic;
- `stdlib/*.air` must use `capabilities { }`;
- `stdlib/*.air` must not declare host externs;
- `stdlib/*.air` must not call Host ABI families;
- host-facing wrappers such as `gfx3d`, `scene`, `ui`, and `voxel` have been
  moved or quarantined outside `stdlib/` and remain blocked from re-entering
  public stdlib by the layer guard;
- `kits/voxel-basic/air/voxel.air` is an experimental reusable kit candidate,
  not stdlib, not AIR Core, and not public Host ABI.
