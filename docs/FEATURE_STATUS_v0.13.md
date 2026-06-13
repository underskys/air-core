# AIR v0.13 Feature Status

Status: authoritative active feature status

Version target: v0.13

v0.13 is the Verified Module Composition & AI Surface Discipline release. This
file is the authoritative active feature status file for the v0.13 branch. The
release makes packages reviewable as deterministic graphs of package-local AIR
modules instead of one large `.air` file, while keeping demo pressure out of
Core, stdlib, and public Host ABI.

Status values:

- `stable`: accepted behavior carried forward from v0.12.
- `active`: implemented or being implemented in v0.13 with tests.
- `experimental`: available as a narrow first slice; not a complete contract.
- `RFC`: design only; no implementation should be assumed.
- `deferred`: recognized need, not active implementation in v0.13.
- `rejected`: not allowed in AIR Core, stdlib, public Host ABI, or package
  contracts for this release.

Related documents:

- [AIR Project Boundaries](PROJECT_BOUNDARIES.md)
- [AIR v0.13 Release Plan](V0_13_RELEASE_PLAN.md)
- [AIR v0.13 Release Checklist](V0_13_RELEASE_CHECKLIST.md)
- [AIR v0.13 Gap Report](V0_13_GAP_REPORT.md)
- [AIR v0.12 AI-Language Execution Contract](V0_12_AI_LANGUAGE_CONTRACT.md)
- [AIR Layer Manifest](../spec/AIR_LAYER_MANIFEST.md)
- [AIR Core](../spec/AIR_CORE.md)

| Feature | Status | Layer | v0.13 rule |
| --- | --- | --- | --- |
| Package manifest | stable | package/tooling | `air.package.json` remains the package identity and requirement contract. |
| Host profiles | stable | package/tooling | Profiles remain compatibility contracts; they do not create Host ABI. |
| `package-check --profile` | active | package/tooling | Emits deterministic package/profile/module graph compatibility reports. |
| `package-check --source-only` | active | package/tooling | Source/audit mode reports package, profile, manifest, generated handle, and module graph diagnostics without requiring `wasm`. |
| Package-local imports | active | package/tooling/Core verification | Only relative package-local `use "./x.air" as alias` imports are supported. Remote imports, registries, and runtime loading remain rejected. |
| Package-root import safety | active | package/tooling/Core verification | URL imports, absolute paths, symlink/package-root escape, missing imports, duplicate aliases, duplicate module identities, and cycles are rejected. |
| Module graph analysis | active | package/tooling | Reports deterministic module order, imports, exports, private functions, graph edges, errors, capability origins, host import origins, and authority chains. |
| Cross-module calls | active | verifier/package-check | Calls like `alias.exported_func(...)` are allowed only for direct imported modules and exported target functions. Private functions stay hidden. |
| Linked multi-module Wasm output | deferred | lowering | v0.13 verifies and reports the graph first. Package-check warns when package-local multi-module imports are present because linked output remains gated until symbol/linking semantics are explicit. |
| Capability propagation | active | package-check/report | Package capability requirements are computed from reachable modules, manifests, and host imports, with origins and authority chains. |
| Effect propagation | experimental | package-check/report | Per-module effect usage is reported with origins. Strict linked effect-budget composition remains deferred. |
| Module constants | stable | AIR Core | Module-local immutable scalar constants remain compile-time-only names for literals. |
| Static read-only scalar tables | active | AIR Core | Fixed-length scalar literal tables and `table.get` are supported as the first generated-data ergonomics slice. No dynamic arrays, maps, objects, nested tables, or mutation. |
| Generated handles | stable | package/tooling | Package-local generated AIR handle modules remain deterministic and stale-checkable. |
| Generated data modules | experimental | package/tooling | Manifest-derived `generated/assets.air` may expose deterministic static scalar table data and metadata. It does not grant authority or expose host objects. |
| AI review diagnostics | active/advisory | reports/tooling | Reports surface large modules, repeated literals, magic handle candidates, table-like patterns, suspicious debug metrics, and package/profile mismatch. |
| Stable diagnostic codes | active | package-check/module graph | Module graph and package-check errors use deterministic check ids and repair hints where practical. |
| Stdlib helpers | stable policy | stdlib | Stdlib remains pure, deterministic, backend-neutral, resource-free, and host-authority-free. |
| Audio event ABI | RFC | Host ABI/package | A future event model may be designed by RFC, but `audio.event` is rejected as a usable public import in v0.13. |
| Sprite transform ABI | RFC | GFX ABI/kit/manifest | Sprite needs remain kit/manifest/RFC work before public `gfx.*` expansion; `gfx.draw_sprite_transform` is rejected in v0.13. |
| Linked multi-module Wasm | deferred | lowering | Verification/reporting is active; stable linked output is deferred to a later release. |
| Kit vendoring/import mechanism | deferred | package/tooling | Kits remain explicit files/resources, not `std.*` imports or package registry dependencies. |
| Sprite/rig manifests | deferred | manifest/kit | Kept as future kit/manifest work, not Core or public GFX ABI in v0.13. |
| Effect events | deferred | Host ABI/package | `effect.event` has no stable public ABI in v0.13. |
| Rich audio events | deferred | Host ABI/package | Use existing direct `audio.beep` authority path; richer events require future RFC/spec/profile/tests. |
| Browser camera/skybox profile decision | deferred | Host profile/GFX | Browser/native GFX parity for native-only imports is not decided in v0.13. |
| `mobile-gpu-draft` host profile | experimental | host profile metadata | Draft compatibility-planning metadata only. It is not a stable supported runtime profile and is not a v0.13 release gate. |
| Persistent entity buffers | deferred | Core/package | Entity buffer semantics remain outside v0.13. |
| Level recipe compiler | deferred | tooling/demo | Level recipes are demo/tool pressure, not Core release surface. |
| Dynamic maps / GC / reflection / runtime module loading | rejected | AIR Core | Not part of v0.13. |
| Remote imports / package registry | rejected | package/tooling | Not part of v0.13. |
| Host object handles | rejected | Host ABI/Core | DOM, Canvas, WebAudio, WebGPU, Metal, Vulkan, socket, file, process, and renderer objects must not cross into AIR. |
| Dynamic imports | rejected | AIR Core/package | Package-local static imports only. |
| `std.gfx3d` / `std.scene` / `std.voxel` | rejected | stdlib | These are kit/project-local concepts, not stdlib modules. |
| `audio.event` import | rejected | Host ABI | Rejected in v0.13; future event work must go through RFC and promotion gates. |
| `effect.event` import | rejected | Host ABI | No stable effect event ABI exists in v0.13. |
| `gfx.draw_sprite_transform` import | rejected | GFX ABI | Sprite transform is not public GFX ABI in v0.13. |

## v0.13 Version Semantics

- Project milestone: `v0.13`.
- Compiler/package version: remains `0.10.0` in `package.json`.
- AIR ABI version: remains `0.10`.
- Host ABI version: remains `0.10`.

v0.13 changes verification, package graph reporting, generated data hygiene, and
AI-facing diagnostics. It does not promote a new stable Host ABI surface.

## Promotion Rule

Public Host ABI additions still require spec, registry, verifier/signature,
capability checks, package-check/profile/report support, host profile
declarations, generic fixtures/tests, migration notes, and no demo-specific
naming.

Demo pressure can justify request/RFC work. It cannot bypass Core, stdlib, Host
ABI, manifest, package, and profile boundaries.
