# AIR Review Policy Profiles

Status: recommended v0.15 presets  
Scope: documentation only

These profiles are recommended starting points for package `reviewPolicy`.
They are not global defaults and are not automatically enforced by AIR Core.
Package owners may copy, adjust, and version them in `air.package.json`.

## Common Shape

```json
{
  "reviewPolicy": {
    "schemaVersion": "0.15",
    "profile": "interactive",
    "pathClasses": {
      "authored": ["src/**/*.air"],
      "generated": ["generated/**/*.air"],
      "vendor": ["kits/**"]
    },
    "pathClassOrder": ["authored", "generated", "vendor"],
    "thresholds": {},
    "pathClassThresholds": {},
    "gates": {},
    "trend": {
      "thresholds": {},
      "gates": {}
    }
  }
}
```

Path classes:

- `authored`: package-owned source modules.
- `generated`: deterministic derived AIR modules.
- `vendor`: vendored kit/helper code.

## experimental

Intended use:

- early design sketches;
- local AI generation experiments;
- exploratory package structure;
- temporary fixtures not used as release gates.

Recommended thresholds:

```json
{
  "largeFunctionStatements": 160,
  "largeEntryStatements": 320,
  "largeModuleLines": 800,
  "repeatedLiteralCount": 8,
  "mutableGlobalsPerModule": 64
}
```

Recommended gates:

```json
{
  "air.review.debug_metric_event_bus": "warn",
  "air.review.large_entry": "warn",
  "air.review.magic_handle_literal": "warn"
}
```

False-positive posture:

- Prefer warnings over failures.
- Allow noisy output while testing whether diagnostics are useful.

Risk notes:

- This profile can hide structural drift if used for release candidates.
- Do not use it to justify hidden authority, unsupported Host ABI, or generated
  stale artifacts.

## library

Intended use:

- pure helper libraries;
- stdlib-like package-local helpers;
- reusable deterministic modules;
- capability-free shared code.

Recommended thresholds:

```json
{
  "largeFunctionStatements": 80,
  "largeEntryStatements": 120,
  "largeModuleLines": 360,
  "repeatedLiteralCount": 5,
  "mutableGlobalsPerModule": 0
}
```

Recommended gates:

```json
{
  "air.review.mutable_globals": "fail",
  "air.review.debug_metric_event_bus": "fail",
  "air.review.large_function": "warn",
  "air.review.repeated_literal": "warn"
}
```

False-positive posture:

- Be strict about mutable state and diagnostic/event confusion.
- Keep large-function warnings advisory unless the package is part of a release
  gate.

Risk notes:

- A library profile should not be used for host-authority wrappers.
- Host imports and capabilities remain package/verifier contract issues, not
  reviewPolicy style issues.

## verifier-only

Intended use:

- packages meant to run under `verifier-only`;
- compiler/verifier fixtures;
- source-only validation packages;
- capability-free examples.

Recommended thresholds:

```json
{
  "largeFunctionStatements": 100,
  "largeEntryStatements": 180,
  "largeModuleLines": 420,
  "repeatedLiteralCount": 6,
  "mutableGlobalsPerModule": 16
}
```

Recommended gates:

```json
{
  "air.review.debug_metric_event_bus": "fail",
  "air.review.large_entry": "warn",
  "air.review.select_chain_table": "warn"
}
```

False-positive posture:

- Keep structural diagnostics mostly warning-level.
- Treat host-like event behavior as a failure because verifier-only packages
  should not depend on host behavior.

Risk notes:

- This profile does not replace host profile compatibility checks.
- Any capability or Host ABI mismatch remains a hard package/profile issue.

## policy-audit

Intended use:

- non-game policy packages;
- CI/SRE checks;
- service matrices;
- network allowlists;
- secret/environment boundary metadata.

Recommended thresholds:

```json
{
  "largeFunctionStatements": 70,
  "largeEntryStatements": 140,
  "largeModuleLines": 320,
  "repeatedLiteralCount": 4,
  "mutableGlobalsPerModule": 8
}
```

Recommended gates:

```json
{
  "air.review.large_entry": "fail",
  "air.review.select_chain_table": "warn",
  "air.review.repeated_literal": "warn",
  "air.review.debug_metric_event_bus": "fail"
}
```

False-positive posture:

- Prefer smaller modules and explicit static tables.
- Repeated IDs should become constants or AIR-authored tables.

Risk notes:

- Overly strict repeated-literal gates may flag legitimate policy constants.
- Use waivers only with explicit reason and review ownership.

## interactive

Intended use:

- frame/update-style packages;
- UI-like loops;
- simulations;
- bounded interactive systems.

Recommended thresholds:

```json
{
  "largeFunctionStatements": 90,
  "largeEntryStatements": 220,
  "largeModuleLines": 450,
  "repeatedLiteralCount": 5,
  "mutableGlobalsPerModule": 24
}
```

Recommended gates:

```json
{
  "air.review.large_entry": "fail",
  "air.review.debug_metric_event_bus": "fail",
  "air.review.slot_family_state": "warn",
  "air.review.select_chain_table": "warn",
  "air.review.magic_handle_literal": "warn"
}
```

False-positive posture:

- Entry/frame/main functions should stay orchestration-heavy, not logic-heavy.
- Slot-family warnings are advisory until fixed-pool/tablegroup RFCs are
  promoted.

Risk notes:

- Do not use `debug.metric` as an event/output bus.
- Do not make host code infer gameplay, audio, or effect authority from
  diagnostics.

## generated-heavy

Intended use:

- packages with large deterministic generated AIR modules;
- manifest-derived handles/data;
- generated static tables;
- vendored generated kits.

Recommended thresholds:

```json
{
  "largeFunctionStatements": 100,
  "largeEntryStatements": 180,
  "largeModuleLines": 500,
  "repeatedLiteralCount": 5,
  "mutableGlobalsPerModule": 24
}
```

Recommended path class thresholds:

```json
{
  "generated": {
    "largeFunctionStatements": 400,
    "largeModuleLines": 2400,
    "repeatedLiteralCount": 16
  },
  "vendor": {
    "largeFunctionStatements": 180,
    "largeModuleLines": 1000
  }
}
```

Recommended gates:

```json
{
  "air.generated.missing": "fail",
  "air.generated.stale": "fail",
  "air.generated.untraced": "warn",
  "air.review.debug_metric_event_bus": "fail",
  "air.review.large_entry": "warn"
}
```

False-positive posture:

- Generated size can be tolerated when deterministic and traceable.
- Generated freshness remains strict.

Risk notes:

- Generated files do not grant authority.
- Generated files should not become the source of truth when authored AIR data is
  available.

## release-candidate

Intended use:

- Core release gates;
- package release gates;
- CI before publishing;
- clean MR/RC evidence.

Recommended thresholds:

```json
{
  "largeFunctionStatements": 80,
  "largeEntryStatements": 180,
  "largeModuleLines": 400,
  "repeatedLiteralCount": 4,
  "mutableGlobalsPerModule": 16
}
```

Recommended gates:

```json
{
  "air.review.large_entry": "fail",
  "air.review.debug_metric_event_bus": "fail",
  "air.review.magic_handle_literal": "warn",
  "air.review.select_chain_table": "warn",
  "air.review.slot_family_state": "warn",
  "air.generated.missing": "fail",
  "air.generated.stale": "fail",
  "air.manifest.missing_runtime_resource": "fail",
  "air.manifest.forbidden_runtime_path": "fail"
}
```

Recommended trend gates:

```json
{
  "air.trend.function_statements_increased": "warn",
  "diagnostics.air.review.debug_metric_event_bus": "fail",
  "diagnostics.air.generated.stale": "fail"
}
```

False-positive posture:

- Release candidates should explain or fix warnings.
- Expired waivers fail in release-candidate mode.
- Waivers must be rare and include a reason.

Risk notes:

- This profile should not depend on heavy demo assets unless explicitly declared
  as a Core gate.
- Do not use it to promote demo-specific Core APIs or Host ABI additions.

## Waiver Guidance

Waivers are allowed only for `air.review.*` diagnostics.

Example:

```json
{
  "code": "air.review.large_function",
  "file": "generated/**/*.air",
  "reason": "deterministic generated lookup module; tracked by freshness checks",
  "expires": "2026-12-31"
}
```

Do not waive:

- parser errors;
- verifier errors;
- capability/profile errors;
- Host ABI errors;
- generated stale/missing errors;
- manifest/resource hard errors.
