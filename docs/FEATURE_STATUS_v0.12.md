# AIR v0.12 Feature Status

Status: active status register

Version target: v0.12

This document makes v0.12 status explicit so implementation work does not hide
inside roadmap prose. Status values are:

- `stable`: accepted behavior carried into v0.12.
- `active`: implemented or being implemented in v0.12 and covered by tests or
  planned tests.
- `experimental`: present as a narrow first slice; not a complete feature.
- `RFC`: design only; no implementation should be assumed.
- `deferred`: recognized need, not active implementation in v0.12 unless
  explicitly promoted.
- `rejected`: not allowed in AIR Core/public ABI under the v0.12 contract.

Related documents:

- [AIR v0.12 AI-Language Execution Contract](V0_12_AI_LANGUAGE_CONTRACT.md)
- [AIR v0.12 Phase Plan](V0_12_PHASE_PLAN.md)
- [AIR v0.12 Roadmap](ROADMAP_v0.12.md)
- [Numeric And Constraints Policy](V0_12_NUMERIC_AND_CONSTRAINTS_POLICY.md)

| Feature | Status | Layer | v0.12 rule |
| --- | --- | --- | --- |
| Package manifest | active | package/tooling | `air.package.json` declares identity, ABI versions, entry, capabilities, target profiles, and manifests. |
| Host profiles | active | package/tooling | Profiles describe supported capabilities, host imports, asset kinds, manifest kinds, and limits; they do not create ABI. |
| `package-check --profile` | active | package/tooling | Opt-in compatibility gate comparing package requirements with selected host profile. |
| Capabilities | stable | Core/verifier/package | Every host authority must be declared by module/package capability and supported by the selected profile. |
| Effects budgets | stable | Core/verifier/audit | Effects remain verifier-visible budgets and report inputs; wildcard budgets should stay reviewable. |
| Module constants | active | AIR Core | Module-local immutable scalar constants reduce repeated literals and lower to existing constants. |
| Generated handles | active | package/tooling | Package-local generated AIR helper modules reduce magic `i32` drift; not stdlib and not authority. |
| Static scalar tables | RFC | AIR Core | Fixed-size read-only scalar table design only; parser/verifier/lowering are not active. `aiReview` may flag table-like generated patterns as repair hints. |
| Module split | experimental | package/tooling/Core design | First graph-analysis slice may exist and demos may use it as pressure evidence; stable linked output semantics remain gated. |
| Fixed-size arrays/records | stable internal / deferred ergonomics | AIR Core | Existing internal arrays/structs stay; broader authoring ergonomics require explicit RFC promotion. |
| Fixed numeric helpers | active policy | Stdlib/docs | Only pure deterministic backend-neutral resource-free helpers may enter stdlib. |
| Constraints / `requires` / `ensures` | stable | Core/verifier | Contracts remain verifier/audit behavior, not a new dynamic assertion system. |
| Optimizer passes | deferred | compiler/tooling | No optimizer expansion until canonical semantics and reports remain deterministic. |
| Audio authority | active policy | package/manifest/report | Audio playback authority must be explicit; assets and debug metrics do not grant it. |
| Audio event ABI | RFC | Host ABI/package | Candidate explicit event path only; `audio.event` is rejected by current strict Host ABI/profile checks until this RFC is promoted through spec/registry/verifier/profile/report/tests. |
| Sprite transform ABI | RFC | GFX ABI/kit/manifest | Evaluate sprite kit and rig manifests before any public `gfx.*` addition. |
| Asset manifest | active | package/manifest/tooling | Package-local asset declarations validate paths, kinds, fallbacks, and profile support. |
| AI prompt-to-module workflow | active | examples/scripts/docs | Offline deterministic prompt fixtures remain review evidence, not live LLM integration. |
| Anti-slop diagnostics | active/advisory | reports/tooling | Report repeated literals, hidden authority, package/profile mismatch, and repair hints. v0.12 makes safe AIR-slop visible; it does not yet reject every safe-but-unreviewable module. |
| Dynamic maps | rejected | AIR Core | Not part of v0.12. |
| Garbage collection | rejected | AIR Core | Not part of v0.12. |
| Generics | rejected | AIR Core | Not part of v0.12. |
| Runtime reflection | rejected | AIR Core | Not part of v0.12. |
| Dynamic imports | rejected | AIR Core/package | Not part of v0.12. |
| Remote imports | rejected | package/tooling | Not part of v0.12. |
| Package registry | rejected | package/tooling | Not part of v0.12. |
| Runtime module loading | rejected | AIR Core/host | Not part of v0.12. |
| Host object handles | rejected | Host ABI/Core | DOM, WebGPU, Metal, Vulkan, Direct3D, WebAudio, socket, file, and platform objects must not cross into AIR. |

## Promotion Rule

A feature may move from RFC to active only when the target layer is explicit and
the change includes specs, implementation, reports, tests, and migration notes
where needed.

Demo evidence can justify promotion work, but it cannot skip the request, RFC,
spec, verifier, package-check, profile, report, and test path.
