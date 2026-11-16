# AIR Core 0.53.0

Package: `@underskys/air-core@0.53.0`. Tag: `v0.53.0`. The npm registry, not this
file, is the source of truth for publication state and dist-tags.

0.52.0 and 0.52.1 were never published; 0.51.0 is the last published line.
0.53.0 contains their content (see the [0.52.0](RELEASE_NOTES_0_52_0.md) and
[0.52.1](RELEASE_NOTES_0_52_1.md) notes) and adds the typed-v0.53 source profile
as a candidate.

## The typed-v0.53 candidate profile

typed-v0.53 is a candidate profile in 0.53.0. It is selected only together with
`--allow-candidate-profile` on the CLI (`--source-profile typed-v0.53
--allow-candidate-profile`), or `allowCandidateProfile: true` in the SDK.
`legacy-v0.50` stays the default, and `typed-v0.51` is unchanged. AIR ABI and
Host ABI do not move: AIR ABI `0.10` and `0.11` and Host ABI `0.10` and `0.11`
keep their meaning, and AIR ABI `0.12` remains a candidate.

The ABI and host statements of this release:

1. "`typed-v0.53` is a new opt-in canonical source profile. The default remains
   `legacy-v0.50`."
2. "typed-v0.53 artifacts with borrowed (memory-view) exports use a new AIR ABI
   lane `0.13` and require the AIR contract import
   `air:contract/typed-v0.53.v1`." "Host ABI capability lanes 0.10/0.11 are
   unchanged; the host execution interface changed and is versioned by the
   host-adapter contract `typed-v0.53.v1`." "AIR ABI 0.12 remains a candidate."
3. "Hosts older than 0.53 cannot instantiate these artifacts; the engine refuses
   (no AIR diagnostic is possible on shipped hosts), in every binding mode,
   copied mode included."
4. "Hosts that call exports directly must use the 0.53 admission helper with a
   trusted record (in-process) or a digest they pin from a channel they trust.
   The contract handshake is not authentication. The artifact rejects borrowed
   ranges that overlap its own memory on every host. Digest pinning, external
   mutation and reentrancy remain host duties."
5. "typed-v0.53 protection requires the typed admission API with a trusted
   record. The legacy API offers legacy guarantees for any bytes, including
   stripped or relabelled typed-v0.53 bytes."
6. "Legacy (0.50-0.52.1) artifacts behave as documented for 0.52.1, including the
   disclosed unpinned-range residual (OPEN-42 legacy cell)."
7. "The 0.53 realtime session refuses typed-v0.53 packages with
   `air.assurance.profile_unsupported`; a typed realtime session is planned for
   0.54."
8. "Migration: rebuild from typed-v0.53 source with the 0.53 compiler and run
   with the 0.53 adapter. Rollback: disable the profile; legacy artifacts are
   unaffected."

The source-profile axis and the correction-record rule are in `VERSIONING.md`.

## In the package

- The typed-v0.53 notes, under `docs/v0.53/`.
- The typed-v0.53 RFC, `docs/v0.53/RFC_TYPED_V053.md`: the accepted text, with the
  local path in front of three evidence folder names cut and one notice line
  added at its end.
- The page for models, `docs/v0.53/AIR_FOR_MODELS.md`, with its examples under
  `docs/v0.53/for-models/examples/`, the root `llms.txt` and the skill
  `skills/air/SKILL.md`. In a project they are under
  `node_modules/@underskys/air-core/`.

## Carried from the 0.52 line (HD-5)

- The legacy constructs that became unsupported and the guarantees that were
  corrected are listed in the [0.52.1](RELEASE_NOTES_0_52_1.md) and
  [0.52.0](RELEASE_NOTES_0_52_0.md) notes. 0.53.0 keeps them.
- "M1 legacy certificate retained only where sound/defined; unsupported cases no
  longer produce VERIFIED and cannot authorize admission."
- The full WorkBound arrives with typed-v0.53.
- 0.51.0 remains the historical published line, with its known limitations.

## Migration

The `CHANGELOG.md` section of 0.53.0 lists every breaking change. In short:

- **The exports map.** `package.json` `exports` has three entries: `"."`,
  `"./package.json"` and `"./raw"`. An npm user who deep-imports a file by
  package name (for example `@underskys/air-core/src/sdk.js`) breaks on upgrade.
  Bundlers and TypeScript that honour `exports` resolve only the root and the
  two subpaths. The test-only builder-defect seam is not shipped. A caller of
  the root `lowerToWat` with a typed-v0.53 AST and no opt-in gets
  `air.source_profile.candidate_disabled`.
- **Raw bytes.** `instantiateAirModule` left the root. Raw instantiation and the
  raw borrowed lane are in `@underskys/air-core/raw` (`instantiateRawWasm`,
  `invokeRawBorrowedMemory`, `prepareRawBorrowedMemoryInvocation`).
- **Host authority.** `run` and `runPackage` take `{ authority, facts }`. Two
  names are new on the root: `hostAuthority` and `runHostConstructed`.
- **Typed admission.** Only crafted artifacts change behaviour: a funcref,
  externref or v128 result, or any non-numeric value type anywhere in the type
  section, refuses the whole artifact at admission; other multi-value results
  get a coded refusal at `invoke`; a non-function name is refused before any
  host call. No shape the typed compiler emits changes behaviour.
- **Packages.** A package with a link anywhere on a declared, imported, asset or
  legacy-format path is refused; a legacy-format path with ".." is refused; a
  FIFO or other non-regular asset is refused, where it used to hang the package
  check; package files over 4 MiB at the listed read sites are refused; an
  import is looked up in the package, never through the working directory; an
  import name with a backslash is refused in package mode; a name beginning
  "std." that is not a stdlib module name gets the package rule; the
  output-emit check fails with a code where it skipped a module silently.
- **Type nesting.** A type nested more than 1,024 levels, in typed-v0.51 and
  legacy sources, is refused with a code instead of a crash or a hang. `audit`,
  `explain` and `format` refuse a typed-v0.51 AST with a code where they threw a
  raw `TypeError`, and also refuse a function-less typed-v0.51 module that
  returned output before.
- **Entry-point arguments.** `air.run` and `air.runHostConstructed` refuse an
  argument outside the signed i32 range. `airc run-proof`, conformance replay
  and `airc benchmark` refuse such an argument for a parameter that is i32 in
  Wasm. `airc benchmark` reports such a refusal as the warning
  `air.benchmark.runtime_unavailable` and keeps the status `pass`, with no timed
  call; its `wasmExecutionMs` is then only the time to the refusal, and its
  limitations say "wasmExecutionMs unavailable because runtime execution could
  not complete"; check the diagnostics.
- **Two message prefixes, not registered codes.** `air.run.argument_invalid` is
  the message prefix of the refusal inside `air.run.execution_failed`, and
  `air.benchmark.argument_invalid` is the message of the warning
  `air.benchmark.runtime_unavailable`.
- **f32 arguments (SEC53-10).** Typed `invoke`, the borrowed lane, the verified
  session, conformance replay and `airc benchmark` refuse an `f32` argument that
  binary32 does not hold exactly (for example 0.1 or 1e39), where it ran on the
  rounded value. NaN, -0 and the infinities pass; the session keeps refusing
  NaN and the infinities.
- **Legacy imports outside the input's folder (SEC53-10, OD-S10-4 (b)).** A
  legacy-v0.50 file built, verified or migrated on its own reads a `use` target
  only inside its own folder. An import by `..`, by an absolute path, by a
  `std.` name with path segments, or through a symbolic link below that folder
  is refused with `air.package.path_uncontained` before anything of it is read.
  A FIFO, a device or a file above 4 MiB inside the folder is refused with
  `air.package.file_invalid`, where it used to hang or be read (`airc migrate`
  keeps its `air.cli.file_read_failed` line). Imports inside the folder, also
  through a linked ancestor folder, work as before. A project that imports
  outside its folder moves to a package layout, where SEC53-01's rules apply.

## Corrections

These are fixed in 0.53.0, not limits:

- **Entry-point arguments wrapped to i32** (SEC53-03 R-5): fixed at `air.run` by
  SEC53-08, and at the four other call sites by SEC53-09.
- **CR-S6, SEC53-06's corrections:**
  - a typed-v0.51 type nested more than 1,024 levels gets the nesting code at
    every depth, where it got a raw `RangeError` or hung, also when it is invalid
    elsewhere (G-2);
  - `lowerToWat(mod, { maxWatBytes })` refuses a WAT over its cap with
    `air.v052.work_limit_wat_bytes`, where it returned it (G-5);
  - the typed-v0.51 CLI `--emit wasm` without a resolvable WABT gives
    `air.v052.toolchain_input_unavailable`, where it gave a raw module error
    (G-7);
  - `auditModule`, `explainModule`, `formatModule` and `formatSource(...,
    legacy-v0.50)` refuse a typed-v0.51 AST with a code, where they threw a raw
    `TypeError` (O-2);
  - a legacy-v0.50 type nested more than 1,024 levels gets the located nesting
    refusal, where it overflowed the stack.
- **P0-13 part B's three findings,** fixed by SEC53-10: an `f32` argument run on
  its rounded value (F-B7-1); a raw `TypeError` from a typed-v0.53 `state.set`
  whose operands hold CR, U+2028 or U+2029, now `air.v051.typed_syntax_invalid`
  (F-B1-1); and reads, and echoes, of files outside the input's folder by
  `airc migrate` and legacy single-file commands (F-B8-1).

## Known limits

Each under its record's name. None of them is fixed in 0.53.0.

- **F7:** a missing CT-1 file (`src/workbound_cost_table_v1.json`) gives a raw
  `ENOENT` at package load. It fails closed. The file ships, and a correct
  install loads it.
- **`engines`:** `package.json` says `>=22`, the Node floor CI tests. npm only
  warns on an older Node; it does not refuse.
- **F-1 L1:** same-process code that loads files by path reaches every internal
  function without the gate. An exports map limits only package-name
  resolution.
- **F-1 L2:** non-enumerable properties, frozen objects and private `WeakMap`s
  order the API. They are not access control against code in the same process.
- **F-1 L3:** "the candidate gate is consent, not security": any caller may pass
  the flag.
- **F-1 L4:** the seam vectors test a copy of `src/`, not the shipped module
  instance; their equivalence rests on byte identity outside the injected seam.
- **F-1 L5:** the seven R-PROF-7 observations of OD-F1-6 stay.
- **SEC53-02 R-1:** `/raw` is public, so a host can still run unadmitted bytes,
  by name. That is the trusted-host model.
- **SEC53-02 R-2:** the root still makes bytes (`lowerToWat`, `watToWasm`,
  `buildPackage`) and reads them (`loadPackage`). A host's own
  `WebAssembly.instantiate` of those bytes is outside AIR's entries.
- **SEC53-02 R-4:** the evidence still labels an integral `f64` result as
  `"i32"`.
- **SEC53-02 R-5:** the WebGPU host in the repository (`hosts/webgpu`, not in
  the npm package) names its own raw function `instantiateAirModule`.
- **SEC53-02 R-7:** conformance replay lowers with its own `--profile`. A package
  built under one profile and replayed under another would be refused if a
  later lowering depended on the profile, which fails closed.
- **SEC53-03 R-1:** whatever host code passes to `hostAuthority` or
  `runHostConstructed` is trusted.
- **SEC53-03 R-2:** request facts other than the host-state ones are request data
  by design.
- **SEC53-03 R-3:** a token works only with the AIR module instance that made it.
  Two loaded copies do not share tokens, and refuse each other's.
- **SEC53-03 R-4:** the frozen v0.51 reference and the Swift host contract
  (`swift/AIRSwift`, not in the npm package) are unchanged.
- **SEC53-01 R-1:** reads outside the listed read sites get containment at
  admission only; a swap after admission there is not detected.
- **SEC53-01 R-2:** content changed in place in the admitted inode is read as it
  is. Separate reads of one file in one call can see different bytes.
- **SEC53-01 R-3:** a hard-linked file is read as admitted.
- **SEC53-01 R-4:** the root and its ancestors are trusted, and a link in the
  root path is resolved once.
- **SEC53-01 R-5:** Windows (no `O_NOFOLLOW`) is untested, and the promise is not
  made there.
- **SEC53-01 R-6:** the typed closure loader keeps its own rule, and reads by path
  after its walk.
- **SEC53-01 R-7:** the migration's import check is "a bounded mitigation, not
  global import security closure". Since SEC53-10 the migration and
  every legacy single-file command read an import only inside the input's
  folder, admitted as a package's imports are; the look's bounds stay that
  mitigation for the files inside it.
- **SEC53-01 R-8:** the walk and the read check each path from the root again,
  one name at a time; a folder swapped and swapped back between two checks is
  not caught.
- **SEC53-01 R-9:** a swap after admission can make a read's `open` reach a
  device node. The type test refuses it and no byte is read, but opening some
  devices has side effects.
- **SEC53-08 R-2:** a host whose quantities exceed the `i32` range must scale
  them. AIR does not scale or clamp. Unix seconds pass 2^31-1 on
  2038-01-19T03:14:07Z.
- **SEC53-08 R-3:** the refusal is identified by its message prefix inside
  `air.run.execution_failed`, not by its own diagnostic code.
- **SEC53-08 R-4:** inside the range, a value is the host's or the request's, as
  before.
- **SEC53-06 R-1, the stack margin:** at depth 1,024, a small Node stack
  (`--stack-size` 200 or less) gives a raw `RangeError` where the default gives
  the nesting refusal. Measured: the typed paths hold at `--stack-size=250` and
  the legacy path at 200.
- **SEC53-06 R-2:** the legacy-v0.50 CLI `build --emit wasm` without WABT still
  gives the raw module error.
- **SEC53-06 R-3:** the typed-v0.51 CLI build parses and verifies before its
  intake limits, and checks the Wasm cap after assembly.
- **SEC53-06 R-4:** the four bare-code messages stay.
- **SEC53-06 R-5:** a type nested more than 1,024 levels and invalid anywhere gets
  the nesting refusal, not its own located code.
- **SEC53-06 R-6:** the type bound is linear, with a slope of about 4 s per MiB of
  type text; nothing caps the input before a typed-v0.51 `parseSource`.
- **SEC53-06 R-8:** the 14 regular expressions SEC53-06B leaves native (below),
  with the input classes the regex inventory lists as not placed.
- **SEC53-06, the lexical nesting count:** the nesting guard counts angle
  brackets as text.
- **SEC53-06, O-2 on function-less typed-v0.51 modules:** `audit`, `explain` and
  `format` refuse them where they returned output.
- **SEC53-06, the legacy cost slope:** at depth 1,024 a legacy parse costs about
  1.1 s per MiB, with no source-size check before a legacy parse.
- **SEC53-06B R-8:** 14 residual sites stay native.
- **SEC53-06B, the linear bound:** "The linear bound holds for the 70 sites as
  they call the matcher, not for any pattern: under split or a global replace, a
  pattern whose earlier branch outlives its match (for example /a.*b|a/g) is
  quadratic."
- **SEC53-06B, its cost on large legacy modules:** parse time measured at 3.9x
  (0.4 MB) to 4.6x (1.6 MB), above the accepted 2.2x to 3.4x; peak memory +33% at
  most, inside the accepted figure.
- **SEC53-06B KNOWN_1:** a refusal from the matcher is a plain `Error` without an
  AIR code.
- **SEC53-06B KNOWN_2:** a wrapped expression's getters throw, by design, to
  refuse `new RegExp`; `JSON.stringify`, spread or `structuredClone` of an
  object that holds one also throws.
- **SEC53-06B KNOWN_3:** there is no program-size guard.
- **SEC53-06B KNOWN_4:** the cost is permanent: every call allocates.
- **SEC53-09 R-1:** an argument to an `f64` parameter keeps today's
  JavaScript conversion, a string included; since SEC53-10 an `f32` argument
  must be a number binary32 holds exactly. An `i64` parameter keeps today's
  `TypeError`.
- **SEC53-09 R-2:** a step or benchmark with fewer arguments than parameters
  passes `undefined`, which an `i32` parameter reads as 0; extra arguments are
  ignored.
- **SEC53-09 R-3:** the benchmark's status stays `pass` with a warning for a
  refused argument.
- **SEC53-09 R-4:** the e2e proof checks every required fact against its
  message's `i32` contract, whatever the export's parameter types.
- **SEC53-09 R-5:** `invokeV051TypedExport` also passes arguments unchecked;
  nothing in `src/` or `bin/` calls it.
- **SEC53-10 S10-F-R1:** `invokeRaw` passes lanes as JavaScript converts them
  (ToInt32 for `i32`, ToFloat32 for `f32`), by contract.
- **SEC53-10 S10-F-R2:** `invokeV051TypedExport` stays unchecked (SEC53-09 R-5).
- **SEC53-10 S10-F-R3:** at conformance replay and `airc benchmark` an `f64`
  lane keeps JavaScript's conversion, a string included, and an `i64` lane its
  `TypeError`.
- **SEC53-10 S10-F-R4:** a NaN argument enters as the engine's NaN; its payload
  and sign are not claimed.
- **SEC53-10 S10-F-R5:** legacy host-import results keep JavaScript's
  conversion; typed results stay under R-EFF-13.
- **SEC53-10 S10-B-R1:** CR, U+2028 and U+2029 stay whitespace wherever a
  typed-v0.53 line that parses today takes them as such.
- **SEC53-10 S10-B-R2:** the LSP's framing (P0-13 F-B1-2) is unchanged.
- **SEC53-10 S10-B-R3:** legacy-v0.50's raw `TypeError`s and uncoded lowering
  refusals (P0-13 F-O-1, F-O-2) are unchanged.
- **SEC53-10 S10-M-R1:** a legacy file whose imports leave its folder, by `..`,
  by an absolute path, by a `std.` name with path segments, or through a
  symbolic link, no longer builds, verifies or migrates as a single file: move
  it into a package layout. Outside users of such layouts are unknown.
- **SEC53-10 S10-M-R2:** inside the folder, SEC53-01's limits apply: a hard link
  to an outside file is read (R-3), content changed in place is read as it is
  (R-2), a folder swapped and swapped back is not caught (R-8), and a swap can
  make an open reach a device node, refused unread (R-9).
- **SEC53-10 S10-M-R3:** OD-P11-22 (c)'s carried items stay for files inside
  the folder: aggregate and repeated-read growth, and untested special regular
  files.
- **SEC53-10 S10-M-R4:** a legacy program whose imports leave its folder gets
  no migration record; M() refused it anyway for its `use` line.
- **`invokeRaw`:** "The typed admission's `invokeRaw(entrypoint, lanes)` passes
  lanes as JavaScript converts them for Wasm (ToInt32 for an i32 lane); give
  each lane in the signed i32 range. Typed `invoke` refuses an out-of-range
  argument."
  For an `f32` lane JavaScript applies ToFloat32; since SEC53-10 typed
  `invoke` refuses an `f32` argument that binary32 does not hold exactly (NaN
  and the infinities pass).
- **The benchmark's warning:** "The runtime benchmark reports a refused argument
  as the warning `air.benchmark.runtime_unavailable` with status `pass`: read
  the diagnostics, not only the status."
- **Linked packages:** "A linked package's packageExports can name a
  module-private function, and a linked export can take a ptr or a plain slice
  parameter as one raw i32 lane. AIR code cannot use such a parameter: the
  verifier refuses any access through a ptr that is not a live region, and a
  plain slice parameter carries no length, so a body that reads, writes or
  measures it does not build ("missing local for %<name>$len"). Such an export
  can only ignore the value or return it. Typed-v0.53 exports refuse both
  types."
- **The bundle secret scan, N1-N10:** the scan looks for its listed patterns
  only (N1), not in other encodings (N2) or in names (N3); it does not resist
  tampering (N4) or a race (N5); it does not cover other archives (N6), and the
  npm package only for its 5 signatures (N7); a label warns and does not stop
  (N8); it was measured on macOS (N9); and a pass is not "secret-free" (N10).
- **Migration (`airc migrate`, M()):** M() covers what `docs/v0.53/MIGRATION.md`
  lists for 0.53.0, not every legacy program: constants/tables, memory, source
  imports, structs/arrays, other loop forms and metric contracts remain coded
  refusals in 0.53.0. Over a host import, void exports run through `invokeRaw`;
  typed `invoke` refuses void, i64 results and i64 parameters before any host
  call. M() judges one file at its path, not a package: a module legacy accepts
  only inside its package is `legacy_invalid` there. Since SEC53-10 M() reads a `use`
  target only inside the input's folder: an import outside it, by `..`, by an
  absolute path, by a `std.` name with path segments, or through a symbolic
  link, is refused with `air.package.path_uncontained` and no record. The four caveats of every
  budget mapping apply:
  - keeping N while changing `cpu.instructions` to typed `steps` changes the
    metric;
  - per-export checks do not preserve legacy's aggregate claim across exports;
  - `EXACT` means the same run-time behaviour, not preservation of the budget
    claim;
  - static counts are not run-time duration or physical-CPU guarantees.
- **Host results:** a host result that typed-v0.53 refuses fails in typed where
  legacy coerced it: a result JavaScript would coerce, such as 0.1 for
  `random.f32` or `true` for `fs.exists`, becomes `air.host.result_invalid`.
- Packaged documentation: relative links in some packaged documents, mainly the docs index `docs/README.md`, point to files that exist only in the source repository and do not resolve inside the installed package. The documents under `docs/v0.53/` contain no such link.
