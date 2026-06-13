# AIR Architecture Gates

AIR architecture gates define which future changes require explicit
architecture / PRO review before implementation. They are intended to keep AIR
small, verifier-first, and host-authority-safe as the project adds useful
surface area.

## Why Gates Exist

AIR is an AI-first verified IR. Useful features can still create slop if they:

- expand runtime authority;
- create hidden ABI;
- add dynamic data models;
- create multiple canonical ways to solve the same problem;
- bypass verifier, report, or conformance evidence.

The gates below do not block routine maintenance. They require an explicit
architecture decision when a change could alter AIR semantics, host authority,
or the canonical package contract.

## Gate Policy

A feature requires architecture review before implementation if it changes:

- AIR language syntax;
- verifier semantics;
- lowering or runtime representation;
- AIR ABI;
- Host ABI;
- host authority;
- package or runtime contract;
- generated code semantics;
- LSP code actions or automated repair behavior;
- conformance or evidence semantics.

Review must happen before parser, verifier, lowering, host, or compatibility
work starts. If implementation reveals a new ABI or authority impact, stop and
return the feature to architecture review.

## Explicit PRO-Gated Features

### A. Generated State Handles / Accessors

Required review questions:

- Is the mechanism a package-visible generated module or a hidden compiler
  export?
- How is generated-code freshness checked?
- How do verifier, report, and LSP diagnostics see generated accessors?
- How are hidden `__air_state_*` exports prevented?
- What is the rollback path for packages that do not use generated handles?

### B. Compact State `u8` / `u16` / `i16`

Required review questions:

- What range proof is required for writes?
- How is silent truncation prevented?
- Do compact reads return `i32`?
- What are write semantics for dynamic values?
- What lowering model preserves state isolation?
- Does the runtime or package contract become ABI-visible?

### C. Tablegroups

Required review questions:

- Is the feature source ergonomics or runtime layout?
- Are layouts fixed-size and scalar-only?
- How is an object model avoided?
- How is dynamic allocation avoided?
- Does any tablegroup layout become ABI-visible?

### D. Host ABI `0.11` / `output.emit`

Required review questions:

- Is there evidence from two independent domains?
- Can package-check, reports, and verification evidence describe the surface?
- Can conformance replay it deterministically?
- Is there a mock host / policy executor?
- What is the rollback and compatibility path?
- How do API gates prevent reintroducing raw host authority?

### E. State Snapshots As ABI

Required review questions:

- Can explicit exported scalar helpers satisfy the use case instead?
- If a standardized runtime snapshot is proposed, what AIR ABI changes?
- How is host direct state access prevented?
- How are raw state dumps avoided by default?
- What conformance evidence is required?

### F. AIR ABI `0.11`

Required review questions:

- What runtime or executable contract changed?
- What compatibility path exists for old packages?
- What old package behavior is preserved or rejected?
- What host or runtime changes are required?
- Can the feature remain tooling/report/conformance-only instead?

### G. LSP Code Actions / AI Repair Loop

Required review questions:

- Are responses suggestions or automatic rewrites?
- Are stable diagnostics the source of truth?
- How is a parallel repair engine avoided?
- What user or agent confirmation model is required?
- How are edits made deterministic and reviewable?

## Non-Gated Routine Changes

Routine changes normally do not need architecture review when they stay within
existing semantics and contracts. Examples:

- docs wording;
- markdown link fixes;
- tests for existing behavior;
- review bundle hygiene;
- small examples using existing APIs;
- diagnostics message wording without diagnostic code or semantic changes.

If a routine change touches a gated area accidentally, the gated policy wins.

## Required Architecture Review Output

Every gated feature review must produce:

- architecture verdict;
- P0 / P1 / deferred scope;
- ABI decision;
- verifier, report, and conformance impact;
- risks and kill criteria;
- Codex prompt batch;
- rollback / compatibility strategy.

The review output should be source-controlled before implementation starts.

## Integration With Roadmap

Architecture gates are roadmap controls, not milestone bumps by themselves. A
single gate document, cleanup, or pressure request must not create a new public
project milestone.

Current policy references:

- [Version and ABI Policy](VERSION_AND_ABI_POLICY.md)
- [Feature Status v0.23](FEATURE_STATUS_v0.23.md)
- [Release Plan v0.23](V0_23_RELEASE_PLAN.md)
- [API Gates v0.22](API_GATES_v0_22.md)
