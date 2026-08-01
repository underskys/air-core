# AIR v0.50.2 Release Notes

Package: `@underskys/air-core@0.50.2`

CLI: `airc`

## Public Identity Correction

AIR is a verifier-first programming language and toolchain created and
maintained by [Dmitriy Shtro](https://www.linkedin.com/in/dmitrii-sky-64024810a/?skipRedirect=true).

This patch aligns package metadata, CLI version reporting, README, and public
release documentation. AIR source files use the `.air` extension and are
unrelated to Adobe AIR.

## Compatibility

- No compiler, verifier, or lowerer behavior changed.
- Existing AIR ABI `0.10` modules remain supported.
- Borrowed slices remain opt-in AIR ABI `0.11`.
- Host ABI is not redefined by this patch.
