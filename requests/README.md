# AIR Request Intake

Requests are proposals, not release scope.

Active triage may happen on the `core/requests` branch. This skeleton exists in
Core so active docs and review bundles can point to a stable intake location.

Accepted requests must become an RFC or a release plan item before they affect
Core scope. Rejected requests should record the reason. Archived requests are
historical.

Demos and downstream projects are pressure evidence, not Core authority. Core
accepts generalized mechanisms, not game-specific APIs.

`docs/PROMISE_DEBT.md` summarizes the current public-alpha promise debt. The
machine-checkable ledger lives in:

- `requests/accepted/`
- `requests/rejected/`
- `requests/archive/`
- `requests/inbox/`

Every non-README file under `docs/abi-requests/` must have a matching formal
ledger entry. Future pressure bypasses fail `node scripts/check_request_ledger.js`.
