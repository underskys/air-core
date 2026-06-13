# Chrome Extension Host ABI

Title: Chrome Extension Host ABI
Source demo/project: FlowDesk Air Chrome extension pressure.
Original source path: docs/abi-requests/flowdesk-air.md
Target layer: host ABI
Status: rejected/post-1.0
Decision: Rejected before 1.0; no Chrome-extension Host ABI expansion in public alpha.
Rationale: Chrome MV3 APIs, storage, content scripts, alarms, active tab, Jira/fetch, DOM, and IndexedDB are host authority and product integration details.
Compatibility risk: High if exposed as public Host ABI; would expand authority and require policy, profiles, conformance, and security review.
Rejection reason: Host ABI expansion is frozen before 1.0 unless separately accepted; raw `chrome.*` authority is not allowed.
Alternative: post-1.0
Why not Core: Chrome MV3 APIs, browser permissions, DOM/content scripts, storage, fetch, and alarms are host authority and not portable AIR Core behavior.
Existing alternative: Keep Chrome integration in project-local TypeScript and pass minimized scalar facts into AIR.
Demo migration: Use bounded structured facts, tablegroups, declared pools, output contracts, and command buffers where generic.

## Notes

Future extension examples may live in kits or host implementation docs, but not
as Core or Host ABI authority before 1.0.
