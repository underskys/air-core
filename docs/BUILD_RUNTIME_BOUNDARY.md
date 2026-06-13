# Build-Time vs Runtime Boundary

Status: active v0.16 policy

AIR packages may use ordinary development tooling during build and review. The
runtime product or runtime artifact must not depend on that tooling unless a
future runtime contract explicitly declares it.

## Build-Time Allowed

Build and review workflows may use:

- Node;
- npm;
- Python;
- generators;
- asset scripts;
- Codex;
- review bundle scripts;
- CI tooling.

These tools are allowed because they run before a package artifact or target
product is shipped. If a generated artifact depends on a tool, package-check or
artifact metadata should make that dependency visible as build-time evidence.

## Runtime Must Not Require

Runtime artifacts and shipped products must not require:

- Node;
- npm install;
- Python;
- source AIR repo checkout;
- Codex;
- build scripts;
- local absolute paths.

Runtime requirements must be declared as package/product metadata. Hidden
dependencies on local source trees, developer machines, temporary files, or
build scripts are release blockers for runtime artifacts.

## airpkg First Slice

The v0.16 `airpkg` first slice is metadata-only. It records:

- package-relative runtime files;
- package-relative build-time source/generator evidence;
- `boundary.runtimeRequires`, which is empty unless a future accepted runtime
  contract explicitly declares runtime tool dependencies;
- forbidden runtime dependencies such as Node, Python, Codex, and build scripts.

The first slice does not implement target product bundling or native packaging.
