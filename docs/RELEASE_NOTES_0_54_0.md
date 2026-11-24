# AIR Core v0.54.0

This release adds the [public pure execution contract](v0.54/n54-01/CONTRACT.md),
its threat model and traceability, and repository documentation cleanup.
It adds no runtime feature, changes no source profile or ABI, and makes
no native, AOT, or performance claim. The runtime remains the v0.53.0
implementation apart from version metadata. The [v0.53.0 release notes](RELEASE_NOTES_0_53_0.md)
remain the reference for that runtime; older version-pinned examples are
not v0.54.0 install instructions.

v0.54.0 is released on GitHub only. It is not published to npm;
`@underskys/air-core@0.53.0` remains the current npm package.

Only G54-PUBLIC is in scope to close for this release. G54-SWIFT, G54-STATE
and G54-LIFECYCLE are covered by contract text only and stay open. TIME,
REPLAY, EFFECT, EVIDENCE and FENCE are out of scope.

These are the SHA-256 digests of the **public** documents in this package.
The public copy omits private citations and does not change the rules.

| Document | SHA-256 |
| --- | --- |
| [Contract](v0.54/n54-01/CONTRACT.md) | `196e04a23c8083260eece03a848cb76f003b1031da00598e2575fb79c29b4e0e` |
| [Threat model](v0.54/n54-01/THREAT_MODEL.md) | `416f8f68300092e5e3d8cd689e2a2fb46363622994e783712c822893c8eb25f1` |
| [Norms table](v0.54/n54-01/NORMS_TABLE.md) | `c37814a25c52117827ee711be998b76519756d7b188e2eb4ffbf20750428cd14` |
| [Open decisions](v0.54/n54-01/OPEN_DECISIONS.md) | `9308121111ed53d817cb2a62a5ed9b7efa2a03d104906639fa5e5868d03e2c47` |

This text does not authorize native execution or supply a revocation mechanism.
