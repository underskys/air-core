# AIR v0.11 Version Semantics

v0.11 is a Product/Demo Loop milestone. It does not change the public AIR ABI.

Use these version meanings during release review:

| Version surface | Current value | Meaning |
| --- | --- | --- |
| AIR ABI version | `0.10` | Public AIR/Core/Host ABI contract used by verifier, lowering, package metadata, WIT, and hosts. |
| Compiler/package version | `0.10.0` | Current npm/package compiler version in `package.json`, `package-lock.json`, and `src/version.js`. |
| Conformance report schema | `0.11` | Review/report JSON shape for v0.11 release evidence. |
| Roadmap milestone | `v0.11` | Product/Demo Loop + ABI Request Pipeline + GFX/Utility Foundation milestone. |

## Release Rule

Do not infer a public ABI bump from the v0.11 milestone name.

AIR ABI stays `0.10` unless a separate ABI migration changes specs, verifier
behavior, host ABI registry entries, SDK imports, examples, and migration notes.
This v0.11 release instead stabilizes:

- browser/live demo evidence;
- prompt-to-module loop evidence;
- non-game UI dashboard evidence;
- strict Host ABI/report behavior;
- ABI request governance;
- review bundle sanity;
- GFX foundation diagnostics.

## What May Say v0.11

- Roadmap and release checklist documents.
- Conformance/report schema: `reportVersion: "0.11"`.
- Release/gap/status documents describing the Product/Demo Loop milestone.

## What Must Stay v0.10 Unless Separately Approved

- `AIR_ABI_VERSION`.
- Public Host ABI signatures.
- Public `gfx.*`, `gpu.*`, `input.*`, `ui.*`, utility, and debug signatures.
- Package metadata field `abi`.
- Existing v0.10 examples and host compatibility assumptions.

## Future Bumps

A future compiler/package SemVer bump or AIR ABI bump is a separate release
decision. It must not be hidden inside v0.11 demo or governance work.
