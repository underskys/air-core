# AIR v0.12 Phase Plan

Status: active planning document

Version target: v0.12

This plan keeps all current and deferred work inside v0.12. Work that is too
large for the active implementation path remains a v0.12 RFC or deferred v0.12
item rather than becoming a new version roadmap.

Related documents:

- [AIR v0.12 AI-Language Execution Contract](V0_12_AI_LANGUAGE_CONTRACT.md)
- [AIR v0.12 Feature Status](FEATURE_STATUS_v0.12.md)
- [AIR v0.12 Roadmap](ROADMAP_v0.12.md)
- [AIR package manifest](../spec/AIR_PACKAGE_MANIFEST.md)
- [Host profiles](../spec/HOST_PROFILES.md)

## P0: Package/Profile/Capability Authority

Goal: make package requirements and selected host support machine-checkable.

Work:

- validate minimal `air.package.json`;
- validate host profiles;
- make `package-check --profile` the compatibility gate;
- compute declared and effective capabilities;
- report host import origins and unsupported imports;
- keep capability checks separate from host import checks;
- reject hidden authority through assets, manifests, generated handles, debug
  metrics, examples, kits, or profiles.

Acceptance:

- package-check reports pass/fail/warn deterministically;
- every error has a repair hint where practical;
- profile-aware behavior remains opt-in where legacy behavior requires it;
- no new public Host ABI is added by profile metadata.

## P1: Anti-Slop Review/Report Diagnostics

Goal: make generated AIR easier for humans and AI agents to repair.

v0.12 anti-slop checks are advisory unless they expose a semantic, capability,
profile, or authority violation. The release should not claim that AIR
eliminates all safe-but-unreviewable code yet.

Work:

- add deterministic report fields for package/profile/capability mismatches;
- flag repeated literal floods and magic handles when generated handles exist;
- flag debug-as-event-bus patterns where detectable;
- report unused imports, unreachable code, oversized modules, and oversized
  functions when deterministic checks are available;
- emit machine-readable diagnostic IDs, ranges where available, and repair
  hints so editor integrations and AI repair loops can consume the same data;
- expose repair hints without auto-rewriting source.

Acceptance:

- reports are stable JSON/text surfaces;
- diagnostics explain what layer owns the fix;
- checks do not depend on demo-specific vocabulary.

## P2: Data Ergonomics

Goal: reduce generated boilerplate without adding dynamic language semantics.

Work:

- module-level immutable scalar constants;
- package-local generated handles;
- static read-only scalar tables as an RFC-gated feature;
- no arrays/tables/records expansion beyond accepted v0.12 scope;
- no hidden authority from numeric handles.

Acceptance:

- constants and handles remain compile-time/package-local review aids;
- static tables stay fixed-size, scalar, read-only, and explicitly accounted
  before implementation;
- audit/report output makes generated data visible.

## P3: Package-Local Modules And Deterministic Linking

Goal: split large generated AIR packages without remote imports or runtime
loading.

Work:

- resolve relative package-local imports;
- reject URLs, absolute paths, parent traversal outside package root, and
  missing files;
- build deterministic dependency graphs;
- reject cycles and duplicate module identities;
- aggregate capabilities, host imports, and effects with origins;
- design linked single-Wasm output before enabling cross-module calls.

Acceptance:

- package-check can report the module graph;
- imported modules cannot silently add host authority;
- deterministic graph output is stable across runs;
- runtime module loading remains out of scope.

## P4: Generic Media Authority/Events, If Gated

Goal: make media side effects explicit only after package/profile authority is
stable.

Work:

- keep `debug.metric` diagnostic only;
- keep audio assets separate from audio playback authority;
- design explicit audio event ABI only through spec, registry, verifier,
  capability, profile, report, host declarations, tests, and migration notes;
- route sprite transform pressure through sprite kit and rig manifest design
  before any public GFX ABI.

Acceptance:

- no host side effect is authorized by debug metrics or asset presence;
- media authority is visible in package manifests and reports;
- no demo-specific audio or sprite names become public ABI.

## P5: Cross-Platform Conformance And Release Gate

Goal: make portability measurable instead of assumed.

Work:

- compare package requirements against browser, native, CLI, verifier-only,
  mobile, Linux, Windows, and future host profiles as they exist;
- report unsupported capabilities, imports, manifests, asset kinds, and limits;
- keep host-specific mechanics in hosts;
- keep target packaging as model/RFC work until compatibility gates are stable.

Acceptance:

- release checks prove package/profile/report consistency;
- unsupported host features produce diagnostics, not silent drops;
- AIR does not promise one binary runs everywhere.
