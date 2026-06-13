# AIR v0.27 Release Plan

Status: active stabilization/evidence milestone

Theme: Host ABI `0.11` Stabilization & Adapter Evidence

v0.27 starts after the v0.26 bounded `output.emit` first slice. v0.26 accepted
only this Host ABI `0.11` runtime surface:

```text
output.emit(output_id:i32, arg0:i32, arg1:i32, arg2:i32, arg3:i32) -> i32
```

v0.27 does not expand Host ABI beyond that first slice. The goal is to
stabilize evidence, adapter behavior, diagnostics, conformance, and gates before
any later output/event expansion is considered.

AIR ABI remains `0.10`. Host ABI remains `0.11` only for bounded
`output.emit` packages. Host ABI `0.10` remains supported.

## P0 Scope

| Area | Gate | Acceptance |
| --- | --- | --- |
| Host ABI `0.11` stability matrix | Freeze the accepted first slice. | Matrix covers package manifests, host profiles, verifier/package-check, lowering, SDK imports, mock host, evidence, LSP, and rollback to command buffers. |
| `output.emit` adapter evidence | Prove host adapter behavior without widening authority. | At least one reference/mock adapter and one non-production adapter evidence path report accepted, denied, unsupported, invalid output, and budget outcomes deterministically. |
| Host profile compatibility hardening | Keep profile decisions visible. | Reports and verification evidence consistently expose required Host ABI, selected profile Host ABI, required/supported imports, and unsupported feature diagnostics. |
| Reference/mock host consistency | Keep policy evidence deterministic. | Mock host and runtime `output.emit` traces use the same Output Contract ids, policy decisions, status codes, replay checksum rules, and no-payload evidence boundary. |
| Two-domain conformance fixtures | Preserve generic semantics. | Fixtures cover non-game policy/ops and interactive/visual-like command-intent domains without real platform authority. |
| Verification/report/evidence hardening | Make review output complete. | Evidence shows emit usage, output ids, contract mapping, profile compatibility, policy decisions, and status codes without raw payloads, timestamps, absolute paths, tokens, URLs, or host handles. |
| API gates v0.27 | Prevent scope creep. | Gates preserve the v0.26 first slice and reject event imports, dynamic output ids, strings/payloads/object args, raw authority, host object handles, runtime JSON, and automatic side-effect guarantees. |
| Negative tests against scope creep | Keep rejected surfaces rejected. | Tests fail `output.event`, `audio.event`, `effect_event`, raw Chrome/DOM/DB/cloud APIs, host object handles, runtime JSON/object payloads, and demo-specific host APIs. |

## P1 / If Scope Allows

- generated output handle constants (implemented first slice);
- output handle metadata sidecar (implemented first slice);
- freshness validation (implemented first slice);
- LSP diagnostics for stale, missing, or mismatched output handles (implemented first slice);
- report/evidence mapping for output handles (implemented first slice);
- output.emit ergonomics docs.

Generated output handles must remain package-visible derived artifacts. Output
Contracts remain the source of truth. The first slice generates constants only
with `node bin/airc.js generate output-handles <package-dir>` and reports
freshness through `outputHandleSets`. P1 must not generate emit wrapper
functions unless a separate architecture review accepts that work.

## Deferred

- generated emit wrapper functions unless separately approved;
- dynamic `output_id`;
- `output.event`;
- `audio.event`;
- `effect.event`;
- string, payload, object, map, pointer, slice, or runtime JSON args;
- raw Chrome, DOM, DB, cloud, Kubernetes, Jira, fetch, filesystem, or secret
  authority;
- host object handles;
- runtime JSON/object model;
- automatic host-side action guarantee;
- real production platform adapters;
- package registry or native installers.

## Stabilization Questions

Before v0.27 RC, the repository must answer:

1. Does every `output.emit` report identify the package-required Host ABI and
   selected profile Host ABI?
2. Do mock-host decisions and runtime emit status codes use the same
   accepted/denied/unsupported/invalid/budget semantics?
3. Can reviewers see the Output Contract mapping without seeing private payloads?
4. Do LSP-lite and diagnostics-only Full LSP expose stable diagnostics for every
   first-slice misuse?
5. Do API gates reject every deferred event/output expansion?
6. Can Host ABI `0.10` packages still pass unchanged?

See [Output Emit Adapter Evidence](rfcs/v0.27-output-emit-adapter-evidence.md)
for the required `air.hostInteractionEvidence` shape and no-payload evidence
boundary.

## ABI Policy

AIR ABI remains `0.10`.

Host ABI remains `0.11` only for the bounded `output.emit` first slice accepted
in v0.26. v0.27 does not add host imports, dynamic output ids, richer payloads,
event streams, or automatic side-effect guarantees.

## Representative Checks

```sh
node scripts/check_markdown_links.js
git diff --check
```
