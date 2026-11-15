# RFC — AIR source profile `typed-v0.53` (integrated P0-01 candidate)

```text
TASK=P0-01 integrated typed-v0.53 RFC          ROLE=language_architect
REVISION=R3.1 errata (task AIR-0053-P0-01-RFC-R3_1-ERRATA-0001; ARCH53 R3 = PASS_FOR_H53_HUMAN_GATE; only residuals R3-N7..N10 corrected).
         R3 was the bounded correction after ARCH53 Review R2 (task AIR-0053-P0-01-RFC-R3-BOUNDED-CORRECTION-0001)
STATUS=CANDIDATE_RFC_R3_1_FOR_NARROW_ARCH53_ERRATA_REVIEW, THEN HUMAN GATE H53-P0-RFC
MUTATION_AUTHORIZED=false   SOURCE_MUTATION=none   SEMANTIC_IMPLEMENTATION_AUTHORIZED=false
DATE=2026-10-08 (R2: 2026-10-06)
SOURCE_BASELINE=airlang main f258ed0df6da99785bacd706f9d5b04f42ba64c0 (tree 945e82cf…), src tree 0b56c1fa95260ea4c49df1471df443e60703dd17
PUBLIC_BASELINE=air-core main 7285a25af9985c5da71f3a71a63c907fa20c50f0 (tree a3d1c708…), identical src tree 0b56c1fa…
MAINTENANCE_CANDIDATE_0.52.1=REVIEWED_BUT_NOT_ACCEPTED / QA52_REQUEST_CHANGES (QA52 report sha256 e8da3a36…); identities in §2.6
R1_FILES=AIR_V053_P0_01_TYPED_V053_RFC_2026_10_06/ (unchanged; RFC sha256 deb00f95…)
R2_FILES=AIR_V053_P0_01_TYPED_V053_RFC_R2_2026_10_06/ (unchanged; RFC sha256 ee473a2d…)
R3_FILES=AIR_V053_P0_01_TYPED_V053_RFC_R3_2026_10_08/ (unchanged; RFC sha256 54d86dcc…; package 491f90ae…)
COMPANION_FILES=TRACEABILITY_95.json, VECTORS.md, VECTOR_INDEX.json, OPEN_QUESTIONS.md, H53_DECISION_SURFACE.md, PROPOSED_RECORDS.json,
                R3_1_CARRIED_SLICE_OBLIGATIONS.md, CHANGES_R3_1.md, R3_1_DIFF_ATTRIBUTION.md, CHANGES_R3.md (same folder)
TERMINAL=see §21; ARCH53 R1 finding dispositions in Appendix C, ARCH53 R2 finding dispositions in Appendix D, R3.1 errata record in Appendix E
```

## 0. Inputs and evidence posture

| Input | Identity (sha256) | Rank |
| --- | --- | --- |
| Owner decision record R0 `HUMAN_DECISION_2026-10-06.md` | `7bcefb472b74ed3d5f8a0d97a5a26a9f317df147b56d9c0c8ba08e1aa026bcbf` | 1 (HD-1..HD-5, SCOPE-1 DECIDED) |
| `ROADMAP_V3_AMENDMENT_SCOPE1.md` | `f0f6dfd570629d9de761e2d57c94f4baf6fc58747e47d36ddb177fab5f1883ad` | 1 |
| `PROGRAM_DAG.md` | `a660e9f2580f81b86767bef3271856a3684d2cf6b757731501e969431888fe2d` | 1 |
| Start pack V3 zip | `f2e4a24d005a41a9cfc8762b1acd0dae899bcd093f0a06f68b52455bc2563458` | 2 |
| Start pack `tasks/P0-01.md` | `c0c60caf399052bff87e2c404d57d6cceef06bc9d4f7160647257d84c9707563` | 2 |
| Start pack `tasks/FIRST_IMPLEMENTATION_WORKBOUND.md` | `97ce7786abe853435d6f139f858b86fdbc2cb474f328650ad707903e8b3cc503` | 2 |
| P0-00 matrix `P0_00_NORMATIVE_COMPATIBILITY_MATRIX.json` (95 rows) | `ff1d6b6c0aa1b42da7ce77be52a6428df74e535ecb0b5748741dc1e1165f717d` | 3 (normative input) |
| P0-00 ledger `P0_00_CONTRADICTIONS.md` (51 entries) | `dff7cf9ee772d0988b11d32f9e6f0b3f6848d50fef32c4a1bc86d11440ce8e1c` | 3 |
| P0-00 folder `SHA256SUMS` | `dc5c744a3d575525cb9d88dd02dcd1dc4906c2d317671b43487f66f0434b42f6` | 3 |
| Repository specs/frozen docs read from git objects at `main` (f258ed0) | src tree `0b56c1fa95260ea4c49df1471df443e60703dd17` | 4 |
| Architecture assessment zip (14 proof questions, owner map) | `eb2374f8e29967f3a33ade76f983c2e832f0fac322f3d5d93a1901f2692c8a9d` | 5 (checklist only) |
| R2: ARCH53 R1 findings, restated from the owner chat (`inputs/ARCH53_R1_FINDINGS_FROM_OWNER_CHAT.md`) | review input | 5 (findings, not authorization) |
| R2: correction task text (`inputs/03_RFC_AUTHOR_CORRECTION_PROMPT.md`) | task text | 2 |
| R2: 0.52.1 maintenance candidate: `AIR_V0521_M1_MAINTENANCE_CANDIDATE_2026_10_06/REPORT.md` (as read for R2: sha256 `aed90e29ee0bc2a967c762cdef99cd0247245140af80eb7ec634b7cd7d0f140d`); `docs/v0.52/V0521_SOUNDNESS_MAINTENANCE.md` at `263d0fa` (blob `f41188c2…`, sha256 `b85ba388…`) | identities in §2.6 | 6 (identity and behaviour of an **unaccepted** candidate; R3 status: REVIEWED_BUT_NOT_ACCEPTED / QA52_REQUEST_CHANGES) |
| R3: ARCH53 Review R2, `inputs/ARCH53_R2_REVIEW/REVIEW.md` (with its `SHA256SUMS` `b731033d…`, probes and outputs) | `2f24053f20ed25563225fc1ad70b473236936180d3e556f6f7fb16e2323dcefe` | 5 (findings, not authorization) |
| R3: correction task text `inputs/AIR_0053_P0_01_RFC_R3_TASK_FROM_OWNER_CHAT.md` (owner direction for P1-2 included) | `af17ea1374fb774600de6d929b1b933049bbb27456f7447d2865833c8c0333fa` | 2 |
| R3: QA52 independent report on the 0.52.1 candidate, `AIR_QA52_INDEPENDENT_REVIEW_2026_10_08/REPORT.md` (disposition REQUEST_CHANGES) | `e8da3a364e8b7820000e2a30da7c61a55f6927d465b94d3a00dba72d7193b26e` | 6 (status and observations of an unaccepted candidate; never a classification) |
| R3.1: ARCH53 Review R3, `inputs/ARCH53_R3_REVIEW/REVIEW.md` (PASS_FOR_H53_HUMAN_GATE; residuals R3-N1..N12) | `c6eda8460bc25f84400dfe403be583e35a51974fd1ea7ef83ca4f31d7402ceee` | 5 (findings, not authorization) |
| R3.1: errata task text `inputs/AIR_0053_P0_01_RFC_R3_1_ERRATA_TASK_FROM_OWNER_CHAT.md` | recorded in `SHA256SUMS` | 2 |

The ARCH53 review archive itself (`00_ARCH53_REVIEW.md`, `01_OPEN_QUESTIONS_RECOMMENDATIONS.md`) was not
delivered locally. R2 answers the findings as restated in the owner-chat file. For OPEN items whose reviewer
recommendation was not restated there, R2 keeps its own recommendation.

Evidence rules applied by this RFC:

- The five input hashes recorded in the R0 decision record (P0-00 `SHA256SUMS`, matrix, ledger, start-pack zip,
  assessment zip) were recomputed on 2026-10-06 and match it.
  The scratchpad copies of the start pack and the assessment, restored during this task,
  are byte-identical to the copies read (same sha256 for every file used).
- Repository content was read only through `git show main:<path>`. The airlang working tree
  is checked out on `task/air-0052-1-m1-soundness-maintenance-0001` and is being edited by
  another agent. For that reason this RFC ran **no new probe** against `src/`. Every behavioural
  claim cites P0-00 probe evidence (matrix row / ledger entry) or a frozen document line.
- Late in the task `/usr/bin/git` stopped running: the host started requiring Xcode license acceptance,
  which this task did not change. The remaining fixture reads (`fixtures/v051/checked_numeric/checked_numeric.air`,
  `examples/phi_loop.air`, `examples/refinement_types/bounded_score.air`) were streamed with `tar -xzO` from
  `AIR_V053_ARCHITECTURE_REVIEW_INPUT_2026_10_05/source/AIR_DEV_SOURCE_REFERENCE_f258ed0.tar.gz`
  (sha256 `17be2b51b7f4317cdbd729b81fc173433df339a64d5fab4712e49ae20b9ee3ed`; manifest: commit f258ed0, 1106 tracked
  files with git blob ids). Nothing was extracted to disk.
- R2: `git` works again on this host, so R2 reads repositories with `git show <commit>:<path>` at `f258ed0`
  (baseline) and at `263d0fa` (0.52.1 implementation commit). R2 also runs no probe.
- R3: repositories were read only with `git show <commit>:<path>` and `git grep <commit>` at `f258ed0` and `263d0fa`. The
  airlang working tree is being edited by another task (the 0.52.1 correction wave), so R3 touched no working tree and ran no
  probe against `src/`. The zero-semantics and lower-bound facts R3 relies on are cited by `file:line` at `f258ed0`
  (`docs/v0.50/REGION_BOUNDS_INTEGRITY.md:7-19`, `src/region_bounds.js:7-48`, `src/types.js:53-55`,
  `src/lower_wasm.js:1842-1862,1903-1930`, `docs/v0.50/BORROWED_SLICES_SECURITY.md:110`, `src/v052_numeric_diagnostic.js:5-19`,
  `src/v052_verified_build.js:398-432,571-577`, `src/host_abi.js:12-68`) and at `263d0fa` (`src/lower_wasm.js:1859-1881`,
  `src/verifier.js:3837-3848`).
- R3: new and revised expected values were computed by `tools/r3_model_values.mjs` (BigInt, the RFC rules only; output in
  `tool_outputs/r3_model_values.out.json`). The script re-derives the R2 values it touches (V53-WB-ID-06 R2 bytes, V53-CALL-P03,
  V53-LOOP-P01/P03, V53-MEM-WB01) and they are unchanged.
- Expected values in `VECTORS.md` come from the rules in this RFC, from frozen v0.51 vectors,
  or from exact integer arithmetic (BigInt) done independently of the AIR implementation.
  None comes from implementation output.
- External consumer projects are pressure only. No consumer or product vocabulary appears in this RFC
  (00_DECISION.md item 6; ROADMAP_V3_AMENDMENT_SCOPE1.md "Invariants").

## 1. Scope, authority and conventions

### 1.1 Scope

`typed-v0.53` is the canonical typed source profile of the v0.53 milestone
"Canonical Typed Language & Sound Work Model" (SCOPE-1). This RFC covers the P0 language-convergence scope only.
That scope is P0-02…P0-13 plus the HD-4 SCALAR slice, and its exit gates are G53-LANG, G53-WORK and G53-PUBLIC (SCOPE-1).

**Out of scope, v0.54** (SCOPE-1; referenced only as boundaries): embedded Swift runtime (G54-SWIFT),
persistent state/session lifecycle (G54-STATE), logical time/ticks (G54-TIME), replay
(G54-REPLAY), runtime effect mediation of demand against grants (G54-EFFECT), DecisionEvidence/EffectReceipt
evolution (G54-EVIDENCE), generation/revision fencing (G54-FENCE), artifact lifecycle
(G54-LIFECYCLE), v0.54 public gate (G54-PUBLIC). AirGate is v0.55, native delivery v0.56 and adapters v0.57 (SCOPE-1).

### 1.2 Authority order

R0 decisions (HD-1..HD-5, SCOPE-1) > start-pack task texts > P0-00 matrix/ledger > repository
specs and frozen documents > reviewer checklist. HD-1..HD-5 and SCOPE-1 are not reopened here.
Where these sources do not settle a question, this RFC writes `OPEN-n` (see `OPEN_QUESTIONS.md`) with
options and a recommendation.

### 1.3 Conventions

- MUST / MUST NOT / SHOULD / MAY are normative.
- `PROPOSED` marks an exact spelling, numeric constant or code name proposed for acceptance at
  H53-P0-RFC (brief: "Exact op spellings and numeric constants may be proposed as PROPOSED").
  It is normative text if accepted.
- `OPEN-n` marks an unsettled question. A rule that depends on it states the recommended branch.
- Row dispositions (TRACEABILITY_95.json) use: `IMPLEMENT_IN_SLICE`, `PRESERVE`,
  `UNSUPPORTED_FAIL_CLOSED` (rejected by typed-v0.53 with a stable code; legacy unchanged),
  `DEPRECATION_PROPOSED`, `OUT_OF_CORE_PROPOSED`, `DEFERRED_V054`, `OPEN`.
- Citations: `M53-xnn` = matrix row; `X-…` = ledger entry; `HD-n`/`SCOPE-1` = decision;
  `file:line` = git object at `main` f258ed0.

### 1.4 HD-1 rule as applied throughout

Normative guarantees govern typed-v0.53. A shipped deviation from a normative guarantee is a
**LEGACY_DEFECT**. It is recorded, and it is never a compatibility or migration-preservation target.
Every construct that typed-v0.53 admits MUST either **satisfy the guarantee** or be **explicitly
unsupported and fail closed** with a stable code until it is soundly implemented (HD-1). Buggy legacy
execution MUST NOT be the sole oracle for any expected result (HD-1; §14.3). HD-1 supersedes the P0-00
wording "typed-v0.53 must reject such programs" (R0 §3).

### 1.5 Gates referenced by this RFC (R2)

| Gate | What it decides | What it does **not** decide |
| --- | --- | --- |
| ARCH53 | Independent architecture review of this exact RFC text and vectors | Any human decision |
| **H53-P0-RFC** | Human acceptance or amendment of this RFC. That covers the PROPOSED values (WB_MAX, CT-1, codes, spellings), the OPEN recommendations, and the proposed deprecation, unsupported, out-of-core and deferral closures (Appendix A, TRACEABILITY_95.json `HUMAN_DECISION_REQUIRED`). It admits P0-02 *only together with* the other activation prerequisites (§21). | Release of v0.53; removal of the typed-v0.53 candidate gate (R-PROF-1); ABI 0.12 promotion |
| **H53-RELEASE** | The final human v0.53 release decision after P0-13 (PROGRAM_DAG "H53 (v0.53 release)"). It freezes `typed-v0.53` (R-PROF-3) and decides whether the candidate gate of R-PROF-1 is removed. | Any v0.54 item |
| QA52 / H52 | Independent exact-SHA QA of the 0.52.1 candidate, and the human 0.52.1 decision (PROGRAM_DAG §M1) | typed-v0.53 semantics |
| **H52_BASELINE** (term used in §21) | The exact 0.52.1 bytes that P0-02 starts from | See OPEN-39 |

H52_BASELINE (OPEN-39; R3 wording per ARCH53 R2 P2-12). R0/PROGRAM_DAG phrases H52 as "publish 0.52.1?". WorkBound
prerequisite 1 asks for "an exact accepted source/public-package baseline after final release-candidate QA". Neither says whether
npm publication is part of the baseline. Stated cleanly:

- **What is decided:** nothing yet. H52_BASELINE is defined by the owner's answer to OPEN-39.
- **What is proposed (OPEN-39 recommendation (a)):** the P0-02 prerequisite is `QA52 = PASS_FOR_HUMAN_GATE` on exact identities
  **plus** an H52 record that accepts those exact dev/public commits, trees and tarball bytes. npm publication, tags and
  dist-tags are separate H52 release actions and do not gate P0-02.
- **Status of that proposal:** a PROPOSED_R0_AMENDMENT. It is not adopted until the owner records it. R2 and R3 do not edit R0.
- **Current fact (R3):** the only candidate so far is REVIEWED_BUT_NOT_ACCEPTED / QA52_REQUEST_CHANGES (§2.6), so no H52_BASELINE
  exists under any option.

The proposed R0 wording amendment, for the owner to adopt or reject, is unchanged from R2:

```text
PROPOSED_R0_AMENDMENT (not adopted): In PROGRAM_DAG.md, "M1/QA52/H52 ... must finish before P0-02 starts
(prerequisite 1 ...)" means: QA52 = PASS_FOR_HUMAN_GATE on exact identities, and an H52 record accepting those
exact bytes as H52_BASELINE. Publication, tagging and dist-tags are separate H52 actions and do not gate P0-02.
```

## 2. Source-profile identity and versioning

### 2.1 A separate version axis

A **source profile id** pins one source language. It is a version axis of its own, separate from:
the project milestone, the compiler/package version, AIR ABI, Host ABI, the Host Contract version,
and package/report schema versions [X-PROF-01; X-DOC-02; docs/VERSION_AND_ABI_POLICY.md:8-22;
docs/rfcs/v0.51-final-architecture-freeze.md:39-49]. P0-12 MUST add this axis to the public
versioning documents [X-DOC-02; M53-A20].

A profile id pins all of the following. Each is part of the profile's compatibility promise:

1. the grammar;
2. the accepted and rejected program sets;
3. the canonical formatter output;
4. every stable diagnostic code and its meaning;
5. the observable runtime behaviour of accepted programs, including failure identities;
6. the WorkBound cost table version that applies to it (§6.4).

### 2.2 Registered ids

| Id | Role | Rule |
| --- | --- | --- |
| `legacy-v0.50` | compatibility profile; **default** when the profile is omitted | Non-growing. Changes only through correction records (§2.5), including the HD-5 0.52.1 corrections. [V052_SOURCE_PROFILE_CLOSURE.md:17-33; HD-5] |
| `typed-v0.51` | frozen narrow typed profile | Frozen exactly as implemented by src tree `0b56c1fa…`, the accepted 0.52.0 candidate acceptance set [HD-3]. No growth. Corrections only by correction record (§2.5). The HD-5 0.52.1 items that touch typed paths count as such records, provisionally classified in §2.6: X-BND-01 (CLI emission cap) and X-SND-04 (the certificate API rejects typed ASTs). After H52, the reference for typed-v0.51 is "`0b56c1fa` plus the H52-accepted correction records". The candidate reports `TYPED_V051_ACCEPTANCE_CHANGED=false`; QA52 must confirm it (V53-PROF-R03). |
| `typed-v0.53` | opt-in canonical successor | Defined by this RFC. Selected only explicitly. Candidate-gated until H53 (§2.3). |

The default stays `legacy-v0.50`. Promoting another default is a separate later human decision and
never an implicit heuristic [V052_SOURCE_PROFILE_CLOSURE.md:30-33; HD-3]. Unknown ids keep failing
with `air.source_profile.unsupported` [M53-A20].

### 2.3 Candidate gating of `typed-v0.53` before H53

The typed-v0.53 acceptance set grows slice by slice from SCALAR to P0-10. Growing a released id in
place is the defect that HD-3 closes [X-PROF-01]. Therefore:

- R-PROF-1: Until H53 accepts v0.53, `typed-v0.53` is selectable only with an explicit candidate
  opt-in. PROPOSED: SDK option `allowCandidateProfile: true`; CLI flag `--allow-candidate-profile`.
  Without the opt-in, selection fails with `air.source_profile.candidate_disabled` (PROPOSED). The
  existing `allowCandidateAbi012` gate is the precedent [M53-C14]. Mechanism and spelling: OPEN-1.
  The source-profile gate and the ABI 0.12 gate are **independent**: neither implies or enables the other.
  A typed-v0.53 artifact built under the gate records the exact compiler implementation digest that produced it
  (R-WB-18; M53-E19). It is bound to that exact implementation and revision, not to the profile name alone.
- R-PROF-2: No public package may expose `typed-v0.53` without the gate before H53-RELEASE [G53-PUBLIC; R0 §3 "Still gated"].
- R-PROF-3: Accepting this RFC (H53-P0-RFC) does not remove the gate. At H53-RELEASE the acceptance set, formatter output,
  codes and cost table are frozen under `typed-v0.53`, and H53-RELEASE decides separately whether the gate is removed (§1.5).
  Later language evolution takes a new id.

### 2.4 Relationship rules

- R-PROF-4 (typed-v0.51 frozen): no typed-v0.53 slice may change any typed-v0.51 parse, verify, format
  or lower result. The frozen N01-N37/D01-D28/H01-H08 matrix and the V2.1 clarified fixtures MUST be run
  by name (`test/v051_frozen_conformance_matrix.test.js`) in every slice's regression [X-CONF-01; HD-3; M53-E06].
- R-PROF-5 (superset): every typed-v0.51 program that verifies **and** lowers at `0b56c1fa` MUST be
  accepted by typed-v0.53 with identical observable behaviour, except where the exception list in §3.2
  says otherwise [M53-A04; M53-A05; M53-A06; M53-A08].
- R-PROF-6 (legacy is not a subset): typed-v0.53 does not claim to be a superset of legacy-v0.50.
  Legacy programs reach typed-v0.53 only through the deterministic migration of §14
  [V052_SOURCE_PROFILE_CLOSURE.md:61-78].
- R-PROF-7 (AST binding): every parsed AST carries its profile id, immutably. Every SDK entrypoint
  that takes an AST (format, verify, lower, assurance tools) compares the requested profile to the
  AST tag. A mismatch fails closed with `air.source_profile.ast_mismatch` (PROPOSED). It never raises a
  raw `TypeError` and never formats silently in another profile [X-PROF-08; M53-A03; M53-A17].
  Extending the check to legacy/typed-v0.51 ASTs is correction record CR-53-02 (§2.5; OPEN-35).
- R-PROF-8 (no heuristic dispatch): the exported `parseV051Air` heuristic MUST NOT route to typed-v0.53.
  Its public export is DEPRECATION_PROPOSED (Appendix A) [X-PROF-07; M53-A09; M53-A20]. R3: the deprecation is a human
  decision. Rows M53-A09 and M53-A20 carry `HUMAN_DECISION_REQUIRED=true` with this scope (decision D-ROW-A09 / D-ROW-A20 in
  `H53_DECISION_SURFACE.md`). The no-routing rule itself does not depend on that decision.

### 2.5 Correction records (HD-3)

A correction to a frozen profile (`legacy-v0.50`, `typed-v0.51`) is valid only as an explicit
**correction record**. Its fields are:

`CR-ID`, frozen profile id, class (below), ledger defect ids, the normative rule followed, exact defect domain,
before/after disposition and result per affected construct, preservation statement for unaffected inputs, migration note,
vectors, and the human gate reference [HD-3; HD-5].

R2 replaces the R1 rule, which allowed only fail-closed narrowing. That rule would have wrongly prohibited the normative repairs that HD-1 and
HD-5 authorize. There are three classes:

| Class | Name | Allowed change | Required evidence |
| --- | --- | --- | --- |
| 1 | `FAIL_CLOSED_NARROWING` | A previously accepted input, or a previously "verified" claim, becomes a stable rejection, `unknown` or `unsupported`. No correct successful result changes value. | Vectors for each narrowed construct; preservation vectors for the unaffected neighbours |
| 2 | `IDENTITY_REFINEMENT` | A failure that already happened (raw trap, uncoded message, `TypeError`) gets a stable code and location. Accept/reject dispositions are unchanged. | Code-presence vectors |
| 3 | `NORMATIVE_DEFECT_REPAIR` | On an exactly defined **defect domain D** (the inputs that exercise a ledger LEGACY_DEFECT), behaviour changes from the incorrect result to the normative one. The normative result may be a different successful value (for example region contents after an overlap repair) or a stable failure where the defect silently succeeded. Outside D, behaviour is unchanged. | The normative rule; D defined exactly; before/after table; vectors inside D; preservation vectors outside D; explicit human authorization (HD-5 for 0.52.1) |

No class may make a previously rejected program accepted. That would be profile growth and needs a new profile id (HD-3).
Historic evidence, digests and hashes are never rewritten by a correction record. The R1 hashes of this RFC stay as published.

HD-5 already admits the 0.52.1 corrections (X-SND-01..07, X-BND-01..03, X-REL-03 as scoped in
PROGRAM_DAG.md §M1). §2.6 classifies them provisionally. This RFC proposes only:

- CR-53-01 (proposed with SCALAR; OPEN-35): typed-v0.51 ASTs passed to the SDK assurance tools
  (ai_review, audit, explain, provenance, semantic patch, WIT) return a stable unsupported code
  instead of a silent PASS, a `TypeError`, `not_enabled` or a raw parse error [X-PROF-05; M53-E01..E04].
- CR-53-02 (proposed with SCALAR; OPEN-35): the AST/profile binding check of R-PROF-7 for
  legacy and typed-v0.51 ASTs [X-PROF-08].

Both are class 1. CR-53-01 also carries a class-2 part: a `TypeError` becomes a stable code. Neither changes a successful result.

### 2.6 Reconciliation with the 0.52.1 maintenance candidate (provisional; pending QA52 and H52)

Candidate identities, as recorded in `AIR_V0521_M1_MAINTENANCE_CANDIDATE_2026_10_06/REPORT.md` and re-read with git
on 2026-10-06:

| Repository | Implementation commit / tree | Branch tip / tree (CI-only delta) |
| --- | --- | --- |
| airlang | `263d0fab701a4eded539744ef32a155b7a2f1cb4` / `c118e245bbd4e79175d8ce9325c1ae5f299ca1f0` | `60bc7ce8d53901c7417bb087ecf5484210e4d861` / `9bcbeb8e208d1fe2198614f00d1f1ba8259d5d6a`; `git diff --stat 263d0fa 60bc7ce` = `.gitlab-ci.yml` only |
| air-core | `07e15b44424aae38f18bad37afcefb61a86ce398` / `cde876fca354341b62d15c1f6f489ab2af9eb8cc` | `57ba627d3429676de90a81984ac363fa9589d966` / `cce7f43d96b117b28981e7356a7cb1bb462b606f`; `.gitlab-ci.yml` only |
| shared `src` | `60ef16bf8eccc45bce230156c858049717d40dee` (dev = public) | same |
| tarball | `underskys-air-core-0.52.1.tgz` sha256 `df98ac3c056e59176d25531f92f0a2b2ad173cb47327e2da050f34cfa6f81ea2` | report: byte-identical when re-packed from `57ba627` |

**Status (R3): REVIEWED_BUT_NOT_ACCEPTED / QA52_REQUEST_CHANGES.** The independent QA52 report (sha256 `e8da3a36…`) returned
`REQUEST_CHANGES` on exactly the identities above, with three P1 findings (a run-package admission consumer that fails open on an
unknown certified host-call bound; the X-SND-06 host `(ptr, capacity)` check missing on the linked-package build path; X-BND-02
not closed for the legacy verifier) and eleven P2 findings. A bounded correction wave on new commits is in progress outside this
RFC. Nothing below is accepted. R3 changes no classification in this section. In particular:

- The R2 tables below are kept as written. They describe the candidate as documented, not an accepted delta.
- One R2 table cell is now known to be inaccurate for these bytes: "X-BND-02 memoized usage … linear work". QA52 measured
  superlinear verify time and a raw stack overflow at call depth ≥ 1500. The cell is not rewritten. The accepted delta will
  replace the whole table after QA52 PASS and H52.
- QA52's observed artifact × host matrix for the owned-range exports is recorded in its report. R3 cites it only as an
  observation of unaccepted bytes. It does not adopt it as the classification. OPEN-42 stays unresolved, and R3 chooses no
  AIR ABI or artifact-contract answer from these bytes.
- typed-v0.53 rules that reuse candidate codes keep the tag `CANDIDATE_0521`. They become final only with H52.

The final reconciliation of this RFC with the *accepted* 0.52.1 delta happens after QA52 PASS and H52. It is recorded as a
correction note with new hashes. The R1, R2 and R3 hashes stay unchanged.

Provisional classification of the candidate's items (normative rules from `docs/v0.52/V0521_SOUNDNESS_MAINTENANCE.md` at `263d0fa`):

| Item | Candidate behaviour | Class | Defect domain / note |
| --- | --- | --- | --- |
| X-SND-01 phi charging | the phi body counts 4096 times and the header 4097 times; the loop counts as one dynamic loop with fuel 4096 | **3** (with class-1 effects) | D = legacy modules with a structured phi loop. Budget, contract, certificate and realtime results change from undercounted to fuel-bounded. Programs whose budgets do not cover 4096 iterations are now rejected. |
| X-SND-02 exact totals | totals outside 2^53−1 become `unknown` / `air.resource.work_bound_overflow`; validator `air.resource_certificate.bound_invalid` | 1 | M1 stays a legacy report with its own safe-integer range. It is not the typed WB_MAX (R-WB-25). |
| X-SND-03 package-external calls | work categories `unknown` (`package_call_composition_unproven`); module budgets documented as module-local | 1 | |
| X-SND-04 typed AST certificate | `air.resource_certificate.profile_unsupported` | 1 | typed-v0.51 path; acceptance of typed-v0.51 *source* unchanged |
| X-SND-05 region slots | per-site slot = max(4096, 16-byte-rounded verified max) ≤ 16 MiB, else `air.memory.region_size_unsupported`; non-constant sizes checked against the slot; initial memory covers all slots | **3** (static sizes > 4096: overlapped result becomes correct) + 3 (dynamic sizes > slot: silent overlap becomes a trap) + 1 (> 16 MiB rejected) | Changes the memory layout of AIR-owned memory (classified below) |
| X-SND-06 derived views / host capacity | live region and in-bounds size required, statically or by a runtime trap; buffer views tracked for use-after-free | 1 (static rejections) + **3** (dynamic: corruption becomes a trap) | |
| X-SND-07 AIR-owned range | borrowed-lane modules export `__air_owned_memory_base` / `__air_owned_memory_end`; SDK view bindings and realtime sessions fail closed on overlap or on a missing range | 1 (SDK narrowing) + artifact-contract amendment (below) | |
| X-BND-01 CLI typed build cap | `VERIFIED_TYPED_RUNTIME_LIMITS` on `airc build --source-profile typed-v0.51` | 1 | typed-v0.51 path |
| X-BND-02 memoized usage | identical counts, linear work | none (no observable disposition change) | implementation-only |
| X-BND-03 bounded reader | 4 MiB regular-file reader for `check` and JSON inputs | 1 + 2 | |
| X-REL-03 | release wording | docs | |

**New exported globals: AIR ABI, Host ABI and artifact contract are classified separately.** Unchanged signatures do not
settle the question. The facts come from `263d0fa:src/lower_wasm.js`:

- `(global (export "__air_owned_memory_base") i32 (i32.const B))` and `(global (export "__air_owned_memory_end") i32 (i32.const E))`
  are immutable i32 globals.
- They are exported only by modules on the borrowed lane (AIR ABI 0.11).
- `B` is 0 when the module uses `fd_write`, otherwise 1024. `E` is the end of static data and region slots.
- Readers are `airOwnedMemoryRange` in `src/borrowed_slices.js`, used by `prepareWasmViewBindings` and `createVerifiedExecutionSession`.
  A missing or invalid range leads to `air.borrow.air_memory_layout_unknown` / `air.realtime.air_memory_layout_unknown`.
- The exported memory's initial page count now depends on total slot size, on all lanes.

| Axis | Proposed classification (for QA52 item 6 and H52; not asserted as final) |
| --- | --- |
| AIR ABI | The lane version is unchanged (0.11), but this is an **additive amendment of the borrowed-slice-v1 artifact exports**. A new SDK refuses Wasm-view binding of an artifact without the exports, so the amendment is compatibility-relevant. Recommended record: an explicit AIR ABI 0.11 artifact-contract amendment, not a silent "ABI unchanged". The slot layout change on lanes 0.10 and 0.11 is a "memory or data representation" change in the sense of docs/VERSION_AND_ABI_POLICY.md:108-116. Hosts do not address AIR-owned memory, so its host-visible effect is the exported memory size and the new owned range. Whether either change needs a lane bump is an **H52 decision (OPEN-42)**. |
| Host ABI | No host import name, signature or required host semantics changed → no Host ABI change, *provided* QA52 confirms that the new Host ABI `(ptr, cap)` capacity checks only reject or trap on the AIR side and never change what a host import receives for an in-bounds call. |
| Artifact / SDK binding contract | **Changed.** The borrowed-lane artifact must carry the range exports for `wasm_memory_view` binding. New fail-closed codes (`air.borrow.air_owned_memory_overlap`, `air.borrow.air_memory_layout_unknown`, `air.realtime.*` counterparts). Direct-export hosts must apply the range check themselves. |

Old/new artifact × old/new host (the candidate's behaviour as documented and read; QA52 must reproduce it):

| Artifact \ Host | 0.52.0 / 0.51.0 SDK (old) | 0.52.1 SDK (new) |
| --- | --- | --- |
| old artifact (no range exports) | unchanged; X-SND-07 defect present | `wasm_memory_view` and realtime: fail closed (`…air_memory_layout_unknown`); `copied_into_wasm`: unaffected (`263d0fa:docs/v0.50/BORROWED_MEMORY_SDK.md`: copies are placed in memory grown beyond the initial pages); no "missing global ⇒ allow" path |
| new artifact | extra exports ignored; **no overlap protection** (X-SND-07 defect persists on that host); larger initial memory accepted | range checked; overlap fails closed |
| direct-export host (no SDK) | n/a | unprotected unless the host reads the globals; disclosed limitation |

typed-v0.53 adopts the same owned-range export for its borrowed-lane artifacts (R-MEM-4). The 0.52.1 candidate codes are reused
where the meaning is identical, and are marked `CANDIDATE_0521` in VECTORS.md until H52.

## 3. Compatibility rules for types and control flow

### 3.1 General rules (all slices)

- R-COMP-1 (no implicit conversion): no implicit numeric conversion, enum-to-i32, truthiness or
  option/result unwrap. Every conversion is a named operation [docs/rfcs/v0.51-typed-decisions-numerics.md:62-64].
  Refinement widening is governed separately (OPEN-10).
- R-COMP-2 (exact literals): integer literals are parsed exactly from their spelling. Float literals
  are rounded once, ties-to-even, to the target format. Float `-0` keeps its sign bit
  [docs/rfcs/v0.51-typed-decisions-numerics.md:78-112; X-SND-08; M53-A01].
- R-COMP-3 (verify ⇒ admitted build or bounded refusal; R2 rewrite): for every program that typed-v0.53 verifies, the
  build either produces an executable artifact or ends in a **bounded build refusal** with a stable code (§3.4 phase B, or an
  emission cap reached during phase L; R3). Never a raw
  JavaScript, WABT or engine error. Invalid WAT or an assembly failure from a build that passed admission is an
  implementation defect and a slice-blocking QA finding. Exceeding a declared build limit is not a defect, and it is not a
  semantic rejection [X-VL-01; docs/v0.50/VERIFY_LOWER_CONSISTENCY.md via M53-C02; ARCH53 R2].
- R-COMP-4 (stable failure identity): every runtime failure of an accepted program surfaces an AIR
  code and reason. A bare `unreachable` is never the host-facing identity [X-CONF-06; v0.51 RFC:152-160].
- R-COMP-5 (finite WorkBound): a module is accepted only if every function in it has a finite
  WorkBound summary (§6) [HD-2; G53-WORK].

### 3.2 Exceptions to the superset rule (R-PROF-5)

These typed-v0.51 shapes verify but never lowered, or conflict with frozen grammar. typed-v0.53 resolves them
explicitly. None is a regression of a working program (HD-1).

| Shape | typed-v0.51 status | typed-v0.53 rule |
| --- | --- | --- |
| checked numeric op inside a `match` arm | verifies; lowering emits invalid WAT [X-VL-01; M53-A06] | rejected with `air.decision.match_arm_invalid` (OPEN-9, recommended) |
| `-> void` with empty body | verifies; lowering rejects [X-PROF-06; M53-A03] | admitted with bare `return` (OPEN-17, recommended) |
| typed `i32<a..b>` at export | runs via internal lowering only; public build rejects [X-PROF-04; M53-A13] | §7 (OPEN-11) |

### 3.3 Module identity

The typed module-id grammar `[a-z][a-z0-9._-]{0,127}` is kept [M53-A03]. Migration never renames a
module silently. A legacy id that is not representable is a migration rejection unless an explicit
mapping is supplied (§14) [M53-A03; X-PROF-06].

### 3.4 Pipeline phases and dispositions (R2; ARCH53 R2; R3 per ARCH53 R2 P1-2, P2-5, P2-13)

Semantic verification, analysis capacity, build/resource admission and environment failures are separate phases with separate
dispositions:

| Phase | Input → output | Disposition on failure | Kind of limit | Example codes |
| --- | --- | --- | --- | --- |
| A. Intake and analysis capacity | bytes → AST of the whole unique import closure; then a structural capacity check before any semantic analysis (R3) | `INTAKE_REFUSED` (bytes, nodes, modules); `ANALYSIS_REFUSED` (R3: analysis units or syntax nesting depth above the host's analysis capacity, R-WB-15c) | host limits (lowerable, never raisable): per-module and closure bytes, AST nodes, module count (§6.8); host analysis capacity (R-WB-15c; lowerable only down to the conformance floor) | `air.v052.work_limit_source_bytes`, `air.v052.work_limit_ast_nodes`, `air.cli.file_too_large` (EXISTING); `air.analysis.capacity_exceeded` (PROPOSED, R3) |
| S. Semantic verification | AST → `VERIFIED` or `STATIC_REJECT` | `STATIC_REJECT` | **profile constants**, part of the language: LOOP_MAX, table length ≤ 65536, REGION_MAX, WB_MAX, finiteness of every WorkBound summary. **No host-configurable value is read in phase S** (R3). | language codes (§15) |
| B. Build/resource admission | verified closure → admitted build plan | `BUILD_REFUSED` (bounded, stable) | host build limits (lowerable): total AIR-owned memory backing (OPEN-37), engine-structural counts (globals, locals, functions), checked before lowering starts | `air.build.memory_backing_limit`, `air.build.engine_limit` (PROPOSED) |
| L. Lowering and assembly | admitted plan → artifact | `BUILD_REFUSED` when a declared emission cap (`maxWatBytes`, `maxWasmBytes`) is reached; this check runs **incrementally during L** (R3). Any other failure is an `IMPLEMENTATION_DEFECT` (never a valid disposition) | host emission caps (lowerable) | `air.v052.work_limit_wat_bytes`, `air.v052.work_limit_wasm_bytes` (EXISTING); defects have no valid code (QA P0/P1 finding) |
| R. Runtime | artifact + inputs → result | `RUNTIME_FAIL` with a stable AIR code (R-COMP-4, R-REF-9) | profile semantics | §15 |
| E. Environment | toolchain, engine, process | `ENVIRONMENT_UNAVAILABLE`: neither PASS nor a language-semantic defect | missing or invalid WABT, engine unavailable, external process crash, host out of memory | `air.v052.toolchain_input_unavailable`, `air.v052.toolchain_input_invalid` (EXISTING); otherwise `air.environment.unavailable` (PROPOSED) |

`IMPLEMENTATION_DEFECT` (R3, named): a result that a conforming implementation never produces. It covers invalid WAT or an assembly
failure after admission (phase L), the internal-consistency guards `air.workbound.cost_undefined` (R-WB-26) and
`air.runtime.trap_unclassified` (R-REF-9), and any raw JavaScript, WABT or engine error. It is never a language disposition, never
reported as STATIC_REJECT, RUNTIME_FAIL or BUILD_REFUSED, and every occurrence is a slice-blocking QA finding.

Rules:

- R-PIPE-1 (host-independent verdicts; R3): `VERIFIED` and `STATIC_REJECT` are functions of the source closure bytes and the
  profile only. Two conformant hosts that both reach a verdict reach the same verdict with byte-identical WorkBound evidence.
  A host with less capacity may instead return `INTAKE_REFUSED` or `ANALYSIS_REFUSED`, which are not verdicts: they make no claim
  about the program's validity, are never cached or reported as a rejection, and never produce WorkBound evidence.
- A semantically valid program that exceeds a build limit receives `BUILD_REFUSED`. It is still a valid typed-v0.53 program; another
  host with higher limits may build it. The disposition is the same on every host whose limits are not larger.
- Profile constants (phase S) are the same on every host. Host limits (phases A, B and the emission caps in L) MAY only be lowered
  by a host. Analysis capacity MAY be lowered only down to the conformance floor (R-WB-15c).
- R3 (P2-13): emission caps are not "after lowering". Lowering emits WAT and Wasm incrementally and checks the running byte
  count against the cap as it goes. The first emission that would exceed the cap stops lowering with `BUILD_REFUSED`, so no
  output beyond the cap is materialized. A cap hit inside L is therefore a bounded build refusal, not an implementation defect and
  not a semantic rejection.
- QA reports an `ENVIRONMENT_UNAVAILABLE` run as not executed, never as PASS or FAIL of a semantic vector. A vector whose own
  expected disposition is `ENVIRONMENT_UNAVAILABLE` (V53-PIPE-02, V53-PIPE-06) passes when the run yields exactly that disposition
  and code with no raw error.
- R2 corrects the R1 statement "a failure after a successful verify is an implementation defect": that holds only for phase L
  outside the emission caps.

## 4. Type universe; source types versus the ABI 0.12 descriptor grammar

### 4.1 Decoupling (resolves X-PROF-02)

Today the typed-v0.51 source types are parsed by the AIR ABI 0.12 **candidate** descriptor grammar.
So every memory or aggregate rejection reads "not admitted by AIR ABI 0.12 candidate" [X-PROF-02; M53-C14].
typed-v0.53 separates the two grammars:

- R-TYPE-1: typed-v0.53 has its own **source type grammar** (`SourceType`). It is a superset of the
  descriptor type grammar (`DescriptorType`: `i32|i64|f32|f64|bool`, qualified enum,
  `option<flat>`, `result<flat,error-enum>`) [M53-C14; v0.51 RFC:43-60].
- R-TYPE-2: at an **export boundary** on the AIR ABI 0.12 candidate lane, each parameter and result SourceType `t` must have a
  descriptor image `desc(t)`, defined exactly as follows:
  - `desc(t) = t` for every `DescriptorType`;
  - `desc(i32<a..b>) = i32` (R2: the only non-identity mapping; R-REF-7). The refinement check stays mandatory
    on both ingress and result (§7);
  - `desc` is undefined for every other SourceType. An export using such a type fails with
    `air.abi.export_type_unsupported` (PROPOSED).

  Borrowed exports use the AIR ABI 0.11 lane unchanged (§11) [M53-C14; M53-C05; ARCH53 R4].
- R-TYPE-3: the frozen ABI 0.12 candidate descriptor grammar, its schema and its digest are not changed
  by v0.53 [docs/rfcs/v0.51-final-architecture-freeze.md:43; M53-C14]. Promoting ABI 0.12 is not part
  of v0.53 P0 (HD-5 lists it as 0.52.1 non-scope). R3 (ARCH53 R2 P1-3): P0-00 classes M53-C14 HUMAN_DECISION_REQUIRED
  ("promotion of AIR ABI 0.12 … must be decided before typed-v0.53 memory integration"). So the non-promotion is not assumed. It is
  proposed as an explicit owner scope decision at H53-P0-RFC (Appendix A.2, decision D-SCOPE-01): "AIR ABI 0.12 stays a
  candidate in v0.53; typed-v0.53 decouples source types from the candidate grammar (R-TYPE-1..4)". Until that record exists,
  nothing in this RFC promotes ABI 0.12, and P0-08 memory integration MUST NOT start (it is the point at which P0-00 requires the
  decision).
- R-TYPE-4: an internal-only type (refinement, internal aggregate, region/slice/buffer) is rejected
  inside typed-v0.53 code only by its own slice rules. It is never rejected by citing the ABI
  candidate.

### 4.2 Admitted value types by slice

| Type family | Slice | Export lane |
| --- | --- | --- |
| `i32 i64 f32 f64 bool`, enums, `option`, `result` (typed-v0.51 set) | baseline | ABI 0.12 candidate (unchanged) |
| scalar operations (§5) | SCALAR | same |
| `i32<MIN..MAX>` | P0-03 | base type in the descriptor (OPEN-11) |
| internal fixed records/arrays | P0-06 (OPEN-18) | none (internal only) [spec/AIR_CORE.md:107-109] |
| region `ptr` (internal), `slice`, `buffer<T,N>` | P0-08 (OPEN-22) | none, except `borrowed_slice` on AIR ABI 0.11 |

No `f64` arithmetic, `u64`, unsigned source types or fixed-point types are added [HD-4; v0.51 RFC:212-217,454-459;
docs/v0.52/G2_DETERMINISTIC_NUMERICS_EXPERIMENT.md:57-63; V052_HANDOFF_REQUIREMENT_MATRIX R01/R02].

## 5. HD-4 SCALAR slice — exact operations and semantics

HD-4 requires explicit checked and wrapping `i32` families with distinct spellings and no implicit
mode; `f32` per the frozen v0.51 float rules; `bool` logic; select and branch-on-bool. The slice comes before P0-04.
Its operation set is limited to operations that already have an accepted precedent: the legacy i32/f32/bool/select set
[spec/AIR_CORE.md:118-123] and the frozen checked-i64 pattern [v0.51 RFC:127-168]. Nothing wider is
inferred [M53-A02; M53-A10; X-PROF-03].

### 5.1 i32 — two families, no implicit mode (PROPOSED spellings)

| Family | Operations | Semantics |
| --- | --- | --- |
| **checked** | `i32.checked_add`, `i32.checked_sub`, `i32.checked_mul`, `i32.checked_div_s`, `i32.checked_rem_s` | exact signed arithmetic over [-2^31, 2^31-1]. A result outside the range is `air.numeric.checked_failure` / `overflow`. Division or remainder by 0 is `division_by_zero`. `checked_div_s(MIN,-1)` is `overflow`. `checked_rem_s(MIN,-1)` returns `0`. Division truncates toward zero; the remainder takes the sign of the dividend. All of this mirrors the frozen i64 rules [v0.51 RFC:144-150; N09-N10, N22-N26]. |
| **wrapping** | `i32.wrapping_add`, `i32.wrapping_sub`, `i32.wrapping_mul` | two's-complement modulo 2^32: the existing Wasm `i32.add/sub/mul` target behaviour [v0.51 RFC:114-119; spec/AIR_CORE.md:118-119]. There is **no** wrapping division or remainder; `i32.wrapping_div_s` etc. are `air.numeric.operation_invalid`. |
| bit operations (mode-free) | `i32.and`, `i32.or`, `i32.xor`, `i32.shl`, `i32.shr_u` | Wasm semantics. The shift count is taken modulo 32 (OPEN-7). |
| comparisons | `i32.eq`, `i32.ne`, `i32.lt_s`, `i32.le_s`, `i32.gt_s`, `i32.ge_s` → `bool` | total and exact. |

- R-SCL-1: the unqualified spellings `i32.add`, `i32.sub`, `i32.mul`, `i32.div_s`, `i32.rem_s` and the
  compact aliases `add`, `sub`, `mul` are **not admitted** in typed-v0.53. They fail with
  `air.numeric.operation_mode_required` (PROPOSED) (OPEN-5, recommended) [HD-4 "no implicit mode"].
  The repair hint for `add/sub/mul` names both explicit families. The hint for `div_s/rem_s` names **only**
  `i32.checked_div_s` / `i32.checked_rem_s`, because no wrapping division family exists (R2; reviewer note on OPEN-5).
  Legacy migration chooses the wrapping family explicitly (§14.4).
- R-SCL-2 (static evaluation): a checked operation whose operands are all statically known and which
  fails is a verification failure at its source location with `air.numeric.checked_failure:<reason>`
  [v0.51 RFC:149-150,170-174]. Wrapping operations never fail statically.
- R-SCL-3 (one failure model): i32 checked failures use the existing single runtime failure model and its existing
  transport. That transport is the exported failure global with reason values 1 overflow, 2 division_by_zero,
  3 invalid_conversion [M53-A08 subsurfaces; v0.51 RFC:152-164]. SCALAR adds no export, no flag and no reason value.
  P0-03 extends the reason registry (R-REF-9, OPEN-38). If OPEN-38 option (b) is adopted, P0-03 moves *all* typed-v0.53
  failure reasons, numeric ones included, to the new export, with the same values. Candidate artifacts are bound to their compiler
  digest (R-PROF-1), so no existing artifact changes meaning.
- R-SCL-4: there is no unsigned comparison, no `i32.shr_s`, no rotate and no count operation. These have
  no accepted precedent. Adding one later needs a new profile id.

### 5.2 Conversions (OPEN-6)

These conversions are frozen and kept: `i32.to_i64`, `i64.to_i32_checked`, `f32.to_f64`, `f64.to_f32_checked` [M53-A08; M53-A10].
Recommended for SCALAR (PROPOSED, OPEN-6): `i32.to_f32_checked` (fails with `invalid_conversion` if the result is
not exact) and `f32.trunc_to_i32_checked` (truncates toward zero; fails with `invalid_conversion` on NaN, ±∞ or
out of range). This follows the frozen policy against undocumented lossy conversions [v0.51 RFC:219-233].
The legacy rounding `f32.convert_i32_s` and the trapping `i32.trunc_f32_s` are not admitted under those names.

### 5.3 f32 (frozen v0.51 float rules)

Admitted: `f32.add`, `f32.sub`, `f32.mul`, `f32.div`, `f32.min`, `f32.max`, and `f32.eq`, `f32.ne`, `f32.lt`,
`f32.le`, `f32.gt`, `f32.ge` → `bool`. Semantics are IEEE 754 binary32 with Wasm operation behaviour [v0.51 RFC:188-206]:

- `+0.0 == -0.0`, and the sign is preserved in evidence;
- every ordered comparison involving NaN is false; `f32.ne` with NaN is true;
- `f32.min`/`f32.max` keep Wasm behaviour (NaN propagates, `min(-0,+0) = -0`);
- division by zero produces ±∞ or NaN and **does not fail**: IEEE semantics is the frozen rule,
  and f32 has no checked family;
- cross-host evidence uses bits, with NaN given as a classification only (no payload claim).

The frozen operation corpus N15-C01..C04 MUST be executed through AIR source, not raw WAT [X-CONF-02; M53-A01; M53-E06].

The legacy f32 helpers are **not admitted** in SCALAR. R2 corrects the R1 rationale, which wrongly called them all "not
bit-exact approximations". The facts per operation come from `f258ed0:src/lower_wasm.js:975-1045,2135-2200`; the operation set is unchanged:

| Legacy op | How the baseline lowers it | Why SCALAR excludes it |
| --- | --- | --- |
| `f32.sqrt` | the native Wasm `f32.sqrt` instruction (IEEE 754 correctly rounded; deterministic apart from NaN sign/payload) | Not an approximation. Excluded only for scope: HD-4 names checked/wrapping i32, f32 per the frozen rules, bool, select and branch, and the frozen corpus has no sqrt vector. Admission would be a separate decision with its own vectors (OPEN-40). |
| `f32.clamp x, lo, hi` | `f32.min(f32.max(x, lo), hi)` | Not an approximation. It is a fixed macro of admitted ops, so it adds no expressiveness. Its `lo > hi` result (`hi`) and NaN propagation follow min/max. Migration expands it exactly (§14.4). |
| `f32.lerp a, b, t` | `(b − a) · t + a`, unfused IEEE ops | Not an approximation. It is a fixed macro of admitted ops, but not endpoint-exact: `t = 1` need not yield `b`. Migration expands it exactly. |
| `f32.inverse_lerp a, b, x` | `(x − a) / (b − a)` | Macro of admitted ops; `a = b` gives ±∞ or NaN under IEEE rules. Expanded exactly. |
| `ease.smoothstep t`, `ease.out_quad t` | `t·t·(3 − 2t)`; `1 − (1 − t)²` (no clamping) | Macros of admitted ops; expanded exactly. |
| `f32.sin`, `f32.cos` | one ±2π range adjustment, then a truncated polynomial (`lowerF32Trig`) | Bit-reproducible, since it is a fixed sequence of IEEE ops, but it is an **approximation** of sin/cos: the documented tolerance is 0.003, and range reduction is correct only for roughly \|x\| ≤ 3π. A Core trig operation would need its own domain and error specification. Migration rejects it. |

In typed these helpers are DEPRECATION_PROPOSED; legacy is unchanged [M53-A10]. `f64` stays boundary-only [v0.51 RFC:212-217].

- R-F32-1 (NaN observability; R2): Wasm leaves the sign and payload of NaN results nondeterministic, and the frozen evidence
  policy excludes NaN payload and sign from cross-host equality [v0.51 RFC:200-206]. So typed-v0.53 claims cross-host
  bit-identical results only up to NaN classification. No typed-v0.53 construct may expose NaN bits through an observation
  channel that the claim covers. In SCALAR this holds by construction: there is no memory, no bit-reinterpretation operation and
  no host import, and export results and evidence use NaN classification. From P0-08 (f32 stored to memory, then read back as
  bytes or i32) and from P0-10 (f32 host-import arguments), every f32 value that crosses such a channel MUST be canonicalized,
  or the channel MUST be excluded from the determinism claim (OPEN-41). Until OPEN-41 is decided, no
  deterministic bit-level claim is made for memory bytes or host arguments that may carry a NaN.
Literals: integer-spelled float literals and the `const.i32/f32/f64/bool` carriers are OPEN-4. The recommendation is to admit both,
as the frozen RFC grammar allows [v0.51 RFC:84-92; X-PROF-06].

### 5.4 bool, select, branch-on-bool

- `bool.and`, `bool.or`, `bool.not`. Operands are SSA atoms that are already evaluated, so there is no short-circuit question [spec/AIR_CORE.md:122].
- `select.T %cond, %a, %b` for T ∈ {`i32`, `i64`, `f32`, `f64`, `bool`} (OPEN-8). `%cond` MUST be
  `bool` and both operands MUST have type T. Both operands are evaluated, as in Wasm `select` [M53-B03; M53-A07].
- Value-level branch-on-bool: `match` over `bool` with the patterns `true` and `false`, exhaustive.
  The `air.decision.match_nonexhaustive` code is emitted with a proper `code:` delimiter [X-CONF-02; M53-A06].
  Statement-level structured branching belongs to P0-04 (§8).
- Inbound bool lanes other than 0 or 1 are rejected, as in frozen N32 [v0.51 RFC:241-246].

### 5.5 WorkBound cost of SCALAR operations

Every operation in §5.1-§5.4 costs one step (CT-1, §6.4). None introduces iteration or effects.

## 6. The single compositional WorkBound family (HD-2)

HD-2: "typed-v0.53 defines one exact checked-integer compositional WorkBound family. Host
Budget, input/build caps, runtime fuel and analyzer limits remain distinct. Legacy M1 is
non-authoritative unless proven to be a sound projection." This section is the P0-02 foundation
contract. No rule that P0-02 needs depends on an OPEN item (§21). The OPEN references in this section (OPEN-14, -16, -31,
-32, -33) concern later slices or optional publication.

### 6.1 Role reconciliation (closes the X-WORK-01 HOLD clause)

| Role | What it is | Unit | Semantic? | Authority? | Identity | Rule |
| --- | --- | --- | --- | --- | --- | --- |
| **WorkBound** (this family) | verifier-derived upper bound per function and per entry | steps, calls, iterations, effects[k]; peak `region_bytes` from P0-08 | **yes**: part of typed-v0.53 acceptance (R-COMP-5) | **no** | WorkBoundKeyV1 (§6.9) | §6.2-§6.12 |
| Intake/emission limits (M2) | `VERIFIED_TYPED_RUNTIME_LIMITS`, CLI file intake | bytes, AST nodes, lanes, cache entries | no: host implementation limits, may only be lowered | no | none | applied at every typed-v0.53 entrypoint before analysis or expansion (§6.8) [M53-E09; M53-E11; M53-E13; S3 doc:68-90] |
| Host Budget (M3) | Host Contract `Budget{ResourceClass, limit}` | host resource classes | no | **yes** (host) | DecisionEvidence/EffectReceipt | unchanged; never derived from or compared to WorkBound [R03; M53-E16; M53-E07] |
| Runtime guards (typed form of M4) | dynamic-count and dynamic-index checks | — | enforcement only | no | — | each guard's maximum MUST equal the maximum used in the summary; no independent fuel [X-SND-01; M53-E14] |
| Analyzer effort (M5; R3 rewrite) | host analysis capacity: a deterministic structural measure of the closure, checked at the end of phase A before semantic analysis | analysis units and syntax nesting depth (R-WB-15c) | **no**: a host/tool resource guard. It is not part of WorkBound, not in R-WB-2, and never changes a verdict (R-PIPE-1) | no | none (not recorded in WorkBound evidence) | `ANALYSIS_REFUSED` with `air.analysis.capacity_exceeded` (PROPOSED); host-lowerable down to the conformance floor; never needed for termination of WorkBound analysis (§6.8) [M53-E01; M53-E02; M53-E10; X-BND-02; ARCH53 R2 P1-2] |
| Timeout | wall-clock deadline | ns | **never** semantic | host operational control | — | no AIR rule reads a clock (logical time is v0.54) [R04; SCOPE-1] |
| Legacy M1 | `collectEffectUsage`, legacy certificate, legacy effect budgets, realtime fuel | legacy keys | legacy-v0.50 only | no | certificateDigest | §6.10 |

Under HD-2 there is one semantic family. M2, M3, the runtime guards, M5 and timeouts are **roles**, not cost models.
M1 is a frozen legacy report and is non-authoritative for typed-v0.53. With these roles assigned, the WorkBound task's
"two competing models" HOLD clause is answered and creating this family is **not** a second cost model
(`SECOND_COST_MODEL_CREATED=false`) [R0 §3 "HD-2"; X-WORK-01; M53-E18].

### 6.2 Value domain and strict partial algebra (R2 rewrite; ARCH53 R1)

PROPOSED values in §6 (WB_MAX, CT-1 weights, code names, record domain) are **not yet agreed**. They become normative only
when H53-P0-RFC records acceptance or an amendment. P0-02 does not start before that (§21).

- R-WB-1 (domain): a **valid summary** `ok(S)` has every dimension equal to an exact integer `v` with `0 ≤ v ≤ WB_MAX`, where
  **WB_MAX = 9223372036854775807 (2^63 − 1)** (PROPOSED). This is the non-negative range of the frozen exact
  i64. S4-WORK-04/05 already compose checked i64 work [M53-E06], and G2 found checked i64 sufficient for counters
  [G2_DETERMINISTIC_NUMERICS_EXPERIMENT.md:57-63].
- R-WB-2 (strict partial algebra): every summary is either `ok(S)` or `fail(r)`, where
  r ∈ {`overflow`, `unknown_bound`, `invalid_bound`, `missing_summary`, `recursion`}.
  R3 (ARCH53 R2 P1-2, P2-5) removes `analysis_limit` and `cost_undefined` from this set. Analysis capacity is a phase-A host guard
  (R-WB-15c) and never a summary value. A construct without a CT row is an `IMPLEMENTATION_DEFECT` (R-WB-26), not a summary
  failure. The five remaining reasons are host-independent properties of the source closure.
  Composition is a **partial** function over a **canonical composition tree**, which is fixed by the program syntax and CT-1:
  - one tree node per CT-1 row instance;
  - a multi-operator row is split into the sub-nodes stated in that row, evaluated innermost first;
  - R3 (P2-1): a statement sequence `s1 … sn` (n ≥ 2) is a **left-nested chain of binary ⊕ nodes**,
    `(((s1 ⊕ s2) ⊕ s3) … ⊕ sn)`. It is never one n-ary node. A block with one statement is that statement's node.

  Each node is evaluated in two steps:
  1. **Strictness**: every child summary the node needs MUST be `ok`. If any child is `fail(r)`, the node is `fail(r)`.
     The reported `r` and location are those of the first failing child in source order.
  2. **Checked operation**: the node's exact value is computed from its children's exact values with the node operator
     (⊕ exact addition, ⊗ exact multiplication by a non-negative integer literal, `max`). If any dimension exceeds WB_MAX, the
     node is `fail(overflow)` at that node.

  Consequence (R3): with the binary chain, `seq(S{WB_MAX}, S{1}, fail(unknown_bound))` is `fail(overflow)` at the first ⊕ node,
  because that node's children are both `ok` and it is evaluated before the third statement is reached (V53-WB-N19).
- R-WB-2a (no regrouping): implementations MUST evaluate the canonical tree exactly as specified. They MUST NOT regroup,
  factor, distribute, reorder across nodes, or skip a child because an enclosing multiplier is zero. R2 withdraws the R1 claim that
  "a composition fails iff the exact mathematical result exceeds WB_MAX". It was false: `(M ⊗ 2) ⊗ 0` fails at the inner node,
  while the regrouped `M ⊗ (2 ⊗ 0)` would be 0. Two different programs with mathematically equal totals may therefore differ in
  acceptance. The canonical tree makes the result deterministic. For a pure ⊕ fold of non-negative values, checking each partial sum
  is equivalent to checking the total, because no partial sum exceeds the total. That equivalence is the only order-independence claimed.
- R-WB-2b (zero): `0 ⊗ ok(S) = ok(0)` (every dimension 0; empty effects map). `0 ⊗ fail(r) = fail(r)`. A zero multiplier never
  erases an unknown, missing, invalid, recursive or overflowed child. This is consistent with R-WB-11, which requires every function
  to have a valid summary whether or not it is reachable.
  R3 note (ARCH53 R2 P2-7): at source level, a failing callback already rejects its module through R-WB-11, whatever the fold
  count. A `0` fold count changes the result only at the caller's own call and `t1` nodes, and only when some dimension of the
  callee summary is within 2 of WB_MAX. The algebra vectors V53-WB-N12..N16 are MODEL vectors and pin this. R3 adds the executable source vector
  V53-LOOP-N11 (a failing callback folded 0 times is still rejected, at the callback). It does not invent source twins for shapes
  that need a summary near WB_MAX.
- R-WB-2c (`max`): `max` over alternatives is strict too. A `fail` alternative makes the node fail even if it is statically never
  taken. Given `ok` inputs, `max` cannot overflow.
- R-WB-2d (effects map): ⊕, ⊗ and `max` act per EffectKey. A key whose result is 0 is omitted from the canonical form.
  Overflow is checked per key.
- R-WB-2e (peak dimension `region_bytes`, from P0-08; R3 rewrite per ARCH53 R2 P2-2): it is not additive and it is **not**
  composed node by node. It is computed once per function by the closed form of §11.4, `peak(f) = L(f) ⊕ C(f)`, where `L(f)` is the
  checked Σ of the proven maxima of every allocation site syntactically in `f` (all blocks and all branches) and `C(f)` is the
  `max` of `peak(g)` over every callee and loop callback `g` referenced in `f`. ⊗, R-WB-6's branch `max` and the loop rows of
  CT-1 do not act on `region_bytes`. A fold count of `0` does not remove a callback from `C(f)`. Strictness applies: a site
  without a proven maximum is `fail(unknown_bound)`, a callee with `fail(r)` makes `peak(f)` fail with `r`, and `L(f) ⊕ C(f)` above
  WB_MAX is `fail(overflow)`.
- R-WB-2f (failure precedence; R3 per ARCH53 R2 P2-1): when several WorkBound failure causes exist, the reported one is fixed
  as follows.
  1. Call-graph phase first: if the closure has any call-graph cycle (R-CALL-3), the module fails with
     `air.call.recursion_rejected`, every cycle is listed in `cyclePath` order of first occurrence, and no summary is computed.
  2. Within one function: the additive tree is evaluated first, in canonical order (post-order, left to right, innermost
     first). Its first failing node is the function's failure. Only if the additive tree is `ok` is `peak(f)` (R-WB-2e) evaluated.
  3. A failure produced by a node itself is a **root failure**: an overflow at a checked node, or a leaf failure
     (`unknown_bound`, `invalid_bound`, `missing_summary`). A failure a node inherits from a child or a callee summary is a
     **propagated failure**. Each propagated failure carries a `cause` reference to its root failure.
  4. Module report: every root failure of the closure is listed, ordered by module identity (ASCII), then by source position
     (line, column). The first entry is the module's primary diagnostic and determines the stable code. Propagated failures are
     not separate diagnostics.

  These rules change only which failure is reported. They never change acceptance (V53-WB-N19, V53-WB-N20).
- Implementations MUST use exact integers. IEEE doubles or JS `Number` MUST NOT be used at any point [X-SND-02; M53-B12].
- R-WB-3: "unknown" is not a value. It is `fail(unknown_bound)`. There is no `null`, `Infinity` or "unknown but verified" state
  [X-SND-02; VERIFIED_RESOURCE_CERTIFICATE.md:30-35].
- R-WB-4 (canonical encoding): every value is a decimal string matching `^(0|[1-9][0-9]*)$`. A JSON
  number is never a WorkBound encoding [v0.51 RFC:184-186 pattern].

### 6.3 Summary vector

`S = (steps, calls, iterations, effects)`, where:

- `steps`: abstract AIR evaluation steps (CT-1);
- `calls`: local function call executions, including loop-callback invocations;
- `iterations`: loop body executions;
- `effects`: a finite map from EffectKey to count. An EffectKey is the canonical Host ABI import name, for example
  `output.emit`. Missing keys mean 0. The canonical form omits zero entries.

From P0-08 a **peak** dimension `region_bytes` is added (§11.4). All other dimensions are **additive**.
⊕, ⊗ and `max` act per additive dimension; on `effects` they act per key. R3: `region_bytes` is computed per function by the
§11.4 closed form (R-WB-2e), not by these node operators.

### 6.4 Cost table CT-1 (PROPOSED; id `air.workbound.cost/1`)

**Observation domain (R2).** `steps` counts the evaluation events of the typed-v0.53 *reference evaluator*. A row instance
contributes exactly its stated weight. A step is not a Wasm instruction, not machine work and not time. `calls`, `iterations` and
`effects[k]` count, respectively, local call executions, loop body executions and AIR→host import calls (§13).

**Scope of an entry summary.** `E(e)` covers the evaluation of one invocation of export `e`, from entry ingress to return or AIR failure.
Instantiation (fresh instance per invocation, R-STATE-1), data-segment initialization and host adapter marshalling are **not**
counted in `steps`. They are bounded by build admission (AIR-owned backing, phase B), by the emission caps on artifact bytes
(enforced incrementally during phase L, BUILD_REFUSED; §3.4; R3.1 errata R3-N7) and by the M2 lane limit (64 invocation lanes).

**A source operation is not constant work.** Rows whose evaluation is proportional to a size are weighted by that size. All
sizes are compile-time constants of the operation's type or proven maximum:

| Construct | Contribution |
| --- | --- |
| scalar SSA statement: atom assignment, conversion, comparison, arithmetic, bit operation, `select`, block `yield`, each over a scalar, an enum, or an `option`/`result` (fixed ≤ 3 lanes; frozen layout) | `steps 1` |
| constructor of `option`/`result` (outside a match arm) | `steps 1` |
| value of an aggregate type with `L` scalar lanes (P0-06): construction, whole-value copy (assignment, argument, yield, return), whole-value `struct.set` copy | `steps L` (L ≥ 1). A struct's lanes are its flattened scalar fields; `array<T,N>` has N·lanes(T). R3: exactly one copy row per transfer, as listed in R-WB-26b. |
| element/field access with a static index, or a dynamic index whose lowering is O(1) (P0-06/07/08) | `steps 1` |
| dynamic indexed access whose lowering is O(N) over N elements | `steps N` (R-WB-12) |
| check that a value enters a refined type from another type: assignment, call argument, yield, return or ingress | `+1 step` per check. It is charged even when lowering elides the check (R-REF-4), so the bound does not depend on proofs. |
| `match` with `k` arms | `steps 1+k` (dispatch compare chain), plus the componentwise max over the arms' block summaries. An atom arm, including a constructor atom, costs 0. |
| `return` | `steps 1` (plus a refinement check row if applicable; plus `L` for an aggregate result, R-WB-26b) |
| local call `call @f(…)` | sub-nodes, innermost first (R3): `c1` = the copy rows of the aggregate arguments, left to right (empty if none); `c2 = c1 ⊕ (steps 1, calls 1)`; `c3 = c2 ⊕ B(f)`, where `B(f)` is the body summary of `f`. Binding the call result adds nothing (R-WB-26b). |
| host extern call to key `k` | `(steps 1, effects[k] 1)`. Host-side work is not AIR work and is outside WorkBound (§6.1, R-EFF-10). |
| structured branch (P0-04) | `steps 1 ⊕ max(then, else)` |
| bounded loop with proven maximum `n`, body summary `Bd` (P0-05) | sub-nodes, innermost first: `t1 = (steps 1, iterations 1) ⊕ Bd`; `t2 = n ⊗ t1`; `t3 = (steps 1 + L_T) ⊕ t2`. For `loop.fold`, `Bd = call(callback)`, including the copy row of an aggregate accumulator argument. `L_T` is the lane count of an aggregate accumulator type `T` and 0 for every other `T` (R3, R-WB-26b), so every existing scalar-loop value is unchanged. |
| `alloc_region` with proven maximum size `B` bytes, including zero-initialization (R-MEM-5) (P0-08) | `steps 1 + ceil(B / 8)` |
| `free_region`; creating or narrowing a view (`slice.from_region`, `slice.sub`, `buffer.from_ptr`), its bounds check included whether or not lowering elides it | `steps 1` |
| raw or element memory access (`load.*`, `store.*`, `slice.load/store.*`, `buffer.load/store`), its bounds check included whether or not lowering elides it | `steps 1` |
| entry ingress, per exported parameter | `i32 i64 f32 f64`: 0; `bool`: 1; refined `i32<..>`: 1; enum with `c` cases: `c`; `option<T>`: `1 + ingress(T)`; `result<T,E>`: `1 + max(ingress(T), ingress(E))` |

Entry summary: `E(f) = ingress(f) ⊕ B(f)` for an exported `f`, evaluated as one checked node. Internal calls use `B(f)`, because
values are already validated.

- R-WB-26 (cost-table closure; R2; R3 reclassification per ARCH53 R2 P2-5): every construct admitted by any slice MUST have
  exactly one CT row **before** that slice is implemented. A slice that admits a construct amends CT-1 in its slice RFC text, and
  that amendment is reviewed with the slice. If the summarizer nevertheless meets a construct without a row, it aborts
  verification with `air.workbound.cost_undefined` (PROPOSED). R3: this is an **IMPLEMENTATION_DEFECT** (§3.4), a
  toolchain/specification incompleteness. It is not a property of the source program, not a STATIC_REJECT, not a member of the
  R-WB-2 failure set, and never answered with a default cost. A conforming implementation never emits it, and QA treats any
  occurrence as a slice-blocking finding (V53-WB-N18).
- R-WB-26b (aggregate transfers; R3 per ARCH53 R2 P2-3): a whole aggregate value of `L` lanes is charged `steps L` **once per
  transfer**, at the node that performs the transfer:
  - construction: at the constructor statement;
  - assignment `%b: T = %a` and block `yield %a`: at that statement;
  - call argument: in the call's `c1` sub-node, once per aggregate argument, in argument order;
  - return `return %a`: at the `return` row (`1 + L`);
  - call result `%r: T = call @f(…)`: **no extra row**. The callee's `return` already charged the copy out, and binding the
    result is that same transfer;
  - fold accumulator: per iteration, as the call argument in `Bd = call(callback)` and as the callback's `return`; plus `L_T` once
    in the loop's `t3` node for binding the fold result. That last charge also covers a 0-count fold, whose result is the seed;
  - `match` arm yielding an aggregate: as `yield`.

  Scalars, enums, `option` and `result` (fixed ≤ 3 lanes) are not aggregates and keep their R2 rows. Expected values:
  V53-AGG-WB01 (unchanged), V53-AGG-WB02..WB04 (R3).
- R-WB-27 (cost-table versioning): the cost table is part of the profile contract (§2.1 item 6). It may still be amended until
  H53-RELEASE. After that, any changed weight requires a new table id (`air.workbound.cost/2`) and a new profile id. The table id
  is part of `WorkBoundKeyV1`.
- R-WB-27a (cost-table content identity; R3 per ARCH53 R2 P2-4): the id `air.workbound.cost/1` names a table that may still change
  until H53-RELEASE, so the id alone does not identify content. In R2, summaries under different table revisions stayed
  separate only because the compiler digest was also in the key. R3 binds content explicitly:
  - P0-02 delivers CT-1 as a machine-readable file, a list of rows with exact construct names and exact decimal weights. Its
    `cost_table_digest = sha256(UTF8("AIR_WORKBOUND_COST_TABLE_V1") || 0x00 || canonical(table))`, with `canonical` as in R-WB-19;
  - every slice amendment of CT-1 (R-WB-26) produces a new file and therefore a new digest, recorded in the slice evidence;
  - `cost_table_digest` is a field of `WorkBoundKeyV1` (R-WB-18), so two summaries with the same table id but different table
    content never compare equal and are never mixed, whatever the compiler digest (V53-WB-ID-07);
  - at H53-RELEASE the final digest of `air.workbound.cost/1` is frozen with the profile. After that, a different digest under
    the same id is an `air.workbound.identity_mismatch`.

### 6.5 Composition rules

- R-WB-5 sequence: `seq(S1..Sn) = S1 ⊕ … ⊕ Sn` per additive dimension.
- R-WB-6 branch alternatives (`select` operands are atoms; `match` arms; P0-04 branches): componentwise
  `max` over the alternatives, plus the dispatch cost from CT-1. A componentwise max is sound because each
  dimension is bounded on its own.
- R-WB-7 return and early-exit paths: a function summary is the componentwise max over all paths from
  entry to exit. typed-v0.53 recommends a single structured exit (OPEN-16). If early exit were admitted, the same max rule would apply.
- R-WB-8 local calls: `call(f) = (steps 1, calls 1) ⊕ B(f)`, plus the aggregate argument copies of R-WB-26b in sub-node `c1`
  (R3). `B(f)` is computed **once** per function (memoized).
- R-WB-9 structured loops and callbacks: as in CT-1. The callback is a call edge whose summary is multiplied by `n`.
  **Effect multiplicity** follows from ⊗ on `effects`. With **zero iterations** (`n = 0`) the loop costs `steps 1 + L_T` (R3; `L_T = 0`
  for a non-aggregate accumulator) and its effects are 0, **iff** `t1` is `ok`. A failing body or callee still fails the loop (R-WB-2b).
  A dynamic count is charged at its proven maximum `n`, never at an optimistic value [spec/AIR_CORE.md:228; X-SND-01].
- R-WB-10 module edges (P0-09): a call to a function of an imported module is a local call whose `B(f)` comes from
  that module's summary. The summary is **recomputed** inside the same verification closure, from the
  dependency's bytes bound by identity (§6.9). It is never taken from a supplied certificate [X-SND-03; X-AUTH-03].
- R-WB-11 completeness: every function of a module, including unexported and unused ones, MUST have a
  finite summary, or the module is rejected (R-COMP-5).
- R-WB-12 lowering honesty: no construct may lower to code whose executed instruction count depends on a
  runtime value that is not charged by CT-1. A data-dependent linear chain MUST either be replaced by an
  O(1) lowering or be charged `N` [X-BND-04; M53-B13; M53-B21; M53-B22].
- R-WB-13 soundness obligation: for every accepted entry `e` and every admissible input, a reference evaluator
  that counts per CT-1 observes at most `E(e).steps` steps, `E(e).calls` calls, `E(e).iterations` iterations,
  and at most `E(e).effects[k]` host calls of each key `k`. If a runtime guard fails, it stops execution
  with a stable AIR failure before any bound is exceeded. Independent QA checks steps with its own reference evaluator,
  and checks effects and iterations through observable host-call counts [X-SND-01; X-SND-03; M53-B10].

### 6.6 Fail-closed conditions and diagnostics (PROPOSED family `air.workbound.*`)

| Condition | Code |
| --- | --- |
| a dimension exceeds WB_MAX | `air.workbound.overflow` |
| a loop count, index range or allocation size has no proven maximum | `air.workbound.unknown_bound` |
| a call target has no summary: external, opaque, or a missing dependency | `air.workbound.missing_summary` |
| a declared maximum is invalid (negative, above the profile cap of OPEN-14, or not an integer literal) | `air.workbound.invalid_bound` |
| a call-graph cycle (an SCC with a cycle) through call edges or loop-callback edges, including edges behind statically false branches | `air.call.recursion_rejected` (existing code reused with the same meaning and its `cyclePath` field) [spec/AIR_CORE.md:41,219; M53-B01] |
| a supplied summary or evidence does not match the recomputed one | `air.workbound.identity_mismatch` |

Every `fail(r)` of R-WB-2 maps to exactly one row above, and every row above is a phase-S disposition (§3.4). R3 removes two R2
rows from this table, because neither is a semantic WorkBound result:

- `air.workbound.analysis_limit_exceeded` (R2 PROPOSED) is **withdrawn**. Analysis capacity is a phase-A host guard with the
  disposition `ANALYSIS_REFUSED` and the code `air.analysis.capacity_exceeded` (PROPOSED; R-WB-15c). It is outside the
  `air.workbound.*` family, so no WorkBound code or evidence can carry it (V53-ANA-07).
- `air.workbound.cost_undefined` stays PROPOSED as the code of an `IMPLEMENTATION_DEFECT` (R-WB-26), not of a STATIC_REJECT.

These codes do not repurpose the existing `air.v052.work_limit_*`, `air.realtime.fuel_*` or
`air.resource_certificate.*` codes [M53-E17]. Every code is emitted with the `code:` delimiter and a
source location [X-CONF-03].

### 6.7 What WorkBound is not

WorkBound is not a grant, not a Budget, not a timeout, not a scheduler policy and not a cost guarantee in
time units [R03; R04 via M53-E18]. A host MAY use it as an admission input under its own policy
thresholds. Such a threshold is host policy: it never changes typed-v0.53 acceptance and never mints authority
[VERIFIED_RESOURCE_CERTIFICATE.md:111-116; S3 doc:52-66].

### 6.8 Analyzer effort and analysis capacity (R3 rewrite of R-WB-15a/16 per ARCH53 R2 P1-2 and the owner direction)

Owner direction for R3 (task text): analyzer effort is a host/tool resource guard, not semantic WorkBound. R3 implements the
reviewer's model (ii). Analyzer exhaustion is a non-semantic `ANALYSIS_REFUSED`. It is removed from R-WB-2, and no analysis
result depends on it.

- R-WB-14: summaries are computed in one pass in reverse topological order of the call DAG.
  Tarjan SCC (or an equivalent linear algorithm) detects cycles first. Each function is summarized exactly
  once. A summary is never re-derived per call site [X-BND-02; M53-E10; M53-B01].
- R-WB-15 (closure-wide bound; R2): analysis is bounded over the **whole unique import closure**, not per file.
  - The closure is the set of unique module identities reachable through imports (§12). Each is read, parsed, verified and
    summarized **once**, memoized by identity, however many importers it has.
  - Phase-A intake limits apply per module (the existing `maxSourceBytes` 256 KiB and `maxAstNodes` 65,536) **and** to the closure
    totals (PROPOSED, host-lowerable; OPEN-36): `maxClosureModules` = 64, `maxClosureSourceBytes` = 1 MiB,
    `maxClosureAstNodes` = 262,144. A closure total over its limit fails as `INTAKE_REFUSED`, with the existing intake codes and
    a `scope: "closure"` field.
  - Total analysis work is `O(N + E·K)`, where `N` is the closure's AST nodes, `E` its call edges and import edges, and `K` the distinct
    effect keys. `K` is bounded by the fixed Host ABI registry size, because typed externs are limited to registry signatures (§13).
  - The limits are applied **before** verification at every typed-v0.53 entrypoint: CLI verify/format/build/check, SDK
    parse/verify/format/lower, builder and runtime [M53-E09; M53-E11; X-BND-01].
- R-WB-15a (parser, type and graph effort; R2; R3 removes the host-dependent widening):
  - the parser is linear in source bytes, with no unbounded backtracking; block nesting is bounded in phase A (R-WB-15c);
  - type references are bounded by the existing nesting guard of 64 [M53-E09; `src/typed_interface.js:79-90` via M53-E09];
  - type checking is linear in AST nodes;
  - import-graph and call-graph cycle detection use one linear SCC pass each, `O(V + E)`;
  - range analysis for refinements and memory bounds (R3) is **one forward pass per function** over its structured body.
    typed-v0.53 has no back edges: there is no phi and there are no labels, and loops are folds over callbacks in an acyclic call
    graph. So the pass needs no fixed point and no widening. At call boundaries it uses only the declared parameter and result
    types. Its precision is part of the profile (phase S) and depends on no host value. The R2 clause "no fixed-point widening
    beyond the R-WB-16 constants" is withdrawn.
- R-WB-15b (no input-proportional recursion; R3): no analysis may use host-stack recursion whose depth grows with the input,
  except through syntax nesting, which R-WB-15c bounds. Import-closure reading, SCC detection and reverse-topological
  summarization MUST use an explicit worklist or stack. A call chain of any length that intake admits therefore never raises a raw
  `RangeError` or stack overflow (V53-ANA-05).
- R-WB-15c (analysis capacity; R3; PROPOSED values, OPEN-43):
  - **Measures.** Both are computed from the parsed closure in one linear pass at the **end of phase A**, before any phase-S
    analysis. They depend only on the source bytes.
    - `analysis_units(C) = Σ over modules m of C of (1 + decls(m) + stmts(m)) + call_sites(C) + callback_refs(C) + import_edges(C)`.
      - `C` is the unique import closure, each module counted once.
      - `decls(m)` counts the top-level declarations of `m` of every kind: functions, externs, enums, structs, tables,
        constants, state, the capability block, the demand block and each `use`.
      - `stmts(m)` counts every statement of every function body of `m` at every block depth: each element of a body or block
        statement list, `return` and `yield` included. A statement that contains blocks (value `if`, block-bodied `match` arm)
        counts 1, and each statement inside its blocks counts separately. An atom `match` arm is not a statement.
      - `call_sites(C)` counts every `call` occurrence (local, imported or extern). `callback_refs(C)` counts every `loop.fold`
        callback reference. `import_edges(C)` counts every `use` edge per importing module.
    - `nesting_depth(C)` is the largest block nesting depth of any function body. A body is depth 1, and each block nested inside
      a statement adds 1.
  - **Capacity.** A host's analysis capacity is `maxAnalysisUnits` (PROPOSED default 1,048,576 = 2^20) and
    `maxSyntaxNestingDepth` (PROPOSED default 64). Hosts MAY lower them. A host that claims typed-v0.53 conformance MUST NOT lower
    them below the **conformance floor** `ANALYSIS_UNITS_FLOOR` = 65,536 and `NESTING_DEPTH_FLOOR` = 32 (PROPOSED). A closure
    within the floor is analyzable on every conformant host. The defaults are a sizing choice above ordinary closures within the
    R-WB-15 intake defaults. They are not a guarantee that every intake-admitted closure fits.
  - **Refusal.** If `analysis_units(C) > maxAnalysisUnits` or `nesting_depth(C) > maxSyntaxNestingDepth`, the host returns
    `ANALYSIS_REFUSED` with `air.analysis.capacity_exceeded` (PROPOSED) and the fields `measure` (`analysis_units` |
    `nesting_depth`), `required` and `capacity`. A measure equal to the capacity is admitted. When both measures exceed, the
    report names `analysis_units` first.
  - **Not a verdict** (R-PIPE-1). `ANALYSIS_REFUSED` produces no STATIC_REJECT, no WorkBound evidence and no cached rejection.
    A host with more capacity may verify the same closure. Every conformant host that reaches a verdict reaches the same verdict
    with byte-identical WorkBound evidence. Analysis capacity is not part of `WorkBoundKeyV1`, of the summary record or of any
    WorkBound failure reason (V53-ANA-06, V53-ANA-07).
  - **Complexity obligation.** After admission, every phase-S analysis runs in `O(analysis_units(C) · K_max)` time and space,
    where `K_max` is the fixed Host ABI registry size, with host-stack depth `O(maxSyntaxNestingDepth)`. The capacity check
    bounds resource use. It is never needed for termination, because R-WB-14/15a/15b already terminate.
  - **Relation to the other phases.**
    - Parser and intake (phase A, M2): byte, AST-node and module limits per module and per closure (R-WB-15, OPEN-36). They bound
      what reaches the capacity check, which runs after them.
    - Import closure: read, parsed and measured once per unique identity.
    - Type checking and every other phase-S analysis run only after admission and read no host value.
    - Build admission (phase B) and the emission caps (phase L) apply after `VERIFIED` and are independent of analysis capacity.
    - Legacy analyzers (M5: provenance `FLOW_LIMITS`, semantic-patch `LIMITS`, and the legacy-verifier guard that the 0.52.1
      correction wave is adding) stay legacy-only. If H52 accepts a legacy guard code whose meaning is identical, OPEN-2(a) reuse
      applies. Otherwise typed-v0.53 uses `air.analysis.capacity_exceeded`.
- R-WB-16 (R3 rewrite): every typed-v0.53 verifier analysis, not only WorkBound, MUST meet the complexity obligation of
  R-WB-15c. No analysis may have a host-configurable constant that changes its **result**. The only host-configurable analysis
  values are the capacities of R-WB-15c, which can only refuse to start phase S. An analysis that cannot meet this is not
  admitted to the profile [M53-E10; X-BND-02]. R2's "fixed, profile-defined effort constant … Hosts may lower these constants"
  is withdrawn.
- R-WB-17 (R3 per ARCH53 R2 P2-13): emission caps (`maxWatBytes`, `maxWasmBytes`) are enforced **incrementally during phase L**
  at **every** typed-v0.53 lowering entrypoint: CLI build, SDK builder, runtime and direct `lowerToWat` [X-BND-01; M53-E11;
  V052_S5_PUBLIC_REALITY_PREFLIGHT.md:72-83]. Lowering keeps a running byte count and stops at the first emission that would
  exceed a cap, so nothing beyond the cap is materialized. The disposition is `BUILD_REFUSED` (§3.4), not a semantic rejection
  and not an implementation defect. Caps that can be decided before lowering (backing, engine counts) are phase B.

### 6.9 Identity binding

- R-WB-18 key: a summary is valid only for `WorkBoundKeyV1 = {body_digest, compiler_implementation_digest,
  cost_table, cost_table_digest, dependencies[], profile}` (PROPOSED field names; R3 adds `cost_table_digest`), where:
  - `profile` is the source profile id;
  - `cost_table` is `air.workbound.cost/1`;
  - `cost_table_digest` is the domain-separated content digest of the exact CT-1 revision used (R-WB-27a);
  - `body_digest` is the digest of the module's body. It is the existing raw `sourceDigest`. R2 adopts the reviewer
    recommendation for OPEN-33, which is still OPEN for the human: keep the raw digest, because extra cache misses are safe and a
    formatter-based semantic identity would be premature;
  - `dependencies` lists, for each imported module (stdlib included, if ever admitted), its module identity,
    body digest and summary digest, ordered ASCII by module identity;
  - `compiler_implementation_digest` is the existing `air.v052.toolchainManifest/1` digest over all of `src/`
    plus WABT. This is the single verifier identity, replacing the verifier.js-only identity for typed work evidence [X-WORK-04; M53-E19; M53-E08].

  The interface descriptor is not part of the key: the work of an entry depends only on its source and the
  cost table. Ingress costs come from source types (CT-1).
- R-WB-19 domain separation: the summary record digest is
  `sha256(UTF8("AIR_WORKBOUND_SUMMARY_V1") || 0x00 || canonical(record))`. `canonical` is the v0.51
  canonical JSON (sorted keys, UTF-8, no whitespace) [docs/rfcs/v0.51-final-architecture-freeze.md:116-124].
  The v0.52 undomained `artifactDigest` is not reused as a WorkBound digest [X-WORK-04].
- R-WB-20 P0-02 binding (internal; no public schema): P0-02 binds summaries only to **existing** identities:
  `sourceProfile`, `sourceDigest` (raw bytes, which is conservative) and `compiler.implementationDigest`, plus the
  cost-table id and, from R3, the cost-table content digest of R-WB-27a (P0-02 produces the CT-1 file, so this needs no new
  public identity). The binding lives in the trusted build record's private state, in place of the discarded work tuple
  [X-WORK-04; FIRST_IMPLEMENTATION_WORKBOUND "Bind composed summaries to the existing … identities. Do not invent a
  public serialization"]. The canonical record bytes of V53-WB-ID-06 pin only canonicalization and domain
  separation. The public record (OPEN-31) comes later; OPEN-33 (recommendation (c)) keeps the raw digest.
- R-WB-21 recomputation: summaries are always recomputed from bytes bound by identity. Any change of profile,
  body, dependency, toolchain or cost table changes the key and forces recomputation. A supplied summary,
  certificate or evidence record can never lower a derived bound. It is either ignored or compared for
  equality; a mismatch fails with `air.workbound.identity_mismatch` [task test 15; X-SND-04].
- R-WB-22: typed-v0.53 adds no field to DecisionEvidence, EffectReceipt, Budget or `PackageIdentityV1`
  [R03; R14; M53-E20; M53-D16]. A frozen record with an unknown `work_bound` field keeps failing with
  `air.v051.record_invalid` [M53-E20].

### 6.10 Relation to legacy M1

- R-WB-23: M1 output (legacy usage counts, legacy certificate, legacy effect budgets, realtime fuel) is
  **never** an input, oracle or authority for typed-v0.53 [HD-2; X-WORK-01; M53-E08; M53-E14; M53-E15].
- R-WB-24: the legacy certificate API MUST reject typed ASTs, typed-v0.53 included, with a stable code and never
  return `verified`. This is the 0.52.1 X-SND-04 correction, extended to typed-v0.53 ASTs in SCALAR [X-SND-04; HD-5].
  The 0.52.1 candidate code is `air.resource_certificate.profile_unsupported` (`263d0fa:src/verifier.js`; CANDIDATE_0521, pending QA52).
  typed-v0.53 reuses it if H52 accepts it.
- R-WB-25: after 0.52.1, M1 stays the legacy-v0.50 report: sound where defined, and fail-closed `unsupported` otherwise
  [R0 §2 compatibility statement]. Whether it should later be proven a sound projection of this family is OPEN-32. The recommendation is not in v0.53.
  The 0.52.1 candidate's M1 overflow range is the JS safe-integer range (2^53 − 1; `263d0fa:spec/AIR_CORE.md`). It is a property
  of the legacy report and is not the typed WB_MAX. The two are never compared or converted.

### 6.11 Hostile vectors (coverage)

| Ledger | Rule(s) | Vectors |
| --- | --- | --- |
| X-SND-01 phi iterations uncharged | R-WB-9, R-WB-13; phi not admitted (§8) | V53-WB-H01, V53-WB-P04, V53-LOOP-P05, V53-CFG-N02 |
| X-SND-02 Number overflow, still "verified" | R-WB-1..3 | V53-WB-N04, V53-WB-N05, V53-WB-N08, V53-WB-H02 |
| ARCH53 R1: regrouping and zero multiplication | R-WB-2, R-WB-2a..2d | V53-WB-P13, V53-WB-P14, V53-WB-N12..N17 |
| X-SND-03 cross-module undercount | R-WB-10 | V53-WB-H03, V53-IMP-P01 |
| X-SND-04 typed AST false verified, digest collision | R-WB-21, R-WB-24 | V53-WB-H04, V53-WB-ID-02, V53-ASSUR-01 |
| X-WORK-01 competing models | §6.1 | V53-WB-H05 |
| X-WORK-02 WB01-WB05 undefined | this catalogue defines the V53-WB-* set; the undefined WB01-WB05 placeholders are superseded, not mapped | VECTORS.md §WB |
| X-WORK-03 mixed effect namespace, vacuous unknown keys | §13 R-EFF-3/4 | V53-WB-H08, V53-EFF-N03, V53-EFF-N04 |
| X-WORK-04 identity gaps | R-WB-18..20, R-WB-27a (R3) | V53-WB-ID-01..07, V53-WB-H09 |
| X-WORK-05 per-site cap only | R-WB-9 (total bound), §6.7 | V53-WB-H02, V53-LOOP-P06 |
| X-BND-02 exponential verifier | R-WB-14..16; R3: R-WB-15b/15c | V53-WB-H06, V53-ANA-01..08 |
| ARCH53 R2 P2-1: failure precedence | R-WB-2 (binary chain), R-WB-2f | V53-WB-N19, V53-WB-N20 |
| X-BND-04 hidden O(N) lowering | R-WB-12 | V53-WB-H07, V53-AGG-P02 |

### 6.12 P0-02 deliverable (what the foundation implements)

P0-02 implements §6.2-§6.10 as an internal algebra, with three uses:

- summary computation for typed-v0.51 ASTs, which have no calls or loops (CT-1 straight-line part);
- the identity binding of R-WB-20;
- the diagnostics of §6.6.

It adds no syntax, changes no typed-v0.51 or legacy disposition, and changes no ABI, Host ABI or Host Contract.
The implicit v0.52 typed-subset work witness (no calls or backedges, so emitted size bounds work) stays true for
typed-v0.51. From P0-02 on it is backed by an explicit summary, and it is never relabelled as a WorkBound record
[M53-E12; V052_S5_PUBLIC_REALITY_PREFLIGHT.md:79-83].
Its required tests 1-15 are V53-WB-P01..P14, V53-WB-N01..N18 and V53-WB-ID-01..06. R2 adds P13-P14 and N12-N17 (the strict
partial algebra and the zero and regrouping boundary cases) and N18 (the cost-table closure guard). The regression set is V53-WB-REG-01..03, and the pipeline set is
V53-PIPE-01..02 [FIRST_IMPLEMENTATION_WORKBOUND "Required tests"; §18].
R3 adds V53-WB-N19/N20 (failure precedence), V53-WB-ID-07 (cost-table content digest) and V53-ANA-07 (no analysis term in
WorkBound). It revises V53-WB-N18 (an IMPLEMENTATION_DEFECT, not a STATIC_REJECT), V53-WB-ID-06 (the key gains
`cost_table_digest`) and V53-PIPE-02 (typed-v0.51 input, executable at P0-02). P0-02 does not implement the analysis-capacity
guard of R-WB-15c, because no typed-v0.53 entrypoint exists before SCALAR.

## 7. Refinements and checked public ingress (P0-03)

Two semantics share the `i32<..>` syntax today [X-PROF-04; M53-A12; M53-A13]:

- legacy: static-only and erased; widening allowed; exported refined parameters are unchecked host
  assumptions (X-SND-09);
- typed-v0.51: runtime-checked on ingress and assignment (frozen N28-N30); nominal; no widening.

typed-v0.53 resolves this with **one** semantics.

- R-REF-1 (meaning): `i32<a..b>` (with `a ≤ b`, both within i32) is a **guarantee** that holds at every program point
  where the value is observable [HD-1].
- R-REF-2 (how a value is established): a value gets a refined type only through
  1. a literal inside the range (static);
  2. statically proven containment by the verifier's range analysis (linear; R-WB-16);
  3. an **assignment check** after arithmetic or conversion, failing with
     `air.refinement.assignment_out_of_range`. Checked arithmetic failure takes precedence
     [v0.51 RFC:170-180; N28-N30];
  4. an **entry check** on an exported parameter, failing with
     `air.refinement.ingress_out_of_range` (PROPOSED). Today this is a bare `unreachable` [M53-A13; X-CONF-06].
- R-REF-3 (no unchecked assumption): no construct may introduce a refined fact about a host-supplied value
  without a check. "Static" means proven. "Entry-checked" means enforced at public ingress. A third,
  "assumed", category does not exist in typed-v0.53 [X-SND-09; M53-A15].
- R-REF-4: lowering MAY elide a check only where the verifier proved containment, and the elision MUST NOT change
  observable behaviour. WorkBound still charges the check (CT-1).
- R-REF-5: widening and narrowing are OPEN-10. The recommendation (R2), which covers every point where a value enters a typed slot:
  1. **Widening** from `i32<a..b>` to `i32`, or to any containing `i32<c..d>` (c ≤ a, b ≤ d), is implicit and costs nothing.
  2. **Narrowing** into `i32<a..b>` from `i32` or a non-contained refinement is allowed at five *refinement entry points*:
     assignment, internal call argument, block `yield`, `return`, and export ingress. It is either statically proven or
     runtime-checked; there is no other way.
     - A failing check at an assignment, argument, yield or return fails with `air.refinement.assignment_out_of_range` (frozen code).
     - A failing check at export ingress fails with `air.refinement.ingress_out_of_range`.

  This is a monotonic extension of typed-v0.51. typed-v0.51 rejects atom narrowing statically, and it stays frozen (R-PROF-4).
- R-REF-6: refinements on `i64`, `f32` and `f64` are not admitted in v0.53. Slice-length refinements come only with P0-08
  (OPEN-22) [M53-A12].
- R-REF-7 (descriptor representation, OPEN-11; R2 rewrite): the recommended branch (a) maps the refined export signature by
  `desc` (R-TYPE-2). `export func g(n: i32<0..10>) -> i32<0..10>` has descriptor `(i32) -> i32`.
  `validateDescriptorAgainstSource` accepts a refined source parameter or result against the entry `desc(t)` and nothing else.
  The obligations are:
  - **Parameter**: entry check before any other evaluation of the body (R-REF-2(4)).
  - **Result**: the returned value is in the result refinement at the `return` statement, by proof or by a checked narrowing
    (R-REF-5(2)). A host therefore never receives a value outside the declared result range. There is no separate egress check,
    because the return-point rule already establishes it.
  - **Internal calls and yields**: refined parameters of internal functions and refined block destinations are refinement entry
    points (R-REF-5).
  - **Build evidence**: the build record carries the source signature, refinements included, alongside the descriptor. That needs
    a versioned build-record schema (`air.v052.verifiedTypedBuild/2` is closed and must not be silently extended; M53-E19), so a new
    schema id is required (OPEN-31).

  No ABI 0.12 descriptor grammar change [M53-A13; M53-C14; X-PROF-02; ARCH53 R4].
- R-REF-8 (checked entry relations): a `checked` relation is never inert. The legacy shape
  `requires checked param` on an export without borrowed parameters verifies and emits no check
  [X-SND-09; M53-A15]. In typed-v0.53 every admitted `checked` relation is enforced at entry preflight.
  Scalar parameter relations are written as refinement types. `requires checked bytes … >= param … * k` is
  admitted only with borrowed parameters (P0-08). The fate of the remaining legacy contract syntax is OPEN-12;
  the recommendation does not admit it [M53-A14].
- R-REF-9 (failure transport; R2; OPEN-38): a host distinguishes refinement failures from numeric failures and from every other trap
  through a closed **failure-reason registry**:
  - R3 (ARCH53 R2 P2-8): the registry is a **bijection** between reason values and host-facing failure identities. A
    host-facing identity is a stable code plus, for `air.numeric.checked_failure` only, its frozen reason word. Every in-module
    runtime failure of typed-v0.53 has exactly one entry, and no two entries share an identity:

    | Value | Host-facing identity | Raised by | Status |
    | --- | --- | --- | --- |
    | 1 | `air.numeric.checked_failure` / `overflow` | checked i32/i64 arithmetic and conversions | EXISTING (M53-A08) |
    | 2 | `air.numeric.checked_failure` / `division_by_zero` | checked division and remainder | EXISTING |
    | 3 | `air.numeric.checked_failure` / `invalid_conversion` | checked conversions | EXISTING |
    | 16 | `air.refinement.ingress_out_of_range` | export entry check (R-REF-2(4)) | PROPOSED |
    | 17 | `air.refinement.assignment_out_of_range` | assignment, argument, yield and return checks (R-REF-5) | PROPOSED value; code EXISTING |
    | 32 | `air.loop.count_out_of_range` | dynamic fold count (R-LOOP-2) | PROPOSED |
    | 33 | `air.table.index_out_of_range` | dynamic table index (R-AGG-1) | PROPOSED |
    | 34 | `air.memory.region_bounds_runtime` | every dynamic memory-domain check of R-MEM-0: raw offset, view length and sub-view, slice offset, buffer element index, Host ABI `cap`, dynamic `alloc_region` size (R-MEM-1) | code EXISTING; value PROPOSED |
    | 35 | `air.array.index_out_of_range` | dynamic `array<T,N>` index (R3: split from R2's shared value 33) | PROPOSED |
    | 48 | `air.decision.enum_discriminant_invalid` | in-module enum ingress check | code EXISTING; value PROPOSED |
    | 49 | `air.decision.payload_tag_invalid` | in-module `option`/`result` tag ingress check (R3) | PROPOSED |
    | 50 | `air.decision.bool_lane_invalid` | in-module `bool` lane ingress check (R3; the in-module form of frozen N32) | PROPOSED |

    Values 0 and every value not in the table are not identities: 0 maps to `air.runtime.trap_unclassified` (an
    IMPLEMENTATION_DEFECT) and any other value to `air.runtime.failure_reason_unknown` (fail closed). A new in-module failure in a
    later slice gets a new value through its slice amendment. Reusing a value for a second identity is forbidden.
    The diagnostic **detail** of value 34 (`lower_bound`, `upper_bound`, `region_size`, `capacity`) is a message field, not part
    of the identity.
  - It is carried in an exported mutable i32 failure-reason global. The module sets the reason immediately before the AIR-defined trap.
    Each invocation uses a fresh instance (R-STATE-1), so the global starts at 0 and cannot be stale.
  - The verified runtime maps (trap, reason) to the stable host-facing code. A trap with reason 0 maps to
    `air.runtime.trap_unclassified` (PROPOSED), which is an implementation defect if it is ever reached, never a valid language
    disposition. An unregistered reason value fails closed as `air.runtime.failure_reason_unknown` (PROPOSED).
  - The verified runtime MAY also validate refined parameters host-side before instantiation, as it does today for enum
    discriminants (M53-A04). If it does, it MUST produce the same code. R3: structural argument errors that never reach Wasm
    (wrong arity, wrong JS type) keep the existing `air.v052.invocation_arguments_invalid`
    [`f258ed0:src/v052_verified_build.js:398-432`].
  - Whether the global is the existing `__air_v051_checked_numeric_failure` with an extended registry, or a new profile-neutral export,
    is OPEN-38. typed-v0.51 artifacts are unchanged either way.
- R-REF-10 (WorkBound): each refinement entry point costs `+1 step` (CT-1), at ingress, assignment, argument, yield and return,
  whether or not lowering elides the check.
- R-REF-11 (ABI and adapter impact; R2): the descriptor signature is unchanged (`i32`), but the **adapter contract changes**:
  - JavaScript and Swift adapters must map the new failure reasons to `air.refinement.ingress_out_of_range` /
    `air.refinement.assignment_out_of_range`;
  - they must read the refinement metadata from the new build-record schema;
  - a host may no longer assume that every `i32` value is accepted.

  §17 classifies this as `ADAPTER_CONTRACT_CHANGE` on the AIR ABI 0.12 candidate lane, not as NONE.
- R-REF-12 (old and new adapters; R3 per ARCH53 R2 P2-8): R2 said that old adapters "must reject typed-v0.53 artifacts they
  do not support". AIR cannot impose behaviour on adapters that have already shipped, so R3 withdraws that sentence and states
  what each combination does and what is enforceable. "Old adapter" means the 0.52.x verified runtime, whose numeric mapping is
  `f258ed0:src/v052_numeric_diagnostic.js:5-19`: it reads `__air_v051_checked_numeric_failure`, maps only values 1-3, and returns
  `null` otherwise. The caller then reports `air.v052.invocation_runtime_failure` (`f258ed0:src/v052_verified_build.js:571-577`).

  | Artifact \ adapter | old adapter (0.52.x) | typed-v0.53 adapter |
  | --- | --- | --- |
  | typed-v0.51 artifact | unchanged | unchanged: values 1-3 map as before; the artifact is byte-unchanged under either OPEN-38 option |
  | typed-v0.53 artifact, OPEN-38 (a) (extended existing global) | numeric values 1-3: correct numeric code. Values ≥ 16: `null`, so the generic `air.v052.invocation_runtime_failure`. A refinement, bounds or loop failure is never misreported as a numeric failure, but its identity is lost | full registry mapping |
  | typed-v0.53 artifact, OPEN-38 (b) (new `__air_failure_reason` export) | the numeric global stays 0 for non-numeric failures, so again the generic runtime failure. If typed-v0.53 numeric failures also move to the new export (R-SCL-3, option (b)), even numeric failures are generic on the old adapter | full registry mapping |
  | typed-v0.53 artifact, direct-export host (no AIR adapter) | n/a | no AIR enforcement. The host must implement the registry itself or it observes bare traps |

  What is **enforceable** by AIR: (1) the candidate gate (R-PROF-1) and the compiler implementation digest bind every typed-v0.53
  artifact to the build that produced it; (2) the 0.52.x verified runtime admits only build objects it created in-process (the
  private `BUILDS` state), so it has no API that accepts a typed-v0.53 build record; (3) the typed-v0.53 adapter fails closed on
  an unregistered value (`air.runtime.failure_reason_unknown`, V53-REF-N11) and maps every registered value exactly
  (V53-REF-N12). What is **not** enforceable: what a shipped adapter or a direct-export host does with a typed-v0.53 Wasm module it
  obtains by other means. That is a disclosed limitation, like R-MEM-12. V53-REF-N13 characterizes the old-adapter column under
  both OPEN-38 options. Either way the old adapter degrades to a generic failure and never to a wrong specific code, which
  supports the OPEN-38 (b) recommendation without depending on it.

## 8. Calls, call graph, recursion, structured control flow (P0-04)

- R-CALL-1 (PROPOSED shape): `%r: T = call @f(%a, …)` for a non-void callee; `call @f(%a, …)` as a
  statement for a `void` callee (OPEN-17). Arguments match parameter base types exactly (R-COMP-1). A refined parameter is a
  refinement entry point (R-REF-5; OPEN-10).
  Aggregate arguments are copied by value, and a memory view is passed as a noescape borrow (R-MEM-9). R3: the copy charges
  are those of R-WB-26b (argument copy in the call node, result copy at the callee's `return`, nothing extra at the binding).
  Typed values (enum/option/result) cross internal calls by their lanes. This internal convention is not
  observable and is not an ABI change [M53-B01].
- R-CALL-2: an unbound non-void result fails with `air.call.result_unbound` (PROPOSED). Binding a void result
  is rejected [M53-B01].
- R-CALL-3 (call graph): the nodes are the functions of the verification closure. The edges are call sites and loop-callback
  references, including those behind statically false branches. Extern calls are not edges. Any cycle fails with
  `air.call.recursion_rejected` and a `cyclePath` [spec/AIR_CORE.md:41,219; M53-B01].
- R-CALL-4: there are no indirect calls, first-class functions or closures.
- R-CFG-1 (structured control): typed-v0.53 has no labels, `br`, `br_if` or `phi`. Branching is structured.
  PROPOSED shape (exact syntax OPEN-16):
  `%r: T = if %c { … yield %a } else { … yield %b }` and `match` arms with block bodies ending in `yield`.
  Locals defined inside a block are not visible after it. Joins happen only through `yield` (they replace phi)
  [M53-B02; M53-B10].
- R-CFG-2: there is a single function exit: `return` only as the last top-level statement (OPEN-16, recommended).
- R-CFG-3: unstructured forms fail with `air.control.unstructured_unsupported` (PROPOSED). The frozen
  legacy codes `air.control.br_syntax_invalid` and `air.control.br_if_syntax_invalid` stay legacy-only and
  unchanged [V052_SOURCE_PROFILE_CLOSURE.md:45-53; M53-B02].
- R-CFG-4: WorkBound composition for calls and branches is R-WB-6 and R-WB-8.
- The typed module needs no entrypoint (library modules are allowed, as in typed-v0.51) [M53-A03].

## 9. Bounded loops and effect multiplicity (P0-05)

One canonical form (answers "one or two canonical forms"; OPEN-15 for the alternative):

- R-LOOP-1 (PROPOSED shape):
  `%acc: T = loop.fold @f, %seed, <count>`. `<count>` is either an integer literal `n` with
  `0 ≤ n ≤ LOOP_MAX`, or `%c max n` (a dynamic `i32` with a literal maximum). The callback `f` has the shape
  `(T) -> T`, or `(T, i32) -> T` where the second argument is the index `0..k-1`.
  **LOOP_MAX = 4096** (PROPOSED; OPEN-14) [spec/AIR_CORE.md:42].
- R-LOOP-2: if a dynamic count `c` is outside `0 ≤ c ≤ n`, evaluation fails with
  `air.loop.count_out_of_range` (PROPOSED) **before the first iteration**. The rejected loop performs **no** iteration and no host
  call. Effects already performed earlier in the same invocation are **not** rolled back: a failure is not a transaction, and a
  fresh Wasm instance per invocation is not a transaction either (R-EFF-12). Otherwise the loop runs exactly `c`
  iterations [X-CONF-06; M53-B04; ARCH53 R6].
- R-LOOP-3: WorkBound charges `n` (R-WB-9). Effects inside `f` are multiplied by `n`. `n = 0` returns the seed
  [X-SND-01; X-WORK-05]. R3: an aggregate accumulator is charged per R-WB-26b (V53-AGG-WB03/WB04). A callback whose summary
  fails rejects the module even when every fold over it has count 0 (R-WB-2b, R-WB-11; V53-LOOP-N11).
- R-LOOP-4: the callback edge is part of the call graph (R-CALL-3).
- R-LOOP-5: lowering may unroll a static `n` only within the emission caps (R-WB-17). There is no independent fuel; the runtime guard
  of R-LOOP-2 is the only dynamic check [M53-E14].
- Legacy forms in typed-v0.53 [M53-B05; M53-B06; M53-B07; M53-B08; M53-B09; M53-B10; M53-B11]:
  - `loop.range.*` is DEPRECATION_PROPOSED; migration maps it to `loop.fold`.
  - structured phi loops are DEPRECATION_PROPOSED; migration maps the counter shape to `loop.fold` or rejects it.
  - `loop.array.*` and `loop.buffer.f32` are OPEN-15 (recommended DEPRECATION_PROPOSED in favour of the indexed fold).
  - `loop.poll` and `io.poll_bounded` are OUT_OF_CORE_PROPOSED.
  - `loop.map.*`, `loop.while` and `for` fail with `air.loop.form_unsupported` (PROPOSED).
- Source-level WorkBound assertions (author caps) are OPEN-13. The recommendation is static assertions in P0-05,
  never host authority.

## 10. Fixed aggregates, tables, constants, state primitives (P0-06 / P0-07)

- R-AGG-1 (static tables, P0-06): `table name: T[N] = [v0, …]`, with `T ∈ {i32, i64, f32, f64, bool}` and `1 ≤ N ≤ 65536`.
  Literals are exact (R-COMP-2): legacy i64 table values that lose precision are a LEGACY_DEFECT and are not preserved [X-SND-08; M53-B13].
  Tables are read-only. A static out-of-range index is rejected; a dynamic one fails with `air.table.index_out_of_range` (PROPOSED).
  Lowering MUST be O(1) per access, for example a data segment in internal, non-exported memory, or else charged `N` (R-WB-12) [X-BND-04].
- R-AGG-2 (module constants, P0-07): `const NAME: T = literal` for `T ∈ {i32, i64, f32, f64, bool}`. Constants are exact
  and compile-time only. Computed initializers are rejected [M53-B19; spec/AIR_CORE.md:32,115].
- Internal fixed records and arrays are OPEN-18. The recommendation admits them internal-only, with value semantics,
  not exportable [M53-B16; M53-B17; spec/AIR_CORE.md:107-109; v0.51 RFC:454-459].
- Facts and rowset schemas (and the structured IO and command-buffer schemas) stay package metadata, independent of the
  profile and unchanged (PRESERVE) [M53-B18; M53-C11; M53-C12].
- Compact u8/u16/i16 tables and tablegroups are OPEN-19. The recommendation is UNSUPPORTED_FAIL_CLOSED in typed, with legacy unchanged
  [M53-B14; M53-B15].
- State primitives are OPEN-20. The recommendation for P0-07 admits only **invocation-scoped** mutable state: it is initialized
  for each invocation and never persists. Cross-invocation persistence and generated state handles are DEFERRED_V054
  (G54-STATE) [M53-B20; M53-B21; M53-B23; R07]. Pools: OPEN-21, recommended not admitted [M53-B22; X-BND-04].
- R-STATE-1 (compile cache != persistent state): the typed runtime cache stores only immutable compiled modules.
  Every invocation uses a fresh instance with fresh memory and globals. No state, admission decision, grant or WorkBound
  acceptance is cached as authority [S3 doc:52-66; M53-B24; M53-E19].

## 11. Memory, slices, buffers, borrowed lifetimes (P0-08)

### 11.1 Normative guarantees (X-SND-05..07 and X-SND-11..12 stated as rules; R2 completes the contract per ARCH53 R3)

**Model.**

- Every AIR-owned region `r` has an **extent** `ext(r)`: the byte size passed to `alloc_region`, with `0 ≤ ext(r) ≤ max(r)`, where
  `max(r)` is the verifier-proven maximum and `max(r) ≤ REGION_MAX` = 16 MiB (PROPOSED profile constant; the same limit as the
  0.52.1 candidate per-site slot, `air.memory.region_size_unsupported`, CANDIDATE_0521).
- Every pointer or view value carries **provenance** `(r, off)`, a region and a byte offset, plus, for views, a **byte length**
  `len`. The value is internal metadata, not an integer.
- There is no integer→pointer conversion and no pointer arithmetic outside the view operations below. An exported or
  host-supplied raw `ptr` is not admitted (OPEN-22).

Rules:

- R-MEM-0 (domains before arithmetic; R3 per ARCH53 R2 P1-1). Every memory quantity that comes from an AIR value is a signed
  `i32` source value. Before **any** arithmetic on it, and before any memory access or host call that uses it, it is checked
  against the domain below. Each check is either proven statically (phase S) or emitted as a runtime check (phase R) that runs
  before the guarded operation. A Wasm out-of-bounds trap, unsigned reinterpretation or 32-bit address wrap is never the
  mechanism. This restores the frozen invariant `0 <= offset` and the frozen rule that dynamic checks "reject negative region sizes
  and offsets before unsigned comparison" [`f258ed0:docs/v0.50/REGION_BOUNDS_INTEGRITY.md:7-19`; `f258ed0:src/region_bounds.js:7-48`].

  | Construct | Quantity (unit) | Domain, checked in this order | Zero | Positive required? (source) | Static failure | Runtime failure (R-REF-9 value) |
  | --- | --- | --- | --- | --- | --- | --- |
  | `alloc_region s` | size `s` (bytes) | `0 ≤ s`, then `s ≤ max(site)`; `max(site) ≤ REGION_MAX` | **valid**: an empty region; every access to it fails because `ext ≥ w` is false | no (`f258ed0:src/region_bounds.js:7-16` accepts `min ≥ 0`) | `air.memory.region_bounds_static` (s always < 0, frozen); `air.memory.region_size_unsupported` (max > REGION_MAX, CANDIDATE_0521); `air.workbound.unknown_bound` (no proven max) | `air.memory.region_bounds_runtime` (34), detail `region_size` |
  | `load.T` / `store.T` on a region pointer | offset `o` (bytes); width `w` = byte width of `T` (≥ 1 by construction) | `0 ≤ o`, then `ext(r) ≥ w`, then `o ≤ ext(r) − w` | `o = 0` valid when `ext(r) ≥ w` | `w` only (fixed by the operation) | `air.memory.region_bounds_static` | 34 |
  | `slice.from_region p, L` | length `L` (bytes) | `0 ≤ L`, then `L ≤ ext(r)` | **valid**: an empty view | no | `air.memory.region_bounds_static` | 34 |
  | `slice.sub v, o2, L2` | `o2`, `L2` (bytes) | `0 ≤ o2`, `0 ≤ L2`, then `L2 ≤ len(v)`, then `o2 ≤ len(v) − L2` | **valid**: `L2 = 0` gives an empty sub-view, including at `o2 = len(v)` | no (`f258ed0:src/lower_wasm.js:1903-1930` accepts width 0) | `air.memory.region_bounds_static` | 34 |
  | `slice.load.T` / `slice.store.T` | offset `o` (bytes); width `w` | `0 ≤ o`, then `len(v) ≥ w`, then `o ≤ len(v) − w` | `o = 0` valid when `len(v) ≥ w` | `w` only | `air.memory.region_bounds_static` | 34 |
  | type `buffer<T,N>` / `array<T,N>` | element count `N` | `1 ≤ N ≤ 65536` | **invalid** | **yes** (`f258ed0:src/types.js:53-55`: `length > 0`) | `air.v051.type_reference_invalid` (EXISTING) | — (static only) |
  | `buffer.from_ptr p` as `buffer<T,N>` | byte length `N·sizeof(T)` | checked multiplication, then `N·sizeof(T) ≤ ext(r)`, region base offset 0 | n/a (`N ≥ 1`) | — | `air.memory.region_bounds_static` | 34 (dynamic extent) |
  | `buffer.load` / `buffer.store` | element index `i` | `0 ≤ i`, then `i < N`; only then byte offset `i·sizeof(T)` by checked multiplication | `i = 0` valid | — | `air.memory.region_bounds_static` | 34 |
  | `array.get` / `array.set` (P0-06) | element index `i` | `0 ≤ i`, then `i < N` | `i = 0` valid | — | `air.array.index_out_of_range` | 35 |
  | `table.get` (P0-06) | element index `i` | `0 ≤ i`, then `i < N` | `i = 0` valid | — | `air.table.index_out_of_range` | 33 |
  | Host ABI `(ptr, cap)` pair (P0-10, under OPEN-29) | capacity `cap` (bytes) | `0 ≤ cap`, then `cap ≤` the remaining extent of the passed region or view (`ext(r)` for a region pointer, `len(v)` for a view) | **valid**: the host receives an empty range. What an import does with an empty range is that import's host contract | no source requires `cap > 0` | `air.memory.region_bounds_static` | 34, before the host call; the call does not happen |
  | `borrowed_slice` (host-supplied, AIR ABI 0.11) | length | frozen binding rules, unchanged | **valid**: zero-length ranges are empty and non-overlapping | no (`f258ed0:docs/v0.50/BORROWED_SLICES_SECURITY.md:110`) | binding codes (`air.borrow.*`, EXISTING) | binding codes |

  Arithmetic after the domain checks:
  - Element index to byte offset: `i·sizeof(T)` is computed only after `0 ≤ i < N`. It is still specified as a checked
    multiplication. A lowering that multiplies first in 32-bit arithmetic is non-conformant: index 2^30 on `buffer<i32,4>` would
    wrap to byte offset 0 and alias element 0 (V53-MEM-N29).
  - Base plus offset: the absolute address `slot_base(r) + off + o` is formed only after `o ≤ len − w` (or `o ≤ ext(r) − w`).
    Every term is then bounded by the artifact's AIR-owned backing, which phase B caps below 2^31 (OPEN-37), so the address
    cannot wrap. The comparison form never adds two unchecked operands: `o + w ≤ len` is evaluated as `len ≥ w ∧ o ≤ len − w`
    (V53-MEM-N27, V53-MEM-N33).
- R-MEM-13 (failure precedence for memory operations; R3): for one operation, checks run in the order of the R-MEM-0 table row
  (lower bounds of operands in operand order, then extents). The first failing check is reported. Liveness
  (`air.memory.region_not_live`) and noescape (R-MEM-9) are phase-S checks and precede every domain check of the same statement.
  At runtime all memory-domain failures share value 34, so precedence changes only the diagnostic `detail`.
- R-MEM-1 (backing ≥ live, disjointness): the physical backing of each region covers `max(r)`. Live regions are pairwise disjoint,
  and disjoint from static and literal data and from every host-borrowed range. Soundness of per-site static slots: the call graph is
  acyclic (R-CALL-3), regions have same-function lifetime, and host reentrancy is forbidden (R-EFF-11). Together these mean that
  each allocation **site** has at most one live region at any time, so one slot per site is sufficient.
  An allocation whose proven maximum exceeds REGION_MAX is a phase-S rejection (`air.memory.region_size_unsupported`).
  R3 (ARCH53 R2 P1-1, P2-14): the proven maximum of a dynamic size comes either from the refinement type of the size operand
  (`%n: i32<a..b>` gives `max = b`) or from an explicit annotation `alloc_region %n max B` with a literal `B` (PROPOSED shape,
  mirroring `loop.fold … %c max n`; OPEN-22). The size domain `0 ≤ s ≤ max(site)` of R-MEM-0 is then checked before
  allocation. A negative or above-maximum dynamic size fails at runtime with `air.memory.region_bounds_runtime`, reason value 34,
  detail `region_size`, before the region exists and before any access. This is the identity the frozen lowering and the 0.52.1
  candidate already use for this check [`f258ed0:src/lower_wasm.js:1842-1862`; `263d0fa:src/lower_wasm.js:1859-1868`]. A size
  that is always negative is a phase-S `air.memory.region_bounds_static` (frozen). No case relies on a Wasm out-of-bounds trap
  [X-SND-05; M53-C01; REGION_BOUNDS_INTEGRITY.md:3-17,45-46; `263d0fa:src/verifier.js` regionSlotBytesForRange].
- R-MEM-2 (raw access; R3 restatement): a raw access of width `w` at offset `o` through a region pointer `(r, 0)` requires
  `0 ≤ o ∧ ext(r) ≥ w ∧ o ≤ ext(r) − w`, which is the frozen invariant `0 <= offset ∧ offset + w <= size` in overflow-safe form. The
  lower bound is checked first, and the subtraction happens only after `ext(r) ≥ w` holds. R2's form `base + o ≤ ext(r) − w`
  omitted `0 ≤ o` and is withdrawn: with `o = -4` on a 16-byte region it would have admitted an access below the region. The
  check is proven statically (`air.memory.region_bounds_static`) or checked at runtime (`air.memory.region_bounds_runtime`) before
  the access [REGION_BOUNDS_INTEGRITY.md:7-19; M53-C01].
- R-MEM-3 (byte-accurate derived views): every view creation computes a **byte length** with checked arithmetic and then checks
  the extent:
  - `slice.from_region p, L` with `p = (r, 0)`: `len = L` bytes; requires `0 ≤ L ≤ ext(r)`;
  - `buffer.from_ptr p` as `buffer<T,N>`: `len = checked_mul(N, sizeof(T))` bytes. Overflow is a phase-S rejection. It requires
    `len ≤ ext(r)` and a region base offset of 0. The typed-v0.53 lowering MUST place every region base at a 16-byte-aligned
    address, so element alignment holds by construction. This is a requirement, not an observation: the legacy data layout does not
    guarantee it once literals are present.
    Example: a 64-byte region with `buffer<f32,64>` needs 256 bytes and is **rejected** (V53-MEM-N15);
  - an interior sub-view `slice.sub v, o2, L2` of `v = (r, o, L)`: requires `0 ≤ o2 ≤ L` and `0 ≤ L2 ≤ L − o2` (compare, then
    subtract). The result is `(r, o + o2, L2)`. Interior views are therefore always compared against the **remaining** extent of
    their parent, never against the region start. The exact final valid byte of an interior view is reachable (`o2 = L − 1`,
    `L2 = 1`). One byte past it is not (V53-MEM-N32);
  - a Host ABI `(ptr, cap)` argument pair: `cap` is in bytes and requires `0 ≤ cap` (R3) and `cap ≤` the remaining extent of the
    passed view (`len(view)`), or `ext(r)` for a region base. A negative `cap` is rejected before the call. It never reaches the
    host as a large unsigned capacity (V53-MEM-N34).

  Each requirement, including every lower bound of R-MEM-0, is proven statically or runtime-checked before the view exists or the
  host call happens.
  - Static failures: `air.memory.region_bounds_static`.
  - Dynamic failures: `air.memory.region_bounds_runtime` (both EXISTING; the 0.52.1 candidate uses the same codes for the same
    checks).
  - Using a view or pointer whose region was freed: `air.memory.region_not_live` (PROPOSED)

  [X-SND-06; M53-C02; M53-C03; M53-C04; spec/MEMORY.md:20-21,41].
- R-MEM-4 (borrowed ranges: the frozen overlap rules, preserved exactly): two host-borrowed ranges may overlap **iff both are
  `readonly`**. Any overlap where either side is `writeonly` or `readwrite` fails closed with `air.borrow.mutable_overlap`
  (EXISTING; `borrowedOverlapAllowed`, `f258ed0:src/borrowed_slices.js:192-195`). R2 adds one rule: a host-borrowed range must not overlap
  AIR-owned memory (static data, literals, region slots) **in any access mode**, readonly included; a violation fails with
  `air.borrow.air_owned_memory_overlap`. A missing owned-range declaration fails with `air.borrow.air_memory_layout_unknown`.
  Both checks run before invocation, and both codes are CANDIDATE_0521. typed-v0.53 borrowed-lane artifacts export the AIR-owned
  range as the 0.52.1 candidate does (§2.6). A `readonly` borrowed range is never written through any alias
  [X-SND-07; M53-C05; M53-C06; BORROWED_SLICES_THREAT_MODEL.md:16-18 via X-SND-07; ARCH53 R3].
- R-MEM-4a (owned-range authority; R3 per ARCH53 R2 P2-10): for typed-v0.53, the AIR-owned range used by the R-MEM-4 checks
  comes from the **verified build record**, never from the module's own exports alone:
  - the verified builder computes `owned_range = [base, end)` from the layout it emitted (static and literal data plus every
    region slot) and records it in the build record, bound to the module digest;
  - a `wasm_memory_view` binding of a typed-v0.53 artifact requires the module digest to equal the verified build's digest.
    A mismatch fails with `air.borrow.module_identity_mismatch` (EXISTING; `f258ed0:src/borrowed_memory_binding.js`);
  - the exported globals `__air_owned_memory_base/end` must equal the recorded range. An empty range (`end == base`) while the
    record lists owned bytes, an understated range (`end` below the recorded end or `base` above the recorded base), a range with
    `end < base`, and absent exports all fail with `air.borrow.air_memory_layout_unknown` (CANDIDATE_0521) before invocation;
  - an empty range is accepted only when the record itself lists zero owned bytes.

  The exports remain a convenience for direct-export hosts. R-MEM-12 applies to those hosts unchanged. This rule is a
  typed-v0.53 rule. For the 0.52.1 candidate, the same questions (a self-declared empty or understated range; a forged range
  honoured without digest pinning, as QA52 observed) belong to H52 and OPEN-42, and V53-CR-02 keeps them dependent on that
  record (§16, VECTORS CR).
- R-MEM-5 (no hidden state through memory): `alloc_region` returns zeroed bytes, and the zeroing is charged by CT-1. Nothing persists
  across invocations; the typed runtime's fresh instance per invocation guarantees that part [X-SND-11; M53-C01; S3 doc:54-57].
  When a site allocates again (for example in the next loop iteration), it reuses its slot and zeroes it again.
- R-MEM-6 (literals): admitted literal byte data (OPEN-23) is read-only and counted in memory bounds [X-SND-11; M53-C09].
- R-MEM-7 (boundary): an exported function cannot return a `slice`. Lengths cross the boundary only as explicit pairs or through
  `borrowed_slice` on AIR ABI 0.11 [X-SND-12; spec/MEMORY.md:37].
- R-MEM-8 (units; R3 adds the lower bound): offsets and lengths are **bytes** for `ptr`, `slice`, `borrowed_slice` and Host ABI
  capacities. **Indexes** of `buffer<T,N>` and `array<T,N>` count elements. A dynamic index is checked as `0 ≤ i` and then `i < N`
  before anything else (spec/MEMORY.md: "outside 0 <= index < N"). Only then is the byte offset `i · sizeof(T)` computed, with
  checked arithmetic (R-MEM-0). The structured IO "offset", which is a field ordinal, is never a memory offset
  [spec/AIR_CORE.md:134; spec/MEMORY.md:52; M53-C11].
- R-MEM-9 (lifetime and noescape; R2): a region lives from `alloc_region` to `free_region` in **the same function activation**, and every
  path frees it [spec/AIR_CORE.md:43]. Pointers and views derived from a region, and borrowed views, are **noescape borrows**:
  - they MAY be passed as arguments to local calls and to loop callbacks (as extra by-reference arguments of an indexed fold,
    if P0-05 admits that), because the callee returns before the caller continues;
  - they MUST NOT be returned from any function, yielded out of the block that frees the region, stored into a struct, array, table,
    state or global, used as a fold accumulator, or passed to an extern except as a Host ABI `(ptr, cap)` pair for that call only;
  - only the allocating activation may free a region.

  Violations fail with `air.memory.view_escape` / `air.memory.free_not_owner` (PROPOSED). "Same-function lifetime" alone is
  not the noescape rule. This rule is.
- R-MEM-10 (host argument lifetime): a host import receiving `(ptr, cap)` may read or write only `[ptr, ptr + cap)`, and only during that
  call. It must not retain the address. Writes outside the range, or after return, are a host contract violation outside AIR's
  guarantee (R-EFF-8).
- R-MEM-11 (live peak vs backing; R2): two different quantities are defined and both are reported:
  - `region_bytes` (the WorkBound peak dimension, §11.4) **proves an upper bound on simultaneously live AIR-owned region bytes**
    in the abstract semantics;
  - `backing_bytes` is the artifact's physical reservation. In the per-site static-slot lowering it is
    `Σ over allocation sites of slot(site)` plus static and literal data, independent of liveness. Example: two sequential callees that
    each allocate 8192 bytes have a live peak of 8192 but a backing of 16384 (V53-MEM-WB02).

  R-MEM-1 requires `backing ≥` what liveness needs. `backing_bytes` is a phase-B build-admission quantity, capped by a host
  build limit (OPEN-37). A future slot-reusing lowering may reduce backing towards the live peak; that is an implementation change,
  not a semantic one.
- R-MEM-12 (borrowed↔AIR ranges are host-checked): the owned-range check of R-MEM-4 runs in the host binding. A host that calls exports
  directly, bypassing the verified runtime, must apply it itself, or the guarantee does not hold. This is a disclosed limitation,
  carried over from 0.52.1.

### 11.2 Surface (OPEN-22)

Recommended: regions with internal `ptr` only (never at an export), `slice`, `buffer<T,N>` and `borrowed_slice`,
all under R-MEM-0..13 (R3) and the accepted v0.50 borrowed contract. R3 adds the PROPOSED shape `alloc_region %n max B` for a
dynamic size with a literal maximum (R-MEM-1). They come with byte-accurate extents, noescape, the readonly
overlap rules, backing-footprint reporting and the ABI-impact classification of §17. Its canonical spelling, byte units, alignment sets,
descriptor `air.borrowed-slice-interface.v1`, digest domain, preflight order, noescape rules and `air.borrow.*` codes
are preserved [M53-C05; ADR_BORROWED_SLICES_v0_50 via M53-C05].

DEPRECATION_PROPOSED in typed: exported raw `ptr` parameters, `buffer.from_ptr` over non-region pointers, and the
`main(args: slice)` placeholder [M53-C02; M53-C03; M53-C04].

P0-08 MUST ship a typed memory specification that replaces, for typed-v0.53, the stale v0.10 statements: the
`spec/MEMORY.md` lexical-borrow text and the AIR_CORE.md:335-339 "borrowed exports do not lower" text. The legacy documents
are corrected or marked historical [X-DOC-01; M53-C01; M53-C02; M53-C05].

### 11.3 Memory and the certificate

Typed memory facts are WorkBound dimensions (§11.4) bound by R-WB-18. A typed artifact never receives the legacy
memory certificate (R-WB-24) [M53-C07].

### 11.4 Peak dimension `region_bytes` (live peak; not backing)

For function `f` (R3 makes the R2 formula the only rule, per ARCH53 R2 P2-2):

`peak(f) = L(f) ⊕ C(f)`, with

- `L(f)` = checked Σ of `max(site)` over **every** allocation site syntactically in `f`: every block, every branch of every `if`
  and `match`, each site counted once;
- `C(f)` = `max` of `peak(g)` over every distinct callee and loop callback `g` referenced in `f` (0 if there is none).

The cases the reviewer asked for:

| Case | Rule | Example (vector) |
| --- | --- | --- |
| sequence | local sites add; callees contribute their maximum once, wherever they occur in the sequence | `alloc 64; call g (peak 128); alloc 32; call h (peak 16)` → 96 + 128 = 224 (V53-MEM-WB04) |
| mutually exclusive branches | sites in both branches are summed, not maxed. This is a deliberate conservative choice: the bound never depends on which branch runs | `if {alloc 64} else {alloc 32}` → 96 (V53-MEM-WB05) |
| nested calls | recursive through `C`: a callee's peak already includes its own callees | h 16; g = 32 + 16 = 48; f = 64 + 48 = 112 (V53-MEM-WB06) |
| loops | a callback contributes its peak once, not multiplied, because its regions are freed before it returns (R-MEM-9). A fold count of 0 does not remove it | `fold g ×10` with `peak(g) = 128` → 128 (V53-MEM-WB01) |
| live peak vs cumulative allocation | `region_bytes` bounds simultaneously live bytes only. Cumulative allocated bytes (every execution of every site) are not a WorkBound dimension. They are bounded indirectly, because each execution charges `1 + ceil(B/8)` steps (CT-1), so cumulative bytes ≤ 8 · `steps` | `fold ×10` over a 64-byte allocation: `region_bytes` 64, cumulative 640, steps 162 (V53-MEM-WB08) |
| unknown | a site without a proven maximum (R-MEM-1) is `fail(unknown_bound)` | `alloc_region %n` with an unrefined `%n` and no `max` (V53-MEM-WB07) |
| overflow | `L(f) ⊕ C(f)` above WB_MAX is `fail(overflow)`. It is unreachable within the profile constants (each site ≤ REGION_MAX = 2^24), but it is still checked | — |

The R-WB-6 branch `max` and the CT-1 loop rows apply to the additive dimensions only. The ordering against the other dimensions
is R-WB-2f step 2. The value bounds *live* bytes (R-MEM-11). Physical `backing_bytes` is reported separately and is not a
WorkBound dimension [spec/AIR_CORE.md:43; X-SND-05]. A tighter rule (for example a branch `max`) would be a reviewed CT
amendment under R-WB-26 with its own vectors. It is not proposed for v0.53.

### 11.5 Deferred

The realtime-safe execution session and its typed projection are DEFERRED_V054 (session lifecycle; OPEN-34) [M53-C08; M53-E15].
Async buffer lifetimes are DEFERRED_V054 [M53-D15].

## 12. Imports, package composition, transitive identity (P0-09)

- R-IMP-1 (one composition semantics): every module in a typed import closure is parsed and verified in its own profile.
  Its declarations, demands, capabilities and contracts are preserved; nothing is dropped by flattening. The closure is then
  lowered as one Wasm module (static linking; OPEN-25). There is no runtime linking [X-AUTH-02; M53-D02; M53-D04].
- R-IMP-2 (containment): import paths are package-relative, with no `../` escape and no absolute path; violations fail with
  `air.import.path_uncontained` (PROPOSED). Import cycles are rejected [X-AUTH-02; M53-D02; M53-D03].
- R-IMP-3 (no authority through imports): importing never grants a capability. A module's capability must be declared by that
  module, and the package manifest must declare the union [M53-D02; M53-D03; spec/AIR_PACKAGE_MANIFEST.md:632-660 via M53-D03].
  A module whose entries reach an effect of family `X` transitively, through an imported call, MUST itself declare capability `X`
  and the corresponding `demand` key. Authority is never hidden behind an import edge
  (`air.capability.required_missing`, `air.effect.demand_missing`).
  `use utility.*` / `use math.fixed` bundles are DEPRECATION_PROPOSED in typed and rejected with `air.import.bundle_unsupported` (PROPOSED)
  [X-AUTH-01; M53-D01].
- R-IMP-4 (composition): cross-module calls compose by R-WB-10, which closes the per-module-only undercount [X-SND-03; M53-D03].
- R-IMP-5 (transitive identity): module identity is domain-separated over profile, body digest (R-WB-18) and the sorted dependency identities.
  Identities are body-sensitive: they cover bytes, not only signatures. Stdlib content, if ever admitted, is bound by content digest
  [X-AUTH-03; M53-D04; M53-D05; M53-D06]. The legacy `sourceGraphHash` and `.airpkg` fingerprint are not reused for typed identity [M53-D04; M53-D05].
- Cross-profile imports: OPEN-27. The recommendation is that a typed-v0.53 module imports only typed-v0.53 modules.
  Typed stdlib: OPEN-26, recommended none in v0.53 [R09; M53-D06].
- `.airpkg` remains optional transport with no authority (PRESERVE) [M53-D05; v0.51 freeze:33-37]. The legacy
  global-dependency report helper is unchanged; for typed ASTs it falls under the R-ASSUR-1 floor [M53-D07].

## 13. Typed host effect-demand declarations and the host grant boundary (P0-10)

SCOPE-1 keeps P0-10 **declarations** in v0.53. Runtime demand-versus-grant mediation is v0.54 (G54-EFFECT).

- R-EFF-1 (typed externs): `extern module.fn(params) -> T` is admitted only for signatures in the existing Host ABI 0.10/0.11
  registry. Names stay capability-qualified and the strict-module rules apply. **No new host import** is added
  [v0.51 freeze:44; M53-D09; M53-C10; M53-D12]. The exact allowlist is OPEN-29. The recommendation is scalar-only signatures,
  `output.emit` included; memory-carrying imports only after P0-08 under R-MEM-3; async imports and `print` not admitted.
  Call shape (PROPOSED, same as R-CALL-1): `%r: T = call @module.fn(…)`, or `call @module.fn(…)` for `void`.
  An unknown import fails with `air.extern.unsupported` and a mismatched signature with `air.extern.signature_mismatch`
  (both PROPOSED). An extern whose capability is not declared fails with `air.capability.required_missing` (PROPOSED).
- R-EFF-2 (demand declaration, PROPOSED shape): `demand { output.emit <= 4, debug.metric <= 1 }` at module level.
  For every export `e` and every key `k`, the verifier proves `E(e).effects[k] ≤ declared(k)`.
- R-EFF-3 (completeness and kind): every extern key used MUST appear in `demand`. A missing key fails with
  `air.effect.demand_missing`; an exceeded one with `air.effect.demand_exceeded` (both PROPOSED).
  Only Host ABI import keys are valid. A work key (`cpu.*`, `memory.*`) or an unknown key fails with
  `air.effect.demand_key_invalid` (PROPOSED). Unknown keys are never satisfied vacuously [X-WORK-03; M53-D10; M53-E14].
- R-EFF-4: the legacy `effects {}` block, which mixes host-call counts, work counts and lower bounds, is not admitted in
  typed (DEPRECATION_PROPOSED for typed). Migration splits it into `demand` (host keys) and WorkBound
  assertions (OPEN-13) [X-WORK-03; M53-D10; M53-E14].
- R-EFF-5 (**EffectDemand != HostGrant**): a demand declaration is an artifact claim, an upper bound on host-call multiplicity.
  It is never a grant, never satisfies `required_capabilities`, and is never an input to `deriveEffectiveAuthority`.
  Grants come only from host-supplied `CapabilityGrant` records, unchanged. Checking demand against grants at runtime is
  v0.54 (G54-EFFECT) [R15; M53-D16; v0.51 freeze:167-180].
- R-EFF-6 (capabilities): typed `capabilities {}` gates externs as in legacy and is declaration metadata. The source
  names (`fs`, `io`, …) are not mapped to `air.capability.*` in Core (OPEN-28). The typed-v0.51 acceptance of
  `capabilities {}` before `module` is kept and normalized by the formatter [M53-D08; X-AUTH-04; freeze:170-173].
- R-EFF-7: async request handles, `io.*` polling and async buffer lifetimes are DEFERRED_V054. The v0.51 host contract says the host owns asynchronous work
  [M53-D14; M53-D15; X-SND-10]. The legacy v0.49 run-facade grant model is OUT_OF_CORE_PROPOSED and DEPRECATION_PROPOSED [X-AUTH-05; M53-D13].
- Host profiles stay descriptive and grant nothing (PRESERVE) [M53-D11]. The v0.52 runtime admission boundary is unchanged
  (PRESERVE) [M53-D17].

### 13.1 Minimum host-import safety (R2; ARCH53 R6)

These are the minimum obligations of any v0.53 reference adapter that executes a typed-v0.53 artifact with imports. They are not
the v0.54 mediation product: there is no demand-versus-grant checking, no receipts and no fencing (SCOPE-1, G54-EFFECT).

- R-EFF-8 (declaration ≠ handler; no default authority):
  - An `extern` declaration is a typed requirement on the host. It is not a binding.
  - The adapter binds each declared import only to a handler that the host supplies **explicitly** for that exact import name. A
    missing handler fails instantiation with `air.host.binding_missing` (PROPOSED) before any evaluation.
  - There is no default import object. There is no implicit binding to a real native, OS, file, network or clock facility, and no
    fallback stub. The legacy convenience import factories (for example `createUtilityImports`, `createIoImports`) are not used for
    typed-v0.53 artifacts.
- R-EFF-9 (demand ≠ grant; count ≠ actions): `demand` bounds the number of AIR→host calls per key (R-EFF-2). It is not a grant
  (R-EFF-5). It also does not bound what a handler does inside one call: one `output.emit` call may cause any amount of host work.
- R-EFF-10 (no termination claim for handlers): WorkBound bounds AIR-side steps and the number of host calls. It cannot guarantee
  that a host handler returns. Handler termination, and any timeout, are host operational responsibilities (§6.1 "Timeout").
- R-EFF-11 (no mutable-instance reentrancy): while an export invocation is in progress, a handler MUST NOT invoke any export of the
  same instance. The adapter enforces this with an in-call guard. Reentry fails with `air.host.reentrancy_forbidden` (PROPOSED), and
  the outer invocation fails. R-MEM-1's per-site slot soundness depends on this rule.
- R-EFF-12 (errors and no rollback):
  - A handler that throws or rejects fails the invocation with `air.host.import_failed` (PROPOSED). Evaluation does not continue
    after it.
  - Host calls already made, and their external effects, are **not** rolled back by any AIR failure. That covers a handler failure,
    a later runtime failure, and a loop rejected under R-LOOP-2. A fresh instance per invocation discards only AIR-owned memory;
    it is not a transaction.
  - Hosts that need atomicity must provide it host-side (v0.54 receipts and fencing are the planned mechanism).
- R-EFF-13 (no result-type bypass):
  - The adapter validates every handler return value against the declared result type **before** it reaches Wasm: `i32` must be
    an integer in [−2^31, 2^31−1]; `bool` must be 0 or 1; `void` must return no value.
  - The JS-API implicit coercion of import results (for example ToInt32 wrapping 2^40 to 0) MUST NOT be relied on. An invalid
    value fails the invocation with `air.host.result_invalid` (PROPOSED).
  - R3 (ARCH53 R2 P2-9): the registry also has `i64` results (`time.now_ms`, `time.monotonic_ms`) and `f32` results
    (`random.f32`, `ui.input_f32`, `input.axis`, `input.pointer_delta_x/y`, `input.touch_axis`) [`f258ed0:src/host_abi.js:13-16,32,63-68`].
    They are validated just as strictly. The JS-API conversions ToBigInt64 (wraps modulo 2^64) and ToFloat32 (rounds) MUST NOT
    be relied on:
    - `i64`: the value MUST be a JS BigInt (`typeof === "bigint"`) in [−2^63, 2^63−1]. A Number, a string, a boolean, or a BigInt
      outside that range fails with `air.host.result_invalid`. It is not wrapped and not converted (V53-EFF-N15);
    - `f32`: the value MUST be a JS Number that is exactly representable in binary32, that is `Math.fround(v)` is identical to `v`,
      or `v` is NaN. ±∞ and −0 are representable and keep their bits. A non-Number, or a Number that binary32 cannot represent
      exactly (for example `0.1`, or `1e39`, which would round to ∞), fails with `air.host.result_invalid`. It is not rounded
      (V53-EFF-N16);
    - an `f32` NaN result is accepted as a NaN. Its bits are canonicalized at the boundary under OPEN-41 (a) (recommended), or
      the channel is excluded from the determinism claim under OPEN-41 (b). Until OPEN-41 is decided, no bit-level claim is made
      for an `f32` host result that is NaN (R-F32-1);
    - `f64` has no registry result today. If one is ever admitted, the `f32` rule applies with binary64 and no rounding check.
  - f32 arguments follow R-F32-1 / OPEN-41.

[M53-D09; M53-D12; M53-D16; R15; SCOPE-1; ARCH53 R6.]

## 14. Migration, equivalence, LEGACY_DEFECT handling, rollback (P0-11)

### 14.1 Deterministic migration function

`M(legacy source) → MIGRATED(typed-v0.53 canonical source, class, record) | REJECTED(code, construct, location)`.
`M` is deterministic: the same input gives the same output bytes. Its output is formatter-canonical in typed-v0.53. It never
rewrites silently, and every changed construct appears in the record [V052_SOURCE_PROFILE_CLOSURE.md:76-78; M53-A17; M53-A20].

### 14.2 Equivalence classes

| Class | Meaning |
| --- | --- |
| `EXACT` | same observable results and failures on all inputs |
| `EXACT_ON_SUCCESS` | same results on every input where legacy succeeds; where legacy fails with a raw trap, typed fails with a stable AIR identity |
| `LEGACY_DEFECT_CORRECTED` | inputs that exercise a ledger LEGACY_DEFECT now get the normative result or fail closed; the record lists each affected construct and X-id |
| `REJECTED_UNSUPPORTED` | the construct is not admitted in typed-v0.53; `air.migration.unsupported_construct` (PROPOSED) with the construct name |

### 14.3 Oracle rule (HD-1)

Expected migration results are computed from the semantics of this RFC by an **independent reference** (exact arithmetic).
Legacy execution is used only as a differential witness on inputs **outside** LEGACY_DEFECT domains. A disagreement there is a
migration defect or an undocumented legacy defect to triage. It is never accepted from legacy automatically [HD-1; M53-A01; X-CONF-02].
From H52 on, the legacy differential witness is the legacy implementation at H52_BASELINE. Inputs inside a class-3 repair
domain (§2.5, §2.6) are inside a LEGACY_DEFECT domain, so the pre-repair 0.52.0 result is never used as a witness for them.

### 14.4 LEGACY_DEFECT dispositions

| Ledger | typed-v0.53 guarantee | Migration class |
| --- | --- | --- |
| X-SND-01 | loops charged exactly; phi not admitted | counter-shape phi → `loop.fold` (`EXACT_ON_SUCCESS`); other shapes → `REJECTED_UNSUPPORTED` |
| X-SND-02 | exact domain (§6.2) | not a source construct |
| X-SND-03 | cross-module composition | demands recomputed (`LEGACY_DEFECT_CORRECTED`) |
| X-SND-04 | no legacy certificate for a typed AST | n/a |
| X-SND-05/06/07 | R-MEM-1/3/4 | aliasing, use-after-free and over-length views → `LEGACY_DEFECT_CORRECTED` or rejected |
| X-SND-08 | exact literals | the literal is kept exactly as written; the value change is recorded (`LEGACY_DEFECT_CORRECTED`) |
| X-SND-09 | R-REF-3/8 | inert checked relations and unchecked refined exports become entry-checked (`LEGACY_DEFECT_CORRECTED`) |
| X-SND-10 | async not admitted | `REJECTED_UNSUPPORTED` (v0.54) |
| X-SND-11 | R-MEM-5/6 | `LEGACY_DEFECT_CORRECTED` |
| X-SND-12 | R-MEM-7 | `REJECTED_UNSUPPORTED` |

Further mapping rules:

- legacy `i32.add/sub/mul` (and the aliases) → `i32.wrapping_*`: `EXACT`;
- `i32.div_s/rem_s` → `i32.checked_*`: `EXACT_ON_SUCCESS`;
- bundles → explicit `capabilities` plus the externs actually used. The import set narrows, which is an X-AUTH-01 correction (`LEGACY_DEFECT_CORRECTED`);
- legacy persistence → `REJECTED_UNSUPPORTED` (v0.54);
- `f32.clamp`, `f32.lerp`, `f32.inverse_lerp`, `ease.smoothstep`, `ease.out_quad` → the exact admitted-op sequence of their baseline
  lowering, in the same operation order (`EXACT`; R2, §5.3);
- `f32.sin`, `f32.cos` (approximations) → `REJECTED_UNSUPPORTED`;
- `f32.sqrt` → `REJECTED_UNSUPPORTED` unless OPEN-40 admits it;
- an unrepresentable module id → `REJECTED_UNSUPPORTED`, unless an explicit mapping is supplied.

### 14.5 Differential corpus and regression

The corpus grows with every slice (P0-11 runs in parallel). It includes:

- the frozen typed-v0.51 matrix, run by name;
- the legacy suites, unchanged;
- the v0.52 public-reality gate;
- every V53 vector of the admitted slices.

Expected values are never regenerated from the implementation [X-CONF-01; FIRST_IMPLEMENTATION_WORKBOUND "Forbidden mutation"].

### 14.6 Rollback

typed-v0.53 is opt-in and candidate-gated (§2.3). Rollback means:

- commit-level reversal of the owning slice, or disabling the profile (kill switch `disable_typed_v053_profile`, PROPOSED, after
  which selection fails with `air.source_profile.unsupported`);
- legacy-v0.50 and typed-v0.51 acceptance, formatter output and codes are unaffected;
- no historical digest or evidence is rewritten [docs/v0.51/ROLLBACK_AND_KILL_CRITERIA.md:11-32].

A correction record (§2.5) is rolled back only by a new correction record.

## 15. Diagnostics, formatter, LSP, assurance tools (every slice; P0-11/P0-12 gates)

HD-4: "Every semantic slice owns its formatter/diagnostic/LSP/assurance obligations."

- R-DIAG-1: every typed-v0.53 rejection and runtime failure carries a registered stable code, written with the `code:` delimiter so that
  `.code` is set, and a source location when known. There is no raw stack, `TypeError` or WABT text [X-CONF-03; M53-A19; v0.51 RFC:446-447].
- R-DIAG-2 (registry): one registry lists every code typed-v0.53 emits. The allowed domains are extended to the ones actually used
  [A-DIAG-01 in M53-A19]. A code's meaning never drifts; messages may change [docs/rfcs/v0.15-diagnostic-code-registry.md:42-43 via M53-A19].
  Naming policy: OPEN-2. The recommendation keeps existing codes byte-for-byte where the meaning is identical, uses
  profile-neutral domains for new rules, and never introduces `air.v053.*`.
- PROPOSED new codes:
  - work: `air.workbound.*` (§6.6);
  - scalars, refinements, calls, control: `air.numeric.operation_mode_required`,
    `air.refinement.ingress_out_of_range|base_type_unsupported`, `air.call.result_unbound|unknown_function`,
    `air.control.unstructured_unsupported|yield_missing`;
  - loops and aggregates: `air.loop.count_out_of_range|form_unsupported`, `air.table.index_out_of_range|readonly`,
    `air.array.index_out_of_range`, `air.const.initializer_invalid`;
  - memory and boundary: `air.memory.region_not_live|readonly_data|view_escape|free_not_owner`,
    `air.abi.export_type_unsupported|slice_return_unsupported`. R2 drops the R1 proposals `air.memory.region_capacity_exceeded`,
    `air.memory.view_exceeds_region` and `air.borrow.alias_air_owned` in favour of codes that already exist with the same meaning:
    `air.memory.region_bounds_static|region_bounds_runtime` (EXISTING), and `air.memory.region_size_unsupported`,
    `air.borrow.air_owned_memory_overlap`, `air.borrow.air_memory_layout_unknown` (CANDIDATE_0521; final after H52);
  - imports and effects: `air.import.path_uncontained|bundle_unsupported|profile_mismatch|cycle|stdlib_unsupported`,
    `air.effect.demand_missing|demand_exceeded|demand_key_invalid`, `air.extern.unsupported|signature_mismatch`,
    `air.capability.required_missing`, `air.host.binding_missing|import_failed|result_invalid|reentrancy_forbidden` (R2);
  - runtime failure transport: `air.runtime.trap_unclassified|failure_reason_unknown` (R2; R-REF-9);
  - ingress in-module checks (R3; R-REF-9 values 49/50): `air.decision.payload_tag_invalid|bool_lane_invalid`;
  - build and environment (R2; §3.4): `air.build.memory_backing_limit|engine_limit`, `air.environment.unavailable`;
  - analysis capacity (R3; R-WB-15c): `air.analysis.capacity_exceeded` (disposition `ANALYSIS_REFUSED`, not a language rejection);
  - work: `air.workbound.cost_undefined` (R2; R3 reclassified as an IMPLEMENTATION_DEFECT code, R-WB-26).
    R3 withdraws `air.workbound.analysis_limit_exceeded`;
  - profile, migration, assurance: `air.source_profile.candidate_disabled|ast_mismatch`, `air.migration.unsupported_construct`,
    `air.assurance.profile_unsupported`.

  Existing codes are reused where the meaning is identical (OPEN-2). An example is `air.v051.typed_syntax_invalid` for an
  unsupported typed declaration such as `print`, `tablegroup`, `pool` or legacy contract lines.
- R-FMT-1 (formatter): one canonical, idempotent formatter per profile is part of the profile contract [spec/AIR_CORE.md:44-45; M53-A17].
  Every V53 ACCEPT vector is canonical. Integer-spelled floats format as `N.0` and `-0.0` is preserved [v0.51 RFC:110-112].
  Trailing newline, function order and type qualification are OPEN-3; the recommendation is exactly one trailing LF and otherwise the
  typed-v0.51 rules [X-CONF-04].
- R-LSP-1: `airc check` and the LSP accept `--source-profile typed-v0.53`, report typed codes (not `air.parser.syntax`), preserve
  `err.code`, use the bounded 4 MiB file reader, and format through the profile's formatter [X-CONF-05; X-BND-03; M53-A18].
- R-ASSUR-1 (floor; no silent PASS): from SCALAR on, every SDK and CLI assurance entrypoint given a typed-v0.53 AST either
  supports the profile or returns `air.assurance.profile_unsupported` (PROPOSED). The CLI keeps
  `air.source_profile.command_unsupported`. Never a silent PASS, a vacuous `verified`, `not_enabled`, a `TypeError` or a raw parse error
  [X-PROF-05; M53-E01..E04; HD-4]. This covers the certificate (R-WB-24), ai_review, audit/explain, provenance,
  semantic patch, WIT, and the realtime-safe admission/session entrypoints (`assertRealtimeSafeProfile`,
  `createVerifiedExecutionSession`; DEFERRED_V054 for typed) [M53-C08; M53-E15]. Parity beyond the floor is OPEN-30.
- R-ASSUR-2 (per-slice table): each slice's evidence lists, for formatter, diagnostics, LSP, certificate, provenance,
  semantic patch, audit/explain, ai_review and WIT, one state from {SUPPORTED, UNSUPPORTED_FAIL_CLOSED}. P0-12 checks the table
  against the installed package [HD-4; M53-A18].
- R-NEG-1: each slice ships its typed negative corpus, including hallucination-shaped inputs, with stable codes. P0-12 aggregates it [M53-E05].

## 16. Conformance vector catalogue

`VECTORS.md` holds the full catalogue. Its sections are:

- PROF (profile identity);
- SCL (scalar);
- WB (WorkBound algebra, identity, hostile and regression);
- REF, CALL/CFG, LOOP, AGG/STATE, MEM, IMP, EFF;
- MIG (migration);
- DIAG/FMT/LSP/ASSUR/NEG (cross-cutting);
- PUB (installed package);
- SEP (separations).

R2 adds the dispositions `INTAKE_REFUSED`, `BUILD_REFUSED` and `ENVIRONMENT_UNAVAILABLE` (§3.4), the code tag `CANDIDATE_0521`,
and the sections PIPE (pipeline phases) and HOST (host-import minimum safety, under EFF).

R3 adds:

- the dispositions `ANALYSIS_REFUSED` and `IMPLEMENTATION_DEFECT` (§3.4);
- the section ANA (analysis capacity, R-WB-15c);
- a **vector kind** for every vector, separating executable AIR source conformance from model and process checks (ARCH53 R2
  P2-7):
  - `SOURCE`: executable source → verify → lower → run;
  - `MODEL`: algebra or model harness, no source syntax;
  - `BINDING`: host binding or adapter;
  - `PROPERTY`: a property over a corpus;
  - `REGRESSION`: an existing corpus keeps its disposition;
  - `PROCESS`: a review or record check;
  - `CHARACTERIZATION`: observed behaviour of unaccepted bytes, never an oracle;
  - `COMPOSITE`: a named group of other vectors; it passes only when every part passes at its own executable slice;
- an **owning slice** and a **first executable slice** for every vector, in the machine-readable `VECTOR_INDEX.json`.

A vector whose first executable slice is later than its owning slice is **deferred**. It is listed in VECTORS.md §DEFERRED,
never marked PASS before it runs, and never silently skipped (PF-1 recommended default; §18.5).

Every vector states its ID, its slice (through the section it belongs to), intent, exact input, expected disposition, expected value or code class, and the
**provenance** of the expected value: an RFC rule, a frozen v0.51 vector, a ledger counterexample, or independent exact arithmetic.
Where an expected value depends on an OPEN item, the vector shows the recommended branch and names the OPEN id.

Additional rules:

- Raw-WAT checks never replace source → verifier → lowerer → Wasm checks for a promised source feature [X-CONF-02].
- The P0-00 counterexamples stay fixed negative regression cases [assessment Q13; X-SND-*; X-BND-*].

## 17. ABI / Host ABI / Host Contract impact classification

| Slice | AIR ABI | Host ABI | Host Contract | Notes |
| --- | --- | --- | --- | --- |
| P0-02 WorkBound | NONE | NONE | NONE | internal summaries; no public record (OPEN-31) [M53-E18; M53-E19] |
| SCALAR | NONE | NONE | NONE | exports use existing descriptor scalars; failure transport reused (R-SCL-3) [M53-A08] |
| P0-03 refinements | Descriptor grammar and signatures unchanged (`desc(i32<a..b>) = i32`), **but `ADAPTER_CONTRACT_CHANGE`** (R2, R-REF-11): an extended failure-reason registry or export (OPEN-38) and a new build-record schema carrying refinement metadata. R3 (R-REF-12): an old adapter degrades every non-numeric typed-v0.53 failure to the generic `air.v052.invocation_runtime_failure` and never to a wrong specific code. AIR cannot make shipped adapters reject new artifacts. What is enforceable is the candidate gate, the build binding and the new adapter's fail-closed mapping. | NONE | failure identities `air.refinement.ingress_out_of_range` / `assignment_out_of_range` are host-visible, like `air.numeric.checked_failure` | [M53-A13; M53-C14; M53-E19; ARCH53 R4; ARCH53 R2 P2-8] |
| P0-04 calls/CFG | NONE | NONE | NONE | the internal call convention is not observable [M53-B01] |
| P0-05 loops | NONE | NONE | NONE | |
| P0-06 aggregates/tables | NONE: internal non-exported memory only | NONE | NONE | exporting memory would be AIR_ABI_CANDIDATE [VERSION_AND_ABI_POLICY.md:108-116] |
| P0-07 constants/state | NONE (invocation-scoped) | NONE | NONE | persistence (v0.54) would be AIR_ABI/HC candidate [M53-B21] |
| P0-08 memory | **AIR_ABI_CANDIDATE (review required)**. The region allocation representation and backing layout change for typed artifacts; typed borrowed-lane artifacts export the AIR-owned range (the same additive artifact-contract amendment as 0.52.1, §2.6); 16-byte-aligned region bases. Legacy 0.10 and borrowed 0.11 lanes are not reinterpreted. R3: the owned range is bound to the verified build record (R-MEM-4a), and P0-08 starts only after D-SCOPE-01 is recorded. | `(ptr,cap)` semantics strengthened (R-MEM-3, R-MEM-10); signatures unchanged | NONE | [VERSION_AND_ABI_POLICY.md:108-116; X-SND-05; M53-C01; M53-C05] |
| P0-09 imports | NONE (static link) | NONE | NONE: no new `PackageIdentityV1` domain (R09) | [M53-D03; M53-D04] |
| P0-10 effect demand and host-import minimum safety | NONE | Reuse of the 0.10/0.11 lanes; **no new import**. The adapter binding contract (R-EFF-8..13) is new: explicit handlers, result validation (R3: `i64` and `f32` included), reentrancy guard. | NONE: demand is not a Host Contract record | [v0.51 freeze:44; R15; M53-D09; M53-C10; ARCH53 R6] |
| (0.52.1, outside the slices) owned-range exports, slot layout | provisional R2 text, unchanged: additive AIR ABI 0.11 artifact-contract amendment plus a memory-layout change; lane bump undecided (OPEN-42) | provisional: none | none | §2.6. R3: candidate REVIEWED_BUT_NOT_ACCEPTED / QA52_REQUEST_CHANGES. No classification is chosen here; OPEN-42 is decided at H52 on accepted bytes |
| P0-11 / P0-12 / P0-13 | NONE | NONE | NONE | |

`typed-v0.53` itself is a source-grammar selector, not an ABI lane [M53-A20].

## 18. Slice plan

### 18.1 Order and dependencies

```text
ARCH53 PASS (on R3) + H53-P0-RFC + H52_BASELINE as decided under OPEN-39 + WorkBound activation prerequisites 1-5
  (OPEN-39 recommended (a), a PROPOSED_R0_AMENDMENT until the owner adopts it: QA52 = PASS_FOR_HUMAN_GATE on exact
   identities + H52 acceptance of those exact bytes; npm publication, tags and dist-tags are separate release actions)
  → P0-02 WorkBound foundation ......... QA: FULL independent
  → SCALAR (HD-4) ....................... QA: exact-SHA, different contour
  → P0-03 refinements / checked ingress . exact-SHA
  → P0-04 calls / CFG / call graph ....... exact-SHA
  → P0-05 bounded loops .................. exact-SHA
  → P0-06 tables / fixed aggregates ...... exact-SHA
  → P0-07 constants / state primitives ... exact-SHA
  → P0-08 regions / slices / borrowed .... FULL independent
  → P0-09 imports / package composition .. FULL independent
  → P0-10 typed effect-demand declarations FULL independent
  P0-11 migration + differential corpus: grows with every slice
  P0-12 installed-public-package gate
  P0-13 whole-P0 independent QA → H53-RELEASE
```

[PROGRAM_DAG.md; R0 §2 "Execution"; HD-4.] The implementer never self-PASSes a semantic slice. Semantic WIP is 1 (R0 §2).

### 18.2 Per-slice scope and acceptance

R3 (ARCH53 R2 P2-6, P2-7): "Acceptance" lists the vectors a slice **owns**. A vector marked *(deferred → Pn)* cannot run in its
owning slice because a construct it needs arrives later. It is executed and must PASS at the first slice where all its constructs
exist (Pn), never earlier and never by substitution. `VECTOR_INDEX.json` holds the owning and first executable slice of every
vector, and VECTORS.md §DEFERRED lists the deferred set.

| Slice | Owns (rows) | Acceptance (all vectors of the slice PASS, plus the regressions) |
| --- | --- | --- |
| P0-02 | M53-E08, E10 (no analysis term in WorkBound), E11, E12, E14, E17, E18, B12 (algebra), D03 (algebra part) | V53-WB-P01..P14, N01..N20, ID-01..07, H02, H04 (identity part; the composite is *deferred → SCALAR*, part (b) = V53-ASSUR-01; R3.1), H05, H06, H09, H10 (typed-v0.51 paths; the typed-v0.53 part is *deferred → SCALAR*; R3.1), REG-01..03, V53-PIPE-01..02 (R3: PIPE-02 uses typed-v0.51 input), V53-ANA-07. Terminal flags as in FIRST_IMPLEMENTATION_WORKBOUND, including `SECOND_COST_MODEL_CREATED=false` (§6.1). |
| SCALAR | A02, A07, A10, B03, A20 (profile id and gate), A01 (literals), E10 (R3: the typed-v0.53 analysis-capacity guard), the R-ASSUR-1 floor for typed-v0.53 ASTs (E01-E04, C08/E15 entrypoints), CR-53-01/02 if admitted | V53-PROF-*, V53-SCL-*, V53-ASSUR-01..08, V53-DIAG-01/02, V53-FMT-01..03, V53-LSP-01..03 for the new operations, V53-ANA-01..03, V53-ANA-06, V53-PIPE-06, and the SCALAR parts of V53-WB-H04 and V53-WB-H10, which complete those deferred composites (R3.1) |
| P0-03 | A12, A13, A15, A14 (via OPEN-12), C14 (source/descriptor decoupling) | V53-REF-*, of which REF-P05 and REF-N10 *(deferred → P0-04: calls)* |
| P0-04 | A03, B01, B02, B10 (deprecation in typed) | V53-CALL-*, V53-CFG-*, of which CFG-P02 *(deferred → P0-10: extern)*; V53-ANA-04, V53-ANA-05, V53-ANA-08 (R3) |
| P0-05 | B04, B05, B06, B07, B11, B12 (source part) | V53-LOOP-*, of which LOOP-P05 *(deferred → P0-10: extern)*; V53-WB-H01 (source part; part (b) *deferred → P0-10*) |
| P0-06 | B13, B14, B15, B16, B17, B18 (preserve) | V53-AGG-* (R3 adds AGG-WB02..WB04, AGG-N09), V53-WB-H07 |
| P0-07 | B19, B20, B21, B22, B23, B24 | V53-STATE-*, V53-SEP-CACHE-01 |
| P0-08 | C01-C07, C09; C08 deferred | V53-MEM-* (R3 adds the R-MEM-0 domain vectors, the region_bytes vectors and the owned-range vectors), of which MEM-N06 and MEM-N34 *(deferred → P0-10: memory-carrying import)*; V53-PIPE-03, V53-PIPE-05. Starts only after decision D-SCOPE-01 (ABI 0.12 non-promotion, R-TYPE-3) is recorded |
| P0-09 | D01-D07 | V53-IMP-*, of which IMP-P01, IMP-N01, IMP-N05 and IMP-ID-01 *(deferred → P0-10: extern)*; V53-WB-H03 *(deferred → P0-10)*; V53-PIPE-04 |
| P0-10 | C10, C13, D08-D17, B08, B09 | V53-EFF-* (including the HOST vectors V53-EFF-N11..N16), V53-LOOP-N10, V53-WB-H08, V53-SEP-ED-01, and every vector deferred to P0-10 above |
| P0-11 | A01, A09, A11, A17, A19, A20 (docs), migration rules for all rows | V53-MIG-*, the differential corpus |
| P0-12 | A18, C13 (claim check), E01-E05 (aggregated), E09, E13, E19, PUB | V53-PUB-*, V53-NEG-CORPUS-01, the R-ASSUR-2 table |
| P0-13 | all rows | whole-P0 independent QA; every row of TRACEABILITY_95.json closed, deprecated or deferred by the human record |

### 18.3 The ten former UNOWNED_GAP rows (HD-4)

The assessment's owner map is input only [R0 §3].

| Row | Owner | Disposition |
| --- | --- | --- |
| M53-A02 scalar ops | SCALAR | IMPLEMENT_IN_SLICE |
| M53-A10 f32/f64 boundary, legacy f32 math | SCALAR; P0-11 (exact macro expansion of clamp/lerp/inverse_lerp/ease; rejection of sin/cos) | IMPLEMENT_IN_SLICE (the legacy helpers are DEPRECATION_PROPOSED in typed with the per-op rationale of §5.3; `f32.sqrt` is OPEN-40) |
| M53-A11 fixed-point/physics helpers | P0-11 (record) | OUT_OF_CORE_PROPOSED |
| M53-A18 LSP / `airc check` | every slice; P0-12 gate | IMPLEMENT_IN_SLICE |
| M53-C13 WIT | P0-10 (claim), P0-12 (check) | OPEN-24 (recommended OUT_OF_CORE_PROPOSED for typed) |
| M53-E01 provenance | SCALAR (floor), P0-12 | UNSUPPORTED_FAIL_CLOSED (parity OPEN-30) |
| M53-E02 semantic patch | SCALAR (floor), P0-11, P0-12 | UNSUPPORTED_FAIL_CLOSED (parity OPEN-30) |
| M53-E03 ai_review | SCALAR (floor), P0-12 | OUT_OF_CORE_PROPOSED |
| M53-E04 audit/explain | SCALAR (floor), P0-12 | UNSUPPORTED_FAIL_CLOSED (WorkBound-based parity OPEN-30) |
| M53-E05 negative/hallucination corpus | every slice; P0-12 | IMPLEMENT_IN_SLICE |

### 18.4 Exit-gate mapping

| Gate | Satisfied by |
| --- | --- |
| G53-LANG | every row in TRACEABILITY_95.json implemented (P0-02..P0-10), preserved, or closed by a human-accepted deprecation, unsupported, out-of-core or v0.54 deferral record. H53-P0-RFC accepts or amends the proposals. R3 uses two flags. A row whose closure or in-row proposal needs an owner decision carries `HUMAN_DECISION_REQUIRED=true`. A row whose final disposition or exact scope holds only under an OPEN recommendation carries a non-empty `H53_DECISION_DEPENDENCY` listing those OPEN items. A row counts as closed only when every decision it lists is recorded. `H53_DECISION_SURFACE.md` lists all of them. P0-13 verifies. |
| G53-WORK | §6, composed through P0-04 (calls), P0-05 (loops), P0-09 (imports) and P0-10 (effects); V53-WB-*, V53-LOOP-*, V53-IMP-P01, V53-WB-H03 |
| G53-PUBLIC | P0-12 (exact tarball, fresh install, full conformance/negative corpus) plus P0-13 independent exact-SHA QA |
| G54-SWIFT/STATE/TIME/REPLAY/EFFECT/EVIDENCE/FENCE/LIFECYCLE/PUBLIC | out of scope, v0.54 (SCOPE-1); listed as DEFERRED_V054 rows: M53-B20/B21/B23 (if OPEN-20 so decides), C08, D14, D15, E15 |

### 18.5 Planning recommendations PF-1 and PF-2 (R3; not gates, not semantics)

Two planning choices came up while the slice cards were prepared. ARCH53 R2 §10 found both compatible with the RFC. They stay
**recommendations for the owner**. Nothing in R3 depends on them semantically, and R3 records neither as a decision.

- **PF-1 (where later-construct vectors run). Recommended default:**
  - P0-09 stays before P0-10; the DAG order is unchanged;
  - a frozen vector executes at the first slice where all its constructs exist (`VECTOR_INDEX.json`, VECTORS.md §DEFERRED). It
    is never marked PASS earlier and never silently skipped;
  - no mock extern is an authority for early effect semantics. Cross-module effect multiplicity (X-SND-03) is therefore first
    executed at P0-10, and the P0-09 full QA records IMP-P01 and WB-H03 as deferred, not as passed;
  - an extern-free P0-09 composition fixture may be added only as a separately reviewed new vector with independently derived
    values. It never replaces a frozen vector.
- **PF-2 (per-slice public projection). Recommended default:** each semantic slice gets an air-core candidate projection, and dev
  and public `npm test` and parity run on it (consistent with V53-WB-REG-03). That implies no merge, tag or publication. The
  alternative, projecting only at P0-12, would require amending V53-WB-REG-03.

## 19. Required separations

| Separation | Rule | Vectors |
| --- | --- | --- |
| **WorkBound != Budget != timeout** | §6.1, §6.7, R-WB-22: WorkBound is a verifier-derived bound; Budget is host authority (frozen); a timeout is a host clock control. No record carries one as the other, and no derivation reads another | V53-WB-H05, V53-SEP-WB-01, V53-SEP-WB-02 |
| **EffectDemand != HostGrant** | R-EFF-5: a demand is an artifact claim, never an input to authority derivation; grants are host-supplied only | V53-SEP-ED-01, V53-EFF-SEP-02 |
| **Compile cache != persistent state** | R-STATE-1, R-MEM-5: the cache holds immutable modules only; every invocation gets a fresh instance; persistence is v0.54 | V53-SEP-CACHE-01, V53-STATE-P01 |
| **DecisionEvidence != EffectReceipt** | typed-v0.53 changes neither record nor the Host Contract JSON codec. Their distinct domains `AIR_DECISION_EVIDENCE_V1` / `AIR_EFFECT_RECEIPT_V1` stay frozen, and unknown fields fail with `air.v051.record_invalid` [M53-E20; M53-A16; R14] | V53-SEP-DE-01 |

## 20. Map of the reviewer proof questions

| Q | Answered in |
| --- | --- |
| 1 authoritative semantics and export subset; source types versus the candidate grammar | §1.4, §2, §4, TRACEABILITY_95.json |
| 2 dimensions, domains, maxima, overflow, encodings | §6.2-§6.4 |
| 3 sequence, branches, calls, CFG, folds, callbacks, package edges; multiplicity; zero iterations | §6.5, §8, §9, §12 |
| 4 SCCs, missing summaries, unknown bounds, forged certificates; vector provenance | §6.6, §6.9 (R-WB-21), VECTORS.md |
| 5 transitive bytes in identity; no legacy PASS for a typed AST | §6.9, §12 R-IMP-5, R-WB-24 |
| 6 analyzer complexity | §6.8 |
| 7 emission budget at every entrypoint | R-WB-15, R-WB-17 |
| 8 regions, alias, liveness, views | §11 |
| 9 static versus entry-checked refinement; descriptor | §7 (OPEN-11) |
| 10 imports and demands without grants; discovery metadata; revocation versus cache | §12, §13, R-STATE-1 (a cache never holds authority; revocation itself is v0.54) |
| 11 deterministic migration and LEGACY_DEFECT handling | §14 |
| 12 per-slice tool behaviour | §15 R-ASSUR-1/2 |
| 13 canonical positives and negatives; verify⇒lower | R-COMP-3, §3.4, VECTORS.md |
| 14 gate mapping | §18.4 (the gates after SCOPE-1), §1.5 |

## 21. Open questions and terminal disposition

`OPEN_QUESTIONS.md` lists OPEN-1..OPEN-43 (R2 adds OPEN-36..42; R3 adds OPEN-43, the analysis-capacity values). Each can be
answered in one sentence and carries a recommendation and the slice it blocks. R3 makes every OPEN item reachable from the rows it
affects, the vectors that depend on it, or the decision surface (`TRACEABILITY_95.json` `open_item_reachability`;
`H53_DECISION_SURFACE.md`).

None of them blocks the P0-02 WorkBound foundation **contract**. With R2, §6 is a strict partial algebra (R-WB-2..2d). It depends
only on PROPOSED constants and names (WB_MAX, CT-1, the `air.workbound.*` codes, the record domain). Those are **not yet agreed**,
and H53-P0-RFC accepts or amends them. The OPEN items that touch WorkBound bind later slices or optional publication only:

- OPEN-13 author caps;
- OPEN-14 LOOP_MAX;
- OPEN-31 public record;
- OPEN-32 M1 projection;
- OPEN-33 digest basis (recommendation (c): raw digest);
- OPEN-36 closure limits (no imports in P0-02).

OPEN-39 (the H52_BASELINE definition) does not block the contract, but it does decide when P0-02 can be **activated**.
OPEN-43 (analysis-capacity values) does not block P0-02 either: the guard arrives with SCALAR, and P0-02 needs only the R3 fact
that analysis capacity is not in the WorkBound algebra (V53-ANA-07).

Activation of P0-02 still needs:

- ARCH53 R3 = PASS_FOR_H53_HUMAN_GATE on the R3 hashes (report `c6eda846…`), and a PASS of the narrow independent check of the
  exact R3→R3.1 errata delta (R3.1);
- H53-P0-RFC (§1.5), including acceptance or amendment of the PROPOSED §6 values, and the decision surface of
  `H53_DECISION_SURFACE.md`. Individual answers may be deferred to the owning slice where the surface says so;
- H52_BASELINE as decided under OPEN-39. The recommended (a), a PROPOSED_R0_AMENDMENT until adopted, is QA52 PASS plus H52
  exact-byte acceptance; npm publication, tags and dist-tags are separate release actions. Today the 0.52.1 candidate is
  REVIEWED_BUT_NOT_ACCEPTED / QA52_REQUEST_CHANGES, so this prerequisite is not met under any option;
- the five prerequisites of FIRST_IMPLEMENTATION_WORKBOUND [PROGRAM_DAG.md].

No implementation is authorized by this RFC. The R1 terminal (`P0_01_RFC_READY_FOR_ASTRA_AND_HUMAN_GATE`) and the R2 status
(`READY_FOR_ARCH53_REQA`) are superseded by the R3 revision status:

```text
P0_01_REVISION_STATUS=READY_FOR_ARCH53_R3_REQA
```

R3.1 errata status (after ARCH53 R3 = PASS_FOR_H53_HUMAN_GATE; Appendix E):

```text
P0_01_R3_1_STATUS=READY_FOR_NARROW_ARCH53_ERRATA_REVIEW
```

## Appendix A — Deprecation and out-of-core proposal register

Every entry is a proposal for H53-P0-RFC. "In typed" means the construct is not admitted in typed-v0.53 and fails with a stable code.
Legacy-v0.50 is unchanged unless a separate human decision says otherwise. **Every row requires an explicit human decision at
H53-P0-RFC** before it counts as a G53-LANG closure (R2; ARCH53 R7). Until then it is a proposal, not a closure.

| Item | Proposal | Human decision required (H53-P0-RFC) | Rows / ledger |
| --- | --- | --- | --- |
| `loop.range.*` alias | DEPRECATION_PROPOSED in typed | yes | M53-B05 |
| structured phi loops | DEPRECATION_PROPOSED in typed | yes | M53-B10; X-SND-01 |
| `loop.array.*`, `loop.buffer.f32` | DEPRECATION_PROPOSED in typed (OPEN-15) | yes | M53-B06; M53-B07 |
| `use utility.*` / `use math.fixed` bundles | DEPRECATION_PROPOSED in typed | yes | M53-D01; X-AUTH-01 |
| legacy contract syntax (`requires/ensures` param/return/metric/capability/export) | DEPRECATION_PROPOSED in typed (OPEN-12) | yes | M53-A14 |
| legacy `effects {}` mixed block | DEPRECATION_PROPOSED in typed; replaced by `demand` plus WorkBound | yes | M53-D10; M53-E14; X-WORK-03 |
| exported raw `ptr`, `buffer.from_ptr` over non-region pointers, `main(args: slice)` | DEPRECATION_PROPOSED in typed (OPEN-22) | yes | M53-C02; M53-C03; M53-C04 |
| legacy f32 helpers `f32.clamp/lerp/inverse_lerp`, `ease.*` (exact macros of admitted ops; R2 rationale, §5.3) | DEPRECATION_PROPOSED in typed; migration expands them exactly | yes | M53-A10 |
| `f32.sin`, `f32.cos` (approximations, §5.3) | DEPRECATION_PROPOSED in typed | yes | M53-A10 |
| `f32.sqrt` (native IEEE op; not an approximation) | not admitted in SCALAR; admission is OPEN-40 | yes | M53-A10 |
| public export of `parseV051Air` | DEPRECATION_PROPOSED (SDK notice; frozen reference runner keeps it). R3: both rows that name it carry `HUMAN_DECISION_REQUIRED=true` | yes | M53-A09; M53-A20; X-PROF-07 |
| `fixed.*` / `physics.*` helpers | OUT_OF_CORE_PROPOSED | yes | M53-A11 |
| `loop.poll`, `io.poll_bounded` | OUT_OF_CORE_PROPOSED | yes | M53-B08; M53-B09 |
| v0.49 run-facade grant/limits model | OUT_OF_CORE_PROPOSED plus DEPRECATION_PROPOSED | yes | M53-D13; X-AUTH-05 |
| ai_review anti-slop | OUT_OF_CORE_PROPOSED (advisory tooling; fail-closed floor for typed) | yes | M53-E03 |
| `print` / WASI `fd_write` | OUT_OF_CORE_PROPOSED (OPEN-23) | yes | M53-C09 |
| WIT emission for typed | OUT_OF_CORE_PROPOSED (OPEN-24) | yes | M53-C13; X-DOC-05 |
| typed-v0.53 assurance floor (provenance, semantic patch, audit/explain) | UNSUPPORTED_FAIL_CLOSED (parity OPEN-30) | yes | M53-E01; M53-E02; M53-E04 |
| `loop.map/while/for` | UNSUPPORTED_FAIL_CLOSED | yes | M53-B11 |
| async requests, realtime session, async buffer lifetime, legacy realtime fuel | DEFERRED_V054. SCOPE-1 moved the runtime gates; the row-level closure still needs a record. | yes | M53-C08; M53-D14; M53-D15; M53-E15 |

### Appendix A.2 — Scope decisions that need an owner record (R3; ARCH53 R2 P1-3)

These are not deprecations. They are scope closures that P0-00 classed as human decisions and that R2 had settled in prose only.

| Decision | Proposal | Human decision required (H53-P0-RFC) | Rows / ledger |
| --- | --- | --- | --- |
| D-SCOPE-01: AIR ABI 0.12 promotion | **Not promoted in v0.53.** ABI 0.12 stays a candidate behind `allowCandidateAbi012`; typed-v0.53 decouples its source types from the candidate descriptor grammar (R-TYPE-1..4) and maps refined exports by `desc` (R-TYPE-2). Promotion is a separate later human decision. P0-08 does not start before this record exists | yes | M53-C14; X-PROF-02 |

`H53_DECISION_SURFACE.md` is the complete list of what the owner decides at H53-P0-RFC:

- the PROPOSED values and the PROPOSED source shapes and spellings, rendered from the proposal records `PROPOSED_RECORDS.json`
  (R3.1; R3-N9). A proposal stays a proposal until the owner records it;
- every OPEN item, with the rows and vectors that depend on it;
- every row with `HUMAN_DECISION_REQUIRED=true` (Appendix A and A.2);
- every row with a non-empty `H53_DECISION_DEPENDENCY`;
- the OPEN-39 R0 amendment proposal;
- the PF-1/PF-2 planning recommendations (not gates).

## Appendix B — Ledger coverage (51/51)

| Ledger | Section | Ledger | Section |
| --- | --- | --- | --- |
| X-SND-01 | §6.11, §9, §14.4 | X-PROF-01 | §2.1-2.3 |
| X-SND-02 | §6.2 | X-PROF-02 | §4.1 |
| X-SND-03 | §6.5 R-WB-10, §12 | X-PROF-03 | §5 |
| X-SND-04 | §6.9-6.10 | X-PROF-04 | §7 |
| X-SND-05 | §11.1 R-MEM-0/1 (R3), §11.4 | X-PROF-05 | §15 R-ASSUR-1, §2.5 |
| X-SND-06 | §11.1 R-MEM-0/3 (R3), R-MEM-13 | X-PROF-06 | §3.2, §5.3, OPEN-4/9/17 |
| X-SND-07 | §11.1 R-MEM-4 | X-PROF-07 | §2.4 R-PROF-8 |
| X-SND-08 | §3.1 R-COMP-2, §10, §14.4 | X-PROF-08 | §2.4 R-PROF-7 |
| X-SND-09 | §7 R-REF-3/8 | X-AUTH-01 | §12 R-IMP-3 |
| X-SND-10 | §13 R-EFF-7 | X-AUTH-02 | §12 R-IMP-1/2 |
| X-SND-11 | §11.1 R-MEM-5/6 | X-AUTH-03 | §12 R-IMP-5 |
| X-SND-12 | §11.1 R-MEM-7 | X-AUTH-04 | §13 R-EFF-6 |
| X-BND-01 | §6.8 R-WB-15/17 (0.52.1 fixes legacy/typed-v0.51 CLI) | X-AUTH-05 | §13 R-EFF-7 |
| X-BND-02 | §6.8 (R3: R-WB-15b/15c, R-WB-16) | X-VL-01 | §3.1 R-COMP-3, §3.2 |
| X-BND-03 | §15 R-LSP-1 (0.52.1 fixes the legacy reader) | X-VL-02 | §12 R-IMP-1 (static link of the closure; loop callbacks and stdlib covered) |
| X-BND-04 | §6.5 R-WB-12, §10 | X-CONF-01 | §2.4 R-PROF-4, §14.5 |
| X-WORK-01 | §6.1 | X-CONF-02 | §5.3, §16 |
| X-WORK-02 | §6.11, VECTORS.md | X-CONF-03 | §15 R-DIAG-1/2 |
| X-WORK-03 | §13 R-EFF-3/4 | X-CONF-04 | §15 R-FMT-1 (OPEN-3) |
| X-WORK-04 | §6.9, R-WB-27a (R3) | X-CONF-05 | §15 R-LSP-1 |
| X-WORK-05 | §6.5 R-WB-9, §9 | X-CONF-06 | §3.1 R-COMP-4, R-LOOP-2, R-REF-2 |
| X-DOC-01 | P0-08 docs obligation (spec/MEMORY.md, AIR_CORE.md:335-339 rewritten for the typed profile) | X-DOC-02 | §2.1 |
| X-DOC-03 | P0-12 (V53-PUB-02) | X-DOC-04 | P0-12 docs hygiene (status drift) |
| X-DOC-05 | OPEN-24 | X-DOC-06 | P0-12 docs hygiene; R-MEM-8 |
| X-REL-01 | PROGRAM_DAG M1/H52 (activation prerequisite) | X-REL-02 | P0-12 docs (tag/npm naming) |
| X-REL-03 | PROGRAM_DAG M1 | | |

## Appendix C — ARCH53 R1 finding dispositions (R2)

Source: `inputs/ARCH53_R1_FINDINGS_FROM_OWNER_CHAT.md` (review findings, not authorization). `CHANGES_R2.md` lists every edit.

| Finding | Disposition | Where (sections) | Vectors |
| --- | --- | --- | --- |
| R1 WorkBound algebra (zero, regrouping, strictness) | **FIXED** | §6.2 R-WB-1..3 (strict partial algebra, canonical composition tree, no regrouping, `0 ⊗ fail = fail`, strict `max`, per-key effects); §6.4 loop row sub-nodes and entry node; §6.5 R-WB-9; §6.6 code mapping; §6.12; §21 (PROPOSED values not yet agreed) | V53-WB-P13, P14, N12, N13, N14, N15, N16, N17 |
| R2 semantic verification vs build admission vs environment; CT-1 observation domain; closure-wide effort | **FIXED** | §3.1 R-COMP-3 (rewritten); §3.4 (phases A/S/B/L/R/E, profile constants vs host limits); §6.4 (observation domain, entry scope, size-dependent rows, R-WB-26 closure, R-WB-27 versioning); §6.8 R-WB-15 (unique closure, closure limits OPEN-36), R-WB-15a (parser/type/graph effort), R-WB-17 | V53-PIPE-01..05, V53-WB-H10 (reclassified BUILD_REFUSED), V53-AGG-WB01, V53-MEM-WB03, V53-WB-N18 |
| R3 memory contract | **FIXED** | §11.1 R-MEM-1..12: extents, provenance, checked element→byte conversion, interior views against the remaining extent, overflow-safe checks, 16-byte base alignment, noescape across calls/callbacks/aggregates, host argument lifetime, live peak vs backing, frozen readonly↔readonly rule plus the AIR-owned exclusion; §11.4; §17 P0-08; OPEN-37 | V53-MEM-N15, P03, N16, P04, N17, P05, N19, N20, N21, WB02, WB03, P06, N22, N23, N08 (revised), N04/N05/N06 (codes), PIPE-03, PIPE-05 |
| R4 refined exports vs R-TYPE-2 | **FIXED** | §4.1 R-TYPE-2 (`desc` mapping); §7 R-REF-5 (five refinement entry points), R-REF-7 (parameter and result rules, build-record schema), R-REF-9 (failure-reason registry and transport, OPEN-38), R-REF-10 (WorkBound costs), R-REF-11 (adapter-contract impact); §17 P0-03 (not NONE) | V53-REF-P04 (revised), N03 (revised), N05 (revised), N08, N09, P05, N10, WB01, N11 |
| R5 correction records; 0.52.1 reconciliation; new exported globals | **FIXED** (the reconciliation with the *accepted* delta is explicitly **pending QA52/H52**) | §2.5 (three classes; R1 narrowing-only rule withdrawn); §2.6 (candidate identities, per-item provisional classes, AIR ABI / Host ABI / artifact-contract classification of `__air_owned_memory_base/end` and the slot layout, old/new artifact × host matrix); §2.2; §14.3; §17; OPEN-42 | V53-CR-01..04, V53-PROF-R03, V53-MEM-N23 |
| R6 minimum host-import safety | **FIXED** | §9 R-LOOP-2 (no new loop effects, no rollback of earlier effects); §13.1 R-EFF-8..13 (explicit handlers, no default authority, demand ≠ grant, count ≠ handler actions, no handler-termination claim, no reentrancy, error handling without rollback, result validation without JS coercion); §17 P0-10 | V53-EFF-N11, N12, N13, N14, V53-LOOP-N10 |
| R7 completeness (OPEN-35, VECTORS, TRACEABILITY, human-decision attachment) | **FIXED**. Partial disagreement with evidence: OPEN-35 was already complete in R1 (R1 `OPEN_QUESTIONS.md` sha256 `9ca6bdd3…`, row OPEN-35 has options, a recommendation, the blocking slice and refs); the reviewer appears to have received a truncated paste. R2 keeps the row complete and says so. | `OPEN_QUESTIONS.md` header and OPEN-35; `VECTORS.md` (287 vectors); `TRACEABILITY_95.json` (95 rows, classes unchanged, `HUMAN_DECISION_REQUIRED` on 37 rows); Appendix A (human-decision column); §18.4 G53-LANG | — (completeness) |
| Other: f32.sqrt/clamp/lerp rationale | **FIXED** (rationale corrected per op; no operation added) | §5.3 table; Appendix A; §14.4; OPEN-40 | V53-SCL-N13 (revised), N21, P30, V53-MIG-P05 |
| Other: NaN-payload observability | **FIXED** (no claim beyond NaN classification until OPEN-41 is decided) | §5.3 R-F32-1; R-EFF-13; OPEN-41 | V53-SCL-N22, V53-MEM-N24 |
| Other: H53-P0-RFC vs H53-RELEASE; H52_BASELINE; R0 wording | **FIXED** (amendment proposed, R0 not edited) | §1.5; §2.3 R-PROF-2/3; §18.1; §21; OPEN-39 | V53-PROF-N07 (gate independence) |
| Reviewer OPEN recommendations (OPEN-1, 5, 11, 22, 33) | incorporated as recommendations; the items stay OPEN | OPEN_QUESTIONS.md; §2.3, R-SCL-1, §7, §11.2, R-WB-18 | — |

## Appendix D — ARCH53 R2 finding dispositions (R3)

Source: `inputs/ARCH53_R2_REVIEW/REVIEW.md` (sha256 `2f24053f…`; review findings, not authorization) and the task text
`inputs/AIR_0053_P0_01_RFC_R3_TASK_FROM_OWNER_CHAT.md`, which carries the owner direction for P1-2. `CHANGES_R3.md` lists every
edit. The dispositions below are the author's claims. The narrow ARCH53 R3 re-review decides whether they hold.

| Finding | Disposition | Where (sections) | Vectors |
| --- | --- | --- | --- |
| P1-1 memory lower bounds | **FIXED** | §11.1 R-MEM-0 (domain table with zero semantics and source citations), R-MEM-1 (dynamic size domain, `max` shape), R-MEM-2 (frozen `0 ≤ o` restored; R2 form withdrawn), R-MEM-3 (`0 ≤ cap`; interior final byte), R-MEM-8 (`0 ≤ i < N` before multiplication), R-MEM-13 (precedence); R-REF-9 value 34 | V53-MEM-N25..N35, V53-MEM-P07, V53-AGG-N09 |
| P1-2 analyzer effort | **FIXED** (owner direction; model (ii)) | §3.4 (phase A capacity check, `ANALYSIS_REFUSED`, R-PIPE-1); §6.1 row; R-WB-2 set without `analysis_limit`; §6.6 (`analysis_limit_exceeded` withdrawn); R-WB-15a (no host-dependent widening), R-WB-15b (no input-proportional recursion), R-WB-15c (units, defaults, conformance floor, refusal, relation to other phases), R-WB-16; OPEN-43 | V53-ANA-01..08 |
| P1-3 human-decision accounting | **FIXED** | `TRACEABILITY_95.json` R3: A09 and A20 flagged (parseV051Air deprecation), C14 flagged (D-SCOPE-01), `H53_DECISION_DEPENDENCY` on every row whose disposition or scope depends on an OPEN item, `P0_00_HDR_RESOLUTION` for all 41 P0-00 HUMAN_DECISION_REQUIRED rows (E05: HD-4; E17, E18: HD-2); R-TYPE-3; R-PROF-8; Appendix A and A.2; §18.4; `H53_DECISION_SURFACE.md` | — (accounting) |
| P2-1 failure precedence | **FIXED** | R-WB-2 (sequence = left-nested binary ⊕ chain), R-WB-2f | V53-WB-N19, V53-WB-N20 |
| P2-2 region_bytes composition | **FIXED** | R-WB-2e, §6.3, §11.4 (sequence, branches, nested calls, loops, live vs cumulative, unknown, overflow) | V53-MEM-WB04..WB08 |
| P2-3 aggregate copy charging | **FIXED** | R-WB-26b; CT-1 return, call and loop rows; R-WB-8/9; R-CALL-1; R-LOOP-3 | V53-AGG-WB02..WB04 |
| P2-4 cost-table identity | **FIXED** | R-WB-27a; R-WB-18 key field `cost_table_digest`; R-WB-20 | V53-WB-ID-06 (revised), V53-WB-ID-07 |
| P2-5 `cost_undefined` phase | **FIXED** | §3.4 `IMPLEMENTATION_DEFECT`; R-WB-26; R-WB-2 set; §6.6; §15 | V53-WB-N18 (revised) |
| P2-6 V53-PIPE-02 | **FIXED** | §3.4 rule on vectors whose expectation is ENVIRONMENT_UNAVAILABLE; §6.12; §18.2 | V53-PIPE-02 (revised: typed-v0.51 input, P0-02), V53-PIPE-06 (SCALAR twin) |
| P2-7 vector kinds and non-executable entries | **FIXED** | §16 (kinds, owning and first executable slice); `VECTOR_INDEX.json`; VECTORS.md §DEFERRED; §18.2 deferral marks; R-WB-2b note (no invented twins) | V53-LOOP-N11 (the one cheap executable source case) |
| P2-8 failure registry and adapters | **FIXED** | R-REF-9 (bijective registry; 33/35 split; 49, 50 added; 34 covers every memory-domain check), R-REF-12 (old/new adapter × artifact matrix; enforceable vs not), §17 P0-03 | V53-REF-N12, V53-REF-N13 |
| P2-9 host result validation | **FIXED** | R-EFF-13 (`i64` BigInt range check; `f32` exact-representability check; NaN under OPEN-41; no ToBigInt64/ToFloat32 reliance) | V53-EFF-N15, V53-EFF-N16 |
| P2-10 owned-range trust | **FIXED** for typed-v0.53; the 0.52.1 side stays **DEPENDENT_ON_H52/OPEN-42** | R-MEM-4a (range from the verified build record, digest pinning, empty or understated range rejected); V53-CR-02 re-derived as a normative minimum plus an H52-dependent remainder | V53-MEM-N36..N38, V53-CR-02 (revised) |
| P2-11 OPEN items not traced | **FIXED** | `TRACEABILITY_95.json` R3 `OPEN_REFS` additions and `open_item_reachability` (43/43 reachable) | — |
| P2-12 OPEN-39 wording | **FIXED** | §1.5, §18.1, §21, OPEN-39 | — |
| P2-13 emission caps vs phase L | **FIXED** | §3.4 (L row; rule), R-WB-17, R-COMP-3 | V53-PIPE-01 (revised wording) |
| P2-14 dynamic region size identity | **FIXED** | R-MEM-0 row `alloc_region`, R-MEM-1 (`air.memory.region_bounds_runtime`, value 34, detail `region_size`, phase R; static and REGION_MAX cases), R-REF-9 | V53-MEM-N30 |

Kept unchanged from R2, as the task requires: the strict partial algebra and its zero and regrouping behaviour (V53-WB-N12 stays
`fail(overflow)`), the CT-1 observation domain (no existing scalar value changes; `tools/r3_model_values.mjs` re-derives LOOP-P01/P03
and CALL-P03), checked extents, provenance and noescape, the refined base-descriptor export design, the host-import minimum, the
sqrt/clamp/lerp facts, the bounded NaN claim, the H53-P0-RFC/H53-RELEASE separation, OPEN-39 separate from WorkBound, and the 95 P0-00
row IDs and OBLIGATION_CLASS values.

## Appendix E — R3.1 errata record (ARCH53 R3 residuals)

Source: `inputs/ARCH53_R3_REVIEW/REVIEW.md` (sha256 `c6eda846…`, PASS_FOR_H53_HUMAN_GATE, P0 = 0, P1 = 0, twelve P2 residuals) and the
task text `inputs/AIR_0053_P0_01_RFC_R3_1_ERRATA_TASK_FROM_OWNER_CHAT.md`. R3.1 is not R4. It changes no rule, value, expectation,
OBLIGATION_CLASS or RFC_DISPOSITION. `R3_1_DIFF_ATTRIBUTION.md` assigns every changed line to one of the items below, or to identity and
checksum propagation.

| Residual | Correction | Where |
| --- | --- | --- |
| R3-N7 WAT cap phase | V53-WB-H10 now says the cap is reached by the incremental emission check during phase L, with BUILD_REFUSED (expectation unchanged). The one RFC duplicate (§6.4 entry-summary scope said artifact bytes were bounded by phase-B admission) now matches §3.4 and R-WB-17 | VECTORS WB-H10; §6.4 |
| R3-N8 deferred metadata | V53-WB-H04 (part (b) = V53-ASSUR-01) and V53-WB-H10 (typed-v0.53 part) are deferred to SCALAR, with per-part first executable slices in `VECTOR_INDEX.json` (`parts`). Expectations unchanged. §DEFERRED lists 15 vectors | §18.2; VECTORS §DEFERRED; VECTOR_INDEX |
| R3-N9 decision-surface completeness | `PROPOSED_RECORDS.json` holds every PROPOSED value group and source shape or spelling with exact RFC anchors (D-VAL-01..24). The surface is rendered from TRACEABILITY + OPEN + these records and checks every anchor, and checks that every RFC line that marks a proposed shape, spelling or value group is covered. D-OPEN cells are no longer truncated. P0-00 HDR rows that rest on a proposal record name it in `P0_00_HDR_RESOLUTION` | Appendix A.2; PROPOSED_RECORDS.json; H53_DECISION_SURFACE.md; TRACEABILITY |
| R3-N10 stale baseline wording | V53-PROF-R03 no longer calls the candidate tree an H52_BASELINE. The candidate is REVIEWED_BUT_NOT_ACCEPTED (QA52 REQUEST_CHANGES), no H52_BASELINE exists, and the OPEN-39 proposal is restated with no future hash | VECTORS PROF-R03 |

Carried, not fixed (ARCH53 R3: not H53 blockers): R3-N1..N4 (SCALAR), R3-N5, R3-N6 (P0-03/P0-08), R3-N11, R3-N12 (P0-06/P0-07).
`R3_1_CARRIED_SLICE_OBLIGATIONS.md` gives each one's owning slice, exact obligation text and vector or test debt. The owning slice
discharges it in its slice text, reviewed with that slice.
> Shipped copy: this file is the accepted RFC text (sha256 8beba738f1f120329ec6520d078207afbb7ddaeedf8ce1b0291939a198a75d65) with exactly two changes: lines 13 to 15 name their evidence folders without the local path that preceded them, and this line is added.
