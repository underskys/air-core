# typed-v0.53 migration (P0-11, increment I3)

Card AIR-0053-P0-11-0001; admitted frozen slice text R4.8 (`AIR_V053_P0_11_SLICE_RFC_R4_8_CLOSURE_2026_11_03/`, SHA256SUMS `16fd09f9...`)
and its erratum 1 for N34's long_path row (`AIR_V053_P0_11_SLICE_RFC_R4_8_ERRATUM_1_2026_11_07/`),
with the I3 owner admission (`AIR_V053_P0_11_I3_ADMISSION_CODEX_2026_11_03/`) on the CI-remediation base bd28cf3f / cc343e21. This
note records what the implementation does and where; the slice text is the specification.

Flags: SILENT_REWRITE=false LEGACY_ORACLE_IN_DEFECT_DOMAIN=false.

`airc migrate <file> [--module-id <id>] [-o <out.air>] [--record <out.json>]` maps a legacy-v0.50 program to typed-v0.53 source, or refuses it
with `air.migration.unsupported_construct` and exit 1. The output goes to `-o` or stdout and the record to `--record` or stderr, so stdout alone
is always the typed source. M() is `migrateV053(source, { path, moduleId })` in `src/migrate_v053.js`; the input is the source at its path,
with every file its `use` lines bring in.

M() is a tool. It changes no profile's acceptance, formatter output or codes, and its rollback is the commit-level reversal of its files and
the I3 commit's allowlisted files. The existing hint line in `src/diagnostics.js` is unchanged.

## Classes

- `EXACT`: the same results and failures on every input.
- `EXACT_ON_SUCCESS`: the same results wherever legacy succeeds; where legacy traps raw, typed-v0.53 fails with a stable code.
- `LEGACY_DEFECT_CORRECTED`: the input exercises a ledger LEGACY_DEFECT (X-SND-08, X-SND-09, X-AUTH-01, X-VL-01) and now gets the normative result or fails closed.
  The entry names the X-id. A counter loop is `EXACT_ON_SUCCESS` with its ledger id, X-SND-01.

A module's class is the highest entry class. `REJECTED_UNSUPPORTED` is a rejection, not a class.

## The record

One JSON object per input, with sorted keys, no whitespace and one final LF: `schema` (`air.migration-record/1`), `from`, `to`, `increment`,
`input_sha256`, `options`, `imports` (each file legacy read besides the input, with its sha256), then either `class`, `entries` and
`output_sha256`, or `entries: []` and `rejection` with `code`, `construct`, `line`, `origin`, `reason` and, for a legacy refusal, `legacy_code`
and `legacy_message`, or for a typed refusal, `typed_code`. Each entry names its `line`, `construct`, legacy spelling (`from`), typed spelling
(`to`), `rule`, `class`, `ledger` id and, for X-SND-08, `legacy_value`.

A record holds no path of the host. `imports` names a file by its path from the input's folder, or `std:<module>` for the stdlib; a file an
absolute `use` reaches keeps the path the input's bytes spell. A path legacy writes in a refusal is written the same way, and of a refusal with
several diagnostics M() takes the first by code, file, numeric line and message (text compares in code-unit order). Host separators become `/`,
but case, drive letters and POSIX backslashes stay. An I/O failure is no refusal: M() gives no record.

## Reasons

- `later_increment`: typed-v0.53 admits the construct, but M() in 0.53.0 does not map it. The name promises no date or later release.
- `not_admitted`: typed-v0.53 never admits it (v0.54, out of core, or refused by an answered OPEN item).
- `legacy_invalid`: legacy-v0.50 itself refuses the program; its line, code and message are kept.

A module with any `not_admitted` construct reports the one with the smallest line; otherwise the `later_increment` construct with the smallest
line. What an import brings in counts only through the input's `use` line, its `origin` kept.

## Construct names

`module-identity`, `source-profile`, `legacy-invalid`, `unstructured-cfg`, `phi-loop`, `typed-verification`; a legacy module form's name as the
legacy AST names the field (`globals`, `states`, `pools`, `flowDeclarations`, `tableGroups`, `constants`, `tables`, `structs`, `uses`, `externs`,
`effects`, `requires`, `ensures`, `capabilities`); `type <T>` for a parameter or result type; a legacy operation's name.

## I1's coverage

Scalar literals and operations, the f32 helpers (each as the baseline lowering's sequence), calls, refined parameters and results, module
identity, and four control-flow shapes: the straight line, the `br` merge, the return split, and the counter loop as `loop.fold`. Everything else
outside the later coverage below is refused with its reason. Every output is the formatter's canonical form, and M() parses and verifies it before returning it.

## I2's coverage

`requires export` and `ensures export` become exact record entries. Function-level `requires param` on i32 and `ensures return` on an i32
result become refinements. Every bound intersects the declared range and every other contract; no contract widens a type. Each contract line
records the final type, including tautologies. Decimal and out-of-i32 bounds are refused, never rounded or clamped. An empty interval is
refused by typed verification. Declared refinements have one entry per distinct `(from, to)` pair in parameter/result reading order.

An ordinary internal `requires param` entry is `EXACT` only within I2's scoped mapping. Exported parameter contracts, all result contracts,
and plain scalar `requires checked param` are `LEGACY_DEFECT_CORRECTED` / `X-SND-09`. Typed checks cover export ingress, internal call arguments
and returns. A return-split temporary takes the refined result type; generated counter-loop callback types remain plain i32.

The first increment mapping any legacy i32 callback loop (`loop.fold.i32`, `loop.range.i32`, `loop.array.i32`) must revisit the internal EXACT
rule. Those loop forms remain unmapped here. Checked borrowed-memory forms, capabilities/effects and metric contracts remain outside I2.
Module-level parameter/result/checked contracts, function `ensures param` and `requires return` are `not_admitted`.

## I3's coverage and limits

I3 adds capabilities, positional extern signatures, host calls, effect budgets, capability contracts, narrowed utility bundles, and void
functions with straight-line or `br`-merge bodies. Explicit externs stay even when uncalled; bundles keep only called externs and their
capability, with an X-AUTH-01 entry. Calls in unexported functions count as called. Async/io externs are refused, and unmapped pointer types
remain `later_increment`. A bound void result is retained and rejected by typed verification, never silently dropped.

Host calls are `EXACT_ON_SUCCESS`, including already-long `call` spellings. Comparison assumes a host result accepted by R-EFF-13.
A throwing handler becomes `air.host.import_failed`; a result JavaScript would coerce, such as 0.1 for random.f32 or true for fs.exists,
becomes `air.host.result_invalid`. No equivalence is claimed for these invalid results. Over a host import, void exports run through
`invokeRaw`; typed `invoke` refuses void, i64 results and i64 parameters before any host call. No ABI or SDK surface is widened.

Non-integer f64 immediates remain as written and get an X-VL-01 entry for each occurrence before its instruction entry: legacy verifies
these programs but cannot build them. There is no H52 execution witness in that defect domain. An immediate `-0` becomes `0` with an EXACT
literal entry, including a call entry whose `to` matches the new spelling. An immediate `007` remains a typed refusal.

Every record now says `increment: I3`. This candidate replaces `corpus_I2.tsv` with `corpus_I3.tsv`; frozen I1/I2 evidence is unchanged.
Constants/tables, memory, source imports, structs/arrays, other loop forms and metric contracts remain coded refusals in 0.53.0.
I3 implementation admission is not closure acceptance, P0-12/P0-13 admission or release authorization. SCALAR F-1 BLOCK_PUBLISH and MB6
remain open; the package version is 0.53.0, set by the separately admitted packaging stage (P0-12).

## Budget mapping

An explicit host budget keeps its exact integer spelling as `demand`; `cpu.instructions <= N` becomes `work { steps <= N }`.
Duplicate keys keep their integer minimum. Wildcards derive counts for called keys lacking explicit budgets; missing budgets derive the
largest typed count over exports, including 0 for unreachable calls. Typed verification rechecks final bounds. Bounds are never clamped,
rounded through Number, or invented when analysis fails. Unknown keys, non-`<=` comparators and function budgets are `not_admitted`.
Author-written budgets on a module with no export are `later_increment`, even with a legacy `main`. Empty effects lines simply disappear.

The four owner-approved caveats apply to every budget mapping above:

- Keeping N while changing `cpu.instructions` to typed `steps` changes the metric.
- Per-export checks do not preserve legacy's aggregate claim across exports, for steps, explicit host keys or wildcards.
- `EXACT` means the same run-time behaviour, not preservation of the budget claim. Records do not introduce a weaker-claim class.
- Static counts are not run-time duration or physical-CPU guarantees; only the typed check remains after migration.

An exceeded typed bound is a `typed-verification` refusal, including WorkBound overflow. A wildcard count exceeding its budget is guarded,
but legacy rejects that condition first; its negative vector tests the neighbouring legacy refusal, not a reachable wildcard guard.

## CLI failures and channels

On MIGRATED, stdout holds only the output unless `-o` is used. The record goes to stderr unless `--record` is used. On REJECTED, stdout is
empty, no output is written, and stderr holds the refusal lines followed by the record unless `--record` directs it to a file. A null
source line has no `:null` suffix. M() judges one file at its path, not a package: a module legacy accepts only inside its package is
`legacy_invalid` here, with legacy's single-file message.

Before any look, M() refuses an import outside the input's folder, at any depth: one whose path leaves the folder by `..` or as an
absolute path, a `std.` name with path segments, or a path through a symbolic link below the folder. It writes one line,
`<input>:<line>: air.package.path_uncontained: AIR import '<spelled>' leaves the input's folder`, with the input's `use` line that
reaches the import, then exits 1 with empty stdout, no output and no record; nothing of the import is looked at or read. Legacy-v0.50's
single-file commands refuse it the same way (SEC53-10, OD-S10-4 (b)). A project that imports outside its folder moves to a package
layout. Inside the folder, imports are admitted as a package's are (no symbolic link below the folder, a regular file within 4 MiB).

Before legacy reads imports, M() looks at every import named by the current file. Only ENOENT, ENOTDIR and a NUL-path
ERR_INVALID_ARG_VALUE are confirmed absence and lead to legacy's recorded refusal. Other lookup/read failures, unreadable files,
non-regular files (including FIFOs/devices) and regular files above 4 MiB yield exactly:
`air.cli.file_read_failed: import file could not be read`, exit 1, empty stdout, no output and no record. The shared predicate also covers
Node's ERR_STRING_TOO_LONG and ERR_FS_FILE_TOO_LARGE errors. At exactly 4 MiB, regular readable imports reach legacy parsing.
This is a bounded mitigation, not global import security closure: TOCTOU, aggregate/repeated reads, special regular files and SEC53-01's
limits inside the folder remain carried.

The record is written first. A failed `--record` or `-o` writes one coded line, `air.cli.file_write_failed: record file could not be written`
or `air.cli.file_write_failed: output file could not be written`, and exits 1 with empty stdout. No stack, host path, refusal lines or JSON
are printed. Nothing is removed: a successfully written record remains if the later output write fails.

## Implementer readings (no scope change)

- **A literal inside X-SND-08's domain always has its entry**, also when its text does not change (a compact `%x:i64 = 9007199254740993`): the
  value changes, and M() rewrites nothing silently (P11-R1, P11-R8).
- **`-0.0`, f32 or f64, lies inside X-SND-08's domain.** Legacy writes the text of `-0`'s Number, `0`, which denotes `+0.0`; the literal denotes
  `-0.0`. Measured at H52_BASELINE: legacy gives `00000000`, typed-v0.53 `80000000`.
- **A carrier whose operand is no literal of its type** (`const.f32 1e5`, `const.i32 %a`, `const.bool 1`, which legacy verifies) has no typed
  spelling: REJECTED, construct `const.<T>`, `not_admitted`.
- **Refined types on one function line** give one `refinement` entry per distinct `(from, to)` pair (P11-R13/R30).
- **A counter loop's start value defined in the loop header** (legacy verifies this but cannot build it) keeps its definition, before the fold.
- **The record without `--record`** goes to stderr: P11-R22 says the output and the record are printed or written, and stdout stays the source.

## Evidence

The vectors and the corpus are in `fixtures/v053/migration/`, and `test/v053_migration.test.js` runs them: 165 corpus rows on dev and 157 on
public (`corpus_I3.tsv`'s `projection` column, chosen by `package.json`'s `name`): 63 and 59 MIGRATED rows respectively. All 153 frozen packages
are checked byte-for-byte or as the two prescribed operational CLI cases. Expected values come from a separate reference implementation: the slice
text's pinned vectors and, for the corpus, an evaluator in the test that shares no code with M() or the lowerer. `witness.json` is legacy's
result at H52_BASELINE, extended on isolated H52 trees and only outside defect domains; it never sets a value, and the test only reads it.
Runtime comparisons include ordered host logs. Author tests and this witness are not the separate independent exact-SHA QA or release gate.
