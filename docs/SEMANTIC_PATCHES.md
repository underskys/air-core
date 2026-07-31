# AIR Semantic Patches

Semantic patches are deterministic, digest-bound repair artifacts for exact
AIR packages. They compare canonical semantic objects and verified evidence.
A textual diff is never semantic proof.

## Boundary

The first version manages only package-local semantic documents:

- `air.package.json`;
- canonical AIR modules;
- JSON schemas referenced by the package manifest.

Operations target stable document identities and are one of:

- `add_semantic_object`;
- `remove_semantic_object`;
- `replace_semantic_object`.

Every operation binds the expected old digest and result digest. Operations
are sorted by target kind, package-local path, and operation. Duplicate or
non-canonical targets fail closed. Raw line offsets are not accepted.

## Identity

`air.semanticPatch` version `1.0` binds:

- exact base package, manifest, module, and document digests;
- exact expected result package, manifest, module, and document digests;
- canonical operations and per-operation digests;
- analyzer name, version, compiler version, and source digest;
- policy mode;
- creation authority, actor, human-forced flag, and optional reason code;
- analysis digest and domain-separated patch digest.

Application snapshots the physical base again, checks every operation
precondition, writes canonical AIR or stable-key JSON, snapshots the result,
checks the expected result tuple, and recomputes the semantic analysis. A
wrong base, substitution, replay against the result, or result mismatch is
rejected.

## Classifications

Exactly one terminal classification is emitted:

- `semantic_noop`;
- `narrowing`;
- `compatible_change`;
- `capability_expansion`;
- `effect_expansion`;
- `resource_expansion`;
- `export_expansion`;
- `contract_weakening`;
- `provenance_policy_expansion`;
- `declassification_authority_expansion`;
- `mixed_expansion`;
- `unknown_unproven`.

Strict mode accepts only semantic no-op, narrowing, and compatible change
when all compatibility invariants are proven. It rejects every expansion,
mixed expansion, weakening, incomplete resource comparison, and unknown
construct.

Semantic direction and API compatibility are separate. A narrower parameter
range or stronger precondition can be semantically narrowing while remaining
caller-incompatible.

## Compared Authority

The analyzer compares:

- declared and computed capabilities;
- used host imports;
- host effects and declared effect budgets;
- Verified Resource Certificate loop, fuel, memory, host-call, output, and
  effect bounds;
- exports, extern imports, package-local imports, function identity, and
  base signatures;
- `requires`, `ensures`, integer refinements, and slice-length refinements;
- required Provenance Flow mode, source labels, sink/storage ceilings,
  source bindings, schema `flowLabel` values, and declassifier authority.

Lower source labels, higher sink ceilings, removed storage ceilings, absent
required mode, and broader declassifiers are expansions. Missing comparable
resource evidence or changed unmodelled schema semantics are
`unknown_unproven`.

## Commands

```text
airc semantic-patch generate BASE RESULT -o patch.json \
  --mode strict \
  --authority-source human_user_direct \
  --actor codex.impl.air-language.m5 \
  --human-forced \
  --reason REASON_CODE

airc semantic-patch inspect patch.json --strict --json
airc semantic-patch verify patch.json --strict --json
airc semantic-patch apply patch.json BASE -o RESULT --strict --json
```

`verify package` and `evidence report` accept `--semantic-patch` and
`--semantic-patch-strict`. The resulting evidence adds a timestamp-free
`semanticPatch` section without replacing or mutating Provenance Flow or
Verified Resource Certificate evidence.

## Bounds

The analyzer fails closed beyond:

- 64 modules;
- 512 functions;
- 256 operations;
- 2,048 compared evidence entries;
- dependency depth 32;
- 1,024 findings.

Expansion findings are never silently truncated.

## Unsupported

This version does not:

- treat text similarity as semantic equivalence;
- edit raw line ranges;
- infer dynamic host behavior;
- prove semantic adequacy of declassification;
- compare unreferenced arbitrary package files;
- prove compatibility for unknown schemas or unsupported constructs;
- change parser, verifier, lowering, runtime representation, AIR ABI, or
  Host ABI.

## Rollback

Remove the semantic-patch module, CLI dispatch, and additive evidence/report
sections. Existing package verification, Provenance Flow evidence, resource
certificates, runtime representation, lowering, and ABI remain unchanged.
